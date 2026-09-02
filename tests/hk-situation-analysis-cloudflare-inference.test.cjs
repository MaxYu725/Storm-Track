const assert = require('node:assert/strict');
const prompt = require('../analysis/hk-situation-analysis-prompt.js');

const IDS = ['E_V1_T1', 'E_V1_T3', 'E_V1_T8', 'E_REAPPROACH', 'E_DIRECT_DEPART', 'E_GEOMETRY', 'E_LOCAL_WIND_SUMMARY'];

function validOutput() {
  const signal = {
    nextQuestion: 'reassessment',
    assessment: 'mixed',
    officialDecisionBasis: 'not-inferred',
    interpretation: 'Evidence is mixed and requires reassessment.',
    evidenceIds: ['E_V1_T3']
  };
  return {
    schemaVersion: 'hk-situation-analysis-shadow-output/v0.3',
    currentPhase: 'departing',
    currentPhaseConfidence: 0.72,
    futurePhases: [{ phase: 're-approaching', earliestTime: null, latestTime: null, interpretation: 'Later re-approach evidence exists.', evidenceIds: ['E_REAPPROACH'] }],
    currentThreatInterpretation: 'Current departure and later re-approach should remain separate.',
    nextDecisionWindow: { signalCode: 'T3', question: 'reassessment', earliestTime: null, latestTime: null, interpretation: 'Timing remains uncertain.', evidenceIds: ['E_V1_T3'] },
    signalInterpretation: { T1: { ...signal, evidenceIds: ['E_V1_T1'] }, T3: { ...signal }, T8: { ...signal, evidenceIds: ['E_V1_T8'] } },
    supportingEvidence: [{ id: 'E_DIRECT_DEPART', finding: 'Departure evidence supports the current phase.' }],
    contradictingEvidence: [{ id: 'E_REAPPROACH', finding: 'A later re-approach prevents a simple closeout.' }],
    modelSemanticConcerns: [{ code: 'phase-mixed-closest', description: 'Full-horizon geometry can describe a later phase.', evidenceIds: ['E_GEOMETRY'] }],
    uncertainties: [{ description: 'Local wind is observation-only.', evidenceIds: ['E_LOCAL_WIND_SUMMARY'] }]
  };
}

function validPacket() {
  const entries = IDS.map(id => ({ id, path: `$.evidence.${id.toLowerCase()}`, kind: 'test', description: id }));
  return {
    schemaVersion: 'hk-situation-analysis-shadow-packet/v0.1',
    packetFingerprint: 'a'.repeat(64),
    caseId: 'STC-TEST',
    groupKey: 'TEST',
    sourceObservationObservedAt: '2026-09-02T03:46:44.156Z',
    evidencePacket: {
      schemaVersion: 'hk-situation-analysis-shadow-input/v0.1',
      evidence: { test: true },
      evidenceCatalog: { schemaVersion: 'hk-situation-analysis-evidence-catalog/v1', referenceMode: 'catalog-id-only', entries },
      semantics: { caseSpecificRulesForbidden: true, noTruthFeedback: true, evidenceReferencesUseCatalogIds: true }
    },
    semantics: { shadowOnly: true, affectsForecast: false, affectsEvaluator: false, noTruthCorpusRead: true }
  };
}

function chatPayload(output, id = 'chat_test') {
  return { id, model: '@cf/openai/gpt-oss-120b', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }], usage: { total_tokens: 100 } };
}

