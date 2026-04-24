import * as fs from 'fs/promises';
import * as path from 'path';

export type PathValidation = { valid: true; resolvedPath: string } | { valid: false; error: string };

/**
 * Resolve a path and verify it stays within the workspace boundary.
 * Uses fs.realpath() to follow symlinks before checking the boundary,
 * preventing symlink-based traversal attacks (e.g. a symlink inside the
 * workspace that points to /etc/passwd bypassing a naive startsWith check).
 *
 * For new files that don't exist yet, the parent directory is realpath'd
 * instead so the check is still symlink-safe.
 */
export async function resolveAndValidatePath(filePath: string, repoPath: string | readonly string[]): Promise<PathValidation> {
	const roots = Array.isArray(repoPath) ? repoPath as readonly string[] : [repoPath as string];

	for (const root of roots) {
		const normalizedRepo = await fs.realpath(root).catch(() => path.resolve(root));
		const tentativePath = path.isAbsolute(filePath)
			? path.resolve(filePath)
			: path.resolve(root, filePath);

		let resolvedPath: string;
		try {
			resolvedPath = await fs.realpath(tentativePath);
		} catch {
			// File doesn't exist yet — resolve the parent directory instead
			const parentDir = path.dirname(tentativePath);
			try {
				const realParent = await fs.realpath(parentDir);
				resolvedPath = path.join(realParent, path.basename(tentativePath));
			} catch {
				// Parent doesn't exist either; use the tentative path as-is
				resolvedPath = tentativePath;
			}
		}

		const isInsideRepo =
			resolvedPath === normalizedRepo || resolvedPath.startsWith(normalizedRepo + path.sep);

		if (isInsideRepo) {
			return { valid: true, resolvedPath };
		}
	}

	return { valid: false, error: `Access denied. Path is outside the workspace: ${filePath}` };
}
