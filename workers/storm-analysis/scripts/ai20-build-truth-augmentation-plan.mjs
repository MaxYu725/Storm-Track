import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { previewImportPlan } from '../src/backfill-repository.js';
import { buildCanonicalTruth } from './ai20-jma-besttrack.mjs';

const require = createRequire(import.meta.url);
const importer = require('../../../analysis/historical-backfill-importer.js');
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(workerRoot, '../..');

export const AI20_AUGMENTATION_VERSION = 'ai20-jma-truth-augmentation/v1';
export const TARGET_STORM_KEY = 'WP-2026-15';
export const TARGET_INTERNATIONAL_NUMBER = '2615';
export const EXPECTED_AI19_RUN_ID = 'ai19_chanhom_forecast_21b774c59c7773cd';
export const EXPECTED_AI19_PLAN_SHA256 = '98a3a2d6c20e5a4704604ef7c58df49a7703b93f9399e2e74962bcd76d74573a';
export const MAX_TRUTH_POINTS = 64;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  const text = typeof value === 'string' ? value : importer.stableStringify(value);
  return crypto.createHash('sha256').update(text).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function stableJson(value) {
  return `${JSON.stringify(JSON.parse(importer.stableStringify(value)), null, 2)}\n`;
}

function parseNullableJson(value, label) {
  if (value == null) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`invalid ${label} JSON in AI-19 canonical plan: ${error.message}`);
  }
}

function snapshotRows(plan) {
  return plan.rows.filter(row => row.table === 'forecast_snapshots')
    .slice()
    .sort((a, b) => String(a.primaryKey).localeCompare(String(b.primaryKey)));
}

function assertSnapshotRowsPreserved(ai19Plan, ai20Plan) {
  const before = snapshotRows(ai19Plan);
  const after = snapshotRows(ai20Plan);
  assert(before.length === 4, `expected four AI-19 snapshot rows, got ${before.length}`);
  assert(after.length === 4, `AI-20 augmentation must carry four snapshot rows, got ${after.length}`);
  for (let index = 0; index < before.length; index += 1) {
    assert(before[index].primaryKey === after[index].primaryKey, `snapshot primary key drift at index ${index}`);
    assert(importer.stableStringify(before[index].values) === importer.stableStringify(after[index].values), `snapshot row drift for ${before[index].primaryKey}`);
  }
}

function reconstructStormFromCanonicalPlan(ai19Plan) {
  const planSha256 = sha256(ai19Plan);
  assert(planSha256 === EXPECTED_AI19_PLAN_SHA256, `AI-19 canonical plan SHA mismatch: ${planSha256}`);
  assert(ai19Plan?.runId === EXPECTED_AI19_RUN_ID, 'unexpected AI-19 canonical plan identity');

  const historicalRows = ai19Plan.rows.filter(row => row.table === 'historical_storms');
  assert(historicalRows.length === 1, 'AI-19 canonical plan must contain exactly one historical storm row');
  const historical = historicalRows[0].values;
  assert(historical.storm_key === TARGET_STORM_KEY, `AI-20 requires ${TARGET_STORM_KEY}`);
  assert(historical.backfill_mode === 'forecast-only' && Number(historical.agency_skill_eligible) === 0, 'AI-19 baseline must remain forecast-only and not agency-skill eligible');

  const rows = snapshotRows(ai19Plan);
  const predictionCases = rows.map(row => {
    const values = row.values;
    const snapshot = parseNullableJson(values.snapshot_json, `${row.primaryKey}.snapshot_json`);
    assert(snapshot && typeof snapshot === 'object', `missing snapshot JSON for ${row.primaryKey}`);
    assert(snapshot?.storm?.key === TARGET_STORM_KEY, `snapshot ${row.primaryKey} storm identity mismatch`);
    return {
      caseId: values.snapshot_id,
      asOf: values.as_of,
      snapshot,
      impact: parseNullableJson(values.impact_json, `${row.primaryKey}.impact_json`),
      signalInputs: parseNullableJson(values.signal_inputs_json, `${row.primaryKey}.signal_inputs_json`),
      sourceAvailability: parseNullableJson(values.source_availability_json, `${row.primaryKey}.source_availability_json`),
      provenance: {
        type: values.provenance_type,
        dataRole: 'forecast',
        source: values.provenance_source,
        sourceUrl: values.provenance_source_url,
        archiveId: values.archive_id,
        originalIssuedAt: values.original_issued_at,
        archiveCapturedAt: values.archive_captured_at,
        payloadHash: values.payload_hash
      }
    };
  });

  return {
    ai19PlanSha256: planSha256,
    storm: {
      stormKey: historical.storm_key,
      nameTc: historical.name_tc,
      nameEn: historical.name_en,
      season: historical.season,
      basin: historical.basin,
      predictionCases
    }
  };
}

