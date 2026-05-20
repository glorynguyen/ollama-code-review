import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import { filterDiff, shouldIgnoreFile, getFilterSummary, getDiffFilterConfigWithYaml } from '../diffFilter';
import { clearProjectConfigCache } from '../config/promptLoader';

suite('Diff Filter Test Suite', () => {
	teardown(() => {
		(globalThis as any).__vscodeTestConfig = undefined;
	});

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

		assert.strictEqual(shouldIgnoreFile('dist/vendor.min.js', {
			...config,
			ignorePaths: [],
			ignorePatterns: ['*.min.js'],
		}), true);
	});

	test('filters formatting-only changes', () => {
		const diff = [
			'diff --git a/src/app.ts b/src/app.ts',
			'--- a/src/app.ts',
			'+++ b/src/app.ts',
			'@@ -1,2 +1,2 @@',
			'-const x = 1;',
			'+    const x = 1;',
		].join('\n');

		const config = {
			ignorePaths: [],
			ignorePatterns: [],
			maxFileLines: 500,
			ignoreFormattingOnly: true,
		};

		const result = filterDiff(diff, config);
		assert.strictEqual(result.stats.includedFiles, 0);
		assert.deepStrictEqual(result.stats.filteredFiles, ['src/app.ts (formatting only)']);
	});

	test('identifies large files', () => {
		const diff = [
			'diff --git a/src/app.ts b/src/app.ts',
			'--- a/src/app.ts',
			'+++ b/src/app.ts',
			'@@ -1,4 +1,4 @@',
			'+line 1',
			'+line 2',
			'+line 3',
			'+line 4',
		].join('\n');

		const config = {
			ignorePaths: [],
			ignorePatterns: [],
			maxFileLines: 2,
			ignoreFormattingOnly: false,
		};

		const result = filterDiff(diff, config);
		assert.strictEqual(result.stats.includedFiles, 1);
		assert.deepStrictEqual(result.stats.largeFiles, ['src/app.ts (4 lines)']);
	});

	test('keeps real changes when formatting-only filtering is enabled', () => {
		const diff = [
			'diff --git a/src/app.ts b/src/app.ts',
			'--- a/src/app.ts',
			'+++ b/src/app.ts',
			'@@ -1 +1 @@',
			'-const value = 1;',
			'+const value = 2;',
		].join('\n');

		const result = filterDiff(diff, {
			ignorePaths: [],
			ignorePatterns: [],
			maxFileLines: 500,
			ignoreFormattingOnly: true,
		});

		assert.strictEqual(result.stats.includedFiles, 1);
		assert.strictEqual(result.stats.filteredFiles.length, 0);
	});

	test('generates correct filter summary messages', () => {
		assert.strictEqual(getFilterSummary({
			totalFiles: 0,
			includedFiles: 0,
			filteredFiles: [],
			largeFiles: [],
		}), null);
		
		const stats1 = {
			totalFiles: 5,
			includedFiles: 3,
			filteredFiles: ['yarn.lock'],
			largeFiles: []
		};
		assert.strictEqual(getFilterSummary(stats1), 'Filtered 1 file(s): yarn.lock');

		const stats2 = {
			totalFiles: 10,
			includedFiles: 5,
			filteredFiles: ['f1.ts', 'f2.ts', 'f3.ts', 'f4.ts'],
			largeFiles: ['large.ts (600 lines)']
		};
		assert.strictEqual(
			getFilterSummary(stats2),
			'Filtered 4 file(s): f1.ts, f2.ts, f3.ts... | Large file(s) included: large.ts (600 lines)'
		);
	});

	test('merges YAML diff filter overrides on top of settings', async () => {
		const configPath = path.join(process.cwd(), '.ollama-review.yaml');
		await fs.writeFile(configPath, [
			'diffFilter:',
			'  ignorePaths:',
			'    - "**/snapshots/**"',
			'  ignorePatterns:',
			'    - "*.fixture.ts"',
			'  maxFileLines: 12',
			'  ignoreFormattingOnly: true',
		].join('\n'));
		clearProjectConfigCache();

		try {
			const config = await getDiffFilterConfigWithYaml();
			assert.ok(config.ignorePaths.includes('**/snapshots/**'));
			assert.ok(config.ignorePatterns.includes('*.fixture.ts'));
			assert.strictEqual(config.maxFileLines, 12);
			assert.strictEqual(config.ignoreFormattingOnly, true);
		} finally {
			await fs.unlink(configPath);
			clearProjectConfigCache();
		}
	});

	test('keeps setting values when YAML has no diff filter overrides', async () => {
		const configPath = path.join(process.cwd(), '.ollama-review.yaml');
		await fs.writeFile(configPath, 'frameworks:\n  - TypeScript\n');
		clearProjectConfigCache();

		try {
			const config = await getDiffFilterConfigWithYaml();
			assert.strictEqual(config.maxFileLines, 500);
			assert.strictEqual(config.ignoreFormattingOnly, false);
		} finally {
			await fs.unlink(configPath);
			clearProjectConfigCache();
		}
	});

	test('keeps setting values when YAML diff filter object is empty', async () => {
		const configPath = path.join(process.cwd(), '.ollama-review.yaml');
		await fs.writeFile(configPath, 'diffFilter: {}\n');
		clearProjectConfigCache();

		try {
			const config = await getDiffFilterConfigWithYaml();
			assert.ok(config.ignorePaths.includes('**/node_modules/**'));
			assert.ok(config.ignorePatterns.includes('*.min.js'));
			assert.strictEqual(config.maxFileLines, 500);
			assert.strictEqual(config.ignoreFormattingOnly, false);
		} finally {
			await fs.unlink(configPath);
			clearProjectConfigCache();
		}
	});

	test('uses VS Code diff filter setting overrides', () => {
		(globalThis as any).__vscodeTestConfig = {
			diffFilter: {
				ignorePaths: ['**/custom/**'],
				ignorePatterns: ['*.snapshot.ts'],
				maxFileLines: 7,
				ignoreFormattingOnly: true,
			},
		};

		const result = filterDiff([
			'diff --git a/src/custom/file.ts b/src/custom/file.ts',
			'--- a/src/custom/file.ts',
			'+++ b/src/custom/file.ts',
			'@@ -1 +1 @@',
			'-const value = 1;',
			'+const value = 2;',
			'diff --git a/src/view.snapshot.ts b/src/view.snapshot.ts',
			'--- a/src/view.snapshot.ts',
			'+++ b/src/view.snapshot.ts',
			'@@ -1 +1 @@',
			'-old',
			'+new',
		].join('\n'));

		assert.deepStrictEqual(result.stats.filteredFiles, [
			'src/custom/file.ts',
			'src/view.snapshot.ts',
		]);
		assert.strictEqual(result.stats.includedFiles, 0);
	});

	test('ignores diff preamble text without file headers', () => {
		const result = filterDiff('not a diff\njust context', {
			ignorePaths: [],
			ignorePatterns: [],
			maxFileLines: 500,
			ignoreFormattingOnly: false,
		});

		assert.strictEqual(shouldIgnoreFile('', {
			ignorePaths: [],
			ignorePatterns: ['*.min.js'],
			maxFileLines: 500,
			ignoreFormattingOnly: false,
		}), false);
		assert.strictEqual(result.stats.totalFiles, 0);
	});
});
