import {
	type ReviewFinding,
	type Severity,
	parseReviewIntoFindings,
} from '../github/commentMapper';
import {
	STRUCTURED_REVIEW_SCHEMA_VERSION,
	type AnchorValidationResult,
	type AnchorValidationStatus,
	type DiffAnchorIndex,
	type DiffFileAnchors,
	type ReviewAnchor,
	type ReviewEvidenceItem,
	type ReviewFixSuggestion,
	type StructuredReviewFinding,
	type StructuredReviewResult,
	type ValidatedStructuredReviewFinding,
	type ValidatedStructuredReviewResult,
} from './types';

interface DiffFileHeaderState {
	oldFile?: string;
	newFile?: string;
}

export function buildDiffAnchorIndex(diff: string): DiffAnchorIndex {
	const files = new Map<string, DiffFileAnchors>();
	const deletedFiles = new Set<string>();
	const lines = diff.split('\n');
	const headerState: DiffFileHeaderState = {};
	let currentFile: string | undefined;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		if (line.startsWith('diff --git ')) {
			headerState.oldFile = undefined;
			headerState.newFile = undefined;
			currentFile = undefined;

			const diffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
			if (diffMatch) {
				headerState.oldFile = diffMatch[1];
				headerState.newFile = diffMatch[2];
			}
			continue;
		}

		if (line.startsWith('--- ')) {
			headerState.oldFile = parseDiffPath(line.slice(4)) ?? headerState.oldFile;
			continue;
		}

		if (line.startsWith('+++ ')) {
			headerState.newFile = parseDiffPath(line.slice(4)) ?? undefined;
			if (!headerState.newFile && headerState.oldFile) {
				deletedFiles.add(headerState.oldFile);
				currentFile = undefined;
				continue;
			}

			currentFile = headerState.newFile ?? headerState.oldFile;
			if (currentFile && !files.has(currentFile)) {
				files.set(currentFile, { file: currentFile, addedLines: new Set<number>() });
			}
			continue;
		}

		const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
		if (!hunkMatch || !currentFile) {
			continue;
		}

		const fileEntry = files.get(currentFile);
		if (!fileEntry) {
			continue;
		}

		let newLineNumber = parseInt(hunkMatch[1], 10);

		for (i = i + 1; i < lines.length; i++) {
			const hunkLine = lines[i];
			if (
				hunkLine.startsWith('@@') ||
				hunkLine.startsWith('diff ') ||
				hunkLine.startsWith('+++ ') ||
				hunkLine.startsWith('--- ')
			) {
				i--;
				break;
			}

			if (hunkLine.startsWith('+') && !hunkLine.startsWith('+++')) {
				fileEntry.addedLines.add(newLineNumber);
				newLineNumber++;
				continue;
			}

			if (hunkLine.startsWith('-') && !hunkLine.startsWith('---')) {
				continue;
			}

			newLineNumber++;
		}
	}

	return { files, deletedFiles };
}

export function validateReviewAnchor(anchor: ReviewAnchor | undefined, diffIndex: DiffAnchorIndex): AnchorValidationResult {
	if (!anchor) {
		return { status: 'missing', reason: 'No anchor was provided for this finding.' };
	}

	const file = normalizeFilePath(anchor.file);
	if (!file) {
		return { status: 'missing', reason: 'The anchor did not include a usable file path.' };
	}

	if (!Number.isInteger(anchor.line) || anchor.line < 1) {
		return {
			status: 'invalid-line',
			reason: `Anchor line must be a positive integer. Received: ${String(anchor.line)}`,
		};
	}

	const resolved = resolveDiffFile(file, diffIndex.files);
	if (!resolved) {
		if (diffIndex.deletedFiles.has(file)) {
			return {
				status: 'deleted-file',
				reason: `The anchor points to deleted file "${file}".`,
			};
		}

		return {
			status: 'unknown-file',
			reason: `The anchor file "${file}" does not exist in the current diff.`,
		};
	}

	if (anchor.endLine !== undefined) {
		if (!Number.isInteger(anchor.endLine) || anchor.endLine < anchor.line) {
			return {
				status: 'invalid-line',
				reason: `Anchor end line must be an integer greater than or equal to ${anchor.line}.`,
			};
		}
	}

	const endLine = anchor.endLine ?? anchor.line;
	for (let line = anchor.line; line <= endLine; line++) {
		if (!resolved.addedLines.has(line)) {
			return {
				status: 'not-added-line',
				reason: `Line ${line} in "${resolved.file}" is not an added line in the current diff.`,
			};
		}
	}

	return {
		status: 'valid',
		normalizedAnchor: {
			file: resolved.file,
			line: anchor.line,
			endLine: anchor.endLine,
		},
	};
}

