#!/usr/bin/env node
// Real-browser probe for the airline handoffs described in AA_ACCEPTANCE.md.
//
// It exists because BA's offer-search handoff cannot be judged without executing
// JavaScript: ba.com's `/processOffer` page is a client-side "Give us a moment, we're
// calculating your price" interstitial that answers every input (valid, multi-city, even
// an invalid airport) with byte-identical HTML. Rendering-only probes — including the
// ones recorded on 2026-10-12 — can prove a page renders and which parameters it ignores,
// but only a real browser can prove whether a search ever resolves to flights.
//
// Three jobs, each opt-in so a run stays small and reproducible:
//
//   1. `--capture`  (AA_ACCEPTANCE.md priority 1) Open BA's own multi-city form, fill the
//      test itineraries BY HAND like a visitor, submit, and record the exact URL BA itself
//      produces (address bar, plus any post-redirect Location). If BA has a prefill
//      format, this is how we find out what it is. The form selectors are heuristics: this
//      tool records which strategy filled which field, and a run it could not fill is
//      reported as CAPTURE_FAILED_FORM_NOT_FILLED — never as a result.
//   2. `--candidates` (AA_ACCEPTANCE.md priority 1+2 checklist) The seven recorded candidate
//      URLs (#1–#7 in the doc's evidence table) opened as real browser cases, one per fresh
//      context, each reporting the final page, the seconds waited and the network failures
//      (status + path only). The five `flightSearch` rows additionally snapshot the rendered
//      form fields, so "BA ignores every prefill parameter" is re-measured in a browser
//      instead of asserted from a rendering fetch.
//   3. `--replay`   The follow-up question the checklist asks after a capture: reuse the URL
//      BA produced and open it again in a BRAND-NEW context (fresh incognito, no cookies) —
//      does it still reach BA flight results, or is it session-bound? The captured URL is
//      held in memory only, never written to disk. `--replay-stdin` runs the same replay on
//      a URL piped in (e.g. the operator's address bar) without ever echoing it.
//   4. `--matrix`   (priority 2) The legacy-entry variant matrix, one variant per fresh
//      browser context: en_eg locale, `&eId=113021`, the two-step homepage→processOffer
//      session test, and the third-party URL shapes found in other projects that land on
//      BA's /processing interstitial.
//   5. default     The app's own output for the three BA shapes plus the AA metasearch
//      link, and (with `--legacy`) the recorded-BLOCKED processOffer URLs, re-measured.
//
// The tool is deliberately read-only and privacy-safe:
//   * no login, no account, no payment, no passenger data is entered anywhere,
//   * every browser context is fresh (no cookies reused between cases),
//   * no cookie jar, storage dump or request header is ever written to disk,
//   * URLs are printed redacted: origin, path and the documented search parameters
//     survive; every other query value becomes "<redacted>" so transient redirect ids
//     (`search-journey-id`, `cid`, …) can never be copied into logs, tests or docs.
//   * network failures are recorded as status + PATH ONLY (never the query string),
//     because a 403/429 from a CDN carries no search information and may carry a token.
//
// Usage (any machine with a real Chrome/Chromium and internet access):
//   npm install --no-save --no-package-lock playwright
//   npx playwright install chromium
//   node tools/ba-live-probe.mjs                    # app output + AA link, headless
//   node tools/ba-live-probe.mjs --headful          # visible browser window
//   node tools/ba-live-probe.mjs --capture          # fill BA's form by hand, capture its URL
//   node tools/ba-live-probe.mjs --capture --replay # …then reopen that URL in a fresh context
//   node tools/ba-live-probe.mjs --candidates       # the recorded #1–#7 rows, one fresh context each
//   node tools/ba-live-probe.mjs --matrix           # legacy-entry variant matrix
//   node tools/ba-live-probe.mjs --legacy           # re-open the BLOCKED processOffer URLs
//   node tools/ba-live-probe.mjs --markdown         # paste-ready evidence table for the doc
//   node tools/ba-live-probe.mjs --seconds=150      # wait longer for a price to resolve
//   node tools/ba-live-probe.mjs --dry-run          # print every case URL (redacted), no browser
//   pbpaste | node tools/ba-live-probe.mjs --headful --replay-stdin   # replay an address-bar URL
//
// Screenshots are written to artifacts/ (gitignored) and the JSON report is printed to
// stdout. Paste the summary block into AA_ACCEPTANCE.md, redacted exactly as printed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBAProcessOfferUrl, ondSlices, resolveAirlineLink } from '../airline-links.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = join(ROOT, 'artifacts');

export const PAX = { adults: 1, seniors: 0, youths: 0, children: 0, infantsInSeat: 0, infantsInLap: 0 };
const leg = (carrier, num, cls, origin, dest, ymd, depH, depM, arrH, arrM) =>
  ({ carrier, num, cls, origin, dest, ymd, depH, depM, arrH, arrM });

// A · BA-only one-way:  `1 BA 323J 30OCT F CDGLHR SS1   705A  735A /DCBA /E`
export const ONE_WAY = [leg('BA', '323', 'J', 'CDG', 'LHR', '2026-10-30', 7, 5, 7, 35)];
// B · BA-only round-trip: adds `2 BA 324J 06NOV F LHRCDG SS1   840A 1105A /DCBA /E`
export const ROUND_TRIP = [...ONE_WAY, leg('BA', '324', 'J', 'LHR', 'CDG', '2026-11-06', 8, 40, 11, 5)];
// C · The 6-leg mixed BA/AA itinerary from the repo docs: 3 O&D slices after collapsing.
export const MIXED_MULTI_CITY = [
  leg('BA', '323', 'J', 'CDG', 'LHR', '2026-10-30', 7, 5, 7, 35),
  leg('AA', '731', 'I', 'LHR', 'CLT', '2026-10-30', 9, 55, 14, 50),
  leg('AA', '2615', 'I', 'CLT', 'MSY', '2026-10-30', 16, 53, 18, 0),
  leg('AA', '1917', 'I', 'MIA', 'STI', '2026-10-31', 12, 5, 14, 15),
  leg('AA', '1770', 'O', 'STI', 'MIA', '2027-01-21', 7, 20, 8, 46),
  leg('AA', '112', 'O', 'MIA', 'BCN', '2027-01-21', 16, 15, 7, 5),
];

