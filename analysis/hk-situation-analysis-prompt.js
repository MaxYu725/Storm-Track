(function attachStormHkSituationAnalysisPrompt(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StormHkSituationAnalysisPrompt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormHkSituationAnalysisPrompt() {
  'use strict';

  const VERSION = 'hk-situation-analysis-prompt/v0.4';
  const OUTPUT_SCHEMA_VERSION = 'hk-situation-analysis-shadow-output/v0.3';

  const PHASES = Object.freeze([
    'remote', 'approaching', 'passing', 'departing', 'quasi-stationary',
    're-approaching', 'transition', 'uncertain'
  ]);
  const DECISION_QUESTIONS = Object.freeze([
    'maintenance', 'cancellation', 'escalation', 'reassessment', 'none', 'uncertain'
  ]);
  const DECISION_SIGNAL_CODES = Object.freeze(['T1', 'T3', 'T8', 'all', 'none']);
  const SIGNAL_ASSESSMENTS = Object.freeze([
    'supports-escalation', 'supports-maintenance', 'supports-cancellation',
    'mixed', 'insufficient', 'not-applicable'
  ]);
  const OFFICIAL_DECISION_BASIS = Object.freeze(['context-supported', 'not-inferred']);

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function catalogEntries(evidencePacket) {
    return Array.isArray(evidencePacket?.evidenceCatalog?.entries)
      ? evidencePacket.evidenceCatalog.entries
      : [];
  }

  function catalogIds(evidencePacket) {
    return [...new Set(catalogEntries(evidencePacket)
      .map(entry => String(entry?.id || '').trim())
      .filter(id => /^E_[A-Z0-9_]+$/.test(id)))];
  }

  function idItemSchema(allowedIds = null) {
    if (Array.isArray(allowedIds) && allowedIds.length) return { type: 'string', enum: [...allowedIds] };
    return { type: 'string', pattern: '^E_[A-Z0-9_]+$' };
  }

  function makeOutputJsonSchema(allowedIds = null) {
    const evidenceIdsSchema = () => ({ type: 'array', items: idItemSchema(allowedIds) });
    const signalSchema = () => ({
      type: 'object',
      properties: {
        nextQuestion: { type: 'string', enum: [...DECISION_QUESTIONS] },
        assessment: { type: 'string', enum: [...SIGNAL_ASSESSMENTS] },
        officialDecisionBasis: { type: 'string', enum: [...OFFICIAL_DECISION_BASIS] },
        interpretation: { type: 'string' },
        evidenceIds: evidenceIdsSchema()
      },
      required: ['nextQuestion', 'assessment', 'officialDecisionBasis', 'interpretation', 'evidenceIds'],
      additionalProperties: false
    });

    return {
      type: 'object',
      properties: {
        schemaVersion: { type: 'string', enum: [OUTPUT_SCHEMA_VERSION] },
        currentPhase: { type: 'string', enum: [...PHASES] },
        currentPhaseConfidence: { type: 'number', minimum: 0, maximum: 1 },
        futurePhases: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              phase: { type: 'string', enum: [...PHASES] },
              earliestTime: { type: ['string', 'null'] },
              latestTime: { type: ['string', 'null'] },
              interpretation: { type: 'string' },
              evidenceIds: evidenceIdsSchema()
            },
            required: ['phase', 'earliestTime', 'latestTime', 'interpretation', 'evidenceIds'],
            additionalProperties: false
          }
        },
        currentThreatInterpretation: { type: 'string' },
        nextDecisionWindow: {
          type: 'object',
          properties: {
            signalCode: { type: 'string', enum: [...DECISION_SIGNAL_CODES] },
            question: { type: 'string', enum: [...DECISION_QUESTIONS] },
            earliestTime: { type: ['string', 'null'] },
            latestTime: { type: ['string', 'null'] },
            interpretation: { type: 'string' },
            evidenceIds: evidenceIdsSchema()
          },
          required: ['signalCode', 'question', 'earliestTime', 'latestTime', 'interpretation', 'evidenceIds'],
          additionalProperties: false
        },
        signalInterpretation: {
          type: 'object',
          properties: { T1: signalSchema(), T3: signalSchema(), T8: signalSchema() },
          required: ['T1', 'T3', 'T8'],
          additionalProperties: false
        },
        supportingEvidence: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: idItemSchema(allowedIds), finding: { type: 'string' } },
            required: ['id', 'finding'],
            additionalProperties: false
          }
        },
        contradictingEvidence: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: idItemSchema(allowedIds), finding: { type: 'string' } },
            required: ['id', 'finding'],
            additionalProperties: false
          }
        },
        modelSemanticConcerns: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              description: { type: 'string' },
              evidenceIds: evidenceIdsSchema()
            },
            required: ['code', 'description', 'evidenceIds'],
            additionalProperties: false
          }
        },
        uncertainties: {
          type: 'array',
          items: {
            type: 'object',
            properties: { description: { type: 'string' }, evidenceIds: evidenceIdsSchema() },
            required: ['description', 'evidenceIds'],
            additionalProperties: false
          }
        }
      },
      required: [
        'schemaVersion', 'currentPhase', 'currentPhaseConfidence', 'futurePhases',
        'currentThreatInterpretation', 'nextDecisionWindow', 'signalInterpretation',
        'supportingEvidence', 'contradictingEvidence', 'modelSemanticConcerns', 'uncertainties'
      ],
      additionalProperties: false
    };
  }

  const OUTPUT_JSON_SCHEMA = Object.freeze(makeOutputJsonSchema());

  function outputSchemaForEvidence(evidencePacket) {
    const ids = catalogIds(evidencePacket);
    if (!ids.length) throw new Error('Evidence catalog is missing or empty');
    return makeOutputJsonSchema(ids);
  }

  function buildInstructions() {
    return [
      'You are the Storm Track AI Situation Analysis Shadow.',
      'Analyze ONLY the supplied evidence packet. Treat this as a closed-book task: do not use prior knowledge, remembered storm behavior, external weather information, or later outcomes.',
      'The storm name, case ID, agency IDs, dates, and station names are provenance only. They must never select a special rule or prompt branch.',
      'Do not modify, recalculate, or silently replace V1/V2 risk indices. Do not invent track coordinates, wind speeds, HKO signal times, or agency positions.',
      'currentPhase is the operationally relevant Hong Kong lifecycle phase now, not merely geometric motion. A later re-approach must not replace the current pass/departure phase.',
      'If frozen deterministic impact says expected=false and likelihood=unlikely and there is no contemporaneous HKO operational context for this case, currentPhase must be remote even when the geometric trend is approaching.',
      'Use remote for a system that is not operationally relevant to Hong Kong even if its geometric distance trend is technically approaching. Motion direction alone does not make the current operational phase approaching.',
      'Treat deterministic geometry, lifecycle analyzers, V1/V2 outputs, TC wind-field evidence, local measured wind, and official HKO context as distinct evidence channels. Explicitly identify conflicts instead of averaging them away.',
      'Cyclone representative or maximum wind is storm intensity, not Hong Kong local wind. Never describe cyclone-centre or representative wind as being above or below a Hong Kong signal/local-wind threshold.',
      'Local station observations are observation-only. A single exposed-station strong wind or gust is not by itself evidence that T3/T8 should be issued, and local wind must not be attributed to the tropical cyclone unless the packet contains supporting linkage evidence.',
      'Official HKO context may tell you the current operational question or stated reassessment context, but it must not rewrite an earlier deterministic forecast or be treated as future outcome feedback.',
      'If the packet does not provide contemporaneous HKO operational context for this case, officialDecisionBasis must be not-inferred and nextQuestion must not be maintenance, cancellation, or escalation. Use reassessment, none, or uncertain instead.',
      'If nextQuestion is maintenance, cancellation, or escalation, officialDecisionBasis must be context-supported.',
      'assessment=not-applicable means no operational action question is applicable and must pair with nextQuestion=none. If maintenance, cancellation, escalation, or reassessment is under discussion, use a substantive assessment such as mixed, insufficient, or supports-* instead.',
      'assessment=supports-maintenance must pair with nextQuestion=maintenance; supports-cancellation with cancellation; supports-escalation with escalation.',
      'nextDecisionWindow.signalCode identifies which signal the window is about. For T1/T3/T8, nextDecisionWindow.question must exactly match that signal nextQuestion. Use signalCode=all only for a genuinely shared cross-signal question, and signalCode=none only when question=none.',
      'For T1/T3/T8, interpret the meaningful next operational question without outputting a new probability or replacement risk score.',
      'A deterministic estimatedWindow is model guidance, not automatically an HKO issuance window. Do not describe it as an official issue/change time unless contemporaneous HKO context explicitly supports that meaning.',
      'If evidence is sparse, phase-mixed, horizon-limited, internally inconsistent, or temporally ambiguous, say so and use uncertain/insufficient rather than forcing a conclusion.',
      'For every evidence citation, use ONLY an ID present in evidenceCatalog.entries. Never output JSON paths, JSONPath expressions, filters, wildcards, predicates, functions, or invented evidence IDs.',
      'The catalog entry path is provided only for audit/provenance; cite its ID in the structured output.',
      'Keep interpretations concise and auditable. The structured JSON output is the complete answer.'
    ].join('\n');
  }

  function validateEvidenceIds(ids, path, errors, allowedIds = null) {
    if (!Array.isArray(ids)) {
      errors.push(`${path} must be an array`);
      return;
    }
    const allowed = allowedIds ? new Set(allowedIds) : null;
    ids.forEach((id, index) => {
      if (typeof id !== 'string' || !/^E_[A-Z0-9_]+$/.test(id)) {
        errors.push(`${path}[${index}] must be a catalog evidence ID`);
      } else if (allowed && !allowed.has(id)) {
        errors.push(`${path}[${index}] is not present in the supplied evidence catalog: ${id}`);
      }
    });
  }

  function validateSignal(value, path, errors, allowedIds) {
    if (!isObject(value)) {
      errors.push(`${path} must be an object`);
      return;
    }
    if (!DECISION_QUESTIONS.includes(value.nextQuestion)) errors.push(`${path}.nextQuestion invalid`);
    if (!SIGNAL_ASSESSMENTS.includes(value.assessment)) errors.push(`${path}.assessment invalid`);
    if (!OFFICIAL_DECISION_BASIS.includes(value.officialDecisionBasis)) errors.push(`${path}.officialDecisionBasis invalid`);
    if (typeof value.interpretation !== 'string') errors.push(`${path}.interpretation must be string`);
    validateEvidenceIds(value.evidenceIds, `${path}.evidenceIds`, errors, allowedIds);

    if (value.assessment === 'not-applicable' && value.nextQuestion !== 'none') {
      errors.push(`${path}.assessment not-applicable requires nextQuestion=none`);
    }
    const supportedQuestion = {
      'supports-maintenance': 'maintenance',
      'supports-cancellation': 'cancellation',
      'supports-escalation': 'escalation'
    }[value.assessment];
    if (supportedQuestion && value.nextQuestion !== supportedQuestion) {
      errors.push(`${path}.assessment ${value.assessment} requires nextQuestion=${supportedQuestion}`);
    }
    if (['maintenance', 'cancellation', 'escalation'].includes(value.nextQuestion)
        && value.officialDecisionBasis !== 'context-supported') {
      errors.push(`${path}.nextQuestion ${value.nextQuestion} requires officialDecisionBasis=context-supported`);
    }
  }

  function validateOutput(value, allowedIds = null) {
    const errors = [];
    if (!isObject(value)) return { valid: false, errors: ['output must be an object'] };
    if (value.schemaVersion !== OUTPUT_SCHEMA_VERSION) errors.push('schemaVersion mismatch');
    if (!PHASES.includes(value.currentPhase)) errors.push('currentPhase invalid');
    if (!Number.isFinite(value.currentPhaseConfidence) || value.currentPhaseConfidence < 0 || value.currentPhaseConfidence > 1) {
      errors.push('currentPhaseConfidence must be 0..1');
    }
    if (typeof value.currentThreatInterpretation !== 'string') errors.push('currentThreatInterpretation must be string');

    if (!Array.isArray(value.futurePhases)) errors.push('futurePhases must be an array');
    else value.futurePhases.forEach((phase, index) => {
      const path = `futurePhases[${index}]`;
      if (!isObject(phase)) return errors.push(`${path} must be object`);
      if (!PHASES.includes(phase.phase)) errors.push(`${path}.phase invalid`);
      if (phase.earliestTime !== null && typeof phase.earliestTime !== 'string') errors.push(`${path}.earliestTime invalid`);
      if (phase.latestTime !== null && typeof phase.latestTime !== 'string') errors.push(`${path}.latestTime invalid`);
      if (typeof phase.interpretation !== 'string') errors.push(`${path}.interpretation must be string`);
      validateEvidenceIds(phase.evidenceIds, `${path}.evidenceIds`, errors, allowedIds);
    });

    const window = value.nextDecisionWindow;
    if (!isObject(window)) errors.push('nextDecisionWindow must be object');
    else {
      if (!DECISION_SIGNAL_CODES.includes(window.signalCode)) errors.push('nextDecisionWindow.signalCode invalid');
      if (!DECISION_QUESTIONS.includes(window.question)) errors.push('nextDecisionWindow.question invalid');
      if (window.earliestTime !== null && typeof window.earliestTime !== 'string') errors.push('nextDecisionWindow.earliestTime invalid');
      if (window.latestTime !== null && typeof window.latestTime !== 'string') errors.push('nextDecisionWindow.latestTime invalid');
      if (typeof window.interpretation !== 'string') errors.push('nextDecisionWindow.interpretation must be string');
      validateEvidenceIds(window.evidenceIds, 'nextDecisionWindow.evidenceIds', errors, allowedIds);
    }

    if (!isObject(value.signalInterpretation)) errors.push('signalInterpretation must be object');
    else ['T1', 'T3', 'T8'].forEach(code => validateSignal(value.signalInterpretation[code], `signalInterpretation.${code}`, errors, allowedIds));

    if (isObject(window) && isObject(value.signalInterpretation)) {
      if (['T1', 'T3', 'T8'].includes(window.signalCode)) {
        const signalQuestion = value.signalInterpretation?.[window.signalCode]?.nextQuestion;
        if (signalQuestion && window.question !== signalQuestion) {
          errors.push(`nextDecisionWindow.question must match signalInterpretation.${window.signalCode}.nextQuestion`);
        }
      }
      if (window.signalCode === 'none' && window.question !== 'none') {
        errors.push('nextDecisionWindow.signalCode=none requires question=none');
      }
    }

    for (const key of ['supportingEvidence', 'contradictingEvidence']) {
      const rows = value[key];
      if (!Array.isArray(rows)) errors.push(`${key} must be array`);
      else rows.forEach((row, index) => {
        if (!isObject(row)) return errors.push(`${key}[${index}] must be object`);
        validateEvidenceIds([row.id], `${key}[${index}].id`, errors, allowedIds);
        if (typeof row.finding !== 'string') errors.push(`${key}[${index}].finding must be string`);
      });
    }

    if (!Array.isArray(value.modelSemanticConcerns)) errors.push('modelSemanticConcerns must be array');
    else value.modelSemanticConcerns.forEach((row, index) => {
      if (!isObject(row)) return errors.push(`modelSemanticConcerns[${index}] must be object`);
      if (typeof row.code !== 'string') errors.push(`modelSemanticConcerns[${index}].code must be string`);
      if (typeof row.description !== 'string') errors.push(`modelSemanticConcerns[${index}].description must be string`);
      validateEvidenceIds(row.evidenceIds, `modelSemanticConcerns[${index}].evidenceIds`, errors, allowedIds);
    });

    if (!Array.isArray(value.uncertainties)) errors.push('uncertainties must be array');
    else value.uncertainties.forEach((row, index) => {
      if (!isObject(row)) return errors.push(`uncertainties[${index}] must be object`);
      if (typeof row.description !== 'string') errors.push(`uncertainties[${index}].description must be string`);
      validateEvidenceIds(row.evidenceIds, `uncertainties[${index}].evidenceIds`, errors, allowedIds);
    });

    return { valid: errors.length === 0, errors };
  }

  function validateOutputAgainstEvidence(value, evidencePacket) {
    const ids = catalogIds(evidencePacket);
    if (!ids.length) return { valid: false, errors: ['supplied evidence catalog is missing or empty'] };
    const validation = validateOutput(value, ids);
    const errors = [...validation.errors];
    const hkoStatement = evidencePacket?.evidence?.officialHko?.signalStatement;
    const hasOfficialContext = isObject(hkoStatement);
    const impact = evidencePacket?.evidence?.deterministicForecasts?.v1?.impact;

    if (!hasOfficialContext) {
      for (const code of ['T1', 'T3', 'T8']) {
        const signal = value?.signalInterpretation?.[code];
        if (!signal) continue;
        if (signal.officialDecisionBasis !== 'not-inferred') {
          errors.push(`signalInterpretation.${code}.officialDecisionBasis must be not-inferred when contemporaneous HKO context is unavailable`);
        }
        if (['maintenance', 'cancellation', 'escalation'].includes(signal.nextQuestion)) {
          errors.push(`signalInterpretation.${code}.nextQuestion cannot be ${signal.nextQuestion} without contemporaneous HKO context`);
        }
      }
      if (['maintenance', 'cancellation', 'escalation'].includes(value?.nextDecisionWindow?.question)) {
        errors.push(`nextDecisionWindow.question cannot be ${value.nextDecisionWindow.question} without contemporaneous HKO context`);
      }
    }

    if (impact?.expected === false && impact?.likelihood === 'unlikely' && !hasOfficialContext && value?.currentPhase !== 'remote') {
      errors.push('currentPhase must be remote when deterministic HK impact is expected=false/ unlikely and no contemporaneous HKO context is available');
    }
    if (hasOfficialContext && value?.currentPhase === 'remote') {
      errors.push('currentPhase cannot be remote while contemporaneous HKO operational context for this case is present');
    }

    return { valid: errors.length === 0, errors };
  }

  function resolveEvidenceId(id, evidencePacket) {
    const entry = catalogEntries(evidencePacket).find(row => row?.id === id) || null;
    if (!entry) return null;
    return { id: entry.id, path: entry.path, kind: entry.kind, description: entry.description };
  }

  return Object.freeze({
    VERSION,
    OUTPUT_SCHEMA_VERSION,
    OUTPUT_JSON_SCHEMA,
    PHASES,
    DECISION_QUESTIONS,
    DECISION_SIGNAL_CODES,
    SIGNAL_ASSESSMENTS,
    OFFICIAL_DECISION_BASIS,
    buildInstructions,
    catalogIds,
    outputSchemaForEvidence,
    resolveEvidenceId,
    validateOutput,
    validateOutputAgainstEvidence
  });
});
