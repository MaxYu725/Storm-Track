# HK Signal V2 quiet-window active revision — September 2026

Status: **ACTIVE DEVELOPMENT WINDOW — V2 0.5 CANDIDATE**

This document supersedes the earlier interpretation that HK Signal model development must remain almost entirely frozen until another ordinary HKO T1/T3/T8 positive case appears.

The development policy is now:

- **when a tropical cyclone is materially affecting / approaching Hong Kong, freeze meteorological model semantics** so the live prospective sequence is not contaminated by case-following edits;
- **when no material Hong Kong-impact tropical cyclone is active, use the quiet window to revise V2 actively but audibly**, based on demonstrated defects, immutable prospective captures, deterministic regression fixtures and valid historical material;
- V1 remains frozen only as a control/benchmark. It is not a reason to stop V2 development.

## Evidence already available

Storm Track has processed enough independent systems to prove that V1 has real limitations even though the sample is not yet balanced enough for final calibration:

- **ATSANI** provides a clean no-signal control;
- **GAENARI** exposed source-membership/confidence and positive-without-window semantics;
- **NARRA** produced a sustained T1 false-positive sequence, including 26 `likely` captures, plus a distinct terminal residual failure;
- **SAUDEL** exposed the inability of one global closest approach / one timing window to represent a multi-pass approach → departure → later re-approach lifecycle.

Waiting for another ideal T1/T3/T8 case before doing any model work would leave known defects in place unnecessarily.

## What remains frozen

### V1

`analysis/basic-hk-signal-forecast.js` remains the immutable comparison baseline.

Do not modify V1 to make completed cases look better. Its output is preserved as control evidence against later V2 candidates.

### Truth separation

Official HKO outcomes are verification-only. Completed outcomes may motivate a generic redesign, but retrospective recomputation must consume only information already present in each immutable prospective snapshot.

### Live-storm stop condition

If a new tropical cyclone becomes materially relevant to Hong Kong while V2 is being revised:

1. finish only correctness/syntax/data-integrity fixes already in flight;
2. freeze the current V2 candidate;
3. begin a new prospective comparison sequence;
4. defer meteorological coefficient/semantic changes until that Hong Kong-impact lifecycle closes.

## V2 development sequence

### 0.3 — architecture split

The first quiet-window candidate moved beyond the narrow 0.2 postprocessor and introduced:

- phase-aware lifecycle context;
- separate source presence vs analytic usability confidence;
- separate long-horizon checkpoint participation vs threshold-positive support;
- a T1 `decisionReadinessIndex` for `likely` without deleting broad `possible` sensitivity;
- retained post-minimum / terminal lifecycle decay;
- explicit risk-window semantics.

The first corpus replay was useful precisely because it exposed two weaknesses before another live storm arrived: the phase detector was too permissive, and T1 readiness did not sufficiently reduce the NARRA `likely` sequence.

### 0.4 — phase correctness + geometric T1 maturity

V2 0.4 corrected phase detection so a later minimum alone is not enough to declare a multi-phase storm. A valid re-approach now requires an actual material sequence:

`inward / first pass → outward movement → later inward recovery`

with temporal separation and shape strength. Ordinary monotonic approaches are no longer mislabeled merely because their minimum lies beyond +36 h.

For T1, the corpus diagnostic showed that risk, agency support and short lead time did **not** cleanly separate NARRA from a real T1 case. Geometry did:

| V1 `likely` diagnostic | SAUDEL | NARRA |
|---|---:|---:|
| likely captures | 214 | 26 |
| risk median | 0.756 | 0.723 |
| strongest evidence lead median | 9.0 h | 11.4 h |
| support fraction median | 1.00 | 1.00 |
| current distance median | 358 km | 655 km |
| forecast minimum median | 212 km | 388 km |

V2 0.4 therefore made T1 `likely` require a continuous geometric decision-maturity factor based on current distance and forecast minimum distance. It did **not** raise the V1 T1 `possible` threshold.

The immutable corpus replay for V2 0.4 covered 735 recorder files / 1777 observations / 8 stable cases. Key behavior changes were:

