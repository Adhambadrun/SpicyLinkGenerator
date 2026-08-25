// POST /api/verify
// Checks the 6-digit code against the signed token, then sets a signed session cookie.
import { handleVerify } from '../lib/core.js';

const SECRET = process.env.AUTH_SECRET;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { token, code, email } = req.body || {};
  const out = handleVerify({ token, code, email, secret: SECRET });
  if (out.cookie) res.setHeader('Set-Cookie', out.cookie + (process.env.VERCEL ? '; Secure' : ''));
  return res.status(out.status).json(out.json);
}
