# AI-5 — Historical Walk-forward Backtest / Backfill

Status: **AI-5 checkpoint implementation**  
Branch: `feature/ai-analysis-engine`  
Parent: AI-4 `42635ce583415e356df484429a03cf60e09b17fd`

## Purpose

AI-5 adds historical walk-forward verification on top of AI-4 without Workers AI, production D1 writes, model training, or automatic weight changes.

Files:

- `analysis/historical-walkforward-backtester.js`
- `tests/historical-walkforward-backtester.test.cjs`

## Two different kinds of backfill

### Truth backfill

Later observed/best-track data is used only as verification truth. It must have an explicit `truth.source`.

Suitable examples:

- versioned JMA/RSMC best track;
- another explicitly selected best-track dataset;
- official HKO warning-signal outcomes.

A best track must never be re-labelled as a historical forecast.

### Forecast backfill

True walk-forward scoring requires the actual forecast/advisory that existed at that historical time, including its issue/availability timestamp.

A retrospective best track or annual post-event report cannot reconstruct what HKO/CMA/JMA/CWA forecast at that time.

Forecast backfill is valid where Storm Track D1 already captured an advisory, or another auditable archive preserves the original forecast payload and provenance. Otherwise the storm remains `truth-only` and is excluded from agency-skill scoring.

## Capability states

```text
full-walk-forward
partial-walk-forward
truth-only
forecast-only
unavailable
```

Only full/partial walk-forward datasets are eligible for agency forecast-skill metrics, and only non-leaking prediction cases are verified.

## Leakage guard

Each prediction case has an historical `asOf` cutoff.

Allowed:

- forecast valid times after `asOf`;
- future positions contained in the forecast issued by that cutoff.

Rejected in strict mode:

- source bulletin/base/availability time after `asOf`;
- AI-1 snapshot generated after `asOf`;
- AI-2/AI-3 artifact timestamp after `asOf`;
- HKO warning context issued after `asOf`.

A future forecast valid time is normal prediction content. A future-issued advisory is leakage.

## Output

`historical-walkforward-backtest/v1` aggregates AI-4 verification into:

- case counts: verified / rejected-leakage / verification-error;
- HKO/CMA/JMA/CWA track, intensity and pressure errors;
- per-lead-time skill buckets;
- app-consensus common-valid-time track error;
- consensus closest-distance and closest-time errors.

Default lead buckets:

```text
0-12h
12-24h
24-48h
48-72h
72-120h
120h+
```

Each metric keeps count, signed mean, MAE, RMSE and maximum absolute error so AI-6 can enforce minimum sample sizes.

## Safety semantics

```text
walkForward = true
truthSourceExplicit = true
truthUsedOnlyForVerification = true
futureForecastValidTimesAllowed = true
bestTrackMustNotBeUsedAsHistoricalForecast = true
adaptiveWeightsUpdated = false
modelTrainingPerformed = false
aiGenerated = false
```

## Validation

```bash
node tests/historical-walkforward-backtester.test.cjs
```

Tests cover future-valid-time allowance, future-source/HKO-context leakage rejection, backfill capability classification, agency/lead-bucket aggregation, strict leakage isolation, explicit truth source, and absence of adaptive training.

## Next checkpoint

AI-6 should build versioned agency skill profiles and candidate adaptive weights from AI-5 output. Promotion must require minimum sample sizes, bounded changes, holdout/backtest improvement, and champion/challenger safeguards. Production weights must not change automatically.
