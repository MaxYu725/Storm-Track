'use strict';
const assert = require('node:assert/strict');
const trainer = require('../analysis/signal-calibration-walkforward-trainer.js');

function makeMetric(brier, ece, count = 30, gap = 0.05) {
  return {
    count,
    brierScore: brier,
    expectedCalibrationError: ece,
    reliabilityBins: [{ count, calibrationGap: gap }]
  };
}

{
  const gate = trainer.evaluateChallengerGate({
    holdoutStormCount: 8,
    championMetrics: { T1: makeMetric(.10,.04), T3: makeMetric(.14,.05), T8: makeMetric(.20,.06) },
    challengerMetrics: { T1: makeMetric(.101,.045), T3: makeMetric(.142,.055), T8: makeMetric(.18,.05) },
    championEvaluationProvenanceConfirmed: true
  });
  assert.equal(gate.eligibleForPromotion, true);
  assert.equal(gate.promotionPerformed, false);
  assert.equal(gate.primarySignal, 'T8');
}

{
  const gate = trainer.evaluateChallengerGate({
    holdoutStormCount: 8,
    championMetrics: { T1: makeMetric(.10,.04), T3: makeMetric(.14,.05), T8: makeMetric(.20,.06) },
    challengerMetrics: { T1: makeMetric(.13,.04), T3: makeMetric(.14,.10), T8: makeMetric(.199,.06) },
    championEvaluationProvenanceConfirmed: true
  });
  assert.equal(gate.eligibleForPromotion, false);
  assert.ok(gate.failedGates.some(code => code.startsWith('primary-brier-improvement:T8')));
  assert.ok(gate.failedGates.some(code => code.startsWith('brier-regression:T1')));
  assert.ok(gate.failedGates.some(code => code.startsWith('ece-regression:T3')));
}

{
  const gate = trainer.evaluateChallengerGate({
    holdoutStormCount: 8,
    championMetrics: { T1: makeMetric(.10,.04), T3: makeMetric(.14,.05), T8: makeMetric(.20,.06) },
    challengerMetrics: { T1: makeMetric(.09,.03), T3: makeMetric(.12,.04), T8: makeMetric(.15,.04) }
  });
  assert.equal(gate.eligibleForPromotion, false);
  assert.ok(gate.failedGates.includes('champion-holdout-independence-unconfirmed'));
}

function calibrationStub() {
  const calls = { builds: [], estimates: [] };
  return {
    calls,
    validateCalibrationRecord(record) {
      const asOf = Date.parse(record.asOf);
      const generated = Date.parse(record.signalInputs?.generatedAt);
      if (!record.outcome?.officialHko) return { eligible:false, reason:'outcome-not-explicit-official-hko' };
      if (record.outcome.signalSystemEra !== 'modern') return { eligible:false, reason:'non-modern-signal-era' };
      if (Number.isFinite(generated) && generated > asOf + 1000) return { eligible:false, reason:'signal-inputs-after-as-of' };
      return { eligible:true, asOf:new Date(asOf).toISOString() };
    },
    buildHkoSignalCalibrationProfile(records, options) {
      const storms = [...new Set(records.map(row => row.stormKey))].sort();
      calls.builds.push({ profileId: options.profileId, storms });
      return {
        schemaVersion:'hko-signal-calibration-profile/v1', profileId:options.profileId,
        trainingWindow: records.length ? { start: records[0].asOf, end: records[records.length-1].asOf } : null,
        coverage:{ distinctStorms:storms.length, eligibleSamples:records.length },
        config:{ minimumStorms:2 }, cells:{}
      };
    },
    estimateHkoSignalRisk(profile, signalInputs) {
      calls.estimates.push({ profileId:profile.profileId, stormMarker:signalInputs.stormMarker });
      const isChampion = profile.profileId === 'champion';
      return { available:true, probabilities: isChampion ? {T1:.7,T3:.5,T8:.35} : {T1:.75,T3:.55,T8:.25} };
    },
    evaluateSignalPredictions(rows) {
      const challenger = rows[0]?.probabilities?.T8 === .25;
      const values = challenger
        ? {T1:makeMetric(.10,.04,rows.length),T3:makeMetric(.12,.04,rows.length),T8:makeMetric(.15,.04,rows.length)}
        : {T1:makeMetric(.10,.04,rows.length),T3:makeMetric(.12,.04,rows.length),T8:makeMetric(.20,.05,rows.length)};
      return { metrics:values, binCount:5 };
    }
  };
}

