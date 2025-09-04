# Gemini Translator 格式處理詳解

## 概述

Gemini Translator 支援四種主要檔案格式：SRT、WebVTT、ASS 字幕格式，以及 Markdown 文件格式。每種格式都有其獨特的結構和處理要求，本文件詳細說明各格式的處理策略。

## SRT 格式處理

### 格式結構
```
1
00:00:01,000 --> 00:00:03,000
Hello World

2
00:00:04,000 --> 00:00:06,000
How are you?
```

### 解析策略
```javascript
function parseSRT(content) {
    // 1. 確保內容以換行結尾，便於最後一個字幕的分割
    if (!content.match(/\r?\n\s*$/)) {
        content += '\n';
    }
    
    // 2. 使用雙換行分割字幕區塊
    const blocks = content.split(/(?:\r?\n){2,}/);
    
    // 3. 解析每個區塊的結構
    return blocks.map(block => {
        const lines = block.split(/\r?\n/);
        if (lines.length < 3) return null;
        
        const index = lines[0].trim();      // 序號
        const time = lines[1].trim();       // 時間碼
        const text = lines.slice(2).join('\n').trim(); // 字幕文字
        
        return { index, time, text };
    }).filter(Boolean);
}
```

### 特殊處理
- **序號連續性檢查**：檢測並可自動修正不連續的序號
- **時間碼驗證**：確保時間碼格式正確且順序合理
- **多行字幕支援**：正確處理跨行的字幕文字

### 品質保證
```javascript
// 時間碼順序檢查
function checkSequentialTimestamps(blocks) {
    let prev = null;
    for (let i = 0; i < blocks.length; ++i) {
        const [start] = blocks[i].time.split(' --> ');
        if (prev && start < prev) {
            return false; // 時間碼順序錯誤
        }
        prev = start;
    }
    return true;
}
```

## WebVTT 格式處理

### 格式結構
```
WEBVTT

1
00:00:01.000 --> 00:00:03.000
Hello World

00:00:04.000 --> 00:00:06.000
How are you?
```

### 解析策略
WebVTT 格式比 SRT 更複雜，支援可選的序號和樣式設定：

```javascript
function parseWebVTT(content) {
    const segments = content.split(/\n\s*\n/);
    const blocks = [];
    
    for (const segment of segments) {
        const lines = segment.trim().split(/\r?\n/);
        
        // 跳過 WEBVTT 標頭
        if (lines[0].trim() === 'WEBVTT') continue;
        
        // 尋找時間碼行
        let timeIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(' --> ')) {
                timeIndex = i;
                break;
            }
        }
        
        if (timeIndex === -1) continue;
        
        // 檢查是否有序號
        let index = null;
        if (timeIndex > 0) {
            const potentialIndex = lines[timeIndex - 1].trim();
            if (!isNaN(parseInt(potentialIndex, 10))) {
                index = potentialIndex;
            }
        }
        
        const time = lines[timeIndex].trim();
        const text = lines.slice(timeIndex + 1).join('\n').trim();
        
        blocks.push({ index, time, text });
    }
    
    // 為沒有序號的字幕自動分配序號
    let autoIndex = 1;
    for (const block of blocks) {
        if (!block.index) {
            block.index = String(autoIndex);
        }
        autoIndex++;
    }
    
    return blocks;
}
```

### 特殊功能
- **彈性序號**：支援有序號和無序號的 WebVTT
- **樣式保護**：保留 WebVTT 的樣式資訊
- **自動序號**：為沒有序號的字幕自動分配

## ASS 格式處理

### 格式結構
```
[Script Info]
Title: Demo
ScriptType: v4.00+

[V4+ Styles]
Format: Name,Fontname,Fontsize...
Style: Default,Arial,20,&H00FFFFFF...

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello World
```

### 解析策略
ASS 格式最為複雜，包含多個區段和豐富的樣式資訊：

```javascript
function parseASS(content) {
    const lines = content.split(/\r?\n/);
    const blocks = [];
    let inEvents = false;
    
    for (const line of lines) {
        const trimmed = line.trim();
        
        // 檢查是否進入 Events 區段
        if (trimmed === '[Events]') {
            inEvents = true;
            continue;
        }
        
        // 檢查是否離開 Events 區段
        if (trimmed.startsWith('[') && trimmed !== '[Events]') {
            inEvents = false;
            continue;
        }
        
        // 解析 Dialogue 行
        if (inEvents && trimmed.startsWith('Dialogue:')) {
            const dialogueLine = trimmed.substring(9).trim();
            const parts = dialogueLine.split(',');
            
            if (parts.length >= 10) {
                const start = parts[1].trim();
                const end = parts[2].trim();
                const text = parts.slice(9).join(',').trim();
                
                // 移除 ASS 格式標籤和處理換行
                const cleanText = text.replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n');
                
                blocks.push({
                    time: `${start} --> ${end}`,
                    text: cleanText
                });
            }
        }
    }
    
    return blocks;
}
```

