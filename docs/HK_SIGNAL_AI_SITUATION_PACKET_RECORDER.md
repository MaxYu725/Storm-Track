# HK Signal AI Situation Shadow packet recorder

Status: **PROSPECTIVE INPUT RECORDING — NO AI PROVIDER INVOCATION**

This stage sits between the evidence-packet foundation and the future inference provider. Its purpose is to save the exact model input **before** any AI model sees it, so later evaluation can distinguish input drift, provider behavior, prompt behavior and outcome leakage.

## Pipeline

```text
HK Signal Beta prospective recorder
        ↓
data/beta-prospective-observations
        ↓
case-registry exact group-key resolution
        +
HKO local-wind immutable observation at-or-before the Beta observation time
        ↓
build-hk-situation-analysis-shadow-packets.mjs
        ↓
data/hk-situation-analysis-shadow-packets
        ↓
future inference provider
```

The recorder deliberately does **not** read `data/hko-warning-truth` or `data/hk-signal-evaluations`.

## Temporal join rule

Local wind is useful only if it was already observable at the time of the prospective HK Signal observation.

For every Beta observation, the recorder searches the immutable HKO local-wind corpus and selects the newest observation whose `summary.dataTimestamp` is **less than or equal to** the Beta `observedAt` time. Newer local-wind files are explicitly rejected as future evidence.

The join metadata records:

- selected local-wind data timestamp;
- age in minutes relative to the Beta observation;
- local-wind capture fingerprint;
- immutable source path;
- count of later candidate files that were rejected.

No local-wind value is copied into the deterministic TC wind-field channel and `affectsForecast=false` remains unchanged.

## Case identity rule

The packet recorder does not implement a second storm resolver. It consumes the already-reconciled `storm-case-identity/v1` registry and resolves only by an exact current `group.key` entry in `caseRegistry.cases[].groupKeys`.

If there is no unique exact match, the packet is retained with an unresolved case ID. The recorder does not fall back to a new source-ID overlap heuristic because that could reintroduce identity-contamination behavior already fixed in the main resolver.

Storm identity is provenance only and cannot select prompt branches or deterministic rules.

## Packet fingerprinting

Each packet receives a SHA-256 fingerprint over canonicalized:

- the complete `hk-situation-analysis-shadow-input/v0.1` evidence packet; and
- its provenance / temporal-join metadata.

`builtAt` is excluded from the evidence fingerprint. Rebuilding the same evidence later therefore produces the same packet and batch fingerprint.

A batch fingerprint is derived from the source Beta capture fingerprint plus the ordered packet fingerprints.

## Data branch layout

Output branch:

```text
data/hk-situation-analysis-shadow-packets
```

Layout:

```text
latest.json
index.ndjson
batches/YYYY/MM/DD/<timestamp>-<fingerprint>.json
packets/<case-id>/YYYY/MM/DD/<timestamp>-<fingerprint>.json
cases/<case-id>/latest.json
```

`batches/` preserves exactly what the recorder produced for one source Beta state. `packets/` provides immutable per-case inputs. `cases/<case-id>/latest.json` is only a convenience pointer and is never the historical authority.

## Hard separation from truth

The output declares:

```text
shadowOnly=true
affectsForecast=false
affectsEvaluator=false
providerInvocationIncluded=false
truthBranchInputIncluded=false
noTruthCorpusRead=true
noFutureLocalWindJoin=true
caseSpecificRulesForbidden=true
```

This separation is intentional. A future AI inference run must be reproducible from a saved packet without consulting later HKO signal truth or evaluator grades.

## HKO statement evidence

The current packet foundation supports a structured HKO signal statement, but there is not yet an immutable historical statement corpus aligned to each Beta observation. The recorder therefore records:

```text
hkoSignalStatementJoin.status = not-recorded-in-source-corpus
```

It does **not** fetch the current HKO statement later and attach it to an older packet. That would introduce future leakage.

A later phase may add a prospective HKO statement recorder. Only after that corpus exists may time-aligned statements be joined.

## Next gate: actual inference

Actual AI invocation remains the next stage. Before enabling it:

1. choose the provider/runtime;
2. freeze a versioned system instruction and structured output schema;
3. record provider/model/prompt version and the exact packet fingerprint on every output;
4. reject malformed or non-schema outputs rather than silently repairing them with outcome-aware logic;
5. store outputs on a separate data branch;
6. keep V1, V2, HKO truth and evaluator behavior unchanged.

The provider must consume these saved packets. It must not bypass the recorder and reconstruct a richer input from current/live sources after the fact.
