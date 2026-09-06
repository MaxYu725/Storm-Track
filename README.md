# Storm Track

Storm Track 是一個以香港為中心的熱帶氣旋追蹤 PWA，整合 HKO、CMA/NMC、JMA、CWA 官方路徑，並提供多機構比較、歷史公報重播、Prospective validation、Consensus Track Beta 及實驗性的香港影響分析。

> 本 repository 的現行開發基準只有 `main`。舊 AI-xx、probe、已合併 feature/fix branch 不應再作為 implementation source。

## 現時狀態

### Production Storm Track

- Vanilla HTML/CSS/JS + Leaflet + PWA
- HKO / CMA / JMA / CWA 保持獨立來源，不作 silent substitution
- 顯示分析點、預報路徑、距港資訊、多機構比較及 Archive
- GitHub Pages 由 `main` 部署
- Production Storm Worker：`https://storm.max-yu.workers.dev`
- repository **沒有 authoritative production Worker source**；未取得／重建 authoritative source 前，不得從舊 Git history 猜測或恢復 Worker 再部署

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
      └─ hk-signal-forecast-v2.js
           → HK Signal V2 Shadow 0.5
```

V1 仍維持 frozen：現行 evaluator、HKO truth attribution、closeout、歷史 prospective 成績全部繼續以 V1 為準，不因 live storm 即時改 threshold / weighting。

### HK Signal V2 Shadow

**V2 Shadow 0.5 已於 PR #109 接入 live Beta，與 frozen V1 同步計算、同步顯示、同步保存。** 它仍只作 parallel shadow comparison，暫不進 evaluator / scoring，也不回饋或改寫 V1。

現行 frontend / recorder 使用獨立 deterministic engine：

`analysis/hk-signal-forecast-v2.js` → `hk-signal-shadow-v2/0.5`

V2 0.5 主要修正方向：

- phase-aware lifecycle：真正的 outward → inward turn 才視為 multi-phase，避免把全預報期 global closest 當成單一連續接近；
- source presence 與 analytic usability 分開影響 numeric confidence；
- T3 / T8 的遠期 evidence 分開 checkpoint participation 與 threshold-positive support，採連續折減而非 hard gate；
- T1 保留 broad `possible` early-warning sensitivity，但 `likely` 另加 geometry / lead-time / persistence maturity 的 decision-readiness；
- 最近點已過、離港且 future timeline 已空時，殘留 risk 可連續衰減；
- single stale terminal source + no forecast + terminal intensity hint 的 lifecycle residual 可額外衰減；
- positive risk 但無 observable threshold crossing 時保留 explicit timing state，不捏造精確 window；
- estimated window 明確是 **risk-evidence window，不是 HKO 掛球／改球時刻**。

V2 0.5 在接入 live 前已重播 immutable prospective corpus。最新 merge 前 audit 使用 **777 recorder files / 1841 observations / 8 stable cases**：

- SAUDEL：T1 V1 `515 positive / 214 likely` → V2 `461 / 179`；T3 positive `303 → 277`；multi-phase detector 只識別 6 個 snapshots；
- NARRA：T1 V1 `136 / 26` → V2 `134 / 5`，主要把 21 個 `likely` 降為 `possible`，而不是把 broad T1 early warning 全部刪除；
- TC2623：70 個 T1 positive 全部保留、沒有新增 likely；
- 其餘五個 clean negative identities 在該 replay 仍保持 T1/T3 0 positive。

另以 **NOUL 2026** 作 historical positive-signal control：70 個 as-issued CMA/NMC snapshots 全部可用，且 forecast generation 只使用當時已發布的 CMA input；HKO truth 在 forecast 完成後才用於 verification。V2 保留 T1/T3/T8 early-positive sensitivity，其中 T1 `likely` 相比 V1 延後至更接近 HKO 實際發出時間。這只屬 validation evidence，不作自動 calibration。

PR #109 merge 後，首個 production Pages recorder capture 已成功保存 `frontend-hk-threat-ui/v3` 及 `hk-signal-shadow-v2/0.5`，證明 live UI、recorder 與 dedicated V2 engine 已對齊。現時 live case 是 KROVANH；SAUDEL watch 已沒有 matched observation，但歷史 watch evidence 保留。

**NARRA (`STC-2026-JMA-TC2622`) R2 已正式結案。** V1 的 26 個 T1 `likely` no-signal snapshots 繼續保留作 control evidence；不得因回看 outcome 直接改 V1。完整交接：`docs/HK_SIGNAL_NARRA_R2.md`。

**SAUDEL (`STC-2026-JMA-TC2621`) 仍視為 extreme-path / multi-phase stress case。** 它對 phase semantics、遠期 T3 support concentration、source membership 及 lifecycle handling 很有價值，但不應單獨決定一般 calibration。

在香港相關 live storm lifecycle 期間，V1 與當前 V2 0.5 candidate 都 freeze；correctness / instrumentation / documentation bug 可修，但不因單一新 snapshot 再調 coefficient。待相關風暴完成 closeout 後，再統一 V1/V2 cross-case review。

詳細 contract、公式、case interpretation 及 decision gate：`docs/HK_SIGNAL_V2_SHADOW.md`。

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

Consensus Track 現階段的主線是 prospective evidence collection，不在單一 live storm 期間調整方法或權重。**CT-1C 已把 read-only prospective diagnostics 加入現有 Observation Board**，但不會因此打開 CT-2 skill gate。

正式 CT-0 → CT-X evidence-gated roadmap：`docs/CONSENSUS_TRACK_ROADMAP.md`。後續階段不是必須逐級完成的 checklist；只有前一 evidence gate 真正滿足才進入下一階段。

### Observation Board

Observation Board 只讀 HK Signal 與 Consensus Track 的 prospective recorder evidence，用於觀察模型／共識路徑活動；不讀 evaluator 成績作校準，也不把 diagnostics 當成 forecast skill。

入口：<https://maxyu725.github.io/Storm-Track/observation.html>

HK Signal 現有圖表仍以 frozen V1 為主，觀察：

- T1 risk / confidence / persistence
- T1 window movement
- agency spread / timing disagreement
- closest distance / lead time
- 各機構最新 input / movement diagnostics

V2 0.5 直接在 live storm card 及同一 prospective observation 保存。Active-storm 期間不為了 UI 完整性大改 Observation Board；全面 review 後才決定是否建立正式 V1/V2 scoring surface。

Consensus Track 主要觀察：

- stable case ID、最新 capture 與 reference valid time
- continuous supported horizon / consensus point count
- exact +24 / +48 / +72 / +96 / +120h consensus availability
- 各 exact target lead 的 agency count / spread
- participating agencies
- successive consensus movement，但只在前後兩輪都存在的**相同 exact valid time**計算

CT Observation 不讀 verification truth / evaluator，不計 track error，不排名機構，不產生 probability / calibrated confidence，也不修改 CT-0。

## Prospective validation

HK Signal 現行驗證流程：

```text
live Beta forecast
  → prospective recorder
  → stable storm case identity
  → HKO warning truth recorder
  → T1 / T3 / T8 evaluator
  → no-signal closeout when applicable
