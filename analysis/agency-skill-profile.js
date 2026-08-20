(function attachStormAgencySkillProfile(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StormAgencySkillProfile = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormAgencySkillProfile() {
    'use strict';

    const PROFILE_VERSION = 'agency-skill-profile/v1';
    const CANDIDATE_VERSION = 'adaptive-weight-candidate/v1';
    const AGENCIES = Object.freeze(['HKO', 'CMA', 'JMA', 'CWA']);
    const DEFAULT_BUCKETS = Object.freeze(['0-12h', '12-24h', '24-48h', '48-72h', '72-120h', '120h+']);

    function finite(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function metricAccumulator() {
        return { count: 0, sum: 0, sumAbs: 0, sumSq: 0, maxAbs: null, storms: new Set() };
    }

    function addMetric(acc, metric, stormKey) {
        const count = finite(metric?.count);
        const mean = finite(metric?.mean);
        const mae = finite(metric?.mae);
        const rmse = finite(metric?.rmse);
        const maxAbs = finite(metric?.maxAbs);
        if (!(count > 0) || mae == null || rmse == null) return;
        acc.count += count;
        acc.sum += (mean ?? 0) * count;
        acc.sumAbs += mae * count;
        acc.sumSq += rmse * rmse * count;
        if (maxAbs != null) acc.maxAbs = acc.maxAbs == null ? maxAbs : Math.max(acc.maxAbs, maxAbs);
        if (stormKey) acc.storms.add(String(stormKey));
    }

    function finishMetric(acc) {
        if (!acc.count) return { count: 0, stormCount: acc.storms.size, mean: null, mae: null, rmse: null, maxAbs: null };
        return {
            count: acc.count,
            stormCount: acc.storms.size,
            mean: acc.sum / acc.count,
            mae: acc.sumAbs / acc.count,
            rmse: Math.sqrt(acc.sumSq / acc.count),
            maxAbs: acc.maxAbs
        };
    }

    function defaultChampionWeights(input) {
        const supplied = input && typeof input === 'object' ? input : {};
        const values = AGENCIES.map(agency => Math.max(0, finite(supplied[agency]) ?? 0));
        const sum = values.reduce((a, b) => a + b, 0);
        if (!(sum > 0)) return Object.fromEntries(AGENCIES.map(agency => [agency, 1 / AGENCIES.length]));
        return Object.fromEntries(AGENCIES.map((agency, index) => [agency, values[index] / sum]));
    }

    function buildSkillProfile(backtests, options) {
        const list = Array.isArray(backtests) ? backtests : [];
        const bucketIds = Array.isArray(options?.bucketIds) && options.bucketIds.length ? options.bucketIds : DEFAULT_BUCKETS;
        const accumulators = {};
        AGENCIES.forEach(agency => {
            accumulators[agency] = {
                overall: { track: metricAccumulator(), intensity: metricAccumulator(), pressure: metricAccumulator() },
                buckets: Object.fromEntries(bucketIds.map(id => [id, { track: metricAccumulator(), intensity: metricAccumulator(), pressure: metricAccumulator() }]))
            };
        });

        const includedStorms = [];
        const excludedStorms = [];
        list.forEach((backtest, index) => {
            const stormKey = backtest?.stormKey || `storm-${index + 1}`;
            const capability = backtest?.backfillCapability?.mode || 'unknown';
            const eligible = backtest?.backfillCapability?.eligibleForAgencySkill !== false
                && (capability === 'full-walk-forward' || capability === 'partial-walk-forward' || capability === 'unknown');
            if (!eligible) {
                excludedStorms.push({ stormKey, reason: `backfill-capability:${capability}` });
                return;
            }
            includedStorms.push(stormKey);
            AGENCIES.forEach(agency => {
                const source = backtest?.metrics?.agencies?.[agency];
                if (!source) return;
                addMetric(accumulators[agency].overall.track, source.trackErrorKm, stormKey);
                addMetric(accumulators[agency].overall.intensity, source.intensityErrorMs, stormKey);
                addMetric(accumulators[agency].overall.pressure, source.pressureErrorHpa, stormKey);
                bucketIds.forEach(id => {
                    const bucket = source?.leadBuckets?.[id];
                    if (!bucket) return;
                    addMetric(accumulators[agency].buckets[id].track, bucket.trackErrorKm, stormKey);
                    addMetric(accumulators[agency].buckets[id].intensity, bucket.intensityErrorMs, stormKey);
                    addMetric(accumulators[agency].buckets[id].pressure, bucket.pressureErrorHpa, stormKey);
                });
            });
        });

        const agencies = {};
        AGENCIES.forEach(agency => {
            agencies[agency] = {
                overall: {
                    trackErrorKm: finishMetric(accumulators[agency].overall.track),
                    intensityErrorMs: finishMetric(accumulators[agency].overall.intensity),
                    pressureErrorHpa: finishMetric(accumulators[agency].overall.pressure)
                },
                leadBuckets: Object.fromEntries(bucketIds.map(id => [id, {
                    trackErrorKm: finishMetric(accumulators[agency].buckets[id].track),
                    intensityErrorMs: finishMetric(accumulators[agency].buckets[id].intensity),
                    pressureErrorHpa: finishMetric(accumulators[agency].buckets[id].pressure)
                }]))
            };
        });

        return {
            schemaVersion: PROFILE_VERSION,
            generatedAt: options?.generatedAt || new Date().toISOString(),
            sourceBacktestVersion: 'historical-walkforward-backtest/v1',
            stormCoverage: {
                supplied: list.length,
                included: includedStorms.length,
                excluded: excludedStorms.length,
                includedStorms,
                excludedStorms
            },
            bucketIds: bucketIds.slice(),
            agencies,
            semantics: {
                groupedByStorm: true,
                truthOnlyExcludedFromAgencySkill: true,
                adaptiveWeightsApplied: false,
                productionWeightsChanged: false,
                modelTrainingPerformed: false,
                aiGenerated: false
            }
        };
    }

    function projectToBounds(values, lower, upper) {
        const result = values.map((value, i) => Math.min(upper[i], Math.max(lower[i], value)));
        for (let iteration = 0; iteration < 40; iteration += 1) {
            const sum = result.reduce((a, b) => a + b, 0);
            const diff = 1 - sum;
            if (Math.abs(diff) < 1e-12) break;
            const available = result.map((value, i) => diff > 0 ? upper[i] - value : value - lower[i]);
            const capacity = available.reduce((a, b) => a + Math.max(0, b), 0);
            if (!(capacity > 0)) break;
            result.forEach((value, i) => {
                const room = Math.max(0, available[i]);
                if (room > 0) result[i] += diff * (room / capacity);
            });
        }
        const finalSum = result.reduce((a, b) => a + b, 0);
        if (Math.abs(finalSum - 1) > 1e-8) throw new Error('weight bounds cannot satisfy sum=1');
        return result;
    }

    function buildAdaptiveWeightCandidate(profile, options) {
        if (!profile || typeof profile !== 'object') throw new Error('skill profile is required');
        const champion = defaultChampionWeights(options?.championWeights);
        const minimumStorms = Math.max(1, Math.floor(finite(options?.minimumStorms) ?? 5));
        const minimumPoints = Math.max(1, Math.floor(finite(options?.minimumPoints) ?? 20));
        const shrinkageStorms = Math.max(1, finite(options?.shrinkageStorms) ?? 10);
        const maxDelta = Math.max(0, finite(options?.maxWeightDelta) ?? 0.08);
        const minWeight = Math.max(0, finite(options?.minWeight) ?? 0.10);
        const maxWeight = Math.min(1, finite(options?.maxWeight) ?? 0.40);
        if (minWeight * AGENCIES.length > 1 || maxWeight * AGENCIES.length < 1) throw new Error('invalid global weight bounds');

        const buckets = {};
        const bucketIds = Array.isArray(profile.bucketIds) ? profile.bucketIds : DEFAULT_BUCKETS;
        bucketIds.forEach(bucketId => {
            const stats = AGENCIES.map(agency => profile?.agencies?.[agency]?.leadBuckets?.[bucketId]?.trackErrorKm || {});
            const peerMaes = stats.map(stat => finite(stat.mae)).filter(Number.isFinite);
            const peerBaselineMae = peerMaes.length ? peerMaes.reduce((a, b) => a + b, 0) / peerMaes.length : null;
            const eligible = stats.map(stat => (finite(stat.stormCount) ?? 0) >= minimumStorms && (finite(stat.count) ?? 0) >= minimumPoints && finite(stat.mae) != null);
            const targetScores = stats.map((stat, i) => {
                if (!eligible[i] || peerBaselineMae == null) return null;
                const stormCount = finite(stat.stormCount) ?? 0;
                const alpha = stormCount / (stormCount + shrinkageStorms);
                const shrunkMae = alpha * stat.mae + (1 - alpha) * peerBaselineMae;
                return { alpha, shrunkMae, score: 1 / Math.max(1e-6, shrunkMae) };
            });
            const scoreSum = targetScores.reduce((sum, item) => sum + (item?.score ?? 0), 0);
            const rawTarget = AGENCIES.map((agency, i) => targetScores[i] && scoreSum > 0 ? targetScores[i].score / scoreSum : champion[agency]);
            const blended = AGENCIES.map((agency, i) => {
                const item = targetScores[i];
                if (!item) return champion[agency];
                return champion[agency] + item.alpha * (rawTarget[i] - champion[agency]);
            });
            const lower = AGENCIES.map(agency => Math.max(minWeight, champion[agency] - maxDelta));
            const upper = AGENCIES.map(agency => Math.min(maxWeight, champion[agency] + maxDelta));
            const projected = projectToBounds(blended, lower, upper);
            const weights = Object.fromEntries(AGENCIES.map((agency, i) => [agency, projected[i]]));
            buckets[bucketId] = {
                status: eligible.filter(Boolean).length >= 2 ? 'candidate' : 'insufficient-sample',
                peerBaselineMaeKm: peerBaselineMae,
                eligibleAgencyCount: eligible.filter(Boolean).length,
                agencies: Object.fromEntries(AGENCIES.map((agency, i) => [agency, {
                    eligible: eligible[i],
                    stormCount: finite(stats[i].stormCount) ?? 0,
                    pointCount: finite(stats[i].count) ?? 0,
                    observedMaeKm: finite(stats[i].mae),
                    reliability: targetScores[i]?.alpha ?? 0,
                    shrunkMaeKm: targetScores[i]?.shrunkMae ?? null,
                    championWeight: champion[agency],
                    candidateWeight: weights[agency],
                    delta: weights[agency] - champion[agency]
                }])),
                weights
            };
        });

        return {
            schemaVersion: CANDIDATE_VERSION,
            generatedAt: options?.generatedAt || new Date().toISOString(),
            sourceProfileVersion: profile.schemaVersion ?? null,
            method: 'inverse-track-mae-with-storm-shrinkage-v1',
            championWeights: champion,
            safeguards: { minimumStorms, minimumPoints, shrinkageStorms, minWeight, maxWeight, maxWeightDelta: maxDelta },
            buckets,
            semantics: {
                candidateOnly: true,
                sparseBucketsRevertTowardChampion: true,
                stormCountControlsReliability: true,
                advisoryRowsDoNotCountAsIndependentStorms: true,
                promotionRequired: true,
                productionWeightsChanged: false,
                aiGenerated: false
            }
        };
    }

    function evaluateChampionChallenger(input) {
        const champion = input?.championMetrics || {};
        const challenger = input?.challengerMetrics || {};
        const minimumSamples = Math.max(1, Math.floor(finite(input?.minimumSamples) ?? 30));
        const minimumImprovement = Math.max(0, finite(input?.minimumImprovementFraction) ?? 0.03);
        const maximumCriticalRegression = Math.max(0, finite(input?.maximumCriticalRegressionFraction) ?? 0.02);
        const sampleCount = Math.min(finite(champion.sampleCount) ?? 0, finite(challenger.sampleCount) ?? 0);
        const championMae = finite(champion.trackMaeKm);
        const challengerMae = finite(challenger.trackMaeKm);
        const improvement = championMae != null && challengerMae != null && championMae > 0
            ? (championMae - challengerMae) / championMae : null;
        const critical = Array.isArray(input?.criticalMetrics) ? input.criticalMetrics : ['closestTimeMaeHours', 'closestDistanceMaeKm'];
        const regressions = critical.map(key => {
            const c = finite(champion[key]);
            const n = finite(challenger[key]);
            const fraction = c != null && n != null && c > 0 ? (n - c) / c : null;
            return { metric: key, champion: c, challenger: n, regressionFraction: fraction };
        });
        const failed = [];
        if (sampleCount < minimumSamples) failed.push('insufficient-samples');
        if (improvement == null || improvement < minimumImprovement) failed.push('insufficient-track-improvement');
        regressions.forEach(item => {
            if (item.regressionFraction != null && item.regressionFraction > maximumCriticalRegression) failed.push(`critical-regression:${item.metric}`);
        });
        return {
            eligibleForPromotion: failed.length === 0,
            promotionPerformed: false,
            sampleCount,
            trackImprovementFraction: improvement,
            criticalRegressions: regressions,
            failedGates: failed,
            thresholds: { minimumSamples, minimumImprovementFraction: minimumImprovement, maximumCriticalRegressionFraction: maximumCriticalRegression },
            semantics: { manualPromotionRequired: true, automaticPromotion: false }
        };
    }

    return Object.freeze({
        PROFILE_VERSION,
        CANDIDATE_VERSION,
        AGENCIES,
        DEFAULT_BUCKETS,
        buildSkillProfile,
        buildAdaptiveWeightCandidate,
        evaluateChampionChallenger
    });
});
