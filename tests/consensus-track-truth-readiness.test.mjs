import assert from 'node:assert/strict';
import {
  parseCsvLine,
  parseJmaFinalCsv,
  normalizeName,
  buildCaseResolutionIndex,
  classifyTruthTime,
  cycleMatchesReference,
  classifyBaselineCoverage,
  auditTruthReadiness
} from '../scripts/audit-consensus-track-truth-readiness.mjs';

assert.deepEqual(parseCsvLine('2026,8,24,6,19,"NARRA",x,20.0,120.0'), [
  '2026', '8', '24', '6', '19', 'NARRA', 'x', '20.0', '120.0'
]);
assert.equal(normalizeName('BANG-LANG'), 'BANGLANG');

const finalCsv = [
  '2026,8,24,6,19,NARRA,x,20.0,120.0',
  '2026,8,25,0,21,ATSANI,x,18.0,138.0',
  '2026,8,25,12,21,ATSANI,x,18.5,137.0',
  'not,a,truth,row'
].join('\n');
const finalPoints = parseJmaFinalCsv(finalCsv);
assert.equal(finalPoints.length, 3);
assert.equal(finalPoints[0].nameToken, 'NARRA');
assert.equal(finalPoints[0].validTime, '2026-08-24T06:00:00.000Z');
assert.deepEqual(
  classifyTruthTime(finalPoints.filter(point => point.nameToken === 'NARRA'), '2026-08-24T06:00:00Z'),
  {
    state: 'exact-final-truth',
    ready: true,
    beforeTime: '2026-08-24T06:00:00.000Z',
    afterTime: '2026-08-24T06:00:00.000Z',
    bracketHours: 0
  }
);
assert.deepEqual(
  classifyTruthTime(finalPoints.filter(point => point.nameToken === 'ATSANI'), '2026-08-25T06:00:00Z'),
  {
    state: 'interpolatable-final-truth',
    ready: true,
    beforeTime: '2026-08-25T00:00:00.000Z',
    afterTime: '2026-08-25T12:00:00.000Z',
    bracketHours: 12
  }
);
assert.equal(classifyTruthTime([], '2026-08-25T06:00:00Z').ready, false);

const caseIndexRows = [
  { captureFingerprint: 'latest', rawGroupKey: 'SAUDEL', caseId: 'case-active' },
  { captureFingerprint: 'n1', rawGroupKey: 'NARRA', caseId: 'case-narra' },
  { captureFingerprint: 'a1', rawGroupKey: 'ATSANI', caseId: 'case-atsani' },
  { captureFingerprint: 'g1', rawGroupKey: 'GAENARI', caseId: 'case-gaenari' },
  { captureFingerprint: 's1', rawGroupKey: 'SINGLE', caseId: 'case-single' }
];
const resolutionIndex = buildCaseResolutionIndex(caseIndexRows);
assert.equal(resolutionIndex.get('n1\u0000NARRA'), 'case-narra');

function sample({ leadHours, validTime, agencies, provenanceByAgency, lat = 20, lon = 120 }) {
  return {
    leadHours,
    validTime,
    agencyCount: agencies.length,
    agencies,
    provenanceByAgency,
    consensusLat: lat,
    consensusLon: lon,
    spreadKm: 50
  };
}

function group({ key, references, samples }) {
  return {
    key,
    displayName: key,
    nameEn: key,
    sourceReferences: references,
    samples
  };
}

const narraSample = sample({
  leadHours: 24,
  validTime: '2026-08-24T06:00:00Z',
  agencies: ['HKO', 'CMA'],
  provenanceByAgency: { HKO: 'exact-forecast', CMA: 'exact-forecast' }
});
const atsaniSample = sample({
  leadHours: 48,
  validTime: '2026-08-25T06:00:00Z',
  agencies: ['CWA', 'JMA'],
  provenanceByAgency: { CWA: 'forecast-to-forecast-interpolation', JMA: 'exact-forecast' },
  lat: 18.2,
  lon: 137.5
});
const gaenariSample = sample({
  leadHours: 24,
  validTime: '2026-08-24T12:00:00Z',
  agencies: ['HKO', 'JMA'],
  provenanceByAgency: { HKO: 'exact-forecast', JMA: 'exact-forecast' },
  lat: 25,
  lon: 118
});

