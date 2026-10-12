# AA.com acceptance test — passenger form with the same available fare

**Status: NOT LIVE VERIFIED in this environment.** The sandbox cannot connect to AA.com.
`npm test` checks our parsing, timestamp conversion, URL construction and UI wiring; it
cannot prove that AA accepts a link, that a seat exists or that a fare is available.
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
| Multi-city AA | All legs, no dropped leg; exact original fare if offered | Not tested |
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

### British Airways (BA) status — `processOffer` alive, shape-restricted after 2026-10-12 probes

- **Previous homepage fallback**: Previously, selecting `BA` on a mixed `BA` + `AA` multi-city
  itinerary resolved to `https://www.britishairways.com/` (`kind: 'homepage'`), which BA
  geo-redirected to the visitor's regional homepage (for example,
  `/travel/home/public/en_eg/`) with an empty search form.
- **Live probes, 2026-10-12 (HTTP GET, no JavaScript execution, no cookies, no login, no PII)**.
  Four URLs were requested directly; all returned HTTP 200 with the page titled
  **"British Airways - Processing Flight Selection"** ("Give us a moment, we're calculating
  your price"):
  1. BA-only one-way: `…/processOffer?onds=CDG-LHR_2026-10-30&ad=1&yad=0&ch=0&inf=0&cabin=M&flex=LOWEST&ond=1`
  2. BA round-trip: `…/processOffer?onds=CDG-LHR_2026-10-30,LHR-CDG_2026-11-06&ad=1&yad=0&ch=0&inf=0&cabin=M&flex=LOWEST&ond=2`
  3. Mixed-carrier 6-leg multi-city (the app's exact 3-slice output): `…/processOffer?onds=CDG-MSY_2026-10-30,MIA-STI_2026-10-31,STI-BCN_2027-01-21&ad=1&yad=0&ch=0&inf=0&cabin=C&flex=LOWEST&ond=3`
  4. Invalid-airport control: `…/processOffer?onds=XXX-YYY_2026-10-30&ad=1&yad=0&ch=0&inf=0&cabin=M&flex=LOWEST&ond=1`

  **Conclusion: `processOffer` is NOT retired/broken** — none of the probes returned a 404, an
  error page, or an immediate server-side redirect to `/travel/home/public/en_*`, even for
  invalid input. The working one-way/round-trip hypothesis (not the full-revert hypothesis)
  therefore applies. However, the "calculating your price" step is client-side JavaScript:
  without executing it, the *final* landing page (flight results vs. error vs. an empty regional
  homepage) is unverifiable for **every** shape — the identical interstitial is returned even
  for the invalid-airport control, so the interstitial itself is not evidence of acceptance.
  These probes contain only public O&D/date search input and were made without cookies;
  no transient identifiers (`search-journey-id`, `cid`), session cookies, or PII were
  requested, observed, stored, or committed.
- **Shape restriction (2026-10-12)**: Because multi-city acceptance cannot be proven,
  `resolveAirlineLink` now gates BA on itinerary shape *before* calling any O&D builder
  (including the legacy `baUrl` injected by `app.html`), and `buildBAProcessOfferUrl` refuses
  the same shapes defensively. Links are emitted only for one-way and round-trip shapes —
  at most 2 O&D slices (`baSliceIndex` starts a new slice on a route break or a >24 h
  ground gap). Itineraries needing 3+ O&D slices, including the mixed BA/AA 6-leg trip above,
  resolve to a clearly labeled BA homepage fallback whose note states the one-way/round-trip
  limitation instead of emitting an unverifiable multi-city `processOffer` URL. Supported
  shapes remain `kind: 'search_unverified'` (label `Open BA offer search`) and encode only
  slice origin/destination and date (`onds`), passenger counts (`ad`, `yad`, `ch`, `inf`),
  a single dominant cabin code (`F`/`C`/`W`/`M`), `flex=LOWEST`, and `ond` — never flight
  numbers, marketing carriers, booking classes, departure times, or connection airports.
- **Manual browser verification still needed on `britishairways.com`**:
  1. In a real (JavaScript-enabled) browser, run **BA-only one-way** and **BA-only round-trip**
     through `Open BA offer search` and record what the "Processing Flight Selection" page lands
     on: flight results (record the benchmark outcome codes, up to the passenger-form checks
     above), an error, or a redirect to `/travel/home/public/en_*`. This decides whether BA can
     ever be promoted from `search_unverified`.
  2. Confirm the multi-city restriction is still necessary by attempting the 3-slice mixed
     BA/AA URL once in a real browser; record whether it renders results (requires re-evaluating
     the gate) or fails (restriction confirmed).
  3. Test **passenger counts** (adults, youths, children, lap infants) on a supported shape.
  4. Record redacted landing URLs only (strip session/cart/journey tokens) and screenshots
     without submitting passenger PII or payment. Do not commit URLs containing live tokens.

## Regression recovery

Keep the original `unixMs` and `aaMetaUrl` functions in `app.html` unchanged; the app-wiring
tests pin their original payload for AA-only and mixed-carrier trips. The golden checksum in
`test/aa-handoff.test.mjs` also protects the standalone AA URL envelope. If AA stops landing
correctly, compare a *redacted* failing case to the last passing manual run and the expected
payload. Do not silently replace the AA handoff with a different carrier's search builder.
