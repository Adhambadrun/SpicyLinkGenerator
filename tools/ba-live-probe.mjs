#!/usr/bin/env node
// Real-browser probe for the airline handoffs described in AA_ACCEPTANCE.md.
//
// It opens the handoff URLs themselves (BA's historical offer-search output and the AA
// metasearch link) in a real desktop browser so the JavaScript on ba.com/aa.com runs.
// BA's button is gone from the app since the handoff was recorded BLOCKED (AA_ACCEPTANCE.md);
// these cases are kept so any future BA change can be re-measured with one command.
// This is the missing half of the HTTP-only probes: those only ever saw the
// "Give us a moment, we're calculating your price" interstitial, which is byte-identical
// for valid, multi-city and even invalid input and therefore proves nothing.
//
// The tool is deliberately read-only and privacy-safe:
//   * no login, no account, no payment, no passenger data is entered anywhere,
//   * every browser context is fresh (no cookies reused between cases),
//   * no cookie jar, storage dump or request header is ever written to disk,
//   * URLs are printed redacted: only origin, path and the documented search parameters
//     (onds/ad/yad/ch/inf/cabin/flex/ond) survive; every other query value becomes
//     "<redacted>" so transient redirect ids (`search-journey-id`, `cid`, …) can never be
//     copied into logs, tests or documentation.
//
// Usage (any machine with a real Chrome/Chromium and internet access):
//   npm install --no-save --no-package-lock playwright
//   npx playwright install chromium
//   node tools/ba-live-probe.mjs                  # headless, all cases
//   node tools/ba-live-probe.mjs --headful        # visible browser window
//   node tools/ba-live-probe.mjs --seconds=120    # wait longer for the price to resolve
//   node tools/ba-live-probe.mjs --legacy-multi-city  # also re-test the 3-slice URL the
//                                                 # gate now refuses to emit
//
// Screenshots are written to artifacts/ (gitignored) and the JSON report is printed to
// stdout. Paste the summary block into AA_ACCEPTANCE.md, redacted as printed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBAProcessOfferUrl, resolveAirlineLink } from '../airline-links.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = join(ROOT, 'artifacts');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const WAIT_SECONDS = Number(value('seconds', 75));
const HEADFUL = flag('headful');
const LEGACY_MULTI_CITY = flag('legacy-multi-city');
const NO_CONSENT = flag('no-consent');

const PAX = { adults: 1, seniors: 0, youths: 0, children: 0, infantsInSeat: 0, infantsInLap: 0 };
const leg = (carrier, num, cls, origin, dest, ymd, depH, depM, arrH, arrM) =>
  ({ carrier, num, cls, origin, dest, ymd, depH, depM, arrH, arrM });

// A · BA-only one-way:  `1 BA 323J 30OCT F CDGLHR SS1   705A  735A /DCBA /E`
const ONE_WAY = [leg('BA', '323', 'J', 'CDG', 'LHR', '2026-10-30', 7, 5, 7, 35)];
// B · BA-only round-trip: adds `2 BA 324J 06NOV F LHRCDG SS1   840A 1105A /DCBA /E`
const ROUND_TRIP = [...ONE_WAY, leg('BA', '324', 'J', 'LHR', 'CDG', '2026-11-06', 8, 40, 11, 5)];
// C · The 6-leg mixed BA/AA itinerary from the repo docs: 3 O&D slices after collapsing.
const MIXED_MULTI_CITY = [
  leg('BA', '323', 'J', 'CDG', 'LHR', '2026-10-30', 7, 5, 7, 35),
  leg('AA', '731', 'I', 'LHR', 'CLT', '2026-10-30', 9, 55, 14, 50),
  leg('AA', '2615', 'I', 'CLT', 'MSY', '2026-10-30', 16, 53, 18, 0),
  leg('AA', '1917', 'I', 'MIA', 'STI', '2026-10-31', 12, 5, 14, 15),
  leg('AA', '1770', 'O', 'STI', 'MIA', '2027-01-21', 7, 20, 8, 46),
  leg('AA', '112', 'O', 'MIA', 'BCN', '2027-01-21', 16, 15, 7, 5),
];
// The pre-#21 multi-city URL the gate now refuses to emit (AA_ACCEPTANCE.md 2026-10-12 probes).
const LEGACY_MULTI_CITY_URL =
  'https://www.britishairways.com/travel/book/public/en_gb/processOffer' +
  '?onds=CDG-MSY_2026-10-30,MIA-STI_2026-10-31,STI-BCN_2027-01-21' +
  '&ad=1&yad=0&ch=0&inf=0&cabin=C&flex=LOWEST&ond=3';

