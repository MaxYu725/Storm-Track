import fs from 'node:fs';

const WATCH_SCHEMA_VERSION = 'beta-prospective-case-watch/v1';

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalize(value) {
  return String(value || '').trim().toUpperCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function observationMatches(observation, aliases, canonicalName) {
  const group = observation?.group || {};
  const groupKey = normalize(group.key);
  const groupName = normalize(group.nameEn);
  const displayName = normalize(group.displayName);
  const canonical = normalize(canonicalName);
  const aliasSet = new Set(aliases.map(normalize));

  if (aliasSet.has(groupKey) || aliasSet.has(groupName)) return true;
  if (canonical && (groupName === canonical || displayName.includes(canonical))) return true;

  for (const source of Object.values(observation?.sources || {})) {
    const sourceId = normalize(source?.sourceId);
    if (sourceId && aliasSet.has(sourceId)) return true;
  }

  return false;
}

const inputPath = process.argv[2];
if (!inputPath) throw new Error('Usage: node scripts/build-beta-case-watch.mjs <capture.json>');

const watchId = requiredEnv('CASE_WATCH_ID');
const canonicalName = requiredEnv('CASE_WATCH_CANONICAL_NAME');
const aliases = unique(
  requiredEnv('CASE_WATCH_ALIASES')
    .split(',')
    .map(normalize)
);

if (!aliases.length) throw new Error('CASE_WATCH_ALIASES must contain at least one alias');

const capture = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
if (capture?.schemaVersion !== 'beta-prospective-recorder/v2') {
  throw new Error(`Unexpected capture schema: ${capture?.schemaVersion || 'missing'}`);
}
if (!capture?.capturedAt || !capture?.captureFingerprint || !Array.isArray(capture?.observations)) {
  throw new Error('Capture is missing required prospective recorder fields');
}

const matchedObservations = capture.observations.filter(observation =>
  observationMatches(observation, aliases, canonicalName)
);

const matchedGroupKeys = unique(matchedObservations.map(item => String(item?.group?.key || '').trim()));
const matchedSourceAgencies = unique(
  matchedObservations.flatMap(item => Array.isArray(item?.sourceAgencies) ? item.sourceAgencies : [])
).sort();

const watch = {
  schemaVersion: WATCH_SCHEMA_VERSION,
  watchId,
  canonicalNameEn: canonicalName,
  aliases,
  capturedAt: capture.capturedAt,
  captureFingerprint: capture.captureFingerprint,
  sourceCommit: capture.sourceCommit ?? null,
  targetUrl: capture.targetUrl ?? null,
  sourceStates: capture.sourceStates ?? [],
  visibleGroupKeys: capture.visibleGroupKeys ?? [],
  discardedStaleObservationKeys: capture.discardedStaleObservationKeys ?? [],
  matchedObservationCount: matchedObservations.length,
  matchedGroupKeys,
  matchedSourceAgencies,
  observations: matchedObservations
};

process.stdout.write(`${JSON.stringify(watch, null, 2)}\n`);
