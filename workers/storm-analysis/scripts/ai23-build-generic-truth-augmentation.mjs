import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { previewImportPlan } from '../src/backfill-repository.js';
import { buildCanonicalTruth } from './ai20-jma-besttrack.mjs';

const require = createRequire(import.meta.url);
const importer = require('../../../analysis/historical-backfill-importer.js');

export const AI23_TRUTH_AUGMENTATION_VERSION = 'ai23-generic-jma-truth-augmentation/v1';
export const MAX_TRUTH_POINTS = 256;
export const JMA_IDENTITY_TYPE = 'jma-rsmc-number';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  const text = typeof value === 'string' ? value : importer.stableStringify(value);
  return crypto.createHash('sha256').update(text).digest('hex');
}

function stable(value) {
  return importer.stableStringify(value);
}

function parseJson(value, label) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); }
  catch (error) { throw new Error(`invalid ${label}: ${error.message}`); }
}

function valuesOf(row) {
  return row?.values ?? row;
}

function normalizeHistoricalStorm(row, stormKey) {
  const values = valuesOf(row);
  assert(values && typeof values === 'object', 'historicalStorm row is required');
  assert(String(values.storm_key || '').trim() === stormKey, `historicalStorm must match ${stormKey}`);
  return values;
}

function normalizeReviewedIdentityBinding(row, stormKey, internationalNumber) {
  const values = valuesOf(row);
  assert(values && typeof values === 'object', 'reviewedIdentityBinding row is required');
  assert(String(values.storm_key || '').trim() === stormKey, `reviewed identity binding must match ${stormKey}`);
  assert(String(values.identity_type || '').trim() === JMA_IDENTITY_TYPE, `reviewed identity binding type must be ${JMA_IDENTITY_TYPE}`);
  assert(String(values.identity_value || '').trim() === internationalNumber, `reviewed identity binding must map ${internationalNumber}`);
  assert(String(values.review_status || '').trim().toLowerCase() === 'reviewed', 'JMA truth attachment requires reviewed storm identity');
  assert(String(values.reviewer || '').trim(), 'reviewed identity binding requires reviewer');
  assert(Number.isFinite(Date.parse(values.reviewed_at)), 'reviewed identity binding requires valid reviewed_at');
  assert(String(values.fingerprint || '').trim(), 'reviewed identity binding requires fingerprint');
  return values;
}

function normalizeSnapshots(rows, stormKey) {
  assert(Array.isArray(rows) && rows.length > 0, 'at least one persisted forecast snapshot is required');
  const normalized = rows.map((row, index) => {
    const values = valuesOf(row);
    assert(values && typeof values === 'object', `snapshots[${index}] row is required`);
    assert(String(values.storm_key || '').trim() === stormKey, `snapshot ${values.snapshot_id || index} storm_key mismatch`);
    assert(values.snapshot_id, `snapshots[${index}].snapshot_id is required`);
    assert(values.as_of, `snapshots[${index}].as_of is required`);
    assert(values.snapshot_json, `snapshots[${index}].snapshot_json is required`);
    const snapshot = parseJson(values.snapshot_json, `${values.snapshot_id}.snapshot_json`);
    assert(snapshot?.storm?.key === stormKey, `snapshot ${values.snapshot_id} embedded storm key mismatch`);
    return values;
  });
  const ids = new Set(normalized.map(row => row.snapshot_id));
  assert(ids.size === normalized.length, 'persisted snapshot IDs must be unique');
  return normalized.slice().sort((a, b) => String(a.as_of).localeCompare(String(b.as_of)) || String(a.snapshot_id).localeCompare(String(b.snapshot_id)));
}

