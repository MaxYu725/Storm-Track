'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const PREFIX = '.github/workflows/';
const EXPECTED_OPERATIONAL_WORKFLOWS = [
  'agency-baseline-prospective-recorder.yml',
  'beta-prospective-recorder.yml',
  'build-android-ultra.yml',
  'consensus-track-prospective-recorder.yml',
  'consensus-track-truth-readiness.yml',
  'consensus-track-visual-beta.yml',
  'deploy-pages.yml',
  'historical-case-replay-inputs.yml',
  'hk-signal-beta-validation.yml',
  'hk-signal-evaluator.yml',
  'hk-signal-v2-retrospective-audit.yml',
  'hk-situation-analysis-cloudflare-shadow.yml',
  'hk-situation-analysis-openai-shadow.yml',
  'hk-situation-analysis-prospective-audit.yml',
  'hk-situation-analysis-shadow-recorder.yml',
  'hko-local-wind-shadow-recorder.yml',
  'hko-warning-truth-recorder.yml'
].map(n => PREFIX + n);
const AUDIT_WORKFLOW = PREFIX + 'legacy-actions-cleanup-audit.yml';
const CANDIDATE_WORKFLOWS = [
  'apply-checkpoint2-lifecycle.yml',
  'apply-checkpoint3-ux.yml',
  'apply-checkpoint4-cleanup.yml',
  'apply-d1-cross-advisory-alpha4.yml',
  'apply-live-ui-checkpoint.yml',
  'apply-recovered-worker-d1-hotfix.yml',
  'd1-hotfix-validation.yml',
  'frontend-threat-ui-patch.yml',
  'narra-r2-main-integration-patch.yml',
  'one-shot-gaenari-identity-fix.yml',
  'patch-beta-prospective-recorder.yml',
  'readme-narra-v2-02-patch.yml'
].map(n => PREFIX + n);
const PROTECTED = new Set([...EXPECTED_OPERATIONAL_WORKFLOWS, AUDIT_WORKFLOW]);
const CANDIDATES = new Set(CANDIDATE_WORKFLOWS);
const PER_PAGE = 100, WINDOW_MAX = 850;

