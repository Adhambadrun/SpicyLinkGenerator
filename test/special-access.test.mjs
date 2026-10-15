// Tests for special (no-OTP) access — run with: npm test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SPECIAL_ACCESS,
  specialAccessMap,
  specialAccessPin,
  specialAccessEmails,
  specialAccessEnabled,
  specialAccessSummary,
  parseSpecialAccessList,
  isSpecialAccess,
  pinLockedOut,
  notePinFailure,
  clearPinFailures,
  resetPinFailures,
  PIN_MAX_FAILURES,
} from '../lib/special-access.js';
import { handleRequestCode, handleVerify, handleSession, MAX_ATTEMPTS, sha256 } from '../lib/core.js';

const SECRET = 'test-secret';
const SPECIAL = 'frank@bcflights.com';
const PIN = DEFAULT_SPECIAL_ACCESS[SPECIAL];

// These tests rewrite the environment and the shared lockout counter; undo both so one test
// cannot change the answer of the next one.
beforeEach(() => {
  resetPinFailures();
  delete process.env.SPECIAL_ACCESS;
  delete process.env.SPECIAL_ACCESS_PINS;
});

test('the four named inboxes each get their own 6-digit PIN', () => {
  const map = specialAccessMap();
  assert.deepEqual(Object.keys(map).sort(), [
    'dex@bcflights.com',
    'frank@bcflights.com',
    'lamar@bcflights.com',
    'lucy@bcflights.com',
  ]);

  for (const [email, pin] of Object.entries(map)) {
    assert.match(pin, /^\d{6}$/, `${email} must have exactly 6 digits`);
    assert.equal(specialAccessPin(email), pin);
  }

  assert.equal(new Set(Object.values(map)).size, 4, 'every inbox has a DIFFERENT PIN');
});

test('special access is matched case-insensitively', () => {
  assert.equal(isSpecialAccess('Frank@BCFlights.com'), true);
  assert.equal(isSpecialAccess('  LUCY@bcflights.com  '), true);
  assert.equal(isSpecialAccess('someone.else@bcflights.com'), false, 'an ordinary inbox is untouched');
  assert.equal(isSpecialAccess('frank@gmail.com'), false);
});

test('requesting a code for a special inbox sends NO email at all', async () => {
  let called = false;
  const out = await handleRequestCode({
    email: 'Frank@BCFlights.com',
    secret: SECRET,
    sendEmail: async () => {
      called = true;
      return { ok: true };
    },
  });

  assert.equal(called, false, 'the OTP email must not be sent — that is the whole point');
  assert.equal(out.status, 200);
  assert.equal(out.json.ok, true);
  assert.equal(out.json.specialAccess, true);
  assert.ok(!('devCode' in out.json), 'the PIN is never handed to the browser, not even in dev mode');
  assert.match(out.json.message, /access PIN/i);
  assert.ok(!new RegExp(PIN).test(JSON.stringify(out.json)), 'the response must not contain the PIN');
});

test('a special inbox signs in with no approver configured', async () => {
  const previous = process.env.APPROVER_EMAIL;
  process.env.APPROVER_EMAIL = 'none';
  try {
    const out = await handleRequestCode({ email: SPECIAL, secret: SECRET, sendEmail: async () => ({ ok: true }) });
    assert.equal(out.status, 200, 'no approver is needed, so the missing-inbox setup error cannot block them');
    assert.equal(out.json.specialAccess, true);
  } finally {
    if (previous === undefined) delete process.env.APPROVER_EMAIL;
    else process.env.APPROVER_EMAIL = previous;
  }
});

test('full special-access flow: the PIN opens a session cookie, no OTP involved', async () => {
  const req = await handleRequestCode({ email: SPECIAL, secret: SECRET, sendEmail: async () => ({ ok: true }) });
  assert.equal(req.status, 200);

  const ok = handleVerify({ token: req.json.token, code: PIN, email: SPECIAL, secret: SECRET });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.email, SPECIAL);
  assert.equal(ok.json.name, 'Frank');
  assert.match(ok.cookie, /^slg_session=.*HttpOnly/);

  const session = handleSession({ cookieHeader: ok.cookie.split(';')[0], secret: SECRET });
  assert.equal(session.status, 200);
  assert.equal(session.json.email, SPECIAL);
});

