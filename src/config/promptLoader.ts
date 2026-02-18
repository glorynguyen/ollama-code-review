/**
 * F-006 (remainder): Project-level YAML config loader for .ollama-review.yaml
 *
 * Implements the config hierarchy:
 *   built-in defaults → VS Code user/workspace settings → .ollama-review.yaml (highest priority)
 *
 * Teams can commit .ollama-review.yaml to share prompt templates and review settings
 * without requiring every contributor to update their VS Code settings.
 */
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Shape of the .ollama-review.yaml file.
 * All fields are optional; only provided fields override lower-priority sources.
 *
 * Example .ollama-review.yaml:
 *
 *   prompts:
 *     review: |
 *       You are a strict security reviewer. Analyze this diff:
 *       ${code}
 *     commitMessage: |
 *       Write a Conventional Commits message for:
 *       ${diff}
 *   frameworks:
 *     - React
 *     - TypeScript
 *   diffFilter:
 *     ignorePaths:
 *       - "**\/node_modules\/**"
 *       - "**\/*.lock"
 *     ignorePatterns:
 *       - "*.min.js"
 *     maxFileLines: 300
 *     ignoreFormattingOnly: true
 */
export interface OllamaReviewYamlConfig {
    prompts?: {
        /** Custom prompt template for code reviews (supports ${code}, ${frameworks}, ${skills}, ${profile}). */
        review?: string;
        /** Custom prompt template for commit messages (supports ${diff}, ${draftMessage}). */
        commitMessage?: string;
    };
    /** Override the list of frameworks used in review prompts. */
    frameworks?: string[];
    /** Override diff filtering configuration. */
    diffFilter?: {
        ignorePaths?: string[];
        ignorePatterns?: string[];
        maxFileLines?: number;
        ignoreFormattingOnly?: boolean;
    };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** `undefined` = not yet loaded; `null` = file not found/invalid; object = loaded config */
let _cachedConfig: OllamaReviewYamlConfig | null | undefined = undefined;
let _cachedWorkspaceRoot: string | undefined = undefined;

// ---------------------------------------------------------------------------
// Core loader
// ---------------------------------------------------------------------------

/**
 * Reads and parses `.ollama-review.yaml` from the first workspace folder root.
 * Results are cached for the lifetime of the workspace session and can be
 * invalidated by calling {@link clearProjectConfigCache}.
 *
 * Returns `null` if the file does not exist, cannot be read, or is malformed.
 */
export async function loadProjectConfig(outputChannel?: vscode.OutputChannel): Promise<OllamaReviewYamlConfig | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return null;
    }

    const workspaceRoot = workspaceFolders[0].uri;
    const workspaceRootStr = workspaceRoot.toString();

    // Invalidate cache when workspace changes
    if (_cachedWorkspaceRoot !== workspaceRootStr) {
        _cachedConfig = undefined;
        _cachedWorkspaceRoot = workspaceRootStr;
    }

    // Return cached result if available
    if (_cachedConfig !== undefined) {
        return _cachedConfig;
    }

    const configUri = vscode.Uri.joinPath(workspaceRoot, '.ollama-review.yaml');

    try {
        const fileBytes = await vscode.workspace.fs.readFile(configUri);
        const yamlContent = Buffer.from(fileBytes).toString('utf-8');

        const parsed = yaml.load(yamlContent);

        if (parsed === null || parsed === undefined) {
            // Empty file — treat as no config
            _cachedConfig = null;
            return null;
        }

        if (typeof parsed !== 'object' || Array.isArray(parsed)) {
            const msg = '.ollama-review.yaml must be a YAML mapping (key-value object). Config ignored.';
            outputChannel?.appendLine(`[Ollama Code Review] Warning: ${msg}`);
            vscode.window.showWarningMessage(`Ollama Code Review: ${msg}`);
            _cachedConfig = null;
            return null;
        }

        const config = parsed as OllamaReviewYamlConfig;
        _validateConfig(config, outputChannel);

        _cachedConfig = config;
        outputChannel?.appendLine('[Ollama Code Review] Loaded project config from .ollama-review.yaml');
        return config;
    } catch (err: any) {
        if (err?.code === 'FileNotFound' || err?.name === 'EntryNotFound') {
            // File simply doesn't exist — normal situation
            _cachedConfig = null;
            return null;
        }

        // YAML parse error or unexpected I/O error
        const msg = `.ollama-review.yaml could not be loaded: ${err?.message ?? String(err)}`;
        outputChannel?.appendLine(`[Ollama Code Review] Warning: ${msg}`);
        vscode.window.showWarningMessage(`Ollama Code Review: ${msg}`);
        _cachedConfig = null;
        return null;
    }
}

/**
 * Clears the in-memory config cache so the next call to {@link loadProjectConfig}
 * re-reads the file from disk.
 */
