'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  EXPECTED_OPERATIONAL_WORKFLOWS, AUDIT_WORKFLOW, CANDIDATE_WORKFLOWS,
  assertProtection, scanRuns, buildAudit, writeReports
} = require('../scripts/audit-legacy-actions-runs.cjs');
const mainList = [...EXPECTED_OPERATIONAL_WORKFLOWS, AUDIT_WORKFLOW];

function mkRun(id, path, createdAt, status = 'completed') {
  return {id, path, created_at:createdAt, head_branch:'feature/old',
    workflow_id:123, status, conclusion:status==='completed'?'success':null};
}
function fakeGitHub(runs, artifacts = {}) {
  return {rest:{
    repos:{
      getBranch:async()=>({data:{commit:{sha:'123abc'}}}),
      getContent:async()=>({data:mainList.map(p=>({type:'file',name:p.split('/').at(-1)}))}),
      get:async()=>({data:{created_at:'2026-08-05T00:00:00Z'}})
    },
    actions:{
      listWorkflowRunsForRepo:async({created,page,per_page})=>{
        const [min,max]=created.split('..').map(Date.parse);
        const items=runs.filter(r=>Date.parse(r.created_at)>=min&&Date.parse(r.created_at)<=max);
        return {data:{total_count:items.length,workflow_runs:items.slice((page-1)*per_page,page*per_page)}};
      },
      listWorkflowRunArtifacts:async({run_id,page,per_page})=>{
        const items=artifacts[run_id]||[];
        return {data:{total_count:items.length,artifacts:items.slice((page-1)*per_page,page*per_page)}};
      }
    }
  }};
}
test('exact 17 official plus one maintenance workflow are protected',()=>{
  assert.equal(EXPECTED_OPERATIONAL_WORKFLOWS.length,17);
  assert.equal(CANDIDATE_WORKFLOWS.length,12);
  assertProtection(mainList);
  assert.throws(()=>assertProtection(mainList.slice(1)),/safety check failed/);
  assert.throws(()=>assertProtection([...mainList,CANDIDATE_WORKFLOWS[0]]),/safety check failed/);
  assert.throws(()=>assertProtection([...mainList,'.github/workflows/random.yml']),/safety check failed/);
});
test('adaptive date-window pagination handles more than 1000 Runs',async()=>{
  const start=Date.parse('2026-08-05T00:00:00Z');
  const runs=Array.from({length:1100},(_,i)=>mkRun(i+1,
    i===200?CANDIDATE_WORKFLOWS[0]:EXPECTED_OPERATIONAL_WORKFLOWS[0],
    new Date(start+i*1000).toISOString()));
  const stats={apiRunListCalls:0,windowSplits:0,scannedWindows:0};
  const seen=new Set();
  await scanRuns(fakeGitHub(runs),'MaxYu725','Storm-Track',
    start,Date.parse('2026-08-06T00:00:00Z'),r=>seen.add(r.id),stats);
  assert.equal(seen.size,1100);
  assert.ok(stats.windowSplits>0);
  assert.ok(stats.apiRunListCalls>=11);
});
test('protected runs excluded and multi-page artifacts enumerated',async()=>{
  const when='2026-08-05T12:00:00Z';
  const runs=[
    mkRun(1,EXPECTED_OPERATIONAL_WORKFLOWS[0],when),
    mkRun(2,CANDIDATE_WORKFLOWS[0],when),
    mkRun(3,CANDIDATE_WORKFLOWS[1],when,'in_progress'),
    mkRun(4,'.github/workflows/ai22-regression.yml',when)
  ];
  const artifacts=Array.from({length:105},(_,i)=>({
    id:i+1,name:'archive-'+i,size_in_bytes:1024,expired:i===0
  }));
  const report=await buildAudit({github:fakeGitHub(runs,{2:artifacts}),
    owner:'MaxYu725',repo:'Storm-Track',nowMs:Date.parse('2026-08-06T00:00:00Z')});
  assert.equal(report.dryRun,true);
  assert.equal(report.apiWriteCalls,0);
  assert.equal(report.summary.scannedDistinctRuns,4);
  assert.equal(report.summary.candidateRuns,2);
  assert.equal(report.summary.completedForReview,1);
  assert.equal(report.summary.skippedNotCompleted,1);
  assert.equal(report.summary.candidateArtifacts,105);
  assert.equal(report.summary.nonExpiredArtifacts,104);
  assert.equal(report.summary.nonExpiredArtifactBytes,104*1024);
  assert.equal(report.summary.apiArtifactListCalls,2);
});
test('report includes exact run IDs and artifact CSV',async()=>{
  const run=mkRun(100,CANDIDATE_WORKFLOWS[1],'2026-08-05T12:00:00Z');
  const report=await buildAudit({github:fakeGitHub([run]),
    owner:'MaxYu725',repo:'Storm-Track',nowMs:Date.parse('2026-08-06T00:00:00Z')});
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'storm-cleanup-test-'));
  try{
    const summary=await writeReports(report,dir);
    assert.match(summary,/No Runs or Artifacts were deleted/);
    assert.match(await fs.readFile(path.join(dir,'runs.csv'),'utf8'),/"100"/);
    assert.match(await fs.readFile(path.join(dir,'audit.json'),'utf8'),/"apiWriteCalls": 0/);
    assert.match(await fs.readFile(path.join(dir,'artifacts.csv'),'utf8'),/"artifact_id"/);
  }finally{
    await fs.rm(dir,{recursive:true,force:true});
  }
});
test('abort when repository identity or main SHA changes',async()=>{
  const github=fakeGitHub([]);
  await assert.rejects(buildAudit({github,owner:'someone-else',repo:'Storm-Track'}),/Repository identity mismatch/);
  let n=0;
  github.rest.repos.getBranch=async()=>({data:{commit:{sha:++n===1?'before':'after'}}});
  await assert.rejects(buildAudit({github,owner:'MaxYu725',repo:'Storm-Track',
    nowMs:Date.parse('2026-08-06T00:00:00Z')}),/main moved during audit/);
});
