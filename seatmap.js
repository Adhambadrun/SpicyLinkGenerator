// Demo seatmap builder.
//
// Rebuilt from the First-cabin handoff (see FIRST_CABIN_NOTES.md). The old
// implementation duplicated resolveLayout()'s variant-only-when-missing rule
// here, which dropped First cabins a second time. The single source of truth
// for which cabins appear is resolveLayout() in seatmap_layouts.js — this
// file renders whatever that resolution returns and must never re-derive or
// filter cabins on its own.
//
// Everything produced here is a DEMO: reference-tier layouts plus
// deterministic placeholder seat states. It is not availability, not a real
// seatmap, and never a booking surface.

import { resolveLayout, normalizeCabin, TYPE_REFERENCE } from './seatmap_layouts.js';

/** Small deterministic string hash → 32-bit int (stable across runs/hosts). */
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const SEAT_STATES = ['available', 'occupied', 'available', 'occupied', 'available', 'blocked'];
const seatState = (seatId) => SEAT_STATES[hash32(seatId) % SEAT_STATES.length];

/** Build a demo seatmap for an aircraft type, optionally scoped to the
 * ticketed cabin (carrier used only to pick a better reference variant).
 *
 * @param {{type: string, carrier?: string|null, cabin?: string|null}} args
 * @returns {object} { demo:true, ok, layout, ticketedCabin, cabins, notice }
 *   cabins: [{ tier, rows: [{ row, seats: [{ id, state }] }] }]
 *   `ok:false` (with notice) for unknown type/cabin — no map is invented. */
export function createDemoSeatMap({ type, carrier = null, cabin = null } = {}) {
  const layout = resolveLayout({ type, carrier, ticketedCabin: cabin });
  if (!layout.ok) return { demo: true, ok: false, layout: null, ticketedCabin: null, cabins: [], notice: layout.notice };

  const ticketedCabin = cabin == null ? null : normalizeCabin(cabin);
  const cabins = layout.cabins.map(({ tier, rows, columns }) => ({
    tier,
    rows: Array.from({ length: rows[1] - rows[0] + 1 }, (_, i) => {
      const row = rows[0] + i;
      return { row, seats: columns.map(letter => { const id = `${row}${letter}`; return { id, state: seatState(id) }; }) };
    }),
  }));

  return {
    demo: true,
    ok: true,
    layout,
    ticketedCabin,
    cabins,
    notice: layout.notice + ' Seat states are demo placeholders, not availability.',
  };
}

export { TYPE_REFERENCE };