const SAFE_PARAMS = new Set(['onds', 'ad', 'yad', 'ch', 'inf', 'cabin', 'flex', 'ond']);
/** Keep origin + path; keep only documented search params; drop every transient value. */
export function redactUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return String(raw).slice(0, 120); }
  const kept = [];
  for (const [k, v] of u.searchParams) kept.push(SAFE_PARAMS.has(k) ? `${k}=${v}` : `${k}=<redacted>`);
  return `${u.origin}${u.pathname}${kept.length ? `?${kept.join('&')}` : ''}`;
}

function legacyBaMultiCityUrl() {
  try { return buildBAProcessOfferUrl(MIXED_MULTI_CITY, PAX); } catch { return LEGACY_MULTI_CITY_URL; }
}

// The app emits AA's historical metasearch URL for the whole itinerary, mixed carriers included.
// Rebuilt here the same way app.html's aaMetaUrl does, with the epochs pinned in
// test/app-wiring.test.mjs so the probe opens the identical payload.
const AA_LEGS = MIXED_MULTI_CITY.map((s, i) => {
  const epoch = [1793340300000, 1793354100000, 1793397180000, 1793466300000, 1800516000000, 1800566100000][i];
  return { ...s, epoch };
});
const AA_META_URL = 'https://www.aa.com/goto/metasearch?ITEN=' + encodeURIComponent([
  'DIRECT', '0', 'US', 'multi', '4', 'A1S0C0I0Y0L0', '0', AA_LEGS[0].origin, '0', AA_LEGS[0].dest,
  '0', '0', '0', '0', '0', '0', '0', '0.00', '1',
  AA_LEGS.map((s) => `#${s.origin}|${s.dest}|0|0|${s.epoch}`).join(''),
  AA_LEGS.map((s, i) => `#${s.carrier}|${s.num}|${s.cls}|${s.origin}|${s.dest}|${s.epoch}|${i}`).join(''),
].join(','));

const baOneWay = resolveAirlineLink(ONE_WAY, 'BA', PAX);
const baRoundTrip = resolveAirlineLink(ROUND_TRIP, 'BA', PAX);
const baMultiCity = resolveAirlineLink(MIXED_MULTI_CITY, 'BA', PAX);

const CASES = [
  { id: 'A-ba-one-way', label: 'A · BA-only one-way (button output)', link: baOneWay, expect: 'ba.com' },
  { id: 'B-ba-round-trip', label: 'B · BA-only round-trip (button output)', link: baRoundTrip, expect: 'ba.com' },
  { id: 'C-ba-multi-city-app-output', label: 'C · mixed BA/AA 3-slice, BA selected (app output today)', link: baMultiCity, expect: 'ba.com' },
  { id: 'D-aa-metasearch-6-leg', label: 'D · mixed BA/AA 6-leg, AA selected (metasearch link)', link: { url: AA_META_URL, kind: 'aa_handoff', label: 'Open AA metasearch link' }, expect: 'aa.com' },
];
if (LEGACY_MULTI_CITY) {
  CASES.push({ id: 'E-ba-legacy-multi-city-url', label: 'E · legacy 3-slice processOffer URL (gate refused to emit this)', link: { url: legacyBaMultiCityUrl(), kind: 'search_unverified', label: 'legacy' }, expect: 'ba.com' });
}

const PROCESSING_TEXT = /calculating your price|processing flight selection/i;
// Deliberately loose: any title that is NOT the processing page is only reported as
// "possible results" for a human to confirm on the screenshot — never as a pass.
const RESULTS_HINT = /choose flights|flight results|select your flight|fare options/i;

function classify(finalUrl, finalTitle, sawProcessing) {
  const path = (() => { try { return new URL(finalUrl).pathname; } catch { return ''; } })();
  if (path.includes('/travel/home/public/')) return 'REDIRECTED_REGIONAL_HOMEPAGE';
  if (/processOffer/.test(path)) return sawProcessing ? 'STILL_PROCESSING_INTERSTITIAL' : 'UNKNOWN_PROCESS_OFFER_STATE';
  if (/\/error|access denied|unavailable/i.test(finalTitle)) return 'ERROR_PAGE';
  if (RESULTS_HINT.test(finalTitle)) return 'LEFT_INTERSTITIAL_FLIGHT_RESULTS_POSSIBLE';
  return 'LEFT_INTERSTITIAL_UNCLASSIFIED';
}

