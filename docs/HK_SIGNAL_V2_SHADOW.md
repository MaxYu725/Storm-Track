# HK Signal V2 Shadow

Status: **ACTIVE LIVE PARALLEL SHADOW 0.5 — V1 remains frozen evaluation baseline**

HK Signal V2 Shadow 與 frozen V1 使用同一批 as-issued HKO / CMA / JMA / CWA input，同步計算、同步顯示及同步保存。V2 目前不是正式 evaluator baseline；它的目標是以 prospective paired evidence 檢驗已知 V1 缺陷，同時保留 V1 作不變的 control。

目前 live frontend / recorder 使用：

`analysis/hk-signal-forecast-v2.js` → `hk-signal-shadow-v2/0.5`

Frontend integration：`frontend-hk-threat-ui/v3`

V2 不使用 HKO outcome 作 forecast input、不改 raw prospective evidence、不修改 V1 threshold / weighting、不輸出 calibrated probability，也不聲稱為香港天文台官方風球預測。

## V1 / V2 關係

```text
同一組 as-issued HKO / CMA / JMA / CWA input
  → storm-analysis-core
  → hk-impact-engine
  → hko-signal-risk-inputs
  → hk-threat-assessment
  → basic-hk-signal-forecast/v1
      ├─ V1 frozen display / evidence / evaluator baseline
      └─ hk-signal-forecast-v2.js / 0.5
           → V2 shadow display
           → 同一 prospective observation 額外保存
           → retrospective / prospective comparison
           → 暫不進正式 evaluator scoring
```

V2 engine 已由 frontend 內嵌 postprocessor 抽成獨立 module；live UI、Node regression、historical replay 和 recorder 都引用同一 deterministic engine，避免兩套 shadow logic 漂移。

## 為何發展到 0.5

已完成／已記錄案例暴露出不同類型的一般問題：

- **GAENARI / MB-01**：來源 membership / usability 收縮時，V1 numeric confidence 可能因 disagreement 消失而看似更高。
- **GAENARI / MS-02**：positive risk 可長時間存在但 `estimatedWindow=null`，需要 left-censored / horizon-limited timing semantics，而不是假裝沒有 timing issue。
- **NARRA**：普通 no-signal case 出現 26 個 T1 `likely`，顯示 broad physical T1 risk 與 operational `likely` readiness 不應完全等價；另有 terminal stale residual。
- **SAUDEL**：extreme multi-pass lifecycle 顯示單一 global closest、單一連續 phase 及遠期 minority-support interpretation 不足。
- **NOUL 2026 historical positive control**：用來檢查修正 false-positive tendency 時，有沒有同時破壞真正 T1/T3/T8 early-warning sensitivity。

這些案例只用來提出 generic hypotheses / verification；forecast 計算本身禁止讀取 later truth。

## V2 Shadow 0.5 主要 semantics

### 1. Phase-aware lifecycle

V2 從 future threat timeline 判斷目前 operational phase，包括：

- `approach`
- `departure`
- `quasi-stationary`
- `multi-phase`
- `departure-before-reapproach`

只有出現具 material magnitude、時間分離清楚的 **outward → inward turn** 才標示 multi-phase。單純因 global future minimum 在 +36h 之後，不足以構成 multi-phase。

輸出保留：

- current / near-term phase minimum
- later phase minimum
- phase peak
- global future minimum
- `globalMinimumBelongsToLaterPhase`

這是由 SAUDEL 暴露、但以 storm-agnostic 方式實作的 lifecycle correction；沒有 SAUDEL name / ID / date exception。

### 2. Source presence 與 analytic usability 分離

0.2 只有固定四機構 coverage factor。0.5 分開：

```text
presenceCoverage = presentAgencyCount / 4
usableWithinPresent = usableAgencyCount / presentAgencyCount
presenceConfidenceFactor = 0.72 + 0.28 × presenceCoverage
usabilityConfidenceFactor = 0.72 + 0.28 × usableWithinPresent
confidenceCoverageFactor = presenceConfidenceFactor × usabilityConfidenceFactor
```

因此「機構根本沒有 present」與「source present 但當輪不適合作 signal calculation」不再被視為完全相同的缺失。

這仍只影響 numeric confidence，不以 agency count hard-veto physical threat。

### 3. T3 / T8：checkpoint participation 與 positive support 分離

只套用 T3 / T8。對 >72h strongest checkpoint：

```text
participationFraction = checkpointAgencyCount / usableAgencyCount
positiveSupportFraction = supportAgencyCount / checkpointAgencyCount
horizonBlend = clamp((strongestLeadHours - 72) / 48, 0, 1)

evidenceWeakness = 0.45 × (1 - participationFraction)
                 + 0.55 × (1 - positiveSupportFraction)

longHorizonFactor = clamp(
  1 - horizonBlend × evidenceWeakness × 0.50,
  0.50,
  1
)
```

V2 risk 乘上 `longHorizonFactor`；confidence 亦有連續 support factor。沒有「至少 N 個 agency」硬門檻，因此仍容許少數機構真正捕捉 early exact-threat scenario。

