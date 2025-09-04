# Gemini Translator 系統架構分析

## 系統概述

Gemini Translator 是一個現代化的 Node.js CLI 應用程式，採用 ES 模組架構，專門用於翻譯多種檔案格式。系統設計注重模組化、效能最佳化和錯誤恢復能力。

## 整體架構

```
┌─────────────────────────────────────────────────────────────┐
│                     CLI Interface (main.js)                │
├─────────────────────────────────────────────────────────────┤
│  Command Line Parsing │  File Detection │  Progress Display │
└─────────────────┬───────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────┐
│                 Translation Engine                          │
├─────────────────────────────────────────────────────────────┤
│ Context Generation │ Batch Processing │ Format Validation  │
└─────────────────┬───────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────┐
│                Format Processing Layer                      │
├──────────────┬──────────────┬──────────────┬───────────────┤
│ SRT Parser   │ WebVTT Parser│ ASS Parser   │ Markdown Parser│
└──────────────┴──────────────┴──────────────┴───────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────┐
│              Concurrency Management                         │
├─────────────────────────────────────────────────────────────┤
│          Promise Pool (promisePool.js)                     │
│        └─ Max 20 concurrent API requests                   │
└─────────────────┬───────────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────────┐
│                 Gemini API Integration                      │
├─────────────────────────────────────────────────────────────┤
│  Structured JSON │ Retry Logic │ Rate Limiting │ Error Handling│
└─────────────────────────────────────────────────────────────┘
```

## 核心元件分析

### 1. 主應用程式 (main.js)

#### 職責劃分
- **命令列介面**：使用 yargs 處理命令列參數和說明
- **檔案檢測**：自動識別輸入檔案格式和產生輸出路徑
- **流程編排**：協調整個翻譯流程，從解析到輸出
- **錯誤處理**：統一處理各種錯誤情況並提供使用者友善的訊息

#### 關鍵設計模式
```javascript
// 工廠模式 - 格式檢測
function detectSubtitleType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.srt': return 'srt';
        case '.vtt': case '.webvtt': return 'webvtt';
        case '.ass': case '.ssa': return 'ass';
        case '.md': return 'md';
    }
}

// 策略模式 - 格式處理
function parseSubtitle(content, type, bytesPerChunk) {
    switch (type) {
        case 'srt': return parseSRT(content);
        case 'webvtt': return parseWebVTT(content);
        case 'ass': return parseASS(content);
        case 'md': return parseMarkdown(content, bytesPerChunk);
    }
}
```

### 2. 併發管理 (promisePool.js)

#### 設計原理
- **有限資源池**：控制同時執行的 Promise 數量
- **順序保證**：確保結果陣列順序與輸入順序一致
- **錯誤隔離**：單一任務失敗不影響其他任務

#### 實作細節
```javascript
async function promisePool(tasks, concurrency) {
    const results = [];
    let i = 0;
    let running = 0;
    
    return new Promise((resolve, reject) => {
        function runNext() {
            // 達到最大併發數或所有任務完成時的控制邏輯
            while (running < concurrency && i < tasks.length) {
                // 保持順序的任務執行
                const currentIndex = i;
                const task = tasks[i++];
                running++;
                
                Promise.resolve()
                    .then(task)
                    .then(result => {
                        results[currentIndex] = result; // 保持順序
                        running--;
                        runNext();
                    })
                    .catch(reject);
            }
        }
        runNext();
    });
}
```

### 3. 格式解析器

#### SRT 解析器
- **區塊分割**：使用正規表達式分割字幕區塊
- **時間碼解析**：精確解析時間格式
- **錯誤恢復**：處理格式不正確的字幕檔案

#### WebVTT 解析器
- **標頭識別**：正確處理 WEBVTT 標頭
- **可選索引**：支援有無索引的 WebVTT 格式
- **樣式支援**：保留 WebVTT 樣式資訊

#### ASS 解析器
- **區段解析**：分別處理 [Script Info]、[V4+ Styles]、[Events] 區段
- **對話解析**：精確解析 Dialogue 行的各個欄位
- **格式保護**：保留 ASS 檔案的進階格式設定

#### Markdown 解析器
最複雜的解析器，具有多層處理邏輯：

```javascript
// 階層式解析策略
1. 識別程式碼區塊、引用區塊、表格等特殊結構
2. 將文件分割為段落，保留分隔符
3. 合併小段落以達到最佳批次大小
4. 標記需要特殊處理的混合內容區塊
```

### 4. 翻譯引擎

#### 情境生成
```javascript
// 兩階段翻譯流程
1. 內容摘要生成 → 建立翻譯情境
2. 批次翻譯 → 使用情境提升品質
```

#### 批次最佳化
- **動態批次大小**：根據內容類型調整批次大小
- **智慧分組**：將相關內容分組到同一批次
- **負載平衡**：平均分配翻譯任務

