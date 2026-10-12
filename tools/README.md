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

node tools/ba-live-probe.mjs --dry-run --capture --candidates --matrix --legacy   # review all 27 cases, no browser
node tools/ba-live-probe.mjs                     # the app's own output + the AA link, headless
node tools/ba-live-probe.mjs --headful           # watch it happen in a visible window
node tools/ba-live-probe.mjs --headful --capture --replay --seconds=150  # PRIORITY 1: capture BA's own
                                                 # prefill URL, then reopen it in a fresh incognito
node tools/ba-live-probe.mjs --headful --candidates --seconds=60  # PRIORITY 2: the recorded #1–#7 rows,
                                                 # final page + seconds waited + network failures
node tools/ba-live-probe.mjs --headful --matrix --seconds=150   # legacy-entry variant matrix
node tools/ba-live-probe.mjs --headful --legacy --seconds=150   # re-measure the recorded-BLOCKED handoff
node tools/ba-live-probe.mjs --seconds=150       # wait longer for a price to resolve
node tools/ba-live-probe.mjs --no-consent        # do not click the cookie banner
pbpaste | node tools/ba-live-probe.mjs --headful --replay-stdin  # replay a URL from your own address bar
```

`--dry-run` (alias `--list-cases`) prints every case URL **already redacted** and launches no
browser, so the case list and the redaction rules can be reviewed anywhere — and are asserted
by `test/ba-live-probe.test.mjs`. `--candidates` and `--replay-stdin` also print a **paste-ready
evidence table** (see `--markdown` below), so a run's results can go straight into
`AA_ACCEPTANCE.md` without retyping URLs.

Every case now records, in the JSON report and in the printed summary:

* the final page (URL, title, landing class) and **the seconds waited**,
* **network failures** the way DevTools → Network shows them — `403`/`429`/`5xx` responses and
  transport failures — as **status + method + path only**. Query strings are dropped whole,
  because a CDN error or a redirect can carry a session id in them,
* the same for every extra tab the page opens.

### Default cases — what the app emits today

**A** BA-only one-way, **B** BA-only round-trip, **C** the mixed BA/AA 6-leg itinerary with BA
selected (all three open BA's own multi-city search form, because BA has no prefill format —
`AA_ACCEPTANCE.md`), and **D** the same itinerary's AA metasearch link.

### `--capture` — find out whether BA has a prefill format at all (cases F, G, H)

Opens `…/flightSearch`, accepts the cookie banner, then **fills the form by hand** like a
visitor (one row per O&D slice: From, To, Date; plus Business travel class), **removes BA's
extra rows** so exactly one row per O&D slice is submitted (one-way: fill Flight 1, remove the
other two — `plannedRemovals` is unit-tested), clicks **Search** and records the URL BA itself
produces — the address bar, every redirect `Location`, and every extra tab — redacted.
Itinerary A (1 slice), B (2 slices) and C (3 slices) are each filled in a fresh context.

What the report adds for the capture specifically:

* `capturedParamNames` — the parameter **names** of the URL BA produced, sorted and deduped.
  That is the recordable *format*; the values stay in the operator's address bar.
* `formAfterFill` / `formReadBack` — the values actually read back out of the DOM. A click
  that did not stick is reported (`readBackWarning`), never recorded as a filled field.
* `rowsRemoved` — how many of BA's rows were removed before submitting.

BA's `ba-sell` app publishes no selectors, so each field is tried with four strategies
(`getByLabel`, `getByPlaceholder`, `getByRole('combobox')`, `getByRole('textbox')`), the date
is offered as `DD/MM/YYYY`, `MM/DD/YYYY` and ISO, and **every attempt is recorded** in
`filledFields`. The selectors are **unverified until an owner run records them**: a form the
tool could not fill is reported as `CAPTURE_FAILED_FORM_NOT_FILLED` (or
`CAPTURE_FAILED_NO_SUBMIT_CONTROL`) with a body-text sample so the selectors can be fixed —
never as a result. If it does submit, the outcome is `CAPTURED_BA_SEARCH_URL` plus the
classifier's verdict on where BA landed.

### `--replay` / `--replay-stdin` — is the captured URL reusable at all?

A captured URL is only useful as a shipping handoff if it still works for a **cold** visitor —
no cookies, no session, no `en_gb` state. So `--replay` takes the URL BA just produced (held in
memory, **never written to disk**) and opens it again in a **brand-new browser context**: fresh
incognito, no cookies, no storage. The verdict is namespaced so it can never be confused with
the capture's own landing:

`REPLAY_FLIGHT_RESULTS_POSSIBLE`, `REPLAY_PROCESSING_INTERSTITIAL`, `REPLAY_PAYMENT_INTERSTITIAL`,
`REPLAY_REDIRECTED_HOMEPAGE`, `REPLAY_ERROR_PAGE`, `REPLAY_UNCLASSIFIED`,
`REPLAY_NAVIGATION_FAILED`.

Only `REPLAY_FLIGHT_RESULTS_POSSIBLE` would justify taking a BA prefill handoff back to the
acceptance test — and then a **human still has to confirm the flights on the screenshot** and
run the passenger-form benchmark. A replay that lands on a spinner or a homepage while the
original capture showed results means the URL is session-bound and must not be shipped.

`--replay-stdin` runs the same replay on a URL piped in (e.g. `pbpaste` of your own address
bar) without echoing it: the report shows its path and parameter names only. Both modes print
the paste-ready evidence table.

### `--candidates` — the recorded #1–#7 rows, re-measured in a browser (R1–R8)

`AA_ACCEPTANCE.md` records thirteen rendering-fetch rows and a `BLOCKED` verdict. `--candidates`
re-opens the **seven candidate URLs from that table** as real browser cases, one per fresh
context, so each recorded row gets what the checklist asks for: final page, seconds waited and
network failures.

| Case | Doc row | URL (redacted) | Also checks |
| --- | --- | --- | --- |
| `R1` | 1 | `/travel/book/public/en_gb/flightSearch` | form renders empty |
| `R2` | 2 | same + `onds/ad/yad/ch/inf/cabin/flex/ond` query | **prefill ignored?** |
| `R3` | 3a | same + 2-slice `onds` payload | **prefill ignored?** |
| `R4` | 3b | same payload as a `#fragment` | **prefill ignored?** |
| `R5` | 4 | same + `tripType/from/to/departDate/cabinclass/adult` | **prefill ignored?** |
| `R6` | 5 | `en_gb/processOffer?onds=…&ond=1` (recorded BLOCKED) | landing class |
| `R7` | 6 | the same payload in `en_eg` | landing class |
| `R8` | 7 | `/travel/book/public/en_gb?origin=…&departureDate=…` | landing class |

