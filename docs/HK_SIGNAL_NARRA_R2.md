# HK Signal NARRA R2 Closeout

Case: `STC-2026-JMA-TC2622` — NARRA / 紫檀

Status: **R2 CLOSED — V1 `OBSERVE MORE`; V2 learning incorporated in Shadow 0.2**

This document is the compact handoff record for the completed NARRA post-case review. It records conclusions only from the immutable prospective/evaluator/truth corpus. SAUDEL is explicitly outside this case review.

## Executive conclusion

NARRA must not be summarized as “136 identical T1 false alarms”. The completed replay separates three different behaviours:

- 136 T1 positive snapshots in total;
- 110 were `possible`;
- 26 were `likely`;
- only the final 2 matched the terminal residual pattern identified during closeout.

T3 and T8 remained correct negatives. The evidence therefore points to a **T1-specific calibration/lifecycle issue**, not a general failure of the HK Signal model.

No V1 coefficient, threshold, weighting or signal semantics is changed from this case alone.

## Verified NARRA T1 timeline

### Early watch phase

The first valid positive capture was `2026-08-22T01:37:22.817Z`.

At that point T1 was only `possible`, not `likely`. The multi-agency forecast geometry placed the system near enough to Hong Kong on a multi-day horizon that an advisory-level watch was defensible. This phase is not treated as the strongest model error.

### Calibration-miss phase

The first T1 `likely` capture was:

`2026-08-25T01:55:00.885Z`

The last T1 `likely` capture was:

`2026-08-26T00:02:04.831Z`

There were **26 `likely` snapshots**. Because HKO ultimately did not issue T1 for NARRA, these snapshots are retained as genuine T1 calibration false-positive evidence.

The evidence does not justify immediately lowering the V1 T1 proximity/geometry coefficients. A second or third completed normal-path no-signal case showing the same multi-agency near-HK → T1 `likely` → no-signal pattern is required before coefficient revision.

### Terminal residual phase

The final two T1-positive captures match a distinct terminal lifecycle pattern.

The last prospective NARRA capture was:

`2026-08-27T03:31:15.090Z`

At that capture:

- only HKO remained in the NARRA group;
- HKO bulletin evidence was about 20 hours old relative to the capture;
- the current classification was `Low Pressure Area`;
- no forecast points remained;
- the representative/closest minimum was already in the past;
- the future threat timeline was empty;
- V1 still retained T1 `possible` with risk about `0.4394`.

This is recorded separately as a **terminal residual**, not merged conceptually with the earlier 26 `likely` calibration misses.

## Evaluator correction completed

The closeout evaluator previously used one binary positive state containing both `possible` and `likely`. That behaviour was technically consistent with the original closeout contract but too coarse for model-development diagnosis.

PR #100 added backward-compatible closeout diagnostics while preserving the existing top-level `forecastOutcome` values.

New derived evidence includes:

- `possibleSnapshotCount`;
- `likelySnapshotCount`;
- likelihood counts and first/last timestamps;
- max risk separated by likelihood;
- `severityClassification`;
- source freshness and forecast availability diagnostics;
- terminal residual snapshot counts and timestamps;
- final pre-close lifecycle diagnostics.

Real NARRA corpus replay after this change produced:

| Metric | Result |
|---|---:|
| T1 snapshots | 136 |
| Positive | 136 |
| `possible` | 110 |
| `likely` | 26 |
| First `likely` | 2026-08-25 01:55 UTC |
| Last `likely` | 2026-08-26 00:02 UTC |
| Terminal residual | 2 |
| Max T1 risk | 0.7803 |
| Max `possible` risk | 0.7191 |
| Max `likely` risk | 0.7803 |

PR #100 was squash-merged into `feature/hk-signal-v2-shadow` as commit:

`f35e924117d68f0f86d2884b5b2c601e0f58964e`

## V2 Shadow 0.2 learning completed

The pre-existing V2 shadow already contained a general post-minimum departure decay, but the final NARRA snapshot had no usable `directDepart` evidence. Therefore that mechanism alone could not address the real NARRA terminal state.

