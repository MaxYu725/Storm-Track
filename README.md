# Storm Track

香港熱帶氣旋路徑 PWA，手機／standalone 優先，集中顯示 HKO、CMA/NMC、JMA、CWA 官方路徑，提供多機構比較、距港分析、D1 歷史公報重播，以及正在獨立開發的 Storm Analysis / adaptive learning 系統。

> **這份 README 是專案的主要開發交接入口。**
>
> 新開發者或新 ChatGPT 對話應先完整閱讀本文件，再決定下一步。不要只依賴舊對話、舊 PR、舊 branch 名稱或 Git 歷史推斷 production backend。本文記錄 production 架構、AI 分支、Cloudflare 資源、部署方式、資料語意、安全邊界、最新 checkpoint、開發目標與目前約定的下一步。

---

## 1. 專案目標

Storm Track 的核心目標分成兩層。

### 1.1 Production Storm Track

維持一個可靠、快速、mobile-first 的熱帶氣旋追蹤工具：

- HKO、CMA/NMC、JMA、CWA 必須保持為 **互相獨立的官方來源**；
- 顯示各機構分析與預測路徑，而不是把它們誤寫成單一官方預報；
- 提供共同時效比較、共識中心、最大分歧、距港與香港影響分析；
- 在網路或個別來源失敗時，以 last-success cache 保留可用資料；
- 保存歷史公報，讓使用者可搜尋、重播和比較過往 forecast evolution；
- 長遠可融入 Weather Metro App，但 Storm backend/service boundary 保持獨立。

### 1.2 Storm Analysis / adaptive learning

建立一套獨立、可驗證、可回溯的分析與學習系統：

```text
官方 forecast snapshots
        ↓
finalized official truth
        ↓
forecast verification
        ↓
agency skill / HK impact evaluation
        ↓
candidate weighting / signal calibration
        ↓
shadow comparison
        ↓
人工、可回滾的 controlled production adoption
```

AI 的目標不是取代官方機構，也不是讓 LLM 自行決定氣象真值。數值計算、forecast verification、truth provenance、agency weighting 與 signal calibration 都應保持 deterministic / auditable；LLM 或 Workers AI 如日後加入，只能建立在已驗證的 deterministic facts 上。

### 1.3 V1「完成」的定義

不要再以無限延伸的 `AI-xx` 編號作為完成標準。Storm Analysis V1 可在以下能力形成完整循環時視為完成：

1. 能持續保存 prospective / historical official forecasts；
2. finalized truth 到達後能安全 attach；
3. 能產生 deterministic verification results；
4. 能產生 agency skill / candidate / calibration 結果；
5. 能與 baseline 做公平、無 leakage 的比較；
6. 能在 shadow mode 長期觀察；
7. 有足夠 evidence 時可人工採用 candidate；
8. adoption 可 rollback；
9. 新 storm 加入後只需繼續累積／評估，不需要重新設計整條 pipeline。

資料與模型之後仍會持續改善，但那屬於正常迭代，不應再因每一個風險或資料狀況增加無限大階段。

---

## 2. Production URLs 與部署拓撲

### 2.1 Frontend

- Web App: `https://maxyu725.github.io/Storm-Track/`
- Branch: `main`
- 技術: Vanilla HTML/CSS/JS + Leaflet + PWA
- Frontend persistence: IndexedDB，必要時 localStorage fallback
- Service Worker version: `3.3.3`
- GitHub Pages workflow: `.github/workflows/deploy-pages.yml`
- `main` 每次 push 都會觸發 Pages deployment；workflow 會把 repository root 作為 static artifact 上傳。

目前 standalone 狀態：**release candidate / maintenance / integration-ready**。

### 2.2 Production Storm Worker

- URL: `https://storm.max-yu.workers.dev`
- Cloudflare Worker + D1 + R2 + Cron
- 已知 production source D1:
  - name: `storm-track-db`
  - UUID: `eb0bf995-3ea7-4bf6-bbca-b425892c4d7e`
