'use strict';

const assert = require('node:assert/strict');
const signalInputs = require('../analysis/hko-signal-risk-inputs.js');

function rawPoint(time, lat, lon, extra = {}) {
    return { time, lat, lon, kind: extra.kind || 'forecast', ...extra };
}

function rawSource(positions, forecast) {
    return { positions, forecast };
}

function makeSnapshot() {
    const base = '2026-08-20T00:00:00Z';
    return {
        schemaVersion: 'storm-analysis-snapshot/v1',
        generatedAt: base,
        storm: { key: 'sample', displayName: 'Sample Storm' },
        referencePoint: { name: 'Hong Kong', lat: 0, lon: 0 },
        coverage: { usableAgencies: ['HKO', 'CMA', 'JMA'], usableAgencyCount: 3 },
        sources: {
            HKO: { state: 'ok', baseTime: base },
            CMA: { state: 'ok', baseTime: base },
            JMA: { state: 'ok', baseTime: base },
            CWA: { state: 'missing' }
        },
        comparison: {
            referenceBaseTime: base,
            spread: { distanceKm: 90 }
        }
    };
}

function makeImpact() {
    return {
        schemaVersion: 'hk-impact/v1',
        agencyClosestApproaches: [
            { agency: 'HKO', time: '2026-08-20T12:00:00Z', distanceKm: 120, lat: 0, lon: 1.08 },
            { agency: 'CMA', time: '2026-08-20T13:00:00Z', distanceKm: 150, lat: 0.2, lon: 1.3 },
            { agency: 'JMA', time: '2026-08-20T11:00:00Z', distanceKm: 100, lat: -0.1, lon: 0.9 }
        ],
        closestApproach: {
            distanceRangeKm: { min: 100, max: 150, span: 50 },
            agencyTimeWindow: { start: '2026-08-20T11:00:00Z', end: '2026-08-20T13:00:00Z' },
            consensus: { time: '2026-08-20T12:00:00Z', distanceKm: 123, lat: 0.05, lon: 1.0 }
        },
        trend: { aggregate: 'approaching', counts: { approaching: 3, departing: 0, steady: 0 } },
        uncertainty: { level: 'moderate', method: 'heuristic-v1' }
    };
}

function makeSourceGroup() {
    const windRadii = [{ level: '15 m/s', ne: 80, se: 80, sw: 80, nw: 200 }];
    return {
        key: 'sample',
        displayName: 'Sample Storm',
        sources: {
            HKO: rawSource([
                rawPoint('2026-08-19T18:00:00Z', 0, 3, { kind: 'analysis', maximumWind: '25 m/s' }),
                rawPoint('2026-08-20T00:00:00Z', 0, 2, { kind: 'analysis', maximumWind: '30 m/s', pressure: '970 hPa', windRadii })
            ], [
                rawPoint('2026-08-20T06:00:00Z', 0, 1.5, { maximumWind: '32 m/s' }),
                rawPoint('2026-08-20T12:00:00Z', 0, 1.08, { maximumWind: '34 m/s', windRadii })
            ]),
            CMA: rawSource([
                rawPoint('2026-08-20T00:00:00Z', 0.2, 2.2, { kind: 'analysis', maximumWind: 40 })
            ], [
                rawPoint('2026-08-20T12:00:00Z', 0.2, 1.3, { maximumWind: 42 })
            ]),
            JMA: rawSource([
                rawPoint('2026-08-20T00:00:00Z', -0.1, 2.0, { kind: 'analysis', maximumWind: '50 kt' })
            ], [
                rawPoint('2026-08-20T12:00:00Z', -0.1, 0.9, { maximumWind: '60 kt' })
            ])
        }
    };
}

(function testUnitNormalization() {
    assert.ok(Math.abs(signalInputs.parseWindMs('36 km/h') - 10) < 0.001);
    assert.ok(Math.abs(signalInputs.parseWindMs('50 kt') - 25.7222) < 0.01);
    assert.equal(signalInputs.parseSpeedKmh('10 m/s'), 36);
})();

