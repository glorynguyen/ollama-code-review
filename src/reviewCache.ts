/**
 * F-046: Review Diff Caching / Deduplication
 *
 * Persists exact review results by hashing the final review prompt plus model
 * runtime inputs. This keeps repeated reviews of the same diff/config instant
 * without changing findings, score, annotations, or history behavior.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ValidatedStructuredReviewResult } from './reviewFindings';

const CACHE_FILE = 'review-cache.json';
const CACHE_SCHEMA_VERSION = 1;

export interface ReviewCacheSettings {
	enabled: boolean;
	ttlMinutes: number;
	maxEntries: number;
}

export interface ReviewCacheKeyInput {
	prompt: string;
	model: string;
	endpoint: string;
	temperature: number;
	providerName: string;
}

export interface ReviewCacheEntry {
	key: string;
	createdAt: string;
	lastAccessedAt: string;
	hitCount: number;
	model: string;
	providerName: string;
	promptHash: string;
	reviewText: string;
	rawResponse: string;
	reviewPrompt: string;
	structuredReview: ValidatedStructuredReviewResult;
}

interface ReviewCacheFile {
	schemaVersion: number;
	entries: ReviewCacheEntry[];
}

export function getReviewCacheSettings(config: vscode.WorkspaceConfiguration): ReviewCacheSettings {
	const raw = config.get<Partial<ReviewCacheSettings>>('cache', {});
	return {
		enabled: raw.enabled ?? true,
		ttlMinutes: clampNumber(raw.ttlMinutes, 1, 60 * 24 * 30, 60 * 24),
		maxEntries: clampNumber(raw.maxEntries, 1, 500, 50),
	};
}

export function createReviewCacheKey(input: ReviewCacheKeyInput): string {
	return hashJson({
		schemaVersion: CACHE_SCHEMA_VERSION,
		responseFormat: 'structured-review',
		model: input.model,
		endpoint: input.endpoint,
		temperature: input.temperature,
		providerName: input.providerName,
		promptHash: hashText(input.prompt),
	});
}

export function createPromptHash(prompt: string): string {
	return hashText(prompt);
}

export class ReviewCacheStore {
	private static readonly instances = new Map<string, ReviewCacheStore>();
	private readonly cachePath: string;
	private entries: ReviewCacheEntry[] = [];

	private constructor(globalStoragePath: string) {
		this.cachePath = path.join(globalStoragePath, CACHE_FILE);
	}

	private initialize(): void {
		this.load();
	}

	static getInstance(globalStoragePath: string): ReviewCacheStore {
		let instance = ReviewCacheStore.instances.get(globalStoragePath);
		if (!instance) {
			instance = new ReviewCacheStore(globalStoragePath);
			ReviewCacheStore.instances.set(globalStoragePath, instance);
			instance.initialize();
		}
		return instance;
	}

	get(key: string, settings: ReviewCacheSettings, now = new Date()): ReviewCacheEntry | undefined {
		if (!settings.enabled) {
			return undefined;
		}

		const entry = this.entries.find(item => item.key === key);
		if (!entry) {
			return undefined;
		}

		if (isExpired(entry, settings, now)) {
			this.entries = this.entries.filter(item => item.key !== key);
			this.save();
			return undefined;
		}

		entry.lastAccessedAt = now.toISOString();
		entry.hitCount += 1;
		this.save();
		return entry;
	}

	set(entry: Omit<ReviewCacheEntry, 'createdAt' | 'lastAccessedAt' | 'hitCount'>, settings: ReviewCacheSettings, now = new Date()): void {
		if (!settings.enabled) {
			return;
		}

		const timestamp = now.toISOString();
		const existingIndex = this.entries.findIndex(item => item.key === entry.key);
		const nextEntry: ReviewCacheEntry = {
			...entry,
			createdAt: existingIndex >= 0 ? this.entries[existingIndex].createdAt : timestamp,
			lastAccessedAt: timestamp,
			hitCount: existingIndex >= 0 ? this.entries[existingIndex].hitCount : 0,
		};

		if (existingIndex >= 0) {
			this.entries[existingIndex] = nextEntry;
		} else {
			this.entries.unshift(nextEntry);
		}

		this.prune(settings, now);
		this.save();
	}

	clear(): void {
		this.entries = [];
		this.save();
	}

	private prune(settings: ReviewCacheSettings, now: Date): void {
		this.entries = this.entries.filter(entry => !isExpired(entry, settings, now));
		this.entries.sort((a, b) => Date.parse(b.lastAccessedAt) - Date.parse(a.lastAccessedAt));
		this.entries = this.entries.slice(0, settings.maxEntries);
	}

	private load(): void {
		try {
			if (!fs.existsSync(this.cachePath)) {
				this.entries = [];
				return;
			}

			const parsed = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8')) as Partial<ReviewCacheFile>;
			this.entries = parsed.schemaVersion === CACHE_SCHEMA_VERSION && Array.isArray(parsed.entries)
				? parsed.entries.filter(isReviewCacheEntry)
				: [];
		} catch {
			this.entries = [];
		}
	}

	private save(): void {
		try {
			fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
			const payload: ReviewCacheFile = {
				schemaVersion: CACHE_SCHEMA_VERSION,
				entries: this.entries,
			};
			fs.writeFileSync(this.cachePath, JSON.stringify(payload, null, 2), 'utf-8');
		} catch {
			// Non-fatal: cache misses are acceptable if persistence fails.
		}
	}
}

function isExpired(entry: ReviewCacheEntry, settings: ReviewCacheSettings, now: Date): boolean {
	const created = Date.parse(entry.createdAt);
	if (!Number.isFinite(created)) {
		return true;
	}

	return now.getTime() - created > settings.ttlMinutes * 60 * 1000;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.max(min, Math.min(max, value));
}

function hashText(value: string): string {
	return crypto.createHash('sha256').update(value).digest('hex');
}

function hashJson(value: unknown): string {
	return hashText(JSON.stringify(value));
}

function isReviewCacheEntry(value: unknown): value is ReviewCacheEntry {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const entry = value as Partial<ReviewCacheEntry>;
	return typeof entry.key === 'string' &&
		typeof entry.createdAt === 'string' &&
		typeof entry.lastAccessedAt === 'string' &&
		typeof entry.hitCount === 'number' &&
		typeof entry.model === 'string' &&
		typeof entry.providerName === 'string' &&
		typeof entry.promptHash === 'string' &&
		typeof entry.reviewText === 'string' &&
		typeof entry.rawResponse === 'string' &&
		typeof entry.reviewPrompt === 'string' &&
		typeof entry.structuredReview === 'object' &&
		entry.structuredReview !== null;
}
