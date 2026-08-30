import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const TRUTH_AUDIT_VERSION = 'consensus-track-truth-readiness/v1';
export const TARGET_LEADS = Object.freeze([24, 48, 72, 96, 120]);
const TIME_TOLERANCE_MS = 60 * 1000;
const CYCLE_MATCH_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_TRUTH_BRACKET_MS = 12 * 3600000;

function clean(value) {
  return value == null ? '' : String(value).trim();
}

export function parseTimeMs(value) {
  const ms = Date.parse(clean(value));
  return Number.isFinite(ms) ? ms : null;
}

export function normalizeName(value) {
  return clean(value).toUpperCase().replace(/[\s_()（）\-–—./]+/g, '');
}

function isFiniteCoordinate(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return false;
  return Number.isFinite(Number(value));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function parseNdjson(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function readNdjson(filePath) {
  return parseNdjson(fs.readFileSync(filePath, 'utf8'));
}

export function parseCsvLine(line) {
  const fields = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      fields.push(value.trim());
      value = '';
    } else {
      value += char;
    }
  }
  fields.push(value.trim());
  return fields;
}

export function parseJmaFinalCsv(text) {
  const points = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const fields = parseCsvLine(line);
    if (fields.length < 9) continue;
    const year = Number(fields[0]);
    const month = Number(fields[1]);
    const day = Number(fields[2]);
    const hour = Number(fields[3]);
    if (![year, month, day, hour].every(Number.isFinite)) continue;
    if (year < 1950 || month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23) continue;
    const validTime = new Date(Date.UTC(year, month - 1, day, hour)).toISOString();
    const lat = Number(fields[7]);
    const lon = Number(fields[8]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    points.push({
      typhoonNumber: clean(fields[4]),
      name: clean(fields[5]),
      nameToken: normalizeName(fields[5]),
      validTime,
      validTimeMs: Date.parse(validTime),
      lat,
      lon
    });
  }
  return points;
}

function walkJsonFiles(root) {
  if (!fs.existsSync(root)) return [];
  const output = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...walkJsonFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.json')) output.push(full);
  }
  return output.sort();
}

function loadObservationRecords(root) {
  const observationsRoot = path.join(root, 'observations');
  const records = [];
  for (const filePath of walkJsonFiles(observationsRoot)) {
    try {
      records.push(readJson(filePath));
    } catch {
      // A corrupt evidence file is ignored here and will reduce readiness counts.
    }
  }
  return records;
}

function caseIndexKey(captureFingerprint, rawGroupKey) {
  return `${clean(captureFingerprint)}\u0000${clean(rawGroupKey)}`;
}

export function buildCaseResolutionIndex(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = caseIndexKey(row?.captureFingerprint, row?.rawGroupKey);
    if (clean(row?.captureFingerprint) && clean(row?.rawGroupKey) && clean(row?.caseId)) {
      map.set(key, clean(row.caseId));
    }
  }
  return map;
}

function activeCaseIds(latest, caseResolutionIndex) {
  const ids = new Set();
  for (const group of latest?.groups || []) {
    const caseId = caseResolutionIndex.get(caseIndexKey(latest?.captureFingerprint, group?.key));
    if (caseId) ids.add(caseId);
  }
  return ids;
}

function caseRomanNames(caseRecord) {
  const tokens = new Set();
  for (const name of caseRecord?.names || []) {
    const raw = clean(name).toUpperCase();
    if (/^[A-Z][A-Z0-9 -]{2,}$/.test(raw)) {
      const token = normalizeName(raw);
      if (token && !['TROPICALDEPRESSION', 'TROPICALSTORM', 'TD', 'TS'].includes(token)) tokens.add(token);
    }
  }
  return [...tokens];
}

function truthPointsForCase(caseRecord, allTruthPoints) {
  const names = new Set(caseRomanNames(caseRecord));
  if (!names.size) return [];
  return allTruthPoints
    .filter(point => names.has(point.nameToken))
    .sort((a, b) => a.validTimeMs - b.validTimeMs);
}