test('a wrong PIN is refused and reported as a PIN, not a code', async () => {
  const req = await handleRequestCode({ email: SPECIAL, secret: SECRET, sendEmail: async () => ({ ok: true }) });
  const wrong = PIN === '000000' ? '000001' : '000000';

  const out = handleVerify({ token: req.json.token, code: wrong, email: SPECIAL, secret: SECRET });
  assert.equal(out.status, 401);
  assert.match(out.json.error, /Wrong PIN/);

  // A colleague's PIN must not work on another colleague's inbox.
  const other = handleVerify({
    token: req.json.token,
    code: DEFAULT_SPECIAL_ACCESS['lucy@bcflights.com'],
    email: SPECIAL,
    secret: SECRET,
  });
  assert.equal(other.status, 401);
});

test('the token binds the PIN by hash, so it cannot be replayed with an emailed code', async () => {
  // What the token actually carries: the SHA-256 of the PIN, never the digits themselves.
  assert.notEqual(sha256(PIN), PIN);

  // An ordinary inbox still gets a real emailed OTP alongside the special one.
  let emailed = null;
  const normal = await handleRequestCode({
    email: 'agent@bcflights.com',
    secret: SECRET,
    sendEmail: async (p) => {
      emailed = p.code;
      return { ok: true };
    },
  });
  assert.equal(normal.status, 200);
  assert.equal(normal.json.specialAccess, undefined, 'the normal flow is unchanged');
  assert.match(emailed, /^\d{6}$/);
  assert.equal(handleVerify({ token: normal.json.token, code: emailed, email: 'agent@bcflights.com', secret: SECRET }).status, 200);

  // ...and Frank's PIN does not open that inbox.
  assert.equal(
    handleVerify({ token: normal.json.token, code: PIN, email: 'agent@bcflights.com', secret: SECRET }).status,
    401
  );
});

test('SPECIAL_ACCESS_PINS replaces the built-in defaults', () => {
  process.env.SPECIAL_ACCESS_PINS = 'New.Boss@BCFlights.com = 246810, ops@bcflights.com:135791';
  try {
    const map = specialAccessMap();
    assert.deepEqual(map, { 'new.boss@bcflights.com': '246810', 'ops@bcflights.com': '135791' });
    assert.equal(specialAccessPin('new.boss@bcflights.com'), '246810');
    assert.equal(specialAccessPin(SPECIAL), '', 'a rotated list drops the committed defaults');
  } finally {
    delete process.env.SPECIAL_ACCESS_PINS;
  }
});

test('SPECIAL_ACCESS=off sends those inboxes back through the OTP approval flow', async () => {
  process.env.SPECIAL_ACCESS = 'off';
  try {
    assert.equal(specialAccessEnabled(), false);
    assert.deepEqual(specialAccessMap(), {});
    assert.equal(specialAccessSummary().enabled, false);

    let emailed = null;
    const out = await handleRequestCode({
      email: SPECIAL,
      secret: SECRET,
      sendEmail: async (p) => {
        emailed = p.code;
        return { ok: true };
      },
    });
    assert.equal(out.status, 200);
    assert.equal(out.json.specialAccess, undefined, 'no bypass while switched off');
    assert.match(emailed, /^\d{6}$/, 'a real OTP is emailed again');
    assert.notEqual(emailed, PIN);
  } finally {
    delete process.env.SPECIAL_ACCESS;
  }
});

test('malformed override entries are dropped instead of trusted', () => {
  assert.deepEqual(parseSpecialAccessList('no-separator-here'), {});
  assert.deepEqual(parseSpecialAccessList('a@b.com=12345'), {}, 'a 5-digit PIN is not accepted');
  assert.deepEqual(parseSpecialAccessList('a@b.com=1234567'), {}, 'a 7-digit PIN is not accepted');
  assert.deepEqual(parseSpecialAccessList('a@b.com=abcdef'), {});
  assert.deepEqual(parseSpecialAccessList('  ,  ;  '), {});
  assert.deepEqual(parseSpecialAccessList('a@b.com=123456'), { 'a@b.com': '123456' });

  // A list that yields nothing valid must not silently disable the feature.
  process.env.SPECIAL_ACCESS_PINS = 'garbage';
  try {
    assert.equal(specialAccessPin(SPECIAL), PIN, 'the defaults still apply');
  } finally {
    delete process.env.SPECIAL_ACCESS_PINS;
  }
});

