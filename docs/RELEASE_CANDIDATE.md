# Storm Track standalone release candidate

Status: **RC approved for standalone close-out**  
RC review date: **2026-08-14 HKT**  
Runtime baseline reviewed: `5824b7ebebc0f2bf630b4f1ef0a42bba6bce1b34`

This checkpoint closes the standalone Storm Track development cycle before future Weather Metro integration. It does not change the production Worker, D1, R2, Cron, source parsers, UI runtime, Service Worker behavior or API contracts.

## Release decision

Storm Track is accepted as the standalone release candidate because:

- a real tropical-cyclone event was manually tested by the project owner with no issue reported before this RC cut;
- the latest GitHub Pages deployment for the reviewed runtime baseline completed successfully;
- the deployed artifact was downloaded and inspected rather than assuming repository contents equal production;
- inline application JavaScript passes `node --check`;
- `sw.js` passes `node --check`;
- the current artifact contains only the intended standalone runtime, documentation and PWA icons;
- Checkpoints 1–5 resolved the identified PWA update, lifecycle, Archive UX, legacy-code and integration-documentation risks.

## Verified production artifact

The reviewed GitHub Pages artifact contains:

```text
README.md
docs/WEATHER_APP_INTEGRATION.md
icons/apple-touch-icon.png
icons/icon-192.png
icons/icon-512.png
icons/icon.svg
index.html
manifest.webmanifest
sw.js
```

Runtime SHA-256 fingerprints at RC review:

```text
index.html           4393c24b97c35f8c11bd923d86350f196e3e8ffd95d4d0e58e1034bf6f58883c
sw.js                eef07c3c9e896d149edd02336227bf4f6ddb28f8aec0a238883fe94b6b7d5e5c
manifest.webmanifest 5d86e66bce2e5168222e6c8914f6a1118688881acba54889ed1f61bb3b479ef0
```

## Final regression matrix

| Area | Result | Evidence / note |
| --- | --- | --- |
| Real tropical-cyclone live use | PASS | Project-owner manual test; no issue reported before RC |
| HKO/CMA/JMA/CWA independent-source architecture | PASS | Retained from production runtime; no source was collapsed into another agency |
| Production Worker origin | PASS | `https://storm.max-yu.workers.dev` is the only Storm Worker origin in the deployed frontend |
| Legacy Worker hostname | PASS | `maxyu0725` absent from deployed `index.html` |
| JavaScript syntax | PASS | Extracted inline JS passes `node --check` |
| Service Worker syntax | PASS | `sw.js` passes `node --check` |
| Service Worker version | PASS | `3.3.3` |
| Navigation cache freshness | PASS | navigation uses network request with `cache: 'no-store'`; install shell uses `cache: 'reload'` |
| Service Worker rollover | PASS | versioned `storm-track-*` caches, `skipWaiting()` and `clients.claim()` retained |
| PWA manifest | PASS | fullscreen/standalone, `zh-HK`, 192/512 icons and scoped start URL retained |
| PWA update UX | PASS | explicit update-ready banner and user-triggered reload retained |
| Foreground recovery | PASS | active mode refresh after at least five minutes away; Leaflet resize recovery retained |
| Hidden Archive playback | PASS | playback stops when the document becomes hidden |
| History request timeout | PASS | explicit 16-second timeout retained |
| Archive playback speed | PASS | 0.7× / 1× / 1.75× control retained |
| Source last-check time | PASS | source status continues to expose app-side last-check time |
| IndexedDB/history cache path | PASS | live and history cache stores remain distinct |
| Legacy/dead files | PASS | obsolete versioned READMEs, root `worker.js` and `icons/1.txt` are absent |
| Confirmed dead frontend/SW helpers | PASS | `firstLocalByType`, `reloadingForUpdate`, `GET_VERSION`, `SKIP_WAITING` message handlers absent |
| Temporary patch tooling | PASS | only permanent `deploy-pages.yml` remains under `.github/workflows` |
| Open pull requests | PASS | none at RC review |
| Weather Metro integration contract | PASS | `docs/WEATHER_APP_INTEGRATION.md` present |

## Known boundaries that are not release blockers

### Production Worker source remains external to this repository

The production Cloudflare Worker uses the independently deployed backend described by the project handoff. Its authoritative source is not synchronized in this repository. The removed historical `worker.js` must never be redeployed over production.

This is a source-of-truth/backup limitation, not a frontend RC defect. Any future backend change should first establish an authoritative backend source repository or export path.

### Live Worker probing from the assistant execution environment

During earlier checkpoints, the assistant execution environment could not reliably DNS-resolve the production Worker. This was treated as an environment limitation rather than evidence of Worker failure. The project-owner real-event test is therefore the stronger final runtime signal for this RC.

### Merged checkpoint branches remain on GitHub

Several merged feature branches remain in the repository because the available connector does not expose a safe delete-ref action. They do not affect `main`, Pages deployment or production runtime and can be removed later through normal GitHub branch cleanup.

## Standalone freeze rule

After this RC checkpoint:

- do not add speculative features to standalone Storm Track;
- only fix reproducible defects, broken upstream-source behavior, security issues or deployment failures;
- do not add agencies without a separate product decision;
- do not merge the Storm Worker into Weather Metro;
- keep the standalone PWA deployable during Weather Metro integration;
- future integration work follows `docs/WEATHER_APP_INTEGRATION.md`.

## Future work classification

Standalone Storm Track now enters **maintenance / integration-ready** status.

The next development effort should occur as Weather Metro integration work rather than another standalone feature phase. Rain Track and Storm Track may share the Weather Metro Tools host patterns, but their domain-specific data models remain independent.