The five `flightSearch` rows snapshot the rendered form (`form` in the report) and report
`PREFILL_IGNORED_FORM_EMPTY` (record confirmed), `PREFILL_APPLIED_FORM_POPULATED` (record
refuted — **still not flight results**, a human checks the screenshot) or `FORM_RENDERED_EMPTY`.
The watch also stops early once the page is stable, so a form that renders instantly does not
burn the whole `--seconds` budget.

### `--markdown` — the paste-ready evidence table

Prints the table the checklist wants, built from the reports (or from the case list under
`--dry-run`): `# | URL opened (redacted) | Landing observed | Seconds waited | Network failures
(status · path only)`. Values are already redacted, so the block can be pasted into
`AA_ACCEPTANCE.md` verbatim. `--candidates` and `--replay-stdin` turn it on automatically.

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

**Recorded results (2026-10-12, second session).** The same day, the arena agent re-checked
both install paths for the Actions workflow and both are still refused with the identical
errors: `git push` of `.github/workflows/ba-live-probe.yml` →
`refusing to allow a GitHub App to create or update workflow … without 'workflows' permission`,
and `gh api -X PUT repos/…/contents/.github/workflows/ba-live-probe.yml` →
`403 Resource not accessible by integration`. `gh workflow list` in the repository is empty, so
no workflow exists to dispatch. **The workflow still has to be created by hand in the web UI**
below — or skipped entirely, because the owner's own machine is the better evidence anyway
(`--headful` plus the checklist in `AA_ACCEPTANCE.md`). This session also produced **no new
browser observation**: its sandbox cannot reach ba.com (`curl` fails `SSL_ERROR_SYSCALL`),
`npx playwright install chromium` still fails, and no Chrome/Chromium binary exists on the box,
so the tooling below was re-reviewed by `--dry-run` and unit tests only. Every BA outcome in
`AA_ACCEPTANCE.md` therefore stands unchanged.

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
* **Sub-resource network failures are status + method + PATH ONLY** (`pathOnly`, `failureEntry`):
  the query string is dropped entirely, because a `403`/`429` from a CDN carries no itinerary
  information and a redirect can carry a session id. Path-only is strictly more private than a
  redacted URL and still answers "did BA's CDN block us?".
