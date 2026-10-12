import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airlineOption, itineraryAirlines, listedAirlineCount, listedAirlineCodes } from '../airline-directory.js';
import { access } from 'node:fs/promises';

test('marketing carriers across regions resolve only to candidate airline homepages', () => {
  assert.ok(listedAirlineCount >= 50);
  for (const code of ['AA', 'LH', 'QR', 'SQ', 'FR', '6E', 'ET', 'LA']) {
    const option = airlineOption(code);
    assert.equal(option.carrier, code);
    assert.equal(option.level, 'homepage_unverified');
    const url = new URL(option.url);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.pathname, '/');
    assert.equal(url.search, '');
    assert.ok(url.hostname.includes('.'));
  }
});

test('unknown and untrusted input cannot turn into an outbound URL', () => {
  for (const value of ['ZZ', 'AA.evil.com', 'AA?to=https://evil.com', 'javascript:alert(1)', null, '']) {
    const option = airlineOption(value);
    assert.equal(option.url, null);
    assert.equal(option.level, 'unsupported');
  }
});

test('only marketing carriers in itinerary order appear, once each; codeshares do not add an airline', () => {
  const options = itineraryAirlines([
    { carrier: 'LH', op: 'UA' }, { carrier: 'LH' }, { carrier: 'AA' }, { carrier: 'ZZ' },
  ]);
  assert.deepEqual(options.map(o => o.carrier), ['LH', 'AA', 'ZZ']);
  assert.equal(options.at(-1).url, null);
  assert.deepEqual(itineraryAirlines([]), []);
});


test('every declared local logo exists and missing logos use an honest code fallback', async () => {
  for(const code of listedAirlineCodes){
    const option=airlineOption(code);
    if(option.logoUrl){
      assert.match(option.logoUrl,new RegExp(`^/assets/airline-logos/${code}\.svg$`));
      await access(new URL('..'+option.logoUrl,import.meta.url));
    }
  }
  assert.equal(airlineOption('VY').logoUrl,null);
  assert.equal(airlineOption('AA').logoUrl,'/assets/airline-logos/AA.svg');
});
