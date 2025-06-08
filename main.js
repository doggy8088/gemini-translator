#!/usr/bin/env node
// Gemini 英翻中（繁體）翻譯器
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import promisePool from './promisePool.js';

const BATCH_SIZE = 10;
const DEFAULT_MODEL = 'gemini-2.5-flash-preview-05-20';
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

function parseArgs() {
    return yargs(hideBin(process.argv))        .usage('用法: npx @willh/gemini-translator --input <input.srt> [--output <output.srt>] [--model <model>] [--autofix]')
        .option('input', { alias: 'i', demandOption: true, describe: '輸入檔案路徑 (支援 .srt, .vtt, .ass, .md)', type: 'string' })
        .option('output', { alias: 'o', describe: '輸出檔案路徑，預設根據輸入檔案自動產生。可指定不同格式的副檔名進行格式轉換', type: 'string' })
        .option('model', { alias: 'm', describe: 'Gemini 模型，預設為 gemini-2.5-flash-preview-05-20', type: 'string', default: DEFAULT_MODEL })        .option('autofix', { describe: '自動修正字幕序號不連續問題 (適用於 SRT 和 WebVTT)', type: 'boolean', default: false })        .example('npx @willh/gemini-translator --input input.srt', '將 input.srt 翻譯為 input.zh.srt')
        .example('npx @willh/gemini-translator -i input.vtt', '翻譯 WebVTT 檔案')
        .example('npx @willh/gemini-translator -i input.ass -o output.ass', '翻譯 ASS 檔案')
        .example('npx @willh/gemini-translator -i input.md', '翻譯 Markdown 檔案')
        .example('npx @willh/gemini-translator -i input.srt -o output.ass', '將 SRT 翻譯並轉換為 ASS 格式')
        .example('npx @willh/gemini-translator -i input.vtt -o output.srt', '將 WebVTT 翻譯並轉換為 SRT 格式')
        .example('npx @willh/gemini-translator -i input.srt --autofix', '自動修正 SRT 字幕序號不連續問題')
        .example('npx @willh/gemini-translator -i input.vtt --autofix', '自動修正 WebVTT 字幕序號不連續問題')
        .help('h')
        .alias('h', 'help')
        .wrap(null)
        .parse();
}

function parseSRT(content) {
    // 解析 SRT，回傳 [{index, time, text}]
    // 若結尾無多餘換行，補一個換行，確保最後一條字幕能被分割
    if (!content.match(/\r?\n\s*$/)) {
        content += '\n';
    }
    const blocks = content.split(/(?:\r?\n){2,}/);
    return blocks.map(block => {
        const lines = block.split(/\r?\n/);
        if (lines.length < 3) return null;
        const index = lines[0].trim();
        const time = lines[1].trim();
        const text = lines.slice(2).join('\n').trim();
        if (!index || !time || !text) return null;
        return { index, time, text };
    }).filter(Boolean);
}

function serializeSRT(blocks) {
    return blocks.map(b => `${b.index}\n${b.time}\n${b.text}\n`).join('\n');
}

function parseWebVTT(content) {
    // 解析 WebVTT，回傳 [{index, time, text}]
    // 分割成段落
    const segments = content.split(/\n\s*\n/);
    const blocks = [];

    for (const segment of segments) {
        const lines = segment.trim().split(/\r?\n/);
        if (lines.length === 0 || lines[0].trim() === 'WEBVTT') {
            continue;
        }

        let index = null;
        let timeIndex = -1;

        // 尋找時間碼行
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(' --> ')) {
                timeIndex = i;
                break;
            }
        }

        if (timeIndex === -1) {
            continue; // 沒有找到時間碼，跳過這個段落
        }

        // 檢查時間碼前面是否有索引
        if (timeIndex > 0) {
            const potentialIndex = lines[timeIndex - 1].trim();
            if (!isNaN(parseInt(potentialIndex, 10)) && String(parseInt(potentialIndex, 10)) === potentialIndex) {
                index = potentialIndex;
            }
        }

        const time = lines[timeIndex].trim();
        const textLines = lines.slice(timeIndex + 1);
        const text = textLines.join('\n').trim();

        if (text) {
            blocks.push({
                index: index,
                time: time,
                text: text
            });
        }
    }

    // 為沒有索引的塊分配順序索引
    let autoIndex = 1;
    for (const block of blocks) {
        if (!block.index) {
            block.index = String(autoIndex);
        }
        autoIndex++;
    }

    return blocks;
}

