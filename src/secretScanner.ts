import type { ReviewFinding } from './github/commentMapper';
import type { ValidatedStructuredReviewFinding } from './reviewFindings/types';

/**
 * Enhanced interface for secrets found during the scan.
 */
export interface SecretFinding extends ReviewFinding {
	severity: 'critical';
	file: string;
	line: number;
}

/**
 * A regex-based definition of a secret pattern to scan for.
 */
interface SecretPattern {
	name: string;
	suggestion: string;
	regex?: RegExp;
	match?: (line: string) => string[];
}

const MAX_SCAN_LINE_LENGTH = 5000;
const MAX_VALUE_SCAN_LENGTH = 256;

const TOKEN_KEYWORD_REGEX = /\b(?:api_?key|api_?token|auth_?token|access_?token|secret)\b/gi;
const PASSWORD_KEYWORD_REGEX = /\b(?:password|passwd|pwd)\b/gi;
const ASSIGNMENT_PREFIX_REGEX = /^\s*(?::=|=>|:|=)\s*/;
const TOKEN_VALUE_REGEX = /^["']?([A-Za-z0-9_=-]{16,})["']?/i;
const PASSWORD_VALUE_REGEX = /^["']?([^\s"']{8,})["']?/i;

function matchKeywordAssignment(
	line: string,
	keyword: RegExp,
	valueRegex: RegExp,
	options?: { ignoreValuePrefixes?: string[] },
): string[] {
	const results: string[] = [];
	keyword.lastIndex = 0;

	let match: RegExpExecArray | null;
	while ((match = keyword.exec(line)) !== null) {
		const remainder = line.slice(keyword.lastIndex);
		const assignmentMatch = remainder.match(ASSIGNMENT_PREFIX_REGEX);
		if (!assignmentMatch) {
			continue;
		}

		const rawValue = remainder.slice(assignmentMatch[0].length, assignmentMatch[0].length + MAX_VALUE_SCAN_LENGTH);
		const trimmed = rawValue.trimStart();
		const dequoted = trimmed.startsWith('"') || trimmed.startsWith("'")
			? trimmed.slice(1)
			: trimmed;

		if (options?.ignoreValuePrefixes) {
			const lower = dequoted.toLowerCase();
			if (options.ignoreValuePrefixes.some((prefix) => lower.startsWith(prefix))) {
				continue;
			}
		}

		const valueMatch = trimmed.match(valueRegex);
		if (valueMatch?.[1]) {
			results.push(valueMatch[1]);
		}
	}

	return results;
}

/**
 * Common patterns for hardcoded secrets.
 * These act as a quick, deterministic, zero-latency safety net before AI review.
 */
const SECRET_PATTERNS: SecretPattern[] = [
	{
		name: 'AWS Access Key ID',
		regex: /\b(AKIA[0-9A-Z]{16})\b/g,
		suggestion: 'Remove hardcoded AWS Access Key. Use environment variables (e.g., `process.env.AWS_ACCESS_KEY_ID`), AWS Secrets Manager, or IAM Roles instead.',
	},
	{
		name: 'AWS Secret Access Key',
		regex: /\b(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])\b/g,
		suggestion: 'Potential AWS Secret Access Key detected. Move this to a secure vault or environment variable.',
	},
	{
		name: 'Generic API Key / Token',
		// Avoid multi-token backtracking by parsing in two steps:
		// 1) find the keyword, 2) parse an assignment value from the remainder.
		match: (line) => matchKeywordAssignment(line, TOKEN_KEYWORD_REGEX, TOKEN_VALUE_REGEX),
		suggestion: 'Hardcoded API key or token found. Use environment config instead of committing credentials.',
	},
	{
		name: 'Stripe Secret Key',
		regex: /\b(sk_(?:live|test)_[0-9a-zA-Z]{24,34})\b/g,
		suggestion: 'Stripe secret key detected. Use `process.env.STRIPE_SECRET_KEY` and do not commit this to version control.',
	},
	{
		name: 'GitHub Personal Access Token',
		regex: /\b(gh[pousr]_[A-Za-z0-9_]{36})\b/g,
		suggestion: 'GitHub Token found. Please revoke it immediately at https://github.com/settings/tokens and use environment variables.',
	},
	{
		name: 'Slack OAuth v2 Token',
		regex: /\b(xox[baprs]-[0-9]{12,}-[0-9]{12,}-[a-zA-Z0-9]{24})\b/g,
		suggestion: 'Slack Token found. Please revoke and use environment variables.',
	},
	{
		name: 'Slack Webhook',
		regex: /(https:\/\/hooks\.slack\.com\/services\/T[a-zA-Z0-9_]{8,}\/B[a-zA-Z0-9_]{8,}\/[a-zA-Z0-9_]{24})/g,
		suggestion: 'Slack Webhook URL found. Move this URL to environment variables or secret management.',
	},
	{
		name: 'RSA Private Key',
		regex: /-----BEGIN (?:RSA|OPENSSH) PRIVATE KEY-----/g,
		suggestion: 'Private key found in code. Never commit private keys. Use a key management service.',
	},
	{
		name: 'Generic Password Assignment',
		match: (line) => matchKeywordAssignment(line, PASSWORD_KEYWORD_REGEX, PASSWORD_VALUE_REGEX, {
			ignoreValuePrefixes: ['process.env', 'env.', 'config.'],
		}),
		suggestion: 'Hardcoded password detected. Use environment variables for passwords instead of hardcoding.',
	}
];

