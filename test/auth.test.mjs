// Tests for the auth core — run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  displayNameFromEmail,
  handleRequestCode,
  handleVerify,
  handleSession,
  MAX_ATTEMPTS,
} from '../lib/core.js';

const SECRET = 'test-secret';

test('displayNameFromEmail builds a readable name from the address', () => {
  assert.equal(displayNameFromEmail('lamar.garcia@bcflights.com'), 'Lamar Garcia');
  assert.equal(displayNameFromEmail('adhambadraan@bcflights.com'), 'Adhambadraan');
  assert.equal(displayNameFromEmail('a_smith-jr@bcflights.com'), 'A Smith Jr');
  assert.equal(displayNameFromEmail(''), 'Unknown user');
});

test('handleRequestCode rejects a bad address and a foreign domain', async () => {
  const bad = await handleRequestCode({ email: 'not-an-email', secret: SECRET, sendEmail: async () => ({ ok: true }) });
  assert.equal(bad.status, 400);

  const foreign = await handleRequestCode({ email: 'someone@gmail.com', secret: SECRET, sendEmail: async () => ({ ok: true }) });
  assert.equal(foreign.status, 403);
  assert.match(foreign.json.error, /@bcflights\.com/);
});

test('handleRequestCode emails the approver the requester name, email and code — with no name input', async () => {
  let payload = null;
  const out = await handleRequestCode({
    email: 'Lamar.Garcia@bcflights.com',
    secret: SECRET,
    sendEmail: async (p) => {
      payload = p;
      return { ok: true };
    },
  });

  assert.equal(out.status, 200);
  assert.equal(out.json.ok, true);
  assert.ok(!('devCode' in out.json), 'production mode must never return the code to the browser');
  assert.equal(payload.to, 'adhambadraan@gmail.com');
  assert.equal(payload.requester, 'lamar.garcia@bcflights.com');
  assert.equal(payload.name, 'Lamar Garcia');
  assert.match(payload.code, /^\d{6}$/);
  assert.match(out.json.message, /Lamar Garcia/);
});

test('handleRequestCode returns 502 when the email cannot be sent', async () => {
  const out = await handleRequestCode({
    email: 'lamar.garcia@bcflights.com',
    secret: SECRET,
    sendEmail: async () => ({ ok: false, error: 'Email send failed — boom' }),
  });
  assert.equal(out.status, 502);
  assert.match(out.json.error, /boom/);
});

test('full flow: the emailed code opens a session cookie', async () => {
  let code = null;
  const req = await handleRequestCode({
    email: 'lamar.garcia@bcflights.com',
    secret: SECRET,
    sendEmail: async (p) => {
      code = p.code;
      return { ok: true };
    },
  });
  assert.equal(req.status, 200);

  const ok = handleVerify({ token: req.json.token, code, email: 'lamar.garcia@bcflights.com', secret: SECRET });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.name, 'Lamar Garcia');
  assert.match(ok.cookie, /^slg_session=.*HttpOnly/);

  const cookie = ok.cookie.split(';')[0];
  const session = handleSession({ cookieHeader: cookie, secret: SECRET });
  assert.equal(session.status, 200);
  assert.equal(session.json.email, 'lamar.garcia@bcflights.com');
  assert.equal(session.json.name, 'Lamar Garcia');
  assert.ok(session.cookie, 'an active session rolls a fresh cookie');
});

test('idle sessions (>5 min unused) are refused, active ones roll forward', async () => {
  const { sign, IDLE_TTL_MS, SESSION_TTL_MS } = await import('../lib/core.js');
  const now = Date.now();

  const stale = sign(
    { email: 'x@bcflights.com', name: 'X', act: now - IDLE_TTL_MS - 1000, exp: now + SESSION_TTL_MS },
    SECRET
  );
  const idleOut = handleSession({ cookieHeader: 'slg_session=' + stale, secret: SECRET });
  assert.equal(idleOut.status, 401);
  assert.equal(idleOut.json.reason, 'idle');

  const fresh = sign({ email: 'x@bcflights.com', name: 'X', act: now, exp: now + SESSION_TTL_MS }, SECRET);
  const okOut = handleSession({ cookieHeader: 'slg_session=' + fresh, secret: SECRET });
  assert.equal(okOut.status, 200);
  assert.ok(okOut.cookie, 'active session gets a rolled cookie');
  // the rolled cookie must itself be valid
  const rolled = handleSession({ cookieHeader: okOut.cookie.split(';')[0], secret: SECRET });
  assert.equal(rolled.status, 200);
});

test('verify rejects a wrong code, a wrong secret and a mismatched email', async () => {
  let realCode = null;
  const req = await handleRequestCode({
    email: 'lamar.garcia@bcflights.com',
    secret: SECRET,
    sendEmail: async (p) => {
      realCode = p.code;
      return { ok: true };
    },
  });
  const wrongCode = realCode === '000000' ? '000001' : '000000';

  const wrong = handleVerify({ token: req.json.token, code: wrongCode, email: 'lamar.garcia@bcflights.com', secret: SECRET });
  assert.equal(wrong.status, 401);
  assert.match(wrong.json.error, new RegExp(`${MAX_ATTEMPTS - 1} attempts left`));

  const badSecret = handleVerify({ token: req.json.token, code: realCode, email: 'lamar.garcia@bcflights.com', secret: 'other' });
  assert.equal(badSecret.status, 401);

  const badEmail = handleVerify({ token: req.json.token, code: realCode, email: 'other@bcflights.com', secret: SECRET });
  assert.equal(badEmail.status, 401);
});

test('an expired code is refused', async () => {
  const { sign, CODE_TTL_MS } = await import('../lib/core.js');
  const expired = sign({ email: 'x@bcflights.com', codeHash: 'h', exp: Date.now() - CODE_TTL_MS, attempts: 0 }, SECRET);
  const out = handleVerify({ token: expired, code: '000000', email: 'x@bcflights.com', secret: SECRET });
  assert.equal(out.status, 401);
  assert.match(out.json.error, /expired/i);
});

test('handleSession refuses a missing or forged cookie', () => {
  assert.equal(handleSession({ cookieHeader: '', secret: SECRET }).status, 401);
  assert.equal(handleSession({ cookieHeader: 'slg_session=nonsense', secret: SECRET }).status, 401);
});
