# HK Signal AI Situation Analysis Shadow

Status: **FOUNDATION PHASE — SHADOW ONLY / NO FORECAST EFFECT**

This phase starts after the September 2026 rule audit. It does **not** replace frozen V1, does not promote V2, and does not add another deterministic correction layer. Its purpose is to let an AI reasoning layer interpret an already-computed evidence package while every numerical fact remains traceable to deterministic or official sources.

## Why this phase exists

SAUDEL showed that the main failure mode is increasingly contextual rather than arithmetic. A forecast horizon can contain a first approach, departure, quasi-stationary transition and later re-approach. A single global closest, a single likelihood state, or a single threshold-crossing window can therefore describe the wrong lifecycle phase even when the underlying numbers are individually valid.

Adding enough `if/else` clauses to capture every unusual path would create a brittle decision tree and may damage ordinary direct-approach storms. The new layer therefore handles **situation interpretation**, not evidence generation.

## Architecture

```text
HKO / CMA / JMA / CWA as-issued data
HKO official signal context / statement
HKO Local Wind Observation Shadow
        ↓
Existing deterministic engines
storm-analysis-core
hk-impact-engine
hko-signal-risk-inputs
hk-threat-assessment
basic-hk-signal-forecast/v1
HK Signal V2 Shadow 0.1
        ↓
hk-situation-analysis-shadow input packet
        ↓
AI Situation Analysis Shadow  [future invocation step]
        ↓
interpretation only
        ↓
prospective comparison / audit

NO arrow back into V1/V2 risk or evaluator
```

## Foundation scope in this PR

The foundation introduces a storm-agnostic **evidence-packet contract**. It packages information that an AI layer may later interpret:

- V1 and V2 T1/T3/T8 state, risk, confidence, persistence, window and strongest checkpoint;
- current and representative-minimum geometry;
- direct approach, direct departure, re-approach, quasi-stationary, forecast-edge, disagreement, interpolation-reliability, wind-field and rapid-evolution analyzers;
- per-agency lifecycle pattern evidence already produced by the deterministic threat engine;
- HKO official warning context and optional structured HKO signal statement;
- optional HKO local-wind observation shadow, including summary and station rows when supplied;
- an explicit task/output contract for a future AI invocation.

The foundation **does not call an AI model yet**. This separation is intentional: first lock the input/output and safety semantics, then attach an inference provider without changing what evidence the model sees from one run to another.

## Non-negotiable semantics

Every packet declares:

- `shadowOnly=true`;
- `affectsForecast=false`;
- `noForecastMutation=true`;
- `noTruthFeedback=true`;
- `aiInvocationIncluded=false` in this foundation step;
- local wind remains observation-only;
- HKO official state/wording is context, not a hidden label used to rewrite V1/V2;
- storm name / case ID are provenance only and must never select a special rule.

## Intended AI task

A future inference step may answer questions that are difficult to express safely as fixed thresholds:

1. What lifecycle phase is occurring **now**?
2. Is there a later phase, such as re-approach, that should be separated from the current phase?
3. Which closest approach is operationally relevant now, and which belongs to a later phase?
4. Do distance, intensity, TC wind-field evidence, local observed wind and official HKO wording support or contradict one another?
5. Given the current official signal state, is the meaningful next question maintenance, cancellation, escalation, or later reassessment?
6. Are V1/V2 timing outputs internally consistent with their own strongest evidence and lifecycle phase?
7. Which conclusions are robust, and which depend on forecast-edge / agency disagreement / sparse evidence?

The AI should produce an **interpretation**, not new meteorological measurements.

## Future output contract

The input packet advertises a target output schema containing at least:

```text
currentPhase
currentPhaseConfidence
futurePhases[]
currentThreatInterpretation
nextDecisionWindow
signalInterpretation.T1/T3/T8
supportingEvidence[]
contradictingEvidence[]
modelSemanticConcerns[]
uncertainties[]
```

Evidence references in the answer should point back to packet fields. The AI must not invent coordinates, wind speeds, HKO signal times or agency positions.

## Anti-overfitting constraints

The future inference layer must obey these constraints:

- No rule or prompt branch selected by `SAUDEL`, storm name, JMA number, case ID, or exact historical date.
- No statement such as “SAUDEL usually…” used as a predictive feature.
- No single-station gust automatically interpreted as T3/T8 truth.
- Local wind and tropical-cyclone wind-field evidence remain separate domains.
- Missing agency data remains missing; no silent agency substitution.
- HKO official outcome can be compared with predictions prospectively, but later truth cannot alter an earlier saved interpretation.
- The layer may say deterministic evidence is ambiguous or phase-mixed; it may not silently rewrite underlying risk indices.
- A future AI answer must be allowed to return `uncertain` rather than force a signal conclusion.

## Relationship to V1 and V2

### Frozen V1

V1 remains the formal evaluator baseline. No AI output enters V1.

### V2 Shadow 0.1

V2 remains a deterministic candidate. Its existing hypotheses remain frozen so its live A/B sequence is still interpretable. The AI layer may **criticize or contextualize** V2 but cannot change its risk numbers.

### Evaluator

The current evaluator remains V1-only. AI Situation Analysis Shadow must build its own prospective record before any scoring design is considered.

## SAUDEL's role

SAUDEL is the first high-value stress case because it contains multiple lifecycle phases and several conflicting evidence channels. It is **not a training template** and will not receive a special prompt or deterministic rule.

The correct success criterion is not “AI makes SAUDEL look right.” The criterion is:

> The same storm-agnostic interpretation contract makes SAUDEL more coherent **without degrading ordinary direct-approach, direct-departure, or no-signal cases**.

GAENARI, NARRA, historical completed cases and future ordinary Hong Kong-impact storms should therefore be used as controls.

## Phase gates

### Foundation — current

- complete deterministic-rule audit;
- create stable evidence-packet builder;
- regression-test that building a packet cannot mutate V1/V2;
- explicitly keep local wind observation-only;
- no external AI invocation.

### Inference shadow — next

- choose an inference provider/runtime;
- store exact prompt/version/model metadata;
- run only from saved as-issued prospective packets;
- save output immutably beside, not inside, V1/V2;
- no evaluator promotion.

### Prospective evaluation — later

Only after enough independent cases:

- define qualitative/structured AI metrics before looking at final outcomes;
- compare lifecycle-phase correctness, timing interpretation and contradiction detection;
- check ordinary-path regression explicitly;
- decide `KEEP`, `MODIFY`, or `WRITE-OFF` for the AI layer independently of V2.

## Stop condition

If the AI layer requires SAUDEL-specific prompt clauses to work, the experiment has failed its primary architectural purpose. Do not compensate by growing another hidden rule tree inside the prompt.
