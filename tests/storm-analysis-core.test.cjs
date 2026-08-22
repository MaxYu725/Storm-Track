'use strict';

const assert = require('node:assert/strict');
const core = require('../analysis/storm-analysis-core.js');

function point(time, lat, lon, extra = {}) {
    return { kind: 'forecast', time, lat, lon, ...extra };
}

function source(agency, baseTime, points, current = null) {
    return {
        agency,
        sourceId: `${agency}-sample`,
        bulletinTime: baseTime,
        positions: current ? [{ kind: 'analysis', ...current }] : [],
        forecast: points.map(item => ({ ...item, baseTime }))
    };
}

(function testHaversineIdentity() {
    assert.equal(core.haversineKm(22.3023, 114.1746, 22.3023, 114.1746), 0);
})();

(function testCommonValidTimeAndInterpolation() {
    const base = '2026-08-20T00:00:00Z';
    const group = {
        key: 'sample',
        displayName: 'Sample Storm',
        sources: {
            HKO: source('HKO', base, [
                point('2026-08-21T00:00:00Z', 20.0, 113.0)
            ]),
            CMA: source('CMA', base, [
                point('2026-08-20T12:00:00Z', 19.0, 112.0),
                point('2026-08-21T12:00:00Z', 21.0, 114.0)
            ]),
            JMA: source('JMA', base, [
                point('2026-08-21T00:00:00Z', 20.5, 113.5)
            ]),
            CWA: source('CWA', base, [
                point('2026-08-21T00:00:00Z', 19.5, 112.5)
            ])
        }
    };

    const snapshot = core.buildStormAnalysisSnapshot(group, {
        generatedAt: '2026-08-20T01:00:00Z',
        compareLeadHours: 24
    });

    assert.equal(snapshot.schemaVersion, 'storm-analysis-snapshot/v1');
    assert.equal(snapshot.comparison.referenceAgency, 'HKO');
    assert.equal(snapshot.comparison.targetValidTime, '2026-08-21T00:00:00.000Z');
    assert.equal(snapshot.comparison.entries.length, 4);

    const cma = snapshot.comparison.entries.find(entry => entry.agency === 'CMA');
    assert.ok(cma);
    assert.equal(cma.interpolated, true);
    assert.equal(cma.lat, 20);
    assert.equal(cma.lon, 113);

    assert.equal(snapshot.comparison.consensus.agencyCount, 4);
    assert.equal(snapshot.comparison.consensus.appComputed, true);
    assert.ok(snapshot.comparison.spread.distanceKm > 0);
    assert.equal(snapshot.semantics.aiGenerated, false);
})();

(function testAgencyFailureIsolation() {
    const base = '2026-08-20T00:00:00Z';
    const snapshot = core.buildStormAnalysisSnapshot({
        key: 'partial',
        sources: {
            HKO: source('HKO', base, [point('2026-08-21T00:00:00Z', 20, 113)]),
            CMA: { agency: 'CMA', positions: [], forecast: [{ lat: 'bad', lon: 112, time: 'invalid' }] },
            JMA: source('JMA', base, [point('2026-08-21T00:00:00Z', 20.2, 113.2)])
        }
    }, { generatedAt: base });

    assert.equal(snapshot.sources.HKO.state, 'ok');
    assert.equal(snapshot.sources.CMA.state, 'empty');
    assert.equal(snapshot.sources.JMA.state, 'ok');
    assert.equal(snapshot.sources.CWA.state, 'missing');
    assert.deepEqual(snapshot.coverage.usableAgencies, ['HKO', 'JMA']);
    assert.equal(snapshot.comparison.entries.length, 2);
})();

(function testNearestApproachUsesLatestAnalysisPlusForecast() {
    const base = '2026-08-20T00:00:00Z';
    const snapshot = core.buildStormAnalysisSnapshot({
        key: 'nearest',
        sources: {
            HKO: source('HKO', base, [
                point('2026-08-20T12:00:00Z', 22.0, 115.0),
                point('2026-08-21T00:00:00Z', 22.3, 114.3),
                point('2026-08-21T12:00:00Z', 22.0, 113.0)
            ], { time: base, lat: 21.5, lon: 116.0 })
        }
    }, { generatedAt: base });

    const nearest = snapshot.sources.HKO.nearestApproach;
    assert.ok(nearest);
    assert.equal(nearest.time, '2026-08-21T00:00:00.000Z');
    assert.ok(nearest.distanceKm < 20);
})();

console.log('storm-analysis-core tests: OK');
