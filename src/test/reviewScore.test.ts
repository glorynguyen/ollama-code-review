/**
 * Unit tests for src/reviewScore.ts
 *
 * Covers: parseFindingCounts, computeScore, isRestorableReviewScore
 */

import * as assert from 'assert';
import { parseFindingCounts, computeScore, isRestorableReviewScore } from '../reviewScore';
import type { ReviewScore } from '../reviewScore';

suite('Review Score Test Suite', () => {

	// ─── parseFindingCounts ──────────────────────────────────────────────────

	suite('parseFindingCounts', () => {
		test('counts critical findings', () => {
			const text = '- **Severity:** critical\n- **Severity:** critical';
			const counts = parseFindingCounts(text);
			assert.strictEqual(counts.critical, 2);
		});

		test('counts high findings', () => {
			const text = '- **Severity:** high\n- **High** issue found';
			const counts = parseFindingCounts(text);
			assert.strictEqual(counts.high, 2);
		});

		test('counts medium findings', () => {
			const text = '- **Severity:** medium\n- **Severity:** moderate';
			const counts = parseFindingCounts(text);
			assert.strictEqual(counts.medium, 2);
		});

		test('counts low findings with emoji badge', () => {
			const text = '🟢 Low: naming issue\n🟢 Low: style concern';
			const counts = parseFindingCounts(text);
			assert.strictEqual(counts.low, 2);
		});

		test('counts info findings', () => {
			const text = '- **Severity:** info\nℹ️ Note: consider caching';
			const counts = parseFindingCounts(text);
			assert.strictEqual(counts.info, 2);
		});

		test('returns zeros for text without findings', () => {
			const text = 'This code looks great! Well structured.';
			const counts = parseFindingCounts(text);
			assert.strictEqual(counts.critical, 0);
			assert.strictEqual(counts.high, 0);
			assert.strictEqual(counts.medium, 0);
			assert.strictEqual(counts.low, 0);
			assert.strictEqual(counts.info, 0);
		});

		test('caps critical findings at 10', () => {
			const lines = Array.from({ length: 15 }, () => '- **Severity:** critical').join('\n');
			const counts = parseFindingCounts(lines);
			assert.strictEqual(counts.critical, 10);
		});

		test('caps high findings at 10', () => {
			const lines = Array.from({ length: 12 }, () => '🟠 High severity bug').join('\n');
			const counts = parseFindingCounts(lines);
			assert.strictEqual(counts.high, 10);
		});

		test('caps low findings at 15', () => {
			const lines = Array.from({ length: 20 }, () => '🟢 Low priority nit').join('\n');
			const counts = parseFindingCounts(lines);
			assert.strictEqual(counts.low, 15);
		});

		test('caps info findings at 20', () => {
			const lines = Array.from({ length: 25 }, () => 'ℹ️ Info note here').join('\n');
			const counts = parseFindingCounts(lines);
			assert.strictEqual(counts.info, 20);
		});

		test('handles emoji severity markers', () => {
			const text = '🔴 Critical: injection\n🟠 High: error\n🟡 Medium: perf\n🟢 Low: style\nℹ️ Info: note';
			const counts = parseFindingCounts(text);
			assert.strictEqual(counts.critical, 1);
			assert.strictEqual(counts.high, 1);
			assert.strictEqual(counts.medium, 1);
			assert.strictEqual(counts.low, 1);
			assert.strictEqual(counts.info, 1);
		});

		test('handles empty text', () => {
			const counts = parseFindingCounts('');
			assert.deepStrictEqual(counts, { critical: 0, high: 0, medium: 0, low: 0, info: 0 });
		});
	});

	// ─── computeScore ────────────────────────────────────────────────────────

	suite('computeScore', () => {
		test('returns 100 for no findings', () => {
			const result = computeScore({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });
			assert.strictEqual(result.score, 100);
		});

		test('deducts 20 per critical finding', () => {
			const result = computeScore({ critical: 1, high: 0, medium: 0, low: 0, info: 0 });
			assert.strictEqual(result.score, 80);
		});

		test('deducts 10 per high finding', () => {
			const result = computeScore({ critical: 0, high: 2, medium: 0, low: 0, info: 0 });
			assert.strictEqual(result.score, 80);
		});

		test('deducts 5 per medium finding', () => {
			const result = computeScore({ critical: 0, high: 0, medium: 4, low: 0, info: 0 });
			assert.strictEqual(result.score, 80);
		});

		test('deducts 2 per low finding', () => {
			const result = computeScore({ critical: 0, high: 0, medium: 0, low: 5, info: 0 });
			assert.strictEqual(result.score, 90);
		});

		test('info findings have no deduction', () => {
			const result = computeScore({ critical: 0, high: 0, medium: 0, low: 0, info: 10 });
			assert.strictEqual(result.score, 100);
		});

		test('clamps to minimum of 0', () => {
			const result = computeScore({ critical: 10, high: 10, medium: 10, low: 10, info: 0 });
			assert.strictEqual(result.score, 0);
		});

		test('computes sub-scores with different weights', () => {
			const result = computeScore({ critical: 2, high: 0, medium: 0, low: 0, info: 0 });
			// Deduction = 40
			// correctness = 100 - round(40 * 0.35) = 100 - 14 = 86
			assert.strictEqual(result.correctness, 86);
			// security = 100 - round(40 * 0.30) = 100 - 12 = 88
			assert.strictEqual(result.security, 88);
			// maintainability = 100 - round(40 * 0.20) = 100 - 8 = 92
			assert.strictEqual(result.maintainability, 92);
			// performance = 100 - round(40 * 0.15) = 100 - 6 = 94
			assert.strictEqual(result.performance, 94);
		});

		test('sub-scores clamp to 0 with extreme deductions', () => {
			// Need deduction >= 667 for all sub-scores to be 0 (performance uses 0.15 weight)
			const result = computeScore({ critical: 34, high: 0, medium: 0, low: 0, info: 0 });
			// Deduction = 680
			assert.strictEqual(result.score, 0);
			assert.strictEqual(result.correctness, 0);
			assert.strictEqual(result.security, 0);
			assert.strictEqual(result.maintainability, 0);
			assert.strictEqual(result.performance, 0);
		});

		test('combined findings compute correctly', () => {
			// 1 critical (20) + 1 high (10) + 1 medium (5) + 1 low (2) = 37 deduction
			const result = computeScore({ critical: 1, high: 1, medium: 1, low: 1, info: 1 });
			assert.strictEqual(result.score, 63);
		});
	});

	// ─── isRestorableReviewScore ─────────────────────────────────────────────

	suite('isRestorableReviewScore', () => {
		test('returns false for undefined', () => {
			assert.strictEqual(isRestorableReviewScore(undefined), false);
		});

		test('returns false for score without diff', () => {
			const score: ReviewScore = {
				id: '1',
				timestamp: '2025-01-01',
				repo: 'r',
				branch: 'b',
				model: 'm',
				profile: 'p',
				score: 80,
				correctness: 80,
				security: 80,
				maintainability: 80,
				performance: 80,
				findingCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
			};
			assert.strictEqual(isRestorableReviewScore(score), false);
		});

		test('returns false for score with empty diff', () => {
			const score: ReviewScore = {
				id: '1',
				timestamp: '2025-01-01',
				repo: 'r',
				branch: 'b',
				model: 'm',
				profile: 'p',
				score: 80,
				correctness: 80,
				security: 80,
				maintainability: 80,
				performance: 80,
				findingCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
				diff: '',
			};
			assert.strictEqual(isRestorableReviewScore(score), false);
		});

		test('returns false for score without findings', () => {
			const score: ReviewScore = {
				id: '1',
				timestamp: '2025-01-01',
				repo: 'r',
				branch: 'b',
				model: 'm',
				profile: 'p',
				score: 80,
				correctness: 80,
				security: 80,
				maintainability: 80,
				performance: 80,
				findingCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
				diff: 'some diff',
			};
			assert.strictEqual(isRestorableReviewScore(score), false);
		});

		test('returns true for score with valid findings and diff', () => {
			const score: ReviewScore = {
				id: '1',
				timestamp: '2025-01-01',
				repo: 'r',
				branch: 'b',
				model: 'm',
				profile: 'p',
				score: 80,
				correctness: 80,
				security: 80,
				maintainability: 80,
				performance: 80,
				findingCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
				diff: 'some diff content',
				findings: {
					findings: [{ severity: 'low', message: 'test', category: 'style', file: 'a.ts' }],
					summary: 'test summary',
				} as any,
			};
			assert.strictEqual(isRestorableReviewScore(score), true);
		});
	});
});
