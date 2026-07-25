/**
 * /gather slash command — smart codebase context harvest for external LLM consultation.
 *
 * Usage: /gather What is the billboard split screen feature?
 *
 * Runs a dual strategy:
 *   A. RAG semantic search (if workspace is indexed)
 *   B. Keyword filename + content search (always available)
 *
 * Formats results as a pasteable prompt (question + relevant file contents)
 * and writes it to the clipboard.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import {
	isEmbeddingModelAvailable,
	JsonVectorStore,
	getRagConfig,
	retrieveRelevantChunks,
} from '../rag';

// ─── budget constants ────────────────────────────────────────────────────────

const PER_FILE_CHAR_LIMIT = 6_000;
const TOTAL_CHAR_BUDGET = 30_000;
const MAX_FILES = 10;

// ─── types ───────────────────────────────────────────────────────────────────

export interface GatheredChunk {
	filePath: string;
	content: string;
	source: 'rag' | 'filename' | 'content';
	score: number;
	startLine?: number;
	endLine?: number;
}

export interface GatherResult {
	question: string;
	chunks: GatheredChunk[];
	formattedPrompt: string;
	stats: { filesFound: number; totalChars: number; strategies: string[] };
}

// ─── keyword extraction ───────────────────────────────────────────────────────

const STOPWORDS = new Set([
	'a', 'an', 'the', 'and', 'or', 'but', 'not', 'so', 'if', 'in', 'on', 'at',
	'to', 'by', 'of', 'for', 'with', 'from', 'that', 'this', 'these', 'those',
	'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
	'will', 'would', 'could', 'should', 'may', 'might', 'can', 'do', 'does',
	'did', 'it', 'its', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she',
	'they', 'their', 'what', 'how', 'why', 'where', 'which', 'who', 'when',
	'use', 'used', 'tell', 'give', 'show', 'get', 'about', 'as', 'into', 'up',
	'out', 'also', 'then', 'than', 'there', 'here', 'all', 'any', 'some',
	'more', 'most', 'such', 'each', 'between', 'through', 'i',
]);

export function extractSearchTerms(question: string): string[] {
	const raw = question
		.toLowerCase()
		.split(/[\s\-_.,;:!?'"()\[\]{}\/\\+]+/)
		.map(w => w.replace(/[^a-z0-9]/g, ''))
		.filter(w => w.length >= 2 && !STOPWORDS.has(w));

	if (raw.length === 0) {
		// Fallback: just take first 5 words verbatim
		return question.split(/\s+/).filter(w => w.length >= 2).slice(0, 5);
	}

	const terms = new Set<string>(raw);

	// PascalCase variant of each word (useful for class/file name matching)
	for (const w of [...raw]) {
		terms.add(w.charAt(0).toUpperCase() + w.slice(1));
	}

	// Compound camelCase from consecutive pairs, e.g. "split screen" → "splitScreen"
	for (let i = 0; i < raw.length - 1; i++) {
		const compound = raw[i] + raw[i + 1].charAt(0).toUpperCase() + raw[i + 1].slice(1);
		terms.add(compound);
		// also the PascalCase full compound
		terms.add(compound.charAt(0).toUpperCase() + compound.slice(1));
	}

	return [...terms];
}

function escapeGlob(s: string): string {
	return s.replace(/[[\]{}()*?!@#$%^&=+|<>,.~`]/g, '\\$&');
}

// ─── strategy A: RAG semantic search ─────────────────────────────────────────

const ragEmbeddingCache = new Map<string, boolean>();

async function strategyRag(
	question: string,
	ragStoragePath: string,
): Promise<GatheredChunk[]> {
	try {
		const store = new JsonVectorStore(ragStoragePath);
		if (store.chunkCount === 0) {return [];}

		const ragConfig = getRagConfig();
		const cfgSection = vscode.workspace.getConfiguration('ollama-code-review');
		const endpoint = cfgSection.get<string>('endpoint', 'http://localhost:11434/api/generate');

		const cacheKey = `${endpoint}::${ragConfig.embeddingModel}`;
		let useOllamaEmbeddings = ragEmbeddingCache.get(cacheKey);
		if (useOllamaEmbeddings === undefined) {
			useOllamaEmbeddings = await isEmbeddingModelAvailable(ragConfig.embeddingModel, endpoint);
			ragEmbeddingCache.set(cacheKey, useOllamaEmbeddings);
		}

		const results = await retrieveRelevantChunks(
			question,
			store,
			ragConfig,
			endpoint,
			useOllamaEmbeddings,
		);

		return results.map(r => ({
			filePath: r.chunk.filePath,
			content: r.chunk.content,
			source: 'rag' as const,
			score: r.score,
			startLine: r.chunk.startLine,
			endLine: r.chunk.endLine,
		}));
	} catch {
		return [];
	}
}

// ─── strategy B: filename keyword search ─────────────────────────────────────

const FILE_EXCLUSIONS =
	'{**/node_modules/**,**/dist/**,**/out/**,**/.git/**,**/.next/**,**/build/**,**/coverage/**,**/*.lock,**/*.min.js,**/*.min.css,**/*.map,**/*.d.ts}';

