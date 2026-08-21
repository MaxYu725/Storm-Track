# AI-10 — Weighted Consensus Track / Hong Kong Impact / Advisory Cache

Status: **AI-10 checkpoint implementation**  
Branch: `feature/ai-analysis-engine`  
Parent: AI-9 `c3496320cc38728923efd91afe93e02ac2e56eb1`

## Purpose

AI-10 extends the independent deterministic analysis Worker from one weighted common-valid-time point to a versioned weighted consensus track and Hong Kong impact calculation. It also adds a deterministic D1 cache keyed by advisory content, analysis options, Champion model version and orchestration version.

It does not deploy the Worker, create/migrate remote D1, change production Storm Track, call Workers AI, predict HKO warning signals, or promote a model.

## Weighted consensus track

Version: `weighted-consensus-track/v1`.

For each fixed-step valid time:

1. AI-2 source-track helpers build each agency track;
2. agencies that can be interpolated at that time are retained;
3. the Champion lead-time bucket is selected relative to the AI-1 comparison reference base time;
4. weights are re-normalized only across available agencies;
5. at least two agencies are required;
6. latitude is weighted arithmetically and longitude uses circular averaging across the dateline.

Default step is 3 hours. The track can continue after one agency's forecast ends as long as at least two agencies remain available.

Every point records the actual agencies, applied weights, lead hours, bucket ID and model version. It remains `appComputed` and never replaces official agency tracks.

## Weighted Hong Kong impact

Version: `weighted-hk-impact/v1`.

AI-10 reuses AI-2 deterministic geometry helpers to calculate from the weighted track:

- continuous closest approach to Hong Kong;
- 800/500/400/300/200/100 km inside intervals;
- first entry and last exit for each distance band.

AI-2's generic nearest helper labels source-track vertices as `official-point`; AI-10 rewrites that label to `weighted-track-point-v1` when the point belongs to the app-computed weighted track so provenance remains correct.

The existing AI-2 unweighted impact and AI-9 weighted common-valid-time comparison remain present in the output.

## Orchestration v2

`storm-analysis-orchestration/v2` returns:

```text
deterministic
  snapshot                    # AI-1
  impact                      # AI-2 unweighted
  signalInputs                # AI-3
  weightedComparison          # AI-9 single common-valid-time point
  weightedConsensusTrack      # AI-10
  weightedHongKongImpact      # AI-10
```

No LLM output is included.

## Advisory fingerprint cache

Version: `analysis-cache/v1`.

Migration: `workers/storm-analysis/schema/0002_analysis_cache.sql`.

The cache identity includes:

```text
canonical sourceGroup
+ compare/snapshot/impact/signal/weighted-track options
+ Champion model version + normalized weights fingerprint
+ orchestration version
```

`generatedAt` is intentionally excluded from the identity because changing only the request timestamp must not invalidate identical meteorological input.

SHA-256 is used for advisory/options/model/request fingerprints. Cache entries therefore naturally become unreachable when agency data, options, model version or deterministic method version changes.

`POST /api/analysis/run` now returns:

```text
analysis
cache
  status
  cacheKey
  advisoryFingerprint
  modelVersion
  createdAt
```

Common statuses:

```text
hit
miss-stored
miss-store-failed
bypass-read-error-stored
bypass-read-and-write-error
```

Cache errors are fail-open: deterministic analysis still runs if the cache table is unavailable or a cache read/write fails. This allows code rollout and migration rollout to remain decoupled.

## D1 schema

`analysis_cache` stores only deterministic analysis results and cache provenance. It does not change model roles, weights or historical truth/forecast rows.

The primary key is the deterministic cache key, with an index on advisory fingerprint + model version for later maintenance/inspection.

## Safety semantics

```text
deterministic = true
officialAgencyDataRemainSeparate = true
weightedTrackIsAppComputed = true
weightedHongKongImpactIsAppComputed = true
unweightedAnalysisPreserved = true
championModelReadOnly = true
modelPromotionPerformed = false
warningSignalPredictionIncluded = false
aiGenerated = false
```

## Validation

Run:

```bash
node --check workers/storm-analysis/src/weighted-consensus.js
node --check workers/storm-analysis/src/analysis-cache-repository.js
node --check workers/storm-analysis/src/analysis-orchestrator.js
node --check workers/storm-analysis/src/index.js
node tests/storm-analysis-orchestrator.test.mjs
node tests/storm-analysis-ai10.test.mjs
```

The AI-10 tests cover changing agency availability along the weighted track, lead-bucket reweighting, dateline-safe weighted longitude, weighted Hong Kong impact, deterministic cache identity, model-version invalidation, prepared D1 cache reads/writes, cache hit/miss behavior, fail-open cache errors, and HTTP orchestration v2 metadata.

The SQL migration is also executed against SQLite in validation before checkpointing.

## Not yet done

AI-10 does not:

- create or migrate remote `ANALYSIS_DB`;
- deploy `storm-analysis`;
- automatically fetch live agency data;
- automatically promote Champion/Challenger models;
- generate HKO signal probabilities;
- call Workers AI or generate narrative text.

## Next checkpoint

AI-11 should add the first deterministic HKO signal-risk probability model/calibration layer using AI-3 features plus historical AI-4/AI-5 outcomes. It should keep official HKO information separate, use probability calibration and minimum-sample safeguards, and avoid allowing rare No. 9/No. 10 outcomes to be learned from sparse data without rule-based constraints.
