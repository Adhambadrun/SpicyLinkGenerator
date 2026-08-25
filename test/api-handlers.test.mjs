// Handler-level tests: drive the actual Vercel functions in api/ with stubbed req/res.
// Run with: npm test
//
// AUTH_SECRET is deliberately left unset so this exercises the zero-config default path,
// and RESEND_API_KEY is set to an invalid key so a test can never send a real email.
process.env.DEV_MODE = '1';
process.env.RESEND_API_KEY = 're_invalid_key_for_tests';
delete process.env.AUTH_SECRET;

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

test('api/request-code rejects a non-bcflights domain and a malformed body', async () => {
  let res = stubRes();
  await requestCode(post({ email: 'someone@gmail.com' }), res);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /@bcflights\.com/);

  res = stubRes();
  await requestCode(post('not json at all'), res);
  assert.equal(res.statusCode, 400);

  res = stubRes();
  await requestCode(get(), res);
  assert.equal(res.statusCode, 405);
});

test('api/request-code needs only an email, then api/verify + api/session complete the login', async () => {
  const res = stubRes();
  await requestCode(post({ email: 'lamar.garcia@bcflights.com' }), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok(res.body.token, 'a signed token must come back');
  assert.match(res.body.devCode, /^\d{6}$/, 'dev mode returns the code so the flow can be tested');

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
});

test('api/session is 401 without a cookie, api/health is ok', async () => {
  const s = stubRes();
  await session(get(), s);
  assert.equal(s.statusCode, 401);

  const h = stubRes();
  await health(get(), h);
  assert.equal(h.statusCode, 200);
  assert.equal(h.body.ok, true);
});
