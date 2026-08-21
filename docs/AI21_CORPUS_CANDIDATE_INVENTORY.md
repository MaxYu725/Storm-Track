# AI-21 — Prospective Corpus Candidate Inventory

Status: **read-only inventory complete; WP-2026-17 selected as the next extraction target**

Workflow run: `32456403826`

Job: `96694436472`

Feature checkout: `2115f9429a23c031be4ea38c64acadd6117f3ae8`

The workflow ran the complete AI regression suite, verified the production source D1 identity, queried forecast-bearing storms and per-agency coverage using `SELECT` only, ranked corpus candidates, and reconfirmed the independent `storm-analysis` D1 state.

## Candidate ranking

| Storm key | Production number | Identity | Agencies | Forecast advisories | Forecast points | Last forecast issue | Decision |
|---|---|---|---:|---:|---:|---|---|
| WP-2026-16 | 18 | unreviewed | 4 | 252 | 1,334 | 2026-08-21 06:45Z | defer freeze; still updating |
| WP-2026-15 | 15 | unreviewed | 4 | 102 | 575 | 2026-08-11 23:45Z | already preserved by AI-19 |
| WP-2026-17 | 17 | unreviewed | 3 | 52 | 270 | 2026-08-14 09:45Z | **next extraction target** |
| WP-2026-TEMP-DC73F40F | null | unreviewed temporary identity | 2 | 14 | 98 | 2026-08-21 04:30Z | defer; temporary and still updating |

The production `international_number` values remain unreviewed. They are inventory metadata only and must not be copied into a canonical AI-21 snapshot until external identity is explicitly reviewed.

## WP-2026-17 coverage

`WP-2026-17` currently has three independent official-source archives:

- CMA: 15 forecast advisories / 59 forecast points; 2026-08-12 00:00Z to 2026-08-14 09:00Z
- CWA: 12 forecast advisories / 84 forecast points; 2026-08-11 12:00Z to 2026-08-14 06:00Z
- JMA: 25 forecast advisories / 127 forecast points; 2026-08-11 10:30Z to 2026-08-14 09:45Z
- HKO: no archived forecast coverage for this storm

AI-21 must preserve HKO as explicitly missing. CMA, CWA and JMA remain independent; no source is permitted to stand in for HKO.

Although the production row currently contains `international_number = 17` and `name_en = TC2620`, that disagreement is exactly why AI-21 identity remains `unreviewed`. Forecast-only preservation may use the stable internal key `WP-2026-17`; finalized JMA identity binding is deferred to a separate reviewed truth-mapping step.

## Why WP-2026-16 is not frozen yet

`WP-2026-16` has the richest archive, with all four agencies, but its last forecast issue was the same time window as the inventory run. Freezing a bounded corpus now would risk creating an arbitrary incomplete lifecycle sample. AI-21 will inventory it again after the forecast stream becomes quiescent.

## AI-21A next extraction checkpoint

The next step is read-only deterministic evidence extraction for `WP-2026-17`:

1. freeze a small set of historical cutoffs across its forecast lifecycle;
2. at each cutoff, select the latest forecast-bearing advisory per independent agency whose issue time is not later than the cutoff;
3. retain only forecast points whose valid time is strictly after that cutoff;
4. require at least two independent agencies at each cutoff;
5. keep the external international number unreviewed and absent from canonical snapshots;
6. generate a hash-bound local AI-21 plan and dry-run preview;
7. do not import it remotely until a separate AI-21B activation gate.

## Remote safety state

After inventory:

- `backfill_runs = 1`
- `historical_storms = 1`
- `forecast_snapshots = 4`
- `truth_datasets = 0`
- `truth_points = 0`
- `verification_results = 0`
- `agency_skill_profiles = 0`
- `adaptive_weight_candidates = 0`
- training rows = 0
- promotion rows = 0
- generation = 0
- Champion = NONE
- `AI21_REMOTE_MUTATIONS_PERFORMED=false`

AI-20 remains `PENDING_AI20`. AI-21 remains `PENDING_AI21`; no remote forecast-corpus import has been authorized or performed.
