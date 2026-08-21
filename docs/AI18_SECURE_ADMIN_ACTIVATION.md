# AI-18 — Secure Admin Activation

Status: **prepared; activation locked pending operator-created GitHub Secrets**  
Branch: `feature/ai-analysis-engine`  
Parent checkpoint: AI-17 `a243636b127d67f11470b86b30dfa7de84c618ae`

## Goal

AI-18 enables the already-deployed independent `storm-analysis` Worker's two write-capable authorization domains without performing any actual analysis-data write:

- `BACKFILL_TOKEN` authorizes only historical backfill import.
- `ANALYSIS_ADMIN_TOKEN` authorizes training, outcome curation, promotion and rollback administration.

The two credentials are intentionally different so compromise of one authorization domain does not automatically grant the other.

## Hard boundaries

AI-18 must not:

- run a historical backfill import;
- run signal calibration training;
- curate signal outcomes;
- promote or roll back a signal calibration Champion;
- modify the production Storm Worker, production D1/R2, `main`, PWA or GitHub Pages;
- enable Workers AI;
- enable automatic Champion promotion;
- write either secret value to source, workflow output, logs, artifacts or deployment evidence.

## Secret format

Create two independent 32-byte random values and store their lowercase hexadecimal encodings. Each GitHub Secret must therefore contain exactly 64 hexadecimal characters.

Recommended local generation, run twice:

```bash
openssl rand -hex 32
```

Store the first value as repository Actions Secret `BACKFILL_TOKEN` and the second as `ANALYSIS_ADMIN_TOKEN`.

Do not reuse `CLOUDFLARE_API_TOKEN`, do not reuse the same value for both application secrets, and do not paste either application secret into ChatGPT, source code, issues, pull requests or commit messages.

## Two-stage activation interlock

The repository contains `.github/ai18-activation-trigger.txt`.

- `PENDING_AI18`: readiness only; Cloudflare secrets cannot be changed by the workflow.
- `ACTIVATE_AI18`: explicit authorization to run the activation path after both GitHub Secrets have been created.
- `COMPLETED_AI18`: written only after successful activation and verification.

The readiness commit deliberately starts at `PENDING_AI18`. A later explicit trigger change is required before any Cloudflare secret mutation.

## Atomic secret activation

AI-18 uses `wrangler secret bulk` with both values in one JSON request. A temporary mode-0600 JSON file is created only inside the ephemeral GitHub Actions runner and is removed immediately after the command.

The workflow does not call separate `wrangler secret put` commands. This avoids intentionally creating an intermediate deployment where only one authorization domain is enabled.

## Pre-mutation gates

Before secret activation, the workflow must pass:

1. complete Node checkpoint tests, including AI-18 guards;
2. Workers Vitest / Miniflare D1 integration;
3. Wrangler bundle-only dry-run;
4. Cloudflare identity verification;
5. live `/health` isolation checks;
6. presence of both application GitHub Secrets;
7. exact 64-hex format for both values;
8. proof the two values differ.

Any failure occurs before `wrangler secret bulk`.

## Safe authorization verification

After activation, `/health` must report both `importEnabled=true` and `analysisAdminEnabled=true` while all isolation flags remain unchanged.

The workflow proves authorization without performing a valid write operation:

- an unauthenticated backfill/admin request must return HTTP 401;
- `ANALYSIS_ADMIN_TOKEN` presented to backfill import must return HTTP 401;
- `BACKFILL_TOKEN` presented to an analysis-admin endpoint must return HTTP 401;
- the correct token with a POST request containing no body must pass authorization and then stop at HTTP 400 `missing-body` before the corresponding data operation can execute.

It also verifies the built-in read-only Champion model and empty signal Champion state remain intact.

## Database no-write gate

After the auth-only probes, AI-18 performs remote read-only SQL and requires all of the following to remain zero:

- `backfill_runs`
- `historical_storms`
- `signal_calibration_training_runs`
- `signal_outcome_curations`
- `signal_profile_promotion_events`
- signal calibration state `generation`

`champion_profile_id` must remain `NULL`.

## Successful checkpoint

Only after all verification passes does the workflow:

1. declare `BACKFILL_TOKEN` and `ANALYSIS_ADMIN_TOKEN` under Wrangler `secrets.required` for future deployments;
2. create `docs/AI18_ACTIVATION_RESULT.md` containing no secret values;
3. set the trigger to `COMPLETED_AI18`;
4. commit the result to the feature branch with `[skip ci]`.

Actual historical data collection and any Champion training/promotion remain future checkpoints.
