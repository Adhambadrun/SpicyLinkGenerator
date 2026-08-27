// Local dev + preview server for Spicy Link Generator.
// Serves the static pages AND the four API endpoints.
//
//   npm run dev            # or: node dev-server.mjs
//   → http://localhost:8080
//
// The approval email is sent for real (Resend → adhambadraan@icloud.com) when the key is
// reachable, and the 6-digit code is ALSO printed here on screen + in the console, so the
// whole 2FA flow can be walked even on a machine with no outbound network.

import http from 'http';
import { readFile } from 'fs/promises';
import { join, extname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { handleRequestCode, handleVerify, handleSession, approverEmail, DEFAULT_AUTH_SECRET, warnIfDefaultSecret } from './lib/core.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Optional local .env (Node 20.6+ built-in loader; missing file is fine).
try {
  process.loadEnvFile(join(__dirname, '.env'));
} catch {}

const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || 8080;
const SECRET = process.env.AUTH_SECRET || DEFAULT_AUTH_SECRET;
const RESEND_KEY = process.env.RESEND_API_KEY || 're_eEa6fVKg_KEBocyJ2fNUQxaoCPXVg4J6H';
const FROM_EMAIL = process.env.FROM_EMAIL || 'Spicy Link Generator <onboarding@resend.dev>';

warnIfDefaultSecret(SECRET);

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

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Same payload as api/request-code.js — the dev server emails for real too, so you can
// see exactly who is trying to sign in. Failures are reported back, never thrown.
async function sendEmail({ to, requester, name, code }) {
  console.log(
    `\n[LOGIN REQUEST]\n  Name:          ${name}\n  Email:         ${requester}\n  6-digit code:  ${code}\n  Approver:      ${to}\n`
  );
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(RESEND_KEY);
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: to.split(',').map((s) => s.trim()).filter(Boolean),
      subject: `Login request — ${name} (${requester}) — code ${code}`,
      html: [
        '<div style="font-family:Arial,sans-serif;max-width:480px">',
        '  <p style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#e00012;font-weight:bold;margin:0 0 10px">Spicy Link Generator · sign-in request</p>',
        `  <p style="font-size:16px;margin:0 0 4px"><strong>${esc(name)}</strong> is trying to sign in.</p>`,
        `  <p style="color:#333;margin:0 0 14px;font-family:ui-monospace,Menlo,Consolas,monospace">${esc(requester)}</p>`,
        '  <p style="margin:0 0 6px;color:#333">Their 6-digit code:</p>',
        `  <p style="font-size:30px;letter-spacing:8px;font-weight:bold;color:#e00012;margin:0 0 16px">${esc(code)}</p>`,
        `  <p style="margin:0 0 14px">Send this code to <strong>${esc(name)}</strong> so they can sign in.</p>`,
        '  <p style="color:#666;font-size:12px;margin:0">The code expires in 10 minutes.</p>',
        '</div>',
      ].join('\n'),
      text: [`${name} is trying to sign in.`, `Email: ${requester}`, ``, `6-digit code: ${code}`].join('\n'),
    });
    if (result && result.error) {
      console.error('[dev] Resend error:', result.error.statusCode, result.error.message);
      return { ok: false, error: result.error.message };
    }
    console.log(`[dev] approval email sent to ${to}`);
    return { ok: true };
  } catch (e) {
    console.error('[dev] could not send the approval email:', e.message);
    return { ok: false, error: e.message };
  }
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
      return json(200, { ok: true, app: 'Spicy Link Generator', api: 'v1', approver: approverEmail() });
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
  console.log(`Approval emails go to ${approverEmail()} · sender: ${FROM_EMAIL}`);
});