(function testGeometryAndWindQuadrantCoverage() {
    const result = signalInputs.buildHkoSignalRiskInputs(makeSnapshot(), makeImpact(), makeSourceGroup());
    const hko = result.agencies.HKO;
    assert.equal(hko.current.sectorFromHongKong, 'E');
    assert.ok(hko.current.distanceToHongKongKm > 200 && hko.current.distanceToHongKongKm < 230);
    assert.equal(hko.windField.latestEvidence.hongKongQuadrantFromStorm, 'NW');
    assert.equal(hko.windField.latestEvidence.anyCoverage, false);
    assert.equal(hko.windField.closestTimeEvidence.anyCoverage, true);
})();

(function testDerivedMotionAndFeatureVector() {
    const result = signalInputs.buildHkoSignalRiskInputs(makeSnapshot(), makeImpact(), makeSourceGroup());
    assert.equal(result.motion.aggregateTrend, 'approaching');
    assert.ok(result.agencies.HKO.derivedMotion.speedKmh > 15);
    assert.ok(result.agencies.HKO.derivedMotion.speedKmh < 25);
    assert.equal(result.agencies.HKO.derivedMotion.compass, 'W');
    assert.equal(result.agencies.HKO.current.officialMovingSpeedKmh, null);
    assert.equal(result.featureVector.usableAgencyCount, 3);
    assert.equal(result.featureVector.comparisonSpreadKm, 90);
    assert.equal(result.featureVector.consensusClosestLeadHours, 12);
    assert.equal(result.featureVector.windRadiusAgencyCount, 1);
    assert.equal(result.featureVector.closestTimeWindFieldCoverageAgencyCount, 1);
})();

(function testIntensityNormalizationAndSpread() {
    const result = signalInputs.buildHkoSignalRiskInputs(makeSnapshot(), makeImpact(), makeSourceGroup());
    assert.equal(result.intensity.currentMaximumWindMs.count, 3);
    assert.ok(result.intensity.currentMaximumWindMs.min > 25);
    assert.equal(result.intensity.currentMaximumWindMs.max, 40);
    assert.equal(result.intensity.closestMaximumWindMs.max, 42);
    assert.ok(result.intensity.intensitySpreadMs > 0);
})();

(function testWarningContextIsNeverInferred() {
    const result = signalInputs.buildHkoSignalRiskInputs(makeSnapshot(), makeImpact(), makeSourceGroup());
    assert.equal(result.officialHkoWarningContext.provided, false);
    assert.equal(result.officialHkoWarningContext.inferred, false);
    assert.equal(result.semantics.warningSignalPredictionIncluded, false);
    assert.equal(result.semantics.warningRiskScoreIncluded, false);
    assert.equal(result.semantics.hkoDecisionInferred, false);
    assert.equal(result.semantics.aiGenerated, false);
})();

(function testTrustedWarningContextCanBeAttachedWithoutPrediction() {
    const result = signalInputs.buildHkoSignalRiskInputs(makeSnapshot(), makeImpact(), makeSourceGroup(), {
        hkoWarningContext: {
            currentSignal: 'T1',
            issuedAt: '2026-08-20T01:00:00Z',
            source: 'HKO official bulletin',
            text: 'Sample official context'
        }
    });
    assert.equal(result.officialHkoWarningContext.provided, true);
    assert.equal(result.officialHkoWarningContext.currentSignal, 'T1');
    assert.equal(result.officialHkoWarningContext.inferred, false);
    assert.equal(result.semantics.warningSignalPredictionIncluded, false);
})();

(function testMissingAgencyIsNotSubstituted() {
    const sourceGroup = makeSourceGroup();
    delete sourceGroup.sources.CMA;
    const result = signalInputs.buildHkoSignalRiskInputs(makeSnapshot(), makeImpact(), sourceGroup);
    assert.equal(result.agencies.CMA.provenance.officialMetricSource, null);
    assert.equal(result.agencies.CMA.provenance.agencySubstitutionUsed, false);
    assert.equal(result.semantics.agencySubstitutionUsed, false);
})();

console.log('hko-signal-risk-inputs tests: OK');
