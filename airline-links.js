// One decision point for BOTH Generate and Copy. AA uses the historical metasearch
// handoff. BA gets NO itinerary prefill, because none exists that we can prove:
// real-browser runs on 2026-10-12 (one-way AND round-trip) hung forever on BA's
// "Give us a moment, we're calculating your price" page — outcome BLOCKED in
// AA_ACCEPTANCE.md — and the rendering probes re-run on 2026-10-12 show BA's own
// search form ignores every prefill parameter tried. So every BA shape opens BA's own
// multi-city search form (HTTP 200, form renders instantly, no spinner) with the exact
// itinerary to type spelled out in the note, plus a clearly labeled pre-filled
// third-party search as the alternative. Nothing in this module calls the legacy
// processOffer builder, so an injected URL builder cannot resurrect the blocked link.
// Other carriers use unverified direct-search prefills or their directory homepage.
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
// BA's processOffer handoff is BLOCKED for real users (real-browser runs, 2026-10-12:
// one-way and round-trip both hung forever on BA's "calculating your price" page). The
// gate below is kept so the O&D slice count — and therefore the reason shown to the
// user — is still computed in one place, and so the legacy builder keeps refusing any
// multi-city shape.
const BA_MAX_SLICES=2;
// BA's own multi-city search form. Recorded 2026-10-12 (rendering fetch from this repo's
// probe host, no login, no cookies, search input only): HTTP 200, title "British Airways -
// Multi-city Flight Search", the form renders immediately — no spinner, no redirect — and
// exposes From/To/Date rows with "Remove flight" / "Add another flight", passenger counts
// and a travel-class selector. It IGNORES every prefill parameter probed:
//   ?onds=CDG-LHR_2026-10-30&ad=1&yad=0&ch=0&inf=0&cabin=C&flex=LOWEST&ond=1   (and the
//   2-slice / 3-slice variants, and the same payload as a #fragment)
//   ?tripType=ONE_WAY&from=CDG&to=LHR&departDate=30/10/2026&cabinclass=C&adult=1
// so it can only be handed over EMPTY, with the itinerary to type stated in the note.
const BA_SEARCH_FORM_URL='https://www.britishairways.com/travel/book/public/en_gb/flightSearch';
const BA_NO_PREFILL='BA has no working pre-filled link: the offer-search handoff hangs forever on BA’s “Give us a moment, we’re calculating your price” page (real-browser runs 2026-10-12, AA_ACCEPTANCE.md) and BA’s own search form ignores URL parameters (re-verified 2026-10-12), so it opens EMPTY.';
const BA_CABIN_WORD={F:'first',C:'business',W:'premium economy',M:'economy'};
/** Defence in depth: no BA URL may ever leave this module pointing at the blocked handoff. */
function assertNotBlockedBaHandoff(url) {
  if (/processOffer|search-journey-id|[?&]cid=/i.test(url))
    throw new Error('Refusing to emit a BA URL that is recorded BLOCKED in AA_ACCEPTANCE.md.');
  return url;
}
function baPassengerSummary(passengers) {
  const c=counts(passengers);
  if(!c)return null;
  const parts=[];
  if(c.adults)parts.push(`${c.adults} adult${c.adults===1?'':'s'}`);
  if(c.children)parts.push(`${c.children} child${c.children===1?'':'ren'}`);
  if(c.infants)parts.push(`${c.infants} infant${c.infants===1?'':'s'} on lap`);
  return parts.join(', ');
}
/** "CDG→LHR on 2026-10-30, LHR→CDG on 2026-11-06 (business, 1 adult)" — what to type into BA's form. */
function baItinerarySummary(segments, passengers) {
  if (baSegmentsMalformed(segments)) return null;
  const journeys=baOndJourneys(segments);
  const cabin=BA_CABIN_WORD[baCabinCode(segments)]||'economy';
  const pax=baPassengerSummary(passengers);
  const route=journeys.map(j=>`${j.o}→${j.d} on ${j.date}`).join(', ');
  return `${route} (${cabin}${pax?`, ${pax}`:''})`;
}
function baOndJourneys(segments) {
  const idx=baSliceIndex(segments);
  const journeys=[];let cur=-1;
  for(let i=0;i<segments.length;i++){
    if(idx[i]!==cur){cur=idx[i];journeys.push({o:segments[i].origin,d:segments[i].dest,date:segments[i].ymd});}
    else journeys[journeys.length-1].d=segments[i].dest;
  }
  return journeys;
}
/** Collapsed O&D slices, shared with app.html so the alternative third-party search
 *  pre-fills one slice per row instead of one row per connection leg. */
export function ondSlices(segments) {
  if (baSegmentsMalformed(segments)) return [];
  return baOndJourneys(segments).map(j=>({origin:j.o,dest:j.d,ymd:j.date}));
}
/** O&D slices annotated with each cabin present on their component legs.
 *  Google Flights accepts one cabin per search, so a mixed-cabin connection is
 *  represented in each applicable cabin group instead of silently choosing one. */
