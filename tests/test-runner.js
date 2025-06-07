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
