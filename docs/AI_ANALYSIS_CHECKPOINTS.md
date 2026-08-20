# Storm Track AI analysis development

Status: **AI-4 checkpoint implementation**  
Baseline: `b03d16149a33928a49790b0d8308dd31e40b1ed4`  
Feature branch: `feature/ai-analysis-engine`

## Safety boundary

AI development must not deploy or reconstruct the existing production Worker from historical `worker.js` source. The production Worker remains independently deployed until its authoritative source is recovered/rebuilt and verified.

AI-1 through AI-4 are repository-only deterministic analysis/verification work. They do not call Workers AI, do not predict HKO warning signals, do not write production D1/R2, and do not change the live/cache/map lifecycle.

## Checkpoint chain

```text
AI-1  StormAnalysisSnapshot
  ↓
AI-2  Hong Kong Impact Engine
  ↓
AI-3  HKO Signal Risk Inputs
  ↓
AI-4  Forecast Verification Engine
```

Each checkpoint is intended to remain independently rollbackable.

## AI-1 — StormAnalysisSnapshot core

Module: `analysis/storm-analysis-core.js`

Responsibilities:

- preserve HKO/CMA/JMA/CWA as independent sources;
- normalize existing analysis/forecast tracks without mutating source objects;
- use the standalone Hong Kong reference point (`22.3023, 114.1746`);
- expose per-agency state and nearest forecast approach;
- compare agencies at one common valid time;
- interpolate only inside available forecast ranges;
- calculate an unweighted app consensus and maximum spread;
- mark app consensus as non-official and `aiGenerated: false`.

## AI-2 — Hong Kong Impact Engine

Module: `analysis/hk-impact-engine.js`

Responsibilities:

- continuous closest approach along interpolated forecast segments;
- 800/500/400/300/200/100 km crossing windows;
- detect crossing even when both segment endpoints remain outside a distance band;
- approach/departure trend;
- fixed-step application consensus track;
- closest-distance/time spread and `heuristic-v1` uncertainty;
- dateline-safe interpolation;
- no warning-signal prediction.

Output: `hk-impact/v1`.

## AI-3 — HKO Signal Risk Input Engine

Module: `analysis/hko-signal-risk-inputs.js`

Responsibilities:

- normalize wind to m/s and movement speed to km/h;
- retain official movement fields separately from app-derived movement geometry;
- calculate storm bearing/sector relative to Hong Kong;
- map Hong Kong to storm-centred NE/SE/SW/NW wind-radius quadrants;
- record geometric wind-radius coverage evidence;
- summarize closest approach, intensity/spread, lead time and uncertainty;
- attach official HKO warning context only when explicitly supplied by a trusted caller;
- expose a flat feature vector for later verification/calibration.

Output: `hko-signal-risk-inputs/v1`.

Wind-radius coverage is geometric evidence only and is never treated as an HKO warning decision.

## AI-4 — Forecast Verification Engine

Module: `analysis/forecast-verification-engine.js`

Goal: create the first closed-loop verification layer: preserve what Storm Track knew at forecast time, then compare it with a later explicitly supplied observed track and optional official warning outcome.

### Truth-source rule

Verification must never silently decide what counts as truth. The caller must supply:

```text
truth.source
truth.track[]
```

Optional provenance:

```text
truth.datasetId
truth.advisoryId
truth.officialHkoWarningOutcome
```

If `truth.source` is missing, verification fails instead of falling back to HKO/JMA/CMA/CWA. This keeps historical scores reproducible if the project later adopts a different best-track dataset.

### Per-agency verification

For every agency forecast point that overlaps the observed track window, AI-4 records:

- forecast valid time and lead time;
- forecast/actual latitude and longitude;
- track error in km;
- forecast/actual maximum wind when available;
- intensity error in m/s;
- forecast/actual pressure when available;
- pressure error in hPa;
- whether the actual position/intensity had to be interpolated between observations.

Per-agency summary metrics include count, mean error, MAE, RMSE and maximum absolute error.

### Consensus verification

The app-computed common-valid-time consensus can be scored against the same truth track. It remains explicitly labelled `appComputed: true`.

### Hong Kong closest-approach verification

When AI-2 output is supplied, AI-4 calculates the actual continuous closest approach to the configured Hong Kong reference point and records:

- predicted vs actual closest distance;
- signed and absolute distance error;
- predicted vs actual closest time;
- signed and absolute time error;
- per-agency closest-approach errors when available.

### Official warning outcome

An HKO warning outcome is stored only if supplied by the caller. AI-4 does not infer it from wind, distance, wind radii or the Storm Track feature vector.

This makes the official outcome usable as a future supervised/calibration label without contaminating it with the model's own prediction.

### Verification contract v1

```text
ForecastVerification
  schemaVersion = forecast-verification/v1
  verifiedAt
  prediction
    snapshotVersion
    generatedAt
    impactVersion
    signalInputVersion
    storm
  truth
    source
    datasetId
    advisoryId
    pointCount
    firstTime
    lastTime
    actualClosestApproach
    officialHkoWarningOutcome
  agencies
    HKO / CMA / JMA / CWA
      state
      points[]
      summary
  consensusAtCommonValidTime
  hongKongImpact
    consensusClosestApproach
    agencyClosestApproaches
  calibrationRecord
  semantics
```

AI-4 explicitly states:

```text
deterministic = true
truthSourceExplicit = true
truthSourceInferred = false
adaptiveWeightsUpdated = false
modelTrainingPerformed = false
hkoWarningOutcomeInferred = false
aiGenerated = false
```

AI-4 produces calibration-ready records but does **not** update agency weights or promote a model version.

## Validation

Run:

```bash
node tests/storm-analysis-core.test.cjs
node tests/hk-impact-engine.test.cjs
node tests/hko-signal-risk-inputs.test.cjs
node tests/forecast-verification-engine.test.cjs
```

AI-4 tests cover:

1. explicit truth-source requirement;
2. forecast-to-observation track error;
3. interpolation of truth positions/intensity inside the observed time range;
4. per-agency MAE/RMSE summaries;
5. application-consensus verification;
6. Hong Kong closest-distance and closest-time error;
7. optional official HKO warning outcome remaining explicit and non-inferred;
8. dateline-safe observed-track interpolation;
9. explicit exclusion of adaptive weight updates, model training and AI generation.

## Next checkpoint

AI-5 should build a historical walk-forward backtester on top of AI-4. It should replay archived advisories using only information available at each historical issue time, generate AI-1/AI-2/AI-3 prediction snapshots, verify them after the valid time with AI-4, and aggregate skill by agency and forecast horizon. It must include leakage guards before any adaptive weighting is introduced.
