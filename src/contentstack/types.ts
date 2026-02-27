/**
 * F-032: Contentstack Schema Validation — Types & Interfaces
 *
 * Shared types for the Contentstack schema validation system that checks
 * whether field names used in source code match the actual Content Type
 * schema from Contentstack.
 */

// ---------------------------------------------------------------------------
// Contentstack schema types
// ---------------------------------------------------------------------------

/** A single field definition in a Contentstack Content Type schema. */
export interface ContentstackField {
	/** Machine-readable field UID (e.g. "hero_title"). */
	uid: string;
	/** Human-readable display name (e.g. "Hero Title"). */
	display_name: string;
	/** Field data type (e.g. "text", "number", "group", "blocks", "reference", "file", "link"). */
	data_type: string;
	/** Whether the field is required. */
	mandatory?: boolean;
	/** Whether the field supports multiple values. */
	multiple?: boolean;
	/** Nested fields for groups and global fields. */
	schema?: ContentstackField[];
}

/** A Contentstack Content Type definition (simplified). */
export interface ContentTypeSchema {
	/** Unique identifier for the content type (e.g. "page", "blog_post"). */
	uid: string;
	/** Human-readable title. */
	title: string;
	/** The field definitions that make up this content type. */
	schema: ContentstackField[];
	/** ISO timestamp of last modification (from API). */
	updated_at?: string;
}

/** The shape of a local JSON export file containing content type schemas. */
export interface ContentstackSchemaExport {
	content_types: ContentTypeSchema[];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Source for fetching schemas: Management API or a local JSON file. */
export type SchemaSource = 'api' | 'local';

/** VS Code settings for the Contentstack validation feature. */
export interface ContentstackConfig {
	/** Enable Contentstack schema validation during reviews. */
	enabled: boolean;
	/** Where to load schemas from: "api" or "local". */
	schemaSource: SchemaSource;
	/** Contentstack Management API key (required when schemaSource is "api"). */
	apiKey: string;
	/** Contentstack Management Token (required when schemaSource is "api"). */
	managementToken: string;
	/** Contentstack API host (default: "https://api.contentstack.io"). */
	apiHost: string;
	/** Path to local JSON schema export file, relative to workspace root. */
	localSchemaPath: string;
	/** Maximum number of content types to include per review prompt. */
	maxContentTypes: number;
}

// ---------------------------------------------------------------------------
// Code parser results
// ---------------------------------------------------------------------------

/** A single field access extracted from source code. */
export interface ExtractedFieldAccess {
	/** The field name accessed (e.g. "hero_title"). */
	fieldName: string;
	/** The content type UID if determinable (e.g. "page"). */
	contentTypeUid?: string;
	/** The line number where the access occurs (1-based). */
	line: number;
	/** The full line of source code for context. */
	sourceLine: string;
	/** How the content type was inferred. */
	inferenceMethod: 'explicit' | 'variable-trace' | 'function-name' | 'unknown';
}

/** Result of parsing a file for Contentstack field accesses. */
export interface CodeParseResult {
	/** All extracted field accesses. */
	accesses: ExtractedFieldAccess[];
	/** Content type UIDs referenced in the file (if determinable). */
	contentTypeUids: string[];
	/** The file path that was parsed. */
	filePath: string;
}

// ---------------------------------------------------------------------------
// Validation results
// ---------------------------------------------------------------------------

/** The result of validating a single field access against the schema. */
export interface FieldValidationResult {
	/** The field access that was checked. */
	access: ExtractedFieldAccess;
	/** Whether the field exists in the schema. */
	valid: boolean;
	/** The closest matching field name if the field is invalid. */
	suggestion?: string;
	/** The Levenshtein distance to the suggestion. */
	distance?: number;
	/** The content type this was validated against. */
	contentTypeUid?: string;
}

/** Aggregated validation result for a file or diff. */
export interface ValidationResult {
	/** All individual field validations. */
	fields: FieldValidationResult[];
	/** Content types that were matched and used for validation. */
	resolvedContentTypes: ContentTypeSchema[];
	/** Content type UIDs referenced in code but not found in the schema. */
	unresolvedContentTypes: string[];
	/** Summary statistics. */
	stats: {
		totalAccesses: number;
		validFields: number;
		invalidFields: number;
		unresolvedTypes: number;
	};
}
