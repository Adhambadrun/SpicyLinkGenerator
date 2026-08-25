// Shared authentication core for Spicy Link Generator.
// Real two-factor flow, stateless: everything is HMAC-SHA256 signed, so no database is needed.
//
//   1) request code  -> sign { email, codeHash, exp, attempts } -> return token to client
//   2) email code to approver (adhambadraan@icloud.com by default)
//   3) verify         -> check signature/expiry/code -> sign a 7-day session cookie
//
// Domain-locked to @bcflights.com by default (override with ALLOWED_DOMAIN).

import crypto from 'crypto';

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export const genCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

export const allowedDomain = () => (process.env.ALLOWED_DOMAIN || 'bcflights.com').toLowerCase();
export const approverEmail = () => process.env.APPROVER_EMAIL || 'adhambadraan@icloud.com';

export const CODE_TTL_MS = 10 * 60 * 1000;          // code lives 10 minutes
export const MAX_ATTEMPTS = 5;                       // wrong-code tries before a new code is required
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;  // session lives 7 days

export function sign(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function unsign(token, secret) {
  try {
    const s = String(token || '');
    const idx = s.indexOf('.');
    if (idx < 0) return null;
    const data = s.slice(0, idx);
    const sig = s.slice(idx + 1);
    const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!payload || typeof payload.exp !== 'number') return null;
    return payload;
  } catch {
    return null;
  }
}

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export async function handleRequestCode({ email, name, secret, sendEmail, devMode = false }) {
  const e = String(email || '').trim().toLowerCase();
  const n = String(name || '').trim().replace(/[<>]/g, '').slice(0, 80) || 'Unknown user';
  if (!EMAIL_RE.test(e)) return { status: 400, json: { error: 'Enter a valid email address.' } };
  if (e.split('@')[1] !== allowedDomain())
    return { status: 403, json: { error: `Only @${allowedDomain()} emails are allowed.` } };

  const code = genCode();
  const token = sign(
    { email: e, name: n, codeHash: sha256(code), exp: Date.now() + CODE_TTL_MS, attempts: 0 },
    secret
  );

  if (devMode) {
    // Local testing only — never enabled in production.
    return { status: 200, json: { ok: true, token, devCode: code, message: 'TEST MODE — code shown below (no email sent).' } };
  }

  const sent = await sendEmail({ to: approverEmail(), requester: e, name: n, code });
  const sentOk = sent === true || (sent && sent.ok === true);
  const sentErr = (sent && typeof sent.error === 'string' && sent.error) || '';
  if (!sentOk) {
    return { status: 502, json: { error: sentErr || 'Could not send the approval email. Check the server email configuration.' } };
  }
  return { status: 200, json: { ok: true, token, message: `A 6-digit code was sent to the approver for ${n} (${e}).` } };
}

export function handleVerify({ token, code, email, secret }) {
  if (!secret) return { status: 500, json: { error: 'Server not configured.' } };
  let p = unsign(token, secret);
  if (!p) return { status: 401, json: { error: 'Invalid request — ask for a new code.' } };
  if (Date.now() > p.exp) return { status: 401, json: { error: 'Code expired — request a new one.' } };
  if (String(email || '').trim().toLowerCase() !== p.email)
    return { status: 401, json: { error: 'Email does not match this code.' } };
  if ((p.attempts || 0) >= MAX_ATTEMPTS)
    return { status: 429, json: { error: 'Too many attempts — request a new code.' } };

  if (sha256(String(code || '').trim()) !== p.codeHash) {
    p.attempts = (p.attempts || 0) + 1;
    const remaining = MAX_ATTEMPTS - p.attempts;
    return {
      status: 401,
      json: { error: `Wrong code — ${remaining} attempt${remaining === 1 ? '' : 's'} left.`, token: sign(p, secret) },
    };
  }

  const session = sign({ email: p.email, name: p.name || '', exp: Date.now() + SESSION_TTL_MS }, secret);
  return {
    status: 200,
    json: { ok: true, email: p.email, name: p.name || '' },
    cookie: `slg_session=${session}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax`,
  };
}

export function handleSession({ cookieHeader, secret }) {
  if (!secret) return { status: 500, json: { ok: false } };
  const token = (cookieHeader || '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('slg_session='));
  if (!token) return { status: 401, json: { ok: false } };
  const p = unsign(token.slice('slg_session='.length), secret);
  if (!p || Date.now() > p.exp) return { status: 401, json: { ok: false } };
  return { status: 200, json: { ok: true, email: p.email, name: p.name || '' } };
}
