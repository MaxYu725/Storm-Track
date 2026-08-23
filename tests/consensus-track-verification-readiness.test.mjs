import assert from 'node:assert/strict';
import {
  objectHasExactPrimitive,
  shortlistStorms,
  selectCycleAdvisory,
  classifyValidTimeCoverage,
  auditReadiness
} from '../scripts/audit-consensus-track-verification-readiness.mjs';

assert.equal(objectHasExactPrimitive({ aliases: ['2632'] }, '2632'), true);
assert.equal(objectHasExactPrimitive({ aliases: ['26320'] }, '2632'), false);

const storms = [
  {
    id: 'storm-named',
    name_en: 'TESTSTORM',
    name_zh: '測試風暴',
    first_seen_at: '2026-08-23T00:00:00Z',
    last_seen_at: '2026-08-24T00:00:00Z'
  },
  {
    id: 'storm-generic',
    name_en: 'Tropical Depression',
    first_seen_at: '2026-08-23T00:00:00Z',
    last_seen_at: '2026-08-24T00:00:00Z'
  }
];

const namedShortlist = shortlistStorms(storms, {
  key: 'TESTSTORM',
  nameEn: 'TESTSTORM',
  nameTc: '測試風暴'
}, {
  sourceId: 'N-1',
  bulletinTime: '2026-08-23T06:00:00Z'
});
assert.equal(namedShortlist[0].storm.id, 'storm-named');

const cycle = selectCycleAdvisory([
  { id: 'a-old', agency: 'HKO', issued_at: '2026-08-23T03:00:00Z' },
  { id: 'a-target', agency: 'HKO', issued_at: '2026-08-23T06:30:00Z', source_id: 'H-1' },
  { id: 'a-other', agency: 'CMA', issued_at: '2026-08-23T06:00:00Z' }
], 'HKO', {
  sourceId: 'H-1',
  bulletinTime: '2026-08-23T06:30:00Z'
});
assert.equal(cycle.advisory.id, 'a-target');
assert.equal(cycle.diffMs, 0);
assert.equal(cycle.sourceIdExact, true);

const points = [
  { point_type: 'analysis', valid_at: '2026-08-23T06:00:00Z' },
  { point_type: 'forecast', valid_at: '2026-08-23T12:00:00Z' },
  { point_type: 'forecast', valid_at: '2026-08-24T00:00:00Z' }
];

assert.deepEqual(
  classifyValidTimeCoverage({
    validTime: '2026-08-23T06:00:00Z',
    provenanceByAgency: { HKO: 'exact-analysis' }
  }, 'HKO', points),
  { state: 'exact-analysis', reconstructable: true }
);
assert.deepEqual(
  classifyValidTimeCoverage({
    validTime: '2026-08-23T09:00:00Z',
    provenanceByAgency: { HKO: 'analysis-to-forecast-interpolation' }
  }, 'HKO', points),
  { state: 'analysis-forecast-bracket', reconstructable: true }
);
assert.deepEqual(
  classifyValidTimeCoverage({
    validTime: '2026-08-23T18:00:00Z',
    provenanceByAgency: { HKO: 'forecast-to-forecast-interpolation' }
  }, 'HKO', points),
  { state: 'forecast-bracket', reconstructable: true }
);
assert.deepEqual(
  classifyValidTimeCoverage({
    validTime: '2026-08-24T06:00:00Z',
    provenanceByAgency: { HKO: 'exact-forecast' }
  }, 'HKO', points),
  { state: 'missing-exact-forecast', reconstructable: false }
);