function serializeWebVTT(blocks) {
    let result = 'WEBVTT\n\n';
    result += blocks.map(b => {
        if (b.index) {
            return `${b.index}\n${b.time}\n${b.text}`;
        } else {
            return `${b.time}\n${b.text}`;
        }
    }).join('\n\n');
    return result;
}

function parseASS(content) {
    // 解析 ASS，回傳 [{time, text}] (ASS 沒有序號)
    const lines = content.split(/\r?\n/);
    const blocks = [];
    let inEvents = false;
    let formatLine = null;

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed === '[Events]') {
            inEvents = true;
            continue;
        }

        if (trimmed.startsWith('[') && trimmed !== '[Events]') {
            inEvents = false;
            continue;
        }

        if (inEvents && trimmed.startsWith('Format:')) {
            formatLine = trimmed.substring(7).trim();
            continue;
        }

        if (inEvents && trimmed.startsWith('Dialogue:')) {
            const dialogueLine = trimmed.substring(9).trim();
            const parts = dialogueLine.split(',');

            if (parts.length >= 10) {
                const start = parts[1].trim();
                const end = parts[2].trim();
                const text = parts.slice(9).join(',').trim();

                // Remove ASS formatting tags
                const cleanText = text.replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n');

                if (cleanText) {
                    blocks.push({
                        time: `${start} --> ${end}`,
                        text: cleanText
                    });
                }
            }
        }
    }

    return blocks;
}

