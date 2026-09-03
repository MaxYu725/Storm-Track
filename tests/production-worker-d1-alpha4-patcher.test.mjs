import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
assert.match(patched, /a\.issued_at<=\? AND p\.point_type='analysis'/);
assert.match(patched, /const seenAnalysisTimes = new Set\(\);/);
assert.match(patched, /const forecastPoints = \(currentPointResult\.results \|\| \[\]\)/);
assert.match(patched, /const points = \[\.\.\.normalizedAnalysis, \.\.\.normalizedForecast\];/);
assert.doesNotMatch(patched, /const VERSION = '3\.3\.0-alpha\.3';/);

// The persisted advisory shape must no longer write the entire upstream
// analysis history on every bulletin. Raw upstream documents remain unchanged.
const makeStart = patched.indexOf('function makeCollectedStorm(data) {');
const makeEnd = patched.indexOf('function parseCycloneList(xmlText) {', makeStart);
const makeBlock = patched.slice(makeStart, makeEnd);
assert.match(makeBlock, /latestAnalysis/);
assert.doesNotMatch(makeBlock, /points: \[\.\.\.normalizedAnalysis, \.\.\.forecast\]/);
assert.match(makeBlock, /points: \[\.\.\.analysis, \.\.\.forecast\]/);

console.log('production worker D1 alpha.4 patcher: ok');
