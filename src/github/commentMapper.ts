/**
 * Maps AI review output into structured review findings that can be
 * posted as GitHub PR comments (summary or inline).
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ReviewFinding {
	severity: Severity;
	message: string;
	file?: string;
	line?: number;
	suggestion?: string;
}

/**
 * Parse a unified diff to extract the set of files and their changed line ranges.
 * Returns a map from file path to an array of added-line numbers.
 */
export function parseDiffFileLines(diff: string): Map<string, number[]> {
	const fileLines = new Map<string, number[]>();
	let currentFile: string | null = null;

	for (const line of diff.split('\n')) {
		// Match +++ b/path/to/file
		const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
		if (fileMatch) {
			currentFile = fileMatch[1];
			if (!fileLines.has(currentFile)) {
				fileLines.set(currentFile, []);
			}
			continue;
		}

		// Match @@ -a,b +c,d @@ context
		const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
		if (hunkMatch && currentFile) {
			// Track current position in the new file
			let newLineNum = parseInt(hunkMatch[1], 10);
			const lines = fileLines.get(currentFile)!;

			// Continue scanning the hunk lines
			const idx = diff.split('\n').indexOf(line);
			const allLines = diff.split('\n');
			for (let i = idx + 1; i < allLines.length; i++) {
				const hunkLine = allLines[i];
				if (hunkLine.startsWith('@@') || hunkLine.startsWith('diff ') || hunkLine.startsWith('+++ ') || hunkLine.startsWith('--- ')) {
					break;
				}
				if (hunkLine.startsWith('+')) {
					lines.push(newLineNum);
					newLineNum++;
				} else if (hunkLine.startsWith('-')) {
					// Deleted line, don't increment new line counter
				} else {
					// Context line
					newLineNum++;
				}
			}
		}
	}

	return fileLines;
}

/**
 * Parse the AI review markdown output into structured findings.
 *
 * This uses heuristics to detect file references and severity levels from
 * the markdown review text. It handles common patterns like:
 * - File references: `file.ts`, `src/path/file.ts:123`
 * - Severity indicators: "critical", "high", "medium", "low"
 * - Numbered findings with headings
 */
