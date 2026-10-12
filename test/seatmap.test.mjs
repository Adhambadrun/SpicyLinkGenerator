import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLayout, normalizeCabin, normalizeType, TYPE_REFERENCE, TYPE_LAYOUTS } from '../seatmap_layouts.js';
import { createDemoSeatMap } from '../seatmap.js';

// Pinning tests for the First-cabin fix (see FIRST_CABIN_NOTES.md).
// The regression: resolveLayout() only consulted TYPE_LAYOUT_VARIANTS when
// the ticketed cabin was missing from the default layout. Business is always
// present in widebody defaults, so a First ticket was silently dropped and
// presented as Business. The same rule was duplicated in createDemoSeatMap().

test('First ticket on a Business-in-default type resolves to the three-class variant, not Business', () => {
  // EK 777-300ER: default layout has BUSINESS + COACH only.
  assert.ok(TYPE_LAYOUTS.B77W.cabins.some(c => c.tier === 'BUSINESS'));
  assert.ok(!TYPE_LAYOUTS.B77W.cabins.some(c => c.tier === 'FIRST'));

  const r = resolveLayout({ type: 'Boeing 777-300ER', carrier: 'EK', ticketedCabin: 'FIRST' });
  assert.equal(r.ok, true);
  assert.equal(r.containsTicketedCabin, true, 'First cabin must not be silently dropped');
  assert.equal(r.missingCabin, null);
  assert.equal(r.source, 'carrier-variant');
  assert.ok(r.cabins.some(c => c.tier === 'FIRST'), 'resolved layout must include the ticketed First cabin');
  // and it must not be disguised as Business
  assert.notEqual(r.cabins.find(c => c.tier === 'FIRST'), undefined);
});

test('carrier-specific variant beats the generic type variant', () => {
  const ek = resolveLayout({ type: 'B77W', carrier: 'EK', ticketedCabin: 'FIRST' });
  const unknownCarrier = resolveLayout({ type: 'B77W', carrier: null, ticketedCabin: 'FIRST' });
  assert.equal(ek.source, 'carrier-variant');
  assert.equal(unknownCarrier.source, 'type-variant');
  assert.equal(unknownCarrier.containsTicketedCabin, true);
});

test('createDemoSeatMap shows the First cabin too — no duplicated dropping rule', () => {
  const map = createDemoSeatMap({ type: 'Boeing 777-300ER', carrier: 'EK', cabin: 'FIRST' });
  assert.equal(map.demo, true);
  assert.equal(map.ok, true);
  assert.deepEqual(map.cabins.map(c => c.tier), ['FIRST', 'BUSINESS', 'COACH']);
  assert.ok(map.cabins[0].rows.length > 0);
  assert.match(map.cabins[0].rows[0].seats[0].id, /^1[A-Z]$/);
});

test('when no reference layout has the ticketed cabin, the gap is reported, never substituted', () => {
  const r = resolveLayout({ type: 'Airbus A321neo', carrier: 'MS', ticketedCabin: 'FIRST' });
  assert.equal(r.ok, true);
  assert.equal(r.containsTicketedCabin, false);
  assert.equal(r.missingCabin, 'FIRST');
  assert.ok(!r.cabins.some(c => c.tier === 'FIRST'), 'a First cabin must not be invented');
  assert.match(r.notice, /No reference layout .* includes FIRST/);

  const map = createDemoSeatMap({ type: 'Airbus A321neo', carrier: 'MS', cabin: 'FIRST' });
  assert.ok(!map.cabins.some(c => c.tier === 'FIRST'));
  assert.match(map.notice, /No reference layout .* includes FIRST/);
});

test('business-as-usual paths are unchanged', () => {
  const business = resolveLayout({ type: 'Boeing 777-300ER', carrier: 'EK', ticketedCabin: 'BUSINESS' });
  assert.equal(business.source, 'carrier-variant'); // variant covers it; consistent source
  assert.equal(business.containsTicketedCabin, true);

  const coachOnDefault = resolveLayout({ type: 'Boeing 737 MAX 8', ticketedCabin: 'COACH' });
  assert.equal(coachOnDefault.source, 'default');
  assert.equal(coachOnDefault.containsTicketedCabin, true);

  const noCabinAsked = resolveLayout({ type: 'Boeing 787-9' });
  assert.equal(noCabinAsked.ok, true);
  assert.equal(noCabinAsked.containsTicketedCabin, null);
  assert.equal(noCabinAsked.missingCabin, null);
});

test('honesty constraint: every resolution is TYPE_REFERENCE and says not verified for the airline', () => {
  const cases = [
    { type: 'Boeing 777-300ER', carrier: 'EK', ticketedCabin: 'FIRST' },
    { type: 'Boeing 777-300ER', ticketedCabin: 'BUSINESS' },
    { type: 'Airbus A321neo', carrier: 'MS', ticketedCabin: 'FIRST' },
    { type: 'Boeing 787-9' },
  ];
  for (const args of cases) {
    const r = resolveLayout(args);
    assert.equal(r.tier, TYPE_REFERENCE);
    assert.match(r.notice, /not verified for this airline/);
    const map = createDemoSeatMap(args);
    assert.equal(map.demo, true);
    assert.match(map.notice, /not verified for this airline/);
    assert.match(map.notice, /demo placeholders, not availability/);
  }
});

test('unknown types and cabins fail honestly instead of inventing layouts', () => {
  assert.equal(resolveLayout({ type: 'Concorde' }).ok, false);
  assert.equal(resolveLayout({ type: 'B77W', ticketedCabin: 'SUITES' }).ok, false);
  const map = createDemoSeatMap({ type: 'Concorde', cabin: 'FIRST' });
  assert.equal(map.ok, false);
  assert.deepEqual(map.cabins, []);
  assert.ok(map.notice.length > 0);
});

test('cabin and type aliases normalize consistently', () => {
  assert.equal(normalizeCabin('PREMIUM ECONOMY'), 'PREMIUM-COACH');
  assert.equal(normalizeCabin('j'), 'BUSINESS');
  assert.equal(normalizeCabin('nope'), null);
  assert.equal(normalizeType('777-300ER'), 'B77W');
  assert.equal(normalizeType('boeing  787-9'), 'B789');
  assert.equal(normalizeType('A380'), null);
});
