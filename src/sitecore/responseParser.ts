/**
 * F-050: Sitecore Layout Service Schema Validation — Response Parser
 *
 * Parses a Sitecore Layout Service response (the `rendered` JSON) and
 * extracts component schemas, placeholder names, field types, and
 * child template definitions.
 */
import type {
	LayoutServiceResponse,
	LayoutServiceComponent,
	SitecoreComponentSchema,
	SitecoreField,
	SitecoreFieldType,
	SitecorePageSchema,
	SitecoreSchemaCache,
	SitecoreRawSamples,
	ComponentSummary,
	ComponentRendering,
} from './types';

/** Max characters kept per string when retaining a raw sample. */
const RAW_STRING_LIMIT = 160;
/** How deep a shape skeleton descends before collapsing to `{…}`. */
const SHAPE_MAX_DEPTH = 3;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses a Layout Service response into structured component schemas.
 *
 * @param response  The full Layout Service response
 * @param routePath The route that was fetched (for tracking)
 * @returns Object with placeholders, components, and page template
 */
export function parseLayoutResponse(
	response: LayoutServiceResponse,
	routePath: string,
): ParsedLayoutResult {
	const route = response.sitecore.route;
	const components = new Map<string, SitecoreComponentSchema>();
	const placeholders = new Set<string>();
	const rawSamples: SitecoreRawSamples = {};
	const renderings: ComponentRendering[] = [];

	// Extract route-level page template
	const pageTemplate: SitecorePageSchema = {
		templateName: route.templateName || 'Page',
		templateId: route.templateId,
		fields: _extractFields(route.fields),
	};

	// Walk all placeholders recursively
	_walkPlaceholders(route.placeholders, components, placeholders, routePath, rawSamples, renderings);

	return {
		pageTemplate,
		components: Array.from(components.values()),
		placeholders: Array.from(placeholders),
		rawSamples,
		renderings,
	};
}

/**
 * Renders a value as a shape skeleton: real keys with value *types*, never
 * content. `{ value: { src: 'https://…', alt: 'Hero' } }` becomes
 * `{value:{src:str,alt:str}}`.
 *
 * This is what the inferred field type cannot express — that the key is `src`
 * and not `url`, or that `width` arrives as a string rather than a number.
 */
export function buildValueShape(value: unknown, depth = 0): string {
	if (value === null) { return 'null'; }
	if (value === undefined) { return 'undefined'; }

	if (Array.isArray(value)) {
		if (value.length === 0) { return '[]'; }
		return `[${buildValueShape(value[0], depth + 1)}]`;
	}

	if (typeof value === 'object') {
		const keys = Object.keys(value as Record<string, unknown>);
		if (keys.length === 0) { return '{}'; }
		if (depth >= SHAPE_MAX_DEPTH) { return '{…}'; }
		const obj = value as Record<string, unknown>;
		return `{${keys.map(k => `${k}:${buildValueShape(obj[k], depth + 1)}`).join(',')}}`;
	}

	switch (typeof value) {
		case 'string': return 'str';
		case 'number': return 'num';
		case 'boolean': return 'bool';
		default: return '?';
	}
}

/**
 * Copies a value with long strings truncated, for display in the Schema
 * Explorer. Keeps raw payloads bounded without hiding structure.
 */
export function truncateRawValue(value: unknown, depth = 0): unknown {
	if (typeof value === 'string') {
		return value.length > RAW_STRING_LIMIT
			? `${value.slice(0, RAW_STRING_LIMIT)}… (${value.length} chars)`
			: value;
	}
	if (Array.isArray(value)) {
		// Only the first few items are needed to understand the shape
		return value.slice(0, 3).map(v => truncateRawValue(v, depth + 1));
	}
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out[k] = truncateRawValue(v, depth + 1);
		}
		return out;
	}
	return value;
}

/**
 * Merges a new parsed result into an existing schema cache.
 * Accumulates fields from multiple routes for the same component.
 */
