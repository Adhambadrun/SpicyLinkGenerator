import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCases, candidateCases, classify, classifyReplay, evidenceRows, failureEntry, formVerdict,
  itineraryTokensFromUrl, main, markdownTable, paramNames, parseArgv, pathOnly, plannedRemovals, printReport,
  redactUrl, PAX, MIXED_MULTI_CITY } from '../tools/ba-live-probe.mjs';
import { resolveAirlineLink } from '../airline-links.js';

const BA_SEARCH_FORM='https://www.britishairways.com/travel/book/public/en_gb/flightSearch';

test('redactUrl keeps origin, path and documented search params and destroys everything else', () => {
  assert.equal(
    redactUrl('https://www.britishairways.com/travel/book/public/en_gb/processOffer?onds=CDG-LHR_2026-10-30&ad=1&cabin=C&flex=LOWEST&ond=1'),
    'https://www.britishairways.com/travel/book/public/en_gb/processOffer?onds=CDG-LHR_2026-10-30&ad=1&cabin=C&flex=LOWEST&ond=1');
  // Transient session/redirect ids can never reach a log, test, doc or commit.
  const redacted=redactUrl('https://www.britishairways.com/travel/book/public/en_gb/processOffer?onds=CDG-LHR_2026-10-30&search-journey-id=abc123&cid=999&token=xyz');
  assert.match(redacted,/search-journey-id=<redacted>/);
  assert.match(redacted,/cid=<redacted>/);
  assert.match(redacted,/token=<redacted>/);
  assert.doesNotMatch(redacted,/abc123|999|xyz/);
  // AA's payload stays opaque, and a captured fragment is never printed verbatim.
  assert.equal(redactUrl('https://www.aa.com/goto/metasearch?ITEN=DIRECT,0,US'),'https://www.aa.com/goto/metasearch?ITEN=<redacted>');
  assert.equal(redactUrl('https://www.britishairways.com/travel/book/public/en_gb/flightSearch#onds=SECRET'),'https://www.britishairways.com/travel/book/public/en_gb/flightSearch#<redacted>');
  assert.equal(redactUrl('not a url'),'not a url');
});

test('classify names the interstitials the BA handoff is known to produce', () => {
  assert.equal(classify('https://www.britishairways.com/processing','British Airways - Processing Payment',true),'PROCESSING_PAYMENT_INTERSTITIAL');
  assert.equal(classify('https://www.britishairways.com/travel/book/public/en_gb/processOffer?ond=1','British Airways - Processing Flight Selection',true),'STILL_PROCESSING_INTERSTITIAL');
  assert.equal(classify('https://www.britishairways.com/travel/book/public/en_gb/processOffer?ond=1','British Airways - Processing Flight Selection',false),'UNKNOWN_PROCESS_OFFER_STATE');
  assert.equal(classify('https://www.britishairways.com/travel/home/public/en_eg/','British Airways',false),'REDIRECTED_REGIONAL_HOMEPAGE');
  assert.equal(classify('https://www.britishairways.com/travel/error','Access denied',false),'ERROR_PAGE');
  assert.equal(classify('https://www.britishairways.com/travel/book/public/en_gb/flightSearch','British Airways - Choose flights',false),'LEFT_INTERSTITIAL_FLIGHT_RESULTS_POSSIBLE');
  assert.equal(classify('https://www.britishairways.com/travel/book/public/en_gb/flightSearch','British Airways - Multi-city Flight Search',false),'LEFT_INTERSTITIAL_UNCLASSIFIED');
});

