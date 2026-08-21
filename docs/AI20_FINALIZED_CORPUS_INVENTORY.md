# AI-20 — Finalized Historical Corpus Inventory

Status: **no additional finalized production forecast corpus available**

Read-only inventory run: `32455064612`

Job: `96690654913`

The inventory compared the current official JMA 2026 finalized RSMC Best Track index with the production `storm-track-db` forecast archive. It performed only official-document reads and D1 `SELECT` queries.

## JMA finalized 2026 storms at inventory time

The current `bst2026.txt` contained:

| International number | Name | Revision date | Best Track points |
|---|---|---:|---:|
| 2601 | NOKAEN | 2026-05-12 | 35 |
| 2602 | PENHA | 2026-05-12 | 17 |
| 2603 | NURI | 2026-06-11 | 10 |
| 2604 | SINLAKU | 2026-07-23 | 62 |

## Production archive overlap

There were **0** exact finalized-JMA / production-forecast matches and therefore **0** additional finalized forecast candidates.

The production Storm archive begins with material collected from 2026-08-05 onward. Its forecast-bearing canonical rows at inventory time were concentrated in later systems such as:

- `WP-2026-15` CHAN-HOM: 104 advisories, 4 agencies, 575 forecast points;
- `WP-2026-16`: 254 advisories, 4 agencies, 1,311 forecast points;
- `WP-2026-17`: 53 advisories, 3 agencies, 270 forecast points;
- several temporary/merged systems with narrower coverage.

Because JMA 2601–2604 predate the current production collection window, the archive cannot supply their historical agency forecasts. Finalized Best Track truth alone is not sufficient for agency-skill learning; forecast provenance from the historical cutoff is also required.

## Identity observation

Production `storms.international_number` currently contains short values such as `15`, `17`, and `18`, rather than finalized RSMC identifiers like `2615`. AI truth matching must therefore not silently infer identity from this field alone. Existing canonical storm identity / explicit reviewed mapping must remain authoritative until production identity semantics are separately resolved.

This observation does not authorize a production database identity rewrite. The authoritative production Worker source remains unavailable in the repository, so no production backend correction is attempted here.

## Training implication

The existing production archive cannot currently provide the default minimum five distinct finalized storms required by adaptive-weight learning. AI-20/AI-21 must therefore remain conservative:

- one storm may be verified for evidence quality;
- one storm must not create a meaningful adaptive-weight candidate;
- advisory count or forecast-point count must never substitute for distinct storm count;
- no Champion promotion may be justified from the CHAN-HOM pilot alone.

A future larger corpus would require either continued accumulation until multiple current-season systems receive finalized truth, or a separately reviewed historical forecast archive with explicit provenance. Finalized truth without historical forecast evidence must not be treated as a walk-forward training case.

## Remote safety

After the inventory:

- `backfill_runs = 1`
- `historical_storms = 1`
- `forecast_snapshots = 4`
- `truth_datasets = 0`
- `truth_points = 0`
- `verification_results = 0`
- training rows = 0
- promotion rows = 0
- generation = 0
- Champion = NONE
- `AI20_CORPUS_INVENTORY_MUTATIONS_PERFORMED=false`

AI-20 remains `PENDING_AI20` while JMA 2615 remains preliminary.
