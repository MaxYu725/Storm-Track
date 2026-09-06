import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const v2engine = require('../analysis/hk-signal-forecast-v2.js');

const root = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!root) throw new Error('usage: node scripts/diagnose-hk-signal-t1-context.mjs <beta-prospective-corpus-dir>');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function readNdjson(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(JSON.parse);
}
function listJsonFiles(dir) {
  const out = [];
  const stack = fs.existsSync(dir) ? [dir] : [];
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
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function key(fingerprint, groupKey) { return `${fingerprint || ''}\u0000${groupKey || ''}`; }
function quantile(values, q) {
  const numeric = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!numeric.length) return null;
  if (numeric.length === 1) return numeric[0];
  const p = (numeric.length - 1) * q;
  const lo = Math.floor(p);
  const hi = Math.ceil(p);
  const fraction = p - lo;
  return numeric[lo] * (1 - fraction) + numeric[hi] * fraction;
}
function stats(values) {
  const numeric = values.filter(Number.isFinite);
  return {
    count: numeric.length,
    min: numeric.length ? Math.min(...numeric) : null,
    q25: quantile(numeric, 0.25),
    median: quantile(numeric, 0.5),
    q75: quantile(numeric, 0.75),
    max: numeric.length ? Math.max(...numeric) : null
  };
}
function currentIntensities(sources) {
  const out = {};
  for (const [agency, source] of Object.entries(sources || {})) {
    const positions = Array.isArray(source?.positions) ? source.positions : [];
    const current = positions.at(-1) || source?.current || null;
    if (current?.intensity != null && String(current.intensity).trim()) out[agency] = String(current.intensity);
  }
  return out;
}

const identityRows = readNdjson(path.join(root, 'case-index.ndjson'));
const identity = new Map(identityRows.map(row => [key(row.captureFingerprint, row.rawGroupKey), row]));
const records = listJsonFiles(path.join(root, 'observations')).map(readJson)
  .filter(record => record?.schemaVersion === 'beta-prospective-recorder/v2')
  .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
const cases = new Map();

for (const record of records) {
  for (const observation of record.observations || []) {
    const groupKey = observation?.group?.key || null;
    const resolved = identity.get(key(record.captureFingerprint, groupKey));
    if (!resolved?.caseId) continue;
    const analysis = observation?.analysis || {};
    const t1 = analysis?.basicForecast?.signals?.T1;
    if (t1?.likelihood !== 'likely') continue;

    const feature = analysis?.signalInputs?.featureVector || {};
    const threat = analysis?.threatAssessment || {};
    const lifecycle = v2engine.buildSourceLifecycleContext(
      observation?.sources || {},
      observation?.observedAt || record.capturedAt,
      { sourcesDirect: true }
    );
    const v2 = v2engine.buildForecast({
      basicForecast: analysis.basicForecast,
      signalInputs: analysis.signalInputs,
      threatAssessment: threat,
      generatedAt: analysis?.generatedAt || analysis?.basicForecast?.generatedAt || record.capturedAt,
      sourceLifecycle: lifecycle
    });
    const v2t1 = v2?.signals?.T1 || {};
    const readiness = v2t1?.shadowDiagnostics?.decisionReadiness || {};

    const row = {
      capturedAt: record.capturedAt,
      v1Risk: finite(t1.riskIndex),
      v1Confidence: finite(t1.confidenceIndex),
      v1PersistenceHours: finite(t1.persistenceHours),
      v2Likelihood: v2t1.likelihood || null,
      v2ReadinessIndex: finite(readiness.index),
      currentDistanceKm: finite(threat?.summary?.currentDistanceKm),
      forecastMinimumKm: finite(threat?.summary?.forecastMinimumKm),
      forecastMinimumLeadHours: finite(threat?.summary?.forecastMinimumLeadHours),
      overallThreatIndex: finite(threat?.summary?.overallThreatIndex),
      threatConfidenceIndex: finite(threat?.summary?.confidenceIndex),
      directApproach: finite(threat?.analyzers?.directApproach?.confidence),
      directDepart: finite(threat?.analyzers?.directDepart?.confidence),
      reApproach: finite(threat?.analyzers?.reApproach?.confidence),
      forecastEdge: finite(threat?.analyzers?.forecastEdge?.confidence),
      agencyDisagreement: finite(threat?.analyzers?.agencyDisagreement?.confidence),
      windFieldConfidence: finite(threat?.analyzers?.windField?.confidence),
      representativeWindMs: finite(threat?.analyzers?.windField?.representativeWindMs),
      rapidEvolution: finite(threat?.analyzers?.rapidEvolution?.confidence),
      usableAgencyCount: finite(feature.usableAgencyCount),
      comparisonSpreadKm: finite(feature.comparisonSpreadKm),
      consensusClosestDistanceKm: finite(feature.consensusClosestDistanceKm),
      consensusClosestLeadHours: finite(feature.consensusClosestLeadHours),
      closestDistanceSpanKm: finite(feature.closestDistanceSpanKm),
      closestTimeSpreadHours: finite(feature.closestTimeSpreadHours),
      derivedMotionSpeedMedianKmh: finite(feature.derivedMotionSpeedMedianKmh),
      currentMaximumWindMedianMs: finite(feature.currentMaximumWindMedianMs),
      closestMaximumWindMedianMs: finite(feature.closestMaximumWindMedianMs),
      intensitySpreadMs: finite(feature.intensitySpreadMs),
      windRadiusAgencyCount: finite(feature.windRadiusAgencyCount),
      latestWindFieldCoverageAgencyCount: finite(feature.latestWindFieldCoverageAgencyCount),
      closestTimeWindFieldCoverageAgencyCount: finite(feature.closestTimeWindFieldCoverageAgencyCount),
      latestStrongWindFieldCoverageAgencyCount: finite(feature.latestStrongWindFieldCoverageAgencyCount),
      closestStrongWindFieldCoverageAgencyCount: finite(feature.closestStrongWindFieldCoverageAgencyCount),
      latestGaleWindFieldCoverageAgencyCount: finite(feature.latestGaleWindFieldCoverageAgencyCount),
      closestGaleWindFieldCoverageAgencyCount: finite(feature.closestGaleWindFieldCoverageAgencyCount),
      sourceAgencyCount: lifecycle.sourceAgencyCount,
      forecastPointTotal: lifecycle.forecastPointTotal,
      currentIntensityByAgency: currentIntensities(observation?.sources)
    };

    if (!cases.has(resolved.caseId)) {
      cases.set(resolved.caseId, {
        caseId: resolved.caseId,
        displayName: observation?.group?.displayName || groupKey,
        rows: []
      });
    }
    cases.get(resolved.caseId).rows.push(row);
  }
}