export function clearProjectConfigCache(): void {
    _cachedConfig = undefined;
}

// ---------------------------------------------------------------------------
// Effective value helpers (config hierarchy)
// ---------------------------------------------------------------------------

/**
 * Returns the review prompt template respecting the config hierarchy:
 * built-in default → VS Code settings → .ollama-review.yaml
 */
export async function getEffectiveReviewPrompt(
    defaultPrompt: string,
    outputChannel?: vscode.OutputChannel
): Promise<string> {
    const vsCodeSettings = vscode.workspace.getConfiguration('ollama-code-review');
    const settingsPrompt = vsCodeSettings.get<string>('prompt.review', '');

    const projectConfig = await loadProjectConfig(outputChannel);
    const yamlPrompt = projectConfig?.prompts?.review?.trim();

    return yamlPrompt || settingsPrompt || defaultPrompt;
}

/**
 * Returns the commit message prompt template respecting the config hierarchy.
 */
export async function getEffectiveCommitPrompt(
    defaultPrompt: string,
    outputChannel?: vscode.OutputChannel
): Promise<string> {
    const vsCodeSettings = vscode.workspace.getConfiguration('ollama-code-review');
    const settingsPrompt = vsCodeSettings.get<string>('prompt.commitMessage', '');

    const projectConfig = await loadProjectConfig(outputChannel);
    const yamlPrompt = projectConfig?.prompts?.commitMessage?.trim();

    return yamlPrompt || settingsPrompt || defaultPrompt;
}

/**
 * Returns the frameworks list respecting the config hierarchy.
 */
export async function getEffectiveFrameworks(outputChannel?: vscode.OutputChannel): Promise<string[]> {
    const vsCodeSettings = vscode.workspace.getConfiguration('ollama-code-review');
    const settingsFrameworks = vsCodeSettings.get<string[] | string>('frameworks', ['React']);

    const projectConfig = await loadProjectConfig(outputChannel);
    const yamlFrameworks = projectConfig?.frameworks;

    if (yamlFrameworks && Array.isArray(yamlFrameworks) && yamlFrameworks.length > 0) {
        return yamlFrameworks.map(String);
    }

    if (Array.isArray(settingsFrameworks)) {
        return settingsFrameworks;
    }
    if (typeof settingsFrameworks === 'string' && settingsFrameworks) {
        return [settingsFrameworks];
    }
    return ['React'];
}

/**
 * Returns a partial diff-filter config override from .ollama-review.yaml (if present).
 * The caller (diffFilter.ts) merges this on top of VS Code settings.
 */
export async function getYamlDiffFilterOverrides(
    outputChannel?: vscode.OutputChannel
): Promise<OllamaReviewYamlConfig['diffFilter'] | null> {
    const projectConfig = await loadProjectConfig(outputChannel);
    return projectConfig?.diffFilter ?? null;
}

// ---------------------------------------------------------------------------
// Schema validation (soft — logs warnings, does not throw)
// ---------------------------------------------------------------------------

function _validateConfig(config: OllamaReviewYamlConfig, outputChannel?: vscode.OutputChannel): void {
    const warn = (msg: string) => {
        outputChannel?.appendLine(`[Ollama Code Review] .ollama-review.yaml warning: ${msg}`);
    };

    if (config.prompts !== undefined) {
        if (typeof config.prompts !== 'object' || Array.isArray(config.prompts)) {
            warn('"prompts" must be a mapping.');
        } else {
            if (config.prompts.review !== undefined && typeof config.prompts.review !== 'string') {
                warn('"prompts.review" must be a string.');
            }
            if (config.prompts.commitMessage !== undefined && typeof config.prompts.commitMessage !== 'string') {
                warn('"prompts.commitMessage" must be a string.');
            }
        }
    }

    if (config.frameworks !== undefined) {
        if (!Array.isArray(config.frameworks)) {
            warn('"frameworks" must be a list of strings.');
        }
    }

    if (config.diffFilter !== undefined) {
        const df = config.diffFilter;
        if (typeof df !== 'object' || Array.isArray(df)) {
            warn('"diffFilter" must be a mapping.');
        } else {
            if (df.ignorePaths !== undefined && !Array.isArray(df.ignorePaths)) {
                warn('"diffFilter.ignorePaths" must be a list.');
            }
            if (df.ignorePatterns !== undefined && !Array.isArray(df.ignorePatterns)) {
                warn('"diffFilter.ignorePatterns" must be a list.');
            }
            if (df.maxFileLines !== undefined && typeof df.maxFileLines !== 'number') {
                warn('"diffFilter.maxFileLines" must be a number.');
            }
            if (df.ignoreFormattingOnly !== undefined && typeof df.ignoreFormattingOnly !== 'boolean') {
                warn('"diffFilter.ignoreFormattingOnly" must be true or false.');
            }
        }
    }
}
