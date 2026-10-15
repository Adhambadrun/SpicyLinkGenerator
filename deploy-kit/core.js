// Shared authentication core for Spicy Link Generator.
// Real two-factor flow, stateless: everything is HMAC-SHA256 signed, so no database is needed.
//
//   1) user enters their @bcflights.com or @travelbusinessclass.com email (no name is asked for)
//   2) request code -> sign { email, name (derived from the email), codeHash, exp, attempts }
//   3) email the 6-digit code — plus who is asking for it — to the APPROVER inbox
//      (APPROVER_EMAIL, by default adhambadraan@gmail.com). The approver passes the code on
//      to that person, so every sign-in is approved by a human. Nothing is ever emailed to
//      the person signing in.
//   4) verify       -> check signature/expiry/code -> sign a session cookie (stays alive while the tab is open)
//
// A few named inboxes are exempt from step 3: they sign in with a fixed 6-digit access PIN
// instead of an emailed OTP, so no approver has to relay a code. The PIN simply replaces the
// code — see lib/special-access.js for the list, the environment overrides, and the security
// notes on standing credentials.
//
// Domain-locked to @bcflights.com and @travelbusinessclass.com by default
// (override with ALLOWED_DOMAINS — comma-separated — or the legacy single ALLOWED_DOMAIN).

import crypto from 'crypto';
import {
  specialAccessPin,
  pinLockedOut,
  notePinFailure,
  clearPinFailures,
  PIN_LOCKOUT_MS,
} from './special-access.js';

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

export const DEFAULT_ALLOWED_DOMAINS = ['bcflights.com', 'travelbusinessclass.com'];

// Returns the list of email domains that may sign in. Accepts a comma/space/semicolon-separated
// list in ALLOWED_DOMAINS (preferred) or the legacy single-value ALLOWED_DOMAIN; a leading "@"
// on any entry is tolerated. Falls back to DEFAULT_ALLOWED_DOMAINS when neither is set.
// An environment object can be passed in (the mailer derives its sender address from it).
export function allowedDomains(environment = process.env) {
  const env = environment || {};
  const raw = env.ALLOWED_DOMAINS || env.ALLOWED_DOMAIN || '';
  const list = String(raw)
    .split(/[,\s;]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@+/, ''))
    .filter(Boolean);
  return list.length ? [...new Set(list)] : [...DEFAULT_ALLOWED_DOMAINS];
}

// Back-compat: the first allowed domain (older callers / docs used a single value).
export const allowedDomain = () => allowedDomains()[0];

export const isAllowedDomain = (domain) => allowedDomains().includes(String(domain || '').toLowerCase());

