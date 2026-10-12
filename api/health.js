// GET /api/health
// Quick check that the server functions are deployed and reachable.
// Open https://YOUR-SITE.vercel.app/api/health in a browser — it must return {"ok":true}.
// If it returns a 404 page instead, the API is not running (wrong host / static-only deploy).
import { mailConfig, isTestSender, senderSetupHint } from '../lib/mailer.js';

export default function handler(req, res) {
  const { apiKey, fromEmail } = mailConfig();
  const testSender = isTestSender(fromEmail);
  res.status(200).json({
    ok: true,
    app: 'Spicy Link Generator',
    api: 'v1',
    mailConfigured: Boolean(apiKey),
    mailFrom: fromEmail,
    // Sign-in emails can only reach other people once the sender is on a domain
    // verified in Resend — the resend.dev sandbox address can only email the
    // Resend account owner.
    mailCanSendToUsers: Boolean(apiKey) && Boolean(fromEmail) && !testSender,
    ...(testSender ? { setupHint: senderSetupHint(fromEmail) } : {}),
  });
}
