// Seatmap layout REFERENCE data + resolution, rebuilt from the First-cabin
// handoff investigation (see FIRST_CABIN_NOTES.md).
//
// THE RULE THIS MODULE PINS DOWN (do not regress):
//   resolveLayout() must consult TYPE_LAYOUT_VARIANTS whenever the ticketed
//   cabin matters — NOT only when the ticketed cabin is missing from the
//   default layout. The old behavior checked variants only in the
//   missing-cabin branch, so a First ticket on an aircraft whose default
//   two-class layout contains Business (it always does) silently dropped the
//   First cabin and presented Business instead.
//
// Honesty constraint: every layout here is tier TYPE_REFERENCE — a generic
// aircraft-type reference, NOT verified for any specific airline. Callers
// must surface `notice` verbatim; nothing in this module may be described as
// the actual seatmap of a specific flight or airline.

/** Provenance tier. Only 'reference' exists today: no layout in this repo
 * has been verified against an airline's real configuration. A future
 * 'verified' tier would require dated, per-airline evidence. */
export const TYPE_REFERENCE = 'reference';

export const CABIN_TIERS = Object.freeze(['FIRST', 'BUSINESS', 'PREMIUM-COACH', 'COACH']);
const CABIN_RANK = Object.freeze({ FIRST: 3, BUSINESS: 2, 'PREMIUM-COACH': 1, COACH: 0 });

const CABIN_ALIASES = Object.freeze({
  FIRST: 'FIRST', F: 'FIRST',
  BUSINESS: 'BUSINESS', J: 'BUSINESS', C: 'BUSINESS',
  'PREMIUM-COACH': 'PREMIUM-COACH', 'PREMIUM ECONOMY': 'PREMIUM-COACH', PREMIUM: 'PREMIUM-COACH', W: 'PREMIUM-COACH',
  COACH: 'COACH', ECONOMY: 'COACH', Y: 'COACH',
});

/** Normalize free-form cabin input to one of CABIN_TIERS, or null. */
export function normalizeCabin(value) {
  if (typeof value !== 'string') return null;
  return CABIN_ALIASES[value.trim().toUpperCase()] ?? null;
}

/** Canonical aircraft type keys. app.html's aircraftFor() emits long names. */
const TYPE_ALIASES = Object.freeze({
  'BOEING 777-300ER': 'B77W', '777-300ER': 'B77W', B77W: 'B77W', '77W': 'B77W',
  'BOEING 787-9': 'B789', '787-9': 'B789', B789: 'B789', '789': 'B789',
  'BOEING 737 MAX 8': 'B38M', '737 MAX 8': 'B38M', '737-8': 'B38M', B38M: 'B38M',
  'AIRBUS A321NEO': 'A321N', 'A321NEO': 'A321N', 'A321-271NX': 'A321N', A321N: 'A321N',
  'AIRBUS A320': 'A320', 'A320-200': 'A320', A320: 'A320',
});

const TYPE_NAMES = Object.freeze({
  B77W: 'Boeing 777-300ER',
  B789: 'Boeing 787-9',
  B38M: 'Boeing 737 MAX 8',
  A321N: 'Airbus A321neo',
  A320: 'Airbus A320',
});

/** Normalize free-form aircraft type input to a canonical key, or null. */
export function normalizeType(value) {
  if (typeof value !== 'string') return null;
  return TYPE_ALIASES[value.trim().toUpperCase().replace(/\s+/g, ' ')] ?? null;
}

export const listSupportedTypes = () => Object.freeze(Object.values(TYPE_NAMES));

/** Default (generic two-class-or-fewer) layouts per aircraft type.
 * Widebody defaults deliberately carry BUSINESS + COACH only — that is the
 * shape that used to swallow First tickets. rows are [first, last] inclusive;
 * columns are seat letters. All counts are illustrative reference figures. */
export const TYPE_LAYOUTS = Object.freeze({
  B77W: {
    cabins: Object.freeze([
      { tier: 'BUSINESS', rows: [1, 10], columns: Object.freeze(['A', 'C', 'D', 'G', 'H', 'K']) },
      { tier: 'COACH', rows: [30, 54], columns: Object.freeze(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'K']) },
    ]),
  },
  B789: {
    cabins: Object.freeze([
      { tier: 'BUSINESS', rows: [1, 8], columns: Object.freeze(['A', 'C', 'D', 'G', 'H', 'K']) },
      { tier: 'COACH', rows: [20, 47], columns: Object.freeze(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'K']) },
    ]),
  },
  B38M: {
    cabins: Object.freeze([
      { tier: 'COACH', rows: [1, 33], columns: Object.freeze(['A', 'B', 'C', 'D', 'E', 'F']) },
    ]),
  },
  A321N: {
    cabins: Object.freeze([
      { tier: 'COACH', rows: [1, 36], columns: Object.freeze(['A', 'B', 'C', 'D', 'E', 'F']) },
    ]),
  },
  A320: {
    cabins: Object.freeze([
      { tier: 'COACH', rows: [1, 30], columns: Object.freeze(['A', 'B', 'C', 'D', 'E', 'F']) },
    ]),
  },
});

