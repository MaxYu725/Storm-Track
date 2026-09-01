# HK Signal V2 Shadow

Status: **ACTIVE PARALLEL SHADOW — V1 remains frozen evaluation baseline**

HK Signal V2 Shadow 是在現行 frozen V1 旁邊同步計算、同步顯示及同步保存的候選版本。它的目的不是立即取代 V1，而是在仍有活躍風暴期間，用同一批 as-issued input 做公平的逐輪比較。

V2 Shadow 不使用 HKO 事後 outcome 回餵當前預測，不改寫 raw prospective evidence，不改 evaluator rubric，也不把結果包裝成概率或官方風球預測。

## 為何現在開始 V2

現有 prospective cases 已累積足夠明確的重複問題，適合由單純記錄 hypothesis 進入 parallel shadow comparison：

- **GAENARI / MB-01**：來源數量和 forecast horizon 收縮時，V1 numeric confidence 有機會反而上升；最後 T1 withdrawal 亦與 source membership 收縮高度同步。
- **GAENARI / MS-02**：T1 可以長時間保持 positive，但 `estimatedWindow=null`；實際較像 first-visible-above-threshold / left-censored timing，而不是「沒有時間風險」。
- **NARRA / MS-01**：最近點已過、已有離港證據後，global forecast-edge / horizon semantics 仍可能令 positive state 延後撤回。
- **SAUDEL / MB-02**：T3 曾由約 +119h 的遠期 checkpoint 推至 `possible`，當時 strongest checkpoint 主要只有 CMA 單一 120h endpoint 支持。這是觀察 V2 能否改善 long-horizon support concentration 的高價值 live case。

這些不是用單一案例直接校準成答案，而是把已知問題轉成一組有限、可解釋、可回退的 V2 shadow hypotheses，再用之後每一輪 live evidence 比較。

## V1 / V2 關係

```text
同一組 HKO / CMA / JMA / CWA as-issued input
  → 現行 analysis chain
  → frozen basic-hk-signal-forecast/v1
      ├─ V1 顯示 / prospective evidence / evaluator baseline
      └─ V2 Shadow 0.1 deterministic adjustment
           → 並排顯示
           → 同一 prospective observation 內額外保存
           → 暫不進 evaluator / scoring
```

V1 的 threshold、weighting、forecast semantics、truth attribution、closeout 和 evaluator 均不修改。V2 只能在 V1 之後建立 shadow output，因此這個階段可以直接比較兩個版本，而不破壞已累積的 V1 prospective sequence。

## V2 Shadow 0.1 改動

### 1. Source coverage 影響 numeric confidence

V1 的 disagreement 下降時 numeric confidence 可以上升，即使只剩一個 agency。V2 加入連續 coverage factor：

```text
agencyCoverage = usableAgencyCount / 4
confidenceCoverageFactor = 0.55 + 0.45 × agencyCoverage
```

各 signal 的 V2 confidence 會乘上這個 factor。這不是 hard gate：一個 agency 仍可以提供 forecast evidence，但不再讓「分歧消失」被誤讀成與四機構完整支持相若的信心。

### 2. T3 / T8 遠期少數機構支援折減

只處理 **T3 / T8**，不套用到 T1。若 strongest checkpoint：

- lead time > 72h；而且
- 該 checkpoint 的實際 agency count 少於整宗 case 當輪 usable agency count，

V2 會連續折減 risk，而不是設定「至少 N 個機構」的硬門檻：

```text
supportCoverage = checkpointAgencyCount / usableAgencyCount
horizonBlend = clamp((leadHours - 72) / 48, 0, 1)
supportFactor = 1 - horizonBlend × (1 - supportCoverage) × 0.45
V2 risk = V1 risk × supportFactor
```

因此 +72h 附近幾乎不變；越接近 +120h、而同時越集中於少數 agency，折減越明顯。

這項改動直接針對 SAUDEL MB-02，但仍保留少數機構 scenario 作早期提示，不會直接把它刪除。

### 3. 最近點已過且離港時，殘留 risk 可連續衰減

如果：

- representative closest point 已在過去；
- `directDepart` 有明顯支持；
- threat timeline 已沒有 future checkpoint，

V2 加入最高 40% 的連續 lifecycle decay：

```text
hoursAfterMinimum = max(0, -minimumLeadHours)
lifecyclePenalty = directDepart
                 × hoursAfterMinimum / (hoursAfterMinimum + 12)
                 × 0.40
V2 risk = V1 risk × (1 - lifecyclePenalty)
```

目的是測試 NARRA / GAENARI 類 post-minimum delayed withdrawal 是否能更自然，而不是一看到最近點過去便強制變成 `unlikely`。

### 4. Positive-but-no-window 改為明確 timing state

V2 0.1 **不捏造精確時間窗口**。當 likelihood 仍 positive 而 window 為 null 時，額外標示：

