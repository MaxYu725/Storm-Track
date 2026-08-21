# AI-18 — Secure Admin Activation Result

Status: **activated, independently verified, and repository declaration recorded**

- AI-18 readiness checkpoint: `f7f5337e3140d3f156b16ff0b7e206b5b1b023c8`
- Explicit activation commit: `9818056d184a3daeee35285bdb7b66a99100efe4`
- Guard-fix activation retry source: `7837e0fe3e57663dd3e0d3ab96ac737c4724c042`
- Independent post-activation verification run: `https://github.com/MaxYu725/Storm-Track/actions/runs/32449624146`
- Worker: `storm-analysis`
- Worker URL: `https://storm-analysis.max-yu.workers.dev`
- D1 database: `storm-analysis`
- D1 database ID: `99c692b2-c932-4774-bf8d-2d7f10f6c6f8`
- Deployment before AI-18 activation: `7d2b7231-b7dc-41d8-8e57-f495b0ac9d76`
- Deployment after atomic secret activation: `9e4d6c82-1924-4e0b-94d3-d7314b9fda4d`
- `BACKFILL_TOKEN`: configured as Worker secret; value not recorded
- `ANALYSIS_ADMIN_TOKEN`: configured as Worker secret; value not recorded
- Secret activation method: `wrangler secret bulk` in one request
- `importEnabled`: true
- `analysisAdminEnabled`: true
- Workers AI: disabled
- Automatic signal-profile promotion: disabled
- Production Storm Worker modified: no

## Authorization-boundary verification

The independent post-activation diagnostic verified that both secret names are present exactly once on the deployed `storm-analysis` Worker and that `/health` returns HTTP 200 with both authorization domains enabled.

Unauthenticated POST requests to all of the following returned HTTP 401:

- `/api/backfill/import`
- `/api/admin/signal-training/preview`
- `/api/admin/signal-risk/promotion/preview`

Cross-token probes also returned HTTP 401:

- `ANALYSIS_ADMIN_TOKEN` cannot authorize `/api/backfill/import`.
- `BACKFILL_TOKEN` cannot authorize `/api/admin/signal-training/preview`.

Correct-token zero-length POST probes returned HTTP 400 `invalid-json`. In the deployed Workers runtime, the zero-length POST is represented as an empty readable body stream, so request JSON validation rejects it before the corresponding import or training operation can execute. The workflow guard accepts either `missing-body` or `invalid-json` as the safe pre-operation body-validation result.

## ANALYSIS_DB no-write verification

After all authorization probes, remote read-only SQL confirmed:

```text
backfill_runs = 0
historical_storms = 0
signal_calibration_training_runs = 0
signal_outcome_curations = 0
signal_profile_promotion_events = 0
signal_calibration_state.generation = 0
signal_calibration_state.champion_profile_id = NULL
```

No historical import, training run, outcome curation, signal-profile promotion, rollback, or other analysis-data write was executed by AI-18 verification.

## Repository declaration

`workers/storm-analysis/wrangler.jsonc` now declares both names under `secrets.required`. This records names only, never values, and causes future Wrangler deployment/version-upload operations to reject a deployment if either required secret is missing.

The AI-18 lifecycle trigger is now `COMPLETED_AI18`.

## Recovery note

The Cloudflare secret activation itself succeeded, but the original workflow stopped before repository writeback because its safe authorized zero-body probe expected only `400 missing-body`; the deployed runtime returned the equally pre-operation `400 invalid-json`. Independent verification proved the secrets were already active and the database remained untouched, so this checkpoint performs repository recovery writeback only. It does **not** invoke `wrangler secret bulk` again.
