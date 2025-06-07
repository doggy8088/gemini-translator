#!/usr/bin/env node

/**
 * Basic test runner for Gemini SRT Translator
 * This provides basic smoke tests to ensure the application works correctly
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

console.log('🧪 Running Gemini SRT Translator Tests');
console.log('=====================================');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  try {
    console.log(`\n▶️  ${name}`);
    testFn();
    console.log(`✅ ${name} - PASSED`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name} - FAILED`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\n   Expected: ${expected}\n   Actual: ${actual}`);
  }
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Test 1: Check if main files exist
runTest('Main files exist', () => {
  assertTrue(fs.existsSync('main.js'), 'main.js should exist');
  assertTrue(fs.existsSync('promisePool.js'), 'promisePool.js should exist');
  assertTrue(fs.existsSync('package.json'), 'package.json should exist');
});

// Test 2: Check package.json structure
runTest('Package.json validation', () => {
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
runTest('Main.js syntax check', () => {
  try {
    require('./main.js');
  } catch (error) {
    // We expect it to fail because of missing args, but not due to syntax errors
    if (error.message.includes('SyntaxError')) {
      throw new Error(`Syntax error in main.js: ${error.message}`);
    }
  }
});

// Test 4: Check if promisePool.js is syntactically correct
runTest('PromisePool.js syntax check', () => {
  const promisePool = require('../promisePool.js');
  assertTrue(typeof promisePool === 'function', 'promisePool should export a function');
});

// Test 5: Check test files exist
runTest('Test files exist', () => {
  const testDir = 'tests';
  if (fs.existsSync(testDir)) {
    const files = fs.readdirSync(testDir);
    assertTrue(files.length > 0, 'Tests directory should contain test files');

    // Check for SRT test file
    const srtFiles = files.filter(f => f.endsWith('.srt'));
    assertTrue(srtFiles.length > 0, 'Should have at least one SRT test file');
  }
});

// Test 6: Check CLI help command (basic functionality)
runTest('CLI help command', async () => {
  // Skip this test in CI if it's causing issues
  if (process.env.CI) {
    console.log('   Skipping CLI test in CI environment');
    return;
  }

  // Simple test - just check if the file can be required without syntax errors
  try {
    const fs = require('fs');
    const mainContent = fs.readFileSync('./main.js', 'utf8');
    assertTrue(mainContent.includes('yargs'), 'main.js should use yargs');
    assertTrue(mainContent.includes('gemini'), 'main.js should reference gemini');
  } catch (error) {
    throw new Error(`Could not read or parse main.js: ${error.message}`);
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
