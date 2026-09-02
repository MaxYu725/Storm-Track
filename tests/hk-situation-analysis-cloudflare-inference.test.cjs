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

(async () => {
  const runner = await import('../scripts/run-hk-situation-analysis-shadow-cloudflare.mjs');
  const packet = validPacket();
  assert.equal(prompt.VERSION, 'hk-situation-analysis-prompt/v0.4');
  assert.equal(prompt.OUTPUT_SCHEMA_VERSION, 'hk-situation-analysis-shadow-output/v0.3');
  assert.deepEqual(prompt.catalogIds(packet.evidencePacket), IDS);
  const schema = prompt.outputSchemaForEvidence(packet.evidencePacket);
  assert.deepEqual(schema.properties.supportingEvidence.items.properties.id.enum, IDS);
  assert.ok(schema.properties.nextDecisionWindow.required.includes('signalCode'));
  assert.ok(schema.properties.signalInterpretation.properties.T1.required.includes('officialDecisionBasis'));
  assert.match(prompt.buildInstructions(), /currentPhase must be remote/);
  assert.match(prompt.buildInstructions(), /assessment=not-applicable/);

  const request = runner.createRequestBody(packet);
  assert.equal(request.model, '@cf/openai/gpt-oss-120b');
  assert.deepEqual(request.response_format.json_schema.properties.supportingEvidence.items.properties.id.enum, IDS);
  assert.equal(request.stream, false);

  const structured = validOutput();
  assert.deepEqual(prompt.validateOutputAgainstEvidence(structured, packet.evidencePacket), { valid: true, errors: [] });

  const invented = validOutput();
  invented.supportingEvidence[0].id = 'E_INVENTED';
  assert.equal(prompt.validateOutputAgainstEvidence(invented, packet.evidencePacket).valid, false);

  const notApplicableAction = validOutput();
  notApplicableAction.signalInterpretation.T3.assessment = 'not-applicable';
  assert.match(prompt.validateOutputAgainstEvidence(notApplicableAction, packet.evidencePacket).errors.join('\n'), /not-applicable requires nextQuestion=none/);

  const decisionMismatch = validOutput();
  decisionMismatch.nextDecisionWindow.question = 'none';
  assert.match(prompt.validateOutputAgainstEvidence(decisionMismatch, packet.evidencePacket).errors.join('\n'), /must match signalInterpretation.T3.nextQuestion/);

  const noContextEscalation = validOutput();
  noContextEscalation.signalInterpretation.T3.nextQuestion = 'escalation';
  noContextEscalation.signalInterpretation.T3.assessment = 'supports-escalation';
  noContextEscalation.signalInterpretation.T3.officialDecisionBasis = 'context-supported';
  noContextEscalation.nextDecisionWindow.question = 'escalation';
  assert.match(prompt.validateOutputAgainstEvidence(noContextEscalation, packet.evidencePacket).errors.join('\n'), /without contemporaneous HKO context/);

  const remotePacket = validPacket();
  remotePacket.evidencePacket.evidence = {
    deterministicForecasts: { v1: { impact: { expected: false, likelihood: 'unlikely' } } },
    officialHko: { signalStatement: null }
  };
  const remoteWrong = validOutput();
  remoteWrong.currentPhase = 'approaching';
  assert.match(prompt.validateOutputAgainstEvidence(remoteWrong, remotePacket.evidencePacket).errors.join('\n'), /currentPhase must be remote/);
  remoteWrong.currentPhase = 'remote';
  assert.equal(prompt.validateOutputAgainstEvidence(remoteWrong, remotePacket.evidencePacket).valid, true);

  const payload = { id: 'chat_test', model: '@cf/openai/gpt-oss-120b', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(structured) } }], usage: { total_tokens: 100 } };
  const mockFetch = async () => ({ ok: true, status: 200, headers: { get: () => 'ray-test' }, text: async () => JSON.stringify(payload) });
  const result = await runner.runInference(packet, { accountId: 'account_123', apiToken: 'test-token', fetchImpl: mockFetch, now: () => '2026-09-02T04:00:00.000Z' });
  assert.equal(result.prompt.version, 'hk-situation-analysis-prompt/v0.4');
  assert.equal(result.prompt.outputSchemaVersion, 'hk-situation-analysis-shadow-output/v0.3');
  assert.equal(result.input.evidenceCatalogSchemaVersion, 'hk-situation-analysis-evidence-catalog/v1');
  assert.equal(result.semantics.evidenceReferenceMode, 'catalog-id-only');
  assert.equal(result.semantics.evidenceCatalogIdsRequired, true);
  assert.deepEqual(result.output, structured);

  const invalidPayload = JSON.parse(JSON.stringify(payload));
  const invalid = validOutput();
  invalid.supportingEvidence[0].id = 'E_NOT_IN_CATALOG';
  invalidPayload.choices[0].message.content = JSON.stringify(invalid);
  assert.throws(() => runner.extractStructuredOutput(invalidPayload, packet.evidencePacket), /not present in the supplied evidence catalog/);

  await assert.rejects(runner.runInference(packet, { accountId: null, apiToken: 'x', fetchImpl: mockFetch }), /ACCOUNT_ID/);
  console.log('hk-situation-analysis-cloudflare-inference tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
