/**
 * F-050: Sitecore Layout Service Schema Validation — Prompt Builder
 *
 * Builds the LLM prompt section that injects Sitecore component schema
 * context and pre-validation results into the review prompt.
 */
import type {
	SitecoreSchemaCache,
	SitecoreValidationResult,
	SitecoreCodeParseResult,
	SitecoreConfig,
	SitecoreComponentSchema,
} from './types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds a complete Sitecore schema validation section for the review prompt.
 *
 * @param validation   The pre-validation result from the validator
 * @param parseResult  The code parse result showing what was detected
 * @param schema       The loaded schema cache
 * @param scConfig     Sitecore configuration
 * @returns A prompt section string to append to the review prompt
 */
export function buildSitecorePromptSection(
	validation: SitecoreValidationResult,
	parseResult: SitecoreCodeParseResult,
	schema: SitecoreSchemaCache,
	scConfig: SitecoreConfig,
): string {
	const sections: string[] = [];

	sections.push('\n\n## Sitecore Layout Service Schema Validation');
	sections.push(
		'The diff accesses Sitecore JSS component fields. The schema below was read from a '
		+ 'live Layout Service response, so it reflects only what the sampled routes returned.\n'
	);

	// Include relevant component schemas
	const schemasSection = _buildComponentSchemasSection(
		validation,
		schema,
		scConfig.maxComponents,
	);
	if (schemasSection) {
		sections.push(schemasSection);
	}

	// Include pre-validation findings
	if (validation.stats.invalidFields > 0) {
		sections.push(_buildPreValidationSection(validation));
	}

	// Include unresolved components warning
	if (validation.unresolvedComponents.length > 0) {
		sections.push(_buildUnresolvedSection(validation.unresolvedComponents));
	}

	// Instructions
	sections.push(_buildInstructionsSection(validation, parseResult, schema, scConfig));

	return sections.join('\n');
}

/**
 * Whether the section is worth spending prompt tokens on at all.
 *
 * A clean diff needs nothing: the extension already validated every access
 * deterministically, so restating the schema only to conclude "all correct"
 * costs hundreds of tokens for no signal. Emit only when there is something
 * the model can actually act on.
 */
export function shouldEmitSitecoreSection(
	validation: SitecoreValidationResult,
	parseResult: SitecoreCodeParseResult,
): boolean {
	if (validation.stats.invalidFields > 0) { return true; }
	if (validation.unresolvedComponents.length > 0) { return true; }
	// Type alignment and placeholder checks still need the model's eyes
	if (parseResult.accesses.some(a => a.helper)) { return true; }
	if (parseResult.hasPlaceholderJsx) { return true; }
	return false;
}

/**
 * Generates a TypeScript interface from a component schema.
 * Used by the explorer panel "Copy as TypeScript" feature.
 */
export function generateTypescriptInterface(component: SitecoreComponentSchema): string {
	const allFields = [...component.fields, ...(component.childFields ?? [])];
	const imports = new Set<string>();
	for (const field of allFields) {
		for (const name of _jssTypeFor(field.type).imports) {
			imports.add(name);
		}
	}

	const lines: string[] = [];

	lines.push(`// Auto-generated from Sitecore Layout Service — ${component.componentName}`);
	lines.push(`// Discovered on: ${component.discoveredOnRoutes.join(', ')}`);
	if (imports.size > 0) {
		lines.push('// Adjust the import path if you use a different JSS flavour (…-jss-react, …-jss-vue).');
		lines.push('');
		lines.push(
			`import type { ${Array.from(imports).sort().join(', ')} } `
			+ "from '@sitecore-jss/sitecore-jss-nextjs';"
		);
	}
	lines.push('');
	lines.push(`export interface ${component.componentName}Fields {`);
	lines.push(..._fieldLines(component.fields));
	lines.push('}');

	// Child template interface
	if (component.childFields && component.childFields.length > 0) {
		const childName = _toIdentifier(component.childTemplateName)
			|| `${component.componentName}Child`;
		lines.push('');
		lines.push(`export interface ${childName}Fields {`);
		lines.push(..._fieldLines(component.childFields));
		lines.push('}');
	}

	return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

/**
 * Emits schema context for the components in play.
 *
 * Only fields the diff actually touches get a full entry, plus each suggested
 * near-match so the model can confirm it. Everything else is listed by name
 * only — roughly a sixth the cost of a full row, while still letting the model
 * propose an alternative the Levenshtein cut-off missed.
 *
 * Each field is described by its value *shape* rather than its inferred type
 * label: `{value:{src:str,alt:str}}` says the key is `src`, which "Image" does
 * not. Same token cost, strictly more information.
 */
function _buildComponentSchemasSection(
	validation: SitecoreValidationResult,
	schema: SitecoreSchemaCache,
	maxComponents: number,
): string {
	// Which fields matter, per component: those accessed, plus suggested matches
	const relevant = new Map<string, Set<string>>();
	const weight = new Map<string, number>();
	for (const result of validation.fields) {
		const name = result.componentName;
		if (!name) { continue; }
		if (!relevant.has(name)) { relevant.set(name, new Set()); }
		relevant.get(name)!.add(result.access.fieldName);
		if (result.suggestion) { relevant.get(name)!.add(result.suggestion); }
		// Rank by suspicion first, then by how much of the component is in play
		weight.set(name, (weight.get(name) ?? 0) + (result.valid ? 1 : 100));
	}
	if (relevant.size === 0) { return ''; }

	// Truncate the least interesting components rather than an arbitrary slice
	const ranked = Array.from(relevant.keys()).sort(
		(a, b) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0)
	);
	const toShow = ranked.slice(0, maxComponents);

	const lines: string[] = ['### Component Schemas\n'];
	lines.push('Fields are shown as `Name: shape` where the shape is the real Layout Service');
	lines.push('value structure (`str`/`num`/`bool` denote value types). A `?` after a name');
	lines.push('means the field was observed empty, so it needs optional chaining.\n');

	for (const name of toShow) {
		const comp = schema.components[name];
		if (!comp) { continue; }
		const show = relevant.get(name)!;

		lines.push(`#### \`${comp.componentName}\` (placeholder: ${comp.placeholders.join(', ')})\n`);
		lines.push(..._describeFields(comp.fields, show, 'fields'));

		if (comp.childFields && comp.childFields.length > 0) {
			lines.push(`\nChild items (\`${comp.childTemplateName || 'Child'}\`), accessed as \`item.fields.X\`:\n`);
			lines.push(..._describeFields(comp.childFields, show, 'child fields'));
		}
		lines.push('');
	}

	if (ranked.length > toShow.length) {
		lines.push(`*… ${ranked.length - toShow.length} further component(s) omitted.*\n`);
	}

	return lines.join('\n');
}

