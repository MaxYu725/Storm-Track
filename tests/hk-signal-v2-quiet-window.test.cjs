'use strict';

const assert = require('node:assert/strict');
const v2 = require('../analysis/hk-signal-forecast-v2.js');

const GENERATED = '2026-08-31T00:00:00.000Z';

function forecast() {
  return {
    schemaVersion: 'basic-hk-signal-forecast/v1',
    available: true,
    generatedAt: GENERATED,
    impact: { likelihood: 'possible', closestApproach: { time: '2026-09-02T00:00:00Z', distanceKm: 180 } },
    signals: {
      T1: {
        likelihood: 'possible', riskIndex: .42, confidenceIndex: .60, persistenceHours: 6, estimatedWindow: null,
        strongestCheckpoint: { validTime: '2026-09-01T12:00:00Z', supportAgencyCount: 2, totalAgencyCount: 2 }
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
}

function inputs(count) {
  return { coverage: { usableAgencyCount: count }, featureVector: { usableAgencyCount: count } };
}

function threat({ approach=.5, depart=.1, reApproach=0, timeline=[], currentDistanceKm=500, forecastMinimumKm=250 }={}) {
  return {
    summary: { currentDistanceKm, forecastMinimumKm },
    analyzers: {
      directApproach: { confidence: approach }, directDepart: { confidence: depart },
      reApproach: { confidence: reApproach }, quasiStationary: { confidence: 0.1 }
    },
    timeline
  };
}

function build(v1, assessment, usable=4, lifecycle={ sourceAgencyCount:4, terminalStateCandidate:false }) {
  return v2.buildForecast({
    basicForecast:v1,
    signalInputs:inputs(usable),
    threatAssessment:assessment,
    generatedAt:v1.generatedAt,
    sourceLifecycle:lifecycle
  });
}

assert.equal(v2.VERSION, 'hk-signal-shadow-v2/0.5');
assert.equal(v2.T1_LIKELY_READINESS_FLOOR, .58);
assert.equal(v2.T1_PERSISTENCE_FACTOR_FLOOR, .85);

// A real outward-then-inward turn is a separate operational phase.
{
  const phase = v2.derivePhaseContext(threat({
    approach:.2, depart:.72, reApproach:.78,
    timeline:[
      {leadHours:0,distanceMedianKm:205}, {leadHours:12,distanceMedianKm:285},
      {leadHours:24,distanceMedianKm:350}, {leadHours:48,distanceMedianKm:230},
      {leadHours:72,distanceMedianKm:135}
    ]
  }), GENERATED);
  assert.equal(phase.multiPhase, true);
  assert.equal(phase.operationalPhase, 'departure-before-reapproach');
  assert.equal(phase.currentPhaseMinimum.distanceKm, 205);
  assert.equal(phase.phasePeak.distanceKm, 350);
  assert.equal(phase.laterPhaseMinimum.distanceKm, 135);
}

// A normal monotonic approach must not be mislabeled multi-phase merely because
// the global minimum lies beyond the first 36 hours.
{
  const phase = v2.derivePhaseContext(threat({
    approach:.7, depart:.03, reApproach:0,
    timeline:[
      {leadHours:0,distanceMedianKm:900}, {leadHours:24,distanceMedianKm:650},
      {leadHours:48,distanceMedianKm:420}, {leadHours:72,distanceMedianKm:210}
    ]
  }), GENERATED);
  assert.equal(phase.multiPhase, false);
  assert.equal(phase.operationalPhase, 'approach');
  assert.equal(phase.laterPhaseMinimum, null);
}

// SAUDEL-style marginal +119h T3 evidence from one of four usable agencies is
// discounted continuously below the possible threshold, without a hard veto.
{
  const v1=forecast();
  const out=build(v1, threat({timeline:[
    {leadHours:24,distanceMedianKm:700},{leadHours:72,distanceMedianKm:500},{leadHours:119,distanceMedianKm:250}
  ]}));
  assert.ok(out.signals.T3.riskIndex < v1.signals.T3.riskIndex);
  assert.equal(out.signals.T3.likelihood,'unlikely');
  const adj=out.shadow.adjustments.find(x=>x.code==='t3-long-horizon-evidence');
  assert.equal(adj.participationFraction,.25);
  assert.equal(adj.positiveSupportFraction,1);
}

// Participation and threshold-positive support are distinct evidence dimensions.
{
  const v1=forecast();
  v1.signals.T3.strongestCheckpoint={validTime:'2026-09-05T00:00:00Z',supportAgencyCount:1,totalAgencyCount:4};
  const out=build(v1,threat({timeline:[{leadHours:120,distanceMedianKm:260}]}));
  const adj=out.shadow.adjustments.find(x=>x.code==='t3-long-horizon-evidence');
  assert.equal(adj.participationFraction,1);
  assert.equal(adj.positiveSupportFraction,.25);
  assert.ok(adj.factor<1);
}

// NARRA-like geometry: broad physical risk remains possible, but a marginal V1
// likely state is not considered operationally mature at ~650 km current / ~390 km minimum.
{
  const v1=forecast();
  v1.signals.T1={
    likelihood:'likely',riskIndex:.72,confidenceIndex:.51,persistenceHours:25,estimatedWindow:null,
    strongestCheckpoint:{validTime:'2026-08-31T12:00:00Z',supportAgencyCount:4,totalAgencyCount:4}
  };
  const before=JSON.stringify(v1);
  const out=build(v1,threat({
    approach:.54,depart:.03,currentDistanceKm:655,forecastMinimumKm:388,
    timeline:[{leadHours:12,distanceMedianKm:388}]
  }));
  assert.equal(out.signals.T1.likelihood,'possible');
  assert.ok(out.signals.T1.decisionReadinessIndex<.58);
  assert.ok(out.shadow.adjustments.some(x=>x.code==='t1-likely-readiness'));
  assert.equal(JSON.stringify(v1),before,'V2 must not mutate frozen V1');
}

// Persistence is part of likely maturity rather than a diagnostic-only value.
// A newly emerged likely state with mature-looking geometry must stay possible until
// the evidence has persisted long enough; there is no hard hour gate.
{
  const v1=forecast();
  v1.signals.T1={
    likelihood:'likely',riskIndex:.72,confidenceIndex:.50,persistenceHours:1,estimatedWindow:null,
    strongestCheckpoint:{validTime:'2026-08-31T06:00:00Z',supportAgencyCount:4,totalAgencyCount:4}
  };
  const out=build(v1,threat({
    approach:.5,depart:.02,currentDistanceKm:400,forecastMinimumKm:250,
    timeline:[{leadHours:6,distanceMedianKm:250}]
  }));
  const readiness=out.signals.T1.shadowDiagnostics.decisionReadiness;
  assert.ok(readiness.persistenceCredibility<.1);
  assert.ok(readiness.persistenceFactor>.85 && readiness.persistenceFactor<.87);
  assert.equal(out.signals.T1.likelihood,'possible');
  assert.ok(out.signals.T1.decisionReadinessIndex<.58);
}

// SAUDEL-like mature geometry and sustained evidence keeps a strong T1 likely state.
{
  const v1=forecast();
  v1.signals.T1={
    likelihood:'likely',riskIndex:.76,confidenceIndex:.44,persistenceHours:38,estimatedWindow:null,
    strongestCheckpoint:{validTime:'2026-08-31T09:00:00Z',supportAgencyCount:4,totalAgencyCount:4}
  };
  const out=build(v1,threat({
    approach:.4,depart:.03,currentDistanceKm:358,forecastMinimumKm:212,
    timeline:[{leadHours:9,distanceMedianKm:212}]
  }));
  assert.equal(out.signals.T1.likelihood,'likely');
  assert.ok(out.signals.T1.decisionReadinessIndex>=.58);
  assert.ok(out.signals.T1.shadowDiagnostics.decisionReadiness.persistenceFactor>.99);
}

// V1 possible is never deleted solely because likely-readiness is immature.
{
  const v1=forecast();
  v1.signals.T1.riskIndex=.44;
  const out=build(v1,threat({currentDistanceKm:700,forecastMinimumKm:420,timeline:[{leadHours:72,distanceMedianKm:420}]}),2,{sourceAgencyCount:2,terminalStateCandidate:false});
  assert.equal(out.signals.T1.likelihood,'possible');
}

// Source presence and analytic usability remain separately observable in confidence.
{
  const v1=forecast();
  const out=build(v1,threat({timeline:[{leadHours:12,distanceMedianKm:500}]}),2,{sourceAgencyCount:4,terminalStateCandidate:false});
  assert.equal(out.shadow.diagnostics.presentAgencyCount,4);
  assert.equal(out.shadow.diagnostics.usableAgencyCount,2);
  assert.equal(out.shadow.diagnostics.usableWithinPresent,.5);
  assert.ok(out.signals.T1.confidenceIndex<v1.signals.T1.confidenceIndex);
}

// Exact NARRA terminal pattern is still removed without suppressing a stale active TS.
{
  const observed='2026-08-27T03:31:15.090Z';
  const terminal=v2.buildSourceLifecycleContext({HKO:{
    bulletinTime:'2026-08-26T15:30:35+08:00',forecastCount:0,
    current:{time:'2026-08-26T06:00:00Z',intensity:'Low Pressure Area'}
  }},observed,{sourcesDirect:true});
  assert.equal(terminal.terminalStateCandidate,true);
  const active=v2.buildSourceLifecycleContext({HKO:{
    bulletinTime:'2026-08-26T07:30:00Z',forecastCount:0,
    current:{time:'2026-08-26T06:00:00Z',intensity:'Tropical Storm'}
  }},observed,{sourcesDirect:true});
  assert.equal(active.terminalStateCandidate,false);

  const v1=forecast();
  v1.generatedAt='2026-08-26T07:30:35.000Z';
  v1.impact.closestApproach={time:'2026-08-26T06:00:00Z',distanceKm:321.75};
  v1.signals.T1={likelihood:'possible',riskIndex:.4394138319,confidenceIndex:.4,persistenceHours:5,estimatedWindow:null,strongestCheckpoint:null};
  const out=build(v1,threat({approach:0,depart:0,timeline:[],currentDistanceKm:322,forecastMinimumKm:322}),1,terminal);
  assert.ok(out.signals.T1.riskIndex<.35);
  assert.equal(out.signals.T1.likelihood,'unlikely');
}

// Timing output says risk window and can identify a later re-approach phase.
{
  const v1=forecast();
  v1.signals.T1.estimatedWindow={start:'2026-09-02T18:00:00Z',end:'2026-09-03T06:00:00Z'};
  const out=build(v1,threat({
    approach:.2,depart:.72,reApproach:.78,currentDistanceKm:205,forecastMinimumKm:135,
    timeline:[{leadHours:0,distanceMedianKm:205},{leadHours:24,distanceMedianKm:350},{leadHours:72,distanceMedianKm:135}]
  }));
  assert.equal(out.signals.T1.timingState,'later-phase-estimated');
  assert.equal(out.signals.T1.windowRole,'risk-evidence-window');
  assert.equal(out.semantics.riskWindowIsNotIssuanceTime,true);
}

console.log('HK Signal V2 quiet-window 0.5 tests: OK');