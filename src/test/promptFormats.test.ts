import * as assert from 'assert';
import { buildProviderPrompt } from '../providers/promptFormats';
import { STRUCTURED_REVIEW_SCHEMA_VERSION } from '../reviewFindings/types';

suite('Provider Prompt Format Test Suite', () => {
	test('returns the original prompt when structured review output is not requested', () => {
		assert.strictEqual(buildProviderPrompt('Review this diff.'), 'Review this diff.');
		assert.strictEqual(
			buildProviderPrompt('Review this diff.', { responseFormat: 'text' } as any),
			'Review this diff.',
		);
	});

	test('appends structured review JSON instructions', () => {
		const prompt = buildProviderPrompt('  Review this diff.  ', {
			responseFormat: 'structured-review',
		});

		assert.ok(prompt.startsWith('Review this diff.\n\nReturn ONLY valid JSON.'));
		assert.ok(prompt.includes(`schemaVersion "${STRUCTURED_REVIEW_SCHEMA_VERSION}"`));
		assert.ok(prompt.includes('"severity": "critical|high|medium|low|info"'));
		assert.ok(prompt.includes('- Use repo-relative file paths only.'));
		assert.ok(prompt.includes('- If there are no issues, return an empty findings array and a concise summary.'));
	});
});
