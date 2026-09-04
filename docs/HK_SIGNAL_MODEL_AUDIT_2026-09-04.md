# HK Signal comprehensive model audit — 2026-09-04

Status: **AUDIT BASELINE ESTABLISHED — HOLD V1 / KEEP V2 SHADOW**

This audit is the post-NARRA model-wide checkpoint for Storm Track. It uses `main` as the authoritative implementation baseline and separates model calibration, semantic correctness, evidence integrity, AI interpretation, and auxiliary research channels.

SAUDEL (`STC-2026-JMA-TC2621`) remains an extreme-path stress case. Its data is retained for instrumentation and later special-case analysis, but it is **not** used to justify general deterministic calibration or promotion decisions in this audit.

## Executive decision

1. **Do not change V1 thresholds, coefficients or weighting.** V1 remains the frozen evaluator benchmark.
2. **Keep V2 Shadow 0.2 running in parallel.** It contains plausible generic corrections, but the prospective sample is not yet balanced enough for promotion.
3. **Do not reopen T1 calibration yet.** NARRA provides real T1 `likely` false-positive evidence, but there is no second/third independent normal-path repeat and there is not yet a completed normal-path HKO signal positive case in the current evaluator corpus.
4. **Do not change T3/T8 from NARRA.** NARRA was a correct negative for both.
5. **Keep the SAUDEL-derived long-horizon T3/T8 hypothesis shadow-only.** It remains insufficiently cross-case validated.
6. **Keep AI Situation Analysis prompt v0.5 frozen.** The prospective audit corpus is still too small for prompt retuning.
7. **Keep HKO Local Wind observation-only.** It is useful evidence but not yet a calibrated forecast input.
8. **Keep Consensus Track independent from HK Signal.** CT skill verification remains evidence-limited and must not be used as a hidden fifth agency/model input.

## 1. Evidence inventory and sample balance

The stable prospective case registry currently contains seven cases. The HK Signal evaluator has completed case material for ATSANI, GAENARI, NARRA and SAUDEL. For general model calibration this audit excludes SAUDEL.

### Completed non-special evidence

| Case | HKO T1 outcome | V1 behaviour | Audit use |
| --- | --- | --- | --- |
| ATSANI | not issued | 109/109 `unlikely`; max risk about 0.093 | clean correct-negative control |
| GAENARI | not issued | 70 `possible`, 0 `likely`; transient false alarm | source-membership / timing-semantics evidence |
| NARRA | not issued | 110 `possible`, 26 `likely`; stable false alarm | genuine T1 calibration + terminal lifecycle evidence |

The present general-purpose sample is therefore **negative-heavy**. It contains one clean negative and two no-signal false-positive cases, but no completed ordinary-path HKO-issued positive event suitable for balanced threshold optimisation.

This is the main reason threshold tuning is blocked. Lowering or raising deterministic cut-offs now could optimise false positives while creating an unmeasured false-negative cost.

## 2. V1 deterministic model audit

### 2.1 What is structurally sound

- T1/T3/T8 have explicit independent thresholds and do not share one universal severity cut-off.
- Forecast time relevance is continuous rather than fixed day buckets.
- Per-agency evidence is retained before aggregation.
- Interpolation reliability is used for escalation credibility.
- Scenario evidence can preserve a minority exact threat without requiring unanimous consensus.
- T3/T8 include stronger wind/wind-field dependence than T1.
- The model preserves `possible` as a broader early-warning state while requiring more credible evidence for `likely`.

These properties should remain unless future evidence shows a concrete failure.

### 2.2 Confirmed V1 limitations

#### A. T1 calibration is not yet trustworthy enough for promotion-quality use

NARRA produced 26 genuine `likely` snapshots even though HKO never issued T1. This is materially stronger evidence than GAENARI's possible-only false alarm. It is a real warning that T1 may overvalue near-Hong-Kong geometry/trajectory in some ordinary no-signal cases.

However, one case is insufficient to identify which coefficient is wrong. The failure could come from proximity response, trajectory strength, persistence, intensity capability, source composition, or the interaction between them.

**Decision:** retain as a calibration defect candidate; no parameter change until repeated independently.

#### B. V1 numeric confidence can improve when agency membership contracts

The base threat confidence uses an agency-coverage term that saturates at three agencies while disagreement is separately penalised. When agencies disappear, disagreement can mechanically shrink and partially offset the coverage loss. GAENARI demonstrated the resulting semantic risk.

**Decision:** V1 remains frozen; V2 source-coverage confidence correction remains a valid shadow hypothesis.

#### C. Risk state and timing state are not the same thing

