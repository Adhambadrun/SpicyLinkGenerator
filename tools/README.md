# tools/ — live handoff probe

`ba-live-probe.mjs` drives a **real desktop browser** through the airline handoffs and records
where each one lands. It exists because BA's offer-search page is a client-side *“Give us a
moment, we're calculating your price”* interstitial that answers **every** input (valid,
multi-city, even an invalid airport) with byte-identical HTML, so the real landing page cannot
be observed without executing JavaScript — and because a rendering fetch (however accurate)
**cannot click**, so it can never prove that a search resolves to flights.

## Run it (on a machine with a normal browser and internet access)

```bash
git switch main                                  # or the branch being evaluated
npm install --no-save --no-package-lock playwright
npx playwright install chromium

node tools/ba-live-probe.mjs --dry-run --capture --matrix --legacy   # review the case list, no browser
node tools/ba-live-probe.mjs                     # the app's own output + the AA link, headless
node tools/ba-live-probe.mjs --headful           # watch it happen in a visible window
node tools/ba-live-probe.mjs --headful --capture --seconds=150  # PRIORITY 1: capture BA's own prefill URL
node tools/ba-live-probe.mjs --headful --matrix --seconds=150   # PRIORITY 2: legacy-entry variant matrix
node tools/ba-live-probe.mjs --headful --legacy --seconds=150   # re-measure the recorded-BLOCKED handoff
node tools/ba-live-probe.mjs --seconds=150       # wait longer for a price to resolve
node tools/ba-live-probe.mjs --no-consent        # do not click the cookie banner
```

`--dry-run` (alias `--list-cases`) prints every case URL **already redacted** and launches no
browser, so the case list and the redaction rules can be reviewed anywhere — and are asserted
by `test/ba-live-probe.test.mjs`.

### Default cases — what the app emits today

**A** BA-only one-way, **B** BA-only round-trip, **C** the mixed BA/AA 6-leg itinerary with BA
selected (all three open BA's own multi-city search form, because BA has no prefill format —
`AA_ACCEPTANCE.md`), and **D** the same itinerary's AA metasearch link.

### `--capture` — find out whether BA has a prefill format at all (cases F, G, H)

Opens `…/flightSearch`, accepts the cookie banner, then **fills the form by hand** like a
visitor (one row per O&D slice: From, To, Date; plus Business travel class), clicks **Search**
and records the URL BA itself produces — the address bar, every redirect `Location`, and every
extra tab — redacted. Itinerary A (1 slice), B (2 slices) and C (3 slices) are each filled in
a fresh context.

BA's `ba-sell` app publishes no selectors, so each field is tried with four strategies
(`getByLabel`, `getByPlaceholder`, `getByRole('combobox')`, `getByRole('textbox')`), the date
is offered as `DD/MM/YYYY`, `MM/DD/YYYY` and ISO, and **every attempt is recorded** in
`filledFields`. The selectors are **unverified until an owner run records them**: a form the
tool could not fill is reported as `CAPTURE_FAILED_FORM_NOT_FILLED` (or
`CAPTURE_FAILED_NO_SUBMIT_CONTROL`) with a body-text sample so the selectors can be fixed —
never as a result. If it does submit, the outcome is `CAPTURED_BA_SEARCH_URL` plus the
classifier's verdict on where BA landed.

### `--matrix` — the legacy-entry variant matrix, one variant per fresh context (M1–M9)

| Case | Question it answers |
| --- | --- |
| `M1` | `processOffer` in the owner's point of sale (`en_eg`) instead of `en_gb` |
| `M2` | `processOffer` with BA's low-price-finder entry id `&eId=113021` |
| `M3` | **Two-step**: visit `/travel/home/public/en_eg/`, accept the cookie banner, *then* navigate to `processOffer` in the same tab — is the hang a missing-session problem? |
| `M4` / `M5` | `/travel/book/public/en_gb` with third-party prefill params, and the same path with **no** params as a control (rendering probes: both redirect to `/processing`) |
| `M6` | `/travel/schedulesresults/public/en_gb` with route params (claimed elsewhere to bypass the session lock) |
| `M7` | `/travel/fx/public/en_gb` legacy booking entry with route params |
| `M8` | `/travel/low-price-finder/public/en_gb` with route + cabin + nights |
| `M9` | The search form the app ships, in `en_eg` |

