/**
 * F-050: Sitecore Layout Service Schema Validation — Code Parser
 *
 * Parses TypeScript/JavaScript source files to extract Sitecore JSS field
 * accesses. Detects common patterns including:
 *
 * - props.fields.FieldName / fields.FieldName
 * - <Text field={fields.FieldName} />
 * - <Image field={fields.FieldName} />
 * - Destructuring: const { FieldName } = fields
 * - Dot access on children: box.fields.FieldName
 * - Optional chaining: fields?.FieldName
 */
import type { SitecoreFieldAccess, SitecoreCodeParseResult } from './types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses source code (or a diff) for Sitecore JSS field accesses.
 *
 * @param content   Source code or diff text to parse
 * @param filePath  File path for context
 * @returns Parsed field accesses and inferred component names
 */
export function parseSitecoreFieldAccesses(content: string, filePath: string): SitecoreCodeParseResult {
	const lines = content.split('\n');
	const accesses: SitecoreFieldAccess[] = [];
	const componentNames = new Set<string>();

	// Infer component name from file path (e.g. "BentoGrid.tsx" → "BentoGrid")
	const componentFromFile = _inferComponentFromFilePath(filePath);
	if (componentFromFile) {
		componentNames.add(componentFromFile);
	}

	// Find variables that hold `fields` or `props.fields`
	const fieldVars = _findFieldVariables(lines);

	const ctx: AccessContext = { componentName: componentFromFile, filePath };

	// Track hunk offset so line numbers map to the real source file.
	// When parsing a diff, @@ headers tell us where added lines start.
	let hunkLineNum = 0; // current source-file line counter inside a hunk
	let inHunk = false;
	let hasPlaceholderJsx = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Diff metadata never occupies a line in the new file, so it must not
		// advance the counter. A @@ header re-seeds it instead.
		const hunkMatch = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)/);
		if (hunkMatch) {
			hunkLineNum = parseInt(hunkMatch[1], 10) - 1;
			inHunk = true;
			continue;
		}
		if (_isDiffMetadata(line)) { continue; }

		// Removed lines exist only in the old file.
		if (inHunk && line.startsWith('-')) { continue; }

		// Compute line number: use hunk offset when in a diff, otherwise raw index.
		// The counter advances for every added and context line — including blank
		// ones — otherwise reported line numbers drift for the rest of the hunk.
		let lineNum: number;
		let sourceLine: string;
		if (inHunk) {
			hunkLineNum++;
			lineNum = hunkLineNum;
			sourceLine = (line.startsWith('+') || line.startsWith(' ')) ? line.slice(1) : line;
		} else {
			lineNum = i + 1;
			sourceLine = line;
		}

		// Blank and comment lines carry no field accesses, but only skip them
		// after the line counter has been advanced above.
		if (_isIgnorableContent(sourceLine)) { continue; }

		// Use the cleaned source line for pattern matching
		const matchLine = sourceLine;

		// Pattern 1: JSS helper components — <Text field={fields.Xxx} />
		_extractJssHelperAccesses(matchLine, lineNum, accesses, ctx);

		// Pattern 2: Direct field access — fields.FieldName or fields?.FieldName
		_extractDotAccesses(matchLine, lineNum, fieldVars, accesses, ctx);

		// Pattern 3: Bracket access — fields['FieldName'] or fields["FieldName"]
		_extractBracketAccesses(matchLine, lineNum, fieldVars, accesses, ctx);

		// Pattern 4: Destructuring — const { FieldName, AnotherField } = fields
		_extractDestructuring(matchLine, lineNum, fieldVars, accesses, ctx);

		// Pattern 5: Child field access — item.fields.FieldName, box.fields.Image
		_extractChildFieldAccesses(matchLine, lineNum, accesses, ctx);

		// Pattern 6: Component name detection from imports
		_extractComponentNames(matchLine, componentNames);

		if (!hasPlaceholderJsx && /<Placeholder\s[^>]*name=/.test(matchLine)) {
			hasPlaceholderJsx = true;
		}
	}

	// Deduplicate accesses by (fieldName, line, isChildAccess)
	const seen = new Set<string>();
	const uniqueAccesses = accesses.filter(a => {
		const key = `${a.fieldName}:${a.line}:${a.isChildAccess}`;
		if (seen.has(key)) { return false; }
		seen.add(key);
		return true;
	});

	return {
		accesses: uniqueAccesses,
		componentNames: Array.from(componentNames),
		filePath,
		hasPlaceholderJsx,
	};
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Shared provenance for every access extracted from one file. */
interface AccessContext {
	componentName?: string;
	filePath: string;
}

