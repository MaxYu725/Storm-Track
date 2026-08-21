import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildGenericJmaTruthAugmentation } from '../workers/storm-analysis/scripts/ai23-build-generic-truth-augmentation.mjs';
import { buildGenericVerificationRows } from '../workers/storm-analysis/scripts/ai23-build-generic-verification.mjs';
import { previewVerificationRows } from '../workers/storm-analysis/src/verification-result-repository.js';

const require = createRequire(import.meta.url);
const importer = require('../analysis/historical-backfill-importer.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ai19Plan = JSON.parse(fs.readFileSync(path.join(root, 'data/ai19/chan-hom-import-plan.json'), 'utf8'));

const STORM_KEY = 'WP-2026-99';
const INTERNATIONAL_NUMBER = '2699';
const RETRIEVED_AT = '2026-10-10T00:00:00.000Z';
const VERIFIED_AT = '2026-10-10T01:00:00.000Z';

function parseJson(value) {
  return value == null ? null : JSON.parse(value);
}

const sourceSnapshots = ai19Plan.rows.filter(row => row.table === 'forecast_snapshots')
  .slice()
  .sort((a, b) => String(a.values.as_of).localeCompare(String(b.values.as_of)))
  .slice(0, 2);
assert.equal(sourceSnapshots.length, 2);

const predictionCases = sourceSnapshots.map((row, index) => {
  const snapshot = parseJson(row.values.snapshot_json);
  snapshot.storm = { ...(snapshot.storm || {}), key: STORM_KEY, nameEn: 'GENERIC-TEST', nameTc: '通用測試' };
  return {
    caseId: `ai23_fixture_snapshot_${index + 1}`,
    asOf: row.values.as_of,
    snapshot,
    impact: parseJson(row.values.impact_json),
    signalInputs: parseJson(row.values.signal_inputs_json),
    sourceAvailability: parseJson(row.values.source_availability_json),
    provenance: {
      type: row.values.provenance_type,
      dataRole: 'forecast',
      source: row.values.provenance_source,
      sourceUrl: row.values.provenance_source_url,
      archiveId: `ai23-fixture-${index + 1}`,
      originalIssuedAt: row.values.original_issued_at,
      archiveCapturedAt: row.values.archive_captured_at,
      payloadHash: row.values.payload_hash
    }
  };
});

const forecastOnlyPlan = importer.buildImportPlan({
  source: 'ai23-synthetic-forecast-only',
  generatedAt: '2026-09-30T00:00:00.000Z',
  runId: 'ai23_synthetic_forecast_only',
  storms: [{
    stormKey: STORM_KEY,
    nameTc: '通用測試',
    nameEn: 'GENERIC-TEST',
    season: 2026,
    basin: 'WNP',
    predictionCases
  }]
});
const historicalStorm = forecastOnlyPlan.rows.find(row => row.table === 'historical_storms').values;
const persistedSnapshots = forecastOnlyPlan.rows.filter(row => row.table === 'forecast_snapshots').map(row => row.values);
assert.equal(persistedSnapshots.length, 2);
assert.equal(historicalStorm.backfill_mode, 'forecast-only');

function sixHourFloor(ms) {
  const step = 6 * 60 * 60 * 1000;
  return Math.floor(ms / step) * step;
}

function jmaTime(ms) {
  const date = new Date(ms);
  return `${String(date.getUTCFullYear()).slice(-2)}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}${String(date.getUTCHours()).padStart(2, '0')}`;
}

function buildSyntheticFinalizedBestTrack() {
  const forecastTimes = persistedSnapshots.flatMap(row => {
    const snapshot = parseJson(row.snapshot_json);
    return Object.values(snapshot.sources || {}).flatMap(source => Array.isArray(source?.forecast)
      ? source.forecast.map(point => Date.parse(point.time))
      : []);
  }).filter(Number.isFinite);
  assert.ok(forecastTimes.length > 0);
  const step = 6 * 60 * 60 * 1000;
  const start = sixHourFloor(Math.min(...forecastTimes) - 12 * 60 * 60 * 1000);
  const end = sixHourFloor(Math.max(...forecastTimes) + 18 * 60 * 60 * 1000);
  const count = Math.round((end - start) / step) + 1;
  assert.ok(count > 0 && count < 256);
  const lines = [];
  for (let index = 0; index < count; index += 1) {
    const time = start + index * step;
    const latTenths = 220 + index;
    const lonTenths = 1600 - index * 2;
    const pressure = 995 - (index % 8);
    const windKnots = 40 + (index % 5) * 5;
    lines.push(`${jmaTime(time)} 002 3 ${String(latTenths).padStart(3, '0')} ${String(lonTenths).padStart(4, '0')} ${pressure} ${String(windKnots).padStart(3, '0')} 00000 0000 80180 0090`);
  }
  return [`66666 ${INTERNATIONAL_NUMBER} ${String(count).padStart(3, '0')} 0099 ${INTERNATIONAL_NUMBER} 0 6 GENERIC-TEST 20261009`, ...lines].join('\n');
}

const augmentation = buildGenericJmaTruthAugmentation({
  bestTrackText: buildSyntheticFinalizedBestTrack(),
  positionTableHtml: `<html><body>台風${INTERNATIONAL_NUMBER}号 GENERIC-TEST</body></html>`,
  retrievedAt: RETRIEVED_AT,
  stormKey: STORM_KEY,
  internationalNumber: INTERNATIONAL_NUMBER,
  historicalStorm,
  snapshots: persistedSnapshots
});

assert.equal(augmentation.ok, true);
assert.equal(augmentation.summary.stormKey, STORM_KEY);
assert.equal(augmentation.summary.internationalNumber, INTERNATIONAL_NUMBER);
assert.equal(augmentation.summary.forecastSnapshotCount, 2, 'generic augmentation must not require four snapshots');
assert.equal(augmentation.summary.eligibleForecastSnapshotCount, 2);
assert.equal(augmentation.summary.semantics.priorPlanShaRequired, false);
assert.equal(augmentation.summary.semantics.fixedSnapshotCountRequired, false);
assert.equal(augmentation.summary.semantics.persistedSnapshotsPreservedByteForByte, true);
assert.equal(augmentation.preview.tableCounts.truth_datasets, 1);
assert.ok(augmentation.preview.tableCounts.truth_points > 0);
assert.equal(augmentation.preview.tableCounts.forecast_snapshots, 2);
assert.equal(augmentation.plan.rows.find(row => row.table === 'historical_storms').values.backfill_mode, 'full-walk-forward');
assert.equal(augmentation.plan.rows.find(row => row.table === 'historical_storms').values.agency_skill_eligible, 1);

const augmentedSnapshotRows = augmentation.plan.rows.filter(row => row.table === 'forecast_snapshots').map(row => row.values)
  .sort((a, b) => String(a.snapshot_id).localeCompare(String(b.snapshot_id)));
const originalSnapshotRows = persistedSnapshots.slice().sort((a, b) => String(a.snapshot_id).localeCompare(String(b.snapshot_id)));
assert.deepEqual(augmentedSnapshotRows, originalSnapshotRows, 'generic truth attachment must preserve persisted snapshot rows exactly');

const verification = buildGenericVerificationRows(augmentation.plan, { verifiedAt: VERIFIED_AT });
assert.equal(verification.ok, true);
assert.equal(verification.stormCount, 1);
assert.equal(verification.snapshotCount, 2, 'generic verification must use actual eligible snapshot count');
assert.equal(verification.proposedVerificationRows.length, 2);
assert.ok(verification.verifiedAgencyCaseCount > 0);
assert.ok(verification.verifiedPointCount > 0);
assert.equal(verification.semantics.fixedStormKeyRequired, false);
assert.equal(verification.semantics.fixedSnapshotCountRequired, false);
assert.equal(verification.semantics.verificationRowsWritten, false);
assert.ok(/^[0-9a-f]{64}$/.test(verification.previewFingerprint));
assert.ok(verification.proposedVerificationRows.every(row => row.values.storm_key === STORM_KEY));
assert.ok(verification.proposedVerificationRows.every(row => row.values.verification_version === 'forecast-verification/v1'));

const persistencePreview = previewVerificationRows(verification.proposedVerificationRows);
assert.equal(persistencePreview.ok, true);
assert.equal(persistencePreview.dryRun, true);
assert.equal(persistencePreview.writesPerformed, false);
assert.equal(persistencePreview.rowCount, 2);

const replay = buildGenericJmaTruthAugmentation({
  bestTrackText: buildSyntheticFinalizedBestTrack(),
  positionTableHtml: `<html><body>台風${INTERNATIONAL_NUMBER}号 GENERIC-TEST</body></html>`,
  retrievedAt: RETRIEVED_AT,
  stormKey: STORM_KEY,
  internationalNumber: INTERNATIONAL_NUMBER,
  historicalStorm,
  snapshots: persistedSnapshots
});
assert.equal(replay.truthSha256, augmentation.truthSha256);
assert.equal(replay.planSha256, augmentation.planSha256);
assert.deepEqual(replay.plan, augmentation.plan, 'generic augmentation must be deterministic');

assert.throws(() => buildGenericJmaTruthAugmentation({
  bestTrackText: buildSyntheticFinalizedBestTrack(),
  positionTableHtml: `<html><body>台風${INTERNATIONAL_NUMBER}号 ※</body></html>`,
  retrievedAt: RETRIEVED_AT,
  stormKey: STORM_KEY,
  internationalNumber: INTERNATIONAL_NUMBER,
  historicalStorm,
  snapshots: persistedSnapshots
}), /not finalized/);

console.log('storm-analysis AI-23 generic truth/verification tests passed');
