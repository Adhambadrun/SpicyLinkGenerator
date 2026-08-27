# Getting the gorilla dead-end LIVE on your real site

This sandbox can no longer push to GitHub (the session's PR was merged, which closed
its GitHub access). Your live Vercel site is therefore still running the OLD login
(the one that just prints "Only @bcflights.com emails are allowed."). That is exactly
the screenshot you saw — it is not a bug in the new code, the new code simply isn't
deployed yet.

The new code DOES work — the Arena live preview shows the gorilla. To put it on your
real site you only need to replace **4 files** on GitHub (you already know how: you
uploaded `Dead end.jpg` the same way). Vercel redeploys automatically on push to main.

## The 4 files (all in this `deploy-kit/` folder)

| download from the preview as… | upload to GitHub path… |
|---|---|
| `/deploy-kit/index.html`  | `index.html`        |
| `/deploy-kit/app.html`    | `app.html`          |
| `/deploy-kit/core.js`     | `lib/core.js`       |
| `/deploy-kit/session.js`  | `api/session.js`    |

## Steps

1. In the Arena live preview, open each URL on the left and save the raw file
   (right-click → Save As…, or view-source and copy all).
2. On GitHub → your repo → **Add file → Upload files**, drop each saved file in at the
   path on the right (GitHub replaces the existing file when names match; for the two
   that change folder, use the "lib/" and "api/" folders).
3. Commit to `main`. Vercel redeploys in ~30s.
4. Test on your real URL with `anything@gmail.com` → the gorilla dead-end appears.
   Test a wrong 6-digit code → same dead-end. Close the tab or idle 5 min → re-login.

Do **not** overwrite your gorilla image (`Dead end.jpg` / `dead end.png`) — the page tries both names and uses whichever exists.
