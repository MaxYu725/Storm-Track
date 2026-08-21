import assert from 'node:assert/strict';
import { selectModelAsOf, createHistoricalReplayAdapter } from '../workers/storm-analysis/src/historical-replay-adapter.js';
import { previewPersistedSignalCalibrationTraining, runPersistedSignalCalibrationTraining } from '../workers/storm-analysis/src/signal-training-runner.js';
import { createSignalTrainingRepository } from '../workers/storm-analysis/src/signal-training-repository.js';

const models = [
  { model_version:'m1', activated_at:'2020-01-01T00:00:00Z', retired_at:'2021-01-01T00:00:00Z', weights_json:'{"HKO":1}' },
  { model_version:'m2', activated_at:'2021-01-01T00:00:00Z', retired_at:null, weights_json:'{"JMA":1}' }
];
assert.equal(selectModelAsOf(models, '2020-06-01').modelVersion, 'm1');
assert.equal(selectModelAsOf(models, '2022-06-01').modelVersion, 'm2');
assert.equal(selectModelAsOf(models, '2019-06-01').modelVersion, 'builtin-equal-v1');

class Statement {
  constructor(db, sql){this.db=db;this.sql=sql;this.params=[];}
  bind(...params){this.params=params;return this;}
  async all(){
    if(this.sql.includes('FROM forecast_snapshots')) return {results:this.db.snapshots};
    if(this.sql.includes('FROM signal_outcomes')) return {results:this.db.outcomes};
    if(this.sql.includes('FROM model_versions')) return {results:this.db.models};
    return {results:[]};
  }
}
class ReadDb { constructor(){this.snapshots=[];this.outcomes=[];this.models=[];} prepare(sql){return new Statement(this,sql);} }
{
  const db = new ReadDb();
  db.models = models;
  const snapshot = { referencePoint:{lat:22.3,lon:114.2}, comparison:{referenceBaseTime:'2020-06-01T00:00:00Z'}, sources:{} };
  db.snapshots = [
    {snapshot_id:'s1',storm_key:'A',as_of:'2020-06-01T00:00:00Z',eligible_for_walkforward:1,snapshot_json:JSON.stringify(snapshot),signal_inputs_json:'{"generatedAt":"2020-06-01T00:00:00Z"}',source_availability_json:'{}',fingerprint:'fp1'},
    {snapshot_id:'s2',storm_key:'B',as_of:'2020-06-01T00:00:00Z',eligible_for_walkforward:1,snapshot_json:JSON.stringify(snapshot),signal_inputs_json:'{}',source_availability_json:'{}',fingerprint:'fp2'}
  ];
  db.outcomes = [
    {outcome_id:'o1',storm_key:'A',source:'HKO',signal_system_era:'modern',highest_signal:'8NE',official_hko:1,fingerprint:'ofp1'},
    {outcome_id:'o2',storm_key:'B',source:'HKO',signal_system_era:'modern',highest_signal:'3',official_hko:0,fingerprint:'ofp2'}
  ];
  const fakeImpact = {};
  const adapter = createHistoricalReplayAdapter(db, {
    engines:{impact:fakeImpact},
    buildWeightedConsensusTrack(snapshotArg, model){return{schemaVersion:'weighted-consensus-track/v1',available:true,modelVersion:model.modelVersion,points:[{time:'2020-06-01T00:00:00Z'}]};},
    buildWeightedHongKongImpact(track){return{schemaVersion:'weighted-hk-impact/v1',available:true,closestApproach:{distanceKm:100,time:'2020-06-01T12:00:00Z'},sourceTrackVersion:track.schemaVersion};}
  });
  const dataset = await adapter.loadTrainingDataset();
  assert.equal(dataset.storms.length, 1);
  assert.equal(dataset.storms[0].stormKey, 'A');
  assert.equal(dataset.storms[0].outcome.officialHko, true);
  assert.equal(dataset.storms[0].cases[0].replayModel.modelVersion, 'm1');
  assert.equal(dataset.semantics.currentChampionNotBackfilledIntoHistory, true);
}

