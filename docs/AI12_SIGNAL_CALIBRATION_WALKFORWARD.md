# AI-12 — Signal Calibration Walk-forward Trainer / Challenger Gate

Status: **AI-12 checkpoint implementation**  
Branch: `feature/ai-analysis-engine`  
Parent: AI-11 `7327f7b0989a306f729a0f92d4dbd9f1052653e1`

## Purpose

AI-12 connects historical deterministic replay cases to the AI-11 HKO signal calibration contract and produces a **versioned Challenger profile package** with storm-level walk-forward evaluation.

It does not create a remote D1 database, write a profile row, promote a profile, deploy a Worker, call Workers AI, or modify the production Storm Worker/PWA.

Versions:

```text
signal-calibration-walkforward-trainer/v1
signal-calibration-challenger/v1
```

## Input contract

Input is grouped by storm, never by advisory row:

```text
storms[]
  stormKey
  outcome
    highestSignal
    officialHko = true
    signalSystemEra = modern
  cases[]
    caseId
    asOf
    deterministic analysis artifacts
      AI-3 signalInputs
      AI-10 weightedHongKongImpact
      AI-10 weightedConsensusTrack
```

A case may provide the artifacts directly or provide historical replay input while the caller injects `replayCase(case, storm)`. This allows the trainer to sit above a future historical Storm Analysis replay pipeline without duplicating AI-1/2/3/10 logic.

AI-12 reuses the AI-11 `validateCalibrationRecord()` function after replay.

## Historical cutoff guards

Before replay/training, AI-12 rejects known leakage signals including:

```text
status = rejected-leakage
non-empty upstream leakageIssues (strict mode)
snapshot.generatedAt > asOf
agency availableAt / collectedAt / issuedAt > asOf
agency bulletinTime / baseTime > asOf
```

The default tolerance is one second. A caller may also inject `validateHistoricalCase()` for additional provenance checks.

These checks supplement, rather than replace, AI-11 validation. The final HKO outcome remains a target and may occur after `asOf`; future forecast/source information must not enter the feature side.

## Expanding-window walk-forward

Storms are ordered by their first eligible historical `asOf` time.

For holdout storm `S(n)`, its Challenger profile is trained only from storms whose sort time is **strictly earlier**:

```text
S1 S2 S3 S4 | evaluate S5
S1 S2 S3 S4 S5 | evaluate S6
S1 S2 S3 S4 S5 S6 | evaluate S7
...
```

Default minimum prior storms before evaluation: `8`.

Important guards:

- split unit is the storm, not advisory row;
- a holdout storm never trains its own profile;
- multiple advisories from one storm do not satisfy the minimum training-storm count;
- storms with the same first `asOf` timestamp do not train each other;
- duplicate `stormKey` groups are rejected rather than silently merged.

After out-of-sample walk-forward evaluation is complete, a final Challenger profile may be trained from all eligible storms. Its quality claim comes from the earlier holdout predictions, not from in-sample fit.

## Challenger evaluation

For every eligible holdout case, AI-12 calls AI-11:

```text
estimateHkoSignalRisk()
```

and aggregates the resulting out-of-sample predictions with:

```text
evaluateSignalPredictions()
```

Therefore the same AI-11 metrics are used:

```text
T1 / T3 / T8
  Brier score
  ECE
  reliability bins
```

If a fixed Champion profile is supplied, AI-12 evaluates it on the **same holdout cases** for an apples-to-apples comparison.

## Champion provenance requirement

A numeric comparison is not enough to make a Challenger promotion-eligible. The caller must explicitly provide:

```text
championProfileProvenance.holdoutIndependent = true
```

This is a hard gate because a Champion profile trained using the holdout storms would make the comparison invalid even if its metrics look good.

If independence is not explicitly confirmed:

```text
eligibleForPromotion = false
failedGates includes champion-holdout-independence-unconfirmed
```

AI-12 does not infer this property from dates, profile IDs, or filenames.

## Default Champion/Challenger gates

Defaults:

```text
minimum holdout storms                 5
minimum predictions per signal        20
primary signal                         T8
minimum T8 Brier improvement           3%
maximum T1/T3 Brier regression         2%
maximum ECE absolute regression        0.03
minimum reliability-bin count          3
maximum max-bin-gap regression         0.10
```

The gate reports all failures; it never performs a promotion.

Output always includes:

```text
eligibleForPromotion
promotionPerformed = false
manualPromotionRequired = true
automaticPromotion = false
```

## Reliability gate

In addition to ECE, AI-12 derives the maximum absolute reliability-bin calibration gap using only bins with the configured minimum number of observations. A Challenger cannot materially degrade that maximum gap beyond the configured tolerance.

This avoids approving a model based only on a lower average Brier score while its probability calibration becomes substantially worse in a populated probability range.

## Challenger package / existing D1 schema

AI-12 does **not** need another D1 migration. AI-11 already created `signal_calibration_profiles` with `challenger` as a valid role.

The trainer emits a repository-ready `profileRow`:

```text
profile_id
profile_version
role = challenger
training_window_start
training_window_end
storm_count
sample_count
profile_json
metrics_json
```

No database write is performed. A future authorized repository/write checkpoint can validate and persist this row.

## Safety semantics

```text
expandingWindowWalkForward = true
splitByStorm = true
holdoutStormNeverTrainsItsOwnProfile = true
sameTimestampStormsDoNotTrainEachOther = true
ai11LeakageValidatorReused = true
challengerOnly = true
automaticPromotion = false
databaseWritePerformed = false
aiGenerated = false
```

AI-12 does not change the AI-11 signal meaning: T1/T3/T8 remain Storm Track calibrated risk estimates, not HKO decisions or exact issuance-time forecasts. T9/T10 remain outside statistical calibration.

## Validation

```bash
node --check analysis/signal-calibration-walkforward-trainer.js
node --check tests/signal-calibration-walkforward-trainer.test.cjs
node tests/signal-calibration-walkforward-trainer.test.cjs
```

Tests cover:

- expanding-window split by storm;
- repeated advisories from one storm not counting as more storms;
- injected replay path;
- duplicate storm rejection;
- upstream/future-source leakage rejection;
- versioned Challenger row generation;
- Brier/ECE/reliability promotion gates;
- mandatory Champion holdout-independence provenance;
- no automatic promotion or DB write.

## Not done in AI-12

- no real historical bulk replay has been executed;
- no real Challenger profile has been produced from HKO history yet;
- no profile row is written to D1;
- no Champion profile is promoted;
- no scheduler/training cron exists;
- no remote D1 migration/deployment;
- no Workers AI narrative;
- no production Worker or PWA change.

## Next checkpoint

AI-13 should implement the **historical replay adapter / training-run repository** that reads auditable historical forecast snapshots plus HKO outcomes, runs deterministic replay into the AI-12 contract, and persists a Challenger training run/profile only after validation. Promotion should remain a separate explicit action.
