# Storm Track AI analysis development

Status: **AI-3 checkpoint implementation**  
Baseline: `b03d16149a33928a49790b0d8308dd31e40b1ed4`  
Feature branch: `feature/ai-analysis-engine`

## Safety boundary

AI development must not deploy or reconstruct the existing production Worker from historical `worker.js` source. The production Worker remains independently deployed until its authoritative source is recovered/rebuilt and verified.

AI-1 through AI-3 are repository-only deterministic analysis work. They do not call Workers AI, do not predict HKO warning signals and do not change live/cache/map lifecycle.

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

## AI-3 — HKO Signal Risk Input Engine

Goal: assemble the measurable, versioned inputs needed for later Hong Kong warning-risk calibration without emitting a warning-signal prediction or risk score.

Added module:

- `analysis/hko-signal-risk-inputs.js`

The module combines three repository-domain inputs:

1. `StormAnalysisSnapshot` for source state, common-time spread and provenance;
2. `HongKongImpact` for closest approach, trend and uncertainty;
3. the existing normalized source group for meteorological fields that AI-1 intentionally did not copy, such as `maximumWind`, `pressure`, `movingSpeed`, `movingDirection` and `windRadii`.

It does not read Leaflet state or raw upstream response formats.

Responsibilities:

- preserve agency independence and never substitute a missing agency with another source;
- normalize numeric wind values to m/s when the adapter value is numeric or carries m/s, km/h or knot units;
- normalize movement speed to km/h when explicit agency motion is available;
- derive a separate app-computed motion vector from track geometry when enough timed points exist;
- calculate storm bearing/sector relative to Hong Kong;
- map Hong Kong into the storm-centred NE/SE/SW/NW quadrant for available wind radii;
- evaluate whether a supplied quadrant wind radius geometrically reaches Hong Kong at that radius timestamp;
- summarize current and closest-time intensity ranges without converting them into a warning decision;
- preserve closest-approach lead time, agency time spread, route spread and impact uncertainty;
- attach official HKO warning context only when it is explicitly supplied by a trusted caller; it is never inferred from storm geometry;
- expose a flat `featureVector` suitable for later D1 verification/calibration records.

The wind-radius coverage calculation is geometric evidence only. A radius covering Hong Kong does not by itself mean an HKO signal should be issued. Local wind, terrain, storm structure and HKO operational judgement remain separate.

### Signal-risk input contract v1

```text
HkoSignalRiskInputs
  schemaVersion = hko-signal-risk-inputs/v1
  sourceSnapshotVersion
  sourceImpactVersion
  generatedAt
  storm
  referencePoint
  coverage
  proximity
  motion
  intensity
  windField
  disagreement
  officialHkoWarningContext
  agencies
    HKO / CMA / JMA / CWA
      current
      derivedMotion
      closestApproach
      windField
      provenance
  featureVector
  semantics
```

AI-3 output explicitly states:

```text
deterministic = true
officialAgencyDataRemainSeparate = true
agencySubstitutionUsed = false
geometryIsAppComputed = true
warningSignalPredictionIncluded = false
warningRiskScoreIncluded = false
hkoDecisionInferred = false
officialHkoWarningContextInferred = false
aiGenerated = false
```

## Validation

Run with Node.js:

```bash
node tests/storm-analysis-core.test.cjs
node tests/hk-impact-engine.test.cjs
node tests/hko-signal-risk-inputs.test.cjs
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

AI-3 tests cover:

1. m/s, km/h and knot wind-unit normalization;
2. storm sector and Hong Kong quadrant geometry;
3. wind-radius coverage evidence at latest and closest-time radius points;
4. derived motion speed/direction kept separate from official motion;
5. closest-approach lead time and flat feature-vector generation;
6. multi-agency intensity normalization and spread;
7. official HKO warning context remaining absent unless explicitly supplied;
8. supplied official context remaining context only, with no warning prediction;
9. missing-agency metrics remaining missing with no cross-agency substitution.

## Next checkpoint

AI-4 should start the forecast-verification layer. It should persist a forecast-time feature snapshot and later match it against observed storm position/intensity and official warning outcomes, producing versioned error/calibration records. It should not automatically promote new weights or warning-risk rules until historical backtesting and minimum-sample safeguards exist.
