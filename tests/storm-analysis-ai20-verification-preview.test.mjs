import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTruthAugmentationPlan, MAX_TRUTH_POINTS } from '../workers/storm-analysis/scripts/ai20-build-truth-augmentation-plan.mjs';
import { previewVerificationFromAugmentationPlan } from '../workers/storm-analysis/scripts/ai20-preview-verification.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ai19Plan = JSON.parse(fs.readFileSync(path.join(root, 'data/ai19/chan-hom-import-plan.json'), 'utf8'));

function sixHourFloor(ms) {
  const step = 6 * 60 * 60 * 1000;
  return Math.floor(ms / step) * step;
}

function jmaTime(ms) {
  const date = new Date(ms);
  return `${String(date.getUTCFullYear()).slice(-2)}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}${String(date.getUTCHours()).padStart(2, '0')}`;
}

function buildSyntheticFinalizedBestTrack() {
  const forecastTimes = ai19Plan.rows.filter(row => row.table === 'forecast_snapshots').flatMap(row => {
    const snapshot = JSON.parse(row.values.snapshot_json);
    return Object.values(snapshot.sources || {}).flatMap(source => Array.isArray(source?.forecast) ? source.forecast.map(point => Date.parse(point.time)) : []);
  }).filter(Number.isFinite);
  assert.ok(forecastTimes.length > 0);
  const step = 6 * 60 * 60 * 1000;
  const start = sixHourFloor(Math.min(...forecastTimes) - 12 * 60 * 60 * 1000);
  const end = sixHourFloor(Math.max(...forecastTimes) + 18 * 60 * 60 * 1000);
  const count = Math.round((end - start) / step) + 1;
  assert.ok(count > 0 && count <= MAX_TRUTH_POINTS, `synthetic truth fixture unexpectedly needs ${count} points`);
  const lines = [];
  for (let index = 0; index < count; index += 1) {
    const time = start + index * step;
    const latTenths = 220 + index;
    const lonTenths = 1600 - index * 2;
    const pressure = 995 - (index % 8);
    const windKnots = 40 + (index % 5) * 5;
    lines.push(`${jmaTime(time)} 002 3 ${String(latTenths).padStart(3, '0')} ${String(lonTenths).padStart(4, '0')} ${pressure} ${String(windKnots).padStart(3, '0')} 00000 0000 80180 0090`);
  }
  return [`66666 2615  ${String(count).padStart(3, '0')} 0015 2615 0 6 CHAN-HOM 20261001`, ...lines].join('\n');
}

const augmentation = buildTruthAugmentationPlan({
  bestTrackText: buildSyntheticFinalizedBestTrack(),
  positionTableHtml: '<html><body>台風第15号 台風2615号 （上陸）</body></html>',
  retrievedAt: '2026-10-02T00:00:00.000Z',
  ai19Plan
});

const preview = previewVerificationFromAugmentationPlan(augmentation.plan, { verifiedAt: '2026-10-02T01:00:00.000Z' });
assert.equal(preview.ok, true);
assert.equal(preview.snapshotCount, 4);
assert.equal(preview.results.length, 4);
assert.equal(preview.proposedVerificationRows.length, 4);
assert.ok(preview.verifiedAgencyCaseCount > 0);
assert.ok(preview.verifiedPointCount > 0);
assert.ok(preview.intensityComparablePointCount > 0, 'windMs / structured JMA wind must be normalized into comparable metrics');
assert.ok(preview.pressureComparablePointCount > 0, 'pressureHpa / structured JMA pressure must be normalized into comparable metrics');
assert.equal(preview.semantics.proposedRowsOnly, true);
assert.equal(preview.semantics.verificationRowsWritten, false);
assert.equal(preview.semantics.trainingPerformed, false);
assert.equal(preview.semantics.promotionPerformed, false);
assert.equal(preview.semantics.productionDatabaseWritten, false);
assert.ok(/^[0-9a-f]{64}$/.test(preview.previewFingerprint));
assert.ok(preview.proposedVerificationRows.every(row => row.table === 'verification_results'));
assert.ok(preview.proposedVerificationRows.every(row => row.values.truth_dataset_id === preview.truthDatasetId));
assert.ok(preview.proposedVerificationRows.every(row => row.values.verification_version === 'forecast-verification/v1'));

const firstVerifiedPoint = preview.results.flatMap(item => Object.values(item.result.agencies || {})).flatMap(item => item?.points || []).find(item => Number.isFinite(item?.errors?.intensityMs) && Number.isFinite(item?.errors?.pressureHpa));
assert.ok(firstVerifiedPoint, 'preview must produce at least one track/intensity/pressure comparable point');
assert.ok(Number.isFinite(firstVerifiedPoint.forecast.maximumWindMs));
assert.ok(Number.isFinite(firstVerifiedPoint.actual.maximumWindMs));
assert.ok(Number.isFinite(firstVerifiedPoint.forecast.pressureHpa));
assert.ok(Number.isFinite(firstVerifiedPoint.actual.pressureHpa));

const replay = previewVerificationFromAugmentationPlan(augmentation.plan, { verifiedAt: '2026-10-02T01:00:00.000Z' });
assert.equal(replay.previewFingerprint, preview.previewFingerprint);
assert.deepEqual(replay.proposedVerificationRows, preview.proposedVerificationRows, 'verification preview must be deterministic for exact same plan and verifiedAt');

assert.throws(() => previewVerificationFromAugmentationPlan(augmentation.plan), /verifiedAt is required/);
const disabled = structuredClone(augmentation.plan);
disabled.rows.find(row => row.table === 'historical_storms').values.agency_skill_eligible = 0;
assert.throws(() => previewVerificationFromAugmentationPlan(disabled, { verifiedAt: '2026-10-02T01:00:00.000Z' }), /agency_skill_eligible=1/);

console.log('storm-analysis AI-20 verification preview tests passed');
