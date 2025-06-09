This is a Node.js based CLI tool for translating subtitle files (SRT, WebVTT, ASS) and Markdown files from English to Traditional Chinese using Google's Gemini API. Please follow these guidelines when contributing:

## Project Overview

This repository provides a command-line tool that translates various file formats using Google's Gemini API. The primary purpose is to help content creators translate subtitles and documentation from English to Traditional Chinese while preserving formatting and structure.

## Code Standards

### Required Before Each Commit
- Run `npm run lint` before committing any changes to ensure syntax validation
- This performs basic syntax checking on main.js and promisePool.js using `node -c`
- Run `npm test` to ensure all tests pass

### Development Flow
- Install dependencies: `npm install`
- Test: `npm test` (runs custom test suite)
- Lint: `npm run lint` (syntax validation)
- Validate package: `npm run validate` (checks dependencies and package structure)
- Full CI check includes all above plus installation testing

## Repository Structure
- `main.js`: Main application logic and CLI interface with argument parsing
- `promisePool.js`: Concurrent processing utility for managing API request limits
- `package.json`: Package configuration with ES module support and CLI bin entry
- `tests/`: Test files including SRT, VTT, ASS, and Markdown samples plus test runner
- `.github/workflows/`: CI/CD workflows for testing, code quality, auto-release, and NPM publishing
- `scripts/`: Additional utility scripts for video processing

## Technology Stack
- **Node.js 20+**: ES modules with modern JavaScript features
- **axios**: HTTP client for Gemini API interactions
- **yargs**: Command-line argument parsing with extensive help system
- **Custom concurrency**: promisePool.js for managing parallel API requests

## Key Guidelines
1. **ES Module syntax**: Use import/export, not require/module.exports
2. **CLI-first design**: Maintain comprehensive help text and examples in Chinese
3. **Error handling**: Provide clear error messages in Chinese for user-facing issues
4. **API efficiency**: Use batch processing (BATCH_SIZE = 10) and concurrency limits (20 parallel requests)
5. **File format support**: Maintain compatibility with SRT, WebVTT, ASS, and Markdown formats
6. **Format conversion**: Support cross-format translation (e.g., SRT to ASS)
7. **Robust parsing**: Handle malformed subtitle files with auto-fix options
8. **Environment variables**: Use GEMINI_API_KEY for authentication

## Code Patterns
- Use functional programming style with async/await
- Implement retry logic for API failures (MAX_RETRY_ATTEMPTS = 3)
- Parse command-line arguments with yargs for consistent UX
- Use structured JSON responses from Gemini API
- Implement proper file I/O with encoding handling

## Testing Guidelines
- Write tests in `tests/test-runner.js` using custom test framework
- Include syntax validation tests for all main modules
- Test CLI help command and argument parsing
- Validate package.json structure and dependencies
- Test overwrite detection and file handling edge cases
- Use sample files in tests/ directory for integration testing

## NPM Package Considerations
- Package is published as `@willh/gemini-translator` with CLI bin entry
- Follow semantic versioning for releases
- Use prepublishOnly hook to run tests and validation
- Maintain shebang in main.js for CLI execution
- Keep package size minimal (no unnecessary dependencies)

## Shell Environment
Use bash as shell environment for consistency with CI/CD workflows.