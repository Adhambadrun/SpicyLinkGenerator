# AA.com acceptance test — passenger form with the same available fare

**Status: NOT LIVE VERIFIED in this environment.** The sandbox cannot connect to AA.com or
ba.com (outbound access is limited to package registries and GitHub), so browser results here are
either owner-reported or produced by `tools/ba-live-probe.mjs` on a machine with real internet.
`npm test` checks our parsing, timestamp conversion, URL construction and UI wiring; it
cannot prove that an airline accepts a link, that a seat exists or that a fare is available.
The repository's historical `/goto/metasearch?ITEN=…` URL is used whenever AA is selected,
including mixed-carrier itineraries, and its payload contains every parsed leg. Generate copies
and opens it; Copy copies the same URL. Non-AA-marketed flights may not be pinned by AA. Its
`0.00` field is a protocol placeholder, not the fare. The user reports that this method works;
that is not a repeatable verification result until the checks below are recorded.

## Definition of pass

All of these must be true *in the same fresh browser run*, without completing a purchase:

1. Spicy parses **every** leg and the passenger mix; compare flight number, marketing
   carrier, airports, *local* departure date/time, and class against the original GDS/Matrix
   itinerary. No invented fare basis or price is treated as the source quote.
2. Click **Open AA metasearch link**. Final browser address belongs to `aa.com`
   (not another seller); no blocked/error/homepage fallback. Record the landing step.
3. The **selected flights** are in the AA itinerary/cart, not merely displayed somewhere
   in search results; compare every leg, dates, cabin/brand, and passenger counts.
4. AA actually displays the **passenger-details form** for those flights. The booking
   remains selectable at that point. Verify that the fare displayed by AA matches the
   **actual external source quote** in currency, total, passenger mix, included items and
   applicable point of sale. If it changes, record `PRICE_CHANGED`, not `PASS`.
5. Proceed no further than the final review **before payment**; do not submit payment,
   create a paid order, or enter real passport/card details in testing. If AA requires
   names to advance, use permitted test identities only and stop before booking.

A form appearing alone is **not** enough; a stale price, swapped flight, changed
passenger count, or a generic search page is a failure for this benchmark.

## Human browser run

- Use a current, legitimately obtained AA itinerary/offer with a *source timestamp and
  quoted total*; choose flights on future dates and a permitted sandbox/test user if
  available. Avoid live-account automation and purchases.
- Run on the deployed application after signing in. Test in a fresh normal browser tab,
  then a private tab (some handoffs depend on airline login/cookies). Run once near the
  quote time and again after the offer changes/expires; the second run must **not** be
  reported as a passing live fare.
- Record the test date/time UTC, browser, route, segments, cabin/class, passenger mix,
  source quote/currency/time, landing step, AA displayed amount/currency and final result.
  Redact all URL tokens, cookies, passenger data, record locators, email and card fields
  before saving logs/screenshots. Do not commit a full redirect URL with a live token.
- If AA blocks or changes the flow, record the failure verbatim. Do not use proxy rotation,
  CAPTCHA solving, spoofed partner credentials or a fabricated AA cart to bypass it.

| Case | Expected | Result |
| --- | --- | --- |
| One-way direct, 1 adult | Correct flight → passenger form → matching live total | Not tested |
| Round-trip direct, 1 adult | Both flights, same fare/currency | Not tested |
| AA→AA connection | Both legs together; no accidental multi-city repricing | Not tested |
| Multi-city AA | All legs, no dropped leg; exact original fare if offered | Owner-reported landing at the AA passenger-details page (“Passengers - Passenger deta…”); fare, passenger counts and leg pinning **not** compared — still NOT LIVE VERIFIED |
| 2 adults + child / lap infant | All passengers; airline's constraints respected | Not tested |
| Codeshare / non-AA marketing | Original URL contains every leg; AA may not pin non-AA flights | Not live tested |
| DST transition / unknown airport | Legacy airport-offset conversion must be checked against each local departure | Not live tested |
| Sold-out, expired or repriced offer | Explicit not-available/changed, never mark as pass | Not tested |
| New tab / airline logged out | Record difference in landing and fare | Not tested |

**Outcome codes:** `PASS_PASSENGER_FORM_MATCHED_FARE`, `SEARCH_ONLY`, `FLIGHT_MISMATCH`,
`PRICE_CHANGED`, `UNAVAILABLE`, `PASSENGER_MISMATCH`, `BLOCKED`, `UNKNOWN`.
No carrier may be promoted from `unverified` to verified based solely on URL tests.

## How to extend to another airline

Collect the same evidence for that airline *first*. Build a specific adapter only if
its site or an authorized partner offers a documented/observed handoff. Test the full
itinerary and live price; record failures and fall back to a clearly labeled search or
homepage. PSS vendor names or a Google Flights redirect do not substitute for this test.

### British Airways (BA) status — `processOffer` BLOCKED for real users; homepage fallback for every shape

**Outcome: `BLOCKED`** (real-browser run, 2026-10-12, desktop Chrome, current deployment).
BA's `/travel/book/public/en_gb/processOffer` handoff never reaches flight results, so the app
no longer offers it for **any** itinerary shape:

