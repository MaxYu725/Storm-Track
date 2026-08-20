# Storm Track AI analysis development

Status: **AI-2 checkpoint implementation**  
Baseline: `b03d16149a33928a49790b0d8308dd31e40b1ed4`  
Feature branch: `feature/ai-analysis-engine`

## Safety boundary

AI development must not deploy or reconstruct the existing production Worker from historical `worker.js` source. The production Worker remains independently deployed until its authoritative source is recovered/rebuilt and verified.

AI-1 and AI-2 are repository-only deterministic analysis work. They do not call Workers AI, do not predict HKO warning signals and do not change live/cache/map lifecycle.

## AI-1 — StormAnalysisSnapshot core

Goal: create a deterministic, testable snapshot that future impact, verification, calibration and Workers AI layers can consume without reading Leaflet/DOM state.

Added module:

- `analysis/storm-analysis-core.js`

Current responsibilities:

- preserve HKO/CMA/JMA/CWA as independent sources;
- normalize existing `positions` and `forecast` arrays without mutating source objects;
- use the same Hong Kong reference point as the standalone app (`22.3023, 114.1746`);
- expose per-agency latest state and nearest forecast approach to Hong Kong;
- select one common valid time for multi-agency comparison;
- interpolate a source only between official forecast points when the common valid time falls inside that source forecast range;
- calculate an unweighted application consensus and maximum agency spread;
- explicitly mark consensus as application-computed and AI output as disabled.

The module intentionally does **not**:

- predict HKO warning signals;
- infer landfall;
- assign adaptive agency weights;
- call an LLM;
- modify existing live/cache/map lifecycle;
- fall back from a failed agency to another agency.

## Snapshot contract v1

Top-level shape:

```text
StormAnalysisSnapshot
  schemaVersion
  generatedAt
  storm
  referencePoint
  coverage
  sources
    HKO
    CMA
    JMA
    CWA
  comparison
    leadHours
    referenceAgency
    referenceBaseTime
    targetValidTime
    entries[]
    consensus
    spread
  semantics
```

`comparison.consensus` is never an official agency forecast. It is explicitly marked `appComputed: true`.

## AI-2 — Hong Kong Impact Engine

Goal: consume `StormAnalysisSnapshot` and derive Hong Kong proximity/timing facts without an LLM or warning-signal inference.

Added module:

- `analysis/hk-impact-engine.js`

Responsibilities:

- build one time-ordered track per usable agency from the latest analysis point plus forecast points;
- calculate a continuous closest approach along linearly interpolated forecast segments rather than only checking official point timestamps;
- calculate entry/exit intervals for configurable distance bands, defaulting to 800/500/400/300/200/100 km;
- detect an enter-and-exit pass even when both endpoints of a long forecast segment are outside a distance band;
- preserve dateline-safe longitude interpolation and circular longitude averaging for app consensus;
- calculate per-agency 6-hour approach/departure trend using a configurable distance-change threshold;
- build an unweighted fixed-step application consensus track when at least two agencies overlap in time;
- expose agency closest-distance range and closest-time window;
- classify multi-agency uncertainty with an explicit `heuristic-v1` method using agency count, common-time spread, closest-distance spread and closest-time spread;
- keep missing/failed agencies independent instead of silently substituting another source.

AI-2 output explicitly states:

```text
deterministic = true
officialAgencyDataRemainSeparate = true
consensusIsAppComputed = true
crossingTimesAreInterpolated = true
hkoSignalPredictionIncluded = false
warningGuidanceIncluded = false
aiGenerated = false
```

Distance-band crossing times are mathematical interpolation of agency forecast tracks. They are not additional official agency forecast points and are not an HKO warning forecast.

### Impact contract v1

```text
HongKongImpact
  schemaVersion = hk-impact/v1
  sourceSnapshotVersion
  generatedAt
  storm
  referencePoint
  agencyClosestApproaches[]
  closestApproach
    distanceRangeKm
    agencyTimeWindow
    consensus
  trend
    aggregate
    counts
    agencies
  distanceBands
    800 / 500 / 400 / 300 / 200 / 100
      agencies[]
      agenciesEntering[]
      alreadyInsideAgencies[]
      entryWindow
      exitWindow
  proximity
  uncertainty
  consensusTrack
  semantics
```

## Validation

Run with Node.js:

```bash
node tests/storm-analysis-core.test.cjs
node tests/hk-impact-engine.test.cjs
```

AI-1 tests cover:

1. Hong Kong distance calculation baseline;
2. common-valid-time multi-agency comparison;
3. interpolation only inside available forecast range;
4. agency failure/missing-source isolation;
5. nearest-approach extraction;
6. explicit `aiGenerated: false` semantics.

AI-2 tests cover:

1. closest approach occurring between official forecast points;
2. distance-band entry and exit interpolation;
3. a single long segment entering and exiting a band while both endpoints remain outside;
4. dateline-safe interpolation;
5. multi-agency closest range and app consensus closest approach;
6. approaching/departing trend classification;
7. low uncertainty only when spread/time/distance conditions are satisfied;
8. insufficient uncertainty state and no synthetic consensus when only one agency is usable;
9. explicit exclusion of HKO warning-signal prediction and AI generation.

## Next checkpoint

AI-3 should build the deterministic HKO impact/signal-risk input layer without asking an LLM to decide a warning signal. It should first model the measurable ingredients required for later risk calibration, including forecast wind fields when available, storm intensity, closest approach, approach quadrant/direction, forecast spread and official HKO warning context. Any eventual signal result must remain a Storm Track risk estimate and must never be represented as an HKO decision.
