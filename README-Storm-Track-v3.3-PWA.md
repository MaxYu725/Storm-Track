# Storm Track v3.3 PWA

## 本版新增

### 歷史風暴 Archive

頂部新增 `archive` Pivot。進入後會從目前的 Storm Worker v3.3-alpha.2 讀取 D1 歷史 API：

- 按年份篩選風暴
- 以中文名、英文名、國際編號或內部 Storm ID 搜尋
- 顯示每個風暴的狀態及公報數量
- 選擇 HKO／CMA／JMA／CWA，或按全部機構時間排序
- 以 Slider 選擇歷次公報
- 自動播放歷次公報，查看預測路徑隨發報時間改變
- 顯示分析點、預測點、強度、風速、氣壓、預報圓及已保存風圈
- 公報及最近瀏覽風暴保存至 IndexedDB，網絡失敗時可先顯示裝置快取

### 即時及歷史模式分離

- `storm`：現有四機構即時路徑、多機構比較及來源 async 載入
- `archive`：D1 歷史資料及公報重播
- 進入 Archive 時暫時隱藏即時路線，避免兩種資料混淆
- 返回 Storm 後恢復原有即時圖層

## 後端要求

Worker 必須已部署 v3.3.0-alpha.2，並已完成：

- D1 binding：`DB`
- R2 binding：`RAW_BUCKET`
- Migration：`0001_initial`、`0002_identity_repair`
- 身份修復後 `/probe/identity` 的 `mismatchedCanonicalIds` 和 `duplicateNameGroups` 均為空

前端使用以下歷史端點：

- `/api/history/storms`
- `/api/history/storms/:stormId`
- `/api/history/storms/:stormId/advisories`
- `/api/history/advisories/:advisoryId`

## 部署

將以下項目上傳至 Cloudflare Pages 根目錄：

- `index.html`
- `manifest.webmanifest`
- `sw.js`
- `icons/`

你目前已部署的 Worker v3.3-alpha.2 不需要再次覆蓋。套件內的 `worker.js` 和 migrations 只作完整備份。

## 操作

1. 開啟 PWA。
2. 點擊頂部 `archive`。
3. 選擇年份和風暴。
4. 選擇機構；「全部」會依發報時間重播所有機構公報。
5. 拖動時間軸，或按播放鍵。
6. 按「定位路徑」重新聚焦目前公報。
7. 點 `storm` 返回即時路徑。

## 快取及限制

- 歷史風暴清單、所選風暴公報及已讀取公報路徑會保存至 IndexedDB。
- Service Worker 不攔截 Worker API；有網絡時始終優先取得 D1 最新資料。
- 初版每次只顯示一份機構公報，不會把不同機構在相近時間的歷史路徑同時疊加。
- D1 只會包含 v3.3 收集器開始運作後保存的公報，不會自動補回官方未提供的舊資料。

## 驗證

- HTML 內嵌 JavaScript 已以 Node.js `--check` 驗證。
- `sw.js` 已以 Node.js `--check` 驗證。
- ZIP 結構已檢查。
- 實際歷史 API、IndexedDB 及播放互動仍需在 Cloudflare Pages HTTPS 部署後驗證。