export function normalizeReviewResult(reviewContent: string, diff: string): ValidatedStructuredReviewResult {
	const structured = parseStructuredReview(reviewContent);
	const rawResult = structured ?? createLegacyStructuredReview(reviewContent, diff);
	return validateStructuredReviewResult(rawResult, diff);
}

export function renderValidatedReviewMarkdown(result: ValidatedStructuredReviewResult): string {
	if (result.findings.length === 0) {
		return result.summary.trim() || 'I have reviewed the changes and found no significant issues.';
	}

	const sections: string[] = [];
	sections.push('## Review Summary');
	sections.push(result.summary.trim() || `${result.findings.length} finding(s) detected.`);

	for (const finding of result.findings) {
		sections.push(renderFindingMarkdown(finding));
	}

	return sections.join('\n\n');
}

export function toLegacyReviewFinding(finding: ValidatedStructuredReviewFinding): ReviewFinding {
	const anchor = finding.anchorValidation.status === 'valid'
		? finding.anchorValidation.normalizedAnchor
		: undefined;

	return {
		severity: finding.severity,
		message: formatFindingMessage(finding),
		file: anchor?.file,
		line: anchor?.line,
		suggestion: finding.fix?.replacement ?? finding.fix?.patch,
	};
}

function validateStructuredReviewResult(result: StructuredReviewResult, diff: string): ValidatedStructuredReviewResult {
	const diffIndex = buildDiffAnchorIndex(diff);
	return {
		schemaVersion: result.schemaVersion,
		summary: result.summary,
		findings: result.findings.map((finding) => ({
			...finding,
			anchorValidation: validateReviewAnchor(finding.anchor, diffIndex),
		})),
	};
}

function parseStructuredReview(reviewContent: string): StructuredReviewResult | null {
	const candidate = extractJsonCandidate(reviewContent);
	if (!candidate) {
		return null;
	}

	try {
		const parsed = JSON.parse(candidate) as unknown;
		if (!isRecord(parsed)) {
			return null;
		}

		const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
		const findingsInput = Array.isArray(parsed.findings) ? parsed.findings : [];
		const findings = findingsInput
			.map((finding, index) => normalizeStructuredFinding(finding, index))
			.filter((finding): finding is StructuredReviewFinding => finding !== null);

		return {
			schemaVersion: STRUCTURED_REVIEW_SCHEMA_VERSION,
			summary: summary || 'Structured review result',
			findings,
		};
	} catch {
		return null;
	}
}

function createLegacyStructuredReview(reviewContent: string, diff: string): StructuredReviewResult {
	const findings = parseReviewIntoFindings(reviewContent, diff)
		.map((finding, index) => legacyFindingToStructured(finding, index));

	return {
		schemaVersion: STRUCTURED_REVIEW_SCHEMA_VERSION,
		summary: summarizeLegacyReview(reviewContent, findings.length),
		findings,
	};
}

function legacyFindingToStructured(finding: ReviewFinding, index: number): StructuredReviewFinding {
	const title = summarizeMessage(finding.message);
	const fix = finding.suggestion
		? { summary: 'Legacy parser extracted a suggested fix.', replacement: finding.suggestion }
		: undefined;

	return {
		id: `legacy-${index + 1}`,
		severity: finding.severity,
		title,
		summary: finding.message.trim(),
		confidence: 0.5,
		anchor: finding.file && finding.line ? { file: finding.file, line: finding.line } : undefined,
		evidence: [{
			kind: 'diff',
			summary: finding.file
				? `Legacy parser matched this finding to ${finding.file}${finding.line ? `:${finding.line}` : ''}.`
				: 'Legacy parser could not determine a concrete file anchor.',
			anchor: finding.file && finding.line ? { file: finding.file, line: finding.line } : undefined,
		}],
		fix,
	};
}