/**
 * Prevents a pattern anchored on a field variable from also matching when that
 * variable is itself a property of something else. Without this, `fields` would
 * match inside `box.fields.Image`, producing a bogus top-level access alongside
 * the correct child access.
 */
const NOT_A_PROPERTY = '(?<![.\\w$])';

/**
 * Infers a component name from a file path.
 * e.g. "src/components/BentoGrid/BentoGrid.tsx" → "BentoGrid"
 *      "src/rendering/src/components/L1Hero.tsx" → "L1Hero"
 */
function _inferComponentFromFilePath(filePath: string): string | undefined {
	const fileName = filePath.split('/').pop() || '';
	const match = fileName.match(/^([A-Z][A-Za-z0-9]+)\.(tsx?|jsx?)$/);
	return match ? match[1] : undefined;
}

/**
 * Finds variable names that reference `fields` (from props or destructuring).
 */
function _findFieldVariables(lines: string[]): Set<string> {
	const vars = new Set<string>(['fields', 'props.fields']);

	for (const line of lines) {
		// const { fields } = props
		const destructMatch = line.match(/(?:const|let|var)\s*\{\s*.*fields.*\}\s*=\s*(\w+)/);
		if (destructMatch) {
			vars.add('fields');
		}

		// const fields = props.fields
		const assignMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:props\.)?fields/);
		if (assignMatch && assignMatch[1] !== 'fields') {
			vars.add(assignMatch[1]);
		}

		// Function params: ({ fields }) or (props)
		const paramMatch = line.match(/\(\s*\{\s*fields\s*\}/);
		if (paramMatch) {
			vars.add('fields');
		}
	}

	return vars;
}

/**
 * Extracts JSS helper component field accesses.
 * Matches: <Text field={fields.Headline} />, <Image field={fields.heroImage} />
 */
function _extractJssHelperAccesses(
	line: string,
	lineNum: number,
	accesses: SitecoreFieldAccess[],
	ctx: AccessContext,
): void {
	// Match <Text|Image|RichText|Link|DateField|File field={fields.XXX} />
	// Also matches field={fields?.XXX}. The helper name is captured so the
	// validator can check it against the field's actual type.
	const regex = /<(Text|Image|RichText|Link|DateField|File)\s[^>]*field=\{(?:fields|props\.fields)\??\.(\w+)\}/g;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(line)) !== null) {
		accesses.push({ ..._makeAccess(match[2], lineNum, line, ctx, false), helper: match[1] });
	}
}

/**
 * Extracts dot access patterns: fields.FieldName, fields?.FieldName
 */
function _extractDotAccesses(
	line: string,
	lineNum: number,
	fieldVars: Set<string>,
	accesses: SitecoreFieldAccess[],
	ctx: AccessContext,
): void {
	for (const varName of Array.from(fieldVars)) {
		// Escape dots for regex
		const escaped = varName.replace(/\./g, '\\.');
		// Match varName.FieldName or varName?.FieldName (PascalCase or camelCase)
		const regex = new RegExp(`${NOT_A_PROPERTY}${escaped}\\??\\.([A-Za-z]\\w*)`, 'g');
		let match: RegExpExecArray | null;

		while ((match = regex.exec(line)) !== null) {
			const fieldName = match[1];
			// Skip known JS properties and methods
			if (_isJsProperty(fieldName)) { continue; }

			accesses.push(_makeAccess(fieldName, lineNum, line, ctx, false));
		}
	}
}

/**
 * Extracts bracket access patterns: fields['FieldName'] or fields["FieldName"]
 */
function _extractBracketAccesses(
	line: string,
	lineNum: number,
	fieldVars: Set<string>,
	accesses: SitecoreFieldAccess[],
	ctx: AccessContext,
): void {
	for (const varName of Array.from(fieldVars)) {
		const escaped = varName.replace(/\./g, '\\.');
		const regex = new RegExp(`${NOT_A_PROPERTY}${escaped}\\s*\\[\\s*['"]([A-Za-z]\\w*)['"]\\s*\\]`, 'g');
		let match: RegExpExecArray | null;

		while ((match = regex.exec(line)) !== null) {
			accesses.push(_makeAccess(match[1], lineNum, line, ctx, false));
		}
	}
}

/**
 * Extracts destructured field names: const { Headline, Image } = fields
 */
