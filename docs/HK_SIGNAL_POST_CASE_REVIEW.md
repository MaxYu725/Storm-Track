# HK Signal Post-case Review Register

這份文件是 HK Signal Beta 的統一結案備查清單，用於記錄 live validation 期間值得在風暴 lifecycle 結束後重新審視的模型語意、資料完整性、UI 解讀及評分影響。

原則：

- Live case 期間先保存 evidence，不因單一風暴即時調 threshold / weighting。
- Correctness bug 可即時修；模型語意問題等 case closeout 後再用完整 prospective timeline 分析。
- Raw prospective / HKO truth 保持 immutable；必要時只在 derived evaluation 排除污染 capture。
- 已修復項目仍保留一行，結案時只檢查 residual impact，不重新開發同一問題。
- 新現象優先追加到本表，不另開 AI 編號或平行 backlog。只有需要長篇討論時才另開 Issue，並由本表連結。

## Status

- `OPEN — post-case review`：現在不改模型，結案後正式研究。
- `OBSERVE`：目前是模型行為觀察，未證明為 bug。
- `RESOLVED — residual check`：工程問題已修，只需確認歷史污染是否已被 evaluator 正確隔離。
- `CLOSED`：結案分析完成，已決定保留、修改或 write-off。

## Register

| ID | Case | 類型 | 現象 | 現況 / 即時處理 | 結案時要回答 | Status |
|---|---|---|---|---|---|---|
| `MS-01` | `STC-2026-JMA-TC2622` NARRA | Model semantics / timing confidence | 地圖已可見部分較完整預報在最近點後離港，但全局 `forecastEdge` 仍可偏高；舊 UI 容易被理解成「共識最低距離被預報尾端截斷」。 | frozen v1 不變；UI 已改為「部分機構預報在最近距離附近結束」。詳細討論見 Issue #62。後續 prospective evidence 顯示 HKO 已無 future forecast / 系統進入 post-lifecycle 階段時 T1 仍可維持 `possible`，所以 delayed-withdrawal hypothesis 繼續保留至正式 closeout。 | 1. per-agency edge 與 representative/consensus edge 是否應分開？ 2. 對 confidence 的 penalty 是否合理？ 3. 是否不必要地抑制 timing fallback？ 4. 有 post-minimum departure evidence 時應如何解讀 horizon censoring？ | `OPEN — post-case review` |
| `MS-02` | `STC-2026-JMA-TC2623` GAENARI | Model semantics / timing window | T1 仍為 `possible`，risk 約 0.53、persistence 約 46h，然而 `estimatedWindow=null`。最新 timeline 可能在第一個可用 checkpoint 已高於 possible threshold，因此沒有 below→above crossing；同時 `forecastEdge>0.5` 抑制 fallback anchor。 | 不改 frozen v1；視為 timing semantics observation，不解讀為 T1 風險消失。 | 1. 「first visible already above threshold」是否應標成 left-censored timing，而不是完全無 window？ 2. 窗口由有→無是否與 risk/confidence/persistence 的演變一致？ 3. `forecastEdge` 與 missing crossing 同時出現時是否過度保守？ 4. 是否只需改善 UI 表達，而非演算法？ | `OPEN — post-case review` |
| `MB-01` | `STC-2026-JMA-TC2623` GAENARI | Model behaviour / agency disagreement | 曾出現明顯 2-vs-2 路徑分歧：HKO/CWA 偏西北，CMA/JMA 偏西南；之後 agency membership / forecast horizon 又有變化。 | 不視為 bug；Observation Board 持續記錄 spread、closest-time span、confidence、window movement。 | 1. disagreement 增大時 confidence 是否合理下降？ 2. 路徑收斂後 risk/window 是否自然收斂？ 3. 短 forecast horizon agency 是否不成比例影響 edge/timing？ 4. source membership 改變是否造成不合理跳變？ | `OBSERVE` |
| `MB-02` | `STC-2026-JMA-TC2621` SAUDEL | Model behaviour / long-horizon support concentration | T3 首次進入 `possible` 時，risk 約 0.453、confidence 約 0.313、persistence 約 3.3h；最強 checkpoint 約 +119h，當時主要由 CMA 單一 120h endpoint 支持，並同時有 `forecastEdge=1.000`。 | 不視為 bug，不改 frozen v1；後續 T3 已回到 `unlikely`，繼續觀察這次遠期 escalation 是否屬有效 early warning 或 transient long-horizon false positive。 | 1. 後續 HKO/JMA/CWA 是否收斂到相同遠期路徑？ 2. T3 window 是 transient 還是 persistence/confidence 持續增加？ 3. 單一 agency 遠期 endpoint 是否對 `possible` 判定影響過大？ 4. `supportAgencyCount=1` 的 strongest checkpoint 是否應與多機構共同支持的 window 有不同語意？ 5. 是否在其他 case 重複出現同類行為？ | `OBSERVE` |
| `EI-01` | `STC-2026-JMA-TC2623` GAENARI | Data / identity correctness | CMA `热带低压` 在正式命名 GAENARI 後曾被 frontend 誤拆成另一 group。 | Generic-name normalization 已修；stable case identity 保持同一 case。 | 只檢查修補前後 timeline 是否連續；不得把修補前錯拆 group 當兩個獨立 storm。 | `RESOLVED — residual check` |
| `EI-02` | `STC-2026-JMA-TC2623` GAENARI | Evaluation integrity | identity split 期間同一 `caseId + captureFingerprint` 曾有多個 final groups，會污染 state flips / latest-before-event。 | Raw evidence 保留；evaluator / closeout 已排除 ambiguous same-case same-capture。 | 確認正式成績沒有使用被排除的 capture；如報告引用 timeline，需標示 excluded capture count。 | `RESOLVED — residual check` |
| `EI-03` | GAENARI / evaluator generic | Evaluation integrity / closeout bookkeeping | Raw evaluator 先計算 `awaiting`，之後 `apply-hk-signal-closeouts.mjs` 才產生 no-signal closeouts，曾令同一 case 已有 T1/T3/T8 closeout 卻仍留在 `activeHkoCaseIds` / `pendingSignalsByCase`。 | Correctness fix 在 closeout apply 層用 derived closeouts reconcile `awaiting`；完整 closeout case 從 active、pending、latestPredictions 移除，並加入 integration regression。Forecast model 不變。 | 1. derived `latest.json` 不得再同時把已全部 closeout 的 case 列作 active/pending；2. partial closeout / 尚有 pending signal 的 case 必須繼續保留。 | `RESOLVED — residual check` |
| `EI-04` | `STC-2026-JMA-TC2622` NARRA / `STC-2026-JMA-TC2625` ETAU | Data / stable identity correctness | NARRA 歷史資料曾帶有錯誤／重用的 `CWA:2026-21`；ETAU 後來真正使用同一 CWA ID。舊 resolver 只要 source token overlap 就先行合併，令正式名稱已明確衝突的 ETAU 被錯併進 NARRA，並造成一個假的 NARRA `possible → unlikely` 撤回。 | Resolver 已改為正式名稱衝突優先於 source-ID overlap；generic → named continuity 仍保留。完整 immutable prospective corpus 已重新 reconcile：NARRA `lastSeen` 回復至 `2026-08-27T03:31:15.090Z`，ETAU 全部歸入 `STC-2026-JMA-TC2625`。Raw snapshots 不改寫。 | 1. NARRA R1/R2 不得引用 ETAU-driven fake withdrawal；2. 所有 ETAU derived index rows 必須維持 TC2625；3. 未來 source-ID 重用不能跨越兩個互斥正式名稱。 | `RESOLVED — residual check` |
| `EI-05` | HKO truth recorder generic | Evaluation integrity / freshness semantics | HKO truth polling 實際成功，但當 capture fingerprint 不變時 workflow 永久 NOOP，令 `latest.json.retrievedAt` 長期停留在舊時間，看似 recorder 停擺，無法由 derived state 判斷 polling liveness。 | unchanged truth 現最多每 30 分鐘只刷新 `latest.json` heartbeat；不新增 duplicate observation/index/truth-event。已在 production 驗證 heartbeat commit 只修改 `latest.json`，TC truth fingerprint 不變。 | 1. `latest.json.retrievedAt` 應可反映近期成功 polling；2. semantic history 不應因 heartbeat 膨脹；3. eligible HKO event 仍只由實際 truth state transition 產生。 | `RESOLVED — residual check` |
| `EI-06` | HK Signal evaluator generic | Evaluation integrity / pipeline freshness | Prospective recorder、HKO truth recorder 與 evaluator 各自依賴 GitHub scheduled event；近期曾見 upstream 已成功更新，但 evaluator 的另一條 cron 幾小時後才觸發，形成第二層 derived-state lag。 | Evaluator 除保留原 cron / manual fallback 外，新增 `workflow_run`：prospective recorder 或 HKO truth recorder在 `main` 成功完成後立即跟跑；PR branch / failed run 不觸發 production evaluation，concurrency 仍序列化。此修正不回填任何漏掉的 prospective capture。 | 1. 每次實際成功 upstream run 後 evaluator 應能自動追上；2. fingerprint 相同仍應 NOOP；3. GitHub 本身漏發 recorder schedule 所造成的 raw evidence gap 必須保留為 gap，不得事後補造成 prospective evidence。 | `RESOLVED — residual check` |
| `UI-01` | NARRA / generic | UI interpretation | 「最低距離接近預報尾端」過度概括 per-agency edge evidence。 | 已改為較精確的「部分機構預報在最近距離附近結束」。 | 結案時確認新文字是否仍足以解釋 edge evidence；若模型語意未改，不再擴張 UI 規則。 | `RESOLVED — residual check` |

