# Gemini Translator 翻譯策略分析

## 概述

Gemini Translator 是一個基於 Google Gemini AI API 的智慧翻譯工具，專門設計用於將字幕檔案（SRT、WebVTT、ASS）和 Markdown 文件從英文翻譯為繁體中文。本文件詳細分析其翻譯策略和核心機制。

## 核心翻譯策略

### 1. 情境感知翻譯 (Context-Aware Translation)

#### 策略原理
- **內容摘要生成**：在開始翻譯前，工具會先分析整個文件內容，生成包含主題、專有名詞、人物、背景、風格等資訊的摘要
- **上下文注入**：將摘要作為翻譯上下文，提供給後續所有翻譯任務
- **領域專用翻譯**：根據內容領域調整翻譯策略，提高專業術語翻譯準確性

#### 實作細節
```javascript
// 摘要生成流程
const summaryPrompt = `請閱讀以下英文${contentType}內容，並以繁體中文摘要其主題、內容重點、專有名詞、人物、背景、風格等，摘要長度 100-200 字，僅回傳摘要內容：\n${allTexts}`;

// 在翻譯時注入上下文
if (typeof globalThis.translationSummary === 'string' && globalThis.translationSummary) {
    contextPrompt = `\n\n【主題摘要】\n${globalThis.translationSummary}\n`;
}
```

### 2. 批次處理策略 (Batch Processing Strategy)

#### 設計考量
- **批次大小**：每批次處理 10 個項目 (`BATCH_SIZE = 10`)，平衡 API 效率與記憶體使用
- **平行處理**：最多同時執行 20 個批次任務，大幅提升處理速度
- **負載均衡**：使用 Promise Pool 管理併發請求，避免 API 限制

#### 效能最佳化
```javascript
// 批次分割
for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
    const batch = blocks.slice(i, i + BATCH_SIZE);
    batches.push(batch);
}

// 平行處理，最多 20 個同時執行
const allTranslations = await promisePool(tasks, 20);
```

### 3. 格式專用處理策略

#### SRT/WebVTT 字幕格式
- **時間碼保護**：嚴格保護時間碼格式和順序
- **序號修正**：自動檢測並修正不連續的字幕序號
- **結構驗證**：確保翻譯後的時間碼順序正確

#### ASS 進階字幕格式
- **樣式保護**：保留字體、顏色、位置等進階格式設定
- **標頭保護**：維持 ASS 檔案的標頭結構和樣式定義
- **格式轉換**：支援從其他格式轉換為 ASS 格式

#### Markdown 文件格式
- **結構保護**：識別並保護標題、清單、程式碼區塊、連結等結構
- **混合內容處理**：針對包含多種元素的區塊採用逐行翻譯
- **特殊語法驗證**：驗證翻譯後的 Markdown 語法完整性

### 4. 品質保證機制

#### 多層驗證策略
1. **格式驗證**：檢查翻譯後格式是否與原始格式一致
2. **數量驗證**：確保翻譯項目數量與原始項目相符
3. **結構驗證**：驗證特殊語法（如 Markdown）的結構完整性
4. **時序驗證**：檢查字幕時間碼的順序正確性

#### 錯誤恢復機制
```javascript
// 多次重試機制
async function withRetry(asyncFunction, maxAttempts = MAX_RETRY_ATTEMPTS, description = '操作') {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await asyncFunction();
        } catch (error) {
            if (attempt < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, attempt * 1000));
            }
        }
    }
}
```

## 專業術語對應策略

### 術語一致性保證
工具內建專業術語對應表，確保技術文件翻譯的一致性：

```javascript
// 術語對應範例
const termMappings = {
    'creating': '建立',
    'object': '物件',
    'queue': '佇列', 
    'stack': '堆疊',
    'library': '函式庫',
    'package': '套件',
    'class': '類別',
    // ... 更多術語對應
};
```

### 專有名詞保護
- **品牌名稱**：Semantic Kernel、LLM 等專有名詞不進行翻譯
- **技術術語**：維持原文以確保技術準確性
- **API 名稱**：保留 API 和函式名稱的原始格式

## Markdown 特殊處理策略

### 結構元素識別
工具能夠精確識別各種 Markdown 元素：
- 程式碼區塊（```, ~~~）
- 引用區塊（>）
- 表格結構（|）
- HTML 標籤
- LaTeX 數學公式
- VuePress 容器（:::）
- GitHub Callouts（> [!NOTE]）

### 混合內容處理
對於包含多種元素的複雜區塊，採用逐行翻譯策略：
```javascript
// 逐行翻譯保護特殊語法
async function translateMarkdownBlockLineByLine(blockText, apiKey, model) {
    // 識別每行的類型（文字、程式碼、標題等）
    // 僅翻譯純文字內容，保護格式標記
}
```

## API 整合策略

### 結構化回應
- **JSON 模式**：使用 Gemini API 的結構化 JSON 回應模式
- **陣列驗證**：確保回應格式為字串陣列
- **長度驗證**：驗證回應陣列長度與輸入相符

### 錯誤處理
- **API 限制**：自動處理 API 配額和速率限制
- **網路問題**：實作指數退避重試機制
- **格式錯誤**：智慧解析 API 回應，處理格式變化

## 效能最佳化

### 記憶體管理
- **串流處理**：避免將大型檔案完全載入記憶體
- **批次釋放**：及時釋放已處理的批次資料
- **物件複用**：最小化物件建立和銷毀

### 網路最佳化
- **併發控制**：限制同時 API 請求數量避免過載
- **請求合併**：將多個項目合併為單一 API 請求
- **快取機制**：複用摘要資訊，減少重複 API 呼叫

## 總結

Gemini Translator 的翻譯策略結合了情境感知、批次處理、格式保護和品質保證等多個層面，形成了一個完整而強大的翻譯系統。這些策略確保了翻譯品質的同時，也提供了優秀的效能和使用者體驗。