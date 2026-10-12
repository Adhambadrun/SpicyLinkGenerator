// One decision point for BOTH Generate and Copy. AA uses the historical metasearch
// handoff; BA uses the repository's legacy processOffer O&D builder, but only for the
// shapes BA's public search can represent without a multi-city tool: one O&D slice
// (one-way, connections allowed) or two O&D slices (a return trip). It is clearly
// labeled as unverified because it does not pin flight numbers. Multi-city itineraries
// (3+ O&D slices) fall back to the BA homepage with an explicit reason: live probing
// (see AA_ACCEPTANCE.md) shows the processOffer endpoint answers every input with the
// same "Processing Flight Selection" page, so acceptance of multi-city links cannot be
// proven and must not be assumed. Other carriers use unverified direct-search prefills
// or their directory homepage.
import { airlineOption, itineraryAirlines } from './airline-directory.js';
import { buildAAMetasearchUrl } from './aa-handoff.js';

function counts(p) {
  if(!p)return null;
  const adults=(p.adults||0)+(p.seniors||0)+(p.youths||0);
  const youths=p.youths||0;
  const children=(p.children||0)+(p.infantsInSeat||0);
  const infants=p.infantsInLap||0;
  if (![adults,youths,children,infants].every(n => Number.isInteger(n) && n>=0 && n<=9) || adults<1 || infants>adults)
    return null;
  return {adults,youths,children,infants,total:adults+children+infants};
}
const BA_CABIN_MAP={
  EI:{first:'FA',business:'JCDIZ',premium:'WE'},
  BA:{first:'FA',business:'JCDRI',premium:'WET'},
  AA:{first:'FAP',business:'JCDIR',premium:'W'},
  UA:{first:'FA',business:'JCDZP',premium:'OAR'},
  DL:{first:'FAPG',business:'JCDIZ',premium:'WSY'},
  LH:{first:'FA',business:'JCDZP',premium:'GEN'},
  EK:{first:'FAP',business:'JCDIOR',premium:'WE'},
};
function segmentCabin(carrier,cls) {
  if(!cls)return 'COACH';
  const c=String(cls).toUpperCase()[0];
  const m=BA_CABIN_MAP[carrier];
  if(m){if(m.first.includes(c))return 'FIRST';if(m.business.includes(c))return 'BUSINESS';if(m.premium.includes(c))return 'PREMIUM-COACH';return 'COACH';}
  if('FAP'.includes(c))return 'FIRST';if('JCDIZR'.includes(c))return 'BUSINESS';if('WE'.includes(c))return 'PREMIUM-COACH';return 'COACH';
}
function baCabinCode(segs) {
  const tally={};
  for(const s of segs){const cab=segmentCabin(s.carrier,s.cls);tally[cab]=(tally[cab]||0)+1;}
  let best='COACH',bestCount=-1,bestRank=-1;
  for(const cab of Object.keys(tally)){
    const rank=cab==='FIRST'?3:cab==='BUSINESS'?2:cab==='PREMIUM-COACH'?1:0;
    if(tally[cab]>bestCount||(tally[cab]===bestCount&&rank>bestRank)){bestCount=tally[cab];bestRank=rank;best=cab;}
  }
  return best==='FIRST'?'F':best==='BUSINESS'?'C':best==='PREMIUM-COACH'?'W':'M';
}
function baSliceIndex(segs) {
  const idx=[];let cur=0;
  for(let i=0;i<segs.length;i++){
    if(i>0){
      const p=segs[i-1],s=segs[i];
      const routeBreaks=p.dest!==s.origin;
      const pa=new Date(p.ymd+'T00:00:00Z');pa.setUTCDate(pa.getUTCDate()+(p.plus?1:0));pa.setUTCHours(p.arrH||0,p.arrM||0,0,0);
      const dp=new Date(s.ymd+'T00:00:00Z');dp.setUTCHours(s.depH||0,s.depM||0,0,0);
      const gap=(dp-pa)/60000;
      if(routeBreaks||gap>1440)cur++;
    }
    idx.push(cur);
  }
  return idx;
}
// BA's public search links are only offered for one-way and return-trip shapes. The
// endpoint's processing page looks identical for valid, multi-city and even invalid
// input, so acceptance of 3+ O&D slices is unprovable and must not be emitted.
const BA_MAX_SLICES=2;
function baOndJourneys(segments) {
  const idx=baSliceIndex(segments);
  const journeys=[];let cur=-1;
  for(let i=0;i<segments.length;i++){
    if(idx[i]!==cur){cur=idx[i];journeys.push({o:segments[i].origin,d:segments[i].dest,date:segments[i].ymd});}
    else journeys[journeys.length-1].d=segments[i].dest;
  }
  return journeys;
}
function baSegmentsMalformed(segments) {
  return !Array.isArray(segments) || !segments.length ||
    segments.some(s=>!/^[A-Z]{3}$/.test(s?.origin||'') || !/^[A-Z]{3}$/.test(s?.dest||'') || !/^\d{4}-\d\d-\d\d$/.test(s?.ymd||''));
}
function baUnsupportedSlices(journeys) {
  return journeys.length>BA_MAX_SLICES
    ? `BA offer-search links support one-way and round-trip only; this itinerary needs ${journeys.length} O&D slices (multi-city). Search the full itinerary directly on ba.com.`
    : null;
}
export function buildBAProcessOfferUrl(segments, passengers) {
  const c=counts(passengers);
  if (!c || baSegmentsMalformed(segments))
    throw new Error('BA processOffer URL requires valid segments and passenger counts.');
  const journeys=baOndJourneys(segments);
  const unsupported=baUnsupportedSlices(journeys);
  if (unsupported) throw new Error(unsupported);
  const onds=journeys.map(j=>`${j.o}-${j.d}_${j.date}`).join(',');
  return `https://www.britishairways.com/travel/book/public/en_gb/processOffer?onds=${onds}`+
    `&ad=${c.adults}&yad=${c.youths}&ch=${c.children}&inf=${c.infants}`+
    `&cabin=${baCabinCode(segments)}&flex=LOWEST&ond=${journeys.length}`;
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
  return null;
}

/** Returns a descriptive outbound link, never a fabricated fare or session. */
export function resolveAirlineLink(segments, selectedCarrier, passengers, {buildAAUrl=buildAAMetasearchUrl, buildBAUrl=buildBAProcessOfferUrl}={}) {
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
  if (selectedCarrier==='BA') {
    try {
      if (!baSegmentsMalformed(segments)) {
        const unsupported=baUnsupportedSlices(baOndJourneys(segments));
        if (unsupported) return fallback(unsupported);
      }
      const url=buildBAUrl(segments,passengers);
      if (!url) throw new Error('empty BA URL');
      return {url,kind:'search_unverified',
        label:'Open BA offer search',
        note:'The legacy BA processOffer URL encodes O&D slices, dates, cabin and passengers only; flight numbers and non-BA legs are NOT preselected, and no live fare is verified.'};
    } catch(e) { return fallback(`BA handoff cannot safely encode this itinerary: ${e.message}`); }
  }
  if (options.length!==1) return fallback('Multiple marketing carriers: a single airline may not sell this entire itinerary.');
  const url=searchUrl(selectedCarrier,segments,passengers);
  if(url)return {url,kind:'search_unverified',label:`Search ${option.name}`,
    note:'Experimental search prefill. Flight numbers, fare and passenger form are NOT guaranteed; confirm everything on the airline website.'};
  return fallback('No tested airline-specific handoff is available yet.');
}
