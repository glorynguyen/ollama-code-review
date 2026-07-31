/**
 * F-050: Sitecore Layout Service Schema Validation — Types & Interfaces
 *
 * Shared types for the Sitecore schema validation system that checks
 * whether field names used in JSS component code match the actual
 * component schema extracted from the Sitecore Layout Service.
 */

// ---------------------------------------------------------------------------
// Sitecore field & template types
// ---------------------------------------------------------------------------

/** Inferred field type from Layout Service response shape. */
export type SitecoreFieldType =
	| 'Single-Line Text'
	| 'Rich Text'
	| 'Image'
	| 'General Link'
	| 'Checkbox'
	| 'File'
	| 'Lookup'
	| 'Multilist'
	| 'Bynder DAM'
	| 'Date'
	| 'Number'
	| 'unknown';

/** A single field definition inferred from Layout Service data. */
export interface SitecoreField {
	/** Field name as it appears in the Layout Service response (e.g. "Headline"). */
	name: string;
	/** Inferred Sitecore field type. */
	type: SitecoreFieldType;
	/** Whether the field was observed with a non-empty value (heuristic for "required"). */
	observed: boolean;
	/** Additional notes (e.g. "src, alt, w×h" for images). */
	notes?: string;
	/**
	 * Skeleton of the observed value: real keys, value types only, no content
	 * (e.g. `{value:{src:str,alt:str,width:str,height:str}}`).
	 *
	 * This is what makes sub-property access checkable — the inferred `type`
	 * says "Image" but only the shape says the key is `src` and not `url`.
	 * Contains no field content, so it is safe to persist and commit.
	 */
	shape?: string;
}

/**
 * Raw Layout Service field values, keyed `componentName` → `fieldName` → value.
 *
 * Held in memory for the Schema Explorer session only. Never written to
 * `.sitecore/schema-cache.json`: real values can include unpublished copy,
 * customer names, and signed media URLs that should not land in a committed file.
 */
export type SitecoreRawSamples = Record<string, Record<string, unknown>>;

/** A Sitecore component definition extracted from Layout Service. */
export interface SitecoreComponentSchema {
	/** The component name as registered in JSS (e.g. "BentoGrid"). */
	componentName: string;
	/** Fields directly on the component. */
	fields: SitecoreField[];
	/** Placeholders where this component was found. */
	placeholders: string[];
	/** Routes where this component was discovered. */
	discoveredOnRoutes: string[];
	/** Child template fields (e.g. items in a Multilist). */
	childFields?: SitecoreField[];
	/** Name inferred for child template (e.g. "BentoBox"). */
	childTemplateName?: string;
}

/** Route-level page template fields. */
export interface SitecorePageSchema {
	/** Template name (e.g. "Page"). */
	templateName: string;
	/** Template ID GUID. */
	templateId?: string;
	/** Route-level fields. */
	fields: SitecoreField[];
}

// ---------------------------------------------------------------------------
// Schema cache format
// ---------------------------------------------------------------------------

