import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCases, classify, main, redactUrl, PAX, MIXED_MULTI_CITY } from '../tools/ba-live-probe.mjs';
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

test('capture, matrix and legacy cases exist only behind their flags', () => {
  assert.equal(buildCases({}).length,4);
  assert.equal(buildCases({capture:true}).length,7);
  assert.equal(buildCases({matrix:true}).length,13);
  assert.equal(buildCases({legacy:true}).length,7);
  const all=buildCases({capture:true,matrix:true,legacy:true});
  assert.equal(all.length,19);
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

test('--dry-run lists every case redacted and launches no browser', async () => {
  const lines=[];const original=console.log;
  console.log=(...args)=>lines.push(args.join(' '));
  try{ await main(['--dry-run','--capture','--matrix','--legacy']); }
  finally{ console.log=original; }
  const text=lines.join('\n');
  assert.match(text,/19 case\(s\); no browser launched, no cookies, no unredacted URL\./);
  assert.match(text,/^A-ba-one-way-app-output\thttps:\/\/www\.britishairways\.com\/travel\/book\/public\/en_gb\/flightSearch$/m);
  assert.match(text,/fill by hand: CDG-MSY_2026-10-30, MIA-STI_2026-10-31, STI-BCN_2027-01-21/);
  assert.doesNotMatch(text,/ITEN=[^<\s]|search-journey-id=[^<\s]|[?&]cid=[^<\s]/);
});
