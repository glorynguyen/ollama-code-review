/**
 * F-052: Dependency Risk Review
 *
 * Extracts direct dependency additions from a unified diff and looks them up
 * with the OSV vulnerability database. The module deliberately has no VS Code
 * dependency so its parsing and result mapping stay easy to test.
 */

import axios from 'axios';
import type { Severity } from './github/commentMapper';
import type { ValidatedStructuredReviewFinding } from './reviewFindings';

export type DependencyEcosystem = 'npm' | 'PyPI' | 'RubyGems' | 'Go';

export interface DependencyChange {
	name: string;
	version: string;
	ecosystem: DependencyEcosystem;
	file: string;
	line: number;
	group?: string;
}

interface OsvVulnerability {
	id: string;
	summary?: string;
	details?: string;
	aliases?: string[];
	database_specific?: { severity?: string };
	severity?: Array<{ score?: string }>;
}

interface OsvResponse {
	vulns?: OsvVulnerability[];
}

export interface DependencyRiskConfig {
	enabled?: boolean;
	maxDependencies?: number;
	timeoutMs?: number;
}

export interface DependencyRiskResult {
	changes: DependencyChange[];
	findings: ValidatedStructuredReviewFinding[];
	checkedCount: number;
	failures: number;
}

export type OsvQuery = (dependency: DependencyChange, timeoutMs: number) => Promise<OsvResponse>;

const DEFAULT_MAX_DEPENDENCIES = 25;
const DEFAULT_TIMEOUT_MS = 5000;
const OSV_QUERY_URL = 'https://api.osv.dev/v1/query';
const OSV_CACHE_TTL_MS = 30 * 60 * 1000;
const OSV_CACHE_MAX_ENTRIES = 250;
const osvResponseCache = new Map<string, { expiresAt: number; response: OsvResponse }>();

/**
 * Parses exact-version npm, PyPI, RubyGems, and Go dependencies added in a unified diff.
 * Range, workspace, file and git specifications are skipped: OSV's version
 * query needs a concrete release and guessing one would produce false alarms.
 */
export function extractDependencyChanges(diff: string): DependencyChange[] {
	const changes: DependencyChange[] = [];
	let file: string | undefined;
	let line: number | undefined;
	let npmGroup: string | undefined;

	for (const diffLine of diff.split('\n')) {
		const fileMatch = diffLine.match(/^\+\+\+ b\/(.+)$/);
		if (fileMatch) {
			file = fileMatch[1];
			line = undefined;
			npmGroup = undefined;
			continue;
		}

		const hunkMatch = diffLine.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
		if (hunkMatch) {
			line = Number.parseInt(hunkMatch[1], 10);
			continue;
		}

		if (!file || line === undefined) {
			continue;
		}

		if (diffLine.startsWith('+') && !diffLine.startsWith('+++')) {
			const content = diffLine.slice(1);
			if (isPackageJson(file)) {
				const groupMatch = content.match(/^\s*"(dependencies|devDependencies|peerDependencies|optionalDependencies)"\s*:\s*\{/);
				if (groupMatch) {
					npmGroup = groupMatch[1];
				} else if (npmGroup && /^\s*},?\s*$/.test(content)) {
					npmGroup = undefined;
				} else {
					// Git's hunk context may not reach the start of a large dependency
					// object. In that case, still recognise a semver-shaped dependency
					// line while excluding package metadata such as `version`.
					const dependency = parsePackageJsonDependency(content, file, line, npmGroup);
					if (dependency) { changes.push(dependency); }
				}
			} else if (isRequirementsFile(file)) {
				const dependency = parseRequirement(content, file, line);
				if (dependency) { changes.push(dependency); }
			} else if (isGemfile(file)) {
				const dependency = parseGemfileDependency(content, file, line);
				if (dependency) { changes.push(dependency); }
			} else if (isGoMod(file)) {
				const dependency = parseGoModuleDependency(content, file, line);
				if (dependency) { changes.push(dependency); }
			}
			line++;
		} else if (diffLine.startsWith(' ') || diffLine === '') {
			const content = diffLine.startsWith(' ') ? diffLine.slice(1) : diffLine;
			if (isPackageJson(file)) {
				const groupMatch = content.match(/^\s*"(dependencies|devDependencies|peerDependencies|optionalDependencies)"\s*:\s*\{/);
				if (groupMatch) {
					npmGroup = groupMatch[1];
				} else if (npmGroup && /^\s*},?\s*$/.test(content)) {
					npmGroup = undefined;
				}
			}
			line++;
		}
	}

	return deduplicateChanges(changes);
}

