from pathlib import Path

path = Path('index.html')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        "    const DB_VERSION = 2;\n    const FETCH_TIMEOUT_MS = 16000;\n",
        "    const DB_VERSION = 2;\n    const FETCH_TIMEOUT_MS = 16000;\n    const FOREGROUND_REFRESH_AFTER_MS = 5 * 60 * 1000;\n",
    ),
    (
        "    let currentMode = 'live';\n    let historyLayer = null;\n",
        "    let currentMode = 'live';\n    let historyLayer = null;\n    let backgroundedAt = null;\n    let lifecycleRefreshAt = 0;\n    let pendingControllerReload = false;\n    let reloadingForUpdate = false;\n    let mapResizeTimer = null;\n",
    ),
    (
        "    function init() {\n        initPwa();\n        initMap();\n        bindControls();\n        refreshData();\n    }\n",
        "    function init() {\n        initPwa();\n        initMap();\n        bindControls();\n        bindAppLifecycle();\n        refreshData();\n    }\n",
    ),
    (
        "        if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {\n            navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' })\n                .then(registration => registration.update().catch(() => {}))\n                .catch(error => console.warn('Service Worker 註冊失敗', error));\n        }\n",
        "        if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {\n            const hadController = Boolean(navigator.serviceWorker.controller);\n            navigator.serviceWorker.addEventListener('controllerchange', () => {\n                if (!hadController || reloadingForUpdate) return;\n                reloadingForUpdate = true;\n                if (document.visibilityState === 'visible') location.reload();\n                else pendingControllerReload = true;\n            });\n\n            navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' })\n                .then(registration => registration.update().catch(() => {}))\n                .catch(error => console.warn('Service Worker 註冊失敗', error));\n        }\n",
    ),
    (
        "    async function installPwa() {\n",
        "    function scheduleMapResize(delay = 120) {\n        clearTimeout(mapResizeTimer);\n        mapResizeTimer = setTimeout(() => map?.invalidateSize({ pan: false, debounceMoveend: true }), delay);\n    }\n\n    function refreshForLifecycle() {\n        const now = Date.now();\n        if (now - lifecycleRefreshAt < 3000) return;\n        lifecycleRefreshAt = now;\n        if (currentMode === 'archive') refreshArchive();\n        else refreshData();\n    }\n\n    function bindAppLifecycle() {\n        document.addEventListener('visibilitychange', () => {\n            if (document.visibilityState === 'hidden') {\n                backgroundedAt = Date.now();\n                if (archiveState.playing) stopArchivePlayback();\n                return;\n            }\n\n            scheduleMapResize();\n            if (pendingControllerReload) {\n                location.reload();\n                return;\n            }\n\n            const awayMs = backgroundedAt ? Date.now() - backgroundedAt : 0;\n            backgroundedAt = null;\n            if (awayMs >= FOREGROUND_REFRESH_AFTER_MS) refreshForLifecycle();\n        });\n\n        window.addEventListener('pageshow', event => {\n            scheduleMapResize();\n            if (event.persisted) refreshForLifecycle();\n        });\n\n        window.addEventListener('online', () => {\n            if (document.visibilityState === 'visible') refreshForLifecycle();\n        });\n\n        window.addEventListener('resize', () => scheduleMapResize(80));\n        window.addEventListener('orientationchange', () => scheduleMapResize(180));\n    }\n\n    async function installPwa() {\n",
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one match, found {count}: {old[:80]!r}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
