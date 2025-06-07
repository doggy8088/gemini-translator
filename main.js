#!/usr/bin/env node
// Gemini SRT 英翻中（繁體）翻譯器
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const yargs = require('yargs/yargs');
const promisePool = require('./promisePool');

const BATCH_SIZE = 10;
const DEFAULT_MODEL = 'gemini-2.5-flash-preview-05-20';
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

function parseArgs() {
    return yargs(process.argv.slice(2))
        .usage('用法: npx @willh/gemini-srt-translator --input <input.srt> [--output <output.srt>] [--model <model>] [--autofix]')
        .option('input', { alias: 'i', demandOption: true, describe: '輸入字幕檔案路徑 (支援 .srt, .vtt, .ass)', type: 'string' })
        .option('output', { alias: 'o', describe: '輸出字幕檔案路徑，預設根據輸入檔案自動產生', type: 'string' })
        .option('model', { alias: 'm', describe: 'Gemini 模型，預設為 gemini-2.5-flash-preview-05-20', type: 'string', default: DEFAULT_MODEL })        .option('autofix', { describe: '自動修正字幕序號不連續問題 (適用於 SRT 和 WebVTT)', type: 'boolean', default: false })
        .example('npx @willh/gemini-srt-translator --input input.srt', '將 input.srt 翻譯為 input.zh.srt')
        .example('npx @willh/gemini-srt-translator -i input.vtt', '翻譯 WebVTT 檔案')
        .example('npx @willh/gemini-srt-translator -i input.ass -o output.ass', '翻譯 ASS 檔案')
        .example('npx @willh/gemini-srt-translator -i input.srt --autofix', '自動修正 SRT 字幕序號不連續問題')
        .example('npx @willh/gemini-srt-translator -i input.vtt --autofix', '自動修正 WebVTT 字幕序號不連續問題')
        .help('h')
        .alias('h', 'help')
        .wrap(null)
        .argv;
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
Title: Translated Subtitles
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,16,&Hffffff,&Hffffff,&H0,&H0,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1

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

function parseSubtitle(content, type) {
    switch (type) {
        case 'srt':
            return parseSRT(content);
        case 'webvtt':
            return parseWebVTT(content);
        case 'ass':
            return parseASS(content);
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
            return serializeASS(blocks, originalContent);
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
        default:
            throw new Error(`不支援的字幕檔案格式: ${ext}。支援的格式: .srt, .vtt, .webvtt, .ass, .ssa`);
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

// 修改 translateBatch，於 prompt 加入摘要 context
async function translateBatch(texts, apiKey, model) {
    // 若有摘要，加入 context 以提升翻譯品質
    let contextPrompt = '';
    if (typeof globalThis.translationSummary === 'string' && globalThis.translationSummary) {
        contextPrompt = `\n\n【主題摘要】\n${globalThis.translationSummary}\n`;
    }
    const prompt = `The following text is a string array. Translate each element in this array from English to Traditional Chinese (zh-tw). If the string string have 10 elements, the output should also be a string array with 10 elements. Do not add any extra text or formatting. Make sure the output is a valid JSON array. Here is the context of the translation task: \`\`\`${contextPrompt}\`\`\``;
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
    const type = detectSubtitleType(inputPath);
    const outputPath = argv.output || generateOutputPath(inputPath, type);
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

    console.log(`檢測到字幕格式: ${type.toUpperCase()}`);    const subtitleContent = fs.readFileSync(inputPath, 'utf8');
    const blocks = parseSubtitle(subtitleContent, type);

    // 檢查 index 連續性，若有缺漏則顯示有問題的 time code 並停止，或自動修正 (適用於 SRT 和 WebVTT)
    if (type === 'srt' || type === 'webvtt') {
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
                }
                // 修正後直接覆蓋原檔，根據格式使用對應的序列化函數
                const fixedContent = type === 'srt' ? serializeSRT(blocks) : serializeWebVTT(blocks);
                fs.writeFileSync(inputPath, fixedContent, 'utf8');
                console.log('已自動修正並覆蓋原始檔案，請重新執行本程式。');
                process.exit(0);
            } else {
                console.error('字幕序號不連續，發現缺漏：');
                broken.forEach(b => {
                    console.error(`缺少序號 ${b.missing}，前一字幕時間碼: ${b.prevTime}，下一字幕時間碼: ${b.nextTime}`);
                });
                console.error('\n提示：您可以使用 --autofix 選項來自動修正字幕序號不連續問題');
                const fileExt = type === 'srt' ? 'srt' : 'vtt';
                console.error(`例如：npx @willh/gemini-srt-translator --input input.${fileExt} --autofix`);
                process.exit(1);
            }
        }
    }

    // 產生摘要以提升翻譯品質
    const allTexts = blocks.map(b => b.text).join('\n');
    let summary = '';
    try {
        console.log('正在產生字幕摘要以提升翻譯品質...');
        const summaryPrompt = `請閱讀以下英文字幕內容，並以繁體中文摘要其主題、內容重點、專有名詞、人物、背景、風格等，摘要長度 100-200 字，僅回傳摘要內容：\n${allTexts}`;
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
    console.log(`共 ${blocks.length} 條字幕，分批處理中...`);
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
        let translations;
        try {
            // console.error('翻譯內容:', JSON.stringify(texts, null, 2));
            translations = await translateBatch(texts, apiKey, model);
            // console.error('翻譯結果:', JSON.stringify(translations, null, 2));
            if (!Array.isArray(translations) || translations.length !== batch.length) {
                console.error(`\n翻譯失敗: 翻譯數量與原始字幕數量不符 (input: ${batch.length}, result: ${Array.isArray(translations) ? translations.length : 'N/A'})`);
                if (Array.isArray(translations)) {
                    console.error('翻譯結果:', JSON.stringify(translations, null, 2));
                }
                throw new Error('翻譯數量與原始字幕數量不符');
            }
        } catch (e) {
            if (!e.message || !e.message.includes('翻譯數量與原始字幕數量不符')) {
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
    if (type !== 'ass') {
        console.log('檢查時間碼順序...');
        console.log();
        if (!checkSequentialTimestamps(translatedBlocks)) {
            console.error('時間碼順序錯誤');
            process.exit(1);
        }
        console.log('時間碼順序檢查通過，準備寫入輸出檔案...');
    } else {
        // console.log('ASS 格式無需檢查時間碼順序，準備寫入輸出檔案...');
    }
    fs.writeFileSync(outputPath, serializeSubtitle(translatedBlocks, type, subtitleContent), 'utf8');
    console.log(`\n翻譯完成，已寫入 ${outputPath}`);
}

if (require.main === module) {
    main();
}
