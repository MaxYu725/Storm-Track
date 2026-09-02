# HK Signal rule / exception audit — September 2026

Status: **PRE-AI-SHADOW AUDIT COMPLETE**

Purpose: separate verified correctness defects from model-design limitations, generic hypotheses, and SAUDEL-only stress observations before any further HK Signal development. The objective is to avoid fitting the deterministic model to one unusual storm and then degrading normal-path storms.

## Decision taxonomy

Every finding is assigned to exactly one primary class.

| Class | Meaning | Action |
|---|---|---|
| `A — VERIFIED CORRECTNESS` | Data, identity, evaluator, closeout, recorder, freshness, or pipeline behavior is objectively wrong independent of storm geometry. | Fix and keep permanently; add regression coverage. |
| `B — GENERIC SEMANTIC DEFECT` | The deterministic output contract can become misleading even though calculations follow the current code. The issue is storm-agnostic and has either repeated cross-case evidence or a logically invalid representation. | Preserve evidence; redesign generically. Do not add case-specific conditions. |
| `C — GENERIC MODEL HYPOTHESIS` | A plausible deterministic improvement, but evidence is not yet sufficient to call the old behavior wrong. | Shadow only; require cross-case validation before promotion. |
| `D — SAUDEL STRESS OBSERVATION` | SAUDEL exposes a difficult physical/operational context, but the observation does not justify a deterministic rule by itself. | Feed the situation-analysis research layer; do not encode as a new V1/V2 exception. |
| `E — INSTRUMENTATION ONLY` | Extra capture, UI, or observation data added to understand a case; it does not change forecast semantics. | Keep when generally useful; case-specific capture may remain isolated. |

## High-level result

**No SAUDEL-specific branch was added to frozen V1.** `analysis/basic-hk-signal-forecast.js` entered the frontend Beta in the original HK Signal deployment and has not been incrementally patched in response to SAUDEL. The problems exposed by SAUDEL therefore mainly reveal limits already present in the first-version heuristic rather than a chain of SAUDEL patches.

The only current deterministic V2 rule explicitly motivated by SAUDEL is the **T3/T8 long-horizon minority-support discount** in Shadow 0.1. It is written storm-agnostically, but the evidence basis is still heavily SAUDEL MB-02. It must remain frozen as an experiment and must not accumulate additional SAUDEL clauses.

## 1. Verified correctness defects — retain permanently

These are not examples of overfitting. They protect the integrity of every case and should remain independent of the future model architecture.

| Finding | Evidence / prior action | Classification | Decision |
|---|---|---|---|
| Generic TD → named storm identity split | GAENARI could be split during naming transition. Stable identity / normalization was corrected. | `A` | **KEEP** |
| Same-case same-capture ambiguity could contaminate evaluator state flips | Ambiguous final groups are now excluded from derived evaluation while raw evidence remains immutable. | `A` | **KEEP** |
| Reused source ID could merge two mutually exclusive named storms | NARRA / ETAU showed a real source-token reuse collision and fake withdrawal. Named-identity conflict now outranks source-ID overlap. | `A` | **KEEP** |
| Fully closed case could remain active/pending in derived evaluator state | Closeout bookkeeping now reconciles derived closeouts before building active/pending lists. | `A` | **KEEP** |
| No-signal closeout could be inferred from wall-clock passage despite evidence gaps | Closeout now requires continuous healthy overlapping prospective absence + HKO truth coverage rather than elapsed time alone. | `A` | **KEEP** |
| Coverage keeper handoff could cancel a still-active keeper and create evidence gaps | Keeper lifecycle was changed so replacement sessions do not cancel the active run; successor is queued and cron remains fallback. | `A` | **KEEP** |
| Successful unchanged HKO truth polls could look stale | `latest.json` heartbeat now reflects polling liveness without creating duplicate truth events/history. | `A` | **KEEP** |
| Evaluator could lag successful upstream recorders because independent cron did not fire | Successful recorder workflow runs now trigger the evaluator while independent cron remains fallback. | `A` | **KEEP** |
| Production D1 ingest repeatedly rewrote unchanged rows / expensive diagnostics amplified writes | No-op writes and scheduled COUNT diagnostics were removed while API/schema contracts were preserved. | `A` | **KEEP**; unrelated to forecast model |