const ctRecord = {
  schemaVersion: 'storm-consensus-track-prospective/v2',
  capturedAt: '2026-08-23T06:45:00Z',
  sourceCommit: 'fixture',
  captureFingerprint: 'f'.repeat(64),
  groupCount: 2,
  groups: [
    {
      key: 'TESTSTORM',
      displayName: '測試風暴 (TESTSTORM)',
      nameEn: 'TESTSTORM',
      nameTc: '測試風暴',
      sourceReferences: {
        HKO: {
          agency: 'HKO',
          sourceId: 'H-1',
          bulletinTime: '2026-08-23T06:30:00Z',
          currentTime: '2026-08-23T06:00:00Z'
        }
      },
      samples: [
        {
          validTime: '2026-08-23T06:00:00Z',
          agencies: ['HKO'],
          provenanceByAgency: { HKO: 'exact-analysis' },
          consensusLat: 20,
          consensusLon: 120
        },
        {
          validTime: '2026-08-23T09:00:00Z',
          agencies: ['HKO'],
          provenanceByAgency: { HKO: 'analysis-to-forecast-interpolation' },
          consensusLat: 20.2,
          consensusLon: 119.8
        }
      ]
    },
    {
      key: 'TROPICALDEPRESSION',
      displayName: '熱帶低氣壓 (Tropical Depression)',
      nameEn: 'Tropical Depression',
      nameTc: '熱帶低氣壓',
      sourceReferences: {
        CWA: {
          agency: 'CWA',
          sourceId: '2026-23',
          bulletinTime: '2026-08-23T06:00:00Z',
          currentTime: '2026-08-23T06:00:00Z'
        }
      },
      samples: [
        {
          validTime: '2026-08-23T12:00:00Z',
          agencies: ['CWA'],
          provenanceByAgency: { CWA: 'exact-forecast' },
          consensusLat: 13,
          consensusLon: 136
        }
      ]
    }
  ]
};

const fixtures = new Map([
  ['/storms?limit=100', { storms }],
  ['/storms/storm-named', { storm: { id: 'storm-named' }, aliases: [{ agency: 'HKO', source_id: 'H-1' }] }],
  ['/storms/storm-named/advisories?limit=200', { advisories: [
    { id: 'a-target', agency: 'HKO', issued_at: '2026-08-23T06:30:00Z', source_id: 'H-1' }
  ] }],
  ['/advisories/a-target', { advisory: { id: 'a-target', agency: 'HKO' }, points }],
  ['/storms/storm-generic', { storm: { id: 'storm-generic' }, aliases: [{ agency: 'CWA', source_id: '2026-23' }] }],
  ['/storms/storm-generic/advisories?limit=200', { advisories: [
    { id: 'cwa-target', agency: 'CWA', issued_at: '2026-08-23T06:00:00Z', source_id: '2026-23' }
  ] }],
  ['/advisories/cwa-target', {
    advisory: { id: 'cwa-target', agency: 'CWA' },
    points: [
      { point_type: 'analysis', valid_at: '2026-08-23T06:00:00Z' },
      { point_type: 'forecast', valid_at: '2026-08-23T12:00:00Z' }
    ]
  }]
]);

async function mockFetch(url) {
  const parsed = new URL(url);
  const payload = fixtures.get(`${parsed.pathname.replace('/api/history', '')}${parsed.search}`);
  return {
    ok: Boolean(payload),
    status: payload ? 200 : 404,
    async text() {
      return JSON.stringify(payload || { error: 'not found' });
    }
  };
}

const audit = await auditReadiness(ctRecord, {
  origin: 'https://example.test/api/history',
  fetchImpl: mockFetch
});

assert.equal(audit.schemaVersion, 'consensus-track-verification-readiness/v1');
assert.equal(audit.summary.sourceReferenceCount, 2);
assert.equal(audit.summary.stormJoinCount, 2);
assert.equal(audit.summary.cycleJoinCount, 2);
assert.equal(audit.summary.targetCount, 3);
assert.equal(audit.summary.reconstructableTargetCount, 3);
assert.equal(audit.summary.validTimeCoveragePct, 100);
assert.equal(audit.summary.byAgency.HKO.validTimeCoveragePct, 100);
assert.equal(audit.summary.byAgency.CWA.validTimeCoveragePct, 100);
assert.equal(audit.semantics.forecastSkillEvaluated, false);
assert.equal(audit.semantics.forecastErrorsCalculated, false);
assert.equal(audit.semantics.productionDatabaseWritten, false);

const genericJoin = audit.joins.find(item => item.agency === 'CWA');
assert.equal(genericJoin.stormMatch, 'source-id+cycle');
assert.equal(genericJoin.stormId, 'storm-generic');
assert.equal(genericJoin.advisoryId, 'cwa-target');

console.log('consensus-track verification readiness tests: OK');
