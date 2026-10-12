// Handler-level tests: drive the actual Vercel functions in api/ with stubbed req/res.
// Run with: npm test
//
// AUTH_SECRET is deliberately left unset so this exercises the local default path.
// DEV_MODE allows the request to complete without a provider; with no API key the
// handler must never attempt a real email during tests.
process.env.DEV_MODE = '1';
delete process.env.RESEND_API_KEY;
delete process.env.AUTH_SECRET;
// The assertions below rely on the built-in defaults rather than whatever the machine has.
delete process.env.ALLOWED_DOMAINS;
delete process.env.ALLOWED_DOMAIN;
delete process.env.FROM_EMAIL;

import { test } from 'node:test';
import assert from 'node:assert/strict';

const requestCode = (await import('../api/request-code.js')).default;
const verify = (await import('../api/verify.js')).default;
const session = (await import('../api/session.js')).default;
const health = (await import('../api/health.js')).default;

function stubRes() {
  const res = { statusCode: 0, headers: {}, body: null };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (o) => {
    res.body = o;
    return res;
  };
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  return res;
}

const post = (body) => ({ method: 'POST', body });
const get = () => ({ method: 'GET', headers: {} });

test('api/request-code rejects a non-allowed domain and a malformed body', async () => {
  let res = stubRes();
  await requestCode(post({ email: 'someone@gmail.com' }), res);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /@bcflights\.com/);
  assert.match(res.body.error, /@travelbusinessclass\.com/);

  res = stubRes();
  await requestCode(post('not json at all'), res);
  assert.equal(res.statusCode, 400);

  res = stubRes();
  await requestCode(get(), res);
  assert.equal(res.statusCode, 405);
});

test('api/request-code requires a provider key outside local development mode when disabled', async () => {
  const previousMode = process.env.DEV_MODE;
  const previousVercelEnv = process.env.VERCEL_ENV;
  const previousKey = process.env.RESEND_API_KEY;
  delete process.env.DEV_MODE;
  delete process.env.VERCEL_ENV;
  process.env.RESEND_API_KEY = 'disabled';
  const res = stubRes();
  await requestCode(post({ email: 'lamar.garcia@bcflights.com' }), res);
  assert.equal(res.statusCode, 500);
  assert.match(res.body.error, /RESEND_API_KEY/);
  if (previousMode === undefined) delete process.env.DEV_MODE;
  else process.env.DEV_MODE = previousMode;
  if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = previousVercelEnv;
  if (previousKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = previousKey;
});

test('api/request-code needs only an email, then api/verify + api/session complete the login', async () => {
  const res = stubRes();
  await requestCode(post({ email: 'lamar.garcia@bcflights.com' }), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok(res.body.token, 'a signed token must come back');
  assert.match(res.body.devCode, /^\d{6}$/, 'dev mode returns the code so the flow can be tested');
  assert.match(res.body.message, /lamar\.garcia@bcflights\.com/, 'the code is aimed at the requester, never an approver');

  const v = stubRes();
  await verify(post({ token: res.body.token, code: res.body.devCode, email: 'lamar.garcia@bcflights.com' }), v);
  assert.equal(v.statusCode, 200, JSON.stringify(v.body));
  assert.ok(v.headers['Set-Cookie'], 'a session cookie must be set');
  assert.match(v.headers['Set-Cookie'], /slg_session=/);

  const cookie = v.headers['Set-Cookie'].split(';')[0];
  const s = stubRes();
  await session({ ...get(), headers: { cookie } }, s);
  assert.equal(s.statusCode, 200);
  assert.equal(s.body.email, 'lamar.garcia@bcflights.com');
  assert.equal(s.body.name, 'Lamar Garcia');
  assert.match(s.headers['Set-Cookie'] || '', /slg_session=/, 'active sessions roll a fresh cookie');
});

test('api/request-code falls back to preview debug mode when VERCEL_ENV=preview and no key exists', async () => {
  const previousMode = process.env.DEV_MODE;
  const previousVercelEnv = process.env.VERCEL_ENV;
  const previousKey = process.env.RESEND_API_KEY;
  delete process.env.DEV_MODE;
  process.env.VERCEL_ENV = 'preview';
  process.env.RESEND_API_KEY = 'disabled';

  const res = stubRes();
  await requestCode(post({ email: 'lamar.garcia@bcflights.com' }), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.match(res.body.devCode, /^\d{6}$/);
  assert.match(res.body.message, /PREVIEW MODE/);

  if (previousMode === undefined) delete process.env.DEV_MODE;
  else process.env.DEV_MODE = previousMode;
  if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = previousVercelEnv;
  if (previousKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = previousKey;
});

test('api/session is 401 without a cookie, api/health is ok and reports mailConfigured', async () => {
  const s = stubRes();
  await session(get(), s);
  assert.equal(s.statusCode, 401);

  const h = stubRes();
  await health(get(), h);
  assert.equal(h.statusCode, 200);
  assert.equal(h.body.ok, true);
  assert.equal(h.body.mailConfigured, false);
  // Without an explicit FROM_EMAIL the sender is onboarding@resend.dev — never an
  // address on one of the sign-in domains.
  assert.equal(h.body.mailFrom, 'Spicy Link Generator <onboarding@resend.dev>');
  assert.equal(h.body.mailCanSendToUsers, false, 'no API key yet, so nothing can be sent');
  assert.match(h.body.setupHint, /resend\.com\/domains/);
});

test('api/health warns when the sender is still the resend.dev sandbox address', async () => {
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.FROM_EMAIL;
  process.env.RESEND_API_KEY = 're_test';
  process.env.FROM_EMAIL = 'Spicy Link Generator <onboarding@resend.dev>';

  try {
    const h = stubRes();
    await health(get(), h);
    assert.equal(h.statusCode, 200);
    assert.equal(h.body.mailConfigured, true);
    assert.equal(h.body.mailCanSendToUsers, false, 'the sandbox sender can only email the Resend account owner');
    assert.match(h.body.setupHint, /resend\.com\/domains/);
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.FROM_EMAIL;
    else process.env.FROM_EMAIL = previousFrom;
  }
});
