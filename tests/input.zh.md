# 開發指南

::: tip 注意
此入門套件採用**「自備代理程式」**的理念。您專注於獨特的業務邏輯，我們則提供 UI、基礎設施、部署和監控的框架。
:::

### 1. 代理程式原型化
首先建構並實驗您的生成式 AI 代理程式。
*   使用 `notebooks/` 中的入門筆記本作為指南。這非常適合在整合到完整應用程式架構之前進行快速實驗和專注的代理程式邏輯開發
*   使用 [Vertex AI Evaluation](https://cloud.google.com/vertex-ai/generative-ai/docs/models/evaluation-overview) 評估其效能。

### 2. 整合您的代理程式
將您原型化的代理程式整合到應用程式中。

*   編輯 `app/agent.py` 以匯入並設定您的代理程式。
*   自訂 `app/` 目錄中的程式碼 (例如，提示、工具、API 端點、業務邏輯、功能)。

### 3. 本地測試
使用內建的 UI playground 反覆測試您的代理程式。它會在程式碼變更時自動重新載入，並提供聊天記錄、使用者回饋和多種輸入類型等功能。

> 注意：`make playground` 啟動的特定 UI playground (例如 Streamlit、ADK 網頁 UI) 取決於您選擇的代理程式模板。

### 4. 部署至雲端
當您對本地測試滿意後，即可將您的代理程式部署到 Google Cloud！

*所有 `make` 命令都應從您的代理程式專案根目錄執行。*

#### A. 雲端開發環境設定
在雲端建立開發 (dev) 環境以進行首次遠端測試。

**i. 設定 Google Cloud 專案：**
設定 `gcloud` 以指向您的開發專案：
```bash
# 將 YOUR_DEV_PROJECT_ID 替換為您的實際 Google Cloud 專案 ID
gcloud config set project YOUR_DEV_PROJECT_ID
```

**ii. 配置雲端資源：**
此命令使用 Terraform (`deployment/terraform/dev/` 中的指令碼) 來設定必要的雲端資源 (IAM、資料庫等)：
```bash
make setup-dev-env
```

**iii. 🚀 部署代理程式後端：**
建構並部署您的代理程式後端到開發環境：
```bash
make backend
```

#### B. 具備 CI/CD 的生產環境部署
對於可靠、自動化的預備和生產環境部署，CI/CD 管道至關重要。根據需要自訂管道中的測試。

**選項 1：一鍵式 CI/CD 設定 (推薦用於 GitHub)**
`agent-starter-pack` CLI 簡化了 GitHub 的 CI/CD 設定：
```bash
uvx agent-starter-pack setup-cicd
```
這會自動建立一個 GitHub 儲存庫、連接到 Cloud Build、使用 Terraform 設定預備/生產基礎設施，並設定 CI/CD 觸發器。
遵循互動式提示。對於需要精細控制的關鍵系統，請考慮手動設定。
有關詳細資訊，請參閱 [`agent-starter-pack setup-cicd` CLI 參考](../cli/setup_cicd)。*(注意：自動設定目前僅支援 GitHub)。*

**選項 2：手動 CI/CD 設定**
如需完全控制並與其他 Git 供應商相容，請參閱[手動部署設定指南](./deployment.md)。

**首次提交並推送到遠端 (CI/CD 設定後)：**
```bash
git add -A
git config --global user.email "you@example.com" # 如果尚未設定
git config --global user.name "Your Name"     # 如果尚未設定
git commit -m "代理程式程式碼的首次提交"
git push --set-upstream origin main
```

### 5. 監控您已部署的代理程式
使用整合的監測工具追蹤代理程式的效能並收集深入分析。
*   **技術**：OpenTelemetry 事件會傳送到 Google Cloud。
*   **Cloud Trace 和 Logging**：檢查請求流程、分析延遲並審閱提示/輸出。在以下位置存取追蹤：`https://console.cloud.google.com/traces/list?project=YOUR_PROD_PROJECT_ID`
*   **BigQuery**：將追蹤和記錄資料路由至 BigQuery，以進行長期儲存和進階分析。
*   **Looker Studio 儀表板**：使用預建模板將代理程式效能視覺化：
    *   ADK 代理程式：[Looker Studio ADK 儀表板](https://lookerstudio.google.com/c/reporting/46b35167-b38b-4e44-bd37-701ef4307418/page/tEnnC)
    *   非 ADK 代理程式：[Looker Studio 非 ADK 儀表板](https://lookerstudio.google.com/c/reporting/fa742264-4b4b-4c56-81e6-a667dd0f853f/page/tEnnC)
    *(請記得依照儀表板中的「設定說明」來連接您專案的資料來源)。*

➡️ 如需詳細資訊，請參閱[監測指南](./observability.md)。
### 6. 進階客製化與資料
進一步客製化入門套件以符合特定需求。

*   **RAG 資料導入**: 對於檢索增強生成 (RAG) 代理程式，設定資料管線以處理您的資訊並將嵌入載入至 Vertex AI Search 或向量搜尋。
    ➡️ 請參閱[資料導入指南](./data-ingestion.md)。
*   **自訂 Terraform**: 修改 `deployment/terraform/` 中的 Terraform 配置，以滿足獨特的基礎設施需求。
    ➡️ 請參閱[部署指南](./deployment.md)。
