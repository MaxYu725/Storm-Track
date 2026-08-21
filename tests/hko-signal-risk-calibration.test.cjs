'use strict';
const assert = require('node:assert/strict');
const ai11 = require('../analysis/hko-signal-risk-calibration.js');

function record(stormKey, distanceKm, leadHours, windMs, highestSignal, extra = {}) {
  const base = Date.parse('2026-08-21T00:00:00Z');
  return {
    stormKey,
    asOf: new Date(base).toISOString(),
    signalInputs: {
      generatedAt: new Date(base).toISOString(),
      featureVector: {
        consensusClosestDistanceKm: distanceKm,
        consensusClosestLeadHours: leadHours,
        closestMaximumWindMedianMs: windMs,
        usableAgencyCount: 4
      },
      officialHkoWarningContext: { provided: false }
    },
    weightedHongKongImpact: {
      closestApproach: { distanceKm, time: new Date(base + leadHours * 3600000).toISOString() }
    },
    weightedConsensusTrack: { referenceBaseTime: new Date(base).toISOString() },
    outcome: { highestSignal, officialHko: true, signalSystemEra: 'modern', source: 'HKO' },
    ...extra
  };
}

assert.equal(ai11.signalRank('No. 8 NE'), 8);
assert.equal(ai11.signalRank('T10'), 10);
assert.deepEqual(ai11.deriveTargets('8SW'), { rank: 8, T1: true, T3: true, T8: true, T9: false, T10: false });

{
  const badEra = ai11.validateCalibrationRecord(record('a', 200, 24, 30, 3, { outcome: { highestSignal: 3, officialHko: true, signalSystemEra: 'historical' } }));
  assert.equal(badEra.eligible, false);
  assert.equal(badEra.reason, 'non-modern-signal-era');
  const unofficial = ai11.validateCalibrationRecord(record('a', 200, 24, 30, 3, { outcome: { highestSignal: 3, officialHko: false, signalSystemEra: 'modern' } }));
  assert.equal(unofficial.reason, 'outcome-not-explicit-official-hko');
  const leaked = record('a', 200, 24, 30, 3);
  leaked.signalInputs.generatedAt = '2026-08-21T00:00:05Z';
  assert.equal(ai11.validateCalibrationRecord(leaked, { leakageToleranceMs: 1000 }).reason, 'signal-inputs-after-as-of');
}

{
  const rows = [];
  for (let i = 0; i < 12; i += 1) rows.push(record('repeat-storm', 150, 18, 35, 8));
  rows.push(record('storm-2', 150, 18, 35, 1));
  rows.push(record('storm-3', 150, 18, 35, 3));
  rows.push(record('storm-4', 150, 18, 35, 3));
  rows.push(record('storm-5', 150, 18, 35, 8));
  const profile = ai11.buildHkoSignalCalibrationProfile(rows, { minimumStorms: 5, generatedAt: '2026-08-21T01:00:00Z' });
  const cell = profile.cells.distanceLeadWind['100-200km|12-24h|30-40mps'];
  assert.equal(cell.sampleCount, 16);
  assert.equal(cell.stormCount, 5);
  assert.equal(cell.effectiveSampleCount, 5);
  assert.ok(cell.probabilities.T1 >= cell.probabilities.T3);
  assert.ok(cell.probabilities.T3 >= cell.probabilities.T8);
  assert.equal(profile.semantics.stormBalancedWithinCell, true);
}

{
  const rows = [
    record('s1', 150, 18, 35, 8), record('s2', 150, 18, 35, 8),
    record('s3', 150, 18, 25, 3), record('s4', 150, 18, 25, 3),
    record('s5', 150, 18, 25, 1), record('s6', 150, 18, 25, 1)
  ];
  const profile = ai11.buildHkoSignalCalibrationProfile(rows, { minimumStorms: 5 });
  const inputs = record('x', 150, 18, 35, 1);
  const estimate = ai11.estimateHkoSignalRisk(profile, inputs.signalInputs, inputs.weightedHongKongImpact, inputs.weightedConsensusTrack);
  assert.equal(estimate.available, true);
  assert.equal(estimate.selectedCell.level, 'distanceLead');
  assert.ok(estimate.probabilities.T1 >= estimate.probabilities.T3);
  assert.ok(estimate.probabilities.T3 >= estimate.probabilities.T8);
  assert.equal(estimate.rareSignals.T9.probability, null);
  assert.equal(estimate.rareSignals.T10.probability, null);
}

{
  const rows = [];
  for (let i = 0; i < 6; i += 1) rows.push(record(`s${i}`, 250, 30, 35, i < 3 ? 8 : 3));
  const profile = ai11.buildHkoSignalCalibrationProfile(rows, { minimumStorms: 5 });
  const current = record('live', 250, 30, 35, 3);
  current.signalInputs.officialHkoWarningContext = { provided: true, currentSignal: 'No. 3', source: 'HKO', issuedAt: '2026-08-21T00:00:00Z' };
  const estimate = ai11.estimateHkoSignalRisk(profile, current.signalInputs, current.weightedHongKongImpact, current.weightedConsensusTrack);
  assert.equal(estimate.probabilities.T1, 1);
  assert.equal(estimate.probabilities.T3, 1);
  assert.ok(estimate.probabilities.T8 <= 1);
  assert.equal(estimate.officialContextAdjustment.applied, true);
}

{
  const evaluation = ai11.evaluateSignalPredictions([
    { probabilities: { T1: 1, T3: 0.8, T8: 0.2 }, outcome: { highestSignal: 3 } },
    { probabilities: { T1: 0.9, T3: 0.2, T8: 0.1 }, outcome: { highestSignal: 1 } }
  ]);
  assert.equal(evaluation.metrics.T1.count, 2);
  assert.ok(evaluation.metrics.T3.brierScore >= 0);
  assert.ok(evaluation.metrics.T3.expectedCalibrationError >= 0);
  assert.equal(evaluation.metrics.T3.reliabilityBins.length, 5);
  assert.equal(evaluation.semantics.evaluationDoesNotTrainOrPromote, true);
}

console.log('hko-signal-risk-calibration tests: OK');
