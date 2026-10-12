// Resend-backed delivery for sign-in code emails.
//
// The 6-digit code is emailed to the APPROVER inbox (APPROVER_EMAIL, by default
// adhambadraan@gmail.com) together with who asked for it, and the approver passes the code
// on to that person. Nothing is ever emailed to the browser or to the person signing in.
//
// Provider credentials are read only from the environment. Never commit API keys.
// Set RESEND_API_KEY in the deployment environment (for example, Vercel Settings → Environment Variables).
//
// SENDER:
// Unless FROM_EMAIL is set, every sign-in email is sent from Resend's shared sender
// onboarding@resend.dev. That combination — shared sender + approver inbox — is the setup
// that works with no DNS work at all: Resend only lets onboarding@resend.dev deliver to the
// address its account is registered to, which is normally the approver's own inbox. To send
// from your own address instead, verify the domain at https://resend.com/domains and set
// FROM_EMAIL. The sender is never derived from the sign-in domains (ALLOWED_DOMAINS) — those
// are only used to decide who may ask for a code.
//
// Note: when Resend rejects a send (sandbox sender pointed at a different inbox, unverified
// domain, revoked key) the failure is reported as one short, actionable sentence instead of
// the provider's raw text.

import { DEFAULT_APPROVER_EMAIL, approverEmail } from './core.js';

export const DEFAULT_FROM_EMAIL = 'Spicy Link Generator <onboarding@resend.dev>';
export const TEST_SENDER_DOMAIN = 'resend.dev';

const DEFAULT_CONFIG = {
  apiKey: '',
  fromEmail: DEFAULT_FROM_EMAIL,
};

// "Spicy Link Generator <login@bcflights.com>" → "login@bcflights.com"
function addressOf(value) {
  const text = textValue(value);
  const angled = text.match(/<([^<>]+)>/);
  return (angled ? angled[1] : text).trim().toLowerCase();
}

export function senderDomain(fromEmail) {
  const address = addressOf(fromEmail);
  const at = address.lastIndexOf('@');
  return at < 0 ? '' : address.slice(at + 1);
}

// True when the mail is still being sent from Resend's sandbox address, which only delivers
// to the address the Resend account is registered to — normally the approver inbox.
export function isTestSender(fromEmail) {
  return senderDomain(fromEmail) === TEST_SENDER_DOMAIN;
}

// One short sentence that tells whoever is looking at the screen what to change.
export function senderSetupHint(fromEmail = mailConfig().fromEmail, approver = approverEmail()) {
  if (!isTestSender(fromEmail)) return '';
  const inbox = approver || DEFAULT_APPROVER_EMAIL;
  // Kept under ~400 characters on purpose: this sentence is shown in the login page's
  // "setup needed" box, so it has to be readable at a glance.
  return (
    `Sign-in emails are sent from Resend's shared address (onboarding@resend.dev), which Resend only delivers ` +
    `to the address its account is registered to. Codes go to ${inbox} — if that is not your Resend account's ` +
    `address, set APPROVER_EMAIL to it, or verify a domain at https://resend.com/domains and set FROM_EMAIL.`
  );
}

const esc = (value) =>
  String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Read mail settings when a request is handled, rather than at module import
 * time. This keeps local .env loading and serverless environment variables
 * predictable. No credential fallback is stored in source. Setting the variable
 * to "none" or "disabled" explicitly disables the provider.
 */
export function mailConfig(environment = process.env) {
  const rawKey = environment ? environment.RESEND_API_KEY : undefined;
  const envKey = textValue(rawKey);
  let apiKey = envKey || DEFAULT_CONFIG.apiKey;
  if (envKey === 'none' || envKey === 'disabled') {
    apiKey = '';
  }

  const rawFrom = environment ? environment.FROM_EMAIL : undefined;
  const envFrom = textValue(rawFrom);
  // Explicit FROM_EMAIL wins. Otherwise send from onboarding@resend.dev (see SENDER at
  // the top of this file). The sign-in domains are never used as the sender.
  let fromEmail = envFrom || DEFAULT_CONFIG.fromEmail;
  if (envFrom === 'none' || envFrom === 'disabled') {
    fromEmail = '';
  }

  return {
    apiKey,
    fromEmail,
  };
}

