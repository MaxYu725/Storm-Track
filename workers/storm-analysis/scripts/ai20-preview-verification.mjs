import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { previewImportPlan } from '../src/backfill-repository.js';

const require = createRequire(import.meta.url);
const importer = require('../../../analysis/historical-backfill-importer.js');
const verification = require('../../../analysis/forecast-verification-engine.js');

export const AI20_VERIFICATION_PREVIEW_VERSION = 'ai20-verification-preview/v1';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(value, label) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`invalid ${label}: ${error.message}`);
  }
}

function sha256(value) {
  const text = typeof value === 'string' ? value : importer.stableStringify(value);
  return crypto.createHash('sha256').update(text).digest('hex');
}

function toEngineMetric(value, kind) {
  if (value == null) return null;
  const parsed = typeof value === 'string' ? parseJson(value, `${kind} JSON`) : value;
  if (parsed == null) return null;
  if (typeof parsed === 'number') return parsed;
  if (typeof parsed !== 'object' || !Number.isFinite(Number(parsed.value))) return null;
  if (kind === 'wind') return parsed.unit ? `${parsed.value} ${parsed.unit}` : Number(parsed.value);
  return Number(parsed.value);
}

function buildTruthFromPlan(plan) {
  const datasets = plan.rows.filter(row => row.table === 'truth_datasets');
  assert(datasets.length === 1, `verification preview requires exactly one truth dataset, got ${datasets.length}`);
  const dataset = datasets[0].values;
  const pointRows = plan.rows.filter(row => row.table === 'truth_points' && row.values.dataset_id === dataset.dataset_id)
    .slice()
    .sort((a, b) => String(a.values.valid_time).localeCompare(String(b.values.valid_time)));
  assert(pointRows.length > 0, 'verification preview requires truth points');
  return {
    source: dataset.source,
    datasetId: dataset.dataset_id,
    track: pointRows.map(row => ({
      time: row.values.valid_time,
      lat: row.values.lat,
      lon: row.values.lon,
      maximumWind: toEngineMetric(row.values.maximum_wind_json, 'wind'),
      pressure: toEngineMetric(row.values.pressure_json, 'pressure'),
      intensity: row.values.intensity,
      sourcePointId: row.values.source_point_id
    }))
  };
}

function normalizeSnapshotForVerification(row) {
  const snapshot = parseJson(row.values.snapshot_json, `${row.primaryKey}.snapshot_json`);
  assert(snapshot && typeof snapshot === 'object', `snapshot ${row.primaryKey} is missing JSON`);
  const clone = structuredClone(snapshot);
  for (const source of Object.values(clone.sources || {})) {
    if (!source || !Array.isArray(source.forecast)) continue;
    source.forecast = source.forecast.map(point => ({
      ...point,
      maximumWind: point.maximumWind ?? point.windSpeed ?? point.windMs ?? null,
      pressure: point.pressure ?? point.pressureHpa ?? null
    }));
  }
  return clone;
}

export function previewVerificationFromAugmentationPlan(plan, options = {}) {
  const planPreview = previewImportPlan(plan);
  const verifiedAt = options.verifiedAt ? new Date(options.verifiedAt).toISOString() : null;
  assert(verifiedAt, 'verifiedAt is required for deterministic verification preview');
  assert(planPreview.tableCounts.historical_storms === 1, 'verification preview requires one historical storm');
  assert(planPreview.tableCounts.truth_datasets === 1, 'verification preview requires one finalized truth dataset');
  assert(planPreview.tableCounts.truth_points > 0, 'verification preview requires finalized truth points');
  assert(planPreview.tableCounts.forecast_snapshots === 4, 'verification preview requires the four AI-19 forecast snapshots');

  const historical = plan.rows.find(row => row.table === 'historical_storms')?.values;
  assert(historical?.backfill_mode === 'full-walk-forward', 'verification preview requires full-walk-forward capability');
  assert(Number(historical?.agency_skill_eligible) === 1, 'verification preview requires agency_skill_eligible=1 in the proposed augmentation plan');

  const truth = buildTruthFromPlan(plan);
  const snapshotRows = plan.rows.filter(row => row.table === 'forecast_snapshots')
    .slice()
    .sort((a, b) => String(a.values.as_of).localeCompare(String(b.values.as_of)) || String(a.primaryKey).localeCompare(String(b.primaryKey)));

  const results = snapshotRows.map(row => {
    const snapshot = normalizeSnapshotForVerification(row);
    const impact = parseJson(row.values.impact_json, `${row.primaryKey}.impact_json`);
    const signalInputs = parseJson(row.values.signal_inputs_json, `${row.primaryKey}.signal_inputs_json`);
    const result = verification.buildForecastVerification({ snapshot, impact, signalInputs, truth, verifiedAt });
    const fingerprint = sha256({
      previewVersion: AI20_VERIFICATION_PREVIEW_VERSION,
      snapshotId: row.values.snapshot_id,
      truthDatasetId: truth.datasetId,
      verificationVersion: result.schemaVersion,
      result
    });
    return {
      snapshotId: row.values.snapshot_id,
      stormKey: row.values.storm_key,
      asOf: row.values.as_of,
      verificationId: `verify_${fingerprint.slice(0, 24)}`,
      fingerprint,
      result,
      proposedRow: {
        table: 'verification_results',
        primaryKey: `verify_${fingerprint.slice(0, 24)}`,
        values: {
          verification_id: `verify_${fingerprint.slice(0, 24)}`,
          storm_key: row.values.storm_key,
          snapshot_id: row.values.snapshot_id,
          truth_dataset_id: truth.datasetId,
          verification_version: result.schemaVersion,
          verified_at: verifiedAt,
          result_json: JSON.stringify(result),
          calibration_record_json: JSON.stringify(result.calibrationRecord),
          fingerprint
        }
      }
    };
  });

  const agencyResults = results.flatMap(item => Object.values(item.result.agencies || {}));
  const verifiedAgencyCases = agencyResults.filter(item => item?.state === 'verified');
  const verifiedPoints = verifiedAgencyCases.flatMap(item => item.points || []);
  const intensityComparablePoints = verifiedPoints.filter(item => Number.isFinite(item?.errors?.intensityMs));
  const pressureComparablePoints = verifiedPoints.filter(item => Number.isFinite(item?.errors?.pressureHpa));
  assert(verifiedPoints.length > 0, 'verification preview produced no forecast/truth overlap');

  const previewFingerprint = sha256(results.map(item => ({
    verificationId: item.verificationId,
    fingerprint: item.fingerprint
  })));
  return {
    ok: true,
    schemaVersion: AI20_VERIFICATION_PREVIEW_VERSION,
    verifiedAt,
    truthDatasetId: truth.datasetId,
    snapshotCount: results.length,
    verifiedAgencyCaseCount: verifiedAgencyCases.length,
    verifiedPointCount: verifiedPoints.length,
    intensityComparablePointCount: intensityComparablePoints.length,
    pressureComparablePointCount: pressureComparablePoints.length,
    previewFingerprint,
    results,
    proposedVerificationRows: results.map(item => item.proposedRow),
    semantics: {
      deterministic: true,
      explicitVerifiedAtRequired: true,
      canonicalFieldAliasesAdapted: true,
      finalizedTruthRequiredByUpstreamPlan: true,
      proposedRowsOnly: true,
      verificationRowsWritten: false,
      forecastSnapshotsMutated: false,
      trainingPerformed: false,
      promotionPerformed: false,
      productionDatabaseWritten: false
    }
  };
}
