# HK Signal V2 quiet-window active revision — September 2026

Status: **ACTIVE DEVELOPMENT WINDOW**

This document supersedes the earlier interpretation that HK Signal model development must remain almost entirely frozen until another ordinary HKO T1/T3/T8 positive case appears.

The revised development policy is:

- **when a tropical cyclone is materially affecting / approaching Hong Kong, freeze meteorological model semantics** so the live prospective sequence is not contaminated by case-following edits;
- **when no material Hong Kong-impact tropical cyclone is active, use the quiet window to revise V2 aggressively but audibly**, based on the defects already demonstrated by completed cases, immutable prospective captures, deterministic regression fixtures and as-issued historical material where valid;
- V1 remains frozen only as a control/benchmark. It is not a reason to stop V2 development.

## Why the policy changed

Storm Track has now processed enough independent tropical cyclones to prove that the first-version model has genuine limitations even though the sample is not yet balanced enough for final calibration:

- **ATSANI** provides a clean no-signal control;
- **GAENARI** exposed source-membership/confidence and positive-without-window semantics;
- **NARRA** produced a sustained T1 false-positive sequence, including 26 `likely` captures, plus a distinct terminal residual failure;
- **SAUDEL** proved that one global closest approach and one risk window cannot adequately represent a multi-pass approach → departure → later re-approach lifecycle.

Waiting for a future perfect T1/T3/T8 case before doing any model work would waste the current low-risk development period and would make future live storms carry unnecessary known defects.

## What remains frozen

### V1

`analysis/basic-hk-signal-forecast.js` remains the immutable comparison baseline.

Do not modify V1 merely to make completed cases look better. Its defects are useful control evidence against which later V2 revisions are measured.

### Truth separation

Official HKO outcomes remain verification-only. A V2 revision may be designed after reviewing completed outcomes, but when an archived prospective snapshot is recomputed, the forecast calculation itself must consume only information that existed in that snapshot.

### Live-storm stop condition

If a new tropical cyclone becomes materially relevant to Hong Kong while a V2 revision is in progress:

1. finish only correctness/syntax/data-integrity fixes already in flight;
2. freeze the current V2 candidate version;
3. begin a new prospective comparison sequence;
4. defer further coefficient/semantic revisions until the Hong Kong-impact lifecycle closes.

This is a development hygiene rule, not a requirement to wait months between revisions.

## V2 Shadow 0.3 development objectives

V2 0.3 is a **development revision**. It is not promoted over V1 yet, but it deliberately goes beyond the narrow 0.2 postprocessor.

### 1. Phase-aware lifecycle context

V2 0.3 derives a separate phase context from the future threat timeline:

- current/near-term phase minimum;
- later phase minimum;
- global future minimum;
- whether the global minimum belongs to a materially later phase;
- operational phase such as `approach`, `departure`, `departure-before-reapproach`, `multi-phase`, or `quasi-stationary`.

This directly addresses the generic defect exposed most clearly by SAUDEL: a mathematically correct full-horizon global minimum must not be presented as though it described one continuous operational pass.

The phase context is storm-agnostic. It contains no SAUDEL name, ID, date or special coefficient.

### 2. Separate source presence from analytic usability

V2 0.2 used one fixed-four-agency coverage factor. V2 0.3 records two independent concepts:

- how many official agency sources are present in the grouped case;
- how many are analytically usable for the current signal calculation.

Both dimensions affect numeric confidence. This avoids treating all missing evidence as one identical failure mode and creates diagnostics that can later distinguish an unissued/non-applicable source from a present-but-unusable source.

### 3. Separate checkpoint participation from threshold-positive support

V2 0.2's long-horizon T3/T8 rule used `strongestCheckpoint.totalAgencyCount`, which measures participation at the checkpoint rather than the number of agencies positively supporting the signal threshold.

V2 0.3 explicitly computes both:

- `participationFraction = checkpointAgencyCount / usableAgencyCount`;
- `positiveSupportFraction = supportAgencyCount / checkpointAgencyCount`.

For >72 h T3/T8 evidence, both contribute continuously to the far-horizon discount. There is still no hard agency-count veto, preserving minority exact-threat sensitivity.