/** The cached schema file structure (.sitecore/schema-cache.json). */
export interface SitecoreSchemaCache {
	/** ISO timestamp when schema was generated. */
	_generated: string;
	/** Source of the schema data. */
	_source: string;
	/** Routes that were scanned to build this schema. */
	_routesScanned: string[];
	/** Route-level page template. */
	pageTemplate?: SitecorePageSchema;
	/** Component schemas indexed by componentName. */
	components: Record<string, SitecoreComponentSchema>;
	/** All discovered placeholder names. */
	placeholders: string[];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Schema source options. */
export type SitecoreSchemaSource = 'auto' | 'graphql' | 'local';

/** VS Code settings for the Sitecore validation feature. */
export interface SitecoreConfig {
	/** Enable Sitecore schema validation during reviews. */
	enabled: boolean;
	/** Where to load schemas from. */
	schemaSource: SitecoreSchemaSource;
	/** Path to .env file for auto-detection (default: ".env.local"). */
	envFile: string;
	/** GraphQL endpoint (overrides .env detection). */
	graphqlEndpoint: string;
	/** API key for Experience Edge (overrides .env detection). */
	apiKey: string;
	/** Sitecore site name (overrides .env detection). */
	siteName: string;
	/** Path to local schema cache file. */
	localSchemaPath: string;
	/** Cache TTL in minutes. */
	cacheTtlMinutes: number;
	/** Validate field types (e.g. <Image> on a text field). */
	validateFieldTypes: boolean;
	/** Validate placeholder names. */
	validatePlaceholders: boolean;
	/** Max components to include in review prompt. */
	maxComponents: number;
}

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

/** Detected Sitecore environment config from .env files. */
export interface SitecoreEnvConfig {
	/** SITECORE_API_KEY */
	apiKey: string;
	/** GRAPH_QL_ENDPOINT */
	graphqlEndpoint: string;
	/** SITECORE_SITE_NAME */
	siteName: string;
}

// ---------------------------------------------------------------------------
// Code parser results
// ---------------------------------------------------------------------------

/** A single field access extracted from JSS component source code. */
export interface SitecoreFieldAccess {
	/** The field name accessed (e.g. "Headline"). */
	fieldName: string;
	/** The component name if determinable (e.g. "L1Hero"). */
	componentName?: string;
	/** The file the access was found in (e.g. "src/components/L1Hero.tsx"). */
	filePath?: string;
	/** The line number where the access occurs (1-based). */
	line: number;
	/** The full line of source code for context. */
	sourceLine: string;
	/** How the component was inferred. */
	inferenceMethod: 'filename' | 'variable-trace' | 'props-type' | 'unknown';
	/** Whether this is a child/nested field access (e.g. box.fields.Image). */
	isChildAccess: boolean;
	/**
	 * The JSS helper component the field was passed to, when there was one
	 * (e.g. `Image` for `<Image field={fields.Hero} />`). Enables checking that
	 * the helper matches the field's actual type.
	 */
	helper?: string;
}

/** Result of parsing a file for Sitecore field accesses. */
export interface SitecoreCodeParseResult {
	/** All extracted field accesses. */
	accesses: SitecoreFieldAccess[];
	/** Component names referenced in the file. */
	componentNames: string[];
	/** The file path that was parsed. */
	filePath: string;
	/** Whether a `<Placeholder name="…">` appears, so the check is worth prompting for. */
	hasPlaceholderJsx?: boolean;
}

// ---------------------------------------------------------------------------
// Validation results
// ---------------------------------------------------------------------------

/** The result of validating a single field access against the schema. */
export interface SitecoreFieldValidationResult {
	/** The field access that was checked. */
	access: SitecoreFieldAccess;
	/** Whether the field exists in the schema. */
	valid: boolean;
	/** The closest matching field name if invalid. */
	suggestion?: string;
	/** Levenshtein distance to the suggestion. */
	distance?: number;
	/** The component this was validated against. */
	componentName?: string;
}

/** Aggregated validation result. */
export interface SitecoreValidationResult {
	/** All individual field validations. */
	fields: SitecoreFieldValidationResult[];
	/** Components that were matched and validated against. */
	resolvedComponents: string[];
	/** Component names referenced in code but not in schema. */
	unresolvedComponents: string[];
	/** Summary statistics. */
	stats: {
		totalAccesses: number;
		validFields: number;
		invalidFields: number;
		unresolvedComponents: number;
	};
}

// ---------------------------------------------------------------------------
// Layout Service response types (for parsing)
// ---------------------------------------------------------------------------

/** A component rendering from the Layout Service response. */
export interface LayoutServiceComponent {
	uid: string;
	componentName: string;
	dataSource?: string;
	params?: Record<string, string>;
	fields: Record<string, unknown>;
	placeholders?: Record<string, LayoutServiceComponent[]>;
}

/** The route portion of a Layout Service response. */
export interface LayoutServiceRoute {
	name: string;
	displayName: string;
	fields: Record<string, unknown>;
	templateId?: string;
	templateName?: string;
	placeholders: Record<string, LayoutServiceComponent[]>;
}

/** The full rendered Layout Service response. */
export interface LayoutServiceResponse {
	sitecore: {
		context: {
			pageEditing: boolean;
			site: { name: string };
			language: string;
			itemPath: string;
		};
		route: LayoutServiceRoute;
	};
}

// ---------------------------------------------------------------------------
// Explorer panel types
// ---------------------------------------------------------------------------

/** Summary of a component for the explorer panel. */
export interface ComponentSummary {
	componentName: string;
	placeholder: string;
	fieldCount: number;
	hasChildren: boolean;
}

/** Messages from the explorer webview to the extension. */
export type ExplorerPanelMessage =
	| { type: 'get-config' }
	| { type: 'fetch-layout'; route: string }
	| { type: 'select-component'; componentName: string }
	| { type: 'save-schema' }
	| { type: 'copy-typescript'; componentName: string }
	| { type: 'copy-json'; componentName: string }
	| { type: 'copy-raw'; componentName: string }
	| { type: 'use-for-validation'; components: string[] };

/** Messages from the extension to the explorer webview. */
export type ExplorerExtensionMessage =
	| { type: 'config'; endpoint: string; siteName: string; source: 'env' | 'settings' | 'none' }
	| { type: 'layout-result'; placeholders: string[]; components: ComponentSummary[]; routePath: string }
	| {
		type: 'component-detail';
		component: SitecoreComponentSchema;
		/** Raw Layout Service values for this component, string values truncated. */
		raw?: Record<string, unknown>;
	}
	| { type: 'error'; message: string }
	| { type: 'loading'; active: boolean }
	| { type: 'schema-saved'; path: string };
