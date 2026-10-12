# Spicy Link Generator

A single-page tool that parses GDS-style itineraries or supported Matrix-style JSON, builds
experimental search handoffs and illustrative JSON, and has a two-step sign-in gate.
Generated prices and fare codes are not verified or booking-ready.

Made by Adham Badran

## Airline handoff research status

The app accepts supported Sabre/Amadeus-style GDS text **or** Matrix-style JSON
(`itinerary.slices[].segments[]` with full ISO timestamps, airport codes and booking classes).
Imported JSON is preserved when copied. Raw GDS text does **not** contain enough data to
construct a real priced offer: its exported fare basis, taxes, fare construction and price are
synthetic illustrations, **not** a live quote or a verified BookWithMatrix booking. Outbound
links are experimental search handoffs; no airline payment or passenger prefill is promised.
Reprice directly with an authorized provider before booking. The airline directory lists 66
candidate public homepages for marketing carriers found in the itinerary. They are **not
live-checked** in this sandbox. A single-carrier itinerary selects its airline automatically; a
mixed-carrier itinerary shows an accessible airline dropdown (with locally bundled logos where
available, IATA monograms otherwise). **Generate and Copy use the same selected airline and
URL**. When AA is selected, the original AA metasearch URL includes every itinerary leg, even
on mixed-carrier trips; AA may not pin non-AA-marketed flights. Other mixed-carrier selections
fall back to the selected airline's homepage rather than inventing a joint cart. Unknown carriers
get no URL.

For AA-selected itineraries, Generate copies and opens the historical `/goto/metasearch?ITEN=…`
URL; Copy copies the same URL. The original URL format is unchanged, but its presence does not
verify flight selection, availability or price. Transient post-redirect AA parameters (such as
`/airfare-sales/ui/passenger-ui/` query IDs) are session-specific and are never stored in code,
tests or docs. Delta and United direct one-way/round-trip itineraries have *unverified search
prefills* (not flight selection or checkout). British Airways (`BA`) and all other carriers use
their own directory homepage (`https://www.britishairways.com/`, which BA geo-redirects to a
regional homepage such as `/travel/home/public/en_gb/` or `/travel/home/public/en_eg/`). The
legacy unused `baUrl` (`processOffer?onds=…`) helper in `app.html` is **not** wired in because
it strips flight numbers, marketing carriers, booking classes, departure times and intermediate
connection airports, collapses mixed cabins into one letter, and has not been live-verified on
`britishairways.com`. No fabricated price or passenger details are passed to these sites.
Airline marks are used for identification only; see
[asset attribution](assets/airline-logos/ATTRIBUTION.md). See
[AA_ACCEPTANCE.md](AA_ACCEPTANCE.md) for the live passenger-form + fare-match test.
No direct-checkout capability is claimed until that test passes in a real browser.
See [IMPLEMENTATION_BRIEF.md](IMPLEMENTATION_BRIEF.md) for the evidence-first implementation
plan and limitations of prior unverified airline/Google Flights claims.

---

## How the two-factor login works

1. User opens the site and enters their **@bcflights.com** or **@travelbusinessclass.com** work email — **that's the only
   field** (no name is asked for).
2. The server checks the domain (any other domain is rejected) and generates a
   **6-digit code**.
3. The code is emailed to the **approver inbox** — `APPROVER_EMAIL`, by default
   **adhambadraan@gmail.com** — together with the name and address of whoever asked for it.
   The approver passes the 6 digits on to that person. Nothing is ever emailed to the person
   signing in.
4. The user enters the code the approver gave them; the server verifies it and opens the app.

Security properties:
- Every sign-in needs a human approval step. Nobody can let themselves in, even with a
  mailbox on an allowed domain.
- Codes are HMAC-SHA256 signed and stateless — they cannot be forged or replayed,
  and they expire after **10 minutes** (max **5** wrong attempts).
- Sessions are signed httpOnly cookies. They **stay signed in for as long as the tab is open**
  (no idle timeout); the only thing that ends a session is closing the tab (see below).
