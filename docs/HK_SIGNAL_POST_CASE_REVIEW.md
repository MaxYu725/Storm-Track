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
| `MS-01` | `STC-2026-JMA-TC2622` NARRA | Model semantics / timing confidence | 地圖已可見部分較完整預報在最近點後離港，但全局 `forecastEdge` 仍可偏高；舊 UI 容易被理解成「共識最低距離被預報尾端截斷」。 | frozen v1 不變；UI 已改為「部分機構預報在最近距離附近結束」。詳細討論見 Issue #62。 | 1. per-agency edge 與 representative/consensus edge 是否應分開？ 2. 對 confidence 的 penalty 是否合理？ 3. 是否不必要地抑制 timing fallback？ 4. 有 post-minimum departure evidence 時應如何解讀 horizon censoring？ | `OPEN — post-case review` |
| `MS-02` | `STC-2026-JMA-TC2623` GAENARI | Model semantics / timing window | T1 仍為 `possible`，risk 約 0.53、persistence 約 46h，然而 `estimatedWindow=null`。最新 timeline 可能在第一個可用 checkpoint 已高於 possible threshold，因此沒有 below→above crossing；同時 `forecastEdge>0.5` 抑制 fallback anchor。 | 不改 frozen v1；視為 timing semantics observation，不解讀為 T1 風險消失。 | 1. 「first visible already above threshold」是否應標成 left-censored timing，而不是完全無 window？ 2. 窗口由有→無是否與 risk/confidence/persistence 的演變一致？ 3. `forecastEdge` 與 missing crossing 同時出現時是否過度保守？ 4. 是否只需改善 UI 表達，而非演算法？ | `OPEN — post-case review` |
| `MB-01` | `STC-2026-JMA-TC2623` GAENARI | Model behaviour / agency disagreement | 曾出現明顯 2-vs-2 路徑分歧：HKO/CWA 偏西北，CMA/JMA 偏西南；之後 agency membership / forecast horizon 又有變化。 | 不視為 bug；Observation Board 持續記錄 spread、closest-time span、confidence、window movement。 | 1. disagreement 增大時 confidence 是否合理下降？ 2. 路徑收斂後 risk/window 是否自然收斂？ 3. 短 forecast horizon agency 是否不成比例影響 edge/timing？ 4. source membership 改變是否造成不合理跳變？ | `OBSERVE` |
| `MB-02` | `STC-2026-JMA-TC2621` SAUDEL | Model behaviour / long-horizon support concentration | T3 首次進入 `possible` 時，risk 約 0.453、confidence 約 0.313、persistence 約 3.3h；最強 checkpoint 約 +119h，當時主要由 CMA 單一 120h endpoint 支持，並同時有 `forecastEdge=1.000`。 | 不視為 bug，不改 frozen v1；繼續觀察其他機構是否收斂、T3 window 是否持續或很快撤回。 | 1. 後續 HKO/JMA/CWA 是否收斂到相同遠期路徑？ 2. T3 window 是 transient 還是 persistence/confidence 持續增加？ 3. 單一 agency 遠期 endpoint 是否對 `possible` 判定影響過大？ 4. `supportAgencyCount=1` 的 strongest checkpoint 是否應與多機構共同支持的 window 有不同語意？ 5. 是否在其他 case 重複出現同類行為？ | `OBSERVE` |
| `EI-01` | `STC-2026-JMA-TC2623` GAENARI | Data / identity correctness | CMA `热带低压` 在正式命名 GAENARI 後曾被 frontend 誤拆成另一 group。 | Generic-name normalization 已修；stable case identity 保持同一 case。 | 只檢查修補前後 timeline 是否連續；不得把修補前錯拆 group 當兩個獨立 storm。 | `RESOLVED — residual check` |
| `EI-02` | `STC-2026-JMA-TC2623` GAENARI | Evaluation integrity | identity split 期間同一 `caseId + captureFingerprint` 曾有多個 final groups，會污染 state flips / latest-before-event。 | Raw evidence 保留；evaluator / closeout 已排除 ambiguous same-case same-capture。 | 確認正式成績沒有使用被排除的 capture；如報告引用 timeline，需標示 excluded capture count。 | `RESOLVED — residual check` |
| `UI-01` | NARRA / generic | UI interpretation | 「最低距離接近預報尾端」過度概括 per-agency edge evidence。 | 已改為較精確的「部分機構預報在最近距離附近結束」。 | 結案時確認新文字是否仍足以解釋 edge evidence；若模型語意未改，不再擴張 UI 規則。 | `RESOLVED — residual check` |

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