- 已知 R2 binding: `RAW_BUCKET`
- 已知 Cron: `*/15 * * * *`
- production secrets 包括 `CWA_AUTHORIZATION`、`ADMIN_TOKEN`；**只可記錄 secret 名稱，不可把值寫入 repository、README、frontend 或 issue/PR。**

Production D1 主要 tables：

- `storms`
- `storm_aliases`
- `advisories`
- `track_points`
- `wind_radii`
- `collection_runs`
- `identity_merges`
- `schema_migrations`

### 2.3 最重要的 production backend 邊界

**Repository 目前沒有 authoritative production Storm Worker source。**

因此：

- 不可從舊 Git history 的 `worker.js` 恢復 production Worker；
- 不可因為舊檔案「看起來完整」就重新部署；
- 不可把 `storm-analysis` Worker 當成 production Storm Worker source；
- production backend 如需功能修改，第一步必須是 **取得／重建並驗證現時 production Worker 的 authoritative source**，然後才 version it；
- 在此之前，frontend-only 工作仍可安全進行。

這條限制屬於 **source integrity / production safety**，不是過度保守的 sample gate，不能任意解除。

### 2.4 Production backend APIs

主要診斷端點包括：

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

---

## 3. Production runtime baseline

AI 開發開始前，production runtime baseline 為：

`b03d16149a33928a49790b0d8308dd31e40b1ed4`

這個 SHA 是 **runtime baseline reference**。本 README 的 handoff/documentation 更新會令 `main` 出現新的 documentation commit，但不代表 production frontend runtime logic 已經改變。

如果要檢查 production code drift，應比較實際 runtime files（例如 `index.html`、`sw.js`、manifest、icons、deployment workflow），不要只因 README-only commit 令 `main` SHA 改變就誤判 production runtime 已變。

---

## 4. Frontend 現有功能

- HKO／CMA／JMA／CWA 獨立 async 載入及來源狀態
- IndexedDB last-success cache，失敗時保留可用快取
- 分析／預測路徑、強度顏色、香港 400／800 km 圈
- 多機構共同時效比較、共識中心、最大分歧、距港分析
- CWA 70% 預報圓及已保存風圈
- PWA 安裝、fullscreen、safe-area、離線 shell
- foreground stale-data recovery
- Service Worker cache rollover / update lifecycle
- Archive：D1 風暴清單、搜尋／年份／機構篩選、歷次公報 slider、可調速重播

主要 frontend files：

- `index.html` — standalone UI、資料 adapters、Archive、Leaflet lifecycle
- `manifest.webmanifest` — PWA metadata
- `sw.js` — offline shell、cache rollover、update lifecycle
- `icons/` — PWA icons
- `.github/workflows/deploy-pages.yml` — production Pages deployment

相關文件：

- [`docs/RELEASE_CANDIDATE.md`](docs/RELEASE_CANDIDATE.md)
- [`docs/WEATHER_APP_INTEGRATION.md`](docs/WEATHER_APP_INTEGRATION.md)

---

## 5. 官方來源與資料語意

Live agencies 固定為：

- HKO
- CMA/NMC
- JMA
- CWA

### 5.1 Agency independence

以下是 hard correctness rule：

- 不可 silent substitution；
- HKO missing 就是 HKO missing，不能用 JMA/CMA/CWA 代替；
- CMA/NMC、JMA、CWA 亦同樣；
- app-computed consensus 必須清楚標示為 application computation，不得呈現成任何機構的官方 forecast。

### 5.2 Forecast semantics

Historical / prospective snapshot 必須只包含該 cutoff 當時已知的資訊：

- advisory `issued_at <= cutoff`；
- snapshot 中用作 forecast 的 future points 可有 `valid_at > cutoff`；
- 但 source 本身不可在 cutoff 後才取得再回填到舊 snapshot；
- historical verification / training 不可使用 future source availability 造成 leakage。