export async function reviewDependencyRisks(
	diff: string,
	config: DependencyRiskConfig = {},
	query: OsvQuery = queryOsv,
): Promise<DependencyRiskResult> {
	const changes = extractDependencyChanges(diff);
	if (config.enabled === false || changes.length === 0) {
		return { changes, findings: [], checkedCount: 0, failures: 0 };
	}

	const maxDependencies = clamp(config.maxDependencies, DEFAULT_MAX_DEPENDENCIES, 1, 100);
	const timeoutMs = clamp(config.timeoutMs, DEFAULT_TIMEOUT_MS, 500, 30_000);
	const findings: ValidatedStructuredReviewFinding[] = [];
	let checkedCount = 0;
	let failures = 0;

	for (const dependency of changes.slice(0, maxDependencies)) {
		try {
			const response = await query(dependency, timeoutMs);
			checkedCount++;
			for (const vulnerability of response.vulns ?? []) {
				findings.push(toStructuredFinding(dependency, vulnerability, findings.length));
			}
		} catch {
			failures++;
		}
	}

	return { changes, findings, checkedCount, failures };
}

export async function queryOsv(dependency: DependencyChange, timeoutMs: number): Promise<OsvResponse> {
	const cacheKey = `${dependency.ecosystem}:${dependency.name}@${dependency.version}`;
	const cached = osvResponseCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.response;
	}
	if (cached) {
		osvResponseCache.delete(cacheKey);
	}

	const response = await axios.post<OsvResponse>(OSV_QUERY_URL, {
		package: { name: dependency.name, ecosystem: dependency.ecosystem },
		version: dependency.version,
	}, { timeout: timeoutMs });
	if (osvResponseCache.size >= OSV_CACHE_MAX_ENTRIES) {
		const oldestKey = osvResponseCache.keys().next().value;
		if (oldestKey) { osvResponseCache.delete(oldestKey); }
	}
	osvResponseCache.set(cacheKey, { expiresAt: Date.now() + OSV_CACHE_TTL_MS, response: response.data });
	return response.data;
}

export function renderDependencyRiskMarkdown(findings: readonly ValidatedStructuredReviewFinding[]): string {
	if (findings.length === 0) { return ''; }
	const items = findings.map((finding) => {
		const location = finding.anchor ? `\`${finding.anchor.file}:${finding.anchor.line}\`` : 'dependency manifest';
		const suggestion = finding.fix?.summary ? `\n  - Suggestion: ${finding.fix.summary}` : '';
		return `- **${capitalize(finding.severity)}**: ${finding.summary}\n  - Location: ${location}${suggestion}`;
	});
	return `## ⚠️ Dependency Risk\n\n${items.join('\n\n')}\n\n---\n\n`;
}

export function buildDependencyRiskPromptContext(findings: readonly ValidatedStructuredReviewFinding[]): string {
	if (findings.length === 0) { return ''; }
	return [
		'## Deterministic Dependency Vulnerability Results',
		'The following OSV advisories were found for newly added or upgraded direct dependencies. Treat them as verified context; do not repeat them unless you can add code-specific remediation advice.',
		...findings.map((finding) => `- ${finding.title}: ${finding.summary}`),
	].join('\n');
}

function parsePackageJsonDependency(content: string, file: string, line: number, group: string | undefined): DependencyChange | undefined {
	const match = content.match(/^\s*"((?:@[^/\s]+\/)?[^"\s]+)"\s*:\s*"([^"]+)"\s*,?\s*$/);
	if (!match) { return undefined; }
	if (!group && new Set(['name', 'version', 'description', 'main', 'module', 'types', 'packageManager']).has(match[1])) {
		return undefined;
	}
	const version = normalizeNpmVersion(match[2]);
	return version ? { name: match[1], version, ecosystem: 'npm', file, line, group } : undefined;
}

function parseRequirement(content: string, file: string, line: number): DependencyChange | undefined {
	const trimmed = content.trim();
	if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) { return undefined; }
	const match = trimmed.match(/^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?\s*===?\s*([A-Za-z0-9][A-Za-z0-9._+!-]*)/);
	if (!match) { return undefined; }
	return { name: match[1], version: match[2], ecosystem: 'PyPI', file, line, group: 'requirements' };
}

