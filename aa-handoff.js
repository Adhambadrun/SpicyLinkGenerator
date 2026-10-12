// Preserves the repository's historical AA metasearch handoff. A generated URL is
// NOT proof of a live fare, held seat or successful landing at passenger details.
// The old link's 0.00 field is a protocol placeholder, not a quoted price.

// Airport-local departure times in raw GDS text need a real timezone, not the
// fixed UTC offsets in the app's display database (which ignore daylight saving).
// Additional airports must be mapped to an IANA zone before using the exact link.
const ZONES = Object.freeze({
  JFK:'America/New_York', LGA:'America/New_York', EWR:'America/New_York',
  BOS:'America/New_York', DCA:'America/New_York', IAD:'America/New_York',
  PHL:'America/New_York', CLT:'America/New_York', MIA:'America/New_York',
  ATL:'America/New_York', DTW:'America/New_York', MCO:'America/New_York',
  ORD:'America/Chicago', DFW:'America/Chicago', IAH:'America/Chicago',
  MSP:'America/Chicago', DEN:'America/Denver', PHX:'America/Phoenix',
  LAS:'America/Los_Angeles', LAX:'America/Los_Angeles',
  SFO:'America/Los_Angeles', SEA:'America/Los_Angeles',
  SAN:'America/Los_Angeles', PDX:'America/Los_Angeles',
  HNL:'Pacific/Honolulu', YYZ:'America/Toronto', YVR:'America/Vancouver',
  LHR:'Europe/London', LGW:'Europe/London', CDG:'Europe/Paris',
  FRA:'Europe/Berlin', AMS:'Europe/Amsterdam', MAD:'Europe/Madrid',
  FCO:'Europe/Rome', DUB:'Europe/Dublin', CAI:'Africa/Cairo',
  MEX:'America/Mexico_City', CUN:'America/Cancun',
});

const formatter = zone => new Intl.DateTimeFormat('en-GB', {
  timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit',
  hour:'2-digit', minute:'2-digit', hourCycle:'h23',
});
function localParts(epoch, fmt) {
  return Object.fromEntries(fmt.formatToParts(new Date(epoch))
    .filter(p => p.type !== 'literal').map(p => [p.type, +p.value]));
}

/** Resolve airport-local wall time, rejecting DST gaps and ambiguous repeated hours. */
export function aaDepartureMs(seg) {
  if (Number.isSafeInteger(seg?.depEpochMs)) return seg.depEpochMs;
  if (!/^\d{4}-\d\d-\d\d$/.test(seg?.ymd || '') || !Number.isInteger(seg?.depH) ||
      !Number.isInteger(seg?.depM) || seg.depH < 0 || seg.depH > 23 || seg.depM < 0 || seg.depM > 59)
    throw new Error('AA handoff needs a valid departure date and time.');
  const zone = ZONES[seg.origin];
  if (!zone) throw new Error(`No verified timezone mapping for ${seg.origin}; use a timestamped Matrix JSON or search manually.`);
  const [year, month, day] = seg.ymd.split('-').map(Number);
  const wall = Date.UTC(year, month-1, day, seg.depH, seg.depM);
  if (new Date(wall).toISOString().slice(0,16) !== `${seg.ymd}T${String(seg.depH).padStart(2,'0')}:${String(seg.depM).padStart(2,'0')}`)
    throw new Error('Invalid calendar date for AA handoff.');
  const fmt = formatter(zone);
  // Every real UTC offset is within 14 hours. Search offsets by 15 min to support
  // regions with fractional offsets, and require exactly one matching instant.
  const matches = [];
  for (let minutes=-14*60; minutes<=14*60; minutes+=15) {
    const epoch = wall-minutes*60000;
    const p = localParts(epoch,fmt);
    if (p.year===year && p.month===month && p.day===day && p.hour===seg.depH && p.minute===seg.depM)
      matches.push(epoch);
  }
  if (matches.length!==1) throw new Error('Ambiguous or nonexistent airport-local departure time; use a timestamped Matrix JSON.');
  return matches[0];
}

/** Builds the existing AA flight-selection attempt, for AA-marketed legs ONLY.
 *  This does not verify the endpoint or a fare; live browser validation is required.
 */
export function buildAAMetasearchUrl(segments, passengers) {
  if (!Array.isArray(segments) || segments.length<1 || segments.length>12 ||
      segments.some(s => s?.carrier!=='AA' || !/^\d{1,4}$/.test(String(s?.num)) ||
        !/^[A-Z]{3}$/.test(s?.origin||'') || !/^[A-Z]{3}$/.test(s?.dest||'') ||
        !/^[A-Z]$/.test(s?.cls||'')))
    throw new Error('AA exact-flight handoff requires 1–12 valid AA-marketed segments.');
  const keys=['adults','seniors','children','infantsInSeat','youths','infantsInLap'];
  if (!passengers || keys.some(k => !Number.isInteger(passengers[k]) || passengers[k]<0 || passengers[k]>9) ||
      passengers.adults+passengers.seniors+passengers.youths < 1 ||
      passengers.infantsInLap>passengers.adults+passengers.seniors+passengers.youths)
    throw new Error('AA handoff requires valid passenger counts and an adult for each lap infant.');
  const p = passengers;
  const pax=`A${p.adults}S${p.seniors}C${p.children}I${p.infantsInSeat}Y${p.youths}L${p.infantsInLap}`;
  let legs='', flights='';
  segments.forEach((s,i) => {
    const epoch=aaDepartureMs(s);
    legs+=`#${s.origin}|${s.dest}|0|0|${epoch}`;
    flights+=`#${s.carrier}|${s.num}|${s.cls}|${s.origin}|${s.dest}|${epoch}|${i}`;
  });
  const first=segments[0];
  const parts=['DIRECT','0','US',segments.length===1?'oneWay':'multi','4',pax,'0',first.origin,'0',first.dest,
    '0','0','0','0','0','0','0','0.00','1',legs,flights];
  return 'https://www.aa.com/goto/metasearch?ITEN='+encodeURIComponent(parts.join(','));
}