Positive risk can persist while `estimatedWindow` is null when a threshold crossing is left-censored or hidden by forecast-horizon structure. GAENARI established this before SAUDEL.

**Decision:** treat this as a generic output-semantics defect, not a calibration failure. V2's explicit timing-state annotation is directionally correct.

#### D. Global closest approach can represent the wrong operational phase

A full-horizon global minimum is mathematically valid but can mix current approach/departure with a later re-approach. This is especially visible in extreme-path cases, but the semantic issue is generic.

**Decision:** do not add a deterministic penalty. Future architecture should become phase-aware rather than trying to repair one global number with more coefficients.

## 3. V2 Shadow 0.2 audit

V2 remains a post-processing shadow of frozen V1. It can degrade risk/confidence or clarify timing semantics without altering the evaluator baseline.

### 3.1 Source-coverage confidence factor

**Status: KEEP SHADOW.**

This directly addresses a cross-case semantic issue exposed by GAENARI. The fixed denominator of four is intentionally conservative, but it currently conflates two situations:

- a source that should be present but is missing/failing;
- an agency that legitimately has no applicable/current forecast evidence.

Future work should distinguish `expected-but-missing` from `not-applicable/unissued` before promotion. No coefficient change is justified now.

### 3.2 T3/T8 long-horizon agency-participation discount

**Status: KEEP SHADOW, LOW PROMOTION CONFIDENCE.**

The implementation discounts T3/T8 when the strongest checkpoint is beyond +72 h and the number of agencies represented at that checkpoint is smaller than the case-wide usable agency count.

Important semantic finding: the implementation uses `strongestCheckpoint.totalAgencyCount`, not `supportAgencyCount`. Therefore it measures **checkpoint participation/availability**, not strictly the number of agencies whose evidence exceeds the signal threshold.

This is not necessarily a calculation bug. It is, however, a terminology/design ambiguity because existing commentary often describes the rule as a minority-`support` discount. A future test should separate:

- checkpoint agency participation fraction; and
- positive support fraction.

Do not change the formula until a normal-path independent case demonstrates that this distinction improves outcomes.

### 3.3 Post-minimum departure decay

**Status: KEEP SHADOW.**

The rule is continuous and requires the closest point to be in the past, departure evidence, and no future threat timeline. It is generic and avoids a hard `minimum passed => unlikely` gate.

GAENARI/NARRA provide reasonable motivation, but prospective V2 outcome evidence remains limited.

### 3.4 Terminal lifecycle decay (0.2)

**Status: KEEP SHADOW; GOOD GENERIC GUARDING.**

The NARRA terminal fixture requires one remaining source, no forecasts, stale source evidence, explicit terminal intensity, past closest point and no future timeline. A stale active tropical storm is explicitly protected from suppression.

This is a better-shaped generic hypothesis than a NARRA-specific exception. It fixes the exact terminal residual pattern in replay while retaining counterexample protection.

It still cannot be called a prospective V2 win because NARRA did not have a contemporaneous 0.2 sequence.

### 3.5 Timing-state annotation

**Status: RETAIN.**

`left-censored-or-horizon-limited`, `post-minimum-no-future`, `unresolved`, `estimated`, and `not-applicable` are useful semantic states and avoid inventing false precision.

This should eventually become part of a dedicated forecast-output contract rather than remaining a frontend shadow interpretation.

## 4. V2 architecture audit

V2 0.2 is still implemented inside `analysis/frontend-hk-threat-ui.js` as a cloned/post-adjusted V1 output.

This was a sensible deployment-minimisation choice during live comparison, but it is **not a promotion-ready architecture**.

Before any V2 evaluator candidacy:

- extract V2 logic to a dedicated deterministic analysis module;
- version its input/output schema independently;
- keep UI rendering separate from model calculation;
- add evaluator support that can score V1 and V2 from the same immutable capture without changing historical V1 results;
- preserve the rule that V2 cannot consume later HKO outcome truth.

Do not perform this extraction yet merely for code cleanliness. Wait until V2 has enough evidence to survive the keep/modify/write-off decision.

## 5. Evaluator and evidence-integrity audit

The evaluator/closeout infrastructure is now materially stronger than the original Beta:

- ambiguous same-case same-capture states are excluded from derived scoring;
- raw evidence remains immutable;
- no-signal closeout requires healthy overlapping prospective and HKO-truth coverage;
- checkpoint freshness is enforced;
- lifecycle grades are withheld when coverage is incomplete;
- `possible` and `likely` false-positive severity are now separated;
- terminal residual diagnostics are preserved.

The prospective coverage corpus still records 55 gaps across 513 coverage records. This is not a reason to reconstruct missing forecasts after the fact. The correct policy is the current one: quarantine incomplete grading and improve forward capture continuity.

