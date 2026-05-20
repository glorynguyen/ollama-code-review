import * as assert from 'assert';
import {
	buildDiffAnchorIndex,
	filterReviewNoise,
	normalizeReviewResult,
	renderValidatedReviewMarkdown,
	toLegacyReviewFinding,
	validateReviewAnchor,
	type ValidatedStructuredReviewFinding,
} from '../reviewFindings';

const diff = [
	'diff --git a/src/app.ts b/src/app.ts',
	'--- a/src/app.ts',
	'+++ b/src/app.ts',
	'@@ -1,2 +1,4 @@',
	' const existing = true;',
	'+const token = "secret";',
	'+console.log(token);',
	' export { existing };',
	'diff --git a/src/old.ts b/src/old.ts',
	'--- a/src/old.ts',
	'+++ /dev/null',
	'@@ -1 +0,0 @@',
	'-export const old = true;',
].join('\n');

function structuredReview(findings: unknown[], summary = 'Structured summary.'): string {
	return JSON.stringify({
		schemaVersion: '1.0.0',
		summary,
		findings,
	});
}

suite('Structured Review Test Suite', () => {
	test('builds diff anchor indexes and validates all anchor failure modes', () => {
		const index = buildDiffAnchorIndex(diff);

		assert.ok(index.files.get('src/app.ts')?.addedLines.has(2));
		assert.ok(index.files.get('src/app.ts')?.addedLines.has(3));
		assert.ok(index.deletedFiles.has('src/old.ts'));

		assert.strictEqual(validateReviewAnchor(undefined, index).status, 'missing');
		assert.strictEqual(validateReviewAnchor({ file: '', line: 1 }, index).status, 'missing');
		assert.strictEqual(validateReviewAnchor({ file: 'src/app.ts', line: 0 }, index).status, 'invalid-line');
		assert.strictEqual(validateReviewAnchor({ file: 'src/app.ts', line: 3, endLine: 2 }, index).status, 'invalid-line');
		assert.strictEqual(validateReviewAnchor({ file: 'src/missing.ts', line: 1 }, index).status, 'unknown-file');
		assert.strictEqual(validateReviewAnchor({ file: 'src/old.ts', line: 1 }, index).status, 'deleted-file');
		assert.strictEqual(validateReviewAnchor({ file: 'src/app.ts', line: 1 }, index).status, 'not-added-line');

		const valid = validateReviewAnchor({ file: 'app.ts', line: 2, endLine: 3 }, index);
		assert.strictEqual(valid.status, 'valid');
		assert.deepStrictEqual(valid.normalizedAnchor, { file: 'src/app.ts', line: 2, endLine: 3 });
	});

	test('normalizes structured JSON findings with defaults and valid anchors', () => {
		const review = normalizeReviewResult(structuredReview([
			null,
			{ title: 'Ignored because summary is missing' },
			{
				id: 'finding-1',
				severity: 'HIGH',
				title: '',
				summary: 'The token is logged and may expose credentials.',
				confidence: 2,
				category: 'security',
				anchor: { file: './src/app.ts', line: 2, endLine: 3 },
				evidence: [
					{
						kind: 'CODE',
						summary: 'The added line logs the token.',
						anchor: { file: 'src/app.ts', line: 3 },
						quote: 'console.log(token);',
					},
					{ kind: 'invalid-kind', summary: '' },
				],
				fix: {
					replacement: 'const token = getToken();',
				},
			},
			{
				severity: 123,
				summary: 'Fallback evidence and info severity are applied.',
				confidence: -1,
				anchor: { file: 'src/app.ts' },
				evidence: [
					'not an object',
					{ kind: 123, summary: 'Non-string evidence kinds fall back.' },
				],
				fix: {},
			},
		]), diff);

		assert.strictEqual(review.schemaVersion, '1.0.0');
		assert.strictEqual(review.findings.length, 2);
		assert.strictEqual(review.findings[0].id, 'finding-1');
		assert.strictEqual(review.findings[0].severity, 'high');
		assert.strictEqual(review.findings[0].title, 'The token is logged and may expose credentials.');
		assert.strictEqual(review.findings[0].confidence, 1);
		assert.strictEqual(review.findings[0].anchorValidation.status, 'valid');
		assert.strictEqual(review.findings[0].evidence[0].kind, 'code');
		assert.strictEqual(review.findings[0].fix?.summary, 'Suggested fix');

		assert.strictEqual(review.findings[1].severity, 'info');
		assert.strictEqual(review.findings[1].confidence, 0);
		assert.strictEqual(review.findings[1].anchor, undefined);
		assert.strictEqual(review.findings[1].evidence[0].kind, 'diff');
		assert.strictEqual(review.findings[1].fix, undefined);
	});

	test('normalizes unknown structured review enum values to safe defaults', () => {
		const review = normalizeReviewResult(structuredReview([
			{
				severity: 'urgent',
				summary: 'Unknown enum values fall back to defaults.',
				anchor: { file: 'src/app.ts', line: 2 },
				evidence: [{ kind: 'stacktrace', summary: 'Unknown evidence kind.' }],
			},
		]), diff);

		assert.strictEqual(review.findings[0].severity, 'info');
		assert.strictEqual(review.findings[0].evidence[0].kind, 'diff');
	});

	test('indexes modified-file hunks without treating removed lines as added', () => {
		const modifiedDiff = [
			'diff --git a/src/edit.ts b/src/edit.ts',
			'--- a/src/edit.ts',
			'+++ b/src/edit.ts',
			'@@ -1,3 +1,3 @@',
			' const keep = true;',
			'-const before = false;',
			'+const after = true;',
			' export { keep };',
		].join('\n');
		const index = buildDiffAnchorIndex(modifiedDiff);

		assert.deepStrictEqual([...index.files.get('src/edit.ts')?.addedLines ?? []], [2]);
	});

	test('renders markdown for empty, replacement, and patch findings', () => {
		assert.strictEqual(
			renderValidatedReviewMarkdown({
				schemaVersion: '1.0.0',
				summary: '  ',
				findings: [],
			}),
			'I have reviewed the changes and found no significant issues.',
		);

		const review = normalizeReviewResult(structuredReview([
			{
				id: 'replacement',
				severity: 'medium',
				title: 'Token logging',
				summary: 'Do not log the token.',
				confidence: 0.75,
				category: 'security',
				anchor: { file: 'src/app.ts', line: 2, endLine: 3 },
				evidence: [{
					kind: 'diff',
					summary: 'The token is added and logged.',
					anchor: { file: 'src/app.ts', line: 3 },
					quote: 'console.log(token);',
				}],
				fix: {
					summary: 'Remove the log statement.',
					replacement: 'const token = getToken();',
				},
			},
			{
				id: 'patch',
				severity: 'low',
				title: 'Prefer const',
				summary: 'Use a constant declaration.',
				confidence: 0.5,
				anchor: { file: 'src/app.ts', line: 2 },
				evidence: [{ kind: 'test', summary: 'A test documents the expected token behavior.' }],
				fix: {
					summary: 'Apply this patch.',
					patch: '-let token\n+const token',
				},
			},
		]), diff);

		const markdown = renderValidatedReviewMarkdown(review);
		assert.ok(markdown.includes('## Review Summary'));
		assert.ok(markdown.includes('- **File:** `src/app.ts:2-3`'));
		assert.ok(markdown.includes('Quote: "console.log(token);"'));
		assert.ok(markdown.includes('```diff'));
	});

	test('converts validated structured findings to legacy review findings', () => {
		const review = normalizeReviewResult(structuredReview([
			{
				id: 'finding-1',
				severity: 'high',
				title: 'Token logging',
				summary: 'Do not log the token.',
				confidence: 0.8,
				anchor: { file: 'src/app.ts', line: 2 },
				evidence: [{ kind: 'diff', summary: 'The token appears in an added line.' }],
				fix: { summary: 'Remove it.', patch: '-console.log(token);' },
			},
			{
				id: 'finding-2',
				severity: 'medium',
				title: 'Unknown file',
				summary: 'This points outside the diff.',
				confidence: Number.NaN,
				anchor: { file: 'src/other.ts', line: 10 },
				evidence: [],
			},
		]), diff);

		const validLegacy = toLegacyReviewFinding(review.findings[0]);
		assert.strictEqual(validLegacy.file, 'src/app.ts');
		assert.strictEqual(validLegacy.line, 2);
		assert.strictEqual(validLegacy.suggestion, '-console.log(token);');
		assert.ok(validLegacy.message.includes('Evidence: The token appears in an added line.'));

		const invalidLegacy = toLegacyReviewFinding(review.findings[1]);
		assert.strictEqual(invalidLegacy.file, undefined);
		assert.strictEqual(invalidLegacy.line, undefined);
		assert.strictEqual(review.findings[1].confidence, 0.5);
		assert.ok(invalidLegacy.message.includes('Anchor validation:'));
	});

	test('falls back to legacy markdown and noise filtering no-op paths', () => {
		const legacy = normalizeReviewResult([
			'### 1. Critical leak',
			'The added code in `src/app.ts:2` logs a secret token.',
			'You should fix it:',
			'```ts',
			'const token = getToken();',
			'```',
		].join('\n'), diff);

		assert.strictEqual(legacy.findings.length, 1);
		assert.strictEqual(legacy.findings[0].id, 'legacy-1');
		assert.strictEqual(legacy.findings[0].severity, 'critical');
		assert.strictEqual(legacy.findings[0].anchorValidation.status, 'valid');
		assert.strictEqual(legacy.findings[0].fix?.replacement, 'const token = getToken();');

		const noSuppress = filterReviewNoise(legacy);
		assert.strictEqual(noSuppress.result, legacy);
		assert.strictEqual(noSuppress.suppressedCount, 0);
	});

	test('parses fenced JSON and summarizes empty or multi-finding legacy reviews', () => {
		const fenced = normalizeReviewResult([
			'```json',
			structuredReview([{
				id: 'fenced',
				severity: 'low',
				summary: 'Fenced JSON works.',
				confidence: 0.2,
				anchor: { file: 'src/app.ts', line: 2 },
			}], 'Fenced summary.'),
			'```',
		].join('\n'), diff);
		assert.strictEqual(fenced.summary, 'Fenced summary.');
		assert.strictEqual(fenced.findings[0].id, 'fenced');

		const emptyLegacy = normalizeReviewResult('', diff);
		assert.strictEqual(emptyLegacy.summary, 'No review summary was generated.');
		assert.deepStrictEqual(emptyLegacy.findings, []);

		const multiLegacy = normalizeReviewResult([
			'### 1. First issue',
			'Medium issue in `src/app.ts:2`.',
			'### 2. Second issue',
			'Low issue in `src/app.ts:3`.',
		].join('\n'), diff);
		assert.strictEqual(multiLegacy.summary, '2 findings extracted from legacy markdown review output.');
		assert.strictEqual(multiLegacy.findings.length, 2);
	});

	test('falls back when structured JSON is invalid or not an object', () => {
		const invalidJson = normalizeReviewResult('```json\n{ invalid\n```', diff);
		assert.strictEqual(invalidJson.summary, '```json');
		assert.strictEqual(invalidJson.findings.length, 1);

		const arrayJson = normalizeReviewResult('[{"summary":"not an object"}]', diff);
		assert.strictEqual(arrayJson.summary, '[{"summary":"not an object"}]');

		const nonObjectJson = normalizeReviewResult('```json\nnull\n```', diff);
		assert.strictEqual(nonObjectJson.summary, '```json');
		assert.strictEqual(nonObjectJson.findings.length, 1);

		const minimalJson = normalizeReviewResult(JSON.stringify({}), diff);
		assert.strictEqual(minimalJson.summary, 'Structured review result');
		assert.deepStrictEqual(minimalJson.findings, []);
	});

	test('keeps non-build findings and summarizes remaining findings after suppression', () => {
		const review = normalizeReviewResult(structuredReview([
			{
				id: 'build',
				severity: 'medium',
				title: 'Missing export may fail type-check',
				summary: 'The diff only shows the import and the symbol may not be exported.',
				confidence: 0.4,
				anchor: { file: 'src/app.ts', line: 2 },
				evidence: [{ kind: 'diff', summary: 'Not shown in the diff as exported.' }],
			},
			{
				id: 'runtime',
				severity: 'high',
				title: 'Runtime crash',
				summary: 'This can crash at runtime when the token is undefined.',
				confidence: 0.4,
				anchor: { file: 'src/app.ts', line: 3 },
				evidence: [{ kind: 'context', summary: 'Runtime behavior is affected.' }],
			},
		]), diff);

		const filtered = filterReviewNoise(review, { suppressBuildVerifiableFindings: true });
		assert.strictEqual(filtered.suppressedCount, 1);
		assert.strictEqual(filtered.result.summary, 'Structured summary.');
		assert.deepStrictEqual(filtered.result.findings.map(finding => finding.id), ['runtime']);
	});

	test('keeps build-verifiable findings when security language is present', () => {
		const review = normalizeReviewResult(structuredReview([
			{
				id: 'security-build',
				severity: 'high',
				title: 'Missing export exposes security credential handling',
				summary: 'The missing export affects authentication and could expose a secret.',
				confidence: 0.2,
				anchor: { file: 'src/app.ts', line: 2 },
				evidence: [{ kind: 'diff', summary: 'The exported member is not shown in the diff.' }],
			},
		]), diff);

		const filtered = filterReviewNoise(review, { suppressBuildVerifiableFindings: true });
		assert.strictEqual(filtered.suppressedCount, 0);
		assert.strictEqual(filtered.result.findings.length, 1);
	});

	test('renders invalid anchor reason in markdown', () => {
		const finding: ValidatedStructuredReviewFinding = normalizeReviewResult(structuredReview([
			{
				id: 'invalid',
				severity: 'low',
				title: 'Unknown anchor',
				summary: 'The file is not part of the diff.',
				confidence: 0.4,
				anchor: { file: 'src/missing.ts', line: 10 },
				evidence: [{ kind: 'rule', summary: 'Rule-based finding.' }],
			},
		]), diff).findings[0];

		const markdown = renderValidatedReviewMarkdown({
			schemaVersion: '1.0.0',
			summary: 'Invalid anchor summary.',
			findings: [finding],
		});
		assert.ok(markdown.includes('- **Anchor:** unknown-file'));
	});
});
