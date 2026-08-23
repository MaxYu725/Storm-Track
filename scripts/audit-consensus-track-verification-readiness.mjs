import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const AUDIT_VERSION = 'consensus-track-verification-readiness/v1';
export const DEFAULT_HISTORY_ORIGIN = 'https://storm.max-yu.workers.dev/api/history';
const CYCLE_TOLERANCE_MS = 3 * 3600000;
const EXACT_TIME_TOLERANCE_MS = 60 * 1000;

function clean(value) {
  return value == null ? '' : String(value).trim();
}

export function normalizeToken(value) {
  return clean(value).toUpperCase().replace(/[\s_()（）\-–—./]+/g, '');
}

export function parseTimeMs(value) {
  const ms = Date.parse(clean(value));
  return Number.isFinite(ms) ? ms : null;
}

function primitiveStrings(value, result = []) {
  if (value == null) return result;
  if (Array.isArray(value)) {
    for (const item of value) primitiveStrings(item, result);
    return result;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) primitiveStrings(item, result);
    return result;
  }
  if (typeof value === 'string' || typeof value === 'number') result.push(clean(value));
  return result;
}

export function objectHasExactPrimitive(value, expected) {
  const target = clean(expected);
  if (!target) return false;
  return primitiveStrings(value).some(item => item === target);
}

function isGenericNameToken(token) {
  return /^(TROPICALDEPRESSION|TROPICALSTORM|TD|TS|熱帶低氣壓|熱帶低壓|热带低气压|热带低压|熱帶風暴|热带风暴)$/.test(token);
}

function groupSpecificNames(group) {
  return [...new Set([
    group?.nameEn,
    group?.nameTc,
    group?.key
  ].map(normalizeToken).filter(token => token && !isGenericNameToken(token)))];
}

function stormNameTokens(storm) {
  return [...new Set([
    storm?.name_en,
    storm?.name_zh,
    storm?.international_number,
    storm?.id
  ].map(normalizeToken).filter(Boolean))];
}

function stormTimeOverlapsReference(storm, reference) {
  const refTimes = [reference?.bulletinTime, reference?.currentTime, reference?.forecastBaseTime]
    .map(parseTimeMs).filter(Number.isFinite);
  if (!refTimes.length) return true;
  const first = parseTimeMs(storm?.first_seen_at);
  const last = parseTimeMs(storm?.last_seen_at);
  if (!Number.isFinite(first) && !Number.isFinite(last)) return true;
  const ref = Math.min(...refTimes);
  const pad = 48 * 3600000;
  if (Number.isFinite(first) && ref < first - pad) return false;
  if (Number.isFinite(last) && ref > last + pad) return false;
  return true;
}

export function shortlistStorms(storms, group, reference) {
  const names = groupSpecificNames(group);
  const sourceId = clean(reference?.sourceId);
  const timed = (Array.isArray(storms) ? storms : []).filter(storm => stormTimeOverlapsReference(storm, reference));
  const scored = timed.map(storm => {
    const tokens = stormNameTokens(storm);
    const exactSourceId = sourceId && objectHasExactPrimitive(storm, sourceId);
    const nameOverlap = names.filter(name => tokens.includes(name)).length;
    const score = (exactSourceId ? 1000 : 0) + nameOverlap * 100;
    return { storm, score, exactSourceId, nameOverlap };
  }).sort((left, right) => right.score - left.score || String(left.storm?.id || '').localeCompare(String(right.storm?.id || '')));

  const strong = scored.filter(item => item.score > 0);
  if (strong.length) return strong.slice(0, 8);
  return scored.slice(0, 12);
}

function advisoryAgency(advisory) {
  return clean(advisory?.agency).toUpperCase();
}

function sourceReferenceTimes(reference) {
  return [...new Set([
    reference?.bulletinTime,
    reference?.forecastBaseTime,
    reference?.currentTime
  ].map(parseTimeMs).filter(Number.isFinite))];
}