// URLs below are recorded in AA_ACCEPTANCE.md. They are kept here verbatim so a future run
// re-measures exactly what was measured before, and so nothing depends on a builder the
// app no longer calls.
const BA = 'https://www.britishairways.com';
const PROCESS_OFFER_GB = `${BA}/travel/book/public/en_gb/processOffer`;
const PROCESS_OFFER_EG = `${BA}/travel/book/public/en_eg/processOffer`;
const FLIGHT_SEARCH = `${BA}/travel/book/public/en_gb/flightSearch`;
const HOME_EG = `${BA}/travel/home/public/en_eg/`;
const PAX_QS = 'ad=1&yad=0&ch=0&inf=0&cabin=C&flex=LOWEST';
const ONDS_ONE_WAY = 'onds=CDG-LHR_2026-10-30';
const ONDS_ROUND_TRIP = 'onds=CDG-LHR_2026-10-30,LHR-CDG_2026-11-06';
const ONDS_MULTI_CITY = 'onds=CDG-MSY_2026-10-30,MIA-STI_2026-10-31,STI-BCN_2027-01-21';

// Origin + path + documented search parameters survive; every other query VALUE becomes
// "<redacted>". `eId` is a BA entry-point id that BA itself publishes in its own links
// (e.g. /travel/fx/public/en_gb?eId=111096&saleOption=PAKFHC) — not a session or passenger
// value. `search-journey-id`, `cid` and anything else never reach a log, test or commit.
export const SAFE_PARAMS = new Set([
  'onds', 'ad', 'yad', 'ch', 'inf', 'cabin', 'flex', 'ond',
  'origin', 'destination', 'outboundDate', 'inboundDate', 'departDate', 'departureDate',
  'returnDate', 'CabinCode', 'NumberOfAdults', 'TripType', 'tripType', 'from', 'to',
  'cabinclass', 'adult', 'child', 'infant', 'adults', 'depAirport', 'arrAirport', 'ss',
  'numNights', 'eId', 'multiCityFlights', 'saleOption', 'fromPkg',
]);
/** Keep origin + path; keep only documented search params; drop every transient value. */
export function redactUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return String(raw).slice(0, 120); }
  const kept = [];
  for (const [k, v] of u.searchParams) kept.push(SAFE_PARAMS.has(k) ? `${k}=${v}` : `${k}=<redacted>`);
  return `${u.origin}${u.pathname}${kept.length ? `?${kept.join('&')}` : ''}${u.hash ? '#<redacted>' : ''}`;
}

/** Origin + path only — no query at all. Used for sub-resource network failures, where a
 *  status code and a path are the whole finding and any query value could be a token. */
export function pathOnly(raw) {
  try { const u = new URL(raw); return `${u.origin}${u.pathname}`; }
  catch { return String(raw).split('?')[0].slice(0, 120); }
}

/** The parameter NAMES of a URL, sorted and deduped — what the doc may record as the
 *  "format" of a captured BA URL, with every value replaced by `<redacted>`. */
export function paramNames(raw) {
  try { return [...new Set(new URL(raw).searchParams.keys())].sort(); }
  catch { return []; }
}

/** Airport codes carried by a URL's documented `onds` payload (query or fragment). Used to
 *  decide whether BA honoured the prefill — never guessed from other parameters, because
 *  `tripType=ONE_WAY` would otherwise look like an airport code. */
