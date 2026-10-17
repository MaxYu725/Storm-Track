# Storm Track — GitHub Actions 第二輪清理 Dry Run

## 目的與保護界線

這是一個**只讀盤點工具**，不是批量刪除工具。只有手動觸發（`workflow_dispatch`），沒有排程，也沒有 `actions:write` 權限；**不會刪除 Workflow Runs、Artifacts、任何 YAML 或分支**。

原有 `main` 的 **17 個正式工作流**，包括 Android Ultra、GitHub Pages、HKO、HK Signal、Consensus Track、AI Situation Analysis、歷史重播和各種 Recorder，連同其在**所有分支上的 Runs 與 Artifacts 均保護**。新增的 `legacy-actions-cleanup-audit.yml` 是第 18 個、只作維護的工作流，同樣受保護。

執行時先鎖定並重新核對 `main` workflow YAML 路徑，必須與 17 個正式流程 + 1 個審核工具完全一致；有任何新增、移除或更名即中止。掃描期間若 `main` SHA 改變，亦立即失敗，避免輸出不完整的「可刪除」結果。

## 第一批僅有 12 個一次性舊工作流

以下僅列舊工作流路徑的 Runs；**不刪除其分支或 YAML**：

- `apply-checkpoint2-lifecycle.yml`
- `apply-checkpoint3-ux.yml`
- `apply-checkpoint4-cleanup.yml`
- `apply-d1-cross-advisory-alpha4.yml`
- `apply-live-ui-checkpoint.yml`
- `apply-recovered-worker-d1-hotfix.yml`
- `d1-hotfix-validation.yml`
- `frontend-threat-ui-patch.yml`
- `narra-r2-main-integration-patch.yml`
- `one-shot-gaenari-identity-fix.yml`
- `patch-beta-prospective-recorder.yml`
- `readme-narra-v2-02-patch.yml`

AI-17～23 實驗、HK Signal／Consensus Track 驗證、HKO official truth、歷史資料與其他研究成果全部不在第一批範圍。

## 使用步驟

1. 審閱並合併本工具 PR 到 `main`（在 PR 分支不能直接從 Actions 頁面執行此新的手動 workflow）。
2. 前往 GitHub → Actions → **Audit legacy Actions runs (dry run only)** → **Run workflow**，選擇 `main`。
3. 執行完成後查看 Job Summary 並下載 Artifact：`legacy-actions-dry-run-report`。
4. 報告包括 `audit.json`（全量盤點資訊）、`runs.csv`（每次候選 Run ID、workflow 路徑、branch、狀態）、`artifacts.csv`（每個 Artifact ID、大小、過期狀態）及 `SUMMARY.md`。
5. 先審閱名單及相關證據，**須另行明確確認**才可進行任何正式批量刪除。此 PR 不含刪除功能。

## 掃描可靠性

GitHub 歷史 Runs 約 40,000 筆。工具會從 repository 建立日期掃描到執行當刻，以 `created` 日期範圍遞迴拆分密集時間窗口（每窗口最多 850 Runs），再分頁取得每筆 Run，使用 Run ID 去重。只為 12 個目標路徑中 `completed` 的 Run 逐頁查詢 Artifacts。進行中 Runs 只列入「排除」紀錄。

API 回傳筆數不符、分頁不完整、主分支有變更或資料欄位缺漏時會失敗。非過期 Artifacts 的 logical bytes 只是估算大小，不等於保證可釋放的實際儲存額度。結果 Artifact 保存 7 日，可由使用者下載保留。

## 使用的最小權限

`contents: read`、`actions: read`。沒有 `actions: write`，不會部署程式、改動資料庫或修改正式流程。
