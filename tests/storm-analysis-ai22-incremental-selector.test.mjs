import assert from 'node:assert/strict';
import { buildIncrementalLifecycleEvidence } from '../workers/storm-analysis/scripts/ai22-select-incremental-cutoff.mjs';

const H64 = 'a'.repeat(64);
const stormKey = 'WP-2026-16';

function advisory(agency, issuedAt, suffix) {
  return {
    id: `${stormKey}:${agency}:${suffix}`,
    storm_id: stormKey,
    agency,
    issued_at: issuedAt,
    fetched_at: issuedAt,
    source_code: agency,
    source_url: `https://example.test/${agency}/${suffix}`,
    source_hash: H64,
    raw_object_key: `raw/${stormKey}/${agency}/${suffix}`,
    parser_version: 'test/v1'
  };
}

function point(advisoryId, validAt, order = 0) {
  return {
    storm_id: stormKey,
    advisory_id: advisoryId,
    valid_at: validAt,
    forecast_hour: 12 + order * 12,
    latitude: 20 + order * 0.1,
    longitude: 130 - order * 0.1,
    pressure_hpa: 990,
    wind_ms: 25,
    gust_ms: 35,
    wind_averaging_minutes: 10,
    intensity_code: 'TS',
    intensity_label: 'Tropical Storm',
    probability_radius_km: null,
    source_order: order
  };
}

const advisories = [
  advisory('JMA', '2026-08-20T00:00:00.000Z', 'j0'),
  advisory('CMA', '2026-08-20T00:00:00.000Z', 'c0'),
  advisory('JMA', '2026-08-20T06:00:00.000Z', 'j1'),
  advisory('CMA', '2026-08-20T06:00:00.000Z', 'c1'),
  advisory('JMA', '2026-08-20T12:00:00.000Z', 'j2'),
  advisory('JMA', '2026-08-20T18:00:00.000Z', 'j3')
];
const points = advisories.flatMap((row, index) => [
  point(row.id, new Date(Date.parse(row.issued_at) + 12 * 3600_000).toISOString(), index),
  point(row.id, new Date(Date.parse(row.issued_at) + 24 * 3600_000).toISOString(), index + 1)
]);

const input = {
  storm: {
    id: stormKey,
    name_en: 'Sample',
    name_zh: '樣本',
    status: 'active',
    international_number: '18',
    merged_into_id: null
  },
  advisories,
  forecastPoints: points,
  existingCutoffs: [
    { as_of: '2026-08-20T00:00:00.000Z' },
    { as_of: '2026-08-20T06:00:00.000Z' }
  ]
};

const result = buildIncrementalLifecycleEvidence(input, { windowId: 'wp-2026-16-operational-202608' });
assert.equal(result.summary.existingCutoffCount, 2);
assert.deepEqual(result.summary.existingCutoffs, ['2026-08-20T00:00:00.000Z', '2026-08-20T06:00:00.000Z']);
assert.equal(result.summary.newCutoff.asOf, '2026-08-20T18:00:00.000Z', 'incremental selector should take the latest genuinely new usable cutoff');
assert.deepEqual(result.summary.newCutoff.agencies, ['CMA', 'JMA'], 'all agencies with still-valid forecast state at the new cutoff must be retained');
assert.equal(result.summary.newAgencyCount, 2, 'incremental append accepts the actual usable agency set without imposing a minimum beyond one');
assert.equal(result.summary.selectedSnapshotCount, 3);
assert.deepEqual(result.evidence.storms[0].cutoffs, [
  '2026-08-20T00:00:00.000Z',
  '2026-08-20T06:00:00.000Z',
  '2026-08-20T18:00:00.000Z'
]);
assert.equal(result.evidence.minimumAgencies, 1);
assert.equal(result.evidence.storms[0].lifecycle.windowId, 'wp-2026-16-operational-202608');
assert.equal(result.evidence.storms[0].identity.status, 'unreviewed');
assert.equal(result.evidence.storms[0].identity.internationalNumber, '18');

const replay = buildIncrementalLifecycleEvidence(structuredClone(input), { windowId: 'wp-2026-16-operational-202608' });
assert.deepEqual(replay, result, 'incremental selection must be deterministic');

const noNew = structuredClone(input);
noNew.existingCutoffs = advisories.map(row => row.issued_at);
assert.throws(() => buildIncrementalLifecycleEvidence(noNew, { windowId: 'wp-2026-16-operational-202608' }), /no new usable cutoff/);

const duplicateExisting = structuredClone(input);
duplicateExisting.existingCutoffs = ['2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'];
assert.throws(() => buildIncrementalLifecycleEvidence(duplicateExisting), /existing cutoffs must be unique/);

console.log('storm-analysis AI-22 incremental cutoff selector tests passed');
