# CI/CD Integration

Run AI-powered code reviews headlessly in your CI/CD pipelines using the standalone `@ollama-code-review/cli` package.

## Installation

```bash
npm install -g @ollama-code-review/cli
```

## Basic Usage

Review a PR diff with Claude and fail the pipeline on high-severity findings:

```bash
ANTHROPIC_API_KEY=sk-... ollama-review \
  --provider claude \
  --model claude-3-7-sonnet \
  --profile security \
  --fail-on-severity high
```

## GitHub Actions Example

```yaml
name: AI Code Review
on: [pull_request]
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g @ollama-code-review/cli
      - name: AI Code Review
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          git diff origin/${{ github.base_ref }}...HEAD > /tmp/pr.diff
          ollama-review \
            --provider claude \
            --post-to-github \
            --diff-file /tmp/pr.diff
```

See the `ci-templates/` folder in the repository for more examples.
