import * as assert from 'assert';
import { buildBranchDiffClipboardContent } from '../commands';

suite('Copy Branch Diff for LLM Test Suite', () => {
	test('formats basic clipboard content with header and files list', () => {
		const result = buildBranchDiffClipboardContent(
			'main',
			'feature-branch',
			['src/app.ts', 'src/utils.ts'],
			'+const x = 1;',
		);

		assert.ok(result.includes('## Code changes between `main` and `feature-branch`'));
		assert.ok(result.includes('**Changed files (2):**'));
		assert.ok(result.includes('- src/app.ts'));
		assert.ok(result.includes('- src/utils.ts'));
		assert.ok(result.includes('### Diff'));
		assert.ok(result.includes('```diff'));
		assert.ok(result.includes('+const x = 1;'));
		assert.ok(result.includes('```'));
	});

	test('includes context section when provided', () => {
		const context = '\n## Related Files\n\n### src/types.ts\n```ts\nexport type Foo = string;\n```';
		const result = buildBranchDiffClipboardContent(
			'develop',
			'feature/login',
			['src/auth.ts'],
			'-old\n+new',
			context,
		);

		assert.ok(result.includes(context));
		assert.ok(result.includes('## Related Files'));
	});

	test('omits context section when not provided', () => {
		const result = buildBranchDiffClipboardContent(
			'main',
			'fix/bug',
			['src/fix.ts'],
			'+fix',
		);

		// Should end with the closing code fence
		const lines = result.split('\n');
		assert.strictEqual(lines[lines.length - 1], '```');
	});

	test('omits context section when empty string', () => {
		const result = buildBranchDiffClipboardContent(
			'main',
			'fix/bug',
			['src/fix.ts'],
			'+fix',
			'',
		);

		const lines = result.split('\n');
		assert.strictEqual(lines[lines.length - 1], '```');
	});

	test('handles single file correctly with singular count', () => {
		const result = buildBranchDiffClipboardContent(
			'main',
			'hotfix',
			['package.json'],
			'+  "version": "2.0.0"',
		);

		assert.ok(result.includes('**Changed files (1):**'));
		assert.ok(result.includes('- package.json'));
	});

	test('handles empty files list', () => {
		const result = buildBranchDiffClipboardContent(
			'main',
			'branch',
			[],
			'+line',
		);

		assert.ok(result.includes('**Changed files (0):**'));
	});

	test('escapes backticks in branch names within markdown header', () => {
		const result = buildBranchDiffClipboardContent(
			'release/v1.0',
			'feature/add-tests',
			['src/test.ts'],
			'+test',
		);

		assert.ok(result.includes('`release/v1.0`'));
		assert.ok(result.includes('`feature/add-tests`'));
	});

	test('preserves diff content exactly as-is', () => {
		const diff = [
			'diff --git a/src/app.ts b/src/app.ts',
			'--- a/src/app.ts',
			'+++ b/src/app.ts',
			'@@ -1,3 +1,3 @@',
			' import { foo } from "./utils";',
			'-const value = 1;',
			'+const value = 2;',
			' export default value;',
		].join('\n');

		const result = buildBranchDiffClipboardContent(
			'main',
			'dev',
			['src/app.ts'],
			diff,
		);

		assert.ok(result.includes(diff));
	});

	test('produces valid markdown structure', () => {
		const result = buildBranchDiffClipboardContent(
			'main',
			'feature',
			['a.ts', 'b.ts'],
			'+code',
			'\n## Context\nsome context',
		);

		// Verify ordering: header, files, diff block, context
		const headerIdx = result.indexOf('## Code changes between');
		const filesIdx = result.indexOf('**Changed files');
		const diffIdx = result.indexOf('### Diff');
		const contextIdx = result.indexOf('## Context');

		assert.ok(headerIdx < filesIdx, 'header before files list');
		assert.ok(filesIdx < diffIdx, 'files list before diff');
		assert.ok(diffIdx < contextIdx, 'diff before context');
	});
});
