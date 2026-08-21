# AI-11 — HKO Signal Risk Probability Calibration

Status: **AI-11 checkpoint implementation**  
Branch: `feature/ai-analysis-engine`  
Parent: AI-10 `bab1b4c7f86769769f57fd5e2afb6266b372dc38`

## Purpose

AI-11 adds a transparent historical calibration layer for Storm Track estimates of whether a tropical cyclone will reach at least:

```text
T1
T3
T8
```

These are **Storm Track risk estimates**, not Hong Kong Observatory forecasts or promises that HKO will issue a signal at a particular time.

No statistical T9/T10 probability is produced in v1. Those rare signals remain `rule-evidence-only` so sparse historical labels cannot drive an unconstrained model.

## Historical signal-system boundary

HKO's warning database notes that Signals 5–8 represented directional gale signals before 1973 and were replaced by the present No. 8 NW/SW/NE/SE notation on 1 January 1973. HKO's signal-history page states that the 1973 system has remained in use since then.

AI-11 therefore requires every calibration outcome to explicitly declare:

```text
signalSystemEra = modern
officialHko = true
```

It does not infer either property from a storm name, year, URL, or source string. Older records may still be useful for track/intensity verification but are excluded from this modern signal-label calibration.

## Training record contract

Each historical calibration sample must contain:

```text
stormKey
asOf
AI-3 signalInputs
AI-10 weightedHongKongImpact
AI-10 weightedConsensusTrack
explicit official HKO outcome
```

`signalInputs.generatedAt` may not be later than the historical `asOf` cutoff (default tolerance 1 second). The later final warning outcome is the target and is not treated as a forecast input.

Best-track or retrospective data must not be injected into the feature side of a historical sample.

## Feature context

AI-11 v1 deliberately uses a small, auditable context:

1. Champion-weighted closest distance to Hong Kong;
2. lead time from weighted-track reference base to closest approach;
3. representative maximum-wind feature already normalized by AI-3.

Buckets are intentionally coarse:

```text
distance: <100 / 100-200 / 200-300 / 300-500 / 500-800 / 800+ km
lead:     0-12 / 12-24 / 24-48 / 48-72 / 72-120 / 120+ h
wind:     <20 / 20-30 / 30-40 / 40-50 / 50+ m/s
```

These wind buckets describe tropical-cyclone intensity evidence. They are **not** HKO local-wind signal thresholds.

## Storm-balanced hierarchical calibration

Calibration cells are built at four levels:

```text
global
  -> distance
      -> distance + lead
          -> distance + lead + wind
```

A live estimate starts at the most specific cell and falls back until a cell has the configured minimum number of distinct storms (default 5).

Multiple advisories from one storm do not count as independent storms. Within one cell, all samples from one storm share a total effective weight of 1. This prevents a storm with unusually frequent archived advisories from dominating the historical rate.

Child-cell probabilities are shrunk toward their parent using a configurable prior strength (default 4 effective storms). The global cell uses a neutral Beta-style 0.5 prior.

The probability hierarchy is always constrained to:

```text
P(T1) >= P(T3) >= P(T8)
```

## Official current-signal context

AI-3 accepts optional trusted HKO current-signal context. If it is supplied, AI-11 never returns a probability below an already observed fact.

Example: when an official No. 3 signal is already supplied, T1 and T3 are set to 100% reached while the future T8 probability remains calibrated from historical evidence.

This adjustment does not infer any future HKO decision.

## Holdout evaluation

`evaluateSignalPredictions()` provides, per T1/T3/T8:

- Brier score;
- 5-bin reliability data by default;
- expected calibration error (ECE).

It expects holdout/walk-forward predictions. It does not train, promote, or activate a profile.

Train/test separation must remain by storm rather than advisory row.

## ANALYSIS_DB profile layer

Migration `0003_signal_risk_calibration.sql` adds only the independent analysis table:

```text
signal_calibration_profiles
```

Roles are:

```text
champion
challenger
retired
```

AI-11 Worker code only **reads** these rows. There is no profile-write or promotion endpoint.

Read-only endpoints:

```text
GET /api/signal-risk/profiles/champion
GET /api/signal-risk/profiles/:profileId
```

If no Champion profile exists, deterministic storm analysis still succeeds and returns:

```text
signalRisk.available = false
reason = no-champion-calibration-profile
```

## Cache identity

`analysis-cache/v2` adds the selected signal-calibration profile content to the request fingerprint. A profile change therefore cannot reuse an analysis result calibrated by an older profile, even if the track Champion model and advisory are unchanged.

If the calibration-profile table/read fails, analysis fails open but deliberately bypasses both cache reads and writes for that request because the active profile is unknown.

## Orchestration v3

AI-11 advances the deterministic Worker output to:

```text
storm-analysis-orchestration/v3
```

New output:

```text
deterministic.signalRisk
```

Safety semantics include:

```text
stormTrackSignalRiskEstimateIncluded
signalRiskProbabilitiesAreAppComputed
championSignalCalibrationReadOnly
signalCalibrationPromotionPerformed = false
warningSignalPredictionIncluded = false
officialHkoDecisionInferred = false
aiGenerated = false
```

## Validation

```bash
node --check analysis/hko-signal-risk-calibration.js
node tests/hko-signal-risk-calibration.test.cjs
node --check workers/storm-analysis/src/signal-risk-repository.js
node --check workers/storm-analysis/src/analysis-cache-repository.js
node --check workers/storm-analysis/src/analysis-orchestrator.js
node --check workers/storm-analysis/src/index.js
node tests/storm-analysis-ai11.test.mjs
```

Migration is also executed against SQLite during checkpoint verification.

## Not done in AI-11

- no remote D1 creation or migration;
- no historical profile has been promoted to Champion;
- no automatic training job;
- no automatic profile promotion;
- no T9/T10 statistical probabilities;
- no exact HKO signal issuance-time forecast;
- no Workers AI narrative;
- no production Worker or PWA change.

## Next checkpoint

AI-12 should connect walk-forward historical snapshots to the AI-11 training/evaluation contract and produce versioned Challenger calibration profiles with storm-level holdout Brier/reliability gates. Promotion should remain explicit and reversible.