export function ondSlicesWithCabin(segments) {
  if (baSegmentsMalformed(segments)) return [];
  const indexes=baSliceIndex(segments);
  const journeys=[];
  for(let i=0;i<segments.length;i++){
    const s=segments[i];
    let journey=journeys[journeys.length-1];
    if(!journey||indexes[i]!==indexes[i-1]){
      journey={origin:s.origin,dest:s.dest,ymd:s.ymd,cabins:[]};
      journeys.push(journey);
    }else{
      journey.dest=s.dest;
    }
    const cabin=segmentCabin(s.carrier,s.cls);
    if(!journey.cabins.includes(cabin))journey.cabins.push(cabin);
  }
  return journeys.flatMap(({origin,dest,ymd,cabins})=>
    cabins.map(cabin=>({origin,dest,ymd,cabin})));
}
function normalizeSearchCabin(value) {
  const cabin=String(value||'').trim().toUpperCase().replace(/[ _]+/g,'-');
  if(cabin==='FIRST'||cabin==='F')return 'FIRST';
  if(cabin==='BUSINESS'||cabin==='C'||cabin==='J')return 'BUSINESS';
  if(cabin==='PREMIUM-COACH'||cabin==='PREMIUM-ECONOMY'||cabin==='W')return 'PREMIUM-COACH';
  if(cabin==='COACH'||cabin==='ECONOMY'||cabin==='M'||cabin==='Y')return 'COACH';
  return null;
}
/** Group cabin-annotated O&D slices into one Google Flights search per cabin.
 *  Passing raw flight segments is also supported; they are collapsed and annotated first. */
export function gfSearchGroups(slicesOrSegments) {
  const input=Array.isArray(slicesOrSegments)?slicesOrSegments:[];
  const annotated=input.every(s=>s&&typeof s==='object'&&typeof s.cabin==='string');
  const slices=annotated?input:ondSlicesWithCabin(slicesOrSegments);
  const groups=new Map();
  for(const slice of slices){
    if(!/^[A-Z]{3}$/.test(slice?.origin||'')||!/^[A-Z]{3}$/.test(slice?.dest||'')||
       !/^\d{4}-\d\d-\d\d$/.test(slice?.ymd||''))continue;
    const cabin=normalizeSearchCabin(slice.cabin);
    if(!cabin)continue;
    if(!groups.has(cabin))groups.set(cabin,{cabin,slices:[]});
    groups.get(cabin).slices.push({origin:slice.origin,dest:slice.dest,ymd:slice.ymd});
  }
  return [...groups.values()];
}
function baSegmentsMalformed(segments) {
  return !Array.isArray(segments) || !segments.length ||
    segments.some(s=>!/^[A-Z]{3}$/.test(s?.origin||'') || !/^[A-Z]{3}$/.test(s?.dest||'') || !/^\d{4}-\d\d-\d\d$/.test(s?.ymd||''));
}
function baUnsupportedSlices(journeys) {
  return journeys.length>BA_MAX_SLICES
    ? `BA’s offer-search handoff supports one-way and round-trip only; this itinerary needs ${journeys.length} O&D slices (multi-city).`
    : null;
}
/** Legacy BA O&D builder, kept ONLY for manual re-probing (tools/ba-live-probe.mjs).
 *  The handoff is BLOCKED for real users (AA_ACCEPTANCE.md, 2026-10-12): both the
 *  one-way and the round-trip link hang forever on BA's processing page. Do NOT wire
 *  this back into resolveAirlineLink until a recorded browser run reaches BA flight
 *  results and the passenger-form benchmark passes.
 */
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
  if (selectedCarrier==='BA') {
    // No BA prefill builder is called: the processOffer handoff is BLOCKED for real users
    // and BA's search form ignores URL parameters, so a third-party or legacy URL builder
    // must never be able to put a "pre-filled BA link" back in the UI. BA gets its own
    // search surface — the one BA page recorded rendering instantly with no spinner — and
    // the note spells out exactly what to type, because the form opens empty.
    const malformed=baSegmentsMalformed(segments);
    const journeys=malformed?[]:baOndJourneys(segments);
    const summary=baItinerarySummary(segments,passengers);
    const enter=journeys.length===1
      ? `Fill “Flight 1” with ${summary} and remove the other rows.`
      : journeys.length===2
        ? `Fill one row per O&D slice — ${summary} — and remove the third row.`
        : `Fill one row per O&D slice${summary?` — ${summary}`:''} (“Add another flight” if you need more rows).`;
    const gate=baUnsupportedSlices(journeys);
    const note=gate
      ? `${BA_NO_PREFILL} ${enter} ${gate} The retained O&D gate still refuses to build an offer-search link for it. No flight is selected and no fare is shown or claimed here.`
      : `${BA_NO_PREFILL} ${enter} No flight is selected and no fare is shown or claimed here.`;
    return {url:assertNotBlockedBaHandoff(BA_SEARCH_FORM_URL),kind:'search_unverified',
      label:'Open BA search form',note,manualEntry:true,
      manualEntryHint:summary?`Type into BA's form: ${summary}`:'Type the itinerary into BA’s form.'};
  }
  if (options.length!==1) return fallback('Multiple marketing carriers: a single airline may not sell this entire itinerary.');
  const url=searchUrl(selectedCarrier,segments,passengers);
  if(url)return {url,kind:'search_unverified',label:`Search ${option.name}`,
    note:'Experimental search prefill. Flight numbers, fare and passenger form are NOT guaranteed; confirm everything on the airline website.'};
  return fallback('No tested airline-specific handoff is available yet.');
}