{
  const calls=[];
  const adapter={async loadTrainingDataset(){return{datasetFingerprint:'datafp',coverage:{eligibleStorms:10,eligibleCases:30},storms:[{stormKey:'A',outcome:{officialHko:true,signalSystemEra:'modern',highestSignal:'3'},cases:[]}]};}};
  const repository={
    async beginRun(meta){calls.push(['begin',meta]);return{status:'running',runId:meta.runId};},
    async completeRun(runId,result){calls.push(['complete',runId,result.challenger.profileRow.role]);return{status:'completed',runId,challengerProfileId:'c1',eligibleForPromotion:false,promotionPerformed:false};},
    async failRun(){throw new Error('unexpected fail');}
  };
  const trainer={TRAINER_VERSION:'signal-calibration-walkforward-trainer/v1',async runSignalCalibrationWalkForward(input){
    assert.equal(input.challengerProfileId,'c1');
    assert.equal(input.storms.length,1);
    return{challenger:{profileRow:{profile_id:'c1',role:'challenger'},eligibleForPromotion:false,gate:{failedGates:['x']}},replay:{eligibleStorms:1,holdoutStormCount:0,usableChallengerPredictionCount:0}};
  }};
  const signalRiskRepository={async getChampion(){return{profileId:'champ',profile:{schemaVersion:'hko-signal-calibration-profile/v1'}};}};
  const calibration={buildHkoSignalCalibrationProfile(){}};
  const dependencies={adapter,repository,trainer,signalRiskRepository,calibration};
  const trainingInput={runId:'r1',challengerProfileId:'c1',championProfileProvenance:{holdoutIndependent:false}};
  const preview=await previewPersistedSignalCalibrationTraining({}, trainingInput, dependencies);
  assert.equal(preview.dataset.datasetFingerprint,'datafp');
  assert.equal(preview.semantics.datasetFingerprintMustBeConfirmedForRun,true);
  const result=await runPersistedSignalCalibrationTraining({}, {...trainingInput,expectedDatasetFingerprint:preview.dataset.datasetFingerprint}, dependencies);
  assert.equal(result.status,'completed');
  assert.equal(result.persisted.promotionPerformed,false);
  assert.deepEqual(calls.map(x=>x[0]),['begin','complete']);
}


{
  class RepoStatement {
    constructor(db, sql){this.db=db;this.sql=sql;this.params=[];}
    bind(...params){this.params=params;return this;}
    async first(){
      this.db.calls.push(['first',this.sql,this.params]);
      if(this.sql.includes('FROM signal_calibration_profiles')) return this.db.profile;
      return null;
    }
    async run(){this.db.calls.push(['run',this.sql,this.params]);return{success:true};}
  }
  class RepoDb {
    constructor(){this.calls=[];this.profile=null;}
    prepare(sql){return new RepoStatement(this,sql);}
    async batch(statements){this.calls.push(['batch',statements.map(s=>[s.sql,s.params])]);return statements.map(()=>({success:true}));}
  }
  const db=new RepoDb();
  const repo=createSignalTrainingRepository(db);
  const begin=await repo.beginRun({runId:'run-x',inputFingerprint:'fp-x',challengerProfileId:'challenger-x',datasetFingerprint:'data-x',trainerVersion:'trainer-v1'});
  assert.equal(begin.status,'running');
  const trainerResult={
    challenger:{
      profileRow:{profile_id:'challenger-x',profile_version:'hko-signal-calibration-profile/v1',role:'challenger',training_window_start:null,training_window_end:null,storm_count:8,sample_count:24,profile_json:'{"x":1}',metrics_json:'{"m":1}'},
      eligibleForPromotion:true,gate:{eligibleForPromotion:true},walkForwardEvaluation:{metrics:{}},championEvaluation:{metrics:{}}
    },
    replay:{eligibleStorms:8,usableChallengerPredictionCount:24,holdoutStormCount:5}
  };
  const completed=await repo.completeRun('run-x',trainerResult);
  assert.equal(completed.status,'completed');
  assert.equal(completed.eligibleForPromotion,true);
  assert.equal(completed.promotionPerformed,false);
  const batch=db.calls.find(call=>call[0]==='batch');
  assert.ok(batch);
  assert.ok(batch[1][0][0].includes("'challenger'"));
  assert.ok(batch[1][1][0].includes('eligible_for_promotion'));
}

console.log('storm-analysis AI-13 tests: OK');