export function mergeIntoCache(
	cache: SitecoreSchemaCache,
	parsed: ParsedLayoutResult,
	routePath: string,
	source: string,
): void {
	// Track the route
	if (!cache._routesScanned.includes(routePath)) {
		cache._routesScanned.push(routePath);
	}

	// Merge page template
	if (parsed.pageTemplate) {
		if (!cache.pageTemplate) {
			cache.pageTemplate = parsed.pageTemplate;
		} else {
			_mergeFields(cache.pageTemplate.fields, parsed.pageTemplate.fields);
		}
	}

	// Merge placeholders
	for (const ph of parsed.placeholders) {
		if (!cache.placeholders.includes(ph)) {
			cache.placeholders.push(ph);
		}
	}

	// Merge components
	for (const comp of parsed.components) {
		const existing = cache.components[comp.componentName];
		if (!existing) {
			cache.components[comp.componentName] = comp;
		} else {
			// Merge fields
			_mergeFields(existing.fields, comp.fields);

			// Merge child fields
			if (comp.childFields) {
				if (!existing.childFields) {
					existing.childFields = comp.childFields;
					existing.childTemplateName = comp.childTemplateName;
				} else {
					_mergeFields(existing.childFields, comp.childFields);
				}
			}

			// Merge placeholders
			for (const ph of comp.placeholders) {
				if (!existing.placeholders.includes(ph)) {
					existing.placeholders.push(ph);
				}
			}

			// Merge routes
			for (const r of comp.discoveredOnRoutes) {
				if (!existing.discoveredOnRoutes.includes(r)) {
					existing.discoveredOnRoutes.push(r);
				}
			}
		}
	}

	cache._generated = new Date().toISOString();
	cache._source = source;
}

/**
 * Creates an empty schema cache.
 */
export function createEmptyCache(): SitecoreSchemaCache {
	return {
		_generated: new Date().toISOString(),
		_source: '',
		_routesScanned: [],
		components: {},
		placeholders: [],
	};
}

/**
 * Converts components map to a summary list for the explorer panel.
 */