PR #101 extends **V2 shadow only** with a conservative terminal lifecycle decay. V1 remains untouched.

The new decay requires all of the following generic conditions:

1. exactly one remaining source;
2. no forecast points;
3. source evidence is stale by at least 12 hours;
4. an explicit terminal intensity hint such as `Low Pressure Area`, `LPA`, remnant low or dissipating state;
5. the representative minimum is already in the past;
6. no future timeline remains.

Staleness alone is not sufficient. A stale source still identifying an active `Tropical Storm` does not trigger the terminal decay.

The exact NARRA terminal regression fixture verifies that:

- frozen V1 remains T1 `possible`, risk about `0.4394`;
- the ordinary V2 departure penalty remains zero because `directDepart=0` in the real frozen snapshot;
- the new terminal lifecycle penalty activates;
- V2 T1 falls below the `possible` threshold and becomes `unlikely`.

A counterexample verifies that a stale-but-active Tropical Storm retains the original risk/likelihood.

The V2 terminal regression suite passed, including the existing frontend HK threat UI regression.

PR #101 was squash-merged into `feature/hk-signal-v2-shadow` as commit:

`1ef37c75cce7393f342231798bb5cd60f74f1539`

The V2 shadow schema/version exposed by the frontend is now:

`hk-signal-shadow-v2/0.2`

## T3 / T8 outcome

NARRA did not expose a general strong-signal failure.

- T3: zero positive snapshots; official outcome not issued; correct negative.
- T8: zero positive snapshots; official outcome not issued; correct negative.

Do not use NARRA as evidence for changing T3/T8 thresholds.

## What NARRA does and does not prove

### Proven / useful evidence

- The old binary closeout presentation hid meaningful `possible` versus `likely` severity.
- V1 can retain a T1 residual after a storm has degraded and the forecast stream has effectively ended.
- NARRA provides real T1 `likely` false-positive calibration evidence worth retaining for cross-case review.
- Source membership reduction was already reflected in V1 confidence/likelihood behaviour; agency count was not simply ignored.

### Not proven

- NARRA alone does not prove V1 T1 coefficients should be lowered.
- NARRA does not prove the entire HK Signal model is over-sensitive.
- NARRA does not justify changing T3/T8.
- There was no contemporaneous V2 NARRA corpus, so this case cannot be scored as a prospective V2 victory.
- Later local-wind shadow data must not be used as hindsight evidence for NARRA because the recorder began after the case lifecycle.

## Frozen decisions after R2

1. **V1 remains frozen.** No NARRA-specific coefficient or threshold changes.
2. **NARRA status is `OBSERVE MORE`.** Retain its 26 `likely` snapshots as calibration evidence for later cross-case analysis.
3. **Evaluator diagnostics are corrected.** Future closeouts should be interpreted using severity breakdown rather than only binary positive count.
4. **V2 Shadow 0.2 retains the generic terminal lifecycle decay.** It stays shadow-only and does not enter official V1 evaluator scoring.
5. **No further NARRA-specific rules are to be added.** Any additional model change must be justified by another independent completed case or a generic correctness defect.

## Next evidence gate

The next HK Signal decision is **prospective cross-case observation**, not further NARRA tuning.

For future completed cases, specifically check whether either pattern repeats:

- `multi-agency near-HK geometry → T1 likely → HKO no T1`;
- `single stale terminal source + no forecasts + post-minimum → residual T1 possible`.

If the first pattern repeats across independent completed normal-path cases, reopen T1 calibration. If the second pattern recurs, compare frozen V1 with V2 Shadow 0.2 prospectively before considering any promotion.

SAUDEL remains a separate special-case observation and must not be mixed into NARRA statistics or used to overwrite this R2 conclusion.

## Handoff state

As of this R2 closeout:

- evaluator diagnostic improvement: **merged**;
- NARRA immutable replay: **completed**;
- V2 terminal lifecycle regression: **passed**;
- V2 Shadow 0.2 terminal fix: **merged**;
- V1 coefficient changes: **none**;
- next mode: **prospective observation / later cross-case review**.
