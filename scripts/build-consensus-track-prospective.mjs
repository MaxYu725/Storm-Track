import crypto from 'node:crypto';
import fs from 'node:fs';

const PROSPECTIVE_VERSION = 'storm-consensus-track-prospective/v1';
const DEFAULT_URL = 'https://maxyu725.github.io/Storm-Track/?beta=hk-signal';
const inputPath = process.argv[2];
if (!inputPath) throw new Error('Usage: node scripts/build-consensus-track-prospective.mjs <dry-run.json>');

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sortedUniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value)).filter(Boolean))].sort();
}

function sortedObject(input) {
  return Object.fromEntries(Object.entries(input && typeof input === 'object' ? input : {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, value == null ? null : String(value)]));
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
    sourceAgencies: sortedUniqueStrings(group?.sourceAgencies),
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
    forecastSkillEvaluated: false,
    probabilityCalibrated: false
  }
};

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
