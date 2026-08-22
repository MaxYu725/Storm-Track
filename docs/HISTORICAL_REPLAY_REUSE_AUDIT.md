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

## New historical replay path

1. Read production `storm-track-db` with `SELECT` only.
2. Identify the historical storm and stable production identity.
3. Inventory per-agency forecast-bearing advisories and provenance.
4. Reconstruct the latest advisory available to each agency at each cutoff.
5. Build current `storm-analysis-snapshot/v1` input without future advisory leakage.
6. Run the current frozen HK Signal Beta analysis stack.
7. Compare T1/T3/T8 against historical HKO official signal lifecycle using the same event policy/rubric where applicable.
8. Keep historical results explicitly marked retrospective.
9. Diagnose repeated biases before creating any v2 candidate.

## First target cases

- 2026 紅霞 — requested T8 stress case.
- 2025 樺加沙 / RAGASA — requested T8 stress case.

The first PR only audits whether production Archive data is sufficient to reconstruct these cases. It performs no model changes, no training and no production database writes.
