'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const v2 = require('../analysis/hk-signal-forecast-v2.js');
const ui = require('../analysis/frontend-hk-threat-ui.js');

assert.equal(v2.VERSION, 'hk-signal-shadow-v2/0.5');
assert.equal(ui.SHADOW_V2_VERSION, v2.VERSION);
assert.equal(ui.TERMINAL_STALE_HOURS, v2.TERMINAL_STALE_HOURS);
assert.equal(typeof ui.buildShadowV2Forecast, 'function');
assert.equal(typeof ui.buildSourceLifecycleContext, 'function');

// Browser integration must synchronously install the dedicated V2 engine while the
// document is still parsing, rather than silently falling back to the retired 0.2
// implementation. The PWA cache keeps the same engine available offline.
{
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'analysis', 'frontend-hk-threat-ui.js'), 'utf8');
  assert.match(source, /installV2Engine\(root\)/);
  assert.match(source, /\.\/analysis\/hk-signal-forecast-v2\.js/);
  assert.match(source, /data-storm-hk-signal-v2/);
}

const generatedAt = '2026-08-31T00:00:00.000Z';
const basicForecast = {
  schemaVersion: 'basic-hk-signal-forecast/v1',
  available: true,
  generatedAt,
  impact: { likelihood: 'possible', closestApproach: { time: '2026-09-02T00:00:00Z', distanceKm: 180 } },
  signals: {
    T1: {
      likelihood: 'likely', riskIndex: .72, confidenceIndex: .51, persistenceHours: 25, estimatedWindow: null,
      strongestCheckpoint: { validTime: '2026-08-31T12:00:00Z', supportAgencyCount: 4, totalAgencyCount: 4 }
    },
    T3: {
      likelihood: 'possible', riskIndex: .453, confidenceIndex: .50, persistenceHours: 3.3, estimatedWindow: null,
      strongestCheckpoint: { validTime: '2026-09-05T23:00:00Z', supportAgencyCount: 1, totalAgencyCount: 1 }
    },
    T8: {
      likelihood: 'unlikely', riskIndex: .18, confidenceIndex: .40, persistenceHours: 0, estimatedWindow: null,
      strongestCheckpoint: { validTime: '2026-09-02T00:00:00Z', supportAgencyCount: 0, totalAgencyCount: 3 }
    }
  }
};
const signalInputs = { coverage: { usableAgencyCount: 4 }, featureVector: { usableAgencyCount: 4 } };
const threatAssessment = {
  summary: { currentDistanceKm: 655, forecastMinimumKm: 388 },
  analyzers: {
    directApproach: { confidence: .54 },
    directDepart: { confidence: .03 },
    reApproach: { confidence: 0 },
    quasiStationary: { confidence: .1 }
  },
  timeline: [
    { leadHours: 12, validTime: '2026-08-31T12:00:00Z', distanceMedianKm: 388 },
    { leadHours: 72, validTime: '2026-09-03T00:00:00Z', distanceMedianKm: 420 },
    { leadHours: 119, validTime: '2026-09-04T23:00:00Z', distanceMedianKm: 260 }
  ]
};
const sourceLifecycle = {
  sourceAgencyCount: 4,
  sourceAgencies: ['CMA', 'CWA', 'HKO', 'JMA'],
  forecastPointTotal: 20,
  terminalStateCandidate: false
};

// The frontend must be a thin integration surface: for identical frozen inputs its
// shadow forecast is exactly the dedicated V2 engine output.
{
  const before = JSON.stringify(basicForecast);
  const expected = v2.buildForecast({ basicForecast, signalInputs, threatAssessment, generatedAt, sourceLifecycle });
  const actual = ui.buildShadowV2Forecast({ basicForecast, signalInputs, threatAssessment, generatedAt, sourceLifecycle });
  assert.deepEqual(actual, expected);
  assert.equal(actual.schemaVersion, 'hk-signal-shadow-v2/0.5');
  assert.equal(actual.semantics.shadowOnly, true);
  assert.equal(actual.semantics.v1RemainsEvaluationBaseline, true);
  assert.equal(JSON.stringify(basicForecast), before, 'live V2 integration must not mutate frozen V1');
}

// Lifecycle evidence must also be delegated to the same engine so recorder and live
// display cannot diverge on terminal/stale semantics.
{
  const group = {
    sources: {
      HKO: {
        bulletinTime: '2026-08-26T15:30:35+08:00',
        positions: [{ time: '2026-08-26T06:00:00Z', intensity: 'Low Pressure Area' }],
        forecast: []
      }
    }
  };
  const observedAt = '2026-08-27T03:31:15.090Z';
  assert.deepEqual(
    ui.buildSourceLifecycleContext(group, observedAt),
    v2.buildSourceLifecycleContext(group, observedAt)
  );
  assert.equal(ui.buildSourceLifecycleContext(group, observedAt).terminalStateCandidate, true);
}

console.log('HK Signal V2 0.5 live-shadow integration tests: OK');
