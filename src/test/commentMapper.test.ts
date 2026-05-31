/**
 * Unit tests for src/github/commentMapper.ts
 *
 * Covers: parseDiffFileLines, parseReviewIntoFindings, formatFindingAsComment,
 * formatFindingsAsSummary
 */

import * as assert from 'assert';
import {
	parseDiffFileLines,
	parseReviewIntoFindings,
	formatFindingAsComment,
	formatFindingsAsSummary,
} from '../github/commentMapper';
import type { ReviewFinding } from '../github/commentMapper';

suite('Comment Mapper Test Suite', () => {

	// ─── parseDiffFileLines ──────────────────────────────────────────────────

	suite('parseDiffFileLines', () => {
		test('parses a simple diff with one file and one hunk', () => {
			const diff = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 unchanged
+added line
 unchanged
`;
			const result = parseDiffFileLines(diff);
			assert.ok(result instanceof Map);
			const lines = result.get('src/foo.ts');
			assert.ok(lines);
			assert.ok(lines.includes(2)); // Added at line 2 in new file
		});

		test('parses multiple files', () => {
			const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,3 @@
 x
+y
 z
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -5,3 +5,4 @@
 aaa
+bbb
 ccc
`;
			const result = parseDiffFileLines(diff);
			assert.ok(result.has('a.ts'));
			assert.ok(result.has('b.ts'));
		});

		test('tracks multiple added lines in a hunk', () => {
			const diff = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,2 +1,5 @@
 line1
+added1
+added2
+added3
 line2
`;
			const result = parseDiffFileLines(diff);
			const lines = result.get('foo.ts')!;
			assert.ok(lines.includes(2));
			assert.ok(lines.includes(3));
			assert.ok(lines.includes(4));
		});

		test('handles new file (--- /dev/null)', () => {
			const diff = `diff --git a/new.ts b/new.ts
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,3 @@
+line1
+line2
+line3
`;
			const result = parseDiffFileLines(diff);
			const lines = result.get('new.ts')!;
			assert.strictEqual(lines.length, 3);
			assert.ok(lines.includes(1));
			assert.ok(lines.includes(2));
			assert.ok(lines.includes(3));
		});

		test('returns empty map for empty input', () => {
			const result = parseDiffFileLines('');
			assert.strictEqual(result.size, 0);
		});

		test('handles multiple hunks in same file', () => {
			const diff = `diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1,3 +1,4 @@
 a
+b
 c
@@ -10,3 +11,4 @@
 d
+e
 f
`;
			const result = parseDiffFileLines(diff);
			const lines = result.get('x.ts')!;
			assert.ok(lines.includes(2));
			assert.ok(lines.includes(12));
		});
	});

	// ─── parseReviewIntoFindings ─────────────────────────────────────────────

	suite('parseReviewIntoFindings', () => {
		const sampleDiff = `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,4 @@
 const x = 1;
+const password = "hardcoded";
 export default x;
`;

		test('detects critical severity from keywords', () => {
			const review = '### 1. SQL Injection Vulnerability\n\nThe query is vulnerable to SQL injection attack in `src/auth.ts:2`';
			const findings = parseReviewIntoFindings(review, sampleDiff);
			assert.ok(findings.length > 0);
			const critical = findings.find(f => f.severity === 'critical');
			assert.ok(critical);
		});

		test('detects high severity from keywords', () => {
			const review = '### 1. Security Bug\n\nThere is a severe bug in the authentication logic';
			const findings = parseReviewIntoFindings(review, sampleDiff);
			const high = findings.find(f => f.severity === 'high');
			assert.ok(high);
		});

		test('detects medium severity from keywords', () => {
			const review = '### 1. Performance Warning\n\nThere is a moderate performance issue with this loop';
			const findings = parseReviewIntoFindings(review, sampleDiff);
			const medium = findings.find(f => f.severity === 'medium');
			assert.ok(medium);
		});

		test('detects low severity from keywords', () => {
			const review = '### 1. Minor Style Issue\n\nThis is a low-priority naming convention nitpick';
			const findings = parseReviewIntoFindings(review, sampleDiff);
			const low = findings.find(f => f.severity === 'low');
			assert.ok(low);
		});

		test('detects file reference in backtick format', () => {
			const review = '### 1. Issue\n\nCritical vulnerability in `src/auth.ts:2`';
			const findings = parseReviewIntoFindings(review, sampleDiff);
			const withFile = findings.find(f => f.file === 'src/auth.ts');
			assert.ok(withFile);
			assert.strictEqual(withFile!.line, 2);
		});

		test('detects file reference with separate line mention', () => {
			const review = '### 1. Issue\n\nHigh severity bug in `src/auth.ts`, line 2';
			const findings = parseReviewIntoFindings(review, sampleDiff);
			const withFile = findings.find(f => f.file === 'src/auth.ts');
			assert.ok(withFile);
			assert.strictEqual(withFile!.line, 2);
		});

		test('extracts code suggestion', () => {
			const review = '### 1. Fix Suggestion\n\nCritical issue. You should replace the hardcoded password.\n\nSuggest using environment variables instead:\n```typescript\nconst password = process.env.SECRET;\n```';
			const findings = parseReviewIntoFindings(review, sampleDiff);
			const withSuggestion = findings.find(f => f.suggestion);
			assert.ok(withSuggestion);
			assert.ok(withSuggestion!.suggestion!.includes('process.env.SECRET'));
		});

		test('handles review with numbered list items', () => {
			const review = '1. **Critical:** SQL injection in query builder\n2. **High:** Missing input validation';
			const findings = parseReviewIntoFindings(review, sampleDiff);
			assert.ok(findings.length >= 2);
		});

		test('returns findings for review without clear structure', () => {
			const review = 'The code has a critical vulnerability with injection attacks.';
			const findings = parseReviewIntoFindings(review, sampleDiff);
			assert.ok(findings.length >= 1);
		});

		test('handles empty review text', () => {
			const findings = parseReviewIntoFindings('', sampleDiff);
			assert.deepStrictEqual(findings, []);
		});
	});

	// ─── formatFindingAsComment ──────────────────────────────────────────────

	suite('formatFindingAsComment', () => {
		test('formats critical finding with red emoji', () => {
			const finding: ReviewFinding = { severity: 'critical', message: 'SQL injection' };
			const result = formatFindingAsComment(finding);
			assert.ok(result.includes('🔴'));
			assert.ok(result.includes('Critical'));
			assert.ok(result.includes('SQL injection'));
		});

		test('formats high finding with orange emoji', () => {
			const finding: ReviewFinding = { severity: 'high', message: 'Null deref' };
			const result = formatFindingAsComment(finding);
			assert.ok(result.includes('🟠'));
			assert.ok(result.includes('High'));
		});

		test('formats medium finding with yellow emoji', () => {
			const finding: ReviewFinding = { severity: 'medium', message: 'Perf issue' };
			const result = formatFindingAsComment(finding);
			assert.ok(result.includes('🟡'));
			assert.ok(result.includes('Medium'));
		});

		test('formats low finding with blue emoji', () => {
			const finding: ReviewFinding = { severity: 'low', message: 'Style nit' };
			const result = formatFindingAsComment(finding);
			assert.ok(result.includes('🔵'));
			assert.ok(result.includes('Low'));
		});

		test('formats info finding with info emoji', () => {
			const finding: ReviewFinding = { severity: 'info', message: 'Note' };
			const result = formatFindingAsComment(finding);
			assert.ok(result.includes('ℹ️'));
			assert.ok(result.includes('Info'));
		});

		test('includes suggestion as code block', () => {
			const finding: ReviewFinding = {
				severity: 'high',
				message: 'Use const instead',
				suggestion: 'const x = 1;',
			};
			const result = formatFindingAsComment(finding);
			assert.ok(result.includes('```suggestion'));
			assert.ok(result.includes('const x = 1;'));
		});

		test('does not include suggestion block when no suggestion', () => {
			const finding: ReviewFinding = { severity: 'low', message: 'Looks fine' };
			const result = formatFindingAsComment(finding);
			assert.ok(!result.includes('```suggestion'));
		});
	});

	// ─── formatFindingsAsSummary ─────────────────────────────────────────────

	suite('formatFindingsAsSummary', () => {
		test('returns "no issues" message for empty findings', () => {
			const result = formatFindingsAsSummary([], 'gpt-4');
			assert.ok(result.includes('No significant issues found'));
			assert.ok(result.includes('gpt-4'));
		});

		test('generates table with severity counts', () => {
			const findings: ReviewFinding[] = [
				{ severity: 'critical', message: 'a' },
				{ severity: 'critical', message: 'b' },
				{ severity: 'high', message: 'c' },
				{ severity: 'low', message: 'd' },
			];
			const result = formatFindingsAsSummary(findings, 'claude');
			assert.ok(result.includes('Critical'));
			assert.ok(result.includes('2')); // 2 critical
			assert.ok(result.includes('High'));
			assert.ok(result.includes('1')); // 1 high
			assert.ok(result.includes('Low'));
			assert.ok(result.includes('claude'));
		});

		test('only includes rows for non-zero severity counts', () => {
			const findings: ReviewFinding[] = [
				{ severity: 'medium', message: 'x' },
			];
			const result = formatFindingsAsSummary(findings, 'model');
			assert.ok(result.includes('Medium'));
			assert.ok(!result.includes('Critical'));
			assert.ok(!result.includes('High'));
		});

		test('includes model attribution', () => {
			const result = formatFindingsAsSummary([{ severity: 'low', message: 'x' }], 'my-model');
			assert.ok(result.includes('my-model'));
			assert.ok(result.includes('Ollama Code Review'));
		});
	});
});