**Rule:** Class A fixes may be made immediately in future live cases because they repair evidence integrity, not meteorological judgment.

## 2. Confirmed generic semantic defects — do not solve with SAUDEL exceptions

### B1. Signal issuance window is not lifecycle/state aware

Observed most clearly in SAUDEL: HKO issued T1 on 2026-08-31 18:10 HKT, yet the frozen model could later create a new future T1 `estimatedWindow`. The current forecast engine derives a signal window from a future threshold crossing or future distance-band entry; it does not know that the operational event for that signal has already happened.

This is a **real output-contract defect**, not evidence that a special rule such as `if SAUDEL && T1 active then window=null` should be added.

Generic redesign target:

- distinguish `risk window` from `issuance / escalation / maintenance / cancellation decision window`;
- treat current official warning state as context when interpreting what question is being answered;
- never rewrite prior prospective forecasts using later truth.

Classification: `B — GENERIC SEMANTIC DEFECT`.

### B2. A single representative/global closest can mix different lifecycle phases

SAUDEL progressed through first-pass approach → passage/departure → forecast re-approach. During the departure phase, the full-horizon global closest became dominated by the later re-approach and at times fell from roughly 100 km to tens of km or lower, even while all agencies described the immediate phase as departing.

The distance itself may be mathematically valid for the full forecast horizon. The semantic problem is using one number as though it represented a single operational phase.

Generic redesign target:

- preserve separate local minima / lifecycle phases;
- identify `current operational pass`, transition/departure, and later re-approach minimum;
- attach intensity, agency support, forecast horizon and uncertainty to each phase rather than one global closest.

Classification: `B — GENERIC SEMANTIC DEFECT`.

### B3. Positive risk and timing window can become semantically disconnected

This was already observed in GAENARI (`MS-02`) before SAUDEL: positive T1 risk could persist while `estimatedWindow=null` because the first visible timeline point was already above threshold and no below→above crossing existed; `forecastEdge>0.5` then suppresses the fallback. SAUDEL later showed repeated `estimated → null → estimated` changes with little risk change.

The rule `first visible above threshold does not invent a crossing` is defensible. The defect is presenting absence of a reconstructable crossing as though timing information simply does not exist.

V2 Shadow's explicit `left-censored-or-horizon-limited` state is a generic interpretation improvement, not a SAUDEL exception.

Classification: `B — GENERIC SEMANTIC DEFECT`.

### B4. Forecast risk state and current official signal state answer different questions

SAUDEL demonstrated that V1 may move T1 `likely → possible` while official T1 remains in force. V1 is a forecast-risk estimate, not a state machine mirroring HKO's current warning. Treating the two as interchangeable creates misleading UI and evaluator interpretations.

Generic redesign target: make `current official state`, `future escalation risk`, `maintenance risk`, and `withdrawal risk` explicit and separate.

Classification: `B — GENERIC SEMANTIC DEFECT`.

## 3. Generic model hypotheses already in V2 Shadow — keep frozen, do not proliferate

### C1. Source coverage should affect numeric confidence

V2 0.1 applies a continuous source-coverage confidence factor. This was motivated by GAENARI membership changes, where fewer agencies can reduce disagreement mechanically and make V1 confidence appear higher.

- Not SAUDEL-specific.
- Plausible and generic.
- Still a candidate, not proven truth.

Decision: `C — GENERIC MODEL HYPOTHESIS`, **KEEP FROZEN IN SHADOW** pending cross-case review.

### C2. T3/T8 long-horizon minority-support discount

