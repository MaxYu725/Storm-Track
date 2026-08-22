'use strict';

const assert = require('node:assert/strict');
const core = require('../analysis/storm-analysis-core.js');
const impactEngine = require('../analysis/hk-impact-engine.js');
const signalEngine = require('../analysis/hko-signal-risk-inputs.js');
const threatEngine = require('../analysis/hk-threat-assessment.js');
const basic = require('../analysis/basic-hk-signal-forecast.js');

const BASE = '2026-08-21T12:00:00Z';
const point = (time, lat, lon, maximumWind, extra = {}) => ({ kind: extra.kind || 'forecast', time, lat, lon, maximumWind, ...extra });
const source = (positions, forecast) => ({ bulletinTime: positions.at(-1)?.time || BASE, positions, forecast });

function run(sources) {
  const group = { key: 'rule-scenario', displayName: 'RULE SCENARIO', sources };
  const snapshot = core.buildStormAnalysisSnapshot(group, { generatedAt: BASE });
  const impact = impactEngine.buildHongKongImpact(snapshot);
  const signalInputs = signalEngine.buildHkoSignalRiskInputs(snapshot, impact, group);
  const threatAssessment = threatEngine.buildHkThreatAssessment({ snapshot, impact, signalInputs, generatedAt: BASE });
  const forecast = basic.buildBasicHkSignalForecast({ impact, weightedImpact: null, signalInputs, threatAssessment, generatedAt: BASE });
  return { snapshot, impact, signalInputs, threatAssessment, forecast };
}

function safeTrack(offset = 0) {
  return source(
    [point(BASE, 18 + offset, 128.5 + offset, 15, { kind: 'analysis' })],
    [
      point('2026-08-21T18:00:00Z', 18.2 + offset, 128.0 + offset, 15),
      point('2026-08-22T00:00:00Z', 18.4 + offset, 127.5 + offset, 14),
      point('2026-08-22T12:00:00Z', 18.8 + offset, 126.5 + offset, 14)
    ]
  );
}

// Agreement should increase confidence, not manufacture physical threat.
{
  const one = run({ HKO: safeTrack(), CMA: null, JMA: null, CWA: null });
  const three = run({ HKO: safeTrack(), CMA: safeTrack(0.03), CWA: safeTrack(-0.03), JMA: null });
  assert.ok(Math.abs(one.threatAssessment.summary.overallThreatIndex - three.threatAssessment.summary.overallThreatIndex) < 0.03);
  assert.ok(three.threatAssessment.summary.confidenceIndex > one.threatAssessment.summary.confidenceIndex);
  assert.ok(Math.abs(one.forecast.signals.T1.riskIndex - three.forecast.signals.T1.riskIndex) < 0.04);
}

// A credible minority high-threat scenario must survive a safe median consensus.
{
  const severe = source(
    [point(BASE, 20.0, 123.5, 22, { kind: 'analysis' })],
    [
      point('2026-08-21T18:00:00Z', 20.5, 120.5, 26),
      point('2026-08-22T00:00:00Z', 21.0, 117.8, 31),
      point('2026-08-22T06:00:00Z', 21.6, 115.6, 35)
    ]
  );
  const result = run({ HKO: severe, CMA: safeTrack(), CWA: safeTrack(0.05), JMA: null });
  const strongest = result.forecast.signals.T3.strongestCheckpoint;
  assert.ok(strongest.scenarioMaxEvidence > strongest.consensusEvidence + 0.08);
  assert.ok(strongest.supportAgencyCount >= 1);
  assert.notEqual(result.forecast.signals.T3.likelihood, 'unlikely');
  assert.ok(result.forecast.signals.T3.confidenceIndex < 0.8);
}