function _extractDestructuring(
	line: string,
	lineNum: number,
	fieldVars: Set<string>,
	accesses: SitecoreFieldAccess[],
	ctx: AccessContext,
): void {
	for (const varName of Array.from(fieldVars)) {
		const escaped = varName.replace(/\./g, '\\.');
		// The trailing lookahead keeps `const { value } = fields.Headline` from being
		// read as a destructure of `fields` itself.
		const regex = new RegExp(`(?:const|let|var)\\s*\\{([^}]+)\\}\\s*=\\s*${escaped}(?![.\\[\\w])`);
		const match = line.match(regex);
		if (!match) { continue; }

		const destructured = match[1].split(',');
		for (const item of destructured) {
			const fieldName = item.trim().split(':')[0].trim().split('=')[0].trim();
			if (!fieldName || _isJsProperty(fieldName)) { continue; }

			accesses.push(_makeAccess(fieldName, lineNum, line, ctx, false));
		}
	}
}

/**
 * Extracts child/nested field accesses: item.fields.Image, box.fields.Size
 */
function _extractChildFieldAccesses(
	line: string,
	lineNum: number,
	accesses: SitecoreFieldAccess[],
	ctx: AccessContext,
): void {
	// Match: someVar.fields.FieldName or someVar.fields?.FieldName
	// But NOT props.fields or just "fields" (those are top-level)
	const regex = /(\w+)\.fields\??\.([A-Z]\w*)/g;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(line)) !== null) {
		const varName = match[1];
		const fieldName = match[2];

		// Skip if the variable is 'props' (top-level) or already handled
		if (varName === 'props' || varName === 'rendering') { continue; }
		if (_isJsProperty(fieldName)) { continue; }

		accesses.push(_makeAccess(fieldName, lineNum, line, ctx, true));
	}
}

/** Builds a field access record with shared provenance. */
function _makeAccess(
	fieldName: string,
	lineNum: number,
	sourceLine: string,
	ctx: AccessContext,
	isChildAccess: boolean,
): SitecoreFieldAccess {
	return {
		fieldName,
		componentName: ctx.componentName,
		filePath: ctx.filePath,
		line: lineNum,
		sourceLine: sourceLine.trim(),
		inferenceMethod: ctx.componentName ? 'filename' : 'unknown',
		isChildAccess,
	};
}

/**
 * Extracts component names from import statements.
 */
function _extractComponentNames(line: string, names: Set<string>): void {
	// componentFactory or componentBuilder registrations
	const regMatch = line.match(/(?:register|addComponent)\s*\(\s*['"]([A-Z]\w+)['"]/);
	if (regMatch) {
		names.add(regMatch[1]);
	}
}

/**
 * Diff plumbing that has no counterpart in the new file, so it must not advance
 * the source line counter. `@@` headers are handled by the caller because they
 * re-seed the counter rather than just skipping.
 */
function _isDiffMetadata(line: string): boolean {
	if (line.startsWith('diff --git ')) { return true; }
	if (/^index [0-9a-f]{4,}/.test(line)) { return true; }
	if (/^(?:---|\+\+\+) /.test(line)) { return true; }
	if (line.startsWith('\\ No newline')) { return true; }
	// File mode / rename plumbing emitted between the `diff --git` and `@@` lines
	if (/^(?:old|new) mode /.test(line)) { return true; }
	if (/^(?:deleted|new) file mode /.test(line)) { return true; }
	if (/^(?:similarity|dissimilarity) index /.test(line)) { return true; }
	if (/^(?:rename|copy) (?:from|to) /.test(line)) { return true; }
	return false;
}

/**
 * Content lines that cannot hold a field access. These DO occupy a line in the
 * new file, so callers must advance the line counter before skipping them.
 */
function _isIgnorableContent(sourceLine: string): boolean {
	const trimmed = sourceLine.trim();
	if (!trimmed) { return true; }
	if (trimmed.startsWith('//')) { return true; }
	if (trimmed.startsWith('*')) { return true; }
	if (trimmed.startsWith('/*')) { return true; }
	return false;
}

/** JavaScript/TypeScript properties that are not CMS field names. */
const JS_PROPERTIES = new Set([
	'length', 'map', 'filter', 'reduce', 'forEach', 'find', 'some',
	'every', 'includes', 'indexOf', 'slice', 'concat', 'join',
	'keys', 'values', 'entries', 'hasOwnProperty', 'toString',
	'valueOf', 'constructor', 'prototype', 'then', 'catch',
	'finally', 'value', 'id', 'url', 'name', 'displayName',
]);

function _isJsProperty(name: string): boolean {
	return JS_PROPERTIES.has(name);
}
