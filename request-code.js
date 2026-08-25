// POST /api/request-code
// Validates the @bcflights.com email, generates a 6-digit code, signs a token,
// and emails the code to the approver (adhambadraan@icloud.com) via the Resend SDK.
import { handleRequestCode } from '../lib/core.js';

const SECRET = process.env.AUTH_SECRET;
const RESEND_KEY = process.env.RESEND_API_KEY;   // ← replace re_xxxxxxxxx with your real key
// Default to Resend's TESTING sender. It works with zero DNS setup (no verified domain
// needed), but testing mode only delivers to YOUR OWN Resend account email.
// Once you verify bcflights.com in Resend → Domains, set:
//   FROM_EMAIL = "Spicy Link Generator <login@bcflights.com>"
const FROM_EMAIL = process.env.FROM_EMAIL || 'Spicy Link Generator <onboarding@resend.dev>';
const DEV_MODE = process.env.DEV_MODE === '1';

async function sendEmail({ to, requester, name, code }) {
  if (!RESEND_KEY) {
    return { ok: false, error: 'No RESEND_API_KEY set — add it in Vercel → Settings → Environment Variables, then Redeploy.' };
  }
  try {
    // Lazy-import the SDK so the local dev server (which shows the code on screen
    // instead of emailing) still runs without installing dependencies.
    const { Resend } = await import('resend');
    const resend = new Resend(RESEND_KEY);

    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: to.split(',').map((s) => s.trim()).filter(Boolean),
      subject: `Spicy Link Generator — login request from ${name} (${requester})`,
      html: [
        '<div style="font-family:Arial,sans-serif;max-width:480px">',
        `  <p style="font-size:16px;margin:0 0 6px"><strong>${name}</strong> is trying to sign in.</p>`,
        `  <p style="color:#666;margin:0 0 14px">${requester}</p>`,
        `  <p style="margin:0 0 6px;color:#333">Their 6-digit code:</p>`,
        `  <p style="font-size:28px;letter-spacing:6px;font-weight:bold;color:#e00012;margin:0 0 14px">${code}</p>`,
        `  <p style="margin:0 0 14px">Give this code to <strong>${name}</strong> so they can sign in.</p>`,
        '  <p style="color:#666;font-size:12px">The code expires in 10 minutes. If this wasn\'t expected, ignore this email.</p>',
        '</div>',
      ].join('\n'),
      text: [
        `${name} (${requester}) is trying to sign in.`,
        ``,
        `6-digit code: ${code}`,
        ``,
        `Give this code to ${name} so they can sign in.`,
        `The code expires in 10 minutes.`,
      ].join('\n'),
    });

    if (result && result.error) {
      const msg = result.error.message || JSON.stringify(result.error);
      console.error('Resend error', result.error.statusCode, msg);

      // Translate the two common Resend setup errors into actions the owner can take right away.
      let hint = '';
      if (/verified domain|onboarding@resend\.dev/i.test(msg)) {
        hint = ' → In Resend, verify bcflights.com under “Domains” and set FROM_EMAIL to login@bcflights.com — or use FROM_EMAIL = “Spicy Link Generator <onboarding@resend.dev>” for a quick test.';
      } else if (/own email|testing email/i.test(msg)) {
        hint = ' → Testing mode only sends to your Resend account email — verify bcflights.com in Resend to send to other addresses.';
      } else if (/unauthorized|api key|invalid.*key|missing.*key/i.test(msg)) {
        hint = ' → Check RESEND_API_KEY in Vercel env vars (must start with “re_”, not the placeholder).';
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
  if (!SECRET || (!RESEND_KEY && !DEV_MODE)) {
    return res.status(500).json({ error: 'Server not configured (AUTH_SECRET + RESEND_API_KEY).' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { email, name } = req.body || {};
  const out = await handleRequestCode({ email, name, secret: SECRET, sendEmail, devMode: DEV_MODE });
  return res.status(out.status).json(out.json);
}
