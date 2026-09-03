import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const patcher = path.join(root, 'scripts', 'patch-production-worker-d1-cross-advisory.mjs');
const source = path.join(root, 'backend', 'worker.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'storm-worker-alpha4-'));
const output = path.join(tmp, 'worker.alpha4.js');

execFileSync(process.execPath, [patcher, source, output], { stdio: 'pipe' });
execFileSync(process.execPath, ['--check', output], { stdio: 'pipe' });

const patched = fs.readFileSync(output, 'utf8');
assert.match(patched, /const VERSION = '3\.3\.0-alpha\.4';/);
assert.match(patched, /const normalizedAnalysis = asArray\(data\.positions\)/);
assert.match(patched, /const latestAnalysis = normalizedAnalysis\.reduce/);
assert.match(patched, /latestAnalysis \? \[\{ \.\.\.latestAnalysis, sourceOrder: 0 \}\] : \[\]/);
assert.match(patched, /const currentParser = row\?\.parser_version === VERSION \? 1 : 0;/);
assert.doesNotMatch(patched, /Number\(row\?\.point_count \|\| 0\) \* 1000/);
assert.match(patched, /a\.issued_at<=\? AND p\.point_type='analysis'/);
assert.match(patched, /const seenAnalysisTimes = new Set\(\);/);
assert.match(patched, /const forecastPoints = \(currentPointResult\.results \|\| \[\]\)/);
assert.match(patched, /const points = \[\.\.\.normalizedAnalysis, \.\.\.normalizedForecast\];/);
assert.doesNotMatch(patched, /const VERSION = '3\.3\.0-alpha\.3';/);

const makeStart = patched.indexOf('function makeCollectedStorm(data) {');
const makeEnd = patched.indexOf('function parseCycloneList(xmlText) {', makeStart);
const makeBlock = patched.slice(makeStart, makeEnd);
assert.match(makeBlock, /latestAnalysis/);
assert.doesNotMatch(makeBlock, /points: \[\.\.\.normalizedAnalysis, \.\.\.forecast\]/);
assert.match(makeBlock, /points: \[\.\.\.analysis, \.\.\.forecast\]/);

// Execute the exact generated makeCollectedStorm() body with minimal stubs.
// A bulletin carrying three historical analysis fixes must persist only the
// latest analysis plus all as-issued forecast points.
const sandbox = {
  result: null,
  asArray: value => Array.isArray(value) ? value : (value == null ? [] : [value]),
  normalizePoint: (point, type, order) => ({
    pointType: type,
    validAt: point.time,
    forecastHour: point.forecastHour ?? null,
    latitude: point.lat,
    longitude: point.lon,
    sourceOrder: order,
    windRadii: point.windRadii || []
  }),
  normalizeIsoTime: value => value || null,
  yearFromTime: () => 2026,
  normalizeInternationalNumber: value => value || null
};
vm.createContext(sandbox);
vm.runInContext(`${makeBlock}\nresult = makeCollectedStorm({
  agency: 'CMA', sourceId: '2622', bulletinTime: '2026-09-03T00:00:00.000Z', year: 2026,
  positions: [
    { time: '2026-09-02T12:00:00.000Z', lat: 10, lon: 120 },
    { time: '2026-09-02T18:00:00.000Z', lat: 11, lon: 121 },
    { time: '2026-09-03T00:00:00.000Z', lat: 12, lon: 122 }
  ],
  forecast: [
    { time: '2026-09-03T06:00:00.000Z', lat: 13, lon: 123, forecastHour: 6 },
    { time: '2026-09-03T12:00:00.000Z', lat: 14, lon: 124, forecastHour: 12 }
  ]
});`, sandbox);

assert.equal(sandbox.result.points.length, 3);
assert.equal(sandbox.result.points.filter(point => point.pointType === 'analysis').length, 1);
assert.equal(sandbox.result.points[0].validAt, '2026-09-03T00:00:00.000Z');
assert.deepEqual(Array.from(sandbox.result.points, point => point.sourceOrder), [0, 1, 2]);
assert.equal(sandbox.result.points.filter(point => point.pointType === 'forecast').length, 2);

console.log('production worker D1 alpha.4 patcher: ok');
