// Regression tests for the GDS line parser.
// The parser is extracted straight out of app.html (and asserted to be identical in
// deploy-kit/app.html) so these tests always cover the code that actually ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

function loadParser(file) {
  const html = readFileSync(join(root, file), 'utf8');
  const start = html.indexOf('/* ================= parser ================= */');
  const end = html.indexOf('/* ================= JSON builder ================= */');
  assert.ok(start > -1 && end > start, `parser block not found in ${file}`);
  const fn = new Function('MONTHS', html.slice(start, end) +
    '; return {normalizeLine,parseTime,tryParseLine,parseSegments,unparsedLines};');
  return fn(MONTHS);
}

const P = loadParser('app.html');
const PD = loadParser('deploy-kit/app.html');

test('app.html and deploy-kit/app.html parsers are identical', () => {
  for (const name of ['parseTime', 'tryParseLine', 'parseSegments']) {
    assert.equal(PD[name].toString(), P[name].toString(), `${name} drifted between app.html and deploy-kit`);
  }
});

const bugLine = '1   AA 136   I 11MAY   LAX LHR   435P 1105A\u20211'; // ...1105A‡1

test('bug report line with ‡1 next-day marker parses', () => {
  const s = P.tryParseLine(bugLine);
  assert.ok(s, 'line was rejected as unrecognized');
  assert.equal(s.carrier, 'AA');
  assert.equal(s.num, '136');
  assert.equal(s.cls, 'I');
  assert.equal(s.origin, 'LAX');
  assert.equal(s.dest, 'LHR');
  assert.deepEqual([s.depH, s.depM], [16, 35]);
  assert.deepEqual([s.arrH, s.arrM], [11, 5]);
  assert.equal(s.plus, true, '‡1 must mark next-day arrival');
});

test('plain segments still parse (PR #8 regression: bare flight number stolen as time)', () => {
  const s = P.tryParseLine('2   AA 135   I 27MAY   LHR LAX   425P 735P');
  assert.ok(s, 'plain line was rejected');
  assert.equal(s.num, '135');
  assert.deepEqual([s.depH, s.depM], [16, 25]);
  assert.deepEqual([s.arrH, s.arrM], [19, 35]);
  assert.equal(s.plus, false);
});

test('all three bug-report lines parse, none is unparsed', () => {
  const input = [
    '1   AA 136   I 11MAY   LAX LHR   435P 1105A\u20211',
    '2   AA 135   I 27MAY   LHR LAX   425P 735P',
    '3   AA*9396  I 28MAY   SEA YYC   557P 827P',
  ].join('\n');
  const segs = P.parseSegments(input);
  assert.equal(segs.length, 3);
  assert.deepEqual(segs.map(s => s.carrier + s.num).sort(), ['AA135', 'AA136', 'AA9396']);
  assert.deepEqual(P.unparsedLines(input), []);
  const s136 = segs.find(s => s.num === '136');
  assert.equal(s136.plus, true);
});

test('next-day marker variants: lowercase meridiem, +1, †, *, bare 1, 5-digit, separate token', () => {
  const base = (arrival) => P.tryParseLine('1   AA 136   I 11MAY   LAX LHR   435P ' + arrival);
  for (const arrival of ['1105a\u20211', '1105A+1', '1105A\u20201', '1105A*', '1105A1', '11051', '11:05A\u20211']) {
    const s = base(arrival);
    assert.ok(s, `arrival ${JSON.stringify(arrival)} rejected`);
    assert.deepEqual([s.arrH, s.arrM], [11, 5], `arrival ${JSON.stringify(arrival)} time wrong`);
    assert.equal(s.plus, true, `arrival ${JSON.stringify(arrival)} lost next-day flag`);
  }
  const sep = P.tryParseLine('1   AA 136   I 11MAY   LAX LHR   435P 1105A +1');
  assert.ok(sep);
  assert.equal(sep.plus, true);
});

test('times that merely end in 1 are not mangled by marker stripping', () => {
  for (const [tok, h, m] of [['1101', 11, 1], ['2301', 23, 1], ['131P', 13, 31], ['11:01A', 11, 1]]) {
    assert.deepEqual(P.parseTime(tok), [h, m], `parseTime(${JSON.stringify(tok)})`);
  }
  const s = P.tryParseLine('2   AA 135   I 27MAY   LHR LAX   1101A 1101');
  assert.ok(s);
  assert.deepEqual([s.depH, s.depM], [11, 1]);
  assert.deepEqual([s.arrH, s.arrM], [11, 1]);
  assert.equal(s.plus, false, 'plain 1101 arrival must NOT be flagged next-day');
});

test('military times without meridiem still work, 4-digit flight numbers excluded', () => {
  const s = P.tryParseLine('1   AA 1105   J 11MAY   JFK LHR   2245 0610\u20211');
  assert.ok(s, 'military-time line rejected');
  assert.equal(s.num, '1105'); // the 4-digit flight number must not be eaten as the departure time
  assert.deepEqual([s.depH, s.depM], [22, 45]);
  assert.deepEqual([s.arrH, s.arrM], [6, 10]);
  assert.equal(s.plus, true);
});

test('full-width and zero-width character noise from email pastes is normalized', () => {
  const s = P.tryParseLine('1   AA 136   I 11MAY   LAX LHR   435P 1105A\uFF0B1\u200B'); // ＋1 + zero-width space
  assert.ok(s);
  assert.deepEqual([s.arrH, s.arrM], [11, 5]);
  assert.equal(s.plus, true);
});

test('garbage segment-like line is still reported as not recognized', () => {
  assert.equal(P.tryParseLine('1   ZZ 99   ? 99XXX   --- ---   hello world'), null);
  assert.deepEqual(P.unparsedLines('1   ZZ 99   ? 99XXX   --- ---   hello world'),
    ['1   ZZ 99   ? 99XXX   --- ---   hello world']);
});
