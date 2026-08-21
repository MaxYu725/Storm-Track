# AI-17 — First storm-analysis Deployment Result

Status: **deployed, migrated, independently verified, and repository binding recorded**

- Source authorization commit: `3f62bd0f14879e4a6b8ead2835e46c261c53b134`
- Independent verification run: `https://github.com/MaxYu725/Storm-Track/actions/runs/32445191753`
- Worker: `storm-analysis`
- Worker URL: `https://storm-analysis.max-yu.workers.dev`
- Worker deployment ID: `7d2b7231-b7dc-41d8-8e57-f495b0ac9d76`
- D1 binding: `ANALYSIS_DB`
- D1 database: `storm-analysis`
- D1 database ID: `99c692b2-c932-4774-bf8d-2d7f10f6c6f8`
- D1 location request: `apac`
- Remote migrations: `0001 → 0006` verified
- Initial signal Champion state: `NONE / generation 0`
- `BACKFILL_TOKEN` / `ANALYSIS_ADMIN_TOKEN`: not configured; write-capable APIs disabled
- Workers AI: disabled
- Automatic signal-profile promotion: disabled
- Production Storm Worker modified: no

## Verification evidence

The post-provisioning read-only verification confirmed exactly one D1 database named `storm-analysis` and the expected D1 UUID above.

Remote `d1_migrations` contains, in order:

1. `0001_learning.sql`
2. `0002_analysis_cache.sql`
3. `0003_signal_risk_calibration.sql`
4. `0004_signal_training_runs.sql`
5. `0005_signal_outcome_curations.sql`
6. `0006_signal_profile_promotions.sql`

`signal_calibration_state` contains the expected bootstrap singleton:

```text
state_id = 1
champion_profile_id = NULL
generation = 0
```

The deployed Worker returned HTTP 200 from `/health` with:

- `analysisDbBound = true`
- `importEnabled = false`
- `analysisAdminEnabled = false`
- `workersAiEnabled = false`
- `promotionApiEnabled = true`
- `automaticPromotionEnabled = false`
- `productionStormWorkerModified = false`

Read-only endpoint checks also confirmed:

- `/api/models/champion`: `builtin-equal-v1`, `persisted = false`
- `/api/signal-risk/profiles/champion`: no active signal calibration Champion

Unauthenticated requests to `/api/backfill/import`, `/api/admin/signal-training/preview`, and `/api/admin/signal-risk/promotion/preview` all returned HTTP 503 while application secrets remain unconfigured. No import, training run, promotion, rollback, or other analysis-data write was executed by those checks.

## Repository writeback recovery

The provisioning run successfully created, migrated, and deployed the independent service, but its intended final repository evidence commit did not land. After independently verifying the live D1, migration history, bootstrap state, Worker deployment, read endpoints, and authorization gates, this checkpoint records the already-provisioned D1 UUID in `workers/storm-analysis/wrangler.jsonc` and adds this non-secret evidence file.

This recovery writeback does **not** redeploy the Worker, reapply migrations, create another D1 database, configure application secrets, or modify the production Storm Worker, production D1/R2, `main`, PWA, or GitHub Pages.