// Sustained local-wind threat must rank above an isolated transient peak.
{
  const transientTrack = () => source(
    [point(BASE, 20.0, 121.0, 22, { kind: 'analysis' })],
    [
      point('2026-08-21T18:00:00Z', 21.0, 117.0, 31),
      point('2026-08-22T00:00:00Z', 20.0, 121.0, 20),
      point('2026-08-22T06:00:00Z', 19.5, 123.0, 18)
    ]
  );
  const sustainedTrack = () => source(
    [point(BASE, 20.0, 121.0, 22, { kind: 'analysis' })],
    [
      point('2026-08-21T18:00:00Z', 21.0, 117.0, 31),
      point('2026-08-22T00:00:00Z', 21.4, 116.0, 31),
      point('2026-08-22T06:00:00Z', 21.5, 115.7, 29)
    ]
  );
  const transient = run({ HKO: transientTrack(), CMA: transientTrack(), CWA: transientTrack(), JMA: null });
  const sustained = run({ HKO: sustainedTrack(), CMA: sustainedTrack(), CWA: sustainedTrack(), JMA: null });
  assert.ok(sustained.forecast.signals.T3.persistenceHours > transient.forecast.signals.T3.persistenceHours);
  assert.ok(sustained.forecast.signals.T3.riskIndex > transient.forecast.signals.T3.riskIndex + 0.03);
  assert.ok(sustained.forecast.signals.T8.riskIndex > transient.forecast.signals.T8.riskIndex);
}

// Same track, strengthening storm should have materially more T8 risk than weakening storm.
{
  const make = winds => source(
    [point(BASE, 19.0, 122.0, winds[0], { kind: 'analysis' })],
    [
      point('2026-08-21T18:00:00Z', 20.0, 119.0, winds[1]),
      point('2026-08-22T00:00:00Z', 21.0, 116.8, winds[2]),
      point('2026-08-22T06:00:00Z', 21.7, 115.1, winds[3])
    ]
  );
  const strengthening = run({ HKO: make([18, 24, 31, 40]), CMA: make([18, 24, 31, 40]), CWA: make([18, 24, 31, 40]), JMA: null });
  const weakening = run({ HKO: make([32, 25, 18, 12]), CMA: make([32, 25, 18, 12]), CWA: make([32, 25, 18, 12]), JMA: null });
  assert.ok(strengthening.forecast.signals.T8.riskIndex > weakening.forecast.signals.T8.riskIndex + 0.12);
  assert.ok(strengthening.threatAssessment.analyzers.rapidEvolution.confidence > weakening.threatAssessment.analyzers.rapidEvolution.confidence);
}

// Wind-radius levels must distinguish strong-wind coverage from gale coverage.
{
  const radii7 = [{ level: '7', ne: 800, se: 800, sw: 800, nw: 800 }];
  const radii10 = [{ level: '10', ne: 800, se: 800, sw: 800, nw: 800 }];
  const make = radii => source(
    [point(BASE, 20.5, 109.0, 28, { kind: 'analysis', windRadii: radii })],
    [point('2026-08-22T00:00:00Z', 20.8, 109.5, 28, { windRadii: radii })]
  );
  const strongOnly = run({ CMA: make(radii7), HKO: null, JMA: null, CWA: null });
  const gale = run({ CMA: make(radii10), HKO: null, JMA: null, CWA: null });
  assert.equal(strongOnly.signalInputs.featureVector.closestTimeStrongWindFieldCoverageAgencyCount, 1);
  assert.equal(strongOnly.signalInputs.featureVector.closestTimeGaleWindFieldCoverageAgencyCount, 0);
  assert.equal(gale.signalInputs.featureVector.closestTimeGaleWindFieldCoverageAgencyCount, 1);
  assert.ok(gale.forecast.signals.T8.riskIndex > strongOnly.forecast.signals.T8.riskIndex);
}

// Forecast-edge uncertainty should reduce confidence without erasing the physical threat.
{
  const edge = source(
    [point(BASE, 18.0, 125.0, 25, { kind: 'analysis' })],
    [
      point('2026-08-22T12:00:00Z', 20.0, 120.0, 28),
      point('2026-08-23T12:00:00Z', 21.0, 116.0, 30)
    ]
  );
  const interior = source(
    [point(BASE, 18.0, 125.0, 25, { kind: 'analysis' })],
    [
      point('2026-08-22T12:00:00Z', 20.0, 120.0, 28),
      point('2026-08-23T12:00:00Z', 21.0, 116.0, 30),
      point('2026-08-24T12:00:00Z', 20.0, 120.0, 25)
    ]
  );
  const a = run({ HKO: edge, CMA: edge, CWA: edge, JMA: null });
  const b = run({ HKO: interior, CMA: interior, CWA: interior, JMA: null });
  assert.ok(a.threatAssessment.analyzers.forecastEdge.confidence > b.threatAssessment.analyzers.forecastEdge.confidence);
  assert.ok(a.threatAssessment.summary.confidenceIndex < b.threatAssessment.summary.confidenceIndex);
  assert.ok(Math.abs(a.forecast.signals.T1.riskIndex - b.forecast.signals.T1.riskIndex) < 0.18);
}


