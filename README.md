# Gemini Translator

<!--
[![CI](https://github.com/doggy8088/gemini-translator/actions/workflows/ci.yml/badge.svg)](https://github.com/doggy8088/gemini-translator/actions/workflows/ci.yml)
[![Publish to NPM](https://github.com/doggy8088/gemini-translator/actions/workflows/publish.yml/badge.svg)](https://github.com/doggy8088/gemini-translator/actions/workflows/publish.yml)
[![Code Quality](https://github.com/doggy8088/gemini-translator/actions/workflows/code-quality.yml/badge.svg)](https://github.com/doggy8088/gemini-translator/actions/workflows/code-quality.yml)
-->
[![npm version](https://badge.fury.io/js/@willh%2Fgemini-translator.svg)](https://badge.fury.io/js/@willh%2Fgemini-translator)

A powerful command-line tool that translates SRT, WebVTT, ASS, Markdown files from English to Traditional Chinese using Google's Gemini AI API. The tool features intelligent context-aware translation with automatic content summarization for improved translation quality.

## Features

- 🚀 **Fast Batch Processing**: Translates subtitles in batches with configurable concurrency
- 🧠 **Context-Aware Translation**: Generates content summary to improve translation accuracy
- 🔧 **Auto-Fix**: Automatically fixes non-sequential subtitle numbering
- 📝 **SRT Format Support**: Full support for standard SRT subtitle format
- ⚡ **Parallel Processing**: Up to 20 concurrent translation tasks
- 🎯 **Customizable Models**: Support for different Gemini AI models
- 📊 **Progress Tracking**: Real-time translation progress display

## Installation

### Using npx (Recommended)

No installation required! Run directly with npx:

```bash
npx @willh/gemini-translator --input your-subtitle.srt
```

### Global Installation

```bash
npm install -g @willh/gemini-translator
```

Then run:

```bash
gemini-translator --input your-subtitle.srt
```

## Prerequisites

### 1. Get Google Gemini API Key

1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Create a new API key
3. Set the environment variable:

**Windows (PowerShell)**:

```powershell
$env:GEMINI_API_KEY = "your-api-key-here"
```

**Windows (Command Prompt)**:

```cmd
set GEMINI_API_KEY=your-api-key-here
```

**macOS/Linux**:

```bash
export GEMINI_API_KEY="your-api-key-here"
```

### 2. Node.js

Ensure you have Node.js 14+ installed. Check with:

```bash
node --version
```

## Usage

### Basic Usage

Translate a subtitle file to Traditional Chinese:

```bash
npx @willh/gemini-translator --input movie.srt
```

This will create `movie.zh.srt` in the same directory.

### Advanced Usage

```bash
# Custom output filename
npx @willh/gemini-translator --input movie.srt --output movie-chinese.srt

# Use specific Gemini model
npx @willh/gemini-translator --input movie.srt --model gemini-2.5-pro

# Auto-fix subtitle numbering issues
npx @willh/gemini-translator --input movie.srt --autofix

# Combine options
npx @willh/gemini-translator -i movie.srt -o output.srt -m gemini-2.5-pro --autofix
```

## Command Line Options

| Option      | Alias | Description                                | Default                          |
| ----------- | ----- | ------------------------------------------ | -------------------------------- |
| `--input`   | `-i`  | Input SRT file path (required)             | -                                |
| `--output`  | `-o`  | Output SRT file path                       | `<input>.zh.srt`                 |
| `--model`   | `-m`  | Gemini model to use                        | `gemini-2.5-flash-lite-preview-06-17` |
| `--autofix` | -     | Auto-fix non-sequential subtitle numbering | `false`                          |
| `--help`    | `-h`  | Show help information                      | -                                |

## How It Works

1. **Content Analysis**: The tool first analyzes the entire subtitle content to generate a summary
2. **Context Generation**: Creates a context summary including themes, terminology, characters, and style
3. **Batch Processing**: Divides subtitles into batches of 10 for efficient processing
4. **Parallel Translation**: Processes up to 20 batches simultaneously using Gemini AI
5. **Quality Assurance**: Validates translation results and timestamp sequences
6. **Output Generation**: Creates the final translated SRT file

## Supported Models

- `gemini-2.5-flash-lite-preview-06-17` (default - fastest)
- `gemini-2.5-flash` (fast, stable)
- `gemini-2.5-pro` (highest quality)
- Other Gemini models as they become available

## Error Handling

The tool includes robust error handling for common issues:

- **Missing API Key**: Clear instructions to set up the environment variable
- **Invalid SRT Format**: Detailed error messages for format issues
- **Non-Sequential Numbering**: Option to auto-fix or manual correction guidance
- **API Errors**: Retry logic and detailed error reporting
- **Network Issues**: Graceful handling of connection problems

## Examples

### Example 1: Basic Translation

```bash
npx @willh/gemini-translator --input "My Movie.srt"
# Output: "My Movie.zh.srt"
```

### Example 2: Batch Processing with Auto-fix

```bash
npx @willh/gemini-translator -i "Series S01E01.srt" --autofix
# Automatically fixes numbering issues and translates
```

### Example 3: High-Quality Translation

```bash
npx @willh/gemini-translator -i "Documentary.srt" -m gemini-2.5-pro -o "Documentary-TC.srt"
# Uses the most advanced model for better accuracy
```

## Troubleshooting

### Common Issues

**"請設定 GEMINI\_API\_KEY 環境變數"**

- Solution: Set up your Gemini API key as described in Prerequisites

**"字幕序號不連續"**

- Solution: Use the `--autofix` flag to automatically correct numbering

**"翻譯數量與原始字幕數量不符"**

- Solution: Check your internet connection and API key validity

**"找不到輸入檔案"**

- Solution: Verify the file path and ensure the SRT file exists

### Performance Tips

- Use `gemini-2.5-flash-lite-preview-06-17` for faster processing
- Use `gemini-2.5-pro` for higher quality translations
- Ensure stable internet connection for batch processing
- Large files (1000+ subtitles) may take several minutes

## Development

### Project Structure

```
gemini-translator/
├── main.js              # Main application logic
├── promisePool.js       # Concurrent processing utility
├── package.json         # Package configuration
├── scripts/
│   └── Make_Video.ps1   # Video processing script
└── README.md           # This file
```

### Local Development

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up your API key
4. Test locally:
   ```bash
   node main.js --input test.srt
   ```

## Publishing to NPM

### Prerequisites for Publishing

1. **NPM Account**: Create an account at [npmjs.com](https://www.npmjs.com/)
2. **NPM CLI**: Install and login

   ```bash
   npm install -g npm
   npm login
   ```

### Publishing Steps

1. **Prepare the Package**

   ```bash
   # Ensure all files are ready
   npm run test  # If you have tests

   # Check package contents
   npm pack --dry-run
   ```

2. **Version Management**

   ```bash
   # Update version (patch/minor/major)
   npm version patch  # 1.0.0 -> 1.0.1
   npm version minor  # 1.0.0 -> 1.1.0
   npm version major  # 1.0.0 -> 2.0.0
   ```

3. **Publish to NPM**

   ```bash
   # For scoped packages (like @willh/gemini-translator)
   npm publish --access public

   # For regular packages
   npm publish
   ```

4. **Verify Publication**

   ```bash
   # Test installation
   npx @willh/gemini-translator@latest --help
   ```

### Publishing Checklist

- [ ] Update version in `package.json`
- [ ] Ensure `bin` field points to correct executable
- [ ] Add shebang (`#!/usr/bin/env node`) to main.js
- [ ] Test with `npm pack --dry-run`
- [ ] Verify dependencies are correct
- [ ] Update README.md if needed
- [ ] Test locally with different SRT files
- [ ] Publish with `npm publish --access public`
- [ ] Test installation with `npx`

### Updating the Package

```bash
# Make your changes
git add .
git commit -m "Update: description of changes"

# Update version
npm version patch

# Publish update
npm publish --access public
```

## Technical Details

### Dependencies

- **axios**: HTTP client for Gemini API calls
- **yargs**: Command-line argument parsing
- **fs/path**: File system operations (Node.js built-in)

### API Integration

The tool uses Google's Gemini API with:

- Structured JSON response format
- Context-aware prompting
- Batch processing optimization
- Error recovery mechanisms

### Performance Characteristics

- **Batch Size**: 10 subtitles per API call
- **Concurrency**: Up to 20 parallel requests
- **Rate Limiting**: Automatically handled by promise pool
- **Memory Usage**: Efficient streaming for large files

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Support

For issues and questions:

- GitHub Issues: [Repository Issues](https://github.com/doggy8088/gemini-translator/issues)
- Email: \[Your email]

## Changelog

### v1.0.0

- Initial release
- Basic SRT translation functionality
- Context-aware translation
- Batch processing with concurrency
- Auto-fix for subtitle numbering
- NPX support

---

**Made with ❤️ using Google Gemini AI**
