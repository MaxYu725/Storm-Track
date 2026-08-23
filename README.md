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
  → basic-hk-signal-forecast
```

目前模型維持 frozen v1，以 prospective evidence 驗證為主；沒有足夠跨案例證據前，不因單一風暴結果調整 threshold / weighting。

### Consensus Track Beta

Consensus Track Beta 已進入 `main`，是獨立於 HK Signal v1 的 app-computed 多機構共識路徑。

核心原則：

- HKO / CMA / JMA / CWA 先按 valid time 對齊，再計算 equal-weight consensus
- 預設 0–120h、6h sampling；至少 2 個機構才形成共識點
- 官方四機構路徑保持獨立，不被共識路徑改寫
- longitude interpolation 及 consensus mean 已處理 ±180° date line
- spread / interpolation provenance 只屬 diagnostics，不代表 calibrated confidence / probability
- 不使用 weighting / ML / probability cone
- HK Signal v1 不消費 Consensus Track output

在 `?beta=hk-signal` 的 **設定 → 實驗圖層 → 共識路徑 Beta** 可手動開啟；預設為 OFF。`consensus.html` 保留作 isolated force-on visual test entry。

Consensus Track 現階段的主線是 prospective evidence collection，不在單一 live storm 期間調整方法或權重。

### Observation Board

Observation Board 只讀 prospective recorder 原始紀錄，用於觀察模型活動，不讀 evaluator 成績、不作校準。

入口：<https://maxyu725.github.io/Storm-Track/observation.html>

主要觀察：

- T1 risk / confidence / persistence
- T1 window movement
- agency spread / timing disagreement
- closest distance / lead time
- 各機構最新 input / movement diagnostics

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

Consensus Track 另有獨立 prospective recorder，只保存 derived consensus coordinates、valid time、參與機構、spread 與 provenance；不保存各機構逐點 raw coordinates，也不在 capture 階段評估 forecast skill。未來只有累積跨風暴樣本後，才做 24/48/72/96/120h homogeneous skill verification。

相關 data-only branches：

- `data/beta-prospective-observations`
- `data/hko-warning-truth`
- `data/hk-signal-evaluations`
- `data/consensus-track-prospective-observations`

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
observation.html           HK Signal observation-only board
analysis/                  現行 deterministic analysis modules
scripts/                   recorder / evaluator / historical replay scripts
historical/cases/          historical case manifests
tests/                     deterministic regression tests
.github/workflows/         active deployment / recording / evaluation CI
docs/HK_SIGNAL_POST_CASE_REVIEW.md
                           HK Signal 結案備查與統一 review checklist
docs/WEATHER_APP_INTEGRATION.md
                           Weather App integration contract
```

## Active workflows

保留的 workflow 只有仍有實際用途的流程：

- Pages deployment
- HK Signal Beta regression validation
- HK Signal prospective recorder
- HKO warning truth recorder
- HK Signal evaluator / closeout
- Consensus Track live dry-run / visual regression
- Consensus Track prospective recorder
- historical case replay inputs

已完成使命的一次性 feasibility / probe workflow 不應重新加入 main。

## Legacy / withdrawn work

早期 AI-xx 系列曾建立大量 backfill、training、calibration、candidate、runtime probe 等實驗。部分概念已被現行 deterministic validation pipeline 重用，但舊 branch 本身已不是現行架構。

狀態規則：

- **Current** — `main` 及上述 data branches
- **Experimental** — 明確標示的獨立研究 branch，例如 wind-field work
- **Archived** — `archive/legacy-ai-xx-20260822`，只供需要追查舊實驗時參考
- **Withdrawn / write-off** — 舊 `ai*`、`*-probe`、重複 identity fix、已合併 feature/fix branch；不要從中恢復程式到 production

PR #35 已正式 withdrawn，不應合併。

## Development rules

1. **先用現有能力。** 不因新問題立即建立新的 AI 編號或平行框架。
2. **遇到同一路線反覆失敗就換方法。** 不在同一位置不斷增加例外規則、fallback 與限制。
3. **Correctness bug 可以立即修。** Parser、identity、timezone、future leakage、recorder 等資料問題不需要等待模型驗證完成。
4. **模型變更需要跨案例證據。** Live case 期間不因單次 risk/window 表現調參。
5. **保持 agency independence。** 缺來源就是缺來源，不以其他機構靜默代替。
6. **Forecast 與 truth 分離。** Official outcome 只能用於 verification，不能回餵較早 forecast snapshot。
7. **Backend source integrity 優先。** 未確認 authoritative backend source 前，不從舊 Git history 猜測或恢復 production backend。
8. **小 PR、可回退。** 一個 PR 解一個清楚問題；完成後停止擴張 scope。

## 下一步

目前主線不是增加新模型功能，而是：

- 持續收集 HK Signal live prospective evidence
- 持續收集 Consensus Track derived prospective forecasts
- 使用 Observation Board 觀察不同風暴的 HK Signal 模型活動
- 在出現正式 HKO outcome / closeout 後產生 HK Signal v1 diagnosis
- Consensus Track 累積跨風暴樣本後才比較 24/48/72/96/120h forecast skill；沒有足夠樣本前不引入 weighting / ML
- 結案時統一按 `docs/HK_SIGNAL_POST_CASE_REVIEW.md` 檢查已記錄現象
- 只有多個獨立案例顯示一致偏差時，才考慮 v2 candidate / shadow comparison

Weather App integration 與 wind-field animation 可以平行研究，但不應阻塞或改寫 HK Signal validation pipeline。

---

Storm Track 的分析結果只供實驗與研究用途；熱帶氣旋警告及安全決策應以官方資訊為準。
