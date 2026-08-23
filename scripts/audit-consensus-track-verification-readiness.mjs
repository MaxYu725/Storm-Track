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

export function objectHasExactPrimitive(value, expected) {
  const target = clean(expected);
  if (!target) return false;
  if (Array.isArray(value)) return value.some(item => objectHasExactPrimitive(item, target));
  if (value && typeof value === 'object') return Object.values(value).some(item => objectHasExactPrimitive(item, target));
  return clean(value) === target;
}

export function sourceAliasCandidates(agency, sourceId) {
  const code = clean(agency).toUpperCase();
  const raw = clean(sourceId);
  if (!raw) return [];
  const result = new Set([raw]);
  if (code === 'CWA') {
    const match = raw.match(/^(\d{4})-(\d+)$/);
    if (match) result.add(`${match[1]}-TD${match[2]}`);
  }
  return [...result];
}

export function advisorySourceCodeCandidates(agency, sourceId) {
  const code = clean(agency).toUpperCase();
  const raw = clean(sourceId);
  if (!raw) return [];
  if (code === 'CWA') {
    const match = raw.match(/^\d{4}-(?:TD)?(\d+)$/i);
    return match ? [match[1], raw] : [raw];
  }
  if (code === 'JMA') return [];
  return [raw];
}

function sameAgencyAliases(detail, agency) {
  const code = clean(agency).toUpperCase();
  return (Array.isArray(detail?.aliases) ? detail.aliases : [])
    .filter(alias => clean(alias?.agency).toUpperCase() === code);
}

export function matchExplicitAgencyAlias(detail, agency, sourceId) {
  const candidates = new Set(sourceAliasCandidates(agency, sourceId));
  if (!candidates.size) return null;
  return sameAgencyAliases(detail, agency)
    .find(alias => candidates.has(clean(alias?.agency_storm_id))) || null;
}

function isGenericNameToken(token) {
  return /^(TROPICALDEPRESSION|TROPICALSTORM|TD|TS|熱帶低氣壓|熱帶低壓|热带低气压|热带低压|熱帶風暴|热带风暴)$/.test(token);
}

function groupSpecificNames(group) {
  return [...new Set([group?.nameEn, group?.nameTc, group?.key]
    .map(normalizeToken)
    .filter(token => token && !isGenericNameToken(token)))];
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
  const timed = (Array.isArray(storms) ? storms : [])
    .filter(storm => stormTimeOverlapsReference(storm, reference));
  const scored = timed.map(storm => {
    const tokens = stormNameTokens(storm);
    const nameOverlap = names.filter(name => tokens.includes(name)).length;
    return { storm, score: nameOverlap * 100, nameOverlap };
  }).sort((left, right) => right.score - left.score
    || String(left.storm?.id || '').localeCompare(String(right.storm?.id || '')));
  const strong = scored.filter(item => item.score > 0);
  return (strong.length ? strong : scored).slice(0, 20);
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

function nearestCycle(advisories, reference) {
  const targets = sourceReferenceTimes(reference);
  if (!advisories.length || !targets.length) return null;
  return advisories.map(advisory => {
    const issued = parseTimeMs(advisory?.issued_at);
    let matchedReferenceTime = null;
    let offsetMs = null;
    let diffMs = Infinity;
    if (Number.isFinite(issued)) {
      for (const target of targets) {
        const difference = issued - target;
        if (Math.abs(difference) < diffMs) {
          diffMs = Math.abs(difference);
          offsetMs = difference;
          matchedReferenceTime = target;
        }
      }
    }
    return { advisory, diffMs, offsetMs, matchedReferenceTime };
  }).sort((left, right) => left.diffMs - right.diffMs
    || String(left.advisory?.id || '').localeCompare(String(right.advisory?.id || '')))[0] || null;
}

export function selectCycleAdvisory(advisories, agency, reference, stormDetail = null) {
  const code = clean(agency).toUpperCase();
  const agencyAdvisories = (Array.isArray(advisories) ? advisories : [])
    .filter(item => advisoryAgency(item) === code);
  if (!agencyAdvisories.length) return { state: 'no-agency-advisory', cycle: null };

  const sourceCodes = new Set(advisorySourceCodeCandidates(code, reference?.sourceId));
  if (sourceCodes.size) {
    const sourceMatched = agencyAdvisories.filter(item => sourceCodes.has(clean(item?.source_code)));
    if (!sourceMatched.length) return { state: 'no-source-matched-advisory', cycle: null };
    return { state: 'source-code-matched', cycle: nearestCycle(sourceMatched, reference) };
  }

  // JMA stores EventID (TC26xx) in storm aliases but product code (VPTWxx) on advisories.
  // The advisory stream is source-identifiable only when the storm row has one JMA alias.
  const aliases = sameAgencyAliases(stormDetail, code)
    .map(alias => clean(alias?.agency_storm_id)).filter(Boolean);
  if (code === 'JMA' && new Set(aliases).size !== 1) {
    return { state: 'ambiguous-jma-advisory-stream', cycle: nearestCycle(agencyAdvisories, reference) };
  }
  return { state: 'storm-scoped-agency-stream', cycle: nearestCycle(agencyAdvisories, reference) };
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
  return times.some(time => time <= target + EXACT_TIME_TOLERANCE_MS)
    && times.some(time => time >= target - EXACT_TIME_TOLERANCE_MS);
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
    const ok = analysis.some(time => time <= target + EXACT_TIME_TOLERANCE_MS)
      && forecast.some(time => time >= target - EXACT_TIME_TOLERANCE_MS);
    return { state: ok ? 'analysis-forecast-bracket' : 'missing-analysis-forecast-bracket', reconstructable: ok };
  }
  if (provenance === 'forecast-to-forecast-interpolation') {
    const ok = hasBracket(forecast, target);
    return { state: ok ? 'forecast-bracket' : 'missing-forecast-bracket', reconstructable: ok };
  }
  if (hasExactTime(all, target)) return { state: 'exact-unspecified', reconstructable: true };
  const bracket = hasBracket(all, target);
  return { state: bracket ? 'generic-bracket' : 'missing-generic-bracket', reconstructable: bracket };
}

