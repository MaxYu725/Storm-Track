# Consensus Track verification truth readiness

## Purpose

This audit is the second readiness layer before any CT-2 forecast-skill evaluator is allowed to calculate track error.

The existing CT-1B Archive audit answers:

> Can a persisted CT source reference be joined back to the same agency's as-issued forecast cycle in the production Archive?

This truth-readiness audit answers a different question:

> For completed prospective CT cases, do we have both an official post-analysis verification truth and the same-cycle prospective agency baseline evidence needed for homogeneous comparison at +24 / +48 / +72 / +96 / +120h?

It is read-only. It does not calculate forecast error, rank agencies, tune weights, modify CT-0, write production data or automatically decide whether CT-2 should open.

## Verification truth contract

The verification truth source is the Japan Meteorological Agency Typhoon Position Table final CSV (`tableYYYY.csv`).

Only JMA **post-analysis final** positions are accepted as verification truth. Operational / preliminary analysis is not promoted to final truth merely because the storm has disappeared from the live tracker.

Case-to-truth matching uses the stable CT case registry's specific English storm names. It does not assume that the live JMA EventID form such as `TC26xx` is the same identifier as the finalized typhoon number in the position table.

For a target valid time:

- an exact finalized position is accepted directly;
- interpolation is considered truth-ready only when finalized points bracket the target and the bracket is no wider than 12 hours;
- missing final positions, one-sided coverage or a wider gap remain unavailable.

The 12-hour bracket is a reconstruction boundary for readiness only. This audit does not calculate an interpolated coordinate or any forecast error.

## Prospective forecast rule

A CT target is eligible only when:

- the snapshot schema is `storm-consensus-track-prospective/v2`;
- lead time is exactly +24 / +48 / +72 / +96 / +120h;
- at least two agencies contributed to the consensus point;
- the consensus coordinate is present;
- the immutable CT snapshot was captured before the target valid time.

Older v1 observations remain immutable but are not used for this homogeneous readiness check because they do not contain the v2 source-reference contract required to reconstruct the participating as-issued agency cycles safely.

## Agency-baseline rule

For each agency participating in an eligible CT target, the auditor searches the immutable `storm-agency-baseline-prospective/v1` evidence stream for:

- the same agency;
- the exact persisted source ID;
- a matching source cycle time within five minutes;
- enough analysis / forecast valid-time points to reproduce the CT contribution according to its persisted provenance class.

The provenance classes remain:

- `exact-analysis`;
- `exact-forecast`;
- `analysis-to-forecast-interpolation`;
- `forecast-to-forecast-interpolation`.

No different agency is substituted for a missing baseline.

## First production audit

PR #81 first production run audited at `2026-08-30T03:33:28.316Z` using:

- latest CT snapshot captured `2026-08-30T01:26:32.755Z`;
- 7 stable CT cases;
- 126 immutable CT observation files;
- 122 immutable agency-baseline observation files;
- 124 points present in the fetched JMA final-position CSV corpus.

### Completed-case classification

The current latest CT snapshot contains BANG-LANG, ETAU and SAUDEL. Three inactive cases have eligible multi-agency v2 targets and are therefore completed verification candidates:

| Case | Stable case ID | Eligible v2 target cycles |
| --- | --- | ---: |
| GAENARI | `STC-2026-GAENARI-E87CCBAD` | 12 |
| NARRA | `STC-2026-NARRA-E87CCBAD` | 158 |
| Tropical Depression → ATSANI | `STC-2026-TROPICALDEPRESSION-E87CCBAD` | 81 |

The short CWA-only `2026-25` case is inactive but has zero eligible multi-agency target points, so it is not a completed verification candidate.

### Standard-lead forecast evidence

The v2 prospective corpus contains:

| Case | +24h | +48h | +72h | +96h | +120h |
| --- | ---: | ---: | ---: | ---: | ---: |
| GAENARI | 12 | 0 | 0 | 0 | 0 |
| NARRA | 77 | 52 | 29 | 0 | 0 |
| ATSANI case | 57 | 20 | 4 | 0 | 0 |

This is deliberately based on v2 observations only. Earlier v1 snapshots could show a longer supported horizon, but they pre-date the source-reference contract and cannot be silently upgraded into homogeneous verification samples.

### Prospective agency-baseline readiness

The separate agency-baseline recorder is working for these completed cases. Counts below are target cycles for which **all agencies participating in that CT consensus point** can be reconstructed from the same prospective source cycles:

| Case | +24h | +48h | +72h |
| --- | ---: | ---: | ---: |
| GAENARI | 12 / 12 | — | — |
| NARRA | 73 / 77 | 50 / 52 | 28 / 29 |
| ATSANI case | 56 / 57 | 19 / 20 | 4 / 4 |

The remaining target cycles are partial rather than evidence-free: at least one participating agency baseline can still be reconstructed, but a homogeneous all-participant comparison would need to omit the missing agency for that cycle rather than substitute another source.

### Final verification truth readiness

Current result:

| Metric | Result |
| --- | ---: |
| Completed multi-agency case candidates | 3 |
| Completed cases with JMA post-analysis final truth | **0 / 3** |
| Completed cases with any final-truth + same-cycle homogeneous pair | **0 / 3** |
| Truth-ready agency comparison pairs | **0** |

GAENARI, NARRA and ATSANI are absent from the currently published JMA post-analysis final CSV corpus. Therefore their stored operational analysis positions are **not** used as verification truth.

## Decision

The prospective forecast-evidence problem has materially improved: the completed cases already contain substantial same-cycle agency-baseline coverage, especially at +24 / +48 / +72h.

The immediate blocker is now narrower:

> **official post-analysis final verification truth has not yet been published for the three completed CT cases.**

Accordingly:

- do not calculate track error yet;
- do not use live/operational analysis as a substitute for final truth;
- do not tune CT-0 or rank agencies from the readiness counts;
- keep the daily truth-readiness audit active so final publication is detected automatically;
- when final truth appears, rerun this audit first and inspect homogeneous pairing counts before opening a CT-2 evaluator.

The current completed corpus supports prospective verification through +72h once final truth becomes available. It does not yet provide v2 homogeneous +96h / +120h samples for these completed cases.