function assertProtection(paths) {
  if (!Array.isArray(paths) || paths.some(p => typeof p !== 'string')) {
    throw new Error('main workflow listing unavailable');
  }
  const found = new Set(paths);
  if (found.size !== paths.length || found.size !== PROTECTED.size ||
      [...found].some(p => !PROTECTED.has(p))) {
    throw new Error('main workflow safety check failed: unexpected=' +
      JSON.stringify([...found].filter(p => !PROTECTED.has(p))) + ' missing=' +
      JSON.stringify([...PROTECTED].filter(p => !found.has(p))));
  }
  if ([...CANDIDATES].some(p => found.has(p))) throw new Error('Candidate active on main');
}
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
function listing(resp, field) {
  const data = resp && resp.data;
  if (!Number.isSafeInteger(data?.total_count) || !Array.isArray(data?.[field])) {
    throw new Error('Invalid API list response: ' + field);
  }
  return {total: data.total_count, items: data[field]};
}
async function scanRuns(github, owner, repo, start, end, onRun, stats) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) {
    throw new Error('Invalid run scan bounds');
  }
  const created = iso(start) + '..' + iso(end);
  const args = {owner, repo, created, per_page: PER_PAGE};
  const first = listing(await github.rest.actions.listWorkflowRunsForRepo({...args, page: 1}), 'workflow_runs');
  stats.apiRunListCalls++;
  if (first.total > WINDOW_MAX) {
    const left = Math.floor(start / 1000), right = Math.floor(end / 1000);
    if (right - left < 2) throw new Error('Dense unsplittable window: ' + created);
    const mid = Math.floor((left + right) / 2) * 1000;
    if (mid <= start || mid >= end) throw new Error('Cannot split window: ' + created);
    stats.windowSplits++;
    await scanRuns(github, owner, repo, start, mid, onRun, stats);
    await scanRuns(github, owner, repo, mid, end, onRun, stats);
    return;
  }
  stats.scannedWindows++;
  const runs = first.items.slice();
  for (let page = 2; runs.length < first.total; page++) {
    if (page > Math.ceil(first.total / PER_PAGE)) throw new Error('Run pagination incomplete: ' + created);
    const next = listing(await github.rest.actions.listWorkflowRunsForRepo({...args, page}), 'workflow_runs');
    stats.apiRunListCalls++;
    if (next.total !== first.total || !next.items.length) throw new Error('Run listing changed: ' + created);
    runs.push(...next.items);
  }
  if (runs.length !== first.total) throw new Error('Run count mismatch: ' + created);
  for (const run of runs) onRun(run);
}
async function readArtifacts(github, owner, repo, runId, stats) {
  const items = []; let total = null;
  for (let page = 1; ; page++) {
    const result = listing(await github.rest.actions.listWorkflowRunArtifacts({
      owner, repo, run_id: runId, per_page: PER_PAGE, page
    }), 'artifacts');
    stats.apiArtifactListCalls++;
    if (total === null) total = result.total;
    if (total !== result.total) throw new Error('Artifact list changed for run ' + runId);
    items.push(...result.items);
    if (items.length >= total) break;
    if (!result.items.length || page >= Math.ceil(total / PER_PAGE)) {
      throw new Error('Artifact pagination incomplete for run ' + runId);
    }
  }
  if (items.length !== total) throw new Error('Artifact total mismatch for run ' + runId);
  return items.map(a => {
    if (!Number.isSafeInteger(a.id) || !Number.isSafeInteger(a.size_in_bytes) || a.size_in_bytes < 0) {
      throw new Error('Malformed artifact in run ' + runId);
    }
    return {id: a.id, name: a.name, sizeBytes: a.size_in_bytes,
      expired: a.expired === true, createdAt: a.created_at || null, expiresAt: a.expires_at || null};
  });
}
function safeCell(value) {
  let text = String(value ?? '');
  if (/^\s*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
const csv = (heads, rows) => [heads.map(safeCell).join(','),
  ...rows.map(row => row.map(safeCell).join(','))].join('\n') + '\n';
const mib = bytes => (bytes / (1024 * 1024)).toFixed(2);

async function buildAudit({github, owner, repo, nowMs = Date.now()}) {
  if (owner !== 'MaxYu725' || repo !== 'Storm-Track') throw new Error('Repository identity mismatch');
  const mainSha = (await github.rest.repos.getBranch({owner, repo, branch:'main'})).data?.commit?.sha;
  if (!mainSha) throw new Error('Cannot read main SHA');
  const dir = (await github.rest.repos.getContent({
    owner, repo, path:'.github/workflows', ref:mainSha
  })).data;
  if (!Array.isArray(dir)) throw new Error('Cannot read main workflow directory');
  assertProtection(dir.filter(e => e.type === 'file' && /\.ya?ml$/.test(e.name)).map(e => PREFIX + e.name));
  const repoCreated = Date.parse((await github.rest.repos.get({owner, repo})).data?.created_at);
  if (!Number.isFinite(repoCreated) || repoCreated > nowMs) throw new Error('Invalid repo creation time');
  const since = Math.floor(repoCreated / 1000) * 1000, until = Math.floor(nowMs / 1000) * 1000;
  const stats = {scannedWindows:0, windowSplits:0, apiRunListCalls:0, apiArtifactListCalls:0};
  const seen = new Set(), candidates = [];
  await scanRuns(github, owner, repo, since, until, run => {
    if (!Number.isSafeInteger(run?.id) || typeof run.path !== 'string') {
      throw new Error('GitHub run lacks ID or workflow path');
    }
    if (seen.has(run.id)) return;
    seen.add(run.id);
    if (PROTECTED.has(run.path) || !CANDIDATES.has(run.path)) return;
    candidates.push({
      id:run.id, workflowPath:run.path, workflowId:run.workflow_id,
      branch:run.head_branch || null, status:run.status,
      conclusion:run.conclusion || null, createdAt:run.created_at,
      url:run.html_url || 'https://github.com/' + owner + '/' + repo + '/actions/runs/' + run.id,
      disposition:run.status === 'completed' ? 'review_only' : 'skip_not_completed', artifacts:[]
    });
  }, stats);
  candidates.sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.id - a.id);
  for (const run of candidates) {
    if (run.disposition === 'review_only') {
      run.artifacts = await readArtifacts(github, owner, repo, run.id, stats);
    }
  }
  const shaAfter = (await github.rest.repos.getBranch({owner, repo, branch:'main'})).data?.commit?.sha;
  if (shaAfter !== mainSha) throw new Error('main moved during audit; retry');
  const allArtifacts = candidates.flatMap(r => r.artifacts);
  const active = allArtifacts.filter(a => !a.expired);
  const workflows = Object.fromEntries(CANDIDATE_WORKFLOWS.map(n => [n, {
    runs:0, reviewRuns:0, artifacts:0, nonExpiredBytes:0
  }]));
  for (const run of candidates) {
    const item = workflows[run.workflowPath];
    item.runs++;
    if (run.disposition === 'review_only') item.reviewRuns++;
    item.artifacts += run.artifacts.length;
    item.nonExpiredBytes += run.artifacts.filter(a => !a.expired).reduce((s,a) => s + a.sizeBytes,0);
  }
  const bytes = active.reduce((s,a) => s + a.sizeBytes, 0);
  return {
    schemaVersion:'storm-track-legacy-actions-dry-run/v1',
    dryRun:true, deletionEnabled:false, apiWriteCalls:0,
    repo:owner + '/' + repo, auditedAt:new Date(nowMs).toISOString(), mainSha,
    protection:{operationalWorkflows:EXPECTED_OPERATIONAL_WORKFLOWS, auditWorkflow:AUDIT_WORKFLOW},
    candidateWorkflowPaths:CANDIDATE_WORKFLOWS, scope:{from:iso(since), to:iso(until), allBranches:true},
    summary:{
      scannedDistinctRuns:seen.size, candidateRuns:candidates.length,
      completedForReview:candidates.filter(r => r.disposition === 'review_only').length,
      skippedNotCompleted:candidates.filter(r => r.disposition !== 'review_only').length,
      candidateArtifacts:allArtifacts.length, nonExpiredArtifacts:active.length,
      nonExpiredArtifactBytes:bytes, estimatedPotentialReleaseMiB:mib(bytes), ...stats
    },
    workflows, runs:candidates
  };
}
async function writeReports(report, outputDir) {
  await fs.mkdir(outputDir,{recursive:true});
  const runs = report.runs;
  const artifactRows = runs.flatMap(r => r.artifacts.map(a => [
    r.id,r.workflowPath,r.branch,a.id,a.name,a.sizeBytes,a.expired,a.createdAt,a.expiresAt
  ]));
  await Promise.all([
    fs.writeFile(path.join(outputDir,'audit.json'),JSON.stringify(report,null,2)+'\n'),
    fs.writeFile(path.join(outputDir,'runs.csv'),csv(
      ['run_id','workflow_path','branch','status','conclusion','created_at','disposition','artifact_count','non_expired_artifact_bytes','run_url'],
      runs.map(r => [r.id,r.workflowPath,r.branch,r.status,r.conclusion,r.createdAt,r.disposition,
        r.artifacts.length,r.artifacts.filter(a=>!a.expired).reduce((s,a)=>s+a.sizeBytes,0),r.url]))),
    fs.writeFile(path.join(outputDir,'artifacts.csv'),csv(
      ['run_id','workflow_path','branch','artifact_id','name','size_bytes','expired','created_at','expires_at'],
      artifactRows))
  ]);
  const lines = [
    '# Storm-Track legacy GitHub Actions: read-only dry run','',
    'Time: ' + report.auditedAt + '; main SHA: ' + report.mainSha,'',
    '**No Runs or Artifacts were deleted.** GitHub token has no Actions write permission.','',
    'Scanned distinct Runs: **' + report.summary.scannedDistinctRuns + '**.',
    'Candidate Runs: **' + report.summary.candidateRuns + '**; completed for review: **' +
      report.summary.completedForReview + '**; skipped (non-completed): **' + report.summary.skippedNotCompleted + '**.',
    'Artifacts: **' + report.summary.candidateArtifacts + '**; non-expired: **' +
      report.summary.nonExpiredArtifacts + '**; logical size: **' +
      report.summary.estimatedPotentialReleaseMiB + ' MiB** (not guaranteed quota reduction).','',
    '| Candidate YAML | Runs | Completed | Artifacts | Non-expired MiB |',
    '|---|---:|---:|---:|---:|',
    ...Object.entries(report.workflows).map(([key,v]) => '| ' + key.slice(PREFIX.length) +
      ' | ' + v.runs + ' | ' + v.reviewRuns + ' | ' + v.artifacts + ' | ' + mib(v.nonExpiredBytes) + ' |'),
    '',
    'Review runs.csv and artifacts.csv. A separate explicit approval is required before any real deletion.'
  ];
  const summary = lines.join('\n') + '\n';
  await fs.writeFile(path.join(outputDir,'SUMMARY.md'),summary);
  return summary;
}
async function runAudit({github,context,core}) {
  if (context.repo.owner !== 'MaxYu725' || context.repo.repo !== 'Storm-Track' ||
      context.ref !== 'refs/heads/main') throw new Error('Run only from Storm-Track main');
  const report = await buildAudit({github,owner:context.repo.owner,repo:context.repo.repo});
  const summary = await writeReports(report,path.resolve('legacy-actions-audit'));
  core.info('Read-only audit completed. Candidate Runs: ' + report.summary.candidateRuns);
  await core.summary.addRaw(summary).write();
  return report;
}
module.exports = {EXPECTED_OPERATIONAL_WORKFLOWS,AUDIT_WORKFLOW,CANDIDATE_WORKFLOWS,
  assertProtection,scanRuns,buildAudit,writeReports,runAudit};
