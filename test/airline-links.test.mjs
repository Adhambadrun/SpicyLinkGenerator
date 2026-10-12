import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBAProcessOfferUrl, gfSearchGroups, ondSlices, ondSlicesWithCabin, resolveAirlineLink } from '../airline-links.js';
import { buildAAMetasearchUrl } from '../aa-handoff.js';

const BA_SEARCH_FORM='https://www.britishairways.com/travel/book/public/en_gb/flightSearch';

const pax={adults:1,seniors:0,youths:0,children:0,infantsInSeat:0,infantsInLap:0};
const leg=(carrier='AA',origin='JFK',dest='LAX',ymd='2026-11-12')=>({
  carrier,num:'123',origin,dest,ymd,cls:'K',depH:15,depM:45,
});

test('AA handoff is unchanged: resolver delegates to historical builder', () => {
  const itinerary=[leg()];
  const result=resolveAirlineLink(itinerary,'AA',pax);
  assert.equal(result.kind,'aa_handoff');
  assert.equal(result.url,buildAAMetasearchUrl(itinerary,pax));
  assert.equal(new URL(result.url).hostname,'www.aa.com');
  assert.match(result.note,/live fare/);
});

test('direct DL and UA can offer only clearly unverified search prefills', () => {
  for(const carrier of ['DL','UA']) {
    const result=resolveAirlineLink([leg(carrier)],carrier,pax);
    assert.equal(result.kind,'search_unverified');
    assert.match(result.note,/NOT guaranteed/);
    const url=new URL(result.url);
    assert.ok(url.hostname.includes(carrier==='DL'?'delta.com':'united.com'));
    assert.ok(url.searchParams.has(carrier==='DL'?'departureDate':'d'));
    assert.doesNotMatch(result.url,/fareBasis|price|passport|firstName|lastName|session=/i);
  }
});

test('round-trip search keeps both dates; connections never collapse into a wrong direct search', () => {
  const outbound=leg('DL');
  const inbound=leg('DL','LAX','JFK','2026-11-20');
  const trip=resolveAirlineLink([outbound,inbound],'DL',pax);
  assert.equal(trip.kind,'search_unverified');
  assert.equal(new URL(trip.url).searchParams.get('returnDate'),'2026-11-20');
  const connection=resolveAirlineLink([outbound,leg('DL','LAX','SFO')],'DL',pax);
  assert.equal(connection.kind,'homepage');
  assert.equal(new URL(connection.url).search,'');
});

test('AA selection can preserve all mixed-carrier legs via the original metasearch builder', () => {
  const itinerary=[leg('AA'),leg('LH','LAX','FRA')];
  const originalUrl='https://www.aa.com/goto/metasearch?ITEN=historical-payload';
  let encodedSegments;
  const aa=resolveAirlineLink(itinerary,'AA',pax,{buildAAUrl:segments=>{encodedSegments=segments;return originalUrl;}});
  const lh=resolveAirlineLink(itinerary,'LH',pax);
  assert.equal(aa.kind,'aa_handoff');
  assert.equal(aa.url,originalUrl);
  assert.deepEqual(encodedSegments,itinerary);
  assert.match(aa.note,/every itinerary leg/);
  assert.match(aa.note,/non-AA-marketed flights may not be pinned/);
  assert.equal(lh.kind,'homepage');
  assert.equal(new URL(lh.url).hostname,'www.lufthansa.com');
  assert.match(lh.note,/Multiple marketing carriers/);
  assert.equal(resolveAirlineLink(itinerary,'DL',pax).url,null);
});

