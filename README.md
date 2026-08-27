# Spicy Link Generator

A single-page tool that turns a GDS (Sabre/Amadeus) itinerary into booking-ready links and
BookWithMatrix-valid JSON — fronted by a **real two-factor sign-in** gate.

Made by Lamar García · lamar@bcflights.com

---

## How the two-factor login works

1. User opens the site and enters their **@bcflights.com** work email — **that's the only
   field** (no name is asked for).
2. The server checks the domain (any other domain is rejected) and generates a
   **6-digit code**.
3. The code is emailed to the **approver** (`adhambadraan@icloud.com` by default) —
   *not* to the user. The email shows **who is asking**: the name (built from the email
   address, e.g. `lamar.garcia@…` → *Lamar Garcia*), the full email, and the code.
4. The approver relays the code to the user (Slack/Teams/text — your choice).
5. The user enters the code; the server verifies it and opens the app.

Security properties:
- Codes are HMAC-SHA256 signed and stateless — they cannot be forged or replayed,
  and they expire after **10 minutes** (max **5** wrong attempts).
- Sessions are signed httpOnly cookies; the hard cap is 7 days but the **idle rule**
  kills them after **5 unused minutes** (see below).
- Domain lock is enforced server-side (not just in the browser).
- The code is **never** returned to the browser in production — only the approver sees it.

### Dead end for outsiders

A **non-@bcflights.com email** *or* a **wrong/expired code** replaces the whole login page
with a full-screen `dead end.png` (the gorilla). The form is destroyed, there is no button,
link or "back", and the tab is flagged in `sessionStorage` so reloading in the same tab shows
the dead end again. Only a brand-new tab gets a fresh login form.

### Sessions: per-tab, and 5-minute idle

- Signing in marks **that tab** (`sessionStorage`), so **closing the tab — or opening a new
  one — always requires logging in again**, even if the cookie is still valid.
- While the app is open, user activity (mouse/keys/scroll/touch) refreshes a timestamp and a
  heartbeat re-signs the cookie. If the tab sits **unused for 5 minutes**, the page logs
  itself out, and the server also refuses the stale cookie (`reason: "idle"`).

> This is a *human-in-the-loop* approval flow by design: nobody can get in unless
> you personally hand them a fresh code.

---

## Project layout

```
spicy-link-generator/
├── index.html          ← login page (2FA gate: email → code)
├── app.html            ← the actual tool (redirects to login if no session)
├── logo.png            ← app logo
├── api/
│   ├── request-code.js ← POST  validate domain → generate code → email approver (Resend)
│   ├── verify.js       ← POST  check code → set session cookie
│   ├── session.js      ← GET   is the visitor signed in?
│   └── health.js       ← GET   deployment smoke test
├── lib/
│   └── core.js         ← shared crypto (HMAC sign/verify, code gen, domain lock)
├── dev-server.mjs      ← local server: serves the pages + the same API endpoints
├── test/               ← node --test suite (npm test)
├── package.json
├── vercel.json
└── .env.example
```

> The `api/` and `lib/` folder names are not cosmetic: Vercel only exposes server functions
> that live in `api/`, and both `dev-server.mjs` and the functions import `lib/core.js`.

---

## 1 · Run locally

```bash
npm install          # once — installs the Resend SDK
npm run dev          # or: node dev-server.mjs
```

Open http://localhost:8080 and use any `name@bcflights.com` address. The dev server tries to
send the real approval email **and** always prints the request (name, email, code) in its
console, so the flow can be finished even on a machine with no outbound network.

```bash
npm test             # 11 tests over the auth core + the api/ handlers
```

## 2 · Deploy to Vercel (production, real email)

The login email is sent with the official **Resend Node.js SDK** (`api/request-code.js`):

```javascript
import { Resend } from 'resend';
const resend = new Resend(process.env.RESEND_API_KEY || '<built-in default key>');
await resend.emails.send({ from: FROM_EMAIL, to: APPROVER_EMAIL, subject: '…', html: '…' });
```

**Out of the box there is nothing to configure** — the Resend key, the approver address
(`adhambadraan@icloud.com`) and the allowed domain (`bcflights.com`) are all built in as
defaults. Deploy and it works.

**Resend setup (only if you want to send from your own address):**
1. Sign in at https://resend.com.
2. **Domains → Add domain** → add `bcflights.com` and follow the DNS records to verify it.
   - Until then, Resend only lets you send from `onboarding@resend.dev`, and only to your
     own sign-up email — which *is* the approver inbox here, so it works as-is.
   - After verification, set `FROM_EMAIL` to `Spicy Link Generator <login@bcflights.com>`.

**Deploy:**
1. Push this folder to GitHub.
2. Go to https://vercel.com → **Add New → Project** → import the repo.
3. Framework preset: **Other** (leave build command and output directory empty).
4. **Settings → Environment Variables** (all optional — see `.env.example`):
   - `AUTH_SECRET`     ← **recommended** (`openssl rand -hex 32`)
   - `RESEND_API_KEY`  ← only to override the built-in key
   - `FROM_EMAIL`      ← only once bcflights.com is verified in Resend
   - `APPROVER_EMAIL`  (default `adhambadraan@icloud.com`)
   - `ALLOWED_DOMAIN`  (default `bcflights.com`)
5. Click **Deploy**. Every future `git push` redeploys automatically.

**Verify the API is live (do this first, before anything else):**
Open this in your browser, using YOUR site's address:
```
https://YOUR-SITE.vercel.app/api/health
```
- Returns `{"ok":true,"app":"Spicy Link Generator",...}` → the server is deployed ✓
- Returns a 404 / "not found" page → the API is NOT running. You are either on a
  static-only host (Netlify Drop / GitHub Pages — those can't run the functions),
  opened the file by double-clicking it, or deployed without the `api/` folder.
  Deploy the whole folder to **Vercel** and open the `vercel.app` URL.

> ⚠️ The login page can only send codes through the Vercel server functions.
> If you see "Network error — try again" on the login page, it means the browser
> can't reach `/api/*` — almost always because the page is open as a local file,
> on a static host, or in a sandboxed preview. Test on the Vercel URL instead.

## 3 · Change the approver / domain

Edit `.env.example` (or the defaults in `lib/core.js`) — the approver email and allowed
domain are fully configurable per environment, no code changes needed.

## 4 · Security notes

- ⚠️ **This repo is public.** The Resend API key and the fallback `AUTH_SECRET` live in the
  source, so treat both as known: set a real `AUTH_SECRET` env var (otherwise anyone can
  forge a session cookie and skip the approval step), and revoke/rotate the Resend key in
  Resend → API Keys if it was ever exposed somewhere you don't trust.
- Keep `AUTH_SECRET` secret; never commit `.env` (it is git-ignored).
- The API endpoints send `Cache-Control: no-store` (see `vercel.json`).
- Consider rate-limiting the login endpoint behind a firewall rule if you expect
  many attempts.

