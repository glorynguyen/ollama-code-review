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
	/** Optional grouping label shown as a separator in the picker (e.g. 'Compliance'). */
	group?: string;
	/** Optional compliance-specific preamble injected before the focus areas in the prompt. */
	complianceContext?: string;
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
 * Compliance-focused profiles for regulatory and security framework auditing.
 * These appear under a "Compliance" group separator in the profile picker.
 */
export const COMPLIANCE_PROFILES: ReviewProfile[] = [
	{
		name: 'owasp-top10',
		group: 'Compliance',
		description: 'OWASP Top 10 (2021) — web application security risks',
		focusAreas: [
			'A01 Broken Access Control — missing authorization checks, IDOR',
			'A02 Cryptographic Failures — weak algorithms, plaintext secrets, insecure TLS',
			'A03 Injection — SQL, NoSQL, LDAP, OS command, and template injection',
			'A04 Insecure Design — missing threat modelling, flawed business logic',
			'A05 Security Misconfiguration — default credentials, verbose errors, open CORS',
			'A06 Vulnerable Components — outdated or unpatched dependencies',
			'A07 Auth & Session Failures — weak passwords, improper session management',
			'A08 Software Integrity Failures — unsigned updates, insecure deserialization',
			'A09 Logging & Monitoring Failures — missing audit trails, silent catch blocks',
			'A10 Server-Side Request Forgery (SSRF) — unvalidated URL inputs'
		],
		severity: 'strict',
		includeExplanations: true,
		complianceContext: 'You are auditing code against the OWASP Top 10 (2021 edition). For every finding, cite the relevant OWASP category identifier (e.g. A03:2021 – Injection) and explain the risk it poses. Prioritise exploitability and real-world impact.'
	},
	{
		name: 'pci-dss',
		group: 'Compliance',
		description: 'PCI-DSS v4 — cardholder data protection and payment security',
		focusAreas: [
			'Cardholder data (PAN, CVV, expiry) stored, logged, or transmitted unencrypted',
			'Missing TLS 1.2+ enforcement on all payment data channels',
			'Weak or default credentials for payment system components',
			'Insufficient access controls — least privilege not applied',
			'Lack of audit logging for sensitive operations (Requirement 10)',
			'Missing input validation on payment form fields',
			'Insecure key management — hardcoded keys or weak key storage',
			'Unpatched dependencies in the payment processing path'
		],
		severity: 'strict',
		includeExplanations: true,
		complianceContext: 'You are auditing code for PCI-DSS v4 compliance. Cite the relevant PCI-DSS requirement number (e.g. Requirement 6.2.4) for each finding. Flag any code that could expose cardholder data or weaken payment security controls.'
	},
	{
		name: 'gdpr',
		group: 'Compliance',
		description: 'GDPR / CCPA — personal data handling and privacy by design',
		focusAreas: [
			'PII collected without explicit consent or beyond stated purpose (data minimisation)',
			'Personal data stored longer than necessary (retention limits)',
			'Missing or insufficient data anonymisation / pseudonymisation',
			'Logging or debugging output that captures personal data',
			'Third-party data sharing without adequate safeguards',
			'Missing right-to-erasure (delete) or right-to-access (export) support',
			'Insecure transfer of personal data across borders',
			'Insufficient encryption of data at rest containing personal data'
		],
		severity: 'strict',
		includeExplanations: true,
		complianceContext: 'You are auditing code for GDPR and CCPA compliance. Reference the relevant GDPR article (e.g. Art. 5 – Principles) for each finding. Emphasise privacy-by-design: data minimisation, purpose limitation, and the data subject rights.'
	},
	{
		name: 'hipaa',
		group: 'Compliance',
		description: 'HIPAA — protected health information (PHI) safeguards',
		focusAreas: [
			'PHI stored, logged, or transmitted without encryption (AES-256 / TLS 1.2+)',
			'Missing access controls and authentication for PHI systems',
			'Insufficient audit logging for PHI access and modifications',
			'PHI exposed in URLs, query strings, or error messages',
			'Inadequate session management for clinical applications',
			'Missing de-identification before data is used for analytics',
			'Unauthorized data sharing with business associates lacking BAAs',
			'Missing automatic logoff for sessions accessing PHI'
		],
		severity: 'strict',
		includeExplanations: true,
		complianceContext: 'You are auditing code for HIPAA compliance (Security Rule § 164.312 and Privacy Rule § 164.502). Cite the relevant HIPAA section for each finding. Prioritise any code path that handles, stores, or transmits Protected Health Information (PHI).'
	},
	{
		name: 'soc2',
		group: 'Compliance',
		description: 'SOC 2 Type II — availability, confidentiality, and change management',
		focusAreas: [
			'Missing or insufficient access control and authentication (CC6)',
			'Lack of encryption for data in transit and at rest (CC6.1)',
			'Insufficient audit logging and monitoring (CC7.2)',
			'Missing error handling that could cause availability failures (A1)',
			'Hardcoded credentials or secrets in source code (CC6.7)',
			'Missing input validation leading to data integrity issues (PI1)',
			'Inadequate change management — missing tests or review gates (CC8)',
			'Insecure third-party integrations without vendor risk assessment (CC9)'
		],
		severity: 'strict',
		includeExplanations: true,
		complianceContext: 'You are auditing code for SOC 2 Type II compliance. Reference the relevant SOC 2 Common Criteria identifier (e.g. CC6.1) for each finding. Focus on the five Trust Services Criteria: Security, Availability, Processing Integrity, Confidentiality, and Privacy.'
	},
	{
		name: 'nist-csf',
		group: 'Compliance',
		description: 'NIST CSF 2.0 — identify, protect, detect, respond, recover',
		focusAreas: [
			'IDENTIFY — missing asset inventory, undocumented data flows, unclear trust boundaries',
			'PROTECT — inadequate access control, missing encryption, no least-privilege principle',
			'PROTECT — missing input validation and output encoding against injection',
			'DETECT — insufficient logging, missing anomaly detection hooks, silent failures',
			'DETECT — hardcoded credentials or secrets that hinder detection of misuse',
			'RESPOND — missing error handling and incident response hooks',
			'RECOVER — no graceful degradation, missing backup/restore logic for critical data',
			'GOVERN — missing security documentation, policy enforcement in code'
		],
		severity: 'strict',
		includeExplanations: true,
		complianceContext: 'You are auditing code against the NIST Cybersecurity Framework 2.0. Prefix each finding with its CSF function (IDENTIFY / PROTECT / DETECT / RESPOND / RECOVER / GOVERN) and the relevant subcategory (e.g. PR.AC-1). Focus on systemic risk reduction rather than individual bugs.'
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
 * Get all available profiles (built-in + compliance + custom from settings + custom from globalState).
 */
export function getAllProfiles(context: vscode.ExtensionContext): ReviewProfile[] {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const settingsProfiles = config.get<ReviewProfile[]>('customProfiles', []);
	const stateProfiles = context.globalState.get<ReviewProfile[]>(CUSTOM_PROFILES_KEY, []);

	// Merge: built-in first, then compliance, then settings, then globalState (later entries override by name)
	const byName = new Map<string, ReviewProfile>();
	for (const p of BUILTIN_PROFILES) {
		byName.set(p.name, p);
	}
	for (const p of COMPLIANCE_PROFILES) {
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
 * Delete a custom profile from globalState. Cannot delete built-in or compliance profiles.
 */
export async function deleteCustomProfile(context: vscode.ExtensionContext, name: string): Promise<boolean> {
	if (BUILTIN_PROFILES.some(p => p.name === name) || COMPLIANCE_PROFILES.some(p => p.name === name)) {
		return false; // Cannot delete built-in or compliance profiles
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
	];

	if (profile.complianceContext) {
		lines.push('', profile.complianceContext);
	}

	lines.push(
		'',
		'**Profile-Specific Focus Areas (prioritize these):**',
		...profile.focusAreas.map(area => `- ${area}`),
		'',
		`**Severity Level:** ${profile.severity}`,
		severityInstructions[profile.severity] || severityInstructions.balanced,
	);

	if (profile.includeExplanations) {
		lines.push('', '**Explanation Level:** Provide detailed explanations and reasoning for each finding.');
	} else {
		lines.push('', '**Explanation Level:** Be concise. Focus on actionable findings without lengthy explanations.');
	}

	return lines.join('\n');
}