// "@bcflights.com or @travelbusinessclass.com" — used in error messages and hints.
export const allowedDomainsLabel = () => {
  const list = allowedDomains().map((d) => `@${d}`);
  return list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`;
};

// Who receives the 6-digit code for every sign-in attempt. The default is the owner's own
// inbox, and that default is what makes the built-in sender work: Resend's shared sender
// (onboarding@resend.dev) can only deliver to the address its account is registered to,
// which is normally exactly this inbox. Set APPROVER_EMAIL to a different address (or to
// "none"/"disabled" to switch the approval relay off) and redeploy.
export const DEFAULT_APPROVER_EMAIL = 'adhambadraan@gmail.com';

export function approverEmail(environment = process.env) {
  const raw = environment ? environment.APPROVER_EMAIL : undefined;
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value === 'none' || value === 'disabled') return '';
  return value || DEFAULT_APPROVER_EMAIL;
}

export const CODE_TTL_MS = 10 * 60 * 1000;          // code lives 10 minutes
export const MAX_ATTEMPTS = 5;                       // wrong-code tries before a new code is required
// Sessions do NOT time out while the tab is open: every heartbeat (/api/session) rolls the
// expiry forward by SESSION_TTL_MS, so a signed-in user stays signed in indefinitely. The
// per-tab sessionStorage flag in the browser is what ends the session when the tab closes,
// so the next visit always starts at the OTP login.
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;  // rolling window, refreshed on every heartbeat

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
// email local-part ("lamar.garcia@…" → "Lamar Garcia"). It is only used as a greeting
// in the sign-in email — never as an identity check.
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
  if (!isAllowedDomain(e.split('@')[1]))
    return { status: 403, json: { error: `Only ${allowedDomainsLabel()} emails are allowed.` } };

  // Special-access inboxes stop here: no approver, no email, no OTP. The token carries the
  // SHA-256 of that inbox's fixed PIN, so handleVerify() and everything after it are unchanged
  // — same token expiry, same signed session cookie. See lib/special-access.js.
  const pin = specialAccessPin(e);
  if (pin) {
    // A locked inbox is told before any token is minted, so hammering "request code" cannot
    // be used to keep guessing past the throttle.
    if (pinLockedOut(e)) {
      return {
        status: 429,
        json: { error: `Too many wrong PIN attempts — wait ${PIN_LOCKOUT_MS / 60000} minutes and try again.` },
      };
    }
    // Audit trail for whoever reads the platform logs. The browser is told only that it should
    // ask for a PIN — never the PIN itself, not even in DEV_MODE.
    console.log(`[spicy-link-generator] special access: ${e} requested sign-in (no OTP emailed)`);
    const token = sign(
      { email: e, name: displayNameFromEmail(e), codeHash: sha256(pin), exp: Date.now() + CODE_TTL_MS, attempts: 0, special: true },
      secret
    );
    return {
      status: 200,
      json: {
        ok: true,
        token,
        specialAccess: true,
        message: `No email code is sent for ${e} — enter your 6-digit access PIN.`,
      },
    };
  }

  // The code is delivered to the approver inbox, so without one there is no way to finish
  // a sign-in. This is a deployment problem, not something the visitor typed.
  const approver = approverEmail();
  if (!approver) {
    return {
      status: 500,
      json: {
        error:
          'Email delivery is not configured — set APPROVER_EMAIL to the inbox that should receive ' +
          'sign-in codes, then redeploy.',
        setupError: true,
      },
    };
  }

  const n = displayNameFromEmail(e);
  const code = genCode();
  const token = sign(
    { email: e, name: n, codeHash: sha256(code), exp: Date.now() + CODE_TTL_MS, attempts: 0 },
    secret
  );

  // The code always goes to the approver — never to the browser, and never to the person
  // signing in. The approver reads off the 6 digits; the domain lock above decides who may
  // even raise a request.
  const sent =
    typeof sendEmail === 'function'
      ? await sendEmail({ to: approver, requester: e, name: n, code })
      : false;
  const sentOk = sent === true || (sent && sent.ok === true);
  const sentErr = (sent && typeof sent.error === 'string' && sent.error) || '';
  // Configuration-class failures (sandbox sender, unverified domain, bad API key) are
  // marked so the login page can present them as "setup needed" instead of a wrong code.
  const sentSetup = Boolean(sent && sent.ok !== true && sent.setup === true);

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
          ? `${label} — approval email sent to ${approver} for ${e}. Code also shown below.`
          : `${label} — approval email NOT sent to ${approver} for ${e} (${sentErr || 'no sender configured'}). Code shown below.`,
      },
    };
  }

  if (!sentOk) {
    return {
      status: 502,
      json: {
        error: sentErr || 'Could not send the sign-in code to the approver. Check the server email configuration.',
        setupError: sentSetup,
      },
    };
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

  // A special-access token is checked against a fixed PIN rather than a fresh OTP, so the
  // per-token budget below is not enough on its own: request a new token and it resets. The
  // per-inbox lockout carries on across tokens instead, and is checked first so a locked inbox
  // is always told it is locked rather than being invited to ask for another code.
  // See lib/special-access.js.
  const special = Boolean(p.special);
  const word = special ? 'PIN' : 'code';
  if (special && pinLockedOut(p.email)) {
    return {
      status: 429,
      json: { error: `Too many wrong PIN attempts — wait ${PIN_LOCKOUT_MS / 60000} minutes and try again.` },
    };
  }

  if ((p.attempts || 0) >= MAX_ATTEMPTS)
    return { status: 429, json: { error: 'Too many attempts — request a new code.' } };

  if (sha256(String(code || '').trim()) !== p.codeHash) {
    p.attempts = (p.attempts || 0) + 1;
    if (special) notePinFailure(p.email);
    const remaining = MAX_ATTEMPTS - p.attempts;
    return {
      status: 401,
      json: { error: `Wrong ${word} — ${remaining} attempt${remaining === 1 ? '' : 's'} left.`, token: sign(p, secret) },
    };
  }

  if (special) clearPinFailures(p.email);

  return {
    status: 200,
    json: { ok: true, email: p.email, name: p.name || '' },
    cookie: sessionCookie({ email: p.email, name: p.name || '', exp: Date.now() + SESSION_TTL_MS }, secret),
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
  // Roll the expiry forward so a signed-in tab stays signed in (no idle timeout).
  return {
    status: 200,
    json: { ok: true, email: p.email, name: p.name || '' },
    cookie: sessionCookie({ email: p.email, name: p.name || '', exp: now + SESSION_TTL_MS }, secret),
  };
}
