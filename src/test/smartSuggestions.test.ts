/**
 * F-049: Smart Review Suggestions — Unit Tests
 *
 * Full coverage for the suggestion analyzer: fix suggestions,
 * profile suggestions, trend suggestions, workflow suggestions,
 * and the main generateSmartSuggestions orchestrator.
 */

import * as assert from 'assert';
import {
	generateSmartSuggestions,
	generateFixSuggestions,
	generateProfileSuggestions,
	generateTrendSuggestions,
	generateWorkflowSuggestions,
} from '../smartSuggestions';
import type { SuggestionInput, SmartSuggestion } from '../smartSuggestions';
import type { ReviewScore } from '../reviewScore';

function createInput(overrides: Partial<SuggestionInput> = {}): SuggestionInput {
	return {
		findingCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
		activeProfile: 'general',
		filesReviewed: [],
		diff: '',
		score: 85,
		categories: {},
		recentScores: [],
		fixableCount: 0,
		totalFindings: 0,
		...overrides,
	};
}

function createReviewScore(overrides: Partial<ReviewScore> = {}): ReviewScore {
	return {
		id: Date.now().toString(),
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

suite('Smart Review Suggestions Tests', () => {

	// ─── Fix Suggestions ─────────────────────────────────────────────────────

	suite('generateFixSuggestions', () => {
		test('returns empty when no fixable findings', () => {
			const input = createInput({ fixableCount: 0, totalFindings: 5 });
			const result = generateFixSuggestions(input);
			assert.strictEqual(result.length, 0);
		});

		test('returns suggestion when fixable findings exist', () => {
			const input = createInput({ fixableCount: 3, totalFindings: 5 });
			const result = generateFixSuggestions(input);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].category, 'fix');
			assert.strictEqual(result[0].command, 'ollama-code-review.fixAllFindings');
		});

		test('low priority for 1 fixable finding', () => {
			const input = createInput({ fixableCount: 1, totalFindings: 1 });
			const result = generateFixSuggestions(input);
			assert.strictEqual(result[0].priority, 'low');
		});

		test('medium priority for 2-4 fixable findings', () => {
			const input = createInput({ fixableCount: 3, totalFindings: 5 });
			const result = generateFixSuggestions(input);
			assert.strictEqual(result[0].priority, 'medium');
		});

		test('high priority for 5+ fixable findings', () => {
			const input = createInput({ fixableCount: 7, totalFindings: 10 });
			const result = generateFixSuggestions(input);
			assert.strictEqual(result[0].priority, 'high');
		});

		test('singular grammar for 1 finding', () => {
			const input = createInput({ fixableCount: 1, totalFindings: 1 });
			const result = generateFixSuggestions(input);
			assert.ok(result[0].title.includes('is auto-fixable'));
		});

		test('plural grammar for multiple findings', () => {
			const input = createInput({ fixableCount: 3, totalFindings: 5 });
			const result = generateFixSuggestions(input);
			assert.ok(result[0].title.includes('are auto-fixable'));
		});
	});

	// ─── Profile Suggestions ─────────────────────────────────────────────────

	suite('generateProfileSuggestions', () => {
		test('suggests security profile for auth files', () => {
			const input = createInput({
				filesReviewed: ['src/auth/login.ts', 'src/utils/helper.ts'],
				activeProfile: 'general',
			});
			const result = generateProfileSuggestions(input);
			const secSuggestion = result.find(s => s.id === 'suggest-security-profile');
			assert.ok(secSuggestion);
			assert.strictEqual(secSuggestion!.category, 'security');
			assert.strictEqual(secSuggestion!.priority, 'high');
		});

		test('does not suggest security profile when already active', () => {
			const input = createInput({
				filesReviewed: ['src/auth/login.ts'],
				activeProfile: 'security',
			});
			const result = generateProfileSuggestions(input);
			const secSuggestion = result.find(s => s.id === 'suggest-security-profile');
			assert.strictEqual(secSuggestion, undefined);
		});

		test('detects various security file patterns', () => {
			const securityNames = [
				'src/auth.ts', 'lib/session.ts', 'utils/token.ts',
				'core/password.ts', 'api/credentials.ts', 'middleware/jwt.ts',
			];
			for (const file of securityNames) {
				const input = createInput({
					filesReviewed: [file],
					activeProfile: 'general',
				});
				const result = generateProfileSuggestions(input);
				const secSuggestion = result.find(s => s.id === 'suggest-security-profile');
				assert.ok(secSuggestion, `Expected security suggestion for ${file}`);
			}
		});

		test('suggests performance profile for database files with performance categories', () => {
			const input = createInput({
				filesReviewed: ['src/database/query.ts'],
				activeProfile: 'general',
				categories: { performance: 2 },
			});
			const result = generateProfileSuggestions(input);
			const perfSuggestion = result.find(s => s.id === 'suggest-performance-profile');
			assert.ok(perfSuggestion);
			assert.strictEqual(perfSuggestion!.category, 'performance');
		});

		test('does not suggest performance when no perf categories detected', () => {
			const input = createInput({
				filesReviewed: ['src/database/query.ts'],
				activeProfile: 'general',
				categories: { performance: 0 },
			});
			const result = generateProfileSuggestions(input);
			const perfSuggestion = result.find(s => s.id === 'suggest-performance-profile');
			assert.strictEqual(perfSuggestion, undefined);
		});

		test('does not suggest performance profile when already active', () => {
			const input = createInput({
				filesReviewed: ['src/database/query.ts'],
				activeProfile: 'performance',
				categories: { performance: 3 },
			});
			const result = generateProfileSuggestions(input);
			const perfSuggestion = result.find(s => s.id === 'suggest-performance-profile');
			assert.strictEqual(perfSuggestion, undefined);
		});

		test('suggests specific profile switch based on dominant category', () => {
			const input = createInput({
				activeProfile: 'general',
				categories: { security: 4, performance: 1, style: 0 },
			});
			const result = generateProfileSuggestions(input);
			const profileSuggestion = result.find(s => s.category === 'profile');
			assert.ok(profileSuggestion);
			assert.ok(profileSuggestion!.title.includes('security'));
		});

		test('does not suggest profile switch when count below threshold', () => {
			const input = createInput({
				activeProfile: 'general',
				categories: { security: 2, performance: 1 },
			});
			const result = generateProfileSuggestions(input);
			const profileSuggestion = result.find(s => s.category === 'profile');
			assert.strictEqual(profileSuggestion, undefined);
		});

		test('does not suggest profile switch when already on non-general', () => {
			const input = createInput({
				activeProfile: 'security',
				categories: { security: 5 },
			});
			const result = generateProfileSuggestions(input);
			const profileSuggestion = result.find(s => s.category === 'profile');
			assert.strictEqual(profileSuggestion, undefined);
		});

		test('maps style category to strict profile', () => {
			const input = createInput({
				activeProfile: 'general',
				categories: { style: 5 },
			});
			const result = generateProfileSuggestions(input);
			const profileSuggestion = result.find(s => s.category === 'profile');
			assert.ok(profileSuggestion);
			assert.ok(profileSuggestion!.title.includes('strict'));
		});

		test('maps accessibility category to accessibility profile', () => {
			const input = createInput({
				activeProfile: 'general',
				categories: { accessibility: 3 },
			});
			const result = generateProfileSuggestions(input);
			const profileSuggestion = result.find(s => s.category === 'profile');
			assert.ok(profileSuggestion);
			assert.ok(profileSuggestion!.title.includes('accessibility'));
		});
	});

	// ─── Trend Suggestions ───────────────────────────────────────────────────

	suite('generateTrendSuggestions', () => {
		test('returns empty when insufficient history', () => {
			const input = createInput({
				recentScores: [createReviewScore(), createReviewScore()],
			});
			const result = generateTrendSuggestions(input);
			assert.strictEqual(result.length, 0);
		});

		test('warns about declining score trend', () => {
			const input = createInput({
				score: 50,
				recentScores: [
					createReviewScore({ score: 85 }),
					createReviewScore({ score: 80 }),
					createReviewScore({ score: 82 }),
				],
			});
			const result = generateTrendSuggestions(input);
			const trendSuggestion = result.find(s => s.id === 'trend-declining-quality');
			assert.ok(trendSuggestion);
			assert.strictEqual(trendSuggestion!.priority, 'high');
			assert.ok(trendSuggestion!.description.includes('50/100'));
		});

		test('no decline warning when score is close to average', () => {
			const input = createInput({
				score: 78,
				recentScores: [
					createReviewScore({ score: 80 }),
					createReviewScore({ score: 82 }),
					createReviewScore({ score: 85 }),
				],
			});
			const result = generateTrendSuggestions(input);
			const trendSuggestion = result.find(s => s.id === 'trend-declining-quality');
			assert.strictEqual(trendSuggestion, undefined);
		});

		test('detects recurring issues in same files', () => {
			const input = createInput({
				score: 70,
				filesReviewed: ['src/auth.ts', 'src/utils.ts'],
				recentScores: [
					createReviewScore({ score: 70, filesReviewed: ['src/auth.ts'] }),
					createReviewScore({ score: 65, filesReviewed: ['src/auth.ts', 'src/other.ts'] }),
					createReviewScore({ score: 75, filesReviewed: ['src/utils.ts'] }),
					createReviewScore({ score: 80, filesReviewed: ['src/different.ts'] }),
				],
			});
			const result = generateTrendSuggestions(input);
			const recurringSuggestion = result.find(s => s.id === 'trend-recurring-issues');
			assert.ok(recurringSuggestion);
			assert.strictEqual(recurringSuggestion!.category, 'trend');
		});

		test('no recurring warning when files are different', () => {
			const input = createInput({
				score: 70,
				filesReviewed: ['src/new-file.ts'],
				recentScores: [
					createReviewScore({ score: 70, filesReviewed: ['src/auth.ts'] }),
					createReviewScore({ score: 65, filesReviewed: ['src/other.ts'] }),
					createReviewScore({ score: 75, filesReviewed: ['src/utils.ts'] }),
				],
			});
			const result = generateTrendSuggestions(input);
			const recurringSuggestion = result.find(s => s.id === 'trend-recurring-issues');
			assert.strictEqual(recurringSuggestion, undefined);
		});

		test('no recurring warning when past reviews had good scores', () => {
			const input = createInput({
				score: 70,
				filesReviewed: ['src/auth.ts'],
				recentScores: [
					createReviewScore({ score: 90, filesReviewed: ['src/auth.ts'] }),
					createReviewScore({ score: 95, filesReviewed: ['src/auth.ts'] }),
					createReviewScore({ score: 88, filesReviewed: ['src/auth.ts'] }),
				],
			});
			const result = generateTrendSuggestions(input);
			const recurringSuggestion = result.find(s => s.id === 'trend-recurring-issues');
			assert.strictEqual(recurringSuggestion, undefined);
		});
	});

	// ─── Workflow Suggestions ────────────────────────────────────────────────

	suite('generateWorkflowSuggestions', () => {
		test('suggests committing when score is high and no critical/high findings', () => {
			const input = createInput({
				score: 92,
				findingCounts: { critical: 0, high: 0, medium: 2, low: 1, info: 3 },
			});
			const result = generateWorkflowSuggestions(input);
			const commitSuggestion = result.find(s => s.id === 'workflow-commit');
			assert.ok(commitSuggestion);
			assert.strictEqual(commitSuggestion!.priority, 'low');
			assert.strictEqual(commitSuggestion!.command, 'ollama-code-review.generateCommitMessage');
		});

		test('does not suggest committing when score is below 90', () => {
			const input = createInput({
				score: 85,
				findingCounts: { critical: 0, high: 0, medium: 2, low: 1, info: 0 },
			});
			const result = generateWorkflowSuggestions(input);
			const commitSuggestion = result.find(s => s.id === 'workflow-commit');
			assert.strictEqual(commitSuggestion, undefined);
		});

		test('does not suggest committing when high findings present', () => {
			const input = createInput({
				score: 95,
				findingCounts: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
			});
			const result = generateWorkflowSuggestions(input);
			const commitSuggestion = result.find(s => s.id === 'workflow-commit');
			assert.strictEqual(commitSuggestion, undefined);
		});

		test('does not suggest committing when critical findings present', () => {
			const input = createInput({
				score: 95,
				findingCounts: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
			});
			const result = generateWorkflowSuggestions(input);
			const commitSuggestion = result.find(s => s.id === 'workflow-commit');
			assert.strictEqual(commitSuggestion, undefined);
		});

		test('warns about critical findings', () => {
			const input = createInput({
				score: 40,
				findingCounts: { critical: 2, high: 3, medium: 1, low: 0, info: 0 },
			});
			const result = generateWorkflowSuggestions(input);
			const criticalSuggestion = result.find(s => s.id === 'workflow-critical');
			assert.ok(criticalSuggestion);
			assert.strictEqual(criticalSuggestion!.priority, 'high');
			assert.ok(criticalSuggestion!.title.includes('2'));
		});

		test('no critical warning when none present', () => {
			const input = createInput({
				score: 60,
				findingCounts: { critical: 0, high: 3, medium: 2, low: 1, info: 0 },
			});
			const result = generateWorkflowSuggestions(input);
			const criticalSuggestion = result.find(s => s.id === 'workflow-critical');
			assert.strictEqual(criticalSuggestion, undefined);
		});

		test('singular grammar for 1 critical finding', () => {
			const input = createInput({
				score: 40,
				findingCounts: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
			});
			const result = generateWorkflowSuggestions(input);
			const criticalSuggestion = result.find(s => s.id === 'workflow-critical');
			assert.ok(criticalSuggestion);
			assert.ok(criticalSuggestion!.title.includes('1 critical finding require'));
		});
	});

	// ─── Main Orchestrator ───────────────────────────────────────────────────

	suite('generateSmartSuggestions', () => {
		test('returns SuggestionResult with generatedAt timestamp', () => {
			const input = createInput();
			const result = generateSmartSuggestions(input);
			assert.ok(result.generatedAt);
			assert.ok(result.suggestions);
			assert.ok(Array.isArray(result.suggestions));
		});

		test('returns empty suggestions for clean review', () => {
			const input = createInput({
				score: 95,
				findingCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
				fixableCount: 0,
				totalFindings: 0,
			});
			const result = generateSmartSuggestions(input);
			// Only workflow-commit should appear
			const nonCommit = result.suggestions.filter(s => s.id !== 'workflow-commit');
			assert.strictEqual(nonCommit.length, 0);
		});

		test('sorts suggestions by priority (high first)', () => {
			const input = createInput({
				score: 50,
				findingCounts: { critical: 2, high: 3, medium: 5, low: 2, info: 1 },
				fixableCount: 7,
				totalFindings: 13,
				filesReviewed: ['src/auth/login.ts'],
				recentScores: [
					createReviewScore({ score: 85 }),
					createReviewScore({ score: 82 }),
					createReviewScore({ score: 80 }),
				],
			});
			const result = generateSmartSuggestions(input);
			for (let i = 1; i < result.suggestions.length; i++) {
				const prev = result.suggestions[i - 1];
				const curr = result.suggestions[i];
				const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
				assert.ok(order[prev.priority] <= order[curr.priority],
					`Suggestion ${i - 1} (${prev.priority}) should not come after ${i} (${curr.priority})`);
			}
		});

		test('limits to maximum 5 suggestions', () => {
			const input = createInput({
				score: 40,
				findingCounts: { critical: 2, high: 5, medium: 3, low: 2, info: 1 },
				fixableCount: 10,
				totalFindings: 13,
				filesReviewed: ['src/auth/login.ts', 'src/database/query.ts'],
				activeProfile: 'general',
				categories: { security: 5, performance: 4 },
				recentScores: [
					createReviewScore({ score: 85 }),
					createReviewScore({ score: 82 }),
					createReviewScore({ score: 80 }),
				],
			});
			const result = generateSmartSuggestions(input);
			assert.ok(result.suggestions.length <= 5);
		});

		test('combines suggestions from multiple generators', () => {
			const input = createInput({
				score: 50,
				findingCounts: { critical: 1, high: 2, medium: 3, low: 1, info: 0 },
				fixableCount: 4,
				totalFindings: 7,
				filesReviewed: ['src/auth.ts'],
				activeProfile: 'general',
				recentScores: [
					createReviewScore({ score: 85 }),
					createReviewScore({ score: 80 }),
					createReviewScore({ score: 82 }),
				],
			});
			const result = generateSmartSuggestions(input);
			const categories = new Set(result.suggestions.map(s => s.category));
			// Should have at least fix + workflow(critical) + security
			assert.ok(categories.size >= 2, `Expected multiple categories, got: ${[...categories].join(', ')}`);
		});

		test('each suggestion has required fields', () => {
			const input = createInput({
				score: 50,
				findingCounts: { critical: 1, high: 2, medium: 1, low: 0, info: 0 },
				fixableCount: 3,
				totalFindings: 4,
			});
			const result = generateSmartSuggestions(input);
			for (const s of result.suggestions) {
				assert.ok(s.id, 'Suggestion must have id');
				assert.ok(s.category, 'Suggestion must have category');
				assert.ok(s.priority, 'Suggestion must have priority');
				assert.ok(s.title, 'Suggestion must have title');
				assert.ok(s.description, 'Suggestion must have description');
			}
		});

		test('generatedAt is a valid ISO date', () => {
			const input = createInput();
			const result = generateSmartSuggestions(input);
			const date = new Date(result.generatedAt);
			assert.ok(!isNaN(date.getTime()), 'generatedAt should be a valid ISO date');
		});
	});
});
