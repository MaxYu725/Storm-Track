import { createBackfillRepository, previewImportPlan, validateImportPlan } from './backfill-repository.js';

const TRUTH_AUGMENTATION_REPOSITORY_VERSION = 'ai23-truth-augmentation-repository/v1';
const JMA_IDENTITY_TYPE = 'jma-rsmc-number';

const SNAPSHOT_COLUMNS = Object.freeze([
  'snapshot_id', 'storm_key', 'as_of', 'provenance_type', 'provenance_source',
  'provenance_source_url', 'archive_id', 'original_issued_at', 'archive_captured_at',
  'payload_hash', 'eligible_for_walkforward', 'rejection_reason', 'snapshot_json',
  'impact_json', 'signal_inputs_json', 'source_availability_json', 'fingerprint'
]);
const TRUTH_DATASET_COLUMNS = Object.freeze([
  'dataset_id', 'storm_key', 'source', 'source_url', 'source_version', 'retrieved_at', 'fingerprint'
]);
const TRUTH_POINT_COLUMNS = Object.freeze([
  'point_id', 'dataset_id', 'valid_time', 'lat', 'lon', 'maximum_wind_json',
  'pressure_json', 'intensity', 'source_point_id', 'fingerprint'
]);

function httpError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function text(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw httpError(400, 'invalid-truth-augmentation-request', `${label} is required`);
  return normalized;
}

function sameValue(left, right) {
  return (left ?? null) === (right ?? null);
}

function sameColumns(existing, planned, columns) {
  return columns.every(column => sameValue(existing?.[column], planned?.[column]));
}

function valuesOf(row) {
  return row?.values ?? row;
}

function normalizeRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw httpError(400, 'invalid-truth-augmentation-request', 'truth augmentation request object is required');
  }
  const stormKey = text(input.stormKey, 'stormKey');
  const internationalNumber = text(input.internationalNumber, 'internationalNumber');
  if (!/^\d{4}$/.test(internationalNumber)) {
    throw httpError(400, 'invalid-truth-augmentation-request', 'internationalNumber must be a four-digit JMA number');
  }
  const identityBindingFingerprint = text(input.identityBindingFingerprint, 'identityBindingFingerprint');
  if (!/^[0-9a-f]{64}$/i.test(identityBindingFingerprint)) {
    throw httpError(400, 'invalid-truth-augmentation-request', 'identityBindingFingerprint must be a SHA-256 hex value');
  }
  const plan = validateImportPlan(input.plan);
  const historicalRows = plan.rows.filter(row => row.table === 'historical_storms');
  const truthDatasets = plan.rows.filter(row => row.table === 'truth_datasets');
  const truthPoints = plan.rows.filter(row => row.table === 'truth_points');
  const snapshots = plan.rows.filter(row => row.table === 'forecast_snapshots');
  const signalOutcomes = plan.rows.filter(row => row.table === 'signal_outcomes');

  if (historicalRows.length !== 1 || historicalRows[0].values.storm_key !== stormKey) {
    throw httpError(400, 'invalid-truth-augmentation-plan', 'plan must contain exactly one matching historical storm');
  }
  if (truthDatasets.length !== 1 || truthDatasets[0].values.storm_key !== stormKey) {
    throw httpError(400, 'invalid-truth-augmentation-plan', 'plan must contain exactly one matching truth dataset');
  }
  if (truthDatasets[0].values.source !== 'JMA RSMC Tokyo Best Track') {
    throw httpError(400, 'invalid-truth-augmentation-plan', 'truth source must be JMA RSMC Tokyo Best Track');
  }
  if (!truthPoints.length || truthPoints.some(row => row.values.dataset_id !== truthDatasets[0].values.dataset_id)) {
    throw httpError(400, 'invalid-truth-augmentation-plan', 'truth points must belong to the single truth dataset');
  }
  if (!snapshots.length || snapshots.some(row => row.values.storm_key !== stormKey)) {
    throw httpError(400, 'invalid-truth-augmentation-plan', 'plan must carry at least one matching persisted forecast snapshot');
  }
  if (signalOutcomes.length) {
    throw httpError(400, 'invalid-truth-augmentation-plan', 'truth augmentation must not create signal outcomes');
  }
  const historical = historicalRows[0].values;
  if (!['full-walk-forward', 'partial-walk-forward'].includes(historical.backfill_mode) || Number(historical.agency_skill_eligible) !== 1) {
    throw httpError(400, 'invalid-truth-augmentation-plan', 'truth augmentation must make at least one forecast case verification-eligible');
  }

  return {
    stormKey,
    internationalNumber,
    identityBindingFingerprint,
    rawPlan: input.plan,
    plan,
    historical,
    truthDataset: truthDatasets[0].values,
    truthPoints: truthPoints.map(valuesOf),
    snapshots: snapshots.map(valuesOf)
  };
}

