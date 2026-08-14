# Storm Track → Weather Metro integration contract

Status: **Integration Phase 0 source contract**  
Storm Track verified baseline: `bf6bb3616d861c62f156bc8a77e67a8c404487f8`  
Weather Metro verified baseline: `32fc4dd08344b1eb3c59e84c4423bc7ee476d557`

## 1. Integration decision

`MaxYu725/Weather_Metro_App` remains the native Android host. Storm Track becomes a native tool module inside the existing `tools` Pivot, beside Rain Track.

Weather Metro currently has five top-level Pivot pages:

```text
current / hourly / forecast / tools / settings
```

Do **not** add a permanent top-level `storm` page. The current `ToolsScreen` is the replacement point for the external HKO tool cards.

Target host structure:

```text
Weather Metro
  tools
    ├── Rain
    └── Storm
         ├── Live
         └── Archive
```

Storm Track keeps its independent production backend:

```text
https://storm.max-yu.workers.dev
```

Do not merge the Storm Worker into Weather Metro during initial integration.

## 2. Repository/backend boundary

The Storm-Track repository is now the standalone frontend/reference implementation. The production Cloudflare Worker uses D1/R2/Cron and its authoritative source is not kept in this repository.

Therefore:

- never deploy an old historical `worker.js` from Git history over production;
- Weather Metro consumes only documented public runtime APIs;
- D1/R2/admin logic stays Worker-side;
- the standalone PWA remains a regression/reference client.

## 3. Production API surface

### Live source transport

The current standalone app obtains agency data through the Worker.

Conceptually:

```http
GET /?url=<allowed-HKO/CMA/JMA-upstream-url>
GET /api/cwa
```

Weather Metro UI must not construct arbitrary proxy URLs. Live transport belongs behind a single `StormService` boundary.

### History API

Required Archive endpoints:

```http
GET /api/history/storms?limit=100
GET /api/history/storms/:stormId
GET /api/history/storms/:stormId/advisories?limit=200
GET /api/history/advisories/:advisoryId
```

Diagnostic-only history may include:

```http
GET /api/history/latest?agency=JMA
```

Do not make diagnostics required for normal Archive rendering.

### Health/probes

Useful for diagnostics and release checks:

```http
GET /health
GET /probe/cma
GET /probe/jma
GET /probe/cwa
GET /probe/database
GET /probe/identity
```

Protected admin/collection/repair routes are **not** Android runtime APIs.

## 4. Security boundary

The Android app must never contain:

- `CWA_AUTHORIZATION`;
- `ADMIN_TOKEN`;
- D1 credentials;
- R2 credentials;
- arbitrary Worker proxy construction logic.

All such secrets remain Cloudflare-side.

Weather Metro currently has no WebView or JavaScript bridge. Native integration should preserve this boundary.

## 5. Required native service boundary

Recommended interface:

```text
StormService
  loadLive(force = false)
  loadHistory(query)
  loadStorm(stormId)
  loadAdvisories(stormId, query)
  loadAdvisory(advisoryId)
  probeHealth()
```

Live loading must preserve per-agency independence. A failure in CMA must not block HKO/JMA/CWA, and vice versa.

Recommended normalized models:

