import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMatrixInput, assessQuote } from '../booking-tools.js';

const segment = (flight = '401') => ({
  carrier: { code: 'LH' }, flight: { number: flight },
  origin: { code: 'JFK' }, destination: { code: 'FRA' },
  bookingInfos: [{ bookingCode: 'K' }],
  departure: '2026-11-12T15:45:00-05:00', arrival: '2026-11-13T05:30:00+01:00',
});

test('imports every segment and preserves the unmodified Matrix-style document', () => {
  const input = { itinerary: { slices: [
    { segments: [segment(), { ...segment('402'), origin: { code: 'FRA' }, destination: { code: 'MUC' },
      departure: '2026-11-13T08:00:00+01:00', arrival: '2026-11-13T09:00:00+01:00' }] },
    { segments: [{ ...segment('400'), origin: { code: 'FRA' }, destination: { code: 'JFK' },
      departure: '2026-11-22T10:00:00+01:00', arrival: '2026-11-22T13:00:00-05:00' }] },
  ] }, tickets: [{ fareBasis: 'REAL_CODE_FROM_INPUT' }] };
  const parsed = parseMatrixInput(JSON.stringify(input));
  assert.equal(parsed.segments.length, 3);
  assert.equal(parsed.segments[0].ymd, '2026-11-12');
  assert.equal(parsed.segments[0].plus, true);
  assert.equal(parsed.segments[1].plus, false);
  assert.equal(parsed.segments[2].origin, 'FRA');
  assert.equal(parsed.original.tickets[0].fareBasis, 'REAL_CODE_FROM_INPUT');
});

test('rejects missing legs, naive timestamps, unknown classes and bad JSON', () => {
  assert.throws(() => parseMatrixInput('{'), SyntaxError);
  assert.throws(() => parseMatrixInput({ itinerary: { slices: [{ segments: [] }] } }), /no segments/);
  assert.throws(() => parseMatrixInput({ slices: [{ segments: [segment(), { ...segment(), bookingInfos: [] }] }] }), /segment 2/);
  assert.throws(() => parseMatrixInput({ slices: [{ segments: [{ ...segment(), departure: '2026-11-12T15:45:00' }] }] }), /explicit UTC offsets/);
});

test('quote age is not presented as inventory validation or a fabricated TTL', () => {
  const now = Date.parse('2026-10-12T12:00:00Z');
  assert.equal(assessQuote('', now).state, 'unknown');
  assert.equal(assessQuote('invalid', now).state, 'unknown');
  assert.equal(assessQuote('2026-10-12T12:10:00Z', now).state, 'unknown');
  const recent = assessQuote('2026-10-12T11:58:00Z', now);
  assert.equal(recent.state, 'recent');
  assert.equal(recent.ageMinutes, 2);
  assert.match(recent.message, /live recheck/);
  assert.equal(assessQuote('2026-10-12T11:30:00Z', now).state, 'recheck');
  assert.equal(assessQuote('2026-10-12T11:58:00Z', now, '2026-10-12T11:59:00Z').state, 'expired');
});