export function itineraryTokensFromUrl(raw) {
  const onds = /onds=([^&#]+)/.exec(String(raw))?.[1] || '';
  return [...new Set(onds.match(/[A-Z]{3}(?=-|_|,|$)/g) || [])];
}

/** One network failure, safe to print: status + method + path (never the query string). */
export function failureEntry(status, method, raw) {
  return { status, method: String(method || 'GET').toUpperCase(), path: pathOnly(raw) };
}

const PROCESSING_TEXT = /calculating your price|processing flight selection|payment is in progress/i;
// Deliberately loose: any title that is NOT an interstitial is only reported as "possible
// results" for a human to confirm on the screenshot — never as a pass.
const RESULTS_HINT = /choose flights|flight results|select your flight|fare options|timetable/i;

export function classify(finalUrl, finalTitle, sawProcessing) {
  const path = (() => { try { return new URL(finalUrl).pathname; } catch { return ''; } })();
  if (/^\/processing$/.test(path) || /payment is in progress/i.test(finalTitle)) return 'PROCESSING_PAYMENT_INTERSTITIAL';
  if (path.includes('/travel/home/public/')) return 'REDIRECTED_REGIONAL_HOMEPAGE';
  if (/processOffer/.test(path)) return sawProcessing ? 'STILL_PROCESSING_INTERSTITIAL' : 'UNKNOWN_PROCESS_OFFER_STATE';
  if (/\/error|access denied|unavailable/i.test(finalTitle)) return 'ERROR_PAGE';
  if (RESULTS_HINT.test(finalTitle)) return 'LEFT_INTERSTITIAL_FLIGHT_RESULTS_POSSIBLE';
  return 'LEFT_INTERSTITIAL_UNCLASSIFIED';
}

/** The replay verdict: same landing classes, namespaced so a fresh-context replay can never
 *  be mistaken for the original capture's result. Only `REPLAY_FLIGHT_RESULTS_POSSIBLE`
 *  would justify re-testing a BA prefill handoff, and it still needs a human to confirm the
 *  results on the screenshot — it is never by itself a pass. */
export function classifyReplay(finalUrl, finalTitle, sawProcessing) {
  switch (classify(finalUrl, finalTitle, sawProcessing)) {
    case 'LEFT_INTERSTITIAL_FLIGHT_RESULTS_POSSIBLE': return 'REPLAY_FLIGHT_RESULTS_POSSIBLE';
    case 'STILL_PROCESSING_INTERSTITIAL': case 'UNKNOWN_PROCESS_OFFER_STATE': return 'REPLAY_PROCESSING_INTERSTITIAL';
    case 'PROCESSING_PAYMENT_INTERSTITIAL': return 'REPLAY_PAYMENT_INTERSTITIAL';
    case 'REDIRECTED_REGIONAL_HOMEPAGE': return 'REPLAY_REDIRECTED_HOMEPAGE';
    case 'ERROR_PAGE': return 'REPLAY_ERROR_PAGE';
    default: return 'REPLAY_UNCLASSIFIED';
  }
}

// The app emits AA's historical metasearch URL for the whole itinerary, mixed carriers
// included. Rebuilt here the same way app.html's aaMetaUrl does, with the epochs pinned in
// test/app-wiring.test.mjs so the probe opens the identical payload.
const AA_LEGS = MIXED_MULTI_CITY.map((s, i) => {
  const epoch = [1793340300000, 1793354100000, 1793397180000, 1793466300000, 1800516000000, 1800566100000][i];
  return { ...s, epoch };
});
export const AA_META_URL = 'https://www.aa.com/goto/metasearch?ITEN=' + encodeURIComponent([
  'DIRECT', '0', 'US', 'multi', '4', 'A1S0C0I0Y0L0', '0', AA_LEGS[0].origin, '0', AA_LEGS[0].dest,
  '0', '0', '0', '0', '0', '0', '0', '0.00', '1',
  AA_LEGS.map((s) => `#${s.origin}|${s.dest}|0|0|${s.epoch}`).join(''),
  AA_LEGS.map((s, i) => `#${s.carrier}|${s.num}|${s.cls}|${s.origin}|${s.dest}|${s.epoch}|${i}`).join(''),
].join(','));

/** The seven candidate URLs recorded in AA_ACCEPTANCE.md's evidence table (#1–#7), each one
 *  exactly as written there, so a real-browser run answers the same questions per row: final
 *  page, seconds waited and network failures. The five `flightSearch` rows also snapshot the
 *  rendered form fields (`formCheck`): the record says the parameters are IGNORED, and a
 *  browser run either confirms that (fields still empty) or refutes it (fields populated) —
 *  but note that a populated field is *still* not flight results. */
export function candidateCases() {
  const FS = `${BA}/travel/book/public/en_gb/flightSearch`;
  const FS_ONDS = `${FS}?${ONDS_ONE_WAY}&${PAX_QS}&ond=1`;
  return [
    { id: 'R1-flightSearch-no-params', label: 'R1 · doc row 1 — flightSearch, no params (the link the app ships)', expect: 'ba.com',
      link: { url: FS, kind: 'search_unverified', label: 'search form' }, formCheck: { prefillExpected: null } },
    { id: 'R2-flightSearch-onds-query', label: 'R2 · doc row 2 — flightSearch + onds/ad/yad/ch/inf/cabin/flex/ond as query', expect: 'ba.com',
      link: { url: FS_ONDS, kind: 'search_unverified', label: 'search form + onds' }, formCheck: { prefillExpected: 'ignored' } },
    { id: 'R3-flightSearch-two-slice', label: 'R3 · doc row 3a — flightSearch + the 2-slice onds payload', expect: 'ba.com',
      link: { url: `${FS}?${ONDS_ROUND_TRIP}&${PAX_QS}&ond=2`, kind: 'search_unverified', label: 'search form + 2 slices' }, formCheck: { prefillExpected: 'ignored' } },
    { id: 'R4-flightSearch-fragment', label: 'R4 · doc row 3b — the same payload as a #fragment', expect: 'ba.com',
      link: { url: `${FS}#${ONDS_ONE_WAY}&${PAX_QS}&ond=1`, kind: 'search_unverified', label: 'search form + fragment' }, formCheck: { prefillExpected: 'ignored' } },
    { id: 'R5-flightSearch-tripType', label: 'R5 · doc row 4 — flightSearch + tripType/from/to/departDate/cabinclass/adult', expect: 'ba.com',
      link: { url: `${FS}?tripType=ONE_WAY&from=CDG&to=LHR&departDate=30/10/2026&cabinclass=C&adult=1`, kind: 'search_unverified', label: 'search form + tripType' }, formCheck: { prefillExpected: 'ignored' } },
    { id: 'R6-processOffer-en_gb', label: 'R6 · doc row 5 — the recorded-BLOCKED processOffer payload (en_gb)', expect: 'ba.com',
      link: { url: `${PROCESS_OFFER_GB}?${ONDS_ONE_WAY}&${PAX_QS}&ond=1`, kind: 'search_unverified', label: 'legacy' } },
    { id: 'R7-processOffer-en_eg', label: 'R7 · doc row 6 — the same payload in the owner’s locale (en_eg)', expect: 'ba.com',
      link: { url: `${PROCESS_OFFER_EG}?${ONDS_ONE_WAY}&${PAX_QS}&ond=1`, kind: 'search_unverified', label: 'legacy en_eg' } },
    { id: 'R8-book-root-with-params', label: 'R8 · doc row 7 — /travel/book/public/en_gb with third-party prefill params (recorded: /processing)', expect: 'ba.com',
      link: { url: `${BA}/travel/book/public/en_gb?origin=CDG&destination=LHR&departureDate=2026-10-30&adults=1&cabin=C`, kind: 'search_unverified', label: 'book root' } },
  ];
}

/**
 * Every case this tool can open. `capture` cases are form-fill flows rather than URLs.
 * Flags mirror the CLI: {capture, candidates, matrix, legacy}.
 */
export function buildCases({ capture = false, candidates = false, matrix = false, legacy = false } = {}) {
  const cases = [
    { id: 'A-ba-one-way-app-output', label: 'A · BA-only one-way (what the app opens today)', expect: 'ba.com',
      link: resolveAirlineLink(ONE_WAY, 'BA', PAX) },
    { id: 'B-ba-round-trip-app-output', label: 'B · BA-only round-trip (what the app opens today)', expect: 'ba.com',
      link: resolveAirlineLink(ROUND_TRIP, 'BA', PAX) },
    { id: 'C-ba-multi-city-app-output', label: 'C · mixed BA/AA 3-slice, BA selected (what the app opens today)', expect: 'ba.com',
      link: resolveAirlineLink(MIXED_MULTI_CITY, 'BA', PAX) },
    { id: 'D-aa-metasearch-6-leg', label: 'D · mixed BA/AA 6-leg, AA selected (metasearch link)', expect: 'aa.com',
      link: { url: AA_META_URL, kind: 'aa_handoff', label: 'Open AA metasearch link' } },
  ];

  if (capture) {
    // Priority 1: capture the prefill URL BA itself produces when a human fills the form.
    cases.push(
      { id: 'F-capture-one-way', label: 'F · fill BA’s form by hand: one-way CDG-LHR 2026-10-30 (flight 1 only, extra rows removed)', expect: 'ba.com',
        capture: { journeys: ondSlices(ONE_WAY), cabin: 'C', pax: PAX, removeExtraRows: true } },
      { id: 'G-capture-round-trip', label: 'G · fill BA’s form by hand: round-trip CDG-LHR / LHR-CDG (one row per slice)', expect: 'ba.com',
        capture: { journeys: ondSlices(ROUND_TRIP), cabin: 'C', pax: PAX, removeExtraRows: true } },
      { id: 'H-capture-multi-city', label: 'H · fill BA’s form by hand: 3 O&D slices (CDG-MSY, MIA-STI, STI-BCN)', expect: 'ba.com',
        capture: { journeys: ondSlices(MIXED_MULTI_CITY), cabin: 'C', pax: PAX, removeExtraRows: true } },
    );
  }

  if (candidates) {
    // The doc's recorded #1–#7 rows, re-measured in a real browser (priority 1+2 checklist).
    cases.push(...candidateCases());
  }

  if (matrix) {
    // Priority 2: the legacy-entry variant matrix, one variant per fresh context.
    cases.push(
      { id: 'M1-processOffer-en_eg', label: 'M1 · processOffer in the owner’s locale (en_eg) instead of en_gb', expect: 'ba.com',
        link: { url: `${PROCESS_OFFER_EG}?${ONDS_ONE_WAY}&${PAX_QS}&ond=1`, kind: 'search_unverified', label: 'legacy en_eg' } },
      { id: 'M2-processOffer-eId', label: 'M2 · processOffer with BA’s low-price-finder entry id (&eId=113021)', expect: 'ba.com',
        link: { url: `${PROCESS_OFFER_GB}?${ONDS_ONE_WAY}&${PAX_QS}&ond=1&eId=113021`, kind: 'search_unverified', label: 'legacy +eId' } },
      { id: 'M3-two-step-session', label: 'M3 · two-step: BA homepage (en_eg) → accept cookies → processOffer in the same tab', expect: 'ba.com',
        warmUp: HOME_EG,
        link: { url: `${PROCESS_OFFER_GB}?${ONDS_ROUND_TRIP}&${PAX_QS}&ond=2`, kind: 'search_unverified', label: 'legacy after homepage' } },
      { id: 'M4-book-root-with-params', label: 'M4 · /travel/book/public/en_gb with third-party prefill params (recorded: lands on /processing)', expect: 'ba.com',
        link: { url: `${BA}/travel/book/public/en_gb?origin=CDG&destination=LHR&departureDate=2026-10-30&adults=1&cabin=C`, kind: 'search_unverified', label: 'book root' } },
      { id: 'M5-book-root-bare', label: 'M5 · /travel/book/public/en_gb with NO params (control for M4)', expect: 'ba.com',
        link: { url: `${BA}/travel/book/public/en_gb`, kind: 'search_unverified', label: 'book root bare' } },
      { id: 'M6-schedulesresults', label: 'M6 · timetable results with route params (claimed to bypass the session lock)', expect: 'ba.com',
        link: { url: `${BA}/travel/schedulesresults/public/en_gb?origin=CDG&destination=LHR&outboundDate=2026-10-30&CabinCode=C&NumberOfAdults=1&TripType=O`, kind: 'search_unverified', label: 'timetable' } },
      { id: 'M7-fx-booking-entry', label: 'M7 · legacy booking entry /travel/fx with route params', expect: 'ba.com',
        link: { url: `${BA}/travel/fx/public/en_gb?eId=120001&depAirport=CDG&arrAirport=LHR&outboundDate=2026-10-30&adults=1`, kind: 'search_unverified', label: 'booking entry' } },
      { id: 'M8-low-price-finder', label: 'M8 · low-price-finder with route + cabin + nights', expect: 'ba.com',
        link: { url: `${BA}/travel/low-price-finder/public/en_gb?origin=CDG&destination=LHR&cabin=C&numNights=7`, kind: 'search_unverified', label: 'fare finder' } },
      { id: 'M9-flightSearch-en_eg', label: 'M9 · the search form the app ships, in the owner’s locale (en_eg)', expect: 'ba.com',
        link: { url: `${BA}/travel/book/public/en_eg/flightSearch`, kind: 'search_unverified', label: 'search form en_eg' } },
    );
  }

  if (legacy) {
    // The recorded-BLOCKED handoff, re-measured: 1-slice, 2-slice and the 3-slice URL the
    // gate refuses to emit. Use --seconds=150 to give the price time to resolve.
    cases.push(
      { id: 'L1-legacy-one-way', label: 'L1 · BLOCKED processOffer, one-way', expect: 'ba.com',
        link: { url: `${PROCESS_OFFER_GB}?${ONDS_ONE_WAY}&${PAX_QS}&ond=1`, kind: 'search_unverified', label: 'legacy' } },
      { id: 'L2-legacy-round-trip', label: 'L2 · BLOCKED processOffer, round-trip', expect: 'ba.com',
        link: { url: `${PROCESS_OFFER_GB}?${ONDS_ROUND_TRIP}&${PAX_QS}&ond=2`, kind: 'search_unverified', label: 'legacy' } },
      { id: 'L3-legacy-multi-city', label: 'L3 · BLOCKED processOffer, 3 O&D slices (gate refuses to emit this)', expect: 'ba.com',
        link: { url: legacyBaMultiCityUrl(), kind: 'search_unverified', label: 'legacy multi-city' } },
    );
  }
  return cases;
}

function legacyBaMultiCityUrl() {
  try { return buildBAProcessOfferUrl(MIXED_MULTI_CITY, PAX); }
  catch { return `${PROCESS_OFFER_GB}?${ONDS_MULTI_CITY}&${PAX_QS}&ond=3`; }
}

function instrument(context, page, log) {
  const tabLog = [];
  // DevTools → Network equivalent: a failed request is recorded as status + method + PATH
  // only. Query strings are dropped whole, so a CDN 403 (or a redirect carrying a session
  // id) can never put a token into a log, report, doc or commit.
  const networkFailures = [];
  const requestFailures = [];
  const MAX = 40;
  const onPage = (p) => {
    p.on('response', (r) => {
      if (r.status() < 400 || networkFailures.length >= MAX) return;
      const entry = failureEntry(r.status(), r.request().method(), r.url());
      if (!networkFailures.some((f) => f.status === entry.status && f.path === entry.path)) networkFailures.push(entry);
    });
    p.on('requestfailed', (r) => {
      if (requestFailures.length >= MAX) return;
      const entry = { path: pathOnly(r.url()), error: String(r.failure()?.errorText || 'unknown').slice(0, 80) };
      if (!requestFailures.some((f) => f.path === entry.path && f.error === entry.error)) requestFailures.push(entry);
    });
  };
  onPage(page);
  context.on('page', (p) => {
    tabLog.push({ opened: true, url: redactUrl(p.url()) });
    p.on('framenavigated', (f) => { if (f === p.mainFrame()) tabLog.push({ navigated: redactUrl(f.url()) }); });
    if (p !== page) onPage(p);
  });
  const redirects = [];
  page.on('response', (r) => {
    const status = r.status();
    if (status >= 300 && status < 400) {
      const location = r.headers()['location'];
      redirects.push({ status, url: redactUrl(r.url()), location: location ? redactUrl(location) : null });
    }
  });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => consoleErrors.push(String(e.message).slice(0, 200)));
  log.redirects = redirects; log.tabLog = tabLog; log.consoleErrors = consoleErrors;
  log.networkFailures = networkFailures; log.requestFailures = requestFailures;
}

async function acceptConsent(page, log) {
  if (log.noConsent) return false;
  const accept = page.getByRole('button', { name: /accept all|accept\b/i }).first();
  if (await accept.isVisible({ timeout: 2000 }).catch(() => false)) {
    await accept.click({ timeout: 3000 }).catch(() => {});
    return true;
  }
  return false;
}

/** What the rendered form actually contains, in DOM order — the evidence behind the claim
 *  "BA's search form ignores URL parameters". Inputs are capped and truncated; no value is
 *  ever a credential (these are the itinerary fields the operator typed). */
async function formState(page, expectedTokens = []) {
  const values = await page.locator('input:visible, select:visible')
    .evaluateAll((els) => els.map((el) => String(el.value ?? '').trim().slice(0, 40)).filter(Boolean).slice(0, 12))
    .catch(() => []);
  const fieldCount = await page.locator('input:visible, select:visible').count().catch(() => 0);
  // Airport codes only — deliberately NOT "2026"/"30/10", because a date box carrying today's
  // date would otherwise be misread as a honoured prefill. The raw values are in the report
  // either way, so a human can see exactly what BA put in its own fields.
  const codes = new Set(expectedTokens.map((t) => String(t).toUpperCase()));
  const fromItinerary = values.filter((v) => {
    const up = v.toUpperCase();
    return [...codes].some((c) => up.includes(c)) || /\b(CDG|LHR|MSY|STI|BCN)\b/.test(up);
  });
  return { visibleFieldCount: fieldCount, filledValues: values, itineraryPrefillFound: fromItinerary.length > 0 };
}

/** Watch a page until it leaves the interstitial or the wait budget runs out.
 *  `stopWhenStable` ends the watch early once the URL and title have not changed for three
 *  consecutive samples — a form that renders instantly should not burn the whole budget. */
async function watch(page, log, waitSeconds, { stopWhenOffPath = null, stopWhenStable = false } = {}) {
  const steps = [];
  let sawProcessing = false;
  const startedAt = Date.now();
  const deadline = startedAt + waitSeconds * 1000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    const url = redactUrl(page.url());
    const title = await page.title().catch(() => '');
    const body = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
    const processing = PROCESSING_TEXT.test(body) || PROCESSING_TEXT.test(title);
    if (processing) sawProcessing = true;
    const last = steps[steps.length - 1];
    if (!last || last.url !== url || last.title !== title) steps.push({ t: steps.length + 1, url, title, processing });
    if (stopWhenOffPath) {
      let onPath = true;
      try { onPath = new RegExp(stopWhenOffPath).test(new URL(page.url()).pathname); } catch {}
      if (!onPath && steps.length > 1) break;
    }
    if (stopWhenStable && steps.length >= 3) {
      const [a, b, c] = steps.slice(-3);
      if (a.url === b.url && b.url === c.url && a.title === b.title && b.title === c.title) break;
    }
  }
  log.steps = steps; log.sawProcessing = sawProcessing;
  log.secondsWaited = (log.secondsWaited || 0) + Math.round((Date.now() - startedAt) / 1000);
  return { sawProcessing };
}

