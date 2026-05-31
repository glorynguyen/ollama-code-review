import * as assert from 'assert';
import { formatRelativeTime } from '../utils/time';
import { isRestorableReviewScore, type ReviewScore } from '../reviewScore';
import { FindingsTreeProvider } from '../reviewFindings';

function baseScore(overrides: Partial<ReviewScore> = {}): ReviewScore {
	return {
		id: 'id-1',
		timestamp: new Date().toISOString(),
		repo: 'repo',
		branch: 'main',
		model: 'test-model',
		profile: 'general',
		score: 100,
		correctness: 100,
		security: 100,
		maintainability: 100,
		performance: 100,
		findingCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
		...overrides,
	};
}

const validFindings = { summary: 'All good', findings: [] } as unknown as ReviewScore['findings'];

suite('F-048 Findings Persistence Test Suite', () => {
	// ─── formatRelativeTime ──────────────────────────────────────────────────

	suite('formatRelativeTime', () => {
		const now = 1_700_000_000_000;

		test('reports recent timestamps as "just now"', () => {
			assert.strictEqual(formatRelativeTime(now, now), 'just now');
			assert.strictEqual(formatRelativeTime(now - 10_000, now), 'just now');
		});

		test('clamps future timestamps (clock skew) to "just now"', () => {
			assert.strictEqual(formatRelativeTime(now + 60_000, now), 'just now');
		});

		test('boundary: exactly 44_999ms is still "just now"', () => {
			assert.strictEqual(formatRelativeTime(now - 44_999, now), 'just now');
		});

		test('boundary: exactly 45_000ms rounds to "1m ago"', () => {
			assert.strictEqual(formatRelativeTime(now - 45_000, now), '1m ago');
		});

		test('formats minutes', () => {
			assert.strictEqual(formatRelativeTime(now - 5 * 60_000, now), '5m ago');
			assert.strictEqual(formatRelativeTime(now - 59 * 60_000, now), '59m ago');
		});

		test('boundary: 60 minutes rounds to "1h ago"', () => {
			assert.strictEqual(formatRelativeTime(now - 60 * 60_000, now), '1h ago');
		});

		test('formats hours', () => {
			assert.strictEqual(formatRelativeTime(now - 2 * 3_600_000, now), '2h ago');
			assert.strictEqual(formatRelativeTime(now - 23 * 3_600_000, now), '23h ago');
		});

		test('boundary: 24 hours rounds to "1d ago"', () => {
			assert.strictEqual(formatRelativeTime(now - 24 * 3_600_000, now), '1d ago');
		});

		test('formats days', () => {
			assert.strictEqual(formatRelativeTime(now - 3 * 86_400_000, now), '3d ago');
		});

		test('formats large day counts', () => {
			assert.strictEqual(formatRelativeTime(now - 30 * 86_400_000, now), '30d ago');
			assert.strictEqual(formatRelativeTime(now - 365 * 86_400_000, now), '365d ago');
		});

		test('handles NaN input gracefully', () => {
			assert.strictEqual(formatRelativeTime(Number.NaN, now), 'unknown');
		});

		test('handles Infinity input gracefully', () => {
			assert.strictEqual(formatRelativeTime(Number.POSITIVE_INFINITY, now), 'unknown');
		});

		test('handles negative Infinity input gracefully', () => {
			assert.strictEqual(formatRelativeTime(Number.NEGATIVE_INFINITY, now), 'unknown');
		});

		test('uses Date.now() as default for nowMs parameter', () => {
			// A timestamp from far in the past should produce a "Xd ago" result
			const pastTimestamp = Date.now() - 10 * 86_400_000;
			assert.strictEqual(formatRelativeTime(pastTimestamp), '10d ago');
		});
	});

	// ─── isRestorableReviewScore ─────────────────────────────────────────────

	suite('isRestorableReviewScore', () => {
		test('accepts a score with valid findings and diff', () => {
			assert.strictEqual(
				isRestorableReviewScore(baseScore({ findings: validFindings, diff: 'diff --git a b' })),
				true,
			);
		});

		test('accepts a score with non-empty findings array', () => {
			const findings = {
				summary: 'Issues found',
				findings: [{ severity: 'high', message: 'Bug', file: 'a.ts', line: 1 }],
			} as unknown as ReviewScore['findings'];
			assert.strictEqual(
				isRestorableReviewScore(baseScore({ findings, diff: 'diff content' })),
				true,
			);
		});

		test('rejects undefined', () => {
			assert.strictEqual(isRestorableReviewScore(undefined), false);
		});

		test('rejects a score with no diff', () => {
			assert.strictEqual(isRestorableReviewScore(baseScore({ findings: validFindings })), false);
		});

		test('rejects a score with an empty diff', () => {
			assert.strictEqual(isRestorableReviewScore(baseScore({ findings: validFindings, diff: '' })), false);
		});

		test('rejects a score with no findings', () => {
			assert.strictEqual(isRestorableReviewScore(baseScore({ diff: 'some diff' })), false);
		});

		test('rejects a score with findings set to null', () => {
			assert.strictEqual(
				isRestorableReviewScore(baseScore({ findings: null as unknown as ReviewScore['findings'], diff: 'd' })),
				false,
			);
		});

		test('rejects a score with findings as a primitive', () => {
			assert.strictEqual(
				isRestorableReviewScore(baseScore({ findings: 'string' as unknown as ReviewScore['findings'], diff: 'd' })),
				false,
			);
		});

		test('rejects a score with malformed findings (missing findings array)', () => {
			const malformed = { summary: 'x' } as unknown as ReviewScore['findings'];
			assert.strictEqual(isRestorableReviewScore(baseScore({ findings: malformed, diff: 'd' })), false);
		});

		test('rejects a score with malformed findings (missing summary)', () => {
			const malformed = { findings: [] } as unknown as ReviewScore['findings'];
			assert.strictEqual(isRestorableReviewScore(baseScore({ findings: malformed, diff: 'd' })), false);
		});

		test('rejects a score with malformed findings (findings is not an array)', () => {
			const malformed = { summary: 'ok', findings: 'not-array' } as unknown as ReviewScore['findings'];
			assert.strictEqual(isRestorableReviewScore(baseScore({ findings: malformed, diff: 'd' })), false);
		});

		test('rejects a score with malformed findings (summary is not a string)', () => {
			const malformed = { summary: 123, findings: [] } as unknown as ReviewScore['findings'];
			assert.strictEqual(isRestorableReviewScore(baseScore({ findings: malformed, diff: 'd' })), false);
		});
	});

	// ─── FindingsTreeProvider — lastReviewedAt / setFindings / clear ──────────

	suite('FindingsTreeProvider — F-048 timestamp tracking', () => {
		const sampleDiff = [
			'diff --git a/src/foo.ts b/src/foo.ts',
			'--- a/src/foo.ts',
			'+++ b/src/foo.ts',
			'@@ -1,2 +1,3 @@',
			' const a = 1;',
			'+const b = 2;',
			' export { a };',
		].join('\n');

		// A structured review JSON that produces at least one finding
		const reviewWithFinding = JSON.stringify({
			schemaVersion: '1.0.0',
			summary: 'Found issues.',
			findings: [{
				severity: 'medium',
				message: 'Unused variable',
				file: 'src/foo.ts',
				line: 2,
			}],
		});

		// A structured review with no findings
		const reviewEmpty = JSON.stringify({
			schemaVersion: '1.0.0',
			summary: 'No issues found.',
			findings: [],
		});

		test('lastReviewedAt is undefined initially', () => {
			const provider = new FindingsTreeProvider();
			assert.strictEqual(provider.lastReviewedAt, undefined);
		});

		test('setFindings sets lastReviewedAt to provided timestamp', () => {
			const provider = new FindingsTreeProvider();
			const ts = 1_700_000_000_000;
			provider.setFindings(reviewWithFinding, sampleDiff, ts);
			assert.strictEqual(provider.lastReviewedAt, ts);
		});

		test('setFindings defaults to approximately Date.now() when reviewedAt is omitted', () => {
			const provider = new FindingsTreeProvider();
			const before = Date.now();
			provider.setFindings(reviewWithFinding, sampleDiff);
			const after = Date.now();
			assert.ok(provider.lastReviewedAt! >= before);
			assert.ok(provider.lastReviewedAt! <= after);
		});

		test('setFindings updates lastReviewedAt on subsequent calls', () => {
			const provider = new FindingsTreeProvider();
			provider.setFindings(reviewEmpty, sampleDiff, 1000);
			assert.strictEqual(provider.lastReviewedAt, 1000);
			provider.setFindings(reviewEmpty, sampleDiff, 2000);
			assert.strictEqual(provider.lastReviewedAt, 2000);
		});

		test('clear() resets lastReviewedAt to undefined', () => {
			const provider = new FindingsTreeProvider();
			provider.setFindings(reviewWithFinding, sampleDiff, 1_700_000_000_000);
			assert.strictEqual(provider.lastReviewedAt, 1_700_000_000_000);
			provider.clear();
			assert.strictEqual(provider.lastReviewedAt, undefined);
		});

		test('setFindings fires onDidChangeTreeData event', () => {
			const provider = new FindingsTreeProvider();
			let fired = false;
			provider.onDidChangeTreeData(() => { fired = true; });
			provider.setFindings(reviewEmpty, sampleDiff, 1000);
			assert.strictEqual(fired, true);
		});

		test('clear() fires onDidChangeTreeData event', () => {
			const provider = new FindingsTreeProvider();
			provider.setFindings(reviewEmpty, sampleDiff, 1000);
			let fired = false;
			provider.onDidChangeTreeData(() => { fired = true; });
			provider.clear();
			assert.strictEqual(fired, true);
		});

		test('setFindings populates findings count from structured review', () => {
			const provider = new FindingsTreeProvider();
			provider.setFindings(reviewWithFinding, sampleDiff, 1000);
			assert.ok(provider.count >= 1, `Expected at least 1 finding, got ${provider.count}`);
		});

		test('clear() zeroes the findings count', () => {
			const provider = new FindingsTreeProvider();
			provider.setFindings(reviewWithFinding, sampleDiff, 1000);
			provider.clear();
			assert.strictEqual(provider.count, 0);
		});
	});
});
