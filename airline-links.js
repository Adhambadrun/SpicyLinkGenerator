// One decision point for BOTH Generate and Copy. AA uses the historical metasearch
// handoff; the app supplies its verbatim legacy builder so mixed itineraries keep every
// leg. Other carriers use unverified prefills or their directory homepage.
import { airlineOption, itineraryAirlines } from './airline-directory.js';
import { buildAAMetasearchUrl } from './aa-handoff.js';

function counts(p) {
  if(!p)return null;
  const adults=(p.adults||0)+(p.seniors||0)+(p.youths||0);
  const children=(p.children||0)+(p.infantsInSeat||0);
  const infants=p.infantsInLap||0;
  if (![adults,children,infants].every(n => Number.isInteger(n) && n>=0 && n<=9) || adults<1 || infants>adults)
    return null;
  return {adults,children,infants,total:adults+children+infants};
}
function shape(segs) {
  if(segs.length===1)return 'oneWay';
  if(segs.length===2 && segs[0].origin===segs[1].dest && segs[0].dest===segs[1].origin)
    return 'roundTrip';
  return null; // Connections and multi-city must not be truncated into a direct search.
}
function searchUrl(code,segs,p) {
  const c=counts(p), type=shape(segs);
  if (!c || !type || !segs.every(s=>/^\d{4}-\d\d-\d\d$/.test(s.ymd))) return null;
  const first=segs[0];
  if(code==='DL') {
    const u=new URL('https://www.delta.com/flight-search/book-a-flight');
    u.searchParams.set('tripType',type==='oneWay'?'ONE_WAY':'ROUND_TRIP');
    u.searchParams.set('originCity',first.origin);
    u.searchParams.set('destinationCity',first.dest);
    u.searchParams.set('departureDate',first.ymd);
    u.searchParams.set('paxCount',String(c.total));
    if(type==='roundTrip')u.searchParams.set('returnDate',segs[1].ymd);
    return u.href;
  }
  if(code==='UA') {
    const u=new URL('https://www.united.com/en/us/fsr/choose-flights');
    u.searchParams.set('f',first.origin);u.searchParams.set('t',first.dest);
    u.searchParams.set('d',first.ymd);u.searchParams.set('tt',type==='roundTrip'?'2':'1');
    u.searchParams.set('at',String(c.total));u.searchParams.set('px',String(c.total));
    // Do not infer cabin from a single RBD letter for another carrier.
    if(type==='roundTrip')u.searchParams.set('r',segs[1].ymd);
    return u.href;
  }
  // BA's legacy processOffer?onds=... builder in app.html omits flight numbers, carriers,
  // booking classes, departure times, and connection airports, collapses mixed cabins, and
  // has not been verified on britishairways.com. Keep BA on the homepage fallback until tested.
  return null;
}

/** Returns a descriptive outbound link, never a fabricated fare or session. */
export function resolveAirlineLink(segments, selectedCarrier, passengers, {buildAAUrl=buildAAMetasearchUrl}={}) {
  const options=itineraryAirlines(segments);
  const option=options.find(o=>o.carrier===selectedCarrier);
  if (!option) return {url:null,kind:'unsupported',label:'No airline selected',note:'Choose a carrier in this itinerary.'};
  if (!option.url) return {url:null,kind:'unsupported',label:`${option.name} · no link`,note:'No airline website is listed. Search manually.'};
  const fallback=(reason)=>({url:option.url,kind:'homepage',label:`Visit ${option.name} website`,
    note:`${reason} This opens a homepage, not a selected flight or live fare.`});
  if (selectedCarrier==='AA') {
    try {
      return {url:buildAAUrl(segments,passengers),kind:'aa_handoff',
        label:'Open AA metasearch link',
        note:'The historical AA metasearch URL includes every itinerary leg; non-AA-marketed flights may not be pinned, and no live fare is verified.'};
    } catch(e) { return fallback(`AA handoff cannot safely encode this itinerary: ${e.message}`); }
  }
  if (options.length!==1) return fallback('Multiple marketing carriers: a single airline may not sell this entire itinerary.');
  const url=searchUrl(selectedCarrier,segments,passengers);
  if(url)return {url,kind:'search_unverified',label:`Search ${option.name}`,
    note:'Experimental search prefill. Flight numbers, fare and passenger form are NOT guaranteed; confirm everything on the airline website.'};
  return fallback('No tested airline-specific handoff is available yet.');
}
