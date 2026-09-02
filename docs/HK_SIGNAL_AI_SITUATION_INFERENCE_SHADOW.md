# HK Signal AI Situation Analysis — Inference Shadow

Status: **IMPLEMENTED HARNESS / MANUAL PILOT ONLY / NOT YET ACTIVATED**

This stage adds the first real inference-provider adapter after the rule audit, evidence-packet foundation and immutable pre-inference packet recorder.

It remains completely outside V1, V2, HKO truth, evaluator and closeout logic.

## Provider choice for the pilot

The initial adapter targets the OpenAI **Responses API** with Structured Outputs.

Default pilot model:

```text
gpt-5.6-terra
```

Default reasoning effort:

```text
medium
```

The model ID is a workflow input and is recorded with both the requested and returned model IDs. The default is not a promotion decision and can be changed for controlled comparison later.

No SDK dependency is added. The Node 22 runner uses `fetch` directly against:

```text
POST https://api.openai.com/v1/responses
```

## Why the workflow is manual-only

Actual inference can incur API cost and requires a repository secret. Therefore this phase deliberately does **not** run on cron, push, `workflow_run`, case-watch or live storm updates.

The only trigger is:

```text
workflow_dispatch
```

A human must explicitly select a case ID, model and reasoning effort.

This prevents a 15-minute prospective recorder from silently becoming a paid AI loop before the first outputs are inspected.

## Required secret

The runtime expects one GitHub Actions repository secret:

```text
OPENAI_API_KEY
```

The secret is passed only to the inference process and is never written to the packet or inference data branches.

The ChatGPT product subscription and OpenAI API billing are separate; this workflow requires an API credential that is authorized for the chosen API model.

## Closed-book request contract

The model receives only:

1. a versioned system instruction from `analysis/hk-situation-analysis-prompt.js`; and
2. the exact saved `evidencePacket` from one immutable `hk-situation-analysis-shadow-packet/v0.1` record.

It does **not** receive:

- HKO truth branch data;
- evaluator grades;
- current live web results;
- web-search tools;
- file-search tools;
- function tools;
- a newly rebuilt richer storm context;
- hidden SAUDEL-specific examples.

The request explicitly sets:

```text
store=false
tools omitted
Structured Outputs json_schema strict=true
```

The packet fingerprint and prompt version are also placed in request metadata for auditability.

## Prompt rules

Prompt version:

```text
hk-situation-analysis-prompt/v0.1
```

Core rules include:

- closed-book evidence only;
- storm identity is provenance only;
- no storm-name/case-ID/date/station special rule;
- do not modify or replace V1/V2 risk indices;
- separate the current lifecycle phase from later phases;
- keep geometry, TC wind-field, local measured wind and HKO official context as distinct evidence channels;
- do not infer T3/T8 from one exposed station or one gust;
- do not create new probabilities;
- use `uncertain` / `insufficient` rather than force an answer;
- every evidence citation in the structured result must point to a `$.evidence...` path in the supplied packet.

## Structured output

Output schema:

```text
hk-situation-analysis-shadow-output/v0.1
```

Required top-level fields:

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

For each T1/T3/T8 signal the AI does not emit a replacement risk score. It selects the meaningful next question:

```text
maintenance | cancellation | escalation | reassessment | none | uncertain
```

and an interpretation class:

```text
supports-escalation
supports-maintenance
supports-cancellation
mixed
insufficient
not-applicable
```

This is situation interpretation, not a second numerical forecast model.

## Double validation

The provider is asked for strict JSON Schema Structured Output, but the result is also validated locally before persistence.

The local validator checks:

- required enum/state fields;
- current-phase confidence range;
- T1/T3/T8 structure;
- evidence reference syntax;
- evidence references must begin with `$.evidence.`.

A refusal, incomplete response, non-JSON response or locally invalid output fails the run. The workflow does not silently repair it with later truth or heuristic fallback.

## Persistence

Successful outputs are written to a separate branch:

```text
data/hk-situation-analysis-shadow-inferences
```

Layout:

```text
latest.json
index.ndjson
inferences/<case-id>/YYYY/MM/DD/<timestamp>-<packet>-<request>.json
cases/<case-id>/latest.json
```

Each inference records:

- input packet fingerprint and source observation time;
- prompt version and request fingerprint;
- requested / returned model;
- Responses API response ID and request ID when available;
- reasoning effort;
- token usage returned by the API;
- `store=false` and `toolsEnabled=false`;
- validated structured output;
- immutable no-forecast/no-evaluator semantics.

By default, the workflow refuses to pay for another run when the latest case inference already uses the same packet + prompt + model + reasoning effort. `force=true` is available only for an intentional repeat/variance experiment.

## What is not enabled yet

Merging the harness does **not** activate AI inference. The first paid call should occur only after `OPENAI_API_KEY` is configured and the pilot case is explicitly dispatched.

There is no automatic scoring yet. A first pilot should be inspected for:

- phase separation quality;
- whether evidence references are genuinely grounded;
- whether the model merely paraphrases V1/V2 or adds useful contextual interpretation;
- whether it detects known semantic contradictions without being told the storm outcome;
- whether a control case receives normal, non-SAUDEL-shaped reasoning.

Only after that should automatic prospective invocation frequency, if any, be considered.