/** Full entries for relevant fields, then a name-only tail for the rest. */
function _describeFields(
	fields: SitecoreComponentSchema['fields'],
	relevant: Set<string>,
	label: string,
): string[] {
	const shown = fields.filter(f => relevant.has(f.name));
	const rest = fields.filter(f => !relevant.has(f.name)).map(f => f.name);
	const out: string[] = [];

	for (const f of shown) {
		const optional = f.observed ? '' : '?';
		out.push(`- \`${f.name}${optional}\`: ${f.shape || f.type}`);
	}
	if (shown.length === 0) {
		out.push(`- *(no ${label} referenced in this diff)*`);
	}
	if (rest.length > 0) {
		out.push(`- other ${label}: ${rest.map(n => `\`${n}\``).join(', ')}`);
	}
	return out;
}

function _buildPreValidationSection(validation: SitecoreValidationResult): string {
	const lines: string[] = [
		'\n### Pre-Validation Findings\n',
		'The following field accesses were **not found** in the Sitecore schema. '
		+ 'Confirm these are bugs and flag them in your review:\n',
	];

	// Group repeats of the same (component, field) so a field used on five lines
	// costs one bullet rather than five.
	const grouped = new Map<string, { result: SitecoreValidationResult['fields'][number]; locations: string[] }>();
	for (const result of validation.fields) {
		if (result.valid) { continue; }
		const key = `${result.componentName ?? '?'}.${result.access.fieldName}`;
		const location = result.access.filePath
			? `${result.access.filePath}:${result.access.line}`
			: `line ${result.access.line}`;
		const entry = grouped.get(key);
		if (entry) {
			if (!entry.locations.includes(location)) { entry.locations.push(location); }
		} else {
			grouped.set(key, { result, locations: [location] });
		}
	}

	for (const { result, locations } of grouped.values()) {
		const suggestion = result.suggestion
			? ` → Did you mean \`${result.suggestion}\`?`
			: '';
		lines.push(
			`- \`${result.access.fieldName}\` on \`${result.componentName || 'unknown'}\` `
			+ `at ${_formatLocations(locations)}${suggestion}`
		);
	}

	return lines.join('\n');
}

/** Collapses repeats within a file: `a.tsx:3, a.tsx:4` → `` `a.tsx:3, 4` ``. */
function _formatLocations(locations: string[]): string {
	const byFile = new Map<string, string[]>();
	for (const location of locations) {
		const idx = location.lastIndexOf(':');
		const file = idx > 0 ? location.slice(0, idx) : location;
		const line = idx > 0 ? location.slice(idx + 1) : '';
		if (!byFile.has(file)) { byFile.set(file, []); }
		if (line) { byFile.get(file)!.push(line); }
	}
	return Array.from(byFile.entries())
		.map(([file, lineNums]) => `\`${file}${lineNums.length ? `:${lineNums.join(', ')}` : ''}\``)
		.join('; ');
}