const ctRecords = [
  {
    schemaVersion: 'storm-consensus-track-prospective/v2',
    capturedAt: '2026-08-23T06:00:00Z',
    captureFingerprint: 'n1',
    groups: [group({
      key: 'NARRA',
      references: {
        HKO: { sourceId: '2629', bulletinTime: '2026-08-23T06:00:00Z' },
        CMA: { sourceId: '3304364', bulletinTime: '2026-08-23T06:00:00Z' }
      },
      samples: [narraSample]
    })]
  },
  {
    schemaVersion: 'storm-consensus-track-prospective/v2',
    capturedAt: '2026-08-23T06:00:00Z',
    captureFingerprint: 'a1',
    groups: [group({
      key: 'ATSANI',
      references: {
        CWA: { sourceId: '2026-20', bulletinTime: '2026-08-23T06:00:00Z' },
        JMA: { sourceId: 'TC2624', bulletinTime: '2026-08-23T06:00:00Z' }
      },
      samples: [atsaniSample]
    })]
  },
  {
    schemaVersion: 'storm-consensus-track-prospective/v2',
    capturedAt: '2026-08-23T12:00:00Z',
    captureFingerprint: 'g1',
    groups: [group({
      key: 'GAENARI',
      references: {
        HKO: { sourceId: '2631', bulletinTime: '2026-08-23T12:00:00Z' },
        JMA: { sourceId: 'TC2623', bulletinTime: '2026-08-23T12:00:00Z' }
      },
      samples: [gaenariSample]
    })]
  },
  {
    schemaVersion: 'storm-consensus-track-prospective/v2',
    capturedAt: '2026-08-23T06:00:00Z',
    captureFingerprint: 's1',
    groups: [group({
      key: 'SINGLE',
      references: { CWA: { sourceId: '2026-25', bulletinTime: '2026-08-23T06:00:00Z' } },
      samples: [sample({
        leadHours: 24,
        validTime: '2026-08-24T06:00:00Z',
        agencies: ['CWA'],
        provenanceByAgency: { CWA: 'exact-forecast' }
      })]
    })]
  }
];

function baselineRecord({ caseId, agency, sourceId, bulletinTime, analysisTime, forecast }) {
  return {
    caseIdAtCapture: caseId,
    agency,
    sourceId,
    sourceToken: `${agency}:${sourceId}`,
    bulletinTime,
    analysis: analysisTime ? { validTime: analysisTime, lat: 10, lon: 100 } : null,
    cycleFingerprint: `${caseId}-${agency}-${sourceId}-${bulletinTime}`,
    forecast
  };
}

const baselineRecords = [{
  schemaVersion: 'storm-agency-baseline-prospective/v1',
  capturedAt: '2026-08-23T06:05:00Z',
  records: [
    baselineRecord({
      caseId: 'case-narra', agency: 'HKO', sourceId: '2629', bulletinTime: '2026-08-23T06:00:00Z',
      analysisTime: '2026-08-23T06:00:00Z',
      forecast: [{ validTime: '2026-08-24T06:00:00Z', lat: 20.1, lon: 120.1 }]
    }),
    baselineRecord({
      caseId: 'case-narra', agency: 'CMA', sourceId: '3304364', bulletinTime: '2026-08-23T06:00:00Z',
      analysisTime: '2026-08-23T06:00:00Z',
      forecast: [{ validTime: '2026-08-24T06:00:00Z', lat: 20.2, lon: 120.2 }]
    }),
    baselineRecord({
      caseId: 'case-atsani', agency: 'CWA', sourceId: '2026-20', bulletinTime: '2026-08-23T06:00:00Z',
      analysisTime: '2026-08-23T06:00:00Z',
      forecast: [
        { validTime: '2026-08-25T00:00:00Z', lat: 18.1, lon: 138.0 },
        { validTime: '2026-08-25T12:00:00Z', lat: 18.4, lon: 137.0 }
      ]
    }),
    baselineRecord({
      caseId: 'case-atsani', agency: 'JMA', sourceId: 'TC2624', bulletinTime: '2026-08-23T06:00:00Z',
      analysisTime: '2026-08-23T06:00:00Z',
      forecast: [{ validTime: '2026-08-25T06:00:00Z', lat: 18.3, lon: 137.4 }]
    }),
    baselineRecord({
      caseId: 'case-gaenari', agency: 'HKO', sourceId: '2631', bulletinTime: '2026-08-23T12:00:00Z',
      analysisTime: '2026-08-23T12:00:00Z',
      forecast: [{ validTime: '2026-08-24T12:00:00Z', lat: 25.1, lon: 118.1 }]
    }),
    baselineRecord({
      caseId: 'case-gaenari', agency: 'JMA', sourceId: 'TC2623', bulletinTime: '2026-08-23T12:00:00Z',
      analysisTime: '2026-08-23T12:00:00Z',
      forecast: [{ validTime: '2026-08-24T12:00:00Z', lat: 25.2, lon: 118.2 }]
    })
  ]
}];

assert.equal(cycleMatchesReference(
  baselineRecords[0].records[0],
  { sourceId: '2629', bulletinTime: '2026-08-23T06:00:00Z' }
), true);
assert.deepEqual(
  classifyBaselineCoverage(narraSample, 'HKO', baselineRecords[0].records[0]),
  { state: 'exact-forecast', reconstructable: true }
);
assert.deepEqual(
  classifyBaselineCoverage(atsaniSample, 'CWA', baselineRecords[0].records[2]),
  { state: 'forecast-bracket', reconstructable: true }
);

