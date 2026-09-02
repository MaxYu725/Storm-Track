# AI Situation Shadow — contemporaneous HKO operational context

## Purpose

The AI Situation Analysis Shadow may use Hong Kong Observatory operational warning context only when that context was already public at or before the immutable Beta observation time being analysed.

This is not outcome feedback and does not allow later HKO truth, evaluator results or closeout results to rewrite an earlier forecast.

## Temporal rule

For a Beta observation at time `T`, the packet recorder selects only an HKO warning observation whose `retrievedAt <= T`.

A later HKO observation is rejected even if it exists by the time the packet is rebuilt.

The selected join records:

- source retrieval time;
- age at `T`;
- source capture fingerprint;
- source path;
- whether future candidates were rejected.

## Case-scope rule

An active tropical-cyclone warning is attached to a storm packet only when the contemporaneous HKO warning text contains a specific identity token for that case, such as the reconciled Chinese or English storm name.

This prevents an active warning for one Hong Kong-impacting system from leaking into another simultaneously tracked storm such as a remote control case.

If HKO has no active tropical-cyclone warning at `T`, that global no-warning state may be attached as contemporaneous operational context.

## Allowed evidence

The projected context may contain the contemporaneous:

- active signal code and label;
- issue/update/expiry timestamps already public at `T`;
- HKO warning paragraphs already public at `T`;
- contemporaneous Pre-8 or Special Weather Tip context, when present.

## Forbidden evidence

The AI packet must not contain:

- an HKO warning observation retrieved after `T`;
- a T3/T8 event that occurred after `T`;
- evaluator scores calculated after the event;
- formal no-signal closeout results;
- post-case judgement or model promotion labels.

## Semantics

Packets with this context declare:

```text
noTruthCorpusRead = false
noFutureTruthFeedback = true
contemporaneousOfficialContextOnly = true
noFutureOfficialContextJoin = true
```

Batch semantics additionally declare:

```text
truthBranchUseRestrictedToContemporaneousOfficialContext = true
futureTruthFeedbackIncluded = false
outcomeEvaluatorInputIncluded = false
officialContextJoinMustBeAtOrBeforeObservation = true
```

The AI inference remains shadow-only:

```text
affectsForecast = false
affectsEvaluator = false
caseSpecificRulesForbidden = true
```

## Why this boundary is necessary

The first Workers AI pilot showed that a packet without the current HKO signal state could ask the AI the wrong operational question. In SAUDEL, the model could interpret a deterministic future T1 window as a new issuance question even though T1 was already active in the real contemporaneous operational state.

The correction is not a SAUDEL special rule. The generic requirement is that situation reasoning should know the current official state that was already available at inference time while remaining blind to future outcomes.