function _buildUnresolvedSection(unresolvedComponents: string[]): string {
	return (
		'\n### Unresolved Components\n'
		+ 'The following component names were referenced in code but not found in the schema. '
		+ 'They may be new components not yet fetched via the Schema Explorer:\n'
		+ unresolvedComponents.map(c => `- \`${c}\``).join('\n')
	);
}

/**
 * Emits only the rules that this diff can actually violate. The full block is
 * ~220 tokens; most reviews need two or three of its lines.
 */
function _buildInstructionsSection(
	validation: SitecoreValidationResult,
	parseResult: SitecoreCodeParseResult,
	schema: SitecoreSchemaCache,
	scConfig: SitecoreConfig,
): string {
	const rules: string[] = [];
	const hasInvalid = validation.stats.invalidFields > 0;
	const usesHelpers = parseResult.accesses.some(a => a.helper);

	rules.push('**Field Naming**: Sitecore fields are PascalCase — flag `fields.headline` in favour of `fields.Headline`.');

	if (hasInvalid) {
		rules.push(
			'**Field Existence**: The mismatches listed above were detected deterministically '
			+ 'against the live schema. Report each as a HIGH severity finding at the given '
			+ 'file and line, using the suggested name where one is offered.'
		);
	}

	rules.push(
		'**Sub-property Access**: The shapes above are the real value structure. '
		+ 'Flag access to a key that is not present (e.g. `fields.Hero.value.url` when the shape is `{value:{src:str,…}}`).'
	);

	if (scConfig.validateFieldTypes && usesHelpers) {
		rules.push(
			'**Type Alignment**: Check each JSS helper against its field shape — `<Image>` needs '
			+ '`{value:{src,…}}`, `<Link>` needs `{value:{href,…}}`, `<RichText>` for HTML content, '
			+ '`<Text>` for plain strings.'
		);
	}

	if (scConfig.validatePlaceholders && parseResult.hasPlaceholderJsx && schema.placeholders.length > 0) {
		rules.push(
			`**Placeholder Names**: Known placeholders are ${schema.placeholders.map(p => `\`${p}\``).join(', ')}. `
			+ 'Flag any `<Placeholder name="…">` outside that set — but note the list only covers '
			+ 'routes that were sampled, so treat an unknown name as a question, not a certainty.'
		);
	}

	rules.push('**Null Safety**: A `?` after a field name above means it was observed empty — require optional chaining.');

	const lines = ['\n### Sitecore Review Rules\n'];
	lines.push(...rules.map((r, i) => `${i + 1}. ${r}`));

	if (hasInvalid) {
		lines.push('');
		lines.push(
			'Example: > **[HIGH] Sitecore Field Mismatch** (`src/components/L1Hero.tsx:42`): '
			+ '`fields.heding` does not exist on `L1Hero`. Did you mean `Headline`?'
		);
	}

	return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps an inferred Sitecore field type to the corresponding type exported by
 * `@sitecore-jss/sitecore-jss-*`, plus the named imports that type needs.
 */
const JSS_TYPE_MAP: Record<string, { ts: string; imports: string[] }> = {
	'Single-Line Text': { ts: 'Field<string>', imports: ['Field'] },
	'Rich Text': { ts: 'RichTextField', imports: ['RichTextField'] },
	'Image': { ts: 'ImageField', imports: ['ImageField'] },
	'General Link': { ts: 'LinkField', imports: ['LinkField'] },
	'Checkbox': { ts: 'Field<boolean>', imports: ['Field'] },
	'File': { ts: 'FileField', imports: ['FileField'] },
	'Lookup': { ts: 'Item', imports: ['Item'] },
	'Multilist': { ts: 'Item[]', imports: ['Item'] },
	'Date': { ts: 'Field<string>', imports: ['Field'] },
	'Number': { ts: 'Field<number>', imports: ['Field'] },
	'Bynder DAM': { ts: 'unknown', imports: [] },
};

const UNKNOWN_JSS_TYPE = { ts: 'unknown', imports: [] as string[] };

function _jssTypeFor(type: string): { ts: string; imports: string[] } {
	return JSS_TYPE_MAP[type] ?? UNKNOWN_JSS_TYPE;
}

function _fieldLines(fields: SitecoreComponentSchema['fields']): string[] {
	return fields.map(field => {
		const optional = !field.observed ? '?' : '';
		return `  ${_toPropertyKey(field.name)}${optional}: ${_jssTypeFor(field.type).ts};`;
	});
}

/** Quotes a field name that is not a valid bare TS property key. */
function _toPropertyKey(name: string): string {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : `'${name.replace(/'/g, "\\'")}'`;
}

/**
 * Strips characters that cannot appear in a TS interface name. Child template
 * names are inferred from list field names and may be a composite like
 * "Box / Slide" when a component has several child lists.
 */
function _toIdentifier(name?: string): string | undefined {
	if (!name) { return undefined; }
	const cleaned = name.replace(/[^A-Za-z0-9_$]/g, '');
	return /^[A-Za-z_$]/.test(cleaned) ? cleaned : undefined;
}