// A weak cyclone can be very close yet clearly departing; proximity alone must not manufacture T1/T3/T8.
{
  const departing = () => source(
    [point(BASE, 22.0, 115.6, 8, { kind: 'analysis' })],
    [
      point('2026-08-21T18:00:00Z', 22.0, 117.5, 8),
      point('2026-08-22T00:00:00Z', 22.0, 119.5, 8),
      point('2026-08-22T06:00:00Z', 22.0, 121.5, 8)
    ]
  );
  const result = run({ HKO: departing(), CMA: departing(), CWA: departing(), JMA: null });
  assert.equal(result.forecast.impact.likelihood, 'unlikely');
  assert.equal(result.forecast.signals.T1.likelihood, 'unlikely');
  assert.equal(result.forecast.signals.T1.estimatedWindow, null);
  assert.equal(result.forecast.signals.T3.likelihood, 'unlikely');
  assert.equal(result.forecast.signals.T8.likelihood, 'unlikely');
}

// High-low-high threat is two separate episodes, not one continuous warning-level period.
{
  const separated = () => source(
    [point(BASE, 21.7, 115.0, 30, { kind: 'analysis' })],
    [
      point('2026-08-21T18:00:00Z', 19.0, 122.0, 18),
      point('2026-08-22T00:00:00Z', 21.7, 115.0, 30)
    ]
  );
  const result = run({ HKO: separated(), CMA: separated(), CWA: separated(), JMA: null });
  assert.equal(result.forecast.signals.T3.likelihood, 'possible');
  assert.ok(result.forecast.signals.T3.persistenceHours < 6);
}

// Wind-radius threshold parser must accept compact knot notation.
{
  assert.ok(Math.abs(signalEngine.parseWindRadiusThresholdMs('34kt') - 34 * 0.514444) < 1e-6);
  assert.ok(Math.abs(signalEngine.parseWindRadiusThresholdMs('34 kt') - 34 * 0.514444) < 1e-6);
}


// A radius observed long before the current analysis must remain visible as raw evidence
// but must not keep full weight indefinitely.
{
  const oldRadii = [{ level: '7', ne: 900, se: 900, sw: 900, nw: 900 }];
  const stale = source(
    [
      point('2026-08-20T12:00:00Z', 20.0, 110.0, 20, { kind: 'analysis', windRadii: oldRadii }),
      point(BASE, 20.5, 112.0, 20, { kind: 'analysis' })
    ],
    [
      point('2026-08-22T12:00:00Z', 21.0, 113.0, 21),
      point('2026-08-24T12:00:00Z', 21.5, 114.0, 22)
    ]
  );
  const result = run({ CMA: stale, HKO: null, JMA: null, CWA: null });
  const evidence = result.signalInputs.agencies.CMA.windField.latestEvidence;
  assert.ok(evidence.targetOffsetHours >= 23.9);
  assert.ok(evidence.freshness < 0.15);
  assert.equal(result.signalInputs.agencies.CMA.windField.timelineEvidence.length, 1);
  assert.ok(result.signalInputs.featureVector.latestStrongWindFieldCoverageAgencyCount >= 1);
  assert.ok(result.signalInputs.featureVector.latestStrongWindFieldCoverageEffectiveAgencyCount < 0.15);
}


// A high-threat path supported by two agencies should carry more scenario credibility
// than the same path supported by only one agency, without erasing the minority case.
{
  const severe = () => source(
    [point(BASE, 19.0, 122.0, 24, { kind: 'analysis' })],
    [
      point('2026-08-21T18:00:00Z', 20.0, 119.0, 28),
      point('2026-08-22T00:00:00Z', 21.0, 116.8, 32),
      point('2026-08-22T06:00:00Z', 21.7, 115.1, 36)
    ]
  );
  const safe = () => safeTrack(0.02);
  const one = run({ HKO: severe(), CMA: safe(), CWA: safe(), JMA: null });
  const two = run({ HKO: severe(), CMA: severe(), CWA: safe(), JMA: null });
  assert.ok(one.forecast.signals.T3.riskIndex >= 0.38);
  assert.ok(two.forecast.signals.T3.riskIndex > one.forecast.signals.T3.riskIndex + 0.03);
  assert.ok(two.forecast.signals.T3.strongestCheckpoint.supportAgencyCount >= 2);
}

