# Gemini Translator API 整合與錯誤處理

## 概述

Gemini Translator 與 Google Gemini AI API 的整合是整個系統的核心，涉及複雜的請求管理、錯誤處理和效能最佳化。本文件詳細分析 API 整合策略和錯誤恢復機制。

## API 整合架構

### 1. API 配置與認證

#### 環境設定
```javascript
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.5-pro';
const apiKey = process.env.GEMINI_API_KEY;
```

#### 安全考量
- **環境變數保護**：API 金鑰透過環境變數管理，避免硬編碼
- **金鑰驗證**：啟動時檢查 API 金鑰是否存在
- **錯誤隱藏**：不在日誌中洩露敏感的 API 金鑰資訊

### 2. 結構化 API 請求

#### 請求格式設計
```javascript
const body = {
    contents: [
        { 
            role: 'user', 
            parts: [
                { text: prompt }, 
                { text: JSON.stringify(texts) }
            ] 
        },
    ],
    generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
            type: 'array',
            minItems: texts.length,
            maxItems: texts.length,
            items: { type: 'string' }
        }
    }
};
```

#### 關鍵設計原則
- **結構化回應**：強制 API 回傳 JSON 陣列格式
- **長度驗證**：確保回應陣列長度與輸入相符
- **類型約束**：限制陣列元素為字串類型

### 3. 智慧提示詞系統

#### 情境注入機制
```javascript
// 動態情境提示詞
let contextPrompt = '';
if (typeof globalThis.translationSummary === 'string' && globalThis.translationSummary) {
    contextPrompt = `\n\n【主題摘要】\n${globalThis.translationSummary}\n`;
}

const contentTypeText = contentType === 'markdown' ? 'markdown content' : 'subtitle content';
const formatInstructions = contentType === 'markdown' ? 
    'Preserve markdown formatting like headers, links, code blocks, and other markdown syntax.' : '';

let prompt = `The following text is a string array containing ${contentTypeText}. 
Translate each element in this array from English to Traditional Chinese (zh-tw). 
${formatInstructions} 
Here is the context of the translation task: \`\`\`${contextPrompt}\`\`\``;
```

#### 術語對應策略
內建術語對應表確保翻譯一致性：
```javascript
prompt += `
<notes>
Use the following term mappings:
- creating = 建立
- object = 物件  
- queue = 佇列
- library = 函式庫
- package = 套件
- class = 類別
- concurrency = 平行處理

Do not translate the following terms:
- Semantic Kernel
- Plugins  
- LLM
</notes>`;
```

## 批次處理策略

### 1. 最佳化批次大小

#### 批次大小選擇
```javascript
const BATCH_SIZE = 10; // 經驗最佳值
```

**選擇考量：**
- **API 效率**：單次請求處理多個項目，減少往返時間
- **記憶體使用**：避免單次請求過大導致記憶體問題
- **錯誤隔離**：批次失敗影響範圍有限
- **重試成本**：重試時工作量適中

### 2. 平行處理機制

#### 併發控制
```javascript
const tasks = batches.map((batch, batchIdx) => async () => {
    // 批次處理邏輯
    const texts = batch.map(b => b.text);
    const translations = await withRetry(async () => {
        return await translateBatch(texts, apiKey, model, contentType);
    }, MAX_RETRY_ATTEMPTS, `批次 ${batchIdx + 1} 翻譯`);
    
    return translations;
});

// 最多 20 個任務並行執行
const allTranslations = await promisePool(tasks, 20);
```

#### 負載平衡
- **動態調整**：根據 API 回應時間調整併發數
- **錯誤隔離**：單一批次失敗不影響其他批次
- **進度追蹤**：即時顯示翻譯進度

### 3. 進度監控

#### 即時進度顯示
```javascript
// 更新進度
completedTasks++;
const startIdx = batchIdx * BATCH_SIZE + 1;
const endIdx = Math.min((batchIdx + 1) * BATCH_SIZE, blocks.length);
process.stdout.write(`\r[${inputFilename}] 翻譯進度: ${completedTasks}/${totalTasks} 批次完成 (第 ${startIdx}-${endIdx} 條已完成)...`);
```

## 錯誤處理機制

### 1. 多層重試策略

#### 基礎重試機制
```javascript
async function withRetry(asyncFunction, maxAttempts = MAX_RETRY_ATTEMPTS, description = '操作') {
    let lastError;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await asyncFunction();
        } catch (error) {
            lastError = error;
            
            if (attempt < maxAttempts) {
                console.error(`\n${description}失敗 (第 ${attempt}/${maxAttempts} 次嘗試): ${error.message}`);
                console.log(`等待 ${attempt} 秒後重試...`);
                
                // 指數退避策略
                await new Promise(resolve => setTimeout(resolve, attempt * 1000));
            }
        }
    }
    
    throw lastError;
}
```

#### 重試策略特點
- **指數退避**：每次重試間隔遞增，避免立即重試
- **錯誤記錄**：詳細記錄每次失敗的原因
- **最大限制**：設定最大重試次數避免無限循環
- **最終錯誤**：所有重試失敗後拋出最後一個錯誤

### 2. API 回應解析

#### 複雜回應處理
```javascript
function extractStrings(val) {
    // 遞迴解析直到取得 string 陣列
    if (Array.isArray(val)) {
        return val.flatMap(extractStrings);
    }
    
    if (typeof val === 'object' && val !== null) {
        // 處理 Gemini API 多種回傳格式
        if (val.candidates && Array.isArray(val.candidates)) {
            return val.candidates.flatMap(extractStrings);
        }
        
        if (val.content && val.content.parts && Array.isArray(val.content.parts)) {
            return val.content.parts.flatMap(extractStrings);
        }
        
        if (typeof val.text === 'string') {
            // 嘗試將 text 欄位解析為 JSON 陣列
            try {
                const arr = JSON.parse(val.text);
                if (Array.isArray(arr)) return extractStrings(arr);
            } catch (e) { }
            return [val.text];
        }
        
        return [JSON.stringify(val)];
    }
    
    if (typeof val === 'string') {
        // 嘗試解析為 JSON 陣列
        try {
            const arr = JSON.parse(val);
            if (Array.isArray(arr)) {
                return arr.flatMap(e => typeof e === 'string' ? [e] : extractStrings(e));
            }
        } catch (e) { }
        return [val];
    }
    
    return [String(val)];
}
```

### 3. 格式驗證與恢復

#### Markdown 格式恢復
```javascript
let retryCount = 0;
let formatCheckPassed = false;

