import * as assert from 'assert';
import { filterDiff, shouldIgnoreFile } from '../diffFilter';

suite('Diff Filter Test Suite', () => {
	test('filters lockfile diffs by default', () => {
		const diff = [
			'diff --git a/src/app.ts b/src/app.ts',
			'index 1111111..2222222 100644',
			'--- a/src/app.ts',
			'+++ b/src/app.ts',
			'@@ -1 +1 @@',
			'-export const value = 1;',
			'+export const value = 2;',
			'diff --git a/yarn.lock b/yarn.lock',
			'index 1111111..2222222 100644',
			'--- a/yarn.lock',
			'+++ b/yarn.lock',
			'@@ -1 +1 @@',
			'-left-pad@1.0.0:',
			'+left-pad@1.1.0:',
			'diff --git a/packages/api/package-lock.json b/packages/api/package-lock.json',
			'index 1111111..2222222 100644',
			'--- a/packages/api/package-lock.json',
			'+++ b/packages/api/package-lock.json',
			'@@ -1 +1 @@',
			'-{"lockfileVersion":2}',
			'+{"lockfileVersion":3}',
		].join('\n');

		const result = filterDiff(diff);

		assert.strictEqual(result.stats.totalFiles, 3);
		assert.strictEqual(result.stats.includedFiles, 1);
		assert.deepStrictEqual(result.stats.filteredFiles, [
			'yarn.lock',
			'packages/api/package-lock.json',
		]);
		assert.ok(result.filteredDiff.includes('src/app.ts'));
		assert.strictEqual(result.filteredDiff.includes('yarn.lock'), false);
		assert.strictEqual(result.filteredDiff.includes('package-lock.json'), false);
	});

	test('matches common lockfile paths', () => {
		const config = {
			ignorePaths: ['**/*.lock', '**/package-lock.json', '**/yarn.lock', '**/*-lock.yaml'],
			ignorePatterns: [],
			maxFileLines: 500,
			ignoreFormattingOnly: false,
		};

		assert.strictEqual(shouldIgnoreFile('yarn.lock', config), true);
		assert.strictEqual(shouldIgnoreFile('package-lock.json', config), true);
		assert.strictEqual(shouldIgnoreFile('apps/web/pnpm-lock.yaml', config), true);
		assert.strictEqual(shouldIgnoreFile('src/app.ts', config), false);
	});
});
