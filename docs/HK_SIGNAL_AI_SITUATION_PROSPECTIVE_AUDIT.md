# HK Signal AI Situation Analysis — Prospective Audit v0.1

Status: **READ-ONLY AUDIT / NO FORECAST EFFECT**

This layer audits saved AI Situation Analysis Shadow output without changing the prompt, V1, V2 Shadow, evaluator, closeout or any forecast coefficient. It exists so recurring semantic weaknesses can be measured before deciding whether another prompt revision is justified.

## Why this layer is separate from prompt tuning

The controlled Workers AI pilots reached a point where the structured contract and active-signal applicability can pass while softer interpretation issues can still remain. Immediately adding another prompt clause after every example would recreate the brittle rule-tree problem the AI layer was intended to avoid.

The prospective audit therefore records generic review flags first. A review flag is **not** an automatic model failure and does not modify the inference. Repeated independent evidence is required before a prompt change is justified.

## Automatic contract checks

The audit verifies:

- inference and packet fingerprints match;
- inference remains `shadowOnly=true`;
- `affectsForecast=false` and `affectsEvaluator=false`;
- the current prompt/evidence validator still accepts the saved structured output when supplied;
- the source inference request fingerprint, provider attempt count and repair metadata remain available for later reliability analysis.

A structural failure produces `status=fail`.

## Review flags in v0.1

### `CURRENT_THREAT_METRIC_MISMATCH`

If `currentThreatInterpretation` explicitly states a numeric **threat index**, the value is compared with deterministic V1/V2 impact threat-index values. A material mismatch is flagged for review.

This catches metric-name confusion such as accidentally describing a signal risk index as the overall impact threat index.

### `FUTURE_OPERATIONAL_PHASE_REVIEW`

If a case is currently `remote`, V1 impact is `expected=false / likelihood=unlikely`, no contemporaneous HKO operational context exists, but the AI introduces a future `approaching` phase, the audit asks for review.

This does not assert that the future phase is wrong. It asks whether the AI is describing an operational Hong Kong lifecycle phase or merely a geometrically decreasing distance.

### `NULL_TIMING_ACTION_CAUSALITY_REVIEW`

If the deterministic V1 signal has no `estimatedWindow`, but an AI signal interpretation appears to use that missing window as causal support for maintenance/cancellation/escalation, the output is flagged.

A null window means **absence of deterministic timing guidance**. It is not evidence for an operational action. An action may still be supported independently by contemporaneous HKO context.

## Status meanings

- `pass` — structural checks pass and no v0.1 review flag is raised;
- `review` — structural checks pass, but one or more generic interpretation questions should be inspected;
- `fail` — packet/inference isolation or the underlying structured semantic contract is invalid.

`review` must never be converted into forecast penalties, likelihood changes or evaluator scores.

## No-outcome rule

The v0.1 prospective audit does not read later HKO truth, evaluator outcomes or future observations. It only examines:

1. one saved immutable inference;
2. the exact immutable packet used by that inference;
3. the already-versioned prompt/evidence validator.

Therefore the audit can be run immediately after inference without contaminating later prospective verification.

## Automatic recorder

`.github/workflows/hk-situation-analysis-prospective-audit.yml` also acts as the audit recorder.

After a successful **main-branch** `Run AI situation analysis Cloudflare Workers AI shadow` workflow completes, `workflow_run` starts the prospective audit automatically. It reloads each provider `latest.json`, resolves the exact immutable packet by the source packet fingerprint, runs the same v0.1 audit and validates the no-outcome/isolation contract.

Feature-branch and pull-request runs exercise code and audit logic but do not write prospective audit data.

Successful `pass` and `review` audit records are persisted to the dedicated branch:

```text
data/hk-situation-analysis-prospective-audits
```

Immutable history is keyed to the source inference, not the time the audit happened:

```text
audits/<case-id>/<provider>/YYYY/MM/DD/<inference-time>-<packet-fingerprint>-<request-fingerprint>-v01.json
```

Convenience pointers are stored under:

```text
cases/<case-id>/providers/<provider>/latest.json
```

and a compact append-only `index.ndjson` supports later aggregate review.

The source inference `requestFingerprint` is carried into every audit record. Re-running the recorder for an already-audited inference is therefore a no-op rather than a duplicate prospective sample.

The recorder is serialized with `cancel-in-progress: false` so two completed inference workflows cannot race while updating the audit data branch.

A structural `fail` stops the workflow before persistence. It is treated as an audit-contract failure rather than silently entering the accepted prospective corpus.

## Controlled v0.5 pilot observations

The fifth controlled Workers AI pilot produced valid first-pass outputs for both the SAUDEL stress case and KROVANH ordinary remote control case; neither required the one-shot repair path.

The audit framework was introduced after inspecting those outputs because they exposed useful generic review dimensions rather than hard contract failures:

- metric-name/value provenance in the qualitative current-threat summary;
- operational lifecycle phase versus geometry-only approach wording;
- avoiding causal interpretation of a missing deterministic timing window.

The first two-case audit produced:

- SAUDEL — `review`: `CURRENT_THREAT_METRIC_MISMATCH` and `NULL_TIMING_ACTION_CAUSALITY_REVIEW`;
- KROVANH — `review`: `FUTURE_OPERATIONAL_PHASE_REVIEW`.

These are deliberately recorded as review dimensions instead of immediately creating prompt v0.6.

## Decision rule before further prompt changes

Keep prompt v0.5 frozen while collecting independent prospective examples. Move to another prompt revision only when a generic review flag recurs often enough, or is severe enough across independent cases, to demonstrate a structural weakness rather than one model-generation variation.

The preferred outcomes remain:

- `KEEP v0.5` if flags are rare/non-material;
- `MODIFY` only for repeated generic semantic failure;
- `WRITE-OFF` if reliable situation interpretation cannot be achieved without case-specific prompt growth.
