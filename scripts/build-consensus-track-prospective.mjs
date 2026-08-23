import crypto from 'node:crypto';
import fs from 'node:fs';

const PROSPECTIVE_VERSION = 'storm-consensus-track-prospective/v2';
const DEFAULT_URL = 'https://maxyu725.github.io/Storm-Track/?beta=hk-signal';
const inputPath = process.argv[2];
if (!inputPath) throw new Error('Usage: node scripts/build-consensus-track-prospective.mjs <dry-run.json>');

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

function finiteOrNull(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stringOrNull(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function sortedUniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value)).filter(Boolean))].sort();
}

function sortedObject(input) {
  return Object.fromEntries(Object.entries(input && typeof input === 'object' ? input : {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, value == null ? null : String(value)]));
}

function sanitizeSourceReference(reference, fallbackAgency) {
  return {
    agency: stringOrNull(reference?.agency) || stringOrNull(fallbackAgency),
    sourceId: stringOrNull(reference?.sourceId),
    bulletinTime: stringOrNull(reference?.bulletinTime),
    currentTime: stringOrNull(reference?.currentTime),
    forecastBaseTime: stringOrNull(reference?.forecastBaseTime),
    forecastFirstValidTime: stringOrNull(reference?.forecastFirstValidTime),
    forecastLastValidTime: stringOrNull(reference?.forecastLastValidTime),
    positionCount: Math.max(0, Number(reference?.positionCount) || 0),
    forecastCount: Math.max(0, Number(reference?.forecastCount) || 0)
  };
}

function sanitizeSourceReferences(input) {
  return Object.fromEntries(
    Object.entries(input && typeof input === 'object' ? input : {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([agency, reference]) => [agency, sanitizeSourceReference(reference, agency)])
  );
}

function sanitizeSample(sample) {
  return {
    leadHours: finiteOrNull(sample?.leadHours),
    validTime: sample?.validTime ?? null,
    agencyCount: Number(sample?.agencyCount) || 0,
    agencies: sortedUniqueStrings(sample?.agencies),
    interpolatedAgencyCount: Number(sample?.interpolatedAgencyCount) || 0,
    provenanceByAgency: sortedObject(sample?.provenanceByAgency),
    consensusLat: finiteOrNull(sample?.consensusLat),
    consensusLon: finiteOrNull(sample?.consensusLon),
    spreadKm: finiteOrNull(sample?.spreadKm)
  };
}

function sanitizeGroup(group) {
  const samples = (Array.isArray(group?.samples) ? group.samples : [])
    .map(sanitizeSample)
    .sort((left, right) => (left.leadHours ?? Infinity) - (right.leadHours ?? Infinity));

  return {
    key: group?.key ?? null,
    displayName: group?.displayName ?? null,
    nameTc: group?.nameTc ?? null,
    nameEn: group?.nameEn ?? null,
    sourceAgencies: sortedUniqueStrings(group?.sourceAgencies),
    sourceReferences: sanitizeSourceReferences(group?.sourceReferences),
    trackSchemaVersion: group?.trackSchemaVersion ?? null,
    state: group?.state ?? null,
    referenceAgency: group?.referenceAgency ?? null,
    referenceBaseTime: group?.referenceBaseTime ?? null,
    referenceMethod: group?.referenceMethod ?? null,
    configuredHorizonHours: finiteOrNull(group?.configuredHorizonHours),
    stepHours: finiteOrNull(group?.stepHours),
    consensusPointCount: Number(group?.consensusPointCount) || 0,
    supportedThroughHours: finiteOrNull(group?.supportedThroughHours),
    continuousConsensusThroughHours: finiteOrNull(group?.continuousConsensusThroughHours),
    samples
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

const sourceStates = (Array.isArray(raw?.sourceStates) ? raw.sourceStates : [])
  .map(item => ({ agency: String(item?.agency || ''), state: String(item?.state || 'unknown') }))
  .filter(item => item.agency)
  .sort((left, right) => left.agency.localeCompare(right.agency));
const groups = (Array.isArray(raw?.groups) ? raw.groups : [])
  .map(sanitizeGroup)
  .sort((left, right) => String(left.key || '').localeCompare(String(right.key || '')));
const visibleGroupKeys = sortedUniqueStrings(raw?.visibleGroupKeys);

const fingerprintSource = canonicalize({
  schemaVersion: PROSPECTIVE_VERSION,
  sourceStates,
  visibleGroupKeys,
  groups
});
const captureFingerprint = crypto
  .createHash('sha256')
  .update(JSON.stringify(fingerprintSource))
  .digest('hex');

const output = {
  schemaVersion: PROSPECTIVE_VERSION,
  capturedAt: raw?.capturedAt ?? new Date().toISOString(),
  targetUrl: process.env.STORM_BETA_URL || DEFAULT_URL,
  sourceCommit: process.env.SOURCE_COMMIT || null,
  captureFingerprint,
  pageTitle: raw?.pageTitle ?? null,
  sourceStates,
  visibleGroupKeys,
  groupCount: groups.length,
  groups,
  semantics: {
    rawInputsPersisted: false,
    individualAgencyCoordinatesPersisted: false,
    derivedConsensusCoordinatesPersisted: true,
    sourceReferencesPersisted: true,
    sourceReferenceCoordinatesPersisted: false,
    stableCaseIdentityResolvedSeparately: true,
    forecastSkillEvaluated: false,
    probabilityCalibrated: false
  }
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
