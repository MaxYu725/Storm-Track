# HK Signal V2 Shadow

Status: **ACTIVE PARALLEL SHADOW 0.2 — V1 remains frozen evaluation baseline**

HK Signal V2 Shadow 是在現行 frozen V1 旁邊同步計算、同步顯示及同步保存的候選版本。它的目的不是立即取代 V1，而是用同一批 as-issued input 做公平的逐輪比較。

V2 Shadow 不使用 HKO 事後 outcome 回餵當前預測，不改寫 raw prospective evidence，不改 evaluator rubric，也不把結果包裝成概率或官方風球預測。

目前 frontend 暴露的版本為：

`hk-signal-shadow-v2/0.2`

## 為何現在保留 V2 Shadow

現有 prospective cases 已累積數類可重複或具一般性的問題，適合維持 parallel shadow comparison：

- **GAENARI / MB-01**：來源數量和 forecast horizon 收縮時，V1 numeric confidence 有機會反而上升；最後 T1 withdrawal 亦與 source membership 收縮高度同步。
- **GAENARI / MS-02**：T1 可以長時間保持 positive，但 `estimatedWindow=null`；實際較像 first-visible-above-threshold / left-censored timing，而不是「沒有時間風險」。
- **NARRA / MS-01**：最近點已過、已有離港證據後，global forecast-edge / horizon semantics 仍可能令 positive state 延後撤回。
- **NARRA terminal residual**：最後只餘一個 stale HKO source、已降為 Low Pressure Area、沒有 forecast point、最近點已過且 future timeline 為空，V1 仍保留 T1 `possible`。
- **SAUDEL / MB-02 stress observation**：T3 曾由約 +119h 的遠期 checkpoint 推至 `possible`，當時 checkpoint participation 很低。這只保留作特殊路徑壓力案例，不作一般模型 calibration 證據。

這些不是用單一案例直接校準成答案，而是把已知問題轉成一組有限、可解釋、可回退的 V2 shadow hypotheses，再用之後每一輪 live evidence 比較。

## V1 / V2 關係

```text
同一組 HKO / CMA / JMA / CWA as-issued input
  → 現行 analysis chain
  → frozen basic-hk-signal-forecast/v1
      ├─ V1 顯示 / prospective evidence / evaluator baseline
      └─ V2 Shadow 0.2 deterministic adjustment
           → 並排顯示
           → 同一 prospective observation 內額外保存
           → 暫不進 evaluator / scoring
```

V1 的 threshold、weighting、forecast semantics、truth attribution、closeout 和 evaluator 均不修改。V2 只能在 V1 之後建立 shadow output，因此這個階段可以直接比較兩個版本，而不破壞已累積的 V1 prospective sequence。

## V2 Shadow 0.2 改動

### 1. Source coverage 影響 numeric confidence

V1 的 disagreement 下降時 numeric confidence 可以上升，即使只剩一個 agency。V2 加入連續 coverage factor：

```text
agencyCoverage = usableAgencyCount / 4
confidenceCoverageFactor = 0.55 + 0.45 × agencyCoverage
```

各 signal 的 V2 confidence 會乘上這個 factor。這不是 hard gate：一個 agency 仍可以提供 forecast evidence，但不再讓「分歧消失」被誤讀成與四機構完整 evidence 相若的信心。

這個 shadow hypothesis 目前仍把四個 agency 當作完整 coverage denominator，因此「expected-but-missing」與「legitimately unavailable/not applicable」仍未分開；在 promotion 前需要再驗證。

### 2. T3 / T8 遠期 checkpoint agency-participation 折減

只處理 **T3 / T8**，不套用到 T1。若 strongest checkpoint：

- lead time > 72h；而且
- 該 checkpoint 的 `totalAgencyCount` 少於整宗 case 當輪 `usableAgencyCount`，

V2 會連續折減 risk，而不是設定「至少 N 個機構」的硬門檻：

```text
checkpointParticipation = strongestCheckpoint.totalAgencyCount / usableAgencyCount
horizonBlend = clamp((leadHours - 72) / 48, 0, 1)
participationFactor = 1 - horizonBlend × (1 - checkpointParticipation) × 0.45
V2 risk = V1 risk × participationFactor
```

實作欄位仍沿用：

```text
supportCoverage
supportFactor
```

但它們在 Shadow 0.2 的實際意思是 **checkpoint participation/availability**。公式並沒有直接使用 `strongestCheckpoint.supportAgencyCount` 作 risk discount。

因此 +72h 附近幾乎不變；越接近 +120h、而同時可提供該 checkpoint 的 agency 越少，折減越明顯。

這項改動最初受 SAUDEL MB-02 啟發，現階段仍屬 SAUDEL-heavy hypothesis。它必須保持 shadow-only，直到獨立 normal-path cases 證明這個 participation discount 有一般價值。未來亦應另外研究「checkpoint participation」與「threshold-positive support fraction」是否需要分拆，而不是把兩者混稱為同一件事。

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

### 4. Terminal stale lifecycle decay（0.2 新增）

NARRA R2 顯示，普通 departure decay 不足以處理一種已結束 forecast lifecycle 的 residual risk：真實 final snapshot 的 `directDepart=0`，因此第 3 項規則不會啟動。

Shadow 0.2 加入另一個保守、generic 的 terminal lifecycle decay。只有全部條件同時成立才可啟動：

