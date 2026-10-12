import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseMatrixInput } from '../booking-tools.js';
import { airlineOption, itineraryAirlines } from '../airline-directory.js';
import { resolveAirlineLink } from '../airline-links.js';

function makeFixture(carriers=['AA']) {
  return JSON.stringify({itinerary:{slices:carriers.map((carrier,i)=>({segments:[{
    carrier,flightNumber:String(i+123),origin:i?'LAX':'JFK',destination:i?'SFO':'LAX',bookingCode:'K',
    departureTime:i?'2026-11-13T09:30:00-08:00':'2026-11-12T15:45:00-05:00',
    arrivalTime:i?'2026-11-13T11:00:00-08:00':'2026-11-12T19:00:00-08:00',
  }]}))}});
}
function mockElement(){return {value:'',textContent:'',disabled:false,hidden:false,dataset:{},style:{},children:[],attrs:{},events:{},scrollHeight:56,
  classList:{add(){},remove(){}},
  addEventListener(name,fn){this.events[name]=fn;},
  replaceChildren(...nodes){this.children=nodes;},appendChild(node){this.children.push(node);},
  setAttribute(name,value){this.attrs[name]=value;},focus(){},contains(node){return this.children.includes(node);},
};}
function historicalAAUrl(carriers) {
  const segments=carriers.map((carrier,i)=>({
    carrier,num:String(i+123),origin:i?'LAX':'JFK',dest:i?'SFO':'LAX',cls:'K',
    ymd:i?'2026-11-13':'2026-11-12',depH:i?9:15,depM:i?30:45,
  }));
  const offsets={JFK:-300,LAX:-480};
  const unixMs=s=>{
    const [y,m,d]=s.ymd.split('-').map(Number),off=offsets[s.origin];
    return Date.UTC(y,m-1,d,s.depH-Math.trunc(off/60),s.depM-(off%60));
  };
  const paxStr='A1S0C0I0Y0L0';
  let legs='';for(const s of segments)legs+='#'+s.origin+'|'+s.dest+'|0|0|'+unixMs(s);
  let flights='';for(let i=0;i<segments.length;i++){const s=segments[i];flights+='#'+s.carrier+'|'+s.num+'|'+(s.cls||'Y')+'|'+s.origin+'|'+s.dest+'|'+unixMs(s)+'|'+i;}
  const first=segments[0];
  const parts=['DIRECT','0','US',segments.length===1?'oneWay':'multi','4',paxStr,'0',first.origin,'0',first.dest,
    '0','0','0','0','0','0','0','0.00','1',legs,flights];
  return 'https://www.aa.com/goto/metasearch?ITEN='+encodeURIComponent(parts.join(','));
}
async function app({nowIso='2026-10-12T12:00:00Z'}={}) {
  const html=await readFile(new URL('../app.html',import.meta.url),'utf8');
  const match=html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(match,'app logic must be a module so its imports actually run');
  for(const path of ['/booking-tools.js','/airline-directory.js','/airline-links.js'])
    assert.ok(match[1].includes(`from "${path}"`),`missing ${path} import`);
  assert.doesNotMatch(html,/quote-age|quote time|quote-time|quote-status|assessQuote/i);
  assert.doesNotMatch(html,/4 · Airlines on this itinerary/);
  const script=match[1].replace(/^import .*;\s*$/gm,'');
  const elements=new Map();
  const document={getElementById(id){if(!elements.has(id))elements.set(id,mockElement());return elements.get(id);},
    createElement:mockElement,body:{appendChild(){}},querySelector:()=>mockElement()};
  const opened=[],copied=[];
  const window={open:(url)=>opened.push(url),addEventListener(){}};
  class FixedDate extends Date {
    constructor(...args){super(...(args.length?args:[nowIso]));}
    static now(){return new Date(nowIso).getTime();}
  }
  const context=vm.createContext({document,window,parseMatrixInput,airlineOption,itineraryAirlines,
    resolveAirlineLink,navigator:{clipboard:{writeText:async text=>copied.push(text)}},
    localStorage:{getItem:()=> '1',setItem(){}},setInterval(){},setTimeout(){},
    TextEncoder,Date:FixedDate,URL,console});
  vm.runInContext(script,context,{filename:'app.html'});
  return {elements,document,window,opened,copied};
}

