from pathlib import Path

path = Path('index.html')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        "        #toast.show { opacity: 1; }\n",
        "        #toast.show { opacity: 1; }\n        #pwa-update-banner {\n            left:50%; bottom:68px; z-index:1250; transform:translateX(-50%);\n            display:flex; align-items:center; gap:9px; max-width:calc(100vw - 28px);\n            padding:8px 9px 8px 11px; border:1px solid #666; background:rgba(0,0,0,.96);\n            color:#fff; font-size:.76rem; pointer-events:auto; white-space:nowrap;\n            box-shadow:0 5px 18px rgba(0,0,0,.5);\n        }\n        #pwa-update-banner button { height:28px; padding:0 9px; border:1px solid #fff; background:#fff; color:#000; cursor:pointer; }\n",
    ),
    (
        "        .archive-frame-row { display:grid; grid-template-columns:34px 1fr auto; gap:8px; align-items:center; }\n        .archive-play { width:34px; height:32px; border:1px solid #777; background:#080808; color:#fff; cursor:pointer; font-size:.9rem; }\n",
        "        .archive-frame-row { display:grid; grid-template-columns:34px 1fr auto auto; gap:7px; align-items:center; }\n        .archive-play { width:34px; height:32px; border:1px solid #777; background:#080808; color:#fff; cursor:pointer; font-size:.9rem; }\n        .archive-speed { height:30px; min-width:58px; padding:0 5px; border:1px solid #444; background:#0b0b0b; color:#ddd; font-size:.68rem; outline:none; }\n",
    ),
    (
        "            <div id=\"toast\" class=\"map-hud\"></div>\n",
        "            <div id=\"toast\" class=\"map-hud\"></div>\n            <div id=\"pwa-update-banner\" class=\"map-hud hidden\" role=\"status\" aria-live=\"polite\">\n                <span>Storm Track 新版本已就緒</span>\n                <button type=\"button\" onclick=\"WeatherApp.applyPwaUpdate()\">重新載入</button>\n            </div>\n",
    ),
    (
        "                        <div id=\"archive-frame-count\" class=\"archive-frame-count\">0 / 0</div>\n",
        "                        <div id=\"archive-frame-count\" class=\"archive-frame-count\">0 / 0</div>\n                        <select id=\"archive-speed\" class=\"archive-speed\" aria-label=\"歷史公報播放速度\" onchange=\"WeatherApp.setArchivePlaybackSpeed(this.value)\">\n                            <option value=\"0.7\">0.7×</option>\n                            <option value=\"1\" selected>1×</option>\n                            <option value=\"1.75\">1.75×</option>\n                        </select>\n",
    ),
    (
        "        agency: 'ALL', index: 0, timer: null, playing: false, listSerial: 0, stormSerial: 0, frameSerial: 0,\n",
        "        agency: 'ALL', index: 0, timer: null, playing: false, playbackSpeed: 1, listSerial: 0, stormSerial: 0, frameSerial: 0,\n",
    ),
    (
        "            navigator.serviceWorker.addEventListener('controllerchange', () => {\n                if (!hadController || reloadingForUpdate) return;\n                reloadingForUpdate = true;\n                if (document.visibilityState === 'visible') location.reload();\n                else pendingControllerReload = true;\n            });\n",
        "            navigator.serviceWorker.addEventListener('controllerchange', () => {\n                if (!hadController || reloadingForUpdate) return;\n                pendingControllerReload = true;\n                if (document.visibilityState === 'visible') showPwaUpdatePrompt();\n            });\n",
    ),
    (
        "    function scheduleMapResize(delay = 120) {\n",
        "    function showPwaUpdatePrompt() {\n        pendingControllerReload = false;\n        document.getElementById('pwa-update-banner')?.classList.remove('hidden');\n    }\n\n    function applyPwaUpdate() {\n        reloadingForUpdate = true;\n        location.reload();\n    }\n\n    function scheduleMapResize(delay = 120) {\n",
    ),
    (
        "            if (pendingControllerReload) {\n                location.reload();\n                return;\n            }\n",
        "            if (pendingControllerReload) {\n                showPwaUpdatePrompt();\n                return;\n            }\n",
    ),
    (
        "        archiveState.timer = setInterval(() => {\n            if (archiveState.index >= archiveState.filteredAdvisories.length - 1) { stopArchivePlayback(); return; }\n            archiveState.index += 1;\n            showArchiveFrame(archiveState.index, false);\n        }, 1400);\n    }\n\n    function stopArchivePlayback() {\n",
        "        scheduleArchivePlaybackTimer();\n    }\n\n    function scheduleArchivePlaybackTimer() {\n        clearInterval(archiveState.timer);\n        const delay = Math.round(1400 / archiveState.playbackSpeed);\n        archiveState.timer = setInterval(() => {\n            if (archiveState.index >= archiveState.filteredAdvisories.length - 1) { stopArchivePlayback(); return; }\n            archiveState.index += 1;\n            showArchiveFrame(archiveState.index, false);\n        }, delay);\n    }\n\n    function setArchivePlaybackSpeed(value) {\n        const speed = Number(value);\n        archiveState.playbackSpeed = [0.7, 1, 1.75].includes(speed) ? speed : 1;\n        if (archiveState.playing) scheduleArchivePlaybackTimer();\n    }\n\n    function stopArchivePlayback() {\n",
    ),
    (
        "    function showSourceStatus(source) {\n        const health = sourceHealth[source] || { state: 'unknown', message: '沒有狀態資料' };\n        document.getElementById('storm-panel').classList.add('open');\n        showToast(`${source}：${health.message}`);\n    }\n\n    function setSourceHealth(source, state, message) {\n        sourceHealth[source] = { state, message, updatedAt: new Date().toISOString() };\n        const badge = document.getElementById(`badge-${source.toLowerCase()}`);\n        badge.className = `source-badge ${state}`;\n        badge.title = message;\n        badge.setAttribute('aria-label', `${source}：${message}`);\n    }\n\n    function buildStatusHtml() {\n        const rows = ['HKO', 'CMA', 'JMA', 'CWA'].map(source => {\n            const health = sourceHealth[source];\n            const stateLabel = { loading: '載入中', ok: '已載入', empty: '無活躍風暴', error: '失敗', stale: '快取／過期' }[health.state] || health.state;\n            return `${source}［${stateLabel}］：${escapeHtml(health.message)}`;\n        });\n",
        "    function showSourceStatus(source) {\n        const health = sourceHealth[source] || { state: 'unknown', message: '沒有狀態資料' };\n        document.getElementById('storm-panel').classList.add('open');\n        const checkedAt = health.updatedAt ? ` · 最後檢查 ${formatHkt(health.updatedAt)}` : '';\n        showToast(`${source}：${health.message}${checkedAt}`);\n    }\n\n    function setSourceHealth(source, state, message) {\n        const updatedAt = new Date().toISOString();\n        sourceHealth[source] = { state, message, updatedAt };\n        const badge = document.getElementById(`badge-${source.toLowerCase()}`);\n        const checkedAt = formatHkt(updatedAt);\n        badge.className = `source-badge ${state}`;\n        badge.title = `${message} · 最後檢查 ${checkedAt}`;\n        badge.setAttribute('aria-label', `${source}：${message}，最後檢查 ${checkedAt}`);\n    }\n\n    function buildStatusHtml() {\n        const rows = ['HKO', 'CMA', 'JMA', 'CWA'].map(source => {\n            const health = sourceHealth[source];\n            const stateLabel = { loading: '載入中', ok: '已載入', empty: '無活躍風暴', error: '失敗', stale: '快取／過期' }[health.state] || health.state;\n            const checkedAt = health.updatedAt ? ` · 最後檢查 ${escapeHtml(formatHkt(health.updatedAt))}` : '';\n            return `${source}［${stateLabel}］：${escapeHtml(health.message)}${checkedAt}`;\n        });\n",
    ),
    (
        "        toggleComparisonPanel, focusComparison, installPwa, clearTrackHighlight,\n        switchMode, toggleArchivePlayback, focusArchiveTrack, refreshArchive\n",
        "        toggleComparisonPanel, focusComparison, installPwa, applyPwaUpdate, clearTrackHighlight,\n        switchMode, toggleArchivePlayback, setArchivePlaybackSpeed, focusArchiveTrack, refreshArchive\n",
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one match, found {count}: {old[:100]!r}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