| Case | Link opened (search input only, no tokens) | Observed landing |
| --- | --- | --- |
| A · BA-only one-way `1 BA 323J 30OCT F CDGLHR SS1   705A  735A /DCBA /E` | `…/processOffer?onds=CDG-LHR_2026-10-30&ad=1&yad=0&ch=0&inf=0&cabin=C&flex=LOWEST&ond=1` | Stuck indefinitely on **“Give us a moment, we're calculating your price”** — no flight results, no error page, no redirect to `/travel/home/public/en_*`. |
| B · BA-only round-trip (adds `2 BA 324J 06NOV F LHRCDG SS1   840A 1105A /DCBA /E`) | `…/processOffer?onds=CDG-LHR_2026-10-30,LHR-CDG_2026-11-06&ad=1&yad=0&ch=0&inf=0&cabin=C&flex=LOWEST&ond=2` | Same hang on the processing page, indefinitely. |
| C · mixed BA/AA 6-leg multi-city, 3 O&D slices (reference run, before the shape gate existed) | `…/processOffer?onds=CDG-MSY_2026-10-30,MIA-STI_2026-10-31,STI-BCN_2027-01-21&ad=1&yad=0&ch=0&inf=0&cabin=C&flex=LOWEST&ond=3` | Same hang; no results, no error, no homepage redirect. |

The HTTP-only probes below had already shown the interstitial is byte-identical for valid,
multi-city **and invalid** input, so it is not evidence of acceptance. The real browser now adds
the second half: it is not a slow or transient state either — it never resolves. A button that
strands a paying user on a spinner for every shape must not be emitted, so BA is demoted rather
than shape-restricted.

**Decision (2026-10-12)**

- `resolveAirlineLink` emits **no BA link**: `kind: 'homepage'`, `url` = `https://www.britishairways.com/`,
  label `Visit British Airways website`, and a note that states the handoff is unusable (with the
  live-browser date) plus, for 3+ O&D slices, the one-way/round-trip limitation. Nothing in the
  module calls a BA URL builder, so an injected or legacy builder cannot put the link back into
  the UI — that is pinned by a test.
- The **O&D slice gate is retained** (`baSliceIndex`, `BA_MAX_SLICES = 2`,
  `baUnsupportedSlices`): the slice count is still computed in one place to explain the
  multi-city limitation, and the legacy builder still refuses 3+ slices defensively.
- `buildBAProcessOfferUrl` survives **only as a manual re-probing tool** (used by
  `tools/ba-live-probe.mjs`); it must not be wired back into the app until a recorded browser run
  reaches BA flight results *and* the passenger-form benchmark below passes.
- `app.html` no longer injects a BA builder at all (its legacy `baUrl`/`baCabin`/`deltaSliceIndex`
  copies were deleted as dead code). `unixMs` and `aaMetaUrl` are untouched: the AA payload is
  byte-identical, and the app-wiring tests still pin the 6-leg epoch values.

**How to re-test in one command (any machine with a normal browser and internet access)**

```bash
npm install --no-save --no-package-lock playwright && npx playwright install chromium
node tools/ba-live-probe.mjs --headful     # cases A, B, C and the AA link; screencaps + JSON
node tools/ba-live-probe.mjs --legacy-multi-city   # also re-opens the 3-slice URL above
```

The probe uses a fresh context per case (no cookie reuse), never logs in, never enters passenger
data, and redacts every URL except origin, path and the documented search parameters
(`onds`/`ad`/`yad`/`ch`/`inf`/`cabin`/`flex`/`ond`) — so `search-journey-id`, `cid` or any other
transient value cannot reach a log, test, doc or commit. Artifacts stay in the gitignored
`artifacts/` folder. A **pass** would be: interstitial resolves → BA flight results → the
benchmark steps 3–5 above with a matching fare; record it here and only then reconsider the link.

**Historical HTTP-only evidence (2026-10-12, GET, no JavaScript, no cookies, no login, no PII).**
Four URLs were requested directly; all returned HTTP 200 with the page titled
**“British Airways - Processing Flight Selection”** (“Give us a moment, we're calculating your
price”): the one-way (A), the round-trip (B), the mixed-carrier 6-leg multi-city (C, exact app
output at the time) and an invalid-airport control
(`…/processOffer?onds=XXX-YYY_2026-10-30&ad=1&yad=0&ch=0&inf=0&cabin=M&flex=LOWEST&ond=1`).
None returned 404, an error page, or an immediate server-side redirect to `/travel/home/public/en_*`
— which is exactly why the interstitial alone was never treated as evidence. These probes
contained only public O&D/date search input and were made without cookies; no transient
identifiers (`search-journey-id`, `cid`), session cookies, or PII were requested, observed,
stored, or committed.

### The mystery third tab from the previous run — identified

The unexplained tab titled **“Passengers - Passenger deta…”** was the **AA** side, not BA: it was
reached from **Open AA metasearch link** for the 6-leg mixed BA/AA itinerary (test C), and the
owner reports the AA flow “works fine” there. Landing step recorded: AA **passenger-details
page** after the metasearch handoff. This is an owner-reported observation, not a benchmark pass —
the displayed fare was **not** compared against a source quote, passenger counts were not
reconciled, and no screenshot was captured, so AA stays `NOT LIVE VERIFIED` for the fare gate
above. It does confirm that the metasearch link is the one that advances, and that BA's spinner
was never a passenger form.

### Deployment caveat for these runs

The Vercel **production** deployment created for the PR #21 merge failed
(`dpl_DQm7fAP3Kg56dt5hsGmBFxS2eNrH`, status `failure`), so production was still serving the
pre-#21 build at the time of the runs above; test C therefore exercised the pre-gate behaviour
(BA emitting the 3-slice URL), which is the case that motivated the gate. The probe and the
shape-gate code are in the repository regardless of deploy health; verify
`https://<deployment>/airline-links.js` matches the merged commit before recording a new
browser result.

## Regression recovery

Keep the original `unixMs` and `aaMetaUrl` functions in `app.html` unchanged; the app-wiring
tests pin their original payload for AA-only and mixed-carrier trips. The golden checksum in
`test/aa-handoff.test.mjs` also protects the standalone AA URL envelope. If AA stops landing
correctly, compare a *redacted* failing case to the last passing manual run and the expected
payload. Do not silently replace the AA handoff with a different carrier's search builder.
