import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const importer = require('../../../analysis/historical-backfill-importer.js');

const EXPECTED = Object.freeze({
  evidenceSha256: 'bf48ab58f885b42b33b0d5f0247416a649b389cfffaa4b4d794868076964716f',
  planSha256: '77b2bfdac1190cd5987f2407e9d83af5efa6fabd346ac6f9516fbb3f914e69d2',
  runId: 'ai21_forecast_corpus_bf48ab58f885b42b',
  stormKey: 'WP-2026-17'
});

function sha256(value) {
  const text = typeof value === 'string' ? value : importer.stableStringify(value);
  return crypto.createHash('sha256').update(text).digest('hex');
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const root = path.resolve(process.argv[2] ?? 'data/ai21');
const evidence = readJson(path.join(root, 'forecast-corpus-evidence.json'));
const input = readJson(path.join(root, 'forecast-corpus-input.json'));
const plan = readJson(path.join(root, 'forecast-corpus-plan.json'));
const summary = readJson(path.join(root, 'forecast-corpus-summary.json'));

const { evidenceSha256: embeddedEvidenceSha, ...evidenceEnvelope } = evidence;
const evidenceSha256 = sha256(evidenceEnvelope);
const planSha256 = sha256(plan);

assert(evidenceSha256 === EXPECTED.evidenceSha256, 'AI-21 evidence SHA-256 mismatch');
assert(embeddedEvidenceSha === evidenceSha256, 'AI-21 embedded evidence SHA-256 mismatch');
assert(planSha256 === EXPECTED.planSha256, 'AI-21 plan SHA-256 mismatch');
assert(summary.evidenceSha256 === evidenceSha256, 'AI-21 summary evidence SHA mismatch');
assert(summary.planSha256 === planSha256, 'AI-21 summary plan SHA mismatch');
assert(summary.runId === EXPECTED.runId && plan.runId === EXPECTED.runId && input.runId === EXPECTED.runId, 'AI-21 run ID mismatch');
assert(input.source === `ai21-prospective-forecast-corpus/storm-track-db/${evidenceSha256}`, 'AI-21 run source must bind exact evidence SHA');
assert(summary.stormCount === 1 && summary.snapshotCount === 4, 'AI-21 must contain exactly one storm and four snapshots');
assert(summary.selectedAdvisoryCount === 11 && summary.forecastPointCount === 56, 'AI-21 evidence cardinality mismatch');
assert(summary.storms?.[0]?.stormKey === EXPECTED.stormKey, 'AI-21 summary storm key mismatch');
assert(summary.storms?.[0]?.identity?.status === 'unreviewed' && summary.storms?.[0]?.identity?.internationalNumber == null, 'AI-21 external identity must remain unreviewed');

const rows = Array.isArray(plan.rows) ? plan.rows : [];
assert(rows.length === 6, `AI-21 expected 6 plan rows, got ${rows.length}`);
const count = table => rows.filter(row => row.table === table).length;
assert(count('backfill_runs') === 1, 'AI-21 requires one backfill run row');
assert(count('historical_storms') === 1, 'AI-21 requires one historical storm row');
assert(count('forecast_snapshots') === 4, 'AI-21 requires four forecast snapshot rows');
for (const table of ['truth_datasets','truth_points','signal_outcomes','verification_results','agency_skill_profiles','adaptive_weight_candidates','signal_calibration_training_runs','signal_outcome_curations','signal_profile_promotion_events']) {
  assert(count(table) === 0, `AI-21 canonical plan must not contain ${table}`);
}

const runRow = rows.find(row => row.table === 'backfill_runs');
assert(runRow?.values?.run_id === EXPECTED.runId, 'AI-21 backfill run row ID mismatch');
assert(typeof runRow?.values?.fingerprint === 'string' && /^[0-9a-f]{16}$/i.test(runRow.values.fingerprint), 'AI-21 run fingerprint invalid');
const stormRow = rows.find(row => row.table === 'historical_storms');
assert(stormRow?.values?.storm_key === EXPECTED.stormKey, 'AI-21 historical storm mismatch');
assert(stormRow?.values?.backfill_mode === 'forecast-only', 'AI-21 historical storm must remain forecast-only');
assert(Number(stormRow?.values?.agency_skill_eligible) === 0, 'AI-21 historical storm must not be agency-skill eligible');

const snapshots = rows.filter(row => row.table === 'forecast_snapshots');
for (const row of snapshots) {
  assert(row.values?.storm_key === EXPECTED.stormKey, 'AI-21 snapshot belongs to unexpected storm');
  assert(Number(row.values?.eligible_for_walkforward) === 1, 'AI-21 snapshot must retain trusted historical provenance');
  const snapshot = JSON.parse(row.values.snapshot_json);
  assert(snapshot?.storm?.key === EXPECTED.stormKey, 'AI-21 snapshot JSON storm key mismatch');
  assert(!Object.prototype.hasOwnProperty.call(snapshot.storm, 'internationalNumber'), 'AI-21 unreviewed international number leaked into snapshot');
  assert(snapshot?.sources?.HKO?.state === 'missing', 'AI-21 HKO must remain explicitly missing');
  for (const agency of ['CMA','JMA','CWA']) {
    const source = snapshot?.sources?.[agency];
    if (source?.state === 'ok') {
      assert(Array.isArray(source.forecast) && source.forecast.length > 0, `${agency} forecast missing`);
      assert(source.forecast.every(point => Date.parse(point.time) > Date.parse(snapshot.generatedAt)), `${agency} contains non-future point`);
    }
  }
}

assert(plan.tableCounts?.backfill_runs === 1 && plan.tableCounts?.historical_storms === 1 && plan.tableCounts?.forecast_snapshots === 4, 'AI-21 tableCounts mismatch');
assert((plan.tableCounts?.truth_datasets ?? 0) === 0 && (plan.tableCounts?.truth_points ?? 0) === 0 && (plan.tableCounts?.signal_outcomes ?? 0) === 0, 'AI-21 canonical plan contains forbidden truth/outcome rows');

process.stdout.write(`${JSON.stringify({
  ok: true,
  evidenceSha256,
  planSha256,
  runId: EXPECTED.runId,
  runFingerprint: runRow.values.fingerprint,
  stormKey: EXPECTED.stormKey,
  rowCount: rows.length,
  snapshotCount: snapshots.length,
  backfillMode: stormRow.values.backfill_mode,
  agencySkillEligible: Number(stormRow.values.agency_skill_eligible) === 1
})}\n`);
