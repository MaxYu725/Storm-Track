'use strict';
const assert = require('node:assert/strict');
const importer = require('../analysis/historical-backfill-importer.js');

function truth() {
    return {
        source: 'JMA RSMC best track', datasetId: 'jma-sample',
        track: [
            { time: '2026-08-20T00:00:00Z', lat: 20, lon: 120, maximumWind: '25 m/s' },
            { time: '2026-08-20T00:00:00Z', lat: 20, lon: 120, maximumWind: '25 m/s' },
            { time: '2026-08-20T06:00:00Z', lat: 21, lon: 119 }
        ]
    };
}
function snapshot(asOf) {
    return {
        schemaVersion: 'storm-analysis-snapshot/v1', generatedAt: asOf,
        storm: { key: 'sample' }, sources: {
            HKO: { state: 'ok', baseTime: asOf, forecast: [{ time: '2026-08-21T00:00:00Z', lat: 22, lon: 116 }] },
            CMA: { state: 'missing' }, JMA: { state: 'missing' }, CWA: { state: 'missing' }
        }
    };
}
function goodCase(asOf = '2026-08-20T00:00:00Z') {
    return {
        asOf, snapshot: snapshot(asOf),
        provenance: { type: 'storm-track-d1', source: 'Storm Track D1 advisory', originalIssuedAt: asOf, archiveId: 'adv-1' }
    };
}

(function stableFingerprintIgnoresObjectKeyOrder() {
    assert.equal(importer.fingerprint({ a: 1, b: 2 }), importer.fingerprint({ b: 2, a: 1 }));
})();

(function duplicateTruthPointsAreRemoved() {
    const storm = importer.buildStormImport({ stormKey: 'sample', truth: truth() });
    assert.equal(storm.truthDataset.points.length, 2);
    assert.equal(storm.capability.mode, 'truth-only');
})();

(function trustedForecastWithTruthIsFullWalkForward() {
    const storm = importer.buildStormImport({ stormKey: 'sample', truth: truth(), predictionCases: [goodCase()] });
    assert.equal(storm.capability.mode, 'full-walk-forward');
    assert.equal(storm.capability.eligibleForAgencySkill, true);
    assert.equal(storm.forecastCases[0].eligibleForWalkForward, true);
})();

(function bestTrackCannotMasqueradeAsForecast() {
    const item = goodCase();
    item.provenance = { type: 'auditable-archive', source: 'JMA best track', originalIssuedAt: item.asOf, dataRole: 'truth' };
    const storm = importer.buildStormImport({ stormKey: 'sample', truth: truth(), predictionCases: [item] });
    assert.equal(storm.capability.mode, 'truth-only');
    assert.equal(storm.forecastCases[0].eligibleForWalkForward, false);
    assert.equal(storm.forecastCases[0].rejectionReason, 'not-forecast-role');
})();

(function unknownArchiveIsExcludedFromSkill() {
    const item = goodCase();
    item.provenance.type = 'unknown';
    const storm = importer.buildStormImport({ stormKey: 'sample', truth: truth(), predictionCases: [item] });
    assert.equal(storm.capability.eligibleForAgencySkill, false);
    assert.equal(storm.forecastCases[0].rejectionReason, 'untrusted-provenance-type');
})();

(function futureIssuedForecastIsRejected() {
    const item = goodCase('2026-08-20T00:00:00Z');
    item.provenance.originalIssuedAt = '2026-08-20T06:00:00Z';
    const storm = importer.buildStormImport({ stormKey: 'sample', truth: truth(), predictionCases: [item] });
    assert.equal(storm.forecastCases[0].eligibleForWalkForward, false);
    assert.equal(storm.forecastCases[0].rejectionReason, 'issued-after-as-of');
})();

(function explicitSignalOutcomeIsStoredWithoutInference() {
    const storm = importer.buildStormImport({
        stormKey: 'sample', truth: truth(),
        signalOutcome: { source: 'HKO warning database', highestSignal: 'T8', issuedAt: '2026-08-20T12:00:00Z', signalSystemEra: 'modern' }
    });
    assert.equal(storm.signalOutcome.source, 'HKO warning database');
    assert.equal(storm.signalOutcome.highestSignal, 'T8');
})();

(function importPlanIsDeterministicAndIdempotent() {
    const input = { source: 'test', generatedAt: '2026-08-21T00:00:00Z', storms: [{ stormKey: 'sample', truth: truth(), predictionCases: [goodCase()] }] };
    const a = importer.buildImportPlan(input);
    const b = importer.buildImportPlan(input);
    assert.equal(a.runId, b.runId);
    assert.deepEqual(a.rows, b.rows);
    assert.equal(a.tableCounts.truth_points, 2);
    assert.equal(a.tableCounts.forecast_snapshots, 1);
    assert.equal(a.semantics.productionDatabaseWritten, false);
    assert.equal(a.semantics.bestTrackMayNotBeForecastProvenance, true);
})();

console.log('historical-backfill-importer tests: OK');