function parseGemfileDependency(content: string, file: string, line: number): DependencyChange | undefined {
	const match = content.trim().match(/^gem\s+['"]([^'"]+)['"]\s*,\s*['"](?:=\s*)?([0-9][0-9A-Za-z._+-]*)['"]/);
	if (!match) { return undefined; }
	return { name: match[1], version: match[2], ecosystem: 'RubyGems', file, line, group: 'gem' };
}

function parseGoModuleDependency(content: string, file: string, line: number): DependencyChange | undefined {
	const match = content.trim().match(/^([A-Za-z0-9._~/-]+)\s+(v[0-9][0-9A-Za-z.+-]*)\s*(?:\/\/.*)?$/);
	if (!match || match[1] === 'require' || match[1] === 'module' || match[1] === 'go') { return undefined; }
	return { name: match[1], version: match[2], ecosystem: 'Go', file, line, group: 'require' };
}

function normalizeNpmVersion(specifier: string): string | undefined {
	const trimmed = specifier.trim();
	if (/^(?:workspace:|file:|git\+|https?:|github:|latest$|\*|[~^<>=|])/i.test(trimmed)) {
		return undefined;
	}
	return /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(trimmed)
		? trimmed
		: undefined;
}

function toStructuredFinding(
	dependency: DependencyChange,
	vulnerability: OsvVulnerability,
	index: number,
): ValidatedStructuredReviewFinding {
	const severity = getSeverity(vulnerability);
	const advisory = vulnerability.aliases?.[0] ?? vulnerability.id;
	const summary = vulnerability.summary?.trim() || vulnerability.details?.split('\n')[0]?.trim() || 'Known vulnerability reported by OSV.';
	return {
		id: `dependency-${dependency.ecosystem}-${dependency.name}-${dependency.version}-${vulnerability.id}-${index}`,
		severity,
		title: `${dependency.name}@${dependency.version} — ${advisory}`,
		summary: `${dependency.name}@${dependency.version} has ${advisory}: ${summary}`,
		confidence: 1,
		category: 'Dependency Security',
		anchor: { file: dependency.file, line: dependency.line },
		evidence: [{
			kind: 'diff',
			summary: `OSV reported ${vulnerability.id} for ${dependency.ecosystem} package ${dependency.name}@${dependency.version}.`,
		}],
		fix: { summary: `Upgrade ${dependency.name} to a version that resolves ${advisory}; consult https://osv.dev/vulnerability/${encodeURIComponent(vulnerability.id)}.` },
		anchorValidation: {
			status: 'valid',
			normalizedAnchor: { file: dependency.file, line: dependency.line },
		},
	};
}

function getSeverity(vulnerability: OsvVulnerability): Severity {
    const declared = vulnerability.database_specific?.severity?.toLowerCase();

    if (declared === 'critical') return 'critical';
    if (declared === 'high' || declared === 'important') return 'high';
    if (declared === 'moderate' || declared === 'medium') return 'medium';
    if (
        declared === 'low' ||
        declared === 'info' ||
        declared === 'informational'
    ) {
        return 'low';
    }

    const vectors =
        vulnerability.severity
            ?.map(item => item.score?.trim())
            .filter((v): v is string => Boolean(v)) ?? [];

    // Non-standard feeds may provide raw numeric scores.
    for (const value of vectors) {
        const numeric = Number(value);

        if (Number.isFinite(numeric)) {
            if (numeric >= 9.0) return 'critical';
            if (numeric >= 7.0) return 'high';
            if (numeric >= 4.0) return 'medium';
            if (numeric > 0.0) return 'low';
        }
    }

    // Best-effort fallback for OSV CVSS vectors.
    const joined = vectors.join(' ').toUpperCase();

    if (
        joined.includes('AV:N') &&
        (
            joined.includes('/S:C') ||
            (joined.includes('/C:H') && joined.includes('/I:H'))
        )
    ) {
        return 'critical';
    }

    if (
        joined.includes('/C:H') ||
        joined.includes('/I:H') ||
        joined.includes('/A:H')
    ) {
        return 'high';
    }

    if (
        joined.includes('/C:L') ||
        joined.includes('/I:L') ||
        joined.includes('/A:L')
    ) {
        return 'medium';
    }

    return 'high';
}

function isPackageJson(file: string): boolean {
	return /(?:^|\/)package\.json$/i.test(file);
}

function isRequirementsFile(file: string): boolean {
	return /(?:^|\/)(?:requirements(?:[-._][^/]*)?\.txt|requirements\.in)$/i.test(file);
}

function isGemfile(file: string): boolean {
	return /(?:^|\/)Gemfile$/i.test(file);
}

function isGoMod(file: string): boolean {
	return /(?:^|\/)go\.mod$/i.test(file);
}

function deduplicateChanges(changes: DependencyChange[]): DependencyChange[] {
	const seen = new Set<string>();
	return changes.filter((change) => {
		// A duplicated declaration within one manifest still represents one
		// package/version lookup. Keep the first line as the canonical anchor.
		const key = `${change.ecosystem}|${change.name}|${change.version}|${change.file}`;
		if (seen.has(key)) { return false; }
		seen.add(key);
		return true;
	});
}

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
	if (!Number.isFinite(value)) { return fallback; }
	return Math.min(max, Math.max(min, Math.floor(value!)));
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}