### 序列化策略
ASS 序列化需要重建完整的檔案結構：

```javascript
function serializeASS(blocks, originalContent = '') {
    let header = '';
    
    if (originalContent) {
        // 從原始內容提取標頭
        const lines = originalContent.split(/\r?\n/);
        // ... 提取 [Script Info]、[V4+ Styles] 等區段
    } else {
        // 使用預設標頭
        header = defaultASSHeader;
    }
    
    // 重建 Dialogue 行
    const dialogues = blocks.map(b => {
        const [start, end] = b.time.split(' --> ');
        const text = b.text.replace(/\n/g, '\\N');
        return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
    });
    
    return header + dialogues.join('\n') + '\n';
}
```

## Markdown 格式處理

### 複雜度分析
Markdown 是最複雜的格式，需要處理：
- 程式碼區塊（保護不翻譯）
- 連結和圖片（保護 URL）
- 表格結構
- 清單和引用
- 特殊語法（VuePress、GitHub Callouts）

### 解析策略

#### 第一階段：結構識別
```javascript
function parseMarkdown(content, bytesPerChunk) {
    // 1. 正規化換行字元
    content = content.replace(/\r\n/g, '\n');
    
    // 2. 識別特殊區塊
    const patterns = [
        /^(```|~~~)[\s\S]*?^\1\n?/gm,    // 程式碼區塊
        /^(?:[ ]{0,3}(?:[-*+]|\d+\.))[ \t]+.*(?:\n|$)(?:[ \t].*(?:\n|$))*/gm, // 清單
        /^(?:>[ \t]?.*(?:\n|$))+/gm,      // 引用區塊
        /^(?:\|.*\|(?:\n|$))+/gm,         // 表格
        /^(?:<([a-z][a-z0-9]*)\b[^>]*>[\s\S]*?<\/\1>|<[a-z][a-z0-9]*\b[^>]*\/>)\n?/gmi, // HTML
        /^\$\$[\s\S]*?\$\$\n?/gm          // LaTeX
    ];
    
    // 3. 提取特殊區塊並記錄位置
    let extractedBlocks = [];
    patterns.forEach(regex => {
        let match;
        while ((match = regex.exec(content)) !== null) {
            extractedBlocks.push({
                start: match.index,
                end: match.index + match[0].length,
                text: match[0]
            });
        }
    });
    
    // 4. 處理重疊區塊，保留較大的容器
    const finalBlocks = filterOverlappingBlocks(extractedBlocks);
    
    return finalBlocks;
}
```

#### 第二階段：段落分割與合併
```javascript
function splitAndMergeContent(content, bytesPerChunk, specialBlocks) {
    const segments = [];
    
    // 1. 分割為段落，保留分隔符
    const paragraphs = content.split(/\n\n+/);
    
    // 2. 合併小段落以達到最佳批次大小
    const merged = [];
    let current = paragraphs[0];
    
    for (let i = 1; i < paragraphs.length; i++) {
        const combined = current + '\n\n' + paragraphs[i];
        if (Buffer.byteLength(combined, 'utf8') <= bytesPerChunk) {
            current = combined;
        } else {
            merged.push(current);
            current = paragraphs[i];
        }
    }
    merged.push(current);
    
    return merged;
}
```

### 翻譯策略分類

#### 1. 純文字區塊
直接使用批次翻譯，效率最高：
```javascript
const pureTextBlocks = blocks.filter(block => 
    !containsSpecialSyntax(block) && 
    !containsCodeFences(block)
);
```

#### 2. 程式碼區塊
完全保護，不進行翻譯：
```javascript
const codeBlocks = blocks.filter(block => 
    isCompleteCodeFence(block.text)
);
// 直接回傳原文
```

#### 3. 混合內容區塊
使用逐行翻譯策略：
```javascript
const mixedBlocks = blocks.filter(block => 
    containsMultipleElements(block) || 
    containsLinkReferences(block)
);

