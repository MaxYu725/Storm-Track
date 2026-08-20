# AI-6 — Agency Skill Profile / Adaptive Weight Candidate

Status: **AI-6 checkpoint implementation**  
Branch: `feature/ai-analysis-engine`  
Parent: AI-5 `962a753d98fafb8c581c7b06ea95241953466a57`

## Purpose

AI-6 converts verified AI-5 historical backtests into versioned agency skill profiles and bounded candidate weights. It does not change the production consensus, does not train an LLM, and does not automatically promote a candidate.

Files:

- `analysis/agency-skill-profile.js`
- `tests/agency-skill-profile.test.cjs`

## Skill profile

`agency-skill-profile/v1` combines multiple storm-level AI-5 backtest outputs. `truth-only` storms are excluded from agency forecast-skill scoring. Sample reliability is based on distinct storms, not advisory-row count.

For HKO/CMA/JMA/CWA it keeps overall and lead-bucket track/intensity/pressure metrics. Default track lead buckets remain:

```text
0-12h
12-24h
24-48h
48-72h
72-120h
120h+
```

## Candidate weighting v1

`adaptive-weight-candidate/v1` is deliberately conservative:

1. start from the current champion weights (default equal 25% each);
2. require minimum distinct storms and verified forecast points;
3. estimate relative track skill using inverse MAE;
4. shrink observed skill toward the peer baseline when storm count is small;
5. blend the skill target back toward champion weights;
6. constrain every agency by global min/max and a maximum delta from champion;
7. project all bounded weights back to exactly 100%.

Default safeguards:

```text
minimumStorms = 5
minimumPoints = 20
shrinkageStorms = 10
minWeight = 0.10
maxWeight = 0.40
maxWeightDelta = 0.08
```

Sparse buckets therefore stay close to or exactly at the champion instead of allowing one unusually accurate storm to dominate future forecasts.

AI-6 v1 changes weights only by forecast lead bucket. Regional/storm-intensity/behaviour-conditioned weighting should be added only after historical backfill supplies enough independent storms per context bucket.

## Champion / Challenger

A candidate is not promoted merely because its in-sample MAE is lower. `evaluateChampionChallenger()` requires holdout metrics supplied by a caller and checks:

- minimum holdout sample count;
- minimum track-MAE improvement;
- maximum tolerated regression on critical Hong Kong metrics such as closest-time and closest-distance MAE.

Even when every gate passes:

```text
eligibleForPromotion = true
promotionPerformed = false
automaticPromotion = false
```

Promotion remains a separate explicit operation so the current model can always be retained or rolled back.

## Safety semantics

```text
truthOnlyExcludedFromAgencySkill = true
groupedByStorm = true
advisoryRowsDoNotCountAsIndependentStorms = true
candidateOnly = true
promotionRequired = true
productionWeightsChanged = false
modelTrainingPerformed = false
aiGenerated = false
```

## Validation

```bash
node tests/agency-skill-profile.test.cjs
```

Tests cover truth-only exclusion, distinct-storm minimum samples, shrinkage/bounds, sum-to-one weights, different weights by lead bucket, and Champion/Challenger promotion gates.

## Next checkpoint

AI-7 should add the independent `storm-analysis` Cloudflare Worker boundary and Workers AI narrative layer. It should consume deterministic AI-1..AI-6 outputs, never calculate meteorological truth inside the LLM, cache/dedupe by advisory fingerprint, and keep numerical/official-warning facts outside generated prose.
