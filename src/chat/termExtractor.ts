/**
 * Term extraction module — single responsibility: turn a question into search terms.
 *
 * Two strategies:
 *   1. Heuristic: stopword removal + PascalCase/camelCase expansion (always available)
 *   2. AI-powered: LLM understands the question intent and outputs precise code-aware terms
 *
 * The composite `createTermExtractor()` tries AI first and falls back to heuristic.
 */

// ─── types ───────────────────────────────────────────────────────────────────

/** Callback for one-shot LLM generation — depends on abstraction, not concrete provider. */
export type GenerateFn = (prompt: string, signal?: AbortSignal) => Promise<string>;

export interface TermExtractionResult {
	terms: string[];
	source: 'ai' | 'heuristic' | 'ai-failed';
	/** When source is 'ai-failed', describes why AI extraction failed. */
	failureReason?: string;
}

// ─── heuristic term extractor ────────────────────────────────────────────────

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

/**
 * Extract search terms from a question using stopword removal and case-variant expansion.
 * Pure function — no AI or I/O required.
 */
export function heuristicTermExtractor(question: string): string[] {
	const raw = question
		.toLowerCase()
		.split(/[\s\-_.,;:!?'"()\[\]{}\/\\+]+/)
		.map(w => w.replace(/[^a-z0-9]/g, ''))
		.filter(w => w.length >= 2 && !STOPWORDS.has(w));

	if (raw.length === 0) {
		return question.split(/\s+/).filter(w => w.length >= 2).slice(0, 5);
	}

	const terms = new Set<string>(raw);

	for (const w of [...raw]) {
		terms.add(w.charAt(0).toUpperCase() + w.slice(1));
	}

	for (let i = 0; i < raw.length - 1; i++) {
		const compound = raw[i] + raw[i + 1].charAt(0).toUpperCase() + raw[i + 1].slice(1);
		terms.add(compound);
		terms.add(compound.charAt(0).toUpperCase() + compound.slice(1));
	}

	return [...terms];
}

// ─── AI term extractor ───────────────────────────────────────────────────────

const TERM_EXTRACTION_TIMEOUT_MS = 5_000;
const MAX_TERMS = 15;

const TERM_EXTRACTION_PROMPT = `You are a code search assistant. Given a developer's question about a codebase, output ONLY a JSON array of 5-15 search terms that would help find relevant source files.

Include:
- Likely file names (with and without extensions, e.g. "authService.ts", "authService")
- Class names, function names, variable names (e.g. "AuthService", "handleLogin")
- Module or directory names (e.g. "auth", "middleware")
- Technical keywords relevant to the question
- Both PascalCase and camelCase variants when applicable

Do NOT include common English words, explanations, or anything other than the JSON array.

Example:
Question: "How does the authentication flow work?"
["AuthService", "authService", "authentication", "login", "handleLogin", "authMiddleware", "auth.ts", "session", "SessionManager", "authFlow"]

Question: `;

export interface AiTermResult {
	terms: string[] | null;
	/** Set when terms is null — explains why AI extraction failed. */
	failureReason?: string;
}

/**
 * Build an AI-powered term extractor using the provided generation callback.
 * Returns `{ terms: null, failureReason }` on failure so the caller can surface the reason.
 */
export async function aiTermExtractor(
	question: string,
	generateFn: GenerateFn,
	outputChannel?: { appendLine(value: string): void },
	token?: { readonly isCancellationRequested: boolean; onCancellationRequested?: (listener: () => void) => { dispose(): void } },
): Promise<AiTermResult> {
	if (token?.isCancellationRequested) { return { terms: null, failureReason: 'cancelled' }; }
	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	let cancelDisposable: { dispose(): void } | undefined;
	const abortController = new AbortController();
	try {
		const prompt = TERM_EXTRACTION_PROMPT + JSON.stringify(question);

		const generatePromise = generateFn(prompt, abortController.signal);
		// Guard against unhandled rejection if this promise loses the race
		generatePromise.catch(() => {});

		const racers: Promise<string | null>[] = [
			generatePromise,
			new Promise<never>((_, reject) => {
				timeoutHandle = setTimeout(() => reject(new Error('term extraction timeout')), TERM_EXTRACTION_TIMEOUT_MS);
			}),
		];

		// If a cancellation token is provided, add a race branch so cancel resolves immediately
		const onCancel = token?.onCancellationRequested;
		if (onCancel) {
			racers.push(new Promise<null>(resolve => {
				cancelDisposable = onCancel.call(token, () => {
					abortController.abort();
					resolve(null);
				});
			}));
		}

		const response = await Promise.race(racers);

		if (response === null || typeof response !== 'string') { return { terms: null, failureReason: 'empty response from AI' }; }

		// Extract JSON array from response — try direct parse first, then bracket extraction
		let parsed: unknown;
		try {
			parsed = JSON.parse(response.trim());
		} catch {
			const jsonMatch = response.match(/\[[\s\S]*\]/);
			if (!jsonMatch) { return { terms: null, failureReason: 'AI response was not valid JSON' }; }
			parsed = JSON.parse(jsonMatch[0]);
		}
		if (!Array.isArray(parsed) || parsed.length === 0) { return { terms: null, failureReason: 'AI returned empty or non-array result' }; }

		const terms = [...new Set(
			parsed.filter((item): item is string => typeof item === 'string' && item.length >= 2),
		)].slice(0, MAX_TERMS);

		return terms.length > 0 ? { terms } : { terms: null, failureReason: 'AI returned no valid string terms' };
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		outputChannel?.appendLine(`[TermExtractor] AI extraction failed: ${reason}`);
		return { terms: null, failureReason: reason };
	} finally {
		if (timeoutHandle) { clearTimeout(timeoutHandle); }
		cancelDisposable?.dispose();
		abortController.abort();
	}
}

// ─── composite extractor ─────────────────────────────────────────────────────

/**
 * Create a term extraction result: tries AI first (if `generateFn` is provided),
 * falls back to heuristic on failure or when no AI callback is available.
 */
export async function extractTerms(
	question: string,
	generateFn?: GenerateFn,
	outputChannel?: { appendLine(value: string): void },
	token?: { readonly isCancellationRequested: boolean; onCancellationRequested?: (listener: () => void) => { dispose(): void } },
): Promise<TermExtractionResult> {
	if (generateFn) {
		const result = await aiTermExtractor(question, generateFn, outputChannel, token);
		if (result.terms) {
			return { terms: result.terms, source: 'ai' };
		}
		// AI was requested but failed — fall back to heuristic with distinct source
		return { terms: heuristicTermExtractor(question), source: 'ai-failed', failureReason: result.failureReason };
	}

	return { terms: heuristicTermExtractor(question), source: 'heuristic' };
}