function predictionCaseFromRow(values) {
  return {
    caseId: values.snapshot_id,
    asOf: values.as_of,
    snapshot: parseJson(values.snapshot_json, `${values.snapshot_id}.snapshot_json`),
    impact: parseJson(values.impact_json, `${values.snapshot_id}.impact_json`),
    signalInputs: parseJson(values.signal_inputs_json, `${values.snapshot_id}.signal_inputs_json`),
    sourceAvailability: parseJson(values.source_availability_json, `${values.snapshot_id}.source_availability_json`),
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
}

function assertSnapshotRowsPreserved(existingRows, plan) {
  const planned = plan.rows.filter(row => row.table === 'forecast_snapshots')
    .map(row => row.values)
    .sort((a, b) => String(a.as_of).localeCompare(String(b.as_of)) || String(a.snapshot_id).localeCompare(String(b.snapshot_id)));
  assert(planned.length === existingRows.length, `snapshot row count drift: ${existingRows.length} -> ${planned.length}`);
  for (let index = 0; index < existingRows.length; index += 1) {
    assert(existingRows[index].snapshot_id === planned[index].snapshot_id, `snapshot ID drift at index ${index}`);
    assert(stable(existingRows[index]) === stable(planned[index]), `snapshot row drift for ${existingRows[index].snapshot_id}`);
  }
}

export function buildGenericJmaTruthAugmentation({
  bestTrackText,
  positionTableHtml,
  retrievedAt,
  stormKey,
  internationalNumber,
  reviewedIdentityBinding,
  historicalStorm,
  snapshots
}) {
  const key = String(stormKey || '').trim();
  const number = String(internationalNumber || '').trim();
  assert(key, 'stormKey is required');
  assert(/^\d{4}$/.test(number), 'internationalNumber must be a four-digit JMA number');

  const historical = normalizeHistoricalStorm(historicalStorm, key);
  const identity = normalizeReviewedIdentityBinding(reviewedIdentityBinding, key, number);
  const existingSnapshots = normalizeSnapshots(snapshots, key);
  const truth = buildCanonicalTruth({ bestTrackText, positionTableHtml, internationalNumber: number, stormKey: key, retrievedAt });
  assert(truth.finality.status === 'finalized', 'generic truth augmentation requires finalized JMA truth');
  assert(truth.semantics.preliminaryDataUsed === false, 'preliminary JMA data cannot be used as truth');
  assert(truth.semantics.forecastDataUsedAsTruth === false, 'forecast data cannot be used as truth');
  assert(truth.track.length > 0 && truth.track.length <= MAX_TRUTH_POINTS, `finalized truth point count must be 1..${MAX_TRUTH_POINTS}`);

  const truthSha256 = sha256(truth);
  const snapshotSetSha256 = sha256(existingSnapshots.map(row => ({
    snapshot_id: row.snapshot_id,
    as_of: row.as_of,
    fingerprint: row.fingerprint,
    payload_hash: row.payload_hash
  })));
  const identityBindingFingerprint = String(identity.fingerprint);
  const runId = `ai23_truth_${key.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${truthSha256.slice(0, 16)}`;
  const source = `ai23-finalized-jma-truth/${key}/${number}/${truthSha256}/identity/${identityBindingFingerprint}/snapshots/${snapshotSetSha256}`;

  const plan = importer.buildImportPlan({
    source,
    generatedAt: truth.retrievedAt,
    runId,
    storms: [{
      stormKey: key,
      nameTc: historical.name_tc ?? null,
      nameEn: historical.name_en ?? null,
      season: historical.season,
      basin: historical.basin ?? 'WNP',
      predictionCases: existingSnapshots.map(predictionCaseFromRow),
      truth
    }]
  });
  const preview = previewImportPlan(plan);
  assert(plan.storms.length === 1, 'generic augmentation currently operates on one storm per reviewed truth binding');
  assert(plan.storms[0].capability.truthAvailable === true, 'truth must be present in augmentation plan');
  assert(plan.storms[0].capability.eligibleForecastCases >= 1, 'at least one persisted forecast snapshot must remain eligible for verification');
  assert(plan.rows.filter(row => row.table === 'truth_datasets').length === 1, 'exactly one truth dataset is required per reviewed storm binding');
  assert(plan.rows.filter(row => row.table === 'truth_points').length === truth.track.length, 'truth point row count mismatch');
  assert(!plan.rows.some(row => row.table === 'signal_outcomes'), 'generic truth augmentation must not create signal outcomes');
  assert(preview.ok === true && preview.dryRun === true && preview.writesPerformed === false, 'generic augmentation preview must be no-write');
  assertSnapshotRowsPreserved(existingSnapshots, plan);

  const planSha256 = sha256(plan);
  return {
    ok: true,
    version: AI23_TRUTH_AUGMENTATION_VERSION,
    stormKey: key,
    internationalNumber: number,
    identityBindingFingerprint,
    truth,
    truthSha256,
    snapshotSetSha256,
    plan,
    planSha256,
    preview,
    summary: {
      stormKey: key,
      internationalNumber: number,
      identityType: JMA_IDENTITY_TYPE,
      identityBindingFingerprint,
      runId,
      source,
      truthSha256,
      snapshotSetSha256,
      planSha256,
      truthPointCount: truth.track.length,
      forecastSnapshotCount: existingSnapshots.length,
      eligibleForecastSnapshotCount: plan.storms[0].capability.eligibleForecastCases,
      capability: plan.storms[0].capability,
      tableCounts: preview.tableCounts,
      semantics: {
        genericStormKey: true,
        genericInternationalNumber: true,
        reviewedJmaIdentityRequired: true,
        identityBindingIncludedInRunSource: true,
        priorPlanShaRequired: false,
        fixedSnapshotCountRequired: false,
        persistedSnapshotsPreservedByteForByte: true,
        finalizedJmaTruthRequired: true,
        preliminaryTruthRejected: true,
        truthWritePerformed: false,
        verificationWritePerformed: false,
        trainingPerformed: false,
        promotionPerformed: false,
        productionDatabaseWritten: false
      }
    }
  };
}
