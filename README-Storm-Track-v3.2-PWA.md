# Storm Track v3.2 PWA

## 本版重點

### 各機構獨立非同步載入

HKO、CMA、JMA、CWA 會同時開始更新；任何一個來源完成後立即加入地圖，不再等待四個來源全部完成。每個來源都有獨立狀態：

- `loading`：同步中
- `ok`：已載入
- `empty`：沒有活躍風暴
- `error`：即時讀取失敗
- `stale`：顯示裝置快取或即時更新失敗後保留舊資料

頂部總進度條會一直顯示至四個來源都完成或失敗，但已完成的路線會先行顯示。

### IndexedDB 快取優先顯示

開啟 App 時先從 IndexedDB 讀取 HKO、CMA、JMA、CWA 各自最後一次成功資料，立即繪製；官方資料在背景逐個更新。瀏覽器不支援 IndexedDB 時會退回 localStorage。

### 路線點選高亮

- 點擊任一數據點，高亮該風暴的該機構整條分析及預測路線。
- 高亮路線加粗，其他路線及數據點淡化。
- 被點選的數據點顯示白色選取環。
- 點擊地圖空白位置或按 `Esc` 取消高亮。

### 數據點樣式簡化

所有數據點只用風暴強度填充色，不再用機構路線色作外框。機構仍由路線顏色、彈出資料及來源標籤辨識。

### 地圖縮放行為

只會在第一批可用資料出現時自動縮放一次。其後其他機構逐一載入，不會令地圖反覆跳動；用戶一旦拖動或縮放地圖，背景載入也不會再強制改變視野。

## 保留功能

- PWA 安裝、fullscreen、safe-area 與離線啟動殼
- HKO／CMA／JMA／CWA 路徑
- 多機構共同時效比較
- 預測分歧半徑及共識中心
- 最近距港分析
- CWA 70% 預報圓
- CMA／CWA 風圈
- 測距、底圖及圖層控制

## 部署

把以下檔案與資料夾完整上傳至 Cloudflare Pages 專案根目錄：

- `index.html`
- `manifest.webmanifest`
- `sw.js`
- `icons/`

`worker.js` 與現有 Storm Worker v2.5 相同；若 `/health`、HKO、CMA、JMA、CWA 均正常，不需要重新部署 Worker。

PWA 和 Service Worker 只會在 HTTPS 或 localhost 生效。直接用 `file://` 開啟 `index.html` 時，Service Worker、PWA 安裝及持久 IndexedDB 行為可能與正式部署不同。

## 更新舊版 PWA

Service Worker 版本為 `3.2.0`。部署後：

1. 重新開啟網站並強制重新整理一次。
2. 已安裝的 PWA 若仍顯示舊版，可完全關閉後重新開啟。
3. 必要時在瀏覽器網站資料中移除舊 Service Worker 快取，再重新載入。

## 驗證

- HTML 內嵌 JavaScript 已使用 Node.js `--check` 驗證語法。
- `sw.js` 已使用 Node.js `--check` 驗證語法。
- 實際官方資料載入次序、IndexedDB 持久化與點選互動仍應在 Cloudflare Pages HTTPS 部署後測試。
