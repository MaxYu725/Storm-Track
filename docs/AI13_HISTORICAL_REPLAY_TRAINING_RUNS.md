# AI-13 — Historical Replay Adapter / Training Run Repository

Status: **AI-13 checkpoint implementation**

AI-13 connects the AI-7 historical D1 schema to the AI-12 signal-calibration trainer and persists only Challenger profiles plus auditable training-run results. It does not promote a profile, deploy a Worker, or touch the production Storm Worker database.

## Explicit HKO outcome provenance

AI-11 requires explicit official-HKO labels. AI-13 migration `0004_signal_training_runs.sql` therefore adds `signal_outcomes.official_hko` with default `0`. Existing rows are **not** inferred from their `source` text and remain ineligible until explicitly curated/backfilled. The replay adapter also requires `signal_system_era = modern`.

## Historical model selection

For every forecast snapshot at `asOf`, replay chooses a model only when:

```text
activated_at <= asOf < retired_at
```

If no model was active, replay uses the explicit `builtin-equal-v1` 25/25/25/25 fallback. The current Champion is never applied retroactively to historical snapshots.

## Replay input

The adapter reads:

- eligible `forecast_snapshots`;
- explicit modern official-HKO `signal_outcomes`;
- historical `model_versions` activation windows.

A case requires persisted `snapshot_json` and `signal_inputs_json`. AI-10 weighted consensus track and weighted Hong Kong impact are recomputed deterministically from the historical snapshot and historical model selection.

## Training run persistence

`signal_calibration_training_runs` stores:

- run/trainer IDs and fingerprints;
- dataset fingerprint;
- selected Champion profile ID used only for comparison;
- run status;
- storm/case/holdout counts;
- `eligible_for_promotion` gate result;
- gate, metrics and full trainer result JSON;
- failure audit data.

The repository persists the AI-12 output into `signal_calibration_profiles` with `role = challenger`. It rejects a profile ID collision when the stored profile JSON differs.

Completed runs are idempotent by input fingerprint. Failed/running runs can be retried with the same run identity; conflicting run IDs/fingerprints are rejected.

## Promotion boundary

AI-13 only persists:

```text
role = challenger
eligible_for_promotion = 0 or 1
promotionPerformed = false
```

There is no promotion endpoint and no automatic role change to Champion.

## Safety semantics

- explicit official HKO flag required;
- modern signal era only;
- historical model activation window enforced;
- future model activation excluded;
- current Champion not backfilled into history;
- AI-12 storm-level walk-forward remains authoritative;
- production database is never written;
- no Workers AI generation.

## Still not done

- no remote D1 migration;
- no real historical training run;
- no outcome curation/backfill of `official_hko`;
- no promotion endpoint;
- no scheduled trainer;
- no Worker deployment;
- no production PWA change.

## Next checkpoint

AI-14 should add an authenticated, dry-run-first administrative training endpoint and explicit outcome-curation/import path, still without automatic promotion. A later separate checkpoint can implement manual Champion promotion with rollback/audit semantics.
