# Storm Track

香港熱帶氣旋路徑 PWA，以手機／standalone 使用為優先，集中顯示 HKO、CMA、JMA、CWA 官方路徑，並提供多機構比較與 D1 歷史公報重播。

## Production

- Web App：`https://maxyu725.github.io/Storm-Track/`
- Storm Worker：`https://storm.max-yu.workers.dev`
- 前端部署：GitHub Pages，由 `.github/workflows/deploy-pages.yml` 在 `main` push 後自動部署

## 目前功能

- HKO／CMA／JMA／CWA 獨立 async 載入及來源狀態
- IndexedDB last-success cache，失敗時保留可用快取
- 分析／預測路徑、強度顏色、香港 400／800 km 圈
- 多機構共同時效比較、共識中心、最大分歧、距港分析
- CWA 70% 預報圓及已保存風圈
- PWA 安裝、fullscreen、safe-area、離線 shell
- Archive：D1 風暴清單、搜尋／年份／機構篩選、歷次公報 slider、可調速重播

## Repository scope

此 repository 現時只保存 **standalone 前端與 GitHub Pages deployment**。

Production Storm Worker 使用 Cloudflare Worker + D1 + R2 + Cron，繼續獨立部署於 `storm.max-yu.workers.dev`。目前 production backend source 並未同步在此 repository，因此不要從舊 Git 歷史中的 `worker.js` 重新部署或覆蓋現行 Worker。

Production backend 主要診斷端點包括：

- `/health`
- `/probe/cma`
- `/probe/jma`
- `/probe/cwa`
- `/probe/database`
- `/probe/identity`

History API 主要端點：

- `/api/history/storms`
- `/api/history/storms/:stormId`
- `/api/history/storms/:stormId/advisories`
- `/api/history/advisories/:advisoryId`

## Frontend files

- `index.html` — standalone UI、資料 adapters、Archive、Leaflet lifecycle
- `manifest.webmanifest` — PWA metadata
- `sw.js` — offline shell、cache rollover、update lifecycle
- `icons/` — PWA icons
- `.github/workflows/deploy-pages.yml` — production Pages deployment

## Development rules

- Mobile / PWA first
- 不把 Storm Worker backend 搬進 Weather App
- 不新增來源機構，除非有明確產品理由
- 不把不同機構的分析／預測資料誤當成單一官方預報
- 修改 `main` 後應確認 GitHub Pages deployment 成功，並以實際 deployment artifact 做 regression

Weather App 整合契約：[`docs/WEATHER_APP_INTEGRATION.md`](docs/WEATHER_APP_INTEGRATION.md)。
