# 開發指南

::: tip 注意
此入門套件秉持 **「自備代理」** 的理念。您專注於您獨特的業務邏輯，我們則提供 UI、基礎設施、部署與監控的支架。
:::

### 1. 為您的代理建立原型
首先，建構並實驗您的生成式 AI 代理。

*   使用 `notebooks/` 中的入門筆記本作為指導。這是在將代理整合到完整應用程式結構之前，進行快速實驗和專注於代理邏輯開發的理想方式。
*   使用 [Vertex AI 評估](https://cloud.google.com/vertex-ai/generative-ai/docs/models/evaluation-overview) 來評估其表現。

### 2. 整合您的代理
將您建立原型的代理整合到應用程式中。

*   編輯 `app/agent.py` 以匯入並設定您的代理。
*   在 `app/` 目錄中自訂程式碼（例如：提示、工具、API 端點、業務邏輯、功能）。

### 3. 在本地端測試
使用內建的 UI 遊樂場來迭代您的代理。它會在程式碼變更時自動重新載入，並提供聊天紀錄、使用者回饋和多樣化的輸入類型等功能。

> 注意：由 `make playground` 啟動的特定 UI 遊樂場（例如 Streamlit、ADK Web UI）取決於您選擇的代理範本。

### 4. 部署至雲端
當您對本地端測試感到滿意後，就可以將您的代理部署到 Google Cloud 了！

*所有 `make` 指令都應從您代理專案的根目錄執行。*

#### A. 設定雲端開發環境
在雲端建立一個開發（dev）環境，以進行初步的遠端測試。

**i. 設定 Google Cloud 專案：**
設定 `gcloud` 以指定您的開發專案：
```bash
# 將 YOUR_DEV_PROJECT_ID 替換為您實際的 Google Cloud 專案 ID
gcloud config set project YOUR_DEV_PROJECT_ID
```

**ii. 佈建雲端資源：**
此指令使用 Terraform（位於 `deployment/terraform/dev/` 的腳本）來設定必要的雲端資源（IAM、資料庫等）：
```bash
make setup-dev-env
```

**iii. 🚀 部署代理後端：**
建構您的代理後端並將其部署到開發環境：
```bash
make backend
```

#### B. 使用 CI/CD 進行生產就緒的部署
為了可靠、自動化地部署到預備（staging）和生產環境，CI/CD 管線是不可或缺的。根據需要在您的管線中自訂測試。

**選項 1：單一指令 CI/CD 設定（建議用於 GitHub）**
`agent-starter-pack` CLI 簡化了與 GitHub 的 CI/CD 設定：
```bash
uvx agent-starter-pack setup-cicd
```

此指令會自動建立一個 GitHub 儲存庫，連結至 Cloud Build，使用 Terraform 設定預備與正式環境的基礎設施，並設定 CI/CD 觸發器。

請依照互動式提示進行操作。對於需要精細控制的關鍵系統，請考慮手動設定。
詳情請參閱 [`agent-starter-pack setup-cicd` CLI 參考文件](../cli/setup_cicd)。*(注意：自動設定目前僅支援 GitHub。)*

**選項 2：手動 CI/CD 設定**
若要取得完整控制權並與其他 Git 供應商相容，請參閱[手動部署設定指南](./deployment.md)。

**初始提交與推送 (CI/CD 設定後)：**
設定 CI/CD 後，請提交並推送您的程式碼以觸發首次管線執行：
```bash
git add -A
git config --global user.email "you@example.com" # 若尚未設定
git config --global user.name "Your Name"     # 若尚未設定
git commit -m "代理程式碼的初始提交"
git push --set-upstream origin main
```

### 5. 監控您已部署的代理
使用整合的可觀測性工具來追蹤代理的效能並收集深入分析。

*   **技術**：OpenTelemetry 事件會傳送至 Google Cloud。
*   **Cloud Trace & Logging**：檢查請求流程、分析延遲，並檢閱提示/輸出。在此處存取追蹤記錄：`https://console.cloud.google.com/traces/list?project=YOUR_PROD_PROJECT_ID`
*   **BigQuery**：將追蹤和日誌資料路由到 BigQuery，以進行長期儲存和進階分析。
*   **Looker Studio 資訊主頁**：使用預先建構的範本將代理效能視覺化：
    *   ADK 代理：[Looker Studio ADK 資訊主頁](https://lookerstudio.google.com/c/reporting/46b35167-b38b-4e44-bd37-701ef4307418/page/tEnnC)
    *   非 ADK 代理：[Looker Studio 非 ADK 資訊主頁](https://lookerstudio.google.com/c/reporting/fa742264-4b4b-4c56-81e6-a667dd0f853f/page/tEnnC)
    *(請記得遵循資訊主頁內的「設定說明」，以連結您專案的資料來源)。*

➡️ 詳情請參閱[可觀測性指南](./observability.md)。

### 6. 進階自訂與資料
進一步量身打造入門套件，以滿足特定需求。

*   **RAG 資料擷取**：對於檢索增強生成 (Retrieval Augmented Generation, RAG) 代理，請設定資料管線來處理您的資訊，並將嵌入載入至 Vertex AI Search 或 Vector Search。
    ➡️ 請參閱[資料擷取指南](./data-ingestion.md)。
*   **自訂 Terraform**：修改 `deployment/terraform/` 中的 Terraform 設定，以符合獨特的基礎設施需求。
    ➡️ 請參閱[部署指南](./deployment.md)。