while (!formatCheckPassed && retryCount < MAX_RETRY_ATTEMPTS) {
    const formatCheck = checkMarkdownFormat(blocks, translatedBlocks, argv.debug, inputPath);
    
    if (!formatCheck.isValid) {
        retryCount++;
        
        if (retryCount >= 3) {
            // 第三次失敗後，改用逐行翻譯
            console.log('多次驗證失敗，切換為逐行翻譯以保留特殊語法結構...');
            
            const lineByLineTasks = blocks.map((block, idx) => async () => {
                const translated = await translateMarkdownBlockLineByLine(
                    block.text, apiKey, model
                );
                return { idx, text: translated };
            });
            
            const lineByLineResults = await promisePool(lineByLineTasks, 10);
            // 更新翻譯結果...
        } else {
            // 重新翻譯
            console.log('正在重新翻譯...');
            // 執行重新翻譯邏輯...
        }
    } else {
        formatCheckPassed = true;
    }
}
```

## 效能最佳化

### 1. 記憶體管理

#### 批次釋放策略
```javascript
// 即時處理批次結果，避免累積
const tasks = batches.map((batch, batchIdx) => async () => {
    const result = await processBatch(batch);
    
    // 處理完立即回傳，不保留中間資料
    return result;
});
```

#### 物件重用
```javascript
// 重用翻譯結果結構
translatedBlocks = blocks.map((block, idx) => ({
    ...block,  // 保留原始結構
    text: flatTranslations[idx] || ''  // 僅更新文字內容
}));
```

### 2. 網路最佳化

#### 請求壓縮
```javascript
// 合併小項目減少請求數
if (textsToTranslate.length > 0) {
    translatedTexts = await withRetry(async () => {
        // 單次 API 呼叫處理多個文字
        return await translateBatch(textsToTranslate, apiKey, model, contentType);
    }, MAX_RETRY_ATTEMPTS, `批次翻譯`);
}
```

#### 連線復用
- **HTTP Keep-Alive**：使用 axios 預設的連線復用
- **請求管道化**：batch 請求減少往返次數
- **錯誤快速失敗**：避免無效請求浪費資源

### 3. 快取機制

#### 情境快取
```javascript
// 全域快取翻譯情境，避免重複生成
globalThis.translationSummary = summary;
```

#### 結果快取（潛在擴展）
```javascript
// 未來可實作本地快取，避免重複翻譯相同內容
const cacheKey = crypto.createHash('md5').update(text).digest('hex');
if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
}
```

## 錯誤類型與處理策略

### 1. 網路錯誤
- **連線超時**：重試機制與指數退避
- **DNS 解析失敗**：提示檢查網路連線
- **HTTP 錯誤碼**：根據狀態碼提供具體建議

### 2. API 錯誤
- **配額超出**：提示升級方案或稍後重試
- **認證失敗**：檢查 API 金鑰設定
- **請求格式錯誤**：檢查請求參數

### 3. 回應格式錯誤
- **JSON 解析失敗**：嘗試其他解析策略
- **陣列長度不符**：重新請求或部分處理
- **類型不匹配**：強制類型轉換

### 4. 業務邏輯錯誤
- **翻譯品質檢查失敗**：重新翻譯或逐行處理
- **格式驗證失敗**：切換翻譯策略
- **檔案權限錯誤**：提示修改權限

## 監控與診斷

### 1. 除錯模式
```javascript
if (argv.debug) {
    console.error('\n=== 翻譯數量不符詳細除錯資訊 ===');
    console.error(`批次 ${batchIdx + 1} 翻譯失敗`);
    console.error(`預期輸出數量: ${batch.length}`);
    console.error(`實際輸出數量: ${Array.isArray(result) ? result.length : 'N/A'}`);
    
    console.error('\n原始輸入內容:');
    texts.forEach((text, index) => {
        console.error(`  ${index + 1}. ${text.replace(/\n/g, '\\n').substring(0, 100)}`);
    });
}
```

### 2. 效能追蹤
```javascript
// 追蹤 API 呼叫效能
const startTime = Date.now();
const result = await apiCall();
const duration = Date.now() - startTime;
console.log(`API 呼叫耗時: ${duration}ms`);
```

### 3. 錯誤統計
```javascript
// 統計重試次數和成功率
let totalRetries = 0;
let successfulBatches = 0;
let failedBatches = 0;
```

## 總結

Gemini Translator 的 API 整合展現了現代應用程式在處理外部服務時的最佳實踐。透過多層重試、智慧錯誤恢復、效能最佳化和全面的錯誤處理，系統能夠在各種條件下維持穩定運作，提供可靠的翻譯服務。這種設計不僅提升了使用者體驗，也為系統的長期維護和擴展提供了堅實的基礎。