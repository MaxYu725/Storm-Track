import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { previewImportPlan } from '../src/backfill-repository.js';

const require = createRequire(import.meta.url);
const importer = require('../../../analysis/historical-backfill-importer.js');
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');
const dataDir = path.resolve(process.argv[2] || path.join(repoRoot, 'data/ai19'));

function read(name) { return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8')); }
function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const evidence = read('chan-hom-forecast-evidence.json');
const input = read('chan-hom-pilot-input.json');
const plan = read('chan-hom-import-plan.json');
const summary = read('chan-hom-pilot-summary.json');
const evidenceBase = { ...evidence };
delete evidenceBase.evidenceSha256;
const evidenceSha256 = sha256(importer.stableStringify(evidenceBase));
const planSha256 = sha256(importer.stableStringify(plan));
const preview = previewImportPlan(plan);

assert(evidenceSha256 === evidence.evidenceSha256, 'evidence self-hash mismatch');
assert(evidenceSha256 === summary.evidenceSha256, 'summary evidence hash mismatch');
assert(planSha256 === summary.planSha256, 'summary plan hash mismatch');
assert(summary.runId === 'ai19_chanhom_forecast_21b774c59c7773cd', 'unexpected AI-19 run ID');
assert(plan.runId === summary.runId && input.runId === summary.runId, 'run ID mismatch across canonical files');
assert(plan.source === summary.runSource && input.source === summary.runSource, 'run source mismatch across canonical files');
assert(summary.runSource === `ai19-forecast-only-pilot/storm-track-db/${evidenceSha256}`, 'run source must bind exact evidence hash');
assert(summary.storm.stormKey === 'WP-2026-15' && summary.storm.nameEn === 'CHAN-HOM', 'unexpected pilot storm');
assert(summary.selectedAdvisoryCount === 13 && summary.forecastPointCount === 69 && summary.snapshotCount === 4, 'unexpected evidence counts');
assert(summary.capability.mode === 'forecast-only' && summary.capability.truthAvailable === false && summary.capability.eligibleForAgencySkill === false, 'unexpected pilot capability');
assert(preview.ok === true && preview.dryRun === true && preview.writesPerformed === false && preview.rowCount === 6, 'canonical plan local preview failed');
assert(preview.tableCounts.backfill_runs === 1 && preview.tableCounts.historical_storms === 1 && preview.tableCounts.forecast_snapshots === 4, 'unexpected writable pilot table counts');
assert(preview.tableCounts.truth_datasets === 0 && preview.tableCounts.truth_points === 0 && preview.tableCounts.signal_outcomes === 0, 'forecast-only plan must not contain truth/outcome rows');

const runRow = plan.rows.find(row => row.table === 'backfill_runs');
const stormRow = plan.rows.find(row => row.table === 'historical_storms');
const snapshots = plan.rows.filter(row => row.table === 'forecast_snapshots');
assert(runRow?.values.run_id === summary.runId && typeof runRow?.values.fingerprint === 'string', 'invalid run row');
assert(stormRow?.values.storm_key === 'WP-2026-15' && stormRow?.values.backfill_mode === 'forecast-only' && stormRow?.values.agency_skill_eligible === 0, 'invalid historical storm row');
assert(snapshots.length === 4 && snapshots.every(row => row.values.eligible_for_walkforward === 1 && row.values.rejection_reason == null), 'all four snapshots must preserve trusted forecast provenance');
for (const row of snapshots) {
  const snapshot = JSON.parse(row.values.snapshot_json);
  const asOf = row.values.as_of;
  assert(snapshot.generatedAt === asOf, `snapshot ${row.primaryKey} cutoff mismatch`);
  let forecastPoints = 0;
  for (const agency of ['HKO', 'CMA', 'JMA', 'CWA']) {
    const source = snapshot.sources?.[agency];
    if (source?.state !== 'ok') continue;
    assert(source.baseTime <= asOf, `${row.primaryKey} ${agency} base time is after cutoff`);
    for (const point of source.forecast || []) {
      assert(point.time > asOf, `${row.primaryKey} ${agency} contains non-future forecast point`);
      forecastPoints += 1;
    }
  }
  assert(forecastPoints > 0, `${row.primaryKey} has no forecast evidence`);
}
assert(evidence.forecastPoints.every(point => point.valid_at > point.as_of), 'evidence contains non-future forecast point');
assert(evidence.semantics.productionSourceReadOnly === true && evidence.semantics.forecastOnly === true && evidence.semantics.truthRowsPlanned === 0, 'evidence semantics mismatch');

const result = {
  ok: true,
  evidenceSha256,
  planSha256,
  runId: summary.runId,
  runFingerprint: runRow.values.fingerprint,
  stormKey: stormRow.values.storm_key,
  snapshotIds: snapshots.map(row => row.values.snapshot_id).sort(),
  rowCount: preview.rowCount,
  tableCounts: preview.tableCounts,
  forecastPointCount: summary.forecastPointCount,
  capability: summary.capability,
  importExecuted: false
};
console.log(JSON.stringify(result));
