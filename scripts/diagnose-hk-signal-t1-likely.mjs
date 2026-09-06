import fs from 'node:fs';
import path from 'node:path';

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
    const signal = obs?.analysis?.basicForecast?.signals?.T1;
    if (signal?.likelihood !== 'likely') continue;
    const strongest = signal?.strongestCheckpoint || {};
    const total = Math.max(0, finite(strongest.totalAgencyCount) ?? 0);
    const support = Math.max(0, finite(strongest.supportAgencyCount) ?? 0);
    const generatedAt = obs?.analysis?.generatedAt || obs?.analysis?.basicForecast?.generatedAt || record.capturedAt;
    const threat = obs?.analysis?.threatAssessment || {};
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
      forecastMinimumLeadHours: finite(threat?.summary?.forecastMinimumLeadHours)
    };
    if (!cases.has(id.caseId)) cases.set(id.caseId, { caseId:id.caseId, displayName:obs?.group?.displayName || groupKey, rows:[] });
    cases.get(id.caseId).rows.push(row);
  }
}

const report = {
  schemaVersion: 'hk-signal-t1-likely-diagnostic/v1',
  recordCount: records.length,
  cases: [...cases.values()].map(item => {
    const fields = ['risk','confidence','persistenceHours','strongestLeadHours','supportFraction','supportAgencyCount','checkpointAgencyCount','directApproach','directDepart','reApproach','currentDistanceKm','forecastMinimumKm','forecastMinimumLeadHours'];
    return {
      caseId: item.caseId,
      displayName: item.displayName,
      likelyCount: item.rows.length,
      firstLikelyAt: item.rows[0]?.capturedAt || null,
      lastLikelyAt: item.rows.at(-1)?.capturedAt || null,
      stats: Object.fromEntries(fields.map(field => [field, stats(item.rows.map(row => row[field]))])),
      rows: item.rows
    };
  }).sort((a,b) => a.caseId.localeCompare(b.caseId))
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);