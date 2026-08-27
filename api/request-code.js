// POST /api/request-code
// Validates the @bcflights.com email, generates a 6-digit code, signs a token,
// and emails the code — plus who is asking for it — to the approver
// (adhambadraan@icloud.com) via Resend.
import { handleRequestCode, DEFAULT_AUTH_SECRET, warnIfDefaultSecret } from '../lib/core.js';
import { mailConfig, missingMailConfig, sendApprovalEmail } from '../lib/mailer.js';

const SECRET = process.env.AUTH_SECRET || DEFAULT_AUTH_SECRET;
warnIfDefaultSecret(SECRET);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  } catch {
    return res.status(400).json({ error: 'Invalid request body.' });
  }

  const { apiKey, fromEmail } = mailConfig();
  const devMode = process.env.DEV_MODE === '1';
  // Local DEV_MODE may run without a provider and shows the generated code. A
  // production request must have a real key; never fall back to a key committed
  // in source, since exposed Resend keys are revoked and unsafe to reuse.
  if (!devMode) {
    const configurationError = missingMailConfig({ apiKey, fromEmail });
    if (configurationError) return res.status(500).json({ error: configurationError });
  }

  const { email } = body;
  const out = await handleRequestCode({
    email,
    secret: SECRET,
    // DEV_MODE is deliberately offline for the API handler. The local dev server
    // has its own mailer and can opt into a real send; a debug flag on a deployed
    // function must not accidentally email live addresses.
    sendEmail: devMode ? undefined : (payload) => sendApprovalEmail({ ...payload, apiKey, fromEmail }),
    devMode,
  });
  return res.status(out.status).json(out.json);
}