// A very large strong-wind radius can make a distant centre relevant to T3, while
// a small radius on the identical centre track must not receive the same exposure.
{
  const huge = [{ level: '7', ne: 900, se: 900, sw: 900, nw: 900 }];
  const small = [{ level: '7', ne: 100, se: 100, sw: 100, nw: 100 }];
  const make = radii => source(
    [point(BASE, 20.5, 107.5, 24, { kind: 'analysis', windRadii: radii })],
    [
      point('2026-08-22T00:00:00Z', 20.7, 108.0, 24, { windRadii: radii }),
      point('2026-08-22T12:00:00Z', 20.9, 108.5, 23, { windRadii: radii })
    ]
  );
  const largeField = run({ CMA: make(huge), HKO: null, JMA: null, CWA: null });
  const smallField = run({ CMA: make(small), HKO: null, JMA: null, CWA: null });
  assert.equal(largeField.signalInputs.featureVector.latestStrongWindFieldCoverageAgencyCount, 1);
  assert.equal(smallField.signalInputs.featureVector.latestStrongWindFieldCoverageAgencyCount, 0);
  assert.ok(largeField.forecast.signals.T3.riskIndex > smallField.forecast.signals.T3.riskIndex + 0.08);
  assert.notEqual(largeField.forecast.signals.T3.likelihood, 'unlikely');
  assert.notEqual(largeField.forecast.signals.T8.likelihood, 'likely');
}

// Future gale-radius evidence that disappears before the closest forecast time must
// lose weight versus a forecast that continues to publish gale coverage near closest.
{
  const gale = [{ level: '10', ne: 450, se: 450, sw: 450, nw: 450 }];
  const fading = () => source(
    [point(BASE, 19.0, 121.5, 26, { kind: 'analysis' })],
    [
      point('2026-08-22T00:00:00Z', 20.8, 117.0, 31, { windRadii: gale }),
      point('2026-08-22T12:00:00Z', 21.7, 115.2, 33)
    ]
  );
  const persistent = () => source(
    [point(BASE, 19.0, 121.5, 26, { kind: 'analysis' })],
    [
      point('2026-08-22T00:00:00Z', 20.8, 117.0, 31, { windRadii: gale }),
      point('2026-08-22T12:00:00Z', 21.7, 115.2, 33, { windRadii: gale })
    ]
  );
  const a = run({ HKO: fading(), CMA: fading(), CWA: fading(), JMA: null });
  const b = run({ HKO: persistent(), CMA: persistent(), CWA: persistent(), JMA: null });
  assert.ok(a.signalInputs.featureVector.closestTimeWindFieldEvidenceAgeMedianHours >= 11.9);
  assert.ok(a.signalInputs.featureVector.closestTimeGaleWindFieldCoverageEffectiveAgencyCount < 1.2);
  assert.ok(b.signalInputs.featureVector.closestTimeGaleWindFieldCoverageEffectiveAgencyCount > 2.9);
  assert.ok(b.forecast.signals.T8.riskIndex > a.forecast.signals.T8.riskIndex + 0.05);
}

// Sparse long-interval guidance should not be treated as equally certain as the same
// hazardous passage confirmed by intermediate official forecast points.
{
  const sparse = () => source(
    [point(BASE, 18.0, 118.0, 30, { kind: 'analysis' })],
    [point('2026-08-22T12:00:00Z', 26.0, 110.0, 30)]
  );
  const dense = () => source(
    [point(BASE, 18.0, 118.0, 30, { kind: 'analysis' })],
    [
      point('2026-08-21T18:00:00Z', 20.0, 116.0, 30),
      point('2026-08-22T00:00:00Z', 22.0, 114.0, 30),
      point('2026-08-22T06:00:00Z', 24.0, 112.0, 30),
      point('2026-08-22T12:00:00Z', 26.0, 110.0, 30)
    ]
  );
  const a = run({ HKO: sparse(), CMA: sparse(), CWA: sparse(), JMA: null });
  const b = run({ HKO: dense(), CMA: dense(), CWA: dense(), JMA: null });
  assert.ok(b.threatAssessment.summary.confidenceIndex > a.threatAssessment.summary.confidenceIndex + 0.05);
  assert.ok(Math.abs(b.forecast.signals.T3.riskIndex - a.forecast.signals.T3.riskIndex) < 0.25);
}


