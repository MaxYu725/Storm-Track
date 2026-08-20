# Storm Track AI analysis development

Status: **AI-1 checkpoint implementation**  
Baseline: `b03d16149a33928a49790b0d8308dd31e40b1ed4`  
Feature branch: `feature/ai-analysis-engine`

## Safety boundary

AI development must not deploy or reconstruct the existing production Worker from historical `worker.js` source. The production Worker remains independently deployed until its authoritative source is recovered/rebuilt and verified.

AI-1 is frontend/repository-only and does not call Workers AI.

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

## Validation

Run with Node.js:

```bash
node tests/storm-analysis-core.test.cjs
```

AI-1 tests cover:

1. Hong Kong distance calculation baseline;
2. common-valid-time multi-agency comparison;
3. interpolation only inside available forecast range;
4. agency failure/missing-source isolation;
5. nearest-approach extraction;
6. explicit `aiGenerated: false` semantics.

## Next checkpoint

AI-2 should consume the snapshot and add a deterministic Hong Kong impact engine:

- distance-band crossing windows;
- closest-approach time/range across agencies;
- approach/departure trend;
- consensus/spread uncertainty classification;
- no HKO signal prediction yet.