### 5. 品質保證系統

#### 驗證管道
```javascript
翻譯完成 → 格式驗證 → 數量驗證 → 結構驗證 → 輸出
     ↓              ↓              ↓              ↓
   失敗處理    → 重新翻譯    → 逐行翻譯    → 錯誤報告
```

#### Markdown 特殊驗證
- **標題層級檢查**：確保標題層級一致
- **清單結構檢查**：驗證清單格式和層級
- **連結完整性檢查**：檢查連結格式和參考
- **程式碼區塊檢查**：驗證程式碼語言標記
- **特殊語法檢查**：檢查 VuePress、GitHub Callouts 等

## 資料流架構

### 1. 正常流程
```
輸入檔案 → 格式檢測 → 內容解析 → 摘要生成 → 批次分割 → 平行翻譯 → 結果合併 → 格式驗證 → 輸出檔案
```

### 2. 錯誤恢復流程
```
翻譯失敗 → 重試機制 → 格式檢查失敗 → 逐行翻譯 → 最大重試達到 → 部分成功輸出
```

### 3. Markdown 複雜流程
```
Markdown輸入 → 結構分析 → 內容分類 → 混合內容標記 → 分層翻譯策略 → 格式驗證循環 → 輸出
                    ↓
            程式碼區塊    純文字區塊    混合區塊
                ↓            ↓           ↓
            保持原樣      批次翻譯    逐行翻譯
```

## 設計模式應用

### 1. 策略模式 (Strategy Pattern)
不同檔案格式使用不同的解析和序列化策略：
```javascript
const strategies = {
    srt: { parse: parseSRT, serialize: serializeSRT },
    webvtt: { parse: parseWebVTT, serialize: serializeWebVTT },
    ass: { parse: parseASS, serialize: serializeASS },
    md: { parse: parseMarkdown, serialize: serializeMarkdown }
};
```

### 2. 工廠模式 (Factory Pattern)
根據檔案副檔名建立對應的處理器：
```javascript
function createProcessor(filePath) {
    const type = detectSubtitleType(filePath);
    return new FormatProcessor(type);
}
```

### 3. 責任鏈模式 (Chain of Responsibility)
錯誤處理和重試機制：
```javascript
翻譯嘗試 → API錯誤重試 → 格式驗證 → 逐行翻譯 → 最終錯誤處理
```

### 4. 觀察者模式 (Observer Pattern)
進度追蹤和狀態更新：
```javascript
// 進度更新機制
process.stdout.write(`\r[${inputFilename}] 翻譯進度: ${completedTasks}/${totalTasks} 批次完成`);
```

## 效能設計

### 1. 記憶體效率
- **串流處理**：避免載入整個檔案到記憶體
- **即時釋放**：處理完的批次立即釋放記憶體
- **物件池**：重複使用物件結構

### 2. 網路效率
- **批次合併**：減少 API 呼叫次數
- **併發控制**：最佳化網路資源使用
- **智慧重試**：指數退避避免網路風暴

### 3. CPU 效率
- **非同步處理**：充分利用 Node.js 事件迴圈
- **正規表達式快取**：避免重複編譯
- **演算法最佳化**：選擇適當的資料結構和演算法

## 擴充性設計

### 1. 新格式支援
系統設計使添加新格式變得簡單：
```javascript
// 添加新格式只需實作三個函式
function parseNewFormat(content) { /* 解析邏輯 */ }
function serializeNewFormat(blocks) { /* 序列化邏輯 */ }
function detectNewFormat(filePath) { /* 檢測邏輯 */ }
```

### 2. 新 AI 模型支援
透過設定檔輕鬆支援新的 AI 模型：
```javascript
const supportedModels = [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'future-model-name'
];
```

### 3. 新語言支援
翻譯提示詞模組化，便於支援其他語言：
```javascript
const translationPrompts = {
    'zh-tw': '翻譯為繁體中文',
    'zh-cn': '翻譯為簡體中文',
    'ja': '日本語に翻訳'
};
```

## 安全性考量

### 1. 輸入驗證
- **檔案大小限制**：防止記憶體耗盡攻擊
- **格式驗證**：確保輸入檔案格式正確
- **路徑檢查**：防止路徑穿越攻擊

### 2. API 安全
- **金鑰保護**：從環境變數讀取 API 金鑰
- **請求限制**：控制 API 請求頻率
- **錯誤隱藏**：不在日誌中洩露敏感資訊

### 3. 輸出安全
- **檔案覆寫確認**：防止意外覆寫重要檔案
- **權限檢查**：確保有寫入權限
- **原子寫入**：確保寫入操作的原子性

## 總結

Gemini Translator 的架構展現了現代 Node.js 應用程式的最佳實踐，結合了模組化設計、效能最佳化、錯誤恢復和擴充性考量。這個架構不僅支援當前的需求，也為未來的功能擴展和維護提供了良好的基礎。