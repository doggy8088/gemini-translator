#!/usr/bin/env node
// Gemini 英翻中（繁體）翻譯器
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import promisePool from './promisePool.js';

const BATCH_SIZE = 10;
const DEFAULT_MODEL = 'gemini-2.5-pro';
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_RETRY_ATTEMPTS = 10;
const BYTES_PER_CHUNK = 1000; // 每個區塊的最大位元數

function parseArgs() {
    return yargs(hideBin(process.argv))
        .usage('用法: npx @willh/gemini-translator --input <input.srt> [--output <output.srt>] [--model <model>] [--autofix] [--debug]')
        .option('input', { alias: 'i', demandOption: true, describe: '輸入檔案路徑 (支援 .srt, .vtt, .ass, .md)', type: 'string' })
        .option('output', { alias: 'o', describe: '輸出檔案路徑，預設根據輸入檔案自動產生。可指定不同格式的副檔名進行格式轉換', type: 'string' })
        .option('model', { alias: 'm', describe: 'Gemini 模型，預設為 gemini-2.5-pro', type: 'string', default: DEFAULT_MODEL }).option('autofix', { describe: '自動修正字幕序號不連續問題 (適用於 SRT 和 WebVTT)', type: 'boolean', default: false }).option('debug', { describe: '顯示詳細的除錯資訊，包括翻譯前後的完整內容比對', type: 'boolean', default: false }).example('npx @willh/gemini-translator --input input.srt', '將 input.srt 翻譯為 input.zh.srt')
        .example('npx @willh/gemini-translator -i input.vtt', '翻譯 WebVTT 檔案')
        .example('npx @willh/gemini-translator -i input.ass -o output.ass', '翻譯 ASS 檔案')
        .example('npx @willh/gemini-translator -i input.md', '翻譯 Markdown 檔案')
        .example('npx @willh/gemini-translator -i input.srt -o output.ass', '將 SRT 翻譯並轉換為 ASS 格式')
        .example('npx @willh/gemini-translator -i input.vtt -o output.srt', '將 WebVTT 翻譯並轉換為 SRT 格式')
        .example('npx @willh/gemini-translator -i input.srt --autofix', '自動修正 SRT 字幕序號不連續問題')
        .example('npx @willh/gemini-translator -i input.vtt --autofix', '自動修正 WebVTT 字幕序號不連續問題')
        .example('npx @willh/gemini-translator -i input.md --debug', '翻譯 Markdown 並顯示除錯資訊')
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
        }
    } else {
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
    const chunks = [];

    if (Buffer.byteLength(content, 'utf8') > BYTES_PER_CHUNK) {
        // Smart chunking that respects Markdown semantic boundaries
        const lines = content.split(/\r?\n/);
        let currentChunk = '';
        let chunkIndex = 1;
        let inCodeBlock = false;
        let codeBlockStart = -1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            
            // Track code block boundaries
            if (trimmed.startsWith('```')) {
                if (!inCodeBlock) {
                    inCodeBlock = true;
                    codeBlockStart = i;
                } else {
                    inCodeBlock = false;
                    codeBlockStart = -1;
                }
            }
            
            const testChunk = currentChunk + (currentChunk ? '\n' : '') + line;
            const shouldBreak = Buffer.byteLength(testChunk, 'utf8') > 500 && currentChunk;
            
            // Don't break inside code blocks, inside lists, or in the middle of headers
            const isBreakSafe = !inCodeBlock && 
                               !isPartOfList(lines, i) && 
                               !isPartOfHeader(lines, i);
            
            // For list items, also check if we're at a safe list boundary
            const isAtSafeListBoundary = !isPartOfList(lines, i) || isAtListBoundary(lines, i);
            
            // Natural break points: empty lines after content, or before new sections
            const isNaturalBreak = (trimmed === '' && currentChunk.trim() !== '') ||
                                   (trimmed.startsWith('# ') || trimmed.startsWith('## ') || 
                                    trimmed.startsWith('### ') || trimmed.startsWith('#### ') ||
                                    trimmed.startsWith('##### ') || trimmed.startsWith('###### '));

            if (shouldBreak && isBreakSafe && isAtSafeListBoundary && 
                (isNaturalBreak || !hasOngoingStructure(lines, i))) {
                // Save current chunk if it has content
                if (currentChunk.trim()) {
                    chunks.push({
                        index: String(chunkIndex++),
                        text: currentChunk.trim()
                    });
                }
                currentChunk = line;
            } else {
                currentChunk = testChunk;
            }
        }

        // Add the last chunk
        if (currentChunk.trim()) {
            chunks.push({
                index: String(chunkIndex),
                text: currentChunk.trim()
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

// Helper function to check if a line is part of a list
function isPartOfList(lines, index) {
    const line = lines[index];
    const trimmed = line.trim();
    
    // Check if current line is a list item
    if (trimmed.match(/^[-*+]\s/) || trimmed.match(/^\d+\.\s/)) {
        return true;
    }
    
    // Check if current line is a continuation of a list item (indented)
    if (line.match(/^\s+/) && trimmed !== '') {
        // Look backward for the nearest list item, considering indentation levels
        const currentIndent = line.match(/^\s*/)[0].length;
        
        for (let i = index - 1; i >= 0; i--) {
            const prevLine = lines[i];
            const prevTrimmed = prevLine.trim();
            
            // Skip empty lines
            if (prevTrimmed === '') continue;
            
            // Found a list item
            if (prevTrimmed.match(/^[-*+]\s/) || prevTrimmed.match(/^\d+\.\s/)) {
                return true;
            }
            
            // If we encounter a line with less indentation than current line,
            // and it's not a list item, then we're not in a list
            const prevIndent = prevLine.match(/^\s*/)[0].length;
            if (prevIndent < currentIndent && !prevTrimmed.match(/^[-*+]\s/) && !prevTrimmed.match(/^\d+\.\s/)) {
                // But continue if the previous line is also indented (could be nested list content)
                if (prevIndent === 0) break;
            }
        }
    }
    
    return false;
}

// Helper function to check if a line is part of a header structure
function isPartOfHeader(lines, index) {
    const line = lines[index];
    
    // Current line is a header
    if (line.trim().startsWith('#')) {
        return true;
    }
    
    // Check for setext-style headers (underlined with = or -)
    if (index + 1 < lines.length) {
        const nextLine = lines[index + 1].trim();
        if (nextLine.match(/^=+$/) || nextLine.match(/^-+$/)) {
            return true;
        }
    }
    
    return false;
}

// Helper function to check if there's an ongoing structure that shouldn't be broken
function hasOngoingStructure(lines, index) {
    // Look ahead for immediate structure continuations
    if (index + 1 < lines.length) {
        const nextLine = lines[index + 1];
        const trimmed = nextLine.trim();
        
        // Next line is indented content (likely continuation)
        if (nextLine.match(/^\s+\S/) && trimmed !== '') {
            return true;
        }
        
        // Next line is a table separator or continuation
        if (trimmed.includes('|') || trimmed.match(/^[-|:\s]+$/)) {
            return true;
        }
    }
    
    return false;
}

// Helper function to check if we're at a safe list boundary for chunking
function isAtListBoundary(lines, index) {
    // If we're not in a list, it's always safe
    if (!isPartOfList(lines, index)) {
        return true;
    }
    
    // Check if the next lines continue the current list item
    for (let i = index + 1; i < lines.length; i++) {
        const nextLine = lines[i];
        const nextTrimmed = nextLine.trim();
        
        // Empty line - could be end of list item or just spacing
        if (nextTrimmed === '') {
            continue;
        }
        
        // If next non-empty line is a new list item at same level or header, we're at boundary
        if (nextTrimmed.match(/^[-*+]\s/) || nextTrimmed.match(/^\d+\.\s/) || 
            nextTrimmed.startsWith('#')) {
            return true;
        }
        
        // If next non-empty line is indented (continuation of current list item), not at boundary
        if (nextLine.match(/^\s+/) && nextTrimmed !== '') {
            return false;
        }
        
        // If next line is not indented and not a list item, we're at boundary
        if (!nextLine.match(/^\s+/)) {
            return true;
        }
    }
    
    // End of content, so we're at boundary
    return true;
}

function serializeMarkdown(blocks) {
    // Reconstruct Markdown content from translated blocks
    // Preserve appropriate spacing between blocks
    const result = [];
    
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const text = block.text.trim();
        
        if (text) {
            result.push(text);
            
            // Add appropriate spacing after blocks
            if (i < blocks.length - 1) {
                const nextBlock = blocks[i + 1];
                const nextText = nextBlock.text.trim();
                
                // Add extra spacing before headers or after code blocks
                if (nextText.startsWith('#') || text.includes('```') || 
                    text.match(/^[-*+]\s/) || nextText.match(/^[-*+]\s/) ||
                    text.match(/^\d+\.\s/) || nextText.match(/^\d+\.\s/)) {
                    result.push('');
                }
            }
        }
    }
    
    return result.join('\n');
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
 * 顯示除錯比對資訊
 * @param {Array} originalBlocks - 原始區塊
 * @param {Array} translatedBlocks - 翻譯後區塊
 * @param {string} title - 除錯標題
 * @param {boolean} showDetails - 是否顯示詳細內容
 */
function showDebugComparison(originalBlocks, translatedBlocks, title, showDetails = false) {
    console.error(`\n=== ${title} ===`);
    console.error(`原始區塊數量: ${originalBlocks.length}`);
    console.error(`翻譯區塊數量: ${translatedBlocks.length}`);
    
    if (showDetails) {
        console.error('\n原始區塊內容:');
        originalBlocks.forEach((block, index) => {
            const text = block.text || block.toString();
            const preview = text.replace(/\n/g, '\\n').substring(0, 100);
            console.error(`  ${index + 1}. ${preview}${text.length > 100 ? '...' : ''}`);
        });
        
        console.error('\n翻譯區塊內容:');
        translatedBlocks.forEach((block, index) => {
            const text = block.text || block.toString();
            const preview = text.replace(/\n/g, '\\n').substring(0, 100);
            console.error(`  ${index + 1}. ${preview}${text.length > 100 ? '...' : ''}`);
        });
    }
    
    console.error(`=== ${title} 結束 ===\n`);
}

/**
 * 顯示 Markdown 格式除錯資訊
 * @param {Array} originalBlocks - 原始 Markdown 區塊
 * @param {Array} translatedBlocks - 翻譯後 Markdown 區塊  
 * @param {Array} errors - 錯誤列表
 * @param {boolean} isDebugMode - 是否為除錯模式
 * @param {string} inputPath - 輸入檔案路徑
 */
function showMarkdownFormatDebug(originalBlocks, translatedBlocks, errors, isDebugMode, inputPath) {
    if (!isDebugMode) return;
    
    console.error('\n=== Markdown 格式檢查除錯資訊 ===');
    console.error(`正在處理檔案: ${inputPath}`);
    console.error(`發現 ${errors.length} 個格式問題:`);
    
    errors.forEach((error, index) => {
        console.error(`  ${index + 1}. ${error}`);
    });
    
    console.error('\n詳細區塊比對:');
    const maxBlocks = Math.max(originalBlocks.length, translatedBlocks.length);
    
    for (let i = 0; i < maxBlocks; i++) {
        console.error(`\n--- 區塊 ${i + 1} ---`);
        
        if (i < originalBlocks.length) {
            const originalText = originalBlocks[i].text || '';
            console.error(`原始: ${originalText.replace(/\n/g, '\\n')}`);
        } else {
            console.error('原始: [不存在]');
        }
        
        if (i < translatedBlocks.length) {
            const translatedText = translatedBlocks[i].text || '';
            console.error(`翻譯: ${translatedText.replace(/\n/g, '\\n')}`);
        } else {
            console.error('翻譯: [不存在]');
        }
    }
    
    console.error('\n=== Markdown 格式檢查除錯資訊結束 ===\n');
}

/**
 * 檢查原始 Markdown 和翻譯後 Markdown 的格式是否一致
 * @param {Array} originalBlocks - 原始 Markdown 區塊
 * @param {Array} translatedBlocks - 翻譯後 Markdown 區塊
 * @param {boolean} isDebugMode - 是否為除錯模式
 * @param {string} inputPath - 輸入檔案路徑
 * @returns {Object} 檢查結果 { isValid: boolean, errors: Array }
 */
function checkMarkdownFormat(originalBlocks, translatedBlocks, isDebugMode = false, inputPath = '') {
    const errors = [];

    // 檢查區塊數量是否一致
    if (originalBlocks.length !== translatedBlocks.length) {
        errors.push(`區塊數量不一致: 原始 ${originalBlocks.length} 個，翻譯後 ${translatedBlocks.length} 個`);
        
        // 如果開啟除錯模式，顯示詳細比對
        if (isDebugMode) {
            showDebugComparison(originalBlocks, translatedBlocks, '區塊數量不一致詳細比對', true);
        }
        
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
                const origLink = originalLinks[j];
                const transLink = translatedLinks[j];
                
                // Check URL consistency for links that have URLs
                if (origLink.url && transLink.url && origLink.url !== transLink.url) {
                    errors.push(`區塊 ${i + 1}: 連結 URL 不一致 (位置 ${j + 1}, 原始: "${origLink.url}", 翻譯: "${transLink.url}")`);
                }
                
                // Check link type consistency
                if (origLink.type !== transLink.type) {
                    errors.push(`區塊 ${i + 1}: 連結類型不一致 (位置 ${j + 1}, 原始: ${origLink.type}, 翻譯: ${transLink.type})`);
                }
                
                // Check reference consistency for reference-style links
                if (origLink.ref && transLink.ref && origLink.ref !== transLink.ref) {
                    errors.push(`區塊 ${i + 1}: 連結參考不一致 (位置 ${j + 1}, 原始: "${origLink.ref}", 翻譯: "${transLink.ref}")`);
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

    const result = {
        isValid: errors.length === 0,
        errors
    };

    // 如果檢查失敗且開啟除錯模式，顯示詳細除錯資訊
    if (!result.isValid && isDebugMode) {
        showMarkdownFormatDebug(originalBlocks, translatedBlocks, errors, isDebugMode, inputPath);
    }

    return result;
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
        const leadingSpaces = line.match(/^(\s*)/)?.[1] || '';

        // 無序列表 (*, -, +)
        const unorderedMatch = trimmed.match(/^([-*+])\s+/);
        if (unorderedMatch) {
            // Calculate level based on actual indentation, supporting both 2 and 4 space styles
            const level = leadingSpaces.length === 0 ? 1 : 
                         Math.floor(leadingSpaces.length / (leadingSpaces.length >= 4 ? 4 : 2)) + 1;
            lists.push({
                type: 'unordered',
                level: level,
                marker: unorderedMatch[1],
                indent: leadingSpaces.length
            });
            continue;
        }

        // 有序列表 (1., 2., etc.)
        const orderedMatch = trimmed.match(/^(\d+\.)\s+/);
        if (orderedMatch) {
            // Calculate level based on actual indentation
            const level = leadingSpaces.length === 0 ? 1 : 
                         Math.floor(leadingSpaces.length / (leadingSpaces.length >= 4 ? 4 : 2)) + 1;
            lists.push({
                type: 'ordered',
                level: level,
                marker: orderedMatch[1],
                indent: leadingSpaces.length
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
    let codeBlockStartLine = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // 檢查行內程式碼 `code` (avoid matching inside fenced code blocks)
        if (!inCodeBlock) {
            const inlineCodeMatches = line.match(/`[^`\n]+`/g);
            if (inlineCodeMatches) {
                inlineCodeMatches.forEach(() => {
                    codeBlocks.push({
                        type: 'inline',
                        language: '',
                        content: '',
                        line: i + 1
                    });
                });
            }
        }

        // 檢查程式碼區塊 ``` or ~~~
        const fenceMatch = line.trim().match(/^(```|~~~)(.*)$/);
        if (fenceMatch) {
            if (!inCodeBlock) {
                // 開始程式碼區塊
                const language = fenceMatch[2].trim();
                currentBlock = {
                    type: 'block',
                    language: language,
                    content: '',
                    startLine: i + 1,
                    fence: fenceMatch[1]
                };
                inCodeBlock = true;
                codeBlockStartLine = i;
            } else if (currentBlock && fenceMatch[1] === currentBlock.fence) {
                // 結束程式碼區塊 (matching fence type)
                currentBlock.endLine = i + 1;
                codeBlocks.push(currentBlock);
                currentBlock = null;
                inCodeBlock = false;
                codeBlockStartLine = -1;
            }
            // If fence types don't match, treat as content
            else if (inCodeBlock && currentBlock) {
                currentBlock.content += line + '\n';
            }
        } else if (inCodeBlock && currentBlock) {
            currentBlock.content += line + '\n';
        }
        
        // Check for indented code blocks (4+ spaces, not inside fenced blocks)
        else if (!inCodeBlock && line.match(/^    /) && line.trim() !== '') {
            // Ensure previous line is empty or also indented code
            const prevLine = i > 0 ? lines[i - 1] : '';
            // Don't treat list continuation lines as indented code blocks
            if ((prevLine.trim() === '' || prevLine.match(/^    /)) && !isPartOfList(lines, i)) {
                codeBlocks.push({
                    type: 'indented',
                    language: '',
                    content: line.substring(4),
                    line: i + 1
                });
            }
        }
    }

    // Handle unclosed code blocks
    if (inCodeBlock && currentBlock) {
        currentBlock.endLine = lines.length;
        currentBlock.unclosed = true;
        codeBlocks.push(currentBlock);
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
            type: 'inline',
            text: match[1],
            url: match[2],
            full: match[0]
        });
    }

    // 參考式連結格式 [text][ref]
    const refLinkRegex = /\[([^\]]*)\]\[([^\]]*)\]/g;
    while ((match = refLinkRegex.exec(text)) !== null) {
        links.push({
            type: 'reference',
            text: match[1],
            ref: match[2] || match[1], // If ref is empty, use text as ref
            full: match[0]
        });
    }

    // 連結定義格式 [ref]: url "title"
    const linkDefRegex = /^\s*\[([^\]]+)\]:\s*(\S+)(?:\s+"([^"]*)")?/gm;
    while ((match = linkDefRegex.exec(text)) !== null) {
        links.push({
            type: 'definition',
            ref: match[1],
            url: match[2],
            title: match[3] || '',
            full: match[0]
        });
    }

    // 自動連結格式 <url>
    const autoLinkRegex = /<(https?:\/\/[^>]+)>/g;
    while ((match = autoLinkRegex.exec(text)) !== null) {
        links.push({
            type: 'autolink',
            text: match[1],
            url: match[1],
            full: match[0]
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

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // VuePress 容器語法 ::: type
        const vuepressMatch = trimmed.match(/^:::\s*(\w+)(.*)$/);
        if (vuepressMatch) {
            special.push({
                type: vuepressMatch[1],
                syntax: 'vuepress-container',
                content: vuepressMatch[2].trim(),
                line: i + 1
            });
            continue;
        }

        // Admonition syntax (mkdocs, docusaurus) !!! type
        const admonitionMatch = trimmed.match(/^!!!\s*(\w+)(.*)$/);
        if (admonitionMatch) {
            special.push({
                type: admonitionMatch[1],
                syntax: 'admonition',
                content: admonitionMatch[2].trim(),
                line: i + 1
            });
            continue;
        }

        // GitHub callouts > [!NOTE]
        const calloutMatch = trimmed.match(/^>\s*\[!(\w+)\](.*)$/);
        if (calloutMatch) {
            special.push({
                type: calloutMatch[1].toLowerCase(),
                syntax: 'github-callout',
                content: calloutMatch[2].trim(),
                line: i + 1
            });
            continue;
        }

        // Front matter (YAML)
        if (i === 0 && trimmed === '---') {
            // Look for closing ---
            for (let j = i + 1; j < lines.length; j++) {
                if (lines[j].trim() === '---') {
                    special.push({
                        type: 'yaml',
                        syntax: 'frontmatter',
                        startLine: i + 1,
                        endLine: j + 1,
                        content: lines.slice(i + 1, j).join('\n')
                    });
                    break;
                }
            }
            continue;
        }

        // Math blocks $$
        if (trimmed === '$$') {
            special.push({
                type: 'math',
                syntax: 'math-block',
                line: i + 1
            });
            continue;
        }

        // Inline math $...$
        const inlineMathMatches = trimmed.match(/\$[^$\n]+\$/g);
        if (inlineMathMatches) {
            inlineMathMatches.forEach(() => {
                special.push({
                    type: 'math',
                    syntax: 'math-inline',
                    line: i + 1
                });
            });
        }

        // HTML comments <!-- -->
        const htmlCommentMatch = trimmed.match(/<!--[\s\S]*?-->/);
        if (htmlCommentMatch) {
            special.push({
                type: 'comment',
                syntax: 'html-comment',
                line: i + 1
            });
        }

        // Table rows (containing |)
        if (trimmed.includes('|') && !trimmed.startsWith('```')) {
            special.push({
                type: 'table',
                syntax: 'table-row',
                line: i + 1
            });
        }
    }

    return special;
}

// 重試包裝函數
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
                await new Promise(resolve => setTimeout(resolve, attempt * 1000));
            }
        }
    }

    // 所有重試都失敗，拋出最後一個錯誤
    console.error(`\n${description}在 ${maxAttempts} 次嘗試後仍然失敗`);
    throw lastError;
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
    
    // Show input filename at the beginning for better progress understanding
    console.log(`開始處理檔案: ${inputPath}`);
    
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

    // Check if input and output paths are the same (resolve to absolute paths for comparison)
    const resolvedInputPath = path.resolve(inputPath);
    const resolvedOutputPath = path.resolve(outputPath);
    const isOverwriteMode = resolvedInputPath === resolvedOutputPath;

    if (isOverwriteMode) {
        console.log('偵測到輸入與輸出檔案相同，將自動覆蓋原檔案');
    }

    const model = argv.model || DEFAULT_MODEL;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('請設定 GEMINI_API_KEY 環境變數');
        process.exit(1);
    }
    if (!fs.existsSync(inputPath)) {
        console.error('找不到輸入檔案:', inputPath);
        process.exit(1);
    }
    console.log(`檢測到輸入檔案格式: ${inputType.toUpperCase()}`);
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
                });
                console.error('\n提示：您可以使用 --autofix 選項來自動修正字幕序號不連續問題');
                const fileExt = inputType === 'srt' ? 'srt' : 'vtt';
                console.error(`例如：npx @willh/gemini-translator --input input.${fileExt} --autofix`);
                process.exit(1);
            }
        }
    }

    // 產生摘要以提升翻譯品質
    const allTexts = blocks.map(b => b.text).join('\n');
    let summary = '';

    // 使用重試機制產生摘要
    try {
        console.log('正在產生內容摘要以提升翻譯品質...');
        const contentType = inputType === 'md' ? '文件' : '字幕';

        summary = await withRetry(async () => {
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
            let result = '';
            if (resp.data && resp.data.candidates && resp.data.candidates[0] && resp.data.candidates[0].content && resp.data.candidates[0].content.parts) {
                result = resp.data.candidates[0].content.parts.map(p => p.text).join('');
            } else if (resp.data && resp.data.candidates && resp.data.candidates[0] && resp.data.candidates[0].content && resp.data.candidates[0].content.text) {
                result = resp.data.candidates[0].content.text;
            }

            if (!result || result.trim() === '') {
                throw new Error('API 未回傳有效的摘要內容');
            }

            return result;
        }, MAX_RETRY_ATTEMPTS, '摘要產生');

        if (summary) {
            // console.log('摘要產生完成：', summary);
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
    // 進度追蹤
    let completedTasks = 0;
    const totalTasks = batches.length;

    // 建立任務陣列
    const inputFilename = path.basename(inputPath);
    const tasks = batches.map((batch, batchIdx) => async () => {
        const texts = batch.map(b => b.text);

        // 使用重試機制進行翻譯
        const translations = await withRetry(async () => {
            // console.error('翻譯內容:', JSON.stringify(texts, null, 2));
            const contentType = inputType === 'md' ? 'markdown' : 'subtitle';
            const result = await translateBatch(texts, apiKey, model, contentType);
            // console.error('翻譯結果:', JSON.stringify(result, null, 2));

            // 檢核翻譯結果
            if (!Array.isArray(result) || result.length !== batch.length) {
                const itemType = inputType === 'md' ? '段落' : '字幕';
                const error = new Error(`翻譯數量與原始${itemType}數量不符 (input: ${batch.length}, result: ${Array.isArray(result) ? result.length : 'N/A'})`);
                
                // 如果開啟除錯模式，顯示詳細的輸入輸出比對
                if (argv.debug) {
                    console.error('\n=== 翻譯數量不符詳細除錯資訊 ===');
                    console.error(`批次 ${batchIdx + 1} 翻譯失敗`);
                    console.error(`預期輸出數量: ${batch.length}`);
                    console.error(`實際輸出數量: ${Array.isArray(result) ? result.length : 'N/A'}`);
                    console.error(`實際輸出類型: ${typeof result}`);
                    
                    console.error('\n原始輸入內容:');
                    texts.forEach((text, index) => {
                        console.error(`  ${index + 1}. ${text.replace(/\n/g, '\\n').substring(0, 100)}${text.length > 100 ? '...' : ''}`);
                    });
                    
                    console.error('\n翻譯輸出內容:');
                    if (Array.isArray(result)) {
                        result.forEach((text, index) => {
                            console.error(`  ${index + 1}. ${text.replace(/\n/g, '\\n').substring(0, 100)}${text.length > 100 ? '...' : ''}`);
                        });
                    } else {
                        console.error(`  非陣列結果: ${JSON.stringify(result, null, 2)}`);
                    }
                    console.error('=== 翻譯數量不符詳細除錯資訊結束 ===\n');
                }
                
                if (Array.isArray(result)) {
                    console.error('翻譯結果:', JSON.stringify(result, null, 2));
                }
                throw error;
            }

            return result;
        }, MAX_RETRY_ATTEMPTS, `批次 ${batchIdx + 1} 翻譯`);

        // 更新進度
        completedTasks++;
        const startIdx = batchIdx * BATCH_SIZE + 1;
        const endIdx = Math.min((batchIdx + 1) * BATCH_SIZE, blocks.length);
        process.stdout.write(`\r[${inputFilename}] 翻譯進度: ${completedTasks}/${totalTasks} 批次完成 (第 ${startIdx}-${endIdx} 條已完成)...`);

        // 回傳本 batch 的翻譯結果
        return translations;
    });
    console.log('開始平行處理翻譯任務，最多同時執行 20 個任務...');
    // 平行處理，最多 20 個同時執行
    const allTranslations = await promisePool(tasks, 20);
    process.stdout.write('\n'); // 確保下一行從新行開始
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
        // 檢查 Markdown 格式一致性，如果失敗則重新翻譯
        let retryCount = 0;
        let formatCheckPassed = false;

        while (!formatCheckPassed && retryCount < MAX_RETRY_ATTEMPTS) {
            console.log('檢查 Markdown 格式一致性...');
            console.log();
            const formatCheck = checkMarkdownFormat(blocks, translatedBlocks, argv.debug, inputPath);

            if (!formatCheck.isValid) {
                retryCount++;
                if (argv.debug) {
                    console.error(`當前處理檔案: ${inputPath}`);
                    console.error('原始 chunk 內容:');
                    blocks.forEach((block, idx) => console.error(`Chunk ${idx + 1} 原文:\n${block.text}`));
                    console.error('翻譯後 chunk 內容:');
                    translatedBlocks.forEach((block, idx) => console.error(`Chunk ${idx + 1} 翻譯:\n${block.text}`));
                }
                console.error(`Markdown 格式檢查失敗 (第 ${retryCount} 次):`);
                formatCheck.errors.forEach(error => {
                    console.error(`  - ${error}`);
                });

                if (retryCount < MAX_RETRY_ATTEMPTS) {
                    console.log('正在重新翻譯...');

                    // 進度追蹤
                    let completedRetranslations = 0;
                    const totalRetranslations = batches.length;

                    // 重新翻譯所有區塊
                    const retranslationTasks = batches.map((batch, batchIdx) => async () => {
                        const texts = batch.map(b => b.text);

                        const translations = await withRetry(async () => {
                            const contentType = inputType === 'md' ? 'markdown' : 'subtitle';
                            const result = await translateBatch(texts, apiKey, model, contentType);

                            if (!Array.isArray(result) || result.length !== batch.length) {
                                const error = new Error(`重新翻譯數量不符 (input: ${batch.length}, result: ${Array.isArray(result) ? result.length : 'N/A'})`);
                                
                                // 如果開啟除錯模式，顯示詳細的輸入輸出比對
                                if (argv.debug) {
                                    console.error('\n=== 重新翻譯數量不符詳細除錯資訊 ===');
                                    console.error(`重新翻譯批次 ${batchIdx + 1} 失敗`);
                                    console.error(`預期輸出數量: ${batch.length}`);
                                    console.error(`實際輸出數量: ${Array.isArray(result) ? result.length : 'N/A'}`);
                                    console.error(`實際輸出類型: ${typeof result}`);
                                    
                                    console.error('\n原始輸入內容:');
                                    texts.forEach((text, index) => {
                                        console.error(`  ${index + 1}. ${text.replace(/\n/g, '\\n').substring(0, 100)}${text.length > 100 ? '...' : ''}`);
                                    });
                                    
                                    console.error('\n重新翻譯輸出內容:');
                                    if (Array.isArray(result)) {
                                        result.forEach((text, index) => {
                                            console.error(`  ${index + 1}. ${text.replace(/\n/g, '\\n').substring(0, 100)}${text.length > 100 ? '...' : ''}`);
                                        });
                                    } else {
                                        console.error(`  非陣列結果: ${JSON.stringify(result, null, 2)}`);
                                    }
                                    console.error('=== 重新翻譯數量不符詳細除錯資訊結束 ===\n');
                                }
                                
                                throw error;
                            }

                            return result;
                        }, MAX_RETRY_ATTEMPTS, `重新翻譯批次 ${batchIdx + 1}`);

                        // 更新進度
                        completedRetranslations++;
                        const startIdx = batchIdx * BATCH_SIZE + 1;
                        const endIdx = Math.min((batchIdx + 1) * BATCH_SIZE, blocks.length);
                        process.stdout.write(`\r[${inputFilename}] 重新翻譯進度: ${completedRetranslations}/${totalRetranslations} 批次完成 (第 ${startIdx}-${endIdx} 條已完成)...`);

                        return translations;
                    });

                    // 執行重新翻譯
                    const allRetranslations = await promisePool(retranslationTasks, 20);
                    const flatRetranslations = allRetranslations.flat();

                    // 更新翻譯結果
                    translatedBlocks = blocks.map((block, idx) => ({
                        ...block,
                        text: flatRetranslations[idx] || ''
                    }));

                    process.stdout.write('\n'); // 確保下一行從新行開始
                    console.log('重新翻譯完成，再次檢查格式...');
                } else {
                    console.error(`已達到最大重試次數 (${MAX_RETRY_ATTEMPTS})，格式檢查仍然失敗`);
                    console.log('將繼續處理，但可能存在格式不一致問題');
                    formatCheckPassed = true; // 強制退出迴圈
                }
            } else {
                formatCheckPassed = true;
                console.log('Markdown 格式檢查通過，準備寫入輸出檔案...');
            }
        }
    } else {
        // console.log('ASS 格式無需檢查時間碼順序，準備寫入輸出檔案...');
    }
    fs.writeFileSync(outputPath, serializeSubtitle(translatedBlocks, outputType, subtitleContent), 'utf8');
    console.log(`\n翻譯完成，已寫入 ${outputPath}\n---\n`);
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
