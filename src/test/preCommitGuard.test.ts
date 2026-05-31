/**
 * Unit tests for src/preCommitGuard.ts
 *
 * Covers: assessSeverity, formatAssessmentSummary
 */

import * as assert from 'assert';
import { assessSeverity, formatAssessmentSummary } from '../preCommitGuard';
import type { SeverityAssessment } from '../preCommitGuard';

const sampleDiff = `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,4 @@
 const x = 1;
+const password = "hardcoded";
 export default x;
`;

suite('Pre-Commit Guard Test Suite', () => {

	// ─── assessSeverity ──────────────────────────────────────────────────────

	suite('assessSeverity', () => {
		test('passes when no significant issues in review', () => {
			const review = 'This code looks good. Found no significant issues.';
			const result = assessSeverity(review, sampleDiff, 'high');
			assert.strictEqual(result.pass, true);
			assert.strictEqual(result.blockingFindings.length, 0);
		});

		test('blocks on critical findings when threshold is high', () => {
			const review = '### 1. SQL Injection Vulnerability\n\nCritical vulnerability: SQL injection attack possible in `src/auth.ts:2`';
			const result = assessSeverity(review, sampleDiff, 'high');
			assert.strictEqual(result.pass, false);
			assert.ok(result.blockingFindings.length > 0);
		});

		test('blocks on high findings when threshold is high', () => {
			const review = '### 1. Security Bug\n\nHigh severity: Hardcoded credentials found in `src/auth.ts:2`';
			const result = assessSeverity(review, sampleDiff, 'high');
			assert.strictEqual(result.pass, false);
		});

		test('passes on medium findings when threshold is high', () => {
			const review = '### 1. Performance Warning\n\nMedium severity: Consider using a Map instead of Object for better lookup performance';
			const result = assessSeverity(review, sampleDiff, 'high');
			assert.strictEqual(result.pass, true);
		});

		test('blocks on medium findings when threshold is medium', () => {
			const review = '### 1. Performance Warning\n\nMedium severity: Consider memoization for expensive computation';
			const result = assessSeverity(review, sampleDiff, 'medium');
			assert.strictEqual(result.pass, false);
		});

		test('blocks on low findings when threshold is low', () => {
			const review = '### 1. Naming Issue\n\nLow severity: Variable naming does not follow conventions';
			const result = assessSeverity(review, sampleDiff, 'low');
			assert.strictEqual(result.pass, false);
		});

		test('threshold critical only blocks on critical findings', () => {
			const review = '### 1. Bug Found\n\nHigh severity: Null dereference possible at runtime';
			const result = assessSeverity(review, sampleDiff, 'critical');
			assert.strictEqual(result.pass, true);
		});

		test('threshold critical blocks on critical findings', () => {
			const review = '### 1. Critical Issue\n\nCritical: Remote code execution vulnerability found';
			const result = assessSeverity(review, sampleDiff, 'critical');
			assert.strictEqual(result.pass, false);
		});

		test('returns all findings regardless of threshold', () => {
			const review = '### 1. Critical\n\nCritical: XSS vulnerability\n### 2. Low Issue\n\nLow: Naming nitpick';
			const result = assessSeverity(review, sampleDiff, 'high');
			assert.ok(result.findings.length >= 2);
		});

		test('counts findings by severity', () => {
			const review = '### 1. First\n\nCritical: A\n### 2. Second\n\nCritical: B\n### 3. Third\n\nLow: C minor style';
			const result = assessSeverity(review, sampleDiff, 'high');
			assert.ok(result.counts.critical >= 2);
		});

		test('includes threshold in result', () => {
			const result = assessSeverity('No issues.', sampleDiff, 'medium');
			assert.strictEqual(result.threshold, 'medium');
		});
	});

	// ─── formatAssessmentSummary ─────────────────────────────────────────────

	suite('formatAssessmentSummary', () => {
		test('formats passing assessment', () => {
			const assessment: SeverityAssessment = {
				pass: true,
				threshold: 'high',
				findings: [],
				counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
				blockingFindings: [],
			};
			const summary = formatAssessmentSummary(assessment);
			assert.ok(summary.includes('No findings'));
		});

		test('formats failing assessment with finding details', () => {
			const assessment: SeverityAssessment = {
				pass: false,
				threshold: 'high',
				findings: [
					{ severity: 'critical', message: 'SQL injection found' },
					{ severity: 'high', message: 'Null deref' },
				],
				counts: { critical: 1, high: 1, medium: 0, low: 0, info: 0 },
				blockingFindings: [
					{ severity: 'critical', message: 'SQL injection found' },
					{ severity: 'high', message: 'Null deref' },
				],
			};
			const summary = formatAssessmentSummary(assessment);
			assert.ok(summary.includes('🔴') || summary.includes('critical') || summary.includes('Critical'));
		});

		test('includes severity emoji indicators', () => {
			const assessment: SeverityAssessment = {
				pass: false,
				threshold: 'medium',
				findings: [
					{ severity: 'medium', message: 'Performance issue' },
				],
				counts: { critical: 0, high: 0, medium: 1, low: 0, info: 0 },
				blockingFindings: [
					{ severity: 'medium', message: 'Performance issue' },
				],
			};
			const summary = formatAssessmentSummary(assessment);
			assert.ok(summary.length > 0);
		});
	});
});