// Wind-field minority scenarios must survive consensus dilution just as track minority
// scenarios do. Two safe agencies should reduce confidence, not erase a credible
// agency that explicitly puts Hong Kong inside strong-wind coverage.
{
  const huge = [{ level: '7', ne: 900, se: 900, sw: 900, nw: 900 }];
  const small = [{ level: '7', ne: 100, se: 100, sw: 100, nw: 100 }];
  const make = radii => source(
    [point(BASE, 20.5, 107.5, 24, { kind: 'analysis', windRadii: radii })],
    [point('2026-08-22T00:00:00Z', 20.7, 108.0, 24, { windRadii: radii })]
  );
  const result = run({ HKO: make(huge), CMA: make(small), CWA: make(small), JMA: null });
  assert.equal(result.signalInputs.featureVector.latestStrongWindFieldCoverageAgencyCount, 1);
  assert.notEqual(result.forecast.signals.T3.likelihood, 'unlikely');
  assert.ok(result.forecast.signals.T3.confidenceIndex < 0.9);
}

// The same minority preservation applies to a gale-radius scenario: one agency saying
// Hong Kong enters gale coverage is a possible T8 scenario even if peers disagree.
{
  const huge = [{ level: '10', ne: 900, se: 900, sw: 900, nw: 900 }];
  const small = [{ level: '10', ne: 100, se: 100, sw: 100, nw: 100 }];
  const make = radii => source(
    [point(BASE, 20.5, 107.5, 30, { kind: 'analysis', windRadii: radii })],
    [point('2026-08-22T00:00:00Z', 20.7, 108.0, 30, { windRadii: radii })]
  );
  const result = run({ HKO: make(huge), CMA: make(small), CWA: make(small), JMA: null });
  assert.equal(result.signalInputs.featureVector.latestGaleWindFieldCoverageAgencyCount, 1);
  assert.notEqual(result.forecast.signals.T8.likelihood, 'unlikely');
  assert.notEqual(result.forecast.signals.T8.likelihood, 'likely');
}

// A short-lived intensity spike should not rank like sustained severe winds along the
// same close passage.
{
  const make = winds => source(
    [point(BASE, 19.0, 121.5, winds[0], { kind: 'analysis' })],
    [
      point('2026-08-21T18:00:00Z', 20.3, 118.5, winds[1]),
      point('2026-08-22T00:00:00Z', 21.2, 116.5, winds[2]),
      point('2026-08-22T06:00:00Z', 21.8, 115.2, winds[3])
    ]
  );
  const transient = run({ HKO: make([24, 42, 16, 12]), CMA: make([24, 42, 16, 12]), CWA: make([24, 42, 16, 12]), JMA: null });
  const sustained = run({ HKO: make([24, 42, 38, 34]), CMA: make([24, 42, 38, 34]), CWA: make([24, 42, 38, 34]), JMA: null });
  assert.notEqual(transient.forecast.signals.T8.likelihood, 'likely');
  assert.ok(sustained.forecast.signals.T8.riskIndex > transient.forecast.signals.T8.riskIndex + 0.08);
  assert.ok(sustained.forecast.signals.T8.persistenceHours > transient.forecast.signals.T8.persistenceHours);
}

// Compact knot labels are common in wind-radius feeds and must map to the correct
// strong/gale thresholds without relying on whitespace.
{
  const r34 = [{ level: '34KT', ne: 900, se: 900, sw: 900, nw: 900 }];
  const r50 = [{ level: '50KT', ne: 900, se: 900, sw: 900, nw: 900 }];
  const make = radii => source(
    [point(BASE, 20.5, 107.5, 28, { kind: 'analysis', windRadii: radii })],
    [point('2026-08-22T00:00:00Z', 20.7, 108.0, 28, { windRadii: radii })]
  );
  const strong = run({ CMA: make(r34), HKO: null, JMA: null, CWA: null });
  const gale = run({ CMA: make(r50), HKO: null, JMA: null, CWA: null });
  assert.equal(strong.signalInputs.featureVector.latestStrongWindFieldCoverageAgencyCount, 1);
  assert.equal(strong.signalInputs.featureVector.latestGaleWindFieldCoverageAgencyCount, 0);
  assert.equal(gale.signalInputs.featureVector.latestGaleWindFieldCoverageAgencyCount, 1);
}

console.log('HK threat rule scenarios: OK');