const numericFields = [
  'v1Risk','v1Confidence','v1PersistenceHours','v2ReadinessIndex',
  'currentDistanceKm','forecastMinimumKm','forecastMinimumLeadHours','overallThreatIndex','threatConfidenceIndex',
  'directApproach','directDepart','reApproach','forecastEdge','agencyDisagreement','windFieldConfidence','representativeWindMs','rapidEvolution',
  'usableAgencyCount','comparisonSpreadKm','consensusClosestDistanceKm','consensusClosestLeadHours','closestDistanceSpanKm','closestTimeSpreadHours',
  'derivedMotionSpeedMedianKmh','currentMaximumWindMedianMs','closestMaximumWindMedianMs','intensitySpreadMs','windRadiusAgencyCount',
  'latestWindFieldCoverageAgencyCount','closestTimeWindFieldCoverageAgencyCount','latestStrongWindFieldCoverageAgencyCount',
  'closestStrongWindFieldCoverageAgencyCount','latestGaleWindFieldCoverageAgencyCount','closestGaleWindFieldCoverageAgencyCount',
  'sourceAgencyCount','forecastPointTotal'
];

const report = {
  schemaVersion: 'hk-signal-t1-context-diagnostic/v1',
  v2Version: v2engine.VERSION,
  recordCount: records.length,
  cases: [...cases.values()].map(item => {
    const v2Likely = item.rows.filter(row => row.v2Likelihood === 'likely');
    const v2Downgraded = item.rows.filter(row => row.v2Likelihood !== 'likely');
    return {
      caseId: item.caseId,
      displayName: item.displayName,
      v1LikelyCount: item.rows.length,
      v2LikelyCount: v2Likely.length,
      v2DowngradedCount: v2Downgraded.length,
      firstV2LikelyAt: v2Likely[0]?.capturedAt || null,
      allLikelyStats: Object.fromEntries(numericFields.map(field => [field, stats(item.rows.map(row => row[field]))])),
      retainedLikelyStats: Object.fromEntries(numericFields.map(field => [field, stats(v2Likely.map(row => row[field]))])),
      downgradedStats: Object.fromEntries(numericFields.map(field => [field, stats(v2Downgraded.map(row => row[field]))])),
      rows: item.rows
    };
  }).sort((left, right) => left.caseId.localeCompare(right.caseId))
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
