# Storm Track

Storm Track 是一個以香港為中心的熱帶氣旋追蹤 PWA，整合 HKO、CMA/NMC、JMA、CWA 官方路徑，並提供多機構比較、歷史公報重播及實驗性的香港影響分析。

> 本 repository 的現行開發基準只有 `main`。舊 AI-xx、probe、已合併 feature/fix branch 不應再作為 implementation source。

## 現時狀態

### Production Storm Track

- Vanilla HTML/CSS/JS + Leaflet + PWA
- HKO / CMA / JMA / CWA 保持獨立來源，不作 silent substitution
- 顯示分析點、預報路徑、距港資訊、多機構比較及 Archive
- GitHub Pages 由 `main` 部署

Web App：<https://maxyu725.github.io/Storm-Track/>

### HK Signal Beta

HK Signal Beta 是 deterministic、可審計的實驗分析，不是香港天文台官方風球預測。

入口：<https://maxyu725.github.io/Storm-Track/?beta=hk-signal>

現行分析鏈：

```text
storm-analysis-core
  → hk-impact-engine
  → hko-signal-risk-inputs
  → hk-threat-assessment
  → basic-hk-signal-forecast/v1
      ├─ frozen V1 benchmark / evaluator baseline
      └─ HK Signal V2 Shadow 0.2
```

V1 仍維持 frozen：現行 evaluator、HKO truth attribution、closeout、歷史 prospective 成績全部繼續以 V1 為準，不因 live storm 即時改 threshold / weighting。

### HK Signal V2 Shadow

HK Signal V2 Shadow 已開始與 frozen V1 **同步計算、同步顯示、同步保存**，但目前只作 parallel shadow comparison，暫不進 evaluator / scoring，也不回饋或改寫 V1。

V2 Shadow 0.2 只針對已由 completed / prospective case 暴露的有限問題：

- source membership 減少時，numeric confidence 不應因 disagreement 消失而看似更高；
- T3 / T8 在 +72h 以後若 strongest checkpoint 集中於少數 agency，採連續折減而非 hard gate；
- 最近點已過、明顯離港且 future timeline 已空時，殘留 risk 可連續衰減；
- NARRA R2 後新增 terminal lifecycle decay：只有在單一來源、來源至少 12h stale、已無 forecast points、最近點已過、future timeline 已空，且來源明確標為 Low Pressure Area / LPA / dissipating / remnant low 等 terminal state 時才連續折減殘留 risk；stale 本身不會觸發；
- positive risk 但沒有 observable threshold crossing 時，明確標記 left-censored / horizon-limited timing，而不是捏造精確 window。

**NARRA (`STC-2026-JMA-TC2622`) R2 已正式結案。** 真實 replay 將 136 個 T1 positive 拆成 110 個 `possible`、26 個 `likely`，並只識別最後 2 個為 terminal residual。Evaluator 已分開 possible/likely severity；V1 維持 frozen，不因 NARRA 單例調 coefficient。V2 Shadow 0.2 已加入 generic terminal lifecycle decay，但 NARRA 沒有 contemporaneous V2 corpus，因此不得把這宗 case 宣稱為 prospective V2 勝出。完整交接：`docs/HK_SIGNAL_NARRA_R2.md`。

**SAUDEL (`STC-2026-JMA-TC2621`) 是首個重點 live V1/V2 comparison case。** 它曾出現約 +119h 的 T3 `possible`，strongest checkpoint 主要由 CMA 單一 120h endpoint 支持，非常適合觀察 V2 能否減少 long-horizon support concentration，又不犧牲真正的 early warning。

在香港附近仍有活躍風暴期間，V1 與 V2 Shadow 0.2 都暫時 freeze；correctness bug 可修，但不因 SAUDEL 或任何單一新 snapshot 再調參。待這一輪香港附近風暴全部消散／完成可用 closeout 後，再做一次統一 V1/V2 cross-case review 及架構整理。

詳細 contract、公式、SAUDEL 觀察問題及 post-storm 整理清單：`docs/HK_SIGNAL_V2_SHADOW.md`。

### Consensus Track Beta

Consensus Track Beta 已進入 `main`，是獨立於 HK Signal 的 app-computed 多機構共識路徑。

核心原則：

- HKO / CMA / JMA / CWA 先按 valid time 對齊，再計算 equal-weight consensus
- 預設 0–120h、6h sampling；至少 2 個機構才形成共識點
- 官方四機構路徑保持獨立，不被共識路徑改寫
- longitude interpolation 及 consensus mean 已處理 ±180° date line
- spread / interpolation provenance 只屬 diagnostics，不代表 calibrated confidence / probability
- 不使用 weighting / ML / probability cone
- HK Signal V1 / V2 Shadow 都不消費 Consensus Track output