test('mixed BA/AA 6-leg itinerary: BA falls back clearly beyond 2 O&D slices while AA preserves all 6 legs in order', () => {
  const itinerary=[
    {carrier:'BA',num:'323',cls:'J',origin:'CDG',dest:'LHR',ymd:'2026-10-30',depH:7,depM:5,arrH:7,arrM:35,plus:false},
    {carrier:'AA',num:'731',cls:'I',origin:'LHR',dest:'CLT',ymd:'2026-10-30',depH:9,depM:55,arrH:14,arrM:50,plus:false},
    {carrier:'AA',num:'2615',cls:'I',origin:'CLT',dest:'MSY',ymd:'2026-10-30',depH:16,depM:53,arrH:18,arrM:0,plus:false},
    {carrier:'AA',num:'1917',cls:'I',origin:'MIA',dest:'STI',ymd:'2026-10-31',depH:12,depM:5,arrH:14,arrM:15,plus:false},
    {carrier:'AA',num:'1770',cls:'O',origin:'STI',dest:'MIA',ymd:'2027-01-21',depH:7,depM:20,arrH:8,arrM:46,plus:false},
    {carrier:'AA',num:'112',cls:'O',origin:'MIA',dest:'BCN',ymd:'2027-01-21',depH:16,depM:15,arrH:7,arrM:5,plus:true},
  ];
  // 6 legs collapse to 3 O&D slices (CDG-MSY, MIA-STI, STI-BCN). BA's processOffer handoff
  // is unusable for real users (AA_ACCEPTANCE.md, 2026-10-12 BLOCKED) and BA's own search
  // form ignores prefill parameters (probed 2026-10-12), so BA gets its empty search form
  // with the itinerary spelled out — never a link that claims to be pre-filled.
  assert.throws(()=>buildBAProcessOfferUrl(itinerary,pax),/one-way and round-trip only/);
  const ba=resolveAirlineLink(itinerary,'BA',pax);
  assert.equal(ba.kind,'search_unverified');
  assert.equal(ba.url,BA_SEARCH_FORM);
  assert.equal(ba.label,'Open BA search form');
  assert.match(ba.note,/one-way and round-trip only/);
  assert.match(ba.note,/needs 3 O&D slices/);
  assert.match(ba.note,/multi-city/);
  assert.match(ba.note,/CDG→MSY on 2026-10-30, MIA→STI on 2026-10-31, STI→BCN on 2027-01-21/);
  assert.doesNotMatch(ba.url,/processOffer|search-journey-id|[?&]cid=/i);

  // The collapsed slices are what the clearly labeled third-party alternative pre-fills.
  assert.deepEqual(ondSlices(itinerary).map(s=>`${s.origin}-${s.dest}_${s.ymd}`),
    ['CDG-MSY_2026-10-30','MIA-STI_2026-10-31','STI-BCN_2027-01-21']);

  // BA calls no prefill builder at all (handoff BLOCKED), so even an injected legacy
  // builder can never put a processOffer URL back into the UI for any shape.
  const gated=resolveAirlineLink(itinerary,'BA',pax,{buildBAUrl:()=>{throw new Error('must not be called');}});
  assert.equal(gated.kind,'search_unverified');
  assert.equal(gated.url,BA_SEARCH_FORM);

  let encodedSegments;
  const aa=resolveAirlineLink(itinerary,'AA',pax,{
    buildAAUrl:segments=>{encodedSegments=segments;return 'https://www.aa.com/goto/metasearch?ITEN=six-legs';},
  });
  assert.equal(aa.kind,'aa_handoff');
  assert.deepEqual(encodedSegments.map(s=>`${s.carrier}${s.num}:${s.origin}-${s.dest}:${s.ymd}`),[
    'BA323:CDG-LHR:2026-10-30',
    'AA731:LHR-CLT:2026-10-30',
    'AA2615:CLT-MSY:2026-10-30',
    'AA1917:MIA-STI:2026-10-31',
    'AA1770:STI-MIA:2027-01-21',
    'AA112:MIA-BCN:2027-01-21',
  ]);
});

