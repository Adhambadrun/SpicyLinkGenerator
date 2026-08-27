// GET /api/health
// Quick check that the server functions are deployed and reachable.
// Open https://YOUR-SITE.vercel.app/api/health in a browser — it must return {"ok":true}.
// If it returns a 404 page instead, the API is not running (wrong host / static-only deploy).
import { mailConfig } from '../lib/mailer.js';

export default function handler(req, res) {
  const { apiKey, fromEmail } = mailConfig();
  res.status(200).json({
    ok: true,
    app: 'SPICY LAMAR',
    api: 'v1',
    mailConfigured: Boolean(apiKey),
    mailFrom: fromEmail,
  });
}