### 5.3 Truth semantics

Forecast 不等於 truth。

目前 finalized tropical-cyclone truth authority 是 JMA RSMC Tokyo Best Track。對 JMA 2026 data：

- position table 中 `※` 表示速報解析 / preliminary；
- preliminary data 不可標為 finalized truth；
- finalized truth import 應同時有官方 Best Track block、source URL/version、retrieval timestamp、hash/provenance；
- forecast data 不可用作 truth fallback。

這也是不可為追求開發速度而解除的 correctness rule。

---

## 6. Storm Analysis 獨立環境

AI / learning 工作完全隔離在：

- Branch: `feature/ai-analysis-engine`
- Worker: `https://storm-analysis.max-yu.workers.dev`
- Worker name: `storm-analysis`
- D1 binding: `ANALYSIS_DB`
- D1 database: `storm-analysis`
- D1 UUID: `99c692b2-c932-4774-bf8d-2d7f10f6c6f8`
- Wrangler config: `workers/storm-analysis/wrangler.jsonc`
- Required Worker secrets:
  - `BACKFILL_TOKEN`
  - `ANALYSIS_ADMIN_TOKEN`

Secret values只存在 Cloudflare / GitHub Secrets，不可寫入 source。

Workers AI 目前：**disabled**  
Automatic promotion 目前：**disabled**

Production Storm Worker modified by AI branch：**no**。

### 6.1 Analysis D1 重要 tables

Base learning schema 包括：

- `backfill_runs`
- `historical_storms`
- `truth_datasets`
- `truth_points`
- `forecast_snapshots`
- `signal_outcomes`
- `verification_results`
- `agency_skill_profiles`
- `adaptive_weight_candidates`
- `model_versions`

後續 migrations 另加入 analysis cache、signal calibration、training runs、outcome curation、promotion/rollback state 等 tables。

### 6.2 Admin / analysis routes

目前 deployed analysis architecture 已具備：

- `POST /api/backfill/plan` — no-write import preview
- `POST /api/backfill/import` — authenticated bounded import
- `POST /api/admin/signal-training/preview`
- `POST /api/admin/signal-training/run`
- `POST /api/admin/signal-outcomes/curate`
- `POST /api/admin/signal-risk/promotion/preview`
- `POST /api/admin/signal-risk/promote`
- `POST /api/admin/signal-risk/rollback/preview`
- `POST /api/admin/signal-risk/rollback`
- model/profile read routes
- deterministic analysis route

**已知缺口：** `verification-result-repository.js` 已完成 local D1 integration / idempotency / conflict tests，但目前沒有接到 live Worker verification-persist route。這是 AI-23 要收尾的必要 plumbing，不應遺漏。

---

## 7. AI development 已完成能力

AI-1 至 AI-18 已建立主要分析與 control-plane 能力，包括：

- deterministic StormAnalysisSnapshot
- Hong Kong Impact Engine
- HKO Signal Risk Inputs
- Forecast Verification Engine
- historical walk-forward backtester
- agency skill profile
- adaptive weight candidate
- independent `storm-analysis` Worker boundary
- deterministic orchestration / cache
- HKO signal-risk calibration
- walk-forward signal calibration trainer
- persisted training-run infrastructure
- authenticated training admin API
- explicit HKO outcome curation
- manual Champion promotion
- rollback
- deployment readiness
- independent Worker + D1 provisioning
- secure admin secret activation

注意：**「功能已寫好」不等於「已用真實足量資料訓練並證明改善」。** 目前真實資料 pipeline 才剛開始累積。

---

## 8. AI-19 / AI-20 / AI-21 現況

### 8.1 AI-19 — CHAN-HOM forecast-only pilot

Storm: `WP-2026-15` / CHAN-HOM / 昌鴻

因 JMA `2615` 尚未 finalized，AI-19 只保存 forecast evidence，不建立 truth。