export function missingMailConfig(config = mailConfig()) {
  if (!config.apiKey) {
    return 'Email delivery is not configured — set RESEND_API_KEY in the deployment environment, then redeploy.';
  }
  if (!textValue(config.fromEmail)) {
    return 'Email delivery is not configured — set FROM_EMAIL to a verified sender, then redeploy.';
  }
  return '';
}

function recipientsFrom(value) {
  const values = Array.isArray(value) ? value : String(value == null ? '' : value).split(',');
  return values.map(textValue).filter(Boolean);
}

function providerMessage(error) {
  if (!error) return 'The email provider returned an unknown error.';
  if (typeof error === 'string') return error;
  return error.message || JSON.stringify(error);
}

/**
 * Turn Resend's (very long) provider errors into the one sentence the person reading
 * the login screen needs. Resend returns a paragraph for its most common setup
 * mistake — the sandbox sender — and dumping it on the login page tells the user
 * nothing about what to fix. Returns { error, setup }; `setup` marks failures the
 * deployment owner must fix (as opposed to a bad code or a temporary outage).
 */
export function describeSendFailure(message, fromEmail, approver = approverEmail()) {
  const text = String(message || '');
  if (/only send testing emails|own email address|testing email/i.test(text)) {
    return {
      setup: true,
      error:
        senderSetupHint(fromEmail, approver) ||
        'Email delivery is not configured — set FROM_EMAIL to an address on a verified domain.',
    };
  }
  if (/verified domain|domain.*verify|not verified|invalid from|invalid.*sender/i.test(text)) {
    return {
      setup: true,
      error:
        `The sign-in email could not be sent: ${senderDomain(fromEmail) || 'the sender domain'} is not a verified ` +
        `sender domain in Resend. Verify it at https://resend.com/domains and set FROM_EMAIL to an address on it.`,
    };
  }
  if (/unauthorized|api key|invalid.*key|missing.*key|restricted_api_key/i.test(text)) {
    return {
      setup: true,
      error: 'The sign-in email could not be sent: Resend rejected RESEND_API_KEY. Replace it with a current key and redeploy.',
    };
  }
  if (/invalid.*(to|recipient)|no recipients/i.test(text)) {
    return {
      setup: true,
      error: `The sign-in email could not be sent: Resend rejected the approver address (${approver || 'APPROVER_EMAIL'}). Set APPROVER_EMAIL to a valid inbox and redeploy.`,
    };
  }
  if (/rate.?limit|too many/i.test(text)) {
    return { setup: false, error: 'Too many sign-in emails were requested in a row — wait a minute and try again.' };
  }
  return { setup: false, error: `Email send failed — ${text}` };
}

/**
 * Hand one prepared message to Resend and translate the outcome. Kept in one place so the
 * sign-in code email and the delivery test from /api/health report failures identically.
 */
async function deliver(config, message, resendClient, approver) {
  try {
    // Lazy import keeps the local development flow usable when no email provider
    // is configured; in that case the caller can still show the local code.
    let client = resendClient;
    if (!client) {
      const { Resend } = await import('resend');
      client = new Resend(config.apiKey);
    }

    const result = await client.emails.send(message);

    if (result && result.error) {
      const text = providerMessage(result.error);
      console.error('Resend error', result.error.statusCode, text);
      const failure = describeSendFailure(text, config.fromEmail, approver);
      return { ok: false, error: failure.error, setup: failure.setup };
    }

    const id = result && result.data && result.data.id;
    if (!id) {
      return { ok: false, error: 'Email send failed — Resend did not return a message id.' };
    }
    return { ok: true, id };
  } catch (error) {
    const text = error && error.message ? error.message : String(error);
    console.error('Resend send failed', text);
    const failure = describeSendFailure(text, config.fromEmail, approver);
    return { ok: false, error: failure.error, setup: failure.setup };
  }
}

function resolveConfig({ apiKey, fromEmail } = {}) {
  return {
    ...mailConfig(),
    ...(apiKey !== undefined ? { apiKey: textValue(apiKey) } : {}),
    ...(fromEmail !== undefined ? { fromEmail: textValue(fromEmail) } : {}),
  };
}

/**
 * Send one sign-in code email to the approver. `to` is the approver inbox (a string or a
 * list) and `requester` is the person who asked for the code, so the approver can see who
 * they are approving. The function returns a structured result so the API never tells the
 * user that a code was sent unless Resend actually accepted it.
 */
