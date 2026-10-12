// Resend-backed delivery for sign-in code emails.
//
// The 6-digit code is emailed to the address that requested it — the person signing in.
//
// Provider credentials are read only from the environment. Never commit API keys.
// Set RESEND_API_KEY in the deployment environment (for example, Vercel Settings → Environment Variables).
//
// SENDER:
// Unless FROM_EMAIL is set, every sign-in email is sent from Resend's shared sender
// onboarding@resend.dev. The sender is never derived from the sign-in domains
// (ALLOWED_DOMAINS) — those are only used to decide who may sign in. To send from your
// own address instead, verify the domain at https://resend.com/domains and set FROM_EMAIL.
//
// Note: Resend only lets onboarding@resend.dev deliver to the address the Resend account
// is registered to. When Resend rejects a send for that reason, the failure is reported as
// one short, actionable sentence instead of the provider's raw text.

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

// True when the mail is still being sent from Resend's sandbox address, which can only
// deliver to the Resend account owner. Any other recipient is rejected by Resend.
export function isTestSender(fromEmail) {
  return senderDomain(fromEmail) === TEST_SENDER_DOMAIN;
}

// One short sentence that tells whoever is looking at the screen what to change.
export function senderSetupHint(fromEmail = mailConfig().fromEmail) {
  if (!isTestSender(fromEmail)) return '';
  return (
    `The sign-in email is sent from Resend's shared address (onboarding@resend.dev), ` +
    `which Resend only delivers to your own Resend account address. To email other people, verify a ` +
    `domain at https://resend.com/domains, then set FROM_EMAIL to an address on it — for example ` +
    `"Spicy Link Generator <login@yourdomain.com>".`
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
export function describeSendFailure(message, fromEmail) {
  const text = String(message || '');
  if (/only send testing emails|own email address|testing email/i.test(text)) {
    return {
      setup: true,
      error: senderSetupHint(fromEmail) || 'Email delivery is not configured — set FROM_EMAIL to an address on a verified domain.',
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
  if (/rate.?limit|too many/i.test(text)) {
    return { setup: false, error: 'Too many sign-in emails were requested in a row — wait a minute and try again.' };
  }
  return { setup: false, error: `Email send failed — ${text}` };
}

/**
 * Send one sign-in code email. `to` is always the address that asked for the code,
 * so the person signing in receives it directly. The function returns a structured
 * result so the API never tells the user that a code was sent unless Resend actually
 * accepted it.
 */
export async function sendLoginCodeEmail({ to, requester, name, code, apiKey, fromEmail, resendClient } = {}) {
  const config = {
    ...mailConfig(),
    ...(apiKey !== undefined ? { apiKey: textValue(apiKey) } : {}),
    ...(fromEmail !== undefined ? { fromEmail: textValue(fromEmail) } : {}),
  };
  const configurationError = missingMailConfig(config);
  if (configurationError) return { ok: false, error: configurationError };

  const recipients = recipientsFrom(to);
  if (!recipients.length) {
    return { ok: false, error: 'Email delivery is not configured — no recipient address for the sign-in code.' };
  }

  const safeName = String(name || 'Unknown user');
  const safeRequester = String(requester || '');
  const safeCode = String(code || '');

  try {
    // Lazy import keeps the local development flow usable when no email provider
    // is configured; in that case the caller can still show the local code.
    let client = resendClient;
    if (!client) {
      const { Resend } = await import('resend');
      client = new Resend(config.apiKey);
    }
    const result = await client.emails.send({
      from: config.fromEmail,
      to: recipients,
      subject: `Your Spicy Link Generator sign-in code — ${safeCode}`,
      html: [
        '<div style="font-family:Arial,sans-serif;max-width:480px">',
        '  <p style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#e00012;font-weight:bold;margin:0 0 10px">Spicy Link Generator · sign-in code</p>',
        `  <p style="font-size:16px;margin:0 0 14px">Hi <strong>${esc(safeName)}</strong> — here is your code to finish signing in:</p>`,
        `  <p style="font-size:30px;letter-spacing:8px;font-weight:bold;color:#e00012;margin:0 0 16px">${esc(safeCode)}</p>`,
        '  <p style="margin:0 0 14px">Enter it on the sign-in page. The code expires in <strong>10 minutes</strong>.</p>',
        `  <p style="color:#666;font-size:12px;margin:0">Requested for ${esc(safeRequester)}. If you did not try to sign in, just ignore this email — nobody can get in without this code.</p>`,
        '</div>',
      ].join('\n'),
      text: [
        `Hi ${safeName},`,
        '',
        'Your Spicy Link Generator sign-in code is:',
        '',
        `6-digit code: ${safeCode}`,
        '',
        'Enter it on the sign-in page. The code expires in 10 minutes.',
        '',
        `Requested for ${safeRequester}.`,
        'If you did not try to sign in, just ignore this email — nobody can get in without this code.',
      ].join('\n'),
    });

    if (result && result.error) {
      const message = providerMessage(result.error);
      console.error('Resend error', result.error.statusCode, message);
      const failure = describeSendFailure(message, config.fromEmail);
      return { ok: false, error: failure.error, setup: failure.setup };
    }

    const id = result && result.data && result.data.id;
    if (!id) {
      return { ok: false, error: 'Email send failed — Resend did not return a message id.' };
    }
    return { ok: true, id };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error('sendLoginCodeEmail failed', message);
    const failure = describeSendFailure(message, config.fromEmail);
    return { ok: false, error: failure.error, setup: failure.setup };
  }
}
