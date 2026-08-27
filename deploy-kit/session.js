// GET /api/session
// Reports whether the visitor holds a valid signed session cookie.
import { handleSession, DEFAULT_AUTH_SECRET, warnIfDefaultSecret } from '../lib/core.js';

const SECRET = process.env.AUTH_SECRET || DEFAULT_AUTH_SECRET;
warnIfDefaultSecret(SECRET);

export default async function handler(req, res) {
  const out = handleSession({ cookieHeader: req.headers.cookie, secret: SECRET });
  if (out.cookie) res.setHeader('Set-Cookie', out.cookie + (process.env.VERCEL ? '; Secure' : ''));
  return res.status(out.status).json(out.json);
}
