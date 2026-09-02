const assert = require('node:assert/strict');
const shadow = require('../analysis/hk-situation-analysis-shadow.js');

assert.equal(shadow.VERSION, 'hk-situation-analysis-shadow-input/v0.1');
assert.equal(shadow.OUTPUT_CONTRACT_VERSION, 'hk-situation-analysis-shadow-output/v0.1');

const basicForecast = {
  schemaVersion: 'basic-hk-signal-forecast/v1',
  available: true,
  generatedAt: '2026-09-01T22:00:00.000Z',
  impact: { likelihood: 'possible' },
  signals: {
    T1: {
      likelihood: 'possible', riskIndex: 0.62, confidenceIndex: 0.40, persistenceHours: 100,
      estimatedWindow: { start: '2026-09-02T00:00:00.000Z', end: '2026-09-02T12:00:00.000Z' },
      strongestCheckpoint: { validTime: '2026-09-03T22:00:00.000Z', evidence: 0.7, supportAgencyCount: 3, totalAgencyCount: 4 }
    },
    T3: {
      likelihood: 'possible', riskIndex: 0.60, confidenceIndex: 0.35, persistenceHours: 70,
      estimatedWindow: null,
      strongestCheckpoint: { validTime: '2026-09-03T22:00:00.000Z', evidence: 0.61, supportAgencyCount: 2, totalAgencyCount: 4 }
    },
    T8: { likelihood: 'unlikely', riskIndex: 0.29, confidenceIndex: 0.31, persistenceHours: 0, estimatedWindow: null }
  },
  semantics: { deterministic: true }
};

const v2 = JSON.parse(JSON.stringify(basicForecast));
v2.schemaVersion = 'hk-signal-shadow-v2/0.1';
v2.signals.T3.timingState = 'left-censored-or-horizon-limited';
v2.shadow = { mode: 'parallel-shadow', adjustments: [] };

const threatAssessment = {
  schemaVersion: 'hk-threat-assessment/v1',
  generatedAt: '2026-09-01T22:00:00.000Z',
  summary: {
    currentDistanceKm: 285,
    forecastMinimumKm: 45,
    forecastMinimumLeadHours: 72,
    representativeMinimum: { distanceKm: 45, time: '2026-09-04T22:00:00.000Z', source: 'unweighted-consensus' },
    strongestTimelineThreat: { validTime: '2026-09-04T00:00:00.000Z', threatIndex: 0.66 }
  },
  analyzers: {
    directApproach: { confidence: 0.1 },
    directDepart: { confidence: 0.8 },
    reApproach: { confidence: 0.72 },
    quasiStationary: { confidence: 0.2 },
    forecastEdge: { confidence: 0.9 },
    agencyDisagreement: { confidence: 0.7 },
    interpolationReliability: { confidence: 0.8 },
    windField: { confidence: 0, latestCoverageAgencyCount: 0 },
    rapidEvolution: { confidence: 0.2 }
  },
  agencies: {
    HKO: { currentDistanceKm: 280, directDepartConfidence: 0.8, reApproachConfidence: 0.7 },
    JMA: { currentDistanceKm: 290, directDepartConfidence: 0.75, reApproachConfidence: 0.65 }
  },
  timeline: [{ validTime: '2026-09-02T04:00:00.000Z', leadHours: 6, distanceMedianKm: 310 }]
};

const signalInputs = {
  generatedAt: '2026-09-01T22:00:00.000Z',
  featureVector: {
    usableAgencyCount: 4,
    currentDistanceMedianKm: 285,
    windRadiusAgencyCount: 3,
    latestStrongWindFieldCoverageAgencyCount: 0
  },
  coverage: { usableAgencyCount: 4 },
  disagreement: { level: 'high' },
  officialHkoWarningContext: { provided: true, currentSignal: 'T1' }
};

const localWindShadow = {
  schemaVersion: 'hko-local-wind-shadow-observation/v1',
  shadowVersion: 'hko-local-wind-shadow/v1',
  authority: 'Hong Kong Observatory Open Data',
  affectsForecast: false,
  retrievedAt: '2026-09-01T22:02:00.000Z',
  summary: {
    dataTimestamp: '2026-09-01T21:50:00.000Z',
    stationCount: 2,
    meanStrongStationCount: 1,
    meanGaleStationCount: 0,
    gustStrongStationCount: 1,
    gustGaleStationCount: 0,
    topMeanStations: [{ station: 'Station A', valueKmh: 43 }]
  },
  stations: [
    { observedAt: '2026-09-01T21:50:00.000Z', station: 'Station A', meanSpeedKmh: 43, maxGustKmh: 55 },
    { observedAt: '2026-09-01T21:50:00.000Z', station: 'Station B', meanSpeedKmh: 26, maxGustKmh: 35 }
  ]
};