Canonical identifiers：

- Evidence SHA-256: `21b774c59c7773cd7ccdf03e6002deeed4035cd7ca452dc72a00115e449f591d`
- Plan SHA-256: `98a3a2d6c20e5a4704604ef7c58df49a7703b93f9399e2e74962bcd76d74573a`
- Run ID: `ai19_chanhom_forecast_21b774c59c7773cd`
- 4 imported forecast snapshots
- truth rows: 0
- `agency_skill_eligible = 0`

AI-19 lifecycle: **completed**。

### 8.2 AI-20 — finalized truth readiness

AI-20 目前仍：

`PENDING_AI20`

原因：JMA 2615 finalized Best Track 尚未滿足 finality gate。

已完成 preparation：

- JMA Best Track parser / finality checker
- canonical finalized-truth contract
- truth augmentation builder
- deterministic verification preview
- `verification-result-repository.js`
- local D1 persistence tests

但 AI-20 有一個已知 architectural limitation：現時 truth augmentation 明確綁定：

- `WP-2026-15`
- JMA `2615`
- AI-19 exact plan SHA
- AI-19 四個 snapshots

因此它是非常安全的 pilot implementation，但不是通用 multi-storm truth attachment。AI-23 應把這個能力泛化，而不是為每場 storm 複製一套新的硬編碼 workflow。

### 8.3 AI-21 — prospective multi-storm forecast corpus

AI-21 lifecycle：**`COMPLETED_AI21`**。

已正式保存第二個 forecast-only storm：

- storm key: `WP-2026-17`
- external international identity: **unreviewed**
- HKO: explicitly missing
- JMA/CMA/CWA: independent forecast evidence
- snapshots: 4
- Evidence SHA-256: `bf48ab58f885b42b33b0d5f0247416a649b389cfffaa4b4d794868076964716f`
- Plan SHA-256: `77b2bfdac1190cd5987f2407e9d83af5efa6fabd346ac6f9516fbb3f914e69d2`
- Run ID: `ai21_forecast_corpus_bf48ab58f885b42b`
- exact replay verified as `already-imported / writesPerformed=false`

AI-21B result checkpoint：

`c2d1f3e557aa354e94bb60d2c575b5fd98a37dfa`

### 8.4 Remote `storm-analysis` state after AI-21B

```text
backfill_runs                 = 2
historical_storms             = 2
forecast_snapshots            = 8
truth_datasets                = 0
truth_points                  = 0
signal_outcomes               = 0
verification_results          = 0
agency_skill_profiles         = 0
adaptive_weight_candidates    = 0
training_runs                 = 0
curations                     = 0
promotion_events              = 0
signal generation             = 0
Champion                      = NONE
```

兩場 historical storms 目前均是 `forecast-only`。

---

## 9. 新開發原則（2026-08 handoff decision）

此前 AI roadmap 為安全起見加入大量固定 storm 數、固定 target、固定 cutoff、階段 gate。這成功保護了 production，但亦令 roadmap 由早期 AI-10 一路膨脹，而且有機會因自然資料累積太慢而永遠達不到後續條件。

現在正式採用以下原則。

### 9.1 核心原則

> **對研究、測試、evaluation、training、shadow learning 採較靈活原則；對資料真實性、leakage、source identity、不可逆 production mutation 採嚴格原則。**

> **樣本少代表 confidence 較低，不代表禁止測試。樣本增加，confidence 應自然上升。**

### 9.2 可安全解除／軟化的舊限制

如不影響 correctness，可主動把以下 hard-coded assumptions 改成 configurable default、warning、confidence input 或 lifecycle state：

- `minimumStorms = 5 / 8` 才准 evaluation/training；
- storm 必須完結才可保存；
- 每場 storm 必須固定 4 snapshots；
- truth / workflow 只支援某個指定 storm key；
- generic capability 綁死某個 plan SHA；
- 樣本不足直接停止所有 candidate evaluation；
- 每新增一個例外就增加一個新的大型 AI phase；
- 為「比較保守」而設、但無法指出具體 correctness/safety failure 的 blocker。

