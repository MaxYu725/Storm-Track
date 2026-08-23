import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const identity = require('../analysis/storm-case-identity.js');
const ADAPTER_VERSION = 'consensus-track-case-identity-adapter/v1';
const root = path.resolve(process.argv[2] || '.');
const observationsRoot = path.join(root, 'observations');

function listJsonFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...listJsonFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.json')) result.push(fullPath);
  }
  return result.sort();
}

function finite(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function representativeSample(group) {
  const samples = Array.isArray(group?.samples) ? group.samples : [];
  const exactLeadZero = samples.find(sample => Number(sample?.leadHours) === 0
    && finite(sample?.consensusLat) != null && finite(sample?.consensusLon) != null);
  const sample = exactLeadZero || samples.find(item => finite(item?.consensusLat) != null && finite(item?.consensusLon) != null);
  if (!sample) return null;
  return {
    lat: finite(sample.consensusLat),
    lon: finite(sample.consensusLon),
    time: sample.validTime || group?.referenceBaseTime || null
  };
}

function identityNames(group) {
  const key = String(group?.key || '').trim();
  const explicitNameEn = String(group?.nameEn || '').trim();
  const explicitNameTc = String(group?.nameTc || '').trim();
  return {
    nameEn: explicitNameEn || (key && !identity.isGenericName(key) ? key : null),
    nameTc: explicitNameTc || null
  };
}

function syntheticSources(group, representative) {
  const references = group?.sourceReferences && typeof group.sourceReferences === 'object'
    ? group.sourceReferences : {};
  const agencies = new Set([
    ...(Array.isArray(group?.sourceAgencies) ? group.sourceAgencies : []),
    ...Object.keys(references)
  ]);
  return Object.fromEntries([...agencies].sort().map(agency => {
    const reference = references?.[agency] || {};
    const currentTime = reference.currentTime || group?.referenceBaseTime || representative?.time || null;
    return [agency, {
      agency,
      sourceId: reference.sourceId || null,
      bulletinTime: reference.bulletinTime || null,
      current: representative ? {
        lat: representative.lat,
        lon: representative.lon,
        time: currentTime
      } : null
    }];
  }));
}

function toIdentityRecord(record) {
  const observations = (Array.isArray(record?.groups) ? record.groups : []).map(group => {
    const representative = representativeSample(group);
    const names = identityNames(group);
    return {
      schemaVersion: record?.schemaVersion || null,
      observedAt: record?.capturedAt || null,
      group: {
        key: group?.key ?? null,
        displayName: group?.displayName ?? null,
        nameEn: names.nameEn,
        nameTc: names.nameTc
      },
      sources: syntheticSources(group, representative)
    };
  });
  return {
    capturedAt: record?.capturedAt || null,
    captureFingerprint: record?.captureFingerprint || null,
    observations
  };
}

const rawRecords = listJsonFiles(observationsRoot).map(file => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to parse Consensus Track prospective record ${file}: ${error.message}`);
  }
});
const identityRecords = rawRecords.map(toIdentityRecord);
const reconciled = identity.reconcileProspectiveRecords(identityRecords);
const registry = {
  schemaVersion: reconciled.schemaVersion,
  identityAdapterVersion: ADAPTER_VERSION,
  reconciledThrough: reconciled.reconciledThrough,
  caseCount: reconciled.caseCount,
  cases: reconciled.cases
};

fs.writeFileSync(path.join(root, 'case-registry.json'), `${JSON.stringify(registry, null, 2)}\n`);
fs.writeFileSync(
  path.join(root, 'case-index.ndjson'),
  reconciled.index.length ? `${reconciled.index.map(item => JSON.stringify({
    ...item,
    identityAdapterVersion: ADAPTER_VERSION
  })).join('\n')}\n` : ''
);

process.stdout.write(`${JSON.stringify({
  schemaVersion: reconciled.schemaVersion,
  identityAdapterVersion: ADAPTER_VERSION,
  reconciledThrough: reconciled.reconciledThrough,
  recordCount: rawRecords.length,
  caseCount: reconciled.caseCount,
  indexCount: reconciled.index.length,
  cases: reconciled.cases.map(item => ({
    caseId: item.caseId,
    groupKeys: item.groupKeys,
    displayNames: item.displayNames,
    sourceTokens: item.sourceTokens
  }))
}, null, 2)}\n`);
