# AI-19 — Controlled Historical Backfill Pilot

Status: **readiness / source inventory; import locked**  
Branch: `feature/ai-analysis-engine`  
Parent checkpoint: AI-18 secure admin activation

## Purpose

AI-19 is the first checkpoint allowed to write real historical learning data into the independent `storm-analysis` D1 (`ANALYSIS_DB`). It is deliberately split into a read-only source-inventory phase and a separately gated pilot-import phase.

AI-19 must not modify the production Storm Worker, production Storm D1, production R2, `main`, GitHub Pages, or PWA assets.

## Phase A — read-only source inventory

Before any backfill plan is accepted, AI-19 inventories Cloudflare D1 resources using read-only commands only.

The inventory may:

- list D1 databases;
- inspect `sqlite_master` and `PRAGMA table_info(...)`;
- count rows in candidate historical tables;
- inspect recent storm/advisory metadata with bounded `SELECT` queries;
- inspect current `storm-analysis` row counts.

The inventory must not execute SQL containing `INSERT`, `UPDATE`, `DELETE`, `REPLACE`, `CREATE`, `ALTER`, `DROP`, `VACUUM`, `PRAGMA ... =`, migrations, or D1 creation/deletion.

The production source database is identified by schema, not by guessing a database UUID. A candidate must contain at least:

```text
storms
advisories
track_points
```

`storm-analysis` is always excluded as a production-source candidate.

## Pilot scope

The first import is intentionally small:

```text
storms <= 1
truth datasets <= 1
truth points <= 32
forecast snapshots <= 4
signal outcomes <= 1
total import-plan rows <= 50
```

A larger backfill requires a later checkpoint.

## Historical roles and provenance

The existing AI-7 contract remains authoritative:

- `truth` must come from an explicit observed/best-track source;
- a forecast snapshot must represent information actually available at its historical issue time;
- best-track data may be truth only and may never masquerade as a historical forecast;
- eligible forecast provenance is limited to `storm-track-d1`, `original-official-advisory`, or `auditable-archive`;
- provenance source and original issue time are mandatory.

The preferred pilot forecast source is a bounded read-only export from the existing production Storm D1 because it preserves the advisories actually collected by Storm Track. The production database remains read-only throughout AI-19.

The preferred truth source is an explicit official best-track/observed source (for example JMA RSMC best track) for the same completed storm. Truth must not be inferred from production forecast points.

## Pre-import gates

All of the following must pass before the trigger may move from `PENDING_AI19` to an activation state:

1. AI-18 trigger is `COMPLETED_AI18`.
2. Full Node checkpoint suite passes.
3. Workers Vitest / Miniflare D1 integration passes.
4. Wrangler bundle dry-run passes.
5. `storm-analysis` health is HTTP 200 with `importEnabled=true` and `analysisAdminEnabled=true`.
6. `ANALYSIS_DB` contains zero historical/backfill/training/curation/promotion rows and Champion generation remains 0.
7. Production source D1 is identified by schema using read-only inspection.
8. Pilot storm is completed and has explicit source identifiers.
9. Truth source is explicit and distinct from forecast provenance.
10. Canonical AI-7 import plan is generated deterministically and passes `POST /api/backfill/plan` dry-run.
11. Plan limits remain within the pilot caps above.
12. No training, curation, promotion, rollback, or Workers AI operation is part of the activation workflow.

## Import semantics

The eventual pilot import must use only:

```text
POST /api/backfill/import
Authorization: Bearer BACKFILL_TOKEN
```

and must import the exact reviewed canonical plan. It must not use direct SQL writes to `ANALYSIS_DB` for historical rows.

After import, the same plan must be replayed once to verify idempotence (`already-imported` or equivalent no-op semantics).

## Post-import invariants

The controlled pilot may change only the raw historical-import tables:

```text
backfill_runs
historical_storms
truth_datasets
truth_points
forecast_snapshots
signal_outcomes
```

The following must remain unchanged at AI-19 completion:

```text
verification_results = 0
agency_skill_profiles = 0
adaptive_weight_candidates = 0
signal_calibration_training_runs = 0
signal_outcome_curations = 0
signal_profile_promotion_events = 0
signal_calibration_state.generation = 0
signal_calibration_state.champion_profile_id = NULL
Workers AI = disabled
automatic promotion = disabled
```

AI-19 does not train or promote anything. Importing historical evidence and learning from it are separate checkpoints.

## Current interlock

AI-19 starts locked:

```text
PENDING_AI19
```

The Phase-A workflow is inventory-only and contains no backfill-import call. A later activation workflow/trigger may be added only after the source inventory identifies a suitable completed storm and truth source.
