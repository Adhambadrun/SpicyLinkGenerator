# Spicy Link Generator

A single-page tool that turns a GDS (Sabre/Amadeus) itinerary into booking-ready links and
BookWithMatrix-valid JSON — fronted by a **real two-factor sign-in** gate.

Made by Lamar García · lamar@bcflights.com

---

## How the two-factor login works

1. User opens the site and enters their **@bcflights.com** work email.
2. The server checks the domain (any other domain is rejected) and generates a
   **6-digit code**.
3. The code is emailed to the **approver** (`adhambadraan@icloud.com` by default) —
   *not* to the user.
4. The approver relays the code to the user (Slack/Teams/text — your choice).
5. The user enters the code; the server verifies it and opens the app.

Security properties:
- Codes are HMAC-SHA256 signed and stateless — they cannot be forged or replayed,
  and they expire after **10 minutes** (max **5** wrong attempts).
- Sessions are signed httpOnly cookies that last 7 days.
- Domain lock is enforced server-side (not just in the browser).

> This is a *human-in-the-loop* approval flow by design: nobody can get in unless
> you personally hand them a fresh code.

---

## Project layout

```
spicy-link-generator/
├── index.html          ← login page (2FA gate)
├── app.html            ← the actual tool (redirects to login if no session)
├── logo.png            ← app logo
├── api/
│   ├── request-code.js ← POST  validate domain → generate code → email approver
│   ├── verify.js       ← POST  check code → set session cookie
│   └── session.js      ← GET   is the visitor signed in?
├── lib/
│   └── core.js         ← shared crypto (HMAC sign/verify, code gen, domain lock)
├── dev-server.mjs      ← zero-dependency local server (test mode, no email needed)
├── package.json
├── vercel.json
└── .env.example
```

---

## 1 · Run locally (no email needed)

```bash
npm run dev          # or: node dev-server.mjs
```

Open http://localhost:8080 — in this test mode the 6-digit code is printed on
screen (and in the console) instead of being emailed, so you can walk the whole
flow. Use any `name@bcflights.com` address.

## 2 · Deploy to Vercel (production, real email)

The login email is sent with the official **Resend Node.js SDK** (`api/request-code.js`):

```javascript
import { Resend } from 'resend';
const resend = new Resend(process.env.RESEND_API_KEY);   // ← never hard-coded
await resend.emails.send({ from: FROM_EMAIL, to: APPROVER_EMAIL, subject: '…', html: '…' });
```

**Prereq — set up Resend (5 minutes, free):**
1. Sign up at https://resend.com (free tier: 100 emails/day).
2. **API Keys** → create a key → it looks like `re_xxxxxxxx…`. **Replace
   `RESEND_API_KEY=re_xxxxxxxx` in your Vercel env vars with this real key.**
3. **Domains → Add domain** → add `bcflights.com` and follow the DNS records to verify it.
   - Until then, Resend only lets you send from `onboarding@resend.dev` to your
     own sign-up email — use that for a first test, then switch `FROM_EMAIL`
     to `login@bcflights.com` once the domain is verified.

**Deploy:**
1. Push this folder to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Spicy Link Generator — two-factor login"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/spicy-link-generator.git
   git push -u origin main
   ```
2. Go to https://vercel.com → **Add New → Project** → import the repo.
3. Framework preset: **Other** (leave build command and output directory empty).
4. **Settings → Environment Variables** — add:
   - `RESEND_API_KEY`  ← your real `re_…` key
   - `FROM_EMAIL`      (e.g. `Spicy Link Generator <onboarding@resend.dev>` for a first test, then `login@bcflights.com`)
   - `APPROVER_EMAIL`  (default `adhambadraan@icloud.com`)
   - `ALLOWED_DOMAIN`  (default `bcflights.com`)
   - `AUTH_SECRET`     (run `openssl rand -hex 32`)
5. Click **Deploy**. Every future `git push` redeploys automatically.

## 3 · Change the approver / domain

Edit the defaults in `.env.example` (or `lib/core.js`) — the approver email and
allowed domain are fully configurable per environment, no code changes needed.

## 4 · Security notes

- Keep `AUTH_SECRET` secret; never commit `.env`.
- The API endpoints send `Cache-Control: no-store` (see `vercel.json`).
- Consider rate-limiting the login endpoint behind a firewall rule if you expect
  many attempts.
