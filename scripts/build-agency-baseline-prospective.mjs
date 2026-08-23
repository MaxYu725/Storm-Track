import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const BASELINE_VERSION = 'storm-agency-baseline-prospective/v1';
const CAPTURE_VERSION = 'storm-agency-baseline-capture/v0';
const DEFAULT_URL = 'https://maxyu725.github.io/Storm-Track/?beta=hk-signal';

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function stringOrNull(value) {
  const text = clean(value);
  return text || null;
}

function finiteOrNull(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseTime(value) {
  const ms = Date.parse(clean(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function normalizePoint(point, origin) {
  if (!point || typeof point !== 'object') return null;
  const lat = finiteOrNull(point.lat);
  const lon = finiteOrNull(point.lon);
  const validTime = parseTime(point.time);
  if (lat == null || lon == null || !validTime) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return {
    origin,
    kind: stringOrNull(point.kind) || origin,
    validTime,
    baseTime: parseTime(point.baseTime),
    forecastHour: finiteOrNull(point.forecastHour),
    lat,
    lon
  };
}

function timedSort(left, right) {
  return Date.parse(left.validTime) - Date.parse(right.validTime)
    || left.lat - right.lat
    || left.lon - right.lon;
}

function dedupePoints(points) {
  const seen = new Set();
  const result = [];
  for (const point of points.slice().sort(timedSort)) {
    const key = JSON.stringify([point.validTime, point.baseTime, point.forecastHour, point.lat, point.lon]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(point);
  }
  return result;
}

function latestAnalysisPoint(source) {
  const points = (Array.isArray(source?.positions) ? source.positions : [])
    .map(point => normalizePoint(point, 'analysis'))
    .filter(Boolean)
    .sort(timedSort);
  return points.at(-1) || null;
}

function forecastPoints(source) {
  return dedupePoints((Array.isArray(source?.forecast) ? source.forecast : [])
    .map(point => normalizePoint(point, 'forecast'))
    .filter(Boolean));
}

function sourceToken(agency, sourceId) {
  const code = clean(agency).toUpperCase();
  const id = clean(sourceId);
  return code && id ? `${code}:${id}` : null;
}

function loadRegistry(registryPath) {
  if (!registryPath) return null;
  try {
    const value = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    return value?.schemaVersion === 'storm-case-identity/v1' && Array.isArray(value?.cases) ? value : null;
  } catch {
    return null;
  }
}

function resolveCase(registry, agency, sourceId) {
  const token = sourceToken(agency, sourceId);
  if (!registry || !token) return { caseId: null, state: registry ? 'missing-source-token' : 'registry-unavailable' };
  const candidates = registry.cases.filter(item => Array.isArray(item?.sourceTokens) && item.sourceTokens.includes(token));
  if (candidates.length === 1) return { caseId: candidates[0].caseId ?? null, state: 'resolved-source-token' };
  if (candidates.length > 1) return { caseId: null, state: 'ambiguous-source-token' };
  return { caseId: null, state: 'unresolved-source-token' };
}

function firstNonNull(values) {
  return values.find(value => value != null) ?? null;
}

function buildBaseline(group, agency, source, registry) {
  const normalizedAgency = clean(agency).toUpperCase();
  const sourceId = stringOrNull(source?.sourceId);
  const bulletinTime = parseTime(source?.bulletinTime);
  const analysis = latestAnalysisPoint(source);
  const forecast = forecastPoints(source);
  const forecastBaseTime = firstNonNull(forecast.map(point => point.baseTime));
  const identity = resolveCase(registry, normalizedAgency, sourceId);
  const evidence = {
    groupKey: stringOrNull(group?.key),
    agency: normalizedAgency || null,
    sourceId,
    bulletinTime,
    analysis,
    forecastBaseTime,
    forecast
  };
  return {
    caseIdAtCapture: identity.caseId,
    caseIdentityStateAtCapture: identity.state,
    groupKey: stringOrNull(group?.key),
    displayName: stringOrNull(group?.displayName),
    nameTc: stringOrNull(group?.nameTc),
    nameEn: stringOrNull(group?.nameEn),
    agency: normalizedAgency || null,
    sourceId,
    sourceToken: sourceToken(normalizedAgency, sourceId),
    bulletinTime,
    analysis,
    forecastBaseTime,
    forecastFirstValidTime: forecast[0]?.validTime ?? null,
    forecastLastValidTime: forecast.at(-1)?.validTime ?? null,
    forecastPointCount: forecast.length,
    cycleFingerprint: sha256(evidence),
    forecast
  };
}

export function buildAgencyBaselineProspective(raw, options = {}) {
  if (raw?.schemaVersion !== CAPTURE_VERSION) {
    throw new Error(`Expected ${CAPTURE_VERSION} input`);
  }
  const registry = options.registry || null;
  const records = [];
  for (const group of Array.isArray(raw?.groups) ? raw.groups : []) {
    for (const [agency, source] of Object.entries(group?.sources || {}).sort(([a], [b]) => a.localeCompare(b))) {
      records.push(buildBaseline(group, agency, source, registry));
    }
  }
  records.sort((left, right) => String(left.groupKey || '').localeCompare(String(right.groupKey || ''))
    || String(left.agency || '').localeCompare(String(right.agency || ''))
    || String(left.sourceId || '').localeCompare(String(right.sourceId || '')));

  const fingerprintSource = records.map(record => ({
    groupKey: record.groupKey,
    agency: record.agency,
    sourceId: record.sourceId,
    cycleFingerprint: record.cycleFingerprint
  }));

  return {
    schemaVersion: BASELINE_VERSION,
    capturedAt: parseTime(raw?.capturedAt) || new Date().toISOString(),
    targetUrl: options.targetUrl || DEFAULT_URL,
    sourceCommit: options.sourceCommit || null,
    captureFingerprint: sha256(fingerprintSource),
    pageTitle: stringOrNull(raw?.pageTitle),
    sourceStates: (Array.isArray(raw?.sourceStates) ? raw.sourceStates : [])
      .map(item => ({ agency: clean(item?.agency).toUpperCase(), state: clean(item?.state) || 'unknown' }))
      .filter(item => item.agency)
      .sort((a, b) => a.agency.localeCompare(b.agency)),
    visibleGroupKeys: [...new Set((Array.isArray(raw?.visibleGroupKeys) ? raw.visibleGroupKeys : []).map(clean).filter(Boolean))].sort(),
    caseRegistry: registry ? {
      schemaVersion: registry.schemaVersion ?? null,
      identityAdapterVersion: registry.identityAdapterVersion ?? null,
      reconciledThrough: registry.reconciledThrough ?? null
    } : null,
    recordCount: records.length,
    records,
    semantics: {
      evidencePurpose: 'future-homogeneous-track-verification',
      asIssuedAgencyCoordinatesPersisted: true,
      latestAnalysisPointPersisted: true,
      forecastPointsPersisted: true,
      historicalAnalysisTrackPersisted: false,
      verificationTruthPersisted: false,
      forecastSkillEvaluated: false,
      agencyRankingProduced: false,
      consensusAlgorithmModified: false,
      hkSignalModified: false,
      productionDatabaseWritten: false,
      caseIdentityDerivedFromConsensusRegistry: true,
      immutableEvidenceIntended: true
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const inputPath = process.argv[2];
  const registryPath = process.argv[3] || null;
  if (!inputPath) throw new Error('Usage: node scripts/build-agency-baseline-prospective.mjs <capture.json> [case-registry.json]');
  const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const registry = loadRegistry(registryPath);
  const output = buildAgencyBaselineProspective(raw, {
    registry,
    sourceCommit: process.env.SOURCE_COMMIT || null,
    targetUrl: process.env.STORM_BETA_URL || DEFAULT_URL
  });
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
