# AA.com acceptance test — passenger form with the same available fare

**Status: NOT LIVE VERIFIED in this environment.** The sandbox's own network cannot connect to
AA.com or ba.com (`curl https://www.britishairways.com/` fails with `SSL_ERROR_SYSCALL`; outbound
access is limited to package registries and GitHub). Rendering **fetches** to ba.com are possible
through the agent's page-fetch proxy and were used on 2026-10-12 — they prove what a page renders
and which parameters it ignores, but they cannot click, so anything requiring a click is either
owner-reported or produced by `tools/ba-live-probe.mjs` on a machine with a real browser.
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
`tools/ba-live-probe.mjs` additionally reports landing classes verbatim:
`STILL_PROCESSING_INTERSTITIAL`, `PROCESSING_PAYMENT_INTERSTITIAL`,
`REDIRECTED_REGIONAL_HOMEPAGE`, `LEFT_INTERSTITIAL_FLIGHT_RESULTS_POSSIBLE`,
`LEFT_INTERSTITIAL_UNCLASSIFIED`, `ERROR_PAGE`, `UNKNOWN_PROCESS_OFFER_STATE`, and for the
hand-fill capture `CAPTURED_BA_SEARCH_URL`, `CAPTURE_SUBMIT_NO_NAVIGATION`,
`CAPTURE_FAILED_FORM_NOT_FILLED`, `CAPTURE_FAILED_NO_SUBMIT_CONTROL`. None of the
`LEFT_INTERSTITIAL_*` classes is a pass.
No carrier may be promoted from `unverified` to verified based solely on URL tests.

## How to extend to another airline

Collect the same evidence for that airline *first*. Build a specific adapter only if
its site or an authorized partner offers a documented/observed handoff. Test the full
itinerary and live price; record failures and fall back to a clearly labeled search or
homepage. PSS vendor names or a Google Flights redirect do not substitute for this test.

A third-party search may only ever be offered as a **clearly labeled alternative beside** the
airline's own surface (button, note and toast all say so) — never as the airline link, never
labeled as an airline booking, and never with a fare attached. BA is the worked example: its
own search form is the airline link, and the per-cabin pre-filled Google Flights searches are
labeled alternatives. Copy formats found in other public projects are **not** evidence; the two
BA formats found by code search on 2026-10-12 both land on `/processing` (rows 7–10 above).

### British Airways (BA) status — no pre-filled BA URL exists; BA's own (empty) search form is the handoff

**Outcome for the offer-search handoff: `BLOCKED`** (real-browser run, 2026-10-12, desktop
Chrome, current deployment) — unchanged, and re-confirmed the same day by rendering fetch.
**Outcome for the emitted BA link: `SEARCH_ONLY`** — BA's own multi-city search form, opened
empty, with the itinerary spelled out in the note. No BA URL that claims to be pre-filled is
emitted, because on 2026-10-12 no such URL could be found that BA honours.

#### What was tested on 2026-10-12, and where each URL landed

Method: **rendering fetch** (headless renderer reached through this repository's agent
page-fetch proxy, JavaScript executed, no login, no cookies carried, no PII, search input
only). The agent sandbox itself has **no** route to ba.com — `curl https://www.britishairways.com/`
fails with `SSL_ERROR_SYSCALL` — so every row below came from that proxy, and every URL is
redacted to origin + path + documented search parameters. A renderer cannot click, so
**nothing below proves what BA's Search button does**; that still needs the owner's browser.

