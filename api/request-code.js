// POST /api/request-code
// Validates the @bcflights.com email, generates a 6-digit code, signs a token,
// and emails the code — plus who is asking for it — to the approver
// (adhambadraan@icloud.com) via the Resend SDK.
import { handleRequestCode, DEFAULT_AUTH_SECRET, warnIfDefaultSecret } from '../lib/core.js';

const SECRET = process.env.AUTH_SECRET || DEFAULT_AUTH_SECRET;
warnIfDefaultSecret(SECRET);

// New Resend key, used as the default so the app works with zero setup.
// Override it per environment with RESEND_API_KEY (recommended for production).
const RESEND_KEY = process.env.RESEND_API_KEY || 're_eEa6fVKg_KEBocyJ2fNUQxaoCPXVg4J6H';

// Default to Resend's TESTING sender. It works with zero DNS setup (no verified domain
// needed), but testing mode only delivers to YOUR OWN Resend account email — which is
// exactly the approver inbox (adhambadraan@icloud.com) here.
// Once you verify bcflights.com in Resend → Domains, set:
//   FROM_EMAIL = "Spicy Link Generator <login@bcflights.com>"
const FROM_EMAIL = process.env.FROM_EMAIL || 'Spicy Link Generator <onboarding@resend.dev>';
const DEV_MODE = process.env.DEV_MODE === '1';

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendEmail({ to, requester, name, code }) {
  if (!RESEND_KEY) {
    return { ok: false, error: 'No RESEND_API_KEY set — add it in Vercel → Settings → Environment Variables, then Redeploy.' };
  }
  try {
    // Lazy-import the SDK so the local dev server (which can fall back to showing the
    // code on screen) still runs without installing dependencies.
    const { Resend } = await import('resend');
    const resend = new Resend(RESEND_KEY);

    const subject = `Login request — ${name} (${requester}) — code ${code}`;

    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: to.split(',').map((s) => s.trim()).filter(Boolean),
      subject,
      html: [
        '<div style="font-family:Arial,sans-serif;max-width:480px">',
        '  <p style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#e00012;font-weight:bold;margin:0 0 10px">Spicy Link Generator · sign-in request</p>',
        `  <p style="font-size:16px;margin:0 0 4px"><strong>${esc(name)}</strong> is trying to sign in.</p>`,
        `  <p style="color:#333;margin:0 0 14px;font-family:ui-monospace,Menlo,Consolas,monospace">${esc(requester)}</p>`,
        '  <p style="margin:0 0 6px;color:#333">Their 6-digit code:</p>',
        `  <p style="font-size:30px;letter-spacing:8px;font-weight:bold;color:#e00012;margin:0 0 16px">${esc(code)}</p>`,
        `  <p style="margin:0 0 14px">Send this code to <strong>${esc(name)}</strong> so they can sign in.</p>`,
        '  <p style="color:#666;font-size:12px;margin:0">The code expires in 10 minutes. If you were not expecting this, just ignore the email — they cannot get in without it.</p>',
        '</div>',
      ].join('\n'),
      text: [
        `${name} is trying to sign in to Spicy Link Generator.`,
        `Email: ${requester}`,
        ``,
        `6-digit code: ${code}`,
        ``,
        `Send this code to ${name} so they can sign in.`,
        `The code expires in 10 minutes.`,
      ].join('\n'),
    });

    if (result && result.error) {
      const msg = result.error.message || JSON.stringify(result.error);
      console.error('Resend error', result.error.statusCode, msg);

      // Translate the common Resend setup errors into actions the owner can take right away.
      let hint = '';
      if (/verified domain|onboarding@resend\.dev/i.test(msg)) {
        hint = ' → In Resend, verify bcflights.com under “Domains” and set FROM_EMAIL to login@bcflights.com — or use FROM_EMAIL = “Spicy Link Generator <onboarding@resend.dev>” for a quick test.';
      } else if (/own email|testing email|only send to/i.test(msg)) {
        hint = ' → Testing mode only sends to your Resend account email — verify bcflights.com in Resend to send to other addresses.';
      } else if (/unauthorized|api key|invalid.*key|missing.*key/i.test(msg)) {
        hint = ' → Check RESEND_API_KEY (must be a current key starting with “re_”).';
      } else if (/rate.?limit|too many/i.test(msg)) {
        hint = ' → Resend rate limit hit — wait a minute and try again.';
      }
      return { ok: false, error: `Email send failed — ${msg}${hint}` };
    }
    return { ok: true };
  } catch (e) {
    console.error('sendEmail failed', e.message);
    return { ok: false, error: `Email send failed — ${e.message}` };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!RESEND_KEY && !DEV_MODE) {
    return res.status(500).json({ error: 'Server not configured — RESEND_API_KEY is missing.' });
  }
  let body = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  } catch {
    return res.status(400).json({ error: 'Invalid request body.' });
  }
  const { email } = body;
  const out = await handleRequestCode({ email, secret: SECRET, sendEmail, devMode: DEV_MODE });
  return res.status(out.status).json(out.json);
}
