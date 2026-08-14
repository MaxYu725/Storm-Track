# Storm Track → Weather Metro integration contract

Status: **Checkpoint 5 integration specification**  
Storm Track verified baseline: `0f708cd9c84be2854486904b2f731c3721c251cd`  
Weather Metro verified baseline: `32fc4dd08344b1eb3c59e84c4423bc7ee476d557`

This document defines how Storm Track should be integrated into `MaxYu725/Weather_Metro_App` without merging the Storm backend into the Weather backend or recreating the current standalone app inside the host by copy-paste.

## 1. Integration decision

Weather Metro remains the **host application**. Storm Track becomes a **tool module** inside the existing `tools` top-level Pivot.

The existing Weather Metro top-level pages remain:

- `current`
- `forecast`
- `tools`
- `settings`

Do **not** add a permanent fifth top-level `storm` page. The current `ToolsScreen` is the replacement point for the external HKO tool cards. The target Tools experience should become an in-app tool hub containing, at minimum, Rain Track and Storm Track.

Storm Track keeps its independent Cloudflare backend:

```text
Weather Metro Android host
        │
        ├── Rain Track module ─────── Rain Track backend
        │
        └── Storm Track module ───── Storm Worker
                                      https://storm.max-yu.workers.dev
                                      ├── live source proxy/API
                                      └── D1 history API
```

### Non-goals

Checkpoint 5 does not:

- merge repositories;
- move the Storm Worker into `Weather_Metro_App/backend`;
- reconstruct the production Worker from old Git history;
- add new agencies;
- rewrite the map UI;
- change D1/R2/Cron/schema;
- replace HKO/CMA/JMA/CWA source semantics with one synthetic official forecast.

## 2. Verified host constraints

At the Weather Metro baseline above:

- the UI is native Jetpack Compose;
- navigation is an infinite `HorizontalPager` over `PageColourSlot.entries`;
- the existing `TOOLS` page renders `ToolsScreen(pageColour)`;
- `ToolsScreen` currently opens four official HKO web tools with external `ACTION_VIEW` intents;
- the host uses a single `WeatherLoadState` for normal weather pages;
- `MainActivity` owns permission handling and immersive-mode restoration;
- the architecture explicitly states that no app WebView or JavaScript bridge remains.

Therefore, a WebView is **not the default integration assumption**. Reintroducing one would be an explicit architecture/security decision and must be isolated to the Storm/Rain module surface.

## 3. Verified Storm Track boundaries

The standalone frontend currently owns all of the following in one `index.html`:

- HKO/CMA/JMA/CWA live fetch adapters;
- normalization and rendering;
- Leaflet map lifecycle;
- source health state;
- IndexedDB/localStorage caches;
- live/archive mode switching;
- Archive list/advisory loading and playback;
- standalone PWA install/update behavior.

The production Worker is deployed independently. Its current source is **not authoritative in this repository**. Never deploy the removed historical `worker.js` over production.

Canonical origin:

```text
https://storm.max-yu.workers.dev
```

The standalone frontend currently centralizes this as `WORKER_ORIGIN`; the integrated module must keep one equivalent source of truth rather than scattering the hostname through UI code.

## 4. Backend contract

### 4.1 Live transport used by the current standalone frontend

The current frontend reaches live sources through the Storm Worker:

```text
GET /?url=<allowed-HKO-CMA-JMA-upstream-url>
GET /api/cwa
```

The host UI should not construct arbitrary proxy URLs itself. Live transport belongs behind `StormService`.

### 4.2 History API used by Archive

Required for the current Archive feature set:

```text
GET /api/history/storms?limit=100
GET /api/history/storms/:stormId
GET /api/history/storms/:stormId/advisories?limit=200
GET /api/history/advisories/:advisoryId
```

The production backend also exposes collector/diagnostic history such as:

```text
GET /api/history/latest?agency=JMA
```

This endpoint is useful for diagnostics but is not required to render the current Archive UI.

### 4.3 Health/probe endpoints

Useful for diagnostics and release checks:

```text
GET /health
GET /probe/cma
GET /probe/jma
GET /probe/cwa
GET /probe/database
GET /probe/identity
```