在 `?beta=hk-signal` 的 **設定 → 實驗圖層 → 共識路徑 Beta** 可手動開啟；預設為 OFF。`consensus.html` 保留作 isolated force-on visual test entry。

Consensus Track 現階段的主線是 prospective evidence collection，不在單一 live storm 期間調整方法或權重。CT-1C 已把 read-only prospective diagnostics 加入現有 Observation Board，但不會因此打開 CT-2 skill gate。

正式 CT-0 → CT-X evidence-gated roadmap：`docs/CONSENSUS_TRACK_ROADMAP.md`。後續階段不是必須逐級完成的 checklist；只有前一 evidence gate 真正滿足才進入下一階段。

### Observation Board

Observation Board 只讀 HK Signal 與 Consensus Track 的 prospective recorder evidence，用於觀察模型／共識路徑活動；不讀 evaluator 成績作校準，也不把 diagnostics 當成 forecast skill。

入口：<https://maxyu725.github.io/Storm-Track/observation.html>

HK Signal 主要觀察：

- frozen V1 T1 risk / confidence / persistence
- V1 T1 window movement
- agency spread / timing disagreement
- closest distance / lead time
- 各機構最新 input / movement diagnostics

V2 Shadow 現階段直接在 live storm card 與同一 prospective observation 中保存；現有 Observation Board 的既有圖表仍以 V1 為基準，避免 active-storm 期間大幅重構觀察頁。Post-storm review 若決定保留 V2，再統一整理 Observation Board 的 V1/V2 comparison surface。

Consensus Track 主要觀察：

- stable case ID、最新 capture 與 reference valid time
- continuous supported horizon / consensus point count
- exact +24 / +48 / +72 / +96 / +120h consensus availability
- 各 exact target lead 的 agency count / spread
- participating agencies
- capture timeline
- successive consensus movement，但只在前後兩輪都存在的**相同 exact valid time**計算；沒有共同 valid time 時保持 unavailable

CT Observation 不讀 verification truth / evaluator，不計 track error，不排名機構，不產生 probability / calibrated confidence，也不修改 CT-0。

### Prospective validation

HK Signal 現行驗證流程已形成閉環：

```text
live Beta forecast
  → prospective recorder
  → stable storm case identity
  → HKO warning truth recorder
  → T1 / T3 / T8 evaluator
  → no-signal closeout when applicable
```

Raw observations 與 HKO truth 保持 immutable；evaluation / closeout 屬 derived output。

V2 Shadow 不建立另一套 raw corpus：新的 `hk-beta-prospective-observation/v1` observation 在原有 `analysis.basicForecast` V1 旁額外保存 `analysis.shadowForecastV2`，並保留 V2 engine version。既有 evaluator 繼續只讀 V1，因此可在同一 capture 上公平比較而不改變 V1 成績語意。

Consensus Track 另有獨立 prospective recorder。新 capture 使用 `storm-consensus-track-prospective/v2`：保存 derived consensus coordinates、valid time、參與機構、spread、provenance，以及不含座標的 agency source references（source ID、bulletin/base/valid times、point counts）；仍不保存各機構逐點 raw coordinates，也不在 capture 階段評估 forecast skill。舊 v1 snapshots 保持可讀、不改寫。

Consensus Track stable case identity 重用 `storm-case-identity/v1`，透過 CT adapter 由完整 prospective corpus 產生 derived `case-registry.json` / `case-index.ndjson`。Generic TD 可先用已保存的 consensus lead-0 位置維持 physical continuity；一旦新 v2 capture 有 source ID，後續 generic → named transition 以 source overlap 鎖定同一 case。Snapshot 本身保持 immutable。

### Consensus Track verification readiness

CT-1B read-only audit 已完成。最新 production CT v2 snapshot 的 13/13 source references 都能透過 D1 同機構 `aliases[].agency_storm_id` 找回 storm identity，但**現有 Archive 尚不足以支援 CT-2 homogeneous skill verification**：

- same-cycle join within 3h：0/13
- 明確 stale Archive cycles：10/13
- JMA advisory stream ambiguous：3/13（同一 D1 storm row 可有多個 JMA EventID，但 advisory 只保存 WMO product code）
- nearest-cycle median Archive lag：675 分鐘
- 167 個 valid-time contribution targets 中，0 個可在同一 as-issued cycle 下安全重建