function groupTargetsForAgency(group, agency) {
  return (Array.isArray(group?.samples) ? group.samples : [])
    .filter(sample => Array.isArray(sample?.agencies) && sample.agencies.includes(agency))
    .filter(sample => Number.isFinite(Number(sample?.consensusLat))
      && Number.isFinite(Number(sample?.consensusLon)));
}

function roundPct(numerator, denominator) {
  return denominator ? Number((numerator * 100 / denominator).toFixed(1)) : null;
}

function roundMinutes(ms) {
  return Number.isFinite(ms) ? Number((ms / 60000).toFixed(1)) : null;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
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
  const specificNames = groupSpecificNames(group);
  const evaluated = shortlist.map(item => {
    const stormId = clean(item?.storm?.id);
    const bundle = bundles.get(stormId);
    const alias = matchExplicitAgencyAlias(bundle?.detail, agency, reference?.sourceId);
    const nameOverlap = specificNames.filter(name => stormNameTokens(item?.storm).includes(name)).length;
    return {
      storm: item.storm,
      bundle,
      alias,
      explicitSourceIdentity: Boolean(alias),
      nameOverlap,
      identityScore: (alias ? 10000 : 0) + nameOverlap * 100
    };
  }).sort((left, right) => right.identityScore - left.identityScore
    || String(left.storm?.id || '').localeCompare(String(right.storm?.id || '')));

  const best = evaluated[0] || null;
  if (!best?.explicitSourceIdentity) {
    return best ? { ...best, identityAccepted: false, identityReason: 'no-explicit-same-agency-source-alias' } : null;
  }
  const cycleSelection = selectCycleAdvisory(
    best.bundle?.advisories,
    agency,
    reference,
    best.bundle?.detail
  );
  return {
    ...best,
    identityAccepted: true,
    identityReason: 'explicit-same-agency-source-alias',
    cycleSelection,
    cycle: cycleSelection?.cycle || null
  };
}

function cycleState(match) {
  if (!match?.identityAccepted) return 'not-evaluated';
  if (match?.cycleSelection?.state === 'ambiguous-jma-advisory-stream') return 'source-stream-ambiguous';
  if (!match?.cycle) return match?.cycleSelection?.state || 'no-agency-advisory';
  if (Number.isFinite(match.cycle.diffMs) && match.cycle.diffMs <= CYCLE_TOLERANCE_MS) return 'within-tolerance';
  if (Number.isFinite(match.cycle.offsetMs) && match.cycle.offsetMs < 0) return 'archive-cycle-stale';
  if (Number.isFinite(match.cycle.offsetMs) && match.cycle.offsetMs > 0) return 'archive-cycle-ahead';
  return 'cycle-outside-tolerance';
}