const beforeV1 = JSON.stringify(basicForecast);
const beforeV2 = JSON.stringify(v2);
const beforeWind = JSON.stringify(localWindShadow);

const packet = shadow.buildSituationAnalysisInput({
  caseInfo: { caseId: 'STC-TEST-001', displayName: 'TEST STORM' },
  impact: {
    closestApproach: { consensus: { distanceKm: 45, time: '2026-09-04T22:00:00.000Z' } },
    trend: { aggregate: 'departing' },
    uncertainty: { level: 'high' }
  },
  signalInputs,
  threatAssessment,
  basicForecast,
  shadowForecastV2: v2,
  hkoSignalStatement: {
    schemaVersion: 'hko-signal-statement/v1',
    currentSignal: '一號戒備信號',
    primary: { kind: 'maintain_until', timeText: '今日餘下時間' }
  },
  localWindShadow
});

assert.equal(packet.schemaVersion, shadow.VERSION);
assert.equal(packet.mode, 'ai-situation-analysis-shadow-input');
assert.equal(packet.case.caseId, 'STC-TEST-001');
assert.equal(packet.case.provenanceOnly, true);
assert.equal(packet.evidence.deterministicForecasts.v1.signals.T3.riskIndex, 0.60);
assert.equal(packet.evidence.deterministicForecasts.v2Shadow.signals.T3.timingState, 'left-censored-or-horizon-limited');
assert.equal(packet.evidence.geometry.currentDistanceKm, 285);
assert.equal(packet.evidence.lifecycleAnalyzers.directDepart.confidence, 0.8);
assert.equal(packet.evidence.lifecycleAnalyzers.reApproach.confidence, 0.72);
assert.equal(packet.evidence.agencyPatterns.HKO.reApproachConfidence, 0.7);
assert.equal(packet.evidence.officialHko.warningContext.currentSignal, 'T1');
assert.equal(packet.evidence.officialHko.signalStatement.primary.kind, 'maintain_until');
assert.equal(packet.evidence.localWind.provided, true);
assert.equal(packet.evidence.localWind.affectsForecast, false);
assert.equal(packet.evidence.localWind.stations.length, 2);
assert.equal(packet.semantics.shadowOnly, true);
assert.equal(packet.semantics.affectsForecast, false);
assert.equal(packet.semantics.affectsEvaluator, false);
assert.equal(packet.semantics.noForecastMutation, true);
assert.equal(packet.semantics.noTruthFeedback, true);
assert.equal(packet.semantics.aiInvocationIncluded, false);
assert.equal(packet.semantics.caseSpecificRulesForbidden, true);
assert.equal(packet.aiTask.constraints.stormIdentityIsProvenanceOnly, true);
assert.equal(packet.aiTask.constraints.noSingleGustSignalInference, true);
assert.equal(packet.aiTask.constraints.localWindRemainsSeparateFromTcWindField, true);
assert.equal(packet.aiTask.targetOutput.uncertainAnswerAllowed, true);
assert.ok(packet.aiTask.targetOutput.requiredFields.includes('currentPhase'));
assert.ok(packet.aiTask.targetOutput.requiredFields.includes('modelSemanticConcerns'));

assert.equal(JSON.stringify(basicForecast), beforeV1, 'building the packet must not mutate frozen V1');
assert.equal(JSON.stringify(v2), beforeV2, 'building the packet must not mutate V2 shadow');
assert.equal(JSON.stringify(localWindShadow), beforeWind, 'building the packet must not mutate local-wind observations');

const packetWithoutOptionalEvidence = shadow.buildSituationAnalysisInput({
  basicForecast,
  threatAssessment,
  signalInputs
});
assert.equal(packetWithoutOptionalEvidence.evidence.localWind.provided, false);
assert.equal(packetWithoutOptionalEvidence.evidence.localWind.affectsForecast, false);
assert.equal(packetWithoutOptionalEvidence.evidence.officialHko.signalStatement, null);

console.log('hk-situation-analysis-shadow tests passed');
