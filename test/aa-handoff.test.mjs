import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { aaDepartureMs, buildAAMetasearchUrl } from '../aa-handoff.js';
import { parseMatrixInput } from '../booking-tools.js';

const pax={adults:1,seniors:0,children:0,infantsInSeat:0,youths:0,infantsInLap:0};
const seg=(ymd='2026-11-12',origin='JFK')=>({
  carrier:'AA',num:'123',cls:'K',origin,dest:'LAX',ymd,depH:15,depM:45,
});

test('AA exact-flight URL preserves the historical metasearch envelope and every leg', () => {
  const first=seg();
  const second={...seg('2026-11-13','LAX'),num:'456',dest:'SFO',depH:9,depM:30};
  const url=new URL(buildAAMetasearchUrl([first,second],pax));
  assert.equal(url.origin,'https://www.aa.com');
  assert.equal(url.pathname,'/goto/metasearch');
  assert.deepEqual([...url.searchParams.keys()],['ITEN']);
  const payload=url.searchParams.get('ITEN');
  assert.match(payload,/^DIRECT,0,US,multi,4,A1S0C0I0Y0L0,/);
  assert.match(payload,/#AA\|123\|K\|JFK\|LAX\|\d+\|0/);
  assert.match(payload,/#AA\|456\|K\|LAX\|SFO\|\d+\|1/);
  assert.match(payload,/,0\.00,1,/); // historical protocol placeholder, NOT a fare
  assert.doesNotMatch(url.href,/passport|firstName|lastName|payment|price=/i);
});

test('airport timezone conversion handles daylight saving instead of fixed offsets', () => {
  const winter=aaDepartureMs(seg('2026-11-12'));
  const summer=aaDepartureMs(seg('2026-07-12'));
  assert.equal(winter,Date.parse('2026-11-12T20:45:00Z')); // New York UTC−5
  assert.equal(summer,Date.parse('2026-07-12T19:45:00Z')); // New York UTC−4
  assert.equal(aaDepartureMs(seg('2026-07-12','PHX')),Date.parse('2026-07-12T22:45:00Z'));
});

test('exact timestamp from imported Matrix JSON is used even for airports outside timezone map', () => {
  const imported=parseMatrixInput({itinerary:{slices:[{segments:[{
    carrier:'AA',flightNumber:'12',origin:'SYD',destination:'LAX',bookingCode:'K',
    departureTime:'2026-11-12T15:45:00+11:00', arrivalTime:'2026-11-12T10:15:00-08:00',
  }]}]}});
  assert.equal(aaDepartureMs(imported.segments[0]),Date.parse('2026-11-12T04:45:00Z'));
  assert.ok(buildAAMetasearchUrl(imported.segments,pax).includes('www.aa.com'));
});

test('unsupported carriers, missing timezone and invalid passenger mixes fail closed', () => {
  assert.throws(()=>buildAAMetasearchUrl([{...seg(),carrier:'BA'}],pax),/AA-marketed/);
  assert.throws(()=>buildAAMetasearchUrl([seg('2026-11-12','ZZZ')],pax),/timezone mapping/);
  assert.throws(()=>buildAAMetasearchUrl([seg()],{...pax,infantsInLap:2}),/passenger counts/);
  assert.throws(()=>aaDepartureMs({...seg('2026-03-08','JFK'),depH:2,depM:30}),/Ambiguous or nonexistent/);
  assert.throws(()=>aaDepartureMs({...seg('2026-11-01','JFK'),depH:1,depM:30}),/Ambiguous or nonexistent/);
});


test('AA URL golden checksum protects the working handoff format from regressions', () => {
  const url=buildAAMetasearchUrl([seg()],pax);
  assert.equal(createHash('sha256').update(url).digest('hex'),
    '76249debd11fd0238540fb99ebcb73754c2fa9a519a53f27a1acabca1cfbb268');
});