async function strategyFilename(terms: string[]): Promise<GatheredChunk[]> {
	const uriScores = new Map<string, { uri: vscode.Uri; score: number }>();

	for (const term of terms) {
		if (term.length < 3) {continue;}
		const safe = escapeGlob(term);
		try {
			const found = await vscode.workspace.findFiles(
				`**/*${safe}*`,
				FILE_EXCLUSIONS,
				10,
			);
			for (const uri of found) {
				const key = uri.fsPath;
				const existing = uriScores.get(key);
				if (existing) {
					existing.score += 1;
				} else {
					uriScores.set(key, { uri, score: 1 });
				}
			}
		} catch {
			// invalid glob for this term — skip
		}
	}

	const sorted = [...uriScores.values()]
		.sort((a, b) => b.score - a.score)
		.slice(0, MAX_FILES);

	const chunks: GatheredChunk[] = [];
	for (const { uri, score } of sorted) {
		try {
			const raw = await vscode.workspace.fs.readFile(uri);
			const content = Buffer.from(raw).toString('utf-8');
			chunks.push({
				filePath: vscode.workspace.asRelativePath(uri),
				content,
				source: 'filename',
				score: score / Math.max(terms.length, 1),
			});
		} catch {
			// skip unreadable files
		}
	}

	return chunks;
}

// ─── strategy C: content keyword search ──────────────────────────────────────

async function strategyContent(
	terms: string[],
	existingPaths: Set<string>,
): Promise<GatheredChunk[]> {
	const lowerTerms = terms
		.map(t => t.toLowerCase())
		.filter((t, i, a) => t.length >= 3 && a.indexOf(t) === i);

	if (lowerTerms.length === 0) {return [];}

	let allFiles: vscode.Uri[] = [];
	try {
		allFiles = await vscode.workspace.findFiles(
			'**/*.{ts,tsx,js,jsx,mts,mjs,py,go,java,cs,php,rb,rs,vue,svelte,md}',
			FILE_EXCLUSIONS,
			80,
		);
	} catch {
		return [];
	}

	const scored: Array<{ uri: vscode.Uri; score: number; content: string }> = [];

	for (const uri of allFiles) {
		const rel = vscode.workspace.asRelativePath(uri);
		if (existingPaths.has(rel)) {continue;}
		try {
			const raw = await vscode.workspace.fs.readFile(uri);
			if (raw.length > 200_000) {continue;} // skip files > 200 KB
			const content = Buffer.from(raw).toString('utf-8');
			const lower = content.toLowerCase();
			let matchCount = 0;
			for (const term of lowerTerms) {
				if (lower.includes(term)) {matchCount++;}
			}
			if (matchCount > 0) {
				scored.push({ uri, score: matchCount / lowerTerms.length, content });
			}
		} catch {
			// skip
		}
	}

	scored.sort((a, b) => b.score - a.score);

	return scored.slice(0, 5).map(({ uri, score, content }) => ({
		filePath: vscode.workspace.asRelativePath(uri),
		content,
		source: 'content' as const,
		score,
	}));
}

// ─── merge and apply budget ───────────────────────────────────────────────────

export function mergeAndBudget(allChunks: GatheredChunk[]): GatheredChunk[] {
	// Deduplicate by filePath: keep the entry with the highest score
	const byPath = new Map<string, GatheredChunk>();
	for (const chunk of allChunks) {
		const existing = byPath.get(chunk.filePath);
		if (!existing || chunk.score > existing.score) {
			byPath.set(chunk.filePath, chunk);
		}
	}

	// Sort: RAG results first (most precise), then by score
	const sourceOrder = { rag: 0, filename: 1, content: 2 };
	const sorted = [...byPath.values()].sort(
		(a, b) =>
			sourceOrder[a.source] - sourceOrder[b.source] ||
			b.score - a.score,
	);

	const result: GatheredChunk[] = [];
	let totalChars = 0;

	for (const chunk of sorted) {
		if (result.length >= MAX_FILES) {break;}
		if (totalChars >= TOTAL_CHAR_BUDGET) {break;}

		const remaining = TOTAL_CHAR_BUDGET - totalChars;
		let content = chunk.content;

		if (content.length > PER_FILE_CHAR_LIMIT) {
			content = content.slice(0, PER_FILE_CHAR_LIMIT) + '\n// … truncated';
		}
		if (content.length > remaining) {
			content = content.slice(0, remaining) + '\n// … truncated';
		}

		result.push({ ...chunk, content });
		totalChars += content.length;
	}

	return result;
}

