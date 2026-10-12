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
async function app() {
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
  const context=vm.createContext({document,window,parseMatrixInput,airlineOption,itineraryAirlines,
    resolveAirlineLink,navigator:{clipboard:{writeText:async text=>copied.push(text)}},
    localStorage:{getItem:()=> '1',setItem(){}},setInterval(){},setTimeout(){},
    TextEncoder,Date,URL,console});
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
