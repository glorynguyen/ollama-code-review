const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/i;
const EMBEDDED_COMMIT_HASH_PATTERN = /\b[0-9a-f]{7,40}\b/i;
const COMMIT_HASH_KEYS = [
	'hash',
	'sha',
	'commit',
	'commitHash',
	'commitSha',
	'commitId',
	'shortSha',
	'ref',
	'revision',
	'id',
	'webviewItemValue',
] as const;
const REPOSITORY_CONTAINER_KEYS = [
	'repository',
	'ref',
	'webviewItemValue',
] as const;
const REPOSITORY_PATH_KEYS = [
	'repoRoot',
	'repoPath',
	'repositoryPath',
	'root',
	'path',
] as const;

function isObjectLike(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function getKnownProperty(value: Record<string, unknown>, key: string): unknown {
	try {
		return value[key];
	} catch {
		return undefined;
	}
}

function extractCommitHashFromString(value: string, allowEmbedded = false): string | undefined {
	const trimmed = value.trim();
	if (COMMIT_HASH_PATTERN.test(trimmed)) {
		return trimmed;
	}

	if (allowEmbedded && /(commit|sha|hash|ref|revision|gitlens)/i.test(trimmed)) {
		return trimmed.match(EMBEDDED_COMMIT_HASH_PATTERN)?.[0];
	}

	return undefined;
}

function extractCommitHashFromValue(value: unknown, seen = new WeakSet<object>()): string | undefined {
	if (typeof value === 'string') {
		return extractCommitHashFromString(value);
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			const hash = extractCommitHashFromValue(item, seen);
			if (hash) {
				return hash;
			}
		}
		return undefined;
	}

	if (!isObjectLike(value)) {
		return undefined;
	}

	if (seen.has(value)) {
		return undefined;
	}
	seen.add(value);

	for (const key of COMMIT_HASH_KEYS) {
		const candidate = getKnownProperty(value, key);
		if (candidate === undefined) {
			continue;
		}

		if (typeof candidate === 'string') {
			const hash = extractCommitHashFromString(candidate, true);
			if (hash) {
				return hash;
			}
		} else {
			const hash = extractCommitHashFromValue(candidate, seen);
			if (hash) {
				return hash;
			}
		}
	}

	return undefined;
}

export function extractCommitHashFromCommandArgs(...args: unknown[]): string | undefined {
	return extractCommitHashFromValue(args);
}

function extractRepositoryPathFromValue(value: unknown, seen = new WeakSet<object>()): string | undefined {
	if (Array.isArray(value)) {
		for (const item of value) {
			const repoPath = extractRepositoryPathFromValue(item, seen);
			if (repoPath) {
				return repoPath;
			}
		}
		return undefined;
	}

	if (!isObjectLike(value)) {
		return undefined;
	}

	if (seen.has(value)) {
		return undefined;
	}
	seen.add(value);

	const rootUri = getKnownProperty(value, 'rootUri');
	if (isObjectLike(rootUri)) {
		const fsPath = getKnownProperty(rootUri, 'fsPath');
		if (typeof fsPath === 'string') {
			return fsPath;
		}
	}

	for (const key of REPOSITORY_PATH_KEYS) {
		const candidate = getKnownProperty(value, key);
		if (typeof candidate !== 'string') {
			continue;
		}

		return candidate;
	}

	for (const key of REPOSITORY_CONTAINER_KEYS) {
		const repoPath = extractRepositoryPathFromValue(getKnownProperty(value, key), seen);
		if (repoPath) {
			return repoPath;
		}
	}

	return undefined;
}

export function extractRepositoryPathFromCommandArgs(...args: unknown[]): string | undefined {
	return extractRepositoryPathFromValue(args);
}