Protected admin routes such as collection or identity repair are **not application-runtime APIs** and must never be called from the Android client.

### 4.4 Secrets

The Android app must never contain:

- `CWA_AUTHORIZATION`;
- `ADMIN_TOKEN`;
- D1 credentials;
- R2 credentials.

Those remain Worker-side secrets/bindings.

## 5. Required service boundary

Before Weather Metro consumes Storm Track directly, live/history fetch logic should be callable without DOM or Leaflet dependencies.

Target logical interface:

```text
StormService
  loadLive(force = false)
  loadHistory(query)
  loadStorm(stormId)
  loadAdvisories(stormId, query)
  loadAdvisory(advisoryId)
  probeHealth()
```

`loadLive()` should preserve **per-agency independence**. A CMA failure must not block HKO/JMA/CWA, and vice versa.

Suggested normalized result shape:

```text
StormLiveResult
  agencies: Map<Agency, AgencyLiveResult>
  storms: List<StormTrack>
  fetchedAt

AgencyLiveResult
  agency: HKO | CMA | JMA | CWA
  state: loading | ok | empty | stale | error
  message
  updatedAt
  storms

StormTrack
  stableKey
  agency
  agencyStormId
  internationalNumber?
  nameEn?
  nameZh?
  analysisPoints
  forecastPoints
  windRadii?
  probabilityGeometry?

StormPoint
  time
  latitude
  longitude
  pointType: analysis | forecast
  intensity?
  windSpeed?
  pressure?
  forecastHour?
```

Archive domain models should preserve the backend identifiers instead of deriving new IDs in UI code:

```text
ArchiveStorm
  id
  year
  internationalNumber?
  nameEn?
  nameZh?
  status
  firstSeenAt?
  lastSeenAt?
  advisoryCount

ArchiveAdvisorySummary
  id
  stormId
  agency
  issuedAt
  pointCount
  parserVersion?
```

Exact backend JSON remains backend-owned; these are integration-level normalized models.

## 6. Cancellation and request ownership

The standalone app currently uses request serials and `AbortController` for some history requests. The integrated service must make cancellation a first-class contract.

Rules:

- leaving the Storm module cancels in-flight UI-owned requests;
- selecting another archived storm cancels or invalidates the old selection request;
- selecting another advisory invalidates the old frame request;
- a refresh must not let an older response overwrite a newer result;
- hidden tools must not continue polling or replay timers;
- request timeout remains explicit; current standalone History timeout is 16 seconds.

For native Kotlin, use structured coroutine cancellation. For a web adapter, retain `AbortController` and serial guards.

## 7. UI lifecycle contract

Storm Track must no longer assume `DOMContentLoaded` means "the module is permanently visible".

A reusable surface needs the following conceptual lifecycle:

```text
mount(host)
resize()
resume()
pause()
destroy()
```

Required behavior:

### `mount(host)`

- create UI/map exactly once for that mounted instance;
- bind listeners exactly once;
- load cached state first when available;
- start live refresh only after the surface is mounted.

### `resize()`

- notify the map after host size, orientation, inset, or pager changes;
- Leaflet implementation must call `invalidateSize()`;
- do not create another map to fix sizing.

### `resume()`

- mark the module visible;
- resize the map;
- if backgrounded for at least five minutes, refresh the active mode;
- do not automatically restart Archive autoplay unless that behavior is explicitly selected later.

### `pause()`

- stop Archive autoplay;
- stop module-owned intervals/timeouts that are not required off-screen;
- cancel disposable fetches;
- retain user state needed for quick return.

### `destroy()`

- abort requests;
- clear timers;
- remove listeners;
- release map/layers;
- clear references to the host container;
- make a later `mount()` safe.

## 8. Android host integration

### 8.1 Navigation

Keep `PageColourSlot.TOOLS` as the top-level page.

Recommended Tools internal state:

```text
ToolsHome
  ├── Rain Track
  └── Storm Track

Storm Track
  ├── Live
  └── Archive
```

Opening Storm Track should remain inside the app rather than launching the current HKO tropical-cyclone web page.

Back behavior:

