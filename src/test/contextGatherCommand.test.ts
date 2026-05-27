/**
 * /gather command — Unit Tests
 *
 * Covers the pure, VS-Code-free helpers in contextGatherCommand.ts:
 *   - extractSearchTerms  (keyword extraction + PascalCase/camelCase expansion)
 *   - mergeAndBudget      (deduplication, source ordering, char budget)
 *   - formatGatherPrompt  (prompt assembly for pasting into external LLMs)
 */

import * as assert from 'assert';
import {
	extractSearchTerms,
	mergeAndBudget,
	formatGatherPrompt,
} from '../chat/contextGatherCommand';
import type { GatheredChunk } from '../chat/contextGatherCommand';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeChunk(
	filePath: string,
	source: GatheredChunk['source'],
	score: number,
	content = 'file content',
	startLine?: number,
	endLine?: number,
): GatheredChunk {
	return { filePath, content, source, score, startLine, endLine };
}

// ─── extractSearchTerms ───────────────────────────────────────────────────────

suite('extractSearchTerms', () => {
	test('filters stopwords and returns lower-case terms', () => {
		const terms = extractSearchTerms('What is the billboard feature?');
		assert.ok(terms.includes('billboard'), 'should include "billboard"');
		assert.ok(terms.includes('feature'), 'should include "feature"');
		assert.ok(!terms.includes('what'), 'should exclude stopword "what"');
		assert.ok(!terms.includes('is'), 'should exclude stopword "is"');
		assert.ok(!terms.includes('the'), 'should exclude stopword "the"');
	});

	test('adds PascalCase variant of each meaningful word', () => {
		const terms = extractSearchTerms('billboard feature');
		assert.ok(terms.includes('Billboard'), 'should include PascalCase "Billboard"');
		assert.ok(terms.includes('Feature'), 'should include PascalCase "Feature"');
	});

	test('generates camelCase compound from consecutive word pairs', () => {
		const terms = extractSearchTerms('split screen');
		assert.ok(terms.includes('splitScreen'), 'should include camelCase compound "splitScreen"');
	});

	test('generates PascalCase full compound from consecutive pairs', () => {
		const terms = extractSearchTerms('split screen');
		assert.ok(terms.includes('SplitScreen'), 'should include PascalCase compound "SplitScreen"');
	});

	test('strips punctuation before processing', () => {
		const terms = extractSearchTerms('auth-token, session!');
		assert.ok(terms.includes('auth'), '"auth" should survive punctuation stripping');
		assert.ok(terms.includes('token'), '"token" should survive punctuation stripping');
		assert.ok(terms.includes('session'), '"session" should survive punctuation stripping');
	});

	test('falls back to first 5 raw words when all tokens are stopwords', () => {
		const terms = extractSearchTerms('is it in the to');
		// fallback: split on whitespace, keep words >= 2 chars, take first 5
		assert.ok(terms.length > 0, 'should not return empty array');
	});

	test('falls back for empty string', () => {
		const terms = extractSearchTerms('');
		assert.ok(Array.isArray(terms));
		assert.strictEqual(terms.length, 0);
	});

	test('filters single-character tokens', () => {
		const terms = extractSearchTerms('a b c billboard');
		assert.ok(!terms.some(t => t.length < 2), 'should not include single-char tokens');
		assert.ok(terms.includes('billboard'));
	});

	test('deduplicates identical terms', () => {
		const terms = extractSearchTerms('auth auth');
		const lowerAuthCount = terms.filter(t => t === 'auth').length;
		assert.strictEqual(lowerAuthCount, 1, 'should not duplicate "auth"');
	});

	test('handles multi-word query with three consecutive words', () => {
		const terms = extractSearchTerms('billboard split screen');
		// Compounds: billboardSplit, splitScreen and their PascalCase variants
		assert.ok(terms.includes('billboardSplit') || terms.includes('splitScreen'),
			'should generate at least one camelCase compound');
	});
});

// ─── mergeAndBudget ───────────────────────────────────────────────────────────

