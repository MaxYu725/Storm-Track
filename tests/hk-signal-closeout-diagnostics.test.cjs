'use strict';

const assert = require('node:assert/strict');
const closeout = require('../analysis/hk-signal-closeout.js');

function row({ capturedAt, fingerprint, likelihood, sourceAgencies, sources, representativeMinimumTime }) {
  return {
    capturedAt,
    captureFingerprint: fingerprint,
    observation: {
      group: { key: 'NARRA', displayName: '紫檀 (NARRA)' },
      sourceAgencies,
      sources,
      analysis: {
        threatAssessment: {
          summary: {
            representativeMinimum: { time: representativeMinimumTime }
          }
        },
        basicForecast: {
          signals: {
            T1: {
              likelihood,
              riskIndex: likelihood === 'likely' ? 0.72 : 0.44,
              confidenceIndex: 0.5,
              persistenceHours: likelihood === 'unlikely' ? 0 : 6,
              estimatedWindow: null
            }
          }
        }
      }
    }
  };
}

assert.equal(closeout.TERMINAL_STALE_HOURS, 12);

const possibleOnly = closeout.summarizeNegativeForecast([
  row({
    capturedAt: '2026-08-22T01:00:00Z',
    fingerprint: 'p0',
    likelihood: 'possible',
    sourceAgencies: ['HKO', 'CMA', 'JMA', 'CWA'],
    sources: {
      HKO: { bulletinTime: '2026-08-22T00:30:00Z', forecastCount: 4 },
      CMA: { bulletinTime: '2026-08-22T00:00:00Z', forecastCount: 4 },
      JMA: { bulletinTime: '2026-08-22T00:00:00Z', forecastCount: 4 },
      CWA: { bulletinTime: '2026-08-22T00:00:00Z', forecastCount: 4 }
    },
    representativeMinimumTime: '2026-08-25T00:00:00Z'
  })
], 'T1', '2026-08-23T00:00:00Z');

assert.equal(possibleOnly.classification, 'stable-false-alarm');
assert.equal(possibleOnly.severityClassification, 'possible-only-false-alarm');
assert.equal(possibleOnly.positiveSnapshotCount, 1);
assert.equal(possibleOnly.possibleSnapshotCount, 1);
assert.equal(possibleOnly.likelySnapshotCount, 0);
assert.deepEqual(possibleOnly.likelihoodCounts, { unlikely: 0, possible: 1, likely: 0, unknown: 0 });

const mixed = closeout.summarizeNegativeForecast([
  row({
    capturedAt: '2026-08-25T00:00:00Z',
    fingerprint: 'm0',
    likelihood: 'possible',
    sourceAgencies: ['HKO', 'CMA', 'JMA', 'CWA'],
    sources: {
      HKO: { bulletinTime: '2026-08-24T23:30:00Z', forecastCount: 4, current: { intensity: 'Tropical Storm' } },
      CMA: { bulletinTime: '2026-08-24T23:00:00Z', forecastCount: 4, current: { intensity: 'TS' } },
      JMA: { bulletinTime: '2026-08-24T23:00:00Z', forecastCount: 4, current: { intensity: 'TS' } },
      CWA: { bulletinTime: '2026-08-24T23:00:00Z', forecastCount: 4, current: { intensity: '輕度颱風' } }
    },
    representativeMinimumTime: '2026-08-26T00:00:00Z'
  }),
  row({
    capturedAt: '2026-08-25T06:00:00Z',
    fingerprint: 'm1',
    likelihood: 'likely',
    sourceAgencies: ['HKO', 'CMA', 'JMA'],
    sources: {
      HKO: { bulletinTime: '2026-08-25T05:30:00Z', forecastCount: 3, current: { intensity: 'Tropical Storm' } },
      CMA: { bulletinTime: '2026-08-25T05:00:00Z', forecastCount: 3, current: { intensity: 'TS' } },
      JMA: { bulletinTime: '2026-08-25T05:00:00Z', forecastCount: 3, current: { intensity: 'TS' } }
    },
    representativeMinimumTime: '2026-08-25T18:00:00Z'
  }),
  row({
    capturedAt: '2026-08-26T22:00:00Z',
    fingerprint: 'm2',
    likelihood: 'possible',
    sourceAgencies: ['HKO'],
    sources: {
      HKO: { bulletinTime: '2026-08-26T02:00:00Z', forecastCount: 0, current: { intensity: 'Low Pressure Area' } }
    },
    representativeMinimumTime: '2026-08-26T06:00:00Z'
  })
], 'T1', '2026-08-27T00:00:00Z');

assert.equal(mixed.classification, 'stable-false-alarm');
assert.equal(mixed.severityClassification, 'likely-involved-false-alarm');
assert.equal(mixed.positiveSnapshotCount, 3);
assert.equal(mixed.possibleSnapshotCount, 2);
assert.equal(mixed.likelySnapshotCount, 1);
assert.equal(mixed.firstLikelyAt, '2026-08-25T06:00:00Z');
assert.equal(mixed.lastLikelyAt, '2026-08-25T06:00:00Z');
assert.equal(mixed.terminalResidualSnapshotCount, 1);
assert.equal(mixed.firstTerminalResidualAt, '2026-08-26T22:00:00Z');
assert.equal(mixed.finalPreClose.diagnostics.sourceAgencyCount, 1);
assert.equal(mixed.finalPreClose.diagnostics.forecastPointAgencyCount, 0);
assert.equal(mixed.finalPreClose.diagnostics.representativeMinimumInPast, true);
assert.equal(mixed.finalPreClose.diagnostics.freshestBulletinAgeHours, 20);
assert.equal(mixed.finalPreClose.diagnostics.terminalResidualCandidate, true);
assert.equal(mixed.finalPreClose.diagnostics.currentIntensityByAgency.HKO, 'Low Pressure Area');

const negative = closeout.summarizeNegativeForecast([
  row({
    capturedAt: '2026-08-22T01:00:00Z',
    fingerprint: 'n0',
    likelihood: 'unlikely',
    sourceAgencies: ['HKO'],
    sources: { HKO: { bulletinTime: '2026-08-22T00:30:00Z', forecastCount: 0 } },
    representativeMinimumTime: '2026-08-21T00:00:00Z'
  })
], 'T1', '2026-08-23T00:00:00Z');
assert.equal(negative.classification, 'correct-negative');
assert.equal(negative.severityClassification, 'correct-negative');
assert.equal(negative.positiveSnapshotCount, 0);
assert.equal(negative.terminalResidualSnapshotCount, 0, 'terminal diagnostics must not turn an unlikely forecast into a false alarm');

console.log('hk signal closeout diagnostics tests: OK');
