# AI-9 — Deterministic Analysis Orchestration / Model Read Layer

Status: **AI-9 checkpoint implementation**  
Branch: `feature/ai-analysis-engine`  
Parent: AI-8 `cbd1f7c0113b88ec4c86bbc3386a8ec7672e87dd`

## Purpose

AI-9 connects the existing deterministic AI-1, AI-2 and AI-3 engines to the independent `storm-analysis` Worker and adds a read-only Champion model/version layer backed by `ANALYSIS_DB`.

It does not call Workers AI, promote models, write model rows, change the production Storm Worker, or deploy anything.

## Reuse existing deterministic engines

`src/deterministic-engines.js` side-effect imports the existing repository modules:

- `analysis/storm-analysis-core.js`
- `analysis/hk-impact-engine.js`
- `analysis/hko-signal-risk-inputs.js`

The bridge exposes their immutable APIs to the Worker. AI-9 deliberately does not fork or duplicate these meteorological calculations.

## Champion model repository

`src/model-repository.js` reads `model_versions` with prepared D1 statements only.

Read operations:

- latest `role = champion` model;
- one explicit `model_version`.

If the database contains no Champion row, the repository returns the explicit non-persisted fallback:

```text
builtin-equal-v1
HKO 25%
CMA 25%
JMA 25%
CWA 25%
```

A missing row is different from a missing/broken database. If `ANALYSIS_DB` is unavailable, Worker routes return 503 instead of silently pretending the database exists.

Model weights normalize to `storm-analysis-model-weights/v1` and support the AI-6 lead buckets:

```text
0-12h
12-24h
24-48h
48-72h
72-120h
120h+
```

AI-9 never writes or promotes a model.

## Orchestration v1

`storm-analysis-orchestration/v1` runs, in order:

```text
normalized sourceGroup
       ↓
AI-1 StormAnalysisSnapshot
       ↓
AI-2 HongKongImpact
       ↓
AI-3 HkoSignalRiskInputs
       ↓
read Champion model
       ↓
Champion-weighted common-valid-time comparison
```

The AI-2 unweighted consensus and all official agency data remain intact. AI-9 adds a separate app-computed weighted comparison rather than rewriting official or earlier deterministic output.

For a lead-time bucket, weights are re-normalized over only the agencies that actually have a common-valid-time entry. Longitude averaging is circular so tracks around +180/-180 degrees do not average incorrectly through 0 degrees.

## API additions

### `GET /api/models/champion`

Returns the selected Champion model or `builtin-equal-v1`. Read-only.

### `GET /api/models/:modelVersion`

Returns one versioned model. Read-only. Unknown versions return 404.

### `POST /api/analysis/run`

Accepts an existing normalized Storm Track `sourceGroup` plus optional deterministic engine options. It does not accept arbitrary upstream URLs or prompts.

Output includes:

```text
model
  modelVersion
  role
  persisted
  bucketId

deterministic
  snapshot
  impact
  signalInputs
  weightedComparison
```

## Safety semantics

```text
deterministic = true
officialAgencyDataRemainSeparate = true
weightedComparisonIsAppComputed = true
unweightedAnalysisPreserved = true
championModelReadOnly = true
modelPromotionPerformed = false
warningSignalPredictionIncluded = false
aiGenerated = false
```

The weighted comparison is a Storm Track derived product. It is not an HKO/CMA/JMA/CWA forecast and does not infer an HKO warning signal.

## Validation

```bash
node --check workers/storm-analysis/src/deterministic-engines.js
node --check workers/storm-analysis/src/model-repository.js
node --check workers/storm-analysis/src/analysis-orchestrator.js
node --check workers/storm-analysis/src/index.js
node tests/storm-analysis-worker.test.mjs
node tests/storm-analysis-orchestrator.test.mjs
```

AI-9 tests cover Champion fallback, persisted model parsing, lead-bucket selection, available-agency weight normalization, dateline-safe weighted longitude, deterministic engine order, model read routes and the analysis route.

## Still not done

- no remote D1 creation/migration;
- no Worker deployment;
- no model promotion endpoint;
- no automatic adaptive-weight activation;
- no Workers AI narrative;
- no mutation of the existing production Storm Worker or PWA.

## Next checkpoint

AI-10 should add a versioned weighted-consensus track/impact layer and advisory fingerprint/caching contract so repeated analysis requests can be deduplicated before the later Workers AI narrative layer is introduced.
