'use strict';

const assert = require('node:assert/strict');
const v2engine = require('../analysis/hk-signal-forecast-v2.js');

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
        confidenceIndex: 0.60,
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
        confidenceIndex: 0.50,
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
        confidenceIndex: 0.40,
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

function threat({ approach = 0.5, depart = 0.1, reApproach = 0, timeline = [] } = {}) {
  return {
    analyzers: {
      directApproach: { confidence: approach },
      directDepart: { confidence: depart },
      reApproach: { confidence: reApproach },
      quasiStationary: { confidence: 0.1 }
    },
    timeline
  };
}

assert.equal(v2engine.VERSION, 'hk-signal-shadow-v2/0.3');
assert.equal(v2engine.TERMINAL_STALE_HOURS, 12);
assert.equal(v2engine.PHASE_NEAR_TERM_HOURS, 36);

// Multi-pass geometry is represented as phases rather than one operational closest.
{
  const phase = v2engine.derivePhaseContext(threat({
    approach: 0.20,
    depart: 0.72,
    reApproach: 0.78,
    timeline: [
      { leadHours: 0, validTime: '2026-08-31T00:00:00Z', distanceMedianKm: 205 },
      { leadHours: 12, validTime: '2026-08-31T12:00:00Z', distanceMedianKm: 285 },
      { leadHours: 24, validTime: '2026-09-01T00:00:00Z', distanceMedianKm: 350 },
      { leadHours: 48, validTime: '2026-09-02T00:00:00Z', distanceMedianKm: 230 },
      { leadHours: 72, validTime: '2026-09-03T00:00:00Z', distanceMedianKm: 135 }
    ]
  }), '2026-08-31T00:00:00Z');
  assert.equal(phase.available, true);
  assert.equal(phase.multiPhase, true);
  assert.equal(phase.operationalPhase, 'departure-before-reapproach');
  assert.equal(phase.currentPhaseMinimum.distanceKm, 205);
  assert.equal(phase.laterPhaseMinimum.distanceKm, 135);
  assert.equal(phase.globalMinimumBelongsToLaterPhase, true);
}

// SAUDEL-style +119h T3 driven by one participating/supporting agency remains
// continuous but is discounted enough to remove a marginal V1 possible state.
{
  const v1 = baseForecast();
  const result = v2engine.buildForecast({
    basicForecast: v1,
    signalInputs: inputs(4),
    sourceLifecycle: { sourceAgencyCount: 4, terminalStateCandidate: false },
    threatAssessment: threat({
      timeline: [
        { leadHours: 24, distanceMedianKm: 700 },
        { leadHours: 72, distanceMedianKm: 500 },
        { leadHours: 119, distanceMedianKm: 250 }
      ]
    }),
    generatedAt: v1.generatedAt
  });
  assert.ok(result.signals.T3.riskIndex < v1.signals.T3.riskIndex);
  assert.equal(result.signals.T3.likelihood, 'unlikely');
  const adjustment = result.shadow.adjustments.find(item => item.code === 't3-long-horizon-evidence');
  assert.ok(adjustment);
  assert.equal(adjustment.participationFraction, 0.25);
  assert.equal(adjustment.positiveSupportFraction, 1);
}

// Participation and positive support are independent dimensions. Four agencies can
// participate at a far checkpoint while only one crosses the positive threshold.
{
  const v1 = baseForecast();
  v1.signals.T3.strongestCheckpoint = {
    validTime: '2026-09-05T00:00:00.000Z',
    supportAgencyCount: 1,
    totalAgencyCount: 4
  };
  const result = v2engine.buildForecast({
    basicForecast: v1,
    signalInputs: inputs(4),
    sourceLifecycle: { sourceAgencyCount: 4, terminalStateCandidate: false },
    threatAssessment: threat({ timeline: [{ leadHours: 120, distanceMedianKm: 260 }] }),
    generatedAt: v1.generatedAt
  });
  const adjustment = result.shadow.adjustments.find(item => item.code === 't3-long-horizon-evidence');
  assert.ok(adjustment);
  assert.equal(adjustment.participationFraction, 1);
  assert.equal(adjustment.positiveSupportFraction, 0.25);
  assert.ok(adjustment.factor < 1);
}

// NARRA-style marginal T1 likely can be downgraded to possible by decision maturity
// without deleting the broader early-warning risk channel or changing V1.
{
  const v1 = baseForecast();
  v1.signals.T1.likelihood = 'likely';
  v1.signals.T1.riskIndex = 0.60;
  v1.signals.T1.persistenceHours = 2;
  v1.signals.T1.strongestCheckpoint = {
    validTime: '2026-09-03T00:00:00.000Z',
    supportAgencyCount: 1,
    totalAgencyCount: 3
  };
  const before = JSON.stringify(v1);
  const result = v2engine.buildForecast({
    basicForecast: v1,
    signalInputs: inputs(3),
    sourceLifecycle: { sourceAgencyCount: 3, terminalStateCandidate: false },
    threatAssessment: threat({
      approach: 0.15,
      depart: 0.65,
      timeline: [{ leadHours: 72, distanceMedianKm: 360 }]
    }),
    generatedAt: v1.generatedAt
  });
  assert.equal(result.signals.T1.likelihood, 'possible');
  assert.ok(result.signals.T1.decisionReadinessIndex < 0.52);
  assert.ok(result.shadow.adjustments.some(item => item.code === 't1-likely-readiness'));
  assert.equal(JSON.stringify(v1), before, 'V2 must not mutate frozen V1');
}

