/**
 * F-010: CI/CD Integration — Output formatters and severity checking
 */

import { CliConfig } from './config';

export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

const SEVERITY_PATTERNS: Record<keyof SeverityCounts, RegExp[]> = {
  critical: [
    /\bcritical\b/gi,
    /severity[:\s]+critical/gi,
    /\[CRITICAL\]/gi,
    /## critical/gi,
  ],
  high: [
    /\bhigh\b/gi,
    /severity[:\s]+high/gi,
    /\[HIGH\]/gi,
    /## high/gi,
  ],
  medium: [
    /\bmedium\b/gi,
    /severity[:\s]+medium/gi,
    /\[MEDIUM\]/gi,
    /## medium/gi,
  ],
  low: [
    /\blow\b/gi,
    /severity[:\s]+low/gi,
    /\[LOW\]/gi,
    /## low/gi,
    /## suggestion/gi,
  ],
};

/** Parse severity finding counts from a review Markdown text. */
export function parseSeverityCounts(reviewText: string): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const [severity, patterns] of Object.entries(SEVERITY_PATTERNS)) {
    let count = 0;
    for (const pattern of patterns) {
      const matches = reviewText.match(pattern);
      count += matches?.length ?? 0;
    }
    (counts as Record<string, number>)[severity] = Math.min(count, 50);
  }
  return counts;
}

/** Determine exit code based on severity threshold. Returns 1 if threshold is met, 0 otherwise. */
export function shouldFail(counts: SeverityCounts, threshold: CliConfig['failOnSeverity']): boolean {
  if (threshold === 'none') {
    return false;
  }
  switch (threshold) {
    case 'critical':
      return counts.critical > 0;
    case 'high':
      return counts.critical > 0 || counts.high > 0;
    case 'medium':
      return counts.critical > 0 || counts.high > 0 || counts.medium > 0;
    case 'low':
      return counts.critical > 0 || counts.high > 0 || counts.medium > 0 || counts.low > 0;
    default:
      return false;
  }
}

/** Format output based on the requested output format. */
export function formatOutput(
  reviewText: string,
  counts: SeverityCounts,
  config: CliConfig,
  diffSummary: string,
): string {
  switch (config.outputFormat) {
    case 'json':
      return JSON.stringify(
        {
          provider: config.provider,
          model: config.model,
          profile: config.profile,
          diffSummary,
          findingCounts: counts,
          score: computeScore(counts),
          review: reviewText,
        },
        null,
        2,
      );

    case 'markdown':
      return [
        `# Code Review Report`,
        ``,
        `**Provider:** ${config.provider} / **Model:** ${config.model} / **Profile:** ${config.profile}`,
        `**Diff:** ${diffSummary}`,
        `**Score:** ${computeScore(counts)}/100`,
        `**Findings:** 🔴 ${counts.critical} critical  🟠 ${counts.high} high  🟡 ${counts.medium} medium  🔵 ${counts.low} low`,
        ``,
        `---`,
        ``,
        reviewText,
      ].join('\n');

    case 'text':
    default:
      return [
        `=== Ollama Code Review ===`,
        `Provider: ${config.provider} | Model: ${config.model} | Profile: ${config.profile}`,
        `Score: ${computeScore(counts)}/100`,
        `Findings: ${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low`,
        ``,
        reviewText,
      ].join('\n');
  }
}

function computeScore(counts: SeverityCounts): number {
  const raw =
    100 - counts.critical * 20 - counts.high * 10 - counts.medium * 5 - counts.low * 2;
  return Math.max(0, Math.min(100, raw));
}