// ─── prompt formatting ────────────────────────────────────────────────────────

export function formatGatherPrompt(question: string, chunks: GatheredChunk[]): string {
	const lines: string[] = [
		'# Codebase Context for Your Question',
		'',
		`**Question:** ${question}`,
		'',
		'---',
		'',
	];

	if (chunks.length === 0) {
		lines.push(
			'*No relevant files were found in the workspace for this query.*',
			'',
			'*Try using more specific technical terms, or index the workspace first with "Index Codebase for RAG" to enable semantic search.*',
		);
	} else {
		lines.push('## Relevant Files', '');

		for (const chunk of chunks) {
			const ext = path.extname(chunk.filePath).slice(1) || 'text';
			const lineRange =
				chunk.startLine && chunk.endLine
					? ` (lines ${chunk.startLine}–${chunk.endLine})`
					: '';

			const sourceLabel =
				chunk.source === 'rag'
					? `semantic search · similarity ${Math.round(chunk.score * 100)}%`
					: chunk.source === 'filename'
					? 'filename match'
					: 'content match';

			lines.push(`### \`${chunk.filePath}\`${lineRange}`);
			lines.push(`> *Source: ${sourceLabel}*`);
			lines.push('');
			lines.push('```' + ext);
			lines.push(chunk.content);
			lines.push('```');
			lines.push('');
			lines.push('---');
			lines.push('');
		}
	}

	lines.push(
		'*Context gathered from workspace by [Ollama Code Review](https://github.com/glorynguyen/ollama-code-review).*',
		'*Paste into Claude, Gemini, or your preferred LLM to get a detailed answer.*',
	);

	return lines.join('\n');
}

// ─── main export ──────────────────────────────────────────────────────────────

export async function gatherContextForQuestion(
	question: string,
	ragStoragePath: string,
	outputChannel?: vscode.OutputChannel,
): Promise<GatherResult> {
	const terms = extractSearchTerms(question);
	const strategies: string[] = [];

	outputChannel?.appendLine(`[Gather] Question: "${question}"`);
	outputChannel?.appendLine(`[Gather] Search terms: ${terms.join(', ')}`);

	// Strategy A: RAG semantic search (requires a pre-built index)
	const ragChunks = await strategyRag(question, ragStoragePath);
	if (ragChunks.length > 0) {
		strategies.push(`semantic (${ragChunks.length} snippet${ragChunks.length > 1 ? 's' : ''})`);
		outputChannel?.appendLine(`[Gather] RAG: ${ragChunks.length} chunk(s)`);
	}

	// Strategy B: filename keyword search (always runs)
	const filenameChunks = await strategyFilename(terms);
	if (filenameChunks.length > 0) {
		strategies.push(`filename (${filenameChunks.length} file${filenameChunks.length > 1 ? 's' : ''})`);
		outputChannel?.appendLine(`[Gather] Filename: ${filenameChunks.length} file(s)`);
	}

	// Strategy C: content keyword search (only when we have fewer than 5 candidates)
	const allSoFar = [...ragChunks, ...filenameChunks];
	const pathsSoFar = new Set(allSoFar.map(c => c.filePath));
	let contentChunks: GatheredChunk[] = [];
	if (allSoFar.length < 5) {
		contentChunks = await strategyContent(terms, pathsSoFar);
		if (contentChunks.length > 0) {
			strategies.push(`content (${contentChunks.length} file${contentChunks.length > 1 ? 's' : ''})`);
			outputChannel?.appendLine(`[Gather] Content: ${contentChunks.length} file(s)`);
		}
	}

	const merged = mergeAndBudget([...ragChunks, ...filenameChunks, ...contentChunks]);
	const formattedPrompt = formatGatherPrompt(question, merged);
	const totalChars = merged.reduce((sum, c) => sum + c.content.length, 0);

	outputChannel?.appendLine(
		`[Gather] Final: ${merged.length} file(s), ~${Math.round(totalChars / 100) / 10}k chars`,
	);

	return {
		question,
		chunks: merged,
		formattedPrompt,
		stats: { filesFound: merged.length, totalChars, strategies },
	};
}