export function classifyTruthTime(points, targetTime, options = {}) {
  const target = parseTimeMs(targetTime);
  if (!Number.isFinite(target)) return { state: 'invalid-target-time', ready: false };
  const maxBracketMs = Number.isFinite(options.maxBracketMs) ? options.maxBracketMs : MAX_TRUTH_BRACKET_MS;
  const sorted = (points || []).filter(point => Number.isFinite(point?.validTimeMs)).sort((a, b) => a.validTimeMs - b.validTimeMs);
  const exact = sorted.find(point => Math.abs(point.validTimeMs - target) <= TIME_TOLERANCE_MS);
  if (exact) return { state: 'exact-final-truth', ready: true, beforeTime: exact.validTime, afterTime: exact.validTime, bracketHours: 0 };
  let before = null;
  let after = null;
  for (const point of sorted) {
    if (point.validTimeMs < target) before = point;
    if (point.validTimeMs > target) {
      after = point;
      break;
    }
  }
  if (!before || !after) return { state: 'missing-final-truth-time', ready: false };
  const gap = after.validTimeMs - before.validTimeMs;
  if (gap > maxBracketMs) {
    return {
      state: 'final-truth-gap-too-wide',
      ready: false,
      beforeTime: before.validTime,
      afterTime: after.validTime,
      bracketHours: Number((gap / 3600000).toFixed(1))
    };
  }
  return {
    state: 'interpolatable-final-truth',
    ready: true,
    beforeTime: before.validTime,
    afterTime: after.validTime,
    bracketHours: Number((gap / 3600000).toFixed(1))
  };
}

function referenceTimes(reference) {
  return [reference?.bulletinTime, reference?.forecastBaseTime, reference?.currentTime]
    .map(parseTimeMs).filter(Number.isFinite);
}

function baselineCycleTimes(record) {
  return [record?.bulletinTime, record?.forecastBaseTime, record?.analysis?.validTime]
    .map(parseTimeMs).filter(Number.isFinite);
}

export function cycleMatchesReference(record, reference) {
  const left = referenceTimes(reference);
  const right = baselineCycleTimes(record);
  if (!left.length || !right.length) return false;
  return left.some(a => right.some(b => Math.abs(a - b) <= CYCLE_MATCH_TOLERANCE_MS));
}

function pointTimes(points) {
  return (points || []).map(point => parseTimeMs(point?.validTime)).filter(Number.isFinite).sort((a, b) => a - b);
}

function hasExact(times, target) {
  return times.some(time => Math.abs(time - target) <= TIME_TOLERANCE_MS);
}

function hasBracket(times, target) {
  return times.some(time => time <= target + TIME_TOLERANCE_MS)
    && times.some(time => time >= target - TIME_TOLERANCE_MS);
}

export function classifyBaselineCoverage(sample, agency, record) {
  const target = parseTimeMs(sample?.validTime);
  if (!Number.isFinite(target)) return { state: 'invalid-target-time', reconstructable: false };
  const provenance = clean(sample?.provenanceByAgency?.[agency]);
  const analysisTime = parseTimeMs(record?.analysis?.validTime);
  const forecastTimes = pointTimes(record?.forecast);
  if (provenance === 'exact-analysis') {
    const ok = Number.isFinite(analysisTime) && Math.abs(analysisTime - target) <= TIME_TOLERANCE_MS;
    return { state: ok ? 'exact-analysis' : 'missing-exact-analysis', reconstructable: ok };
  }
  if (provenance === 'exact-forecast') {
    const ok = hasExact(forecastTimes, target);
    return { state: ok ? 'exact-forecast' : 'missing-exact-forecast', reconstructable: ok };
  }
  if (provenance === 'analysis-to-forecast-interpolation') {
    const ok = Number.isFinite(analysisTime)
      && analysisTime <= target + TIME_TOLERANCE_MS
      && forecastTimes.some(time => time >= target - TIME_TOLERANCE_MS);
    return { state: ok ? 'analysis-forecast-bracket' : 'missing-analysis-forecast-bracket', reconstructable: ok };
  }
  if (provenance === 'forecast-to-forecast-interpolation') {
    const ok = hasBracket(forecastTimes, target);
    return { state: ok ? 'forecast-bracket' : 'missing-forecast-bracket', reconstructable: ok };
  }
  const all = [...forecastTimes];
  if (Number.isFinite(analysisTime)) all.push(analysisTime);
  if (hasExact(all, target)) return { state: 'exact-unspecified', reconstructable: true };
  const ok = hasBracket(all, target);
  return { state: ok ? 'generic-bracket' : 'missing-generic-bracket', reconstructable: ok };
}