(async () => {
  const runner = await import('../scripts/run-hk-situation-analysis-shadow-cloudflare.mjs');
  const packet = validPacket();
  assert.equal(prompt.VERSION, 'hk-situation-analysis-prompt/v0.5');
  assert.equal(prompt.OUTPUT_SCHEMA_VERSION, 'hk-situation-analysis-shadow-output/v0.3');
  assert.deepEqual(prompt.catalogIds(packet.evidencePacket), IDS);
  assert.equal(runner.MAX_REPAIR_ATTEMPTS, 1);
  assert.match(prompt.buildInstructions(), /Maintenance and cancellation apply only to the currently active HKO signal tier/);

  const request = runner.createRequestBody(packet);
  assert.equal(request.model, '@cf/openai/gpt-oss-120b');
  assert.deepEqual(request.response_format.json_schema.properties.supportingEvidence.items.properties.id.enum, IDS);
  assert.equal(request.stream, false);

  const structured = validOutput();
  assert.deepEqual(prompt.validateOutputAgainstEvidence(structured, packet.evidencePacket), { valid: true, errors: [] });

  const invented = validOutput();
  invented.supportingEvidence[0].id = 'E_INVENTED';
  assert.equal(prompt.validateOutputAgainstEvidence(invented, packet.evidencePacket).valid, false);

  const activePacket = validPacket();
  activePacket.evidencePacket.evidence = {
    deterministicForecasts: { v1: { impact: { expected: true, likelihood: 'possible' } } },
    officialHko: { signalStatement: { currentSignalCode: 'TC1', currentSignal: '一號戒備信號' } }
  };
  assert.equal(prompt.activeSignalTier(activePacket.evidencePacket), 'T1');
  const inactiveCancellation = validOutput();
  inactiveCancellation.signalInterpretation.T1 = {
    nextQuestion: 'maintenance', assessment: 'supports-maintenance', officialDecisionBasis: 'context-supported', interpretation: 'T1 is active.', evidenceIds: ['E_V1_T1']
  };
  inactiveCancellation.signalInterpretation.T3.officialDecisionBasis = 'context-supported';
  inactiveCancellation.signalInterpretation.T8 = {
    nextQuestion: 'cancellation', assessment: 'supports-cancellation', officialDecisionBasis: 'context-supported', interpretation: 'Invalid inactive cancellation.', evidenceIds: ['E_V1_T8']
  };
  assert.match(prompt.validateOutputAgainstEvidence(inactiveCancellation, activePacket.evidencePacket).errors.join('\n'), /T8.nextQuestion cancellation is not applicable because active HKO signal tier is T1/);

  const remotePacket = validPacket();
  remotePacket.evidencePacket.evidence = {
    deterministicForecasts: { v1: { impact: { expected: false, likelihood: 'unlikely' } } },
    officialHko: { signalStatement: null }
  };
  const remoteWrong = validOutput();
  remoteWrong.currentPhase = 'approaching';
  remoteWrong.signalInterpretation.T1 = { nextQuestion: 'maintenance', assessment: 'supports-maintenance', officialDecisionBasis: 'context-supported', interpretation: 'Invalid.', evidenceIds: ['E_V1_T1'] };
  remoteWrong.signalInterpretation.T3 = { nextQuestion: 'maintenance', assessment: 'supports-maintenance', officialDecisionBasis: 'context-supported', interpretation: 'Invalid.', evidenceIds: ['E_V1_T3'] };
  remoteWrong.signalInterpretation.T8 = { nextQuestion: 'maintenance', assessment: 'supports-maintenance', officialDecisionBasis: 'context-supported', interpretation: 'Invalid.', evidenceIds: ['E_V1_T8'] };
  remoteWrong.nextDecisionWindow = { signalCode: 'T3', question: 'maintenance', earliestTime: null, latestTime: null, interpretation: 'Invalid.', evidenceIds: ['E_V1_T3'] };
  assert.match(prompt.validateOutputAgainstEvidence(remoteWrong, remotePacket.evidencePacket).errors.join('\n'), /without contemporaneous HKO context/);

  const remoteFixed = validOutput();
  remoteFixed.currentPhase = 'remote';
  remoteFixed.currentPhaseConfidence = 0.91;
  remoteFixed.futurePhases = [];
  remoteFixed.currentThreatInterpretation = 'The system remains operationally remote for Hong Kong.';
  remoteFixed.nextDecisionWindow = { signalCode: 'none', question: 'none', earliestTime: null, latestTime: null, interpretation: 'No operational signal decision is identified.', evidenceIds: ['E_GEOMETRY'] };
  for (const code of ['T1', 'T3', 'T8']) {
    remoteFixed.signalInterpretation[code] = { nextQuestion: 'none', assessment: 'not-applicable', officialDecisionBasis: 'not-inferred', interpretation: 'No current operational action.', evidenceIds: [`E_V1_${code}`] };
  }
  assert.equal(prompt.validateOutputAgainstEvidence(remoteFixed, remotePacket.evidencePacket).valid, true);

  let fetchCount = 0;
  const repairFetch = async (_url, options) => {
    fetchCount += 1;
    const body = JSON.parse(options.body);
    if (fetchCount === 1) {
      assert.equal(body.messages.length, 2);
      return { ok: true, status: 200, headers: { get: () => 'ray-initial' }, text: async () => JSON.stringify(chatPayload(remoteWrong, 'chat_initial')) };
    }
    assert.equal(body.messages.length, 4);
    assert.equal(body.messages[2].role, 'assistant');
    assert.match(body.messages[3].content, /VALIDATION_ERRORS=/);
    assert.match(body.messages[3].content, /same evidence packet/);
    return { ok: true, status: 200, headers: { get: () => 'ray-repair' }, text: async () => JSON.stringify(chatPayload(remoteFixed, 'chat_repair')) };
  };

  const repaired = await runner.runInference(remotePacket, {
    accountId: 'account_123', apiToken: 'test-token', fetchImpl: repairFetch, now: () => '2026-09-02T04:00:00.000Z'
  });
  assert.equal(fetchCount, 2);
  assert.equal(repaired.prompt.version, 'hk-situation-analysis-prompt/v0.5');
  assert.equal(repaired.provider.attemptCount, 2);
  assert.equal(repaired.provider.repairAttempted, true);
  assert.equal(repaired.repair.attempted, true);
  assert.ok(repaired.repair.initialValidationErrors.length > 0);
  assert.equal(repaired.semantics.repairUsesExactSameEvidencePacket, true);
  assert.equal(repaired.semantics.repairReceivesValidationDiagnosticsOnly, true);
  assert.equal(repaired.semantics.invalidRepairFailsClosed, true);
  assert.deepEqual(repaired.output, remoteFixed);
  assert.notEqual(repaired.prompt.initialRequestFingerprint, repaired.prompt.repairRequestFingerprint);

  let failCount = 0;
  const alwaysInvalidFetch = async () => {
    failCount += 1;
    return { ok: true, status: 200, headers: { get: () => `ray-${failCount}` }, text: async () => JSON.stringify(chatPayload(remoteWrong, `chat_${failCount}`)) };
  };
  await assert.rejects(
    runner.runInference(remotePacket, { accountId: 'account_123', apiToken: 'test-token', fetchImpl: alwaysInvalidFetch }),
    /failed local validation/
  );
  assert.equal(failCount, 2, 'one initial request plus exactly one repair attempt');

  const invalidPayload = chatPayload(invented);
  assert.throws(() => runner.extractStructuredOutput(invalidPayload, packet.evidencePacket), /not present in the supplied evidence catalog/);
  await assert.rejects(runner.runInference(packet, { accountId: null, apiToken: 'x', fetchImpl: repairFetch }), /ACCOUNT_ID/);

  console.log('hk-situation-analysis-cloudflare-inference tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