## GAENARI R1 preliminary review

Case：`STC-2026-JMA-TC2623` GAENARI

R1 status：`COMPLETE — R2 available below`

R1 是正式 closeout 前的 read-only diagnosis。這一節保存當時 prospective evidence 的判讀，不修改 frozen v1 threshold、weighting、signal semantics 或 raw corpus；正式 outcome / classification 已由下方 R2 closeout 鎖定。

### R1 lifecycle anchors

- Stable case identity 從 JMA `TC2623` generic stage 已建立；CMA / CWA generic TD 及後來命名 GAENARI 均 resolve 到同一 `STC-2026-JMA-TC2623`。
- 命名過渡期間有 2 個 ambiguous same-case same-capture records；evaluator 已排除，R1 不把它們用作 state-transition evidence。
- 第一個 clean four-agency snapshot（2026-08-22 05:36Z）仍為 T1 `unlikely`：risk 約 `0.265`、confidence 約 `0.386`；當時 comparison spread 約 `615 km`、closest-time span 約 `27.8 h`，而 `forecastEdge=0.750`。
- Recorder 首次由 `unlikely` 轉為 T1 `possible` 的 capture 是 2026-08-22 13:02Z。該 snapshot risk 約 `0.366`、confidence 約 `0.303`，已有 estimated window；`forecastEdge=1.000`、agency disagreement 約 `0.781`。
- 2026-08-22 23:38Z，在四機構仍存在時，T1 risk 已升至約 `0.575`、confidence 約 `0.304`、persistence 約 `26.1 h`，estimated window 仍存在；strongest checkpoint 的實際支持為 `3/3`，不是把整宗 case 的 4 個 usable agencies 當成 4 個共同支持。
- 到 2026-08-23 01:56Z，CWA 已退出該 group，只餘 CMA/HKO/JMA；T1 仍為 `possible`、risk 約 `0.528`、confidence 約 `0.344`、persistence 約 `41 h`，strongest checkpoint 仍是 `3/3` 支持，但 `estimatedWindow` 已變成 `null`，同時 `forecastEdge=1.000`。之後即使 CWA 再返回 group，window 亦沒有自動恢復。
- 這支持 MS-02 的主要 diagnosis：window 消失不是 risk 消失，而較符合 timeline 已在第一個可見 checkpoint 高於 threshold、沒有可重建的 below→above crossing，再加上 horizon-limited fallback 被抑制的 left-censored timing semantics。CWA membership change 是觸發 window 由有→無時的重要同時事件，但目前證據不足以把它定為唯一原因。
- 2026-08-25 04:56Z，GAENARI 只餘 HKO + JMA；T1 仍為 `possible`，risk 約 `0.397`、confidence 約 `0.561`，future timeline 已空，最近點已在過去，window 仍為 null。
- 約 43 分鐘後的 2026-08-25 05:39Z，JMA 亦退出，只餘 HKO。模型立即轉為 T1 `unlikely`，risk 約 `0.350`；資料 uncertainty 已是 `insufficient`，但 numeric confidence 反而升至約 `0.633`。
- 因此 GAENARI 的最終 `possible → unlikely` 不應描述成「四機構收斂後模型成功撤回」。現有 evidence 更準確的描述是：source membership / usable forecast horizon 收縮與狀態撤回高度同步。這確認 MB-01 的 source-membership sensitivity 值得跨案例繼續觀察。
- 最後仍包含 GAENARI 的 healthy capture 是 2026-08-25 13:02Z；第一個四來源皆 healthy 而 GAENARI 已消失的 capture 是 2026-08-25 14:07Z。24 小時 inactive grace 於 2026-08-26 14:07Z 滿足，之後產生正式 R2 closeout。

