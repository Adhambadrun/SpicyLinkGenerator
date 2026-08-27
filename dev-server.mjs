// Local dev + preview server for Spicy Link Generator.
// Serves the static pages AND the four API endpoints.
//
//   npm run dev            # or: node dev-server.mjs
//   → http://localhost:8080
//
// The approval email is sent for real (Resend → adhambadraan@gmail.com) when the key is
// reachable, and the 6-digit code is ALSO printed here on screen + in the console, so the
// whole 2FA flow can be walked even on a machine with no outbound network.

import http from 'http';
import { readFile } from 'fs/promises';
import { join, extname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { handleRequestCode, handleVerify, handleSession, approverEmail, DEFAULT_AUTH_SECRET, warnIfDefaultSecret } from './lib/core.js';
import { mailConfig, sendApprovalEmail } from './lib/mailer.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Optional local .env (Node 20.6+ built-in loader; missing file is fine).
try {
  process.loadEnvFile(join(__dirname, '.env'));
} catch {}

const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || 8080;
const SECRET = process.env.AUTH_SECRET || DEFAULT_AUTH_SECRET;

warnIfDefaultSecret(SECRET);
const STARTUP_MAIL_CONFIG = mailConfig();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.css': 'text/css; charset=utf-8',
};

// The dev server prints every request so the local flow can be completed even
// without email. If a key is configured, it also sends the same approval email
// used by the deployed API.
async function sendEmail(payload) {
  const { to, requester, name, code } = payload;
  console.log(
    `\n[LOGIN REQUEST]\n  Name:          ${name}\n  Email:         ${requester}\n  6-digit code:  ${code}\n  Approver:      ${to}\n`
  );

  const config = mailConfig();
  const result = await sendApprovalEmail({ ...payload, ...config });
  if (result.ok) console.log(`[dev] approval email sent to ${to}`);
  else if (config.apiKey) console.error('[dev] approval email failed:', result.error);
  else console.log('[dev] no RESEND_API_KEY configured; the local code is shown in the response.');
  return result;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const json = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  const readBody = () =>
    new Promise((resolveBody) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => resolveBody(b));
    });
  const parseBody = (raw) => {
    try {
      return JSON.parse(raw || '{}');
    } catch {
      return {};
    }
  };

  try {
    if (path === '/api/request-code' && req.method === 'POST') {
      const { email } = parseBody(await readBody());
      const out = await handleRequestCode({ email, secret: SECRET, sendEmail, devMode: true });
      return json(out.status, out.json);
    }
    if (path === '/api/verify' && req.method === 'POST') {
      const body = parseBody(await readBody());
      const out = handleVerify({ token: body.token, code: body.code, email: body.email, secret: SECRET });
      if (out.cookie) res.setHeader('Set-Cookie', out.cookie);
      return json(out.status, out.json);
    }
    if (path === '/api/session') {
      const out = handleSession({ cookieHeader: req.headers.cookie, secret: SECRET });
      if (out.cookie) res.setHeader('Set-Cookie', out.cookie);
      return json(out.status, out.json);
    }
    if (path === '/api/health') {
      const config = mailConfig();
      return json(200, {
        ok: true,
        app: 'Spicy Link Generator',
        api: 'v1',
        approver: approverEmail(),
        mailConfigured: Boolean(config.apiKey),
        mailFrom: config.fromEmail,
      });
    }
  } catch (e) {
    return json(500, { error: e.message });
  }

  // static files (kept inside the project directory)
  const rel = path === '/' ? '/index.html' : path;
  const file = resolve(__dirname, '.' + decodeURIComponent(rel));
  if (!file.startsWith(resolve(__dirname))) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Spicy Link Generator (2FA) dev server → http://localhost:${PORT}`);
  console.log(`Approval emails go to ${approverEmail()} · sender: ${STARTUP_MAIL_CONFIG.fromEmail}`);
  console.log(`Email provider: ${STARTUP_MAIL_CONFIG.apiKey ? 'Resend configured' : 'not configured (local code will be shown)'}`);
});
