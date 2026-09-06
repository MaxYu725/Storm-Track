# HK Signal V2 historical positive-control validation

Status: **ACTIVE — NOUL independent positive control**

## Purpose

The quiet-window V2 0.5 revision materially reduced NARRA T1 `likely` false-positive evidence while preserving the existing prospective clean-negative cases. Before tightening T1/T3/T8 further or moving V2 0.5 toward the live shadow surface, the model now needs an independent case in which HKO actually issued T1, T3 and T8.

The immediate control case is **NOUL / 紅霞 (2026)** because the repository already has official CMA/NMC as-issued forecast history and an HKO verification-only signal lifecycle.

This validation is deliberately different from prospective replay:

- forecast input is reconstructed only from CMA/NMC material that existed at each historical snapshot;
- HKO signal truth is never supplied to V1 or V2 during forecast generation;
- truth is compared only after the full forecast sequence has been generated;
- no missing agency is substituted;
- V1 stays frozen;
- V2 stays shadow-only;
- no production Worker or database write is involved.

## Why this comes before another coefficient change

The remaining five NARRA V2 `likely` snapshots cannot safely be eliminated by simply tightening the distance scale. Their geometry overlaps plausible operational T1 conditions, and the current prospective corpus contains only one completed true-T1 case, SAUDEL, whose multi-phase lifecycle is atypical.

A historical positive control therefore has higher information value than another NARRA-specific adjustment. The question is not whether V2 can make NARRA look perfect; it is whether the generic maturity logic still gives useful warning lead on a real T1/T3/T8 event.

## Replay contract

`scripts/replay-historical-v2-case.mjs` rebuilds, for each official CMA/NMC as-issued NOUL snapshot:

1. Storm Analysis snapshot;
2. Hong Kong impact assessment;
3. HKO-signal risk inputs with no official-warning context;
4. deterministic threat assessment;
5. frozen V1 forecast;
6. V2 0.5 shadow forecast.

Only after all snapshots are generated does the replay call the existing HKO-truth evaluator.

The report records, separately for V1 and V2:

- first `possible/likely` positive time;
- first `likely` time;
- state counts;
- fixed pre-issuance checkpoints;
- first stable-positive lead;
- estimated-window verification against the later official issue time.

## Decision use

The historical replay is **validation evidence, not training input**.

Interpretation after the first NOUL run:

- if V2 preserves useful T1/T3/T8 lead relative to V1, V2 0.5 gains independent support and can proceed toward live shadow integration;
- if V2 removes or materially delays genuine positive-event warning lead, revise the generic maturity/support architecture before promotion;
- do not choose a new coefficient merely to optimize NOUL;
- RAGASA may become a second historical strong-signal control later, but its current repository manifest does not yet contain an equivalent as-issued forecast source suitable for the same quality of replay.

## Development state

**V1 = frozen benchmark · V2 0.5 = development shadow · NOUL = independent historical positive control.**
