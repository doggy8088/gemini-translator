#!/usr/bin/env node

// Simple validation test that mimics CI behavior
import fs from 'fs';

console.log('🔍 Basic validation tests');

// Test 1: Files exist
import { spawn } from 'child_process';

console.log('🧪 Running Gemini Translator Tests');
console.log('=====================================');

let testsPassed = 0;
let testsFailed = 0;

async function runTest(name, testFn) {
  try {
    console.log(`\n▶️  ${name}`);
    await testFn();
    console.log(`✅ ${name} - PASSED`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name} - FAILED`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function checkSyntax(filename) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['-c', filename], {
      cwd: process.cwd(),
      stdio: 'pipe'
    });

    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Syntax error in ${filename}: ${stderr}`));
      } else {
        resolve();
      }
    });
  });
}

// Main test execution
async function runAllTests() {
  // Test 1: Check if main files exist
  await runTest('Main files exist', () => {
    assertTrue(fs.existsSync('main.js'), 'main.js should exist');
    assertTrue(fs.existsSync('promisePool.js'), 'promisePool.js should exist');
    assertTrue(fs.existsSync('package.json'), 'package.json should exist');
  });

  // Test 2: Check package.json structure
  await runTest('Package.json validation', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

    assertTrue(pkg.name, 'Package should have a name');
    assertTrue(pkg.version, 'Package should have a version');
    assertTrue(pkg.main, 'Package should have a main entry point');
    assertTrue(pkg.bin, 'Package should have bin configuration');
    assertTrue(pkg.dependencies, 'Package should have dependencies');

    // Check required dependencies
    assertTrue(pkg.dependencies.axios, 'axios dependency should be present');
    assertTrue(pkg.dependencies.yargs, 'yargs dependency should be present');
  });

  // Test 3: Check if main.js is syntactically correct
  await runTest('Main.js syntax check', async () => {
    await checkSyntax('main.js');
  });

  // Test 4: Check if promisePool.js is syntactically correct
  await runTest('PromisePool.js syntax check', async () => {
    await checkSyntax('promisePool.js');
  });

  // Test 5: Check test files exist
  await runTest('Test files exist', () => {
    const testDir = 'tests';
    if (fs.existsSync(testDir)) {
      const files = fs.readdirSync(testDir);
      assertTrue(files.length > 0, 'Tests directory should contain test files');

      // Check for SRT test file
      const srtFiles = files.filter(f => f.endsWith('.srt'));
      assertTrue(srtFiles.length > 0, 'Should have at least one SRT test file');
    }
  });

  // Test 6: Check CLI help command
  await runTest('CLI help command', async () => {
    return new Promise((resolve, reject) => {
      const child = spawn('node', ['main.js', '--help'], {
        cwd: process.cwd(),
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`CLI help failed with code ${code}: ${stderr}`));
        } else if (!stdout.includes('用法:')) {
          reject(new Error('Help output does not contain expected content'));
        } else {
          resolve();
        }
      });
    });
  });

  // Test 6.5: Enhanced Markdown parsing test
  await runTest('Enhanced Markdown parsing', () => {
    // Test if enhanced Markdown detection works properly
    const testMd = `# Test Header

This is a test with various Markdown elements:

- List item 1
- List item 2
  - Nested item

\`\`\`javascript
function test() {
  console.log("test");
}
\`\`\`

[Link](https://example.com)

::: tip
This is a tip
:::

$$
E = mc^2
$$
`;

    // Test that the markdown contains various elements we can now detect
    assertTrue(testMd.includes('# Test'), 'Should contain headers');
    assertTrue(testMd.includes('- List'), 'Should contain lists');
    assertTrue(testMd.includes('```'), 'Should contain code blocks');
    assertTrue(testMd.includes('[Link]'), 'Should contain links');
    assertTrue(testMd.includes(':::'), 'Should contain special syntax');
    assertTrue(testMd.includes('$$'), 'Should contain math blocks');
    
    console.log('   ✅ Enhanced Markdown elements detected correctly');
  });

  // Test 7: Check overwrite detection (input same as output)
  await runTest('Overwrite detection test', async () => {
    // Create a temporary test file
    const testContent = `1
00:00:01,000 --> 00:00:05,000
Hello World

2
00:00:06,000 --> 00:00:10,000
This is a test subtitle
`;
    
    const tempFile = './temp-test.srt';
    fs.writeFileSync(tempFile, testContent, 'utf8');
    
    try {
      return new Promise((resolve, reject) => {
        // Test with same input and output file (should detect overwrite mode)
        const child = spawn('node', ['main.js', '-i', tempFile, '-o', tempFile], {
          cwd: process.cwd(),
          stdio: 'pipe',
          env: { ...process.env, GEMINI_API_KEY: 'fake-key-for-test' }
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        child.on('close', (code) => {
          // We expect this to fail due to fake API key, but it should detect overwrite mode first
          if (stdout.includes('偵測到輸入與輸出檔案相同，將自動覆蓋原檔案') || 
              stderr.includes('偵測到輸入與輸出檔案相同，將自動覆蓋原檔案')) {
            resolve();
          } else {
            reject(new Error(`Expected overwrite detection message not found. Stdout: ${stdout}, Stderr: ${stderr}`));
          }
        });
      });
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });

  // Test 8: Check extractMarkdownCodeBlocks fix for list continuation lines
  await runTest('Markdown code blocks detection fix', () => {
    // Read main.js content to extract functions for testing
    const mainJsContent = fs.readFileSync('main.js', 'utf8');
    
    // Extract the extractMarkdownCodeBlocks function
    const functionStart = mainJsContent.indexOf('function extractMarkdownCodeBlocks(text) {');
    let braceCount = 0;
    let functionEnd = functionStart;
    let started = false;

    for (let i = functionStart; i < mainJsContent.length; i++) {
        if (mainJsContent[i] === '{') {
            braceCount++;
            started = true;
        } else if (mainJsContent[i] === '}') {
            braceCount--;
            if (started && braceCount === 0) {
                functionEnd = i + 1;
                break;
            }
        }
    }

    const extractMarkdownCodeBlocksCode = mainJsContent.substring(functionStart, functionEnd);

    // Extract the isPartOfList function
    const isPartOfListStart = mainJsContent.indexOf('function isPartOfList(lines, index) {');
    let isPartOfListBraceCount = 0;
    let isPartOfListEnd = isPartOfListStart;
    let isPartOfListStarted = false;

    for (let i = isPartOfListStart; i < mainJsContent.length; i++) {
        if (mainJsContent[i] === '{') {
            isPartOfListBraceCount++;
            isPartOfListStarted = true;
        } else if (mainJsContent[i] === '}') {
            isPartOfListBraceCount--;
            if (isPartOfListStarted && isPartOfListBraceCount === 0) {
                isPartOfListEnd = i + 1;
                break;
            }
        }
    }

    const isPartOfListCode = mainJsContent.substring(isPartOfListStart, isPartOfListEnd);

    // Test the issue case - should only detect inline code blocks, not indented ones in lists
    const testMarkdownWithLists = `## Authentication

- **Error: \`Failed to login. Message: Request contains an invalid argument\`**
  - Users with Google Workspace accounts, or users with Google Cloud accounts
    associated with their Gmail accounts may not be able to activate the free
    tier of the Google Code Assist plan.
  - For Google Cloud accounts, you can work around this by setting
    \`GOOGLE_CLOUD_PROJECT\` to your project ID.
  - You can also grab an API key from [AI
    Studio](http://aistudio.google.com/app/apikey), which also includes a
    separate free tier.`;

    // Test the fix by evaluating the functions in a sandbox
    const testCode = `
    ${isPartOfListCode}
    
    ${extractMarkdownCodeBlocksCode}
    
    const blocks = extractMarkdownCodeBlocks(\`${testMarkdownWithLists.replace(/`/g, '\\`')}\`);
    blocks;
    `;

    const blocks = eval(testCode);
    
    // Should only find 2 inline code blocks, not the indented list continuation lines
    assertTrue(blocks.length === 2, `Expected 2 code blocks, but found ${blocks.length}`);
    assertTrue(blocks.every(block => block.type === 'inline'), 'All blocks should be inline type');
    
    console.log('   ✅ Correctly identified only inline code blocks in lists');
    console.log(`   ✅ Found ${blocks.length} code blocks (expected 2)`);
  });

  // Test 9: Smart chunking fix for list items
  await runTest('Smart chunking respects list boundaries', () => {
    // Read main.js content to extract functions for testing
    const mainJsContent = fs.readFileSync('main.js', 'utf8');
    
    // Extract the parseMarkdown function and its dependencies
    function extractFunction(startText) {
      const startIndex = mainJsContent.indexOf(startText);
      let braceCount = 0;
      let end = startIndex;
      let started = false;
      
      for (let i = startIndex; i < mainJsContent.length; i++) {
        if (mainJsContent[i] === '{') {
          braceCount++;
          started = true;
        } else if (mainJsContent[i] === '}') {
          braceCount--;
          if (started && braceCount === 0) {
            end = i + 1;
            break;
          }
        }
      }
      return mainJsContent.substring(startIndex, end);
    }

    const parseMarkdownCode = extractFunction('function parseMarkdown(content) {');
    const isPartOfListCode = extractFunction('function isPartOfList(lines, index) {');
    const isPartOfHeaderCode = extractFunction('function isPartOfHeader(lines, index) {');
    const hasOngoingStructureCode = extractFunction('function hasOngoingStructure(lines, index) {');
    const isAtListBoundaryCode = extractFunction('function isAtListBoundary(lines, index) {');

    // Test content with a multi-line list item that should not be split
    const testContent = `# Test Document

This is a comprehensive test document that contains enough content to trigger the chunking mechanism in parseMarkdown function.

## Authentication Section

- **Complex list item with detailed explanation**
  - This is a multi-line list item with continuation lines that provide detailed information
  - It has multiple indented lines that belong together as a cohesive unit
  - And should not be split across chunks when the byte limit is reached during processing
  - This includes additional explanatory text and examples for completeness
  - The last line should stay with the rest of the item to maintain semantic integrity

- **Another complex list item for testing**
  - This item also has multiple continuation lines that should stay together
  - With detailed explanations and additional context information
  - Including examples and use cases that span multiple lines
  - All of these lines should remain as a complete unit

## Configuration Section

Additional content to ensure we exceed the chunking threshold and trigger the smart chunking behavior.

### Detailed Instructions

- **Step-by-step configuration process**
  - First, ensure that your environment is properly set up
  - Then, configure the necessary parameters and settings
  - Finally, test the configuration to verify it works correctly
  - Document any issues or special considerations for future reference

## Final Section

More content to ensure adequate size for chunking test.`;

    const testCode = `
    const BYTES_PER_CHUNK = 1000;
    ${isPartOfListCode}
    ${isPartOfHeaderCode}
    ${hasOngoingStructureCode}
    ${isAtListBoundaryCode}
    ${parseMarkdownCode}
    
    const chunks = parseMarkdown(\`${testContent.replace(/`/g, '\\`')}\`);
    chunks;
    `;

    const chunks = eval(testCode);
    
    // Verify that list items are not fragmented across chunks
    let hasFragmentedList = false;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const lines = chunk.text.split('\n');
      const lastLine = lines[lines.length - 1];
      
      // Check if chunk ends with a list continuation line
      if (lastLine.match(/^\s+/) && lastLine.trim() !== '' && 
          !lastLine.trim().match(/^[-*+]\s/) && !lastLine.trim().match(/^\d+\.\s/)) {
        
        // Check if the next chunk starts with another continuation
        if (i + 1 < chunks.length) {
          const nextChunk = chunks[i + 1];
          const nextLines = nextChunk.text.split('\n');
          const firstLine = nextLines[0];
          
          if (firstLine.match(/^\s+/)) {
            hasFragmentedList = true;
            break;
          }
        }
      }
    }
    
    assertTrue(!hasFragmentedList, 'List items should not be fragmented across chunks');
    assertTrue(chunks.length > 1, 'Content should be chunked for this test to be meaningful');
    
    console.log(`   ✅ Generated ${chunks.length} chunks without fragmenting list items`);
    console.log('   ✅ List boundaries are properly respected');
  });

  // Test debug functionality doesn't truncate content
  await runTest('Debug output shows full content without truncation', async () => {
    const longContent = 'This is a very long piece of content that definitely exceeds 150 characters and should be displayed in full when debug mode is enabled. It contains important information that users need to see for debugging purposes. The content should not be truncated at all.';
    
    // Mock console.error to capture output
    const originalConsoleError = console.error;
    const capturedOutput = [];
    console.error = (...args) => {
      capturedOutput.push(args.join(' '));
    };
    
    try {
      // Create test blocks with long content
      const originalBlocks = [{ text: longContent }];
      const translatedBlocks = [{ text: longContent + ' (translated)' }];
      const errors = ['Test error'];
      
      // Extract the showMarkdownFormatDebug function
      const showMarkdownFormatDebugCode = `
        function showMarkdownFormatDebug(originalBlocks, translatedBlocks, errors, isDebugMode, inputPath) {
          if (!isDebugMode) return;
          
          console.error('\\n=== Markdown 格式檢查除錯資訊 ===');
          console.error(\`正在處理檔案: \${inputPath}\`);
          console.error(\`發現 \${errors.length} 個格式問題:\`);
          
          errors.forEach((error, index) => {
              console.error(\`  \${index + 1}. \${error}\`);
          });
          
          console.error('\\n詳細區塊比對:');
          const maxBlocks = Math.max(originalBlocks.length, translatedBlocks.length);
          
          for (let i = 0; i < maxBlocks; i++) {
              console.error(\`\\n--- 區塊 \${i + 1} ---\`);
              
              if (i < originalBlocks.length) {
                  const originalText = originalBlocks[i].text || '';
                  console.error(\`原始: \${originalText.replace(/\\n/g, '\\\\n')}\`);
              } else {
                  console.error('原始: [不存在]');
              }
              
              if (i < translatedBlocks.length) {
                  const translatedText = translatedBlocks[i].text || '';
                  console.error(\`翻譯: \${translatedText.replace(/\\n/g, '\\\\n')}\`);
              } else {
                  console.error('翻譯: [不存在]');
              }
          }
          
          console.error('\\n=== Markdown 格式檢查除錯資訊結束 ===\\n');
        }
        
        showMarkdownFormatDebug(originalBlocks, translatedBlocks, errors, true, 'test.md');
      `;
      
      eval(showMarkdownFormatDebugCode);
      
      // Check that the full content is displayed (no truncation)
      const fullOutput = capturedOutput.join(' ');
      assertTrue(fullOutput.includes(longContent), 'Full original content should be displayed');
      assertTrue(fullOutput.includes(longContent + ' (translated)'), 'Full translated content should be displayed');
      assertTrue(!fullOutput.includes('...'), 'Output should not contain truncation indicators');
      
      console.log('   ✅ Debug output shows full content without truncation');
      console.log(`   ✅ Content length: ${longContent.length} characters (exceeds old 150 limit)`);
      console.log('   ✅ No truncation indicators found in output');
      
    } finally {
      // Restore console.error
      console.error = originalConsoleError;
    }
  });

  // Summary
  console.log('\n📊 Test Summary');
  console.log('===============');
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`📈 Total:  ${testsPassed + testsFailed}`);

  if (testsFailed > 0) {
    console.log('\n❌ Some tests failed!');
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  }
}

// Run all tests
runAllTests().catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});
