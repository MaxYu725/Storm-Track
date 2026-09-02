const assert = require('node:assert/strict');
const prompt = require('../analysis/hk-situation-analysis-prompt.js');

const IDS = ['E_V1_T1', 'E_V1_T3', 'E_V1_T8', 'E_REAPPROACH', 'E_DIRECT_DEPART', 'E_GEOMETRY', 'E_LOCAL_WIND_SUMMARY'];

function validOutput() {
  const signal = {
    nextQuestion: 'reassessment',
    assessment: 'mixed',
    officialDecisionBasis: 'not-inferred',
    interpretation: 'Evidence is mixed.',
    evidenceIds: ['E_V1_T3']
  };
  return {
    schemaVersion: 'hk-situation-analysis-shadow-output/v0.3',
    currentPhase: 'departing',
    currentPhaseConfidence: 0.72,
    futurePhases: [{ phase: 're-approaching', earliestTime: null, latestTime: null, interpretation: 'Later re-approach evidence exists.', evidenceIds: ['E_REAPPROACH'] }],
    currentThreatInterpretation: 'Current departure and later re-approach are separate phases.',
    nextDecisionWindow: { signalCode: 'T3', question: 'reassessment', earliestTime: null, latestTime: null, interpretation: 'Timing remains uncertain.', evidenceIds: ['E_V1_T3'] },
    signalInterpretation: { T1: { ...signal, evidenceIds: ['E_V1_T1'] }, T3: { ...signal }, T8: { ...signal, evidenceIds: ['E_V1_T8'] } },
    supportingEvidence: [{ id: 'E_DIRECT_DEPART', finding: 'Departure evidence supports the current phase.' }],
    contradictingEvidence: [{ id: 'E_REAPPROACH', finding: 'Later re-approach prevents simple closeout.' }],
    modelSemanticConcerns: [{ code: 'phase-mixed-closest', description: 'Full-horizon geometry can describe another phase.', evidenceIds: ['E_GEOMETRY'] }],
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
  const runner = await import('../scripts/run-hk-situation-analysis-shadow-openai.mjs');
  const packet = validPacket();
  assert.equal(prompt.VERSION, 'hk-situation-analysis-prompt/v0.4');
  const request = runner.createRequestBody(packet, { model: 'gpt-5.6-terra', reasoningEffort: 'medium' });
  assert.equal(request.text.format.schema.properties.supportingEvidence.items.properties.id.enum[0], 'E_V1_T1');
  assert.equal(request.metadata.prompt_version, 'hk-situation-analysis-prompt/v0.4');
  assert.ok(request.text.format.schema.properties.nextDecisionWindow.required.includes('signalCode'));

  const structured = validOutput();
  const payload = {
    id: 'resp_test', status: 'completed', model: 'gpt-5.6-terra-test',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(structured) }] }],
    usage: { total_tokens: 100 }
  };
  const mockFetch = async () => ({ ok: true, status: 200, headers: { get: () => 'req-test' }, text: async () => JSON.stringify(payload) });
  const result = await runner.runInference(packet, { apiKey: 'test-key', fetchImpl: mockFetch, now: () => '2026-09-02T04:00:00.000Z' });
  assert.equal(result.prompt.outputSchemaVersion, 'hk-situation-analysis-shadow-output/v0.3');
  assert.equal(result.input.evidenceCatalogSchemaVersion, 'hk-situation-analysis-evidence-catalog/v1');
  assert.equal(result.semantics.evidenceReferenceMode, 'catalog-id-only');
  assert.deepEqual(result.output, structured);

  const invalidPayload = JSON.parse(JSON.stringify(payload));
  const invalid = validOutput();
  invalid.supportingEvidence[0].id = 'E_FAKE';
  invalidPayload.output[0].content[0].text = JSON.stringify(invalid);
  assert.throws(() => runner.extractStructuredOutput(invalidPayload, packet.evidencePacket), /not present in the supplied evidence catalog/);

  await assert.rejects(runner.runInference(packet, { apiKey: null, fetchImpl: mockFetch }), /OPENAI_API_KEY/);
  console.log('hk-situation-analysis-openai-inference tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
