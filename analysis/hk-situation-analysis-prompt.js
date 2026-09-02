(function attachStormHkSituationAnalysisPrompt(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StormHkSituationAnalysisPrompt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormHkSituationAnalysisPrompt() {
  'use strict';

  const VERSION = 'hk-situation-analysis-prompt/v0.1';
  const OUTPUT_SCHEMA_VERSION = 'hk-situation-analysis-shadow-output/v0.1';

  const PHASES = Object.freeze([
    'remote',
    'approaching',
    'passing',
    'departing',
    'quasi-stationary',
    're-approaching',
    'transition',
    'uncertain'
  ]);
  const DECISION_QUESTIONS = Object.freeze([
    'maintenance',
    'cancellation',
    'escalation',
    'reassessment',
    'none',
    'uncertain'
  ]);
  const SIGNAL_ASSESSMENTS = Object.freeze([
    'supports-escalation',
    'supports-maintenance',
    'supports-cancellation',
    'mixed',
    'insufficient',
    'not-applicable'
  ]);

  const evidenceRefsSchema = Object.freeze({
    type: 'array',
    items: { type: 'string' }
  });

  const signalSchema = Object.freeze({
    type: 'object',
    properties: {
      nextQuestion: { type: 'string', enum: [...DECISION_QUESTIONS] },
      assessment: { type: 'string', enum: [...SIGNAL_ASSESSMENTS] },
      interpretation: { type: 'string' },
      evidenceRefs: evidenceRefsSchema
    },
    required: ['nextQuestion', 'assessment', 'interpretation', 'evidenceRefs'],
    additionalProperties: false
  });

  const OUTPUT_JSON_SCHEMA = Object.freeze({
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
            evidenceRefs: evidenceRefsSchema
          },
          required: ['phase', 'earliestTime', 'latestTime', 'interpretation', 'evidenceRefs'],
          additionalProperties: false
        }
      },
      currentThreatInterpretation: { type: 'string' },
      nextDecisionWindow: {
        type: 'object',
        properties: {
          question: { type: 'string', enum: [...DECISION_QUESTIONS] },
          earliestTime: { type: ['string', 'null'] },
          latestTime: { type: ['string', 'null'] },
          interpretation: { type: 'string' },
          evidenceRefs: evidenceRefsSchema
        },
        required: ['question', 'earliestTime', 'latestTime', 'interpretation', 'evidenceRefs'],
        additionalProperties: false
      },
      signalInterpretation: {
        type: 'object',
        properties: {
          T1: signalSchema,
          T3: signalSchema,
          T8: signalSchema
        },
        required: ['T1', 'T3', 'T8'],
        additionalProperties: false
      },
      supportingEvidence: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ref: { type: 'string' },
            finding: { type: 'string' }
          },
          required: ['ref', 'finding'],
          additionalProperties: false
        }
      },
      contradictingEvidence: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ref: { type: 'string' },
            finding: { type: 'string' }
          },
          required: ['ref', 'finding'],
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
            evidenceRefs: evidenceRefsSchema
          },
          required: ['code', 'description', 'evidenceRefs'],
          additionalProperties: false
        }
      },
      uncertainties: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            evidenceRefs: evidenceRefsSchema
          },
          required: ['description', 'evidenceRefs'],
          additionalProperties: false
        }
      }
    },
    required: [
      'schemaVersion',
      'currentPhase',
      'currentPhaseConfidence',
      'futurePhases',
      'currentThreatInterpretation',
      'nextDecisionWindow',
      'signalInterpretation',
      'supportingEvidence',
      'contradictingEvidence',
      'modelSemanticConcerns',
      'uncertainties'
    ],
    additionalProperties: false
  });

  function buildInstructions() {
    return [
      'You are the Storm Track AI Situation Analysis Shadow.',
      'Analyze ONLY the supplied evidence packet. Treat this as a closed-book task: do not use prior knowledge, remembered storm behavior, external weather information, or later outcomes.',
      'The storm name, case ID, agency IDs, dates, and station names are provenance only. They must never select a special rule or prompt branch.',
      'Do not modify, recalculate, or silently replace V1/V2 risk indices. Do not invent track coordinates, wind speeds, HKO signal times, or agency positions.',
      'Separate the lifecycle phase that is operationally relevant now from later forecast phases. A later re-approach must not silently replace the current pass/departure phase.',
      'Treat deterministic geometry, lifecycle analyzers, V1/V2 outputs, TC wind-field evidence, local measured wind, and official HKO context as distinct evidence channels. Explicitly identify conflicts instead of averaging them away.',
      'Local station observations are observation-only. A single exposed-station strong wind or gust is not by itself evidence that T3/T8 should be issued.',
      'Official HKO context may tell you the current operational question or stated reassessment context, but it must not rewrite an earlier deterministic forecast or be treated as a hidden training label.',
      'For T1/T3/T8, interpret the meaningful next operational question (maintenance, cancellation, escalation, reassessment, none, uncertain). Do not output a new probability or replacement risk score.',
      'If evidence is sparse, phase-mixed, horizon-limited, internally inconsistent, or temporally ambiguous, say so and use uncertain/insufficient rather than forcing a conclusion.',
      'Every evidence reference must be a JSON path into the supplied packet and must begin with $.evidence.',
      'Keep interpretations concise and auditable. The structured JSON output is the complete answer.'
    ].join('\n');
  }

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function validateEvidenceRefs(refs, path, errors) {
    if (!Array.isArray(refs)) {
      errors.push(`${path} must be an array`);
      return;
    }
    refs.forEach((ref, index) => {
      if (typeof ref !== 'string' || !ref.startsWith('$.evidence.')) {
        errors.push(`${path}[${index}] must start with $.evidence.`);
      }
    });
  }

  function validateSignal(value, path, errors) {
    if (!isObject(value)) {
      errors.push(`${path} must be an object`);
      return;
    }
    if (!DECISION_QUESTIONS.includes(value.nextQuestion)) errors.push(`${path}.nextQuestion invalid`);
    if (!SIGNAL_ASSESSMENTS.includes(value.assessment)) errors.push(`${path}.assessment invalid`);
    if (typeof value.interpretation !== 'string') errors.push(`${path}.interpretation must be string`);
    validateEvidenceRefs(value.evidenceRefs, `${path}.evidenceRefs`, errors);
  }

  function validateOutput(value) {
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
      if (!isObject(phase)) {
        errors.push(`${path} must be object`);
        return;
      }
      if (!PHASES.includes(phase.phase)) errors.push(`${path}.phase invalid`);
      if (phase.earliestTime !== null && typeof phase.earliestTime !== 'string') errors.push(`${path}.earliestTime invalid`);
      if (phase.latestTime !== null && typeof phase.latestTime !== 'string') errors.push(`${path}.latestTime invalid`);
      if (typeof phase.interpretation !== 'string') errors.push(`${path}.interpretation must be string`);
      validateEvidenceRefs(phase.evidenceRefs, `${path}.evidenceRefs`, errors);
    });

    const window = value.nextDecisionWindow;
    if (!isObject(window)) errors.push('nextDecisionWindow must be object');
    else {
      if (!DECISION_QUESTIONS.includes(window.question)) errors.push('nextDecisionWindow.question invalid');
      if (window.earliestTime !== null && typeof window.earliestTime !== 'string') errors.push('nextDecisionWindow.earliestTime invalid');
      if (window.latestTime !== null && typeof window.latestTime !== 'string') errors.push('nextDecisionWindow.latestTime invalid');
      if (typeof window.interpretation !== 'string') errors.push('nextDecisionWindow.interpretation must be string');
      validateEvidenceRefs(window.evidenceRefs, 'nextDecisionWindow.evidenceRefs', errors);
    }

    if (!isObject(value.signalInterpretation)) errors.push('signalInterpretation must be object');
    else ['T1', 'T3', 'T8'].forEach(code => validateSignal(value.signalInterpretation[code], `signalInterpretation.${code}`, errors));

    for (const key of ['supportingEvidence', 'contradictingEvidence']) {
      const rows = value[key];
      if (!Array.isArray(rows)) errors.push(`${key} must be array`);
      else rows.forEach((row, index) => {
        if (!isObject(row)) {
          errors.push(`${key}[${index}] must be object`);
          return;
        }
        if (typeof row.ref !== 'string' || !row.ref.startsWith('$.evidence.')) errors.push(`${key}[${index}].ref invalid`);
        if (typeof row.finding !== 'string') errors.push(`${key}[${index}].finding must be string`);
      });
    }

    if (!Array.isArray(value.modelSemanticConcerns)) errors.push('modelSemanticConcerns must be array');
    else value.modelSemanticConcerns.forEach((row, index) => {
      if (!isObject(row)) {
        errors.push(`modelSemanticConcerns[${index}] must be object`);
        return;
      }
      if (typeof row.code !== 'string') errors.push(`modelSemanticConcerns[${index}].code must be string`);
      if (typeof row.description !== 'string') errors.push(`modelSemanticConcerns[${index}].description must be string`);
      validateEvidenceRefs(row.evidenceRefs, `modelSemanticConcerns[${index}].evidenceRefs`, errors);
    });

    if (!Array.isArray(value.uncertainties)) errors.push('uncertainties must be array');
    else value.uncertainties.forEach((row, index) => {
      if (!isObject(row)) {
        errors.push(`uncertainties[${index}] must be object`);
        return;
      }
      if (typeof row.description !== 'string') errors.push(`uncertainties[${index}].description must be string`);
      validateEvidenceRefs(row.evidenceRefs, `uncertainties[${index}].evidenceRefs`, errors);
    });

    return { valid: errors.length === 0, errors };
  }

  return Object.freeze({
    VERSION,
    OUTPUT_SCHEMA_VERSION,
    OUTPUT_JSON_SCHEMA,
    PHASES,
    DECISION_QUESTIONS,
    SIGNAL_ASSESSMENTS,
    buildInstructions,
    validateOutput
  });
});