async function finish(page, log, probe, { shotSuffix = '' } = {}) {
  const finalUrl = redactUrl(page.url());
  const finalTitle = await page.title().catch(() => '');
  const finalBody = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  mkdirSync(ARTIFACTS, { recursive: true });
  const shot = `${probe.id}${shotSuffix}.png`;
  await page.screenshot({ path: join(ARTIFACTS, shot), fullPage: false }).catch(() => {});
  return {
    finalUrl, finalTitle,
    outcome: log.outcome || classify(finalUrl, finalTitle, log.sawProcessing),
    finalTextSample: finalBody.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 12),
    screenshot: `artifacts/${shot}`,
  };
}

function report(probe, log, tail) {
  return {
    case: probe.id, description: probe.label, linkKind: probe.link?.kind ?? 'capture-flow',
    openedUrl: probe.link?.url ? redactUrl(probe.link.url) : `${redactUrl(FLIGHT_SEARCH)} (form filled by hand)`,
    openedLabel: probe.link?.label ?? 'capture BA’s own search URL',
    acceptedCookieBanner: !!log.acceptedConsent, sawProcessingInterstitial: !!log.sawProcessing,
    secondsWaited: log.secondsWaited ?? 0,
    networkFailures: log.networkFailures || [], requestFailures: log.requestFailures || [],
    filledFields: log.filledFields, captureOutcome: log.captureOutcome,
    steps: log.steps, redirects: log.redirects, extraTabs: (log.tabLog || []).filter((t) => t.opened),
    consoleErrors: log.consoleErrors, screenshot: `artifacts/${probe.id}.png`, ...tail,
  };
}