export function selectCycleAdvisory(advisories, agency, reference) {
  const candidates = (Array.isArray(advisories) ? advisories : [])
    .filter(item => advisoryAgency(item) === clean(agency).toUpperCase());
  const targets = sourceReferenceTimes(reference);
  if (!candidates.length || !targets.length) return null;

  return candidates.map(advisory => {
    const issued = parseTimeMs(advisory?.issued_at);
    const diffMs = Number.isFinite(issued)
      ? Math.min(...targets.map(target => Math.abs(issued - target)))
      : Infinity;
    const sourceIdExact = objectHasExactPrimitive(advisory, reference?.sourceId);
    return { advisory, diffMs, sourceIdExact };
  }).sort((left, right) => (right.sourceIdExact - left.sourceIdExact)
    || left.diffMs - right.diffMs
    || String(left.advisory?.id || '').localeCompare(String(right.advisory?.id || '')))[0] || null;
}

function validPointTimes(points, type) {
  return (Array.isArray(points) ? points : [])
    .filter(point => !type || clean(point?.point_type) === type)
    .map(point => parseTimeMs(point?.valid_at))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

function hasExactTime(times, target) {
  return times.some(time => Math.abs(time - target) <= EXACT_TIME_TOLERANCE_MS);
}

function hasBracket(times, target) {
  const before = times.some(time => time <= target + EXACT_TIME_TOLERANCE_MS);
  const after = times.some(time => time >= target - EXACT_TIME_TOLERANCE_MS);
  return before && after;
}

export function classifyValidTimeCoverage(sample, agency, points) {
  const target = parseTimeMs(sample?.validTime);
  if (!Number.isFinite(target)) return { state: 'invalid-target-time', reconstructable: false };
  const provenance = clean(sample?.provenanceByAgency?.[agency]);
  const analysis = validPointTimes(points, 'analysis');
  const forecast = validPointTimes(points, 'forecast');
  const all = [...new Set([...analysis, ...forecast])].sort((a, b) => a - b);

  if (provenance === 'exact-analysis') {
    const ok = hasExactTime(analysis, target);
    return { state: ok ? 'exact-analysis' : 'missing-exact-analysis', reconstructable: ok };
  }
  if (provenance === 'exact-forecast') {
    const ok = hasExactTime(forecast, target);
    return { state: ok ? 'exact-forecast' : 'missing-exact-forecast', reconstructable: ok };
  }
  if (provenance === 'analysis-to-forecast-interpolation') {
    const beforeAnalysis = analysis.some(time => time <= target + EXACT_TIME_TOLERANCE_MS);
    const afterForecast = forecast.some(time => time >= target - EXACT_TIME_TOLERANCE_MS);
    const ok = beforeAnalysis && afterForecast;
    return { state: ok ? 'analysis-forecast-bracket' : 'missing-analysis-forecast-bracket', reconstructable: ok };
  }
  if (provenance === 'forecast-to-forecast-interpolation') {
    const ok = hasBracket(forecast, target);
    return { state: ok ? 'forecast-bracket' : 'missing-forecast-bracket', reconstructable: ok };
  }

  const exact = hasExactTime(all, target);
  if (exact) return { state: 'exact-unspecified', reconstructable: true };
  const bracket = hasBracket(all, target);
  return { state: bracket ? 'generic-bracket' : 'missing-generic-bracket', reconstructable: bracket };
}

function groupTargetsForAgency(group, agency) {
  return (Array.isArray(group?.samples) ? group.samples : [])
    .filter(sample => Array.isArray(sample?.agencies) && sample.agencies.includes(agency))
    .filter(sample => Number.isFinite(Number(sample?.consensusLat)) && Number.isFinite(Number(sample?.consensusLon)));
}

function roundPct(numerator, denominator) {
  return denominator ? Number((numerator * 100 / denominator).toFixed(1)) : null;
}

async function fetchJson(origin, path, fetchImpl = fetch) {
  const response = await fetchImpl(`${origin}${path}`, {
    headers: { Accept: 'application/json' },
    redirect: 'follow'
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}${data?.error ? ` ${data.error}` : ''}`);
  if (!data || typeof data !== 'object') throw new Error(`${path}: non-JSON response`);
  return data;
}

async function loadStormBundle(origin, stormId, fetchImpl) {
  const encoded = encodeURIComponent(stormId);
  const [detail, list] = await Promise.all([
    fetchJson(origin, `/storms/${encoded}`, fetchImpl),
    fetchJson(origin, `/storms/${encoded}/advisories?limit=200`, fetchImpl)
  ]);
  return {
    detail,
    advisories: Array.isArray(list?.advisories) ? list.advisories : []
  };
}

function chooseStormMatch(shortlist, bundles, group, agency, reference) {
  const sourceId = clean(reference?.sourceId);
  const specificNames = groupSpecificNames(group);
  const evaluated = shortlist.map(item => {
    const stormId = clean(item?.storm?.id);
    const bundle = bundles.get(stormId);
    const metadata = { storm: item?.storm, detail: bundle?.detail, advisories: bundle?.advisories };
    const sourceIdExact = sourceId && objectHasExactPrimitive(metadata, sourceId);
    const nameOverlap = specificNames.filter(name => stormNameTokens(item?.storm).includes(name)).length;
    const cycle = selectCycleAdvisory(bundle?.advisories, agency, reference);
    const cycleWithinTolerance = Boolean(cycle && Number.isFinite(cycle.diffMs) && cycle.diffMs <= CYCLE_TOLERANCE_MS);
    const score = (sourceIdExact ? 10000 : 0) + nameOverlap * 100 + (cycleWithinTolerance ? 20 : 0);
    return { storm: item.storm, bundle, sourceIdExact, nameOverlap, cycle, cycleWithinTolerance, score };
  }).sort((left, right) => right.score - left.score || (left.cycle?.diffMs ?? Infinity) - (right.cycle?.diffMs ?? Infinity));

  const best = evaluated[0] || null;
  if (!best) return null;
  const generic = groupSpecificNames(group).length === 0;
  if (generic && !best.sourceIdExact) return { ...best, accepted: false, reason: 'generic-storm-without-source-id-evidence' };
  if (!best.sourceIdExact && best.nameOverlap === 0) return { ...best, accepted: false, reason: 'no-source-id-or-name-evidence' };
  if (!best.cycleWithinTolerance) return { ...best, accepted: false, reason: 'no-cycle-within-tolerance' };
  return {
    ...best,
    accepted: true,
    reason: best.sourceIdExact ? 'source-id+cycle' : 'specific-name+cycle'
  };
}

export async function auditReadiness(ctRecord, options = {}) {
  if (ctRecord?.schemaVersion !== 'storm-consensus-track-prospective/v2') {
    throw new Error('CT-1B requires storm-consensus-track-prospective/v2 input');
  }
  const origin = options.origin || DEFAULT_HISTORY_ORIGIN;
  const fetchImpl = options.fetchImpl || fetch;
  const stormsPayload = await fetchJson(origin, '/storms?limit=100', fetchImpl);
  const storms = Array.isArray(stormsPayload?.storms) ? stormsPayload.storms : [];
  const bundleCache = new Map();
  const joins = [];

  for (const group of ctRecord.groups || []) {
    for (const [agency, reference] of Object.entries(group?.sourceReferences || {})) {
      const shortlist = shortlistStorms(storms, group, reference);
      for (const item of shortlist) {
        const stormId = clean(item?.storm?.id);
        if (!stormId || bundleCache.has(stormId)) continue;
        try {
          bundleCache.set(stormId, await loadStormBundle(origin, stormId, fetchImpl));
        } catch (error) {
          bundleCache.set(stormId, { detail: null, advisories: [], loadError: error.message });
        }
      }

      const match = chooseStormMatch(shortlist, bundleCache, group, agency, reference);
      const targets = groupTargetsForAgency(group, agency);
      if (!match?.accepted) {
        joins.push({
          groupKey: group?.key ?? null,
          displayName: group?.displayName ?? null,
          agency,
          sourceId: reference?.sourceId ?? null,
          stormId: match?.storm?.id ?? null,
          stormMatch: match?.reason || 'no-storm-candidate',
          cycleJoin: false,
          cycleTimeDiffMinutes: Number.isFinite(match?.cycle?.diffMs) ? Number((match.cycle.diffMs / 60000).toFixed(1)) : null,
          advisoryId: match?.cycle?.advisory?.id ?? null,
          targetCount: targets.length,
          reconstructableTargetCount: 0,
          validTimeCoveragePct: targets.length ? 0 : null,
          targetStates: []
        });
        continue;
      }

      const advisoryId = clean(match?.cycle?.advisory?.id);
      let detail = null;
      let detailError = null;
      try {
        detail = advisoryId ? await fetchJson(origin, `/advisories/${encodeURIComponent(advisoryId)}`, fetchImpl) : null;
      } catch (error) {
        detailError = error.message;
      }
      const points = Array.isArray(detail?.points) ? detail.points : [];
      const targetStates = targets.map(sample => ({
        validTime: sample.validTime ?? null,
        provenance: sample?.provenanceByAgency?.[agency] ?? null,
        ...classifyValidTimeCoverage(sample, agency, points)
      }));
      const reconstructableTargetCount = targetStates.filter(item => item.reconstructable).length;

      joins.push({
        groupKey: group?.key ?? null,
        displayName: group?.displayName ?? null,
        agency,
        sourceId: reference?.sourceId ?? null,
        stormId: match?.storm?.id ?? null,
        stormMatch: match.reason,
        cycleJoin: !detailError && Boolean(advisoryId),
        cycleTimeDiffMinutes: Number.isFinite(match?.cycle?.diffMs) ? Number((match.cycle.diffMs / 60000).toFixed(1)) : null,
        advisoryId: advisoryId || null,
        advisoryIssuedAt: match?.cycle?.advisory?.issued_at ?? null,
        archivePointCount: points.length,
        archiveAnalysisPointCount: points.filter(point => point?.point_type === 'analysis').length,
        archiveForecastPointCount: points.filter(point => point?.point_type === 'forecast').length,
        targetCount: targets.length,
        reconstructableTargetCount,
        validTimeCoveragePct: roundPct(reconstructableTargetCount, targets.length),
        detailError,
        targetStates
      });
    }
  }

  const acceptedReasons = new Set(['source-id+cycle', 'specific-name+cycle']);
  const agencies = ['HKO', 'CMA', 'JMA', 'CWA'];
  const byAgency = Object.fromEntries(agencies.map(agency => {
    const items = joins.filter(item => item.agency === agency);
    const targets = items.reduce((sum, item) => sum + item.targetCount, 0);
    const reconstructable = items.reduce((sum, item) => sum + item.reconstructableTargetCount, 0);
    return [agency, {
      sourceReferenceCount: items.length,
      stormJoinCount: items.filter(item => acceptedReasons.has(item.stormMatch)).length,
      cycleJoinCount: items.filter(item => item.cycleJoin).length,
      targetCount: targets,
      reconstructableTargetCount: reconstructable,
      validTimeCoveragePct: roundPct(reconstructable, targets)
    }];
  }));

  const targetCount = joins.reduce((sum, item) => sum + item.targetCount, 0);
  const reconstructableTargetCount = joins.reduce((sum, item) => sum + item.reconstructableTargetCount, 0);
  return {
    schemaVersion: AUDIT_VERSION,
    auditedAt: new Date().toISOString(),
    input: {
      schemaVersion: ctRecord.schemaVersion,
      capturedAt: ctRecord.capturedAt ?? null,
      sourceCommit: ctRecord.sourceCommit ?? null,
      captureFingerprint: ctRecord.captureFingerprint ?? null,
      groupCount: ctRecord.groupCount ?? (ctRecord.groups || []).length
    },
    archive: {
      origin,
      stormCount: storms.length
    },
    joins,
    summary: {
      sourceReferenceCount: joins.length,
      stormJoinCount: joins.filter(item => acceptedReasons.has(item.stormMatch)).length,
      cycleJoinCount: joins.filter(item => item.cycleJoin).length,
      targetCount,
      reconstructableTargetCount,
      validTimeCoveragePct: roundPct(reconstructableTargetCount, targetCount),
      byAgency
    },
    semantics: {
      readOnlyArchiveAudit: true,
      forecastSkillEvaluated: false,
      forecastErrorsCalculated: false,
      agencyRankingProduced: false,
      consensusAlgorithmModified: false,
      productionDatabaseWritten: false
    }
  };
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error('usage: node scripts/audit-consensus-track-verification-readiness.mjs <ct-v2-latest.json>');
  const ctRecord = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const result = await auditReadiness(ctRecord, {
    origin: process.env.HISTORY_API_ORIGIN || DEFAULT_HISTORY_ORIGIN
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
  });
}