(async () => {
  const calibration = calibrationStub();
  const storms = [];
  for (let index = 0; index < 7; index += 1) {
    const day = String(index + 1).padStart(2,'0');
    storms.push({
      stormKey:`S${index+1}`,
      outcome:{ highestSignal:index % 2 ? 'T3' : 'T8', officialHko:true, signalSystemEra:'modern', source:'HKO' },
      cases:[{
        caseId:`S${index+1}:a`, asOf:`2020-01-${day}T00:00:00Z`,
        analysis:{ deterministic:{
          signalInputs:{generatedAt:`2020-01-${day}T00:00:00Z`,stormMarker:`S${index+1}`},
          weightedHongKongImpact:{schemaVersion:'weighted-hk-impact/v1'},
          weightedConsensusTrack:{schemaVersion:'weighted-consensus-track/v1'}
        }}
      }]
    });
  }
  // Many advisories from one early storm must not satisfy minimumTrainingStorms by itself.
  storms[0].cases.push(...Array.from({length:5},(_,i)=>({
    caseId:`S1:extra${i}`,asOf:`2020-01-01T0${i+1}:00:00Z`,
    analysis:{deterministic:{signalInputs:{generatedAt:`2020-01-01T0${i+1}:00:00Z`,stormMarker:'S1'},weightedHongKongImpact:{},weightedConsensusTrack:{}}}
  })));

  let replayCalls = 0;
  storms[6].cases.push({ caseId:'S7:replay', asOf:'2020-01-07T06:00:00Z', replayInput:{}, });
  const result = await trainer.runSignalCalibrationWalkForward({
    storms,
    challengerProfileId:'challenger-v1',
    generatedAt:'2026-08-21T00:00:00Z',
    minimumTrainingStorms:3,
    championProfile:{profileId:'champion'},
    championProfileProvenance:{holdoutIndependent:true,source:'prior-champion'},
    gateOptions:{minimumHoldoutStorms:4,minimumPredictionsPerSignal:4}
  }, {
    calibration,
    async replayCase(item, storm) {
      replayCalls += 1;
      return { deterministic:{signalInputs:{generatedAt:item.asOf,stormMarker:storm.stormKey},weightedHongKongImpact:{},weightedConsensusTrack:{}} };
    }
  });

  assert.equal(replayCalls, 1);
  assert.equal(result.schemaVersion, 'signal-calibration-walkforward-trainer/v1');
  assert.equal(result.replay.eligibleStorms, 7);
  assert.equal(result.replay.holdoutStormCount, 4);
  assert.deepEqual(result.replay.holdoutStorms[0].trainingStorms, ['S1','S2','S3']);
  assert.equal(result.replay.holdoutStorms[0].stormKey, 'S4');
  assert.equal(result.challenger.profileRow.role, 'challenger');
  assert.equal(result.challenger.profileRow.profile_id, 'challenger-v1');
  assert.equal(result.challenger.profile.coverage.distinctStorms, 7);
  assert.equal(result.challenger.eligibleForPromotion, true);
  assert.equal(result.challenger.promotionPerformed, false);
  assert.equal(result.semantics.databaseWritePerformed, false);
  const s4Build = calibration.calls.builds.find(item => item.profileId.includes(':S4'));
  assert.deepEqual(s4Build.storms, ['S1','S2','S3']);
  assert.ok(!s4Build.storms.includes('S4'));
})();

(async () => {
  const calibration = calibrationStub();
  const materialized = await trainer.materializeHistoricalStorms({storms:[
    {stormKey:'DUP',outcome:{highestSignal:'T3',officialHko:true,signalSystemEra:'modern'},cases:[{caseId:'a',asOf:'2020-01-01T00:00:00Z',signalInputs:{generatedAt:'2020-01-01T00:00:00Z'},weightedHongKongImpact:{},weightedConsensusTrack:{}}]},
    {stormKey:'DUP',outcome:{highestSignal:'T3',officialHko:true,signalSystemEra:'modern'},cases:[{caseId:'b',asOf:'2020-01-02T00:00:00Z',signalInputs:{generatedAt:'2020-01-02T00:00:00Z'},weightedHongKongImpact:{},weightedConsensusTrack:{}}]},
    {stormKey:'LEAK',outcome:{highestSignal:'T3',officialHko:true,signalSystemEra:'modern'},cases:[{caseId:'c',asOf:'2020-01-03T00:00:00Z',signalInputs:{generatedAt:'2020-01-04T00:00:00Z'},weightedHongKongImpact:{},weightedConsensusTrack:{}}]},
    {stormKey:'FUTURE_SOURCE',outcome:{highestSignal:'T3',officialHko:true,signalSystemEra:'modern'},cases:[{caseId:'d',asOf:'2020-01-04T00:00:00Z',snapshot:{generatedAt:'2020-01-04T00:00:00Z',sources:{JMA:{bulletinTime:'2020-01-05T00:00:00Z'}}},signalInputs:{generatedAt:'2020-01-04T00:00:00Z'},weightedHongKongImpact:{},weightedConsensusTrack:{}}]}
  ]},{calibration});
  assert.equal(materialized.storms.length, 0);
  assert.ok(materialized.rejectedStorms.some(row => row.reason === 'duplicate-storm-key'));
  assert.ok(materialized.rejectedStorms.some(row => row.stormKey === 'LEAK'));
  assert.ok(materialized.rejectedStorms.some(row => row.stormKey === 'FUTURE_SOURCE'));
})();

setImmediate(() => console.log('signal-calibration-walkforward-trainer tests: OK'));
