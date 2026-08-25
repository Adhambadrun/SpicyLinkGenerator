// Local dev + preview server for Spicy Link Generator.
// Serves the static pages AND the three API endpoints (test mode prints the code).
//
//   node dev-server.mjs
//   → http://localhost:8080
//
// In this mode the 6-digit code is shown on screen + in the console instead of
// being emailed, so the full 2FA flow can be exercised end-to-end without Resend.

import http from 'http';
import { readFile } from 'fs/promises';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { handleRequestCode, handleVerify, handleSession } from './lib/core.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 8080;
const SECRET = process.env.AUTH_SECRET || 'dev-secret-change-me';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.css': 'text/css; charset=utf-8',
};

async function sendEmail({ to, requester, code }) {
  console.log(`\n[APPROVAL EMAIL — would send to ${to}]\n  Login request from: ${requester}\n  6-digit code:       ${code}\n  (relay this code to ${requester})\n`);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const json = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };
  const readBody = () =>
    new Promise((resolve) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => resolve(b));
    });

  try {
    if (path === '/api/request-code' && req.method === 'POST') {
      const { email } = JSON.parse((await readBody()) || '{}');
      const out = await handleRequestCode({ email, secret: SECRET, sendEmail, devMode: true });
      return json(out.status, out.json);
    }
    if (path === '/api/verify' && req.method === 'POST') {
      const body = JSON.parse((await readBody()) || '{}');
      const out = handleVerify({ token: body.token, code: body.code, email: body.email, secret: SECRET });
      if (out.cookie) res.setHeader('Set-Cookie', out.cookie);
      return json(out.status, out.json);
    }
    if (path === '/api/session') {
      const out = handleSession({ cookieHeader: req.headers.cookie, secret: SECRET });
      return json(out.status, out.json);
    }
  } catch (e) {
    return json(500, { error: e.message });
  }

  // static files
  const file = path === '/' ? '/index.html' : path;
  try {
    const data = await readFile(join(__dirname, decodeURIComponent(file)));
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Spicy Link Generator (2FA) dev server → http://localhost:${PORT}`));
