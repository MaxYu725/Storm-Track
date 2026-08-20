'use strict';

const assert = require('node:assert/strict');
const verify = require('../analysis/forecast-verification-engine.js');

function forecast(time, lat, lon, extra = {}) {
    return { kind: 'forecast', time, lat, lon, ...extra };
}

function source(baseTime, points) {
    return { state: 'ok', baseTime, forecast: points, positions: [] };
}

function makeSnapshot() {
    const base = '2026-08-20T00:00:00Z';
    return {
        schemaVersion: 'storm-analysis-snapshot/v1',
        generatedAt: base,
        storm: { key: 'sample', displayName: 'Sample Storm' },
        referencePoint: { name: 'Hong Kong', lat: 0, lon: 0 },
        coverage: { usableAgencyCount: 2 },
        sources: {
            HKO: source(base, [
                forecast('2026-08-20T06:00:00Z', 0, 1.2, { maximumWind: '30 m/s', pressure: 970 }),
                forecast('2026-08-20T12:00:00Z', 0, 0.2, { maximumWind: '35 m/s', pressure: 960 })
            ]),
            CMA: source(base, [
                forecast('2026-08-20T06:00:00Z', 0.1, 1.1, { maximumWind: 28, pressure: 972 }),
                forecast('2026-08-20T12:00:00Z', 0.1, 0.3, { maximumWind: 34, pressure: 962 })
            ]),
            JMA: { state: 'missing' },
            CWA: { state: 'missing' }
        },
        comparison: {
            targetValidTime: '2026-08-20T12:00:00Z',
            spread: { distanceKm: 25 },
            consensus: { appComputed: true, agencies: ['HKO', 'CMA'], agencyCount: 2, lat: 0.05, lon: 0.25 }
        }
    };
}

const truth = {
    source: 'HKO-best-track-test',
    datasetId: 'truth-1',
    track: [
        { time: '2026-08-20T00:00:00Z', lat: 0, lon: 2, maximumWind: '20 m/s', pressure: 990 },
        { time: '2026-08-20T12:00:00Z', lat: 0, lon: 0, maximumWind: '36 m/s', pressure: 958 },
        { time: '2026-08-21T00:00:00Z', lat: 0, lon: -2, maximumWind: '30 m/s', pressure: 965 }
    ]
};

(function testRequiresExplicitTruthSource() {
    assert.throws(() => verify.buildForecastVerification({ snapshot: makeSnapshot(), truth: { track: truth.track } }), /truth\.source/);
})();

(function testForecastPointVerificationWithInterpolatedTruth() {
    const result = verify.buildForecastVerification({ snapshot: makeSnapshot(), truth, verifiedAt: '2026-08-21T01:00:00Z' });
    assert.equal(result.schemaVersion, 'forecast-verification/v1');
    assert.equal(result.agencies.HKO.state, 'verified');
    assert.equal(result.agencies.HKO.points.length, 2);
    assert.equal(result.agencies.HKO.points[0].actual.interpolated, true);
    assert.ok(result.agencies.HKO.points[0].errors.trackKm < 30);
    assert.ok(result.agencies.HKO.summary.trackErrorKm.mae > 0);
    assert.equal(result.semantics.truthSourceInferred, false);
    assert.equal(result.semantics.adaptiveWeightsUpdated, false);
})();

(function testConsensusVerification() {
    const result = verify.buildForecastVerification({ snapshot: makeSnapshot(), truth });
    assert.ok(result.consensusAtCommonValidTime);
    assert.ok(result.consensusAtCommonValidTime.trackErrorKm > 0);
    assert.equal(result.consensusAtCommonValidTime.appComputed, true);
})();

(function testClosestApproachVerification() {
    const impact = {
        schemaVersion: 'hk-impact/v1',
        closestApproach: { consensus: { time: '2026-08-20T12:30:00Z', distanceKm: 15, lat: 0, lon: 0.1 } },
        agencyClosestApproaches: [
            { agency: 'HKO', time: '2026-08-20T12:00:00Z', distanceKm: 22, lat: 0, lon: 0.2 }
        ]
    };
    const result = verify.buildForecastVerification({ snapshot: makeSnapshot(), impact, truth });
    assert.ok(result.truth.actualClosestApproach.distanceKm < 0.01);
    assert.ok(Math.abs(result.hongKongImpact.consensusClosestApproach.errors.timeHours - 0.5) < 0.01);
    assert.equal(result.hongKongImpact.consensusClosestApproach.errors.distanceKm, 15);
    assert.ok(result.hongKongImpact.agencyClosestApproaches.HKO);
})();

(function testOfficialWarningOutcomeOnlyWhenProvided() {
    const without = verify.buildForecastVerification({ snapshot: makeSnapshot(), truth });
    assert.equal(without.truth.officialHkoWarningOutcome, null);
    const withOutcome = verify.buildForecastVerification({
        snapshot: makeSnapshot(),
        truth: {
            ...truth,
            officialHkoWarningOutcome: { highestSignal: 'T8', issuedAt: '2026-08-20T09:00:00Z', source: 'HKO bulletin' }
        }
    });
    assert.equal(withOutcome.truth.officialHkoWarningOutcome.highestSignal, 'T8');
    assert.equal(withOutcome.truth.officialHkoWarningOutcome.inferred, false);
    assert.equal(withOutcome.calibrationRecord.hkoOfficialOutcomeProvided, true);
})();

(function testDatelineTruthInterpolation() {
    const points = [
        { time: '2026-08-20T00:00:00Z', lat: 10, lon: 179 },
        { time: '2026-08-20T12:00:00Z', lat: 10, lon: -179 }
    ].map(item => ({ ...item, timeMs: Date.parse(item.time) }));
    const mid = verify.interpolatePointAtTime(points, Date.parse('2026-08-20T06:00:00Z'));
    assert.ok(Math.abs(Math.abs(mid.lon) - 180) < 0.001);
})();

console.log('forecast-verification-engine tests: OK');