// A broad V1 possible state is retained; the readiness channel only governs likely.
{
  const v1 = baseForecast();
  v1.signals.T1.riskIndex = 0.44;
  v1.signals.T1.likelihood = 'possible';
  const result = v2engine.buildForecast({
    basicForecast: v1,
    signalInputs: inputs(2),
    sourceLifecycle: { sourceAgencyCount: 2, terminalStateCandidate: false },
    threatAssessment: threat({ timeline: [{ leadHours: 72, distanceMedianKm: 420 }] }),
    generatedAt: v1.generatedAt
  });
  assert.equal(result.signals.T1.likelihood, 'possible');
  assert.ok(Number.isFinite(result.signals.T1.decisionReadinessIndex));
}

// Source presence and analytic usability are recorded separately in confidence.
{
  const v1 = baseForecast();
  const result = v2engine.buildForecast({
    basicForecast: v1,
    signalInputs: inputs(2),
    sourceLifecycle: { sourceAgencyCount: 4, terminalStateCandidate: false },
    threatAssessment: threat({ timeline: [{ leadHours: 12, distanceMedianKm: 500 }] }),
    generatedAt: v1.generatedAt
  });
  assert.equal(result.shadow.diagnostics.presentAgencyCount, 4);
  assert.equal(result.shadow.diagnostics.usableAgencyCount, 2);
  assert.equal(result.shadow.diagnostics.presenceCoverage, 1);
  assert.equal(result.shadow.diagnostics.usableWithinPresent, 0.5);
  assert.ok(result.signals.T1.confidenceIndex < v1.signals.T1.confidenceIndex);
}

// Exact NARRA terminal pattern remains suppressed in V2 0.3.
{
  const observedAt = '2026-08-27T03:31:15.090Z';
  const lifecycle = v2engine.buildSourceLifecycleContext({
    HKO: {
      bulletinTime: '2026-08-26T15:30:35+08:00',
      forecastCount: 0,
      current: { time: '2026-08-26T06:00:00Z', intensity: 'Low Pressure Area' }
    }
  }, observedAt, { sourcesDirect: true });
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
  const result = v2engine.buildForecast({
    basicForecast: v1,
    signalInputs: inputs(1),
    sourceLifecycle: lifecycle,
    threatAssessment: threat({ approach: 0, depart: 0, timeline: [] }),
    generatedAt: v1.generatedAt
  });
  assert.ok(result.shadow.diagnostics.terminalLifecyclePenalty >= 0.22);
  assert.ok(result.signals.T1.riskIndex < 0.35);
  assert.equal(result.signals.T1.likelihood, 'unlikely');
}

// A stale but still active tropical storm is protected from terminal suppression.
{
  const lifecycle = v2engine.buildSourceLifecycleContext({
    HKO: {
      bulletinTime: '2026-08-26T07:30:00Z',
      forecastCount: 0,
      current: { time: '2026-08-26T06:00:00Z', intensity: 'Tropical Storm' }
    }
  }, '2026-08-27T03:31:15Z', { sourcesDirect: true });
  assert.equal(lifecycle.allSourcesStale, true);
  assert.equal(lifecycle.terminalStateCandidate, false);
}

// Estimated timing is explicitly a risk-evidence window, and a later pass is labelled.
{
  const v1 = baseForecast();
  v1.signals.T1.estimatedWindow = {
    start: '2026-09-02T18:00:00Z',
    end: '2026-09-03T06:00:00Z'
  };
  const result = v2engine.buildForecast({
    basicForecast: v1,
    signalInputs: inputs(4),
    sourceLifecycle: { sourceAgencyCount: 4, terminalStateCandidate: false },
    threatAssessment: threat({
      approach: 0.20,
      depart: 0.72,
      reApproach: 0.78,
      timeline: [
        { leadHours: 0, distanceMedianKm: 205 },
        { leadHours: 24, distanceMedianKm: 350 },
        { leadHours: 72, distanceMedianKm: 135 }
      ]
    }),
    generatedAt: v1.generatedAt
  });
  assert.equal(result.signals.T1.timingState, 'later-phase-estimated');
  assert.equal(result.signals.T1.windowRole, 'risk-evidence-window');
  assert.equal(result.semantics.riskWindowIsNotIssuanceTime, true);
}

console.log('HK Signal V2 quiet-window 0.3 tests: OK');