### R1 A–G preliminary findings

**A. Signal outcome — COMPLETED IN R2**

R1 當時未見 eligible HKO T1/T3/T8 issue；正式 no-signal outcome 現已由 R2 closeout 確認，見下一節。

**B. Risk behaviour — PLAUSIBLE, NOT YET A SKILL CLAIM**

模型由 clean baseline 的 T1 `unlikely` 約 0.265，隨較接近香港的 scenario evidence 升至 `possible`，曾至少達約 0.575；後期下降。風險演變本身有方向性，但最後撤回受到 source membership 改變影響，因此不能單憑最終 `unlikely` 判定 risk trajectory 已被驗證。

**C. Timing-window behaviour — SEMANTIC ISSUE CONFIRMED**

T1 positive state 可以長時間存在而 window 為 null。R1 支持把這種情況視為 left-censored / no-observable-crossing timing，而不是向使用者暗示「沒有時間風險」。是否只需 UI 語意修正，仍留待 NARRA / SAUDEL 及更多案例交叉檢查。

**D. Confidence / disagreement — OBSERVE MORE**

高 disagreement 時 confidence 大致受壓，但 agency 數量由 2 降至 1 時，資料已被標為 `insufficient`，numeric confidence 卻由約 0.561 升至 0.633。這未必是計算 bug，但顯示現行 confidence 不能直接被解讀成「來源越完整、可信度越高」。需要在 NARRA / SAUDEL 檢查是否重現。

