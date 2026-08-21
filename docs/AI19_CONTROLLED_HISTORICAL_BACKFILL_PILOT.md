# AI-19 — Controlled Historical Backfill Pilot

Status: **pilot selected; forecast extraction / import still locked**  
Branch: `feature/ai-analysis-engine`  
Parent checkpoint: AI-18 secure admin activation

## Purpose

AI-19 is the first checkpoint allowed to write real historical evidence into the independent `storm-analysis` D1 (`ANALYSIS_DB`). It is deliberately split into read-only discovery, deterministic plan review, and a separately gated pilot import.

AI-19 must not modify the production Storm Worker, production Storm D1, production R2, `main`, GitHub Pages, or PWA assets.

## Phase A — read-only source inventory

The source inventory identified exactly one production Storm schema candidate:

```text
storm-track-db
D1 UUID: eb0bf995-3ea7-4bf6-bbca-b425892c4d7e
```

It contains `storms`, `advisories`, and `track_points`. Inventory operations use read-only D1 commands only (`SELECT`, read-only `PRAGMA`, list/metadata operations). `storm-analysis` is excluded as a source candidate.

Observed inventory at AI-19 start:

```text
production storms = 11
production advisories = 432
production track_points = 12105
ANALYSIS_DB historical/backfill rows = 0
ANALYSIS_DB training/curation/promotion rows = 0
signal Champion = NONE / generation 0
```

## Pilot selection

The selected pilot storm is:

```text
Storm Track ID: WP-2026-15
International number: 15 / JMA 2615
Name: CHAN-HOM / 昌鴻
Production advisory coverage: HKO + JMA + CMA + CWA
Production advisories: 104
```

`WP-2026-16` has more data but was rejected for the first pilot because it remained too close to the current collection window. CHAN-HOM has stopped receiving advisories and provides four-agency historical forecast coverage.

The production `storms.status` field is not treated as authoritative completion evidence because stale rows may remain `active`; historical completion/truth status is corroborated against official source material instead.

## Truth-finality decision

JMA's official RSMC Best Track Data (Text) for 2026 currently contains finalized records only through international number `2604`. JMA's separate 2026 typhoon position table lists `2615` with the `※` marker, meaning the published positions are still preliminary/速報解析 rather than post-analysis final values.

AI-19 therefore **must not promote the current 2615 preliminary positions to learning truth**.

The first AI-19 write pilot is intentionally **forecast-only**:

```text
truth_datasets = 0
truth_points = 0
signal_outcomes = 0
historical_storms.agency_skill_eligible = 0
backfill_mode = forecast-only
```

Final JMA RSMC best-track truth for 2615 may be added in a future checkpoint after post-analysis publication. Until then, no AI-19 data is eligible for agency-skill training.

This preserves the AI-7 rule that truth must be explicit and prevents preliminary operational positions from being mislabeled as final best track.

## Pilot scope

The first import is intentionally small:

```text
storms <= 1
truth datasets <= 1 (AI-19 pilot actual = 0)
truth points <= 32 (AI-19 pilot actual = 0)
forecast snapshots <= 4
signal outcomes <= 1 (AI-19 pilot actual = 0)
total import-plan rows <= 50
```

A larger backfill requires a later checkpoint.

## Historical roles and provenance

The existing AI-7 contract remains authoritative:

- `truth` must come from an explicit observed/final best-track source;
- a forecast snapshot must represent only information actually available at its historical cutoff;
- best-track data may be truth only and may never masquerade as a historical forecast;
- eligible forecast provenance is limited to `storm-track-d1`, `original-official-advisory`, or `auditable-archive`;
- provenance source and original issue time are mandatory.

The AI-19 forecast source is a bounded read-only export from production `storm-track-db`. It preserves advisory IDs, agency, issue time, source URL/hash metadata and forecast points. Production D1 remains read-only throughout AI-19.

For each combined replay snapshot, each agency uses the latest advisory with `issued_at <= asOf`. Individual agency base times remain explicit. Snapshot-level `originalIssuedAt` is the latest issue time among the advisories included in that combined snapshot and must be `<= asOf`.

## Pre-import gates

All of the following must pass before the trigger may move from `PENDING_AI19` to an activation state:

1. AI-18 trigger is `COMPLETED_AI18`.
2. Full Node checkpoint suite passes.
3. AI-19 safety tests pass.
4. Workers Vitest / Miniflare D1 integration passes.
5. Wrangler bundle dry-run passes.
6. `storm-analysis` health is HTTP 200 with `importEnabled=true` and `analysisAdminEnabled=true`.
7. `ANALYSIS_DB` is pristine before the first pilot and Champion generation remains 0.
8. Production source identity equals the read-only inventoried `storm-track-db` resource.
9. Pilot storm identity is `WP-2026-15` / international number 15.
10. Forecast source rows and advisory IDs are selected using bounded read-only queries.
11. Because finalized 2615 truth is unavailable, canonical plan must contain zero `truth_datasets`, zero `truth_points`, zero `signal_outcomes`, `backfill_mode=forecast-only`, and `agency_skill_eligible=0`.
12. Canonical AI-7 import plan is generated deterministically and passes `POST /api/backfill/plan` dry-run.
13. Plan limits remain within the pilot caps above.
14. Exact canonical plan bytes/hash are recorded before activation.
15. No training, curation, promotion, rollback, direct D1 historical write, or Workers AI operation is part of the activation workflow.

## Import semantics

The eventual pilot import must use only:

```text
POST /api/backfill/import
Authorization: Bearer BACKFILL_TOKEN
```

and must import the exact reviewed canonical plan. It must not use direct SQL writes to `ANALYSIS_DB` for historical rows.

After import, the exact same plan must be replayed once to verify idempotence (`already-imported` or equivalent no-op semantics).

## Post-import expected writes

For this forecast-only pilot, only the following raw tables may gain rows:

```text
backfill_runs = 1
historical_storms = 1
forecast_snapshots = 1..4
```

The following must remain zero:

```text
truth_datasets = 0
truth_points = 0
signal_outcomes = 0
verification_results = 0
agency_skill_profiles = 0
adaptive_weight_candidates = 0
signal_calibration_training_runs = 0
signal_outcome_curations = 0
signal_profile_promotion_events = 0
signal_calibration_state.generation = 0
signal_calibration_state.champion_profile_id = NULL
```

Workers AI and automatic signal-profile promotion remain disabled.

AI-19 does not train or promote anything. Importing historical evidence and learning from it are separate checkpoints.

## Current interlock

AI-19 remains locked:

```text
PENDING_AI19
```

Read-only workflows may discover and export bounded forecast evidence. An activation workflow may be introduced only after the deterministic forecast-only plan and its dry-run result are committed and verified.
