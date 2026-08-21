import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { previewImportPlan } from '../src/backfill-repository.js';

const require = createRequire(import.meta.url);
const importer = require('../../../analysis/historical-backfill-importer.js');
const verification = require('../../../analysis/forecast-verification-engine.js');

export const AI23_VERIFICATION_BUILDER_VERSION = 'ai23-generic-verification-builder/v1';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(value, label) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); }
  catch (error) { throw new Error(`invalid ${label}: ${error.message}`); }
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

function buildTruth(plan, stormKey) {
  const datasets = plan.rows.filter(row => row.table === 'truth_datasets' && row.values.storm_key === stormKey);
  assert(datasets.length === 1, `verification requires exactly one truth dataset for ${stormKey}, got ${datasets.length}`);
  const dataset = datasets[0].values;
  const points = plan.rows.filter(row => row.table === 'truth_points' && row.values.dataset_id === dataset.dataset_id)
    .slice()
    .sort((a, b) => String(a.values.valid_time).localeCompare(String(b.values.valid_time)));
  assert(points.length > 0, `verification requires truth points for ${stormKey}`);
  return {
    source: dataset.source,
    datasetId: dataset.dataset_id,
    track: points.map(row => ({
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

function normalizeSnapshot(row) {
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

export function buildGenericVerificationRows(plan, options = {}) {
  const planPreview = previewImportPlan(plan);
  const verifiedAt = options.verifiedAt ? new Date(options.verifiedAt).toISOString() : null;
  assert(verifiedAt, 'verifiedAt is required for deterministic verification');
  assert(planPreview.tableCounts.truth_datasets >= 1, 'verification requires finalized truth datasets');

  const historicalRows = plan.rows.filter(row => row.table === 'historical_storms');
  assert(historicalRows.length >= 1, 'verification requires at least one historical storm');
  const results = [];

  for (const historicalRow of historicalRows) {
    const historical = historicalRow.values;
    const stormKey = historical.storm_key;
    if (!['full-walk-forward', 'partial-walk-forward'].includes(historical.backfill_mode)) continue;
    if (Number(historical.agency_skill_eligible) !== 1) continue;
    const truth = buildTruth(plan, stormKey);
    const snapshotRows = plan.rows.filter(row => row.table === 'forecast_snapshots'
      && row.values.storm_key === stormKey
      && Number(row.values.eligible_for_walkforward) === 1)
      .slice()
      .sort((a, b) => String(a.values.as_of).localeCompare(String(b.values.as_of)) || String(a.primaryKey).localeCompare(String(b.primaryKey)));
    assert(snapshotRows.length > 0, `verification requires at least one eligible snapshot for ${stormKey}`);

    for (const row of snapshotRows) {
      const snapshot = normalizeSnapshot(row);
      const impact = parseJson(row.values.impact_json, `${row.primaryKey}.impact_json`);
      const signalInputs = parseJson(row.values.signal_inputs_json, `${row.primaryKey}.signal_inputs_json`);
      const result = verification.buildForecastVerification({ snapshot, impact, signalInputs, truth, verifiedAt });
      const fingerprint = sha256({
        builderVersion: AI23_VERIFICATION_BUILDER_VERSION,
        snapshotId: row.values.snapshot_id,
        truthDatasetId: truth.datasetId,
        verificationVersion: result.schemaVersion,
        result
      });
      const verificationId = `verify_${fingerprint.slice(0, 24)}`;
      results.push({
        stormKey,
        snapshotId: row.values.snapshot_id,
        asOf: row.values.as_of,
        truthDatasetId: truth.datasetId,
        verificationId,
        fingerprint,
        result,
        proposedRow: {
          table: 'verification_results',
          primaryKey: verificationId,
          values: {
            verification_id: verificationId,
            storm_key: stormKey,
            snapshot_id: row.values.snapshot_id,
            truth_dataset_id: truth.datasetId,
            verification_version: result.schemaVersion,
            verified_at: verifiedAt,
            result_json: JSON.stringify(result),
            calibration_record_json: JSON.stringify(result.calibrationRecord),
            fingerprint
          }
        }
      });
    }
  }

  assert(results.length > 0, 'generic verification produced no eligible snapshot results');
  const verifiedAgencyCases = results.flatMap(item => Object.values(item.result.agencies || {})).filter(item => item?.state === 'verified');
  const verifiedPoints = verifiedAgencyCases.flatMap(item => item.points || []);
  assert(verifiedPoints.length > 0, 'generic verification produced no forecast/truth overlap');
  const previewFingerprint = sha256(results.map(item => ({ verificationId: item.verificationId, fingerprint: item.fingerprint })));

  return {
    ok: true,
    schemaVersion: AI23_VERIFICATION_BUILDER_VERSION,
    verifiedAt,
    stormCount: new Set(results.map(item => item.stormKey)).size,
    snapshotCount: results.length,
    verifiedAgencyCaseCount: verifiedAgencyCases.length,
    verifiedPointCount: verifiedPoints.length,
    previewFingerprint,
    results,
    proposedVerificationRows: results.map(item => item.proposedRow),
    semantics: {
      deterministic: true,
      fixedStormKeyRequired: false,
      fixedSnapshotCountRequired: false,
      eligibleSnapshotsOnly: true,
      finalizedTruthRequiredByAugmentationPlan: true,
      verificationRowsWritten: false,
      forecastSnapshotsMutated: false,
      trainingPerformed: false,
      promotionPerformed: false,
      productionDatabaseWritten: false
    }
  };
}