/**
 * Scans a unified git diff for added lines containing common secrets.
 *
 * @param diff The staged git diff string.
 * @returns Array of critical findings for any secrets found.
 */
export function scanDiffForSecrets(diff: string): SecretFinding[] {
	const findings: SecretFinding[] = [];
	let currentFile: string | null = null;
	let newLineNum: number | null = null;

	const allLines = diff.split('\n');

	for (let i = 0; i < allLines.length; i++) {
		const line = allLines[i];

		// Match +++ b/path/to/file
		const fileMatch = line.match(/^\+\+\+\s+b\/(.+)$/);
		if (fileMatch) {
			currentFile = fileMatch[1];
			// Only search for secrets in non-deleted files / non-binary files
			continue;
		}

		// Match @@ -a,b +c,d @@ context
		const hunkMatch = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
		if (hunkMatch) {
			newLineNum = parseInt(hunkMatch[1], 10);
			continue;
		}

		// Track line numbers and look for secrets in added lines
		if (currentFile && newLineNum !== null) {
			if (line.startsWith('+') && !line.startsWith('+++')) { // Added line
				// Strip the leading '+' for regex testing
				const rawCodeLine = line.substring(1);
				const codeLine = rawCodeLine.length > MAX_SCAN_LINE_LENGTH
					? rawCodeLine.slice(0, MAX_SCAN_LINE_LENGTH)
					: rawCodeLine;

				// Test all patterns
				for (const pattern of SECRET_PATTERNS) {
					if (pattern.match) {
						const values = pattern.match(codeLine);
						for (const secretValue of values) {
							const masked = secretValue.length > 8
								? secretValue.substring(0, 4) + '**********' + secretValue.substring(secretValue.length - 4)
								: '********';

							findings.push({
								severity: 'critical',
								message: `**Secret Scanner:** Detected ${pattern.name} \`${masked}\`.`,
								file: currentFile,
								line: newLineNum,
								suggestion: pattern.suggestion
							});
						}
						continue;
					}

					if (!pattern.regex) {
						continue;
					}

					// Reset regex lastIndex because it's global
					pattern.regex.lastIndex = 0;

					const matches = [...codeLine.matchAll(pattern.regex)];
					for (const match of matches) {
						// The actual secret value is ideally in a capture group or the full match
						const secretValue = match[1] || match[0];
							
						// Mask the secret for the UI output (e.g., AKIA***)
						const masked = secretValue.length > 8
							? secretValue.substring(0, 4) + '**********' + secretValue.substring(secretValue.length - 4)
							: '********';

						findings.push({
							severity: 'critical',
							message: `**Secret Scanner:** Detected ${pattern.name} \`${masked}\`.`,
							file: currentFile,
							line: newLineNum,
							suggestion: pattern.suggestion
						});
					}
				}
				newLineNum++;
			} else if (line.startsWith(' ') || line === '') {
				newLineNum++;
			} // We ignore deleted lines ('-')
		}
	}

	return findings;
}

export function toStructuredFindings(secrets: SecretFinding[]): ValidatedStructuredReviewFinding[] {
	return secrets.map((secret, index) => ({
		id: `secret-${index}`,
		severity: secret.severity,
		title: 'Hardcoded Secret Detected',
		summary: secret.message,
		confidence: 1, // Deterministic
		category: 'Security',
		anchor: { file: secret.file, line: secret.line },
		evidence: [{
			kind: 'diff',
			summary: 'Found secret matching regex pattern in diff addition.',
		}],
		fix: secret.suggestion ? { summary: secret.suggestion } : undefined,
		anchorValidation: {
			status: 'valid',
			normalizedAnchor: { file: secret.file, line: secret.line },
		},
	}));
}
