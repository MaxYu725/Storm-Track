import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'storm-v2-corpus-'));
const dir=path.join(root,'observations','2026','08','31');
fs.mkdirSync(dir,{recursive:true});
const fingerprint='abc123', groupKey='TEST-STORM';
fs.writeFileSync(path.join(root,'case-index.ndjson'),`${JSON.stringify({caseId:'STC-TEST-001',captureFingerprint:fingerprint,rawGroupKey:groupKey})}\n`);

const record={
  schemaVersion:'beta-prospective-recorder/v2',capturedAt:'2026-08-31T00:00:00.000Z',captureFingerprint:fingerprint,
  observations:[{
    observedAt:'2026-08-31T00:00:00.000Z',group:{key:groupKey,displayName:'Comparator Test'},
    sources:{HKO:{bulletinTime:'2026-08-31T00:00:00Z',forecastCount:2,current:{time:'2026-08-31T00:00:00Z',intensity:'Tropical Storm'}},CMA:{bulletinTime:'2026-08-31T00:00:00Z',forecastCount:2,current:{time:'2026-08-31T00:00:00Z',intensity:'Tropical Storm'}}},
    analysis:{
      available:true,generatedAt:'2026-08-31T00:00:00.000Z',
      signalInputs:{coverage:{usableAgencyCount:2},featureVector:{usableAgencyCount:2}},
      threatAssessment:{
        summary:{currentDistanceKm:655,forecastMinimumKm:388},
        analyzers:{directApproach:{confidence:.54},directDepart:{confidence:.03},reApproach:{confidence:0},quasiStationary:{confidence:0}},
        timeline:[{leadHours:12,validTime:'2026-08-31T12:00:00Z',distanceMedianKm:388}]
      },
      basicForecast:{
        schemaVersion:'basic-hk-signal-forecast/v1',available:true,generatedAt:'2026-08-31T00:00:00.000Z',
        impact:{closestApproach:{time:'2026-08-31T12:00:00Z',distanceKm:388}},
        signals:{
          T1:{likelihood:'likely',riskIndex:.72,confidenceIndex:.51,persistenceHours:25,estimatedWindow:null,strongestCheckpoint:{validTime:'2026-08-31T12:00:00Z',supportAgencyCount:2,totalAgencyCount:2}},
          T3:{likelihood:'unlikely',riskIndex:.2,confidenceIndex:.5,persistenceHours:0,estimatedWindow:null,strongestCheckpoint:{validTime:'2026-08-31T12:00:00Z',supportAgencyCount:0,totalAgencyCount:2}},
          T8:{likelihood:'unlikely',riskIndex:.1,confidenceIndex:.4,persistenceHours:0,estimatedWindow:null,strongestCheckpoint:{validTime:'2026-08-31T12:00:00Z',supportAgencyCount:0,totalAgencyCount:2}}
        }
      }
    }
  }]
};
fs.writeFileSync(path.join(dir,'capture.json'),`${JSON.stringify(record,null,2)}\n`);

try {
  const stdout=execFileSync(process.execPath,[path.resolve('scripts/compare-hk-signal-v2-corpus.mjs'),root],{encoding:'utf8'});
  const report=JSON.parse(stdout);
  assert.equal(report.v2Version,'hk-signal-shadow-v2/0.4');
  assert.equal(report.recordCount,1);
  assert.equal(report.observationCount,1);
  assert.equal(report.caseCount,1);
  const t1=report.cases[0].signals.T1;
  assert.equal(t1.v1.likely,1);
  assert.equal(t1.v2.possible,1);
  assert.equal(t1.transitions.likelyToPossible,1);
  console.log('HK Signal V2 corpus comparator tests: OK');
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}