**E. Forecast-edge / horizon effects — MATERIAL**

`forecastEdge=1.000` 與 window 消失同時存在，且 horizon-limited fallback timing 本身被設計成 suppress。R1 支持 MS-02 為真實 model-semantics observation；但不因單案改 threshold / fallback。

**F. Data integrity — PASS WITH EXCLUSIONS**

Stable identity 可連續追蹤 generic → named lifecycle；2 個已知 ambiguous captures 保持 excluded。R2 closeout 已成功使用 clean derived evidence，沒有重新把這兩個 ambiguous same-case same-capture 納入正式成績。

**G. R1 decision — `OBSERVE MORE`**

GAENARI 不足以建立 v2 candidate。R1 暫不改模型；保留兩個跨案例 hypothesis：

1. `timing-left-censoring`：positive risk + no observable threshold crossing 時，window-null 的 UI / semantics 是否需要明確標示。
2. `source-membership sensitivity`：agency / horizon 消失是否會造成 state 或 numeric confidence 不合比例的跳變。

只有 NARRA、SAUDEL 或其他獨立 prospective cases 重現同方向系統性偏差，才考慮 shadow v2。

## GAENARI R2 final closeout

R2 status：`COMPLETE — no-signal closeout`

Closeout time：`2026-08-26T14:07:08.628Z`，對應第一個 healthy absent evidence `2026-08-25T14:07:08.628Z` 加 24 小時 inactive grace。

正式 derived outcome：

- **T1 — `transient-false-alarm`**：102 個有效 snapshots 中 70 個為 positive；首次 positive `2026-08-22T13:02:59.101Z`；max risk `0.6100819928`。最後 pre-close 已回到 `unlikely`，risk `0.3496440177`，因此不是 stable false alarm。
- **T3 — `correct-negative`**：102 個 snapshots、0 個 positive，max risk `0.2377291724`。
- **T8 — `correct-negative`**：102 個 snapshots、0 個 positive，max risk `0.1213031700`。
- 三個 signal 都是 `officialOutcome=not-issued`，negative closeout 不套用 A/B/C/D timing grade。

### R2 decision — `OBSERVE MORE`

GAENARI 的 no-signal outcome 已完整結案，但不把它解讀成 v1 已被證明準確：T1 lifecycle 曾長時間維持 positive，而且最後撤回與 source membership / usable horizon 收縮高度同步；timing-left-censoring 與 source-membership sensitivity 仍要由 NARRA、SAUDEL 或其他獨立 prospective cases 驗證。

Evaluator 曾因 closeout 在 raw `awaiting` 之後才套用，令已完成 R2 的 GAENARI 仍顯示 active/pending。此問題屬 derived bookkeeping correctness，不影響 immutable closeout artifacts 或 forecast model；修正記錄為 `EI-03`。

## Prospective review queue

GAENARI 已完成 R2；以下案例繼續提供 cross-case comparison。它們是 review hypotheses，不是預先寫死的 truth labels。

1. **NARRA — likely no-signal comparison case**
   - 重點不是單看最後有沒有 T1，而是檢查曾經的 T1 risk / window、forecast-edge、post-minimum departure evidence，以及最後撤回是否比 GAENARI 更穩健。
   - ETAU identity 污染期間產生的 NARRA `possible → unlikely` 是 derived-data 假象，已由 `EI-04` 排除，不得計入 withdrawal skill、R1/R2 或 V2 evidence。
   - 修正後 genuine NARRA `lastSeen` 為 `2026-08-27T03:31:15.090Z`；正式 no-signal closeout 必須從後續真正 healthy absence 計 24 小時，不得讓 ETAU 重置 gate，也不得把 recorder 缺口事後回填成 prospective evidence。
   - 若最終無 signal，特別適合檢查 false-alarm persistence、post-lifecycle delayed withdrawal 及 MS-01 forecast-edge semantics。