### 9.3 仍然保持的 hard limits

下列限制不能只因「希望開發快一點」而取消：

- 禁止 historical leakage / future-source contamination；
- 禁止 agency silent substitution；
- 禁止把 preliminary data 當 finalized truth；
- 禁止偽造 provenance / fingerprint / source identity；
- 已保存 historical snapshot 不可偷偷 retroactive rewrite；
- import / persistence 必須可 audit、可重播、可辨識 conflict；
- secrets 不可進 source/frontend；
- 不可從歷史 `worker.js` 猜測並覆蓋 production Storm Worker；
- training 不等於 promotion；
- 初步小樣本改善不能自動改 production；
- automatic promotion 保持 disabled，除非日後另有明確產品決定與安全證據。

### 9.4 新 hard blocker 的規則

未來新增任何 hard blocker 前，要能明確回答：

> 它是在防止哪一種資料錯誤、安全問題、不可逆 mutation 或 evaluation invalidity？

如果答案只是「比較保守」或「等多些資料比較安心」，原則上應改成 confidence / warning / manual-review signal，而不是阻塞整條 pipeline。

### 9.5 不要現在一次性拆掉全部舊 gate

雖然已授權在安全情況下解除不必要限制，但不要一次過改動 corpus lifecycle、truth binding、verification persistence、training thresholds、promotion semantics。

應逐層改、逐層 regression，避免無法定位新問題來源。

目前決定是：**先完成 AI-22 和 AI-23 的既有架構缺口，再重新審視 sample thresholds / confidence framework。**

---

## 10. 現行 sample safeguards（仍在 code，暫未修改）

這些是舊版 conservative defaults，未來可調整，但目前不應在 AI-22 前突然全部移除：

### Agency adaptive weighting

現有預設大致包括：

```text
minimumStorms       = 5
minimumPoints       = 20
shrinkageStorms     = 10
minWeight           = 0.10
maxWeight           = 0.40
maxWeightDelta      = 0.08
```

系統已經有 small-sample shrinkage：storm 越少，candidate 越向 baseline/champion 收縮。

### Signal calibration walk-forward

現有預設包括：

```text
minimum prior training storms = 8
minimum holdout storms        = 5
minimum predictions/signal    = 20
```

未來重新設計時，應區分：

- **可不可以跑 evaluation/training**；
- **結果 confidence 有多高**；
- **可不可以進 shadow**；
- **可不可以 promotion / production adoption**。

不要再把以上四件事用單一 storm-count hard gate 混在一起。

---

## 11. 下一步：先完成 AI-22，再完成 AI-23

目前不要直接規劃 AI-24～AI-27。

### AI-22 — Corpus Lifecycle & Identity

目的：補上 AI-21 一次性 freeze 之後仍缺少的長期 corpus lifecycle。

應處理：

1. **active storm incremental capture**
   - 不再要求 storm 完結才保存；
   - active storm 可持續 append 新 snapshots；
   - 已保存 snapshot immutable。
2. lifecycle states
   - active
   - quiescent
   - frozen / closed for that capture window
3. append-only / duplicate / exact replay / conflict semantics
4. 同一 storm 多次 corpus runs 的關係
5. internal `stormKey` 與 external identity mapping
6. temporary / ambiguous identity 的 reviewed merge/binding 規則
7. 不新增 sample-count gate
8. 優先用 `WP-2026-16` 作第一個實際 lifecycle case，因它已有四機構及大量 forecast archive。

AI-22 **不應**做：

- truth import
- verification persistence
- training threshold redesign
- Champion promotion
- production weight change

### AI-23 — Generic Truth → Verification Pipeline

目的：把 AI-20 target-specific pilot 泛化成真正可重用的 multi-storm pipeline。

應完成：

