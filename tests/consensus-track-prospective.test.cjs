'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prospective-'));
const inputPath = path.join(tempDir, 'dry-run.json');

function build(capturedAt, sourceCommit) {
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
      displayName: 'Test Storm',
      sourceAgencies: ['HKO', 'CMA'],
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

const first = build('2026-08-23T01:00:00.000Z', 'commit-a');
const second = build('2026-08-23T01:15:00.000Z', 'commit-b');

assert.equal(first.schemaVersion, 'storm-consensus-track-prospective/v1');
assert.equal(first.captureFingerprint.length, 64);
assert.equal(first.captureFingerprint, second.captureFingerprint, 'capture time and source commit must not affect dedupe fingerprint');
assert.equal(first.sourceCommit, 'commit-a');
assert.equal(first.groupCount, 1);
assert.equal(first.groups[0].samples.length, 2);
assert.equal(first.groups[0].samples[0].consensusLat, 20.1);
assert.equal(first.groups[0].samples[0].consensusLon, 130.2);
assert.deepEqual(first.groups[0].samples[0].agencies, ['CMA', 'HKO']);
assert.equal(first.groups[0].samples[1].provenanceByAgency.HKO, 'analysis-to-forecast-interpolation');
assert.equal(first.semantics.rawInputsPersisted, false);
assert.equal(first.semantics.individualAgencyCoordinatesPersisted, false);
assert.equal(first.semantics.derivedConsensusCoordinatesPersisted, true);
assert.equal(first.semantics.forecastSkillEvaluated, false);
assert.equal(first.semantics.probabilityCalibrated, false);

const serialized = JSON.stringify(first);
assert.equal(serialized.includes('rawInput'), false);
assert.equal(serialized.includes('mustNotPersist'), false);
assert.equal(serialized.includes('entries'), false);
assert.equal(serialized.includes('"lat":1'), false);
assert.equal(serialized.includes('"lon":2'), false);

console.log('consensus-track prospective tests: OK');
