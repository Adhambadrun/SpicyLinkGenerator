// Browser + Node helpers for importing supported Matrix-style itinerary JSON.
const code = (value, length) => {
  const s = typeof value === 'string' ? value : value?.code;
  return typeof s === 'string' && new RegExp(`^[A-Z0-9]{${length}}$`).test(s.toUpperCase()) ? s.toUpperCase() : null;
};
const instant = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(value)) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
};

/** Parse an itinerary with slices[].segments[] (including this app's existing export).
 * Reject unknown shapes rather than dropping legs or inventing missing times/classes.
 * This does not assert BookWithMatrix compatibility for arbitrary third-party JSON.
 */
export function parseMatrixInput(input) {
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected an itinerary JSON object.');
  const slices = data.itinerary?.slices ?? data.slices;
  if (!Array.isArray(slices) || !slices.length) throw new Error('Expected itinerary.slices with at least one slice.');
  const segments = [];
  for (const [sliceIndex, slice] of slices.entries()) {
    if (!Array.isArray(slice?.segments) || !slice.segments.length)
      throw new Error(`Slice ${sliceIndex + 1} has no segments; no legs were imported.`);
    for (const [segmentIndex, seg] of slice.segments.entries()) {
      const where = `Slice ${sliceIndex + 1}, segment ${segmentIndex + 1}`;
      const carrier = code(seg?.carrier ?? seg?.marketingCarrier, 2);
      const op = code(seg?.operatingCarrier, 2) || carrier;
      const num = String(seg?.flight?.number ?? seg?.flightNumber ?? '').trim();
      const origin = code(seg?.origin ?? seg?.departureAirport ?? seg?.legs?.[0]?.origin, 3);
      const dest = code(seg?.destination ?? seg?.arrivalAirport ?? seg?.legs?.at(-1)?.destination, 3);
      const cls = seg?.bookingInfos?.[0]?.bookingCode ?? seg?.bookingCode ?? seg?.rbd;
      const dep = instant(seg?.departure ?? seg?.departureTime ?? seg?.legs?.[0]?.departure);
      const arr = instant(seg?.arrival ?? seg?.arrivalTime ?? seg?.legs?.at(-1)?.arrival);
      if (!carrier || !/^\d{1,4}$/.test(num) || !origin || !dest || !/^[A-Z]$/.test(cls) || !dep || !arr)
        throw new Error(`${where} is missing a valid carrier, flight, airports, booking class or ISO departure/arrival time.`);
      const depSource = seg.departure ?? seg.departureTime ?? seg.legs?.[0]?.departure;
      const arrSource = seg.arrival ?? seg.arrivalTime ?? seg.legs?.at(-1)?.arrival;
      // Avoid silently assuming the visitor's timezone for airport-local times.
      if (!/(Z|[+-]\d\d:\d\d)$/.test(depSource) || !/(Z|[+-]\d\d:\d\d)$/.test(arrSource))
        throw new Error(`${where} needs times with explicit UTC offsets.`);
      if (arr <= dep) throw new Error(`${where} arrives before it departs.`);
      const date = depSource.slice(0, 10);
      const arrDate = arrSource.slice(0, 10);
      const deltaDays = Math.round((Date.parse(arrDate + 'T00:00:00Z') - Date.parse(date + 'T00:00:00Z')) / 86400000);
      if (deltaDays > 1) throw new Error(`${where} arrives more than a day later; review the schedule manually.`);
      segments.push({
        carrier, num, origin, dest, cls, op, married: Boolean(seg.married),
        ymd: date, depEpochMs: dep.getTime(), depH: +depSource.slice(11, 13), depM: +depSource.slice(14, 16),
        arrH: +arrSource.slice(11, 13), arrM: +arrSource.slice(14, 16), plus: deltaDays === 1,
      });
    }
  }
  if (segments.length > 24) throw new Error('More than 24 segments: review this itinerary manually.');
  return { segments, original: data };
}