async function allRows(statement) {
  const result = await statement.all();
  return Array.isArray(result?.results) ? result.results : [];
}

export function createTruthAugmentationRepository(db, dependencies = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') {
    throw new Error('ANALYSIS_DB D1 binding is required');
  }
  const backfillFactory = dependencies.createBackfillRepository || createBackfillRepository;

  async function inspect(input) {
    const request = normalizeRequest(input);
    const identityRows = await allRows(db.prepare(`SELECT binding_id, storm_key, identity_type, identity_value,
      review_status, reviewed_at, reviewer, fingerprint
      FROM storm_identity_bindings
      WHERE storm_key = ?1 AND identity_type = ?2 AND identity_value = ?3
        AND review_status = 'reviewed' AND fingerprint = ?4`)
      .bind(request.stormKey, JMA_IDENTITY_TYPE, request.internationalNumber, request.identityBindingFingerprint));
    if (identityRows.length !== 1 || !identityRows[0].reviewed_at || !identityRows[0].reviewer) {
      throw httpError(409, 'reviewed-jma-identity-required', `reviewed ${JMA_IDENTITY_TYPE} binding is required for ${request.stormKey}/${request.internationalNumber}`);
    }

    const existingStorm = await db.prepare(`SELECT storm_key, name_tc, name_en, season, basin, backfill_mode,
      agency_skill_eligible, updated_at FROM historical_storms WHERE storm_key = ?1 LIMIT 1`)
      .bind(request.stormKey).first();
    if (!existingStorm) throw httpError(409, 'historical-storm-missing', `historical storm ${request.stormKey} must already exist`);
    for (const column of ['name_tc', 'name_en', 'season', 'basin']) {
      if (!sameValue(existingStorm[column], request.historical[column])) {
        throw httpError(409, 'historical-storm-metadata-conflict', `truth augmentation would change ${column} for ${request.stormKey}`);
      }
    }

    const existingRunById = await db.prepare('SELECT run_id, fingerprint, status FROM backfill_runs WHERE run_id = ?1 LIMIT 1')
      .bind(request.plan.runId).first();
    const existingRunByFingerprint = await db.prepare('SELECT run_id, fingerprint, status FROM backfill_runs WHERE fingerprint = ?1 LIMIT 1')
      .bind(request.plan.runFingerprint).first();
    if (existingRunById && existingRunById.fingerprint !== request.plan.runFingerprint) {
      throw httpError(409, 'run-id-conflict', `runId ${request.plan.runId} already exists with a different fingerprint`);
    }
    if (existingRunByFingerprint && existingRunByFingerprint.run_id !== request.plan.runId && existingRunByFingerprint.status !== 'completed') {
      throw httpError(409, 'run-fingerprint-conflict', `run fingerprint is owned by unfinished run ${existingRunByFingerprint.run_id}`);
    }

    let exactSnapshots = 0;
    for (const snapshot of request.snapshots) {
      const existing = await db.prepare(`SELECT ${SNAPSHOT_COLUMNS.join(', ')} FROM forecast_snapshots WHERE snapshot_id = ?1 LIMIT 1`)
        .bind(snapshot.snapshot_id).first();
      if (!existing) throw httpError(409, 'forecast-snapshot-missing', `persisted snapshot ${snapshot.snapshot_id} is missing`);
      if (!sameColumns(existing, snapshot, SNAPSHOT_COLUMNS)) {
        throw httpError(409, 'forecast-snapshot-conflict', `persisted snapshot ${snapshot.snapshot_id} differs from the truth augmentation plan`);
      }
      const cutoffConflict = await db.prepare(`SELECT snapshot_id FROM forecast_snapshots
        WHERE storm_key = ?1 AND as_of = ?2 AND snapshot_id <> ?3 LIMIT 1`)
        .bind(snapshot.storm_key, snapshot.as_of, snapshot.snapshot_id).first();
      if (cutoffConflict) {
        throw httpError(409, 'forecast-snapshot-cutoff-conflict', `another snapshot already exists for ${snapshot.storm_key}/${snapshot.as_of}`);
      }
      exactSnapshots += 1;
    }

    const datasetMatches = await allRows(db.prepare(`SELECT ${TRUTH_DATASET_COLUMNS.join(', ')} FROM truth_datasets
      WHERE dataset_id = ?1 OR fingerprint = ?2`)
      .bind(request.truthDataset.dataset_id, request.truthDataset.fingerprint));
    let truthDatasetDisposition = 'appended';
    if (datasetMatches.length) {
      if (datasetMatches.length !== 1 || !sameColumns(datasetMatches[0], request.truthDataset, TRUTH_DATASET_COLUMNS)) {
        throw httpError(409, 'truth-dataset-conflict', `truth dataset ${request.truthDataset.dataset_id} conflicts with persisted evidence`);
      }
      truthDatasetDisposition = 'existing';
    }

    let truthPointsExisting = 0;
    let truthPointsAppended = 0;
    for (const point of request.truthPoints) {
      const matches = await allRows(db.prepare(`SELECT ${TRUTH_POINT_COLUMNS.join(', ')} FROM truth_points
        WHERE point_id = ?1 OR (dataset_id = ?2 AND valid_time = ?3 AND lat = ?4 AND lon = ?5)`)
        .bind(point.point_id, point.dataset_id, point.valid_time, point.lat, point.lon));
      if (!matches.length) {
        truthPointsAppended += 1;
      } else if (matches.length === 1 && sameColumns(matches[0], point, TRUTH_POINT_COLUMNS)) {
        truthPointsExisting += 1;
      } else {
        throw httpError(409, 'truth-point-conflict', `truth point ${point.point_id} conflicts with persisted evidence`);
      }
    }

    const completedExactRun = existingRunById?.status === 'completed' && existingRunById.fingerprint === request.plan.runFingerprint;
    const historicalAlreadyUpgraded = existingStorm.backfill_mode === request.historical.backfill_mode
      && Number(existingStorm.agency_skill_eligible) === Number(request.historical.agency_skill_eligible);
    if (completedExactRun && (truthDatasetDisposition !== 'existing' || truthPointsAppended > 0 || !historicalAlreadyUpgraded)) {
      throw httpError(409, 'completed-truth-run-incomplete', `completed run ${request.plan.runId} does not match persisted truth state`);
    }

    return {
      request,
      preview: previewImportPlan(request.rawPlan),
      classification: {
        status: completedExactRun ? 'already-imported' : 'ready',
        exactSnapshotCount: exactSnapshots,
        truthDatasetDisposition,
        truthPointsExisting,
        truthPointsAppended,
        reviewedIdentityBindingId: identityRows[0].binding_id,
        existingRunStatus: existingRunById?.status ?? null
      }
    };
  }

  return Object.freeze({
    async preview(input) {
      const inspected = await inspect(input);
      return {
        ok: true,
        dryRun: true,
        writesPerformed: false,
        repositoryVersion: TRUTH_AUGMENTATION_REPOSITORY_VERSION,
        stormKey: inspected.request.stormKey,
        internationalNumber: inspected.request.internationalNumber,
        runId: inspected.request.plan.runId,
        ...inspected.classification
      };
    },

    async import(input) {
      const before = await inspect(input);
      const repository = backfillFactory(db);
      const importResult = await repository.importPlan(before.request.rawPlan);
      const after = await inspect(input);
      if (after.classification.truthDatasetDisposition !== 'existing' || after.classification.truthPointsAppended !== 0) {
        throw httpError(500, 'truth-augmentation-postcondition-failed', 'truth augmentation import did not persist the complete reviewed truth dataset');
      }
      return {
        ok: true,
        status: importResult.status,
        writesPerformed: importResult.writesPerformed,
        repositoryVersion: TRUTH_AUGMENTATION_REPOSITORY_VERSION,
        stormKey: before.request.stormKey,
        internationalNumber: before.request.internationalNumber,
        runId: before.request.plan.runId,
        exactSnapshotCount: after.classification.exactSnapshotCount,
        truthDatasetDisposition: after.classification.truthDatasetDisposition,
        truthPointsExisting: after.classification.truthPointsExisting,
        truthPointsAppended: after.classification.truthPointsAppended
      };
    }
  });
}

export {
  JMA_IDENTITY_TYPE,
  TRUTH_AUGMENTATION_REPOSITORY_VERSION
};