```

Raw observations 與 HKO truth 保持 immutable；evaluation / closeout 屬 derived output。

V2 Shadow 不另建 raw corpus：`hk-beta-prospective-observation/v1` 在 `analysis.basicForecast` V1 旁保存：

```text
analysis.shadowForecastV2
engineVersions.shadowForecastV2
```

既有 evaluator 繼續只讀 V1，因此同一 capture 可公平比較 V1/V2，而不改變已累積的 V1 grading semantics。

相關 data-only branches：

- `data/beta-prospective-observations`
- `data/hko-warning-truth`
- `data/hk-signal-evaluations`
- `data/consensus-track-prospective-observations`
- `data/agency-baseline-prospective-observations`
- `data/hko-local-wind-shadow`
- `data/hk-situation-analysis-prospective-audits`

### SAUDEL watch

`docs/SAUDEL_PROSPECTIVE_WATCH.md` 定義獨立 evidence-preservation watch。它保留 SAUDEL / TC2621 的特殊 identity、來源缺席及 lifecycle evidence，不改 V1 evaluator。當 watch target 不再出現在 live groups 時，matched observation 可為 0；這是有效狀態，不應為了保持 SAUDEL 可見而錯配目前其他風暴。

## Historical replay

Historical replay 只允許使用 cutoff 當時已發布的 forecast input，禁止使用事後 Best Track 或未來公報回填較早 snapshot。

現時 case manifest：

- `historical/cases/2026-noul.json` — 可重播 CMA/NMC as-issued forecast snapshots，亦已納入 V2 0.5 positive-control audit
- `historical/cases/2025-ragasa.json` — manifest 保留；現有 CMA 歷史資料不足以重建同等 forecast stream

Historical replay 用作 stress test / diagnosis / verification，不作自動調參。

## Consensus Track verification readiness

CT-1B read-only audit 已證明現有 D1 Archive 尚不足以支援 CT-2 homogeneous skill verification。此前 production CT v2 audit 中，source references 雖可找到 storm identity，但 same-cycle reconstruction 幾乎不存在；這是 Archive/evidence completeness blocker，不是 equal-weight CT-0 算法失敗。

現行 remediation 是獨立 **Prospective Agency Baseline Recorder**，只保存未來 as-issued agency evidence，不修改未 versioned production Worker / D1，也不自動打開 CT-2。

詳細：`docs/CONSENSUS_TRACK_VERIFICATION_READINESS.md`。

## Wind field / AI situation analysis

模式風場／動畫風場屬獨立 experimental layer。它可與 UI 整合，但目前不屬 HK Signal deterministic forecast input。

AI situation analysis 亦是獨立 shadow interpretation layer，不可反向改寫 frozen V1、V2 deterministic risk 或 HKO truth。其 evidence / inference / prospective audit 使用獨立 data stream。

## Repository map

```text
index.html                         主 PWA / live storm UI
consensus.html                     Consensus Track isolated visual Beta entry
observation.html                   read-only observation board
analysis/basic-hk-signal-forecast.js
                                   frozen V1