test('network failures and captured URLs are recorded as status + path + parameter NAMES only', () => {
  // A CDN 403 must never be able to carry a query string (it can hold a token) into a report.
  assert.deepEqual(
    failureEntry(403, 'get', 'https://www.britishairways.com/content/en/gb/x?search-journey-id=abc123&cid=99'),
    { status: 403, method: 'GET', path: 'https://www.britishairways.com/content/en/gb/x' });
  assert.equal(pathOnly('https://www.britishairways.com/travel/book/public/en_gb/processOffer?a=1&token=zzz'),
    'https://www.britishairways.com/travel/book/public/en_gb/processOffer');
  assert.equal(pathOnly('not a url?token=zzz'), 'not a url');
  // The recordable "format" of a captured BA URL: names only, sorted, deduped.
  assert.deepEqual(paramNames('https://www.britishairways.com/travel/book/public/en_gb/processOffer?ond=1&search-journey-id=secret&ond=2&cid=x&cabin=C'),
    ['cabin', 'cid', 'ond', 'search-journey-id']);
  assert.deepEqual(paramNames('nonsense'), []);
  // A replay verdict can never be mistaken for the original capture's landing class.
  assert.equal(classifyReplay('https://www.britishairways.com/travel/book/public/en_gb/flightSearch','British Airways - Choose flights',false),'REPLAY_FLIGHT_RESULTS_POSSIBLE');
  assert.equal(classifyReplay('https://www.britishairways.com/travel/book/public/en_gb/processOffer?ond=1','British Airways - Processing Flight Selection',true),'REPLAY_PROCESSING_INTERSTITIAL');
  assert.equal(classifyReplay('https://www.britishairways.com/processing','Payment is in progress',false),'REPLAY_PAYMENT_INTERSTITIAL');
  assert.equal(classifyReplay('https://www.britishairways.com/travel/home/public/en_eg/','British Airways',false),'REPLAY_REDIRECTED_HOMEPAGE');
  assert.equal(classifyReplay('https://www.britishairways.com/travel/error','Access denied',false),'REPLAY_ERROR_PAGE');
  // Whatever a replay lands on, it is never reported as the capture's own outcome.
  assert.equal(classifyReplay('https://www.britishairways.com/travel/x','x',false),'REPLAY_UNCLASSIFIED');
});

test('the capture plan leaves one form row per O&D slice and nothing is reported as filled on a guess', () => {
  // BA opens the multi-city form with 3 rows; a one-way needs 1, a round-trip 2, 3 slices 3.
  assert.equal(plannedRemovals(3, 1), 2);
  assert.equal(plannedRemovals(3, 2), 1);
  assert.equal(plannedRemovals(3, 3), 0);
  assert.equal(plannedRemovals(1, 3), 0);   // never more rows removed than exist
  assert.equal(plannedRemovals(0, 0), 0);
  // Form verdicts: the recorded claim is "parameters ignored, fields empty" — only a real
  // browser may contradict it, and a populated field is still not flight results.
  assert.equal(formVerdict({ visibleFieldCount: 9, filledValues: [], itineraryPrefillFound: false }, { prefillExpected: 'ignored' }), 'PREFILL_IGNORED_FORM_EMPTY');
  assert.equal(formVerdict({ visibleFieldCount: 9, filledValues: ['CDG'], itineraryPrefillFound: true }, { prefillExpected: 'ignored' }), 'PREFILL_APPLIED_FORM_POPULATED');
  assert.equal(formVerdict({ visibleFieldCount: 9, filledValues: ['CDG'], itineraryPrefillFound: true }, { prefillExpected: null }), 'PREFILL_APPLIED_FORM_POPULATED');
  assert.equal(formVerdict({ visibleFieldCount: 9, filledValues: [], itineraryPrefillFound: false }, { prefillExpected: null }), 'FORM_RENDERED_EMPTY');
  assert.equal(formVerdict(null, { prefillExpected: 'ignored' }), null);
});

test('form-prefill detection reads airport codes from the onds payload only, query or fragment', () => {
  // tripType=ONE_WAY must not read as an airport code — only the `onds` payload counts.
  assert.deepEqual(itineraryTokensFromUrl('https://www.britishairways.com/x/flightSearch?tripType=ONE_WAY&from=CDG&to=LHR&cabinclass=C'),[]);
  assert.deepEqual(itineraryTokensFromUrl('https://www.britishairways.com/x/flightSearch?onds=CDG-LHR_2026-10-30&ond=1'),['CDG','LHR']);
  assert.deepEqual(itineraryTokensFromUrl('https://www.britishairways.com/x/flightSearch#onds=CDG-LHR_2026-10-30,LHR-CDG_2026-11-06&ond=2'),['CDG','LHR']); // deduped
  assert.deepEqual(itineraryTokensFromUrl('https://www.britishairways.com/x/flightSearch'),[]);
  // Every flightSearch candidate row is checked against its own itinerary, nothing else.
  const checked=candidateCases().filter(c=>c.formCheck).map(c=>[c.id,itineraryTokensFromUrl(c.link.url)]);
  assert.deepEqual(checked,[
    ['R1-flightSearch-no-params',[]],
    ['R2-flightSearch-onds-query',['CDG','LHR']],
    ['R3-flightSearch-two-slice',['CDG','LHR']],
    ['R4-flightSearch-fragment',['CDG','LHR']],
    ['R5-flightSearch-tripType',[]],
  ]);
});

