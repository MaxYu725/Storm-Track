# AI-17 — Provisioning + First storm-analysis Deployment

Status: **authorized deployment checkpoint**  
Branch: `feature/ai-analysis-engine`  
Parent checkpoint: AI-16 `5b1db705dd274c511484bec83c68cdb4308c7b9c`

## Scope

AI-17 is the first checkpoint permitted to create Cloudflare resources for the independent `storm-analysis` service. It is intentionally limited to:

1. validating the complete AI-16 test suite in GitHub Actions;
2. creating one new D1 database named `storm-analysis` in the APAC location when none exists;
3. replacing the AI-16 zero-UUID placeholder with that new D1 UUID;
4. applying remote migrations `0001` through `0006` in order;
5. deploying only the `storm-analysis` Worker;
6. optionally configuring `BACKFILL_TOKEN` and `ANALYSIS_ADMIN_TOKEN` only when both are already present as GitHub Secrets;
7. smoke-testing read-only endpoints and authentication gates;
8. committing non-secret deployment evidence and the real D1 binding ID back to the feature branch.

## Hard isolation boundary

AI-17 must not modify or redeploy:

- the production Storm Worker at `storm.max-yu.workers.dev`;
- the production Storm Worker D1 or R2 resources;
- `main`;
- the PWA or GitHub Pages deployment;
- any historical `worker.js` source.

No cron, route, R2 binding, Workers AI binding or automatic signal-profile promotion is added.

## Credentials

The provisioning workflow consumes only GitHub Secrets for Cloudflare authentication:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

These values are never written to source or workflow output.

Application authorization remains separate:

- `BACKFILL_TOKEN`
- `ANALYSIS_ADMIN_TOKEN`

If both application secrets already exist in GitHub Secrets, AI-17 copies them into Cloudflare Worker secrets after the first deployment. If both are absent, deployment is allowed to complete with the write-capable APIs disabled. If only one is present, provisioning stops before any Cloudflare resource is created.

AI-17 deliberately does not generate unknown one-time application tokens in CI because doing so would leave the operator without a safe retained copy.

## Provisioning safety

The first push-triggered run expects no existing D1 database named `storm-analysis`. An unexpected same-name database causes a hard stop rather than implicit reuse.

A later manual `workflow_dispatch` may set `reuse_existing_analysis_db=true`, but this is intended only for recovery after the database has been explicitly inspected and confirmed as the AI-17 resource.

The workflow uses Wrangler with experimental provisioning disabled for migration and deployment operations.

## Migration gate

Before Worker deployment, the workflow verifies the remote D1 migration history exactly equals:

```text
0001_learning.sql
0002_analysis_cache.sql
0003_signal_risk_calibration.sql
0004_signal_training_runs.sql
0005_signal_outcome_curations.sql
0006_signal_profile_promotions.sql
```

It also verifies the new database starts with:

```text
signal_calibration_state.state_id = 1
signal_calibration_state.champion_profile_id = NULL
signal_calibration_state.generation = 0
```

## Smoke gate

The deployed Worker must return healthy metadata from `/health`, the built-in equal-weight model from `/api/models/champion`, and no active signal calibration Champion from `/api/signal-risk/profiles/champion`.

Unauthenticated write-capable requests are checked without executing a real import, training run, promotion or rollback. They must return `503` while application secrets are absent, or `401` once the two application secrets are configured.

## Pre-provisioning evidence

Immediately before first provisioning, GitHub Actions read-only diagnostic run `32444782761` verified:

- the full Node checkpoint suite passed;
- Workers Vitest / Miniflare D1 integration passed `4/4`;
- Wrangler bundle-only dry-run passed with only the intended `ANALYSIS_DB` D1 binding;
- the rotated Cloudflare API token is valid and has effective D1 access (`wrangler d1 list` returned success);
- there is no pre-existing D1 database named `storm-analysis`;
- there is no pre-existing `storm-analysis` Worker;
- `storm-analysis.max-yu.workers.dev/health` is still `404` before provisioning.

This evidence authorizes the first push-triggered provisioning run while preserving the hard isolation boundary above.

## Deployment result

On successful completion, the workflow creates `docs/AI17_DEPLOYMENT_RESULT.md` containing only non-secret evidence: Worker URL, D1 UUID, migration state, application-secret activation status and workflow run reference. It also commits the real `ANALYSIS_DB` UUID into `workers/storm-analysis/wrangler.jsonc`.

A failure before the final evidence commit must be treated as a partial deployment. Inspect the workflow log and Cloudflare resource state before authorizing reuse; do not blindly rerun against an existing D1.
