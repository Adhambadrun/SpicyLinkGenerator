// POST /api/request-code
// Validates the @bcflights.com email, generates a 6-digit code, signs a token,
// and emails the code to the approver (adhambadraan@icloud.com) via the Resend SDK.
import { handleRequestCode } from '../lib/core.js';

const SECRET = process.env.AUTH_SECRET;
const RESEND_KEY = process.env.RESEND_API_KEY;   // ← replace re_xxxxxxxxx with your real key
const FROM_EMAIL = process.env.FROM_EMAIL || 'Spicy Link Generator <login@bcflights.com>';
const DEV_MODE = process.env.DEV_MODE === '1';

async function sendEmail({ to, requester, code }) {
  if (!RESEND_KEY) {
    return { ok: false, error: 'No RESEND_API_KEY set — add it in Vercel → Settings → Environment Variables.' };
  }
  try {
    // Lazy-import the SDK so the local dev server (which shows the code on screen
    // instead of emailing) still runs without installing dependencies.
    const { Resend } = await import('resend');
    const resend = new Resend(RESEND_KEY);

    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: to.split(',').map((s) => s.trim()).filter(Boolean),
      subject: `Spicy Link Generator — login code for ${requester}`,
      html: [
        '<div style="font-family:Arial,sans-serif;max-width:480px">',
        `  <p>A login was requested for <strong>${requester}</strong>.</p>`,
        `  <p style="font-size:28px;letter-spacing:6px;font-weight:bold;color:#e00012">${code}</p>`,
        `  <p>Send this 6-digit code to ${requester} so they can sign in.</p>`,
        '  <p style="color:#666;font-size:12px">The code expires in 10 minutes. If this wasn\'t you, ignore this email.</p>',
        '</div>',
      ].join('\n'),
      text: [
        `A login was requested for: ${requester}`,
        ``,
        `6-digit code: ${code}`,
        ``,
        `Send this code to ${requester} so they can sign in.`,
        `The code expires in 10 minutes.`,
      ].join('\n'),
    });

    if (result && result.error) {
      const msg = result.error.message || JSON.stringify(result.error);
      console.error('Resend error', result.error.statusCode, msg);
      return { ok: false, error: `Email send failed — ${msg}` };
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
  const { email } = req.body || {};
  const out = await handleRequestCode({ email, secret: SECRET, sendEmail, devMode: DEV_MODE });
  return res.status(out.status).json(out.json);
}