export async function sendLoginCodeEmail({ to, requester, name, code, apiKey, fromEmail, resendClient } = {}) {
  const config = resolveConfig({ apiKey, fromEmail });
  const configurationError = missingMailConfig(config);
  if (configurationError) return { ok: false, error: configurationError };

  const recipients = recipientsFrom(to);
  if (!recipients.length) {
    return {
      ok: false,
      setup: true,
      error: 'Email delivery is not configured — set APPROVER_EMAIL to the inbox that should receive sign-in codes.',
    };
  }

  const safeName = String(name || 'Unknown user');
  const safeRequester = String(requester || '');
  const safeCode = String(code || '');

  return deliver(
    config,
    {
      from: config.fromEmail,
      to: recipients,
      subject: `Login request — ${safeName} (${safeRequester}) — code ${safeCode}`,
      html: [
        '<div style="font-family:Arial,sans-serif;max-width:480px">',
        '  <p style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#e00012;font-weight:bold;margin:0 0 10px">Spicy Link Generator · sign-in request</p>',
        `  <p style="font-size:16px;margin:0 0 4px"><strong>${esc(safeName)}</strong> is trying to sign in.</p>`,
        `  <p style="color:#333;margin:0 0 14px;font-family:ui-monospace,Menlo,Consolas,monospace">${esc(safeRequester)}</p>`,
        '  <p style="margin:0 0 6px;color:#333">Their 6-digit code:</p>',
        `  <p style="font-size:30px;letter-spacing:8px;font-weight:bold;color:#e00012;margin:0 0 16px">${esc(safeCode)}</p>`,
        `  <p style="margin:0 0 14px">Send this code to <strong>${esc(safeName)}</strong> so they can finish signing in.</p>`,
        '  <p style="color:#666;font-size:12px;margin:0">The code expires in 10 minutes. If you were not expecting this, just ignore this email — nobody can get in without this code.</p>',
        '</div>',
      ].join('\n'),
      text: [
        `${safeName} (${safeRequester}) is trying to sign in to Spicy Link Generator.`,
        '',
        `6-digit code: ${safeCode}`,
        '',
        `Send this code to ${safeName} so they can finish signing in.`,
        '',
        'The code expires in 10 minutes.',
        'If you were not expecting this, just ignore this email — nobody can get in without this code.',
      ].join('\n'),
    },
    resendClient,
    recipients.join(', ')
  );
}

/**
 * One-line delivery test used by GET /api/health?send=1: it proves whether the sender and
 * the approver inbox can actually talk to each other. No code is included, so the mail is
 * harmless if it arrives unexpectedly.
 */
export async function sendDeliveryTestEmail({ to, apiKey, fromEmail, resendClient } = {}) {
  const config = resolveConfig({ apiKey, fromEmail });
  const configurationError = missingMailConfig(config);
  if (configurationError) return { ok: false, error: configurationError, setup: true };

  const recipients = recipientsFrom(to);
  if (!recipients.length) {
    return {
      ok: false,
      setup: true,
      error: 'Email delivery is not configured — set APPROVER_EMAIL to the inbox that should receive sign-in codes.',
    };
  }

  return deliver(
    config,
    {
      from: config.fromEmail,
      to: recipients,
      subject: 'Spicy Link Generator — delivery test (no code)',
      html: [
        '<div style="font-family:Arial,sans-serif;max-width:480px">',
        '  <p style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#e00012;font-weight:bold;margin:0 0 10px">Spicy Link Generator · delivery test</p>',
        `  <p style="margin:0 0 14px">This is a test from your own deployment. It means sign-in codes <strong>can</strong> reach <strong>${esc(recipients.join(', '))}</strong>.</p>`,
        `  <p style="color:#666;font-size:12px;margin:0">Sent from ${esc(config.fromEmail)}. There is no code in this email and nothing to do.</p>`,
        '</div>',
      ].join('\n'),
      text: [
        'Spicy Link Generator — delivery test.',
        '',
        `Sign-in codes can reach ${recipients.join(', ')}.`,
        `Sent from ${config.fromEmail}.`,
        '',
        'There is no code in this email and nothing to do.',
      ].join('\n'),
    },
    resendClient,
    recipients.join(', ')
  );
}
