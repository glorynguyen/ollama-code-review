#!/usr/bin/env node
/**
 * F-010: CI/CD Integration
 * Ollama Code Review CLI — headless code review for CI/CD pipelines.
 *
 * Usage:
 *   ollama-review [options] [diff-source]
 *
 * Diff sources (in order of precedence):
 *   1. --diff-file <path>    read diff from a file
 *   2. Piped stdin           echo "$(git diff)" | ollama-review
 *   3. --diff-base <ref>     compute diff: git diff <ref> HEAD
 *   4. Default: git diff HEAD (staged + unstaged)
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as childProcess from 'child_process';
import { buildConfig, CliConfig } from './config';
import { buildPrompt, callAIProvider } from './review';
import { parseSeverityCounts, shouldFail, formatOutput } from './output';
import { getPrContextFromEnv, parsePrUrl, postPrComment, formatPrComment } from './github';

const VERSION = '1.0.0';

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('ollama-review')
    .description('AI-powered code review for CI/CD pipelines')
    .version(VERSION)
    // AI provider options
    .option('--provider <provider>', 'AI provider: ollama|claude|gemini|mistral|glm|minimax|openai-compatible', 'ollama')
    .option('--model <model>', 'Model name (provider-specific)')
    .option('--ollama-endpoint <url>', 'Ollama API endpoint', 'http://localhost:11434/api/generate')
    .option('--openai-compatible-endpoint <url>', 'OpenAI-compatible API endpoint')
    .option('--openai-compatible-model <model>', 'Model for OpenAI-compatible endpoint')
    .option('--temperature <n>', 'Generation temperature (0-1)', parseFloat, 0)
    // Review options
    .option('--profile <profile>', 'Review profile: general|security|performance|accessibility|educational|strict|owasp-top10|pci-dss|gdpr|hipaa|soc2|nist-csf', 'general')
    .option('--prompt-file <path>', 'Path to a custom prompt template file')
    .option('--max-diff-length <n>', 'Max diff characters to send (default 50000)', parseInt, 50000)
    // Diff source options
    .option('--diff-file <path>', 'Read diff from a file instead of git')
    .option('--diff-base <ref>', 'Compute diff: git diff <ref> HEAD (e.g. origin/main)')
    // CI/CD options
    .option('--fail-on-severity <level>', 'Exit with code 1 if findings at this severity: critical|high|medium|low|none', 'none')
    .option('--output-format <format>', 'Output format: text|json|markdown', 'text')
    .option('--post-to-github', 'Post review as a GitHub PR comment (requires GITHUB_TOKEN)')
    .option('--github-pr-url <url>', 'GitHub PR URL to post comment to (overrides env auto-detection)')
    // Verbosity
    .option('--verbose', 'Enable verbose logging')
    .parse(process.argv);

  const opts = program.opts();

  const config: CliConfig = buildConfig({
    provider: opts.provider,
    model: opts.model,
    ollamaEndpoint: opts.ollamaEndpoint,
    openaiCompatibleEndpoint: opts.openaiCompatibleEndpoint,
    openaiCompatibleApiKey: opts.openaiCompatibleApiKey,
    openaiCompatibleModel: opts.openaiCompatibleModel,
    temperature: opts.temperature,
    profile: opts.profile,
    promptFile: opts.promptFile,
    maxDiffLength: opts.maxDiffLength,
    failOnSeverity: opts.failOnSeverity,
    outputFormat: opts.outputFormat,
    postToGitHub: !!opts.postToGitHub,
    githubToken: opts.githubToken,
    verbose: !!opts.verbose,
  });

  // ─── Resolve diff ─────────────────────────────────────────────────────────

  let diff = '';
  let diffSummary = '';

  if (opts.diffFile) {
    // --diff-file <path>
    if (!fs.existsSync(opts.diffFile)) {
      console.error(`Error: diff file not found: ${opts.diffFile}`);
      process.exit(1);
    }
    diff = fs.readFileSync(opts.diffFile, 'utf8');
    diffSummary = `from file ${opts.diffFile}`;
  } else if (!process.stdin.isTTY) {
    // Piped stdin
    diff = fs.readFileSync('/dev/stdin', 'utf8');
    diffSummary = 'from stdin';
  } else if (opts.diffBase) {
    // --diff-base <ref>
    diff = runGitCommand(`git diff ${opts.diffBase} HEAD`);
    diffSummary = `git diff ${opts.diffBase} HEAD`;
  } else {
    // Default: staged + unstaged changes
    diff = runGitCommand('git diff HEAD');
    if (!diff.trim()) {
      diff = runGitCommand('git diff --cached');
    }
    diffSummary = 'git diff HEAD';
  }

  if (!diff.trim()) {
    console.log('No changes found to review.');
    process.exit(0);
  }

  // Truncate diff if needed
  if (diff.length > config.maxDiffLength) {
    if (config.verbose) {
      console.error(`[verbose] Diff truncated from ${diff.length} to ${config.maxDiffLength} chars`);
    }
    diff = diff.slice(0, config.maxDiffLength) + '\n\n[diff truncated — see full diff locally]';
  }

  if (config.verbose) {
    console.error(`[verbose] Provider: ${config.provider}, Model: ${config.model}, Profile: ${config.profile}`);
    console.error(`[verbose] Diff length: ${diff.length} chars`);
  }

  // ─── Run review ───────────────────────────────────────────────────────────

  const prompt = buildPrompt(diff, config);

  let reviewText: string;
  try {
    reviewText = await callAIProvider(prompt, config);
  } catch (err: any) {
    console.error(`Error calling AI provider: ${err?.message ?? err}`);
    process.exit(2);
  }

  if (!reviewText?.trim()) {
    console.error('Error: AI provider returned an empty review.');
    process.exit(2);
  }

  // ─── Parse findings ───────────────────────────────────────────────────────

  const counts = parseSeverityCounts(reviewText);
  const output = formatOutput(reviewText, counts, config, diffSummary);

  // ─── Write output ─────────────────────────────────────────────────────────

  process.stdout.write(output + '\n');

  // ─── GitHub PR comment ────────────────────────────────────────────────────

  if (config.postToGitHub) {
    let prCtx = getPrContextFromEnv();
    if (opts.githubPrUrl) {
      prCtx = parsePrUrl(opts.githubPrUrl, config.githubToken);
    }

    if (!prCtx) {
      console.error(
        'Warning: --post-to-github specified but could not determine PR context.\n' +
          'Set GITHUB_TOKEN and ensure GITHUB_REPOSITORY + GITHUB_REF are set (GitHub Actions), or use --github-pr-url.',
      );
    } else {
      const commentBody = formatPrComment(
        reviewText,
        config.provider,
        config.model,
        config.profile,
        counts,
      );
      try {
        const commentUrl = await postPrComment(prCtx, commentBody);
        console.error(`[info] Review posted to GitHub PR: ${commentUrl}`);
      } catch (err: any) {
        console.error(`Warning: Failed to post GitHub comment: ${err?.message ?? err}`);
      }
    }
  }

  // ─── Exit code ────────────────────────────────────────────────────────────

  if (shouldFail(counts, config.failOnSeverity)) {
    const threshold = config.failOnSeverity;
    console.error(
      `\n[FAIL] Review found findings at or above the "${threshold}" threshold.\n` +
        `  Critical: ${counts.critical}, High: ${counts.high}, Medium: ${counts.medium}, Low: ${counts.low}`,
    );
    process.exit(1);
  }

  process.exit(0);
}

function runGitCommand(cmd: string): string {
  try {
    return childProcess.execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err: any) {
    return err?.stdout ?? '';
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(2);
});
