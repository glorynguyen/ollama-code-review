import * as vscode from 'vscode';

/**
 * A review profile adjusts the AI's focus area and severity level.
 */
export interface ReviewProfile {
	name: string;
	description: string;
	focusAreas: string[];
	severity: 'lenient' | 'balanced' | 'strict';
	includeExplanations: boolean;
}

/**
 * Built-in profiles that ship with the extension.
 */
export const BUILTIN_PROFILES: ReviewProfile[] = [
	{
		name: 'general',
		description: 'Best practices, readability, and bug detection',
		focusAreas: [
			'Potential bugs or logical errors',
			'Code readability and maintainability',
			'Best practices and design patterns',
			'Naming conventions and code style'
		],
		severity: 'balanced',
		includeExplanations: true
	},
	{
		name: 'security',
		description: 'Vulnerabilities, injection attacks, auth, and secrets',
		focusAreas: [
			'SQL injection and NoSQL injection',
			'Cross-site scripting (XSS) and cross-site request forgery (CSRF)',
			'Authentication and authorization flaws',
			'Hardcoded secrets, API keys, and credentials',
			'Insecure deserialization',
			'Improper input validation and sanitization',
			'Insecure cryptographic usage',
			'Path traversal and file inclusion vulnerabilities'
		],
		severity: 'strict',
		includeExplanations: true
	},
	{
		name: 'performance',
		description: 'Memory leaks, N+1 queries, and algorithmic complexity',
		focusAreas: [
			'Memory leaks and resource cleanup',
			'N+1 queries and database performance',
			'Algorithmic complexity (Big-O analysis)',
			'Unnecessary re-renders and wasted computations',
			'Bundle size impact and lazy loading opportunities',
			'Caching opportunities',
			'Blocking operations on the main thread'
		],
		severity: 'balanced',
		includeExplanations: true
	},
	{
		name: 'accessibility',
		description: 'ARIA attributes, keyboard navigation, and color contrast',
		focusAreas: [
			'Missing or incorrect ARIA attributes',
			'Keyboard navigation and focus management',
			'Color contrast and visual accessibility',
			'Screen reader compatibility',
			'Semantic HTML usage',
			'Form labels and error messaging',
			'Motion and animation preferences (prefers-reduced-motion)'
		],
		severity: 'balanced',
		includeExplanations: true
	},
	{
		name: 'educational',
		description: 'Detailed explanations for learning and junior developers',
		focusAreas: [
			'Code readability and clarity',
			'Design pattern usage and alternatives',
			'Common pitfalls and how to avoid them',
			'Language/framework idioms and best practices',
			'Testing strategies and testability'
		],
		severity: 'lenient',
		includeExplanations: true
	},
	{
		name: 'strict',
		description: 'All issues flagged, no leniency — for critical code paths',
		focusAreas: [
			'All potential bugs including edge cases',
			'Security vulnerabilities of any severity',
			'Performance issues of any magnitude',
			'Code style and naming deviations',
			'Missing error handling and edge cases',
			'Type safety and null checks',
			'Test coverage gaps',
			'Documentation completeness'
		],
		severity: 'strict',
		includeExplanations: false
	}
];

/**
 * GlobalState key for the active profile name.
 */
const ACTIVE_PROFILE_KEY = 'activeReviewProfile';

/**
 * GlobalState key for user-defined custom profiles.
 */
const CUSTOM_PROFILES_KEY = 'customReviewProfiles';

/**
 * Get all available profiles (built-in + custom from settings + custom from globalState).
 */