- `left-censored-or-horizon-limited` — 尚有 future timeline，但未看到 threshold crossing / 預報長度限制；
- `post-minimum-no-future` — 最近點已過且沒有 future timeline；
- `unresolved` — 暫未能定位；
- `estimated` — 已有正常 estimated window；
- `not-applicable` — signal 為 unlikely。

UI 會把這些狀態轉成簡短中文，例如「窗：起點不可見/受預報長度限制」。這先解決 MS-02 的解讀問題，而不是用假設時間補空值。

## V2 0.1 明確不做的事

- 不修改 `basic-hk-signal-forecast/v1`。
- 不修改 HKO truth / evaluator / closeout。
- 不把 V2 送入正式 scoring。
- 不使用事後 HKO outcome 調整 live V2。
- 不新增 probability / ML。
- 不把 Consensus Track 當成第五個 agency vote。
- 不因 SAUDEL 下一輪結果立即再調參。
- 不加入大量 case-specific exception。

## Prospective evidence

現行 `hk-beta-prospective-observation/v1` schema 保持不變，以免打斷既有 recorder/evaluator contract；每個新 observation 會多保存：

```text
analysis.shadowForecastV2
engineVersions.shadowForecastV2
```

V1 仍在原本的：

```text
analysis.basicForecast
```

因此同一 capture 可以做逐輪 V1 / V2 對照，而既有 evaluator 繼續只讀 V1。

## SAUDEL live comparison

SAUDEL (`STC-2026-JMA-TC2621`) 是 V2 Shadow 0.1 的首個重點 prospective comparison case，原因不是預先認定 V2 應該較低，而是它同時具備：

- 很長 forecast horizon；
- 遠期 T3 escalation 曾集中於單一 CMA endpoint；
- forecast-edge 高；
- 後續不同 agency 有機會逐步加入、收斂、退出或改變 horizon；
- 最終可能出現 official signal，也可能自然 withdrawal。

逐輪主要看：

1. V1 T3 若因單一 +100–120h agency endpoint 升高，V2 是否只做適量折減，而不是完全失去 early warning。
2. 當 HKO / JMA / CWA 後續真正收斂至同一高威脅時段，V2 的折減是否自然減少。
3. 若 SAUDEL 最終真的需要 T3，V2 是否仍保留足夠 lead time。
4. 若最終不發 T3，V2 是否比 V1 減少 transient long-horizon false positive / persistence。
5. T1 不受 long-horizon strong-signal support discount，確認 V2 不因處理 T3 問題而犧牲廣義早期接近提示。
6. source membership 減少時，V2 numeric confidence 是否比 V1 更符合 evidence completeness。
7. 最近點過後，V2 withdrawal 是否比 V1 更符合實際 departure evidence，同時沒有過早撤回。

## Active-storm freeze policy

V2 Shadow 0.1 上線後，在香港附近仍有活躍風暴期間：

- V1 frozen；
- V2 0.1 亦暫時 freeze；
- correctness bug 可修；
- 不因單一新 snapshot 再調公式或 coefficient；
- 所有 V1 / V2 差異先保存 evidence。

這樣 SAUDEL 及同時期其他風暴才能提供真正 prospective 的 A/B sequence，而不是每一輪都改模型後再比較。

## 香港附近風暴全部消散後的全面整理

當這一輪香港附近熱帶氣旋全部離開 lifecycle / 完成可用 closeout 後，做一次統一 review，而不是邊看邊繼續新增 patch：

1. 對 GAENARI、NARRA、SAUDEL 及同期其他完成 case 建立完整 V1 / V2 timeline comparison。
2. 比較 T1/T3/T8 first-positive、max risk、positive persistence、withdrawal、window/timing-state、numeric confidence、agency support。
3. 只以當時已保存的 prospective evidence + official truth 做 verification，禁止 future leakage。
4. 判斷四個 V2 hypothesis 各自是：保留、調整、移除或 evidence insufficient。
5. 檢查 V2 是否真的整體優於 V1，而不是只修好 SAUDEL。
6. 若 V2 值得保留，再把目前為降低 live deployment 風險而暫放在 `frontend-hk-threat-ui.js` 的 shadow logic 抽成獨立 analysis module。
7. 統一整理 UI、Observation Board、recorder schema/evaluator strategy 和文件，避免 V1/V2 臨時比較結構永久累積。
8. 再決定 V2 是否進入正式 evaluator candidate；未達到足夠 cross-case improvement 就保持 shadow 或 write-off。

## Implementation note

V2 Shadow 0.1 暫時實作在 `analysis/frontend-hk-threat-ui.js`，原因是 active-storm 期間要最小化部署面：

- 不新增 production Worker / D1 依賴；
- 不修改 authoritative backend；
- 不修改 V1 core；
- 不需要改 `index.html` script stack；
- 現有 service worker 對 same-origin JavaScript 已採 network-first，可讓 shadow logic 更新而保留 offline fallback。

若 post-storm review 決定保留 V2，才進行模組抽離和正式架構整理。