SAUDEL 約 +119h CMA-heavy T3 evidence 是重要 stress example，但不是 case-specific rule。

### 4. T1 decision readiness：保留 possible，收緊 likely

NARRA 顯示 V1 broad T1 physical risk 可以過早進入 `likely`。直接提高 T1 possible threshold 會傷害 early-watch sensitivity，因此 V2 0.5 不這樣做。

V2 對原本 positive T1 建立第二層 `decisionReadinessIndex`，考慮：

- current distance proximity
- forecast minimum proximity
- strongest checkpoint lead credibility
- persistence maturity
- lifecycle phase

核心幾何 maturity 使用 smooth proximity 而非單一 distance cutoff；persistence 亦以連續函數增加成熟度。

`possible` 不會只因 readiness 未成熟而被刪除；主要作用是把缺乏 decision maturity 的 V1 `likely` 降回 `possible`。

現行 `likely` readiness floor：

`0.58`

這是 shadow calibration hypothesis，不是 HKO decision rule。

### 5. Post-minimum departure residual decay

只有在：

- representative closest 已過；
- `directDepart` 有支持；
- future threat timeline 已空，

才使用最高 40% 的連續 residual decay：

```text
hoursAfterMinimum = max(0, -minimumLeadHours)
lifecyclePenalty = directDepart
                 × hoursAfterMinimum / (hoursAfterMinimum + 12)
                 × 0.40
```

如果仍存在 later meaningful re-approach timeline，這個 no-future departure suppression 不應把後段 threat 一併抹掉。

### 6. Terminal stale lifecycle decay

用來處理 NARRA 類 forecast lifecycle 已結束但 V1 risk 殘留的情況。只有全部條件成立才啟動：

1. exactly one remaining source；
2. no forecast points；
3. source evidence stale 至少 12h；
4. intensity 明確是 terminal hint，例如 `Low Pressure Area`、`LPA`、`remnant low`、`dissipating`；
5. closest 已在過去；
6. future threat timeline 為空。

基礎 penalty 22%，按 stale 程度最高增至 32%。**Stale alone 不足夠**；如果仍標示 active Tropical Storm，terminal decay 必須為 0。

### 7. Timing / window semantics

V2 不捏造 HKO issuance time。正向 signal 可以有：

- `estimated`
- `later-phase-estimated`
- `left-censored-or-horizon-limited`
- `multi-phase-left-censored-or-horizon-limited`
- `post-minimum-no-future`
- `unresolved`
- `not-applicable`

如果存在 estimated window，V2 明確標示：

`windowRole = risk-evidence-window`

即：**風險證據窗，不是掛球／改球時間**。

## 0.5 retrospective evidence

PR #109 接入 live 之前，0.5 已重播 immutable prospective corpus。最近一次 merge 前 audit：

- recorder files：777
- replayed observations：1841
- stable cases：8

重點 paired behavior：

| Case | T1 V1 positive / likely | T1 V2 positive / likely | T3 positive V1→V2 | Multi-phase |
|---|---:|---:|---:|---:|
| SAUDEL | 515 / 214 | 461 / 179 | 303→277 | 6 |
| NARRA | 136 / 26 | 134 / 5 | 0→0 | 0 |
| TC2623 | 70 / 0 | 70 / 0 | 0→0 | 0 |
| five clean negative identities | 0 / 0 | 0 / 0 | 0→0 | 0 |

這不是 promotion score。它只證明 0.5 在已保存 as-issued corpus 上沒有把所有 positive risk 一刀切掉，同時明顯降低 NARRA 的 `likely` escalation。

## Historical positive control — NOUL 2026

0.5 audit 另外重播 70 個 as-issued CMA/NMC snapshots：

- usable agency set 嚴格保持 `['CMA']`；沒有用其他 agency 補缺；
- HKO truth 只在 forecast 全部生成後才作 verification；
- V1 / V2 都有 70/70 available forecasts。

結果：

| Signal | Official issue | V2 first positive | V2 first likely |
|---|---|---|---|
| T1 | 2026-07-24 12:40Z | 2026-07-22 21:00Z | 2026-07-24 06:00Z |
| T3 | 2026-07-25 05:20Z | 2026-07-22 21:00Z | 2026-07-24 15:00Z |
| T8 | 2026-07-25 14:10Z | 2026-07-23 09:00Z | 2026-07-25 09:00Z |

NOUL 的用途是 positive-sensitivity counterexample：V2 不能為了改善 NARRA 而變成「幾乎不報 positive」。目前 0.5 保留早期 possible channel，而 T1 likely 相比 V1 延後到更成熟階段。

## Live 0.5 activation

PR #109 已把 dedicated V2 0.5 engine 接入 live Beta；PWA shell 版本升至 3.3.12 並把 `analysis/hk-signal-forecast-v2.js` 加入 offline app shell。

Frontend integration regression 要求：對完全相同的 frozen inputs，`frontend-hk-threat-ui.js` 的 `buildShadowV2Forecast()` 必須與 dedicated engine `buildForecast()` deep-equal，避免 UI / recorder / retrospective replay 使用不同 V2。