因此 CT-2 gate 現時 **CLOSED**。不會擴大時間 tolerance、用較舊公報替代、或把 0% reconstruction 解讀成 CT forecast skill。這是 Archive/evidence completeness blocker，不是 equal-weight CT-0 算法結論。

為避免往後的 as-issued baseline 再流失，現行安全 remediation 是獨立 **Prospective Agency Baseline Recorder**，不修改未 versioned 的 production Worker / D1。Baseline schema 為 `storm-agency-baseline-prospective/v1`，只保存：

- agency / source ID / source token / bulletin time
- latest valid analysis point
- as-issued forecast valid time、可用的 base time / forecast hour、lat/lon
- 當 capture 時可由現有 CT `case-registry.json` 精確 source-token resolve 的 case ID
- immutable capture / cycle fingerprints

它不保存完整歷史 analysis track、intensity fields、verification truth、consensus output、forecast error、ranking 或 weighting。Case identity 暫未 resolve 時亦不會丟棄 forecast evidence。

這個新 evidence stream 只解決**未來資料保存**，不會回填舊 D1 Archive，也不會自動打開 CT-2；仍需累積完成案例與 matching verification truth。

詳細 audit contract / evidence：`docs/CONSENSUS_TRACK_VERIFICATION_READINESS.md`。

相關 data-only branches：

- `data/beta-prospective-observations`
- `data/hko-warning-truth`
- `data/hk-signal-evaluations`
- `data/consensus-track-prospective-observations`
- `data/agency-baseline-prospective-observations`

## Historical replay

Historical replay 只允許使用 cutoff 當時已發布的 forecast input，禁止使用事後 Best Track 或未來公報回填較早 snapshot。

現時保留兩個 case manifest：

- `historical/cases/2026-noul.json` — 已有可重播的 CMA/NMC as-issued forecast snapshots
- `historical/cases/2025-ragasa.json` — manifest 保留；現有 CMA 歷史資料不足以重建同等 forecast stream

Historical replay 目前用作 stress test / diagnosis，不作自動調參。

## Wind field

模式風場／動畫風場屬獨立 experimental layer。它可以與 Storm Track UI 整合，但目前不屬 HK Signal forecast input，也不應因視覺效果改變現行 validation semantics。

風場研究若需要大幅改動，應保持獨立 branch / PR，確認穩定後才考慮 mainline integration。

## Repository map

```text
index.html                 主 PWA / live storm UI
consensus.html             Consensus Track isolated visual Beta entry
observation.html           HK Signal + Consensus Track read-only observation board
analysis/                  現行 deterministic analysis / observation modules
scripts/                   recorder / evaluator / historical replay / read-only audit / UI smoke scripts
historical/cases/          historical case manifests
tests/                     deterministic regression tests
.github/workflows/         active deployment / recording / evaluation CI
docs/HK_SIGNAL_V2_SHADOW.md
                           V1/V2 parallel shadow contract、SAUDEL live comparison、post-storm review plan
docs/CONSENSUS_TRACK_ROADMAP.md
                           CT-0 → CT-X evidence-gated roadmap
docs/CONSENSUS_TRACK_VERIFICATION_READINESS.md
                           CT-1B Archive join audit / CT-2 gate evidence
docs/HK_SIGNAL_POST_CASE_REVIEW.md
                           HK Signal 結案備查與統一 review checklist
docs/HK_SIGNAL_NARRA_R2.md
                           NARRA R2 closeout、evaluator severity breakdown、V2 0.2 terminal lifecycle learning
docs/WEATHER_APP_INTEGRATION.md
                           Weather App integration contract
```

## Active workflows

保留的 workflow 只有仍有實際用途的流程：

- Pages deployment
- HK Signal Beta regression validation（包括 V1/V2 shadow regression、Observation Board / CT-1C browser smoke）
- HK Signal prospective recorder（同一 observation 保存 V1 + V2 Shadow）
- HKO warning truth recorder
- HK Signal evaluator / closeout（仍只評 V1）
- Consensus Track live dry-run / visual regression
- Consensus Track prospective recorder + stable case reconciliation
- CT-1B read-only verification-readiness audit
- Prospective agency forecast baseline recorder
- historical case replay inputs

已完成使命的一次性 feasibility / probe workflow 不應重新加入 main。

## Legacy / withdrawn work

早期 AI-xx 系列曾建立大量 backfill、training、calibration、candidate、runtime probe 等實驗。部分概念已被現行 deterministic validation pipeline 重用，但舊 branch 本身已不是現行架構。

狀態規則：