test('the evidence table is paste-ready and carries no unredacted value', () => {
  const rows = evidenceRows(candidateCases());
  const table = markdownTable(rows);
  assert.match(table, /^\| # \| URL opened \(redacted\) \| Landing observed \| Seconds waited \| Network failures \(status · path only\) \|$/m);
  assert.match(table, /\| R6-processOffer-en_gb \|/);
  assert.match(table, /not run/);
  // The fragment payload is never printed verbatim, even in the doc table.
  assert.match(table, /flightSearch#<redacted>/);
  assert.doesNotMatch(table, /onds=CDG-LHR_2026-10-30&ad=1&yad=0&ch=0&inf=0&cabin=C&flex=LOWEST&ond=1#/);
  // A finished run fills the same columns, failures included, still redacted.
  const run = markdownTable(evidenceRows([], [{
    case: 'R2-flightSearch-onds-query', openedUrl: 'https://www.britishairways.com/travel/book/public/en_gb/flightSearch?onds=CDG-LHR_2026-10-30',
    outcome: 'PREFILL_IGNORED_FORM_EMPTY', secondsWaited: 6,
    networkFailures: [{ status: 429, method: 'GET', path: 'https://www.britishairways.com/content/en/gb/airport' }],
    requestFailures: [{ path: 'https://www.britishairways.com/cdn/app.js', error: 'net::ERR_FAILED' }],
  }]));
  assert.match(run, /PREFILL_IGNORED_FORM_EMPTY/);
  assert.match(run, /\| 6 \|/);
  assert.match(run, /429 https:\/\/www\.britishairways\.com\/content\/en\/gb\/airport; FAILED https:\/\/www\.britishairways\.com\/cdn\/app\.js \(net::ERR_FAILED\)/);
});

test('the seven recorded candidate rows are re-measurable in a browser, fragment and all', () => {
  const cases = candidateCases();
  assert.deepEqual(cases.map((c) => c.id), ['R1-flightSearch-no-params', 'R2-flightSearch-onds-query',
    'R3-flightSearch-two-slice', 'R4-flightSearch-fragment', 'R5-flightSearch-tripType', 'R6-processOffer-en_gb',
    'R7-processOffer-en_eg', 'R8-book-root-with-params']);
  // Rows 1-4 of the doc are flightSearch rows: they snapshot the rendered form, because
  // "BA ignores every prefill parameter" is exactly what a browser has to re-measure.
  const formChecked = cases.filter((c) => c.formCheck);
  assert.deepEqual(formChecked.map((c) => c.id), ['R1-flightSearch-no-params', 'R2-flightSearch-onds-query',
    'R3-flightSearch-two-slice', 'R4-flightSearch-fragment', 'R5-flightSearch-tripType']);
  assert.equal(cases.find((c) => c.formCheck.prefillExpected === null).id, 'R1-flightSearch-no-params');
  for (const c of cases.filter((x) => x.formCheck && x.id !== 'R1-flightSearch-no-params'))
    assert.equal(c.formCheck.prefillExpected, 'ignored');
  // The processOffer rows stay in the list as BLOCKED re-measurements and are never emit-able.
  assert.match(cases.find((c) => c.id === 'R6-processOffer-en_gb').link.url, /processOffer/);
  assert.equal(resolveAirlineLink(MIXED_MULTI_CITY, 'BA', PAX).url, BA_SEARCH_FORM);
  for (const c of cases) assert.doesNotMatch(c.id, /prefill-verified|results-reached/);
});

test('the default case list opens the app’s own output and never the BLOCKED handoff', () => {
  const cases=buildCases({});
  assert.deepEqual(cases.map(c=>c.id),[
    'A-ba-one-way-app-output','B-ba-round-trip-app-output','C-ba-multi-city-app-output','D-aa-metasearch-6-leg',
  ]);
  for (const c of cases.slice(0,3)) assert.equal(c.link.url,BA_SEARCH_FORM);
  for (const c of cases) assert.doesNotMatch(c.link.url,/processOffer|search-journey-id|[?&]cid=/i);
  // The AA case is the pinned historical metasearch payload, not a BA URL.
  assert.equal(new URL(cases[3].link.url).pathname,'/goto/metasearch');
  assert.equal(resolveAirlineLink(MIXED_MULTI_CITY,'BA',PAX).url,BA_SEARCH_FORM);
});

test('capture, candidates, matrix and legacy cases exist only behind their flags', () => {
  assert.equal(buildCases({}).length,4);
  assert.equal(buildCases({capture:true}).length,7);
  assert.equal(buildCases({candidates:true}).length,12);
  assert.equal(buildCases({matrix:true}).length,13);
  assert.equal(buildCases({legacy:true}).length,7);
  const all=buildCases({capture:true,candidates:true,matrix:true,legacy:true});
  assert.equal(all.length,27);
  // The variant matrix covers every item the acceptance checklist asks for.
  const matrix=all.filter(c=>c.id.startsWith('M')).map(c=>c.id);
  assert.deepEqual(matrix,['M1-processOffer-en_eg','M2-processOffer-eId','M3-two-step-session','M4-book-root-with-params',
    'M5-book-root-bare','M6-schedulesresults','M7-fx-booking-entry','M8-low-price-finder','M9-flightSearch-en_eg']);
  // One-way, round-trip AND multi-city are filled by hand, and the two-step case really
  // warms up on the homepage in the same tab first.
  assert.deepEqual(all.filter(c=>c.capture).map(c=>c.capture.journeys.length),[1,2,3]);
  assert.equal(all.find(c=>c.id==='M3-two-step-session').warmUp,'https://www.britishairways.com/travel/home/public/en_eg/');
  // Nothing anywhere in the case list carries a transient id or a passenger name.
  for (const c of all) {
    const url=c.link?.url||'';
    assert.doesNotMatch(url,/search-journey-id=[A-Za-z0-9]|cid=[A-Za-z0-9]|firstName|lastName|passport/i);
  }
});

test('the CLI clamps a broken --seconds and keeps report names inside artifacts/', () => {
  assert.equal(parseArgv([]).waitSeconds,75);
  assert.equal(parseArgv(['--seconds=150']).waitSeconds,150);
  // A typo must not silently turn every wait into 0s, and nobody gets to wait for an hour.
  assert.equal(parseArgv(['--seconds=abc']).waitSeconds,75);
  assert.equal(parseArgv(['--seconds=-5']).waitSeconds,75);
  assert.equal(parseArgv(['--seconds=99999']).waitSeconds,900);
  assert.equal(parseArgv([]).report,'ba-live-probe-report.json');
  assert.equal(parseArgv(['--report=pass1.json']).report,'pass1.json');
  // A path-shaped name is flattened, so a report can never be written outside artifacts/.
  assert.equal(parseArgv(['--report=../../etc/passwd']).report,'....etcpasswd');
  // Replay needs a capture (or --replay-stdin), and a capture only replays when asked.
  assert.equal(parseArgv([]).replay,false);
  assert.equal(parseArgv(['--replay']).replay,true);
  assert.equal(parseArgv(['--replay-stdin']).replayStdin,true);
  assert.equal(parseArgv(['--replay-stdin']).markdown,true);
  assert.equal(parseArgv(['--candidates']).markdown,true);
  assert.equal(parseArgv(['--dry-run']).dryRun,true);
  assert.equal(parseArgv(['--list-cases']).dryRun,true);
});

test('--dry-run lists every case redacted and launches no browser', async () => {
  const lines=[];const original=console.log;
  console.log=(...args)=>lines.push(args.join(' '));
  try{ await main(['--dry-run','--capture','--candidates','--matrix','--legacy']); }
  finally{ console.log=original; }
  const text=lines.join('\n');
  assert.match(text,/27 case\(s\); no browser launched, no cookies, no unredacted URL\./);
  assert.match(text,/^A-ba-one-way-app-output\thttps:\/\/www\.britishairways\.com\/travel\/book\/public\/en_gb\/flightSearch$/m);
  assert.match(text,/fill by hand: CDG-MSY_2026-10-30, MIA-STI_2026-10-31, STI-BCN_2027-01-21/);
  // The candidate rows carry their form-check expectation into the reviewable case list.
  assert.match(text,/^R2-flightSearch-onds-query\t.*\[form check: prefill expected ignored\]$/m);
  assert.doesNotMatch(text,/ITEN=[^<\s]|search-journey-id=[^<\s]|[?&]cid=[^<\s]/);
});

test('--dry-run --candidates prints the paste-ready evidence skeleton, still redacted', async () => {
  const lines=[];const original=console.log;
  console.log=(...args)=>lines.push(args.join(' '));
  try{ await main(['--dry-run','--candidates','--markdown']); }
  finally{ console.log=original; }
  const text=lines.join('\n');
  assert.match(text,/Landing observed \| Seconds waited \| Network failures \(status · path only\)/);
  assert.match(text,/\| R1-flightSearch-no-params \| `https:\/\/www\.britishairways\.com\/travel\/book\/public\/en_gb\/flightSearch` \| not run \|/);
  assert.doesNotMatch(text,/ITEN=[^<\s]|search-journey-id=[^<\s]|[?&]cid=[^<\s]/);
});

test('a capture report prints its URL as parameter names and prints the fresh-context replay verdict', () => {
  const lines=[];const original=console.log;
  console.log=(...args)=>lines.push(args.join(' '));
  try {
    printReport({
      case:'F-capture-one-way', description:'fill BA’s form by hand', openedUrl:'https://www.britishairways.com/travel/book/view',
      outcome:'STILL_PROCESSING_INTERSTITIAL', captureOutcome:'CAPTURED_BA_SEARCH_URL',
      finalUrl:'https://www.britishairways.com/travel/book/public/en_gb/processOffer?search-journey-id=<redacted>&onds=CDG-LHR_2026-10-30',
      finalTitle:'British Airways - Processing Flight Selection', secondsWaited:150,
      filledFields:[{row:1,label:'from',value:'CDG',strategy:0,ok:true},{label:'travel-class',value:'C',ok:true,strategy:'radio'}],
      rowsRemoved:2, filledOf:'3/3', capturedParamNames:['onds','search-journey-id'],
      capturedPath:'https://www.britishairways.com/travel/book/public/en_gb/processOffer',
      readBackWarning:'The form fields did not read back the typed airports; check the screenshot before trusting the capture.',
      networkFailures:[{status:429,method:'GET',path:'https://www.britishairways.com/content/en/gb/airport'}],
      steps:[{t:1,url:'https://www.britishairways.com/travel/book/public/en_gb/processOffer?search-journey-id=<redacted>',title:'British Airways - Processing Flight Selection'}],
      replay:{freshContext:true,outcome:'REPLAY_PROCESSING_INTERSTITIAL',secondsWaited:40,
        finalUrl:'https://www.britishairways.com/travel/book/public/en_gb/processOffer?search-journey-id=<redacted>',
        finalTitle:'British Airways - Processing Flight Selection',sameUrlPathAfterReplay:true,steps:[]},
    });
  } finally { console.log=original; }
  const text=lines.join('\n');
  assert.match(text,/waited : 150s/);
  assert.match(text,/captured params: onds, search-journey-id \(values redacted\)/);
  assert.match(text,/net: 429 GET https:\/\/www\.britishairways\.com\/content\/en\/gb\/airport/);
  assert.match(text,/WARNING: The form fields did not read back/);
  assert.match(text,/REPLAY \(fresh context, no cookies\) → REPLAY_PROCESSING_INTERSTITIAL after 40s/);
  // A capture that produced a URL still never prints a live value.
  assert.match(text,/search-journey-id=<redacted>/);
  assert.doesNotMatch(text,/\b(search-journey-id|sid|cid)=[A-Za-z0-9-]{6,}/);
});

test('a captured URL is carried into the evidence table as a redacted format, not a live URL', () => {
  const table = markdownTable(evidenceRows([], [{
    case:'F-capture-one-way', openedUrl:'https://www.britishairways.com/travel/book/public/en_gb/flightSearch',
    outcome:'STILL_PROCESSING_INTERSTITIAL', secondsWaited:150,
    capturedPath:'https://www.britishairways.com/travel/book/public/en_gb/processOffer',
    capturedParamNames:['onds','search-journey-id'],
    replay:{outcome:'REPLAY_PROCESSING_INTERSTITIAL'},
  }]));
  assert.match(table, /`capture produced https:\/\/www\.britishairways\.com\/travel\/book\/public\/en_gb\/processOffer\?onds=<redacted>&search-journey-id=<redacted>`/);
  assert.match(table, /STILL_PROCESSING_INTERSTITIAL → replay in fresh context: REPLAY_PROCESSING_INTERSTITIAL/);
  assert.doesNotMatch(table, /search-journey-id=[A-Za-z0-9-]{6,}/);
});

test('the probe never persists or prints a captured URL: only its parameter names and path', () => {
  const src=readFileSync(new URL('../tools/ba-live-probe.mjs',import.meta.url),'utf8');
  // Replay reuses the in-memory URL in a brand-new context — it is never written to the report.
  assert.match(src,/const replay = \{ freshContext: true, paramNames: paramNames\(rawUrl\), path: pathOnly\(rawUrl\) \}/);
  assert.match(src,/await browser\.newContext\(\{ viewport: \{ width: 1440, height: 900 \} \}\);\n  const replay = \{ freshContext: true/);
  assert.match(src,/if \(moved && opts\.replay\) capture\.replay = await runReplay\(browser, probe, captured, opts\);/);
  assert.match(src,/capturedParamNames: moved \? paramNames\(captured\) : \[\]/);
  // The only thing written to disk is the report object (already redacted) — never a raw URL.
  assert.doesNotMatch(src,/writeFileSync\([^)]*(captured|rawUrl|page\.url\(\))/);
  // No BA URL may be treated as a verified prefill by this tool either.
  assert.doesNotMatch(src,/prefill verified|reaches BA results|PASS_PASSENGER_FORM_MATCHED_FARE/);
});
