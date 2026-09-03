'use strict';

const assert = require('node:assert/strict');
const ui = require('../analysis/frontend-hk-threat-ui.js');

function baseForecast(overrides = {}) {
  return {
    schemaVersion: 'basic-hk-signal-forecast/v1',
    available: true,
    generatedAt: '2026-08-31T00:00:00.000Z',
    impact: {
      likelihood: 'possible',
      closestApproach: { time: '2026-09-02T00:00:00.000Z', distanceKm: 180 },
      forecastMinimumMayBeHorizonLimited: true
    },
    signals: {
      T1: {
        likelihood: 'possible',
        riskIndex: 0.42,
        confidenceIndex: 0.50,
        persistenceHours: 6,
        estimatedWindow: null,
        strongestCheckpoint: {
          validTime: '2026-09-01T12:00:00.000Z',
          supportAgencyCount: 2,
          totalAgencyCount: 2
        }
      },
      T3: {
        likelihood: 'possible',
        riskIndex: 0.453,
        confidenceIndex: 0.313,
        persistenceHours: 3.3,
        estimatedWindow: null,
        strongestCheckpoint: {
          validTime: '2026-09-05T23:00:00.000Z',
          supportAgencyCount: 1,
          totalAgencyCount: 1
        }
      },
      T8: {
        likelihood: 'unlikely',
        riskIndex: 0.18,
        confidenceIndex: 0.30,
        persistenceHours: 0,
        estimatedWindow: null,
        strongestCheckpoint: {
          validTime: '2026-09-02T00:00:00.000Z',
          supportAgencyCount: 0,
          totalAgencyCount: 3
        }
      }
    },
    semantics: { officialHkoForecast: false },
    ...overrides
  };
}

function inputs(usableAgencyCount) {
  return {
    coverage: { usableAgencyCount },
    featureVector: { usableAgencyCount }
  };
}

assert.equal(typeof ui.buildShadowV2Forecast, 'function');
assert.equal(typeof ui.buildSourceLifecycleContext, 'function');
assert.equal(ui.SHADOW_V2_VERSION, 'hk-signal-shadow-v2/0.2');
assert.equal(ui.TERMINAL_STALE_HOURS, 12);

// SAUDEL-style long-horizon support concentration: a T3 possible state driven by a
// lone +119h checkpoint is continuously discounted, not hard-gated. T1 is not given
// the strong-signal horizon discount so broad early advisory sensitivity is retained.
{
  const v1 = baseForecast();
  const before = JSON.stringify(v1);
  const v2 = ui.buildShadowV2Forecast({
    basicForecast: v1,
    signalInputs: inputs(4),
    threatAssessment: {
      analyzers: { directDepart: { confidence: 0.05 } },
      timeline: [{ leadHours: 24 }, { leadHours: 72 }, { leadHours: 119 }]
    },
    generatedAt: v1.generatedAt
  });

  assert.equal(v2.schemaVersion, ui.SHADOW_V2_VERSION);
  assert.equal(v2.baseForecastSchemaVersion, 'basic-hk-signal-forecast/v1');
  assert.equal(v2.semantics.shadowOnly, true);
  assert.equal(v2.semantics.v1RemainsEvaluationBaseline, true);
  assert.equal(v2.signals.T1.riskIndex, v1.signals.T1.riskIndex);
  assert.ok(v2.signals.T3.riskIndex < v1.signals.T3.riskIndex);
  assert.equal(v2.signals.T3.likelihood, 'unlikely');
  assert.ok(v2.shadow.adjustments.some(item => item.code === 't3-long-horizon-support'));
  assert.equal(JSON.stringify(v1), before, 'shadow builder must not mutate frozen v1');
}

// GAENARI-style source membership contraction: one remaining agency must not make
// numeric confidence look stronger simply because disagreement has disappeared.
{
  const v1 = baseForecast();
  v1.signals.T1.confidenceIndex = 0.633;
  const v2 = ui.buildShadowV2Forecast({
    basicForecast: v1,
    signalInputs: inputs(1),
    threatAssessment: {
      analyzers: { directDepart: { confidence: 0 } },
      timeline: [{ leadHours: 12 }]
    },
    generatedAt: v1.generatedAt
  });
  assert.ok(v2.signals.T1.confidenceIndex < v1.signals.T1.confidenceIndex);
  assert.ok(v2.shadow.adjustments.some(item => item.code === 'source-coverage-confidence'));
}

// NARRA/GAENARI-style delayed withdrawal: once the representative minimum is in the
// past, the storm is departing, and no future timeline remains, residual risk decays.
{
  const v1 = baseForecast({
    impact: {
      likelihood: 'possible',
      closestApproach: { time: '2026-08-30T12:00:00.000Z', distanceKm: 210 },
      forecastMinimumMayBeHorizonLimited: true
    }
  });
  v1.signals.T1.riskIndex = 0.397;
  v1.signals.T1.likelihood = 'possible';
  const v2 = ui.buildShadowV2Forecast({
    basicForecast: v1,
    signalInputs: inputs(2),
    threatAssessment: {
      analyzers: { directDepart: { confidence: 0.65 } },
      timeline: []
    },
    generatedAt: v1.generatedAt
  });
  assert.ok(v2.shadow.diagnostics.lifecyclePenalty > 0);
  assert.ok(v2.signals.T1.riskIndex < v1.signals.T1.riskIndex);
  assert.equal(v2.signals.T1.likelihood, 'unlikely');
  assert.equal(v2.signals.T1.timingState, 'not-applicable');
}