test('AA only: Generate copies and opens the original metasearch URL; Copy uses that same URL', async () => {
  const {elements,window,opened,copied}=await app();
  const expected=historicalAAUrl(['AA']);
  elements.get('gds').value=makeFixture(['AA']);
  await window.openSelectedLink();
  assert.deepEqual(opened,[expected]);
  assert.deepEqual(copied,[expected]);
  await window.copyLink();
  assert.deepEqual(copied,[expected,expected]);
  assert.equal(new URL(opened[0]).pathname,'/goto/metasearch');
  assert.equal(elements.get('generate-link').textContent,'Open AA metasearch link');
  const picker=elements.get('airline-picker');
  assert.equal(picker.children[0].className,'airline-single');
  assert.ok(picker.children[0].children[0].children[0].src.endsWith('/AA.svg'));
});

test('mixed itinerary: selecting AA generates and copies the original URL with every leg', async () => {
  const {elements,window,opened,copied}=await app();
  const expectedAA=historicalAAUrl(['AA','DL']);
  elements.get('gds').value=makeFixture(['AA','DL']);
  await window.openSelectedLink();
  await window.copyLink();
  assert.equal(opened[0],expectedAA);
  assert.deepEqual(copied.slice(0,2),[expectedAA,expectedAA]);
  const payload=new URL(opened[0]).searchParams.get('ITEN');
  assert.match(payload,/#AA\|123\|K\|JFK\|LAX\|\d+\|0/);
  assert.match(payload,/#DL\|124\|K\|LAX\|SFO\|\d+\|1/);

  const picker=elements.get('airline-picker');
  assert.equal(picker.children[0].className,'airline-dropdown');
  const menu=picker.children[0].children[1];
  assert.equal(menu.children.length,2);
  assert.equal(menu.children[1].children[0].children[0].src,'/assets/airline-logos/DL.svg');
  menu.children[1].events.click();
  await window.openSelectedLink();
  await window.copyLink();
  assert.equal(opened[1],copied[2]);
  assert.equal(new URL(opened[1]).hostname,'www.delta.com');
  assert.equal(new URL(opened[1]).pathname,'/');
  assert.match(elements.get('link-note').textContent,/Multiple marketing/);
});

test('6-leg mixed BA/AA GDS itinerary parses in order across 2026->2027, BA falls back clearly for 3-slice multi-city, and all 6 legs are preserved for AA', async () => {
  const gds=[
    '1 BA 323J 30OCT F CDGLHR SS1   705A  735A /DCBA /E',
    '2 AA 731I 30OCT F LHRCLT*SS1   955A  250P /DCAA /E',
    '3 AA2615I 30OCT F CLTMSY*SS1   453P  600P /DCAA /E',
    '4 AA1917I 31OCT J MIASTI SS1  1205P  215P /DCAA /E',
    '5 AA1770O 21JAN Q STIMIA*SS1   720A  846A /DCAA /E',
    '6 AA 112O 21JAN Q MIABCN*SS1   415P  705A  22JAN F /DCAA /E',
  ].join('\n');

  for (const nowIso of ['2026-10-12T12:00:00Z', '2026-01-10T12:00:00Z']) {
    const {elements,window,opened,copied}=await app({nowIso});
    elements.get('gds').value=gds;
    // Leg 1 is BA, so BA is selected initially. 6 legs collapse to 3 O&D slices
    // (CDG-MSY, MIA-STI, STI-BCN), which BA's offer search cannot prove it accepts
    // (AA_ACCEPTANCE.md), so the app falls back to the clearly labeled BA homepage.
    await window.openSelectedLink();
    await window.copyLink();
    assert.equal(elements.get('warn').textContent,'');
    const outText=elements.get('out').textContent;
    assert.match(outText,/PARSED 6 SEGMENTS · 1 adult/);
    const segmentLines=outText.split('\n').filter(line=>line.startsWith('  '));
    assert.deepEqual(segmentLines,[
      '  BA323     J BUSINESS         CDG->LHR  2026-10-30  07:05 -> 07:35',
      '  AA731     I BUSINESS         LHR->CLT  2026-10-30  09:55 -> 14:50  MARRIED',
      '  AA2615    I BUSINESS         CLT->MSY  2026-10-30  16:53 -> 18:00  MARRIED',
      '  AA1917    I BUSINESS         MIA->STI  2026-10-31  12:05 -> 14:15',
      '  AA1770    O ECONOMY          STI->MIA  2027-01-21  07:20 -> 08:46  MARRIED',
      '  AA112     O ECONOMY          MIA->BCN  2027-01-21  16:15 -> 07:05 (+1)  MARRIED',
    ]);

    assert.equal(opened[0],'https://www.britishairways.com/');
    assert.equal(copied[0],'https://www.britishairways.com/');
    assert.equal(elements.get('generate-link').textContent,'Visit British Airways website');
    assert.match(elements.get('link-note').textContent,/one-way and round-trip only/);
    assert.match(elements.get('link-note').textContent,/3 O&D slices/);
    assert.match(elements.get('link-note').textContent,/unusable/);
    assert.match(elements.get('link-note').textContent,/not a selected flight/);

    // Switch dropdown from BA (option 0) to AA (option 1).
    const menu=elements.get('airline-picker').children[0].children[1];
    assert.equal(menu.children.length,2);
    menu.children[1].events.click();
    assert.equal(elements.get('generate-link').textContent,'Open AA metasearch link');

    await window.openSelectedLink();
    await window.copyLink();
    const aaUrl=opened[1];
    assert.equal(copied[1],aaUrl);
    assert.equal(copied[2],aaUrl);
    assert.equal(new URL(aaUrl).origin,'https://www.aa.com');
    assert.equal(new URL(aaUrl).pathname,'/goto/metasearch');
    assert.doesNotMatch(aaUrl,/search-journey-id|cid=|passenger-ui/i);
    const iten=new URL(aaUrl).searchParams.get('ITEN');
    assert.match(iten,/^DIRECT,0,US,multi,4,A1S0C0I0Y0L0,0,CDG,0,LHR,/);
    assert.match(iten,/#BA\|323\|J\|CDG\|LHR\|1793340300000\|0#AA\|731\|I\|LHR\|CLT\|1793354100000\|1#AA\|2615\|I\|CLT\|MSY\|1793397180000\|2#AA\|1917\|I\|MIA\|STI\|1793466300000\|3#AA\|1770\|O\|STI\|MIA\|1800516000000\|4#AA\|112\|O\|MIA\|BCN\|1800566100000\|5$/);
  }
});

test('1-leg BA-only GDS itinerary falls back to the clearly labeled BA homepage (processOffer BLOCKED in real browsers)', async () => {
  const {elements,window,opened,copied}=await app();
  elements.get('gds').value='1 BA 323J 30OCT F CDGLHR SS1   705A  735A /DCBA /E';
  await window.openSelectedLink();
  await window.copyLink();
  // Real-browser runs on 2026-10-12 hung forever on BA's "calculating your price" page for
  // this shape, so the app must not hand users the processOffer URL at all.
  assert.deepEqual(opened,['https://www.britishairways.com/']);
  assert.deepEqual(copied,['https://www.britishairways.com/']);
  assert.equal(elements.get('generate-link').textContent,'Visit British Airways website');
  const note=elements.get('link-note').textContent;
  assert.match(note,/unusable/);
  assert.match(note,/calculating your price/);
  assert.match(note,/2026-10-12/);
  assert.match(note,/not a selected flight/);
  assert.doesNotMatch(opened[0],/processOffer|search-journey-id|cid=|passenger-ui/i);
});

test('round-trip BA-only GDS itinerary also falls back to the BA homepage, never a processOffer link', async () => {
  const {elements,window,opened,copied}=await app();
  elements.get('gds').value=[
    '1 BA 323J 30OCT F CDGLHR SS1   705A  735A /DCBA /E',
    '2 BA 324J 06NOV F LHRCDG SS1   840A 1105A /DCBA /E',
  ].join('\n');
  await window.openSelectedLink();
  await window.copyLink();
  assert.deepEqual(opened,['https://www.britishairways.com/']);
  assert.deepEqual(copied,['https://www.britishairways.com/']);
  assert.equal(elements.get('generate-link').textContent,'Visit British Airways website');
  assert.match(elements.get('link-note').textContent,/unusable/);
  assert.doesNotMatch(opened[0],/processOffer|search-journey-id|cid=|passenger-ui/i);
});
