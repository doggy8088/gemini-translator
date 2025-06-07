# GitHub Actions Setup Instructions

This project now includes comprehensive GitHub Actions workflows for CI/CD.

## Workflows Overview

### 1. CI Pipeline (`ci.yml`)

- **Triggers**: Push to main/develop branches, Pull requests
- **Features**:
  - Tests on multiple Node.js versions (18.x, 20.x, 22.x)
  - Installs dependencies and runs tests
  - Validates CLI installation
  - Tests with sample files
  - Package validation and security audit

### 2. NPM Publishing (`publish.yml`)

- **Triggers**: When a GitHub release is published
- **Features**:
  - Runs tests before publishing
  - Publishes to NPM with public access
  - Uploads package to GitHub release

### 3. Code Quality (`code-quality.yml`)

- **Triggers**: Push to main/develop branches, Pull requests
- **Features**:
  - Runs ESLint and Prettier checks
  - Security audits
  - Dependency review for PRs
  - Checks for outdated packages

### 4. Auto Release (`auto-release.yml`)

- **Triggers**: When package.json version changes on main branch
- **Features**:
  - Automatically creates GitHub releases
  - Generates changelog from git commits
  - Tags releases with version numbers

## Required Secrets

To fully utilize these workflows, add the following secrets to your GitHub repository:

### Repository Secrets (Settings → Secrets and variables → Actions)

1. **`NPM_TOKEN`** (Required for publishing)
   - Go to [npmjs.com](https://www.npmjs.com) → Account → Access Tokens
   - Create a new token with "Automation" type
   - Add the token to GitHub secrets

2. **`GEMINI_API_KEY`** (Optional - for running tests that require API)
   - Your Google Gemini API key
   - Only needed if tests require actual API calls

## Usage Instructions

### Automated Publishing Workflow

1. **Update version in package.json**:
   ```bash
   npm version patch  # or minor/major
   ```

2. **Push to main branch**:
   ```bash
   git push origin main --follow-tags
   ```

3. **Auto-release will trigger** and create a GitHub release

4. **Publishing workflow will trigger** and publish to NPM

### Manual Release Workflow

1. **Create a release on GitHub**:
   - Go to your repository → Releases → Create a new release
   - Choose a tag (e.g., v1.0.1)
   - Write release notes
   - Publish the release

2. **Publishing workflow will automatically trigger**

## Workflow Status

Add these badges to your README.md to show workflow status:

```markdown
[![CI](https://github.com/willh/gemini-translator/actions/workflows/ci.yml/badge.svg)](https://github.com/willh/gemini-translator/actions/workflows/ci.yml)
[![Publish to NPM](https://github.com/willh/gemini-translator/actions/workflows/publish.yml/badge.svg)](https://github.com/willh/gemini-translator/actions/workflows/publish.yml)
[![Code Quality](https://github.com/willh/gemini-translator/actions/workflows/code-quality.yml/badge.svg)](https://github.com/willh/gemini-translator/actions/workflows/code-quality.yml)
```

## Testing Locally

Before pushing, you can test the workflows locally:

```bash
# Run the test script
npm test

# Run linting
npm run lint

# Validate package
npm run validate

# Test CLI help
node main.js --help
```

## Troubleshooting

### Common Issues

1. **Tests failing**: Ensure all test files are present in the `tests/` directory
2. **NPM publish failing**: Check that `NPM_TOKEN` secret is set correctly
3. **Auto-release not triggering**: Ensure the version in package.json actually changed

### Debugging Workflows

- Check the Actions tab in your GitHub repository
- Look at the workflow logs for detailed error messages
- Verify all required secrets are set
- Ensure branch protection rules don't prevent automated pushes

## Customization

You can customize these workflows by:

1. **Modifying trigger conditions** in the `on:` section
2. **Adding/removing Node.js versions** in the strategy matrix
3. **Adding additional test steps** in the jobs
4. **Customizing the changelog generation** in auto-release workflow
5. **Adding deployment steps** for additional platforms
