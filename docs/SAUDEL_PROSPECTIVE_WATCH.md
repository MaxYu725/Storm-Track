# SAUDEL prospective validation watch

- Status: **ACTIVE**
- Watch ID: `2026-saudel`
- Identity aliases: `SAUDEL`, `TC2621`

## Why this watch exists

SAUDEL is an unusual prospective validation case because its original tropical-cyclone lifecycle weakened over land while later agency guidance continued to represent a circulation near Hainan / the northern South China Sea. During this period HKO can legitimately have no active tropical-cyclone track even while CMA, JMA, and/or CWA continue to publish a related system.

This creates a high-value validation interval for:

- post-lifecycle redevelopment versus new-genesis identity handling;
- agency membership and forecast-horizon changes;
- long-horizon escalation / withdrawal;
- HKO T1/T3/T8 truth lead time and timing-window scoring;
- evaluator correctness when `SAUDEL` and `TC2621` representations split or converge.

The watch must preserve absence as evidence. In particular, `HKO: empty / 沒有活躍路徑` is a meaningful time-stamped state and must not be discarded merely because the model fingerprint is unchanged.

## Capture policy

The normal Beta prospective recorder remains on its established approximately 15-minute cadence. HKO warning truth remains on the higher-frequency approximately 5-minute coverage path.

While `CASE_WATCH_ACTIVE=true`, every successful Beta recorder run creates a separate watched-case snapshot under:

`data/beta-prospective-observations:case-watch/2026-saudel/`

Each snapshot preserves:

- recorder `capturedAt` time and source commit;
- all four agency source states, including HKO route absence;
- visible group keys and stale/discarded keys;
- every observation matching `SAUDEL`, `TC2621`, or a matching agency source ID;
- agency source IDs, bulletin times, current times, forecast counts and forecast horizons;
- the full matched prospective observation, including generated analysis, risk values, likelihood states and estimated timing windows.

A compact chronological `timeline.ndjson` is appended on every watched capture, including captures whose ordinary model fingerprint is unchanged.

## Isolation from model evaluation

The watch data is stored under `case-watch/`, not `observations/`. `reconcile-beta-case-identities.mjs` only reads `observations/`, so these additional high-resolution timepoints do **not** alter frozen v1 model output, case reconciliation, evaluator scoring, closeout rules, or existing prospective evidence semantics.

The watch is evidence preservation only.

## Activation baseline

Immediately before activation, the automated Beta corpus recorded at `2026-08-31T03:22:54.220Z`:

- HKO source state: `empty` — `沒有活躍路徑`;
- CMA: active;
- JMA: active;
- CWA: active;
- visible group `TC2621` displayed as `沙德爾 (SAUDEL)`.

This is the baseline from which the high-resolution watch continues.

## Stop condition

Keep the watch active through SAUDEL / TC2621 identity resolution and formal prospective closeout. Disable it only after the final truth / no-signal closeout evidence and evaluator correctness review have been captured.