1. exactly one remaining source；
2. no forecast points；
3. 所有 remaining source evidence 已 stale 至少 12 小時；
4. 有明確 terminal intensity hint，例如 `Low Pressure Area`、`LPA`、`remnant low` 或 `dissipating`；
5. representative closest 已在過去；
6. future threat timeline 為空。

基礎 terminal penalty 為 22%，並按超過 12 小時 stale threshold 的程度連續增加，最高 32%。它和普通 departure penalty 可乘法疊加，但條件不同。

重要 counterexample：**stale alone 不足夠**。如果 remaining source 仍明確標示 active `Tropical Storm`，terminal decay 必須保持 0。

NARRA frozen regression fixture 中：

- V1 保留 T1 `possible`，risk 約 `0.4394`；
- ordinary departure penalty 為 0；
- terminal lifecycle penalty 啟動；
- V2 T1 降至 `unlikely`。

這只證明 generic fixture 行為符合設計，**不代表 NARRA 是 prospective V2 0.2 勝利**，因為 NARRA 當時沒有 contemporaneous 0.2 sequence。

### 5. Positive-but-no-window 改為明確 timing state

V2 0.2 **不捏造精確時間窗口**。當 likelihood 仍 positive 而 window 為 null 時，額外標示：

- `left-censored-or-horizon-limited` — 尚有 future timeline，但未看到 threshold crossing / 預報長度限制；
- `post-minimum-no-future` — 最近點已過且沒有 future timeline；
- `unresolved` — 暫未能定位；
- `estimated` — 已有正常 estimated window；
- `not-applicable` — signal 為 unlikely。

UI 會把這些狀態轉成簡短中文，例如「窗：起點不可見/受預報長度限制」。這先解決 MS-02 的解讀問題，而不是用假設時間補空值。

## V2 0.2 明確不做的事

- 不修改 `basic-hk-signal-forecast/v1`。
- 不修改 HKO truth / evaluator / closeout。
- 不把 V2 送入正式 scoring。
- 不使用事後 HKO outcome 調整 live V2。
- 不新增 probability / ML。
- 不把 Consensus Track 當成第五個 agency vote。
- 不把 HKO Local Wind observations 直接轉成 T1/T3/T8 risk。
- 不因 SAUDEL 的單一 snapshot 或特殊多段路徑立即再調參。
- 不加入 case-specific exception。

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

## Case interpretation policy

### GAENARI

用作 source-membership confidence 和 timing left-censoring 的一般性證據。GAENARI 是 possible-only transient false alarm，不應與 NARRA 26 個 `likely` false-positive snapshots 混為同一嚴重度。

### NARRA

R2 已完成。NARRA 提供：

- 26 個 genuine T1 `likely` false-positive snapshots；
- 兩個 terminal residual snapshots；
- T3/T8 correct-negative evidence。

NARRA 仍是 `OBSERVE MORE`，不單獨修改 V1 calibration。Terminal fixture 可測試 V2 0.2，但沒有 contemporaneous 0.2 corpus，不能回溯宣稱 V2 勝出。

### SAUDEL

SAUDEL 是 extreme-path / multi-phase stress case。其資料可用於：

- 觀察 phase semantics；
- 檢查 long-horizon participation hypothesis；
- 比較 forecast geometry、local wind、official signal state 與 AI situation interpretation。

但它不納入目前一般 V1/V2 calibration 結論，也不應再衍生 SAUDEL-shaped deterministic clauses。正常期間只保留 evidence；待 case 完整 closeout 後再作獨立 stress-case 總結。

## Freeze policy

在 cross-case evidence 未成熟前：

- V1 frozen；
- V2 0.2 frozen；
- correctness bug 可修；
- documentation / instrumentation correctness 可修；
- 不因單一 snapshot 再調公式或 coefficient；
- 所有 V1 / V2 差異先保存 evidence。

## 下一次全面 V1/V2 decision gate

下一輪正式 promotion / modify / write-off review，應至少具備更多 **normal-path** completed cases，並最好包含 ordinary HKO-issued positive case。統一比較：

1. T1/T3/T8 first-positive / first-likely lead；
2. max risk；
3. positive persistence；
4. withdrawal timing；
5. window / timing-state；
6. numeric confidence；
7. checkpoint participation 與真正 threshold-positive agency support；
8. false-negative cost；
9. false-positive severity；
10. 同一 immutable capture 下的 V1/V2 paired difference。

只以當時已保存的 prospective evidence + official truth 做 verification，禁止 future leakage。

在這個 gate 之前：

- 不 promotion V2；
- 不重調 V1；
- 不把 SAUDEL 當一般 calibration sample；
- 不因 NARRA 單一 false-positive case 改 T1 coefficients；
- 不因 NARRA 改 T3/T8。

## Implementation note

V2 Shadow 0.2 暫時實作在 `analysis/frontend-hk-threat-ui.js`，原因是 live/shadow 階段要最小化部署面：

- 不新增 production Worker / D1 依賴；
- 不修改 authoritative backend forecast contract；
- 不修改 V1 core；
- 不需要改 `index.html` script stack；
- 現有 service worker 對 same-origin JavaScript 採 network-first，可讓 shadow logic 更新而保留 offline fallback。

如果未來 cross-case review 決定保留 V2，才把 shadow logic 抽成獨立 analysis module、建立獨立 schema/version contract，並讓 evaluator 能在同一 immutable capture 上公平 score V1/V2。