V2 0.1 discounts T3/T8 risk when the strongest checkpoint is beyond +72 h and supported by fewer agencies than are otherwise usable. The formula is continuous, but the documentation explicitly states that it directly targets SAUDEL `MB-02`, where a +119 h T3 checkpoint was mainly supported by one CMA endpoint.

This is the closest existing item to a **SAUDEL-derived deterministic special treatment**.

Decision:

- keep the existing 0.1 formula frozen so the prospective A/B sequence remains valid;
- **do not add further clauses** such as re-approach + departing + weak local wind penalties;
- do not promote to a core model unless the same failure mode repeats across independent cases or retrospective/historical tests demonstrate broad benefit;
- if cross-case evidence does not support it, remove/write off the rule rather than preserving it because it helped SAUDEL.

Classification: `C` with **SAUDEL-heavy evidence basis**.

### C3. Post-minimum departure residual-risk decay

V2 0.1 can continuously decay residual risk only when the representative minimum is in the past, departure evidence exists, and no future threat timeline remains. This hypothesis came from NARRA / GAENARI delayed-withdrawal behavior.

- Not SAUDEL-specific.
- Explicitly avoids a hard `minimum passed => unlikely` gate.

Decision: `C — GENERIC MODEL HYPOTHESIS`, **KEEP FROZEN IN SHADOW**.

### C4. Explicit timing state for positive-but-no-window

This is primarily a semantic annotation (`estimated`, `left-censored-or-horizon-limited`, `post-minimum-no-future`, `unresolved`) rather than a meteorological risk adjustment.

Decision: retain as a generic shadow interpretation feature. It addresses a cross-case problem and does not force a forecast answer.

Classification: `B/C` boundary; treat operationally as **generic semantic improvement**, not a case exception.

## 4. SAUDEL stress observations — explicitly prohibited from becoming new deterministic clauses for now

The following observations are valuable, but each is **insufficient by itself** to justify a new hard-coded condition.

| SAUDEL observation | Why it matters | What not to do | Destination |
|---|---|---|---|
| First pass departs while a later re-approach becomes much closer | Reveals multi-phase lifecycle | Do not add `if directDepart && reApproach > X then ...` penalty | AI situation/lifecycle interpretation |
| Northeast monsoon + terrain shielding leaves local general winds weaker than geometry suggests | Shows environment/exposure context matters | Do not hard-code a SAUDEL/monsoon/terrain multiplier from one case | AI context layer + future generic exposure research |
| One exposed/high station can reach strong mean wind or gale gust while territory-wide sustained wind remains sparse | Gust, exposure and spatial coverage differ | Do not define T3/T8 from one station or one gust threshold | Local-wind observation evidence; later generic exposure semantics |
| HKO can explicitly say short-term T3 chance is low while the model remains around `possible` because geometry/re-approach stays high | Official decision context and raw geometry can diverge | Do not simply multiply risk down whenever HKO says “較低”; that would leak official judgment into an independent forecast | AI comparison / contradiction reasoning only |
| Far-future global closest can become extremely small while forecast intensity is weaker | Distance alone is not severity | Do not add an arbitrary minimum-distance veto or special re-approach cap | Phase-aware interpretation |
| T3 strongest checkpoint and estimated window can point to different parts of the lifecycle | Timing semantics need context | Do not patch a fixed hour offset for SAUDEL | Generic timing redesign / AI interpretation |
| TC wind-field channel can be zero while HKO local stations still observe wind | Forecast wind-radius evidence and local observation are separate domains | Do not copy local station observations into the existing TC wind-field channel | Keep channels separate; AI may compare them |
| HKO official wording moved the next T3 reassessment to the later 9/4–5 approach | Natural-language guidance carries lifecycle information | Do not hard-code exact phrases/dates from this event into forecast rules | Generic HKO statement extraction + AI language interpretation |