export function getAllProfiles(context: vscode.ExtensionContext): ReviewProfile[] {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const settingsProfiles = config.get<ReviewProfile[]>('customProfiles', []);
	const stateProfiles = context.globalState.get<ReviewProfile[]>(CUSTOM_PROFILES_KEY, []);

	// Merge: built-in first, then settings, then globalState (later entries override by name)
	const byName = new Map<string, ReviewProfile>();
	for (const p of BUILTIN_PROFILES) {
		byName.set(p.name, p);
	}
	for (const p of settingsProfiles) {
		if (p.name && p.focusAreas?.length) {
			byName.set(p.name, p);
		}
	}
	for (const p of stateProfiles) {
		if (p.name && p.focusAreas?.length) {
			byName.set(p.name, p);
		}
	}
	return Array.from(byName.values());
}

/**
 * Get the currently active profile name from globalState.
 */
export function getActiveProfileName(context: vscode.ExtensionContext): string {
	return context.globalState.get<string>(ACTIVE_PROFILE_KEY, 'general');
}

/**
 * Set the active profile name in globalState.
 */
export async function setActiveProfileName(context: vscode.ExtensionContext, name: string): Promise<void> {
	await context.globalState.update(ACTIVE_PROFILE_KEY, name);
}

/**
 * Resolve the active profile object. Falls back to 'general' if not found.
 */
export function getActiveProfile(context: vscode.ExtensionContext): ReviewProfile {
	const name = getActiveProfileName(context);
	const all = getAllProfiles(context);
	return all.find(p => p.name === name) || BUILTIN_PROFILES[0];
}

/**
 * Save a custom profile to globalState.
 */
export async function saveCustomProfile(context: vscode.ExtensionContext, profile: ReviewProfile): Promise<void> {
	const existing = context.globalState.get<ReviewProfile[]>(CUSTOM_PROFILES_KEY, []);
	const idx = existing.findIndex((p: ReviewProfile) => p.name === profile.name);
	if (idx >= 0) {
		existing[idx] = profile;
	} else {
		existing.push(profile);
	}
	await context.globalState.update(CUSTOM_PROFILES_KEY, existing);
}

/**
 * Delete a custom profile from globalState. Cannot delete built-in profiles.
 */
export async function deleteCustomProfile(context: vscode.ExtensionContext, name: string): Promise<boolean> {
	if (BUILTIN_PROFILES.some(p => p.name === name)) {
		return false; // Cannot delete built-in
	}
	const existing = context.globalState.get<ReviewProfile[]>(CUSTOM_PROFILES_KEY, []);
	const filtered = existing.filter((p: ReviewProfile) => p.name !== name);
	if (filtered.length === existing.length) {
		return false; // Not found
	}
	await context.globalState.update(CUSTOM_PROFILES_KEY, filtered);

	// If the deleted profile was active, reset to general
	if (getActiveProfileName(context) === name) {
		await setActiveProfileName(context, 'general');
	}
	return true;
}

/**
 * Build the profile context string to inject into the review prompt.
 * Returns empty string for 'general' profile (keeps backward compatibility).
 */
export function buildProfilePromptContext(profile: ReviewProfile): string {
	if (profile.name === 'general') {
		return '';
	}

	const severityInstructions: Record<string, string> = {
		lenient: 'Be encouraging and constructive. Only flag significant issues. Provide detailed explanations for each finding.',
		balanced: 'Flag important issues while acknowledging good practices. Provide explanations where helpful.',
		strict: 'Flag every issue regardless of severity. Be thorough and leave nothing unaddressed.'
	};

	const lines = [
		`\n**Active Review Profile: ${profile.name}**`,
		`*${profile.description}*`,
		'',
		'**Profile-Specific Focus Areas (prioritize these):**',
		...profile.focusAreas.map(area => `- ${area}`),
		'',
		`**Severity Level:** ${profile.severity}`,
		severityInstructions[profile.severity] || severityInstructions.balanced,
	];

	if (profile.includeExplanations) {
		lines.push('', '**Explanation Level:** Provide detailed explanations and reasoning for each finding.');
	} else {
		lines.push('', '**Explanation Level:** Be concise. Focus on actionable findings without lengthy explanations.');
	}

	return lines.join('\n');
}
