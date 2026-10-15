// Special access: a fixed 6-digit access PIN for a few named inboxes, so those people can
// sign in WITHOUT the emailed OTP — no approver has to relay a code to them.
//
//   normal flow    email → request code → 6 digits emailed to the APPROVER → verify
//   special flow   email → request code → (nothing is emailed)             → verify with the PIN
//
// The PIN replaces the emailed code rather than bypassing the check: handleRequestCode() signs
// a token whose codeHash is the SHA-256 of that inbox's PIN, and handleVerify() compares the
// typed digits against it exactly as it would an OTP. Nothing downstream changes — the same
// signed session cookie is issued, and the same 10-minute token expiry applies.
//
// ── SECURITY — read before changing this file ──────────────────────────────────────────────
// A fixed PIN is a standing credential. It never expires, the flow never rotates it, and no
// human approves the sign-in. Two consequences that matter here:
//
//   1. This repository is PUBLIC (`gh repo view Adhambadrun/SpicyLinkGenerator` →
//      "isPrivate": false). DEFAULT_SPECIAL_ACCESS below is therefore readable by anyone on
//      the internet, and it stays in git history forever — deleting it later does not retract
//      it. To rotate a PIN without a code change, set SPECIAL_ACCESS_PINS in the deployment
//      environment (Vercel → Settings → Environment Variables); that value wins over the
//      defaults. Set SPECIAL_ACCESS=off to switch the feature off entirely, which sends these
//      four inboxes back through the normal OTP approval flow.
//   2. A 6-digit space is only 1,000,000 combinations, so secrecy is NOT the real defence —
//      the lockout below is. The lockout is per-instance and in-memory: on a serverless
//      deployment it limits one warm instance rather than the whole deployment, because there
//      is no shared store in this app. It is a speed bump, not a wall.
//
// The defaults follow the same convention the app already uses for DEFAULT_AUTH_SECRET: a
// value committed so the app runs with zero configuration, an environment override that wins,
// and a loud warning pointing at both.

const PIN_RE = /^\d{6}$/;

// Built-in special-access inboxes and their PINs, used when SPECIAL_ACCESS_PINS is unset.
// Lower-case the address, keep the PIN exactly 6 digits, and keep them distinct from each
// other — one shared PIN turns four identities into one.
export const DEFAULT_SPECIAL_ACCESS = {
  'frank@bcflights.com': '602096',
  'lamar@bcflights.com': '721478',
  'dex@bcflights.com': '407230',
  'lucy@bcflights.com': '509266',
};

// Kill switch. SPECIAL_ACCESS=off (or none/disabled/false/0) empties the whole list, so those
// inboxes fall back to the normal OTP flow instead of erroring out.
export function specialAccessEnabled(environment = process.env) {
  const raw = String((environment && environment.SPECIAL_ACCESS) || '')
    .trim()
    .toLowerCase();
  return !['none', 'off', 'disabled', 'false', '0'].includes(raw);
}

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizePin = (value) => String(value == null ? '' : value).trim();

/**
 * Parse an override list such as
 *   "frank@bcflights.com=123456, lucy@bcflights.com:654321"
 * Entries are separated by commas, semicolons or newlines and the address from its PIN by "="
 * or ":". Malformed entries and PINs that are not exactly 6 digits are dropped rather than
 * trusted, so a typo degrades to "no override" instead of to a working guess.
 */
export function parseSpecialAccessList(raw) {
  const map = {};
  String(raw == null ? '' : raw)
    .split(/[,;\n]+/)
    .forEach((chunk) => {
      const entry = chunk.trim();
      if (!entry) return;
      const separator = entry.search(/[=:]/);
      if (separator < 0) return;
      const email = normalizeEmail(entry.slice(0, separator));
      const pin = normalizePin(entry.slice(separator + 1));
      if (!email || !PIN_RE.test(pin)) return;
      map[email] = pin;
    });
  return map;
}

/**
 * The effective list: SPECIAL_ACCESS_PINS replaces the built-in defaults wholesale when it
 * yields at least one valid entry, otherwise the defaults are used. Returns {} when the
 * feature is switched off. Callers read this per request rather than once at import time, so
 * environment changes and tests do not need a module reload.
 */
export function specialAccessMap(environment = process.env) {
  if (!specialAccessEnabled(environment)) return {};
  const env = environment || {};

  const override = parseSpecialAccessList(env.SPECIAL_ACCESS_PINS);
  if (Object.keys(override).length) return override;

  const defaults = {};
  for (const [email, pin] of Object.entries(DEFAULT_SPECIAL_ACCESS)) {
    const address = normalizeEmail(email);
    const value = normalizePin(pin);
    if (address && PIN_RE.test(value)) defaults[address] = value;
  }
  return defaults;
}

/** The PIN for one inbox, or '' when that inbox has no special access. */
export function specialAccessPin(email, environment = process.env) {
  return specialAccessMap(environment)[normalizeEmail(email)] || '';
}

export function isSpecialAccess(email, environment = process.env) {
  return Boolean(specialAccessPin(email, environment));
}

/** Every inbox that currently has special access — used for startup logs and /api/health. */
export function specialAccessEmails(environment = process.env) {
  return Object.keys(specialAccessMap(environment));
}

/**
 * Cheap per-inbox throttle. A 6-digit PIN is guessable if the attempts are unlimited, and
 * requesting a fresh token would otherwise reset the per-token MAX_ATTEMPTS budget every time.
 * This keeps a running failure count per inbox across tokens, so the budget survives a new
 * request-code round trip.
 */
export const PIN_MAX_FAILURES = 10;
export const PIN_LOCKOUT_MS = 15 * 60 * 1000;

const pinFailures = new Map(); // email -> { count, windowStartedAt }

function prune(email, now) {
  const record = pinFailures.get(email);
  if (record && now - record.windowStartedAt >= PIN_LOCKOUT_MS) {
    pinFailures.delete(email);
    return undefined;
  }
  return record;
}

export function pinLockedOut(email, now = Date.now()) {
  const record = prune(normalizeEmail(email), now);
  return Boolean(record && record.count >= PIN_MAX_FAILURES);
}

/** Record one wrong PIN. Returns { locked, remaining } for the caller's error message. */
export function notePinFailure(email, now = Date.now()) {
  const address = normalizeEmail(email);
  const record = prune(address, now) || { count: 0, windowStartedAt: now };
  record.count += 1;
  pinFailures.set(address, record);
  const locked = record.count >= PIN_MAX_FAILURES;
  return { locked, remaining: Math.max(0, PIN_MAX_FAILURES - record.count) };
}

/** A correct PIN wipes the slate, so one typo a month never adds up to a lockout. */
export function clearPinFailures(email) {
  pinFailures.delete(normalizeEmail(email));
}

/** Test helper: forget every recorded failure. */
export function resetPinFailures() {
  pinFailures.clear();
}

/**
 * One line for the startup banner and /api/health. Deliberately counts accounts instead of
 * naming them: /api/health is public, and the addresses are not worth publishing twice.
 */
export function specialAccessSummary(environment = process.env) {
  const map = specialAccessMap(environment);
  const count = Object.keys(map).length;
  return { enabled: count > 0, accounts: count };
}