test('BA opens its own (empty) search form for every shape — never the BLOCKED handoff, never a claimed prefill', () => {
  // Business-class BA legs, exactly like the owner's `1 BA 323J … /DCBA /E` itinerary.
  const baLeg=(origin,dest,ymd,carrier='BA')=>({...leg(carrier,origin,dest,ymd),cls:'J'});
  const oneWay=[baLeg('CDG','LHR','2026-10-30')];
  const roundTrip=[baLeg('CDG','LHR','2026-10-30'),baLeg('LHR','CDG','2026-11-06')];
  // A same-day one-way connection is still a single O&D slice; an overnight second
  // departure starts a second slice (open return). Both used to get a processOffer link.
  const connection=[baLeg('CDG','LHR','2026-10-30'),baLeg('LHR','JFK','2026-10-30','AA')];
  const openReturn=[baLeg('CDG','LHR','2026-10-30'),baLeg('LHR','JFK','2026-10-31','AA')];
  const multiCity=[baLeg('CDG','LHR','2026-10-30'),baLeg('LHR','CDG','2026-11-06'),baLeg('CDG','LHR','2026-11-13')];
  for (const itinerary of [oneWay,roundTrip,connection,openReturn,multiCity]) {
    const result=resolveAirlineLink(itinerary,'BA',pax);
    assert.equal(result.kind,'search_unverified');
    assert.equal(result.url,BA_SEARCH_FORM);
    assert.equal(result.label,'Open BA search form');
    assert.equal(result.manualEntry,true);
    // Honest caveat: why nothing is pre-filled, and that no fare is claimed.
    assert.match(result.note,/calculating your price/);
    assert.match(result.note,/2026-10-12/);
    assert.match(result.note,/AA_ACCEPTANCE\.md/);
    assert.match(result.note,/ignores URL parameters/);
    assert.match(result.note,/opens EMPTY/);
    assert.match(result.note,/No flight is selected and no fare is shown or claimed/);
    assert.doesNotMatch(result.note,/£|\$\d|\d USD|guaranteed fare|booked/i);
    // GUARD: no unverified or recorded-BLOCKED BA link may ever reach the UI.
    assert.doesNotMatch(result.url,/processOffer|search-journey-id|[?&]cid=|passenger-ui|britishairways\.com\/$/i);
  }
  // Each shape tells the user exactly what to type, because the form is empty.
  assert.match(resolveAirlineLink(oneWay,'BA',pax).note,/CDG→LHR on 2026-10-30 \(business, 1 adult\)/);
  assert.match(resolveAirlineLink(oneWay,'BA',pax).note,/remove the other rows/);
  const rt=resolveAirlineLink(roundTrip,'BA',{...pax,adults:2,children:1}).note;
  assert.match(rt,/CDG→LHR on 2026-10-30, LHR→CDG on 2026-11-06 \(business, 2 adults, 1 child\)/);
  assert.match(rt,/remove the third row/);
  // A same-day connection is ONE slice (CDG-JFK), not two one-way searches.
  assert.match(resolveAirlineLink(connection,'BA',pax).note,/CDG→JFK on 2026-10-30/);
  // 3+ O&D slices keep the gate's explanation.
  const baMulti=resolveAirlineLink(multiCity,'BA',pax);
  assert.match(baMulti.note,/one-way and round-trip only/);
  assert.match(baMulti.note,/needs 3 O&D slices/);
  assert.match(baMulti.note,/one row per O&D slice/);
  // A stray injected builder (the app's historical baUrl) cannot resurrect the blocked link.
  const injected=resolveAirlineLink(oneWay,'BA',pax,{buildBAUrl:()=>'https://www.britishairways.com/travel/book/public/en_gb/processOffer?onds=BOGUS'});
  assert.equal(injected.url,BA_SEARCH_FORM);
  assert.doesNotMatch(injected.url,/processOffer/);
  // The legacy builder survives ONLY for manual re-probing (tools/ba-live-probe.mjs) and
  // still refuses 3+ O&D slices; its pinned strings document the exact recorded-BLOCKED
  // URLs from AA_ACCEPTANCE.md (business-class legs -> cabin=C).
  assert.equal(buildBAProcessOfferUrl(oneWay,pax),
    'https://www.britishairways.com/travel/book/public/en_gb/processOffer?onds=CDG-LHR_2026-10-30&ad=1&yad=0&ch=0&inf=0&cabin=C&flex=LOWEST&ond=1');
  assert.equal(buildBAProcessOfferUrl(roundTrip,pax),
    'https://www.britishairways.com/travel/book/public/en_gb/processOffer?onds=CDG-LHR_2026-10-30,LHR-CDG_2026-11-06&ad=1&yad=0&ch=0&inf=0&cabin=C&flex=LOWEST&ond=2');
  assert.match(buildBAProcessOfferUrl(connection,pax),/onds=CDG-JFK_2026-10-30&.*ond=1$/);
  assert.match(buildBAProcessOfferUrl(openReturn,pax),/ond=2$/);
  assert.throws(()=>buildBAProcessOfferUrl(multiCity,pax),/needs 3 O&D slices/);
  // Invalid passenger counts still produce the search form rather than throwing at the UI.
  const noPax=resolveAirlineLink(oneWay,'BA',{...pax,adults:0});
  assert.equal(noPax.url,BA_SEARCH_FORM);
  assert.match(noPax.note,/CDG→LHR on 2026-10-30 \(business\)/);
});

