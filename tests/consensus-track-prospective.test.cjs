'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prospective-'));
const inputPath = path.join(tempDir, 'dry-run.json');

function build(capturedAt, sourceCommit, hkoSourceId = 'HKO-TEST') {
  const fixture = {
    schemaVersion: 'storm-consensus-track-dry-run/v0',
    capturedAt,
    pageTitle: 'Storm Track fixture',
    sourceStates: [
      { agency: 'HKO', state: 'ok' },
      { agency: 'CMA', state: 'ok' }
    ],
    visibleGroupKeys: ['TEST'],
    groups: [{
      key: 'TEST',
      displayName: '測試風暴 (TEST)',
      nameTc: '測試風暴',
      nameEn: 'TEST',
      sourceAgencies: ['HKO', 'CMA'],
      sourceReferences: {
        HKO: {
          agency: 'HKO',
          sourceId: hkoSourceId,
          bulletinTime: '2026-08-23T00:10:00Z',
          currentTime: '2026-08-23T00:00:00Z',
          forecastBaseTime: '2026-08-23T00:00:00Z',
          forecastFirstValidTime: '2026-08-23T06:00:00Z',
          forecastLastValidTime: '2026-08-25T00:00:00Z',
          positionCount: 4,
          forecastCount: 8,
          lat: 99,
          lon: 88
        },
        CMA: {
          agency: 'CMA',
          sourceId: 'CMA-TEST',
          bulletinTime: '2026-08-23T00:05:00Z',
          currentTime: '2026-08-23T00:00:00Z',
          forecastBaseTime: '2026-08-23T00:00:00Z',
          forecastFirstValidTime: '2026-08-23T06:00:00Z',
          forecastLastValidTime: '2026-08-24T18:00:00Z',
          positionCount: 5,
          forecastCount: 7
        }
      },
      trackSchemaVersion: 'storm-consensus-track/v0',
      state: 'ok',
      referenceAgency: 'HKO',
      referenceBaseTime: '2026-08-23T00:00:00.000Z',
      referenceMethod: 'latest-analysis-valid-time',
      configuredHorizonHours: 120,
      stepHours: 6,
      consensusPointCount: 2,
      supportedThroughHours: 6,
      continuousConsensusThroughHours: 6,
      rawInput: { mustNotPersist: true },
      samples: [
        {
          leadHours: 0,
          validTime: '2026-08-23T00:00:00.000Z',
          agencyCount: 2,
          agencies: ['HKO', 'CMA'],
          interpolatedAgencyCount: 0,
          provenanceByAgency: { HKO: 'exact-analysis', CMA: 'exact-analysis' },
          consensusLat: 20.1,
          consensusLon: 130.2,
          spreadKm: 30.4,
          entries: [{ lat: 1, lon: 2 }]
        },
        {
          leadHours: 6,
          validTime: '2026-08-23T06:00:00.000Z',
          agencyCount: 2,
          agencies: ['CMA', 'HKO'],
          interpolatedAgencyCount: 1,
          provenanceByAgency: {
            CMA: 'exact-forecast',
            HKO: 'analysis-to-forecast-interpolation'
          },
          consensusLat: 20.5,
          consensusLon: 129.5,
          spreadKm: 42.1
        },
        {
          leadHours: 12,
          validTime: '2026-08-23T12:00:00.000Z',
          agencyCount: 1,
          agencies: ['HKO'],
          interpolatedAgencyCount: 0,
          provenanceByAgency: { HKO: 'exact-forecast' },
          consensusLat: null,
          consensusLon: null,
          spreadKm: null
        }
      ]
    }]
  };
  fs.writeFileSync(inputPath, JSON.stringify(fixture));
  return JSON.parse(execFileSync(process.execPath, [
    'scripts/build-consensus-track-prospective.mjs',
    inputPath
  ], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      SOURCE_COMMIT: sourceCommit,
      STORM_BETA_URL: 'https://example.invalid/?beta=hk-signal'
    }
  }));
}

function hasObjectKey(value, key) {
  if (Array.isArray(value)) return value.some(item => hasObjectKey(item, key));
  if (!value || typeof value !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  return Object.values(value).some(item => hasObjectKey(item, key));
}

const first = build('2026-08-23T01:00:00.000Z', 'commit-a');
const second = build('2026-08-23T01:15:00.000Z', 'commit-b');
const changedReference = build('2026-08-23T01:15:00.000Z', 'commit-b', 'HKO-TEST-NEW');

assert.equal(first.schemaVersion, 'storm-consensus-track-prospective/v2');
assert.equal(first.captureFingerprint.length, 64);
assert.equal(first.captureFingerprint, second.captureFingerprint, 'capture time and source commit must not affect dedupe fingerprint');
assert.notEqual(first.captureFingerprint, changedReference.captureFingerprint, 'source reference changes must create new prospective evidence');
assert.equal(first.sourceCommit, 'commit-a');
assert.equal(first.groupCount, 1);
assert.equal(first.groups[0].nameTc, '測試風暴');
assert.equal(first.groups[0].nameEn, 'TEST');
assert.equal(first.groups[0].sourceReferences.HKO.sourceId, 'HKO-TEST');
assert.equal(first.groups[0].sourceReferences.HKO.forecastBaseTime, '2026-08-23T00:00:00Z');
assert.equal(first.groups[0].sourceReferences.HKO.positionCount, 4);
assert.equal(first.groups[0].sourceReferences.HKO.forecastCount, 8);
assert.equal(first.groups[0].samples.length, 3);
assert.equal(first.groups[0].samples[0].consensusLat, 20.1);
assert.equal(first.groups[0].samples[0].consensusLon, 130.2);
assert.deepEqual(first.groups[0].samples[0].agencies, ['CMA', 'HKO']);
assert.equal(first.groups[0].samples[1].provenanceByAgency.HKO, 'analysis-to-forecast-interpolation');
assert.equal(first.groups[0].samples[2].consensusLat, null);
assert.equal(first.groups[0].samples[2].consensusLon, null);
assert.equal(first.groups[0].samples[2].spreadKm, null);
assert.equal(first.semantics.rawInputsPersisted, false);
assert.equal(first.semantics.individualAgencyCoordinatesPersisted, false);
assert.equal(first.semantics.derivedConsensusCoordinatesPersisted, true);
assert.equal(first.semantics.sourceReferencesPersisted, true);
assert.equal(first.semantics.sourceReferenceCoordinatesPersisted, false);
assert.equal(first.semantics.stableCaseIdentityResolvedSeparately, true);
assert.equal(first.semantics.forecastSkillEvaluated, false);
assert.equal(first.semantics.probabilityCalibrated, false);

assert.equal(hasObjectKey(first, 'rawInput'), false);
assert.equal(hasObjectKey(first, 'entries'), false);
assert.equal(hasObjectKey(first, 'lat'), false);
assert.equal(hasObjectKey(first, 'lon'), false);
assert.equal(JSON.stringify(first).includes('mustNotPersist'), false);
assert.equal(JSON.stringify(first).includes('"lat":99'), false);
assert.equal(JSON.stringify(first).includes('"lon":88'), false);

console.log('consensus-track prospective tests: OK');
