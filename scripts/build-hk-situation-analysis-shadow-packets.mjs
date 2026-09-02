import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const situationShadow = require('../analysis/hk-situation-analysis-shadow.js');

const BATCH_SCHEMA_VERSION = 'hk-situation-analysis-shadow-packet-batch/v0.1';
const PACKET_SCHEMA_VERSION = 'hk-situation-analysis-shadow-packet/v0.1';
const LOCAL_WIND_LOOKBACK_DAYS = 1;
const HKO_OPERATIONAL_LOOKBACK_DAYS = 1;

function parseJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function timeMs(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dayPath(value) {
  const ms = timeMs(value);
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return join(year, month, day);
}

function subtractDays(value, days) {
  const ms = timeMs(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms - days * 24 * 60 * 60 * 1000).toISOString();
}

function listJsonFiles(path) {
  if (!path || !existsSync(path) || !statSync(path).isDirectory()) return [];
  return readdirSync(path)
    .filter(name => name.endsWith('.json'))
    .map(name => join(path, name))
    .filter(file => statSync(file).isFile());
}

function candidateObservationFiles(corpusRoot, observedAt, lookbackDays) {
  const files = [];
  for (let daysBack = 0; daysBack <= lookbackDays; daysBack += 1) {
    const relativeTime = subtractDays(observedAt, daysBack);
    const relativeDay = dayPath(relativeTime);
    if (!relativeDay) continue;
    files.push(...listJsonFiles(join(corpusRoot, 'observations', relativeDay)));
  }
  return files;
}

function localWindTimestamp(item) {
  return item?.summary?.dataTimestamp ?? item?.dataTimestamp ?? item?.retrievedAt ?? null;
}

function selectLocalWindObservation(corpusRoot, observedAt) {
  const observedMs = timeMs(observedAt);
  if (!corpusRoot || !Number.isFinite(observedMs)) {
    return {
      evidence: null,
      join: {
        status: 'unavailable',
        reason: !corpusRoot ? 'local-wind-corpus-not-provided' : 'observation-time-invalid',
        futureEvidenceRejected: true
      }
    };
  }

  const candidateFiles = candidateObservationFiles(corpusRoot, observedAt, LOCAL_WIND_LOOKBACK_DAYS);
  let best = null;
  let futureCandidateCount = 0;
  for (const path of candidateFiles) {
    let item;
    try {
      item = parseJsonFile(path);
    } catch {
      continue;
    }
    if (item?.affectsForecast !== false) continue;
    const candidateTime = localWindTimestamp(item);
    const candidateMs = timeMs(candidateTime);
    if (!Number.isFinite(candidateMs)) continue;
    if (candidateMs > observedMs) {
      futureCandidateCount += 1;
      continue;
    }
    if (!best || candidateMs > best.ms) best = { path, item, ms: candidateMs, time: candidateTime };
  }

  if (!best) {
    return {
      evidence: null,
      join: {
        status: 'unavailable',
        reason: 'no-at-or-before-local-wind-observation',
        futureEvidenceRejected: true,
        futureCandidateCount
      }
    };
  }

  return {
    evidence: best.item,
    join: {
      status: 'matched-at-or-before',
      dataTimestamp: best.time,
      ageMinutes: (observedMs - best.ms) / 60000,
      captureFingerprint: best.item.captureFingerprint ?? null,
      sourcePath: best.path.replaceAll('\\', '/'),
      futureEvidenceRejected: true,
      futureCandidateCount
    }
  };
}

function normalizeIdentityToken(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function caseIdentityTokens(caseInfo) {
  const candidates = [caseInfo?.nameTc, caseInfo?.nameEn];
  const displayParts = String(caseInfo?.displayName ?? '').match(/[\p{L}\p{N}-]{3,}/gu) || [];
  candidates.push(...displayParts);
  const generic = new Set([
    'TROPICALSTORM', 'TROPICALDEPRESSION', 'SEVERETROPICALSTORM',
    '熱帶風暴', '熱帶低氣壓', '強烈熱帶風暴'
  ].map(normalizeIdentityToken));
  return [...new Set(candidates.map(normalizeIdentityToken).filter(token => token.length >= 3 && !generic.has(token)))];
}

function hkoSnapshotText(item) {
  const contents = [];
  const details = Array.isArray(item?.truth?.details) ? item.truth.details : [];
  for (const detail of details) {
    if (Array.isArray(detail?.contents)) contents.push(...detail.contents);
  }
  if (Array.isArray(item?.context?.specialWeatherTips)) {
    for (const row of item.context.specialWeatherTips) {
      if (typeof row === 'string') contents.push(row);
      else if (row?.contents && Array.isArray(row.contents)) contents.push(...row.contents);
      else if (row?.text) contents.push(row.text);
    }
  }
  return normalizeIdentityToken(contents.join(' '));
}

function projectHkoOperationalContext(item) {
  const truth = item?.truth || {};
  const details = Array.isArray(truth.details) ? truth.details.map(detail => ({
    warningStatementCode: detail?.warningStatementCode ?? null,
    subtype: detail?.subtype ?? null,
    updateTime: detail?.updateTime ?? null,
    contents: Array.isArray(detail?.contents) ? [...detail.contents] : []
  })) : [];
  return {
    schemaVersion: 'hko-contemporaneous-operational-context/v1',
    authority: item?.authority ?? 'Hong Kong Observatory Open Data API',
    retrievedAt: item?.retrievedAt ?? null,
    captureFingerprint: item?.captureFingerprint ?? null,
    present: truth?.present === true,
    currentSignalCode: truth?.code ?? null,
    currentSignal: truth?.type ?? null,
    level: truth?.level ?? null,
    actionCode: truth?.actionCode ?? null,
    issueTime: truth?.issueTime ?? null,
    updateTime: truth?.updateTime ?? details?.[0]?.updateTime ?? null,
    expireTime: truth?.expireTime ?? null,
    details,
    context: {
      pre8: Array.isArray(item?.context?.pre8) ? item.context.pre8 : [],
      specialWeatherTips: Array.isArray(item?.context?.specialWeatherTips) ? item.context.specialWeatherTips : []
    },
    semantics: {
      contemporaneousOnly: true,
      officialOperationalContext: true,
      futureOutcomeFeedback: false
    }
  };
}

function selectHkoOperationalContext(corpusRoot, observedAt, caseInfo) {
  const observedMs = timeMs(observedAt);
  if (!corpusRoot || !Number.isFinite(observedMs)) {
    return {
      evidence: null,
      join: {
        status: 'unavailable',
        reason: !corpusRoot ? 'hko-warning-corpus-not-provided' : 'observation-time-invalid',
        futureEvidenceRejected: true
      }
    };
  }

  const candidateFiles = candidateObservationFiles(corpusRoot, observedAt, HKO_OPERATIONAL_LOOKBACK_DAYS);
  let latest = null;
  let futureCandidateCount = 0;
  for (const path of candidateFiles) {
    let item;
    try {
      item = parseJsonFile(path);
    } catch {
      continue;
    }
    const candidateTime = item?.retrievedAt ?? null;
    const candidateMs = timeMs(candidateTime);
    if (!Number.isFinite(candidateMs)) continue;
    if (candidateMs > observedMs) {
      futureCandidateCount += 1;
      continue;
    }
    if (!latest || candidateMs > latest.ms) latest = { path, item, ms: candidateMs, time: candidateTime };
  }

  if (!latest) {
    return {
      evidence: null,
      join: {
        status: 'unavailable',
        reason: 'no-at-or-before-hko-warning-observation',
        futureEvidenceRejected: true,
        futureCandidateCount
      }
    };
  }

  const present = latest.item?.truth?.present === true;
  const tokens = caseIdentityTokens(caseInfo);
  const text = hkoSnapshotText(latest.item);
  const matchedToken = present ? tokens.find(token => text.includes(token)) ?? null : null;

  if (present && !matchedToken) {
    return {
      evidence: null,
      join: {
        status: 'not-matched-to-case',
        reason: tokens.length ? 'active-hko-warning-text-does-not-match-case-identity' : 'case-has-no-specific-identity-token',
        retrievedAt: latest.time,
        ageMinutes: (observedMs - latest.ms) / 60000,
        captureFingerprint: latest.item?.captureFingerprint ?? null,
        sourcePath: latest.path.replaceAll('\\', '/'),
        futureEvidenceRejected: true,
        futureCandidateCount,
        activeWarningPresent: true,
        identityTokensChecked: tokens
      }
    };
  }

  return {
    evidence: projectHkoOperationalContext(latest.item),
    join: {
      status: present ? 'matched-active-warning-at-or-before' : 'matched-global-no-warning-at-or-before',
      retrievedAt: latest.time,
      ageMinutes: (observedMs - latest.ms) / 60000,
      captureFingerprint: latest.item?.captureFingerprint ?? null,
      sourcePath: latest.path.replaceAll('\\', '/'),
      futureEvidenceRejected: true,
      futureCandidateCount,
      activeWarningPresent: present,
      matchedIdentityToken: matchedToken
    }
  };
}

function resolveCase(observation, registry) {
  const key = String(observation?.group?.key ?? '').trim();
  const cases = Array.isArray(registry?.cases) ? registry.cases : [];
  if (!key) return { caseInfo: null, resolution: { status: 'unresolved', reason: 'group-key-missing' } };

  const exact = cases.filter(item => Array.isArray(item?.groupKeys) && item.groupKeys.includes(key));
  if (exact.length === 1) {
    const item = exact[0];
    return {
      caseInfo: {
        caseId: item.caseId ?? null,
        displayName: observation?.group?.displayName ?? item.displayNames?.at?.(-1) ?? null,
        nameTc: observation?.group?.nameTc ?? item.names?.find?.(name => /[^A-Za-z]/.test(name)) ?? null,
        nameEn: observation?.group?.nameEn ?? item.names?.find?.(name => /^[A-Za-z-]+$/.test(name)) ?? null
      },
      resolution: {
        status: 'resolved',
        method: 'case-registry-group-key',
        caseId: item.caseId ?? null
      }
    };
  }

  return {
    caseInfo: {
      caseId: null,
      displayName: observation?.group?.displayName ?? null,
      nameTc: observation?.group?.nameTc ?? null,
      nameEn: observation?.group?.nameEn ?? null
    },
    resolution: {
      status: 'unresolved',
      reason: exact.length > 1 ? 'ambiguous-case-registry-group-key' : 'group-key-not-in-case-registry',
      candidateCount: exact.length
    }
  };
}

function buildPacket({ observation, betaCapture, registry, localWindCorpusRoot, hkoWarningCorpusRoot }) {
  const { caseInfo, resolution } = resolveCase(observation, registry);
  const observationTime = observation?.observedAt ?? betaCapture?.capturedAt;
  const localWind = selectLocalWindObservation(localWindCorpusRoot, observationTime);
  const hkoOperational = selectHkoOperationalContext(hkoWarningCorpusRoot, observationTime, caseInfo);
  const analysis = observation?.analysis || {};

  const evidencePacket = situationShadow.buildSituationAnalysisInput({
    caseInfo,
    generatedAt: analysis.generatedAt ?? observation?.observedAt ?? betaCapture?.capturedAt ?? null,
    impact: analysis.impact ?? null,
    signalInputs: analysis.signalInputs ?? null,
    threatAssessment: analysis.threatAssessment ?? null,
    basicForecast: analysis.basicForecast ?? null,
    shadowForecastV2: analysis.shadowForecastV2 ?? null,
    hkoSignalStatement: hkoOperational.evidence,
    localWindShadow: localWind.evidence,
    previousSituation: null
  });

  const provenance = {
    betaCaptureFingerprint: betaCapture?.captureFingerprint ?? null,
    betaCapturedAt: betaCapture?.capturedAt ?? null,
    betaSourceCommit: betaCapture?.sourceCommit ?? null,
    observationObservedAt: observation?.observedAt ?? null,
    groupKey: observation?.group?.key ?? null,
    sourceAgencies: Array.isArray(observation?.sourceAgencies) ? [...observation.sourceAgencies] : [],
    caseRegistryReconciledThrough: registry?.reconciledThrough ?? null,
    caseResolution: resolution,
    localWindJoin: localWind.join,
    hkoOperationalContextJoin: hkoOperational.join
  };

  const packetFingerprint = fingerprint({ evidencePacket, provenance });
  return {
    schemaVersion: PACKET_SCHEMA_VERSION,
    packetFingerprint,
    caseId: caseInfo?.caseId ?? null,
    groupKey: observation?.group?.key ?? null,
    sourceObservationObservedAt: observation?.observedAt ?? null,
    provenance,
    evidencePacket,
    semantics: {
      shadowOnly: true,
      affectsForecast: false,
      affectsEvaluator: false,
      immutableInputForFutureInference: true,
      noTruthCorpusRead: false,
      noFutureTruthFeedback: true,
      contemporaneousOfficialContextOnly: true,
      noFutureOfficialContextJoin: true,
      noFutureLocalWindJoin: true,
      caseSpecificRulesForbidden: true
    }
  };
}

function buildPacketBatch({ betaCapture, registry, localWindCorpusRoot, hkoWarningCorpusRoot, builtAt = new Date().toISOString() }) {
  if (betaCapture?.schemaVersion !== 'beta-prospective-recorder/v2') {
    throw new Error(`Unsupported beta capture schema: ${betaCapture?.schemaVersion ?? 'missing'}`);
  }
  if (registry?.schemaVersion !== 'storm-case-identity/v1') {
    throw new Error(`Unsupported case registry schema: ${registry?.schemaVersion ?? 'missing'}`);
  }

  const observations = Array.isArray(betaCapture.observations) ? betaCapture.observations : [];
  const packets = observations
    .filter(observation => observation?.analysis?.available === true)
    .map(observation => buildPacket({ observation, betaCapture, registry, localWindCorpusRoot, hkoWarningCorpusRoot }))
    .sort((left, right) => String(left.groupKey || '').localeCompare(String(right.groupKey || '')));

  const batchFingerprint = fingerprint({
    sourceCaptureFingerprint: betaCapture.captureFingerprint ?? null,
    packetFingerprints: packets.map(packet => packet.packetFingerprint)
  });

  return {
    schemaVersion: BATCH_SCHEMA_VERSION,
    builtAt,
    sourceCaptureFingerprint: betaCapture.captureFingerprint ?? null,
    sourceCapturedAt: betaCapture.capturedAt ?? null,
    sourceCommit: betaCapture.sourceCommit ?? null,
    caseRegistryReconciledThrough: registry.reconciledThrough ?? null,
    batchFingerprint,
    packetCount: packets.length,
    packets,
    semantics: {
      shadowOnly: true,
      affectsForecast: false,
      affectsEvaluator: false,
      providerInvocationIncluded: false,
      truthBranchInputIncluded: Boolean(hkoWarningCorpusRoot),
      truthBranchUseRestrictedToContemporaneousOfficialContext: true,
      futureTruthFeedbackIncluded: false,
      outcomeEvaluatorInputIncluded: false,
      officialContextJoinMustBeAtOrBeforeObservation: true,
      localWindJoinMustBeAtOrBeforeObservation: true,
      exactEvidencePacketSavedBeforeInference: true
    }
  };
}

function main(argv = process.argv.slice(2)) {
  const [betaPath, registryPath, localWindCorpusRoot, hkoWarningCorpusRoot] = argv;
  if (!betaPath || !registryPath) {
    throw new Error('Usage: node scripts/build-hk-situation-analysis-shadow-packets.mjs <beta-latest.json> <case-registry.json> [local-wind-corpus-root] [hko-warning-corpus-root]');
  }
  const batch = buildPacketBatch({
    betaCapture: parseJsonFile(resolve(betaPath)),
    registry: parseJsonFile(resolve(registryPath)),
    localWindCorpusRoot: localWindCorpusRoot ? resolve(localWindCorpusRoot) : null,
    hkoWarningCorpusRoot: hkoWarningCorpusRoot ? resolve(hkoWarningCorpusRoot) : null
  });
  process.stdout.write(`${JSON.stringify(batch, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
const modulePath = resolve(fileURLToPath(import.meta.url));
if (invokedPath === modulePath) {
  try {
    main();
  } catch (error) {
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

export {
  BATCH_SCHEMA_VERSION,
  PACKET_SCHEMA_VERSION,
  buildPacketBatch,
  caseIdentityTokens,
  fingerprint,
  resolveCase,
  selectHkoOperationalContext,
  selectLocalWindObservation
};
