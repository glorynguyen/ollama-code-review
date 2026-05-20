import * as assert from 'assert';
import { extractChangedFiles, extractChangedLines, parseImports } from '../context/importParser';

suite('Import Parser Test Suite', () => {
	test('parses static imports, re-exports, requires, and dynamic imports', () => {
		const imports = parseImports([
			"import React, { useEffect, type ComponentProps as Props } from 'react';",
			"import * as utils from './utils';",
			"import './side-effects';",
			"export { buildPrompt, parseResult as parse } from '../reviewPromptBuilder';",
			"export * as schema from '@/contentstack/schema';",
			"const legacy = require('src/legacy');",
			"const dynamic = await import('./lazy');",
			"const ignored = await import(`./template-${name}`);",
		].join('\n'));

		assert.deepStrictEqual(imports.map(item => item.specifier), [
			'react',
			'./utils',
			'./side-effects',
			'../reviewPromptBuilder',
			'@/contentstack/schema',
			'src/legacy',
			'./lazy',
		]);
		assert.deepStrictEqual(imports[0].symbols, ['default', 'useEffect', 'ComponentProps']);
		assert.strictEqual(imports[0].isRelative, false);
		assert.strictEqual(imports[1].isNamespace, true);
		assert.strictEqual(imports[4].isRelative, true);
		assert.strictEqual(imports[5].isNamespace, true);
	});

	test('normalizes multiline import and export blocks', () => {
		const imports = parseImports([
			'import {',
			'  alpha,',
			'  beta as localBeta,',
			"  // } inside comments should not end the block",
			"} from './multi';",
			'export type {',
			'  ReviewAnchor,',
			'  StructuredReviewFinding,',
			"} from './types';",
		].join('\n'));

		assert.deepStrictEqual(imports, [
			{
				specifier: './multi',
				isRelative: true,
				line: 1,
				symbols: ['alpha', 'beta'],
				isNamespace: false,
			},
			{
				specifier: './types',
				isRelative: true,
				line: 2,
				symbols: ['ReviewAnchor', 'StructuredReviewFinding'],
				isNamespace: false,
			},
		]);
	});

	test('deduplicates specifiers and skips comment-only lines', () => {
		const imports = parseImports([
			"// import skipped from './commented';",
			"import { one } from './shared';",
			"import { two } from './shared';",
			" * import alsoSkipped from './doc-comment';",
		].join('\n'));

		assert.deepStrictEqual(imports.map(item => item.specifier), ['./shared']);
		assert.deepStrictEqual(imports[0].symbols, ['one']);
	});

	test('extracts changed files and new-file line numbers from unified diffs', () => {
		const diff = [
			'diff --git a/src/old.ts b/src/new.ts',
			'@@ -10,4 +20,5 @@',
			' context',
			'-removed',
			'+added',
			' context',
			'+second added',
			'diff --git a/src/other.ts b/src/other.ts',
			'@@ -1,2 +1,2 @@',
			'-old',
			'+new',
		].join('\n');

		assert.deepStrictEqual(extractChangedFiles(diff), ['src/new.ts', 'src/other.ts']);

		const lines = extractChangedLines(diff);
		assert.deepStrictEqual([...lines.get('src/new.ts')!], [21, 23]);
		assert.deepStrictEqual([...lines.get('src/other.ts')!], [1]);
	});

	test('handles unclosed multiline import/export blocks gracefully', () => {
		const content = [
			'import {',
			'  unclosedSymbol',
		].join('\n');
		// Should collect but not crash on unclosed block
		const imports = parseImports(content);
		assert.strictEqual(imports.length, 0); // parsed symbols/specifier is empty
	});

	test('skips unmatched diff headers in extractChangedLines', () => {
		const diff = [
			'some random git diff metadata header',
			'diff --git a/src/old.ts b/src/new.ts',
			'@@ -1,2 +1,2 @@',
			'-old',
			'+new',
		].join('\n');
		const lines = extractChangedLines(diff);
		assert.strictEqual(lines.size, 1);
		assert.ok(lines.has('src/new.ts'));
	});
});