Classification for all rows: `D — SAUDEL STRESS OBSERVATION`.

## 5. Instrumentation added during SAUDEL — safe because it does not alter forecast semantics

### SAUDEL high-resolution case-watch

`case-watch/2026-saudel/` preserves every scheduled SAUDEL timepoint. It is deliberately isolated from the normal evaluator corpus. This is case-specific instrumentation, not a case-specific forecast rule.

Classification: `E — INSTRUMENTATION ONLY`. **KEEP** for this stress case; do not use the storm identifier in generic forecast logic.

### HKO official signal statement extractor

The extractor recognizes common HKO forms such as maintain-until, explicit change time/window, conditional assessment and low-likelihood change wording while preserving original text. It is frontend evidence/UI interpretation and does not change V1.

Classification: `E`, generic and reusable. **KEEP**.

### HKO Local Wind Observation Shadow

Captures 10-minute mean wind and maximum gust observations, separately summarizes strong/gale thresholds, and is explicitly `affectsForecast=false`. It does not masquerade as TC forecast wind-radius evidence.

Classification: `E`, generic and reusable. **KEEP SEPARATE**.

## 6. Frozen V1 rules are old heuristics, not SAUDEL patches

Important distinction: V1 still contains many numerical coefficients and thresholds. They are hard-coded, but they were part of the original first-version deterministic Beta rather than added for SAUDEL. Examples include:

- T1 possible/likely thresholds `0.35 / 0.58`;
- T3 `0.38 / 0.65`;
- T8 `0.40 / 0.70`;
- continuous 72 h soft time relevance;
- distance response scales;
- trajectory combination using direct approach / re-approach / quasi-stationary analyzers;
- persistence and interpolation-reliability logic;
- forecast-edge fallback timing suppression.

These values are **not automatically endorsed** by this audit. Their status remains `frozen baseline heuristic`. They should only be revised through broad evidence, not by making SAUDEL fit.

## 7. Deterministic stop line from this point onward

Until a cross-case review justifies otherwise, **do not add to V1 or V2 deterministic risk logic** any rule whose reason can be phrased as “because SAUDEL did X”. In particular:

1. No storm-name, case-ID, basin-number, exact-date or exact-station special cases.
2. No compound SAUDEL-shaped gate such as `departing + reApproach + localWindWeak => suppress T3`.
3. No fixed penalty derived from the 2026-09-04/05 re-approach timing.
4. No rule that converts a single strong/gale gust into a signal decision.
5. No copying local measured wind into the existing tropical-cyclone wind-field evidence channel.
6. No use of HKO outcome/decision wording to retroactively make the independent V1/V2 forecast “correct”.
7. No new V2 coefficient merely because the next SAUDEL snapshot looks better/worse.

Exceptions to the stop line: `A — VERIFIED CORRECTNESS` fixes, generic evidence capture, and clearly non-forecast UI labeling corrections.

## 8. What SAUDEL has genuinely proven

SAUDEL has **not** proven a correct replacement formula for T1/T3/T8. It has proven that a single deterministic decision chain has difficulty representing all of these simultaneously:

- multiple approach/departure phases in one forecast horizon;
- current vs future operational threat;
- forecast geometry vs intensity/exposure;
- official current signal state vs future signal risk;
- local observed wind vs TC forecast wind-radius evidence;
- natural-language reassessment conditions;
- left-censored/horizon-limited timing.

That is sufficient evidence to start a separate **AI Situation Analysis Shadow** without changing the deterministic forecast.

## 9. Promotion standard after this audit

A future deterministic rule is promotable only when at least one of the following is true:

- it fixes an objectively reproducible correctness defect independent of storm behavior; or
- the same semantic/model failure is demonstrated in multiple independent cases and the proposed change improves cross-case results without materially degrading ordinary approach cases; or
- a physically/general mathematically valid invariant can be stated without referring to a particular storm outcome.

Anything else remains shadow research.