const latest = {
  schemaVersion: 'storm-consensus-track-prospective/v2',
  capturedAt: '2026-08-30T00:00:00Z',
  captureFingerprint: 'latest',
  groups: [{ key: 'SAUDEL' }]
};

const caseRegistry = {
  schemaVersion: 'storm-case-identity/v1',
  caseCount: 5,
  cases: [
    { caseId: 'case-narra', firstSeen: '2026-08-23T00:00:00Z', lastSeen: '2026-08-27T00:00:00Z', groupKeys: ['NARRA'], names: ['NARRA', '紫檀'] },
    { caseId: 'case-atsani', firstSeen: '2026-08-23T00:00:00Z', lastSeen: '2026-08-26T00:00:00Z', groupKeys: ['TROPICALDEPRESSION', 'ATSANI'], names: ['ATSANI', '艾莎尼'] },
    { caseId: 'case-gaenari', firstSeen: '2026-08-23T00:00:00Z', lastSeen: '2026-08-25T00:00:00Z', groupKeys: ['GAENARI'], names: ['GAENARI', '簡拉維'] },
    { caseId: 'case-active', firstSeen: '2026-08-23T00:00:00Z', lastSeen: '2026-08-30T00:00:00Z', groupKeys: ['SAUDEL'], names: ['SAUDEL', '沙德爾'] },
    { caseId: 'case-single', firstSeen: '2026-08-26T00:00:00Z', lastSeen: '2026-08-26T12:00:00Z', groupKeys: ['SINGLE'], names: [] }
  ]
};

const audit = auditTruthReadiness({
  latest,
  caseRegistry,
  caseIndexRows,
  ctRecords,
  baselineRecords,
  jmaFinalPoints: finalPoints
});

assert.equal(audit.schemaVersion, 'consensus-track-truth-readiness/v1');
assert.equal(audit.summary.activeCaseCount, 1);
assert.equal(audit.summary.completedMultiAgencyCaseCandidateCount, 3);
assert.deepEqual(audit.summary.completedCaseIds.sort(), ['case-atsani', 'case-gaenari', 'case-narra']);
assert.equal(audit.summary.completedWithFinalTruthCount, 2);
assert.deepEqual(audit.summary.completedWithFinalTruthCaseIds.sort(), ['case-atsani', 'case-narra']);
assert.equal(audit.summary.completedWithHomogeneousReadyCount, 2);
assert.equal(audit.summary.homogeneousReadyAgencyPairCount, 4);
assert.equal(audit.summary.verificationEvidenceAvailable, true);

const narra = audit.cases.find(item => item.caseId === 'case-narra');
assert.equal(narra.state, 'inactive-from-latest');
assert.equal(narra.jmaFinalTruth.available, true);
assert.equal(narra.truthReadyCyclesByLead['24'], 1);
assert.equal(narra.homogeneousReadyByAgencyLead.HKO['24'], 1);
assert.equal(narra.homogeneousReadyByAgencyLead.CMA['24'], 1);

const atsani = audit.cases.find(item => item.caseId === 'case-atsani');
assert.equal(atsani.truthReadyCyclesByLead['48'], 1);
assert.equal(atsani.targetDetails[0].truth.state, 'interpolatable-final-truth');
assert.equal(atsani.homogeneousReadyByAgencyLead.CWA['48'], 1);
assert.equal(atsani.homogeneousReadyByAgencyLead.JMA['48'], 1);

const gaenari = audit.cases.find(item => item.caseId === 'case-gaenari');
assert.equal(gaenari.jmaFinalTruth.available, false);
assert.equal(gaenari.truthReadyCyclesByLead['24'], 0);
assert.equal(gaenari.baselinePairableByAgencyLead.HKO['24'], 1);
assert.equal(gaenari.homogeneousReadyByAgencyLead.HKO['24'], 0);

const single = audit.cases.find(item => item.caseId === 'case-single');
assert.equal(single.multiAgencyTargetCount, 0);
assert.equal(audit.summary.completedCaseIds.includes('case-single'), false);

assert.equal(audit.semantics.readOnlyTruthAudit, true);
assert.equal(audit.semantics.officialPostAnalysisFinalTruthRequired, true);
assert.equal(audit.semantics.preliminaryOperationalAnalysisAcceptedAsFinalTruth, false);
assert.equal(audit.semantics.forecastMustPrecedeTargetValidTime, true);
assert.equal(audit.semantics.sameCycleProspectiveAgencyBaselineRequiredForAgencyComparison, true);
assert.equal(audit.semantics.forecastSkillEvaluated, false);
assert.equal(audit.semantics.forecastErrorsCalculated, false);
assert.equal(audit.semantics.agencyRankingProduced, false);
assert.equal(audit.semantics.consensusAlgorithmModified, false);
assert.equal(audit.semantics.productionDatabaseWritten, false);
assert.equal(audit.semantics.skillGateDecisionProduced, false);
assert.equal(Object.hasOwn(audit.summary, 'skillGateReady'), false);

console.log('consensus-track truth readiness tests: OK');