function dedupeBaselineRecords(records) {
  const seen = new Set();
  const result = [];
  for (const record of records) {
    const key = clean(record?.cycleFingerprint) || [record?.agency, record?.sourceId, record?.bulletinTime].map(clean).join('|');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(record);
  }
  return result;
}

function baselineRecordsForTarget(target, baselineRecords) {
  const byAgency = {};
  for (const agency of target.sample?.agencies || []) {
    const reference = target.group?.sourceReferences?.[agency];
    if (!reference?.sourceId) continue;
    const matches = baselineRecords.filter(record => clean(record?.agency).toUpperCase() === clean(agency).toUpperCase()
      && clean(record?.sourceId) === clean(reference.sourceId)
      && cycleMatchesReference(record, reference));
    let accepted = null;
    for (const record of matches) {
      const coverage = classifyBaselineCoverage(target.sample, agency, record);
      if (coverage.reconstructable) {
        accepted = { record, coverage };
        break;
      }
    }
    byAgency[agency] = accepted ? {
      state: accepted.coverage.state,
      reconstructable: true,
      cycleFingerprint: accepted.record?.cycleFingerprint ?? null
    } : {
      state: matches.length ? 'cycle-found-valid-time-missing' : 'same-cycle-baseline-missing',
      reconstructable: false,
      cycleFingerprint: null
    };
  }
  return byAgency;
}

function targetLead(value) {
  const number = Number(value);
  return TARGET_LEADS.includes(number) ? number : null;
}

function collectCtTargets(ctRecords, caseResolutionIndex) {
  const targets = [];
  for (const observation of ctRecords) {
    if (observation?.schemaVersion !== 'storm-consensus-track-prospective/v2') continue;
    const capturedAtMs = parseTimeMs(observation?.capturedAt);
    for (const group of observation?.groups || []) {
      const caseId = caseResolutionIndex.get(caseIndexKey(observation?.captureFingerprint, group?.key));
      if (!caseId) continue;
      for (const sample of group?.samples || []) {
        const leadHours = targetLead(sample?.leadHours);
        if (leadHours == null) continue;
        if (!isFiniteCoordinate(sample?.consensusLat) || !isFiniteCoordinate(sample?.consensusLon)) continue;
        if (Number(sample?.agencyCount) < 2) continue;
        const validTimeMs = parseTimeMs(sample?.validTime);
        const prospective = Number.isFinite(capturedAtMs) && Number.isFinite(validTimeMs) && capturedAtMs < validTimeMs;
        targets.push({
          caseId,
          capturedAt: observation?.capturedAt ?? null,
          captureFingerprint: observation?.captureFingerprint ?? null,
          groupKey: group?.key ?? null,
          leadHours,
          validTime: sample?.validTime ?? null,
          prospective,
          group,
          sample
        });
      }
    }
  }
  return targets;
}

function loadJmaFinalPoints(dir) {
  const points = [];
  if (!fs.existsSync(dir)) return points;
  for (const name of fs.readdirSync(dir).filter(name => name.toLowerCase().endsWith('.csv')).sort()) {
    points.push(...parseJmaFinalCsv(fs.readFileSync(path.join(dir, name), 'utf8')));
  }
  return points;
}

function leadCounter() {
  return Object.fromEntries(TARGET_LEADS.map(lead => [String(lead), 0]));
}

function agencyLeadCounter() {
  return Object.fromEntries(['HKO', 'CMA', 'JMA', 'CWA'].map(agency => [agency, leadCounter()]));
}

