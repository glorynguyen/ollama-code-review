/**
 * Unit tests for src/analytics/tracker.ts
 *
 * Covers: parseIssueCategories, extractFilesFromDiff, computeAnalytics,
 * exportAsCSV, exportAsJSON
 */

import * as assert from 'assert';
import {
	parseIssueCategories,
	extractFilesFromDiff,
	computeAnalytics,
	exportAsCSV,
	exportAsJSON,
} from '../analytics/tracker';
import type { ReviewScore } from '../reviewScore';

function makeScore(overrides: Partial<ReviewScore> = {}): ReviewScore {
	return {
		id: 'test-1',
		timestamp: new Date().toISOString(),
		repo: 'test-repo',
		branch: 'main',
		model: 'test-model',
		profile: 'general',
		score: 80,
		correctness: 80,
		security: 80,
		maintainability: 80,
		performance: 80,
		findingCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
		...overrides,
	};
}

suite('Analytics Tracker Test Suite', () => {

	// ─── parseIssueCategories ────────────────────────────────────────────────

	suite('parseIssueCategories', () => {
		test('detects security category from review text', () => {
			const text = '- **High** severity: SQL injection vulnerability in user input\n- **Critical** severity: XSS in template';
			const result = parseIssueCategories(text);
			assert.ok(result.security! >= 1);
		});

		test('detects performance category', () => {
			const text = '- **Medium** severity: Memory leak in event listener\n- **Low** severity: Bundle size is large';
			const result = parseIssueCategories(text);
			assert.ok(result.performance! >= 1);
		});

		test('detects bugs category', () => {
			const text = '- **High** severity: Null reference error on line 42\n- **Medium** severity: Race condition in async handler';
			const result = parseIssueCategories(text);
			assert.ok(result.bugs! >= 1);
		});

		test('detects style category', () => {
			const text = '- **Low** severity: Inconsistent naming convention\n- **Low** severity: Indentation issues';
			const result = parseIssueCategories(text);
			assert.ok(result.style! >= 1);
		});

		test('detects maintainability category', () => {
			const text = '- **Medium** severity: Code duplication detected\n- **Medium** severity: High complexity in function';
			const result = parseIssueCategories(text);
			assert.ok(result.maintainability! >= 1);
		});

		test('detects accessibility category', () => {
			const text = '- **Medium** severity: Missing aria label on button';
			const result = parseIssueCategories(text);
			assert.ok(result.accessibility! >= 1);
		});

		test('detects documentation category', () => {
			const text = '- **Low** severity: Missing JSDoc documentation';
			const result = parseIssueCategories(text);
			assert.ok(result.documentation! >= 1);
		});

		test('returns empty object for text without findings', () => {
			const text = 'This code looks great! No issues found.';
			const result = parseIssueCategories(text);
			assert.deepStrictEqual(result, {});
		});

		test('handles multiple categories in same review', () => {
			const text = [
				'- **Critical** severity: SQL injection vulnerability',
				'- **High** severity: Null pointer error',
				'- **Medium** severity: Performance bottleneck with re-render',
				'- **Low** severity: Inconsistent naming convention',
			].join('\n');
			const result = parseIssueCategories(text);
			assert.ok(result.security! >= 1);
			assert.ok(result.bugs! >= 1);
			assert.ok(result.performance! >= 1);
			assert.ok(result.style! >= 1);
		});
	});

	// ─── extractFilesFromDiff ────────────────────────────────────────────────

	suite('extractFilesFromDiff', () => {
		test('extracts file paths from unified diff', () => {
			const diff = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
+import bar from './bar';
diff --git a/src/bar.ts b/src/bar.ts
--- /dev/null
+++ b/src/bar.ts
@@ -0,0 +1,5 @@
+export default 'bar';
`;
			const files = extractFilesFromDiff(diff);
			assert.deepStrictEqual(files, ['src/foo.ts', 'src/bar.ts']);
		});

		test('returns empty array for empty diff', () => {
			assert.deepStrictEqual(extractFilesFromDiff(''), []);
		});

		test('deduplicates file paths', () => {
			const diff = `+++ b/src/foo.ts
@@ -1 +1 @@
+a
+++ b/src/foo.ts
@@ -5 +5 @@
+b`;
			const files = extractFilesFromDiff(diff);
			assert.strictEqual(files.length, 1);
			assert.strictEqual(files[0], 'src/foo.ts');
		});

		test('handles paths with special characters', () => {
			const diff = '+++ b/src/my file (copy).ts\n@@ -1 +1 @@\n+x';
			const files = extractFilesFromDiff(diff);
			assert.strictEqual(files[0], 'src/my file (copy).ts');
		});
	});

	// ─── computeAnalytics ────────────────────────────────────────────────────

	suite('computeAnalytics', () => {
		test('returns zeroed summary for empty scores', () => {
			const result = computeAnalytics([]);
			assert.strictEqual(result.totalReviews, 0);
			assert.strictEqual(result.averageScore, 0);
			assert.strictEqual(result.bestScore, 0);
			assert.strictEqual(result.totalIssues, 0);
		});

		test('computes averages correctly', () => {
			const scores = [
				makeScore({ id: '1', score: 60 }),
				makeScore({ id: '2', score: 80 }),
				makeScore({ id: '3', score: 100 }),
			];
			const result = computeAnalytics(scores);
			assert.strictEqual(result.totalReviews, 3);
			assert.strictEqual(result.averageScore, 80);
			assert.strictEqual(result.bestScore, 100);
			assert.strictEqual(result.worstScore, 60);
		});

		test('aggregates severity distribution', () => {
			const scores = [
				makeScore({ id: '1', findingCounts: { critical: 1, high: 2, medium: 0, low: 0, info: 0 } }),
				makeScore({ id: '2', findingCounts: { critical: 0, high: 1, medium: 3, low: 0, info: 0 } }),
			];
			const result = computeAnalytics(scores);
			assert.strictEqual(result.severityDistribution.critical, 1);
			assert.strictEqual(result.severityDistribution.high, 3);
			assert.strictEqual(result.severityDistribution.medium, 3);
		});

		test('computes total issues (excluding info)', () => {
			const scores = [
				makeScore({ id: '1', findingCounts: { critical: 1, high: 2, medium: 3, low: 4, info: 5 } }),
			];
			const result = computeAnalytics(scores);
			assert.strictEqual(result.totalIssues, 10); // 1+2+3+4 (no info)
		});

		test('tracks model usage', () => {
			const scores = [
				makeScore({ id: '1', model: 'gpt-4' }),
				makeScore({ id: '2', model: 'gpt-4' }),
				makeScore({ id: '3', model: 'claude' }),
			];
			const result = computeAnalytics(scores);
			assert.strictEqual(result.modelUsage['gpt-4'], 2);
			assert.strictEqual(result.modelUsage['claude'], 1);
		});

		test('tracks profile usage', () => {
			const scores = [
				makeScore({ id: '1', profile: 'security' }),
				makeScore({ id: '2', profile: 'security' }),
				makeScore({ id: '3', profile: 'general' }),
			];
			const result = computeAnalytics(scores);
			assert.strictEqual(result.profileUsage['security'], 2);
			assert.strictEqual(result.profileUsage['general'], 1);
		});

		test('tracks review types', () => {
			const scores = [
				makeScore({ id: '1', reviewType: 'staged' }),
				makeScore({ id: '2', reviewType: 'pr' }),
				makeScore({ id: '3', reviewType: 'staged' }),
			];
			const result = computeAnalytics(scores);
			assert.strictEqual(result.reviewTypeBreakdown['staged'], 2);
			assert.strictEqual(result.reviewTypeBreakdown['pr'], 1);
		});

		test('computes top files', () => {
			const scores = [
				makeScore({ id: '1', filesReviewed: ['a.ts', 'b.ts'] }),
				makeScore({ id: '2', filesReviewed: ['a.ts', 'c.ts'] }),
				makeScore({ id: '3', filesReviewed: ['a.ts'] }),
			];
			const result = computeAnalytics(scores);
			assert.strictEqual(result.topFiles[0].file, 'a.ts');
			assert.strictEqual(result.topFiles[0].count, 3);
		});

		test('computes average duration when available', () => {
			const scores = [
				makeScore({ id: '1', durationMs: 1000 }),
				makeScore({ id: '2', durationMs: 3000 }),
			];
			const result = computeAnalytics(scores);
			assert.strictEqual(result.averageDurationMs, 2000);
		});

		test('returns undefined duration when none available', () => {
			const scores = [makeScore({ id: '1' })];
			const result = computeAnalytics(scores);
			assert.strictEqual(result.averageDurationMs, undefined);
		});

		test('counts reviews this week', () => {
			const now = new Date();
			const recent = new Date(now.getTime() - 1000 * 60 * 60); // 1 hour ago
			const old = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 10); // 10 days ago
			const scores = [
				makeScore({ id: '1', timestamp: recent.toISOString() }),
				makeScore({ id: '2', timestamp: old.toISOString() }),
			];
			const result = computeAnalytics(scores);
			assert.strictEqual(result.reviewsThisWeek, 1);
		});
	});

	// ─── exportAsCSV ─────────────────────────────────────────────────────────

	suite('exportAsCSV', () => {
		test('exports header row', () => {
			const csv = exportAsCSV([]);
			assert.ok(csv.startsWith('id,timestamp,'));
		});

		test('exports score data as rows', () => {
			const scores = [makeScore({ id: 'r1', score: 85, model: 'gpt-4' })];
			const csv = exportAsCSV(scores);
			const lines = csv.split('\n');
			assert.strictEqual(lines.length, 2); // header + 1 row
			assert.ok(lines[1].includes('r1'));
			assert.ok(lines[1].includes('"gpt-4"'));
		});

		test('handles missing optional fields', () => {
			const scores = [makeScore({ id: 'r1' })];
			const csv = exportAsCSV(scores);
			assert.ok(csv.includes('r1'));
		});
	});

	// ─── exportAsJSON ────────────────────────────────────────────────────────

	suite('exportAsJSON', () => {
		test('exports valid JSON', () => {
			const scores = [makeScore({ id: 'r1', score: 90 })];
			const json = exportAsJSON(scores);
			const parsed = JSON.parse(json);
			assert.strictEqual(parsed.length, 1);
			assert.strictEqual(parsed[0].id, 'r1');
			assert.strictEqual(parsed[0].score, 90);
		});

		test('exports empty array for no scores', () => {
			const json = exportAsJSON([]);
			assert.deepStrictEqual(JSON.parse(json), []);
		});
	});
});
