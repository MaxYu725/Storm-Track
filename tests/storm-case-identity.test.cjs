'use strict';

const assert = require('node:assert/strict');
const identity = require('../analysis/storm-case-identity.js');

function source(agency, sourceId, time, lat, lon) {
  return {
    agency,
    sourceId,
    current: { time, lat, lon }
  };
}

function observation(key, nameTc, nameEn, sources) {
  return {
    schemaVersion: 'hk-beta-prospective-observation/v1',
    group: {
      key,
      displayName: nameEn ? `${nameTc} (${nameEn})` : nameTc,
      nameTc,
      nameEn
    },
    sources
  };
}

function record(capturedAt, fingerprint, observations) {
  return { capturedAt, captureFingerprint: fingerprint, observations };
}

const records = [
  record('2026-08-22T01:29:26Z', 'capture-1', [
    // v1 briefly contained both the generic and newly named representation of the same cyclone.
    observation('TROPICALSTORM', '熱帶風暴', 'Tropical Storm', {
      HKO: source('HKO', 'hko-2629', '2026-08-22T01:00:00Z', 21.4, 108.3),
      CMA: source('CMA', '3304100', '2026-08-22T00:00:00Z', 21.3, 108.2),
      JMA: source('JMA', 'TC2622', '2026-08-22T01:00:00Z', 21.3, 108.2),
      CWA: source('CWA', '2026-21', '2026-08-22T00:00:00Z', 21.0, 108.5)
    }),
    observation('NARRA', '娜拉', 'NARRA', {
      JMA: source('JMA', 'TC2622', '2026-08-22T01:00:00Z', 21.3, 108.2),
      CWA: source('CWA', '2026-21', '2026-08-22T00:00:00Z', 21.0, 108.5)
    }),
    // A new numbered cyclone can be geographically nearby but must remain distinct when the same agency ID conflicts.
    observation('TC2623', '熱帶低氣壓', 'TC2623', {
      JMA: source('JMA', 'TC2623', '2026-08-22T01:00:00Z', 22.0, 109.0)
    })
  ]),
  record('2026-08-22T01:45:00Z', 'capture-2', [
    observation('NARRA', '娜拉', 'NARRA', {
      HKO: source('HKO', 'hko-2629', '2026-08-22T01:30:00Z', 21.5, 108.1),
      CMA: source('CMA', '3304100', '2026-08-22T01:30:00Z', 21.4, 108.0),
      JMA: source('JMA', 'TC2622', '2026-08-22T01:30:00Z', 21.4, 108.0),
      CWA: source('CWA', '2026-21', '2026-08-22T01:30:00Z', 21.3, 108.2)
    }),
    observation('TC2623', '熱帶低氣壓', 'TC2623', {
      JMA: source('JMA', 'TC2623', '2026-08-22T01:30:00Z', 22.1, 108.8)
    })
  ]),
  record('2026-08-23T01:45:00Z', 'capture-3', [
    // TC2623 later receives a formal name but keeps the JMA source identity.
    observation('BANYAN', '榕樹', 'BANYAN', {
      JMA: source('JMA', 'TC2623', '2026-08-23T01:30:00Z', 23.2, 107.9),
      CMA: source('CMA', '3304101', '2026-08-23T01:30:00Z', 23.1, 108.0)
    })
  ])
];

const result = identity.reconcileProspectiveRecords(records);
assert.equal(result.schemaVersion, 'storm-case-identity/v1');

const narraRows = result.index.filter(item => ['TROPICALSTORM', 'NARRA'].includes(item.rawGroupKey));
assert.ok(narraRows.length >= 3);
assert.equal(new Set(narraRows.map(item => item.caseId)).size, 1, 'generic Tropical Storm and NARRA must resolve to one case');
assert.equal(narraRows[0].caseId, 'STC-2026-JMA-TC2622');

const tc2623Rows = result.index.filter(item => ['TC2623', 'BANYAN'].includes(item.rawGroupKey));
assert.equal(tc2623Rows.length, 3);
assert.equal(new Set(tc2623Rows.map(item => item.caseId)).size, 1, 'TC2623 must retain its case after formal naming');
assert.equal(tc2623Rows[0].caseId, 'STC-2026-JMA-TC2623');
assert.notEqual(tc2623Rows[0].caseId, narraRows[0].caseId, 'TC2623 must not merge into TC2622/NARRA');

const tc2623Case = result.cases.find(item => item.caseId === 'STC-2026-JMA-TC2623');
assert.ok(tc2623Case.groupKeys.includes('TC2623'));
assert.ok(tc2623Case.groupKeys.includes('BANYAN'));
assert.ok(tc2623Case.names.includes('BANYAN'));

// When one agency disappears and another starts tracking the same cyclone, cautious physical continuity may bridge the gap.
const handoff = identity.reconcileProspectiveRecords([
  record('2026-09-01T00:00:00Z', 'handoff-1', [
    observation('TC2690', '熱帶低氣壓', 'TC2690', {
      JMA: source('JMA', 'TC2690', '2026-09-01T00:00:00Z', 18.0, 120.0)
    })
  ]),
  record('2026-09-01T06:00:00Z', 'handoff-2', [
    observation('TROPICALSTORM', '熱帶風暴', 'Tropical Storm', {
      HKO: source('HKO', 'hko-new', '2026-09-01T06:00:00Z', 18.5, 119.4)
    })
  ])
]);
assert.equal(handoff.caseCount, 1, 'cross-agency handoff should preserve a case when time/position continuity is strong');
assert.equal(handoff.index[1].resolution.reason, 'physical-continuity');

console.log('storm case identity tests: OK');
