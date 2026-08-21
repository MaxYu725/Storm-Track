import assert from 'node:assert/strict';
import { buildOperationalLifecycleEvidence } from '../workers/storm-analysis/scripts/ai22-select-lifecycle-cutoffs.mjs';
import { buildLifecycleCapture } from '../workers/storm-analysis/scripts/ai22-build-lifecycle-capture.mjs';

const AGENCIES = ['HKO', 'CMA', 'JMA', 'CWA'];
const H64 = 'b'.repeat(64);

function fixture(agencies = AGENCIES) {
  const stormKey = 'WP-2026-16';
  const advisories = [];
  const forecastPoints = [];
  const rounds = ['2026-08-20T00:00:00.000Z', '2026-08-20T06:00:00.000Z', '2026-08-20T12:00:00.000Z', '2026-08-20T18:00:00.000Z', '2026-08-21T00:00:00.000Z'];
  for (const [roundIndex, base] of rounds.entries()) {
    for (const [agencyIndex, agency] of agencies.entries()) {
      const issuedAt = new Date(Date.parse(base) + agencyIndex * 5 * 60_000).toISOString();
      const id = `${stormKey}:${agency}:${roundIndex}`;
      advisories.push({
        id, storm_id: stormKey, agency, issued_at: issuedAt, fetched_at: issuedAt,
        source_code: agency, source_url: `https://example.test/${agency}/${roundIndex}`,
        source_hash: H64, raw_object_key: `raw/${id}`, parser_version: 'fixture/v1'
      });
      for (const [pointIndex, hours] of [12, 24, 36].entries()) forecastPoints.push({
        storm_id: stormKey, agency, advisory_id: id,
        valid_at: new Date(Date.parse(issuedAt) + hours * 3600_000).toISOString(),
        forecast_hour: hours, latitude: 18 + roundIndex + pointIndex * 0.2,
        longitude: 132 - roundIndex - pointIndex * 0.3, pressure_hpa: 990 - pointIndex * 5,
        wind_ms: 25 + pointIndex, gust_ms: 35 + pointIndex, wind_averaging_minutes: 10,
        intensity_code: 'TS', intensity_label: 'Tropical Storm', probability_radius_km: null,
        source_order: pointIndex
      });
    }
  }
  return {
    storm: {
      id: stormKey, name_en: 'WP16 selector sample', name_zh: 'WP16 選擇器樣本', status: 'active',
      international_number: '18', merged_into_id: null
    },
    advisories,
    forecastPoints
  };
}

const source = fixture();
const selected = buildOperationalLifecycleEvidence(source, {
  windowId: 'wp-2026-16-operational-202608', snapshotCount: 4
});
assert.equal(selected.summary.stormKey, 'WP-2026-16');
assert.equal(selected.summary.maxAgencyCount, 4);
assert.equal(selected.summary.selectedSnapshotCount, 4);
assert.ok(selected.summary.cutoffs.every(item => item.agencies.length === 4));
assert.equal(selected.evidence.minimumAgencies, 1, 'operational selection must not introduce a new agency-count gate');
assert.equal(selected.evidence.storms[0].identity.status, 'unreviewed');
assert.equal(selected.evidence.storms[0].identity.internationalNumber, '18');
assert.equal(selected.evidence.storms[0].lifecycle.windowId, 'wp-2026-16-operational-202608');

const capture = buildLifecycleCapture(selected.evidence);
assert.equal(capture.summary.snapshotCount, 4);
assert.equal(capture.captureRequest.captures[0].initialState, 'active');
assert.equal(capture.plan.tableCounts.truth_datasets ?? 0, 0);
assert.equal(capture.plan.tableCounts.truth_points ?? 0, 0);
assert.equal(capture.plan.tableCounts.signal_outcomes ?? 0, 0);

const replay = buildOperationalLifecycleEvidence(structuredClone(source), {
  windowId: 'wp-2026-16-operational-202608', snapshotCount: 4
});
assert.deepEqual(replay, selected, 'cutoff selection must be deterministic for the same source evidence');

const oneAgency = buildOperationalLifecycleEvidence(fixture(['JMA']), {
  windowId: 'wp-2026-16-operational-202608', snapshotCount: 4
});
assert.equal(oneAgency.summary.maxAgencyCount, 1);
assert.ok(oneAgency.summary.selectedSnapshotCount > 0);
assert.ok(oneAgency.summary.cutoffs.every(item => item.agencies.join(',') === 'JMA'));
assert.doesNotThrow(() => buildLifecycleCapture(oneAgency.evidence));

console.log('storm-analysis AI-22 active-storm cutoff selector tests passed');