| # | URL opened (redacted) | Landing observed |
| --- | --- | --- |
| 1 | `/travel/book/public/en_gb/flightSearch` — no params | **HTTP 200**, title *“British Airways - Multi-city Flight Search”*. Form renders **immediately, no spinner, no redirect**: 3 flight rows (From / To / Date, *“Type 3 letters”*), “Remove flight”, “Add another flight”, Adults / Young adults / Children / Infants counters, travel class (Economy, Business), flexible-ticket toggle, Search. Date range advertised: 10/11/2026 → 9/30/2027. |
| 2 | same + `?onds=CDG-LHR_2026-10-30&ad=1&yad=0&ch=0&inf=0&cabin=C&flex=LOWEST&ond=1` | Identical page, **every field still empty** (*“Please enter your departing airport”*, *“This field is required”*). Parameters ignored. |
| 3 | same, 2-slice `onds=CDG-LHR_2026-10-30,LHR-CDG_2026-11-06&…&ond=2`, and the same payload as a **`#fragment`** | Identical page, fields empty. Ignored. |
| 4 | same + `?tripType=ONE_WAY&from=CDG&to=LHR&departDate=30/10/2026&cabinclass=C&adult=1` | Identical page, fields empty. Ignored. |
| 5 | `/travel/book/public/en_gb/processOffer?onds=CDG-LHR_2026-10-30&ad=1&yad=0&ch=0&inf=0&cabin=C&flex=LOWEST&ond=1` | *“Give us a moment, we're calculating your price”* (title *“Processing Flight Selection”*) — the recorded-BLOCKED interstitial. |
| 6 | same in the **owner's locale**: `/travel/book/public/**en_eg**/processOffer?onds=…&ond=1` | Byte-equivalent interstitial. Locale does not change the server response. |
| 7 | `/travel/book/public/en_gb?origin=CDG&destination=LHR&departureDate=2026-10-30&adults=1&cabin=C` | **Redirects to `/processing`** — *“Your payment is in progress. Please don't refresh the page or click the back button.”* Dead end. |
| 8 | `/travel/book/public/en_gb` (no params — control for row 7) | Same `/processing` payment interstitial, so row 7's params were irrelevant: this path is session-bound, not a prefillable search. |
| 9 | `/travel/schedulesresults/public/en_gb?origin=CDG&destination=LHR&outboundDate=2026-10-30&CabinCode=C&NumberOfAdults=1&TripType=O` | Title *“British Airways - Timetables”*, but the page shows the **empty** timetable search form (Leaving from / Going to / Departing on), no results table, and carries the strings *“Please return to the home page to continue.”* and *“Sorry, this page has timed out”* — session-gated, no prefill. |
| 10 | `/travel/fx/public/en_gb?eId=120001&depAirport=CDG&arrAirport=LHR&outboundDate=2026-10-30&adults=1` | Title *“British Airways - Plan your journey”* — BA's legacy booking entry with the stepper (1 Dates … 6 Confirmation) and a country/region chooser. Route dropdowns **not** prefilled. |
| 11 | `/travel/low-price-finder/public/en_gb?origin=CDG&destination=LHR&cabin=C` · also `…&numNights=7`, also `origin=JFK&destination=LHR`, also `origin=LHR&destination=CDG` | Title *“Find our cheapest fares”*. All four renders show the **same** heading *“Our cheapest **business class** flights from London”* and the **same** North America destination list: `cabin` **is** honoured, `origin`/`destination`/`numNights` produced **no visible change**. The 2026-10-12 lead “accepts route/cabin/nights” is therefore only partly confirmed — the route is not applied in the rendered page, so this is **not** evidence of a route prefill. |
| 12 | `/travel/book/public/**en_eg**/flightSearch` (the owner's point of sale) | Same page, same title, same empty form — only the help links are Egypt-localised (`/content/en/eg/…`). **No geo-redirect to a homepage**, so the emitted `en_gb` URL and the local one behave alike; BA localises this path in place. |
| 13 | `1 BA 323J 30OCT F CDGLHR …` + return `2 BA 324J 06NOV F LHRCDG …` → `processOffer … ond=2`, and the mixed 6-leg 3-slice URL | Owner's real-browser run: both hang **indefinitely** on *“Give us a moment, we're calculating your price”* — no results, no error, no homepage redirect. (Recorded earlier the same day; see the table below.) |

Rows 7–10 matter because those exact formats are what other public projects emit for BA
(found by code search on 2026-10-12); two of them land a paying customer on a **payment
interstitial**. None of them may be emitted by this app. Row 12 matters for the owner in
Cairo: the search surface renders in `en_eg` too, so this handoff does not depend on BA
accepting a UK point of sale.

#### Owner-run real-browser evidence (unchanged, still the reason `processOffer` is BLOCKED)

| Case | Link opened (search input only, no tokens) | Observed landing |
| --- | --- | --- |
| A · BA-only one-way `1 BA 323J 30OCT F CDGLHR SS1   705A  735A /DCBA /E` | `…/processOffer?onds=CDG-LHR_2026-10-30&ad=1&yad=0&ch=0&inf=0&cabin=C&flex=LOWEST&ond=1` | Stuck indefinitely on **“Give us a moment, we're calculating your price”** — no flight results, no error page, no redirect to `/travel/home/public/en_*`. |
| B · BA-only round-trip (adds `2 BA 324J 06NOV F LHRCDG SS1   840A 1105A /DCBA /E`) | `…/processOffer?onds=CDG-LHR_2026-10-30,LHR-CDG_2026-11-06&ad=1&yad=0&ch=0&inf=0&cabin=C&flex=LOWEST&ond=2` | Same hang on the processing page, indefinitely. |
| C · mixed BA/AA 6-leg multi-city, 3 O&D slices (reference run, before the shape gate existed) | `…/processOffer?onds=CDG-MSY_2026-10-30,MIA-STI_2026-10-31,STI-BCN_2027-01-21&ad=1&yad=0&ch=0&inf=0&cabin=C&flex=LOWEST&ond=3` | Same hang; no results, no error, no homepage redirect. |

**Landing step for BA: the processing interstitial, never the passenger form.** A button that
strands a paying user on a spinner must not be emitted.

#### Decision (2026-10-12, supersedes the bare-homepage fallback)

Clicking BA now opens **BA's own multi-city search form** —
`https://www.britishairways.com/travel/book/public/en_gb/flightSearch` (row 1: HTTP 200, form
renders instantly, no spinner, no geo-redirect to an empty widget):

- `resolveAirlineLink` returns `kind: 'search_unverified'`, label **“Open BA search form”**,
  and a note that states (a) why nothing is pre-filled (the BLOCKED handoff + the ignored
  parameters, with the date), (b) **exactly what to type** — e.g. *“Fill “Flight 1” with
  CDG→LHR on 2026-10-30 (business, 1 adult) and remove the other rows.”*, or one row per O&D
  slice for multi-city — and (c) *“No flight is selected and no fare is shown or claimed here.”*
- `app.html` offers one clearly labeled button per represented cabin — for example,
  **“Pre-filled Google Flights · Business (not BA)”** and **“Pre-filled Google Flights ·
  Economy (not BA)”**. `ondSlicesWithCabin` collapses connections to one O&D slice and retains
  each cabin present on that slice's legs; `gfSearchGroups` builds one URL per cabin, so no
  single mixed-cabin Google Flights search is emitted. A mixed-cabin connection may appear
  under each represented cabin and is not reproduced leg-for-leg. TFS field 9 selects seat
  class (1 economy, 2 premium economy, 3 business, 4 first); field 19 encodes trip type
  (1 round-trip, 2 one-way, 3 multi-city). Buttons, note and toast label the search as
  third-party, **not BA**, never an airline booking or a fare, and it is hidden for every
  carrier that has its own handoff.
- The **O&D slice gate is retained** (`baSliceIndex`, `BA_MAX_SLICES = 2`,
  `baUnsupportedSlices`): 3+ slices still explain the one-way/round-trip limitation in the
  note, and `buildBAProcessOfferUrl` still refuses 3+ slices defensively.
- `buildBAProcessOfferUrl` survives **only as a manual re-probing tool**
  (`tools/ba-live-probe.mjs`). Nothing in `resolveAirlineLink` calls a BA builder, and
  `assertNotBlockedBaHandoff` throws if a BA URL ever contains `processOffer`,
  `search-journey-id` or `cid` — pinned by tests, so an injected or legacy builder cannot
  resurrect the blocked link.
- `unixMs` and `aaMetaUrl` are untouched; the AA payload is byte-identical and the 6-leg
  epoch values stay pinned in `test/app-wiring.test.mjs`.

#### What is still NOT verified (needs a real browser — the sandbox cannot click)

1. Whether BA's form, **filled by hand and submitted**, reaches flight results. Rows 1–4
   prove the form renders and ignores parameters; they do not exercise the Search button.
2. The **two-step session hypothesis** (homepage → accept cookies → `processOffer` in the
   same tab). Untested here; `tools/ba-live-probe.mjs --matrix` runs it as case `M3`.
3. The **capture flow's selectors** (`--capture`): BA's ba-sell app publishes no selectors,
   so the tool tries labelled/placeholder/role strategies per field and records which one
   worked. Until an owner run records `CAPTURED_BA_SEARCH_URL`, treat the selectors as
   **unverified**; a form it could not fill is reported as `CAPTURE_FAILED_FORM_NOT_FILLED`,
   never as a result.
4. The **passenger-form + fare-match benchmark** above. BA has never reached step 3, so BA
   stays `SEARCH_ONLY`, never `PASS_PASSENGER_FORM_MATCHED_FARE`.
5. Google Flights landing/results for the cabin-specific URLs. The TFS fields above are built
   and pinned by unit tests, but this sandbox has not observed those generated URLs in a real
   browser; they remain third-party `search_unverified` alternatives, with no fare claimed.
   Test success is not a substitute for browser evidence.

**Sandbox limitation for this turn (2026-10-12).** No new `--capture`, `M3`, `--matrix` or
`--legacy` browser result is recorded here. The checkout has no Playwright/Chromium install,
and this sandbox cannot reach ba.com; therefore no BA result, captured URL or session-hypothesis
verdict was produced. The existing `BLOCKED` / `SEARCH_ONLY` outcomes above remain unchanged;
this is not a new browser observation. Run the commands below on a machine with a real browser
and internet access, then paste only the redacted report results.

**How to re-test in one command (any machine with a normal browser and internet access)**

```bash
npm install --no-save --no-package-lock playwright && npx playwright install chromium
node tools/ba-live-probe.mjs --dry-run --capture --matrix --legacy   # review the case list, no browser
node tools/ba-live-probe.mjs --headful --capture --seconds=150  # PRIORITY 1: capture BA's own prefill URL
node tools/ba-live-probe.mjs --headful --matrix --seconds=150  # PRIORITY 2: legacy-entry variant matrix
node tools/ba-live-probe.mjs --headful --legacy --seconds=150  # re-measure the BLOCKED handoff
```

Each case gets a fresh context (no cookie reuse), never logs in, never enters passenger
data, and redacts every URL except origin, path and the documented search parameters — so
`search-journey-id`, `cid` or any other transient value cannot reach a log, test, doc or
commit. A captured BA URL therefore appears in the report as **parameter names with
`<redacted>` values**; the real values stay in the operator's address bar. Artifacts stay in
the gitignored `artifacts/` folder. A **pass** would be: `CAPTURED_BA_SEARCH_URL` → BA flight
results → benchmark steps 3–5 with a matching fare; record it here and only then replace the
empty-form handoff with the captured prefill.

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
browser result. **Update (2026-10-12, after PR #25):** the Vercel production deployment of the
merge commit `e8afb43` **succeeded** (commit state `success`, deployment
`7010092136`, `https://spicylinkgenerator-hkuxumdi2-mr-spicy.vercel.app`), and a fetch of
`https://spicylinkgenerator.vercel.app/airline-links.js` returns the new module — it contains
`BA_SEARCH_FORM_URL` and `assertNotBlockedBaHandoff` — so production serves the code the BA
evidence table describes. The 2026-10-12 **rendering probes** in the BA table above were made directly
against `www.britishairways.com`, not against a deployment, so they are unaffected by Vercel
build status; only the owner's in-app clicks depend on which build production serves.

## Regression recovery

Keep the original `unixMs` and `aaMetaUrl` functions in `app.html` unchanged; the app-wiring
tests pin their original payload for AA-only and mixed-carrier trips. The golden checksum in
`test/aa-handoff.test.mjs` also protects the standalone AA URL envelope. If AA stops landing
correctly, compare a *redacted* failing case to the last passing manual run and the expected
payload. Do not silently replace the AA handoff with a different carrier's search builder.
