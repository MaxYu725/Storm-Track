const assert = require('node:assert/strict');
const shadow = require('../analysis/hk-situation-analysis-shadow.js');

assert.equal(shadow.VERSION, 'hk-situation-analysis-shadow-input/v0.1');
assert.equal(shadow.OUTPUT_CONTRACT_VERSION, 'hk-situation-analysis-shadow-output/v0.2');
assert.equal(shadow.EVIDENCE_CATALOG_VERSION, 'hk-situation-analysis-evidence-catalog/v1');

const basicForecast = {
  schemaVersion: 'basic-hk-signal-forecast/v1', available: true, generatedAt: '2026-09-01T22:00:00.000Z',
  impact: { likelihood: 'possible' },
  signals: {
    T1: { likelihood: 'possible', riskIndex: 0.62, confidenceIndex: 0.4, persistenceHours: 100, estimatedWindow: { start: '2026-09-02T00:00:00.000Z', end: '2026-09-02T12:00:00.000Z' } },
    T3: { likelihood: 'possible', riskIndex: 0.60, confidenceIndex: 0.35, persistenceHours: 70, estimatedWindow: null },
    T8: { likelihood: 'unlikely', riskIndex: 0.29, confidenceIndex: 0.31, persistenceHours: 0, estimatedWindow: null }
  },
  semantics: { deterministic: true }
};
const v2 = JSON.parse(JSON.stringify(basicForecast));
v2.schemaVersion = 'hk-signal-shadow-v2/0.1';
v2.signals.T3.timingState = 'left-censored-or-horizon-limited';

const threatAssessment = {
  summary: { currentDistanceKm: 285, forecastMinimumKm: 45, forecastMinimumLeadHours: 72, representativeMinimum: { distanceKm: 45, time: '2026-09-04T22:00:00.000Z' } },
  analyzers: {
    directApproach: { confidence: 0.1 }, directDepart: { confidence: 0.8 }, reApproach: { confidence: 0.72 },
    quasiStationary: { confidence: 0.2 }, forecastEdge: { confidence: 0.9 }, agencyDisagreement: { confidence: 0.7 },
    interpolationReliability: { confidence: 0.8 }, windField: { confidence: 0, latestCoverageAgencyCount: 0 }, rapidEvolution: { confidence: 0.2 }
  },
  agencies: { HKO: { currentDistanceKm: 280, directDepartConfidence: 0.8, reApproachConfidence: 0.7 } },
  timeline: [{ validTime: '2026-09-02T04:00:00.000Z', leadHours: 6, distanceMedianKm: 310 }]
};
const signalInputs = {
  featureVector: { usableAgencyCount: 4, currentDistanceMedianKm: 285 },
  coverage: { usableAgencyCount: 4 }, disagreement: { level: 'high' },
  officialHkoWarningContext: { provided: true, currentSignal: 'T1' }
};
const localWindShadow = {
  schemaVersion: 'hko-local-wind-shadow-observation/v1', shadowVersion: 'hko-local-wind-shadow/v1',
  authority: 'Hong Kong Observatory Open Data', affectsForecast: false,
  summary: { dataTimestamp: '2026-09-01T21:50:00.000Z', stationCount: 2, meanStrongStationCount: 1 },
  stations: [{ station: 'Station A', meanSpeedKmh: 43, maxGustKmh: 55 }]
};

const beforeV1 = JSON.stringify(basicForecast);
const packet = shadow.buildSituationAnalysisInput({
  caseInfo: { caseId: 'STC-TEST-001', displayName: 'TEST STORM' },
  impact: { closestApproach: { consensus: { distanceKm: 45 } }, trend: { aggregate: 'departing' }, uncertainty: { level: 'high' } },
  signalInputs, threatAssessment, basicForecast, shadowForecastV2: v2,
  hkoSignalStatement: { schemaVersion: 'hko-contemporaneous-operational-context/v1', currentSignal: '一號戒備信號' },
  localWindShadow
});

assert.equal(packet.evidence.deterministicForecasts.v1.signals.T3.riskIndex, 0.60);
assert.equal(packet.evidence.lifecycleAnalyzers.reApproach.confidence, 0.72);
assert.equal(packet.evidence.localWind.affectsForecast, false);
assert.equal(packet.evidenceCatalog.schemaVersion, 'hk-situation-analysis-evidence-catalog/v1');
assert.equal(packet.evidenceCatalog.referenceMode, 'catalog-id-only');
assert.equal(packet.evidenceCatalog.semantics.stormAgnostic, true);
const catalog = Object.fromEntries(packet.evidenceCatalog.entries.map(entry => [entry.id, entry]));
assert.equal(catalog.E_V1_T3.path, '$.evidence.deterministicForecasts.v1.signals.T3');
assert.equal(catalog.E_REAPPROACH.path, '$.evidence.lifecycleAnalyzers.reApproach');
assert.equal(catalog.E_TC_WIND_FIELD.path, '$.evidence.lifecycleAnalyzers.windField');
assert.equal(catalog.E_HKO_SIGNAL_STATEMENT.path, '$.evidence.officialHko.signalStatement');
assert.equal(catalog.E_LOCAL_WIND_SUMMARY.path, '$.evidence.localWind.summary');
assert.equal(packet.semantics.evidenceReferencesUseCatalogIds, true);
assert.equal(packet.aiTask.targetOutput.evidenceReferenceMode, 'catalog-id-only');
assert.equal(packet.aiTask.constraints.evidenceCatalogIdsOnly, true);
assert.equal(JSON.stringify(basicForecast), beforeV1, 'catalog generation must not mutate V1');

const packetWithoutOptional = shadow.buildSituationAnalysisInput({ basicForecast, threatAssessment, signalInputs });
const idsWithoutOptional = packetWithoutOptional.evidenceCatalog.entries.map(entry => entry.id);
assert.equal(idsWithoutOptional.includes('E_HKO_SIGNAL_STATEMENT'), false);
assert.equal(idsWithoutOptional.includes('E_LOCAL_WIND_SUMMARY'), false);
assert.equal(idsWithoutOptional.includes('E_V1_T1'), true);

console.log('hk-situation-analysis-shadow tests passed');
