const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

(async () => {
  const recorder = await import('../scripts/build-hk-situation-analysis-shadow-packets.mjs');

  const corpusRoot = mkdtempSync(join(tmpdir(), 'storm-ai-shadow-'));
  const dayDir = join(corpusRoot, 'observations', '2026', '09', '02');
  mkdirSync(dayDir, { recursive: true });

  const localWindPast = {
    schemaVersion: 'hko-local-wind-shadow-observation/v1',
    shadowVersion: 'hko-local-wind-shadow/v1',
    retrievedAt: '2026-09-02T03:21:00.000Z',
    affectsForecast: false,
    captureFingerprint: 'a'.repeat(64),
    authority: 'Hong Kong Observatory Open Data',
    stations: [{ observedAt: '2026-09-02T03:20:00.000Z', station: 'A', meanSpeedKmh: 30, maxGustKmh: 42 }],
    summary: {
      schemaVersion: 'hko-local-wind-shadow/v1',
      dataTimestamp: '2026-09-02T03:20:00.000Z',
      stationCount: 1,
      validMeanStationCount: 1,
      validGustStationCount: 1,
      meanStrongStationCount: 0,
      meanGaleStationCount: 0,
      gustStrongStationCount: 1,
      gustGaleStationCount: 0
    }
  };
  const localWindFuture = {
    ...localWindPast,
    retrievedAt: '2026-09-02T03:41:00.000Z',
    captureFingerprint: 'b'.repeat(64),
    stations: [{ observedAt: '2026-09-02T03:40:00.000Z', station: 'B', meanSpeedKmh: 50, maxGustKmh: 70 }],
    summary: { ...localWindPast.summary, dataTimestamp: '2026-09-02T03:40:00.000Z' }
  };
  writeFileSync(join(dayDir, '20260902T032000Z-past.json'), JSON.stringify(localWindPast));
  writeFileSync(join(dayDir, '20260902T034000Z-future.json'), JSON.stringify(localWindFuture));

  const observation = {
    schemaVersion: 'hk-beta-prospective-observation/v1',
    observedAt: '2026-09-02T03:31:38.347Z',
    group: { key: 'TESTSTORM', displayName: 'Test Storm', nameEn: 'TESTSTORM', nameTc: '測試' },
    sourceAgencies: ['HKO', 'CMA', 'JMA', 'CWA'],
    analysis: {
      available: true,
      generatedAt: '2026-09-02T03:30:00.000Z',
      impact: {
        closestApproach: { consensus: { distanceKm: 250, time: '2026-09-02T12:00:00.000Z' } },
        trend: { aggregate: 'approaching' },
        uncertainty: { level: 'moderate' }
      },
      signalInputs: {
        featureVector: { usableAgencyCount: 4, currentDistanceMedianKm: 400 },
        coverage: { usableAgencyCount: 4 },
        disagreement: { comparisonSpreadKm: 80 },
        officialHkoWarningContext: { provided: false }
      },
      threatAssessment: {
        summary: {
          currentDistanceKm: 400,
          forecastMinimumKm: 250,
          forecastMinimumLeadHours: 8.5,
          representativeMinimum: { distanceKm: 250, time: '2026-09-02T12:00:00.000Z' }
        },
        analyzers: {
          directApproach: { confidence: 0.7 },
          directDepart: { confidence: 0.1 },
          reApproach: { confidence: 0.2 },
          quasiStationary: { confidence: 0.1 },
          forecastEdge: { confidence: 0.2 },
          agencyDisagreement: { confidence: 0.3 },
          interpolationReliability: { confidence: 0.9 },
          windField: { confidence: 0 },
          rapidEvolution: { confidence: 0.1 }
        },
        agencies: {
          HKO: { currentDistanceKm: 390, directApproachConfidence: 0.8 }
        },
        timeline: []
      },
      basicForecast: {
        schemaVersion: 'basic-hk-signal-forecast/v1',
        available: true,
        generatedAt: '2026-09-02T03:30:00.000Z',
        signals: {
          T1: { likelihood: 'possible', riskIndex: 0.5, confidenceIndex: 0.6, persistenceHours: 10, estimatedWindow: null },
          T3: { likelihood: 'unlikely', riskIndex: 0.2, confidenceIndex: 0.5, persistenceHours: 0, estimatedWindow: null },
          T8: { likelihood: 'unlikely', riskIndex: 0.1, confidenceIndex: 0.4, persistenceHours: 0, estimatedWindow: null }
        },
        semantics: { officialHkoForecast: false }
      },
      shadowForecastV2: {
        schemaVersion: 'hk-signal-shadow-v2/0.1',
        available: true,
        generatedAt: '2026-09-02T03:30:00.000Z',
        signals: {
          T1: { likelihood: 'possible', riskIndex: 0.5, confidenceIndex: 0.6, persistenceHours: 10, estimatedWindow: null, timingState: 'left-censored-or-horizon-limited' },
          T3: { likelihood: 'unlikely', riskIndex: 0.2, confidenceIndex: 0.5, persistenceHours: 0, estimatedWindow: null, timingState: 'not-applicable' },
          T8: { likelihood: 'unlikely', riskIndex: 0.1, confidenceIndex: 0.4, persistenceHours: 0, estimatedWindow: null, timingState: 'not-applicable' }
        },
        shadow: { version: 'hk-signal-shadow-v2/0.1', adjustments: [] },
        semantics: { shadowOnly: true }
      }
    }
  };

  const betaCapture = {
    schemaVersion: 'beta-prospective-recorder/v2',
    capturedAt: '2026-09-02T03:31:39.107Z',
    captureFingerprint: 'c'.repeat(64),
    sourceCommit: 'deadbeef',
    observations: [observation]
  };
  const registry = {
    schemaVersion: 'storm-case-identity/v1',
    reconciledThrough: '2026-09-02T03:31:39.107Z',
    cases: [{ caseId: 'STC-2026-JMA-TC9999', groupKeys: ['TESTSTORM'], displayNames: ['Test Storm'] }]
  };

  const selected = recorder.selectLocalWindObservation(corpusRoot, observation.observedAt);
  assert.equal(selected.join.status, 'matched-at-or-before');
  assert.equal(selected.join.dataTimestamp, '2026-09-02T03:20:00.000Z');
  assert.equal(selected.join.futureCandidateCount, 1);
  assert.equal(selected.evidence.captureFingerprint, 'a'.repeat(64));

  const resolved = recorder.resolveCase(observation, registry);
  assert.equal(resolved.caseInfo.caseId, 'STC-2026-JMA-TC9999');
  assert.equal(resolved.resolution.method, 'case-registry-group-key');

  const first = recorder.buildPacketBatch({ betaCapture, registry, localWindCorpusRoot: corpusRoot, builtAt: '2026-09-02T03:32:00.000Z' });
  const second = recorder.buildPacketBatch({ betaCapture, registry, localWindCorpusRoot: corpusRoot, builtAt: '2026-09-02T04:00:00.000Z' });

  assert.equal(first.schemaVersion, 'hk-situation-analysis-shadow-packet-batch/v0.1');
  assert.equal(first.packetCount, 1);
  assert.equal(first.batchFingerprint, second.batchFingerprint, 'build time must not change evidence fingerprint');
  assert.match(first.batchFingerprint, /^[0-9a-f]{64}$/);

  const packet = first.packets[0];
  assert.equal(packet.caseId, 'STC-2026-JMA-TC9999');
  assert.equal(packet.provenance.localWindJoin.dataTimestamp, '2026-09-02T03:20:00.000Z');
  assert.equal(packet.evidencePacket.evidence.localWind.provided, true);
  assert.equal(packet.evidencePacket.evidence.localWind.affectsForecast, false);
  assert.equal(packet.evidencePacket.semantics.affectsForecast, false);
  assert.equal(packet.evidencePacket.semantics.affectsEvaluator, false);
  assert.equal(packet.evidencePacket.semantics.caseSpecificRulesForbidden, true);
  assert.equal(packet.semantics.noTruthCorpusRead, true);
  assert.equal(packet.semantics.noFutureLocalWindJoin, true);
  assert.equal(first.semantics.providerInvocationIncluded, false);
  assert.equal(first.semantics.truthBranchInputIncluded, false);

  const absent = recorder.selectLocalWindObservation(null, observation.observedAt);
  assert.equal(absent.evidence, null);
  assert.equal(absent.join.status, 'unavailable');

  console.log('hk-situation-analysis-shadow-recorder tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
