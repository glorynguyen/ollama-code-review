/**
 * Unit tests for src/utils.ts
 *
 * Covers: escapeHtml, resolvePrompt, extractToolCalls, generateToolCallId
 */

import * as assert from 'assert';
import { escapeHtml, resolvePrompt, extractToolCalls, generateToolCallId } from '../utils';

suite('Utils Test Suite', () => {

	// ─── escapeHtml ──────────────────────────────────────────────────────────

	suite('escapeHtml', () => {
		test('escapes ampersands', () => {
			assert.strictEqual(escapeHtml('a & b'), 'a &amp; b');
		});

		test('escapes angle brackets', () => {
			assert.strictEqual(escapeHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
		});

		test('escapes quotes', () => {
			assert.strictEqual(escapeHtml('"hello" & \'world\''), '&quot;hello&quot; &amp; &#039;world&#039;');
		});

		test('returns empty string unchanged', () => {
			assert.strictEqual(escapeHtml(''), '');
		});

		test('leaves safe text unchanged', () => {
			assert.strictEqual(escapeHtml('Hello World 123'), 'Hello World 123');
		});

		test('handles multiple special characters together', () => {
			assert.strictEqual(escapeHtml('<a href="x&y">'), '&lt;a href=&quot;x&amp;y&quot;&gt;');
		});
	});

	// ─── resolvePrompt ───────────────────────────────────────────────────────

	suite('resolvePrompt', () => {
		test('replaces known variables', () => {
			const template = 'Review ${code} with ${frameworks}';
			const result = resolvePrompt(template, { code: 'my diff', frameworks: 'React' });
			assert.strictEqual(result, 'Review my diff with React');
		});

		test('leaves unknown variables unchanged', () => {
			const template = 'Hello ${name}, your ${unknown} is ready';
			const result = resolvePrompt(template, { name: 'World' });
			assert.strictEqual(result, 'Hello World, your ${unknown} is ready');
		});

		test('handles empty variables map', () => {
			const template = '${foo} ${bar}';
			assert.strictEqual(resolvePrompt(template, {}), '${foo} ${bar}');
		});

		test('handles template with no variables', () => {
			assert.strictEqual(resolvePrompt('plain text', { foo: 'bar' }), 'plain text');
		});

		test('handles empty string template', () => {
			assert.strictEqual(resolvePrompt('', { foo: 'bar' }), '');
		});

		test('replaces multiple occurrences of same variable', () => {
			const template = '${x} + ${x}';
			assert.strictEqual(resolvePrompt(template, { x: '1' }), '1 + 1');
		});

		test('handles variable values with special regex characters', () => {
			const result = resolvePrompt('${v}', { v: 'foo$bar' });
			assert.strictEqual(result, 'foo$bar');
		});
	});

	// ─── generateToolCallId ──────────────────────────────────────────────────

	suite('generateToolCallId', () => {
		test('generates a string starting with call_', () => {
			const id = generateToolCallId();
			assert.ok(id.startsWith('call_'));
		});

		test('generates unique ids', () => {
			const ids = new Set(Array.from({ length: 50 }, () => generateToolCallId()));
			assert.strictEqual(ids.size, 50);
		});

		test('has expected format (call_ + 8 hex chars)', () => {
			const id = generateToolCallId();
			assert.match(id, /^call_[a-f0-9]{8}$/);
		});
	});

	// ─── extractToolCalls ────────────────────────────────────────────────────

	suite('extractToolCalls', () => {
		test('extracts a single tool call from compact JSON', () => {
			// Use compact JSON (no spaces in values) so balanced brace and regex produce same dedup key
			const text = '{"tool":"readFile","args":{"path":"/foo.ts"}}';
			const result = extractToolCalls(text);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].name, 'readFile');
			assert.ok(result[0].arguments.includes('/foo.ts'));
		});

		test('finds tool calls from text with multiple calls', () => {
			const text = `
Some text before
{"tool":"readFile","args":{"path":"a.ts"}}
More text
{"tool":"writeFile","args":{"path":"b.ts","content":"hello"}}
`;
			const result = extractToolCalls(text);
			assert.ok(result.length >= 2);
			assert.ok(result.some(r => r.name === 'readFile'));
			assert.ok(result.some(r => r.name === 'writeFile'));
		});

		test('deduplicates identical compact tool calls', () => {
			const text = `
{"tool":"readFile","args":{"path":"a.ts"}}
{"tool":"readFile","args":{"path":"a.ts"}}
`;
			const result = extractToolCalls(text);
			assert.strictEqual(result.length, 1);
		});

		test('returns empty array for text without tool calls', () => {
			const result = extractToolCalls('Hello, no tool calls here.');
			assert.deepStrictEqual(result, []);
		});

		test('handles nested JSON in args', () => {
			const text = '{"tool":"execute","args":{"options":{"timeout":100,"retry":true}}}';
			const result = extractToolCalls(text);
			assert.ok(result.length >= 1);
			assert.strictEqual(result[0].name, 'execute');
			const args = JSON.parse(result[0].arguments);
			assert.strictEqual(args.options.timeout, 100);
		});

		test('handles tool call inside markdown code fence', () => {
			const text = '```json\n{"tool":"readFile","args":{"path":"x.ts"}}\n```';
			const result = extractToolCalls(text);
			assert.ok(result.length >= 1);
			assert.strictEqual(result[0].name, 'readFile');
		});

		test('handles empty text', () => {
			assert.deepStrictEqual(extractToolCalls(''), []);
		});
	});
});
