# AI-21 — WP-2026-17 Forecast Corpus Extraction Result

Status: **AI-21A extraction complete; remote import not performed**

Audit workflow run: `32456660872`

Job: `96695169039`

Feature checkout: `e7c6dfa94d18afebe82bf7632899f672e87ea35d`

## Target

Internal canonical storm key: `WP-2026-17`

Production metadata observed during inventory:

- `international_number = 17`
- `name_en = TC2620`
- `name_zh = 熱帶低氣壓 19`

The external identity is intentionally **unreviewed**. AI-21 does not copy `17` into the canonical snapshot `internationalNumber` field. The internal `WP-2026-17` key is sufficient for forecast-only preservation; later finalized-truth identity binding requires a separate reviewed mapping.

## Frozen historical cutoffs

| Cutoff | Independent agencies |
|---|---|
| 2026-08-11 12:00Z | JMA, CWA |
| 2026-08-12 12:00Z | CMA, JMA, CWA |
| 2026-08-13 12:00Z | CMA, JMA, CWA |
| 2026-08-14 09:45Z | CMA, JMA, CWA |

HKO is explicitly missing at every cutoff. No agency substitution is performed.

Each cutoff selects the latest archived forecast-bearing advisory from each available agency whose `issued_at` is not later than the cutoff. Only forecast points with `valid_at > cutoff` are retained.

## Extracted evidence

- selected advisories: **11**
- future-only forecast points: **56**
- snapshots: **4**
- source parser version on selected advisories: `3.3.0-alpha.2`
- evidence generated-at anchor: `2026-08-14T09:45:51.723Z` (latest selected archive fetch timestamp)

Evidence SHA-256:

`bf48ab58f885b42b33b0d5f0247416a649b389cfffaa4b4d794868076964716f`

Local plan SHA-256:

`77b2bfdac1190cd5987f2407e9d83af5efa6fabd346ac6f9516fbb3f914e69d2`

Deterministic run ID:

`ai21_forecast_corpus_bf48ab58f885b42b`

## Proposed local plan

The dry-run plan contains exactly:

- `backfill_runs = 1`
- `historical_storms = 1`
- `forecast_snapshots = 4`
- `truth_datasets = 0`
- `truth_points = 0`
- `signal_outcomes = 0`

The proposed storm capability remains:

- `backfill_mode = forecast-only`
- `agency_skill_eligible = 0`

No verification, training, curation, candidate generation, promotion, or Champion change is part of this plan.

## Remote preflight

At the end of the audit, remote `storm-analysis` contained for `WP-2026-17`:

- `historical_storms = 0`
- `forecast_snapshots = 0`
- `truth_datasets = 0`
- `verification_results = 0`

The audit recorded:

`AI21_WP17_REMOTE_MUTATIONS_PERFORMED=false`

## AI-21B boundary

AI-21A is now sufficiently prepared to create a committed canonical evidence/plan artifact and a bounded remote-import gate for this one storm.

AI-21B must remain separately authorized because it will perform real writes to the independent `storm-analysis` D1. Even if AI-21B is activated, it must:

1. target only `WP-2026-17` and the reviewed plan hash;
2. write no truth rows;
3. write no verification rows;
4. perform no training or promotion;
5. leave HKO missing;
6. leave external international identity unreviewed;
7. never write production `storm-track-db` or deploy/modify the production Storm Worker.

`.github/ai21-corpus-trigger.txt` remains `PENDING_AI21` after AI-21A.