### `--legacy` — re-measure the recorded-BLOCKED handoff (L1–L3)

The one-way, the round-trip and the 3-slice `processOffer` URLs exactly as recorded in
`AA_ACCEPTANCE.md` (the 3-slice URL is rebuilt through `buildBAProcessOfferUrl`, which throws
for 3+ slices and so falls back to the pinned literal). Use `--seconds=150` to give the price
time to resolve before the case is judged.

Each case gets a **fresh browser context** (no cookies carried between cases), accepts ba.com's
cookie banner like a normal visitor, waits up to `--seconds`, and records the URL/title
timeline, redirects, every extra tab opened, console errors, the filled fields (capture cases),
the final redacted URL/title and a screenshot. Output: a summary on stdout,
`artifacts/ba-live-probe-report.json` and `artifacts/*.png` (both gitignored — never commit run
artifacts).

**Recorded results (2026-10-12).** Owner-run, desktop Chrome, production: cases A/B/C of the
*legacy* handoff all end as `STILL_PROCESSING_INTERSTITIAL` — the processing page never
resolves, for the one-way and the round-trip link alike, so `processOffer` stays `BLOCKED`.
Rendering fetches the same day (which cannot click) additionally showed: BA's `flightSearch`
form renders instantly but ignores `onds/ad/yad/ch/inf/cabin/flex/ond` (query *and* fragment)
and `tripType/from/to/departDate/cabinclass/adult`; `/travel/book/public/en_gb` (with or
without params) redirects to `/processing`; `schedulesresults` renders an empty timetable form;
`/travel/fx` renders the booking entry without prefill; and the low-price-finder honours only
`cabin`, not `origin`/`destination`. Full table in `AA_ACCEPTANCE.md`. **No browser run has yet
exercised BA's Search button** — that is what `--capture` and `--matrix` are for. Only a
recorded run that reaches BA flight results *and* passes the passenger-form benchmark should
move BA off the empty-form handoff. `buildBAProcessOfferUrl` exists only for this tool's
`--legacy` cases; building that URL is not evidence of reaching BA results or passenger details.
The app itself only opens BA's empty search form (plus one unverified Google Flights search,
labeled not BA) and asks the user to submit BA's search there.

## Privacy / redaction guarantees

* No login, account, payment, passport or passenger data is entered or stored.
* Cookies, local storage and request headers are **never** written to disk.
* Every printed URL is redacted: origin, path and the documented search parameters survive
  (`onds`, `ad`, `yad`, `ch`, `inf`, `cabin`, `flex`, `ond`, plus the BA surface parameters
  probed on 2026-10-12 — `origin`, `destination`, `outboundDate`, `inboundDate`, `departDate`,
  `departureDate`, `returnDate`, `CabinCode`, `NumberOfAdults`, `TripType`/`tripType`, `from`,
  `to`, `cabinclass`, `adult`, `child`, `infant`, `adults`, `depAirport`, `arrAirport`, `ss`,
  `numNights`, `eId`, `multiCityFlights`, `saleOption`, `fromPkg`). **Every other query value
  becomes `<redacted>`**, and a fragment is printed as `#<redacted>`, so transient ids such as
  `search-journey-id` or `cid` — and AA's `ITEN` payload — can never reach a log, test, doc or
  commit. `eId` is a BA entry-point id that BA itself publishes in its own links, not a session
  or passenger value.
* Consequence for `--capture`: a captured BA URL is reported as **parameter names with
  `<redacted>` values**. The values stay in the operator's address bar; record the *format* in
  `AA_ACCEPTANCE.md`, not a live URL.

These guarantees are unit-tested: `test/ba-live-probe.test.mjs` asserts the redaction of
transient ids, the case lists behind each flag, and that `--dry-run` prints 19 cases without
launching a browser.

## Optional: run it in GitHub Actions

`gh-workflow-ba-live-probe.yml` in this folder is a ready-to-use workflow (Chrome under Xvfb,
screenshots uploaded as artifacts, `workflow_dispatch` only). Copy it to
`.github/workflows/ba-live-probe.yml` and run it from the Actions tab — this requires a token
with the GitHub **workflows** permission, which the arena automation token does not have, so it
cannot add the file itself.
