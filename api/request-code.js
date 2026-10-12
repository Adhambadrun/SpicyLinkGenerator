// POST /api/request-code
// Validates the email domain (@bcflights.com / @travelbusinessclass.com), generates a 6-digit code,
// signs a token, and emails the code straight to the address that asked for it — the person
// signing in — via Resend. No approver relay: the requester's own inbox is the destination.
import { handleRequestCode, DEFAULT_AUTH_SECRET, warnIfDefaultSecret } from '../lib/core.js';
import { mailConfig, missingMailConfig, sendLoginCodeEmail } from '../lib/mailer.js';

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
  const localDevMode = process.env.DEV_MODE === '1';
  const previewDebugMode = process.env.VERCEL_ENV === 'preview' && !apiKey;
  const debugMode = localDevMode || previewDebugMode;
  // Local development and protected preview builds may run without a provider
  // and show the generated code. Production requests must have a real key;
  // never fall back to a key committed in source, since exposed Resend keys are
  // revoked and unsafe to reuse.
  if (!debugMode) {
    const configurationError = missingMailConfig({ apiKey, fromEmail });
    // setupError tells the login page this is the deployment's problem to fix,
    // not something the visitor typed.
    if (configurationError) return res.status(500).json({ error: configurationError, setupError: true });
  }

  const { email } = body;
  const out = await handleRequestCode({
    email,
    secret: SECRET,
    // Local DEV_MODE and preview fallback are deliberately offline for the API
    // handler. The local dev server has its own mailer and can opt into a real
    // send; the protected preview fallback should not accidentally email live
    // addresses when no Resend key is configured there.
    sendEmail: debugMode ? undefined : (payload) => sendLoginCodeEmail({ ...payload, apiKey, fromEmail }),
    devMode: debugMode,
    debugModeLabel: previewDebugMode ? 'PREVIEW MODE' : 'LOCAL MODE',
  });
  return res.status(out.status).json(out.json);
}
