import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const situationShadow = require('../analysis/hk-situation-analysis-shadow.js');

const BATCH_SCHEMA_VERSION = 'hk-situation-analysis-shadow-packet-batch/v0.1';
const PACKET_SCHEMA_VERSION = 'hk-situation-analysis-shadow-packet/v0.1';
const LOCAL_WIND_LOOKBACK_DAYS = 1;

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

  const candidateFiles = [];
  for (let daysBack = 0; daysBack <= LOCAL_WIND_LOOKBACK_DAYS; daysBack += 1) {
    const relativeTime = subtractDays(observedAt, daysBack);
    const relativeDay = dayPath(relativeTime);
    if (!relativeDay) continue;
    candidateFiles.push(...listJsonFiles(join(corpusRoot, 'observations', relativeDay)));
  }

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
        nameTc: observation?.group?.nameTc ?? null,
        nameEn: observation?.group?.nameEn ?? null
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

function buildPacket({ observation, betaCapture, registry, localWindCorpusRoot }) {
  const { caseInfo, resolution } = resolveCase(observation, registry);
  const localWind = selectLocalWindObservation(localWindCorpusRoot, observation?.observedAt ?? betaCapture?.capturedAt);
  const analysis = observation?.analysis || {};

  const evidencePacket = situationShadow.buildSituationAnalysisInput({
    caseInfo,
    generatedAt: analysis.generatedAt ?? observation?.observedAt ?? betaCapture?.capturedAt ?? null,
    impact: analysis.impact ?? null,
    signalInputs: analysis.signalInputs ?? null,
    threatAssessment: analysis.threatAssessment ?? null,
    basicForecast: analysis.basicForecast ?? null,
    shadowForecastV2: analysis.shadowForecastV2 ?? null,
    hkoSignalStatement: null,
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
    hkoSignalStatementJoin: {
      status: 'not-recorded-in-source-corpus',
      reason: 'no-time-aligned-immutable-statement-corpus-yet'
    }
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
      noTruthCorpusRead: true,
      noFutureLocalWindJoin: true,
      caseSpecificRulesForbidden: true
    }
  };
}

function buildPacketBatch({ betaCapture, registry, localWindCorpusRoot, builtAt = new Date().toISOString() }) {
  if (betaCapture?.schemaVersion !== 'beta-prospective-recorder/v2') {
    throw new Error(`Unsupported beta capture schema: ${betaCapture?.schemaVersion ?? 'missing'}`);
  }
  if (registry?.schemaVersion !== 'storm-case-identity/v1') {
    throw new Error(`Unsupported case registry schema: ${registry?.schemaVersion ?? 'missing'}`);
  }

  const observations = Array.isArray(betaCapture.observations) ? betaCapture.observations : [];
  const packets = observations
    .filter(observation => observation?.analysis?.available === true)
    .map(observation => buildPacket({ observation, betaCapture, registry, localWindCorpusRoot }))
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
      truthBranchInputIncluded: false,
      localWindJoinMustBeAtOrBeforeObservation: true,
      exactEvidencePacketSavedBeforeInference: true
    }
  };
}

function main(argv = process.argv.slice(2)) {
  const [betaPath, registryPath, localWindCorpusRoot] = argv;
  if (!betaPath || !registryPath) {
    throw new Error('Usage: node scripts/build-hk-situation-analysis-shadow-packets.mjs <beta-latest.json> <case-registry.json> [local-wind-corpus-root]');
  }
  const batch = buildPacketBatch({
    betaCapture: parseJsonFile(resolve(betaPath)),
    registry: parseJsonFile(resolve(registryPath)),
    localWindCorpusRoot: localWindCorpusRoot ? resolve(localWindCorpusRoot) : null
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
  fingerprint,
  resolveCase,
  selectLocalWindObservation
};