1. Storm Archive detail → Storm Archive list;
2. Storm Track surface → ToolsHome;
3. ToolsHome → normal system/back behavior.

Do not add a second infinite pager inside the map surface. Use a compact internal mode switch for Live/Archive.

### 8.2 Host lifecycle mapping

Native host events should map to module behavior approximately as follows:

| Host event | Storm action |
| --- | --- |
| Tools → Storm | mount/resume + resize |
| Storm → ToolsHome | pause |
| Pager leaves `TOOLS` | pause |
| Pager returns to `TOOLS` with Storm active | resume + resize |
| Activity/background stop | pause |
| Activity foreground | resume; refresh only if stale threshold reached |
| Configuration/size change | resize |
| Surface removed permanently | destroy |

Weather Metro currently keeps adjacent pager pages alive with `beyondViewportPageCount = 1`; visibility must therefore be driven by the selected page, not merely by Composable existence.

## 9. Preferred rendering strategy

### Final-state preference: native host + shared Storm data contract

The preferred long-term design is:

- Weather Metro stays Compose-first;
- Storm data/network/domain logic is separated from the standalone DOM;
- the Android surface renders normalized Storm models natively;
- the Storm Worker stays independent;
- standalone Storm Track remains a supported PWA using the same backend contract.

This best preserves the current Weather Metro architecture and removes duplicated browser/PWA lifecycle inside Android.

### Transitional web-surface option

If reuse of the existing Leaflet UI is necessary before a native map is ready, an isolated web surface may be used only as an explicit temporary architecture exception.

Minimum conditions:

- one isolated WebView owned only by the Storm tool surface;
- no `addJavascriptInterface` bridge;
- HTTPS-only navigation and allow-listed Storm assets/origins;
- external navigation blocked or handed to Android deliberately;
- standalone install/fullscreen/service-worker controls disabled in embedded mode;
- one map instance per mounted surface;
- host-to-page lifecycle limited to narrowly scoped calls such as `resume/pause/resize/destroy`;
- WebView resources destroyed when the module is permanently removed;
- security/architecture documentation updated in Weather Metro before release.

Do not silently reintroduce a general-purpose WebView because the current Weather Metro security boundary explicitly removed it.

## 10. PWA and Service Worker boundary

`sw.js` belongs to the standalone Storm Track deployment.

When Storm Track is native inside Weather Metro:

- do not register the Storm service worker;
- do not show the Storm PWA install button;
- do not show Storm standalone fullscreen controls;
- Android owns offline lifecycle, process lifecycle and app updates.

The standalone PWA continues to use its own service worker and cache rollover independently.

## 11. Cache ownership

Current standalone browser cache:

```text
IndexedDB: storm-track-v3.2
  agency-cache
  history-cache

localStorage fallback:
  hko-cma-jma-cwa-storm-track-cache-v3.3-*
```

Do not make the Android host depend on browser IndexedDB keys.

Native integration should give Storm its own app-storage cache namespace behind `StormService`, with these semantics preserved:

- last successful data may render immediately;
- stale state must stay visible to the user;
- a failed refresh must not erase good cached data;
- live cache and Archive cache remain distinguishable;
- clearing Weather Metro cache should also clear native Storm cache after integration.

If a transitional WebView is used, its browser storage remains temporary module-owned state and must not become the long-term Weather Metro data store.

## 12. Map ownership rules

These rules are mandatory because map lifecycle errors are one of the highest integration risks.

- Never call `L.map()` twice on the same container.
- Never create a second map just because a hidden pager page returned.
- Always resize/invalidate after the Storm surface becomes visible.
- Keep layer groups reusable rather than recreating the whole map.
- Stop Archive timers when hidden.
- Remove listeners and map resources on final destroy.
- A source refresh changes data/layers, not map ownership.
- User pan/zoom must not be overridden by late-arriving agency responses.

## 13. Source truth and agency semantics

HKO, CMA, JMA and CWA remain independent official sources.

The module may calculate comparison products such as:

- consensus center;
- maximum spread;
- distance from Hong Kong;
- matching forecast hour.

These are application-derived comparisons, not a new official forecast.

UI must continue to distinguish:

- observed/analysis points;
- forecast points;
- agency identity;
- stale/cache state;
- missing agency data.

