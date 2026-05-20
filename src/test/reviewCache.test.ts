import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { createReviewCacheKey, ReviewCacheStore, type ReviewCacheSettings } from '../reviewCache';
import type { ValidatedStructuredReviewResult } from '../reviewFindings';

const settings: ReviewCacheSettings = {
	enabled: true,
	ttlMinutes: 60,
	maxEntries: 2,
};

const structuredReview: ValidatedStructuredReviewResult = {
	schemaVersion: '1.0.0',
	summary: 'Looks good.',
	findings: [],
};

async function tempStorage(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), 'ocr-review-cache-'));
}

suite('Review Cache Test Suite', () => {
	test('creates different keys when runtime inputs change', () => {
		const base = {
			prompt: 'Review this diff',
			model: 'qwen2.5-coder:7b',
			endpoint: 'http://localhost:11434/api/generate',
			temperature: 0,
			providerName: 'ollama',
		};

		assert.strictEqual(createReviewCacheKey(base), createReviewCacheKey({ ...base }));
		assert.notStrictEqual(createReviewCacheKey(base), createReviewCacheKey({ ...base, model: 'claude-sonnet-4' }));
		assert.notStrictEqual(createReviewCacheKey(base), createReviewCacheKey({ ...base, endpoint: 'https://api.example.test/generate' }));
		assert.notStrictEqual(createReviewCacheKey(base), createReviewCacheKey({ ...base, temperature: 0.2 }));
		assert.notStrictEqual(createReviewCacheKey(base), createReviewCacheKey({ ...base, providerName: 'claude' }));
		assert.notStrictEqual(createReviewCacheKey(base), createReviewCacheKey({ ...base, prompt: 'Review another diff' }));
	});

	test('persists hits and prunes by max entries', async () => {
		const storage = await tempStorage();
		const store = ReviewCacheStore.getInstance(storage);
		const now = new Date('2026-05-19T00:00:00.000Z');

		for (const key of ['a', 'b', 'c']) {
			store.set({
				key,
				model: 'test-model',
				providerName: 'ollama',
				promptHash: key,
				reviewText: `review ${key}`,
				rawResponse: `raw ${key}`,
				reviewPrompt: `prompt ${key}`,
				structuredReview,
			}, settings, now);
		}

		assert.strictEqual(store.get('a', settings, now), undefined);
		const hit = store.get('c', settings, now);
		assert.strictEqual(hit?.reviewText, 'review c');
		assert.strictEqual(hit?.hitCount, 1);
	});

	test('does not read or write entries when disabled', async () => {
		const storage = await tempStorage();
		const store = ReviewCacheStore.getInstance(storage);
		const disabledSettings: ReviewCacheSettings = {
			...settings,
			enabled: false,
		};

		store.set({
			key: 'disabled',
			model: 'test-model',
			providerName: 'ollama',
			promptHash: 'hash',
			reviewText: 'review',
			rawResponse: 'raw',
			reviewPrompt: 'prompt',
			structuredReview,
		}, disabledSettings, new Date('2026-05-19T00:00:00.000Z'));

		assert.strictEqual(store.get('disabled', settings, new Date('2026-05-19T00:00:00.000Z')), undefined);
	});

	test('expires entries after configured ttl', async () => {
		const storage = await tempStorage();
		const store = ReviewCacheStore.getInstance(storage);
		store.set({
			key: 'expired',
			model: 'test-model',
			providerName: 'ollama',
			promptHash: 'hash',
			reviewText: 'review',
			rawResponse: 'raw',
			reviewPrompt: 'prompt',
			structuredReview,
		}, settings, new Date('2026-05-19T00:00:00.000Z'));

		const hit = store.get('expired', settings, new Date('2026-05-19T02:00:01.000Z'));
		assert.strictEqual(hit, undefined);
	});

	test('contributes cache settings', async () => {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			console.warn('Skipping test: No workspace folder open');
			return;
		}

		const packageJsonPath = path.join(workspaceFolder.uri.fsPath, 'package.json');
		const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8')) as {
			contributes?: {
				configuration?: {
					properties?: Record<string, { properties?: Record<string, unknown> }>;
				};
			};
		};

		const cacheConfig = packageJson.contributes?.configuration?.properties?.['ollama-code-review.cache'];
		assert.ok(cacheConfig);
		assert.ok(cacheConfig.properties?.enabled);
		assert.ok(cacheConfig.properties?.ttlMinutes);
		assert.ok(cacheConfig.properties?.maxEntries);
	});
});
