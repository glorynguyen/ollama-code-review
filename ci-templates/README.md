# CI/CD Integration Templates (F-010)

This directory contains ready-to-use CI/CD templates for running Ollama Code Review headlessly in your pipelines.

## Available Templates

| File | Platform | Description |
|------|----------|-------------|
| `github-actions.yml` | GitHub Actions | PR review workflow with comment posting |
| `gitlab-ci.yml` | GitLab CI | MR review job template |

## Quick Start

### GitHub Actions

1. Copy `github-actions.yml` to `.github/workflows/code-review.yml` in your repo
2. Set the required secrets in **Settings → Secrets → Actions**
3. Open a pull request — the review runs automatically

### GitLab CI

1. Copy the relevant job from `gitlab-ci.yml` into your `.gitlab-ci.yml`
2. Set CI/CD variables in **Project → Settings → CI/CD → Variables**
3. Open a merge request — the review job runs automatically

## CLI Reference

After installing the CLI (`npm install -g @ollama-code-review/cli`):

```bash
# Review staged changes with Claude
ANTHROPIC_API_KEY=sk-... ollama-review --provider claude --profile security

# Review a specific diff file and output JSON
ollama-review --provider gemini --diff-file pr.diff --output-format json

# Fail the pipeline if critical/high findings are found
ollama-review --provider ollama --model qwen2.5-coder:14b-instruct-q4_0 \
  --fail-on-severity high --post-to-github

# Pipe a diff from git
git diff origin/main...HEAD | ollama-review --provider claude
```

## Environment Variables

All CLI flags can also be set via environment variables:

| Variable | Flag | Description |
|----------|------|-------------|
| `OCR_PROVIDER` | `--provider` | AI provider |
| `OCR_MODEL` | `--model` | Model name |
| `OCR_OLLAMA_ENDPOINT` | `--ollama-endpoint` | Ollama API URL |
| `OCR_PROFILE` | `--profile` | Review profile |
| `OCR_FAIL_ON_SEVERITY` | `--fail-on-severity` | Failure threshold |
| `OCR_OUTPUT_FORMAT` | `--output-format` | Output format |
| `OCR_VERBOSE` | `--verbose` | Verbose logging |
| `ANTHROPIC_API_KEY` | — | Claude API key |
| `GEMINI_API_KEY` | — | Gemini API key |
| `MISTRAL_API_KEY` | — | Mistral API key |
| `GITHUB_TOKEN` | — | GitHub token for PR comments |
