# tools/ — live handoff probe

`ba-live-probe.mjs` drives a **real desktop browser** through the links the app's
*Open BA offer search* / *Open AA metasearch link* buttons emit, and records where each one
lands. It exists because the 2026-10-12 HTTP-only probes could not answer the one question that
decides BA's fate: ba.com's `/processOffer` page is a client-side
*"Give us a moment, we're calculating your price"* interstitial that answers **every** input
(valid, multi-city, even an invalid airport) with byte-identical HTML, so the real landing page
cannot be observed without executing JavaScript.

## Run it (on a machine with a normal browser and internet access)

```bash
git switch arena/753c6466-spicylinkgenerator      # or main once merged
npm install --no-save --no-package-lock playwright
npx playwright install chromium
node tools/ba-live-probe.mjs                      # all cases, headless
node tools/ba-live-probe.mjs --headful            # watch it happen in a visible window
node tools/ba-live-probe.mjs --seconds=120        # wait longer for the price to resolve
node tools/ba-live-probe.mjs --legacy-multi-city  # also re-test the 3-slice URL the gate refuses
```

Cases: **A** BA-only one-way, **B** BA-only round-trip, **C** the mixed BA/AA 6-leg itinerary
with BA selected (today's app output), **D** the same itinerary's AA metasearch link, and
**E** (opt-in) the legacy 3-slice `processOffer` URL.

Each case gets a **fresh browser context** (no cookies carried between cases), accepts ba.com's
cookie banner like a normal visitor, waits up to `--seconds` for the interstitial to resolve,
and records the URL/title timeline, redirects, every extra tab opened, console errors, the final
redacted URL/title and a screenshot. Output: a summary on stdout, `artifacts/ba-live-probe-report.json`
and `artifacts/*.png` (both gitignored — never commit run artifacts).

Outcome codes: `STILL_PROCESSING_INTERSTITIAL`, `REDIRECTED_REGIONAL_HOMEPAGE`,
`LEFT_INTERSTITIAL_FLIGHT_RESULTS_POSSIBLE`, `LEFT_INTERSTITIAL_UNCLASSIFIED`, `ERROR_PAGE`,
`UNKNOWN_PROCESS_OFFER_STATE`. *Possible results* is deliberately not a pass — the
`AA_ACCEPTANCE.md` benchmark still requires the passenger form with a matching fare.

## Privacy / redaction guarantees

* No login, account, payment, passport or passenger data is entered or stored.
* Cookies, local storage and request headers are **never** written to disk.
* Every printed URL is redacted: origin, path and the documented search parameters
  (`onds`, `ad`, `yad`, `ch`, `inf`, `cabin`, `flex`, `ond`) survive; all other query values
  become `<redacted>`, so transient ids such as `search-journey-id` or `cid` can never reach a
  log, test, doc or commit.

## Optional: run it in GitHub Actions

`gh-workflow-ba-live-probe.yml` in this folder is a ready-to-use workflow (Chrome under Xvfb,
screenshots uploaded as artifacts, `workflow_dispatch` only). Copy it to
`.github/workflows/ba-live-probe.yml` and run it from the Actions tab — this requires a token
with the GitHub **workflows** permission, which the arena automation token does not have, so it
cannot add the file itself.
