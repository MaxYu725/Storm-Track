import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ADAPTER_VERSION = 'cma-historical-adapter/v1';
const NMC_ORIGIN = 'https://typhoon.nmc.cn';
const DEFAULT_PROXY_ORIGIN = 'https://storm.max-yu.workers.dev';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeName(value) {
  return clean(value).toUpperCase().replace(/[\s_()（）\-–—./]+/g, '');
}

function parseTimeMs(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : null;
}

export function normalizeNmcTime(value) {
  const raw = clean(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    if (/Z$|[+-]\d{2}:?\d{2}$/.test(raw)) return raw;
    return `${raw.replace(' ', 'T')}Z`;
  }
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 12) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:00Z`;
  }
  return raw;
}

function addHoursToNmcBaseTime(baseValue, hoursValue) {
  const baseTime = normalizeNmcTime(baseValue);
  const hours = Number(hoursValue);
  const baseMs = parseTimeMs(baseTime);
  if (!Number.isFinite(baseMs) || !Number.isFinite(hours)) return null;
  return new Date(baseMs + hours * 3600000).toISOString();
}

export function parseNmcJson(text) {
  const raw = String(text || '').trim();
  const objectStart = raw.indexOf('{');
  const objectEnd = raw.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) return JSON.parse(raw.slice(objectStart, objectEnd + 1));
  const arrayStart = raw.indexOf('[');
  const arrayEnd = raw.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) return JSON.parse(raw.slice(arrayStart, arrayEnd + 1));
  throw new Error('NMC JSON/JSONP response has no JSON payload');
}

function parseNmcWindRadii(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    if (!Array.isArray(item)) return null;
    return {
      level: clean(item[0]),
      ne: Number(item[1]) || 0,
      se: Number(item[2]) || 0,
      sw: Number(item[3]) || 0,
      nw: Number(item[4]) || 0
    };
  }).filter(Boolean);
}

export function parseNmcHistoryPoint(point) {
  if (!Array.isArray(point)) return null;
  const lon = Number.parseFloat(point[4]);
  const lat = Number.parseFloat(point[5]);
  const time = normalizeNmcTime(point[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(parseTimeMs(time))) return null;
  return {
    kind: 'past',
    lat,
    lon,
    time,
    pressure: point[6] ?? null,
    maximumWind: point[7] ?? null,
    intensity: point[3] ?? null,
    windRadii: parseNmcWindRadii(point[10]),
    interpolated: false
  };
}

export function parseNmcForecastPoint(point) {
  if (!Array.isArray(point)) return null;
  const forecastHour = Number(point[0]);
  const lon = Number.parseFloat(point[2]);
  const lat = Number.parseFloat(point[3]);
  const baseTime = normalizeNmcTime(point[1]);
  const time = addHoursToNmcBaseTime(point[1], point[0]);
  if (!Number.isFinite(forecastHour) || forecastHour <= 0 || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!Number.isFinite(parseTimeMs(baseTime)) || !Number.isFinite(parseTimeMs(time))) return null;
  return {
    kind: 'forecast',
    forecastHour,
    lat,
    lon,
    time,
    baseTime,
    pressure: point[4] ?? null,
    maximumWind: point[5] ?? null,
    intensity: point[7] ?? null,
    interpolated: false
  };
}

function dedupePoints(points) {
  const byKey = new Map();
  for (const point of points.filter(Boolean)) {
    const key = `${point.time}|${point.lat}|${point.lon}|${point.kind}`;
    if (!byKey.has(key)) byKey.set(key, point);
  }
  return Array.from(byKey.values()).sort((a, b) => parseTimeMs(a.time) - parseTimeMs(b.time));
}

function findBabjForecast(rawPoint) {
  const container = rawPoint?.[11];
  if (!container || typeof container !== 'object' || Array.isArray(container)) return [];
  const key = Object.keys(container).find(item => item.toUpperCase() === 'BABJ');
  return key && Array.isArray(container[key]) ? container[key] : [];
}

export function validateHistoricalCaseManifest(manifest) {
  assert(manifest?.schemaVersion === 'historical-replay-case/v1', 'unsupported historical case schema');
  assert(clean(manifest.caseId), 'caseId is required');
  assert(manifest.retrospective === true, `${manifest.caseId}: retrospective must be true`);
  assert(manifest.truth?.authority === 'HKO' && manifest.truth?.role === 'verification-only', `${manifest.caseId}: HKO truth must be verification-only`);
  assert(Array.isArray(manifest.truth?.signalLifecycle) && manifest.truth.signalLifecycle.length > 0, `${manifest.caseId}: truth signal lifecycle is required`);
  assert(manifest.safety?.truthMayNotBeUsedAsForecastInput === true, `${manifest.caseId}: truth/input separation guard missing`);
  assert(manifest.safety?.futureAdvisoryLeakageForbidden === true, `${manifest.caseId}: leakage guard missing`);
  assert(manifest.safety?.missingAgencyMayNotBeSubstituted === true, `${manifest.caseId}: agency independence guard missing`);
  assert(manifest.safety?.currentV1ModelFrozen === true, `${manifest.caseId}: frozen v1 guard missing`);

  let previousEnd = null;
  for (const item of manifest.truth.signalLifecycle) {
    const issued = parseTimeMs(item?.issuedAt);
    const ended = parseTimeMs(item?.endedAt);
    assert(Number.isFinite(issued) && Number.isFinite(ended) && ended > issued, `${manifest.caseId}: invalid HKO signal lifecycle`);
    assert(previousEnd == null || issued >= previousEnd, `${manifest.caseId}: HKO signal lifecycle moves backwards`);
    previousEnd = ended;
  }

  const cma = manifest.forecastSources?.CMA;
  assert(cma?.role === 'forecast-input-primary', `${manifest.caseId}: CMA must be current primary historical forecast source`);
  assert(cma?.provider === 'NMC', `${manifest.caseId}: CMA provider must be NMC`);
  assert(Number(cma?.historicalListYear) === Number(manifest.storm?.season), `${manifest.caseId}: CMA historical list year mismatch`);
  assert(clean(cma?.stormNumber) === clean(manifest.identities?.CMA), `${manifest.caseId}: CMA identity mismatch`);
  assert(cma?.asIssuedForecastExtraction === 'active', `${manifest.caseId}: CMA extraction must be active`);
  return manifest;
}

export function selectNmcStorm(listData, manifest) {
  const list = Array.isArray(listData?.typhoonList) ? listData.typhoonList : [];
  const targetNumber = clean(manifest.forecastSources.CMA.stormNumber);
  const targetName = normalizeName(manifest.storm.nameEn);
  const matches = list.filter(row => {
    if (!Array.isArray(row)) return false;
    const numberMatch = [row[3], row[4]].some(value => clean(value) === targetNumber);
    const nameMatch = normalizeName(row[1]) === targetName;
    return numberMatch || nameMatch;
  });
  assert(matches.length === 1, `${manifest.caseId}: expected exactly one NMC historical storm match, got ${matches.length}`);
  const row = matches[0];
  return {
    id: clean(row[0]),
    nameEn: clean(row[1]),
    nameZh: clean(row[2]),
    number: clean(row[4] ?? row[3]),
    state: clean(row[7])
  };
}

export function buildCmaHistoricalSnapshots(detailData, manifest, resolvedStorm) {
  const stormInfo = detailData?.typhoon;
  assert(Array.isArray(stormInfo), `${manifest.caseId}: NMC detail has no typhoon array`);
  const pastRaw = Array.isArray(stormInfo[8]) ? stormInfo[8] : [];
  assert(pastRaw.length > 0, `${manifest.caseId}: NMC detail has no historical points`);

  const snapshots = [];
  for (let index = 0; index < pastRaw.length; index += 1) {
    const baseRaw = pastRaw[index];
    const baseTime = normalizeNmcTime(baseRaw?.[1]);
    const baseMs = parseTimeMs(baseTime);
    if (!Number.isFinite(baseMs)) continue;
    const forecastRaw = findBabjForecast(baseRaw);
    if (!forecastRaw.length) continue;

    const positions = dedupePoints(pastRaw.slice(0, index + 1).map(parseNmcHistoryPoint));
    const forecast = dedupePoints(forecastRaw.map(parseNmcForecastPoint))
      .filter(point => parseTimeMs(point.baseTime) <= baseMs + 1000 && parseTimeMs(point.time) > baseMs);
    if (!positions.length || !forecast.length) continue;

    assert(forecast.every(point => parseTimeMs(point.baseTime) <= baseMs + 1000), `${manifest.caseId}: forecast base time after cutoff`);
    assert(forecast.every(point => parseTimeMs(point.time) > baseMs), `${manifest.caseId}: non-future forecast point in historical snapshot`);

    snapshots.push({
      asOf: new Date(baseMs).toISOString(),
      source: {
        agency: 'CMA',
        sourceId: resolvedStorm.id,
        bulletinTime: new Date(baseMs).toISOString(),
        nameEn: resolvedStorm.nameEn || manifest.storm.nameEn,
        nameTc: resolvedStorm.nameZh || manifest.storm.nameZh,
        positions,
        forecast
      },
      provenance: {
        type: 'official-web-archive',
        dataRole: 'forecast',
        provider: 'CMA/NMC',
        originalIssuedAt: new Date(baseMs).toISOString(),
        issueTimeSemantics: 'NMC history-point/base-time carrying BABJ forecast',
        sourceStormId: resolvedStorm.id,
        futureSourceLeakage: false
      }
    });
  }

  snapshots.sort((a, b) => parseTimeMs(a.asOf) - parseTimeMs(b.asOf));
  assert(snapshots.length > 0, `${manifest.caseId}: no historical BABJ forecast snapshots found`);
  return snapshots;
}

async function fetchThroughStormProxy(url, options = {}) {
  const proxyOrigin = clean(options.proxyOrigin || process.env.STORM_PROXY_ORIGIN || DEFAULT_PROXY_ORIGIN).replace(/\/$/, '');
  const proxyUrl = `${proxyOrigin}/?url=${encodeURIComponent(url)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 20000));
  try {
    const response = await fetch(proxyUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { Accept: 'application/json,application/javascript,text/plain,*/*' }
    });
    const text = await response.text();
    assert(response.ok, `Storm proxy returned HTTP ${response.status}: ${text.slice(0, 120)}`);
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchCmaHistoricalCase(manifest, options = {}) {
  validateHistoricalCaseManifest(manifest);
  const year = Number(manifest.forecastSources.CMA.historicalListYear);
  const listUrl = `${NMC_ORIGIN}/weatherservice/typhoon/jsons/list_${year}?callback=typhoon_jsons_list_${year}`;
  const listData = parseNmcJson(await fetchThroughStormProxy(listUrl, options));
  const storm = selectNmcStorm(listData, manifest);
  assert(storm.id, `${manifest.caseId}: NMC historical storm id is missing`);

  const callback = `typhoon_jsons_view_${storm.id.replace(/[^A-Za-z0-9_]/g, '_')}`;
  const detailUrl = `${NMC_ORIGIN}/weatherservice/typhoon/jsons/view_${encodeURIComponent(storm.id)}?callback=${callback}`;
  const detailData = parseNmcJson(await fetchThroughStormProxy(detailUrl, options));
  const snapshots = buildCmaHistoricalSnapshots(detailData, manifest, storm);

  return {
    schemaVersion: ADAPTER_VERSION,
    caseId: manifest.caseId,
    retrospective: true,
    source: { agency: 'CMA', provider: 'NMC', listUrl, detailUrl, storm },
    snapshotCount: snapshots.length,
    firstAsOf: snapshots[0].asOf,
    lastAsOf: snapshots.at(-1).asOf,
    snapshots,
    semantics: {
      asIssuedForecastHistory: true,
      sourceAvailableAtOrBeforeCutoff: true,
      forecastValidTimesMayBeAfterCutoff: true,
      missingAgenciesNotSubstituted: true,
      HkoTruthUsedAsForecastInput: false,
      currentV1ModelModified: false,
      productionDatabaseWritten: false
    }
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

async function main() {
  const filePath = process.argv[2];
  assert(filePath, 'usage: node scripts/cma-historical-adapter.mjs <historical-case.json>');
  const result = await fetchCmaHistoricalCase(readJson(filePath));
  const summaryOnly = process.argv.includes('--summary');
  const output = summaryOnly ? {
    schemaVersion: result.schemaVersion,
    caseId: result.caseId,
    source: result.source,
    snapshotCount: result.snapshotCount,
    firstAsOf: result.firstAsOf,
    lastAsOf: result.lastAsOf,
    sampleSnapshots: result.snapshots.slice(0, 2).map(item => ({
      asOf: item.asOf,
      positionCount: item.source.positions.length,
      forecastCount: item.source.forecast.length,
      forecastHours: item.source.forecast.map(point => point.forecastHour)
    })),
    semantics: result.semantics
  } : result;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
  });
}