### 4. Add T1 decision-readiness without deleting broad early warning

NARRA shows that V1's broad T1 physical-risk channel can escalate to `likely` too readily in at least one ordinary no-signal case. Raising the global T1 possible threshold would risk destroying useful early-watch sensitivity.

V2 0.3 therefore keeps physical T1 risk and adds a second `decisionReadinessIndex` for the `likely` state. It uses:

- positive-support fraction at the strongest checkpoint;
- strongest-checkpoint lead-time credibility;
- persistence;
- phase context.

A V1 `possible` state is never removed merely because readiness is low. A marginal V1 `likely` can be downgraded to `possible` when physical risk is present but decision maturity remains weak.

This is deliberately a shadow hypothesis and will be measured retrospectively across the existing corpus before any promotion decision.

### 5. Preserve generic departure and terminal decay

The NARRA/GAENARI post-minimum decay and NARRA terminal stale/degraded-state guard remain in 0.3.

The phase-aware architecture also makes the intended meaning clearer: departure suppression is for a lifecycle with **no remaining future threat timeline**. A later meaningful re-approach is represented as a separate phase rather than being accidentally erased by a generic departure rule.

### 6. Make timing semantics explicit

V2 0.3 continues explicit timing states and adds later-phase distinctions such as:

- `later-phase-estimated`;
- `multi-phase-left-censored-or-horizon-limited`.

An estimated V2 window is explicitly marked `risk-evidence-window`. It is **not** an inferred HKO issuance/change time.

This fixes a generic output-contract problem without using later official truth to alter the risk calculation.

## Retrospective development without hindsight leakage

The new comparator:

`scripts/compare-hk-signal-v2-corpus.mjs`

recomputes V2 0.3 over the stored `beta-prospective-recorder/v2` corpus.

The recorder already preserves the V1 basic forecast, signal inputs, threat-assessment timeline and compact source lifecycle metadata. Therefore V2 postprocessing can be replayed over historical prospective captures even though raw source payloads are hashed/removed after capture.

The comparator records per stable case:

- V1/V2 positive, possible and likely counts;
- first/last positive and first likely timestamps;
- maximum risk;
- `likely → possible` changes;
- `positive → unlikely` withdrawals;
- timing-state distribution;
- T3/T8 long-horizon adjustment frequency;
- phase-state distribution;
- terminal/departure/source-coverage adjustment frequency.

Official truth is deliberately **not an input to V2 recomputation**. Outcome comparison is a later scoring/diagnostic step.

## Promotion philosophy

The purpose of this quiet window is not to force V2 into production status. It is to eliminate known architectural weaknesses before the next live Hong Kong case.

A V2 change may be implemented now when it is one of:

1. a generic semantic correction already demonstrated by completed cases;
2. a generic physically/mathematically defensible architecture improvement;
3. a shadow calibration hypothesis that can be replayed across the existing immutable corpus and protected by counterexample tests.

A change must still be rejected when it is:

- tied to one storm name/ID/date;
- based on later truth inside the forecast calculation;
- a one-off coefficient whose only justification is making one completed case score better;
- a replacement of missing agency data with another agency silently.

## Current engineering sequence

1. **Build V2 0.3 as a dedicated deterministic development module.**
2. **Run deterministic regression fixtures** for phase-awareness, source coverage, positive-support semantics, T1 readiness, NARRA terminal lifecycle and active-storm counterexamples.
3. **Replay the immutable prospective corpus** and inspect case-by-case V1/V2 behavior changes.
4. Refine V2 0.3 during the quiet period if the replay reveals broad regressions.
5. Only after the candidate is stable, wire the selected V2 revision into the live V1/V2 Beta surface and start a new immutable prospective sequence.
6. If a Hong Kong-relevant storm appears before step 5 completes, freeze the current candidate rather than continuing to tune against the live storm.

## Development decision

The project is no longer in a passive `OBSERVE MORE` mode.

The correct state is:

**V1 = frozen benchmark · V2 = active quiet-window development · prospective live periods = freeze-and-observe.**

This preserves scientific comparability without turning limited sample size into a reason to leave already demonstrated model defects untouched.