test('repeated wrong PINs lock the inbox even across fresh tokens', async () => {
  const requestToken = async () =>
    (await handleRequestCode({ email: SPECIAL, secret: SECRET, sendEmail: async () => ({ ok: true }) })).json.token;
  const wrong = PIN === '000000' ? '000001' : '000000';

  // A token minted BEFORE the lockout, to prove the lockout applies to it as well.
  const preLock = await requestToken();
  assert.ok(preLock);

  let token = preLock;
  let lockout = null;
  // The per-token budget (MAX_ATTEMPTS) trips before the per-inbox lockout and returns its own
  // 429. Keep asking for a new token: the per-inbox counter must carry on across tokens.
  for (let i = 0; i < PIN_MAX_FAILURES * 4 && !lockout; i += 1) {
    const out = handleVerify({ token, code: wrong, email: SPECIAL, secret: SECRET });
    if (out.status === 429 && /wait \d+ minutes/i.test(out.json.error)) {
      lockout = out;
      break;
    }
    token = out.json.token || (await requestToken());
  }

  assert.ok(lockout, 'the inbox is locked out after repeated wrong PINs');
  assert.equal(lockout.status, 429);
  assert.match(lockout.json.error, /wait \d+ minutes/i);
  assert.equal(pinLockedOut(SPECIAL), true);

  // An already-issued token is refused even with the correct PIN...
  assert.equal(
    handleVerify({ token: preLock, code: PIN, email: SPECIAL, secret: SECRET }).status,
    429,
    'a locked inbox is refused even with the correct PIN'
  );

  // ...and no new token is minted, so there is nothing left to guess against.
  const blockedRequest = await handleRequestCode({ email: SPECIAL, secret: SECRET, sendEmail: async () => ({ ok: true }) });
  assert.equal(blockedRequest.status, 429);
  assert.match(blockedRequest.json.error, /wait \d+ minutes/i);
  assert.equal(blockedRequest.json.token, undefined, 'no new token is minted while locked');

  clearPinFailures(SPECIAL);
  assert.equal(pinLockedOut(SPECIAL), false);
  const after = await handleRequestCode({ email: SPECIAL, secret: SECRET, sendEmail: async () => ({ ok: true }) });
  assert.equal(after.status, 200, 'clearing the counter lets them back in');
  assert.equal(handleVerify({ token: after.json.token, code: PIN, email: SPECIAL, secret: SECRET }).status, 200);
});

test('a correct PIN wipes the failure counter, so one typo never adds up', () => {
  assert.equal(notePinFailure(SPECIAL).remaining, PIN_MAX_FAILURES - 1);
  assert.equal(notePinFailure(SPECIAL).remaining, PIN_MAX_FAILURES - 2);
  clearPinFailures(SPECIAL);
  assert.equal(pinLockedOut(SPECIAL), false);
  assert.equal(notePinFailure(SPECIAL).remaining, PIN_MAX_FAILURES - 1);
});

test('the per-token attempt budget still applies to a special-access token', async () => {
  const req = await handleRequestCode({ email: SPECIAL, secret: SECRET, sendEmail: async () => ({ ok: true }) });
  const wrong = PIN === '000000' ? '000001' : '000000';
  let token = req.json.token;
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    const out = handleVerify({ token, code: wrong, email: SPECIAL, secret: SECRET });
    if (out.status === 429) {
      assert.match(out.json.error, /Too many attempts/);
      return;
    }
    token = out.json.token;
  }
  assert.equal(handleVerify({ token, code: wrong, email: SPECIAL, secret: SECRET }).status, 429);
});

test('the health summary counts accounts without publishing the addresses or PINs', () => {
  const summary = specialAccessSummary();
  assert.deepEqual(summary, { enabled: true, accounts: specialAccessEmails().length });
  assert.equal(summary.accounts, 4);
  assert.ok(!JSON.stringify(summary).includes('@'), 'no address leaks into the public health payload');
  assert.ok(!JSON.stringify(summary).includes(PIN), 'no PIN leaks into the public health payload');
});