function serializeASS(blocks, originalContent = '') {
    // Extract header from original content or use default
    let header = '';
    if (originalContent) {
        const lines = originalContent.split(/\r?\n/);
        let inEvents = false;
        for (const line of lines) {
            if (line.trim() === '[Events]') {
                inEvents = true;
                header += line + '\n';
                continue;
            }
            if (!inEvents) {
                header += line + '\n';
            }
            if (inEvents && line.trim().startsWith('Format:')) {
                header += line + '\n';
                break;
            }
        }    } else {
        // Default ASS header
        header = `[Script Info]
Title: Converted from WebVTT
ScriptType: v4.00+
WrapStyle: 0
PlayResX: 1280
PlayResY: 720
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default, 微軟正黑體,48,&H0080FFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,2,0,2,1,1,40,1
Style: Secondary,Helvetica,12,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,2,1,1,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
    }

    const dialogues = blocks.map(b => {
        const [start, end] = b.time.split(' --> ');
        const text = b.text.replace(/\n/g, '\\N');
        return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
    });
    return header + dialogues.join('\n') + '\n';
}

function parseMarkdown(content) {
    // Parse Markdown content and return chunks for translation
    // Each chunk is treated as a block with text content
    // For files larger than 1000 bytes, split by lines
    const chunks = [];

    if (Buffer.byteLength(content, 'utf8') > 1000) {
        // Split large files by lines, but keep related content together
        const lines = content.split(/\r?\n/);
        let currentChunk = '';
        let chunkIndex = 1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const testChunk = currentChunk + (currentChunk ? '\n' : '') + line;

            // If adding this line would exceed reasonable chunk size (500 bytes),
            // or we hit a natural break point (empty line after content)
            if (Buffer.byteLength(testChunk, 'utf8') > 500 && currentChunk) {
                // Save current chunk if it has content
                if (currentChunk) {
                    chunks.push({
                        index: String(chunkIndex++),
                        text: currentChunk
                    });
                }
                currentChunk = line;
            } else {
                currentChunk = testChunk;
            }
        }

        // Add the last chunk
        if (currentChunk) {
            chunks.push({
                index: String(chunkIndex),
                text: currentChunk
            });
        }
    } else {
        // Small files are treated as single chunk
        chunks.push({
            index: '1',
            text: content.trim()
        });
    }

    return chunks;
}

function serializeMarkdown(blocks) {
    // Reconstruct Markdown content from translated blocks
    return blocks.map(b => b.text).join('\n');
}

function parseSubtitle(content, type) {
    switch (type) {
        case 'srt':
            return parseSRT(content);
        case 'webvtt':
            return parseWebVTT(content);
        case 'ass':
            return parseASS(content);
        case 'md':
            return parseMarkdown(content);
        default:
            throw new Error(`不支援的字幕格式: ${type}`);
    }
}

function serializeSubtitle(blocks, type, originalContent = '') {
    switch (type) {
        case 'srt':
            return serializeSRT(blocks);
        case 'webvtt':
            return serializeWebVTT(blocks);
        case 'ass':
            // Only pass originalContent if it's already ASS format
            const isOriginalASS = originalContent && originalContent.includes('[Script Info]');
            return serializeASS(blocks, isOriginalASS ? originalContent : '');
        case 'md':
            return serializeMarkdown(blocks);
        default:
            throw new Error(`不支援的字幕格式: ${type}`);
    }
}

function generateOutputPath(inputPath, type) {
    const ext = path.extname(inputPath);
    const baseName = inputPath.replace(ext, '');

    switch (type) {
        case 'srt':
            return `${baseName}.zh.srt`;
        case 'webvtt':
            return `${baseName}.zh.vtt`;
        case 'ass':
            return `${baseName}.zh.ass`;
        case 'md':
            return `${baseName}.zh.md`;
        default:
            return `${baseName}.zh${ext}`;
    }
}

function detectSubtitleType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.srt':
            return 'srt';
        case '.vtt':
        case '.webvtt':
            return 'webvtt';
        case '.ass':
        case '.ssa':
            return 'ass';
        case '.md':
            return 'md';
        default:
            throw new Error(`不支援的字幕檔案格式: ${ext}。支援的格式: .srt, .vtt, .webvtt, .ass, .ssa, .md`);
    }
}

function checkSequentialTimestamps(blocks) {
    let prev = null;
    for (let i = 0; i < blocks.length; ++i) {
        const b = blocks[i];
        if (!b.time) {
            console.warn(`[checkSequentialTimestamps] Block ${i + 1} 缺少時間碼:`, b);
            continue;
        }
        const [start] = b.time.split(' --> ');
        if (!start) {
            console.warn(`[checkSequentialTimestamps] Block ${i + 1} 時間碼格式錯誤:`, b.time);
            continue;
        }
        if (prev && start < prev) {
            console.error(`[checkSequentialTimestamps] 時間碼順序錯誤: Block ${i} (${prev}) -> Block ${i + 1} (${start})`);
            return false;
        }
        prev = start;
    }
    // console.log('[checkSequentialTimestamps] 時間碼順序檢查通過');
    return true;
}

/**
 * 檢查原始 Markdown 和翻譯後 Markdown 的格式是否一致
 * @param {Array} originalBlocks - 原始 Markdown 區塊
 * @param {Array} translatedBlocks - 翻譯後 Markdown 區塊
 * @returns {Object} 檢查結果 { isValid: boolean, errors: Array }
 */
function checkMarkdownFormat(originalBlocks, translatedBlocks) {
    const errors = [];
    
    // 檢查區塊數量是否一致
    if (originalBlocks.length !== translatedBlocks.length) {
        errors.push(`區塊數量不一致: 原始 ${originalBlocks.length} 個，翻譯後 ${translatedBlocks.length} 個`);
        return { isValid: false, errors };
    }

    // 逐一檢查每個區塊的格式
    for (let i = 0; i < originalBlocks.length; i++) {
        const original = originalBlocks[i].text;
        const translated = translatedBlocks[i].text;
        
        // 檢查標題格式 (# ## ### 等)
        const originalHeaders = extractMarkdownHeaders(original);
        const translatedHeaders = extractMarkdownHeaders(translated);
        
        if (originalHeaders.length !== translatedHeaders.length) {
            errors.push(`區塊 ${i + 1}: 標題數量不一致 (原始: ${originalHeaders.length}, 翻譯: ${translatedHeaders.length})`);
        } else {
            for (let j = 0; j < originalHeaders.length; j++) {
                if (originalHeaders[j].level !== translatedHeaders[j].level) {
                    errors.push(`區塊 ${i + 1}: 標題層級不一致 (位置 ${j + 1}, 原始: ${originalHeaders[j].level}, 翻譯: ${translatedHeaders[j].level})`);
                }
            }
        }

        // 檢查列表格式
        const originalLists = extractMarkdownLists(original);
        const translatedLists = extractMarkdownLists(translated);
        
        if (originalLists.length !== translatedLists.length) {
            errors.push(`區塊 ${i + 1}: 列表項目數量不一致 (原始: ${originalLists.length}, 翻譯: ${translatedLists.length})`);
        } else {
            for (let j = 0; j < originalLists.length; j++) {
                if (originalLists[j].type !== translatedLists[j].type) {
                    errors.push(`區塊 ${i + 1}: 列表類型不一致 (位置 ${j + 1}, 原始: ${originalLists[j].type}, 翻譯: ${translatedLists[j].type})`);
                }
                if (originalLists[j].level !== translatedLists[j].level) {
                    errors.push(`區塊 ${i + 1}: 列表層級不一致 (位置 ${j + 1}, 原始: ${originalLists[j].level}, 翻譯: ${translatedLists[j].level})`);
                }
            }
        }

        // 檢查程式碼區塊
        const originalCodeBlocks = extractMarkdownCodeBlocks(original);
        const translatedCodeBlocks = extractMarkdownCodeBlocks(translated);
        
        if (originalCodeBlocks.length !== translatedCodeBlocks.length) {
            errors.push(`區塊 ${i + 1}: 程式碼區塊數量不一致 (原始: ${originalCodeBlocks.length}, 翻譯: ${translatedCodeBlocks.length})`);
        } else {
            for (let j = 0; j < originalCodeBlocks.length; j++) {
                if (originalCodeBlocks[j].language !== translatedCodeBlocks[j].language) {
                    errors.push(`區塊 ${i + 1}: 程式碼語言不一致 (位置 ${j + 1}, 原始: "${originalCodeBlocks[j].language}", 翻譯: "${translatedCodeBlocks[j].language}")`);
                }
                if (originalCodeBlocks[j].type !== translatedCodeBlocks[j].type) {
                    errors.push(`區塊 ${i + 1}: 程式碼區塊類型不一致 (位置 ${j + 1}, 原始: ${originalCodeBlocks[j].type}, 翻譯: ${translatedCodeBlocks[j].type})`);
                }
            }
        }

        // 檢查連結格式
        const originalLinks = extractMarkdownLinks(original);
        const translatedLinks = extractMarkdownLinks(translated);
        
        if (originalLinks.length !== translatedLinks.length) {
            errors.push(`區塊 ${i + 1}: 連結數量不一致 (原始: ${originalLinks.length}, 翻譯: ${translatedLinks.length})`);
        } else {
            for (let j = 0; j < originalLinks.length; j++) {
                if (originalLinks[j].url !== translatedLinks[j].url) {
                    errors.push(`區塊 ${i + 1}: 連結 URL 不一致 (位置 ${j + 1}, 原始: "${originalLinks[j].url}", 翻譯: "${translatedLinks[j].url}")`);
                }
            }
        }

        // 檢查特殊語法（如 ::: tip 等）
        const originalSpecial = extractMarkdownSpecialSyntax(original);
        const translatedSpecial = extractMarkdownSpecialSyntax(translated);
        
        if (originalSpecial.length !== translatedSpecial.length) {
            errors.push(`區塊 ${i + 1}: 特殊語法數量不一致 (原始: ${originalSpecial.length}, 翻譯: ${translatedSpecial.length})`);
        } else {
            for (let j = 0; j < originalSpecial.length; j++) {
                if (originalSpecial[j].type !== translatedSpecial[j].type) {
                    errors.push(`區塊 ${i + 1}: 特殊語法類型不一致 (位置 ${j + 1}, 原始: "${originalSpecial[j].type}", 翻譯: "${translatedSpecial[j].type}")`);
                }
            }
        }
    }

    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * 提取 Markdown 標題
 * @param {string} text - Markdown 文本
 * @returns {Array} 標題列表，包含層級信息
 */
function extractMarkdownHeaders(text) {
    const headers = [];
    const lines = text.split('\n');
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#')) {
            const match = trimmed.match(/^(#{1,6})\s+/);
            if (match) {
                headers.push({
                    level: match[1].length,
                    text: trimmed.substring(match[0].length).trim()
                });
            }
        }
    }
    
    return headers;
}

/**
 * 提取 Markdown 列表項目
 * @param {string} text - Markdown 文本
 * @returns {Array} 列表項目，包含類型和層級信息
 */
function extractMarkdownLists(text) {
    const lists = [];
    const lines = text.split('\n');
    
    for (const line of lines) {
        const trimmed = line.trim();
        
        // 無序列表 (*, -, +)
        const unorderedMatch = trimmed.match(/^(\s*)([-*+])\s+/);
        if (unorderedMatch) {
            lists.push({
                type: 'unordered',
                level: Math.floor(unorderedMatch[1].length / 4) + 1, // 假設每 4 個空格為一層
                marker: unorderedMatch[2]
            });
            continue;
        }
        
        // 有序列表 (1., 2., etc.)
        const orderedMatch = trimmed.match(/^(\s*)(\d+\.)\s+/);
        if (orderedMatch) {
            lists.push({
                type: 'ordered',
                level: Math.floor(orderedMatch[1].length / 4) + 1,
                marker: orderedMatch[2]
            });
        }
    }
    
    return lists;
}

/**
 * 提取 Markdown 程式碼區塊
 * @param {string} text - Markdown 文本
 * @returns {Array} 程式碼區塊，包含語言和類型信息
 */
function extractMarkdownCodeBlocks(text) {
    const codeBlocks = [];
    const lines = text.split('\n');
    let inCodeBlock = false;
    let currentBlock = null;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // 檢查行內程式碼 `code`
        const inlineCodeMatches = line.match(/`[^`]+`/g);
        if (inlineCodeMatches) {
            inlineCodeMatches.forEach(() => {
                codeBlocks.push({
                    type: 'inline',
                    language: '',
                    content: ''
                });
            });
        }
        
        // 檢查程式碼區塊 ```
        if (line.trim().startsWith('```')) {
            if (!inCodeBlock) {
                // 開始程式碼區塊
                const language = line.trim().substring(3).trim();
                currentBlock = {
                    type: 'block',
                    language: language,
                    content: ''
                };
                inCodeBlock = true;
            } else {
                // 結束程式碼區塊
                if (currentBlock) {
                    codeBlocks.push(currentBlock);
                    currentBlock = null;
                }
                inCodeBlock = false;
            }
        } else if (inCodeBlock && currentBlock) {
            currentBlock.content += line + '\n';
        }
    }
    
    return codeBlocks;
}