function normalizeStructuredFinding(input: unknown, index: number): StructuredReviewFinding | null {
	if (!isRecord(input)) {
		return null;
	}

	const summary = stringOrUndefined(input.summary)?.trim();
	if (!summary) {
		return null;
	}

	const title = stringOrUndefined(input.title)?.trim() || summarizeMessage(summary);
	const severity = normalizeSeverity(input.severity);
	const confidence = normalizeConfidence(input.confidence);
	const anchor = normalizeAnchor(input.anchor);
	const evidence = normalizeEvidence(input.evidence, summary, anchor);
	const fix = normalizeFix(input.fix);

	return {
		id: stringOrUndefined(input.id)?.trim() || `finding-${index + 1}`,
		severity,
		title,
		summary,
		confidence,
		category: stringOrUndefined(input.category)?.trim(),
		anchor,
		evidence,
		fix,
	};
}

function normalizeEvidence(input: unknown, fallbackSummary: string, anchor: ReviewAnchor | undefined): ReviewEvidenceItem[] {
	if (!Array.isArray(input)) {
		return [{ kind: 'diff', summary: fallbackSummary, anchor }];
	}

	const evidence = input
		.map((item) => normalizeEvidenceItem(item))
		.filter((item): item is ReviewEvidenceItem => item !== null);

	return evidence.length > 0 ? evidence : [{ kind: 'diff', summary: fallbackSummary, anchor }];
}

function normalizeEvidenceItem(input: unknown): ReviewEvidenceItem | null {
	if (!isRecord(input)) {
		return null;
	}

	const summary = stringOrUndefined(input.summary)?.trim();
	if (!summary) {
		return null;
	}

	return {
		kind: normalizeEvidenceKind(input.kind),
		summary,
		anchor: normalizeAnchor(input.anchor),
		quote: stringOrUndefined(input.quote)?.trim(),
	};
}

function normalizeFix(input: unknown): ReviewFixSuggestion | undefined {
	if (!isRecord(input)) {
		return undefined;
	}

	const summary = stringOrUndefined(input.summary)?.trim();
	const replacement = stringOrUndefined(input.replacement);
	const patch = stringOrUndefined(input.patch);

	if (!summary && !replacement && !patch) {
		return undefined;
	}

	return {
		summary: summary || 'Suggested fix',
		replacement: replacement?.trim(),
		patch: patch?.trim(),
	};
}

function normalizeAnchor(input: unknown): ReviewAnchor | undefined {
	if (!isRecord(input)) {
		return undefined;
	}

	const file = normalizeFilePath(stringOrUndefined(input.file));
	const line = numberOrUndefined(input.line);
	const endLine = numberOrUndefined(input.endLine);

	if (!file || line === undefined) {
		return undefined;
	}

	return {
		file,
		line,
		endLine,
	};
}

function resolveDiffFile(file: string, files: Map<string, DiffFileAnchors>): DiffFileAnchors | undefined {
	if (files.has(file)) {
		return files.get(file);
	}

	for (const [knownFile, fileAnchors] of files.entries()) {
		if (knownFile.endsWith('/' + file) || knownFile === file) {
			return fileAnchors;
		}
	}

	return undefined;
}

