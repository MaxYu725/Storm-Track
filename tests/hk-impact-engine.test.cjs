'use strict';

const assert = require('node:assert/strict');
const impact = require('../analysis/hk-impact-engine.js');

function trackPoint(time, lat, lon, kind = 'forecast') {
    return { time, lat, lon, kind };
}

function source(points, positions = []) {
    return { state: 'ok', positions, forecast: points };
}

function snapshot(sources, comparisonSpreadKm = 80) {
    return {
        schemaVersion: 'storm-analysis-snapshot/v1',
        generatedAt: '2026-08-20T00:00:00Z',
        storm: { key: 'sample', displayName: 'Sample Storm' },
        referencePoint: { name: 'Hong Kong', lat: 0, lon: 0 },
        sources,
        comparison: { spread: { distanceKm: comparisonSpreadKm } }
    };
}

(function testContinuousClosestApproachBetweenOfficialPoints() {
    const track = [
        trackPoint('2026-08-20T00:00:00Z', 0, -1),
        trackPoint('2026-08-20T12:00:00Z', 0, 1)
    ].map(point => ({ ...point, timeMs: Date.parse(point.time) }));
    const nearest = impact.calculateContinuousNearest(track, { lat: 0, lon: 0 });
    assert.ok(nearest.distanceKm < 0.01);
    assert.ok(Math.abs(Date.parse(nearest.time) - Date.parse('2026-08-20T06:00:00Z')) < 60 * 1000);
    assert.equal(nearest.method, 'linear-segment-minimum-v1');
})();

(function testDistanceBandDetectsEnterAndExitWithinOneSegmentPair() {
    const track = [
        trackPoint('2026-08-20T00:00:00Z', 0, -10),
        trackPoint('2026-08-20T12:00:00Z', 0, 0),
        trackPoint('2026-08-21T00:00:00Z', 0, 10)
    ].map(point => ({ ...point, timeMs: Date.parse(point.time) }));
    const intervals = impact.calculateBandIntervals(track, 500, { lat: 0, lon: 0 });
    assert.equal(intervals.length, 1);
    assert.ok(Date.parse(intervals[0].enterTime) > Date.parse('2026-08-20T05:00:00Z'));
    assert.ok(Date.parse(intervals[0].enterTime) < Date.parse('2026-08-20T08:00:00Z'));
    assert.ok(Date.parse(intervals[0].exitTime) > Date.parse('2026-08-20T16:00:00Z'));
    assert.ok(Date.parse(intervals[0].exitTime) < Date.parse('2026-08-20T19:00:00Z'));
})();

(function testSingleSegmentCanEnterAndExitBandWithBothEndpointsOutside() {
    const track = [
        trackPoint('2026-08-20T00:00:00Z', 0, -10),
        trackPoint('2026-08-21T00:00:00Z', 0, 10)
    ].map(point => ({ ...point, timeMs: Date.parse(point.time) }));
    const intervals = impact.calculateBandIntervals(track, 500, { lat: 0, lon: 0 });
    assert.equal(intervals.length, 1);
    assert.ok(Date.parse(intervals[0].enterTime) < Date.parse('2026-08-20T12:00:00Z'));
    assert.ok(Date.parse(intervals[0].exitTime) > Date.parse('2026-08-20T12:00:00Z'));
})();

(function testDatelineInterpolationUsesShortArc() {
    const track = [
        { ...trackPoint('2026-08-20T00:00:00Z', 10, 179), timeMs: Date.parse('2026-08-20T00:00:00Z') },
        { ...trackPoint('2026-08-20T12:00:00Z', 10, -179), timeMs: Date.parse('2026-08-20T12:00:00Z') }
    ];
    const mid = impact.interpolateTrackAtTime(track, Date.parse('2026-08-20T06:00:00Z'));
    assert.ok(Math.abs(Math.abs(mid.lon) - 180) < 0.001);
})();

(function testImpactAggregateAndConsensusClosest() {
    const sources = {
        HKO: source([
            trackPoint('2026-08-20T06:00:00Z', 0, 2),
            trackPoint('2026-08-20T12:00:00Z', 0, 0.2),
            trackPoint('2026-08-20T18:00:00Z', 0, -2)
        ], [trackPoint('2026-08-20T00:00:00Z', 0, 4, 'analysis')]),
        CMA: source([
            trackPoint('2026-08-20T06:00:00Z', 0.2, 2.2),
            trackPoint('2026-08-20T12:00:00Z', 0.2, 0.4),
            trackPoint('2026-08-20T18:00:00Z', 0.2, -1.8)
        ], [trackPoint('2026-08-20T00:00:00Z', 0.2, 4.2, 'analysis')]),
        JMA: source([
            trackPoint('2026-08-20T06:00:00Z', -0.2, 1.8),
            trackPoint('2026-08-20T12:00:00Z', -0.2, 0.1),
            trackPoint('2026-08-20T18:00:00Z', -0.2, -2.2)
        ], [trackPoint('2026-08-20T00:00:00Z', -0.2, 4, 'analysis')]),
        CWA: { state: 'missing' }
    };
    const result = impact.buildHongKongImpact(snapshot(sources, 70), {
        distanceBandsKm: [800, 400, 200, 100],
        consensusStepHours: 3
    });

    assert.equal(result.schemaVersion, 'hk-impact/v1');
    assert.equal(result.agencyClosestApproaches.length, 3);
    assert.ok(result.closestApproach.distanceRangeKm.min >= 0);
    assert.ok(result.closestApproach.consensus);
    assert.equal(result.closestApproach.consensus.appComputed, true);
    assert.ok(result.closestApproach.consensus.distanceKm < 30);
    assert.equal(result.trend.aggregate, 'approaching');
    assert.ok(result.distanceBands['400'].agenciesEntering.includes('HKO'));
    assert.equal(result.uncertainty.level, 'low');
    assert.equal(result.semantics.hkoSignalPredictionIncluded, false);
    assert.equal(result.semantics.aiGenerated, false);
})();

(function testUncertaintyBecomesInsufficientWithOneAgency() {
    const result = impact.buildHongKongImpact(snapshot({
        HKO: source([
            trackPoint('2026-08-20T06:00:00Z', 0, 2),
            trackPoint('2026-08-20T12:00:00Z', 0, 1)
        ], [trackPoint('2026-08-20T00:00:00Z', 0, 3, 'analysis')]),
        CMA: { state: 'missing' },
        JMA: { state: 'missing' },
        CWA: { state: 'missing' }
    }));
    assert.equal(result.uncertainty.level, 'insufficient');
    assert.equal(result.closestApproach.consensus, null);
    assert.equal(result.trend.agencies.CMA, undefined);
})();

(function testDepartingTrend() {
    const result = impact.buildHongKongImpact(snapshot({
        HKO: source([
            trackPoint('2026-08-20T06:00:00Z', 0, 2),
            trackPoint('2026-08-20T12:00:00Z', 0, 4)
        ], [trackPoint('2026-08-20T00:00:00Z', 0, 1, 'analysis')]),
        CMA: { state: 'missing' },
        JMA: { state: 'missing' },
        CWA: { state: 'missing' }
    }));
    assert.equal(result.trend.agencies.HKO.state, 'departing');
    assert.equal(result.trend.aggregate, 'departing');
})();

console.log('hk-impact-engine tests: OK');
