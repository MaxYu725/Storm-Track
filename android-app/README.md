# 🌀 Storm-Track Ultra 2.0 (風暴領航 Pro)

基於 [`MaxYu725/Storm-Track`](https://github.com/MaxYu725/Storm-Track) 全面重構與華麗升級的次世代熱帶氣旋戰術追蹤與香港防風決策 Android 應用程式。全面採用 **MTR Metro Ultra 2.0** 的 **Cyber-Meteorological & Neo-Glassmorphism（流光毛玻璃擬態）** 架構與一鍵雲端自動化 APK 打包方案。

---

## ✨ Ultra 2.0 核心架構與升級亮點

1. **🎨 次世代氣象流光毛玻璃介面 (Cyber-Storm Glass UI & 雙主題切換)**
   - 支援 **深淵風暴模式 (Obsidian Storm Dark)** 與 **清晰日照模式 (Daylight Mode)** 一鍵切換，海圖底圖、暴風圈半透明度與風場流線色彩自動同步。
   - 結合經典 **Neo-Metro Pivot 滑動大標題** 與 **懸浮毛玻璃底部導航列 (Floating Glass Dock)**，支援左右手勢滑動與單手極速切換四大戰術視角。

2. **📡 戰術海圖與動態風場引擎 (`Radar`)**
   - **五大權威機構路徑同屏疊加**：整合 **HKO (香港天文台)**、**JMA (日本氣象廳)**、**CMA (中央氣象台)**、**CWA (台灣中央氣象署)** 與 **JTWC (聯合颱風警報中心)** 實時及預測路徑。
   - **Consensus Track Beta (多機構時間對齊共識路徑)**：自動進行時間軸向量線性插值，繪製多機構加權共識路徑與 **70% 機率誤差圓錐 (Uncertainty Cone)**。
   - **非對稱風圈與香港警戒圈**：動態渲染 **30kt (強風圈)**、**50kt (烈風圈)**、**64kt (颶風圈)** 實時風圈，並疊加香港天文台 **100km / 300km / 500km / 800km** 防風警戒同心圓。
   - **Open-Meteo ECMWF 動態流線風場**：串接 `storm.max-yu.workers.dev` 與 Open-Meteo `ecmwf_ifs` 區域風場網格，在 Canvas 圖層即時繪製流體風羽粒子與蒲福氏風級熱區。
   - **互動時間軸推進器 (Timeline Scrubber)**：可自由拖曳或播放 `OBS (實況)` 至 `+120h` 預測時段，實時觀察暴風圈推進與香港 CPA 距離變化。

3. **🛡️ 香港防風威脅與風球機率研判 V2 (`Threat`)**
   - **CPA (Closest Point of Approach) 最接近香港精算儀**：以香港天文台總部 (`22.3022°N, 114.1746°E`) 為基準，精算實時方位角、直線距離、預測最接近距離 (CPA) 與發生時間窗。
   - **五級熱帶氣旋信號機率矩陣 (`T1 / T3 / T8 / T9 / T10`)**：綜合風暴距離、中心強度、移動向量、半圓效應（危險半圓 vs 可航半圓）與本地風力，計算各級風球發出及維持機率。
   - **天文台八大參考測風站看板 (`8-Station Wind Index`)**：即時監測決定三號及八號風球達標門檻（8 站中 4 站達標）之官方測風站：**長洲、赤鱲角、青衣、啟德、西貢、沙田、濕地公園、打鼓嶺**，並附設橫瀾島與昂坪高地前哨站對照。

4. **🧭 多機構路徑共識與分歧度實驗室 (`Agencies`)**
   - 支援切換 `+24h / +48h / +72h / +96h / +120h` 預報時效，同屏對比五大機構與共識路徑之經緯度、中心最高持續風速 (`km/h` / `kt`)、中心最低氣壓 (`hPa`) 及各自預測之香港 CPA 最接近距離。
   - 自動計算 **模式分歧度 (Ensemble Spread km)**，直觀評估路徑預報穩定度（低分歧鎖定 vs 鞍型場高分歧）。

5. **⏪ 歷史經典個案重演與防風演練中心 (`Replay`)**
   - 內建完整離線封裝之歷史及預演資料庫（包含 **2025 超強颱風樺加沙 Ragasa**、**2026 強烈熱帶風暴紅霞 Noul**、**2023 超強颱風蘇拉 Saola**、**2018 超強颱風山竹 Mangkhut**），無網絡環境下依然 0 毫秒秒開。
   - 支援 1x / 2x / 4x 時間軸自動重演、一鍵跳轉至「最接近香港 (CPA) 時刻」，以及 **Android 原生震動預警演練**。

---

## ☁️ 如何依照 MTR Ultra 方案一鍵雲端打包 Android APK

### 方法 A：單一檔案全自動解壓與編譯（MTR Ultra 2.0 方案，最推薦）
1. 在你的 GitHub Repository (`Storm-Track`) 中，建立或覆蓋 `.github/workflows/deploy-and-build.yml`，貼上隨附的 **`Storm-Track-Ultra-auto-deploy-build.yml`** 內容並 Commit。
2. GitHub Actions 會自動解壓完整專案結構 (`src/`、`package.json`、`capacitor.config.json`、高解析度自適應圖標) 並自動完成 Capacitor 6 + Java 21 + Gradle 編譯。
3. 約 2 分鐘後，前往 GitHub **Actions** 分頁點入最新執行紀錄，於底部 **Artifacts** 下載 `Storm_Track_Ultra_v2_APK` 即可獲得 `app-debug.apk` 安裝至手機！