A failed source must never be replaced silently by another agency.

## 14. Failure states

Minimum user-visible states:

```text
loading
partial success
all sources empty
stale cache
source error
history loading
history empty
history error
```

A partial live result is a valid state. The screen should remain usable if one or more agencies fail.

The host should not convert a Storm-source failure into the Weather Metro global `WeatherLoadState.Error`; Storm tool state is module-scoped and must not blank `current` or `forecast` pages.

## 15. Diagnostics and logging

Integration builds should make it possible to distinguish:

- host lifecycle issue;
- module rendering issue;
- Worker connectivity issue;
- individual source failure;
- D1/history failure;
- stale local cache.

Do not log location-derived personal data, Worker secrets, raw auth headers, or admin tokens.

## 16. Rain Track coexistence

Rain Track and Storm Track should share only host-level patterns where useful:

- ToolsHome navigation;
- lifecycle conventions;
- page colour/theme plumbing;
- connectivity/status presentation;
- cache-clear integration.

They should not be forced into one data schema. Radar/nowcast frame logic and tropical-cyclone track/advisory logic are different domains.

## 17. Recommended implementation sequence

### Phase A — extract Storm contracts

In `Storm-Track`:

1. keep one `WORKER_ORIGIN`;
2. isolate live/history fetch and normalization from DOM rendering;
3. make requests cancellable;
4. remove embedded assumptions from the core service;
5. preserve standalone PWA behavior through an adapter.

### Phase B — Weather Tools host shell

In `Weather_Metro_App`:

1. replace external Tools list with `ToolsHome`;
2. add internal Rain Track and Storm Track destinations;
3. retain the existing four top-level pivots;
4. add correct back behavior and page-colour integration;
5. do not integrate map/data yet.

### Phase C — Storm live data integration

1. implement the host-side `StormService` adapter;
2. render source health and live normalized tracks;
3. validate HKO/CMA/JMA/CWA partial-failure behavior;
4. implement map lifecycle and size recovery;
5. keep the standalone Storm Track working.

### Phase D — Archive integration

1. add storm list/year/search filters;
2. add agency filtering;
3. add advisory frame loading;
4. add slider and playback speed;
5. pause playback whenever hidden/backgrounded.

### Phase E — cleanup and cutover

1. remove the old external HKO cyclone tool card after the integrated module passes regression;
2. retain an external official-source fallback link in diagnostics/help if desired;
3. verify cache clearing, offline/stale behavior and activity recreation;
4. final mobile/PWA/Android regression.

## 18. Acceptance criteria before cutover

The Storm module is ready to replace the current external cyclone tool only when all of the following are true:

- Weather Metro still has four top-level pivots;
- `current`, `forecast` and `settings` regressions pass;
- entering/leaving Storm repeatedly creates no duplicate map or listener;
- rotation/resize/background/foreground recover correctly;
- hidden Storm surface stops Archive playback and unnecessary work;
- returning after at least five minutes refreshes the active Storm mode;
- HKO/CMA/JMA/CWA partial failure is handled independently;
- stale cached data is labelled rather than presented as fresh;
- Archive storm/advisory loading works through the production Worker;
- no Worker secret exists in the Android app;
- no admin endpoint is callable from normal UI;
- production Storm Worker remains independently deployable;
- standalone Storm Track remains functional;
- rollback to the previous ToolsScreen is possible without backend migration.

## 19. Release/rollback rule

Integration must be feature-branch/PR based. Do not delete the standalone Storm Track or change the Worker deployment during initial Weather Metro integration.

Rollback should require only reverting the Weather Metro UI/module change. It must not require restoring D1 data, changing Worker schema, or redeploying an old Worker.

## 20. Open implementation gates

Before Phase C coding starts, explicitly choose the Android map/rendering path:

1. **preferred:** native Compose-compatible rendering over normalized Storm models; or
2. **transitional:** tightly isolated WebView/Leaflet reuse under the restrictions above.

This is the main architecture decision intentionally left open by this contract. Everything else—Worker independence, Tools ownership, service boundary, cancellation, lifecycle, cache semantics and source truth—should remain the same under either rendering path.