/** Carrier- and type-level variants for cabins the defaults lack.
 * Keys: `${carrier} ${typeKey}` for a carrier-specific reference, or
 * `* ${typeKey}` for a typical-three-class reference used when the carrier
 * is unknown. A variant is chosen by cabin content, never silently
 * substituted for the ticketed cabin. */
export const TYPE_LAYOUT_VARIANTS = Object.freeze({
  'EK B77W': {
    cabins: Object.freeze([
      { tier: 'FIRST', rows: [1, 2], columns: Object.freeze(['A', 'C', 'H', 'K']) },
      { tier: 'BUSINESS', rows: [3, 12], columns: Object.freeze(['A', 'C', 'D', 'G', 'H', 'K']) },
      { tier: 'COACH', rows: [30, 54], columns: Object.freeze(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'K']) },
    ]),
  },
  '* B77W': {
    cabins: Object.freeze([
      { tier: 'FIRST', rows: [1, 2], columns: Object.freeze(['A', 'E', 'F', 'K']) },
      { tier: 'BUSINESS', rows: [3, 12], columns: Object.freeze(['A', 'C', 'D', 'G', 'H', 'K']) },
      { tier: 'COACH', rows: [30, 54], columns: Object.freeze(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'K']) },
    ]),
  },
  '* B789': {
    cabins: Object.freeze([
      { tier: 'FIRST', rows: [1, 1], columns: Object.freeze(['A', 'E', 'F', 'K']) },
      { tier: 'BUSINESS', rows: [2, 9], columns: Object.freeze(['A', 'C', 'D', 'G', 'H', 'K']) },
      { tier: 'COACH', rows: [20, 47], columns: Object.freeze(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'K']) },
    ]),
  },
});

const layoutHasCabin = (layout, cabin) => Boolean(layout?.cabins?.some(c => c.tier === cabin));
const bestRankBelow = (layout, cabin) =>
  (layout?.cabins ?? []).reduce((best, c) => (CABIN_RANK[c.tier] < CABIN_RANK[cabin] && CABIN_RANK[c.tier] > best ? CABIN_RANK[c.tier] : best), -1);

/** Resolve the reference layout for a ticketed cabin on an aircraft type.
 *
 * Precedence (the fixed rule):
 *   1. carrier-specific variant containing the ticketed cabin
 *   2. type-level variant containing the ticketed cabin
 *   3. default layout, if it contains the ticketed cabin
 *   4. otherwise best available layout (carrier variant > type variant >
 *      default) flagged containsTicketedCabin:false — the missing cabin is
 *      reported, never silently replaced by a lower one.
 * Without ticketedCabin: carrier variant > type variant > default.
 *
 * @param {{type?: string, carrier?: string|null, ticketedCabin?: string|null}} args
 * @returns {object} resolution result; `ok:false` only for unknown type/cabin input. */
export function resolveLayout({ type, carrier = null, ticketedCabin = null } = {}) {
  const typeKey = normalizeType(type);
  if (!typeKey) return { ok: false, reason: 'unknown_type', notice: 'No reference layout exists for this aircraft type.' };

  const wanted = ticketedCabin == null ? null : normalizeCabin(ticketedCabin);
  if (ticketedCabin != null && !wanted) return { ok: false, reason: 'unknown_cabin', notice: 'Unrecognized cabin class.' };

  const carrierKey = typeof carrier === 'string' && /^[A-Z0-9]{2}$/.test(carrier.toUpperCase()) ? carrier.toUpperCase() : null;
  const defaultLayout = TYPE_LAYOUTS[typeKey];
  const carrierVariant = carrierKey && TYPE_LAYOUT_VARIANTS[`${carrierKey} ${typeKey}`] ? TYPE_LAYOUT_VARIANTS[`${carrierKey} ${typeKey}`] : null;
  const typeVariant = TYPE_LAYOUT_VARIANTS[`* ${typeKey}`] || null;

  const candidates = [
    carrierVariant && { layout: carrierVariant, source: 'carrier-variant' },
    typeVariant && { layout: typeVariant, source: 'type-variant' },
    { layout: defaultLayout, source: 'default' },
  ].filter(Boolean);

  let chosen = wanted ? candidates.find(c => layoutHasCabin(c.layout, wanted)) ?? null : null;
  let missingCabin = null;
  if (!chosen) {
    // No reference layout includes the ticketed cabin. Fall back to the layout
    // with the closest lower cabin tier (stable on candidate precedence) and
    // report the gap — never present a lower cabin as the ticketed one.
    chosen = candidates.slice().sort((a, b) => bestRankBelow(b.layout, wanted) - bestRankBelow(a.layout, wanted))[0];
    missingCabin = wanted;
  }

  const notice = missingCabin
    ? `No reference layout for this aircraft type includes ${missingCabin}; showing the closest available layout. Layout is a generic type reference — not verified for this airline.`
    : 'Layout is a generic type reference — not verified for this airline.';

  return {
    ok: true,
    typeKey,
    typeName: TYPE_NAMES[typeKey],
    carrier: carrierKey,
    tier: TYPE_REFERENCE,
    source: chosen.source,
    containsTicketedCabin: wanted == null ? null : missingCabin == null,
    missingCabin,
    cabins: chosen.layout.cabins,
    notice,
  };
}
