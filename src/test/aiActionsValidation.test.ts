import * as assert from 'assert';
import { validateGeneratedFix } from '../commands/aiActions';

suite('AI Actions Validation Test Suite', () => {
	test('accepts direct replacement code', () => {
		assert.deepStrictEqual(
			validateGeneratedFix('const total = items.reduce((sum, item) => sum + item.price, 0);', 'const total = 0;', 'typescript'),
			{ valid: true },
		);
	});

	test('rejects empty fixes, markdown fences, and diff hunks', () => {
		assert.match(validateGeneratedFix('   ', 'const x = 1;', 'typescript').reason!, /empty/);
		assert.match(validateGeneratedFix('```ts\nconst x = 2;\n```', 'const x = 1;', 'typescript').reason!, /markdown fences/);
		assert.match(validateGeneratedFix('@@ -1 +1 @@\n-const x = 1;\n+const x = 2;', 'const x = 1;', 'typescript').reason!, /diff/);
	});

	test('rejects instruction text instead of replacement code', () => {
		const result = validateGeneratedFix(
			'// In src/example.ts, replace the existing function with this implementation:',
			'function run() {}',
			'typescript',
		);

		assert.strictEqual(result.valid, false);
		assert.match(result.reason!, /instructions/);
	});

	test('rejects added imports when the original snippet did not include imports', () => {
		const result = validateGeneratedFix(
			"import { join } from 'path';\nconst fullPath = join(root, child);",
			'const fullPath = `${root}/${child}`;',
			'typescript',
		);

		assert.strictEqual(result.valid, false);
		assert.match(result.reason!, /adds imports/);
	});

	test('allows imports when replacing an existing import section or non-JS code', () => {
		assert.strictEqual(
			validateGeneratedFix(
				"import { join, resolve } from 'path';",
				"import { join } from 'path';",
				'typescript',
			).valid,
			true,
		);
		assert.strictEqual(
			validateGeneratedFix(
				'from pathlib import Path\npath = Path(root) / child',
				'path = root + "/" + child',
				'python',
			).valid,
			true,
		);
	});
});