首個 main post-merge prospective capture 已成功保存：

```text
sourceCommit = 5ca9c97dbb6d610b5e0a45112f7dfe693eb04ef0
engineVersions.ui = frontend-hk-threat-ui/v3
engineVersions.shadowForecastV2 = hk-signal-shadow-v2/0.5
analysis.shadowForecastV2.schemaVersion = hk-signal-shadow-v2/0.5
```

當輪 live group 是 KROVANH，四機構 source 均為 `ok`。因此 0.5 已不只是 retrospective candidate，而是開始累積真正 contemporaneous prospective evidence。

## Case interpretation policy

### GAENARI

用作 source membership / confidence 及 timing left-censoring 的一般證據。其 possible-only false-positive severity 不應與 NARRA `likely` sequence 混為一談。

### NARRA

R2 已完成。V1 的 26 個 T1 `likely` no-signal captures 保持 frozen control evidence。0.5 retrospective replay 把其中 21 個降回 possible、保留 5 個 likely；目前不再為追求 `5 → 0` 繼續硬壓 threshold，避免 outcome-fit。

### SAUDEL

SAUDEL 是 extreme-path / multi-phase stress case，可用於：

- phase semantics；
- long-horizon participation / positive-support diagnosis；
- source membership changes；
- withdrawal / timing semantics。

它不應單獨決定 normal-path calibration，也不應衍生 SAUDEL-shaped exception。

SAUDEL watch 仍保留 evidence。當 live visible group 已不是 SAUDEL 時，`matchedObservationCount=0` 是正確狀態，不可把其他風暴硬配回 SAUDEL 只為維持 watch 活躍。

### KROVANH

KROVANH 是 V2 0.5 live activation 後首個已確認 persisted capture。首輪 geometry 距港很遠且呈 departing，V1/V2 均為低風險；它的價值首先是驗證 live provenance / negative-control continuity，而不是提供調參依據。

## Freeze / quiet-window policy

### 有 materially HK-relevant live lifecycle 時

- V1 frozen；
- 當前 V2 candidate frozen；
- correctness / parser / identity / recorder / version-provenance bug 可修；
- documentation / instrumentation correctness 可修；
- 不因單一 live snapshot 改 coefficient / threshold / semantic rule。

### Quiet window

如果沒有 materially HK-relevant storm，可根據：

- 已完成案例中重複的一般缺陷；
- immutable prospective replay；
- historical as-issued positive / negative controls；
- deterministic counterexample tests，

主動發展下一個 V2 candidate，而不需要等待理想樣本數才開始所有工作。

新 candidate 一旦遇到 live HK-relevant lifecycle，就 freeze-and-observe。

## Prospective evidence contract

`hk-beta-prospective-observation/v1` schema 暫不改名。每個 observation 同時保存：

```text
analysis.basicForecast             # frozen V1
analysis.shadowForecastV2          # live V2
engineVersions.shadowForecastV2    # exact V2 version
```

既有 evaluator 繼續只讀 V1。V2 comparison 先由 paired capture / retrospective audit 進行，不影響 V1 grading history。

## V2 0.5 明確不做的事

- 不修改 `basic-hk-signal-forecast/v1`。
- 不修改 HKO truth / existing evaluator / closeout rubric。
- 不把 V2 自動 promotion 成 production decision model。
- 不使用 later official outcome 生成較早 forecast。
- 不新增 ML / probability output。
- 不把 Consensus Track 當第五個 agency vote。
- 不把 HKO Local Wind observations 直接轉成 T1/T3/T8 deterministic risk。
- 不加入 storm name / ID / date exception。
- 不為消滅最後幾個 retrospective false positive 而無 counterexample 地加硬門檻。

## 下一次全面 decision gate

待香港相關 storm lifecycle 全部完成、truth / closeout 足夠後，統一比較：

1. T1/T3/T8 first-positive / first-likely lead；
2. max risk；
3. positive persistence；
4. withdrawal timing；
5. timing / risk-window semantics；
6. numeric confidence；
7. source presence / usability；
8. checkpoint participation / positive support；
9. false-positive severity；
10. false-negative cost；
11. multi-phase lifecycle correctness；
12. 同一 immutable capture 下 V1/V2 paired difference。

只用 as-issued prospective evidence + verification truth；禁止 future leakage。

全面 review 才決定：

- KEEP V1 only；
- V2 繼續 shadow；
- 建立 V2 evaluator candidate；
- 修改下一個 V2 candidate；
- 或 write-off 某些 0.5 hypotheses。

## Implementation note

0.5 已完成先前預定的 architecture cleanup：shadow logic 位於 dedicated `analysis/hk-signal-forecast-v2.js`，而不是繼續堆在 frontend。

這仍然不需要修改 production Worker / D1。PWA frontend、prospective recorder、retrospective comparator、historical replay及 Node regression 都可以共用同一 deterministic module。

現階段不急於把 Observation Board 改成 V2 scoring dashboard；先保護 prospective comparability，待 post-storm review 再決定正式 comparison surface。
