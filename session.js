// GET /api/session
// Reports whether the visitor holds a valid signed session cookie.
import { handleSession } from '../lib/core.js';

const SECRET = process.env.AUTH_SECRET;

export default async function handler(req, res) {
  const out = handleSession({ cookieHeader: req.headers.cookie, secret: SECRET });
  return res.status(out.status).json(out.json);
}