/** How many of BA's 3+ form rows to remove so exactly one row remains per O&D slice.
 *  Pure so the capture plan can be unit-tested without a browser. */
export function plannedRemovals(visibleRows, slices) {
  return Math.max(0, Math.min(4, (Number(visibleRows) || 0) - (Number(slices) || 0)));
}

/** Verdict for a candidate row that also snapshot the form: the recorded answer is
 *  "parameters ignored / fields empty", and only the browser may say otherwise. */
export function formVerdict(form, formCheck) {
  if (!form) return null;
  if (formCheck?.prefillExpected === 'ignored')
    return form.itineraryPrefillFound ? 'PREFILL_APPLIED_FORM_POPULATED' : 'PREFILL_IGNORED_FORM_EMPTY';
  return form.itineraryPrefillFound ? 'PREFILL_APPLIED_FORM_POPULATED' : 'FORM_RENDERED_EMPTY';
}

/** Replay a captured URL in a BRAND-NEW context (fresh incognito, no cookies, no storage):
 *  the checklist's follow-up question — does BA's own produced URL still reach results when
 *  it is opened cold? The URL itself is never printed or written: only its parameter names. */
async function runReplay(browser, probe, rawUrl, opts, { suffix = '-replay' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const replay = { freshContext: true, paramNames: paramNames(rawUrl), path: pathOnly(rawUrl) };
  const page = await context.newPage();
  // A separate log: the replay's timeline and failures must be attributable to the replay,
  // not merged into the capture that produced the URL.
  const sub = { noConsent: opts.noConsent, steps: [] };
  instrument(context, page, sub);
  try {
    await page.goto(rawUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    replay.acceptedCookieBanner = await acceptConsent(page, sub);
    const replayProbe = { ...probe, id: `${probe.id}${suffix}` };
    await watch(page, sub, opts.waitSeconds);
    const samePath = pathOnly(page.url()) === replay.path;
    replay.sameUrlPathAfterReplay = samePath;
    replay.finalUrl = redactUrl(page.url());
    replay.finalTitle = await page.title().catch(() => '');
    replay.secondsWaited = sub.secondsWaited ?? 0;
    replay.outcome = classifyReplay(replay.finalUrl, replay.finalTitle, sub.sawProcessing);
    const body = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    replay.finalTextSample = body.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 12);
    replay.steps = sub.steps;
    mkdirSync(ARTIFACTS, { recursive: true });
    replay.screenshot = `artifacts/${replayProbe.id}.png`;
    await page.screenshot({ path: join(ARTIFACTS, `${replayProbe.id}.png`), fullPage: false }).catch(() => {});
  } catch (e) {
    replay.outcome = 'REPLAY_NAVIGATION_FAILED';
    replay.error = String(e.message).slice(0, 160);
  }
  replay.networkFailures = sub.networkFailures || [];
  replay.requestFailures = sub.requestFailures || [];
  await context.close();
  return replay;
}

async function runUrlCase(browser, probe, { waitSeconds, noConsent }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const log = { noConsent };
  const page = await context.newPage();
  instrument(context, page, log);
  if (probe.warmUp) {
    // Two-step session test: land on BA's homepage first and accept cookies like a visitor,
    // then navigate to the handoff in the SAME tab (tests whether the hang is a
    // missing-session problem rather than a broken URL).
    await page.goto(probe.warmUp, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
    log.warmUpUrl = redactUrl(page.url());
  }
  log.acceptedConsent = await acceptConsent(page, log);
  await page.goto(probe.link.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (!log.acceptedConsent) log.acceptedConsent = await acceptConsent(page, log);
  await watch(page, log, waitSeconds, { stopWhenOffPath: /processOffer/, stopWhenStable: !!probe.formCheck });
  // Candidate rows snapshot the rendered form: the doc says the parameters are ignored, so
  // the run must show either an empty form (record confirmed) or populated fields (record
  // refuted — still NOT flight results, and a human has to look at the screenshot).
  const form = probe.formCheck ? await formState(page, itineraryTokensFromUrl(probe.link?.url || '')) : null;
  const tail = await finish(page, log, probe);
  await context.close();
  return report(probe, log, { ...tail, form: form || undefined, formVerdict: form ? formVerdict(form, probe.formCheck) : undefined });
}

/** Fill BA's multi-city form by hand and capture the URL BA itself produces. */
async function runCaptureCase(browser, probe, { waitSeconds, noConsent }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const log = { noConsent, filledFields: [] };
  const page = await context.newPage();
  instrument(context, page, log);
  await page.goto(FLIGHT_SEARCH, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  log.acceptedConsent = await acceptConsent(page, log);

  // BA's ba-sell app has no published selectors, so each field is tried with several
  // strategies and every attempt is recorded. Anything we could not fill is reported, not
  // guessed at: an incomplete form must never be recorded as a captured prefill format.
  const textCandidates = [
    (label) => page.getByLabel(new RegExp(label, 'i')),
    (label) => page.getByPlaceholder(new RegExp(label, 'i')),
    (label) => page.getByRole('combobox', { name: new RegExp(label, 'i') }),
    (label) => page.getByRole('textbox', { name: new RegExp(label, 'i') }),
  ];
  const fillStation = async (row, label, value) => {
    for (const [i, find] of textCandidates.entries()) {
      const field = find(label).nth(row);
      if (!(await field.isVisible({ timeout: 1500 }).catch(() => false))) continue;
      await field.click({ timeout: 2000 }).catch(() => {});
      await field.fill(value, { timeout: 2000 }).catch(() => {});
      await page.keyboard.press('Enter').catch(() => {});
      await page.waitForTimeout(1200);
      // Autocomplete lists usually need an explicit choice before the value sticks.
      const option = page.getByRole('option').first();
      if (await option.isVisible({ timeout: 800 }).catch(() => false)) await option.click({ timeout: 1500 }).catch(() => {});
      log.filledFields.push({ row: row + 1, label, value, strategy: i, ok: true });
      return true;
    }
    log.filledFields.push({ row: row + 1, label, value, ok: false });
    return false;
  };
  const fillDate = async (row, ymd) => {
    const [y, m, d] = ymd.split('-');
    const variants = [`${d}/${m}/${y}`, `${m}/${d}/${y}`, ymd];
    for (const variant of variants) {
      const ok = await fillStation(row, 'date', variant);
      if (ok) { log.filledFields.push({ row: row + 1, label: 'date-format', value: variant }); return true; }
    }
    return false;
  };

  let filled = 0;
  for (let i = 0; i < probe.capture.journeys.length; i++) {
    const j = probe.capture.journeys[i];
    // BA's form opens with 3 rows; ask for more only when the itinerary needs them.
    if (i >= 3) {
      const add = page.getByRole('button', { name: /add another flight/i }).first();
      if (await add.isVisible({ timeout: 1500 }).catch(() => false)) await add.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(800);
    }
    filled += await fillStation(i, 'departing airport|from', j.origin) ? 1 : 0;
    filled += await fillStation(i, 'destination|to', j.dest) ? 1 : 0;
    filled += await fillDate(i, j.ymd) ? 1 : 0;
  }
  // Travel class: BA renders it as radios today, but a select or a segmented button would
  // mount nothing for the radio strategy, so every shape is tried and the result recorded.
  const classTried = [
    ['radio', () => page.getByRole('radio', { name: /business/i })],
    ['combobox', () => page.getByRole('combobox', { name: /class|cabin/i })],
    ['button', () => page.getByRole('button', { name: /business/i })],
  ];
  log.filledFields.push({ label: 'travel-class', value: probe.capture.cabin, ok: false, tried: 'none visible' });
  for (const [strategy, find] of classTried) {
    const el = find().first();
    if (!(await el.isVisible({ timeout: 1500 }).catch(() => false))) continue;
    if (strategy === 'combobox') await el.selectOption({ label: /business/i }).catch(() => el.selectOption('C').catch(() => {}));
    else await el.click({ timeout: 2000 }).catch(() => {});
    log.filledFields[log.filledFields.length - 1] = { label: 'travel-class', value: probe.capture.cabin, ok: true, strategy };
    break;
  }

  // The checklist says "fill Flight 1 … and remove the other rows": leave exactly one row per
  // O&D slice, clicking BA's own "Remove flight" controls from the bottom like a visitor, and
  // record how many rows were actually removed.
  let rowsRemoved = 0;
  if (probe.capture.removeExtraRows) {
    const remove = page.getByRole('button', { name: /remove (this )?flight/i });
    const desired = probe.capture.journeys.length;
    const existing = await remove.count().catch(() => 0);
    for (let i = 0; i < plannedRemovals(existing, desired); i++) {
      const btn = remove.last();
      if (!(await btn.isVisible({ timeout: 1200 }).catch(() => false))) break;
      await btn.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(600);
      rowsRemoved++;
    }
    log.rowsRemoved = rowsRemoved;
    log.rowsBeforeSubmit = await remove.count().catch(() => 0);
  }

  // Read the values back out of the DOM: a click that did not stick must never be recorded
  // as a filled field, because that is exactly how a fake "captured prefill" would be born.
  const afterFill = await formState(page);
  log.formAfterFill = afterFill;

  // Informational only: an autocomplete can show "Paris (CDG)" or clear the box after Enter,
  // so an empty read-back is reported as a warning, never used to fake a failure — or a pass.
  const expectedTokens = probe.capture.journeys.flatMap((j) => [j.origin, j.dest]);
  const blob = (afterFill.filledValues || []).join(' ');
  log.formReadBack = { expected: expectedTokens, readBackFound: expectedTokens.filter((t) => blob.includes(t)) };
  if (log.formReadBack.readBackFound.length < expectedTokens.length)
    log.readBackWarning = 'The form fields did not read back the typed airports; check the screenshot before trusting the capture.';

  const wanted = probe.capture.journeys.length * 3;
  if (filled < wanted) {
    log.captureOutcome = 'CAPTURE_FAILED_FORM_NOT_FILLED';
    log.outcome = 'CAPTURE_FAILED_FORM_NOT_FILLED';
    const tail = await finish(page, log, probe);
    await context.close();
    return report(probe, log, { ...tail, filledOf: `${filled}/${wanted}` });
  }

  const before = page.url();
  const search = page.getByRole('button', { name: /^search$/i }).first();
  if (!(await search.isVisible({ timeout: 3000 }).catch(() => false))) {
    log.captureOutcome = 'CAPTURE_FAILED_NO_SUBMIT_CONTROL';
    log.outcome = 'CAPTURE_FAILED_NO_SUBMIT_CONTROL';
    const tail = await finish(page, log, probe);
    await context.close();
    return report(probe, log, { ...tail, filledOf: `${filled}/${wanted}` });
  }
  await Promise.all([
    page.waitForNavigation({ timeout: 30000 }).catch(() => {}),
    search.click({ timeout: 5000 }).catch(() => {}),
  ]);
  await watch(page, log, waitSeconds, { stopWhenOffPath: 'flightSearch' });
  const captured = page.url();
  const moved = captured !== before;
  log.captureOutcome = moved ? 'CAPTURED_BA_SEARCH_URL' : 'CAPTURE_SUBMIT_NO_NAVIGATION';
  if (moved) log.outcome = classify(captured, await page.title().catch(() => ''), log.sawProcessing);
  else log.outcome = 'CAPTURE_SUBMIT_NO_NAVIGATION';
  const tail = await finish(page, log, probe);
  // The URL BA itself produced: values are never printed or written, only the parameter
  // NAMES (the recordable "format") and whether the page carried flight results.
  const capture = {
    ...tail, filledOf: `${filled}/${wanted}`, urlBeforeSubmit: redactUrl(before),
    rowsRemoved: log.rowsRemoved ?? 0, formAfterFill: log.formAfterFill,
    formReadBack: log.formReadBack, readBackWarning: log.readBackWarning,
    capturedParamNames: moved ? paramNames(captured) : [],
    capturedPath: moved ? pathOnly(captured) : null,
  };
  if (moved && opts.replay) capture.replay = await runReplay(browser, probe, captured, opts);
  await context.close();
  return report(probe, log, capture);
}

export function printReport(r) {
  console.log(`\n### ${r.case} — ${r.description}\n    opening: ${r.openedUrl}`);
  console.log(`    outcome: ${r.outcome}${r.captureOutcome && r.captureOutcome !== r.outcome ? ` (${r.captureOutcome})` : ''}`);
  console.log(`    final  : ${r.finalUrl}`);
  console.log(`    title  : ${r.finalTitle}`);
  console.log(`    waited : ${r.secondsWaited ?? 0}s`);
  if (r.formVerdict) console.log(`    form   : ${r.formVerdict}${r.form ? ` (${r.form.filledValues?.length ?? 0} field(s) non-empty of ${r.form.visibleFieldCount} visible)` : ''}`);
  for (const s of r.steps || []) console.log(`      +${s.t}s ${s.url} :: ${s.title}`);
  for (const f of r.filledFields || []) console.log(`      fill: row ${f.row ?? '-'} ${f.label}=${f.value}${f.strategy !== undefined ? ` [${f.strategy}]` : ''} ${f.ok === false ? 'FAILED' : ''}`);
  for (const t of r.extraTabs || []) console.log(`      extra tab: ${t.url}${t.navigated ? ` -> ${t.navigated}` : ''}`);
  for (const e of r.networkFailures || []) console.log(`      net: ${e.status} ${e.method} ${e.path}`);
  for (const e of r.requestFailures || []) console.log(`      net: FAILED ${e.path} (${e.error})`);
  if (r.capturedParamNames?.length) console.log(`    captured params: ${r.capturedParamNames.join(', ')} (values redacted)`);
  if (r.readBackWarning) console.log(`    WARNING: ${r.readBackWarning}`);
  if (r.replay) {
    console.log(`    REPLAY (fresh context, no cookies) → ${r.replay.outcome} after ${r.replay.secondsWaited ?? 0}s`);
    console.log(`      replay final: ${r.replay.finalUrl} :: ${r.replay.finalTitle}`);
    if (r.replay.sameUrlPathAfterReplay === false) console.log('      replay landed on a DIFFERENT path than the captured URL');
    for (const s of r.replay.steps || []) console.log(`        +${s.t}s ${s.url} :: ${s.title}`);
    for (const e of r.replay.networkFailures || []) console.log(`        net: ${e.status} ${e.method} ${e.path}`);
    for (const e of r.replay.requestFailures || []) console.log(`        net: FAILED ${e.path} (${e.error})`);
  }
  if (r.error) console.log(`    error: ${r.error}`);
}

const mdCell = (v) => String(v ?? '—').replace(/\|/g, '\\|');
/** Paste-ready evidence table: exactly the columns the checklist asks for (final page,
 *  seconds waited, network failures). Values are already redacted when they get here. */
export function markdownTable(rows) {
  const head = '| # | URL opened (redacted) | Landing observed | Seconds waited | Network failures (status · path only) |\n| --- | --- | --- | --- | --- |';
  const body = rows.map((r) => {
    const net = [...(r.networkFailures || []).map((e) => `${e.status} ${e.path}`),
      ...(r.requestFailures || []).map((e) => `FAILED ${e.path} (${e.error})`)];
    const landing = r.replay ? `${r.outcome} → replay in fresh context: ${r.replay.outcome}` : r.outcome;
    return `| ${mdCell(r.id)} | \`${mdCell(r.url)}\` | ${mdCell(r.landing ?? landing)} | ${mdCell(r.secondsWaited)} | ${mdCell(net.length ? net.join('; ') : 'none recorded')} |`;
  });
  return `${head}\n${body.join('\n')}`;
}

/** Rows for the table, from a finished run (reports) or from the case list (dry run). */
export function evidenceRows(cases, reports) {
  if (!reports) return cases.map((c) => ({
    id: c.id, url: c.capture ? `${redactUrl(FLIGHT_SEARCH)} (filled by hand)` : redactUrl(c.link?.url || ''),
    landing: 'not run', secondsWaited: null,
  }));
  return reports.map((r) => {
    // A capture's own URL is the interesting one: show it as path + parameter names, every
    // value `<redacted>` — the recordable format, never a live session URL.
    const captured = r.capturedParamNames?.length
      ? `${r.capturedPath}?${r.capturedParamNames.map((k) => `${k}=<redacted>`).join('&')}`
      : null;
    return {
      id: r.case, url: captured ? `capture produced ${captured}` : r.openedUrl,
      landing: r.replay ? `${r.outcome} → replay in fresh context: ${r.replay.outcome}` : r.outcome,
      secondsWaited: r.secondsWaited,
      networkFailures: r.networkFailures, requestFailures: r.requestFailures, replay: r.replay,
    };
  });
}

export function parseArgv(argv) {
  const flag = (name) => argv.includes(`--${name}`);
  const value = (name, fallback) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  // A typo in --seconds must not silently turn every wait into 0s (which would report every
  // interstitial as "still processing" after 1 sample, or worse, as a landing).
  const seconds = Number(value('seconds', 75));
  return {
    waitSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 900) : 75,
    headful: flag('headful'),
    capture: flag('capture'),
    candidates: flag('candidates'),
    matrix: flag('matrix'),
    legacy: flag('legacy') || flag('legacy-multi-city'),
    noConsent: flag('no-consent'),
    // Two-pass runs (a fast pass over the form pages, a slow pass over the interstitials)
    // must not overwrite each other's report.
    report: String(value('report', 'ba-live-probe-report.json')).replace(/[^A-Za-z0-9._-]/g, '') || 'ba-live-probe-report.json',
    // Replay only has something to replay when a capture produced a URL — or when the
    // operator pipes one in via --replay-stdin (never echoed, never written to disk).
    replay: flag('replay') || flag('replay-stdin'),
    replayStdin: flag('replay-stdin'),
    markdown: flag('markdown') || flag('candidates') || flag('replay-stdin'),
    dryRun: flag('dry-run') || flag('list-cases'),
  };
}

/** One URL for --replay-stdin, read from stdin. Validated, never printed, never persisted. */
async function readStdinUrl() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim().split(/\s+/)[0] || '';
  if (!/^https?:\/\//i.test(raw)) {
    console.error('--replay-stdin expects one http(s) URL on stdin (e.g. pbpaste | node tools/ba-live-probe.mjs --replay-stdin).');
    return null;
  }
  return raw;
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgv(argv);
  const cases = buildCases(opts);
  if (opts.dryRun) {
    // No browser: prints exactly what a real run would open, already redacted, so the case
    // list and the redaction rules can be reviewed (and unit-tested) anywhere.
    for (const probe of cases) {
      const url = probe.capture ? `${redactUrl(FLIGHT_SEARCH)} (fill by hand: ${probe.capture.journeys.map((j) => `${j.origin}-${j.dest}_${j.ymd}`).join(', ')})` : redactUrl(probe.link.url);
      console.log(`${probe.id}\t${url}${probe.formCheck ? `\t[form check: prefill expected ${probe.formCheck.prefillExpected || 'n/a'}]` : ''}`);
    }
    console.log(`\n${cases.length} case(s); no browser launched, no cookies, no unredacted URL.`);
    if (opts.markdown) console.log(`\n${markdownTable(evidenceRows(cases))}`);
    return;
  }
  if (opts.replayStdin && !opts.capture) {
    // Stand-alone replay of a URL the operator captured elsewhere (their own address bar).
    const raw = await readStdinUrl();
    if (!raw) { process.exit(2); }
    const chromium = await importPlaywright();
    if (!chromium) process.exit(2);
    const browser = await launchBrowser(chromium, opts);
    const probe = { id: 'stdin-replay', label: 'replay of a URL captured outside this tool', expect: 'ba.com' };
    const replay = await runReplay(browser, probe, raw, opts);
    await browser.close();
    console.log(`\n### ${probe.id}: ${replay.outcome} after ${replay.secondsWaited ?? 0}s`);
    console.log(`    path (values stripped): ${replay.path}`);
    console.log(`    params: ${replay.paramNames.join(', ') || 'none'} (values redacted)`);
    console.log(`    final : ${replay.finalUrl} :: ${replay.finalTitle}`);
    for (const s of replay.steps || []) console.log(`      +${s.t}s ${s.url} :: ${s.title}`);
    for (const e of replay.networkFailures || []) console.log(`      net: ${e.status} ${e.method} ${e.path}`);
    for (const e of replay.requestFailures || []) console.log(`      net: FAILED ${e.path} (${e.error})`);
    writeReport(opts, [{ case: probe.id, description: probe.label, openedUrl: replay.path, outcome: replay.outcome, ...replay }]);
    console.log('\nNo cookies, storage dumps or unredacted URLs were written.');
    return;
  }
  const chromium = await importPlaywright();
  if (!chromium) process.exit(2);
  const browser = await launchBrowser(chromium, opts);

  const reports = [];
  for (const probe of cases) {
    if (!probe.capture && !probe.link?.url) { console.log(`\n### ${probe.id}: no link emitted (${probe.link?.kind}) — nothing to open.`); continue; }
    const r = probe.capture
      ? await runCaptureCase(browser, probe, opts)
      : await runUrlCase(browser, probe, opts);
    reports.push(r);
    printReport(r);
  }
  await browser.close();
  if (opts.markdown) console.log(`\n${markdownTable(evidenceRows(cases, reports))}\n`);
  writeReport(opts, reports);
  console.log('\nNo cookies, storage dumps or unredacted URLs were written.');
}

function writeReport(opts, reports) {
  mkdirSync(ARTIFACTS, { recursive: true });
  const out = join(ARTIFACTS, opts.report || 'ba-live-probe-report.json');
  writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), waitSeconds: opts.waitSeconds, reports }, null, 2));
  console.log(`\nJSON report: ${out}\nScreenshots: artifacts/*.png`);
  return out;
}

async function importPlaywright() {
  try { return (await import('playwright')).chromium; }
  catch {
    console.error('Playwright is not installed. Run:\n  npm install --no-save --no-package-lock playwright\n  npx playwright install chromium');
    return null;
  }
}

/** Prefer the operator's installed Chrome, fall back to Playwright's bundled Chromium. */
async function launchBrowser(chromium, opts) {
  const launch = { headless: !opts.headful, args: ['--no-sandbox'] };
  try { return await chromium.launch({ ...launch, channel: 'chrome' }); }
  catch { return await chromium.launch(launch); }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) await main();
