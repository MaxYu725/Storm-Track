# Consensus Track verification readiness

## Purpose

CT-1B asks one question before any forecast-skill evaluator is built:

> Can a persisted Consensus Track prospective source reference be joined back to the same agency's **as-issued forecast cycle** and valid-time points in the existing production Archive?

This is a read-only evidence audit. It does not calculate track error, rank agencies, tune weights or modify production data.

## Audit contract

Input: latest production `storm-consensus-track-prospective/v2` record.

Archive: `https://storm.max-yu.workers.dev/api/history`.

Identity rule:

- require explicit same-agency D1 `aliases[].agency_storm_id` evidence;
- HKO / CMA / JMA use their persisted source ID directly;
- CWA accepts the explicit generic alias form `YYYY-TDNN` when the live source ID is `YYYY-NN`;
- arbitrary numeric or name-only metadata is not accepted as source identity.

Cycle rule:

- HKO / CMA / CWA advisories must match the source-specific `source_code` representation before time alignment;
- JMA stores `TC26xx` EventID in aliases but WMO `VPTWxx` product codes on advisories; if a D1 storm record contains multiple JMA EventIDs, the advisory stream is marked ambiguous;
- a cycle must be within 3 hours of the persisted bulletin/base/current reference time;
- stale, future or ambiguous cycles are never accepted by widening the tolerance.

Valid-time reconstruction is attempted only after a safe same-cycle join. Exact/interpolated reconstruction must agree with the persisted CT provenance class.

## Production audit result

Audited CT v2 capture:

- capturedAt: `2026-08-23T07:46:08.509Z`
- source commit: `254864339ec652e1bb4776abd4b808177207ee6d`
- groups: GAENARI, NARRA, SAUDEL, Tropical Depression
- source references: 13
- eligible valid-time contribution targets: 167

Result:

| Metric | Result |
| --- | ---: |
| Explicit storm identity joins | 13 / 13 (100%) |
| Same-cycle joins within 3h | 0 / 13 (0%) |
| Explicitly stale cycles | 10 / 13 |
| Ambiguous JMA advisory streams | 3 / 13 |
| Median nearest-cycle Archive lag | 675 min (11.25h) |
| Safely reconstructable valid-time targets | 0 / 167 (0%) |

Agency summary:

| Agency | Source refs | Identity | Same-cycle | Stale | Ambiguous stream | Median Archive lag |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| HKO | 3 | 3/3 | 0/3 | 3 | 0 | 621 min |
| CMA | 3 | 3/3 | 0/3 | 3 | 0 | 720 min |
| JMA | 4 | 4/4 | 0/4 | 1 | 3 | 660 min |
| CWA | 3 | 3/3 | 0/3 | 3 | 0 | 1080 min |

## Correct identity examples

The field-specific matcher resolves the live references to D1 identities without relying on fuzzy name matching:

- GAENARI CMA `3308554`, HKO `2631`, JMA `TC2623` → `WP-2026-17`
- NARRA CMA `3304364`, CWA `2026-19`/D1 alias `2026-TD19`, HKO `2629`, JMA `TC2622` → `WP-2026-17`
- SAUDEL CMA `3304099`, CWA `2026-18`, JMA `TC2621` → `WP-2026-16`
- Tropical Depression HKO `2632`, CWA `2026-23`/D1 alias `2026-TD23` → `WP-2026-TEMP-1E4872B2`
- Tropical Depression JMA `TC2624` → `WP-2026-24`

The fact that several real systems share a D1 storm row is itself important: source-ID evidence is required; a storm-row name alone is not a safe join key.

## Archive completeness finding

The nearest stored advisories are materially older than the live CT source cycles. Representative lag measurements include:

- HKO `2631`: 624 min
- HKO `2629`: 621 min
- HKO `2632`: 599.4 min
- CMA `3308554`: 840 min
- CMA `3304364`: 720 min
- CMA `3304099`: 720 min
- CWA named/generic streams: 1080 min
- JMA nearest available products: about 645–675 min behind, with three source streams additionally ambiguous at advisory level

The archived advisory `issued_at` and stored analysis/forecast valid-time ranges are also old, so this is not merely a timezone or field-interpretation problem.

## Decision

**CT-2 homogeneous skill verification is blocked against the current Archive corpus.**

A fair Consensus-versus-agency comparison requires the same storm, forecast cycle and valid time. Substituting an advisory 10–18 hours older would violate the homogeneous paired-sample requirement and could produce misleading skill claims.

This finding does **not** indicate a problem with CT-0 equal weighting or valid-time alignment. It is an evidence/archive completeness limitation.

## Required remediation before CT-2

One of these paths must establish reliable prospective as-issued agency baselines:

1. acquire/reconstruct the authoritative production Worker source and then correct/extend Archive ingest safely; or
2. add a separate immutable prospective agency-baseline recorder that captures the as-issued agency forecast points needed for verification.

Because authoritative production Worker source is not currently versioned in this repository, do not restore or redeploy an old Worker implementation from Git history merely to unblock CT-2.

Until baseline evidence is complete, continue CT-0 prospective collection. CT-1C read-only observation UI can proceed independently because it does not require skill scoring.

## Selected remediation: separate prospective agency baselines

The selected path is the second option: preserve future as-issued agency baselines in a separate immutable evidence stream without changing production Worker or D1.

The baseline schema is `storm-agency-baseline-prospective/v1`. Each source stream stores only the track evidence needed later for homogeneous verification:

- agency, source ID and source token;
- bulletin time as supplied by the live source;
- latest valid analysis point only;
- all valid as-issued forecast points with valid time, optional forecast base time / forecast hour, latitude and longitude;
- exact source-token case ID from the existing Consensus Track case registry when already resolvable;
- evidence and cycle fingerprints for deduplication.

It explicitly does not persist the full historical analysis track, intensity fields, verification truth, consensus output, forecast error, ranking or weighting.

First PR-local live validation captured all 13 active source streams across GAENARI, NARRA, SAUDEL and Tropical Depression. All 13 source tokens resolved to the existing CT case registry. Forecast point counts were non-zero for every stream; HKO/JMA sources that do not supply forecast `baseTime` remain `null` rather than receiving an inferred value.

This recorder prevents additional prospective baseline loss after deployment. It does not repair the older D1 Archive and therefore does not by itself open CT-2.