// Exact NARRA terminal pattern: the remaining HKO bulletin is stale, the system has
// degraded to a low-pressure area, no forecast points remain, and the minimum is in
// the past. This is a V2-only continuous decay, not a v1 gate or case-specific rule.
{
  const observedAt = '2026-08-27T03:31:15.090Z';
  const lifecycle = ui.buildSourceLifecycleContext({
    sources: {
      HKO: {
        bulletinTime: '2026-08-26T15:30:35+08:00',
        positions: [{ time: '2026-08-26T06:00:00Z', intensity: 'Low Pressure Area' }],
        forecast: []
      }
    }
  }, observedAt);

  assert.equal(lifecycle.sourceAgencyCount, 1);
  assert.equal(lifecycle.forecastPointTotal, 0);
  assert.ok(lifecycle.freshestBulletinAgeHours > 20 && lifecycle.freshestBulletinAgeHours < 20.1);
  assert.equal(lifecycle.allSourcesStale, true);
  assert.equal(lifecycle.terminalIntensityAgencyCount, 1);
  assert.equal(lifecycle.terminalStateCandidate, true);

  const v1 = baseForecast({
    generatedAt: '2026-08-26T07:30:35.000Z',
    impact: {
      likelihood: 'unlikely',
      closestApproach: { time: '2026-08-26T06:00:00.000Z', distanceKm: 321.7491390847886 },
      forecastMinimumMayBeHorizonLimited: false
    }
  });
  v1.signals.T1.riskIndex = 0.4394138319059165;
  v1.signals.T1.likelihood = 'possible';
  v1.signals.T1.strongestCheckpoint = null;

  const v2 = ui.buildShadowV2Forecast({
    basicForecast: v1,
    signalInputs: inputs(1),
    threatAssessment: {
      analyzers: { directDepart: { confidence: 0 } },
      timeline: []
    },
    generatedAt: v1.generatedAt,
    sourceLifecycle: lifecycle
  });

  assert.equal(v2.shadow.diagnostics.lifecyclePenalty, 0, 'no departure evidence exists in the frozen NARRA snapshot');
  assert.ok(v2.shadow.diagnostics.terminalLifecyclePenalty >= 0.22);
  assert.ok(v2.signals.T1.riskIndex < 0.35);
  assert.equal(v2.signals.T1.likelihood, 'unlikely');
  assert.equal(v2.signals.T1.timingState, 'not-applicable');
  assert.ok(v2.shadow.adjustments.some(item => item.code === 'terminal-stale-lifecycle-decay'));
}

// Stale data alone is not enough to suppress an active tropical cyclone. The terminal
// decay requires a generic terminal intensity hint as well as single-source/no-forecast.
{
  const lifecycle = ui.buildSourceLifecycleContext({
    sources: {
      HKO: {
        bulletinTime: '2026-08-26T07:30:00Z',
        positions: [{ time: '2026-08-26T06:00:00Z', intensity: 'Tropical Storm' }],
        forecast: []
      }
    }
  }, '2026-08-27T03:31:15Z');
  assert.equal(lifecycle.allSourcesStale, true);
  assert.equal(lifecycle.terminalIntensityAgencyCount, 0);
  assert.equal(lifecycle.terminalStateCandidate, false);

  const v1 = baseForecast({
    generatedAt: '2026-08-26T07:30:00Z',
    impact: {
      likelihood: 'possible',
      closestApproach: { time: '2026-08-26T06:00:00Z', distanceKm: 320 },
      forecastMinimumMayBeHorizonLimited: false
    }
  });
  v1.signals.T1.riskIndex = 0.439;
  v1.signals.T1.strongestCheckpoint = null;
  const v2 = ui.buildShadowV2Forecast({
    basicForecast: v1,
    signalInputs: inputs(1),
    threatAssessment: { analyzers: { directDepart: { confidence: 0 } }, timeline: [] },
    generatedAt: v1.generatedAt,
    sourceLifecycle: lifecycle
  });
  assert.equal(v2.shadow.diagnostics.terminalLifecyclePenalty, 0);
  assert.equal(v2.signals.T1.riskIndex, v1.signals.T1.riskIndex);
  assert.equal(v2.signals.T1.likelihood, v1.signals.T1.likelihood);
}

// Positive risk with no observable threshold crossing remains positive but is explicitly
// labelled as left-censored/horizon-limited instead of inventing a precise time window.
{
  const v1 = baseForecast();
  v1.signals.T1.estimatedWindow = null;
  const v2 = ui.buildShadowV2Forecast({
    basicForecast: v1,
    signalInputs: inputs(4),
    threatAssessment: {
      analyzers: { directDepart: { confidence: 0 } },
      timeline: [{ leadHours: 6 }, { leadHours: 18 }]
    },
    generatedAt: v1.generatedAt
  });
  assert.equal(v2.signals.T1.likelihood, 'possible');
  assert.equal(v2.signals.T1.estimatedWindow, null);
  assert.equal(v2.signals.T1.timingState, 'left-censored-or-horizon-limited');
}

console.log('HK Signal V2 shadow tests: OK');