2. **SAUDEL — signal / long-horizon withdrawal comparison case**
   - 不預先假設 HKO 必定發 T1/T3；正式 label 只由 HKO truth 決定。
   - 若出現 eligible T1 / T3，將是 frozen v1 高價值 sensitivity / lead-time / timing-window prospective test；若最終無 signal，則成為 MB-02 long-horizon escalation / withdrawal 的對照案例。
   - 特別追蹤 MB-02：早期 T3 `possible` 是否只是單一 CMA 120h endpoint transient，還是其後 HKO/JMA/CWA 真正收斂；每個 strongest checkpoint 必須使用實際 `supportAgencyCount / totalAgencyCount`。

這三宗 case 可形成第一組互補 prospective sequence：GAENARI 已提供 transient false-alarm / source-membership evidence，NARRA 測 no-signal false-alarm control / forecast-edge，SAUDEL 則測 long-horizon escalation 最終能否被 truth 或自然 withdrawal 支持。即使三宗全部完成，也只足以形成初步 cross-case diagnosis，不等於完成模型 calibration。

## Cross-case closeout checklist

每宗有正式 HKO outcome 或 no-signal closeout 的 case，至少統一檢查以下項目。這份 checklist 是 v1 diagnosis 的共同格式，不代表每項都需要改模型。

### A. Signal outcome

- T1 / T3 / T8 是否有 eligible official event。
- 若無信號，closeout 是 correct-negative、transient-false-alarm 還是 stable-false-alarm。
- 是否存在 skipped lower signal / downgrade，不可誤作首次 issue。

### B. Risk behaviour

- 首次 `possible` / `likely` 時間。
- riskIndex 最大值及何時出現。
- 是否長時間貼近 threshold。
- 是否出現頻繁 `unlikely ↔ possible ↔ likely` flips。

### C. Timing-window behaviour

- 第一個 window 出現時間。
- window 是否涵蓋 official event time。
- window start / end 的總漂移量。
- window 是否逐步收斂、長期過闊、或在 risk 仍 positive 時消失。
- 若 window 消失，分類原因：no threshold crossing、forecast-edge suppression、source membership change、data gap、或其他。

### D. Confidence / disagreement

- agency comparison spread、closest-distance span、closest-time spread 的演變。
- confidence 是否與 agency convergence / divergence 大致同步。
- agency 數量或 forecast horizon 改變時是否出現不合理跳變。
- strongest checkpoint 的 `supportAgencyCount / totalAgencyCount`，避免把整宗 case 的 usable agency 數量誤當成該時間點的實際共同支持度。

### E. Forecast-edge / horizon effects

- per-agency closest point 是否接近各自 forecast end。
- representative/consensus closest point 是否真的被共同 horizon 截斷。
- 最近點後是否已有足夠 post-minimum departure evidence。
- `forecastEdge` 是否影響 confidence 或 timing fallback，結果是否合理。

### F. Data integrity

- source IDs / stable case identity 是否全程一致。
- 是否有 ambiguous same-case same-capture，被 evaluator 排除的數量及時間。
- source outage / missing agency 是否只是資料缺口，而非被其他 agency silent substitution。

### G. Decision after review

結案只允許以下其中一種結論：

1. `KEEP v1` — 行為合理，無需修改。
2. `OBSERVE MORE` — 有疑點，但案例不足；保留 hypothesis。
3. `UI / DATA FIX ONLY` — 模型本身不改，只修表達或 correctness。
4. `V2 CANDIDATE` — 至少多個獨立 case 顯示同方向系統性偏差，才建立 shadow comparison。
5. `WRITE-OFF` — 現象屬一次性資料／顯示問題，無需再追。

## Evidence sources

結案分析以以下資料為主，不依賴聊天記憶：

- prospective recorder immutable observations
- stable case index
- HKO warning truth
- derived evaluator / closeout
- Observation Board timeline / agency diagnostics
- historical replay（只作補充 stress test，不取代 prospective evidence）

## Existing detailed issue

- Issue #62 — NARRA forecast-edge semantics。

若之後有新現象，先在本文件 Register 新增一行；只有需要獨立長篇技術討論才再建立 Issue，並回鏈到相應 ID。