* Consequence for `--capture`: a captured BA URL is reported as **parameter names with
  `<redacted>` values**. The values stay in the operator's address bar; record the *format* in
  `AA_ACCEPTANCE.md`, not a live URL. **The raw captured URL is never written to disk**: the
  JSON report stores its path and parameter names only, and `--replay` reuses it in memory in a
  fresh context (pinned by `test/ba-live-probe.test.mjs`).

These guarantees are unit-tested: `test/ba-live-probe.test.mjs` asserts the redaction of
transient ids, the path-only rule for network failures, the capture plan (`plannedRemovals`)
and the form verdicts, the replay classifier, the evidence-table columns, the case lists behind
each flag, and that `--dry-run` prints 27 cases — with the markdown skeleton — without launching
a browser.

## Optional: run it in GitHub Actions

`gh-workflow-ba-live-probe.yml` in this folder is a ready-to-use workflow (Chrome under Xvfb,
`screenshots uploaded as artifacts, workflow_dispatch` only). Copy it to
`.github/workflows/ba-live-probe.yml` and run it from the Actions tab — this requires a token
with the GitHub **workflows** permission, which the arena automation token does not have, so it
cannot add the file itself.

**2026-10-12 attempts (both sessions, same errors):** `git push` of
`.github/workflows/ba-live-probe.yml` was rejected as
`refusing to allow a GitHub App to create or update workflow '.github/workflows/ba-live-probe.yml'
without 'workflows' permission`, and `gh api -X PUT repos/.../contents/.github/workflows/ba-live-probe.yml`
returned `403 Resource not accessible by integration`. `gh workflow list` is empty, so nothing is
installed to dispatch. Install it manually via the GitHub web UI:
Repo → `Add file` → `Create new file` → paste `tools/gh-workflow-ba-live-probe.yml` at
`.github/workflows/ba-live-probe.yml` → `Commit directly to main` →
`Actions` → `BA live browser probe` → `Run workflow` → download `ba-probe-artifacts`. The workflow
runs **two passes** with separate reports (`--report=`), because one 27-case run at a long
`--seconds` would exceed the job timeout:

1. `--capture --replay --candidates --matrix --seconds=60 --markdown --report=ba-live-probe-pass1.json`
   — every page that renders immediately, plus the capture and its fresh-context replay;
2. `--legacy --seconds=150 --markdown --report=ba-live-probe-pass2.json` — the recorded-BLOCKED
   `processOffer` handoff, given the full budget to resolve.

Runner IPs may be bot-blocked by BA (Akamai); a `403`/`429` there is a **possible bot block, not a
final answer** — that is exactly what the path-only network-failure column is for. Rely on the
owner's incognito test for the verdict.

**Time budget:** each interstitial case waits the whole `--seconds` before it is judged, so a run
costs roughly `(interstitial cases + 1) × --seconds`. At `--seconds=60` the fast pass above is a
few minutes; at `--seconds=150` the legacy pass is ~8 minutes. The `flightSearch` rows stop early
once the page is stable, so they cost a few seconds each.