suite('mergeAndBudget', () => {
	test('returns empty array for empty input', () => {
		assert.deepStrictEqual(mergeAndBudget([]), []);
	});

	test('deduplicates chunks with the same filePath, keeping higher score', () => {
		const chunks = [
			makeChunk('src/auth.ts', 'filename', 0.4),
			makeChunk('src/auth.ts', 'content', 0.9),
		];
		const result = mergeAndBudget(chunks);
		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].score, 0.9);
		assert.strictEqual(result[0].source, 'content');
	});

	test('deduplicates keeping first when scores are equal (Map semantics: first wins for equal score)', () => {
		const chunks = [
			makeChunk('src/foo.ts', 'rag', 0.8),
			makeChunk('src/foo.ts', 'filename', 0.8),
		];
		const result = mergeAndBudget(chunks);
		assert.strictEqual(result.length, 1);
	});

	test('sorts rag before filename before content', () => {
		const chunks = [
			makeChunk('src/c.ts', 'content', 0.9),
			makeChunk('src/b.ts', 'filename', 0.9),
			makeChunk('src/a.ts', 'rag', 0.9),
		];
		const result = mergeAndBudget(chunks);
		assert.strictEqual(result[0].source, 'rag');
		assert.strictEqual(result[1].source, 'filename');
		assert.strictEqual(result[2].source, 'content');
	});

	test('within same source, sorts by score descending', () => {
		const chunks = [
			makeChunk('src/low.ts', 'filename', 0.3),
			makeChunk('src/high.ts', 'filename', 0.9),
			makeChunk('src/mid.ts', 'filename', 0.6),
		];
		const result = mergeAndBudget(chunks);
		assert.strictEqual(result[0].filePath, 'src/high.ts');
		assert.strictEqual(result[1].filePath, 'src/mid.ts');
		assert.strictEqual(result[2].filePath, 'src/low.ts');
	});

	test('truncates content exceeding the per-file char limit (6 000)', () => {
		const longContent = 'x'.repeat(10_000);
		const chunks = [makeChunk('src/big.ts', 'rag', 1.0, longContent)];
		const result = mergeAndBudget(chunks);
		assert.strictEqual(result.length, 1);
		assert.ok(result[0].content.length <= 6_000 + '\n// … truncated'.length,
			'content should be capped at PER_FILE_CHAR_LIMIT + truncation marker');
		assert.ok(result[0].content.endsWith('\n// … truncated'),
			'truncated content should end with the truncation marker');
	});

	test('stops adding files once the total char budget (30 000) is exhausted', () => {
		// Each chunk slightly under per-file limit; together they exceed the total budget
		const singleSize = 6_000;
		const chunks = Array.from({ length: 10 }, (_, i) =>
			makeChunk(`src/file${i}.ts`, 'filename', 1.0 - i * 0.01, 'a'.repeat(singleSize)),
		);
		const result = mergeAndBudget(chunks);
		const totalChars = result.reduce((s, c) => s + c.content.length, 0);
		assert.ok(totalChars <= 30_000 + '\n// … truncated'.length * result.length,
			`total chars ${totalChars} should not greatly exceed TOTAL_CHAR_BUDGET`);
	});

	test('respects MAX_FILES limit of 10', () => {
		const chunks = Array.from({ length: 15 }, (_, i) =>
			makeChunk(`src/file${i}.ts`, 'content', 0.5, 'short'),
		);
		const result = mergeAndBudget(chunks);
		assert.ok(result.length <= 10, `expected at most 10 files, got ${result.length}`);
	});

	test('passes through content unchanged when within budget', () => {
		const content = 'small content';
		const chunks = [makeChunk('src/small.ts', 'rag', 0.8, content)];
		const result = mergeAndBudget(chunks);
		assert.strictEqual(result[0].content, content);
	});

	test('preserves all other chunk properties', () => {
		const chunk = makeChunk('src/x.ts', 'rag', 0.75, 'body', 10, 40);
		const [result] = mergeAndBudget([chunk]);
		assert.strictEqual(result.filePath, 'src/x.ts');
		assert.strictEqual(result.source, 'rag');
		assert.strictEqual(result.score, 0.75);
		assert.strictEqual(result.startLine, 10);
		assert.strictEqual(result.endLine, 40);
	});
});

// ─── formatGatherPrompt ───────────────────────────────────────────────────────