/**
 * 提取 Markdown 連結
 * @param {string} text - Markdown 文本
 * @returns {Array} 連結列表，包含 URL 和文本
 */
function extractMarkdownLinks(text) {
    const links = [];
    
    // 標準連結格式 [text](url)
    const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
    let match;
    
    while ((match = linkRegex.exec(text)) !== null) {
        links.push({
            text: match[1],
            url: match[2]
        });
    }
    
    return links;
}

/**
 * 提取 Markdown 特殊語法（如 VuePress 的 ::: tip 等）
 * @param {string} text - Markdown 文本
 * @returns {Array} 特殊語法列表
 */
function extractMarkdownSpecialSyntax(text) {
    const special = [];
    const lines = text.split('\n');
    
    for (const line of lines) {
        const trimmed = line.trim();
        
        // VuePress 容器語法 ::: type
        if (trimmed.startsWith(':::')) {
            const match = trimmed.match(/^:::\s*(\w+)/);
            if (match) {
                special.push({
                    type: match[1],
                    syntax: 'vuepress-container'
                });
            }
        }
        
        // 其他特殊語法可以在這裡添加
    }
    
    return special;
}

// 修改 translateBatch，於 prompt 加入摘要 context
async function translateBatch(texts, apiKey, model, contentType = 'subtitle') {
    // 若有摘要，加入 context 以提升翻譯品質
    let contextPrompt = '';
    if (typeof globalThis.translationSummary === 'string' && globalThis.translationSummary) {
        contextPrompt = `\n\n【主題摘要】\n${globalThis.translationSummary}\n`;
    }

    const contentTypeText = contentType === 'markdown' ? 'markdown content' : 'subtitle content';
    const formatInstructions = contentType === 'markdown' ? 'Preserve markdown formatting like headers, links, code blocks, and other markdown syntax.' : '';
    let prompt = `The following text is a string array containing ${contentTypeText}. Translate each element in this array from English to Traditional Chinese (zh-tw). If the input has 10 elements, the output should also be a string array with 10 elements. ${formatInstructions} Do not add any extra text or formatting beyond the translation. Make sure the output is a valid JSON array. Here is the context of the translation task: \`\`\`${contextPrompt}\`\`\``;

    prompt += `
<notes>
Use the following term mappings:
- creating = 建立
- create = 建立
- 創建 = 建立
- 创建 = 建立
- 質量 (quality) = 品質
- 編程 (coding) (programming) = 程式設計
- object = 物件
- queue = 佇列
- stack = 堆疊
- information = 資訊
- invocation = 呼叫
- code = 程式碼
- running = 執行
- library = 函式庫
- schematics = 原理圖
- building = 建構
- Setting up = 設定
- package = 套件
- video = 影片
- for loop = for 迴圈
- class = 類別
- Concurrency = 平行處理
- Transaction = 交易
- Transactional = 交易式
- Code Snippet = 程式碼片段
- Code Generation = 程式碼產生器
- Any Class = 任意類別
- Scalability = 延展性
- Dependency Package = 相依套件
- Dependency Injection = 相依性注入
- Reserved Keywords = 保留字
- Metadata =  Metadata
- Clone = 複製
- Memory = 記憶體
- Built-in = 內建
- Global = 全域
- Compatibility = 相容性
- Function = 函式
- Refresh = 重新整理
- document = 文件
- example = 範例
- demo = 展示
- quality = 品質
- tutorial = 指南
- recipes = 秘訣
- data source = 資料來源
- premium requests = 進階請求
- remote = 遠端
- settings = 設定
- project = 專案
- database = 資料庫
- cache = 快取
- caching = 快取
- base model = 基礎模型
- demonstration = 展示
- demo = 展示
- creator = 創作者
- integration = 整合
- character = 字元

Do not translate the following terms:
- Semantic Kernel
- Plugins
- LLM
</notes>`;

    const body = {
        contents: [
            { role: 'user', parts: [{ text: prompt }, { text: JSON.stringify(texts) }] },
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
    const url = `${API_URL}/${model}:generateContent?key=${apiKey}`;
    const resp = await axios.post(url, body, { headers: { 'Content-Type': 'application/json' } });
    // Gemini API 可能回傳陣列（每個字幕一個物件）
    let result = resp.data;

    // console.log('API 回傳:', JSON.stringify(result, null, 2));

    // 只處理單一物件回傳（結構化 JSON）
    // 直接回傳 resp.data（應為 JSON 陣列）
    function extractStrings(val) {
        // 遞迴解析直到取得 string 陣列
        if (Array.isArray(val)) {
            return val.flatMap(extractStrings);
        }
        if (typeof val === 'object' && val !== null) {
            // 處理 Gemini API 回傳格式
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
            // 其他物件，轉為 JSON 字串
            return [JSON.stringify(val)];
        }
        if (typeof val === 'string') {
            // 嘗試解析為 JSON 陣列
            try {
                const arr = JSON.parse(val);
                if (Array.isArray(arr)) {
                    // 遞迴展開所有元素，並過濾掉非字串
                    return arr.flatMap(e => typeof e === 'string' ? [e] : extractStrings(e));
                }
            } catch (e) { }
            return [val];
        }
        return [String(val)];
    }
    if (Array.isArray(result)) {
        return extractStrings(result);
    }
    // fallback: 舊格式處理
    if (result && result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts) {
        let text = result.candidates[0].content.parts.map(p => p.text).join('');
        text = text.replace(/^```json\s*/i, '').replace(/\s*```\s*$/i, '');
        try {
            const arr = JSON.parse(text);
            if (Array.isArray(arr)) return arr.map(x => String(x));
        } catch (e) {
            let lines = text.split(/\r?\n\r?\n|\r?\n/).filter(l => l.trim());
            return lines;
        }
    }
    const err = new Error('Gemini API 回傳格式錯誤');
    err.raw = result;
    throw err;
}

async function main() {
    const argv = parseArgs();
    const inputPath = argv.input;
    const inputType = detectSubtitleType(inputPath);

    // Determine output type and path
    let outputType = inputType;
    let outputPath;

    if (argv.output) {
        outputPath = argv.output;
        try {
            outputType = detectSubtitleType(outputPath);
        } catch (e) {
            // If output file extension is not recognized, keep input type
            outputType = inputType;
        }
    } else {
        outputPath = generateOutputPath(inputPath, inputType);
        outputType = inputType;
    }

    const model = argv.model || DEFAULT_MODEL;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('請設定 GEMINI_API_KEY 環境變數');
        process.exit(1);
    }
    if (!fs.existsSync(inputPath)) {
        console.error('找不到輸入檔案:', inputPath);
        process.exit(1);    }    console.log(`檢測到輸入檔案格式: ${inputType.toUpperCase()}`);
    if (inputType !== outputType) {
        console.log(`將轉換為輸出格式: ${outputType.toUpperCase()}`);
    }
    const subtitleContent = fs.readFileSync(inputPath, 'utf8');
    const blocks = parseSubtitle(subtitleContent, inputType);    // 檢查 index 連續性，若有缺漏則顯示有問題的 time code 並停止，或自動修正 (適用於 SRT 和 WebVTT)
    if (inputType === 'srt' || inputType === 'webvtt') {
        const indices = blocks.map(b => parseInt(b.index, 10));
        let broken = [];
        for (let i = 1; i < indices.length; ++i) {
            if (indices[i] !== indices[i - 1] + 1) {
                broken.push({
                    missing: indices[i - 1] + 1,
                    prevTime: blocks[i - 1].time,
                    nextTime: blocks[i].time,
                    pos: i
                });
            }
        }
        if (broken.length > 0) {
            if (argv.autofix) {
                console.warn('發現字幕序號不連續，自動修正中...');
                // 重新編號 blocks
                for (let i = 0; i < blocks.length; ++i) {
                    blocks[i].index = String(i + 1);
                }                // 修正後直接覆蓋原檔，根據格式使用對應的序列化函數
                const fixedContent = inputType === 'srt' ? serializeSRT(blocks) : serializeWebVTT(blocks);
                fs.writeFileSync(inputPath, fixedContent, 'utf8');
                console.log('已自動修正並覆蓋原始檔案，請重新執行本程式。');
                process.exit(0);
            } else {
                console.error('字幕序號不連續，發現缺漏：');
                broken.forEach(b => {
                    console.error(`缺少序號 ${b.missing}，前一字幕時間碼: ${b.prevTime}，下一字幕時間碼: ${b.nextTime}`);
                });                console.error('\n提示：您可以使用 --autofix 選項來自動修正字幕序號不連續問題');
                const fileExt = inputType === 'srt' ? 'srt' : 'vtt';
                console.error(`例如：npx @willh/gemini-translator --input input.${fileExt} --autofix`);
                process.exit(1);
            }
        }
    }

    // 產生摘要以提升翻譯品質
    const allTexts = blocks.map(b => b.text).join('\n');
    let summary = '';    try {
        console.log('正在產生內容摘要以提升翻譯品質...');
        const contentType = inputType === 'md' ? '文件' : '字幕';
        const summaryPrompt = `請閱讀以下英文${contentType}內容，並以繁體中文摘要其主題、內容重點、專有名詞、人物、背景、風格等，摘要長度 100-200 字，僅回傳摘要內容：\n${allTexts}`;
        const summaryBody = {
            contents: [
                { role: 'user', parts: [{ text: summaryPrompt }] },
            ],
            generationConfig: {
                responseMimeType: 'text/plain',
            }
        };
        const summaryUrl = `${API_URL}/${model}:generateContent?key=${apiKey}`;
        const resp = await axios.post(summaryUrl, summaryBody, { headers: { 'Content-Type': 'application/json' } });
        // 嘗試從 Gemini API 回傳中取得摘要
        if (resp.data && resp.data.candidates && resp.data.candidates[0] && resp.data.candidates[0].content && resp.data.candidates[0].content.parts) {
            summary = resp.data.candidates[0].content.parts.map(p => p.text).join('');
        } else if (resp.data && resp.data.candidates && resp.data.candidates[0] && resp.data.candidates[0].content && resp.data.candidates[0].content.text) {
            summary = resp.data.candidates[0].content.text;
        } else {
            summary = '';
        }
        if (summary) {
            // console.log('摘要產生完成：', summary);
        } else {
            console.warn('未能成功產生摘要，將直接進行翻譯。');
        }
    } catch (e) {
        console.warn('產生摘要失敗，將直接進行翻譯。', e.message);
        summary = '';
    }    // 將摘要存入 global 以便後續翻譯任務使用
    globalThis.translationSummary = summary;

    let translatedBlocks = [];
    const itemType = inputType === 'md' ? '段落' : '條字幕';
    console.log(`共 ${blocks.length} ${itemType}，分批處理中...`);
    // 將 blocks 分批
    const batches = [];
    for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
        const batch = blocks.slice(i, i + BATCH_SIZE);
        batches.push(batch);
    }
    // 建立任務陣列
    const tasks = batches.map((batch, batchIdx) => async () => {
        const texts = batch.map(b => b.text);
        process.stdout.write(`\r翻譯第 ${batchIdx * BATCH_SIZE + 1}-${Math.min((batchIdx + 1) * BATCH_SIZE, blocks.length)}/${blocks.length} 條...`);
        let translations;        try {
            // console.error('翻譯內容:', JSON.stringify(texts, null, 2));
            const contentType = inputType === 'md' ? 'markdown' : 'subtitle';
            translations = await translateBatch(texts, apiKey, model, contentType);
            // console.error('翻譯結果:', JSON.stringify(translations, null, 2));

            if (!Array.isArray(translations) || translations.length !== batch.length) {
                const itemType = inputType === 'md' ? '段落' : '字幕';
                console.error(`\n翻譯失敗: 翻譯數量與原始${itemType}數量不符 (input: ${batch.length}, result: ${Array.isArray(translations) ? translations.length : 'N/A'})`);
                if (Array.isArray(translations)) {
                    console.error('翻譯結果:', JSON.stringify(translations, null, 2));
                }
                throw new Error(`翻譯數量與原始${itemType}數量不符`);
            }
        } catch (e) {
            const itemType = inputType === 'md' ? '段落' : '字幕';
            if (!e.message || !e.message.includes(`翻譯數量與原始${itemType}數量不符`)) {
                console.error(`\n翻譯失敗:`, e.message);
                throw e;
            }
            if (e.response) {
                console.error('API 回應:', JSON.stringify(e.response.data, null, 2));
            }
            if (e.raw) {
                console.error('API 原始回傳:', JSON.stringify(e.raw, null, 2));
            }
            process.exit(1);
        }
        // 回傳本 batch 的翻譯結果
        return translations;
    });
    console.log('開始平行處理翻譯任務，最多同時執行 20 個任務...');
    // 平行處理，最多 20 個同時執行
    const allTranslations = await promisePool(tasks, 20);
    console.log('所有翻譯任務已完成，開始合併翻譯結果...');
    // 合併所有翻譯結果
    const flatTranslations = allTranslations.flat();
    // 將翻譯結果還原回 blocks 結構
    translatedBlocks = blocks.map((block, idx) => ({
        ...block,
        text: flatTranslations[idx] || ''
    }));
    // console.log('翻譯結果合併完成', translatedBlocks);    // 檢查時間碼順序 (僅適用於 SRT 和 WebVTT)
    if (outputType !== 'ass' && outputType !== 'md') {
        console.log('檢查時間碼順序...');
        console.log();
        if (!checkSequentialTimestamps(translatedBlocks)) {
            console.error('時間碼順序錯誤');
            process.exit(1);
        }
        console.log('時間碼順序檢查通過，準備寫入輸出檔案...');
    } else if (inputType === 'md') {
        // 檢查 Markdown 格式一致性
        console.log('檢查 Markdown 格式一致性...');
        console.log();
        const formatCheck = checkMarkdownFormat(blocks, translatedBlocks);
        if (!formatCheck.isValid) {
            console.error('Markdown 格式檢查失敗:');
            formatCheck.errors.forEach(error => {
                console.error(`  - ${error}`);
            });
            // process.exit(1);
        }
        console.log('Markdown 格式檢查通過，準備寫入輸出檔案...');
    } else {
        // console.log('ASS 格式無需檢查時間碼順序，準備寫入輸出檔案...');
    }
    fs.writeFileSync(outputPath, serializeSubtitle(translatedBlocks, outputType, subtitleContent), 'utf8');
    console.log(`\n翻譯完成，已寫入 ${outputPath}`);
}

// console.log(process.argv)
// console.log(import.meta.url)
// console.log(`file:///${process.argv[1].replace(/\\/g, '/')}`)
// console.log(`file://${process.argv[1]}`)
// console.log(path.basename(process.argv[1]))

// Check if this module is being run directly (not imported)
// Enhanced check for direct execution, including npx (which may use main.js or the package entry)
const scriptName = path.basename(process.argv[1] || '');
const importUrl = import.meta.url;
// console.log(scriptName)
// console.log(importUrl)

// Handles cases like: .../bin/gemini-translator, .../bin/gemini-translator.js, .../main.js (npx)
const isDirectRun =
    importUrl.endsWith(`/${scriptName}`) ||
    importUrl.endsWith(`/${scriptName}.js`) ||
    importUrl.endsWith('/main.js') ||
    importUrl.endsWith('/main.mjs');

// Don't run if we're in a test environment
if (isDirectRun && (!process.env.NODE_ENV || process.env.NODE_ENV !== 'test')) {
    main();
}
