import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseMatrixInput, assessQuote } from '../booking-tools.js';
import { airlineOption, itineraryAirlines } from '../airline-directory.js';
import { buildAAMetasearchUrl } from '../aa-handoff.js';
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
async function app() {
  const html=await readFile(new URL('../app.html',import.meta.url),'utf8');
  const match=html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(match,'app logic must be a module so its imports actually run');
  for(const path of ['/booking-tools.js','/airline-directory.js','/aa-handoff.js','/airline-links.js'])
    assert.ok(match[1].includes(`from "${path}"`),`missing ${path} import`);
  assert.doesNotMatch(html,/4 · Airlines on this itinerary/);
  const script=match[1].replace(/^import .*;\s*$/gm,'');
  const elements=new Map();
  const document={getElementById(id){if(!elements.has(id))elements.set(id,mockElement());return elements.get(id);},
    createElement:mockElement,body:{appendChild(){}},querySelector:()=>mockElement()};
  const opened=[],copied=[];
  const window={open:(url)=>opened.push(url),addEventListener(){}};
  const context=vm.createContext({document,window,parseMatrixInput,assessQuote,airlineOption,itineraryAirlines,
    buildAAMetasearchUrl,resolveAirlineLink,navigator:{clipboard:{writeText:async text=>copied.push(text)}},
    localStorage:{getItem:()=> '1',setItem(){}},setInterval(){},setTimeout(){},
    TextEncoder,Date,URL,console});
  vm.runInContext(script,context,{filename:'app.html'});
  return {elements,document,window,opened,copied};
}

test('AA only: no dropdown, generate and copy use the exact same historical AA link', async () => {
  const {elements,window,opened,copied}=await app();
  elements.get('gds').value=makeFixture(['AA']);
  window.openSelectedLink();
  await window.copyLink();
  assert.equal(opened.length,1);
  assert.equal(opened[0],copied[0]);
  assert.equal(new URL(opened[0]).pathname,'/goto/metasearch');
  assert.equal(elements.get('generate-link').textContent,'Open AA exact-flight link');
  const picker=elements.get('airline-picker');
  assert.equal(picker.children[0].className,'airline-single');
  assert.ok(picker.children[0].children[0].children[0].src.endsWith('/AA.svg'));
});

test('mixed itinerary: dropdown choice changes BOTH generate and copy to that airline only', async () => {
  const {elements,window,opened,copied}=await app();
  elements.get('gds').value=makeFixture(['AA','DL']);
  window.openSelectedLink();
  await window.copyLink();
  assert.equal(opened[0],copied[0]);
  assert.equal(new URL(opened[0]).hostname,'www.aa.com');
  const picker=elements.get('airline-picker');
  assert.equal(picker.children[0].className,'airline-dropdown');
  const menu=picker.children[0].children[1];
  assert.equal(menu.children.length,2);
  assert.equal(menu.children[1].children[0].children[0].src,'/assets/airline-logos/DL.svg');
  menu.children[1].events.click();
  window.openSelectedLink();
  await window.copyLink();
  assert.equal(opened[1],copied[1]);
  assert.equal(new URL(opened[1]).hostname,'www.delta.com');
  assert.equal(new URL(opened[1]).pathname,'/'); // no invented joint cart
  assert.match(elements.get('link-note').textContent,/Multiple marketing/);
});
