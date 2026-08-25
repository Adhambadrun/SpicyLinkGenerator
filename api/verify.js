// POST /api/verify
// Checks the 6-digit code against the signed token, then sets a signed session cookie.
import { handleVerify, DEFAULT_AUTH_SECRET, warnIfDefaultSecret } from '../lib/core.js';

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
  const { token, code, email } = body;
  const out = handleVerify({ token, code, email, secret: SECRET });
  if (out.cookie) res.setHeader('Set-Cookie', out.cookie + (process.env.VERCEL ? '; Secure' : ''));
  return res.status(out.status).json(out.json);
}