```text
reviewed storm identity
       ↓
finalized official truth
       ↓
generic truth augmentation
       ↓
immutable forecast snapshots
       ↓
deterministic verification preview
       ↓
verification persistence
```

必要項目：

1. generic JMA finalized truth binding；
2. 不再綁死 `WP-2026-15 / 2615 / AI-19 plan`；
3. 保留 exact provenance / hash / finality checks；
4. generic forecast-corpus augmentation；
5. 把現有 `verification-result-repository.js` 接上受控 Worker/API path；
6. dry-run / exact replay / conflict / idempotency；
7. synthetic finalized fixtures 先完成 integration test；
8. 不需要等待 JMA 2615 真正 finalized 才完成 generic capability；
9. 真實 finalized truth 到達時應只是第一個 real dataset，不應再重新開發整條 pipeline。

### AI-23 後立即停止自動延伸 roadmap

完成 AI-23 後做一次新的 architecture + data audit，再回答：

- 真實 finalized storms 有多少？
- verification coverage 如何？
- 哪些 legacy 5/8 storm gates 真正阻礙 evaluation？
- small-sample confidence 應如何表示？
- 是否適合進 shadow training / comparison？
- 哪些限制應降級成 warning/configuration？

只有 audit 結果需要新 implementation 時才命名下一個 checkpoint。

---

## 12. Small-sample learning 的產品方向

未來 training / evaluation 應遵循：

```text
任何合法、無 leakage、有 finalized truth 的樣本
             ↓
          先測試
             ↓
       計算 effect size
             ↓
   stability / coverage / regression
             ↓
         confidence
             ↓
決定只研究、shadow、或可否採用
```

建議未來 confidence 不只看 storm count，亦應考慮：

- distinct storm count
- verification point count
- agency coverage
- lead-time bucket coverage
- storm 路徑／強度多樣性
- candidate vs baseline improvement magnitude
- per-storm consistency
- leave-one-storm-out stability
- weight stability
- worst-case regression

因此：

- 2–3 個高質素、多樣化 storms 可以產生有用 early evidence；
- 7–8 個高度相似、coverage 差的 storms 也不應自動視為高 confidence；
- 少量 storms 可以產生 experimental/provisional candidate；
- 小樣本結果不可自動變成 production Champion。

---

## 13. Deployment / mutation rules

### 13.1 Frontend / Pages

`main` push 會自動部署 Pages。

修改 production frontend 時：

1. 確認只改預期 files；
2. 確認 PWA/service-worker cache semantics；
3. 如改 runtime assets，按需要更新 SW version；
4. 等 GitHub Pages workflow 完成；
5. 用實際 deployment artifact 做 regression。

### 13.2 Production Storm Worker

在 authoritative source 未找回前：

**禁止 redeploy。**

如果未來要改 backend：

1. 先取得現行 authoritative source；
2. 比對 live endpoints / D1 schema / R2 / cron / secret bindings；
3. version source；
4. 建立 dry-run / staging / rollback；
5. 才考慮 production deployment。

### 13.3 `storm-analysis` Worker

`storm-analysis` 是獨立可 version 的 Worker，可以透過 feature branch 的受控 GitHub Actions / Wrangler 流程部署或執行 admin operation。

原則：

- no secret values in repo；
- write-capable operation 要有 authenticated route；
- production source D1 `storm-track-db` 在 AI historical work 預設 read-only；
- AI writes 只進 `storm-analysis` D1，除非另有明確授權與設計；
- deployment、D1 migration、truth import、training run、promotion 應分清楚，不能因一個操作順便執行其他 mutation；
- exact replay / idempotency 要有驗證；
- failure 後先 classify remote state，再決定 retry，不能盲目重送。

---

## 14. Testing / regression 基本要求

AI branch 已有多層 tests：

- deterministic engine unit tests
- historical replay / leakage tests
- AI checkpoint tests
- Miniflare / local D1 integration tests
- Wrangler deploy dry-run
- canonical artifact hash verifiers
- selected GitHub Actions read-only audits

