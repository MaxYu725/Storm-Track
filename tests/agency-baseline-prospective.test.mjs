import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildAgencyBaselineProspective } from '../scripts/build-agency-baseline-prospective.mjs';

const require = createRequire(import.meta.url);
const core = require('../analysis/storm-analysis-core.js');

function fixture(capturedAt = '2026-08-23T08:00:00Z', changedLon = 130.5) {
  return {
    schemaVersion: 'storm-agency-baseline-capture/v0',
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
      sources: {
        HKO: {
          sourceId: '2631',
          bulletinTime: '2026-08-23T07:30:00+00:00',
          positions: [
            { time: '2026-08-23T00:00:00Z', lat: 20.0, lon: 131.0 },
            { time: '2026-08-23T06:00:00Z', lat: 20.5, lon: 130.8, maximumWind: 30 },
            { time: '2026-08-23T07:00:00Z', lat: 20.7, lon: 130.7, pressure: 992 },
            { time: 'invalid', lat: 21, lon: 130 }
          ],
          forecast: [
            { kind: 'forecast', time: '2026-08-23T19:00:00Z', baseTime: '2026-08-23T07:00:00Z', forecastHour: 12, lat: 21.8, lon: 129.7 },
            { kind: 'forecast', time: '2026-08-23T13:00:00Z', baseTime: '2026-08-23T07:00:00Z', forecastHour: 6, lat: 21.2, lon: changedLon },
            { kind: 'forecast', time: '2026-08-23T13:00:00Z', baseTime: '2026-08-23T07:00:00Z', forecastHour: 6, lat: 21.2, lon: changedLon },
            { kind: 'forecast', time: '2026-08-24T01:00:00Z', baseTime: '2026-08-23T07:00:00Z', forecastHour: 18, lat: 95, lon: 129 }
          ]
        },
        CMA: {
          sourceId: '3308554',
          bulletinTime: '2026-08-23T07:00:00Z',
          positions: [
            { time: '2026-08-23T07:00:00Z', lat: 20.6, lon: 130.9 }
          ],
          forecast: [
            { time: '2026-08-23T13:00:00Z', baseTime: '2026-08-23T07:00:00Z', forecastHour: 6, lat: 21.0, lon: 130.1 }
          ]
        }
      }
    }]
  };
}

const registry = {
  schemaVersion: 'storm-case-identity/v1',
  identityAdapterVersion: 'consensus-track-case-identity-adapter/v1',
  reconciledThrough: '2026-08-23T07:46:08.509Z',
  cases: [{
    caseId: 'STC-2026-TEST-12345678',
    sourceTokens: ['HKO:2631', 'CMA:3308554']
  }]
};

const first = buildAgencyBaselineProspective(fixture(), {
  registry,
  sourceCommit: 'commit-a',
  targetUrl: 'https://example.invalid/?beta=hk-signal'
});
const second = buildAgencyBaselineProspective(fixture('2026-08-23T08:15:00Z'), {
  registry,
  sourceCommit: 'commit-b',
  targetUrl: 'https://example.invalid/?beta=hk-signal'
});
const changed = buildAgencyBaselineProspective(fixture('2026-08-23T08:15:00Z', 130.4), {
  registry,
  sourceCommit: 'commit-b',
  targetUrl: 'https://example.invalid/?beta=hk-signal'
});

assert.equal(first.schemaVersion, 'storm-agency-baseline-prospective/v1');
assert.equal(first.recordCount, 2);
assert.equal(first.captureFingerprint.length, 64);
assert.equal(first.captureFingerprint, second.captureFingerprint, 'capture metadata must not change evidence fingerprint');
assert.notEqual(first.captureFingerprint, changed.captureFingerprint, 'forecast coordinate change must change evidence fingerprint');
assert.equal(first.sourceCommit, 'commit-a');
assert.equal(first.caseRegistry.reconciledThrough, '2026-08-23T07:46:08.509Z');

