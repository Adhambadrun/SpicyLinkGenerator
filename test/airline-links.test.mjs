import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAirlineLink } from '../airline-links.js';
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

test('mixed BA/AA 6-leg itinerary: BA falls back to homepage while AA preserves all 6 legs in order', () => {
  const itinerary=[
    {carrier:'BA',num:'323',cls:'J',origin:'CDG',dest:'LHR',ymd:'2026-10-30',depH:7,depM:5},
    {carrier:'AA',num:'731',cls:'I',origin:'LHR',dest:'CLT',ymd:'2026-10-30',depH:9,depM:55},
    {carrier:'AA',num:'2615',cls:'I',origin:'CLT',dest:'MSY',ymd:'2026-10-30',depH:16,depM:53},
    {carrier:'AA',num:'1917',cls:'I',origin:'MIA',dest:'STI',ymd:'2026-10-31',depH:12,depM:5},
    {carrier:'AA',num:'1770',cls:'O',origin:'STI',dest:'MIA',ymd:'2027-01-21',depH:7,depM:20},
    {carrier:'AA',num:'112',cls:'O',origin:'MIA',dest:'BCN',ymd:'2027-01-21',depH:16,depM:15},
  ];
  const ba=resolveAirlineLink(itinerary,'BA',pax);
  assert.equal(ba.kind,'homepage');
  assert.equal(ba.url,'https://www.britishairways.com/');
  assert.equal(ba.label,'Visit British Airways website');
  assert.match(ba.note,/Multiple marketing carriers/);
  assert.match(ba.note,/opens a homepage, not a selected flight or live fare/);
  assert.doesNotMatch(ba.url,/processOffer|onds=/);

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

test('BA-only itineraries also stay on the homepage fallback until a BA handoff is live-verified', () => {
  const oneWay=[leg('BA','CDG','LHR','2026-10-30')];
  const roundTrip=[leg('BA','CDG','LHR','2026-10-30'),leg('BA','LHR','CDG','2026-11-06')];
  for(const trip of [oneWay,roundTrip]) {
    const ba=resolveAirlineLink(trip,'BA',pax);
    assert.equal(ba.kind,'homepage');
    assert.equal(ba.url,'https://www.britishairways.com/');
    assert.match(ba.note,/No tested airline-specific handoff is available yet/);
    assert.doesNotMatch(ba.url,/processOffer|onds=/);
  }
});

test('airlines without specific connectors use their own homepages, unknown carriers disable the link', () => {
  const fr=resolveAirlineLink([leg('FR')],'FR',pax);
  assert.equal(fr.kind,'homepage');
  assert.equal(new URL(fr.url).hostname,'www.ryanair.com');
  assert.equal(resolveAirlineLink([leg('ZZ')],'ZZ',pax).url,null);
  assert.equal(resolveAirlineLink([leg('DL')],'DL',{...pax,adults:0}).kind,'homepage');
});