export function toComponentSummaries(
	cache: SitecoreSchemaCache,
): ComponentSummary[] {
	return Object.values(cache.components).map(comp => ({
		componentName: comp.componentName,
		placeholder: comp.placeholders[0] || 'unknown',
		fieldCount: comp.fields.length,
		hasChildren: !!comp.childFields && comp.childFields.length > 0,
	}));
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export interface ParsedLayoutResult {
	pageTemplate: SitecorePageSchema;
	components: SitecoreComponentSchema[];
	placeholders: string[];
	/**
	 * Raw field values per component, string-truncated. Intentionally not part
	 * of {@link SitecoreSchemaCache} — see {@link SitecoreRawSamples}.
	 */
	rawSamples: SitecoreRawSamples;
	/** Every rendering instance in placeholder order (not deduplicated). */
	renderings: ComponentRendering[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively walks placeholders to extract components.
 */
function _walkPlaceholders(
	placeholders: Record<string, LayoutServiceComponent[]> | undefined,
	components: Map<string, SitecoreComponentSchema>,
	placeholderNames: Set<string>,
	routePath: string,
	rawSamples: SitecoreRawSamples,
	renderings: ComponentRendering[],
): void {
	if (!placeholders) { return; }

	for (const [placeholderName, renderingList] of Object.entries(placeholders)) {
		placeholderNames.add(placeholderName);

		for (const rendering of renderingList) {
			_processComponent(rendering, placeholderName, components, placeholderNames, routePath, rawSamples, renderings);
		}
	}
}

/**
 * Processes a single component rendering and extracts its schema.
 */
function _processComponent(
	rendering: LayoutServiceComponent,
	placeholderName: string,
	components: Map<string, SitecoreComponentSchema>,
	placeholderNames: Set<string>,
	routePath: string,
	rawSamples: SitecoreRawSamples,
	renderings: ComponentRendering[],
): void {
	const name = rendering.componentName;
	if (!name) { return; }

	const fields = _extractFields(rendering.fields);
	const childResult = _extractChildFields(rendering.fields);

	// Record this rendering instance (preserves duplicates)
	renderings.push({
		index: renderings.length,
		componentName: name,
		placeholder: placeholderName,
		fieldCount: fields.length,
		hasChildren: !!childResult,
	});

	// Retain raw values so the Schema Explorer can show ground truth. The first
	// rendering to carry a given field wins, so an empty instance later on the
	// page does not overwrite a populated sample.
	if (rendering.fields) {
		const bucket = rawSamples[name] ?? (rawSamples[name] = {});
		for (const [fieldName, fieldValue] of Object.entries(rendering.fields)) {
			if (fieldName in bucket && !_hasValue(bucket[fieldName])) {
				bucket[fieldName] = truncateRawValue(fieldValue);
			} else if (!(fieldName in bucket)) {
				bucket[fieldName] = truncateRawValue(fieldValue);
			}
		}
	}

	const existing = components.get(name);
	if (existing) {
		_mergeFields(existing.fields, fields);
		if (childResult && !existing.childFields) {
			existing.childFields = childResult.fields;
			existing.childTemplateName = childResult.templateName;
		} else if (childResult && existing.childFields) {
			_mergeFields(existing.childFields, childResult.fields);
		}
		if (!existing.placeholders.includes(placeholderName)) {
			existing.placeholders.push(placeholderName);
		}
		if (!existing.discoveredOnRoutes.includes(routePath)) {
			existing.discoveredOnRoutes.push(routePath);
		}
	} else {
		components.set(name, {
			componentName: name,
			fields,
			placeholders: [placeholderName],
			discoveredOnRoutes: [routePath],
			childFields: childResult?.fields,
			childTemplateName: childResult?.templateName,
		});
	}

	// Recurse into nested placeholders
	if (rendering.placeholders) {
		_walkPlaceholders(rendering.placeholders, components, placeholderNames, routePath, rawSamples, renderings);
	}
}

/**
 * Extracts field definitions from a Layout Service fields object.
 */
function _extractFields(fields: Record<string, unknown>): SitecoreField[] {
	const result: SitecoreField[] = [];

	for (const [fieldName, fieldValue] of Object.entries(fields)) {
		// Array-valued fields (Multilist/Treelist) are still fields on this
		// component, so they belong here. _extractChildFields separately derives
		// the shape of their child items.
		const type = inferFieldType(fieldValue);
		const notes = _getFieldNotes(fieldValue, type);

		result.push({
			name: fieldName,
			type,
			observed: _hasValue(fieldValue),
			notes,
			shape: buildValueShape(fieldValue),
		});
	}

	return result;
}

/**
 * Looks for Multilist-like array fields and extracts child template fields.
 *
 * Every array-valued field is inspected, not just the first one — a component
 * with two Multilists would otherwise silently lose the second. Note that the
 * result is a single flat list, so a component with multiple distinct child
 * templates has their fields conflated into one namespace; validation of child
 * accesses is correspondingly permissive.
 */
function _extractChildFields(
	fields: Record<string, unknown>,
): { fields: SitecoreField[]; templateName: string } | null {
	const childFieldsMap = new Map<string, SitecoreField>();
	const templateNames: string[] = [];

	for (const [fieldName, fieldValue] of Object.entries(fields)) {
		if (!Array.isArray(fieldValue)) { continue; }
		if (fieldValue.length === 0) { continue; }

		// Check if array items have 'fields' property (Multilist/Treelist children)
		const firstItem = fieldValue[0] as Record<string, unknown>;
		if (!firstItem || !firstItem.fields) { continue; }

		let addedForThisField = false;

		// Aggregate all fields from all child items
		for (const item of fieldValue) {
			const childItem = item as Record<string, unknown>;
			const childFields = childItem.fields as Record<string, unknown>;
			if (!childFields) { continue; }

			for (const [name, value] of Object.entries(childFields)) {
				if (Array.isArray(value)) { continue; } // Skip nested arrays for now
				addedForThisField = true;
				if (childFieldsMap.has(name)) { continue; }

				const type = inferFieldType(value);
				childFieldsMap.set(name, {
					name,
					type,
					observed: _hasValue(value),
					notes: _getFieldNotes(value, type),
					shape: buildValueShape(value),
				});
			}
		}

		if (addedForThisField) {
			templateNames.push(_singularize(fieldName));
		}
	}

	if (childFieldsMap.size === 0) { return null; }

	return {
		fields: Array.from(childFieldsMap.values()),
		templateName: templateNames.join(' / '),
	};
}

/** Infers a child template name from its list field name (e.g. "Boxes" → "Box"). */
function _singularize(fieldName: string): string {
	if (fieldName.endsWith('ies')) { return `${fieldName.slice(0, -3)}y`; }
	if (fieldName.endsWith('es')) {
		const stem = fieldName.slice(0, -2);
		// "Boxes" → "Box", "Classes" → "Class", but "Slides" → "Slide"
		return /(?:s|x|z|ch|sh)$/i.test(stem) ? stem : fieldName.slice(0, -1);
	}
	if (fieldName.endsWith('s')) { return fieldName.slice(0, -1); }
	return fieldName;
}

/**
 * Infers the Sitecore field type from the Layout Service response value shape.
 */
export function inferFieldType(value: unknown): SitecoreFieldType {
	if (value === null || value === undefined) { return 'unknown'; }

	// Direct primitive values (shouldn't happen at top level but handle it)
	if (typeof value === 'boolean') { return 'Checkbox'; }
	if (typeof value === 'number') { return 'Number'; }
	if (typeof value === 'string') { return 'Single-Line Text'; }

	// Reference/Lookup field: has id + fields at top level
	if (typeof value === 'object' && !Array.isArray(value)) {
		const obj = value as Record<string, unknown>;

		// Reference/Lookup: { id, url, name, fields: { Value: ... } }
		if (obj.id && obj.fields && typeof obj.fields === 'object') {
			return 'Lookup';
		}

		// Standard field wrapper: { value: ... }
		if ('value' in obj) {
			return _inferFromValueProperty(obj.value);
		}
	}

	// Arrays are Multilist (handled separately)
	if (Array.isArray(value)) { return 'Multilist'; }

	return 'unknown';
}

/**
 * Infers type from the inner `value` property of a field.
 */
function _inferFromValueProperty(inner: unknown): SitecoreFieldType {
	if (inner === null || inner === undefined) { return 'unknown'; }
	if (typeof inner === 'boolean') { return 'Checkbox'; }
	if (typeof inner === 'number') { return 'Number'; }
	if (typeof inner === 'string') {
		// Check if it looks like a date
		if (/^\d{4}-\d{2}-\d{2}/.test(inner)) { return 'Date'; }
		// Check if it looks like rich text (contains HTML)
		if (/<[a-z][\s\S]*>/i.test(inner)) { return 'Rich Text'; }
		return 'Single-Line Text';
	}

	if (typeof inner === 'object') {
		const obj = inner as Record<string, unknown>;

		// Empty object
		if (Object.keys(obj).length === 0) { return 'unknown'; }

		// Image: has src + (alt | width | height), no linktype, no mimeType
		if (obj.src && !obj.linktype && !obj.mimeType) {
			if ('alt' in obj || 'width' in obj || 'height' in obj) {
				return 'Image';
			}
		}

		// File/Media: has src + mimeType + extension
		if (obj.src && obj.mimeType) { return 'File'; }

		// Link: has href or linktype
		if ('href' in obj || obj.linktype) { return 'General Link'; }

		// Bynder DAM: has asset property
		if ('asset' in obj) { return 'Bynder DAM'; }
	}

	return 'unknown';
}

/**
 * Checks if a field value is non-empty.
 */
function _hasValue(value: unknown): boolean {
	if (value === null || value === undefined) { return false; }
	if (typeof value === 'object' && !Array.isArray(value)) {
		const obj = value as Record<string, unknown>;
		if ('value' in obj) {
			const inner = obj.value;
			if (inner === null || inner === undefined) { return false; }
			if (typeof inner === 'string' && inner === '') { return false; }
			if (typeof inner === 'object' && Object.keys(inner as object).length === 0) { return false; }
			return true;
		}
		return Object.keys(obj).length > 0;
	}
	return true;
}

/**
 * Gets human-readable notes for a field based on its type and value.
 */
function _getFieldNotes(value: unknown, type: SitecoreFieldType): string | undefined {
	if (type === 'Multilist') {
		const count = Array.isArray(value) ? value.length : 0;
		return `${count} item(s) on sampled route`;
	}
	if (type === 'Image') {
		return 'src, alt, w×h';
	}
	if (type === 'File') {
		const obj = value as Record<string, unknown>;
		const inner = obj?.value as Record<string, unknown>;
		if (inner?.mimeType) {
			return String(inner.mimeType);
		}
	}
	if (type === 'General Link') {
		return 'href, linktype';
	}
	if (type === 'Lookup') {
		const obj = value as Record<string, unknown>;
		const name = obj?.name;
		if (name) {
			return `→ ${String(name)}`;
		}
	}
	return undefined;
}

/**
 * Merges new fields into an existing fields array (adds new, doesn't duplicate).
 */
function _mergeFields(existing: SitecoreField[], incoming: SitecoreField[]): void {
	for (const field of incoming) {
		const found = existing.find(f => f.name === field.name);
		if (!found) {
			existing.push(field);
		} else {
			// Update type if was unknown
			if (found.type === 'unknown' && field.type !== 'unknown') {
				found.type = field.type;
				found.notes = field.notes ?? found.notes;
			}
			// Update observed status
			if (!found.observed && field.observed) {
				found.observed = true;
			}
			// Prefer a shape learned from a populated instance. An unpopulated
			// field yields a thin shape like `{value:null}`, so a longer one
			// observed on another route is strictly more informative.
			if (field.shape && (!found.shape || field.shape.length > found.shape.length)) {
				found.shape = field.shape;
			}
		}
	}
}
