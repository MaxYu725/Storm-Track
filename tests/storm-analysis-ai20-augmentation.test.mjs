import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTruthAugmentationPlan, MAX_TRUTH_POINTS } from '../workers/storm-analysis/scripts/ai20-build-truth-augmentation-plan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const ai19Input = readJson('data/ai19/chan-hom-pilot-input.json');
const ai19Plan = readJson('data/ai19/chan-hom-import-plan.json');

const finalizedBestTrack = [
  '66666 2615  003 0015 2615 0 6 CHAN-HOM 20261001',
  '26080500 002 3 180 1280 998 035 00000 0000 80180 0090',
  '26080506 002 4 185 1270 985 050 00000 0000 80210 0120',
  '26080512 002 5 190 1260 970 065 00000 0000 80240 0150'
].join('\n');
const finalizedPositionTable = '<html><body>台風第15号 台風2615号 （上陸）</body></html>';
const preliminaryPositionTable = '<html><body>台風第15号 台風2615号 ※ （上陸）</body></html>';

const result = buildTruthAugmentationPlan({
  bestTrackText: finalizedBestTrack,
  positionTableHtml: finalizedPositionTable,
  retrievedAt: '2026-10-02T00:00:00.000Z',
  ai19Input,
  ai19Plan
});

assert.equal(result.summary.stormKey, 'WP-2026-15');
assert.equal(result.summary.internationalNumber, '2615');
assert.equal(result.summary.truthPointCount, 3);
assert.equal(result.summary.forecastSnapshotCount, 4);
assert.equal(result.summary.tableCounts.backfill_runs, 1);
assert.equal(result.summary.tableCounts.historical_storms, 1);
assert.equal(result.summary.tableCounts.truth_datasets, 1);
assert.equal(result.summary.tableCounts.truth_points, 3);
assert.equal(result.summary.tableCounts.forecast_snapshots, 4);
assert.equal(result.summary.tableCounts.signal_outcomes, 0);
assert.equal(result.summary.rowCount, 10);
assert.equal(result.summary.capability.mode, 'full-walk-forward');
assert.equal(result.summary.capability.truthAvailable, true);
assert.equal(result.summary.capability.eligibleForecastCases, 4);
assert.equal(result.summary.capability.eligibleForAgencySkill, true);
assert.equal(result.summary.semantics.ai19SnapshotsPreservedByteForByte, true);
assert.equal(result.summary.semantics.analysisDatabaseWritten, false);
assert.equal(result.summary.semantics.verificationPerformed, false);
assert.equal(result.summary.semantics.trainingPerformed, false);
assert.equal(result.summary.semantics.promotionPerformed, false);
assert.match(result.summary.runId, /^ai20_chanhom_truth_[0-9a-f]{16}$/);
assert.ok(result.summary.runSource.includes(result.truthSha256));
assert.ok(result.summary.runSource.includes(result.ai19PlanSha256));
assert.equal(result.truth.finality.status, 'finalized');
assert.equal(result.truth.semantics.preliminaryDataUsed, false);
assert.equal(result.truth.semantics.forecastDataUsedAsTruth, false);

const historical = result.plan.rows.find(row => row.table === 'historical_storms');
assert.equal(historical.values.backfill_mode, 'full-walk-forward');
assert.equal(historical.values.agency_skill_eligible, 1);

const beforeSnapshots = ai19Plan.rows.filter(row => row.table === 'forecast_snapshots').sort((a, b) => a.primaryKey.localeCompare(b.primaryKey));
const afterSnapshots = result.plan.rows.filter(row => row.table === 'forecast_snapshots').sort((a, b) => a.primaryKey.localeCompare(b.primaryKey));
assert.deepEqual(afterSnapshots, beforeSnapshots, 'AI-20 must not rewrite or reinterpret AI-19 snapshot rows');

assert.throws(() => buildTruthAugmentationPlan({
  bestTrackText: finalizedBestTrack,
  positionTableHtml: preliminaryPositionTable,
  retrievedAt: '2026-10-02T00:00:00.000Z',
  ai19Input,
  ai19Plan
}), error => error?.code === 'jma-truth-not-finalized');

const driftedInput = structuredClone(ai19Input);
driftedInput.storms[0].predictionCases[0].snapshot.sources.JMA.forecast[0].lat += 0.1;
assert.throws(() => buildTruthAugmentationPlan({
  bestTrackText: finalizedBestTrack,
  positionTableHtml: finalizedPositionTable,
  retrievedAt: '2026-10-02T00:00:00.000Z',
  ai19Input: driftedInput,
  ai19Plan
}), /snapshot row drift/);

const tooManyLines = [];
for (let index = 0; index < MAX_TRUTH_POINTS + 1; index += 1) {
  const day = String(1 + Math.floor(index / 4)).padStart(2, '0');
  const hour = String((index % 4) * 6).padStart(2, '0');
  tooManyLines.push(`2610${day}${hour} 002 3 180 1280 998 035 00000 0000 80180 0090`);
}
const oversizedBestTrack = [`66666 2615  ${String(tooManyLines.length).padStart(3, '0')} 0015 2615 0 6 CHAN-HOM 20261020`, ...tooManyLines].join('\n');
assert.throws(() => buildTruthAugmentationPlan({
  bestTrackText: oversizedBestTrack,
  positionTableHtml: finalizedPositionTable,
  retrievedAt: '2026-10-21T00:00:00.000Z',
  ai19Input,
  ai19Plan
}), /finalized truth point count/);

console.log('storm-analysis AI-20 truth augmentation tests passed');