export function parseReviewIntoFindings(reviewMarkdown: string, diff: string): ReviewFinding[] {
	const findings: ReviewFinding[] = [];
	const diffFileLines = parseDiffFileLines(diff);
	const knownFiles = new Set(diffFileLines.keys());

	// Split review into sections by headings or numbered items
	const sections = splitIntoSections(reviewMarkdown);

	for (const section of sections) {
		const severity = detectSeverity(section);
		const fileRef = detectFileReference(section, knownFiles);
		const suggestion = extractSuggestion(section);

		// Clean up the message: remove markdown heading prefixes
		let message = section.trim();
		message = message.replace(/^#{1,4}\s*\d*\.?\s*/, '');

		if (message.length > 0) {
			findings.push({
				severity,
				message: message.trim(),
				file: fileRef?.file,
				line: fileRef?.line,
				suggestion: suggestion || undefined
			});
		}
	}

	return findings;
}

/**
 * Split review markdown into logical sections (each represents one finding).
 */
function splitIntoSections(markdown: string): string[] {
	const sections: string[] = [];
	const lines = markdown.split('\n');
	let currentSection: string[] = [];

	for (const line of lines) {
		// Start a new section on headings or numbered list items
		const isNewSection =
			/^#{1,4}\s+\d+\.?\s/.test(line) ||  // ### 1. Finding
			/^#{1,4}\s+\*\*/.test(line) ||         // ### **Finding**
			/^\d+\.\s+\*\*/.test(line) ||           // 1. **Finding**
			/^-\s+\*\*(?:Critical|High|Medium|Low|Bug|Security|Performance|Issue)/i.test(line); // - **Critical:**

		if (isNewSection && currentSection.length > 0) {
			sections.push(currentSection.join('\n'));
			currentSection = [];
		}
		currentSection.push(line);
	}

	if (currentSection.length > 0) {
		const text = currentSection.join('\n').trim();
		if (text) {
			sections.push(text);
		}
	}

	// If we only got one big section, the review may not have clear structure.
	// In that case, treat the whole thing as one finding.
	return sections.length > 0 ? sections : [markdown];
}

/**
 * Detect severity level from the text of a finding.
 */
function detectSeverity(text: string): Severity {
	const lower = text.toLowerCase();

	if (/\b(critical|vulnerability|injection|xss|csrf|rce)\b/.test(lower)) {
		return 'critical';
	}
	if (/\b(high|severe|bug|error|crash|security)\b/.test(lower)) {
		return 'high';
	}
	if (/\b(medium|moderate|warning|performance|inefficient)\b/.test(lower)) {
		return 'medium';
	}
	if (/\b(low|minor|nitpick|style|naming|readability)\b/.test(lower)) {
		return 'low';
	}

	return 'info';
}

/**
 * Detect a file path and optional line number from the finding text.
 * Matches patterns like:
 *   - `src/foo.ts:42`
 *   - **File:** `bar.ts`
 *   - In `baz/qux.js`, line 10
 */
function detectFileReference(text: string, knownFiles: Set<string>): { file: string; line?: number } | null {
	// Pattern: `path/file.ext:lineNumber`
	const backtickWithLine = text.match(/`([^`]+\.[a-zA-Z]{1,5}):(\d+)`/);
	if (backtickWithLine) {
		const file = backtickWithLine[1];
		const line = parseInt(backtickWithLine[2], 10);
		const resolved = resolveFile(file, knownFiles);
		if (resolved) {
			return { file: resolved, line };
		}
	}

	// Pattern: `path/file.ext` followed by "line X"
	const backtickFile = text.match(/`([^`]+\.[a-zA-Z]{1,5})`/);
	const lineRef = text.match(/line\s+(\d+)/i);
	if (backtickFile) {
		const resolved = resolveFile(backtickFile[1], knownFiles);
		if (resolved) {
			return { file: resolved, line: lineRef ? parseInt(lineRef[1], 10) : undefined };
		}
	}

	// Pattern: bare file references like **src/foo.ts**
	const boldFile = text.match(/\*\*([^\*]+\.[a-zA-Z]{1,5})\*\*/);
	if (boldFile) {
		const resolved = resolveFile(boldFile[1], knownFiles);
		if (resolved) {
			return { file: resolved, line: lineRef ? parseInt(lineRef[1], 10) : undefined };
		}
	}

	return null;
}

/**
 * Check if a file reference (possibly a basename) exists in the known files.
 */
function fileExistsInKnown(file: string, knownFiles: Set<string>): boolean {
	if (knownFiles.has(file)) { return true; }
	for (const known of knownFiles) {
		if (known.endsWith('/' + file) || known === file) { return true; }
	}
	return false;
}

/**
 * Resolve a file reference to its full path in the known files set.
 */
function resolveFile(file: string, knownFiles: Set<string>): string | null {
	if (knownFiles.has(file)) { return file; }
	for (const known of knownFiles) {
		if (known.endsWith('/' + file) || known === file) { return known; }
	}
	return null;
}

/**
 * Extract a code suggestion from a finding (code block after suggestion-like text).
 */
function extractSuggestion(text: string): string | null {
	// Look for code blocks that follow suggestion keywords
	const suggestionPattern = /(?:suggest|recommend|instead|replace|change|fix|should be|could be|try)[^\n]*\n```[\w]*\n([\s\S]*?)```/i;
	const match = text.match(suggestionPattern);
	return match ? match[1].trim() : null;
}

/**
 * Format a ReviewFinding as a GitHub PR review comment body.
 */
export function formatFindingAsComment(finding: ReviewFinding): string {
	const severityEmoji: Record<Severity, string> = {
		critical: '🔴',
		high: '🟠',
		medium: '🟡',
		low: '🔵',
		info: 'ℹ️'
	};

	const emoji = severityEmoji[finding.severity];
	let body = `${emoji} **${finding.severity.charAt(0).toUpperCase() + finding.severity.slice(1)}**\n\n${finding.message}`;

	if (finding.suggestion) {
		body += `\n\n\`\`\`suggestion\n${finding.suggestion}\n\`\`\``;
	}

	return body;
}

/**
 * Format all findings as a summary comment for the PR.
 */
export function formatFindingsAsSummary(findings: ReviewFinding[], model: string): string {
	if (findings.length === 0) {
		return '✅ **AI Code Review** — No significant issues found.\n\n' +
			`> Reviewed by [Ollama Code Review](https://github.com/glorynguyen/ollama-code-review) using \`${model}\``;
	}

	const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
	for (const f of findings) {
		counts[f.severity]++;
	}

	let summary = '## 🔍 AI Code Review Summary\n\n';
	summary += '| Severity | Count |\n|----------|-------|\n';
	if (counts.critical) { summary += `| 🔴 Critical | ${counts.critical} |\n`; }
	if (counts.high) { summary += `| 🟠 High | ${counts.high} |\n`; }
	if (counts.medium) { summary += `| 🟡 Medium | ${counts.medium} |\n`; }
	if (counts.low) { summary += `| 🔵 Low | ${counts.low} |\n`; }
	if (counts.info) { summary += `| ℹ️ Info | ${counts.info} |\n`; }

	summary += `\n> Reviewed by [Ollama Code Review](https://github.com/glorynguyen/ollama-code-review) using \`${model}\`\n`;

	return summary;
}
