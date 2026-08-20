'use strict';

const assert = require('node:assert/strict');
const backtest = require('../analysis/historical-walkforward-backtester.js');

function snapshot(asOf, sourceBase = asOf) {
    return {
        schemaVersion: 'storm-analysis-snapshot/v1',
        generatedAt: asOf,
        storm: { key: 'sample' },
        coverage: { usableAgencyCount: 2 },
        sources: {
            HKO: {
                state: 'ok', baseTime: sourceBase, bulletinTime: sourceBase,
                forecast: [{ time: '2026-08-21T12:00:00Z', lat: 1, lon: 1 }]
            },
            CMA: {
                state: 'ok', baseTime: sourceBase, bulletinTime: sourceBase,
                forecast: [{ time: '2026-08-21T12:00:00Z', lat: 1.2, lon: 1.2 }]
            },
            JMA: { state: 'missing' },
            CWA: { state: 'missing' }
        }
    };
}

(function testFutureForecastValidTimeIsAllowed() {
    const asOf = '2026-08-20T00:00:00Z';
    const result = backtest.validatePredictionCase({ asOf, snapshot: snapshot(asOf) });
    assert.equal(result.valid, true);
    assert.deepEqual(result.issues, []);
})();

(function testFutureSourceAvailabilityIsRejected() {
    const asOf = '2026-08-20T00:00:00Z';
    const result = backtest.validatePredictionCase({
        asOf,
        snapshot: snapshot(asOf, '2026-08-20T06:00:00Z')
    });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some(issue => issue.code === 'source-available-after-cutoff' && issue.agency === 'HKO'));
})();

(function testFutureOfficialWarningContextIsRejected() {
    const asOf = '2026-08-20T00:00:00Z';
    const result = backtest.validatePredictionCase({
        asOf,
        snapshot: snapshot(asOf),
        signalInputs: {
            generatedAt: asOf,
            officialHkoWarningContext: {
                provided: true,
                issuedAt: '2026-08-20T03:00:00Z',
                currentSignal: 'T8'
            }
        }
    });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some(issue => issue.code === 'official-warning-context-after-cutoff'));
})();

(function testBackfillCapabilityModes() {
    const truth = { source: 'JMA best track', track: [{ time: '2026-08-20T00:00:00Z', lat: 0, lon: 0 }] };
    assert.equal(backtest.normalizeBackfillMetadata({ truth, predictionCases: [] }).mode, 'truth-only');
    assert.equal(backtest.normalizeBackfillMetadata({
        truth,
        predictionCases: [{ snapshot: snapshot('2026-08-20T00:00:00Z') }]
    }).mode, 'full-walk-forward');
    assert.equal(backtest.normalizeBackfillMetadata({
        truth,
        predictionCases: [
            { snapshot: snapshot('2026-08-20T00:00:00Z') },
            { snapshot: { sources: { HKO: { state: 'ok', forecast: [] } } } }
        ]
    }).mode, 'partial-walk-forward');
})();

function fakeVerification(input) {
    const marker = input.snapshot.marker || 0;
    return {
        agencies: {
            HKO: {
                points: [
                    { leadHours: 6, errors: { trackKm: 20 + marker, intensityMs: 2, pressureHpa: -3 } },
                    { leadHours: 18, errors: { trackKm: 40 + marker, intensityMs: -1, pressureHpa: 4 } },
                    { leadHours: 36, errors: { trackKm: 80 + marker, intensityMs: 3, pressureHpa: 5 } }
                ]
            },
            CMA: {
                points: [
                    { leadHours: 6, errors: { trackKm: 30 + marker, intensityMs: null, pressureHpa: null } },
                    { leadHours: 36, errors: { trackKm: 70 + marker, intensityMs: null, pressureHpa: null } }
                ]
            },
            JMA: { points: [] },
            CWA: { points: [] }
        },
        consensusAtCommonValidTime: { trackErrorKm: 25 + marker },
        hongKongImpact: {
            consensusClosestApproach: {
                errors: { distanceKm: -10 + marker, timeHours: 1.5 + marker / 10 }
            }
        }
    };
}

(function testWalkForwardAggregatesLeadBucketsAndRejectsLeakage() {
    const firstAsOf = '2026-08-20T00:00:00Z';
    const secondAsOf = '2026-08-20T06:00:00Z';
    const leakedAsOf = '2026-08-20T12:00:00Z';
    const first = snapshot(firstAsOf); first.marker = 0;
    const second = snapshot(secondAsOf); second.marker = 10;
    const leaked = snapshot(leakedAsOf, '2026-08-20T18:00:00Z'); leaked.marker = 100;

    const result = backtest.runHistoricalWalkForward({
        stormKey: 'sample',
        generatedAt: '2026-08-25T00:00:00Z',
        truth: {
            source: 'JMA RSMC best track',
            datasetId: 'sample-truth',
            track: [
                { time: '2026-08-20T00:00:00Z', lat: 0, lon: 0 },
                { time: '2026-08-22T00:00:00Z', lat: 1, lon: 1 }
            ]
        },
        predictionCases: [
            { caseId: 'a', asOf: firstAsOf, snapshot: first },
            { caseId: 'b', asOf: secondAsOf, snapshot: second },
            { caseId: 'leak', asOf: leakedAsOf, snapshot: leaked }
        ]
    }, { buildForecastVerification: fakeVerification });

    assert.equal(result.schemaVersion, 'historical-walkforward-backtest/v1');
    assert.equal(result.caseSummary.total, 3);
    assert.equal(result.caseSummary.verified, 2);
    assert.equal(result.caseSummary.rejectedLeakage, 1);
    assert.equal(result.cases.find(item => item.caseId === 'leak').status, 'rejected-leakage');

    assert.equal(result.metrics.agencies.HKO.trackErrorKm.count, 6);
    assert.equal(result.metrics.agencies.HKO.leadBuckets['0-12h'].trackErrorKm.count, 2);
    assert.equal(result.metrics.agencies.HKO.leadBuckets['12-24h'].trackErrorKm.count, 2);
    assert.equal(result.metrics.agencies.HKO.leadBuckets['24-48h'].trackErrorKm.count, 2);
    assert.equal(result.metrics.consensus.commonValidTrackErrorKm.count, 2);
    assert.equal(result.semantics.truthUsedOnlyForVerification, true);
    assert.equal(result.semantics.bestTrackMustNotBeUsedAsHistoricalForecast, true);
    assert.equal(result.semantics.adaptiveWeightsUpdated, false);
    assert.equal(result.semantics.modelTrainingPerformed, false);
})();

(function testTruthSourceRequired() {
    assert.throws(() => backtest.runHistoricalWalkForward({
        truth: { track: [{ time: '2026-08-20T00:00:00Z', lat: 0, lon: 0 }] },
        predictionCases: []
    }, { buildForecastVerification: fakeVerification }), /truth\.source/);
})();

console.log('historical-walkforward-backtester tests: OK');
