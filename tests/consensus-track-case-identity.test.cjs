'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-case-identity-'));
const observations = path.join(tempRoot, 'observations', '2026', '08', '23');
fs.mkdirSync(observations, { recursive: true });

function record({ schemaVersion, capturedAt, fingerprint, key, displayName, nameEn = null, sourceReferences = null, lat, lon }) {
  return {
    schemaVersion,
    capturedAt,
    captureFingerprint: fingerprint,
    groups: [{
      key,
      displayName,
      nameEn,
      nameTc: null,
      sourceAgencies: ['CMA', 'HKO'],
      ...(sourceReferences ? { sourceReferences } : {}),
      referenceBaseTime: capturedAt,
      samples: [{
        leadHours: 0,
        validTime: capturedAt,
        consensusLat: lat,
        consensusLon: lon
      }]
    }]
  };
}

const oldV1 = record({
  schemaVersion: 'storm-consensus-track-prospective/v1',
  capturedAt: '2026-08-23T00:00:00.000Z',
  fingerprint: 'a'.repeat(64),
  key: 'TROPICALDEPRESSION',
  displayName: '熱帶低氣壓 (Tropical Depression)',
  lat: 15.0,
  lon: 125.0
});
const genericV2 = record({
  schemaVersion: 'storm-consensus-track-prospective/v2',
  capturedAt: '2026-08-23T03:00:00.000Z',
  fingerprint: 'b'.repeat(64),
  key: 'TROPICALDEPRESSION',
  displayName: '熱帶低氣壓 (Tropical Depression)',
  sourceReferences: {
    HKO: { agency: 'HKO', sourceId: '2624', currentTime: '2026-08-23T03:00:00Z' },
    CMA: { agency: 'CMA', sourceId: 'WP2624', currentTime: '2026-08-23T03:00:00Z' }
  },
  lat: 15.4,
  lon: 124.7
});
const namedV2 = record({
  schemaVersion: 'storm-consensus-track-prospective/v2',
  capturedAt: '2026-08-23T06:00:00.000Z',
  fingerprint: 'c'.repeat(64),
  key: 'TESTNAMED',
  displayName: '測試命名 (TESTNAMED)',
  nameEn: 'TESTNAMED',
  sourceReferences: {
    HKO: { agency: 'HKO', sourceId: '2624', currentTime: '2026-08-23T06:00:00Z' },
    CMA: { agency: 'CMA', sourceId: 'WP2624', currentTime: '2026-08-23T06:00:00Z' }
  },
  lat: 15.8,
  lon: 124.3
});

fs.writeFileSync(path.join(observations, '0000-a.json'), JSON.stringify(oldV1));
fs.writeFileSync(path.join(observations, '0300-b.json'), JSON.stringify(genericV2));
fs.writeFileSync(path.join(observations, '0600-c.json'), JSON.stringify(namedV2));

const summary = JSON.parse(execFileSync(process.execPath, [
  'scripts/reconcile-consensus-track-case-identities.mjs',
  tempRoot
], { cwd: repoRoot, encoding: 'utf8' }));

assert.equal(summary.schemaVersion, 'storm-case-identity/v1');
assert.equal(summary.identityAdapterVersion, 'consensus-track-case-identity-adapter/v1');
assert.equal(summary.recordCount, 3);
assert.equal(summary.caseCount, 1, 'generic-to-named continuity should remain one case');
assert.equal(summary.indexCount, 3);
assert.deepEqual(summary.cases[0].groupKeys, ['TESTNAMED', 'TROPICALDEPRESSION']);
assert.deepEqual(summary.cases[0].sourceTokens, ['CMA:WP2624', 'HKO:2624']);

const registry = JSON.parse(fs.readFileSync(path.join(tempRoot, 'case-registry.json'), 'utf8'));
assert.equal(registry.caseCount, 1);
assert.equal(registry.identityAdapterVersion, 'consensus-track-case-identity-adapter/v1');

const index = fs.readFileSync(path.join(tempRoot, 'case-index.ndjson'), 'utf8')
  .trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
assert.equal(index.length, 3);
assert.equal(new Set(index.map(item => item.caseId)).size, 1);
assert.equal(index[0].resolution.reason, 'new-case');
assert.equal(index[1].resolution.reason, 'physical-continuity');
assert.equal(index[2].resolution.reason, 'source-id-overlap');
assert.equal(index.every(item => item.identityAdapterVersion === 'consensus-track-case-identity-adapter/v1'), true);
assert.equal(JSON.stringify(index).includes('consensusLat'), false);
assert.equal(JSON.stringify(index).includes('consensusLon'), false);

console.log('consensus-track case identity tests: OK');
