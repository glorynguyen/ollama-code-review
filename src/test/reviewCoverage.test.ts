import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { computeReviewCoverage } from '../reviewCoverage';
import type { ReviewScore } from '../reviewScore';

function score(
	id: string,
	timestamp: string,
	filesReviewed: string[],
	findingCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
	scoreValue = 100,
): ReviewScore {
	return {
		id,
		timestamp,
		repo: 'repo',
		branch: 'main',
		model: 'test-model',
		profile: 'general',
		score: scoreValue,
		correctness: scoreValue,
		security: scoreValue,
		maintainability: scoreValue,
		performance: scoreValue,
		findingCounts,
		filesReviewed,
		reviewType: 'staged',
	};
}

suite('Review Coverage Test Suite', () => {
	test('groups files by review freshness and findings', () => {
		const files = ['src/never.ts', 'src/recent.ts', 'src/findings.ts', 'src/stale.ts'].map(relativePath => ({
			relativePath,
			uri: vscode.Uri.file(`/repo/${relativePath}`),
		}));

		const coverage = computeReviewCoverage(
			files,
			[
				score('recent', '2026-05-18T00:00:00.000Z', ['src/recent.ts']),
				score('findings', '2026-05-18T00:00:00.000Z', ['src/findings.ts'], { critical: 0, high: 1, medium: 0, low: 0, info: 0 }, 90),
				score('stale', '2026-04-01T00:00:00.000Z', ['src/stale.ts']),
				score('ignored', '2026-05-18T00:00:00.000Z', ['src/not-in-workspace.ts']),
			],
			14,
			new Date('2026-05-19T00:00:00.000Z'),
		);

		const byPath = new Map(coverage.map(item => [item.relativePath, item]));
		assert.strictEqual(byPath.get('src/never.ts')?.group, 'never');
		assert.strictEqual(byPath.get('src/recent.ts')?.group, 'recent');
		assert.strictEqual(byPath.get('src/findings.ts')?.group, 'findings');
		assert.strictEqual(byPath.get('src/stale.ts')?.group, 'stale');
		assert.strictEqual(byPath.get('src/findings.ts')?.score, 90);
		assert.strictEqual(byPath.get('src/stale.ts')?.ageDays, 48);
	});

	test('uses the latest review per normalized file path', () => {
		const files = [{
			relativePath: 'src/app.ts',
			uri: vscode.Uri.file('/repo/src/app.ts'),
		}];

		const coverage = computeReviewCoverage(
			files,
			[
				score('old', '2026-05-01T00:00:00.000Z', ['src/app.ts'], { critical: 0, high: 1, medium: 0, low: 0, info: 0 }, 70),
				score('new', '2026-05-18T00:00:00.000Z', ['src\\app.ts'], { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, 99),
			],
			14,
			new Date('2026-05-19T00:00:00.000Z'),
		);

		assert.strictEqual(coverage[0].lastReview?.id, 'new');
		assert.strictEqual(coverage[0].group, 'recent');
		assert.strictEqual(coverage[0].score, 99);
	});

	test('falls back to file review labels when filesReviewed is absent', () => {
		const files = [{
			relativePath: 'src/labeled.ts',
			uri: vscode.Uri.file('/repo/src/labeled.ts'),
		}];
		const fileScore = score('file-review', '2026-05-18T00:00:00.000Z', []);
		fileScore.reviewType = 'file';
		fileScore.label = '[File Review: src/labeled.ts]';

		const coverage = computeReviewCoverage(
			files,
			[fileScore],
			14,
			new Date('2026-05-19T00:00:00.000Z'),
		);

		assert.strictEqual(coverage[0].lastReview?.id, 'file-review');
		assert.strictEqual(coverage[0].group, 'recent');
	});

	test('contributes Coverage view, commands, menus, and settings', async () => {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			console.warn('Skipping test: No workspace folder open');
			return;
		}

		const packageJsonPath = path.join(workspaceFolder.uri.fsPath, 'package.json');
		const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8')) as {
			activationEvents?: string[];
			contributes?: {
				commands?: Array<{ command: string; title?: string; icon?: string }>;
				views?: Record<string, Array<{ id: string; name: string }>>;
				menus?: {
					'view/item/context'?: Array<{ command: string; when?: string; group?: string }>;
					'view/title'?: Array<{ command: string; when?: string; group?: string }>;
				};
				configuration?: {
					properties?: Record<string, unknown>;
				};
			};
		};

		assert.ok(packageJson.activationEvents?.includes('onView:ai-review.coverage'));
		assert.ok(packageJson.contributes?.views?.['ai-review']?.some(view => view.id === 'ai-review.coverage' && view.name === 'Coverage'));

		for (const command of [
			'ollama-code-review.refreshReviewCoverage',
			'ollama-code-review.copyReviewCoverageSummary',
			'ollama-code-review.openCoverageFile',
			'ollama-code-review.reviewCoverageFile',
			'ollama-code-review.restoreCoverageReview',
		]) {
			assert.ok(
				packageJson.contributes?.commands?.some(item => item.command === command),
				`${command} should be contributed`,
			);
		}

		assert.ok(packageJson.contributes?.menus?.['view/title']?.some(item =>
			item.command === 'ollama-code-review.refreshReviewCoverage' &&
			item.when === 'view == ai-review.coverage',
		));
		assert.ok(packageJson.contributes?.menus?.['view/item/context']?.some(item =>
			item.command === 'ollama-code-review.reviewCoverageFile' &&
			item.when?.includes('view == ai-review.coverage'),
		));
		assert.ok(packageJson.contributes?.configuration?.properties?.['ollama-code-review.coverage']);
	});
});