analysis/hk-signal-forecast-v2.js  live V2 0.5 shadow engine
analysis/frontend-hk-threat-ui.js  live V1/V2 Beta integration + recorder surface
scripts/                           recorder / evaluator / historical replay / audits
historical/cases/                  historical case manifests
tests/                             deterministic regression tests
.github/workflows/                 deployment / recording / validation / evaluation CI
docs/HK_SIGNAL_V2_SHADOW.md        current V1/V2 shadow contract
docs/HK_SIGNAL_POST_CASE_REVIEW.md cross-case review checklist
docs/HK_SIGNAL_NARRA_R2.md         NARRA closeout evidence
docs/SAUDEL_PROSPECTIVE_WATCH.md   SAUDEL special-case evidence watch
docs/CONSENSUS_TRACK_ROADMAP.md    CT evidence-gated roadmap
```

## Active workflows

主要保留：

- Pages deployment
- HK Signal Beta regression validation
- V2 retrospective corpus / historical positive-control audit
- HK Signal prospective recorder（同一 observation 保存 V1 + V2）
- HKO warning truth recorder
- HK Signal evaluator / closeout（仍只評 V1）
- Consensus Track prospective recorder + stable case reconciliation
- CT read-only verification-readiness audit
- Prospective agency forecast baseline recorder
- historical replay inputs / audits
- approved experimental shadow recorders（例如 local wind / situation analysis）

已完成使命的一次性 feasibility / probe workflow 不應重新加入 main。

## Legacy / withdrawn work

早期 AI-xx 系列曾建立大量 backfill、training、calibration、candidate、runtime probe 等實驗。部分概念已被現行 deterministic validation pipeline 重用，但舊 branch 本身已不是現行架構。

狀態規則：

- **Current** — `main` 及上述 data branches
- **Experimental** — 明確標示的 shadow / research work
- **Archived** — `archive/legacy-ai-xx-20260822`，只供追查舊實驗
- **Withdrawn / write-off** — 舊 `ai*`、`*-probe`、重複 identity fix、已合併 feature/fix branch；不要從中恢復程式到 production

PR #35 已正式 withdrawn，不應合併。

## Development rules

1. **先用現有能力。** 不因新問題立即建立新的 AI 編號或平行框架。
2. **遇到同一路線反覆失敗就換方法。** 不在同一位置無限增加 exception、fallback 與限制。
3. **Correctness bug 可以立即修。** Parser、identity、timezone、future leakage、recorder、版本對齊等資料問題不需要等待模型驗證完成。
4. **Live case 期間保持候選版本穩定。** V1 frozen；V2 0.5 live shadow 上線後，在香港相關 storm lifecycle 期間 freeze。新 snapshot 用來比較，不用來逐輪追著 truth 調參。
5. **Quiet window 可主動開發。** 沒有 materially HK-relevant storm 時，可根據已證實的一般缺陷、immutable replay、counterexample regression 主動修訂 V2；不必因樣本未達理想數量而完全停工。
6. **保持 agency independence。** 缺來源就是缺來源，不以其他機構靜默代替。
7. **Forecast 與 truth 分離。** Official outcome 只能用於 verification，不能回餵較早 forecast snapshot。
8. **Backend source integrity 優先。** 未確認 authoritative backend source 前，不從舊 Git history 猜測或恢復 production backend。
9. **小 PR、可回退。** 一個 PR 解一個清楚問題；避免把多個 unrelated subsystem 一次改動。
10. **候選模型必須與 baseline 同時比較。** V2 不先覆蓋 V1；只有 cross-case review 後才決定 promotion、繼續 shadow、修改或 write-off。
11. **避免過度綁死 gate。** Threshold / sample-count / promotion rule 應保持可解釋、可調整，不再以早期過度嚴格限制阻塞安全的實證迭代。

## 下一步

HK Signal 主線現為：

**V1 = frozen benchmark · V2 0.5 = live shadow candidate · active live periods = freeze-and-observe**

- 持續收集同一 capture 的 V1 + V2 0.5 prospective evidence
- 現時 KROVANH 的首個 post-merge capture 已證明 0.5 provenance 正常；不因它單一 snapshot 調參
- HKO truth / evaluator / closeout 繼續只評 V1
- SAUDEL 保留作 extreme-path stress evidence，不納入單一一般 calibration 結論
- 待香港相關 storm lifecycle 完成及 closeout/truth 足夠後，按 `docs/HK_SIGNAL_V2_SHADOW.md` + `docs/HK_SIGNAL_POST_CASE_REVIEW.md` 做全面 V1/V2 review
- 全面 review 才決定：保留 V1、把 V2 送入 evaluator candidate、修改 V2、或 write-off；同時整理 Observation Board / schema / recorder comparison surface
- Consensus Track 繼續收集 v2 derived prospective forecasts 與 as-issued agency baseline；CT-2 仍要等 homogeneous forecast/truth pairing 才重開
- weighting、ECMWF model-family、ML/probability/own-model 仍屬 conditional research，不在沒有 evidence gate 時提前啟動

Weather App integration、wind-field animation、AI situation analysis可以平行研究，但不應阻塞或改寫 HK Signal validation pipeline。

---

Storm Track 的分析結果只供實驗與研究用途；熱帶氣旋警告及安全決策應以官方資訊為準。