function parseDiffPath(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed || trimmed === '/dev/null') {
		return null;
	}
	return normalizeFilePath(trimmed.replace(/^[ab]\//, '')) ?? null;
}

function normalizeSeverity(value: unknown): Severity {
	if (typeof value !== 'string') {
		return 'info';
	}

	switch (value.toLowerCase()) {
		case 'critical':
		case 'high':
		case 'medium':
		case 'low':
		case 'info':
			return value.toLowerCase() as Severity;
		default:
			return 'info';
	}
}

function normalizeEvidenceKind(value: unknown): ReviewEvidenceItem['kind'] {
	if (typeof value !== 'string') {
		return 'diff';
	}

	switch (value.toLowerCase()) {
		case 'diff':
		case 'code':
		case 'rule':
		case 'context':
		case 'test':
			return value.toLowerCase() as ReviewEvidenceItem['kind'];
		default:
			return 'diff';
	}
}

function normalizeConfidence(value: unknown): number {
	if (typeof value !== 'number' || Number.isNaN(value)) {
		return 0.5;
	}

	if (value < 0) {
		return 0;
	}

	if (value > 1) {
		return 1;
	}

	return value;
}

function extractJsonCandidate(reviewContent: string): string | null {
	const trimmed = reviewContent.trim();
	if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
		return trimmed;
	}

	const fencedMatch = reviewContent.match(/```json\s*([\s\S]*?)```/i);
	if (fencedMatch) {
		return fencedMatch[1].trim();
	}

	return null;
}

function formatFindingMessage(finding: ValidatedStructuredReviewFinding): string {
	const parts = [`**${finding.title}**`, finding.summary];
	if (finding.evidence.length > 0) {
		parts.push(`Evidence: ${finding.evidence.map((item) => item.summary).join(' ')}`);
	}
	if (finding.anchorValidation.status !== 'valid' && finding.anchorValidation.reason) {
		parts.push(`Anchor validation: ${finding.anchorValidation.reason}`);
	}
	return parts.filter(Boolean).join('\n\n');
}

function summarizeLegacyReview(reviewContent: string, findingCount: number): string {
	const trimmed = reviewContent.trim();
	if (!trimmed) {
		return 'No review summary was generated.';
	}

	if (findingCount <= 1) {
		return summarizeMessage(trimmed);
	}

	return `${findingCount} findings extracted from legacy markdown review output.`;
}

function summarizeMessage(message: string): string {
	const firstLine = message
		.split('\n')
		.map((line) => line.trim())
		.find(Boolean) ?? 'Review finding';

	return firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
}

function renderFindingMarkdown(finding: ValidatedStructuredReviewFinding): string {
	const lines: string[] = [];
	lines.push(`### ${finding.title}`);
	lines.push(`- **Severity:** ${finding.severity}`);
	lines.push(`- **Confidence:** ${finding.confidence.toFixed(2)}`);
	if (finding.category) {
		lines.push(`- **Category:** ${finding.category}`);
	}

	if (finding.anchorValidation.status === 'valid' && finding.anchorValidation.normalizedAnchor) {
		const anchor = finding.anchorValidation.normalizedAnchor;
		const lineRange = anchor.endLine && anchor.endLine !== anchor.line
			? `${anchor.line}-${anchor.endLine}`
			: `${anchor.line}`;
		lines.push(`- **File:** \`${anchor.file}:${lineRange}\``);
	} else if (finding.anchorValidation.reason) {
		lines.push(`- **Anchor:** ${finding.anchorValidation.status} (${finding.anchorValidation.reason})`);
	}

	lines.push('');
	lines.push(finding.summary);

	if (finding.evidence.length > 0) {
		lines.push('');
		lines.push('**Evidence**');
		for (const evidence of finding.evidence) {
			const evidenceAnchor = evidence.anchor
				? ` (\`${evidence.anchor.file}:${evidence.anchor.line}\`)`
				: '';
			lines.push(`- ${evidence.kind}: ${evidence.summary}${evidenceAnchor}`);
			if (evidence.quote) {
				lines.push(`  Quote: "${evidence.quote}"`);
			}
		}
	}

	if (finding.fix) {
		lines.push('');
		lines.push('**Suggested Fix**');
		lines.push(finding.fix.summary);
		if (finding.fix.replacement) {
			lines.push('```');
			lines.push(finding.fix.replacement);
			lines.push('```');
		} else if (finding.fix.patch) {
			lines.push('```diff');
			lines.push(finding.fix.patch);
			lines.push('```');
		}
	}

	return lines.join('\n');
}

function normalizeFilePath(file: string | undefined): string | undefined {
	if (!file) {
		return undefined;
	}

	const normalized = file.trim().replace(/\\/g, '/').replace(/^\.\//, '');
	return normalized || undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
	return typeof value === 'number' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
