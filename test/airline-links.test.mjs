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

test('multiple airlines always use selected carrier homepage, not an invented joint cart', () => {
  const itinerary=[leg('AA'),leg('LH','LAX','FRA')];
  const aa=resolveAirlineLink(itinerary,'AA',pax);
  const lh=resolveAirlineLink(itinerary,'LH',pax);
  assert.equal(aa.kind,'homepage');assert.equal(lh.kind,'homepage');
  assert.equal(new URL(aa.url).hostname,'www.aa.com');
  assert.equal(new URL(lh.url).hostname,'www.lufthansa.com');
  assert.match(lh.note,/Multiple marketing carriers/);
  assert.equal(resolveAirlineLink(itinerary,'DL',pax).url,null);
});

test('airlines without specific connectors use their own homepages, unknown carriers disable the link', () => {
  const fr=resolveAirlineLink([leg('FR')],'FR',pax);
  assert.equal(fr.kind,'homepage');
  assert.equal(new URL(fr.url).hostname,'www.ryanair.com');
  assert.equal(resolveAirlineLink([leg('ZZ')],'ZZ',pax).url,null);
  assert.equal(resolveAirlineLink([leg('DL')],'DL',{...pax,adults:0}).kind,'homepage');
});
