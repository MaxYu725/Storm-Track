'use strict';
const assert = require('node:assert/strict');
const ai6 = require('../analysis/agency-skill-profile.js');

function metric(count, mae, rmse = mae, mean = mae, maxAbs = mae * 2) {
    return { count, mean, mae, rmse, maxAbs };
}
function storm(key, hkoMae, cmaMae, jmaMae, cwaMae, count = 6) {
    const agency = mae => ({
        trackErrorKm: metric(count * 3, mae), intensityErrorMs: metric(0, 0), pressureErrorHpa: metric(0, 0),
        leadBuckets: {
            '0-12h': { trackErrorKm: metric(count, mae * 0.6), intensityErrorMs: metric(0, 0), pressureErrorHpa: metric(0, 0) },
            '12-24h': { trackErrorKm: metric(count, mae * 0.8), intensityErrorMs: metric(0, 0), pressureErrorHpa: metric(0, 0) },
            '24-48h': { trackErrorKm: metric(count, mae), intensityErrorMs: metric(0, 0), pressureErrorHpa: metric(0, 0) },
            '48-72h': { trackErrorKm: metric(count, mae * 1.3), intensityErrorMs: metric(0, 0), pressureErrorHpa: metric(0, 0) },
            '72-120h': { trackErrorKm: metric(0, 0), intensityErrorMs: metric(0, 0), pressureErrorHpa: metric(0, 0) },
            '120h+': { trackErrorKm: metric(0, 0), intensityErrorMs: metric(0, 0), pressureErrorHpa: metric(0, 0) }
        }
    });
    return { stormKey: key, backfillCapability: { mode: 'full-walk-forward', eligibleForAgencySkill: true }, metrics: { agencies: { HKO: agency(hkoMae), CMA: agency(cmaMae), JMA: agency(jmaMae), CWA: agency(cwaMae) } } };
}

(function testTruthOnlyExcluded() {
    const profile = ai6.buildSkillProfile([
        storm('a', 100, 90, 80, 110),
        { stormKey: 'truth', backfillCapability: { mode: 'truth-only', eligibleForAgencySkill: false }, metrics: { agencies: {} } }
    ], { generatedAt: '2026-08-21T00:00:00Z' });
    assert.equal(profile.stormCoverage.included, 1);
    assert.equal(profile.stormCoverage.excluded, 1);
    assert.equal(profile.semantics.truthOnlyExcludedFromAgencySkill, true);
})();

(function testDistinctStormCountControlsEligibility() {
    const profile = ai6.buildSkillProfile([storm('same-storm', 80, 100, 120, 140, 100)], {});
    const candidate = ai6.buildAdaptiveWeightCandidate(profile, { minimumStorms: 2, minimumPoints: 20 });
    assert.equal(candidate.buckets['24-48h'].status, 'insufficient-sample');
    Object.values(candidate.buckets['24-48h'].weights).forEach(weight => assert.ok(Math.abs(weight - 0.25) < 1e-12));
})();

(function testCandidateFavoursSkilledAgencyButIsBounded() {
    const backtests = [];
    for (let i = 0; i < 8; i += 1) backtests.push(storm(`s${i}`, 100, 90, 60, 130));
    const profile = ai6.buildSkillProfile(backtests, {});
    const candidate = ai6.buildAdaptiveWeightCandidate(profile, { minimumStorms: 5, minimumPoints: 20, maxWeightDelta: 0.08 });
    const bucket = candidate.buckets['24-48h'];
    assert.equal(bucket.status, 'candidate');
    assert.ok(bucket.weights.JMA > bucket.weights.CMA);
    assert.ok(bucket.weights.CMA > bucket.weights.HKO);
    assert.ok(bucket.weights.HKO > bucket.weights.CWA);
    assert.ok(bucket.weights.JMA <= 0.33 + 1e-12);
    assert.ok(bucket.weights.CWA >= 0.17 - 1e-12);
    const sum = Object.values(bucket.weights).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-10);
    assert.equal(candidate.semantics.productionWeightsChanged, false);
    assert.equal(candidate.semantics.promotionRequired, true);
})();

(function testLeadBucketsRemainIndependent() {
    const backtests = [];
    for (let i = 0; i < 6; i += 1) backtests.push(storm(`s${i}`, 100, 80, 60, 120));
    backtests.forEach(item => {
        item.metrics.agencies.HKO.leadBuckets['0-12h'].trackErrorKm = metric(10, 20);
        item.metrics.agencies.JMA.leadBuckets['0-12h'].trackErrorKm = metric(10, 35);
    });
    const profile = ai6.buildSkillProfile(backtests, {});
    const candidate = ai6.buildAdaptiveWeightCandidate(profile, { minimumStorms: 5, minimumPoints: 20 });
    assert.ok(candidate.buckets['0-12h'].weights.HKO > candidate.buckets['0-12h'].weights.JMA);
    assert.ok(candidate.buckets['24-48h'].weights.JMA > candidate.buckets['24-48h'].weights.HKO);
})();

(function testChampionChallengerGates() {
    const pass = ai6.evaluateChampionChallenger({
        championMetrics: { sampleCount: 60, trackMaeKm: 100, closestTimeMaeHours: 2, closestDistanceMaeKm: 50 },
        challengerMetrics: { sampleCount: 60, trackMaeKm: 94, closestTimeMaeHours: 2.01, closestDistanceMaeKm: 49 },
        minimumSamples: 30,
        minimumImprovementFraction: 0.03,
        maximumCriticalRegressionFraction: 0.02
    });
    assert.equal(pass.eligibleForPromotion, true);
    assert.equal(pass.promotionPerformed, false);
    assert.equal(pass.semantics.automaticPromotion, false);

    const fail = ai6.evaluateChampionChallenger({
        championMetrics: { sampleCount: 60, trackMaeKm: 100, closestTimeMaeHours: 2, closestDistanceMaeKm: 50 },
        challengerMetrics: { sampleCount: 60, trackMaeKm: 94, closestTimeMaeHours: 2.2, closestDistanceMaeKm: 49 },
        minimumSamples: 30
    });
    assert.equal(fail.eligibleForPromotion, false);
    assert.ok(fail.failedGates.some(x => x.startsWith('critical-regression:closestTimeMaeHours')));
})();

console.log('agency-skill-profile tests: OK');
