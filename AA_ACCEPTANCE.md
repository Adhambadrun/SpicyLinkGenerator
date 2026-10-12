# AA.com acceptance test — passenger form with the same available fare

**Status: NOT LIVE VERIFIED in this environment.** The sandbox cannot connect to AA.com.
`npm test` checks our parsing, timestamp conversion, URL construction and UI wiring; it
cannot prove that AA accepts a link, that a seat exists or that a fare is available.
The repository's historical `/goto/metasearch?ITEN=…` link is preserved as the
**AA-only Generate action**. Its `0.00` field is a protocol placeholder,
not the fare. The user reports that this method works; that is not a repeatable
verification result until the checks below are recorded.

## Definition of pass

All of these must be true *in the same fresh browser run*, without completing a purchase:

1. Spicy parses **every** leg and the passenger mix; compare flight number, marketing
   carrier, airports, *local* departure date/time, and class against the original GDS/Matrix
   itinerary. No invented fare basis or price is treated as the source quote.
2. Click **Open AA exact-flight link**. Final browser address belongs to `aa.com`
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
| Codeshare / non-AA marketing | Exact AA handoff blocked; use directory fallback | Offline guard tested |
| DST transition / unknown airport | Correct absolute departure instant or safe refusal | Offline guard tested |
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

## Regression recovery

Keep `aa-handoff.js` separate from other airline adapters. The golden checksum in
`test/aa-handoff.test.mjs` pins its generated URL envelope. If AA stops landing correctly,
compare a *redacted* failing case to the last passing manual run and the golden output.
Do not silently replace the AA handoff with a different carrier's search builder.
The homepage remains a clearly labeled fallback when an exact AA URL cannot be safely made.