- Domain lock is enforced server-side (not just in the browser).
- The code is **never** returned to the browser in production — it only exists in the
  approval email.

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

> The 6-digit code is delivered to the approver, not to the person signing in, so a fresh
> code — and a fresh approval — is required for every new tab.

---

## Project layout

```
spicy-link-generator/
├── index.html          ← login page (2FA gate: email → code)
├── app.html            ← the actual tool (redirects to login if no session)
├── logo.png            ← app logo
├── api/
│   ├── request-code.js ← POST  validate domain → generate code → email the approver (Resend)
│   ├── verify.js       ← POST  check code → set session cookie
│   ├── session.js      ← GET   is the visitor signed in?
│   └── health.js       ← GET   deployment smoke test (＋ `?send=1` delivery test)
├── lib/
│   ├── core.js         ← shared crypto (HMAC sign/verify, code gen, domain lock, approver inbox)
│   └── mailer.js       ← Resend delivery of the approval emails
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
prints the request (name, requester, approver inbox, code) in its console, so the flow can be
finished locally. If a `RESEND_API_KEY` is present in `.env`, it also sends the real approval
email to the approver inbox, using the same mailer as production; without one, the local code
is returned for development only.

```bash
npm test             # auth core, mailer, and API handler tests
```

## 2 · Deploy to Vercel (production, real email)

The approval email is sent server-side with the official **Resend Node.js SDK**
(`api/request-code.js`). The Resend API key must be supplied through the `RESEND_API_KEY`
environment variable:

```javascript
import { Resend } from 'resend';
const resend = new Resend(process.env.RESEND_API_KEY);
await resend.emails.send({ from: FROM_EMAIL, to: approverEmail, subject: '…', html: '…' });
```

**Resend setup:**
No API key is committed to the repository. To enable OTP delivery:
1. Sign in at https://resend.com and create a key under **API Keys**.
2. Set `RESEND_API_KEY` in your environment or Vercel settings.
3. Leave `FROM_EMAIL` unset to send from Resend's shared address
   `Spicy Link Generator <onboarding@resend.dev>` (the default). The sender is never
   derived from `ALLOWED_DOMAINS` — those only decide who may ask for a code.
4. Leave `APPROVER_EMAIL` unset to approve from **adhambadraan@gmail.com** (the default).

**Why that default pairing works:** Resend only lets `onboarding@resend.dev` deliver to the
address its account is registered to. The approver inbox *is* that address, so nothing else
has to be configured — no DNS records, no verified domain. If you point `APPROVER_EMAIL`
somewhere else, you must also verify a domain at https://resend.com/domains → **Add domain**
(`bcflights.com`, or a subdomain such as `send.bcflights.com`), add the DNS records it shows,
then set `FROM_EMAIL` to an address on it, e.g. `Spicy Link Generator <login@bcflights.com>`.

**Deploy:**
1. Push this folder to GitHub.
2. Go to https://vercel.com → **Add New → Project** → import the repo.
3. Framework preset: **Other** (leave build command and output directory empty).
4. **Settings → Environment Variables** (all optional — working defaults are built-in):
   - `AUTH_SECRET`     ← **recommended** (`openssl rand -hex 32`)
   - `RESEND_API_KEY`  ← required for OTP delivery
   - `APPROVER_EMAIL`  ← inbox that approves sign-ins; defaults to `adhambadraan@gmail.com`
   - `FROM_EMAIL`      ← defaults to `Spicy Link Generator <onboarding@resend.dev>`; set it
     to an address on a domain you verified in Resend to send from your own domain
   - `ALLOWED_DOMAINS` (comma-separated, default `bcflights.com,travelbusinessclass.com`;
     the legacy single-value `ALLOWED_DOMAIN` still works)
5. Click **Deploy**. Every future `git push` redeploys automatically.

**Verify the API is live (do this first, before anything else):**
Open this in your browser, using YOUR site's address:
```
https://YOUR-SITE.vercel.app/api/health
```
- Returns `{"ok":true,"app":"Spicy Link Generator",...}` → the server is deployed ✓
  Check `mailConfigured` (a key is present), `otpRecipient` (the approver inbox), and
  `mailReadyToSend` — that last one says a send can be *attempted*.
- Returns a 404 / "not found" page → the API is NOT running. You are either on a
  static-only host (Netlify Drop / GitHub Pages — those can't run the functions),
  opened the file by double-clicking it, or deployed without the `api/` folder.
  Deploy the whole folder to **Vercel** and open the `vercel.app` URL.

**Prove email delivery in one step:**
```
https://YOUR-SITE.vercel.app/api/health?send=1
```
That sends a real test email — no code in it — to the approver inbox and reports exactly what
Resend answered (`delivery.ok: true` means sign-in emails can arrive). It is rate-limited to
one test per 30 seconds.

> ⚠️ The login page can only send codes through the Vercel server functions.
> If you see "Network error — try again" on the login page, it means the browser
> can't reach `/api/*` — almost always because the page is open as a local file,
> on a static host, or in a sandboxed preview. Test on the Vercel URL instead.

### ⚙ "You can only send testing emails to your own email address" — the email fails

That error is Resend's. Sign-in emails go out from Resend's shared sender
(`onboarding@resend.dev`, the default), and Resend only lets that address email the address
your Resend account is registered to. Normally that is the approver inbox, so everything just
works — you only hit this when the two are different:

1. **Make sure the approver is the account address** — `APPROVER_EMAIL` must be the exact
   address your Resend account was created with. Setting it there is enough; no DNS needed.
2. **Or send from your own domain** — https://resend.com/domains → **Add domain**
   (`bcflights.com`, or a subdomain such as `send.bcflights.com`), add the SPF/DKIM DNS
   records it shows, and wait for the domain to read **Verified**. Then set
   `FROM_EMAIL = Spicy Link Generator <login@bcflights.com>` (an address on that verified
   domain) in Vercel → Settings → Environment Variables for **Production** and **Preview**.
3. **Redeploy** — Deployments → ⋯ → **Redeploy**, so the new variables are picked up.
4. **Confirm** — open `/api/health?send=1`: `delivery.ok` must be `true`. Request a code again.

The login page reports these as a short **⚙ Setup needed** box; it never prints Resend's raw
multi-line error at the visitor.

## 3 · Change the approver inbox

Set `APPROVER_EMAIL` in Vercel → Settings → Environment Variables (or in `.env` locally):
every sign-in code goes to that inbox from then on. If you move it away from the Resend
account's own address, also follow step 2 above (verify a domain and set `FROM_EMAIL`),
otherwise Resend refuses the send. Setting `APPROVER_EMAIL=none` disables the relay, which
stops sign-ins with a setup error.

## 4 · Change the allowed domains

Edit `.env.example` (or the defaults in `lib/core.js`) — the allowed domains
(`ALLOWED_DOMAINS=one.com,two.com`) are fully configurable per environment, no code changes
needed. They only decide **who may ask for a code**; the code itself always goes to the
approver inbox.

## 5 · Security notes

- ⚠️ Sign-in is two steps: the domain list decides who may ask, and the approver decides who
  actually gets in. Share the 6-digit code only with the person who asked for it.
- ⚠️ **This repo is public.** Never commit `RESEND_API_KEY` or `AUTH_SECRET`. Any Resend key
  that was previously present in the repository should be revoked and replaced in Vercel →
  Settings → Environment Variables. Anyone who knows the fallback `AUTH_SECRET` can forge a
  session cookie and skip the code entirely, so set a real `AUTH_SECRET` before deploying.
- Keep both secrets private; never commit `.env` (it is git-ignored).
- The API endpoints send `Cache-Control: no-store` (see `vercel.json`).
- Consider rate-limiting the login endpoint behind a firewall rule if you expect
  many attempts.
