/**
 * F-032: Contentstack Schema Validation — Prompt Builder
 *
 * Builds the LLM prompt section that injects Contentstack schema context
 * and pre-validation results into the review prompt. This allows the AI
 * reviewer to flag invalid field accesses and suggest corrections.
 */
import type {
	ContentTypeSchema,
	ContentstackConfig,
	ValidationResult,
	CodeParseResult,
} from './types';
import { buildFieldMap } from './schemaFetcher';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds a complete Contentstack schema validation section for the review
 * prompt. This section includes:
 *
 * 1. Relevant content type schemas (field names and types)
 * 2. Pre-validation results (invalid fields with suggestions)
 * 3. Instructions for the AI to verify field usage
 *
 * @param validation    The pre-validation result from the validator
 * @param parseResult   The code parse result showing what was detected
 * @param csConfig      Contentstack configuration
 * @returns A prompt section string to append to the review prompt
 */
export function buildContentstackPromptSection(
	validation: ValidationResult,
	parseResult: CodeParseResult,
	csConfig: ContentstackConfig,
): string {
	const sections: string[] = [];

	sections.push('\n\n## Contentstack Schema Validation');
	sections.push(
		'The code under review accesses Contentstack CMS fields. '
		+ 'Verify that all field names match the Content Type schema below. '
		+ 'Flag any field name that does not exist in the schema as a **high severity** finding, '
		+ 'and suggest the correct field name if a close match exists.\n'
	);

	// Include relevant schemas
	const schemasSection = _buildSchemasSection(
		validation.resolvedContentTypes,
		csConfig.maxContentTypes,
	);
	if (schemasSection) {
		sections.push(schemasSection);
	}

	// Include pre-validation findings
	if (validation.stats.invalidFields > 0) {
		sections.push(_buildPreValidationSection(validation));
	}

	// Include unresolved content types warning
	if (validation.unresolvedContentTypes.length > 0) {
		sections.push(_buildUnresolvedSection(validation.unresolvedContentTypes));
	}

	// Include validation instructions
	sections.push(_buildInstructionsSection(validation));

	return sections.join('\n');
}

/**
 * Formats a compact schema summary for a single content type.
 * Useful for injecting into chat follow-up prompts.
 */
export function formatSchemaForChat(schema: ContentTypeSchema): string {
	const fieldMap = buildFieldMap(schema);
	const lines = [`**Content Type: ${schema.title}** (\`${schema.uid}\`)`];
	lines.push('| Field UID | Display Name |');
	lines.push('|-----------|-------------|');
	for (const [uid, displayName] of fieldMap) {
		// Skip dot-delimited nested paths for brevity
		if (!uid.includes('.')) {
			lines.push(`| \`${uid}\` | ${displayName} |`);
		}
	}
	return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function _buildSchemasSection(
	schemas: ContentTypeSchema[],
	maxTypes: number,
): string {
	if (schemas.length === 0) { return ''; }

	const lines: string[] = ['### Valid Content Type Schemas\n'];

	const toShow = schemas.slice(0, maxTypes);
	for (const schema of toShow) {
		lines.push(`#### Content Type: \`${schema.uid}\` (${schema.title})\n`);
		lines.push('| Field UID | Display Name | Data Type | Required |');
		lines.push('|-----------|-------------|-----------|----------|');

		_appendFieldRows(schema.schema, '', lines);
		lines.push('');
	}

	if (schemas.length > maxTypes) {
		lines.push(
			`*… ${schemas.length - maxTypes} additional content type(s) omitted for brevity.*\n`
		);
	}

	return lines.join('\n');
}

function _appendFieldRows(
	fields: any[],
	prefix: string,
	lines: string[],
): void {
	for (const field of fields) {
		if (!field.uid) { continue; }
		const fullPath = prefix ? `${prefix}.${field.uid}` : field.uid;
		const displayName = field.display_name ?? field.uid;
		const dataType = field.data_type ?? 'unknown';
		const required = field.mandatory ? 'Yes' : 'No';

		lines.push(`| \`${fullPath}\` | ${displayName} | ${dataType} | ${required} |`);

		// Recurse into groups
		if (Array.isArray(field.schema)) {
			_appendFieldRows(field.schema, fullPath, lines);
		}
		// Recurse into blocks
		if (Array.isArray(field.blocks)) {
			for (const block of field.blocks) {
				if (block.uid) {
					const blockPath = `${fullPath}.${block.uid}`;
					lines.push(`| \`${blockPath}\` | ${block.title ?? block.uid} | block | — |`);
					if (Array.isArray(block.schema)) {
						_appendFieldRows(block.schema, blockPath, lines);
					}
				}
			}
		}
	}
}

function _buildPreValidationSection(validation: ValidationResult): string {
	const invalidFields = validation.fields.filter((f) => !f.valid);
	const lines: string[] = [
		'### Pre-Validation Findings (Potential Field Mismatches)\n',
		'The following field accesses were **not found** in the Contentstack schema. '
		+ 'Please confirm these are errors and provide actionable guidance:\n',
	];

	for (const field of invalidFields) {
		const loc = `Line ${field.access.line}`;
		const ct = field.contentTypeUid ? ` (content type: \`${field.contentTypeUid}\`)` : '';
		let line = `- **\`${field.access.fieldName}\`** at ${loc}${ct}`;

		if (field.suggestion) {
			line += ` — Did you mean **\`${field.suggestion}\`**? (edit distance: ${field.distance})`;
		} else if (field.contentTypeUid && !validation.resolvedContentTypes.find((s) => s.uid === field.contentTypeUid)) {
			line += ' — Content type schema not available for validation.';
		} else {
			line += ' — No close match found in the schema.';
		}

		lines.push(line);
	}

	return lines.join('\n');
}

function _buildUnresolvedSection(unresolvedTypes: string[]): string {
	return [
		'### Unresolved Content Types\n',
		'The following content type UIDs were referenced in the code but could not be found in the loaded schemas. '
		+ 'This may indicate a typo in the content type name or a missing schema export:\n',
		...unresolvedTypes.map((uid) => `- \`${uid}\``),
	].join('\n');
}

function _buildInstructionsSection(validation: ValidationResult): string {
	const parts: string[] = [
		'\n### Review Instructions for Contentstack Field Usage\n',
	];

	if (validation.stats.invalidFields > 0) {
		parts.push(
			`1. **${validation.stats.invalidFields} potential field mismatch(es)** were detected above. `
			+ 'For each, confirm whether the field name is truly invalid and provide the correct field name from the schema.'
		);
	}

	parts.push(
		`${validation.stats.invalidFields > 0 ? '2' : '1'}. Check for any additional field accesses that the static analysis may have missed.`
	);
	parts.push(
		`${validation.stats.invalidFields > 0 ? '3' : '2'}. If a field access uses a dynamic key (e.g., \`entry[variable]\`), note it as unverifiable.`
	);
	parts.push(
		`${validation.stats.invalidFields > 0 ? '4' : '3'}. For each invalid field, format the finding as:\n`
		+ '   > **[HIGH] Contentstack Field Mismatch** (Line N): `entry.wrong_field` does not exist in content type `X`. '
		+ 'Did you mean `correct_field`?'
	);

	return parts.join('\n');
}
