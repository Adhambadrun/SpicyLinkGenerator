import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBAProcessOfferUrl, resolveAirlineLink } from '../airline-links.js';
import { buildAAMetasearchUrl } from '../aa-handoff.js';

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
  // 6 legs collapse to 3 O&D slices (CDG-MSY, MIA-STI, STI-BCN): BA's processing page
  // cannot prove multi-city acceptance (AA_ACCEPTANCE.md), so no link is emitted.
  assert.throws(()=>buildBAProcessOfferUrl(itinerary,pax),/one-way and round-trip only/);
  const ba=resolveAirlineLink(itinerary,'BA',pax);
  assert.equal(ba.kind,'homepage');
  assert.equal(ba.url,'https://www.britishairways.com/');
  assert.equal(ba.label,'Visit British Airways website');
  assert.match(ba.note,/one-way and round-trip only/);
  assert.match(ba.note,/3 O&D slices/);
  assert.match(ba.note,/multi-city/);
  assert.match(ba.note,/not a selected flight/);

  // The shape gate runs before any injected legacy builder, so an ungated builder
  // (like the app's historical baUrl) can never emit a multi-city processOffer URL.
  const gated=resolveAirlineLink(itinerary,'BA',pax,{buildBAUrl:()=>{throw new Error('must not be called');}});
  assert.equal(gated.kind,'homepage');
  assert.equal(gated.url,'https://www.britishairways.com/');

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

test('BA processOffer builder encodes one-way and round-trip O&D slices, rejects multi-city, and falls back to homepage on invalid passenger counts', () => {
  const oneWay=[leg('BA','CDG','LHR','2026-10-30')];
  const roundTrip=[leg('BA','CDG','LHR','2026-10-30'),leg('BA','LHR','CDG','2026-11-06')];
  const baOneWay=resolveAirlineLink(oneWay,'BA',pax);
  assert.equal(baOneWay.kind,'search_unverified');
  assert.equal(baOneWay.url,'https://www.britishairways.com/travel/book/public/en_gb/processOffer?onds=CDG-LHR_2026-10-30&ad=1&yad=0&ch=0&inf=0&cabin=M&flex=LOWEST&ond=1');
  assert.equal(baOneWay.url,buildBAProcessOfferUrl(oneWay,pax));
  const baRoundTrip=resolveAirlineLink(roundTrip,'BA',pax);
  assert.equal(baRoundTrip.kind,'search_unverified');
  assert.equal(baRoundTrip.url,'https://www.britishairways.com/travel/book/public/en_gb/processOffer?onds=CDG-LHR_2026-10-30,LHR-CDG_2026-11-06&ad=1&yad=0&ch=0&inf=0&cabin=M&flex=LOWEST&ond=2');
  assert.equal(baRoundTrip.url,buildBAProcessOfferUrl(roundTrip,pax));
  // A same-day one-way connection still counts as one O&D slice and is allowed.
  const connection=[leg('BA','CDG','LHR','2026-10-30'),leg('AA','LHR','JFK','2026-10-30')];
  const baConnection=resolveAirlineLink(connection,'BA',pax);
  assert.equal(baConnection.kind,'search_unverified');
  assert.match(baConnection.url,/onds=CDG-JFK_2026-10-30&/);
  assert.match(baConnection.url,/ond=1$/);
  // An overnight or next-day second departure starts a second O&D slice (open return).
  const openReturn=[leg('BA','CDG','LHR','2026-10-30'),leg('AA','LHR','JFK','2026-10-31')];
  const baOpen=resolveAirlineLink(openReturn,'BA',pax);
  assert.equal(baOpen.kind,'search_unverified');
  assert.match(baOpen.url,/ond=2$/);
  // 3+ O&D slices (multi-city) are refused by the builder and gate to the homepage.
  const multiCity=[leg('BA','CDG','LHR','2026-10-30'),leg('BA','LHR','CDG','2026-11-06'),leg('BA','CDG','LHR','2026-11-13')];
  assert.throws(()=>buildBAProcessOfferUrl(multiCity,pax),/needs 3 O&D slices/);
  const baMulti=resolveAirlineLink(multiCity,'BA',pax);
  assert.equal(baMulti.kind,'homepage');
  assert.equal(new URL(baMulti.url).hostname,'www.britishairways.com');
  assert.match(baMulti.note,/multi-city/);
  assert.equal(resolveAirlineLink(oneWay,'BA',{...pax,adults:0}).kind,'homepage');
});

test('airlines without specific connectors use their own homepages, unknown carriers disable the link', () => {
  const fr=resolveAirlineLink([leg('FR')],'FR',pax);
  assert.equal(fr.kind,'homepage');
  assert.equal(new URL(fr.url).hostname,'www.ryanair.com');
  assert.equal(resolveAirlineLink([leg('ZZ')],'ZZ',pax).url,null);
  assert.equal(resolveAirlineLink([leg('DL')],'DL',{...pax,adults:0}).kind,'homepage');
});
