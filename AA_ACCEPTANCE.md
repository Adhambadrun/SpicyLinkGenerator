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

### British Airways (BA) status — homepage fallback only

- **Observed mixed-carrier behavior**: Selecting `BA` on a mixed `BA` + `AA` multi-city
  itinerary resolves to `https://www.britishairways.com/` (`kind: 'homepage'`), which BA
  geo-redirects to the visitor's regional homepage (for example,
  `/travel/home/public/en_eg/`) with an empty search form. That is this app's homepage
  fallback, not proof for or against a BA deep link.
- **Why legacy `baUrl` (`processOffer?onds=…`) is not enabled**: `app.html` retains an unused
  `/travel/book/public/en_gb/processOffer?onds=…` helper that only sends slice origin/destination
  and date (`onds`), passenger counts (`ad`, `yad`, `ch`, `inf`), a single dominant cabin code
  (`F`/`C`/`W`/`M`), `flex=LOWEST`, and `ond`. It drops flight numbers, marketing carriers,
  booking classes, departure times, and connection airports, and has not been verified in a
  live browser on `britishairways.com`.
- **Manual test needed before coding any BA handoff**:
  1. Test a **BA-only direct one-way** and **BA-only round-trip** on `britishairways.com` to
     observe whether BA exposes a stable public search or flight-selection URL and what
     parameters/landing step it actually reaches.
  2. Test **BA connections and multi-city** (up to 6 O&D slices) and **passenger counts**
     (adults, youths, children, lap infants).
  3. Test **mixed BA + AA (oneworld)** itineraries to determine whether `britishairways.com`
     can price/book AA-marketed non-UK slices or only BA-marketed/UK-touching journeys.
  4. Record redacted landing URLs (strip session/cart/journey tokens) and screenshots without
     submitting passenger PII or payment.

## Regression recovery

Keep the original `unixMs` and `aaMetaUrl` functions in `app.html` unchanged; the app-wiring
tests pin their original payload for AA-only and mixed-carrier trips. The golden checksum in
`test/aa-handoff.test.mjs` also protects the standalone AA URL envelope. If AA stops landing
correctly, compare a *redacted* failing case to the last passing manual run and the expected
payload. Do not silently replace the AA handoff with a different carrier's search builder.
