'use strict';

// WEB-01: preserve the legacy, nearly-100-MiB index.ndjson unchanged.
// New derived evaluation index entries are immutable, bounded JSON files.
const fs = require('node:fs');
const path = require('node:path');

const SHARD_SCHEMA = 'hk-signal-evaluation-index-shard/v1';
const MAX_SHARD_BYTES = 8 * 1024 * 1024;
const FINGERPRINT = /^[0-9a-f]{64}$/;

function pick(source, keys) {
  return Object.fromEntries(keys.map(key => [key, source?.[key] ?? null]));
}

function buildIndexEntry(evaluation) {
  if (!evaluation || typeof evaluation !== 'object' || Array.isArray(evaluation)) {
    throw new Error('Missing evaluation object');
  }
  if (!FINGERPRINT.test(evaluation.evaluationFingerprint || '')) {
    throw new Error('Invalid evaluation fingerprint');
  }
  const timestamp = evaluation.generatedAt;
  if (typeof timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(timestamp)
    || !Number.isFinite(Date.parse(timestamp))
    || new Date(timestamp).toISOString().slice(0, 10) !== timestamp.slice(0, 10)) {
    throw new Error('Invalid evaluation generatedAt');
  }
  if (!Array.isArray(evaluation.evaluations) || !Array.isArray(evaluation.closeouts)) {
    throw new Error('Evaluation arrays unavailable');
  }
  // Keep the same projected fields as the historic index.ndjson record.
  const entry = pick(evaluation, [
    'schemaVersion', 'generatedAt', 'evaluationFingerprint', 'sourceCommit',
    'status', 'rubricVersion', 'eventPolicyVersion', 'evidenceCoveragePolicyVersion',
    'closeoutPolicyVersion', 'prospective', 'hkoTruth', 'closeoutSummary'
  ]);
  entry.awaiting = pick(evaluation.awaiting, [
    'status', 'activeHkoCaseIds', 'pendingSignalsByCase'
  ]);
  entry.closeouts = evaluation.closeouts.map(item => pick(item, [
    'caseId', 'signal', 'closedAt', 'closeoutReason', 'forecastOutcome', 'evidenceCoverage'
  ]));
  entry.evaluations = evaluation.evaluations.map(item => pick(item, [
    'status', 'signal', 'caseId', 'truth', 'grades', 'lifecycle', 'evidenceCoverage'
  ]));
  return entry;
}

function writeEvaluationShard(evaluation, dataRoot) {
  const entry = buildIndexEntry(evaluation);
  const [year, month, day] = evaluation.generatedAt.slice(0, 10).split('-');
  const relativePath = path.posix.join('index-shards', year, month, day,
    evaluation.evaluationFingerprint + '.json');
  const destination = path.join(dataRoot, ...relativePath.split('/'));
  const bytes = Buffer.from(JSON.stringify(entry) + '\n', 'utf8');
  if (bytes.length > MAX_SHARD_BYTES) {
    throw new Error('Evaluation index shard exceeds 8 MiB; split required');
  }
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  if (fs.existsSync(destination)) {
    const old = fs.readFileSync(destination);
    if (!old.equals(bytes)) throw new Error('Immutable evaluation shard differs: ' + relativePath);
    return {relativePath, bytes:bytes.length, alreadyPresent:true, schemaVersion:SHARD_SCHEMA};
  }
  fs.writeFileSync(destination, bytes, {flag:'wx'});
  return {relativePath, bytes:bytes.length, alreadyPresent:false, schemaVersion:SHARD_SCHEMA};
}

if (require.main === module) {
  if (process.argv.length !== 4) {
    console.error('Usage: node persist-hk-signal-evaluation-shard.cjs <evaluation.json> <data-branch-root>');
    process.exitCode = 2;
  } else {
    try {
      const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
      const result = writeEvaluationShard(value, path.resolve(process.argv[3]));
      console.log(JSON.stringify(result));
    } catch (error) {
      console.error(error.stack || String(error));
      process.exitCode = 1;
    }
  }
}

module.exports = {SHARD_SCHEMA, MAX_SHARD_BYTES, buildIndexEntry, writeEvaluationShard};
