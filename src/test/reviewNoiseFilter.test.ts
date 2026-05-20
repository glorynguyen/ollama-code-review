import * as assert from 'assert';
import { filterReviewNoise, normalizeReviewResult } from '../reviewFindings';

const diff = [
	'diff --git a/src/commands/index.ts b/src/commands/index.ts',
	'--- a/src/commands/index.ts',
	'+++ b/src/commands/index.ts',
	'@@ -162,6 +162,7 @@ import {',
	'  getLastPerformanceMetrics,',
	'+ setLastPerformanceMetrics,',
	'} from "./providerClients";',
].join('\n');

function structuredReview(findings: unknown[]): string {
	return JSON.stringify({
		schemaVersion: '1.0.0',
		summary: 'Review complete.',
		findings,
	});
}

suite('Review Noise Filter Test Suite', () => {
	test('suppresses speculative build-verifiable import/export findings', () => {
		const review = normalizeReviewResult(structuredReview([
			{
				id: 'finding-1',
				severity: 'high',
				title: 'Import of setLastPerformanceMetrics may reference non-exported function',
				summary: 'The function is imported from ./providerClients, but the diff only shows interface additions. If this function is not exported, the code will fail to compile.',
				confidence: 0.7,
				category: 'correctness',
				anchor: { file: 'src/commands/index.ts', line: 165 },
				evidence: [
					{
						kind: 'diff',
						summary: 'Function is imported but not shown as exported in the providerClients diff.',
						quote: 'setLastPerformanceMetrics,',
					},
				],
			},
		]), diff);

		const filtered = filterReviewNoise(review, { suppressBuildVerifiableFindings: true });

		assert.strictEqual(filtered.suppressedCount, 1);
		assert.strictEqual(filtered.result.findings.length, 0);
		assert.strictEqual(filtered.result.summary, 'I have reviewed the changes and found no significant issues.');
	});

	test('keeps high-confidence build findings when evidence is not speculative', () => {
		const review = normalizeReviewResult(structuredReview([
			{
				id: 'finding-1',
				severity: 'high',
				title: 'Confirmed missing export',
				summary: 'The module removed the export and the changed file still imports it, so the package will fail to compile.',
				confidence: 0.95,
				category: 'correctness',
				anchor: { file: 'src/commands/index.ts', line: 165 },
				evidence: [
					{
						kind: 'code',
						summary: 'Full context confirms the export was removed.',
					},
				],
			},
		]), diff);

		const filtered = filterReviewNoise(review, { suppressBuildVerifiableFindings: true });

		assert.strictEqual(filtered.suppressedCount, 0);
		assert.strictEqual(filtered.result.findings.length, 1);
	});

	test('keeps security findings even when tooling terms appear', () => {
		const review = normalizeReviewResult(structuredReview([
			{
				id: 'finding-1',
				severity: 'critical',
				title: 'Secret added to build configuration',
				summary: 'The diff adds a credential to a build script; this is a security vulnerability even if lint or build checks pass.',
				confidence: 0.6,
				category: 'security',
				anchor: { file: 'src/commands/index.ts', line: 165 },
				evidence: [
					{
						kind: 'diff',
						summary: 'A credential-like value is present in the changed build configuration.',
					},
				],
			},
		]), diff);

		const filtered = filterReviewNoise(review, { suppressBuildVerifiableFindings: true });

		assert.strictEqual(filtered.suppressedCount, 0);
		assert.strictEqual(filtered.result.findings.length, 1);
	});
});