| Case | V1 T1 positive / likely | V2 0.4 positive / likely | Notes |
|---|---:|---:|---|
| SAUDEL | 515 / 214 | 461 / 179 | 35 likely→possible; 54 terminal/lifecycle positives removed; 6 genuine multi-phase captures detected |
| NARRA | 136 / 26 | 134 / 12 | 14 likely→possible; 2 terminal positives removed |
| TC2623 | 70 / 0 | 70 / 0 | broad possible sensitivity preserved |
| five clean-negative identities | 0 / 0 | 0 / 0 | no new positives |

This confirmed that the phase correction eliminated the broad false multi-phase problem and that geometric maturity improved NARRA substantially without deleting ordinary `possible` behavior.

### 0.5 — persistence becomes part of T1 maturity

The 0.4 audit exposed a smaller but concrete implementation gap: `persistenceCredibility` was already calculated inside T1 readiness but was only diagnostic; it did not actually participate in the readiness factor.

That is corrected in V2 0.5.

T1 `likely` readiness now combines, continuously:

- physical V1 risk;
- current/forecast geometric maturity;
- strongest-checkpoint lead-time credibility;
- **persistence maturity**;
- operational phase factor.

There is still no hard minimum-duration gate. Persistence uses a smooth asymptotic credibility curve and a conservative factor floor of `0.85`, so a newly emerged signal is discounted modestly rather than vetoed. Long-lived evidence converges back toward a factor of 1.

This change is generic. It contains no storm name, ID, date or HKO outcome input. It also preserves the invariant that a V1 `possible` state is not deleted solely because `likely` maturity is weak.

The specific purpose of 0.5 is to test whether short-lived marginal `likely` episodes contract further across the immutable corpus while sustained mature T1 evidence remains intact.

## Phase-aware lifecycle context

The current V2 candidate records separately:

- current/near-term phase minimum;
- later phase minimum;
- global future minimum;
- whether the global minimum belongs to a materially later phase;
- operational state such as `approach`, `departure`, `departure-before-reapproach`, `multi-phase`, or `quasi-stationary`.

A full-horizon minimum can therefore remain mathematically available without being presented as though it describes the immediate operational pass.

## Source evidence semantics

V2 separately records:

- source agencies present in the grouped case;
- agencies analytically usable for the current forecast;
- checkpoint participation fraction;
- threshold-positive support fraction.

These are distinct evidence dimensions. Missing evidence is not silently substituted by another agency.

For T3/T8 beyond +72 h, participation and positive support contribute continuously to long-horizon evidence discounting. There is no hard one-agency veto.

## Timing semantics

An estimated V2 window is explicitly a `risk-evidence-window`; it is not an inferred HKO issuance/change time.

The current candidate also distinguishes states including:

- `estimated`;
- `later-phase-estimated`;
- `left-censored-or-horizon-limited`;
- `multi-phase-left-censored-or-horizon-limited`;
- `post-minimum-no-future`;
- `unresolved`.

This keeps positive risk and timing uncertainty from being conflated.

## Retrospective development without hindsight leakage

`scripts/compare-hk-signal-v2-corpus.mjs` recomputes the current V2 candidate over the stored `beta-prospective-recorder/v2` corpus.

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

Official truth is **not** an input to the V2 recomputation. Outcome comparison is a separate validation step.

## Promotion philosophy

The quiet window is not intended to force V2 into production quickly. It is intended to remove known architectural weaknesses before the next live Hong Kong case.

A V2 change may be implemented when it is one of:

1. a generic semantic correction already demonstrated by completed cases;
2. a generic physically/mathematically defensible architecture improvement;
3. a shadow calibration hypothesis that can be replayed across the immutable corpus and protected by counterexample tests.

Reject changes that are:

- tied to one storm name/ID/date;
- based on later truth inside forecast calculation;
- a one-off coefficient whose only justification is improving one completed case;
- silent substitution of missing agency data;
- a new hard threshold when a continuous evidence weighting can represent the same concept.

## Current engineering sequence

1. Keep **V1 frozen** as the control.
2. Run deterministic regression fixtures on every V2 candidate.
3. Replay the complete immutable prospective corpus after every material semantic change.
4. Inspect regressions and diagnostic separation before changing another factor.
5. Collapse the selected candidate into the live V1/V2 Beta surface only after the quiet-window candidate is stable.
6. Once live prospective comparison begins, freeze that V2 version for the whole Hong Kong-impact lifecycle.

## Development decision

The project is no longer in passive `OBSERVE MORE` mode.

**V1 = frozen benchmark · V2 = active quiet-window development · prospective live periods = freeze-and-observe.**