async function runCase(browser, probe) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const tabLog = [];
  const redirects = [];
  context.on('page', (p) => {
    tabLog.push({ opened: true, url: redactUrl(p.url()) });
    p.on('framenavigated', (f) => { if (f === p.mainFrame()) tabLog.push({ navigated: redactUrl(f.url()) }); });
    p.on('popup', () => {});
  });

  const page = await context.newPage();
  page.on('response', (r) => {
    const status = r.status();
    if (status >= 300 && status < 400) redirects.push({ status, url: redactUrl(r.url()), location: r.headers()['location'] ? redactUrl(r.headers()['location']) : null });
  });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => consoleErrors.push(String(e.message).slice(0, 200)));

  await page.goto(probe.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const steps = [];
  let sawProcessing = false;
  let acceptedConsent = false;
  const deadline = Date.now() + WAIT_SECONDS * 1000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    const url = redactUrl(page.url());
    const title = await page.title().catch(() => '');
    const body = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
    if (PROCESSING_TEXT.test(body) || PROCESSING_TEXT.test(title)) sawProcessing = true;
    if (!acceptedConsent && !NO_CONSENT) {
      const accept = page.getByRole('button', { name: /accept all/i }).first();
      if (await accept.isVisible().catch(() => false)) { await accept.click().catch(() => {}); acceptedConsent = true; }
    }
    const last = steps[steps.length - 1];
    if (!last || last.url !== url || last.title !== title) steps.push({ t: steps.length + 1, url, title, processing: PROCESSING_TEXT.test(body) || PROCESSING_TEXT.test(title) });
    let onProcessingPath = true;
    try { onProcessingPath = /processOffer/.test(new URL(page.url()).pathname); } catch {}
    if (!onProcessingPath && steps.length > 1) break;
  }
  const finalUrl = redactUrl(page.url());
  const finalTitle = await page.title().catch(() => '');
  const finalBody = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  mkdirSync(ARTIFACTS, { recursive: true });
  const shot = join(ARTIFACTS, `${probe.id}.png`);
  await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
  const outcome = classify(finalUrl, finalTitle, sawProcessing);
  const report = {
    case: probe.id,
    description: probe.label,
    linkKind: probe.link.kind,
    openedUrl: redactUrl(probe.url),
    openedLabel: probe.link.label,
    acceptedCookieBanner: acceptedConsent,
    sawProcessingInterstitial: sawProcessing,
    steps,
    redirects,
    extraTabs: tabLog.filter((t) => t.opened),
    consoleErrors,
    finalUrl,
    finalTitle,
    outcome,
    finalTextSample: finalBody.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 12),
    screenshot: `artifacts/${probe.id}.png`,
  };
  await context.close();
  return report;
}

async function main() {
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { console.error('Playwright is not installed. Run:\n  npm install --no-save --no-package-lock playwright\n  npx playwright install chromium'); process.exit(2); }
  const launch = { headless: !HEADFUL, args: ['--no-sandbox'] };
  let browser;
  try { browser = await chromium.launch({ ...launch, channel: 'chrome' }); }
  catch { browser = await chromium.launch(launch); }

  const reports = [];
  for (const probe of CASES) {
    if (!probe.link.url) { console.log(`\n### ${probe.id}: no link emitted (${probe.link.kind}) — nothing to open.`); continue; }
    console.log(`\n### ${probe.id} — ${probe.label}\n    opening: ${redactUrl(probe.link.url)}`);
    const report = await runCase(browser, { ...probe, url: probe.link.url });
    reports.push(report);
    console.log(`    outcome: ${report.outcome}`);
    console.log(`    final  : ${report.finalUrl}`);
    console.log(`    title  : ${report.finalTitle}`);
    for (const s of report.steps) console.log(`      +${s.t}s ${s.url} :: ${s.title}`);
    for (const t of report.extraTabs) console.log(`      extra tab: ${t.url}${t.navigated ? ` -> ${t.navigated}` : ''}`);
  }
  await browser.close();
  mkdirSync(ARTIFACTS, { recursive: true });
  const out = join(ARTIFACTS, 'ba-live-probe-report.json');
  writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), waitSeconds: WAIT_SECONDS, reports }, null, 2));
  console.log(`\nJSON report: ${out}\nScreenshots: artifacts/*.png\nNo cookies, storage dumps or unredacted URLs were written.`);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) await main();
