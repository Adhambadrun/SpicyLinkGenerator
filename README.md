# Spicy Link Generator

A single-page tool that turns a GDS (Sabre/Amadeus) itinerary into booking-ready links and
BookWithMatrix-valid JSON — fronted by a **real two-factor sign-in** gate.

Made by Lamar García · lamar@bcflights.com

---

## How the two-factor login works

1. User opens the site and enters their **@bcflights.com** or **@travelbusinessclass.com** work email — **that's the only
   field** (no name is asked for).
2. The server checks the domain (any other domain is rejected) and generates a
   **6-digit code**.
3. The code is emailed **straight to the address that asked for it** — the person signing
   in. Nobody else is involved and nothing is relayed by hand. The email greets them by
   name (built from the address, e.g. `lamar.garcia@…` → *Lamar Garcia*) and the subject
   line carries the code.
4. The user enters the code from their inbox; the server verifies it and opens the app.

Security properties:
- Codes are HMAC-SHA256 signed and stateless — they cannot be forged or replayed,
  and they expire after **10 minutes** (max **5** wrong attempts).
- Sessions are signed httpOnly cookies. They **stay signed in for as long as the tab is open**
  (no idle timeout); the only thing that ends a session is closing the tab (see below).
- Domain lock is enforced server-side (not just in the browser).
- The code is **never** returned to the browser in production — it only exists in the
  sign-in email.
- Trade-off to know about: because the code goes to the requester, **anyone with a mailbox
  on an allowed domain can sign in on their own** — the human approval step is gone and the
  allowed-domain list is the gate. To go back to human-in-the-loop approval, point
  `to:` in `handleRequestCode` (`lib/core.js`) at a fixed approver address again.

### Dead end for outsiders

A **non-@bcflights.com / non-@travelbusinessclass.com email** *or* a **wrong/expired code** replaces the whole login page
with a full-screen `dead end.png` (the gorilla). The form is destroyed, there is no button,
link or "back", and the tab is flagged in `sessionStorage` so reloading in the same tab shows
the dead end again. Only a brand-new tab gets a fresh login form.

### Sessions: stay signed in until the tab closes

- Entering a valid code signs in **that tab** (`sessionStorage`). Once signed in, the user
  stays signed in **indefinitely** — there is no idle timeout. While the app is open, a
  heartbeat to `/api/session` (every 30 seconds) rolls the signed cookie's expiry forward.
- **Closing the tab — or opening a new one — ends the session**, so the next visit always
  asks for a **new OTP**. Only a new login code is required; nothing else prompts for one.
- If the server reports the session is no longer valid, the page sends the user back to login.

> The 6-digit code is delivered to the person signing in, so a fresh code is required
> for every new tab — but there is no human approval step in the middle any more.

---

## Project layout

```
spicy-link-generator/
├── index.html          ← login page (2FA gate: email → code)
├── app.html            ← the actual tool (redirects to login if no session)
├── logo.png            ← app logo
├── api/
│   ├── request-code.js ← POST  validate domain → generate code → email the requester (Resend)
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

Open http://localhost:8080 and use any `name@bcflights.com` or `name@travelbusinessclass.com` address. The dev server always
prints the request (name, recipient, code) in its console, so the flow can be finished locally.
If a `RESEND_API_KEY` is present in `.env`, it also sends the real sign-in email to the
address that asked for the code, using the same mailer as production; without one, the local
code is returned for development only.

```bash
npm test             # auth core, mailer, and API handler tests
```

## 2 · Deploy to Vercel (production, real email)

The login email is sent server-side with the official **Resend Node.js SDK** (`api/request-code.js`).
The Resend API key must be supplied through the `RESEND_API_KEY` environment variable:

```javascript
import { Resend } from 'resend';
const resend = new Resend(process.env.RESEND_API_KEY);
await resend.emails.send({ from: FROM_EMAIL, to: requesterEmail, subject: '…', html: '…' });
```

**Resend setup:**
No API key is committed to the repository. To enable OTP delivery:
1. Sign in at https://resend.com and create a key under **API Keys**.
2. Set `RESEND_API_KEY` in your environment or Vercel settings.
3. For a quick test sender, you can use `FROM_EMAIL=Spicy Link Generator <onboarding@resend.dev>`
   (delivers only to your Resend account email). Sign-in codes now go to **arbitrary
   @bcflights.com / @travelbusinessclass.com addresses**, so production needs a verified
   domain: **Domains → Add domain**, then set `FROM_EMAIL` to `login@bcflights.com`.

**Deploy:**
1. Push this folder to GitHub.
2. Go to https://vercel.com → **Add New → Project** → import the repo.
3. Framework preset: **Other** (leave build command and output directory empty).
4. **Settings → Environment Variables** (all optional — working defaults are built-in):
   - `AUTH_SECRET`     ← **recommended** (`openssl rand -hex 32`)
   - `RESEND_API_KEY`  ← required for OTP delivery
   - `FROM_EMAIL`      ← **set this on a verified domain** (defaults to `onboarding@resend.dev`)
   - `ALLOWED_DOMAINS` (comma-separated, default `bcflights.com,travelbusinessclass.com`;
     the legacy single-value `ALLOWED_DOMAIN` still works)
5. Click **Deploy**. Every future `git push` redeploys automatically.

**Verify the API is live (do this first, before anything else):**
Open this in your browser, using YOUR site's address:
```
https://YOUR-SITE.vercel.app/api/health
```
- Returns `{"ok":true,"app":"Spicy Link Generator",...}` → the server is deployed ✓
  Check `mailConfigured`: it must be `true` for production OTP emails to be sent.
- Returns a 404 / "not found" page → the API is NOT running. You are either on a
  static-only host (Netlify Drop / GitHub Pages — those can't run the functions),
  opened the file by double-clicking it, or deployed without the `api/` folder.
  Deploy the whole folder to **Vercel** and open the `vercel.app` URL.

> ⚠️ The login page can only send codes through the Vercel server functions.
> If you see "Network error — try again" on the login page, it means the browser
> can't reach `/api/*` — almost always because the page is open as a local file,
> on a static host, or in a sandboxed preview. Test on the Vercel URL instead.

## 3 · Change the allowed domains

Edit `.env.example` (or the defaults in `lib/core.js`) — the allowed domains
(`ALLOWED_DOMAINS=one.com,two.com`) are fully configurable per environment, no code changes
needed. The sign-in code is always sent to whoever requested it, so there is no recipient
address to configure.

## 4 · Security notes

- ⚠️ The only thing standing between a stranger and the app is the allowed-domain list, so
  keep `ALLOWED_DOMAINS` tight and keep `AUTH_SECRET` private.
- ⚠️ **This repo is public.** Never commit `RESEND_API_KEY` or `AUTH_SECRET`. Any Resend key
  that was previously present in the repository should be revoked and replaced in Vercel →
  Settings → Environment Variables. Anyone who knows the fallback `AUTH_SECRET` can forge a
  session cookie and skip the code entirely, so set a real `AUTH_SECRET` before deploying.
- Keep both secrets private; never commit `.env` (it is git-ignored).
- The API endpoints send `Cache-Control: no-store` (see `vercel.json`).
- Consider rate-limiting the login endpoint behind a firewall rule if you expect
  many attempts.