suite('formatGatherPrompt', () => {
	test('includes the question in the output', () => {
		const result = formatGatherPrompt('How does auth work?', []);
		assert.ok(result.includes('How does auth work?'));
	});

	test('shows no-results message when chunks array is empty', () => {
		const result = formatGatherPrompt('some question', []);
		assert.ok(result.includes('No relevant files were found'));
		assert.ok(result.includes('Index Codebase for RAG'));
	});

	test('always includes the attribution footer', () => {
		const result = formatGatherPrompt('q', []);
		assert.ok(result.includes('Ollama Code Review'));
		assert.ok(result.includes('Paste into Claude'));
	});

	test('lists all chunk file paths as headings when chunks present', () => {
		const chunks = [
			makeChunk('src/auth.ts', 'rag', 0.9),
			makeChunk('src/utils.ts', 'filename', 0.7),
		];
		const result = formatGatherPrompt('question', chunks);
		assert.ok(result.includes('`src/auth.ts`'));
		assert.ok(result.includes('`src/utils.ts`'));
	});

	test('uses correct code-fence language for .ts extension', () => {
		const chunks = [makeChunk('src/auth.ts', 'rag', 0.9)];
		const result = formatGatherPrompt('q', chunks);
		assert.ok(result.includes('```ts'));
	});

	test('uses correct code-fence language for .py extension', () => {
		const chunks = [makeChunk('script.py', 'content', 0.5)];
		const result = formatGatherPrompt('q', chunks);
		assert.ok(result.includes('```py'));
	});

	test('falls back to "text" for unknown extension', () => {
		const chunks = [makeChunk('DOCKERFILE', 'filename', 0.5)];
		const result = formatGatherPrompt('q', chunks);
		assert.ok(result.includes('```text'));
	});

	test('shows line range when startLine and endLine are present', () => {
		const chunks = [makeChunk('src/foo.ts', 'rag', 0.9, 'body', 10, 50)];
		const result = formatGatherPrompt('q', chunks);
		assert.ok(result.includes('(lines 10–50)'));
	});

	test('omits line range when startLine/endLine are absent', () => {
		const chunks = [makeChunk('src/foo.ts', 'rag', 0.9)];
		const result = formatGatherPrompt('q', chunks);
		assert.ok(!result.includes('(lines'));
	});

	test('shows "semantic search" label for rag chunks with similarity %', () => {
		const chunks = [makeChunk('src/a.ts', 'rag', 0.87)];
		const result = formatGatherPrompt('q', chunks);
		assert.ok(result.includes('semantic search'));
		assert.ok(result.includes('87%'));
	});

	test('shows "filename match" label for filename chunks', () => {
		const chunks = [makeChunk('src/auth.ts', 'filename', 0.5)];
		const result = formatGatherPrompt('q', chunks);
		assert.ok(result.includes('filename match'));
	});

	test('shows "content match" label for content chunks', () => {
		const chunks = [makeChunk('src/utils.ts', 'content', 0.6)];
		const result = formatGatherPrompt('q', chunks);
		assert.ok(result.includes('content match'));
	});

	test('includes chunk content inside the code fence', () => {
		const chunks = [makeChunk('src/foo.ts', 'rag', 0.9, 'const x = 1;')];
		const result = formatGatherPrompt('q', chunks);
		assert.ok(result.includes('const x = 1;'));
	});

	test('separates multiple chunks with dividers', () => {
		const chunks = [
			makeChunk('src/a.ts', 'rag', 0.9, 'content A'),
			makeChunk('src/b.ts', 'filename', 0.7, 'content B'),
		];
		const result = formatGatherPrompt('q', chunks);
		// Both dividers present (one per chunk after each block)
		const dividerCount = (result.match(/^---$/gm) || []).length;
		assert.ok(dividerCount >= 2, `expected at least 2 dividers, found ${dividerCount}`);
	});

	test('includes "Relevant Files" heading when chunks are present', () => {
		const chunks = [makeChunk('src/foo.ts', 'rag', 0.9)];
		const result = formatGatherPrompt('q', chunks);
		assert.ok(result.includes('## Relevant Files'));
	});

	test('does not include "Relevant Files" heading for empty chunks', () => {
		const result = formatGatherPrompt('q', []);
		assert.ok(!result.includes('## Relevant Files'));
	});

	test('rounds similarity percentage correctly', () => {
		// 0.876 → 88%
		const chunks = [makeChunk('src/x.ts', 'rag', 0.876)];
		const result = formatGatherPrompt('q', chunks);
		assert.ok(result.includes('88%'));
	});
});