進行 AI-22 / AI-23 時應保留：

- full existing regression chain；
- source DB identity pinning；
- no agency substitution；
- snapshot immutability；
- no future-source leakage；
- exact replay/idempotency；
- no unexpected training/promotion writes。

但不要為每一個 read-only檢查都額外創造一個新的大型 product phase；能在同一 checkpoint 內以 test/workflow gate 完成的，就留在同一 checkpoint。

---

## 15. Known operational checkpoints

### Main / production runtime

- Runtime baseline: `b03d16149a33928a49790b0d8308dd31e40b1ed4`
- SW: `3.3.3`
- Production Worker source: **not authoritative in repo**

### AI branch

- Branch: `feature/ai-analysis-engine`
- AI-19 final import result exists
- AI-20 trigger: `PENDING_AI20`
- AI-21 trigger: `COMPLETED_AI21`
- AI-21B final checkpoint: `c2d1f3e557aa354e94bb60d2c575b5fd98a37dfa`

### JMA 2615

AI-20 仍應等官方 finalized Best Track。不要用 preliminary `※` data 代替。

在外部 operational workflow 中已有針對 JMA 2615 finalization 的監察；新接手者在建立重複 monitor 前應先確認現有監察是否仍存在。

---

## 16. 新對話／新開發者接手流程

收到「繼續 Storm Track AI」或類似要求時，建議按以下順序：

1. **完整讀本 README。**
2. 查看 `main` 和 `feature/ai-analysis-engine` 現時 head；不要假設本文件內 checkpoint 永遠是最新 commit。
3. 讀：
   - `docs/AI20_HISTORICAL_TRUTH_FINALIZATION.md`
   - `docs/AI20_PHASE_B_PREP_RESULT.md`
   - `docs/AI20_VERIFICATION_PERSISTENCE_READINESS.md`
   - `docs/AI21_PROSPECTIVE_MULTI_STORM_CORPUS.md`
   - `docs/AI21_WP17_IMPORT_RESULT.md`
4. 檢查：
   - `.github/ai20-truth-trigger.txt`
   - `.github/ai21-corpus-trigger.txt`
5. 如涉及 remote write，先做 read-only preflight / state classification。
6. 不要動 production Storm Worker，除非 authoritative source 已正式 recovered/versioned。
7. 目前正常下一步：**AI-22 Corpus Lifecycle & Identity**。
8. AI-22 完成後：**AI-23 Generic Truth → Verification Pipeline**。
9. AI-23 完成後先 audit，再決定下一個 implementation；不要預設要一路開到 AI-27。

---

## 17. 開發決策摘要

如果只記得幾件事，記住以下內容：

- Production Storm Worker source **不在 repo，不能從舊 `worker.js` redeploy**。
- HKO / CMA / JMA / CWA **永遠保持獨立**。
- Forecast **不能當 truth**；preliminary JMA **不能當 finalized truth**。
- `main` 是 production frontend；AI 在 `feature/ai-analysis-engine` + 獨立 `storm-analysis` Worker/D1。
- AI-21B 已有 2 storms / 8 forecast snapshots，但 **truth=0、verification=0、training=0、Champion=NONE**。
- 先做 AI-22 lifecycle，再做 AI-23 generic truth/verification。
- 小樣本可以測試；storm 數主要影響 confidence，不應自動阻止 evaluation。
- 過度保守但無具體 correctness/safety 理由的 hard gate，應優先改成 config/warning/confidence。
- 但 leakage、source integrity、agency independence、truth finality、secret safety、production source integrity 仍是 hard rules。
- Training、promotion、production adoption 是三件不同的事。
- Automatic promotion 目前保持關閉。

這份 README 應隨重大 architecture / deployment / checkpoint 決定更新，讓下一次接力不必依賴前一段對話才能理解專案。