**Decision:** evidence pipeline is fit for continued prospective research, but not every historical interval is gradeable.

## 6. AI Situation Analysis Shadow

The AI layer is correctly isolated from forecast/evaluator semantics. Current prospective audit evidence contains only two audited records: SAUDEL and KROVANH. SAUDEL is a special stress case and KROVANH was still an active/prospective case at the audit point.

**Decision:** prompt v0.5 stays frozen. There is not enough independent ordinary-case evidence to justify v0.6, model-provider conclusions, or automated AI-to-deterministic feedback.

The AI layer should continue to focus on semantic/lifecycle interpretation where deterministic compression is weakest: current vs future phase, multi-pass lifecycle, null timing causality, and operational context.

## 7. HKO Local Wind Shadow

The recorder is functioning as an observation-only channel and explicitly keeps `affectsForecast=false`.

This separation is correct. Local 10-minute mean wind/gust observations are not equivalent to agency tropical-cyclone wind-radius forecasts and must not be copied into the existing wind-field channel.

The recorder began too late to provide contemporaneous NARRA evidence and is currently heavily associated with the SAUDEL period.

**Decision:** continue collection; no deterministic integration yet.

## 8. Consensus Track relationship

Consensus Track remains independent from HK Signal. Current CT verification readiness cannot reconstruct homogeneous same-cycle agency baselines from the older Archive corpus, so skill promotion is blocked while prospective agency baselines accumulate.

**Decision:** do not feed Consensus Track into HK Signal and do not use CT performance claims for HK Signal calibration until homogeneous paired verification is available.

## 9. Documentation / implementation consistency defect found by this audit

`docs/HK_SIGNAL_V2_SHADOW.md` still describes the active model as Shadow 0.1, while implementation and regression tests expose `hk-signal-shadow-v2/0.2` and NARRA's terminal lifecycle decay.

Classification: **verified documentation correctness defect**.

Action: update the V2 handoff document to 0.2 without changing model behaviour.

## 10. Model readiness scorecard

| Area | Status | Decision |
| --- | --- | --- |
| V1 deterministic calculation | stable frozen baseline | HOLD |
| V1 T1 calibration | insufficient / false-positive concern | OBSERVE MORE |
| V1 T3/T8 from NARRA | no defect shown | HOLD |
| V2 source-coverage confidence | plausible generic improvement | KEEP SHADOW |
| V2 long-horizon T3/T8 rule | SAUDEL-heavy evidence, semantic ambiguity | KEEP SHADOW / DO NOT PROMOTE |
| V2 departure decay | plausible cross-case improvement | KEEP SHADOW |
| V2 terminal decay | well-guarded generic hypothesis | KEEP SHADOW |
| V2 timing states | generic semantic improvement | RETAIN |
| Evaluator / closeout | suitable for prospective use | KEEP |
| Prospective capture continuity | improved but historical gaps remain | IMPROVE FORWARD ONLY |
| AI Situation Shadow | corpus too small | FREEZE v0.5 / COLLECT |
| Local Wind Shadow | healthy observation channel | COLLECT ONLY |
| Consensus Track skill verification | baseline evidence not ready | KEEP INDEPENDENT |

## 11. Next decision gates

The next model change should happen only when one of these gates is met:

### Gate A — reopen T1 calibration

A second or third independent **normal-path** completed case repeats:

`multi-agency near-HK geometry → V1 T1 likely → HKO no T1`.

Then perform cross-case sensitivity analysis on T1 components instead of moving the top-level threshold first.

### Gate B — consider V2 promotion

At least one ordinary HKO-issued positive case and additional no-signal cases provide contemporaneous V1/V2 sequences, allowing comparison of:

- first positive / likely lead;
- false-positive persistence;
- withdrawal timing;
- timing-state usefulness;
- confidence calibration;
- T3/T8 early-warning retention.

### Gate C — revise long-horizon support semantics

An independent normal-path case shows that checkpoint participation and threshold-positive support produce materially different operational conclusions.

### Gate D — AI prompt revision

Multiple independent audited ordinary cases repeat the same AI interpretation defect. One stress case plus one active case is insufficient.

## Final audit position

The project is **not at a point where broad model retuning is justified**. The strongest current move is to preserve the clean V1 benchmark, keep V2 0.2 as a constrained shadow, continue ordinary-case prospective collection, and use the evaluator's improved severity/coverage diagnostics to decide later changes from balanced evidence.

The main engineering risk is now less about obvious pipeline corruption and more about **premature calibration from a small, negative-heavy, partially special-case sample**. Avoiding that is more valuable than forcing an immediate V2 promotion.