- **Current** — `main` 及上述 data branches
- **Experimental** — 明確標示的獨立研究 branch，例如 wind-field work，以及 HK Signal V2 Shadow
- **Archived** — `archive/legacy-ai-xx-20260822`，只供需要追查舊實驗時參考
- **Withdrawn / write-off** — 舊 `ai*`、`*-probe`、重複 identity fix、已合併 feature/fix branch；不要從中恢復程式到 production

PR #35 已正式 withdrawn，不應合併。

## Development rules

1. **先用現有能力。** 不因新問題立即建立新的 AI 編號或平行框架。
2. **遇到同一路線反覆失敗就換方法。** 不在同一位置不斷增加例外規則、fallback 與限制。
3. **Correctness bug 可以立即修。** Parser、identity、timezone、future leakage、recorder 等資料問題不需要等待模型驗證完成。
4. **Active live case 期間保持版本穩定。** V1 frozen；V2 Shadow 0.2 上線後亦 freeze。新 snapshot 用來比較，不用來逐輪追著 truth 調參。
5. **保持 agency independence。** 缺來源就是缺來源，不以其他機構靜默代替。
6. **Forecast 與 truth 分離。** Official outcome 只能用於 verification，不能回餵較早 forecast snapshot。
7. **Backend source integrity 優先。** 未確認 authoritative backend source 前，不從舊 Git history 猜測或恢復 production backend。
8. **小 PR、可回退。** 一個 PR 解一個清楚問題；完成後停止擴張 scope。
9. **候選模型必須能與 baseline 同時比較。** V2 不先覆蓋 V1；只有完成 cross-case review 後才決定 promotion、繼續 shadow 或 write-off。

## 下一步

目前 HK Signal 主線改為 **frozen V1 + V2 Shadow 0.2 parallel prospective comparison**：

- 持續收集 HK Signal live prospective evidence，同一 capture 保存 V1 + V2 Shadow
- NARRA R2 已 CLOSED：保留 26 個 T1 `likely` no-signal snapshots 作跨案例 calibration evidence；不再增加 NARRA-specific rule，只有獨立完成案例重複相同模式才重開 T1 calibration
- V2 Shadow 0.2 已加入 generic terminal lifecycle decay；下一步只作 prospective cross-case observation，確認其他案例是否重現 single stale terminal source + no forecast + post-minimum residual T1
- 以 SAUDEL 為首個重點 V1/V2 comparison case，特別觀察 T3 long-horizon single-agency support、後續多機構收斂、source membership、withdrawal 及 timing semantics
- 活躍風暴期間不再調 V2 0.2 coefficient；只修 correctness bug
- HKO truth / evaluator / closeout 繼續只評 frozen V1，避免改變已建立的 prospective grading contract
- 香港附近這一輪風暴全部消散／完成足夠 closeout 後，按 `docs/HK_SIGNAL_V2_SHADOW.md` + `docs/HK_SIGNAL_POST_CASE_REVIEW.md` 做一次全面 V1/V2 cross-case review
- 全面 review 才決定：KEEP V1、保留／修改 V2、正式 evaluator candidate、或 write-off；同時整理臨時 V1/V2 UI / module / recorder 結構
- 持續收集 Consensus Track v2 derived prospective forecasts與 stable case identity
- 持續收集 HKO / CMA / JMA / CWA as-issued prospective agency baselines，避免 CT-2 必需 evidence 再流失
- 使用 CT-1C Observation Board 觀察 supported horizon、target-lead agency count/spread 及 exact-common-valid-time 路徑移動，但不要把這些 diagnostics 解讀成 skill
- **CT-2 暫停**：目前 D1 Archive 無法重建與 CT v2 同一 as-issued agency cycles；禁止以 10–18 小時較舊公報代替
- Prospective agency baseline recorder 只補未來 evidence；仍需完成案例及 verification truth 才可重新檢查 CT-2 gate
- 未取得 authoritative production Worker source 前不可從舊 Git history 還原 production Worker；若未來要修 Archive ingest，必須先取得／重建 authoritative source
- 只有累積多個完成 case，而且 CT forecast / agency as-issued forecast / verification truth 能 homogeneous pairing，才重開 **CT-2 +24/+48/+72/+96/+120h skill verification**
- weighting 屬 CT-3 conditional research；沒有跨案例穩定 skill difference 就不做
- ECMWF IFS/AIFS 屬 CT-4 separate model-family research，不作第五個 agency vote
- ML / probability / own-model work 留在 CT-X backlog，非 active roadmap

Weather App integration 與 wind-field animation 可以平行研究，但不應阻塞或改寫 HK Signal validation pipeline。

---

Storm Track 的分析結果只供實驗與研究用途；熱帶氣旋警告及安全決策應以官方資訊為準。