// 逐行處理，保護特殊語法
for (const block of mixedBlocks) {
    const translatedText = await translateMarkdownBlockLineByLine(
        block.text, apiKey, model
    );
}
```

### 逐行翻譯機制

```javascript
async function translateMarkdownBlockLineByLine(blockText, apiKey, model) {
    const lines = blockText.split('\n');
    const items = [];
    
    for (const line of lines) {
        // 檢查行類型
        if (isCodeFence(line)) {
            items.push({ kind: 'literal', text: line });
        } else if (isHeader(line)) {
            const [prefix, content] = parseHeader(line);
            items.push({ kind: 'translate', prefix, text: content });
        } else if (isList(line)) {
            const [prefix, content] = parseList(line);
            items.push({ kind: 'translate', prefix, text: content });
        } else if (isLinkReference(line)) {
            items.push({ kind: 'literal', text: line });
        } else {
            items.push({ kind: 'translate', prefix: '', text: line });
        }
    }
    
    // 批次翻譯需要翻譯的行
    const textsToTranslate = items
        .filter(item => item.kind === 'translate')
        .map(item => item.text);
    
    const translations = await translateBatch(textsToTranslate, apiKey, model, 'markdown');
    
    // 重組結果
    let translationIndex = 0;
    return items.map(item => {
        if (item.kind === 'literal') {
            return item.text;
        } else {
            return item.prefix + translations[translationIndex++];
        }
    }).join('\n');
}
```

### 格式驗證機制

#### 1. 結構元素驗證
```javascript
function checkMarkdownFormat(originalBlocks, translatedBlocks) {
    const errors = [];
    
    for (let i = 0; i < originalBlocks.length; i++) {
        const original = originalBlocks[i].text;
        const translated = translatedBlocks[i].text;
        
        // 檢查標題
        const originalHeaders = extractMarkdownHeaders(original);
        const translatedHeaders = extractMarkdownHeaders(translated);
        if (originalHeaders.length !== translatedHeaders.length) {
            errors.push(`標題數量不一致`);
        }
        
        // 檢查清單
        const originalLists = extractMarkdownLists(original);
        const translatedLists = extractMarkdownLists(translated);
        if (originalLists.length !== translatedLists.length) {
            errors.push(`清單項目數量不一致`);
        }
        
        // 檢查程式碼區塊
        const originalCode = extractMarkdownCodeBlocks(original);
        const translatedCode = extractMarkdownCodeBlocks(translated);
        if (originalCode.length !== translatedCode.length) {
            errors.push(`程式碼區塊數量不一致`);
        }
        
        // 檢查連結
        const originalLinks = extractMarkdownLinks(original);
        const translatedLinks = extractMarkdownLinks(translated);
        if (originalLinks.length !== translatedLinks.length) {
            errors.push(`連結數量不一致`);
        }
    }
    
    return { isValid: errors.length === 0, errors };
}
```

#### 2. 特殊語法驗證
```javascript
function extractMarkdownSpecialSyntax(text) {
    const special = [];
    const lines = text.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // VuePress 容器
        const vuepressMatch = line.match(/^:::\s*(\w+)(.*)$/);
        if (vuepressMatch) {
            special.push({
                type: vuepressMatch[1],
                syntax: 'vuepress-container',
                line: i + 1
            });
        }
        
        // GitHub Callouts
        const calloutMatch = line.match(/^>\s*\[!(\w+)\](.*)$/);
        if (calloutMatch) {
            special.push({
                type: calloutMatch[1].toLowerCase(),
                syntax: 'github-callout',
                line: i + 1
            });
        }
        
        // 其他特殊語法...
    }
    
    return special;
}
```

## 格式轉換支援

### 跨格式轉換
工具支援在不同字幕格式之間轉換：

```bash
# SRT 轉 ASS
gemini-translator -i input.srt -o output.ass

# WebVTT 轉 SRT  
gemini-translator -i input.vtt -o output.srt
```

### 轉換策略
1. **解析為通用格式**：所有格式先轉換為內部統一結構
2. **翻譯處理**：在統一結構上進行翻譯
3. **目標格式序列化**：根據輸出格式要求序列化

### 格式相容性
- **時間碼格式**：自動轉換不同的時間碼格式
- **序號處理**：根據目標格式決定是否保留序號
- **樣式資訊**：儘可能保留樣式資訊，無法保留時提供警告

## 總結

Gemini Translator 的格式處理系統展現了對各種檔案格式的深度理解和精細處理。從簡單的 SRT 格式到複雜的 Markdown 文件，每種格式都有其專門的解析策略和品質保證機制。這種設計確保了翻譯品質和格式完整性的雙重保證。