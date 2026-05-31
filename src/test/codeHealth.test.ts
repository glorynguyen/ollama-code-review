import * as assert from 'assert';
import {
	buildFileHealthMap,
	computeFileHealthSummary,
	detectRegressions,
	getHotspots,
	shouldBlockCommit,
	formatRegressionWarning,
} from '../codeHealth';
import type { ReviewScore } from '../reviewScore';

function makeScore(
	id: string,
	timestamp: string,
	filesReviewed: string[],
	scoreValue = 100,
	findingCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
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

suite('Code Health Test Suite', () => {
	suite('buildFileHealthMap', () => {
		test('groups entries by file path', () => {
			const scores = [
				makeScore('r1', '2025-01-01T00:00:00Z', ['src/a.ts', 'src/b.ts'], 80),
				makeScore('r2', '2025-01-02T00:00:00Z', ['src/a.ts'], 90),
			];
			const map = buildFileHealthMap(scores);

			assert.strictEqual(map.size, 2);
			assert.strictEqual(map.get('src/a.ts')?.length, 2);
			assert.strictEqual(map.get('src/b.ts')?.length, 1);
		});

		test('sorts entries most recent first', () => {
			const scores = [
				makeScore('r1', '2025-01-01T00:00:00Z', ['src/a.ts'], 80),
				makeScore('r2', '2025-01-03T00:00:00Z', ['src/a.ts'], 90),
				makeScore('r3', '2025-01-02T00:00:00Z', ['src/a.ts'], 85),
			];
			const map = buildFileHealthMap(scores);
			const entries = map.get('src/a.ts')!;

			assert.strictEqual(entries[0].score, 90); // Jan 3 — most recent
			assert.strictEqual(entries[1].score, 85); // Jan 2
			assert.strictEqual(entries[2].score, 80); // Jan 1
		});

		test('strips a/ and b/ diff path prefixes', () => {
			const scores = [
				makeScore('r1', '2025-01-01T00:00:00Z', ['b/src/a.ts'], 80),
			];
			const map = buildFileHealthMap(scores);
			assert.ok(map.has('src/a.ts'));
		});

		test('skips scores with no filesReviewed', () => {
			const scores = [
				makeScore('r1', '2025-01-01T00:00:00Z', [], 80),
			];
			const map = buildFileHealthMap(scores);
			assert.strictEqual(map.size, 0);
		});
	});

	suite('computeFileHealthSummary', () => {
		test('returns correct summary for multiple entries', () => {
			const entries = [
				{ filePath: 'src/a.ts', score: 70, findingCounts: { critical: 1, high: 0, medium: 0, low: 0, info: 0 }, timestamp: '2025-01-03T00:00:00Z', reviewId: 'r3' },
				{ filePath: 'src/a.ts', score: 90, findingCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, timestamp: '2025-01-01T00:00:00Z', reviewId: 'r1' },
			];
			const summary = computeFileHealthSummary('src/a.ts', entries);

			assert.strictEqual(summary.currentScore, 70);
			assert.strictEqual(summary.previousScore, 90);
			assert.strictEqual(summary.delta, -20);
			assert.strictEqual(summary.averageScore, 80);
			assert.strictEqual(summary.reviewCount, 2);
		});

		test('returns defaults for empty entries', () => {
			const summary = computeFileHealthSummary('src/a.ts', []);
			assert.strictEqual(summary.currentScore, 100);
			assert.strictEqual(summary.averageScore, 100);
			assert.strictEqual(summary.delta, undefined);
			assert.strictEqual(summary.previousScore, undefined);
			assert.strictEqual(summary.reviewCount, 0);
		});

		test('delta is undefined for single entry', () => {
			const entries = [
				{ filePath: 'src/a.ts', score: 80, findingCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, timestamp: '2025-01-01T00:00:00Z', reviewId: 'r1' },
			];
			const summary = computeFileHealthSummary('src/a.ts', entries);
			assert.strictEqual(summary.delta, undefined);
			assert.strictEqual(summary.previousScore, undefined);
		});
	});

	suite('detectRegressions', () => {
		test('detects regression when score drops by threshold or more', () => {
			const history = [
				makeScore('old', '2025-01-01T00:00:00Z', ['src/a.ts'], 90),
			];
			const current = makeScore('new', '2025-01-02T00:00:00Z', ['src/a.ts'], 75);

			const result = detectRegressions(current, [...history, current], 10);
			assert.strictEqual(result.hasRegressions, true);
			assert.strictEqual(result.regressions.length, 1);
			assert.strictEqual(result.regressions[0].previousScore, 90);
			assert.strictEqual(result.regressions[0].currentScore, 75);
			assert.strictEqual(result.regressions[0].delta, -15);
		});

		test('no regression when score drop is below threshold', () => {
			const history = [
				makeScore('old', '2025-01-01T00:00:00Z', ['src/a.ts'], 90),
			];
			const current = makeScore('new', '2025-01-02T00:00:00Z', ['src/a.ts'], 85);

			const result = detectRegressions(current, [...history, current], 10);
			assert.strictEqual(result.hasRegressions, false);
		});

		test('no regression when score improves', () => {
			const history = [
				makeScore('old', '2025-01-01T00:00:00Z', ['src/a.ts'], 70),
			];
			const current = makeScore('new', '2025-01-02T00:00:00Z', ['src/a.ts'], 90);

			const result = detectRegressions(current, [...history, current], 10);
			assert.strictEqual(result.hasRegressions, false);
		});

		test('no regression for first review of a file', () => {
			const current = makeScore('new', '2025-01-02T00:00:00Z', ['src/new-file.ts'], 60);
			const result = detectRegressions(current, [current], 10);
			assert.strictEqual(result.hasRegressions, false);
		});

		test('detects regressions across multiple files', () => {
			const history = [
				makeScore('old1', '2025-01-01T00:00:00Z', ['src/a.ts'], 90),
				makeScore('old2', '2025-01-01T00:00:00Z', ['src/b.ts'], 85),
			];
			const current = makeScore('new', '2025-01-02T00:00:00Z', ['src/a.ts', 'src/b.ts'], 60);

			const result = detectRegressions(current, [...history, current], 10);
			assert.strictEqual(result.hasRegressions, true);
			assert.strictEqual(result.regressions.length, 2);
		});
	});

	suite('getHotspots', () => {
		test('returns files sorted by lowest score first', () => {
			const scores = [
				makeScore('r1', '2025-01-01T00:00:00Z', ['src/good.ts'], 95),
				makeScore('r2', '2025-01-01T00:00:00Z', ['src/bad.ts'], 40),
				makeScore('r3', '2025-01-01T00:00:00Z', ['src/mid.ts'], 70),
			];
			const hotspots = getHotspots(scores, 2);

			assert.strictEqual(hotspots.length, 2);
			assert.strictEqual(hotspots[0].filePath, 'src/bad.ts');
			assert.strictEqual(hotspots[1].filePath, 'src/mid.ts');
		});

		test('respects count limit', () => {
			const scores = [
				makeScore('r1', '2025-01-01T00:00:00Z', ['src/a.ts'], 50),
				makeScore('r2', '2025-01-01T00:00:00Z', ['src/b.ts'], 60),
				makeScore('r3', '2025-01-01T00:00:00Z', ['src/c.ts'], 70),
			];
			const hotspots = getHotspots(scores, 1);
			assert.strictEqual(hotspots.length, 1);
		});
	});

	suite('shouldBlockCommit', () => {
		test('returns true when blockOnRegression is true and regressions exist', () => {
			const result = { regressions: [{ filePath: 'x.ts', previousScore: 90, currentScore: 70, delta: -20 }], hasRegressions: true };
			const config = { enabled: true, regressionThreshold: 10, blockOnRegression: true, hotspotCount: 15 };
			assert.strictEqual(shouldBlockCommit(result, config), true);
		});

		test('returns false when blockOnRegression is false', () => {
			const result = { regressions: [{ filePath: 'x.ts', previousScore: 90, currentScore: 70, delta: -20 }], hasRegressions: true };
			const config = { enabled: true, regressionThreshold: 10, blockOnRegression: false, hotspotCount: 15 };
			assert.strictEqual(shouldBlockCommit(result, config), false);
		});

		test('returns false when no regressions', () => {
			const result = { regressions: [], hasRegressions: false };
			const config = { enabled: true, regressionThreshold: 10, blockOnRegression: true, hotspotCount: 15 };
			assert.strictEqual(shouldBlockCommit(result, config), false);
		});
	});

	suite('formatRegressionWarning', () => {
		test('returns empty string for no regressions', () => {
			const result = { regressions: [], hasRegressions: false };
			assert.strictEqual(formatRegressionWarning(result), '');
		});

		test('formats single regression', () => {
			const result = {
				regressions: [{ filePath: 'src/a.ts', previousScore: 90, currentScore: 70, delta: -20 }],
				hasRegressions: true,
			};
			const warning = formatRegressionWarning(result);
			assert.ok(warning.includes('src/a.ts'));
			assert.ok(warning.includes('90'));
			assert.ok(warning.includes('70'));
		});

		test('formats multiple regressions', () => {
			const result = {
				regressions: [
					{ filePath: 'src/a.ts', previousScore: 90, currentScore: 70, delta: -20 },
					{ filePath: 'src/b.ts', previousScore: 80, currentScore: 60, delta: -20 },
				],
				hasRegressions: true,
			};
			const warning = formatRegressionWarning(result);
			assert.ok(warning.includes('2 files'));
		});
	});
});