```text
Agency = HKO | CMA | JMA | CWA

AgencyLiveResult
  agency
  state = loading | ok | empty | stale | error
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
  pointType = analysis | forecast
  intensity?
  windSpeed?
  pressure?
  forecastHour?

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

Backend JSON remains backend-owned; Compose should consume normalized immutable models.

## 6. Lifecycle and cancellation

The standalone frontend assumes a browser/PWA lifecycle. Weather Metro must convert that behavior to structured Android ownership.

Rules:

- leaving Storm cancels disposable UI-owned requests;
- changing archived storm invalidates the previous detail request;
- changing advisory invalidates the previous advisory/frame request;
- a slow old response must never overwrite a newer selection;
- Archive autoplay stops when Storm is hidden;
- hidden tools do not continue polling or replay timers;
- the current standalone History timeout reference is 16 seconds;
- background/foreground refresh decisions use a stale threshold rather than unconditional refetch.

With Compose/coroutines, cancellation belongs to the ViewModel/service scope rather than manual browser request serials.

## 7. Cache ownership

Do not depend on the standalone browser IndexedDB/localStorage keys.

Native Storm cache semantics:

- render last-success data immediately when useful;
- failed refresh does not erase good cache;
- stale state remains explicit;
- Live and Archive caches remain separate;
- clearing Weather Metro cache should also clear native Storm cache;
- cache IDs must preserve backend storm/advisory IDs rather than deriving new UI-only identifiers.

## 8. Map ownership

The current standalone renderer uses Leaflet; Weather Metro should eventually render normalized models through a native map/overlay surface.

Mandatory ownership rules:

- one logical map instance per active Storm surface;
- data refresh updates layers, not map ownership;
- do not recreate the map because the parent Pivot page was hidden;
- resize/invalidate after the tool becomes visible;
- user pan/zoom must not be overridden by late agency responses;
- Archive timers stop when hidden;
- final destruction releases listeners/map resources.

The native map library decision belongs to the Weather Metro rendering phase, not this source-contract phase.

## 9. Agency/source semantics

HKO, CMA, JMA and CWA remain independent official sources.

Do not collapse different agency tracks into one synthetic "official" forecast.

Comparison/consensus UI may calculate derived geometry, but it must remain clearly labelled as a comparison product rather than an agency-issued track.

Preserve:

- agency identity;
- analysis vs forecast distinction;
- issue/valid times;
- source-specific wind/probability geometry where available;
- partial source failure visibility.

## 10. Weather Metro navigation target

The host stays on the five-page Pivot:

```text
current / hourly / forecast / tools / settings
```

Internal Tools state:

```text
ToolsHome
  ├── Rain
  └── Storm
       ├── Live
       └── Archive
```

Back behavior:

1. Archive advisory/detail → Archive list;
2. Storm surface → ToolsHome;
3. ToolsHome → normal host/system behavior.

Do not create another infinite pager inside the Storm map surface. Use compact internal mode controls.

## 11. PWA boundary

Standalone-only behavior must not migrate into the native module:

- no Storm service worker inside Weather Metro;
- no standalone install prompt;
- no standalone fullscreen/PWA controls;
- no browser IndexedDB as the host cache;
- Android owns process lifecycle, app updates, offline storage and system back.

## 12. Transitional WebView rule

A WebView is **not** the default integration strategy.

If a temporary Leaflet bridge becomes necessary before native rendering is ready, it is an explicit architecture/security exception and must satisfy at least:

- isolated WebView used only by the Storm tool;
- no `addJavascriptInterface`;
- HTTPS-only, allow-listed origins/assets;
- external navigation blocked or handed to Android explicitly;
- PWA install/fullscreen/service-worker behavior disabled;
- lifecycle limited to narrow host calls such as resume/pause/resize/destroy;
- documented rollback path back to native-only architecture.

Do not silently restore a general-purpose WebView to the app.

## 13. Recommended implementation order

1. central Tool endpoint/origin registry in Weather Metro;
2. Storm domain models and JSON fixture tests;
3. health/history service boundary;
4. per-agency Live service boundary;
5. native cache + cancellation semantics;
6. ToolsHome native navigation;
7. Storm Live list/status UI;
8. native map rendering;
9. Archive list/detail/playback;
10. lifecycle/background/rotation regression;
11. integrate Rain beside Storm using independent services/backends.

## 14. Release/reference baseline

Standalone Storm Track is now `release candidate / maintenance / integration-ready`.

Verified standalone capabilities include:

- HKO/CMA/JMA/CWA independent async loading;
- last-success browser cache;
- analysis/forecast paths and intensity display;
- Hong Kong 400/800 km circles;
- multi-agency comparison and consensus calculations;
- CWA probability/wind geometry where available;
- Archive storm/advisory history;
- advisory slider and replay;
- PWA update/offline shell.

These behaviors are the reference while the native Weather Metro module is implemented.

## 15. Freeze rule

Storm-Track standalone runtime should remain maintenance-only unless:

- a production backend/source contract changes;
- a standalone regression is found;
- Weather Metro integration proves a missing public backend field/endpoint;
- a critical agency parser/source failure requires reference-app changes.

New host product UX should be implemented in Weather Metro first.