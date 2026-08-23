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

(function testConsensusTrackBuildsValidTimeAlignedSeries() {
    const base = '2026-08-20T00:00:00Z';
    const makePoints = (latOffset, lonOffset) => [
        point('2026-08-20T12:00:00Z', 18 + latOffset, 120 + lonOffset),
        point('2026-08-21T00:00:00Z', 19 + latOffset, 119 + lonOffset),
        point('2026-08-21T12:00:00Z', 20 + latOffset, 118 + lonOffset),
        point('2026-08-22T00:00:00Z', 21 + latOffset, 117 + lonOffset)
    ];
    const group = {
        key: 'track-series',
        sources: {
            HKO: source('HKO', base, makePoints(0.0, 0.0), { time: base, lat: 17.0, lon: 121.0 }),
            CMA: source('CMA', base, makePoints(0.2, 0.2), { time: base, lat: 17.2, lon: 121.2 }),
            JMA: source('JMA', base, makePoints(-0.2, -0.2), { time: base, lat: 16.8, lon: 120.8 }),
            CWA: source('CWA', base, makePoints(0.1, -0.1), { time: base, lat: 17.1, lon: 120.9 })
        }
    };

    const track = core.buildConsensusTrackForGroup(group, {
        generatedAt: base,
        consensusTrackStartLeadHours: 0,
        consensusTrackEndLeadHours: 48,
        consensusTrackStepHours: 12
    });

    assert.equal(track.schemaVersion, 'storm-consensus-track/v0');
    assert.equal(track.state, 'ok');
    assert.equal(track.method, 'valid-time-aligned-unweighted-mean-v1');
    assert.equal(track.referenceAgency, 'HKO');
    assert.equal(track.referenceBaseTime, '2026-08-20T00:00:00.000Z');
    assert.equal(track.referenceMethod, 'latest-analysis-valid-time');
    assert.equal(track.points.length, 5);

    const lead0 = track.points[0];
    assert.equal(lead0.leadHours, 0);
    assert.equal(lead0.agencyCount, 4);
    assert.equal(lead0.consensus.agencyCount, 4);
    assert.equal(lead0.entries.every(entry => entry.kind === 'analysis'), true);

    const lead24 = track.points.find(item => item.leadHours === 24);
    assert.ok(lead24);
    assert.equal(lead24.validTime, '2026-08-21T00:00:00.000Z');
    assert.equal(lead24.agencyCount, 4);
    assert.equal(lead24.consensus.method, 'unweighted-mean-v1');
    assert.ok(lead24.spread.distanceKm > 0);
})();

(function testConsensusTrackInterpolatesAtCommonValidTimeAcrossDifferentBaseTimes() {
    const hkoBase = '2026-08-20T00:00:00Z';
    const cmaBase = '2026-08-20T06:00:00Z';
    const track = core.buildConsensusTrackForGroup({
        key: 'mixed-base-times',
        sources: {
            HKO: source('HKO', hkoBase, [
                point('2026-08-20T12:00:00Z', 18.0, 120.0),
                point('2026-08-21T00:00:00Z', 20.0, 118.0)
            ]),
            CMA: source('CMA', cmaBase, [
                point('2026-08-20T06:00:00Z', 17.0, 121.0),
                point('2026-08-20T18:00:00Z', 19.0, 119.0),
                point('2026-08-21T06:00:00Z', 21.0, 117.0)
            ])
        }
    }, {
        generatedAt: '2026-08-20T07:00:00Z',
        consensusTrackStartLeadHours: 12,
        consensusTrackEndLeadHours: 12,
        consensusTrackStepHours: 6
    });

    const trackPoint = track.points[0];
    assert.equal(trackPoint.validTime, '2026-08-20T12:00:00.000Z');
    assert.equal(trackPoint.agencyCount, 2);
    const cma = trackPoint.entries.find(entry => entry.agency === 'CMA');
    assert.ok(cma);
    assert.equal(cma.interpolated, true);
    assert.equal(cma.sourceBaseTime, '2026-08-20T06:00:00.000Z');
    assert.equal(trackPoint.consensus.agencyCount, 2);
})();

(function testConsensusTrackUsesTrueLatestAnalysisInsteadOfOddBulletinTime() {
    const track = core.buildConsensusTrackForGroup({
        key: 'analysis-reference',
        sources: {
            HKO: {
                agency: 'HKO',
                sourceId: 'HKO-live-shape',
                bulletinTime: '2026-08-20T04:30:39Z',
                positions: [{ kind: 'analysis', time: '2026-08-20T00:00:00Z', lat: 18, lon: 121 }],
                forecast: [
                    point('2026-08-20T06:00:00Z', 18.6, 120.4),
                    point('2026-08-20T12:00:00Z', 19.2, 119.8)
                ]
            },
            CMA: {
                agency: 'CMA',
                sourceId: 'CMA-live-shape',
                bulletinTime: '2026-08-20T03:17:51Z',
                positions: [{ kind: 'analysis', time: '2026-08-20T03:00:00Z', lat: 18.4, lon: 120.7 }],
                forecast: [
                    point('2026-08-20T09:00:00Z', 19.0, 120.1),
                    point('2026-08-20T15:00:00Z', 19.6, 119.5)
                ]
            }
        }
    }, {
        generatedAt: '2026-08-20T04:45:00Z',
        consensusTrackStartLeadHours: 0,
        consensusTrackEndLeadHours: 0,
        consensusTrackStepHours: 6
    });

    assert.equal(track.referenceAgency, 'CMA');
    assert.equal(track.referenceBaseTime, '2026-08-20T03:00:00.000Z');
    assert.equal(track.referenceMethod, 'latest-analysis-valid-time');
    assert.equal(track.points[0].validTime, '2026-08-20T03:00:00.000Z');
    assert.equal(track.points[0].agencyCount, 2);
    assert.equal(track.points[0].consensus.agencyCount, 2);
    const hko = track.points[0].entries.find(entry => entry.agency === 'HKO');
    assert.ok(hko);
    assert.equal(hko.interpolated, true);
})();

(function testConsensusTrackDoesNotCallSingleAgencyAConsensus() {
    const base = '2026-08-20T00:00:00Z';
    const track = core.buildConsensusTrackForGroup({
        key: 'single-agency',
        sources: {
            HKO: source('HKO', base, [
                point('2026-08-21T00:00:00Z', 20.0, 118.0)
            ])
        }
    }, {
        generatedAt: base,
        consensusTrackStartLeadHours: 24,
        consensusTrackEndLeadHours: 24,
        consensusTrackStepHours: 6
    });

    assert.equal(track.state, 'insufficient-coverage');
    assert.equal(track.points.length, 1);
    assert.equal(track.points[0].agencyCount, 1);
    assert.equal(track.points[0].consensus, null);
    assert.equal(track.points[0].spread, null);
})();

console.log('storm-analysis-core tests: OK');
