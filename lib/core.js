// Shared authentication core for Spicy Link Generator.
// Real two-factor flow, stateless: everything is HMAC-SHA256 signed, so no database is needed.
//
//   1) user enters their @bcflights.com email (no name is asked for)
//   2) request code -> sign { email, name (derived from the email), codeHash, exp, attempts }
//   3) email name + email + code to the approver (adhambadraan@gmail.com by default)
//   4) verify       -> check signature/expiry/code -> sign a 7-day session cookie
//
// Domain-locked to @bcflights.com by default (override with ALLOWED_DOMAIN).

import crypto from 'crypto';

// The API handlers fall back to this when AUTH_SECRET is not set, so the app runs with
// zero configuration. On a PUBLIC repository it should be replaced with a real secret
// (Vercel → Settings → Environment Variables → AUTH_SECRET), because whoever knows the
// secret can mint a valid session cookie and skip the approval step entirely.
export const DEFAULT_AUTH_SECRET = 'spicy-link-generator-default-secret-change-me';

export function warnIfDefaultSecret(secret) {
  if (!secret || secret === DEFAULT_AUTH_SECRET) {
    console.warn(
      '[spicy-link-generator] AUTH_SECRET is not set — using the built-in default. ' +
        'Set AUTH_SECRET (openssl rand -hex 32) in your environment before this repo is public.'
    );
  }
}

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export const genCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

export const allowedDomain = () => (process.env.ALLOWED_DOMAIN || 'bcflights.com').toLowerCase();
export const approverEmail = () => process.env.APPROVER_EMAIL || 'adhambadraan@gmail.com';

export const CODE_TTL_MS = 10 * 60 * 1000;          // code lives 10 minutes
export const MAX_ATTEMPTS = 5;                       // wrong-code tries before a new code is required
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;  // hard cap: session lives 7 days
export const IDLE_TTL_MS = 5 * 60 * 1000;            // unused for 5 minutes → session dies

export function sessionCookie(payload, secret) {
  return `slg_session=${sign(payload, secret)}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax`;
}

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

// The login page no longer asks for a name, so we build a readable one from the
// email local-part ("lamar.garcia@…" → "Lamar Garcia"). It is only used as a label
// in the approval email — never as an identity check.
export function displayNameFromEmail(email) {
  const local = String(email || '')
    .split('@')[0]
    .replace(/[<>]/g, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const pretty = local
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 80)
    .trim();
  return pretty || local || 'Unknown user';
}

export async function handleRequestCode({ email, secret, sendEmail, devMode = false, debugModeLabel = 'LOCAL MODE' }) {
  const e = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return { status: 400, json: { error: 'Enter a valid email address.' } };
  if (e.split('@')[1] !== allowedDomain())
    return { status: 403, json: { error: `Only @${allowedDomain()} emails are allowed.` } };

  const n = displayNameFromEmail(e);
  const code = genCode();
  const token = sign(
    { email: e, name: n, codeHash: sha256(code), exp: Date.now() + CODE_TTL_MS, attempts: 0 },
    secret
  );

  const sent =
    typeof sendEmail === 'function'
      ? await sendEmail({ to: approverEmail(), requester: e, name: n, code })
      : false;
  const sentOk = sent === true || (sent && sent.ok === true);
  const sentErr = (sent && typeof sent.error === 'string' && sent.error) || '';

  if (devMode) {
    // Local testing or protected preview only. The code is handed back so the
    // flow can still be completed when no provider send is possible.
    const label = String(debugModeLabel || 'DEBUG MODE').trim() || 'DEBUG MODE';
    return {
      status: 200,
      json: {
        ok: true,
        token,
        devCode: code,
        message: sentOk
          ? `${label} — approval email sent to ${approverEmail()}. Code also shown below.`
          : `${label} — approval email NOT sent (${sentErr || 'no sender configured'}). Code shown below.`,
      },
    };
  }

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

  // `act` = last activity stamp; handleSession rolls it forward on every heartbeat,
  // so a session left unused for IDLE_TTL_MS is refused server-side.
  return {
    status: 200,
    json: { ok: true, email: p.email, name: p.name || '' },
    cookie: sessionCookie({ email: p.email, name: p.name || '', act: Date.now(), exp: Date.now() + SESSION_TTL_MS }, secret),
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
  const now = Date.now();
  if (!p || now > p.exp) return { status: 401, json: { ok: false } };
  // Idle rule: no heartbeat for IDLE_TTL_MS → dead, even if the cookie itself is fresh.
  // (Cookies minted before `act` existed fail this check once, forcing a re-login.)
  if (now - (p.act || 0) > IDLE_TTL_MS) return { status: 401, json: { ok: false, reason: 'idle' } };
  // Roll the activity stamp forward so active tabs stay signed in.
  return {
    status: 200,
    json: { ok: true, email: p.email, name: p.name || '' },
    cookie: sessionCookie({ ...p, act: now }, secret),
  };
}