function baseJoin(group, agency, reference, match, targets) {
  const cycle = match?.cycle;
  const state = cycleState(match);
  return {
    groupKey: group?.key ?? null,
    displayName: group?.displayName ?? null,
    agency,
    sourceId: reference?.sourceId ?? null,
    sourceAliasCandidates: sourceAliasCandidates(agency, reference?.sourceId),
    advisorySourceCodeCandidates: advisorySourceCodeCandidates(agency, reference?.sourceId),
    stormId: match?.storm?.id ?? null,
    matchedAgencyStormId: match?.alias?.agency_storm_id ?? null,
    stormIdentityJoin: Boolean(match?.identityAccepted),
    stormIdentityReason: match?.identityReason || 'no-storm-candidate',
    advisoryStreamState: match?.cycleSelection?.state ?? null,
    cycleState: state,
    cycleJoin: state === 'within-tolerance',
    cycleTimeDiffMinutes: roundMinutes(cycle?.diffMs),
    cycleOffsetMinutes: roundMinutes(cycle?.offsetMs),
    archiveLagMinutes: Number.isFinite(cycle?.offsetMs) && cycle.offsetMs < 0 ? roundMinutes(-cycle.offsetMs) : null,
    matchedReferenceTime: Number.isFinite(cycle?.matchedReferenceTime)
      ? new Date(cycle.matchedReferenceTime).toISOString() : null,
    nearestAdvisoryId: cycle?.advisory?.id ?? null,
    nearestAdvisoryIssuedAt: cycle?.advisory?.issued_at ?? null,
    targetCount: targets.length
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
      const join = baseJoin(group, agency, reference, match, targets);

      if (!match?.identityAccepted || join.cycleState !== 'within-tolerance') {
        joins.push({
          ...join,
          advisoryId: null,
          archivePointCount: null,
          archiveAnalysisPointCount: null,
          archiveForecastPointCount: null,
          reconstructableTargetCount: 0,
          validTimeCoveragePct: targets.length ? 0 : null,
          detailError: null,
          targetStates: []
        });
        continue;
      }

      const advisoryId = clean(match?.cycle?.advisory?.id);
      let detail = null;
      let detailError = null;
      try {
        detail = advisoryId
          ? await fetchJson(origin, `/advisories/${encodeURIComponent(advisoryId)}`, fetchImpl)
          : null;
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
        ...join,
        advisoryId: advisoryId || null,
        archivePointCount: points.length,
        archiveAnalysisPointCount: points.filter(point => point?.point_type === 'analysis').length,
        archiveForecastPointCount: points.filter(point => point?.point_type === 'forecast').length,
        reconstructableTargetCount,
        validTimeCoveragePct: roundPct(reconstructableTargetCount, targets.length),
        detailError,
        targetStates
      });
    }
  }

  const agencies = ['HKO', 'CMA', 'JMA', 'CWA'];
  const byAgency = Object.fromEntries(agencies.map(agency => {
    const items = joins.filter(item => item.agency === agency);
    const identityCount = items.filter(item => item.stormIdentityJoin).length;
    const cycleCount = items.filter(item => item.cycleJoin).length;
    const targets = items.reduce((sum, item) => sum + item.targetCount, 0);
    const reconstructable = items.reduce((sum, item) => sum + item.reconstructableTargetCount, 0);
    const lags = items.map(item => item.archiveLagMinutes).filter(Number.isFinite);
    return [agency, {
      sourceReferenceCount: items.length,
      stormIdentityJoinCount: identityCount,
      stormIdentityCoveragePct: roundPct(identityCount, items.length),
      ambiguousAdvisoryStreamCount: items.filter(item => item.cycleState === 'source-stream-ambiguous').length,
      cycleJoinCount: cycleCount,
      cycleJoinCoveragePct: roundPct(cycleCount, items.length),
      staleCycleCount: items.filter(item => item.cycleState === 'archive-cycle-stale').length,
      medianArchiveLagMinutes: median(lags),
      targetCount: targets,
      reconstructableTargetCount: reconstructable,
      validTimeCoveragePct: roundPct(reconstructable, targets)
    }];
  }));

  const targetCount = joins.reduce((sum, item) => sum + item.targetCount, 0);
  const reconstructableTargetCount = joins.reduce((sum, item) => sum + item.reconstructableTargetCount, 0);
  const identityJoinCount = joins.filter(item => item.stormIdentityJoin).length;
  const cycleJoinCount = joins.filter(item => item.cycleJoin).length;
  const archiveLags = joins.map(item => item.archiveLagMinutes).filter(Number.isFinite);

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
      stormCount: storms.length,
      cycleToleranceHours: CYCLE_TOLERANCE_MS / 3600000
    },
    joins,
    summary: {
      sourceReferenceCount: joins.length,
      stormIdentityJoinCount: identityJoinCount,
      stormIdentityCoveragePct: roundPct(identityJoinCount, joins.length),
      ambiguousAdvisoryStreamCount: joins.filter(item => item.cycleState === 'source-stream-ambiguous').length,
      cycleJoinCount,
      cycleJoinCoveragePct: roundPct(cycleJoinCount, joins.length),
      staleCycleCount: joins.filter(item => item.cycleState === 'archive-cycle-stale').length,
      medianArchiveLagMinutes: median(archiveLags),
      targetCount,
      reconstructableTargetCount,
      validTimeCoveragePct: roundPct(reconstructableTargetCount, targetCount),
      byAgency
    },
    semantics: {
      readOnlyArchiveAudit: true,
      explicitSameAgencyAliasRequired: true,
      forecastSkillEvaluated: false,
      forecastErrorsCalculated: false,
      agencyRankingProduced: false,
      consensusAlgorithmModified: false,
      productionDatabaseWritten: false,
      staleCyclesNeverAcceptedAsSameCycle: true,
      ambiguousAdvisoryStreamsNeverAcceptedAsSameCycle: true
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
