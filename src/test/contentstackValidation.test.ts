import * as assert from 'assert';
import { parseContentstackAccesses } from '../contentstack/codeParser';
import { collectFieldUids, buildFieldMap } from '../contentstack/schemaFetcher';
import type { ContentTypeSchema } from '../contentstack/types';
import { validateFieldAccesses } from '../contentstack/validator';

const pageSchema: ContentTypeSchema = {
	uid: 'page',
	title: 'Page',
	schema: [
		{ uid: 'hero_title', display_name: 'Hero Title', data_type: 'text' },
		{ uid: 'body', display_name: 'Body', data_type: 'text' },
		{ uid: 'cta_label', display_name: 'CTA Label', data_type: 'text' },
		{
			uid: 'seo',
			display_name: 'SEO',
			data_type: 'group',
			schema: [
				{ uid: 'seo_title', display_name: 'SEO Title', data_type: 'text' },
			],
		},
		{
			uid: 'sections',
			display_name: 'Sections',
			data_type: 'blocks',
			blocks: [{
				uid: 'hero_block',
				title: 'Hero Block',
				schema: [
					{ uid: 'headline', display_name: 'Headline', data_type: 'text' },
				],
			}],
		} as any,
	],
};

suite('Contentstack Validation Test Suite', () => {
	test('parses entry field accesses across common access styles', () => {
		const result = parseContentstackAccesses([
			"const page = await Stack.ContentType('page').Entry('home').fetch();",
			'console.log(page.hero_title);',
			"console.log(page['body']);",
			'console.log(page?.cta_label);',
			'const { seo_title: seoTitle, hero_titel } = page;',
			'page.toJSON();',
			'// page.comment_only should be ignored',
		].join('\n'), 'src/page.ts');

		assert.deepStrictEqual(result.contentTypeUids, ['page']);
		assert.deepStrictEqual(
			result.accesses.map(access => [access.fieldName, access.contentTypeUid, access.line]),
			[
				['hero_title', 'page', 2],
				['body', 'page', 3],
				['cta_label', 'page', 4],
				['seo_title', 'page', 5],
				['hero_titel', 'page', 5],
			],
		);
	});

	test('infers content type from helper calls and entry variable names', () => {
		const helperResult = parseContentstackAccesses(
			"const entries = await client.getEntries('blog_post');\nconsole.log(entries.title);",
			'src/blog.ts',
		);
		const namedVarResult = parseContentstackAccesses(
			'const productEntry = response.entry;\nconsole.log(productEntry.sku);',
			'src/product.ts',
		);

		assert.deepStrictEqual(helperResult.contentTypeUids, ['blog_post']);
		assert.deepStrictEqual(helperResult.accesses.map(access => access.contentTypeUid), ['blog_post']);
		assert.deepStrictEqual(namedVarResult.contentTypeUids, ['product']);
		assert.deepStrictEqual(namedVarResult.accesses.map(access => access.contentTypeUid), ['product']);
	});

	test('validates fields, suggests close matches, and tracks unresolved content types', () => {
		const parseResult = {
			filePath: 'src/page.ts',
			contentTypeUids: ['page', 'product'],
			accesses: [
				{
					fieldName: 'hero_title',
					contentTypeUid: 'page',
					line: 2,
					sourceLine: 'console.log(page.hero_title);',
					inferenceMethod: 'variable-trace' as const,
				},
				{
					fieldName: 'hero_titel',
					contentTypeUid: 'page',
					line: 3,
					sourceLine: 'console.log(page.hero_titel);',
					inferenceMethod: 'variable-trace' as const,
				},
				{
					fieldName: 'sku',
					contentTypeUid: 'product',
					line: 4,
					sourceLine: 'console.log(product.sku);',
					inferenceMethod: 'variable-trace' as const,
				},
			],
		};

		const validation = validateFieldAccesses(parseResult, [pageSchema]);

		assert.strictEqual(validation.stats.totalAccesses, 3);
		assert.strictEqual(validation.stats.validFields, 1);
		assert.strictEqual(validation.stats.invalidFields, 2);
		assert.deepStrictEqual(validation.resolvedContentTypes.map(schema => schema.uid), ['page']);
		assert.deepStrictEqual(validation.unresolvedContentTypes, ['product']);
		assert.strictEqual(validation.fields[1].suggestion, 'hero_title');
	});

	test('collects and labels nested schema fields', () => {
		const uids = collectFieldUids(pageSchema);
		const fieldMap = buildFieldMap(pageSchema);

		assert.ok(uids.has('hero_title'));
		assert.ok(uids.has('seo_title'));
		assert.ok(uids.has('hero_block'));
		assert.ok(uids.has('headline'));

		assert.strictEqual(fieldMap.get('seo.seo_title'), 'SEO Title');
		assert.strictEqual(fieldMap.get('seo_title'), 'SEO Title');
		assert.strictEqual(fieldMap.get('sections.hero_block.headline'), 'Headline');
		assert.strictEqual(fieldMap.get('hero_block'), 'Hero Block');
	});

	test('parses react hooks and property assignments in codeParser', () => {
		const result = parseContentstackAccesses([
			"const page = await Stack.ContentType('page').Entry('home').fetch();",
			"const { data: hookEntry } = useContentstackEntry('page');",
			"const propEntry = response.entry;",
			"console.log(hookEntry.hero_title);",
			"console.log(propEntry.body);",
			"const { toJSON, ...rest } = hookEntry;",
		].join('\n'), 'src/hookTest.ts');

		assert.ok(result.contentTypeUids.includes('page'));
		assert.deepStrictEqual(
			result.accesses.map(access => [access.fieldName, access.contentTypeUid]),
			[
				['body', 'page'],
			]
		);
	});

	test('parses fallback common variable names and filters rest/builtin destructuring', () => {
		const result = parseContentstackAccesses([
			"Stack.ContentType('page');",
			"console.log(entry.hero_title);", // fallback variable name 'entry'
			"const { toJSON, ...rest } = entry;",
		].join('\n'), 'src/fallbackTest.ts');

		assert.deepStrictEqual(
			result.accesses.map(access => [access.fieldName, access.contentTypeUid]),
			[['hero_title', 'page']]
		);
	});

	test('parses helper, parameter, and bracket access patterns', () => {
		const result = parseContentstackAccesses([
			"getEntry({ content_type_uid: 'article' });",
			"function renderArticle(article) {",
			"  console.log(article['headline']);",
			"  console.log(article?.summary);",
			"  console.log(article.toJSON);",
			"}",
		].join('\n'), 'src/helperTest.ts');

		assert.ok(result.contentTypeUids.includes('article'));
		assert.deepStrictEqual(
			result.accesses.map(access => [access.fieldName, access.contentTypeUid]),
			[
				['headline', 'article'],
				['summary', 'article'],
			]
		);
	});

	test('records unknown field accesses when hook content type is unavailable', () => {
		const result = parseContentstackAccesses([
			"const { data } = useContentstackEntry();",
			"console.log(a.title);",
			"console.log(a['body']);",
			"console.log(a?.summary);",
			"const { hero, toJSON } = a;",
		].join('\n'), 'src/unknownHook.ts');

		assert.deepStrictEqual(
			result.accesses.map(access => [access.fieldName, access.contentTypeUid, access.inferenceMethod]),
			[
				['title', undefined, 'unknown'],
				['body', undefined, 'unknown'],
				['summary', undefined, 'unknown'],
				['hero', undefined, 'unknown'],
			]
		);
	});

	test('validates fields without content type uid and handles no closest match', () => {
		const parseResult = {
			filePath: 'src/page.ts',
			contentTypeUids: [],
			accesses: [
				{
					fieldName: 'hero_title',
					contentTypeUid: '', // unknown content type
					line: 2,
					sourceLine: 'console.log(hero_title);',
					inferenceMethod: 'unknown' as const,
				},
				{
					fieldName: 'hero_titel',
					contentTypeUid: '', // unknown content type
					line: 3,
					sourceLine: 'console.log(hero_titel);',
					inferenceMethod: 'unknown' as const,
				},
				{
					fieldName: 'completely_different_field_name',
					contentTypeUid: '', // unknown content type
					line: 4,
					sourceLine: 'console.log(completely_different_field_name);',
					inferenceMethod: 'unknown' as const,
				},
			],
		};

		const validation = validateFieldAccesses(parseResult, [pageSchema]);
		assert.strictEqual(validation.stats.totalAccesses, 3);
		assert.strictEqual(validation.fields[0].valid, true);
		assert.strictEqual(validation.fields[0].contentTypeUid, 'page');
		
		assert.strictEqual(validation.fields[1].valid, false);
		assert.strictEqual(validation.fields[1].suggestion, 'hero_title');
		assert.strictEqual(validation.fields[1].contentTypeUid, 'page');

		assert.strictEqual(validation.fields[2].valid, false);
		assert.strictEqual(validation.fields[2].suggestion, undefined);
		assert.strictEqual(validation.fields[2].distance, undefined);
	});
});
