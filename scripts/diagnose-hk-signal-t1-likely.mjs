import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const v2engine = require('../analysis/hk-signal-forecast-v2-05.js');

const root = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!root) throw new Error('usage: node scripts/diagnose-hk-signal-t1-likely.mjs <beta-prospective-corpus-dir>');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function readNdjson(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map(x => x.trim()).filter(Boolean).map(JSON.parse);
}
function listJsonFiles(dir) {
  const out = [], stack = fs.existsSync(dir) ? [dir] : [];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith('.json')) out.push(full);
    }
  }
  return out.sort();
}
function finite(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function leadHours(reference, target) {
  const a = Date.parse(reference || ''), b = Date.parse(target || '');
  return Number.isFinite(a) && Number.isFinite(b) ? (b - a) / 3600000 : null;
}
function key(fingerprint, groupKey) { return `${fingerprint || ''}\u0000${groupKey || ''}`; }
function quantile(values, q) {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  if (a.length === 1) return a[0];
  const p = (a.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p), f = p - lo;
  return a[lo] * (1 - f) + a[hi] * f;
}
function stats(values) {
  const a = values.filter(Number.isFinite);
  return { count: a.length, min: a.length ? Math.min(...a) : null, q25: quantile(a,.25), median: quantile(a,.5), q75: quantile(a,.75), max: a.length ? Math.max(...a) : null };
}

const identityRows = readNdjson(path.join(root, 'case-index.ndjson'));
const identity = new Map(identityRows.map(row => [key(row.captureFingerprint, row.rawGroupKey), row]));
const records = listJsonFiles(path.join(root, 'observations')).map(readJson)
  .filter(r => r?.schemaVersion === 'beta-prospective-recorder/v2')
  .sort((a,b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
const cases = new Map();

for (const record of records) {
  for (const obs of record.observations || []) {
    const groupKey = obs?.group?.key || null;
    const id = identity.get(key(record.captureFingerprint, groupKey));
    if (!id?.caseId) continue;
    const analysis = obs?.analysis || {};
    const signal = analysis?.basicForecast?.signals?.T1;
    if (signal?.likelihood !== 'likely') continue;
    const strongest = signal?.strongestCheckpoint || {};
    const total = Math.max(0, finite(strongest.totalAgencyCount) ?? 0);
    const support = Math.max(0, finite(strongest.supportAgencyCount) ?? 0);
    const generatedAt = analysis?.generatedAt || analysis?.basicForecast?.generatedAt || record.capturedAt;
    const threat = analysis?.threatAssessment || {};
    const lifecycle = v2engine.buildSourceLifecycleContext(
      obs?.sources || {},
      obs?.observedAt || record.capturedAt,
      { sourcesDirect: true }
    );
    const v2 = v2engine.buildForecast({
      basicForecast: analysis.basicForecast,
      signalInputs: analysis.signalInputs,
      threatAssessment: threat,
      generatedAt,
      sourceLifecycle: lifecycle
    });
    const v2Signal = v2?.signals?.T1 || null;
    const readiness = v2Signal?.shadowDiagnostics?.decisionReadiness || null;
    const phase = v2Signal?.shadowDiagnostics?.phaseContext || null;
    const row = {
      capturedAt: record.capturedAt,
      risk: finite(signal.riskIndex),
      confidence: finite(signal.confidenceIndex),
      persistenceHours: finite(signal.persistenceHours),
      strongestLeadHours: leadHours(generatedAt, strongest.validTime),
      supportFraction: total > 0 ? support / total : null,
      supportAgencyCount: support,
      checkpointAgencyCount: total,
      directApproach: finite(threat?.analyzers?.directApproach?.confidence),
      directDepart: finite(threat?.analyzers?.directDepart?.confidence),
      reApproach: finite(threat?.analyzers?.reApproach?.confidence),
      currentDistanceKm: finite(threat?.summary?.currentDistanceKm),
      forecastMinimumKm: finite(threat?.summary?.forecastMinimumKm),
      forecastMinimumLeadHours: finite(threat?.summary?.forecastMinimumLeadHours),
      v2Likelihood: v2Signal?.likelihood || null,
      v2Risk: finite(v2Signal?.riskIndex),
      v2ReadinessIndex: finite(readiness?.index),
      v2PrePersistenceReadinessIndex: finite(readiness?.prePersistenceIndex),
      v2ReadinessFactor: finite(readiness?.factor),
      v2PersistenceFactor: finite(readiness?.persistenceFactor),
      v2PersistenceCredibility: finite(readiness?.persistenceCredibility),
      v2GeometryMaturity: finite(readiness?.geometryMaturity),
      v2GeometryFactor: finite(readiness?.geometryFactor),
      v2CurrentProximity: finite(readiness?.currentProximity),
      v2MinimumProximity: finite(readiness?.minimumProximity),
      v2PhaseFactor: finite(readiness?.phaseFactor),
      v2OperationalPhase: phase?.operationalPhase || null,
      v2MultiPhase: phase?.multiPhase === true
    };
    if (!cases.has(id.caseId)) cases.set(id.caseId, { caseId:id.caseId, displayName:obs?.group?.displayName || groupKey, rows:[] });
    cases.get(id.caseId).rows.push(row);
  }
}

const report = {
  schemaVersion: 'hk-signal-t1-likely-diagnostic/v3',
  v2Version: v2engine.VERSION,
  recordCount: records.length,
  cases: [...cases.values()].map(item => {
    const fields = ['risk','confidence','persistenceHours','strongestLeadHours','supportFraction','supportAgencyCount','checkpointAgencyCount','directApproach','directDepart','reApproach','currentDistanceKm','forecastMinimumKm','forecastMinimumLeadHours','v2Risk','v2ReadinessIndex','v2PrePersistenceReadinessIndex','v2ReadinessFactor','v2PersistenceFactor','v2PersistenceCredibility','v2GeometryMaturity','v2GeometryFactor','v2CurrentProximity','v2MinimumProximity','v2PhaseFactor'];
    const v2LikelyRows = item.rows.filter(row => row.v2Likelihood === 'likely');
    const v2PossibleRows = item.rows.filter(row => row.v2Likelihood === 'possible');
    const v2UnlikelyRows = item.rows.filter(row => row.v2Likelihood === 'unlikely');
    return {
      caseId: item.caseId,
      displayName: item.displayName,
      likelyCount: item.rows.length,
      firstLikelyAt: item.rows[0]?.capturedAt || null,
      lastLikelyAt: item.rows.at(-1)?.capturedAt || null,
      v2: {
        likelyCount: v2LikelyRows.length,
        possibleCount: v2PossibleRows.length,
        unlikelyCount: v2UnlikelyRows.length,
        firstLikelyAt: v2LikelyRows[0]?.capturedAt || null,
        lastLikelyAt: v2LikelyRows.at(-1)?.capturedAt || null,
        likelyReadiness: stats(v2LikelyRows.map(row => row.v2ReadinessIndex)),
        downgradedReadiness: stats(v2PossibleRows.map(row => row.v2ReadinessIndex)),
        likelyPersistenceHours: stats(v2LikelyRows.map(row => row.persistenceHours)),
        downgradedPersistenceHours: stats(v2PossibleRows.map(row => row.persistenceHours)),
        likelyCurrentDistanceKm: stats(v2LikelyRows.map(row => row.currentDistanceKm)),
        likelyForecastMinimumKm: stats(v2LikelyRows.map(row => row.forecastMinimumKm))
      },
      stats: Object.fromEntries(fields.map(field => [field, stats(item.rows.map(row => row[field]))])),
      rows: item.rows
    };
  }).sort((a,b) => a.caseId.localeCompare(b.caseId))
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);