// Resend-backed delivery for sign-in approval emails.
//
// Keep provider credentials in the deployment environment. A key must never be
// committed to this repository: Resend revokes keys that are exposed publicly,
// which would make the login flow stop sending codes.

export const DEFAULT_FROM_EMAIL = 'Spicy Link Generator <login@bcflights.com>';

const DEFAULT_CONFIG = {
  fromEmail: DEFAULT_FROM_EMAIL,
};

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
 * predictable and makes an empty environment variable behave as "not set".
 */
export function mailConfig(environment = process.env) {
  return {
    apiKey: textValue(environment.RESEND_API_KEY),
    fromEmail: textValue(environment.FROM_EMAIL) || DEFAULT_CONFIG.fromEmail,
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

function providerHint(message) {
  if (/only send testing emails|own email|testing email|resend\.dev/i.test(message)) {
    return ' Set FROM_EMAIL to an address on a verified domain; the resend.dev test sender can only deliver to the Resend account owner.';
  }
  if (/verified domain|domain.*verify|invalid from/i.test(message)) {
    return ' Verify the sender domain in Resend and set FROM_EMAIL to an address on that domain.';
  }
  if (/unauthorized|api key|invalid.*key|missing.*key|restricted_api_key/i.test(message)) {
    return ' Check RESEND_API_KEY and replace it with a current Resend key.';
  }
  if (/rate.?limit|too many/i.test(message)) {
    return ' Resend rate limit hit — wait a minute and try again.';
  }
  return '';
}

/**
 * Send one approval email. The function returns a structured result so the API
 * never tells the user that a code was sent unless Resend actually accepted it.
 */
export async function sendApprovalEmail({ to, requester, name, code, apiKey, fromEmail, resendClient } = {}) {
  const config = {
    ...mailConfig(),
    ...(apiKey !== undefined ? { apiKey: textValue(apiKey) } : {}),
    ...(fromEmail !== undefined ? { fromEmail: textValue(fromEmail) } : {}),
  };
  const configurationError = missingMailConfig(config);
  if (configurationError) return { ok: false, error: configurationError };

  const recipients = recipientsFrom(to);
  if (!recipients.length) {
    return { ok: false, error: 'Email delivery is not configured — APPROVER_EMAIL is empty.' };
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
      subject: `Login request — ${safeName} (${safeRequester}) — code ${safeCode}`,
      html: [
        '<div style="font-family:Arial,sans-serif;max-width:480px">',
        '  <p style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#e00012;font-weight:bold;margin:0 0 10px">Spicy Link Generator · sign-in request</p>',
        `  <p style="font-size:16px;margin:0 0 4px"><strong>${esc(safeName)}</strong> is trying to sign in.</p>`,
        `  <p style="color:#333;margin:0 0 14px;font-family:ui-monospace,Menlo,Consolas,monospace">${esc(safeRequester)}</p>`,
        '  <p style="margin:0 0 6px;color:#333">Their 6-digit code:</p>',
        `  <p style="font-size:30px;letter-spacing:8px;font-weight:bold;color:#e00012;margin:0 0 16px">${esc(safeCode)}</p>`,
        `  <p style="margin:0 0 14px">Send this code to <strong>${esc(safeName)}</strong> so they can sign in.</p>`,
        '  <p style="color:#666;font-size:12px;margin:0">The code expires in 10 minutes. If you were not expecting this, just ignore the email — they cannot get in without it.</p>',
        '</div>',
      ].join('\n'),
      text: [
        `${safeName} is trying to sign in to Spicy Link Generator.`,
        `Email: ${safeRequester}`,
        '',
        `6-digit code: ${safeCode}`,
        '',
        `Send this code to ${safeName} so they can sign in.`,
        'The code expires in 10 minutes.',
      ].join('\n'),
    });

    if (result && result.error) {
      const message = providerMessage(result.error);
      console.error('Resend error', result.error.statusCode, message);
      return { ok: false, error: `Email send failed — ${message}${providerHint(message)}` };
    }

    const id = result && result.data && result.data.id;
    if (!id) {
      return { ok: false, error: 'Email send failed — Resend did not return a message id.' };
    }
    return { ok: true, id };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error('sendApprovalEmail failed', message);
    return { ok: false, error: `Email send failed — ${message}${providerHint(message)}` };
  }
}
