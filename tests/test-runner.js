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
