# Historical Replay Reuse Audit

This note records which completed `AI-xx` components are useful for the current HK Signal Beta historical replay work. It does **not** reactivate the old adaptive-learning pipeline or merge `feature/ai-analysis-engine` wholesale.

## Current objective

Use historical as-issued official forecast snapshots to replay the current frozen HK Signal Beta model (`storm-analysis-snapshot/v1` → `hk-impact/v1` → `hko-signal-risk-inputs/v1` → `hk-threat-assessment/v1` → `basic-hk-signal-forecast/v1`) without future leakage.

Historical replay is retrospective validation. It remains separate from the higher-confidence live prospective corpus.

## Reusable AI-xx capabilities

### Reuse directly or with small adaptation

- **AI-4 Forecast Verification Engine** (`analysis/forecast-verification-engine.js` on `feature/ai-analysis-engine`)
  - deterministic forecast-vs-final-truth verification;
  - useful later for track/intensity/closest-approach diagnostics;
  - not itself a T1/T3/T8 timing evaluator.

- **AI-5 Historical Walk-forward Backtester** (`analysis/historical-walkforward-backtester.js`)
  - explicit `asOf` cutoffs;
  - rejects source availability after cutoff;
  - permits future forecast valid times from an advisory already available at cutoff;
  - strong leakage guard worth preserving.

- **AI-7 Historical Backfill Importer** (`analysis/historical-backfill-importer.js`)
  - trusted provenance types;
  - requires original advisory issue time;
  - marks unknown/untrusted forecast provenance ineligible;
  - useful data-contract concepts even if we do not write the old analysis D1.

- **AI-21 Production forecast corpus extraction** (`workers/storm-analysis/scripts/ai21-build-forecast-corpus.mjs` and read-only workflows)
  - already proved `storm-track-db` can be queried with `SELECT` only;
  - selects forecast-bearing advisories with `issued_at <= cutoff`;
  - extracts only future forecast points for that cutoff;
  - maintains agency separation and missing-agency semantics.

- **AI-22 Lifecycle cutoff selection** (`ai22-select-lifecycle-cutoffs.mjs`)
  - selects the latest forecast-bearing advisory per agency as of a cutoff;
  - rejects advisories that do not have future forecast points;
  - useful for generic lifecycle sampling;
  - event-relative T-48/T-24/T-12/T-6/T-3 selection still needs a new adapter.

- **AI-23 Generic truth augmentation / verification preview**
  - useful for finalized JMA Best Track provenance and track verification;
  - generic, deterministic and not tied to one fixed storm;
  - verification persistence route was not completed, so do not assume live Worker persistence exists.

### Useful later, but not for the first historical replay

- agency skill profiles;
- adaptive weight candidates;
- signal calibration trainer;
- model promotion / rollback control plane;
- corpus lifecycle D1 repository.

These remain useful only after enough replay/prospective evidence exists. They must not be used to tune the current v1 before the first diagnosis corpus is built.

## Components not directly compatible with the current Beta forecast

The old `hko-signal-risk-calibration/v1` and `historical-signal-replay-adapter/v1` model a statistical calibration / weighted-consensus path. The current Beta forecast instead uses `hk-threat-assessment/v1` plus `basic-hk-signal-forecast/v1` with deterministic likelihood thresholds and timing windows.

Therefore:

- do not reuse old calibrated probabilities as if they were current Beta `riskIndex` values;
- do not replay historical storms through the old weighted model and compare that result as current v1 performance;
- do reuse the old cutoff, provenance, leakage and truth-verification infrastructure concepts.

## Live production Archive feasibility result — 2026-08-22

PR #45 ran a read-only audit directly against production D1 `storm-track-db` (UUID `eb0bf995-3ea7-4bf6-bbca-b425892c4d7e`) using only `SELECT` statements.

Observed inventory:

- 15 storm rows in the requested 2025–2026 query range;
- 479 forecast-bearing advisories;
- the earliest returned storm `first_seen_at` is `2026-08-05T08:00:27.000Z`;
- there are no 2025 storm rows in the current production Archive inventory;
- the current rows are the storms accumulated since early August 2026, including CHAN-HOM, WP-2026-16, WP-2026-17, NARRA-related identities and TC2623;
- neither 2026 紅霞 nor 2025 樺加沙 / RAGASA exists as a production `storms` row in this Archive coverage window.

Therefore the first two requested historical T8 cases **cannot be reconstructed from the current production D1 alone**. This is a source-coverage limitation, not a failure of the AI-21/22 walk-forward logic and not an alias-only problem.

The production schema does contain the structures required for future replay where archived data exists:

- `storm_aliases(storm_id, agency, agency_storm_id, agency_name, first_seen_at, last_seen_at)`;
- `wind_radii(track_point_id, threshold_code, threshold_ms, radius_ne_km, radius_se_km, radius_sw_km, radius_nw_km)`.

The presence of `wind_radii` means archived cases can potentially preserve the strong-wind/gale-radius evidence needed by current T3/T8 logic, but target-specific row coverage still has to be audited before replay.

### Consequence

Historical replay now has two source paths:

1. **Archive-native replay** — for storms actually captured by `storm-track-db`; reuse AI-21/22 extraction directly.
2. **External official historical reconstruction** — for pre-Archive cases such as 2025 樺加沙 and earlier-2026 紅霞; acquire auditable as-issued official advisories first, then feed them through the same cutoff/provenance contract.

External reconstruction must not substitute final best track for historical forecasts. Each replay snapshot still requires evidence that the advisory was genuinely issued and available by the chosen cutoff.

## New historical replay path

1. Read production `storm-track-db` with `SELECT` only when the case exists there.
2. Otherwise acquire an auditable official historical advisory corpus outside production D1.
3. Identify the historical storm and stable agency identities.
4. Inventory per-agency forecast-bearing advisories and provenance.
5. Reconstruct the latest advisory available to each agency at each cutoff.
6. Build current `storm-analysis-snapshot/v1` input without future advisory leakage.
7. Run the current frozen HK Signal Beta analysis stack.
8. Compare T1/T3/T8 against historical HKO official signal lifecycle using the same event policy/rubric where applicable.
9. Keep historical results explicitly marked retrospective and record input completeness.
10. Diagnose repeated biases before creating any v2 candidate.

## First target cases

- 2026 紅霞 — requested T8 stress case; requires external official historical reconstruction because it predates current production Archive coverage.
- 2025 樺加沙 / RAGASA — requested T8 stress case; requires external official historical reconstruction because current production Archive has no 2025 rows.

The first PR only audits replay feasibility and records the source-coverage boundary. It performs no model changes, no training and no production database writes.
