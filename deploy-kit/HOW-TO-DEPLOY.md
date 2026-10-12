# Back to approver sign-ins — how this reaches your live site

You asked for the old behaviour: the 6-digit code goes to **adhambadraan@gmail.com**, and you
pass it on to whoever is signing in. That is what this version does again — and it is also why
it works with the Resend key you already have: Resend's shared sender
(`onboarding@resend.dev`) can only deliver to the address your Resend account is registered
to, which is your own Gmail. The version that mailed the code straight to each user could
never deliver for anyone but you.

**Nothing new to configure.** No domain to verify, no new environment variable: the approver
inbox defaults to `adhambadraan@gmail.com`. (If you ever want to approve from another inbox,
set `APPROVER_EMAIL` in Vercel → Settings → Environment Variables.)

## Option A — one click (preferred)

The fix is on a branch with a pull request. Open the PR on GitHub and press **Merge pull
request**. Vercel redeploys `main` automatically in ~30 seconds, and the live site switches
back to approver sign-ins. Nothing to download.

## Option B — upload the files yourself

If you would rather not merge the PR, replace these files on GitHub (**Add file → Upload
files**, keeping the same paths). Vercel redeploys on its own.

| file in the preview | upload to this GitHub path |
|---|---|
| `/deploy-kit/index.html`      | `index.html`        |
| `/deploy-kit/core.js`         | `lib/core.js`       |
| `/deploy-kit/mailer.js`       | `lib/mailer.js`     |
| `/deploy-kit/request-code.js` | `api/request-code.js` |
| `/deploy-kit/health.js`       | `api/health.js`     |

(`app.html` and `api/session.js` did not change and do not need re-uploading.)

## Check it on the real site

1. Open `https://YOUR-SITE.vercel.app/api/health` — `otpRecipient` must read
   `adhambadraan@gmail.com` and `mailReadyToSend` must be `true`.
2. Open `https://YOUR-SITE.vercel.app/api/health?send=1` — that emails you a test (no code
   inside) and reports what Resend said. `delivery.ok: true` means sign-in emails can arrive.
3. Sign in with any `name@bcflights.com` address: the code lands in **adhambadraan@gmail.com**
   and you read it back to that person.
4. A wrong domain (`someone@gmail.com`) or a wrong code still ends in the full-screen gorilla
   dead-end.