test('ondSlices collapses connections so the third-party alternative is never a chain of one-ways', () => {
  const connection=[leg('BA','CDG','LHR','2026-10-30'),leg('AA','LHR','JFK','2026-10-30')];
  assert.deepEqual(ondSlices(connection),[{origin:'CDG',dest:'JFK',ymd:'2026-10-30'}]);
  assert.deepEqual(ondSlices([leg('BA','CDG','LHR','2026-10-30'),leg('BA','LHR','CDG','2026-11-06')]),
    [{origin:'CDG',dest:'LHR',ymd:'2026-10-30'},{origin:'LHR',dest:'CDG',ymd:'2026-11-06'}]);
  // Malformed input yields no slices, so the app offers no alternative search at all
  // rather than a fabricated one.
  assert.deepEqual(ondSlices([]),[]);
  assert.deepEqual(ondSlices([{origin:'cdg',dest:'LHR',ymd:'2026-10-30'}]),[]);
  assert.deepEqual(ondSlices([{origin:'CDG',dest:'LHR',ymd:'30OCT'}]),[]);
});

test('cabin-annotated O&D slices produce separate Google Flights searches per cabin', () => {
  const mixedConnection=[
    {...leg('BA','CDG','LHR','2026-10-30'),cls:'J'},
    {...leg('AA','LHR','JFK','2026-10-30'),cls:'O'},
    {...leg('AA','JFK','CDG','2026-11-06'),cls:'O'},
  ];
  const slices=ondSlicesWithCabin(mixedConnection);
  assert.deepEqual(slices,[
    {origin:'CDG',dest:'JFK',ymd:'2026-10-30',cabin:'BUSINESS'},
    {origin:'CDG',dest:'JFK',ymd:'2026-10-30',cabin:'COACH'},
    {origin:'JFK',dest:'CDG',ymd:'2026-11-06',cabin:'COACH'},
  ]);
  const expected=[
    {cabin:'BUSINESS',slices:[{origin:'CDG',dest:'JFK',ymd:'2026-10-30'}]},
    {cabin:'COACH',slices:[
      {origin:'CDG',dest:'JFK',ymd:'2026-10-30'},
      {origin:'JFK',dest:'CDG',ymd:'2026-11-06'},
    ]},
  ];
  assert.deepEqual(gfSearchGroups(slices),expected);
  assert.deepEqual(gfSearchGroups(mixedConnection),expected,'raw segments may be grouped directly too');
  assert.deepEqual(ondSlicesWithCabin([]),[]);
  assert.deepEqual(gfSearchGroups([]),[]);
});