function addLead(counter, lead) {
  counter[String(lead)] = (counter[String(lead)] || 0) + 1;
}

export function auditTruthReadiness({ latest, caseRegistry, caseIndexRows, ctRecords, baselineRecords, jmaFinalPoints }) {
  const resolutionIndex = buildCaseResolutionIndex(caseIndexRows);
  const active = activeCaseIds(latest, resolutionIndex);
  const uniqueBaselineRecords = dedupeBaselineRecords(baselineRecords.flatMap(observation => observation?.records || []));
  const targets = collectCtTargets(ctRecords, resolutionIndex);
  const cases = [];

  for (const caseRecord of caseRegistry?.cases || []) {
    const caseId = clean(caseRecord?.caseId);
    if (!caseId) continue;
    const caseTargets = targets.filter(target => target.caseId === caseId);
    const truthPoints = truthPointsForCase(caseRecord, jmaFinalPoints);
    const typhoonNumbers = [...new Set(truthPoints.map(point => point.typhoonNumber).filter(Boolean))];
    const forecastCyclesByLead = leadCounter();
    const prospectiveCyclesByLead = leadCounter();
    const truthReadyCyclesByLead = leadCounter();
    const baselinePairableByAgencyLead = agencyLeadCounter();
    const homogeneousReadyByAgencyLead = agencyLeadCounter();
    const targetDetails = [];

    for (const target of caseTargets) {
      addLead(forecastCyclesByLead, target.leadHours);
      if (target.prospective) addLead(prospectiveCyclesByLead, target.leadHours);
      const truth = truthPoints.length
        ? classifyTruthTime(truthPoints, target.validTime)
        : { state: 'final-case-truth-unavailable', ready: false };
      const baselineByAgency = baselineRecordsForTarget(target, uniqueBaselineRecords);
      if (target.prospective && truth.ready) addLead(truthReadyCyclesByLead, target.leadHours);
      for (const [agency, baseline] of Object.entries(baselineByAgency)) {
        if (target.prospective && baseline.reconstructable) addLead(baselinePairableByAgencyLead[agency], target.leadHours);
        if (target.prospective && truth.ready && baseline.reconstructable) addLead(homogeneousReadyByAgencyLead[agency], target.leadHours);
      }
      targetDetails.push({
        capturedAt: target.capturedAt,
        captureFingerprint: target.captureFingerprint,
        groupKey: target.groupKey,
        leadHours: target.leadHours,
        validTime: target.validTime,
        agencyCount: target.sample?.agencyCount ?? null,
        agencies: target.sample?.agencies ?? [],
        prospective: target.prospective,
        truth,
        baselineByAgency
      });
    }

    const baselineAgencies = [...new Set(uniqueBaselineRecords
      .filter(record => clean(record?.caseIdAtCapture) === caseId)
      .map(record => clean(record?.agency).toUpperCase()).filter(Boolean))].sort();
    const multiAgencyTargetCount = caseTargets.length;
    cases.push({
      caseId,
      state: active.has(caseId) ? 'active-in-latest' : 'inactive-from-latest',
      firstSeen: caseRecord?.firstSeen ?? null,
      lastSeen: caseRecord?.lastSeen ?? null,
      groupKeys: caseRecord?.groupKeys ?? [],
      names: caseRecord?.names ?? [],
      jmaFinalNameCandidates: caseRomanNames(caseRecord),
      jmaFinalTruth: {
        available: truthPoints.length > 0,
        typhoonNumbers,
        pointCount: truthPoints.length,
        firstValidTime: truthPoints[0]?.validTime ?? null,
        lastValidTime: truthPoints.at(-1)?.validTime ?? null
      },
      baselineEvidence: {
        agencies: baselineAgencies,
        agencyCount: baselineAgencies.length
      },
      multiAgencyTargetCount,
      forecastCyclesByLead,
      prospectiveCyclesByLead,
      truthReadyCyclesByLead,
      baselinePairableByAgencyLead,
      homogeneousReadyByAgencyLead,
      targetDetails
    });
  }

  const completedCandidates = cases.filter(item => item.state === 'inactive-from-latest' && item.multiAgencyTargetCount > 0);
  const completedWithFinalTruth = completedCandidates.filter(item => item.jmaFinalTruth.available);
  const homogeneousReadyCountForCase = item => Object.values(item.homogeneousReadyByAgencyLead)
    .reduce((agencySum, leads) => agencySum + Object.values(leads).reduce((a, b) => a + b, 0), 0);
  const totalHomogeneousReady = completedCandidates.reduce((sum, item) => sum + homogeneousReadyCountForCase(item), 0);
  const completedWithHomogeneousReady = completedCandidates.filter(item => homogeneousReadyCountForCase(item) > 0);

  return {
    schemaVersion: TRUTH_AUDIT_VERSION,
    auditedAt: new Date().toISOString(),
    truthSource: {
      provider: 'JMA',
      product: 'typhoon-position-table-final-csv',
      postAnalysisFinalOnly: true,
      maxInterpolationBracketHours: MAX_TRUTH_BRACKET_MS / 3600000
    },
    input: {
      latestCapturedAt: latest?.capturedAt ?? null,
      latestCaptureFingerprint: latest?.captureFingerprint ?? null,
      registryCaseCount: caseRegistry?.caseCount ?? (caseRegistry?.cases || []).length,
      ctObservationCount: ctRecords.length,
      baselineObservationCount: baselineRecords.length,
      finalTruthPointCount: jmaFinalPoints.length
    },
    summary: {
      activeCaseCount: cases.filter(item => item.state === 'active-in-latest').length,
      inactiveCaseCount: cases.filter(item => item.state === 'inactive-from-latest').length,
      completedMultiAgencyCaseCandidateCount: completedCandidates.length,
      completedCaseIds: completedCandidates.map(item => item.caseId),
      completedWithFinalTruthCount: completedWithFinalTruth.length,
      completedWithFinalTruthCaseIds: completedWithFinalTruth.map(item => item.caseId),
      completedWithHomogeneousReadyCount: completedWithHomogeneousReady.length,
      completedWithHomogeneousReadyCaseIds: completedWithHomogeneousReady.map(item => item.caseId),
      homogeneousReadyAgencyPairCount: totalHomogeneousReady,
      verificationEvidenceAvailable: totalHomogeneousReady > 0
    },
    cases,
    semantics: {
      readOnlyTruthAudit: true,
      officialPostAnalysisFinalTruthRequired: true,
      preliminaryOperationalAnalysisAcceptedAsFinalTruth: false,
      forecastMustPrecedeTargetValidTime: true,
      sameCycleProspectiveAgencyBaselineRequiredForAgencyComparison: true,
      forecastSkillEvaluated: false,
      forecastErrorsCalculated: false,
      agencyRankingProduced: false,
      consensusAlgorithmModified: false,
      productionDatabaseWritten: false,
      skillGateDecisionProduced: false
    }
  };
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${key}`);
    result[key.slice(2)] = value;
    i += 1;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ctRoot = args['ct-root'];
  const baselineRoot = args['baseline-root'];
  const jmaFinalDir = args['jma-final-dir'];
  if (!ctRoot || !baselineRoot || !jmaFinalDir) {
    throw new Error('usage: node scripts/audit-consensus-track-truth-readiness.mjs --ct-root <ct-data> --baseline-root <baseline-data> --jma-final-dir <csv-dir>');
  }
  const latest = readJson(path.join(ctRoot, 'latest.json'));
  const caseRegistry = readJson(path.join(ctRoot, 'case-registry.json'));
  const caseIndexRows = readNdjson(path.join(ctRoot, 'case-index.ndjson'));
  const ctRecords = loadObservationRecords(ctRoot);
  const baselineRecords = loadObservationRecords(baselineRoot);
  const jmaFinalPoints = loadJmaFinalPoints(jmaFinalDir);
  const result = auditTruthReadiness({ latest, caseRegistry, caseIndexRows, ctRecords, baselineRecords, jmaFinalPoints });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
  });
}
