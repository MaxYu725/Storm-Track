'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  SHARD_SCHEMA, MAX_SHARD_BYTES, buildIndexEntry, writeEvaluationShard
} = require('../scripts/persist-hk-signal-evaluation-shard.cjs');

const fingerprint = '0123456789abcdef'.repeat(4);
function sampleEvaluation() {
  return {
    schemaVersion:'hk-signal-evaluator/v2',
    generatedAt:'2026-10-17T05:45:12.345Z',
    evaluationFingerprint:fingerprint,
    sourceCommit:'f'.repeat(40),
    status:'evaluated',
    rubricVersion:'hk-signal-validation-rubric/v1',
    eventPolicyVersion:'hk-signal-event-policy/v1',
    evidenceCoveragePolicyVersion:'hk-signal-evidence-coverage/v1',
    closeoutPolicyVersion:'hk-signal-closeout-policy/v1',
    prospective:{trustedRecorderSchema:'beta-prospective-recorder/v2'},
    hkoTruth:{signalEventCounts:{T1:1,T3:0,T8:0}},
    awaiting:{status:'ready',activeHkoCaseIds:[],pendingSignalsByCase:{}},
    closeoutSummary:{count:1},
    closeouts:[{caseId:'STC-2026-JMA-TC2621',signal:'T1',closedAt:'2026-09-01T00:00:00Z',closeoutReason:'test',forecastOutcome:'not-issued',evidenceCoverage:{count:2}}],
    evaluations:[{caseId:'STC-2026-JMA-TC2621',signal:'T1',status:'evaluated',
      truth:{eventTime:'2026-08-31T18:10:00+08:00'},grades:{timing:'ok'},
      lifecycle:{ended:true},evidenceCoverage:{count:2},privateDebug:'exclude'}],
    largeInternalDebug:'exclude'
  };
}

test('shard preserves the historic index projection, not raw large evaluation', () => {
  const input = sampleEvaluation(), entry = buildIndexEntry(input);
  assert.equal(entry.schemaVersion, input.schemaVersion);
  assert.equal(entry.evaluationFingerprint, fingerprint);
  assert.equal(entry.evaluations[0].signal, 'T1');
  assert.deepEqual(entry.evaluations[0].truth, input.evaluations[0].truth);
  assert.equal(entry.evaluations[0].privateDebug, undefined);
  assert.equal(entry.largeInternalDebug, undefined);
  assert.equal(entry.closeouts[0].caseId, input.closeouts[0].caseId);
  assert.equal(typeof entry.awaiting.pendingSignalsByCase, 'object');
});

test('never edits legacy index.ndjson or existing case evidence', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'web01-shard-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'cases'),{recursive:true});
  fs.writeFileSync(path.join(root,'index.ndjson'),'immutable historic evidence\n');
  fs.writeFileSync(path.join(root,'cases','sample.json'),'unchanged');
  const result = writeEvaluationShard(sampleEvaluation(),root);
  assert.equal(result.relativePath,'index-shards/2026/10/17/'+fingerprint+'.json');
  assert.equal(result.schemaVersion,SHARD_SCHEMA);
  assert.equal(result.alreadyPresent,false);
  assert.ok(result.bytes < MAX_SHARD_BYTES);
  assert.equal(fs.readFileSync(path.join(root,'index.ndjson'),'utf8'),'immutable historic evidence\n');
  assert.equal(fs.readFileSync(path.join(root,'cases','sample.json'),'utf8'),'unchanged');
  const entry = JSON.parse(fs.readFileSync(path.join(root,result.relativePath),'utf8'));
  assert.equal(entry.evaluationFingerprint, fingerprint);
  assert.equal(writeEvaluationShard(sampleEvaluation(),root).alreadyPresent,true);
  const conflict = sampleEvaluation();
  conflict.status='truth-unresolved';
  assert.throws(() => writeEvaluationShard(conflict,root),/Immutable evaluation shard differs/);
});

test('invalid fingerprint/time and unavailable arrays fail closed', () => {
  const bad = sampleEvaluation();bad.evaluationFingerprint='../outside';
  assert.throws(() => buildIndexEntry(bad),/Invalid evaluation fingerprint/);
  bad.evaluationFingerprint=fingerprint;bad.generatedAt='2026-02-30T05:45:12Z';
  assert.throws(() => buildIndexEntry(bad),/Invalid evaluation generatedAt/);
  bad.generatedAt='2026-10-17T05:45:12.345Z';delete bad.closeouts;
  assert.throws(() => buildIndexEntry(bad),/Evaluation arrays unavailable/);
});

test('oversized shard aborts without writing a partial index', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'web01-shard-size-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const value = sampleEvaluation();
  value.prospective={massive:'x'.repeat(MAX_SHARD_BYTES)};
  assert.throws(()=>writeEvaluationShard(value,root),/exceeds 8 MiB/);
  assert.equal(fs.existsSync(path.join(root,'index-shards')),false);
});

test('workflow uses shard writer and excludes the legacy index from staging',()=>{
  const text=fs.readFileSync(path.join(__dirname,'..','.github','workflows','hk-signal-evaluator.yml'),'utf8');
  assert.match(text,/node --check scripts\/persist-hk-signal-evaluation-shard\.cjs/);
  assert.match(text,/node --test tests\/hk-signal-evaluation-index-shards\.test\.cjs/);
  assert.match(text,/node \/tmp\/persist-hk-signal-evaluation-shard\.cjs \/tmp\/hk-signal-evaluation\.json "\$PWD"/);
  assert.match(text,/git add -- latest\.json index-shards cases/);
  assert.doesNotMatch(text,/>> index\.ndjson/);
  assert.doesNotMatch(text,/git add [^\n]*index\.ndjson/);
});