const hko = first.records.find(item => item.agency === 'HKO');
assert.ok(hko);
assert.equal(hko.caseIdAtCapture, 'STC-2026-TEST-12345678');
assert.equal(hko.caseIdentityStateAtCapture, 'resolved-source-token');
assert.equal(hko.sourceToken, 'HKO:2631');
assert.equal(hko.bulletinTime, '2026-08-23T07:30:00.000Z');
assert.equal(hko.analysis.validTime, '2026-08-23T07:00:00.000Z', 'only latest valid analysis point is persisted');
assert.equal(hko.analysis.lat, 20.7);
assert.equal(hko.analysis.lon, 130.7);
assert.equal(hko.forecastBaseTime, '2026-08-23T07:00:00.000Z');
assert.equal(hko.forecastPointCount, 2, 'duplicate and invalid forecast points are excluded');
assert.deepEqual(hko.forecast.map(point => point.validTime), [
  '2026-08-23T13:00:00.000Z',
  '2026-08-23T19:00:00.000Z'
]);
assert.equal(hko.forecast[0].lat, 21.2);
assert.equal(hko.forecast[0].lon, 130.5);
assert.equal(hko.forecast[0].origin, 'forecast');
assert.equal(hko.forecast[0].forecastHour, 6);

const reconstructedSources = Object.fromEntries(first.records.map(record => [record.agency, {
  agency: record.agency,
  sourceId: record.sourceId,
  bulletinTime: record.bulletinTime,
  positions: record.analysis ? [{
    kind: record.analysis.kind,
    time: record.analysis.validTime,
    baseTime: record.analysis.baseTime,
    forecastHour: record.analysis.forecastHour,
    lat: record.analysis.lat,
    lon: record.analysis.lon
  }] : [],
  forecast: record.forecast.map(point => ({
    kind: point.kind,
    time: point.validTime,
    baseTime: point.baseTime,
    forecastHour: point.forecastHour,
    lat: point.lat,
    lon: point.lon
  }))
}]));
const reconstructedTrack = core.buildConsensusTrackForGroup({
  key: 'TEST',
  displayName: '測試風暴 (TEST)',
  sources: reconstructedSources
}, { generatedAt: '2026-08-23T08:00:00Z' });
const lead6 = reconstructedTrack.points.find(point => point.leadHours === 6);
assert.ok(lead6?.consensus, 'persisted baseline must be sufficient to rebuild valid-time consensus contributions');
assert.equal(lead6.validTime, '2026-08-23T13:00:00.000Z');
assert.deepEqual(lead6.agencies, ['HKO', 'CMA']);
assert.deepEqual(lead6.entries.map(entry => entry.provenance), ['exact-forecast', 'exact-forecast']);
assert.ok(Math.abs(lead6.consensus.lat - 21.1) < 1e-9);
assert.ok(Math.abs(lead6.consensus.lon - 130.3) < 1e-9);

const unresolved = buildAgencyBaselineProspective({
  ...fixture(),
  groups: [{
    ...fixture().groups[0],
    sources: {
      JMA: {
        sourceId: 'TC9999',
        bulletinTime: '2026-08-23T07:00:00Z',
        positions: [{ time: '2026-08-23T06:00:00Z', lat: 18, lon: 140 }],
        forecast: [{ time: '2026-08-24T06:00:00Z', lat: 19, lon: 138 }]
      }
    }
  }]
}, { registry });
assert.equal(unresolved.records[0].caseIdAtCapture, null);
assert.equal(unresolved.records[0].caseIdentityStateAtCapture, 'unresolved-source-token');
assert.equal(unresolved.records[0].forecastPointCount, 1, 'unresolved case identity must not discard forecast evidence');

assert.equal(first.semantics.asIssuedAgencyCoordinatesPersisted, true);
assert.equal(first.semantics.latestAnalysisPointPersisted, true);
assert.equal(first.semantics.forecastPointsPersisted, true);
assert.equal(first.semantics.historicalAnalysisTrackPersisted, false);
assert.equal(first.semantics.verificationTruthPersisted, false);
assert.equal(first.semantics.forecastSkillEvaluated, false);
assert.equal(first.semantics.agencyRankingProduced, false);
assert.equal(first.semantics.consensusAlgorithmModified, false);
assert.equal(first.semantics.hkSignalModified, false);
assert.equal(first.semantics.productionDatabaseWritten, false);
assert.equal(first.semantics.immutableEvidenceIntended, true);

const serialized = JSON.stringify(first);
assert.equal(serialized.includes('maximumWind'), false, 'non-track fields must not persist');
assert.equal(serialized.includes('pressure'), false, 'non-track fields must not persist');
assert.equal(serialized.includes('verificationTruth'), true, 'semantics may describe truth exclusion');
assert.equal(serialized.includes('consensusLat'), false);
assert.equal(serialized.includes('rawInput'), false);

console.log('agency baseline prospective tests: OK');
