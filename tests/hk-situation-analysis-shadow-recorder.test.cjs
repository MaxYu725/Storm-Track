const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

(async () => {
  const recorder = await import('../scripts/build-hk-situation-analysis-shadow-packets.mjs');

  const localWindRoot = mkdtempSync(join(tmpdir(), 'storm-ai-shadow-wind-'));
  const windDayDir = join(localWindRoot, 'observations', '2026', '09', '02');
  mkdirSync(windDayDir, { recursive: true });

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
  writeFileSync(join(windDayDir, '20260902T032000Z-past.json'), JSON.stringify(localWindPast));
  writeFileSync(join(windDayDir, '20260902T034000Z-future.json'), JSON.stringify(localWindFuture));

  const hkoRoot = mkdtempSync(join(tmpdir(), 'storm-ai-shadow-hko-'));
  const hkoDayDir = join(hkoRoot, 'observations', '2026', '09', '02');
  mkdirSync(hkoDayDir, { recursive: true });

  const hkoPast = {
    schemaVersion: 'hko-warning-truth/v1',
    retrievedAt: '2026-09-02T03:25:00.000Z',
    authority: 'Hong Kong Observatory Open Data API',
    captureFingerprint: 'd'.repeat(64),
    truth: {
      present: true,
      code: 'TC1',
      level: 1,
      type: '一號戒備信號',
      actionCode: 'ISSUE',
      issueTime: '2026-09-02T02:00:00+00:00',
      updateTime: '2026-09-02T02:00:00+00:00',
      expireTime: null,
      details: [{
        warningStatementCode: 'WTCSGNL',
        subtype: 'TC1',
        updateTime: '2026-09-02T03:20:00+00:00',
        contents: [
          '一號戒備信號，現正生效。',
          '測試風暴 TESTSTORM 現正逐漸遠離香港，稍後再評估其動向。'
        ]
      }]
    },
    context: { pre8: [], specialWeatherTips: [] }
  };
  const hkoFuture = {
    ...hkoPast,
    retrievedAt: '2026-09-02T03:40:00.000Z',
    captureFingerprint: 'e'.repeat(64),
    truth: {
      ...hkoPast.truth,
      code: 'TC3',
      level: 3,
      type: '三號強風信號',
      details: [{
        ...hkoPast.truth.details[0],
        subtype: 'TC3',
        updateTime: '2026-09-02T03:40:00+00:00',
        contents: ['三號強風信號，現正生效。', '測試風暴 TESTSTORM。']
      }]
    }
  };
  writeFileSync(join(hkoDayDir, '20260902T032500Z-past.json'), JSON.stringify(hkoPast));
  writeFileSync(join(hkoDayDir, '20260902T034000Z-future.json'), JSON.stringify(hkoFuture));

  const observation = {
    schemaVersion: 'hk-beta-prospective-observation/v1',
    observedAt: '2026-09-02T03:31:38.347Z',
    group: { key: 'TESTSTORM', displayName: '測試風暴 (TESTSTORM)', nameEn: 'TESTSTORM', nameTc: '測試風暴' },
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
    cases: [{
      caseId: 'STC-2026-JMA-TC9999',
      groupKeys: ['TESTSTORM'],
      displayNames: ['測試風暴 (TESTSTORM)'],
      names: ['TESTSTORM', '測試風暴']
    }]
  };

  const selected = recorder.selectLocalWindObservation(localWindRoot, observation.observedAt);
  assert.equal(selected.join.status, 'matched-at-or-before');
  assert.equal(selected.join.dataTimestamp, '2026-09-02T03:20:00.000Z');
  assert.equal(selected.join.futureCandidateCount, 1);
  assert.equal(selected.evidence.captureFingerprint, 'a'.repeat(64));

  const resolved = recorder.resolveCase(observation, registry);
  assert.equal(resolved.caseInfo.caseId, 'STC-2026-JMA-TC9999');
  assert.equal(resolved.resolution.method, 'case-registry-group-key');

  const hkoSelected = recorder.selectHkoOperationalContext(hkoRoot, observation.observedAt, resolved.caseInfo);
  assert.equal(hkoSelected.join.status, 'matched-active-warning-at-or-before');
  assert.equal(hkoSelected.join.retrievedAt, '2026-09-02T03:25:00.000Z');
  assert.equal(hkoSelected.join.futureCandidateCount, 1);
  assert.equal(hkoSelected.evidence.currentSignalCode, 'TC1');
  assert.equal(hkoSelected.evidence.currentSignal, '一號戒備信號');
  assert.equal(hkoSelected.evidence.semantics.futureOutcomeFeedback, false);

  const wrongCase = recorder.selectHkoOperationalContext(hkoRoot, observation.observedAt, {
    displayName: '其他風暴 (OTHERSTORM)', nameEn: 'OTHERSTORM', nameTc: '其他風暴'
  });
  assert.equal(wrongCase.evidence, null);
  assert.equal(wrongCase.join.status, 'not-matched-to-case');
  assert.equal(wrongCase.join.activeWarningPresent, true);

  const first = recorder.buildPacketBatch({
    betaCapture,
    registry,
    localWindCorpusRoot: localWindRoot,
    hkoWarningCorpusRoot: hkoRoot,
    builtAt: '2026-09-02T03:32:00.000Z'
  });
  const second = recorder.buildPacketBatch({
    betaCapture,
    registry,
    localWindCorpusRoot: localWindRoot,
    hkoWarningCorpusRoot: hkoRoot,
    builtAt: '2026-09-02T04:00:00.000Z'
  });

  assert.equal(first.schemaVersion, 'hk-situation-analysis-shadow-packet-batch/v0.1');
  assert.equal(first.packetCount, 1);
  assert.equal(first.batchFingerprint, second.batchFingerprint, 'build time must not change evidence fingerprint');
  assert.match(first.batchFingerprint, /^[0-9a-f]{64}$/);

  const packet = first.packets[0];
  assert.equal(packet.caseId, 'STC-2026-JMA-TC9999');
  assert.equal(packet.provenance.localWindJoin.dataTimestamp, '2026-09-02T03:20:00.000Z');
  assert.equal(packet.provenance.hkoOperationalContextJoin.status, 'matched-active-warning-at-or-before');
  assert.equal(packet.evidencePacket.evidence.localWind.provided, true);
  assert.equal(packet.evidencePacket.evidence.localWind.affectsForecast, false);
  assert.equal(packet.evidencePacket.evidence.officialHko.signalStatement.currentSignalCode, 'TC1');
  assert.equal(packet.evidencePacket.evidence.officialHko.signalStatement.currentSignal, '一號戒備信號');
  assert.equal(packet.evidencePacket.evidence.officialHko.signalStatement.semantics.contemporaneousOnly, true);
  assert.equal(packet.evidencePacket.semantics.affectsForecast, false);
  assert.equal(packet.evidencePacket.semantics.affectsEvaluator, false);
  assert.equal(packet.evidencePacket.semantics.caseSpecificRulesForbidden, true);
  assert.equal(packet.semantics.noTruthCorpusRead, false);
  assert.equal(packet.semantics.noFutureTruthFeedback, true);
  assert.equal(packet.semantics.contemporaneousOfficialContextOnly, true);
  assert.equal(packet.semantics.noFutureOfficialContextJoin, true);
  assert.equal(packet.semantics.noFutureLocalWindJoin, true);
  assert.equal(first.semantics.providerInvocationIncluded, false);
  assert.equal(first.semantics.truthBranchInputIncluded, true);
  assert.equal(first.semantics.truthBranchUseRestrictedToContemporaneousOfficialContext, true);
  assert.equal(first.semantics.futureTruthFeedbackIncluded, false);
  assert.equal(first.semantics.outcomeEvaluatorInputIncluded, false);
  assert.equal(first.semantics.officialContextJoinMustBeAtOrBeforeObservation, true);

  const absentWind = recorder.selectLocalWindObservation(null, observation.observedAt);
  assert.equal(absentWind.evidence, null);
  assert.equal(absentWind.join.status, 'unavailable');

  const absentHko = recorder.selectHkoOperationalContext(null, observation.observedAt, resolved.caseInfo);
  assert.equal(absentHko.evidence, null);
  assert.equal(absentHko.join.status, 'unavailable');

  console.log('hk-situation-analysis-shadow-recorder tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