export function buildTruthAugmentationPlan({
  bestTrackText,
  positionTableHtml,
  retrievedAt,
  ai19Plan
}) {
  const canonicalBaseline = reconstructStormFromCanonicalPlan(ai19Plan);
  const truth = buildCanonicalTruth({
    bestTrackText,
    positionTableHtml,
    internationalNumber: TARGET_INTERNATIONAL_NUMBER,
    stormKey: TARGET_STORM_KEY,
    retrievedAt
  });
  assert(truth.finality.status === 'finalized', 'AI-20 truth must be finalized');
  assert(truth.semantics.preliminaryDataUsed === false, 'AI-20 must reject preliminary truth');
  assert(truth.semantics.forecastDataUsedAsTruth === false, 'AI-20 must not use forecast data as truth');
  assert(truth.track.length > 0 && truth.track.length <= MAX_TRUTH_POINTS, `AI-20 finalized truth point count must be 1..${MAX_TRUTH_POINTS}`);

  const truthSha256 = sha256(truth);
  const ai19PlanSha256 = canonicalBaseline.ai19PlanSha256;
  const runSource = `ai20-finalized-jma-truth/${truthSha256}/ai19-plan/${ai19PlanSha256}`;
  const runId = `ai20_chanhom_truth_${truthSha256.slice(0, 16)}`;
  const combinedInput = {
    source: runSource,
    generatedAt: truth.retrievedAt,
    runId,
    storms: [{
      ...canonicalBaseline.storm,
      truth
    }]
  };

  const plan = importer.buildImportPlan(combinedInput);
  const preview = previewImportPlan(plan);
  const historicalRow = plan.rows.find(row => row.table === 'historical_storms');
  const truthDatasetRows = plan.rows.filter(row => row.table === 'truth_datasets');
  const truthPointRows = plan.rows.filter(row => row.table === 'truth_points');

  assert(plan.storms.length === 1, 'AI-20 augmentation must contain one storm');
  assert(plan.storms[0].capability.mode === 'full-walk-forward', `expected full-walk-forward, got ${plan.storms[0].capability.mode}`);
  assert(plan.storms[0].capability.truthAvailable === true, 'finalized truth must be available');
  assert(plan.storms[0].capability.eligibleForecastCases === 4, 'all four AI-19 forecast cases must remain eligible');
  assert(plan.storms[0].capability.eligibleForAgencySkill === true, 'truth augmentation must make the storm agency-skill eligible');
  assert(historicalRow?.values.backfill_mode === 'full-walk-forward', 'historical storm must upgrade to full-walk-forward');
  assert(historicalRow?.values.agency_skill_eligible === 1, 'historical storm must upgrade to agency_skill_eligible=1');
  assert(truthDatasetRows.length === 1, 'AI-20 augmentation requires exactly one truth dataset');
  assert(truthPointRows.length === truth.track.length, 'truth row count must match finalized JMA track');
  assert(plan.rows.filter(row => row.table === 'forecast_snapshots').length === 4, 'AI-20 augmentation must preserve four forecast snapshots');
  assert(!plan.rows.some(row => row.table === 'signal_outcomes'), 'AI-20 truth augmentation must not add signal outcomes');
  assert(preview.ok === true && preview.dryRun === true && preview.writesPerformed === false, 'AI-20 local preview must be no-write');
  assertSnapshotRowsPreserved(ai19Plan, plan);
  assert(plan.source.includes(truthSha256) && plan.source.includes(ai19PlanSha256), 'run source must bind truth and AI-19 evidence hashes');

  const planSha256 = sha256(plan);
  return {
    version: AI20_AUGMENTATION_VERSION,
    truth,
    truthSha256,
    ai19PlanSha256,
    plan,
    planSha256,
    preview,
    summary: {
      schemaVersion: AI20_AUGMENTATION_VERSION,
      stormKey: TARGET_STORM_KEY,
      internationalNumber: TARGET_INTERNATIONAL_NUMBER,
      runId,
      runSource,
      truthSha256,
      ai19PlanSha256,
      planSha256,
      truthPointCount: truth.track.length,
      forecastSnapshotCount: 4,
      rowCount: preview.rowCount,
      tableCounts: preview.tableCounts,
      capability: plan.storms[0].capability,
      semantics: {
        finalizedJmaTruthRequired: true,
        preliminaryTruthRejected: true,
        ai19CanonicalPlanHashPinned: true,
        ai19SnapshotsPreservedByteForByte: true,
        augmentationNotReplacement: true,
        localPreviewOnly: true,
        analysisDatabaseWritten: false,
        productionDatabaseWritten: false,
        verificationPerformed: false,
        trainingPerformed: false,
        promotionPerformed: false
      }
    }
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) args[argv[index]?.replace(/^--/, '')] = argv[index + 1];
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bestTrackPath = args.bestTrack;
  const positionTablePath = args.positionTable;
  const retrievedAt = args.retrievedAt;
  const ai19PlanPath = path.resolve(args.ai19Plan ?? path.join(repoRoot, 'data/ai19/chan-hom-import-plan.json'));
  if (!bestTrackPath || !positionTablePath || !retrievedAt) {
    throw new Error('usage: ai20-build-truth-augmentation-plan.mjs --bestTrack <file> --positionTable <file> --retrievedAt <ISO> [--ai19Plan file] [--output dir]');
  }
  const result = buildTruthAugmentationPlan({
    bestTrackText: fs.readFileSync(bestTrackPath, 'utf8'),
    positionTableHtml: fs.readFileSync(positionTablePath, 'utf8'),
    retrievedAt,
    ai19Plan: readJson(ai19PlanPath)
  });

  if (args.output) {
    const outputDir = path.resolve(args.output);
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'chan-hom-jma-finalized-truth.json'), stableJson(result.truth));
    fs.writeFileSync(path.join(outputDir, 'chan-hom-truth-augmentation-plan.json'), stableJson(result.plan));
    fs.writeFileSync(path.join(outputDir, 'chan-hom-truth-augmentation-summary.json'), stableJson(result.summary));
  }
  process.stdout.write(`${JSON.stringify({ ok: true, ...result.summary }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
  });
}
