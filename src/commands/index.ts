import * as vscode from 'vscode';
import axios from 'axios';
import * as path from 'path';
import { OllamaReviewPanel } from '../reviewProvider';
import { SkillsService } from '../skillsService';
import { SkillsBrowserPanel } from '../skillsBrowserPanel';
import { getOllamaModel, resolvePrompt } from '../utils';
import { filterDiff, getFilterSummary, getDiffFilterConfigWithYaml } from '../diffFilter';
import {
	getEffectiveReviewPrompt,
	getEffectiveCommitPrompt,
	getEffectiveFrameworks,
} from '../config/promptLoader';
import {
	getAllProfiles,
	getActiveProfileName,
	getActiveProfile,
	buildProfilePromptContext
} from '../profiles';
import {
	ExplainCodeActionProvider,
	ExplainCodePanel,
	GenerateTestsActionProvider,
	GenerateTestsPanel,
	getTestFileName,
	detectTestFramework,
	FixIssueActionProvider,
	FixPreviewPanel,
	FixTracker,
	AddDocumentationActionProvider,
	DocumentationPreviewPanel,
	getDocumentationStyle,
} from '../codeActions';
import {
	promptAndFetchPR,
	parsePRInput,
	parseRemoteUrl,
	postPRSummaryComment,
	postPRReview,
	PRReference
} from '../github/prReview';
import { getGitHubAuth, showAuthSetupGuide } from '../github/auth';
import {
	getPreCommitGuardConfig,
	isHookInstalled,
	installHook,
	uninstallHook,
	createBypassFile,
	removeBypassFile,
	assessSeverity,
	formatAssessmentSummary
} from '../preCommitGuard';
import type { SeverityAssessment } from '../preCommitGuard';
import {
	gatherContext,
	getContextGatheringConfig,
	ContextBundle,
	parseImports,
	resolveImport,
	readFileContent,
	DependencyRegistry,
	toRelativePath,
	getSignatureHash,
} from '../context';
import { sendNotifications, type NotificationPayload } from '../notifications';
import {
	parseFindingCounts,
	computeScore,
	ReviewScoreStore,
	ReviewHistoryPanel,
	updateScoreStatusBar,
	type ReviewScore,
} from '../reviewScore';
import { runAgentReview, getAgentModeConfig } from '../agent';
import { generateMermaidDiagram } from '../diagramGenerator';
import { parseIssueCategories, extractFilesFromDiff, AnalyticsDashboardPanel } from '../analytics';
import {
	loadKnowledgeBase,
	getKnowledgeBaseConfig,
	formatKnowledgeForPrompt,
	matchKnowledge,
} from '../knowledge';
import {
	promptAndFetchMR,
	postMRComment,
	MRReference,
	isGitLabRemote,
} from '../gitlab/mrReview';
import { getGitLabAuth } from '../gitlab/auth';
import {
	promptAndFetchBitbucketPR,
	postBitbucketPRComment,
	BitbucketPRReference,
	isBitbucketRemote,
} from '../bitbucket/prReview';
import { getBitbucketAuth } from '../bitbucket/auth';
import {
	JsonVectorStore,
	getRagConfig,
	indexWorkspace,
	getRagContext,
	buildRagContextSection,
	isEmbeddingModelAvailable,
	DEFAULT_RAG_CONFIG,
} from '../rag';
import { loadRulesDirectory } from '../rules/loader';
import {
	loadContentstackSchemas,
	getContentstackConfig,
	parseContentstackAccesses,
	validateFieldAccesses,
	buildContentstackPromptSection,
} from '../contentstack';
import { ReviewDecorationsManager, getAnnotationsConfig } from '../reviewDecorations';
import {
	type PerformanceMetrics,
	checkActiveModels,
	getLastPerformanceMetrics,
	clearPerformanceMetrics,
} from './providerClients';
import { type ProviderRequestContext, providerRegistry } from '../providers';
import {
	selectRepository,
	parseSuggestion,
	runGitCommand,
	SuggestionContentProvider,
	OllamaSuggestionProvider,
	updateModelStatusBar,
	updateProfileStatusBar,
} from './uiHelpers';
import {
	getOllamaSuggestion,
	getExplanation,
	getFileWithImportsExplanation,
	generateTests,
	generateFix,
	generateDocumentation,
	callAIProvider,
} from './aiActions';
import { executeInlineEdit } from '../inlineEdit/inlineEditProvider';
import { ComparisonPanel, type ModelComparisonEntry, type ComparisonResult } from '../compareModels';
import { buildReviewPrompt as buildSharedReviewPrompt, DEFAULT_REVIEW_PROMPT } from '../reviewPromptBuilder';
import {
	FindingsTreeProvider,
	STRUCTURED_REVIEW_SCHEMA_VERSION,
	normalizeReviewResult,
	renderValidatedReviewMarkdown,
	toLegacyReviewFinding,
	type ValidatedStructuredReviewResult,
} from '../reviewFindings';
import { scanDiffForSecrets, toStructuredFindings, type SecretFinding } from '../secretScanner';
import { getModelRecommendation, extractLanguagesFromDiff, bucketDiffSize } from '../modelAdvisor';
import type { ModelAdvisorInput } from '../modelAdvisor';
import { AutoReviewManager } from '../autoReview';
import { MonorepoResolver } from '../autoReview/monorepo';
import { buildFunctionContext, type FunctionContextEntry } from '../autoReview/smartContext';
import { mcpBridge, createMcpServer, type McpServerInstance } from '../mcp';
import { type CommandContext } from './commandContext';
import { registerFindingsCommands } from './findingsCommands';
import { registerReloadCommands } from './reloadCommands';
import { registerSettingsCommands } from './settingsCommands';

export { checkActiveModels, getLastPerformanceMetrics, clearPerformanceMetrics };
export type { PerformanceMetrics };

const V0_MODELS = [{ label: 'v0-auto', description: 'v0 Auto - Automatically selects the best model for the task' },
{ label: 'v0-mini', description: 'v0 Mini - Fastest response time, ideal for quick fixes' },
{ label: 'v0-pro', description: 'v0 Pro - Balanced performance and intelligence' },
{ label: 'v0-max', description: 'v0 Max - Most powerful model for complex logic and architecture' },
{ label: 'v0-max-fast', description: 'v0 Max Fast - High-performance version of the Max model' }];

const DEFAULT_COMMIT_MESSAGE_PROMPT = "You are an expert at writing git commit messages for Semantic Release.\nGenerate a commit message based on the git diff below following the Conventional Commits specification.\n\n### Structural Requirements:\n1. **Subject Line**: <type>(<scope>): <short description>\n   - Keep under 50 characters.\n   - Use imperative mood (\"add\" not \"added\").\n   - Types: feat (new feature), fix (bug fix), docs, style, refactor, perf, test, build, ci, chore, revert.\n2. **Body**: Explain 'what' and 'why'. Required if the change is complex.\n3. **Breaking Changes**: If the diff contains breaking changes, the footer MUST start with \"BREAKING CHANGE:\" followed by a description.\n\n### Rules:\n- If the user's draft mentions a breaking change, prioritize documenting it in the footer.\n- Semantic Release triggers: 'feat' for MINOR, 'fix' for PATCH, and 'BREAKING CHANGE' in footer for MAJOR.\n- Output ONLY the raw commit message text. No markdown blocks, no \"Here is your message,\" no preamble.\n\nDeveloper's draft message (may reflect intent):\n${draftMessage}\n\nStaged git diff:\n---\n${diff}\n---";

// ---------------------------------------------------------------------------

let outputChannel: vscode.OutputChannel;
let skillsServiceInstance: SkillsService | null = null;

// F-016: Score status bar item (initialised in activate())
let scoreStatusBarItem: vscode.StatusBarItem | undefined;
// Extension context reference for score store (set in activate())
let extensionGlobalStoragePath: string | undefined;

// F-031: Findings Explorer tree provider (initialised in activate())
let findingsTreeProvider: FindingsTreeProvider | undefined;

// F-009: RAG vector store (initialised lazily in activate())
let ragVectorStore: JsonVectorStore | undefined;
// Whether the Ollama embedding model is reachable (checked lazily)
let ragUseOllamaEmbeddings: boolean | undefined;

// MCP Server instance (initialised in activate() if enabled)
let mcpServerInstance: McpServerInstance | undefined;

// ---------------------------------------------------------------------------
// Project Code helpers (Jira ticket prefix for commit messages)
// ---------------------------------------------------------------------------

/**
 * Ensure the projectCode setting is configured. If empty, prompt the user
 * to enter their Jira project code and persist it at the most specific level
 * available: WorkspaceFolder (per-repo) when a folder URI is known, otherwise
 * Global (user-level) as a fallback.
 *
 * @param repoUri - URI of the git repository root (e.g. `repo.rootUri`). When
 *   provided the setting is read from and written to that specific workspace
 *   folder, enabling different project codes across multi-root workspaces.
 * Returns the project code string, or `undefined` if the user cancels.
 */
async function ensureProjectCode(repoUri?: vscode.Uri): Promise<string | undefined> {
	const config = repoUri
		? vscode.workspace.getConfiguration('ollama-code-review', repoUri)
		: vscode.workspace.getConfiguration('ollama-code-review');

	// When we know which repo we're in, only use the folder-scoped value.
	// config.get() falls back through Folder → Workspace → Global, which
	// causes a projectCode set for repo A to leak into repo B.
	const folder = repoUri ? vscode.workspace.getWorkspaceFolder(repoUri) : undefined;
	let code = '';
	if (folder) {
		const inspection = config.inspect<string>('projectCode');
		code = (inspection?.workspaceFolderValue ?? '').trim();
	} else {
		code = config.get<string>('projectCode', '').trim();
	}
	// Sentinel: user previously opted out of project code for this repo.
	if (code.toUpperCase() === 'NONE') { return undefined; }
	if (code) { return code; }

	// Give the user three choices instead of a bare input box so they can
	// permanently opt out of the Jira ticket prefix for this repo.
	const choice = await vscode.window.showQuickPick(
		[
			{ label: '$(pencil) Enter Project Code', description: 'Type your Jira project code (e.g., HWWW)', value: 'enter' as const },
			{ label: "$(circle-slash) Don't use project code", description: 'Never add a ticket prefix for this repo', value: 'none' as const },
			{ label: '$(debug-step-over) Skip this time', description: 'No prefix now, ask again next time', value: 'skip' as const },
		],
		{ placeHolder: 'Jira Project Code for commit messages', ignoreFocusOut: true },
	);

	if (!choice || choice.value === 'skip') { return undefined; }

	if (choice.value === 'none') {
		// Persist "NONE" so we never prompt again for this repo.
		if (folder) {
			const folderConfig = vscode.workspace.getConfiguration('ollama-code-review', folder.uri);
			await folderConfig.update('projectCode', 'NONE', vscode.ConfigurationTarget.WorkspaceFolder);
		} else {
			await config.update('projectCode', 'NONE', vscode.ConfigurationTarget.Global);
		}
		return undefined;
	}

	// choice.value === 'enter' — show input box to type the code.
	const input = await vscode.window.showInputBox({
		prompt: 'Enter your Jira Project Code (e.g., HWWW)',
		placeHolder: 'HWWW',
		ignoreFocusOut: true,
		validateInput: (v) => {
			const t = v.trim();
			if (t.toUpperCase() === 'NONE') { return '"NONE" is reserved — choose a different code'; }
			return /^[A-Z][A-Z0-9_-]*$/i.test(t) ? null : 'Must start with a letter; only letters, digits, hyphens, or underscores';
		},
	});
	code = input?.trim() ?? '';
	if (!code) { return undefined; }

	// Persist at the most specific level available.
	if (folder) {
		const folderConfig = vscode.workspace.getConfiguration('ollama-code-review', folder.uri);
		await folderConfig.update('projectCode', code.toUpperCase(), vscode.ConfigurationTarget.WorkspaceFolder);
	} else {
		await config.update('projectCode', code.toUpperCase(), vscode.ConfigurationTarget.Global);
	}

	return code.toUpperCase();
}

/**
 * Try to extract a Jira ticket ID (e.g. HWWW-123) from the current branch name.
 * Falls back to `PROJECT-XXX` if no match is found.
 */
async function resolveTicketId(repoPath: string, projectCode: string): Promise<string> {
	try {
		const branch = (await runGitCommand(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
		const upper = projectCode.toUpperCase();
		const pattern = new RegExp(`(${upper}-\\d+)`, 'i');
		const match = branch.match(pattern);
		if (match) {
			return match[1].toUpperCase();
		}
	} catch {
		// ignore — fall through to placeholder
	}
	return `${projectCode.toUpperCase()}-XXX`;
}

interface GitCommitDetails {
	hash: string;
	message: string;
	parents: string[];
	authorName?: string;
	commitDate?: Date;
}

interface CommitQuickPickItem extends vscode.QuickPickItem {
	hash: string;
}

interface ReviewGenerationResult {
	reviewText: string;
	rawResponse: string;
	reviewPrompt: string;
	structuredReview: ValidatedStructuredReviewResult;
}

interface RunReviewOptions {
	copyPromptOnly?: boolean;
	promptMode?: import('../reviewPromptBuilder').ReviewPromptMode;
}

function showScoreStatusBar(score: number): void {
	if (!scoreStatusBarItem) {
		return;
	}

	updateScoreStatusBar(scoreStatusBarItem, score);
	scoreStatusBarItem.show();
}

function restoreScoreStatusBar(globalStoragePath: string | undefined): void {
    if (!globalStoragePath) { return; }
    try {
        const lastScore = ReviewScoreStore.getInstance(globalStoragePath).getLastScore();
        if (lastScore?.score !== undefined) {
            showScoreStatusBar(lastScore.score);
        }
    } catch (err) {
        console.error('Failed to restore score status bar:', err);
    }
}

/**
 * Selects a Git repository from the workspace.
 * - If only one repo, returns it.
 * - If multiple, tries to find one matching the active editor.
 * - If no match, prompts the user to choose.
 * @param gitAPI The Git API instance.
 * @returns The selected repository object, or undefined if none is selected.
 */

export async function activate(context: vscode.ExtensionContext) {
	const skillsService = await SkillsService.create(context);
	// Store reference for cleanup on deactivation
	skillsServiceInstance = skillsService;
	outputChannel = vscode.window.createOutputChannel("Ollama Code Review");
	const suggestionProvider = new SuggestionContentProvider();

	// Create status bar item for model selection (appears in bottom status bar)
	const modelStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	modelStatusBarItem.command = 'ollama-code-review.selectModel';
	updateModelStatusBar(modelStatusBarItem);
	modelStatusBarItem.show();
	context.subscriptions.push(modelStatusBarItem);

	// Create status bar item for profile selection (next to model selector)
	const profileStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
	profileStatusBarItem.command = 'ollama-code-review.selectProfile';
	updateProfileStatusBar(profileStatusBarItem, context);
	profileStatusBarItem.show();
	context.subscriptions.push(profileStatusBarItem);

	const commandContext: CommandContext = {
		extensionContext: context,
		outputChannel,
		getGlobalStoragePath: () => extensionGlobalStoragePath,
		showScoreStatusBar,
		suggestionProvider,
	};

	const findingsCommands = registerFindingsCommands(commandContext);
	findingsTreeProvider = findingsCommands.provider;
	context.subscriptions.push(...findingsCommands.disposables);

	// Register profile selection command
	const settingsCommands = registerSettingsCommands({
		commandContext,
		skillsService,
		modelStatusBarItem,
		profileStatusBarItem,
		v0Models: V0_MODELS,
	});
	context.subscriptions.push(...settingsCommands);

	const reloadCommands = registerReloadCommands(commandContext);
	context.subscriptions.push(...reloadCommands);

	context.subscriptions.push(
		vscode.workspace.registerTextDocumentContentProvider('ollama-suggestion', suggestionProvider)
	);

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider('*', new OllamaSuggestionProvider(), {
			providedCodeActionKinds: OllamaSuggestionProvider.providedCodeActionKinds
		})
	);

	// Register new code action providers (F-005: Inline Code Actions)
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider('*', new ExplainCodeActionProvider(), {
			providedCodeActionKinds: ExplainCodeActionProvider.providedCodeActionKinds
		}),
		vscode.languages.registerCodeActionsProvider('*', new GenerateTestsActionProvider(), {
			providedCodeActionKinds: GenerateTestsActionProvider.providedCodeActionKinds
		}),
		vscode.languages.registerCodeActionsProvider('*', new FixIssueActionProvider(), {
			providedCodeActionKinds: FixIssueActionProvider.providedCodeActionKinds
		}),
		vscode.languages.registerCodeActionsProvider('*', new AddDocumentationActionProvider(), {
			providedCodeActionKinds: AddDocumentationActionProvider.providedCodeActionKinds
		})
	);

	// Explain Code command (F-005)
	const explainCodeCommand = vscode.commands.registerCommand('ollama-code-review.explainCode', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showInformationMessage('No active editor found.');
			return;
		}

		const selection = editor.selection;
		const selectedText = editor.document.getText(selection);

		if (selection.isEmpty || !selectedText.trim()) {
			vscode.window.showInformationMessage('Please select code to explain.');
			return;
		}

		try {
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Ollama: Explaining code...',
				cancellable: true
			}, async (progress, token) => {
				const explanation = await getExplanation(selectedText, editor.document.languageId);
				if (token.isCancellationRequested) { return; }

				ExplainCodePanel.createOrShow(selectedText, explanation, editor.document.languageId);
			});
		} catch (error) {
			handleError(error, 'Failed to explain code.');
		}
	});

	// Generate Tests command (F-005)
	const generateTestsCommand = vscode.commands.registerCommand('ollama-code-review.generateTests', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showInformationMessage('No active editor found.');
			return;
		}

		const selection = editor.selection;
		const selectedText = editor.document.getText(selection);

		if (selection.isEmpty || !selectedText.trim()) {
			vscode.window.showInformationMessage('Please select a function or code to generate tests for.');
			return;
		}

		try {
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Ollama: Generating tests...',
				cancellable: true
			}, async (progress, token) => {
				const testFramework = await detectTestFramework();
				const result = await generateTests(selectedText, editor.document.languageId, testFramework);
				if (token.isCancellationRequested) { return; }

				const testFileName = getTestFileName(path.basename(editor.document.fileName));
				GenerateTestsPanel.createOrShow(
					result.code,
					testFileName,
					result.explanation,
					editor.document.fileName,
					editor.document.languageId
				);
			});
		} catch (error) {
			handleError(error, 'Failed to generate tests.');
		}
	});

	// Fix Issue command (F-005) - for diagnostics
	const fixIssueCommand = vscode.commands.registerCommand('ollama-code-review.fixIssue', async (document: vscode.TextDocument, diagnostic: vscode.Diagnostic) => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document !== document) {
			vscode.window.showInformationMessage('Please ensure the file is open in the active editor.');
			return;
		}

		// Expand range to include full lines for context
		const startLine = diagnostic.range.start.line;
		const endLine = diagnostic.range.end.line;
		const expandedRange = new vscode.Range(
			new vscode.Position(Math.max(0, startLine - 2), 0),
			new vscode.Position(Math.min(document.lineCount - 1, endLine + 2), document.lineAt(Math.min(document.lineCount - 1, endLine + 2)).text.length)
		);
		const codeWithContext = document.getText(expandedRange);

		try {
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Ollama: Generating fix...',
				cancellable: true
			}, async (progress, token) => {
				const result = await generateFix(codeWithContext, diagnostic.message, document.languageId);
				if (token.isCancellationRequested) { return; }

				FixPreviewPanel.createOrShow(
					editor,
					expandedRange,
					codeWithContext,
					result.code,
					result.explanation,
					diagnostic.message,
					document.languageId
				);
			});
		} catch (error) {
			handleError(error, 'Failed to generate fix.');
		}
	});

	// Fix Selection command (F-005) - for selected code
	const fixSelectionCommand = vscode.commands.registerCommand('ollama-code-review.fixSelection', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showInformationMessage('No active editor found.');
			return;
		}

		const selection = editor.selection;
		const selectedText = editor.document.getText(selection);

		if (selection.isEmpty || !selectedText.trim()) {
			vscode.window.showInformationMessage('Please select code to fix.');
			return;
		}

		try {
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Ollama: Analyzing and fixing code...',
				cancellable: true
			}, async (progress, token) => {
				const result = await generateFix(selectedText, 'General code improvement', editor.document.languageId);
				if (token.isCancellationRequested) { return; }

				FixPreviewPanel.createOrShow(
					editor,
					selection,
					selectedText,
					result.code,
					result.explanation,
					'General code improvement',
					editor.document.languageId
				);
			});
		} catch (error) {
			handleError(error, 'Failed to fix code.');
		}
	});

	// Add Documentation command (F-005)
	const addDocumentationCommand = vscode.commands.registerCommand('ollama-code-review.addDocumentation', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showInformationMessage('No active editor found.');
			return;
		}

		const selection = editor.selection;
		const selectedText = editor.document.getText(selection);

		if (selection.isEmpty || !selectedText.trim()) {
			vscode.window.showInformationMessage('Please select a function or class to document.');
			return;
		}

		try {
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Ollama: Generating documentation...',
				cancellable: true
			}, async (progress, token) => {
				const docStyle = getDocumentationStyle(editor.document.languageId);
				const result = await generateDocumentation(selectedText, editor.document.languageId, docStyle);
				if (token.isCancellationRequested) { return; }

				DocumentationPreviewPanel.createOrShow(
					editor,
					selection,
					result.code,
					selectedText,
					result.explanation,
					editor.document.languageId
				);
			});
		} catch (error) {
			handleError(error, 'Failed to generate documentation.');
		}
	});

	// F-024: Inline Edit Mode
	const inlineEditCommand = vscode.commands.registerCommand('ollama-code-review.inlineEdit', async () => {
		try {
			await executeInlineEdit();
		} catch (error) {
			handleError(error, 'Inline Edit failed.');
		}
	});

	context.subscriptions.push(
		explainCodeCommand,
		generateTestsCommand,
		fixIssueCommand,
		fixSelectionCommand,
		addDocumentationCommand,
		inlineEditCommand,
	);

	const reviewStagedChangesCommand = vscode.commands.registerCommand('ollama-code-review.reviewChanges', async (scmRepo?: any) => {
		try {
			const gitAPI = getGitAPI();
			if (!gitAPI) { return; }
			let repo: any;
			if (scmRepo) {
				repo = scmRepo;
			} else {
				repo = await selectRepository(gitAPI);
			}
			if (!repo) {
				vscode.window.showInformationMessage('No Git repository found.');
				return;
			}
			const repoPath = repo.rootUri.fsPath;
			const diffResult = await runGitCommand(repoPath, ['diff', '--staged']);
			await runReview(diffResult, context, 'staged');
		} catch (error) {
			handleError(error, "Failed to review staged changes.");
		}
	});

	// F-042: Standalone command for scanning secrets in staged files
	const scanSecretsCommand = vscode.commands.registerCommand('ollama-code-review.scanSecrets', async () => {
		try {
			const gitAPI = getGitAPI();
			if (!gitAPI) { return; }
			const repo = await selectRepository(gitAPI);
			if (!repo) {
				vscode.window.showInformationMessage('No Git repository found.');
				return;
			}
			const repoPath = repo.rootUri.fsPath;
			const diffResult = await runGitCommand(repoPath, ['diff', '--staged']);
			
			if (!diffResult || !diffResult.trim()) {
				vscode.window.showInformationMessage('No staged changes found to scan.');
				return;
			}

			const secrets = scanDiffForSecrets(diffResult);

			if (secrets.length === 0) {
				vscode.window.showInformationMessage('✅ No secrets found in the staged changes.');
				return;
			}

			// Surface secrets in the findings tree
			if (findingsTreeProvider) {
				// Inject the secrets into the findings tree, clearing any existing ones
				const secretsStructured = toStructuredFindings(secrets);

				const mockStructuredReview = {
					schemaVersion: STRUCTURED_REVIEW_SCHEMA_VERSION,
					summary: 'Secret Scanner Results',
					findings: secretsStructured
				} satisfies ValidatedStructuredReviewResult;

				const secretsMarkdown = renderSecretScannerMarkdown(secrets);

				// We overwrite whatever was there
				findingsTreeProvider.setFindings(secretsMarkdown, diffResult);

				// Show the review panel as well
				const metrics = getLastPerformanceMetrics();
				try {
					OllamaReviewPanel.createOrShow(
						secretsMarkdown,
						diffResult,
						context,
						metrics,
						mockStructuredReview,
						'Secret Scan'
					);
				} catch (err) {
					outputChannel.appendLine(`[Secret Scanner] Failed to open review panel: ${err}`);
					vscode.window.showWarningMessage('Secrets found, but failed to open the review panel. See the output channel for details.');
				}

				// Ensure tree UI is visible even if the panel fails to render
				try {
					await vscode.commands.executeCommand('setContext', 'ollama-code-review.hasFindings', true);
					await vscode.commands.executeCommand('ollama-code-review.findingsView.focus');
				} catch (err) {
					outputChannel.appendLine(`[Secret Scanner] Failed to update UI context: ${err}`);
				}
			} else {
				const details = secrets.map((secret) => `${secret.file}:${secret.line} — ${secret.message}`).join('\n');
				outputChannel.appendLine(`[Secret Scanner] Found ${secrets.length} critical secret(s) in staging:\n${details}`);

				const action = await vscode.window.showWarningMessage(
					`Found ${secrets.length} critical secret(s) in staging.`,
					'Show Details',
				);
				if (action === 'Show Details') {
					outputChannel.show(true);
				}
			}

		} catch (error) {
			handleError(error, 'Failed to scan for secrets.');
		}
	});

	const reviewCommitCommand = vscode.commands.registerCommand('ollama-code-review.reviewCommit', async (commitOrUri?: any) => {
		try {
			const gitAPI = getGitAPI();
			if (!gitAPI) { return; }

			let repo: any;
			let commitHash: string | undefined;

			// Handle different invocation contexts
			if (commitOrUri) {
				// Called from Git Graph or SCM context menu with commit info
				if (commitOrUri.hash) {
					// Git Graph format
					commitHash = commitOrUri.hash;
					repo = gitAPI.repositories.find((r: any) =>
						commitOrUri.repoRoot && r.rootUri.fsPath === commitOrUri.repoRoot
					) || await selectRepository(gitAPI);
				} else if (commitOrUri.rootUri) {
					// SCM repository context
					repo = commitOrUri;
				}
			}

			if (!repo) {
				repo = await selectRepository(gitAPI);
			}

			if (!repo) {
				vscode.window.showInformationMessage('No Git repository found.');
				return;
			}

			const repoPath = repo.rootUri.fsPath;

			// If we don't have a commit hash yet, prompt for it or show a picker
			if (!commitHash) {
				const inputHash = await vscode.window.showInputBox({
					prompt: 'Enter commit hash to review (or leave empty to select from recent commits)',
					placeHolder: 'e.g., abc123 or HEAD~1'
				});

				if (inputHash === undefined) { return; } // User cancelled

				if (inputHash.trim()) {
					commitHash = inputHash.trim();
				} else {
					// Show commit picker
					await vscode.window.withProgress({
						location: vscode.ProgressLocation.Notification,
						title: 'Loading commits...',
						cancellable: false
					}, async () => {
						const log = await repo.log({ maxEntries: 50 }) as GitCommitDetails[];

						const quickPickItems: CommitQuickPickItem[] = log.map(commit => ({
							label: `$(git-commit) ${commit.message.split('\n')[0]}`,
							description: `${commit.hash.substring(0, 7)} by ${commit.authorName || 'Unknown'}`,
							detail: commit.commitDate ? new Date(commit.commitDate).toLocaleString() : '',
							hash: commit.hash
						}));

						const selected = await vscode.window.showQuickPick(quickPickItems, {
							placeHolder: 'Select a commit to review',
							matchOnDescription: true
						});

						if (selected) {
							commitHash = selected.hash;
						}
					});
				}
			}

			if (!commitHash) { return; }

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Ollama Code Review',
				cancellable: true
			}, async (progress, token) => {
				progress.report({ message: `Getting commit details for ${commitHash!.substring(0, 7)}...` });

				// Get commit details
				const commitDetails = await repo.getCommit(commitHash);
				if (token.isCancellationRequested) { return; }

				progress.report({ message: 'Generating diff...' });

				let diffResult: string;
				let parentHashOrEmptyTree: string;

				// Handle initial commit (no parents) vs regular commits
				if (commitDetails.parents.length > 0) {
					parentHashOrEmptyTree = commitDetails.parents[0];
					diffResult = await runGitCommand(repoPath, ['diff', `${parentHashOrEmptyTree}..${commitHash}`]);
				} else {
					// Initial commit - compare against empty tree
					parentHashOrEmptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
					diffResult = await runGitCommand(repoPath, ['diff', parentHashOrEmptyTree, commitHash as unknown as string]);
				}

				if (token.isCancellationRequested) { return; }

				// Get list of changed files for logging
				const filesList = await runGitCommand(repoPath, ['diff', '--name-only', parentHashOrEmptyTree, commitHash as unknown as string]);
				const filesArray = filesList.trim().split('\n').filter(Boolean);

				outputChannel.appendLine(`\n--- Reviewing Commit: ${commitHash!.substring(0, 7)} ---`);
				outputChannel.appendLine(`Commit Message: ${commitDetails.message.split('\n')[0]}`);
				outputChannel.appendLine(`Author: ${commitDetails.authorName || 'Unknown'}`);
				outputChannel.appendLine(`Changed files (${filesArray.length}):`);
				filesArray.forEach(f => outputChannel.appendLine(`  - ${f}`));
				outputChannel.appendLine('---------------------------------------');

				progress.report({ message: 'Running review...' });
				await runReview(diffResult, context, 'commit');
			});

		} catch (error) {
			handleError(error, 'Failed to review commit.');
		}
	});

	const reviewCommitRangeCommand = vscode.commands.registerCommand('ollama-code-review.reviewCommitRange', async () => {
		try {
			const gitAPI = getGitAPI();
			if (!gitAPI) { return; }
			const repo = await selectRepository(gitAPI);
			if (!repo) {
				vscode.window.showInformationMessage('No Git repository found.');
				return;
			}
			const repoPath = repo.rootUri.fsPath;

			const commitToRef = (await vscode.window.showInputBox({
				prompt: "Enter the newest commit or branch to include in the review (e.g., HEAD)",
				placeHolder: "Default: HEAD",
				value: "HEAD"
			}))?.trim();

			if (!commitToRef) { return; }

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "Ollama Code Review",
				cancellable: true
			}, async (progress, token) => {
				progress.report({ message: "Fetching commit history..." });
				const log = await repo.log({ maxEntries: 100, range: commitToRef }) as GitCommitDetails[];
				if (token.isCancellationRequested) { return; }

				const quickPickItems: CommitQuickPickItem[] = log.map(commit => ({
					label: `$(git-commit) ${commit.message.split('\n')[0]}`,
					description: `${commit.hash.substring(0, 7)} by ${commit.authorName || 'Unknown'}`,
					detail: commit.commitDate ? new Date(commit.commitDate).toLocaleString() : '',
					hash: commit.hash
				}));

				progress.report({ message: "Awaiting your selection..." });
				const selectedStartCommit = await vscode.window.showQuickPick(quickPickItems, {
					placeHolder: "Select the first commit to INCLUDE in the review (the base of your changes)",
					canPickMany: false,
					matchOnDescription: true
				});

				if (!selectedStartCommit || token.isCancellationRequested) { return; }

				const startCommitDetails = await repo.getCommit(selectedStartCommit.hash);

				progress.report({ message: 'Generating diff using git...' });

				let diffResult: string;
				let parentHashOrEmptyTree: string;

				if (startCommitDetails.parents.length > 0) {
					parentHashOrEmptyTree = startCommitDetails.parents[0];
					diffResult = await runGitCommand(repoPath, ['diff', parentHashOrEmptyTree, commitToRef]);
				} else {
					parentHashOrEmptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // empty tree hash
					outputChannel.appendLine(`Info: Initial commit selected. Diffing all changes up to ${commitToRef}.`);
					diffResult = await runGitCommand(repoPath, ['diff', parentHashOrEmptyTree, commitToRef]);
				}

				// Get changed files list and show in output channel
				const filesList = await runGitCommand(repoPath, ['diff', '--name-only', parentHashOrEmptyTree, commitToRef]);
				const filesArray = filesList.trim().split('\n').filter(Boolean);

				outputChannel.appendLine(`\n--- Changed files in selected range (${filesArray.length}) ---`);
				filesArray.forEach(f => outputChannel.appendLine(f));
				outputChannel.appendLine('---------------------------------------');

				await runReview(diffResult, context, 'commit-range');
			});

		} catch (error) {
			handleError(error, `Failed to generate commit diff.`);
		}
	});

	const reviewChangesBetweenTwoBranchesCommand = vscode.commands.registerCommand('ollama-code-review.reviewChangesBetweenTwoBranches', async () => {
		try {
			const gitAPI = getGitAPI();
			if (!gitAPI) { return; }
			const repo = await selectRepository(gitAPI);
			if (!repo) {
				vscode.window.showInformationMessage('No Git repository found.');
				return;
			}
			const repoPath = repo.rootUri.fsPath;
			const repoConfig = vscode.workspace.getConfiguration('ollama-code-review', repo.rootUri);
			const defaultBaseBranch = repoConfig.get<string>('defaultBaseBranch', '').trim();

			const fromRef = defaultBaseBranch || await vscode.window.showInputBox({
				prompt: 'Enter the base branch/ref to compare from (e.g., main)',
				placeHolder: 'main',
				value: 'main'
			});
			if (!fromRef) { return; }

			const toRef = await vscode.window.showInputBox({
				prompt: 'Enter the target branch/ref to compare to (e.g., feature-branch)',
				placeHolder: 'feature-branch',
			});
			if (!toRef) { return; }

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Ollama Code Review',
				cancellable: true
			}, async (progress, token) => {
				progress.report({ message: `Generating diff between ${fromRef} and ${toRef}...` });

				const diffResult = await runGitCommand(repoPath, ['diff', fromRef, toRef]);
				if (token.isCancellationRequested) { return; }

				const filesList = await runGitCommand(repoPath, ['diff', '--name-only', fromRef, toRef]);
				const filesArray = filesList.trim().split('\n').filter(Boolean);
				const mcpEnabled = vscode.workspace.getConfiguration('ollama-code-review').get<boolean>('mcp.enabled', false);

				outputChannel.appendLine(`\n--- Changed files between ${fromRef} and ${toRef} (${filesArray.length}) ---`);
				filesArray.forEach(f => outputChannel.appendLine(f));
				outputChannel.appendLine('---------------------------------------');

				await runReview(diffResult, context, 'branch-compare');
			});
		} catch (error) {
			handleError(error, 'Failed to review changes between branches.');
		}
	});

	const generateCommitMessageCommand = vscode.commands.registerCommand('ollama-code-review.generateCommitMessage', async (scmRepo?: any) => {
		try {
			const gitAPI = getGitAPI();
			if (!gitAPI) { return; }
			let repo: any;
			if (scmRepo) {
				repo = scmRepo;
			} else {
				repo = await selectRepository(gitAPI);
			}

			const repoPath = repo.rootUri.fsPath;
			const diffResult = await runGitCommand(repoPath, ['diff', '--staged']);

			if (!diffResult || !diffResult.trim()) {
				vscode.window.showInformationMessage('No staged changes to create a commit message from.');
				return;
			}

			// Resolve Jira project code scoped to this specific repo folder.
			// Passing repo.rootUri allows ensureProjectCode to read/write the
			// per-folder .vscode/settings.json, enabling different codes across
			// multi-root workspaces. Falls back to global if the URI isn't part
			// of a known WorkspaceFolder.
			const projectCode = await ensureProjectCode(repo.rootUri);
			let ticketId: string | undefined;
			if (projectCode) {
				ticketId = await resolveTicketId(repoPath, projectCode);
			}

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "Ollama",
				cancellable: true
			}, async (progress, token) => {
				progress.report({ message: "Generating commit message..." });

				const commitMessage = await getOllamaCommitMessage(diffResult, repo.inputBox.value?.trim(), ticketId);
				if (token.isCancellationRequested) { return; }

				if (commitMessage === 'PROMPT_COPIED') {
					return;
				}

				if (commitMessage) {
					repo.inputBox.value = commitMessage;
					vscode.window.showInformationMessage('Commit message generated and populated!');
				} else {
					vscode.window.showErrorMessage('Failed to generate commit message.');
				}
			});

		} catch (error) {
			handleError(error, "Failed to generate commit message.");
		}
	});

	// Put this inside the activate function, replacing the old suggestRefactoringCommand
	const suggestRefactoringCommand = vscode.commands.registerCommand('ollama-code-review.suggestRefactoring', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showInformationMessage('No active editor found.');
			return;
		}

		const selection = editor.selection;
		const selectedText = editor.document.getText(selection);

		if (selection.isEmpty || !selectedText.trim()) {
			vscode.window.showInformationMessage('Please select a code snippet to get a suggestion.');
			return;
		}

		// Define unique URIs for our virtual documents. A timestamp ensures they are new each time.
		const timestamp = new Date().getTime();
		const originalUri = vscode.Uri.parse(`ollama-suggestion:original/${path.basename(editor.document.fileName)}?ts=${timestamp}`);
		const suggestedUri = vscode.Uri.parse(`ollama-suggestion:suggestion/${path.basename(editor.document.fileName)}?ts=${timestamp}`);

		try {
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Window,
				title: "Ollama: Getting suggestion...",
				cancellable: true
			}, async (progress, token) => {
				const languageId = editor.document.languageId;
				const rawSuggestion = await getOllamaSuggestion(selectedText, languageId);
				if (token.isCancellationRequested) { return; }

				const parsed = parseSuggestion(rawSuggestion);

				if (!parsed) {
					vscode.window.showErrorMessage('Ollama returned a response in an unexpected format.');
					outputChannel.appendLine("--- Unexpected Ollama Response ---");
					outputChannel.appendLine(rawSuggestion);
					outputChannel.show();
					return;
				}

				const { code: suggestedCode, explanation } = parsed;

				// Set the content for our virtual documents via the provider
				suggestionProvider.setContent(originalUri, selectedText);
				suggestionProvider.setContent(suggestedUri, suggestedCode);

				const diffTitle = `Ollama Suggestion for ${path.basename(editor.document.fileName)}`;

				// Execute the built-in diff command
				vscode.commands.executeCommand('vscode.diff', originalUri, suggestedUri, diffTitle, {
					preview: true, // Show in a peek view, not a new editor tab
					viewColumn: vscode.ViewColumn.Beside, // Prefer showing beside the current editor
				});

				// Use a non-modal message for actions, now including the explanation.
				const userChoice = await vscode.window.showInformationMessage(
					explanation,
					{ modal: false }, // Explicitly non-modal
					"Apply Suggestion",
					"Dismiss"
				);

				if (userChoice === "Apply Suggestion") {
					editor.edit(editBuilder => {
						editBuilder.replace(selection, suggestedCode);
					});
					vscode.window.showInformationMessage('Suggestion applied!');
				}
			});
		} catch (error) {
			handleError(error, "Failed to get suggestion.");
		} finally {
			// CRITICAL: Always clean up the virtual document content to free memory.
			suggestionProvider.deleteContent(originalUri);
			suggestionProvider.deleteContent(suggestedUri);
		}
	});

	// Review GitHub PR command (F-004)
	const reviewGitHubPRCommand = vscode.commands.registerCommand('ollama-code-review.reviewGitHubPR', async () => {
		try {
			const gitAPI = getGitAPI();
			let repoPath = '';

			// Try to get repo path for context detection
			if (gitAPI) {
				const repo = await selectRepository(gitAPI);
				if (repo) {
					repoPath = repo.rootUri.fsPath;
				}
			}

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Ollama Code Review',
				cancellable: true
			}, async (progress, token) => {
				progress.report({ message: 'Authenticating with GitHub...' });

				const result = await promptAndFetchPR(repoPath, runGitCommand);
				if (!result || token.isCancellationRequested) { return; }

				const { diff, ref, info, auth } = result;

				outputChannel.appendLine(`\n--- Reviewing GitHub PR #${ref.prNumber} ---`);
				outputChannel.appendLine(`Title: ${info.title}`);
				outputChannel.appendLine(`Author: ${info.user}`);
				outputChannel.appendLine(`Branch: ${info.headBranch} → ${info.baseBranch}`);
				outputChannel.appendLine(`Changed files: ${info.changedFiles} (+${info.additions}/-${info.deletions})`);
				outputChannel.appendLine('---------------------------------------');

				progress.report({ message: `Reviewing PR #${ref.prNumber}: ${info.title}...` });

				// Store PR context for later "Post to PR" action
				context.globalState.update('activePRContext', {
					owner: ref.owner,
					repo: ref.repo,
					prNumber: ref.prNumber,
					title: info.title,
					url: info.url
				});

				// Use the existing runReview workflow
				await runReview(diff, context, 'pr');
			});
		} catch (error) {
			handleError(error, 'Failed to review GitHub PR.');
		}
	});

	// Post Review to GitHub PR command (F-004)
	const postReviewToPRCommand = vscode.commands.registerCommand('ollama-code-review.postReviewToPR', async () => {
		try {
			const prContext = context.globalState.get<{
				owner: string;
				repo: string;
				prNumber: number;
				title: string;
				url: string;
			}>('activePRContext');

			if (!prContext) {
				vscode.window.showErrorMessage(
					'No active PR context. Please run "Review GitHub PR" first.'
				);
				return;
			}

			const panel = OllamaReviewPanel.currentPanel;
			if (!panel) {
				vscode.window.showErrorMessage('No review panel open. Please run a review first.');
				return;
			}

			const reviewContent = panel.getReviewContent();
			if (!reviewContent) {
				vscode.window.showErrorMessage('No review content available.');
				return;
			}

			const auth = await getGitHubAuth(true);
			if (!auth) {
				await showAuthSetupGuide();
				return;
			}

			const config = vscode.workspace.getConfiguration('ollama-code-review');
			const commentStyle = config.get<string>('github.commentStyle', 'summary');
			const model = getOllamaModel(config);

			const ref: PRReference = {
				owner: prContext.owner,
				repo: prContext.repo,
				prNumber: prContext.prNumber
			};

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Posting review to GitHub...',
				cancellable: false
			}, async (progress) => {
				let commentUrl: string;

				if (commentStyle === 'summary') {
					progress.report({ message: 'Posting summary comment...' });
					commentUrl = await postPRSummaryComment(ref, auth, reviewContent, model);
				} else {
					// 'inline' or 'both' — normalize findings and only inline-comment validated anchors
					progress.report({ message: 'Validating review findings against diff...' });
					const originalDiff = panel.getOriginalDiff();
					const structuredReview = panel.getStructuredReview() ?? normalizeReviewResult(reviewContent, originalDiff);
					const findings = structuredReview.findings.map(toLegacyReviewFinding);
					const inlineFindings = findings.filter(f => f.file && f.line);

					progress.report({
						message: `Posting review with ${findings.length} findings (${inlineFindings.length} inline anchor${inlineFindings.length === 1 ? '' : 's'} validated)...`
					});
					commentUrl = await postPRReview(
						ref,
						auth,
						commentStyle === 'both' ? findings : inlineFindings,
						reviewContent,
						model
					);
				}

				const action = await vscode.window.showInformationMessage(
					`Review posted to PR #${prContext.prNumber}!`,
					'Open in Browser',
					'Copy URL'
				);

				if (action === 'Open in Browser') {
					vscode.env.openExternal(vscode.Uri.parse(commentUrl));
				} else if (action === 'Copy URL') {
					await vscode.env.clipboard.writeText(commentUrl);
				}
			});
		} catch (error) {
			handleError(error, 'Failed to post review to GitHub PR.');
		}
	});

	// F-015: Review GitLab MR command
	const reviewGitLabMRCommand = vscode.commands.registerCommand('ollama-code-review.reviewGitLabMR', async () => {
		try {
			const gitAPI = getGitAPI();
			let repoPath = '';

			// Try to get repo path for context detection
			if (gitAPI) {
				const repo = await selectRepository(gitAPI);
				if (repo) {
					repoPath = repo.rootUri.fsPath;
				}
			}

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Ollama Code Review',
				cancellable: true
			}, async (progress, token) => {
				progress.report({ message: 'Authenticating with GitLab...' });

				const result = await promptAndFetchMR(repoPath, runGitCommand);
				if (!result || token.isCancellationRequested) { return; }

				const { diff, ref, info, auth } = result;

				outputChannel.appendLine(`\n--- Reviewing GitLab MR !${ref.mrNumber} ---`);
				outputChannel.appendLine(`Title: ${info.title}`);
				outputChannel.appendLine(`Author: ${info.author}`);
				outputChannel.appendLine(`Branch: ${info.sourceBranch} → ${info.targetBranch}`);
				outputChannel.appendLine(`Changed files: ${info.changedFiles} (+${info.additions}/-${info.deletions})`);
				outputChannel.appendLine('---------------------------------------');

				progress.report({ message: `Reviewing MR !${ref.mrNumber}: ${info.title}...` });

				// Store MR context for later "Post to MR" action
				context.globalState.update('activeGitLabMRContext', {
					projectPath: ref.projectPath,
					mrNumber: ref.mrNumber,
					title: info.title,
					webUrl: info.webUrl
				});

				// Use the existing runReview workflow
				await runReview(diff, context, 'pr');
			});
		} catch (error) {
			handleError(error, 'Failed to review GitLab MR.');
		}
	});

	// F-015: Post Review to GitLab MR command
	const postReviewToMRCommand = vscode.commands.registerCommand('ollama-code-review.postReviewToMR', async () => {
		try {
			const mrContext = context.globalState.get<{
				projectPath: string;
				mrNumber: number;
				title: string;
				webUrl: string;
			}>('activeGitLabMRContext');

			if (!mrContext) {
				vscode.window.showErrorMessage(
					'No active MR context. Please run "Review GitLab MR" first.'
				);
				return;
			}

			const panel = OllamaReviewPanel.currentPanel;
			if (!panel) {
				vscode.window.showErrorMessage('No review panel open. Please run a review first.');
				return;
			}

			const reviewContent = panel.getReviewContent();
			if (!reviewContent) {
				vscode.window.showErrorMessage('No review content available.');
				return;
			}

			const auth = await getGitLabAuth(true);
			if (!auth) {
				return;
			}

			const config = vscode.workspace.getConfiguration('ollama-code-review');
			const model = getOllamaModel(config);

			const ref: MRReference = {
				projectPath: mrContext.projectPath,
				mrNumber: mrContext.mrNumber
			};

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Posting review to GitLab MR...',
				cancellable: false
			}, async (progress) => {
				progress.report({ message: 'Posting comment...' });
				const commentUrl = await postMRComment(ref, auth, reviewContent, model);

				const action = await vscode.window.showInformationMessage(
					`Review posted to MR !${mrContext.mrNumber}!`,
					'Open in Browser',
					'Copy URL'
				);

				if (action === 'Open in Browser') {
					vscode.env.openExternal(vscode.Uri.parse(commentUrl));
				} else if (action === 'Copy URL') {
					await vscode.env.clipboard.writeText(commentUrl);
				}
			});
		} catch (error) {
			handleError(error, 'Failed to post review to GitLab MR.');
		}
	});

	// F-015: Review Bitbucket PR command
	const reviewBitbucketPRCommand = vscode.commands.registerCommand('ollama-code-review.reviewBitbucketPR', async () => {
		try {
			const gitAPI = getGitAPI();
			let repoPath = '';

			// Try to get repo path for context detection
			if (gitAPI) {
				const repo = await selectRepository(gitAPI);
				if (repo) {
					repoPath = repo.rootUri.fsPath;
				}
			}

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Ollama Code Review',
				cancellable: true
			}, async (progress, token) => {
				progress.report({ message: 'Authenticating with Bitbucket...' });

				const result = await promptAndFetchBitbucketPR(repoPath, runGitCommand);
				if (!result || token.isCancellationRequested) { return; }

				const { diff, ref, info, auth } = result;

				outputChannel.appendLine(`\n--- Reviewing Bitbucket PR #${ref.prId} ---`);
				outputChannel.appendLine(`Title: ${info.title}`);
				outputChannel.appendLine(`Author: ${info.author}`);
				outputChannel.appendLine(`Branch: ${info.sourceBranch} → ${info.destinationBranch}`);
				outputChannel.appendLine('---------------------------------------');

				progress.report({ message: `Reviewing PR #${ref.prId}: ${info.title}...` });

				// Store PR context for later "Post to PR" action
				context.globalState.update('activeBitbucketPRContext', {
					workspace: ref.workspace,
					repoSlug: ref.repoSlug,
					prId: ref.prId,
					title: info.title,
					webUrl: info.webUrl
				});

				// Use the existing runReview workflow
				await runReview(diff, context, 'pr');
			});
		} catch (error) {
			handleError(error, 'Failed to review Bitbucket PR.');
		}
	});

	// F-015: Post Review to Bitbucket PR command
	const postReviewToBitbucketPRCommand = vscode.commands.registerCommand('ollama-code-review.postReviewToBitbucketPR', async () => {
		try {
			const bbContext = context.globalState.get<{
				workspace: string;
				repoSlug: string;
				prId: number;
				title: string;
				webUrl: string;
			}>('activeBitbucketPRContext');

			if (!bbContext) {
				vscode.window.showErrorMessage(
					'No active PR context. Please run "Review Bitbucket PR" first.'
				);
				return;
			}

			const panel = OllamaReviewPanel.currentPanel;
			if (!panel) {
				vscode.window.showErrorMessage('No review panel open. Please run a review first.');
				return;
			}

			const reviewContent = panel.getReviewContent();
			if (!reviewContent) {
				vscode.window.showErrorMessage('No review content available.');
				return;
			}

			const auth = await getBitbucketAuth(true);
			if (!auth) {
				return;
			}

			const config = vscode.workspace.getConfiguration('ollama-code-review');
			const model = getOllamaModel(config);

			const ref: BitbucketPRReference = {
				workspace: bbContext.workspace,
				repoSlug: bbContext.repoSlug,
				prId: bbContext.prId
			};

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Posting review to Bitbucket PR...',
				cancellable: false
			}, async (progress) => {
				progress.report({ message: 'Posting comment...' });
				const commentUrl = await postBitbucketPRComment(ref, auth, reviewContent, model);

				const action = await vscode.window.showInformationMessage(
					`Review posted to PR #${bbContext.prId}!`,
					'Open in Browser',
					'Copy URL'
				);

				if (action === 'Open in Browser') {
					vscode.env.openExternal(vscode.Uri.parse(commentUrl));
				} else if (action === 'Copy URL') {
					await vscode.env.clipboard.writeText(commentUrl);
				}
			});
		} catch (error) {
			handleError(error, 'Failed to post review to Bitbucket PR.');
		}
	});

	// F-009: RAG-Enhanced Reviews — initialise vector store
	ragVectorStore = new JsonVectorStore(context.globalStorageUri.fsPath);
	outputChannel.appendLine(`[RAG] Vector store loaded: ${ragVectorStore.chunkCount} chunks`);

	// F-009: Index Codebase command
	const indexCodebaseCommand = vscode.commands.registerCommand(
		'ollama-code-review.indexCodebase',
		async () => {
			const ragConfig = getRagConfig();
			if (!ragConfig.enabled) {
				const enable = await vscode.window.showInformationMessage(
					'RAG is disabled. Enable it to index your codebase for enhanced reviews.',
					'Enable RAG',
				);
				if (enable !== 'Enable RAG') { return; }
				await vscode.workspace.getConfiguration('ollama-code-review').update('rag.enabled', true, vscode.ConfigurationTarget.Global);
			}
			if (!ragVectorStore) {
				ragVectorStore = new JsonVectorStore(context.globalStorageUri.fsPath);
			}
			const config = getRagConfig();
			const vscodeConfig = vscode.workspace.getConfiguration('ollama-code-review');
			const endpoint = vscodeConfig.get<string>('endpoint', 'http://localhost:11434/api/generate');
			// Check embedding model availability once
			if (ragUseOllamaEmbeddings === undefined) {
				ragUseOllamaEmbeddings = await isEmbeddingModelAvailable(config.embeddingModel, endpoint);
				outputChannel.appendLine(`[RAG] Ollama embedding model "${config.embeddingModel}": ${ragUseOllamaEmbeddings ? 'available' : 'not available — using fallback TF-IDF embeddings'}`);
			}
			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'Ollama Code Review: Indexing codebase…', cancellable: true },
				async (_progress, token) => {
					const stats = await indexWorkspace(ragVectorStore!, config, endpoint, ragUseOllamaEmbeddings!, outputChannel, token);
					vscode.window.showInformationMessage(
						`Codebase indexed: ${stats.filesIndexed} files, ${stats.chunksCreated} chunks (${(stats.durationMs / 1000).toFixed(1)}s)`
					);
				},
			);
		}
	);

	// F-009: Clear RAG Index command
	const clearRagIndexCommand = vscode.commands.registerCommand(
		'ollama-code-review.clearRagIndex',
		() => {
			if (ragVectorStore) {
				ragVectorStore.clear();
				outputChannel.appendLine('[RAG] Index cleared.');
			}
			vscode.window.showInformationMessage('Ollama Code Review: RAG codebase index cleared.');
		}
	);

	// F-014: Pre-Commit Guard — status bar item
	const guardStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
	guardStatusBarItem.command = 'ollama-code-review.togglePreCommitGuard';
	function updateGuardStatusBar() {
		const gitAPI = vscode.extensions.getExtension('vscode.git')?.exports?.getAPI(1);
		const repo = gitAPI?.repositories?.[0];
		if (repo) {
			const installed = isHookInstalled(repo.rootUri.fsPath);
			guardStatusBarItem.text = installed ? '$(shield) Guard ON' : '$(shield) Guard OFF';
			guardStatusBarItem.tooltip = installed
				? 'Ollama Pre-Commit Guard is active — click to disable'
				: 'Ollama Pre-Commit Guard is inactive — click to enable';
			guardStatusBarItem.show();
		} else {
			guardStatusBarItem.hide();
		}
	}
	updateGuardStatusBar();

	// F-014: Toggle Pre-Commit Guard command
	const togglePreCommitGuardCommand = vscode.commands.registerCommand(
		'ollama-code-review.togglePreCommitGuard',
		async () => {
			try {
				const gitAPI = getGitAPI();
				if (!gitAPI) { return; }
				const repo = await selectRepository(gitAPI);
				if (!repo) {
					vscode.window.showInformationMessage('No Git repository found.');
					return;
				}
				const repoPath = repo.rootUri.fsPath;

				if (isHookInstalled(repoPath)) {
					const result = uninstallHook(repoPath);
					if (result.success) {
						vscode.window.showInformationMessage('Pre-commit guard disabled.');
						outputChannel.appendLine('[Pre-Commit Guard] Hook removed.');
					} else {
						vscode.window.showWarningMessage(result.message);
					}
				} else {
					const result = installHook(repoPath);
					if (result.success) {
						vscode.window.showInformationMessage(
							'Pre-commit guard enabled. Use "Ollama: Review & Commit" to commit with AI review.'
						);
						outputChannel.appendLine('[Pre-Commit Guard] Hook installed.');
					} else {
						vscode.window.showWarningMessage(result.message);
					}
				}
				updateGuardStatusBar();
			} catch (error) {
				handleError(error, 'Failed to toggle pre-commit guard.');
			}
		}
	);

	// F-016: Review Quality Score — status bar item (priority 97, just left of guard)
	scoreStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
	scoreStatusBarItem.command = 'ollama-code-review.showReviewHistory';
	scoreStatusBarItem.tooltip = 'Review Quality Score — click to view history';
	// Restore the last known score if one has already been persisted.

	// Set global storage path for score persistence
	extensionGlobalStoragePath = context.globalStorageUri.fsPath;
	restoreScoreStatusBar(extensionGlobalStoragePath);

	// F-016: Show Review History command
	const showReviewHistoryCommand = vscode.commands.registerCommand(
		'ollama-code-review.showReviewHistory',
		() => {
			const store = ReviewScoreStore.getInstance(context.globalStorageUri.fsPath);
			ReviewHistoryPanel.createOrShow(store.getScores(100));
		}
	);
	context.subscriptions.push(showReviewHistoryCommand, scoreStatusBarItem);

	// F-011: Analytics Dashboard command
	const showAnalyticsDashboardCommand = vscode.commands.registerCommand(
		'ollama-code-review.showAnalyticsDashboard',
		() => {
			const store = ReviewScoreStore.getInstance(context.globalStorageUri.fsPath);
			AnalyticsDashboardPanel.createOrShow(store.getAllScores());
		}
	);
	context.subscriptions.push(showAnalyticsDashboardCommand);

	// F-043: Auto-Review on Save — Background Code Quality Monitor
	const autoReviewManager = AutoReviewManager.create(
		context,
		// Review callback: reuse the existing file review pipeline (no UI panel).
		(content: string, label: string) => getOllamaFileReview(content, label, context),
		// Annotations callback: apply inline decorations for the file's findings.
		(reviewText: string, pseudoDiff: string) => {
			const annotCfg = getAnnotationsConfig();
			if (annotCfg.enabled) {
				ReviewDecorationsManager.getInstance().applyFromReview(reviewText, pseudoDiff);
			}
		},
		outputChannel,
	);

	// Phase 1-4: Impact Graph Agent Initialization
	const depRegistry = DependencyRegistry.getInstance();
	depRegistry.setOutputChannel(outputChannel);
	void depRegistry.indexWorkspace(); // Initial background indexing

	const impactStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 94);
	impactStatusBarItem.tooltip = 'Impact Graph: Number of downstream files importing this file';
	context.subscriptions.push(impactStatusBarItem);

	function updateImpactStatusBar(uri: vscode.Uri, signatureChange: boolean = false) {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
		if (!workspaceFolder) {
			impactStatusBarItem.hide();
			return;
		}
		const relPath = toRelativePath(uri, workspaceFolder.uri);
		const importers = depRegistry.getImporters(relPath);
		if (importers.length > 0) {
			const warning = signatureChange ? ' ⚠️ (API Change)' : '';
			impactStatusBarItem.text = `$(graph) ${importers.length} Impact${importers.length > 1 ? 's' : ''}${warning}`;
			impactStatusBarItem.backgroundColor = signatureChange ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
			impactStatusBarItem.command = signatureChange ? 'ollama-code-review.showImpactedFiles' : undefined;
			impactStatusBarItem.show();
		} else {
			impactStatusBarItem.hide();
		}
	}

	// Internal state for signature checks
	const signatureStates = new Map<string, string>(); // relPath -> hash

	const showImpactedFilesCommand = vscode.commands.registerCommand('ollama-code-review.showImpactedFiles', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) { return; }
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
		if (!workspaceFolder) { return; }
		const relPath = toRelativePath(editor.document.uri, workspaceFolder.uri);
		const importers = depRegistry.getImporters(relPath);

		if (importers.length > 0) {
			outputChannel.appendLine(`\n[Impact Agent] Downstream consumers of ${relPath}:`);
			importers.forEach(imp => outputChannel.appendLine(`  - ${imp}`));
			outputChannel.show();
			vscode.window.showInformationMessage(`Impact Analysis: ${importers.length} files depend on ${path.basename(relPath)}. See Output channel for details.`);
		}
	});
	context.subscriptions.push(showImpactedFilesCommand);

	// Update impact status bar when switching editors
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
		if (editor) { 
			updateImpactStatusBar(editor.document.uri); 
		} else { 
			impactStatusBarItem.hide(); 
		}
	}));

	// Smart Agentic Listener: Detect signature changes and update registry
	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (doc) => {
		// Only track code files
		if (!/\.(ts|tsx|js|jsx|mts|mjs)$/.test(doc.fileName)) { return; }

		const workspaceFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
		if (!workspaceFolder) { return; }

		const relPath = toRelativePath(doc.uri, workspaceFolder.uri);
		const lastHash = context.globalState.get<string>(`sig_hash_${relPath}`, '');
		const currentContent = doc.getText();
		const currentHash = getSignatureHash(currentContent);

		let hasSigChange = false;
		if (lastHash && lastHash !== currentHash) {
			hasSigChange = true;
			outputChannel.appendLine(`[Impact Agent] Public API signature changed in ${relPath}`);
		}

		// Update registry (Phase 1)
		await depRegistry.handleFileSave(doc.uri);
		
		// Persist hash for next check
		context.globalState.update(`sig_hash_${relPath}`, currentHash);
		updateImpactStatusBar(doc.uri, hasSigChange);
	}));

	// Initial check for current editor
	if (vscode.window.activeTextEditor) {
		updateImpactStatusBar(vscode.window.activeTextEditor.document.uri);
	}

	const toggleAutoReviewCommand = vscode.commands.registerCommand(
		'ollama-code-review.toggleAutoReview',
		() => {
			const newState = autoReviewManager.toggle();
			vscode.window.showInformationMessage(
				newState
					? 'Auto-Review on Save: ON — files will be reviewed silently after each save.'
					: 'Auto-Review on Save: OFF.',
			);
		},
	);
	context.subscriptions.push(toggleAutoReviewCommand, autoReviewManager);

	// MCP Server instance (initialised in activate() if enabled)
	let isMcpTransitioning = false;

	const mcpStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95);
	mcpStatusBarItem.command = 'ollama-code-review.toggleMcpServer';

	function updateMcpStatusBar(running: boolean, port: number): void {
		if (running) {
			mcpStatusBarItem.text = `$(plug) MCP :${port}`;
			mcpStatusBarItem.tooltip = `MCP Server running on localhost:${port} — click to stop`;
		} else {
			mcpStatusBarItem.text = '$(plug) MCP OFF';
			mcpStatusBarItem.tooltip = 'MCP Server stopped — click to start';
		}
		mcpStatusBarItem.show();
	}

	async function startMcpServer(): Promise<void> {
		if (mcpServerInstance) {
			return;
		}
		const config = vscode.workspace.getConfiguration('ollama-code-review');
		const port = config.get<number>('mcp.port', 19840);
		mcpServerInstance = createMcpServer(port);
		try {
			await mcpServerInstance.start();
			updateMcpStatusBar(true, port);
			outputChannel.appendLine(`[MCP] Server started on http://127.0.0.1:${port}/mcp`);
		} catch (err: unknown) {
			mcpServerInstance = undefined;
			updateMcpStatusBar(false, port);
			throw err;
		}
	}

	async function stopMcpServer(): Promise<void> {
		if (!mcpServerInstance) {
			return;
		}
		const config = vscode.workspace.getConfiguration('ollama-code-review');
		const port = config.get<number>('mcp.port', 19840);
		try {
			if (mcpServerInstance.isRunning()) {
				await mcpServerInstance.stop();
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			outputChannel.appendLine(`[MCP] Error during stop: ${msg}`);
			throw err;
		} finally {
			mcpServerInstance = undefined;
			updateMcpStatusBar(false, port);
			outputChannel.appendLine(`[MCP] Server stopped`);
		}
	}

	// Initial activation sync
	const initialMcpEnabled = vscode.workspace.getConfiguration('ollama-code-review').get<boolean>('mcp.enabled', false);
	if (initialMcpEnabled) {
		startMcpServer().catch((err: unknown) => {
			const msg = err instanceof Error ? err.message : String(err);
			outputChannel.appendLine(`[MCP] Failed to start on activation: ${msg}`);
			vscode.window.showErrorMessage(`MCP Server failed to start: ${msg}`);
		});
	} else {
		const port = vscode.workspace.getConfiguration('ollama-code-review').get<number>('mcp.port', 19840);
		updateMcpStatusBar(false, port);
	}

	const toggleMcpServerCommand = vscode.commands.registerCommand(
		'ollama-code-review.toggleMcpServer',
		async () => {
			const config = vscode.workspace.getConfiguration('ollama-code-review');
			const currentState = config.get<boolean>('mcp.enabled', false);
			try {
				// Only update the config; let the onDidChangeConfiguration listener handle the start/stop logic
				await config.update('mcp.enabled', !currentState, vscode.ConfigurationTarget.Global);
				const action = !currentState ? 'started' : 'stopped';
				vscode.window.showInformationMessage(`MCP Server ${action}.`);
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				outputChannel.appendLine(`[MCP] Error toggling setting: ${msg}`);
				vscode.window.showErrorMessage(`Failed to toggle MCP server setting: ${msg}`);
			}
		},
	);
	context.subscriptions.push(toggleMcpServerCommand, mcpStatusBarItem);

	// Watch for MCP configuration changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(async (e) => {
			if (e.affectsConfiguration('ollama-code-review.mcp.enabled')) {
				if (isMcpTransitioning) {
					return;
				}
				isMcpTransitioning = true;
				try {
					const config = vscode.workspace.getConfiguration('ollama-code-review');
					const enabled = config.get<boolean>('mcp.enabled', false);
					const isRunning = !!mcpServerInstance?.isRunning();

					// Idempotency check: only act if setting differs from current state
					if (enabled === isRunning) {
						return;
					}

					if (enabled) {
						await startMcpServer();
					} else {
						await stopMcpServer();
					}
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					outputChannel.appendLine(`[MCP] Error handling configuration change: ${msg}`);
					vscode.window.showErrorMessage(`MCP Server configuration sync failed: ${msg}`);
				} finally {
					isMcpTransitioning = false;
				}
			}
		})
	);

	// Ensure MCP server is stopped on extension deactivation
	context.subscriptions.push(
		new vscode.Disposable(() => {
			if (mcpServerInstance) {
				// stop() is async, but we fire and forget or log on dispose
				mcpServerInstance.stop().catch(err => {
					console.error('[MCP] Failed to stop server on dispose', err);
				});
				mcpServerInstance = undefined;
			}
		})
	);

	// F-029: Toggle Review Annotations command
	const toggleAnnotationsCommand = vscode.commands.registerCommand(
		'ollama-code-review.toggleAnnotations',
		() => {
			const manager = ReviewDecorationsManager.getInstance();
			const visible = manager.toggleAnnotations();
			vscode.window.showInformationMessage(`Review annotations ${visible ? 'shown' : 'hidden'}.`);
		}
	);
	context.subscriptions.push(toggleAnnotationsCommand);

	// F-029: Clear Review Annotations command
	const clearAnnotationsCommand = vscode.commands.registerCommand(
		'ollama-code-review.clearAnnotations',
		() => {
			ReviewDecorationsManager.getInstance().clearAll();
			vscode.window.showInformationMessage('Review annotations cleared.');
		}
	);
	context.subscriptions.push(clearAnnotationsCommand);

	// F-019: Batch / Legacy Code Review — Review File command
	const reviewFileCommand = vscode.commands.registerCommand(
		'ollama-code-review.reviewFile',
		async (uri?: vscode.Uri) => {
			const fileUri = uri ?? vscode.window.activeTextEditor?.document.uri;
			if (!fileUri) {
				vscode.window.showWarningMessage('Open a file or right-click a file in the Explorer to review it.');
				return;
			}
			try {
				const bytes = await vscode.workspace.fs.readFile(fileUri);
				const content = Buffer.from(bytes).toString('utf-8');
				const relativePath = vscode.workspace.asRelativePath(fileUri);
				const maxKb = vscode.workspace.getConfiguration('ollama-code-review').get<number>('batch.maxFileSizeKb', 100);
				if (content.length > maxKb * 1024) {
					vscode.window.showWarningMessage(`File is larger than ${maxKb} KB. Only the first ${maxKb} KB will be reviewed.`);
				}
				const truncated = content.slice(0, maxKb * 1024);
				await runFileReview(truncated, `[File Review: ${relativePath}]`, context);
			} catch (error) {
				handleError(error, 'Failed to review file.');
			}
		}
	);
	context.subscriptions.push(reviewFileCommand);

	// Explain File with Imports — reads file + all local imports, sends to AI for explanation
	const explainFileWithImportsCommand = vscode.commands.registerCommand(
		'ollama-code-review.explainFileWithImports',
		async (uri?: vscode.Uri) => {
			const fileUri = uri ?? vscode.window.activeTextEditor?.document.uri;
			if (!fileUri) {
				vscode.window.showWarningMessage('Open a file or right-click a file in the Explorer to explain it.');
				return;
			}

			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				vscode.window.showWarningMessage('No workspace folder open.');
				return;
			}
			const workspaceRoot = workspaceFolders[0].uri;

			try {
				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: 'Ollama: Explain File with Imports',
					cancellable: true,
				}, async (progress, token) => {
					progress.report({ message: 'Reading file and resolving imports...' });

					// Read the main file
					const mainContent = await readFileContent(fileUri, IMPORT_PER_FILE_LIMIT);
					if (!mainContent) {
						vscode.window.showWarningMessage('Could not read the file.');
						return;
					}

					const relativePath = vscode.workspace.asRelativePath(fileUri);
					const budget = { remaining: IMPORT_TOTAL_BUDGET - mainContent.length };
					const visited = new Set<string>();

					// Use the monorepo resolver from AutoReviewManager if available,
					// otherwise create a fresh one so cross-package imports are followed.
					const existingManager = AutoReviewManager.getInstance();
					const resolver = existingManager?.resolver ?? new MonorepoResolver();

					// Recursively resolve imports (monorepo-aware)
					const importedFiles = await resolveImportsRecursively(
						fileUri, workspaceRoot, visited, 0, budget, resolver,
					);

					if (token.isCancellationRequested) { return; }

					// Build combined content
					let bundled = `=== Main File: ${relativePath} ===\n${mainContent}\n`;
					for (const imp of importedFiles) {
						bundled += `\n=== Imported: ${imp.relativePath} ===\n${imp.content}\n`;
					}

					const fileCount = importedFiles.length;
					progress.report({
						message: `Resolved ${fileCount} import(s). Asking AI for explanation...`,
					});

					// Detect language from file extension
					const ext = path.extname(fileUri.fsPath).slice(1);
					const langMap: Record<string, string> = {
						ts: 'typescript', tsx: 'typescriptreact',
						js: 'javascript', jsx: 'javascriptreact',
						py: 'python', go: 'go', java: 'java',
						php: 'php', rb: 'ruby', cs: 'csharp',
						cpp: 'cpp', c: 'c', rs: 'rust',
					};
					const languageId = langMap[ext] ?? ext;

					const explanation = await getFileWithImportsExplanation(bundled, relativePath, languageId);
					if (token.isCancellationRequested) { return; }

					ExplainCodePanel.createOrShow(bundled, explanation, languageId);
				});
			} catch (error) {
				handleError(error, 'Failed to explain file with imports.');
			}
		}
	);
	context.subscriptions.push(explainFileWithImportsCommand);

	const copyFileWithImportsCommand = vscode.commands.registerCommand(
		'ollama-code-review.copyFileWithImports',
		async (uri?: vscode.Uri) => {
			const fileUri = uri ?? vscode.window.activeTextEditor?.document.uri;
			if (!fileUri) {
				vscode.window.showWarningMessage('Open a file or right-click a file in the Explorer to copy it.');
				return;
			}

			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				vscode.window.showWarningMessage('No workspace folder open.');
				return;
			}
			const workspaceRoot = workspaceFolders[0].uri;

			try {
				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: 'Ollama: Bundling File and Imports...',
					cancellable: true,
				}, async (progress, token) => {
					// 1. Read main file
					const mainContent = await readFileContent(fileUri, IMPORT_PER_FILE_LIMIT);
					if (!mainContent) {
						vscode.window.showWarningMessage('Could not read the file.');
						return;
					}

					const relativePath = vscode.workspace.asRelativePath(fileUri);
					const budget = { remaining: IMPORT_TOTAL_BUDGET - mainContent.length };
					const visited = new Set<string>();

					// Use the monorepo resolver from AutoReviewManager if available,
					// otherwise create a fresh one so cross-package imports are followed.
					const existingManager = AutoReviewManager.getInstance();
					const resolver = existingManager?.resolver ?? new MonorepoResolver();

					// 2. Resolve imports recursively (monorepo-aware)
					const importedFiles = await resolveImportsRecursively(
						fileUri, workspaceRoot, visited, 0, budget, resolver,
					);

					if (token.isCancellationRequested) { return; }

					// 3. Format the bundle
					let bundled = `=== Main File: ${relativePath} ===\n${mainContent}\n`;
					for (const imp of importedFiles) {
						bundled += `\n=== Imported: ${imp.relativePath} ===\n${imp.content}\n`;
					}

					// 4. Copy to Clipboard
					await vscode.env.clipboard.writeText(bundled);

					vscode.window.showInformationMessage(
						`Copied ${relativePath} and ${importedFiles.length} imports to clipboard!`
					);
				});
			} catch (error) {
				handleError(error, 'Failed to copy file with imports.');
			}
		}
	);
	context.subscriptions.push(copyFileWithImportsCommand);

	// Copy Function with Imports — uses smart context BFS call-graph traversal + monorepo resolver
	const copyFunctionWithImportsCommand = vscode.commands.registerCommand(
		'ollama-code-review.copyFunctionWithImports',
		async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showWarningMessage('Open a file and place cursor inside a function to copy it.');
				return;
			}

			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				vscode.window.showWarningMessage('No workspace folder open.');
				return;
			}
			const workspaceRoot = workspaceFolders[0].uri;
			const position = editor.selection.active;

			try {
				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: 'Ollama: Bundling Function and Imports...',
					cancellable: true,
				}, async (progress, token) => {
					progress.report({ message: 'Detecting function and traversing call graph...' });

					if (token.isCancellationRequested) { return; }

					// Use the monorepo resolver from AutoReviewManager if available,
					// otherwise create a fresh one for this operation.
					const existingManager = AutoReviewManager.getInstance();
					const resolver = existingManager?.resolver ?? new MonorepoResolver();

					const result = await buildFunctionContext(
						editor.document.uri,
						position,
						{ resolver, workspaceRoot: workspaceRoot.fsPath },
					);

					if (token.isCancellationRequested) { return; }

					if (!result.target) {
						vscode.window.showWarningMessage('No function found at cursor position. Place your cursor inside a function.');
						return;
					}

					// Format the bundle for clipboard.
					const target = result.target;
					const deps = result.entries.filter(e => e.depth > 0);

					let bundled = `=== Function: ${target.name} (from ${target.relativePath}) ===\n`;

					if (result.imports.length > 0) {
						bundled += `\n// Imports:\n${result.imports.join('\n')}\n\n`;
					}

					bundled += `${target.body}\n`;

					for (const dep of deps) {
						bundled += `\n=== Called: ${dep.name} (from ${dep.relativePath}, depth ${dep.depth}) ===\n${dep.body}\n`;
					}

					if (result.budgetExhausted) {
						bundled += '\n// … additional called functions omitted (budget reached)\n';
					}

					await vscode.env.clipboard.writeText(bundled);

					vscode.window.showInformationMessage(
						`Copied function "${target.name}" and ${deps.length} dependency function(s) to clipboard!`
					);
				});
			} catch (error) {
				handleError(error, 'Failed to copy function with imports.');
			}
		}
	);
	context.subscriptions.push(copyFunctionWithImportsCommand);

	// F-028: Semantic Version Bump Advisor — analyze staged diff and suggest MAJOR/MINOR/PATCH
	const suggestVersionBumpCommand = vscode.commands.registerCommand(
		'ollama-code-review.suggestVersionBump',
		async () => {
			try {
				const gitAPI = getGitAPI();
				if (!gitAPI) { return; }
				const repo = await selectRepository(gitAPI);
				if (!repo) { return; }
				const repoPath = repo.rootUri.fsPath;

				// Collect staged diff, fallback to HEAD diff if nothing staged
				let diff = await runGitCommand(repoPath, ['diff', '--staged']);
				let diffSource = 'staged changes';
				if (!diff || !diff.trim()) {
					diff = await runGitCommand(repoPath, ['diff', 'HEAD']);
					diffSource = 'uncommitted changes (HEAD)';
				}
				if (!diff || !diff.trim()) {
					vscode.window.showInformationMessage(
						'No changes found. Stage or modify files before requesting a version bump suggestion.'
					);
					return;
				}

				// Try to read current version from the nearest package.json in workspace
				let currentVersion = 'unknown';
				const pkgUris = await vscode.workspace.findFiles(
					new vscode.RelativePattern(repo.rootUri, 'package.json'),
					'**/node_modules/**',
					1
				);
				if (pkgUris.length > 0) {
					try {
						const raw = await vscode.workspace.fs.readFile(pkgUris[0]);
						const pkg = JSON.parse(Buffer.from(raw).toString('utf8'));
						if (pkg.version) { currentVersion = pkg.version; }
					} catch { /* ignore parse errors */ }
				}

				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: 'Ollama: Suggest Version Bump',
					cancellable: true,
				}, async (progress, token) => {
					progress.report({ message: `Analyzing ${diffSource}...` });

					const cfg = vscode.workspace.getConfiguration('ollama-code-review');
					const model = getOllamaModel(cfg);
					const endpoint = cfg.get<string>('endpoint', 'http://localhost:11434/api/generate');
					const temperature = cfg.get<number>('temperature', 0);

					const VERSION_BUMP_PROMPT = `You are a semantic versioning expert. Analyze the following git diff and determine the appropriate semantic version bump type based on the Semantic Versioning specification (semver.org).

Current version: ${currentVersion}

Rules:
- MAJOR: Breaking changes (removed APIs, changed function signatures, renamed exports, behavior changes that break existing usage)
- MINOR: New features added in a backwards-compatible manner (new functions, new optional parameters, new exports)
- PATCH: Backwards-compatible bug fixes, performance improvements, documentation, refactoring with no API changes

Respond ONLY in this exact JSON format (no markdown, no explanation outside the JSON):
{
  "bump": "MAJOR" | "MINOR" | "PATCH",
  "suggestedVersion": "<new semver string>",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "reasons": ["<reason 1>", "<reason 2>", ...],
  "breakingChanges": ["<breaking change description>"] or [],
  "newFeatures": ["<feature description>"] or [],
  "bugFixes": ["<fix description>"] or []
}

Git diff to analyze:
---
${diff.slice(0, 12000)}
---`;

					const response = await callAIProvider(VERSION_BUMP_PROMPT, cfg, model, endpoint, temperature);
					if (token.isCancellationRequested) { return; }

					// Parse the JSON response
					let parsed: {
						bump: 'MAJOR' | 'MINOR' | 'PATCH';
						suggestedVersion: string;
						confidence: 'HIGH' | 'MEDIUM' | 'LOW';
						reasons: string[];
						breakingChanges: string[];
						newFeatures: string[];
						bugFixes: string[];
					} | null = null;

					try {
						// Extract JSON from response (model may wrap in markdown fences)
						const jsonMatch = response.match(/\{[\s\S]*\}/);
						if (jsonMatch) {
							parsed = JSON.parse(jsonMatch[0]);
						}
					} catch { /* fall through to raw display */ }

					if (!parsed) {
						// Fallback: show raw response
						vscode.window.showInformationMessage(
							`Version Bump Analysis:\n${response}`,
							{ modal: true }
						);
						return;
					}

					const bumpEmoji = parsed.bump === 'MAJOR' ? '🔴' : parsed.bump === 'MINOR' ? '🟡' : '🟢';
					const confidenceLabel = parsed.confidence === 'HIGH' ? 'High confidence' : parsed.confidence === 'MEDIUM' ? 'Medium confidence' : 'Low confidence';

					// Build summary message
					let summary = `${bumpEmoji} **${parsed.bump}** bump recommended\n`;
					summary += `📦 ${currentVersion} → **${parsed.suggestedVersion}**  (${confidenceLabel})\n\n`;

					if (parsed.breakingChanges.length > 0) {
						summary += `**Breaking Changes:**\n${parsed.breakingChanges.map(b => `• ${b}`).join('\n')}\n\n`;
					}
					if (parsed.newFeatures.length > 0) {
						summary += `**New Features:**\n${parsed.newFeatures.map(f => `• ${f}`).join('\n')}\n\n`;
					}
					if (parsed.bugFixes.length > 0) {
						summary += `**Bug Fixes:**\n${parsed.bugFixes.map(f => `• ${f}`).join('\n')}\n\n`;
					}
					if (parsed.reasons.length > 0) {
						summary += `**Reasons:**\n${parsed.reasons.map(r => `• ${r}`).join('\n')}`;
					}

					outputChannel.appendLine('\n[Version Bump Advisor] ' + '='.repeat(50));
					outputChannel.appendLine(summary.replace(/\*\*/g, ''));
					outputChannel.appendLine('='.repeat(51));
					outputChannel.show(true);

					// Offer to apply the version bump if a package.json was found
					const actions: string[] = ['Copy Version', 'View Details'];
					if (pkgUris.length > 0 && parsed.suggestedVersion && parsed.suggestedVersion !== 'unknown') {
						actions.unshift(`Apply ${parsed.suggestedVersion}`);
					}

					const shortMsg = `${bumpEmoji} ${parsed.bump}: ${currentVersion} → ${parsed.suggestedVersion} (${confidenceLabel})`;
					const choice = await vscode.window.showInformationMessage(shortMsg, ...actions);

					if (choice === `Apply ${parsed.suggestedVersion}`) {
						try {
							const raw = await vscode.workspace.fs.readFile(pkgUris[0]);
							const pkgText = Buffer.from(raw).toString('utf8');
							const updated = pkgText.replace(
								/"version"\s*:\s*"[^"]*"/,
								`"version": "${parsed.suggestedVersion}"`
							);
							await vscode.workspace.fs.writeFile(
								pkgUris[0],
								Buffer.from(updated, 'utf8')
							);
							vscode.window.showInformationMessage(
								`✅ package.json updated to version ${parsed.suggestedVersion}`
							);
						} catch (e) {
							vscode.window.showErrorMessage(`Failed to update package.json: ${e}`);
						}
					} else if (choice === 'Copy Version') {
						await vscode.env.clipboard.writeText(parsed.suggestedVersion);
						vscode.window.showInformationMessage(`Copied ${parsed.suggestedVersion} to clipboard.`);
					} else if (choice === 'View Details') {
						outputChannel.show(true);
					}
				});
			} catch (error) {
				handleError(error, 'Failed to suggest version bump.');
			}
		}
	);
	context.subscriptions.push(suggestVersionBumpCommand);

	// F-019: Batch / Legacy Code Review — Review Folder command
	const reviewFolderCommand = vscode.commands.registerCommand(
		'ollama-code-review.reviewFolder',
		async (uri?: vscode.Uri) => {
			const folderUri = uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
			if (!folderUri) {
				vscode.window.showWarningMessage('Open a folder or right-click a folder in the Explorer to review it.');
				return;
			}
			try {
				const cfg = vscode.workspace.getConfiguration('ollama-code-review');
				const includeGlob = cfg.get<string>('batch.includeGlob', '**/*.{ts,js,tsx,jsx,py,go,java,php,rb,cs,cpp,c,h}');
				const excludeGlob = cfg.get<string>('batch.excludeGlob', '**/node_modules/**,**/dist/**,**/build/**,**/out/**');
				const maxKb = cfg.get<number>('batch.maxFileSizeKb', 100);

				const pattern = new vscode.RelativePattern(folderUri, includeGlob);
				const files = await vscode.workspace.findFiles(pattern, `{${excludeGlob}}`, 50);

				if (files.length === 0) {
					vscode.window.showInformationMessage('No matching files found in the selected folder.');
					return;
				}

				const relativeFolderPath = vscode.workspace.asRelativePath(folderUri);
				let combined = '';
				let totalChars = 0;
				const budgetChars = maxKb * 1024 * 10; // Allow up to 10× maxKb for folder reviews

				for (const file of files) {
					if (totalChars >= budgetChars) { break; }
					try {
						const bytes = await vscode.workspace.fs.readFile(file);
						const content = Buffer.from(bytes).toString('utf-8').slice(0, maxKb * 1024);
						const rel = vscode.workspace.asRelativePath(file);
						combined += `\n--- ${rel} ---\n${content}\n`;
						totalChars += content.length;
					} catch {
						// Skip unreadable files
					}
				}

				if (!combined.trim()) {
					vscode.window.showInformationMessage('Could not read any files in the selected folder.');
					return;
				}

				await runFileReview(combined.trim(), `[Folder Review: ${relativeFolderPath} — ${files.length} file(s)]`, context, 'folder');
			} catch (error) {
				handleError(error, 'Failed to review folder.');
			}
		}
	);
	context.subscriptions.push(reviewFolderCommand);

	// F-019: Batch / Legacy Code Review — Review Selection command
	const reviewSelectionCommand = vscode.commands.registerCommand(
		'ollama-code-review.reviewSelection',
		async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.selection.isEmpty) {
				vscode.window.showWarningMessage('Select some code first, then run "Review Selection".');
				return;
			}
			const selectedText = editor.document.getText(editor.selection);
			const relativePath = vscode.workspace.asRelativePath(editor.document.uri);
			const startLine = editor.selection.start.line + 1;
			const endLine = editor.selection.end.line + 1;
			await runFileReview(
				selectedText,
				`[Selection Review: ${relativePath} lines ${startLine}–${endLine}]`,
				context,
				'selection'
			);
		}
	);
	context.subscriptions.push(reviewSelectionCommand);

	// F-014: Review & Commit command
	const reviewAndCommitCommand = vscode.commands.registerCommand(
		'ollama-code-review.reviewAndCommit',
		async () => {
			try {
				const gitAPI = getGitAPI();
				if (!gitAPI) { return; }
				const repo = await selectRepository(gitAPI);
				if (!repo) {
					vscode.window.showInformationMessage('No Git repository found.');
					return;
				}
				const repoPath = repo.rootUri.fsPath;

				const diffResult = await runGitCommand(repoPath, ['diff', '--staged']);
				if (!diffResult || !diffResult.trim()) {
					vscode.window.showInformationMessage('No staged changes to review and commit.');
					return;
				}

				const guardConfig = getPreCommitGuardConfig();
				const scannerEnabled = vscode.workspace.getConfiguration('ollama-code-review').get<boolean>('secretScanner.enabled', true);

				// F-042: Run Secret Scanner before AI review
				if (scannerEnabled) {
					const secrets = scanDiffForSecrets(diffResult);
					if (secrets.length > 0) {
						outputChannel.appendLine(`[Pre-Commit Guard] Blocked by Secret Scanner — ${secrets.length} secret(s) found.`);
						
						// Map secret findings directly into an assessment-like object to trigger the block modal
						const assessment: SeverityAssessment = {
							pass: false,
							threshold: guardConfig.severityThreshold,
							findings: secrets,
							counts: { critical: secrets.length, high: 0, medium: 0, low: 0, info: 0 },
							blockingFindings: secrets
						};

						const action = await vscode.window.showWarningMessage(
							`Pre-commit review BLOCKED (threshold: ${assessment.threshold}).\nFound ${secrets.length} critical secret(s).`,
							{ modal: true },
							'View Review',
							'Bypass & Commit',
							'Cancel'
						);

						if (action === 'Bypass & Commit') {
							createBypassFile(repoPath);
							await performCommit(repo, repoPath);
						} else if (action === 'View Review') {
							// Show the dummy review panel displaying the secrets
							const dummyReviewText = '## 🔴 Secret Scanner Block\n\n' + secrets.map(s => `- **Critical**: ${s.message}\n  - Location: \`${s.file}:${s.line}\`\n  - Suggestion: ${s.suggestion}`).join('\n\n');
							const metrics = getLastPerformanceMetrics();
							OllamaReviewPanel.createOrShow(dummyReviewText, diffResult, context, metrics, undefined, 'Secret Scan');
						}
						
						return; // Stop the flow
					}
				}

				// Run AI review with progress and timeout
				const review = await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: 'Ollama: Review & Commit',
					cancellable: true
				}, async (progress, token) => {
					// F-008: Gather multi-file context for Review & Commit
					let rcContextBundle: ContextBundle | undefined;
					const rcCtxConfig = getContextGatheringConfig();
					if (rcCtxConfig.enabled) {
						progress.report({ message: 'Gathering related file context…' });
						try {
							rcContextBundle = await gatherContext(diffResult, rcCtxConfig, outputChannel);
						} catch {
							// Non-fatal — continue without context
						}
					}

					progress.report({ message: 'Running AI review on staged changes...' });

					// Race the review against the configured timeout
					const timeoutMs = guardConfig.timeout * 1000;
					const reviewPromise = getOllamaReview(diffResult, context, rcContextBundle);
					const timeoutPromise = new Promise<null>((resolve) =>
						setTimeout(() => resolve(null), timeoutMs)
					);
					const cancellationPromise = new Promise<null>((resolve) => {
						token.onCancellationRequested(() => resolve(null));
					});

					const result = await Promise.race([reviewPromise, timeoutPromise, cancellationPromise]);

					if (token.isCancellationRequested) {
						return undefined; // User cancelled
					}
					if (result === null) {
						vscode.window.showWarningMessage(
							`AI review timed out after ${guardConfig.timeout}s. You can increase the timeout in settings or commit with --no-verify.`
						);
						return undefined;
					}
					return result as ReviewGenerationResult;
				});

				if (!review) { return; } // Cancelled or timed out
				const reviewText = review.reviewText;

				// Assess severity
				const assessment = assessSeverity(reviewText, diffResult, guardConfig.severityThreshold);
				const summary = formatAssessmentSummary(assessment);

				if (assessment.pass) {
					// Below threshold — show review and offer to commit
					outputChannel.appendLine('[Pre-Commit Guard] Review passed threshold check.');

					const action = await vscode.window.showInformationMessage(
						`Pre-commit review passed (threshold: ${assessment.threshold}).\n${summary}`,
						{ modal: true },
						'Commit',
						'View Review',
						'Cancel'
					);

					if (action === 'Commit') {
						await performCommit(repo, repoPath);
					} else if (action === 'View Review') {
						const metrics = getLastPerformanceMetrics();
						OllamaReviewPanel.createOrShow(reviewText, diffResult, context, metrics, review.structuredReview, review.reviewPrompt);
					}
				} else {
					// Above threshold — show findings, offer options
					outputChannel.appendLine(`[Pre-Commit Guard] Review BLOCKED — ${assessment.blockingFindings.length} finding(s) at or above "${assessment.threshold}".`);

					const action = await vscode.window.showWarningMessage(
						`Pre-commit review found issues:\n${summary}`,
						{ modal: true },
						'View Review',
						'Commit Anyway',
						'Cancel'
					);

					if (action === 'Commit Anyway') {
						await performCommit(repo, repoPath);
					} else if (action === 'View Review') {
						const metrics = getLastPerformanceMetrics();
						OllamaReviewPanel.createOrShow(reviewText, diffResult, context, metrics, review.structuredReview, review.reviewPrompt);
					}
				}
			} catch (error) {
				handleError(error, 'Failed to complete Review & Commit.');
			}
		}
	);

	/** Helper: Perform the actual git commit, creating a bypass file if the hook is installed. */
	async function performCommit(repo: any, repoPath: string) {
		const hookActive = isHookInstalled(repoPath);
		try {
			if (hookActive) {
				createBypassFile(repoPath);
			}
			// Use the SCM input box value as the commit message, or prompt for one
			let commitMessage = repo.inputBox?.value?.trim();
			if (!commitMessage) {
				commitMessage = await vscode.window.showInputBox({
					prompt: 'Enter commit message',
					placeHolder: 'feat: describe your changes',
					ignoreFocusOut: true
				});
			}
			if (!commitMessage) {
				removeBypassFile(repoPath);
				return; // User cancelled
			}

			await runGitCommand(repoPath, ['commit', '-m', commitMessage]);
			// Clear the SCM input box after successful commit
			if (repo.inputBox) {
				repo.inputBox.value = '';
			}
			vscode.window.showInformationMessage('Changes committed successfully.');
			outputChannel.appendLine(`[Pre-Commit Guard] Committed: ${commitMessage}`);
		} catch (error) {
			handleError(error, 'Commit failed.');
		} finally {
			if (hookActive) {
				removeBypassFile(repoPath);
			}
		}
	}

	// F-007: Agentic Multi-Step Review command
	const agentReviewCommand = vscode.commands.registerCommand(
		'ollama-code-review.agentReview',
		async () => {
			try {
				const gitAPI = getGitAPI();
				if (!gitAPI) { return; }
				const repo = await selectRepository(gitAPI);
				if (!repo) {
					vscode.window.showInformationMessage('No Git repository found.');
					return;
				}
				const repoPath = repo.rootUri.fsPath;
				const diffResult = await runGitCommand(repoPath, ['diff', '--staged']);

				if (!diffResult || !diffResult.trim()) {
					vscode.window.showInformationMessage('No staged changes found for agentic review.');
					return;
				}

				// Apply diff filtering
				const filterConfig = await getDiffFilterConfigWithYaml(outputChannel);
				const filterResult = filterDiff(diffResult, filterConfig);
				const filteredDiff = filterResult.filteredDiff;

				if (!filteredDiff || !filteredDiff.trim()) {
					vscode.window.showInformationMessage('All changes were filtered out. No code to review.');
					return;
				}

				const filterSummary = getFilterSummary(filterResult.stats);
				if (filterSummary) {
					outputChannel.appendLine(`\n--- Diff Filter (Agent) ---`);
					outputChannel.appendLine(filterSummary);
				}

				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: 'Ollama: Agentic Review',
					cancellable: true
				}, async (progress, token) => {
					// Build profile + skill context strings
					let profileCtx = '';
					const profile = getActiveProfile(context);
					profileCtx = buildProfilePromptContext(profile);

					let skillCtx = '';
					const selectedSkills = context.globalState.get<any[]>('selectedSkills', []);
					if (selectedSkills && selectedSkills.length > 0) {
						const skillContents = selectedSkills.map((skill: any, idx: number) =>
							`### Skill ${idx + 1}: ${skill.name}\n${skill.content}`
						).join('\n\n');
						skillCtx = `\n\nAdditional Review Guidelines (${selectedSkills.length} skill(s) applied):\n${skillContents}\n`;
					}

					// Build the AI caller that routes through the existing provider system
					const callAI = async (prompt: string): Promise<string> => {
						const cfg = vscode.workspace.getConfiguration('ollama-code-review');
						const model = getOllamaModel(cfg);
						const endpoint = cfg.get<string>('endpoint', 'http://localhost:11434/api/generate');
						const temperature = cfg.get<number>('temperature', 0);
						return callAIProvider(prompt, cfg, model, endpoint, temperature);
					};

					const reportProgressFn = (message: string) => {
						progress.report({ message });
					};

					const result = await runAgentReview(
						filteredDiff,
						context,
						outputChannel,
						callAI,
						reportProgressFn,
						token,
						profileCtx,
						skillCtx
					);

					// Capture metrics from last AI call
					const metrics = getLastPerformanceMetrics();
					const config = vscode.workspace.getConfiguration('ollama-code-review');

					if (metrics && metrics.provider === 'ollama') {
						const activeModel = await checkActiveModels(config);
						if (activeModel) { metrics.activeModel = activeModel; }
					}
					if (metrics) {
						metrics.activeProfile = getActiveProfileName(context);
					}

					// F-016: Score
					const findingCounts = parseFindingCounts(result.review);
					const scoreResult = computeScore(findingCounts);
					if (extensionGlobalStoragePath) {
						const store = ReviewScoreStore.getInstance(extensionGlobalStoragePath);
						const repoName = repo?.rootUri
							? vscode.workspace.asRelativePath(repo.rootUri)
							: 'unknown';
						let branch = 'unknown';
						try { branch = repo?.state?.HEAD?.name ?? 'unknown'; } catch { /* ignore */ }
						const scoreEntry: ReviewScore = {
							id: Date.now().toString(),
							timestamp: new Date().toISOString(),
							repo: repoName,
							branch,
							model: metrics?.model ?? getOllamaModel(config),
							profile: getActiveProfileName(context) ?? 'general',
							label: `[Agent] ${result.stepsCompleted}/5 steps, ${result.durationMs}ms`,
							...scoreResult,
							findingCounts,
							// F-011: Analytics fields
							durationMs: result.durationMs,
							reviewType: 'agent',
							filesReviewed: extractFilesFromDiff(filteredDiff),
							categories: parseIssueCategories(result.review),
						};
						store.addScore(scoreEntry);
					}
					showScoreStatusBar(scoreResult.score);

					// F-018: Notifications
					const notifPayload: NotificationPayload = {
						reviewText: result.review,
						model: metrics?.model ?? getOllamaModel(config),
						profile: getActiveProfileName(context) ?? 'general',
						score: scoreResult.score,
						findingCounts,
					};
					sendNotifications(notifPayload, outputChannel).catch(() => {});

					progress.report({ message: 'Displaying review...' });
					OllamaReviewPanel.createOrShow(result.review, filteredDiff, context, metrics);
				});
			} catch (error) {
				handleError(error, 'Agentic review failed.');
			}
		}
	);

	// F-020: Generate Architecture Diagram (Mermaid) command
	const generateDiagramCommand = vscode.commands.registerCommand(
		'ollama-code-review.generateDiagram',
		async () => {
			// Get the current review content if available, otherwise use staged diff
			let codeContent = '';
			let label = '';

			if (OllamaReviewPanel.currentPanel) {
				codeContent = OllamaReviewPanel.currentPanel.getOriginalDiff();
				label = 'current review';
			}

			if (!codeContent) {
				// Fall back to staged diff
				const gitAPI = getGitAPI();
				if (gitAPI) {
					const repo = await selectRepository(gitAPI);
					if (repo) {
						const repoPath = repo.rootUri.fsPath;
						codeContent = await runGitCommand(repoPath, ['diff', '--staged']);
						label = 'staged changes';
					}
				}
			}

			if (!codeContent || !codeContent.trim()) {
				vscode.window.showInformationMessage('No code available for diagram generation. Open a review or stage some changes.');
				return;
			}

			try {
				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: 'Ollama: Generating diagram…',
					cancellable: true
				}, async (progress, token) => {
					progress.report({ message: `Generating Mermaid diagram from ${label}…` });

					const callAI = async (prompt: string): Promise<string> => {
						const cfg = vscode.workspace.getConfiguration('ollama-code-review');
						const model = getOllamaModel(cfg);
						const endpoint = cfg.get<string>('endpoint', 'http://localhost:11434/api/generate');
						const temperature = cfg.get<number>('temperature', 0.3);
						return callAIProvider(prompt, cfg, model, endpoint, temperature);
					};

					const result = await generateMermaidDiagram(codeContent, callAI);

					if (token.isCancellationRequested) { return; }

					if (!result.mermaidCode) {
						vscode.window.showWarningMessage('Could not generate a valid Mermaid diagram from the provided code.');
						return;
					}

					// Show the diagram in the review panel
					const diagramMarkdown = `## Architecture Diagram\n\n${result.diagramType ? `**Type:** ${result.diagramType}\n\n` : ''}\`\`\`mermaid\n${result.mermaidCode}\n\`\`\`\n\n<div class="mermaid">\n${result.mermaidCode}\n</div>\n\n---\n\n### Raw Mermaid Source\n\n\`\`\`\n${result.mermaidCode}\n\`\`\``;

					const metrics = getLastPerformanceMetrics();
					OllamaReviewPanel.createOrShow(diagramMarkdown, codeContent, context, metrics);
				});
			} catch (error) {
				handleError(error, 'Failed to generate diagram.');
			}
		}
	);

	// F-030: Multi-Model Review Comparison — run the same review across multiple models in parallel
	const compareModelsCommand = vscode.commands.registerCommand(
		'ollama-code-review.compareModels',
		async () => {
			try {
				const gitAPI = getGitAPI();
				if (!gitAPI) { return; }
				const repo = await selectRepository(gitAPI);
				if (!repo) {
					vscode.window.showInformationMessage('No Git repository found.');
					return;
				}
				const repoPath = repo.rootUri.fsPath;
				const diffResult = await runGitCommand(repoPath, ['diff', '--staged']);

				if (!diffResult || !diffResult.trim()) {
					vscode.window.showInformationMessage('No staged changes found. Stage some changes first.');
					return;
				}

				// Apply diff filtering
				const filterConfig = await getDiffFilterConfigWithYaml(outputChannel);
				const filterResult = filterDiff(diffResult, filterConfig);
				const filteredDiff = filterResult.filteredDiff;

				if (!filteredDiff || !filteredDiff.trim()) {
					vscode.window.showInformationMessage('All changes were filtered out. No code to review.');
					return;
				}

				// Build the list of available models for the QuickPick
				const config = vscode.workspace.getConfiguration('ollama-code-review');
				const allModels = [
					...V0_MODELS,
					{ label: 'kimi-k2.5:cloud', description: 'Kimi cloud model' },
					{ label: 'qwen3-coder:480b-cloud', description: 'Cloud coding model' },
					{ label: 'glm-4.7:cloud', description: 'GLM cloud model' },
					{ label: 'glm-4.7-flash', description: 'GLM 4.7 Flash (Z.AI)' },
					{ label: 'gemini-2.5-flash', description: 'Gemini 2.5 Flash (Google AI)' },
					{ label: 'gemini-2.5-pro', description: 'Gemini 2.5 Pro (Google AI)' },
					{ label: 'mistral-large-latest', description: 'Mistral Large (Mistral AI)' },
					{ label: 'mistral-small-latest', description: 'Mistral Small (Mistral AI)' },
					{ label: 'codestral-latest', description: 'Codestral (Mistral AI)' },
					{ label: 'MiniMax-M2.5', description: 'MiniMax M2.5' },
					{ label: 'claude-sonnet-4-20250514', description: 'Claude Sonnet 4 (Anthropic)' },
					{ label: 'claude-opus-4-20250514', description: 'Claude Opus 4 (Anthropic)' },
					{ label: 'claude-3-7-sonnet-20250219', description: 'Claude 3.7 Sonnet (Anthropic)' },
				];

				// Also try to fetch local Ollama models
				try {
					const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
					const baseUrl = endpoint.replace(/\/api\/generate\/?$/, '').replace(/\/$/, '');
					const controller = new AbortController();
					const timeout = setTimeout(() => controller.abort(), 3000);
					const resp = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
					clearTimeout(timeout);
					if (resp.ok) {
						const data = await resp.json() as { models: Array<{ name: string; details?: { parameter_size?: string } }> };
						for (const m of data.models) {
							allModels.push({ label: m.name, description: `Local Ollama${m.details?.parameter_size ? ' • ' + m.details.parameter_size : ''}` });
						}
					}
				} catch { /* Ollama not running — skip local models */ }

				const selected = await vscode.window.showQuickPick(
					allModels.map(m => ({ ...m, picked: false })),
					{
						placeHolder: 'Select 2-4 models to compare (use checkboxes)',
						canPickMany: true,
					},
				);

				if (!selected || selected.length < 2) {
					vscode.window.showInformationMessage('Please select at least 2 models to compare.');
					return;
				}

				if (selected.length > 4) {
					vscode.window.showInformationMessage('Please select at most 4 models.');
					return;
				}

				const modelNames = selected.map(s => s.label);
				outputChannel.appendLine(`\n[Compare Models] Starting comparison with: ${modelNames.join(', ')}`);

				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: 'Comparing models...',
					cancellable: true,
				}, async (progress, token) => {
					// Build the review prompt (same as getOllamaReview but without calling provider)
					const frameworksList = (await getEffectiveFrameworks(outputChannel)).join(', ');
					let skillContext = '';
					const selectedSkills = context.globalState.get<any[]>('selectedSkills', []);
					if (selectedSkills && selectedSkills.length > 0) {
						const skillContents = selectedSkills.map((skill: any, idx: number) =>
							`### Skill ${idx + 1}: ${skill.name}\n${skill.content}`
						).join('\n\n');
						skillContext = `\n\nAdditional Review Guidelines (${selectedSkills.length} skill(s) applied):\n${skillContents}\n`;
					}
					let profileCtx = '';
					const profile = getActiveProfile(context);
					profileCtx = buildProfilePromptContext(profile);

					const promptTemplate = await getEffectiveReviewPrompt(DEFAULT_REVIEW_PROMPT, outputChannel);
					const variables: Record<string, string> = {
						code: filteredDiff,
						frameworks: frameworksList,
						skills: skillContext,
						profile: profileCtx,
					};
					let prompt = resolvePrompt(promptTemplate, variables);
					if (skillContext && !promptTemplate.includes('${skills}')) { prompt += '\n' + skillContext; }
					if (profileCtx && !promptTemplate.includes('${profile}')) { prompt += '\n' + profileCtx; }

					// Run all models in parallel
					const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
					const temperature = config.get<number>('temperature', 0);

					const entries: ModelComparisonEntry[] = await Promise.all(
						modelNames.map(async (model) => {
							if (token.isCancellationRequested) {
								return {
									model,
									provider: providerRegistry.resolve(model).name,
									review: '',
									durationMs: 0,
									score: 0,
									findingCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
									error: 'Cancelled',
								};
							}

							progress.report({ message: `Reviewing with ${model}...` });
							const start = Date.now();
							try {
								const provider = providerRegistry.resolve(model);
								const review = await provider.generate(prompt, {
									config,
									model,
									endpoint,
									temperature,
								}, { captureMetrics: false });

								const dur = Date.now() - start;
								const counts = parseFindingCounts(review);
								const scoreResult = computeScore(counts);

								outputChannel.appendLine(`[Compare Models] ${model} completed in ${dur}ms — score ${scoreResult.score}/100`);

								return {
									model,
									provider: provider.name,
									review,
									durationMs: dur,
									score: scoreResult.score,
									findingCounts: counts,
								};
							} catch (err: any) {
								const dur = Date.now() - start;
								const errMsg = err?.message || String(err);
								outputChannel.appendLine(`[Compare Models] ${model} failed: ${errMsg}`);
								return {
									model,
									provider: providerRegistry.resolve(model).name,
									review: '',
									durationMs: dur,
									score: 0,
									findingCounts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
									error: errMsg,
								};
							}
						}),
					);

					const comparisonResult: ComparisonResult = {
						diff: filteredDiff,
						entries,
						timestamp: new Date().toLocaleString(),
						commonFindings: [],
					};

					const successfulEntries = entries.filter(entry => !entry.error && entry.review.trim());
					if (successfulEntries.length > 0) {
						const bestEntry = successfulEntries.reduce((best, current) =>
							current.score > best.score ? current : best
						);
						if (extensionGlobalStoragePath) {
							const bestScoreResult = computeScore(bestEntry.findingCounts);
							const store = ReviewScoreStore.getInstance(extensionGlobalStoragePath);
							const repoName = repo.rootUri
								? vscode.workspace.asRelativePath(repo.rootUri)
								: 'unknown';
							let branch = 'unknown';
							try { branch = repo.state.HEAD?.name ?? 'unknown'; } catch { /* ignore */ }
							const scoreEntry: ReviewScore = {
								id: Date.now().toString(),
								timestamp: new Date().toISOString(),
								repo: repoName,
								branch,
								model: bestEntry.model,
								profile: getActiveProfileName(context) ?? 'general',
								label: `[Compare Models] Best of ${successfulEntries.length}: ${bestEntry.model}`,
								...bestScoreResult,
								findingCounts: bestEntry.findingCounts,
								durationMs: bestEntry.durationMs,
								reviewType: 'staged',
								filesReviewed: extractFilesFromDiff(filteredDiff),
								categories: parseIssueCategories(bestEntry.review),
							};
							store.addScore(scoreEntry);
						}
						showScoreStatusBar(bestEntry.score);
					}

					ComparisonPanel.createOrShow(comparisonResult);
					outputChannel.appendLine(`[Compare Models] Comparison complete. ${entries.filter(e => !e.error).length}/${entries.length} succeeded.`);
					});
			} catch (error) {
				handleError(error, 'Failed to compare models.');
			}
		}
	);

	context.subscriptions.push(
		reviewStagedChangesCommand,
		scanSecretsCommand,
		reviewCommitRangeCommand,
		reviewChangesBetweenTwoBranchesCommand,
		generateCommitMessageCommand,
		suggestRefactoringCommand,
		reviewCommitCommand,
		reviewGitHubPRCommand,
		postReviewToPRCommand,
		reviewGitLabMRCommand,
		postReviewToMRCommand,
		reviewBitbucketPRCommand,
		postReviewToBitbucketPRCommand,
		togglePreCommitGuardCommand,
		reviewAndCommitCommand,
		guardStatusBarItem,
		agentReviewCommand,
		generateDiagramCommand,
		indexCodebaseCommand,
		clearRagIndexCommand,
		suggestVersionBumpCommand,
		compareModelsCommand,
	);
}

function getGitAPI() {
	const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
	if (!gitExtension) {
		vscode.window.showErrorMessage('Git extension not found. Please ensure it is enabled.');
		return undefined;
	}
	return gitExtension.getAPI(1);
}

function renderSecretScannerMarkdown(secrets: SecretFinding[], title = '## 🔴 Secret Scanner Findings'): string {
	return `${title}\n\n` + secrets.map((secret) => {
		const suggestion = secret.suggestion ? `\n  - Suggestion: ${secret.suggestion}` : '';
		return `- **Critical**: ${secret.message}\n  - Location: \`${secret.file}:${secret.line}\`${suggestion}`;
	}).join('\n\n') + '\n\n---\n\n';
}

function mergeSecretFindingsIntoReview(
	structuredReview: ValidatedStructuredReviewResult | undefined,
	reviewText: string,
	secretFindings: SecretFinding[],
): { combinedReviewText: string; structuredReview: ValidatedStructuredReviewResult | undefined } {
	if (secretFindings.length === 0) {
		return { combinedReviewText: reviewText, structuredReview };
	}

	const baseReview = structuredReview ?? {
			schemaVersion: STRUCTURED_REVIEW_SCHEMA_VERSION,
			summary: 'Secret Scanner Results',
			findings: [],
		} satisfies ValidatedStructuredReviewResult;

	const secretsStructured = toStructuredFindings(secretFindings);
	const mergedReview: ValidatedStructuredReviewResult = {
		...baseReview,
		findings: [...secretsStructured, ...baseReview.findings],
	};

	const secretsMarkdown = renderSecretScannerMarkdown(secretFindings);
	return { combinedReviewText: secretsMarkdown + reviewText, structuredReview: mergedReview };
}

async function runReview(
	diff: string,
	context: vscode.ExtensionContext,
	reviewType: import('../reviewScore').ReviewType = 'staged',
	options: RunReviewOptions = {},
) {
	if (!diff || !diff.trim()) {
		vscode.window.showInformationMessage('No code changes found to review in the selected range.');
		return;
	}

	const reviewStartTime = Date.now();

	// Apply diff filtering (config hierarchy: defaults → settings → .ollama-review.yaml)
	const filterConfig = await getDiffFilterConfigWithYaml(outputChannel);
	const filterResult = filterDiff(diff, filterConfig);
	const filteredDiff = filterResult.filteredDiff;

	if (!filteredDiff || !filteredDiff.trim()) {
		vscode.window.showInformationMessage('All changes were filtered out (lock files, build outputs, etc.). No code to review.');
		return;
	}

	// Show filter summary if files were filtered
	const filterSummary = getFilterSummary(filterResult.stats);
	if (filterSummary) {
		outputChannel.appendLine(`\n--- Diff Filter ---`);
		outputChannel.appendLine(filterSummary);
		outputChannel.appendLine(`Reviewing ${filterResult.stats.includedFiles} of ${filterResult.stats.totalFiles} files`);
	}

	// F-042: Run Secret Scanner on the filtered diff
	const scannerEnabled = vscode.workspace.getConfiguration('ollama-code-review').get<boolean>('secretScanner.enabled', true);
	let secretFindings: SecretFinding[] = [];
	if (scannerEnabled) {
		secretFindings = scanDiffForSecrets(filteredDiff);
		if (secretFindings.length > 0) {
			outputChannel.appendLine(`[Secret Scanner] Found ${secretFindings.length} hardcoded secret(s) in the staged diff.`);
		}
	}

	// F-022: Determine whether streaming is enabled and supported for the active model
	const streamingConfig = vscode.workspace.getConfiguration('ollama-code-review');
	const streamingEnabled = streamingConfig.get<boolean>('streaming.enabled', true);
	let activeModel = getOllamaModel(streamingConfig);

	// F-037: Auto-select best model if enabled
	if (streamingConfig.get<boolean>('autoSelectModel', false)) {
		try {
			const languages = extractLanguagesFromDiff(filteredDiff);
			const reviewTypeToTask: Record<string, import('../modelAdvisor').TaskType> = {
				staged: 'review', commit: 'review', 'commit-range': 'review', 'branch-compare': 'review',
				pr: 'review', file: 'file-review', folder: 'file-review', selection: 'file-review', agent: 'agent-review',
			};
			const advisorInput: ModelAdvisorInput = {
				taskType: reviewTypeToTask[reviewType] ?? 'review',
				languages,
				contentLength: filteredDiff.length,
				activeProfile: getActiveProfileName(context) ?? undefined,
			};
			const advice = await getModelRecommendation(advisorInput, streamingConfig);
			if (advice.recommended.modelId !== activeModel) {
				outputChannel.appendLine(`[Model Advisor] Auto-selected: ${advice.recommended.modelId} (${advice.recommended.reason}, score ${Math.round(advice.recommended.score * 100)}%)`);
				await streamingConfig.update('model', advice.recommended.modelId, vscode.ConfigurationTarget.Global);
				activeModel = advice.recommended.modelId;
				vscode.window.setStatusBarMessage(`⭐ Auto-selected model: ${activeModel}`, 5000);
			}
		} catch (err) {
			outputChannel.appendLine(`[Model Advisor] Auto-select failed, using current model: ${err}`);
		}
	}
	const structuredReviewMode = true;
	const supportsStreaming = !structuredReviewMode && streamingEnabled && providerRegistry.resolve(activeModel).supportsStreaming();

	// Gather context (always, regardless of streaming)
	let contextBundle: ContextBundle | undefined;
	const ctxConfig = getContextGatheringConfig();
	if (ctxConfig.enabled) {
		try {
			contextBundle = await gatherContext(filteredDiff, ctxConfig, outputChannel);
		} catch (err) {
			outputChannel.appendLine(`[Context Gathering] Error: ${err}`);
		}
	}

	// MCP Mode: Copy prompt only (F-029)
	const mcpEnabled = options.copyPromptOnly ?? vscode.workspace.getConfiguration('ollama-code-review').get<boolean>('mcp.enabled', false);

	if (mcpEnabled) {
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "Ollama Code Review",
			cancellable: false
		}, async (progress) => {
			progress.report({ message: 'Building review prompt for MCP...' });
			const prompt = await buildReviewPrompt(filteredDiff, context, contextBundle, options.promptMode);
			await vscode.env.clipboard.writeText(prompt);
			vscode.window.setStatusBarMessage('$(clippy) Review prompt copied to clipboard for MCP use', 5000);
			outputChannel.appendLine(`[Review] MCP mode enabled for ${reviewType}. Prompt copied to clipboard instead of sending to an LLM.`);
		});

		vscode.window.showInformationMessage(
			`MCP is enabled, so the ${reviewType.replace('-', ' ')} review prompt was copied to your clipboard instead of being sent to an LLM.`
		);
		return;
	}

	if (supportsStreaming) {
		// F-022: Streaming path — open panel first, stream chunks in real-time
		const reviewPanel = OllamaReviewPanel.startStreaming(filteredDiff, context);

		try {
			let injectedSecrets = false;
			const reviewResult = await getOllamaReview(filteredDiff, context, contextBundle, (chunk) => {
				if (!injectedSecrets && secretFindings.length > 0) {
					reviewPanel.pushChunk(renderSecretScannerMarkdown(secretFindings));
					injectedSecrets = true;
				}
				reviewPanel.pushChunk(chunk);
			});

			const merged = mergeSecretFindingsIntoReview(reviewResult.structuredReview, reviewResult.reviewText, secretFindings);
			const review = merged.combinedReviewText;
			const structuredReview = merged.structuredReview ?? reviewResult.structuredReview;

			const metrics = getLastPerformanceMetrics();
			const cfg = vscode.workspace.getConfiguration('ollama-code-review');
			if (metrics && metrics.provider === 'ollama') {
				const activeModelInfo = await checkActiveModels(cfg);
				if (activeModelInfo) { metrics.activeModel = activeModelInfo; }
			}
			if (metrics) { metrics.activeProfile = getActiveProfileName(context); }

			reviewPanel.finalizeStream(metrics);

			// F-016: Score
			const findingCounts = parseFindingCounts(review);
			const scoreResult = computeScore(findingCounts);
			if (extensionGlobalStoragePath) {
				const store = ReviewScoreStore.getInstance(extensionGlobalStoragePath);
				const gitAPI = getGitAPI();
				const repo = gitAPI?.repositories?.[0];
				const repoName = repo?.rootUri ? vscode.workspace.asRelativePath(repo.rootUri) : 'unknown';
				let branch = 'unknown';
				try { branch = repo?.state?.HEAD?.name ?? 'unknown'; } catch { /* ignore */ }
				const scoreEntry: ReviewScore = {
					id: Date.now().toString(),
					timestamp: new Date().toISOString(),
					repo: repoName,
					branch,
					model: metrics?.model ?? getOllamaModel(cfg),
					profile: getActiveProfileName(context) ?? 'general',
					...scoreResult,
					findingCounts,
					durationMs: Date.now() - reviewStartTime,
					reviewType,
					filesReviewed: extractFilesFromDiff(filteredDiff),
					categories: parseIssueCategories(review),
				};
				store.addScore(scoreEntry);
				outputChannel.appendLine(`[Score] Quality score: ${scoreResult.score}/100 (${findingCounts.critical}C ${findingCounts.high}H ${findingCounts.medium}M ${findingCounts.low}L)`);
			}
			showScoreStatusBar(scoreResult.score);

			// F-029: Apply inline annotations to editors
			try {
				const annotCfg = getAnnotationsConfig();
				if (annotCfg.enabled) {
					ReviewDecorationsManager.getInstance().applyFromReview(review, filteredDiff);
				}
			} catch (err) {
				outputChannel.appendLine(`[Annotations] Error: ${err}`);
			}

			// F-031: Update Findings Explorer tree view
			try {
				if (findingsTreeProvider && (structuredReview?.findings || secretFindings.length > 0)) {
					findingsTreeProvider.setFindings(review, filteredDiff);
					void vscode.commands.executeCommand('setContext', 'ollama-code-review.hasFindings', findingsTreeProvider.count > 0)
						.then(undefined, (err: unknown) => {
							outputChannel.appendLine(`[FindingsExplorer] Failed to set context: ${String(err)}`);
						});
				}
			} catch (err) {
				outputChannel.appendLine(`[FindingsExplorer] Error: ${err}`);
			}

			// F-018: Notifications
			{
				const notifPayload: NotificationPayload = {
					reviewText: review,
					model: metrics?.model ?? getOllamaModel(cfg),
					profile: getActiveProfileName(context) ?? 'general',
					score: scoreResult.score,
					findingCounts,
				};
				try {
					const gitAPI = getGitAPI();
					const repo = gitAPI?.repositories?.[0];
					notifPayload.branch = repo?.state?.HEAD?.name ?? undefined;
					notifPayload.repoName = repo?.rootUri ? vscode.workspace.asRelativePath(repo.rootUri) : undefined;
				} catch { /* ignore */ }
				sendNotifications(notifPayload, outputChannel).catch(() => { /* already logged */ });
			}
		} catch (error) {
			reviewPanel.finalizeStream(null);
			throw error;
		}
		return;
	}

	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: "Ollama Code Review",
		cancellable: false
	}, async (progress) => {
		progress.report({ message: `Asking AI for a structured review (${filterResult.stats.includedFiles} files)...` });
		const reviewResult = await getOllamaReview(filteredDiff, context, contextBundle);
		const merged = mergeSecretFindingsIntoReview(reviewResult.structuredReview, reviewResult.reviewText, secretFindings);
		const review = merged.combinedReviewText;
		const structuredReview = merged.structuredReview ?? reviewResult.structuredReview;

		// Get performance metrics and check for active model
		const metrics = getLastPerformanceMetrics();
		const config = vscode.workspace.getConfiguration('ollama-code-review');

		// Check active models for Ollama provider
		if (metrics && metrics.provider === 'ollama') {
			const activeModel = await checkActiveModels(config);
			if (activeModel) {
				metrics.activeModel = activeModel;
			}
		}

		// Attach active profile to metrics for display
		if (metrics) {
			metrics.activeProfile = getActiveProfileName(context);
		}

		// F-016: Compute quality score and persist to history
		const findingCounts = parseFindingCounts(review);
		const scoreResult = computeScore(findingCounts);
		if (extensionGlobalStoragePath) {
			const store = ReviewScoreStore.getInstance(extensionGlobalStoragePath);
			const gitAPI = getGitAPI();
			const repo = gitAPI?.repositories?.[0];
			const repoName = repo?.rootUri
				? vscode.workspace.asRelativePath(repo.rootUri)
				: 'unknown';
			let branch = 'unknown';
			try { branch = repo?.state?.HEAD?.name ?? 'unknown'; } catch { /* ignore */ }
			const scoreEntry: ReviewScore = {
				id: Date.now().toString(),
				timestamp: new Date().toISOString(),
				repo: repoName,
				branch,
				model: metrics?.model ?? getOllamaModel(vscode.workspace.getConfiguration('ollama-code-review')),
				profile: getActiveProfileName(context) ?? 'general',
				...scoreResult,
				findingCounts,
				// F-011: Analytics fields
				durationMs: Date.now() - reviewStartTime,
				reviewType,
				filesReviewed: extractFilesFromDiff(filteredDiff),
				categories: parseIssueCategories(review),
			};
			store.addScore(scoreEntry);
			outputChannel.appendLine(`[Score] Quality score: ${scoreResult.score}/100 (${findingCounts.critical}C ${findingCounts.high}H ${findingCounts.medium}M ${findingCounts.low}L)`);
		}

		// F-016: Update score status bar
		showScoreStatusBar(scoreResult.score);

		// F-029: Apply inline annotations to editors
		try {
			const annotCfg = getAnnotationsConfig();
			if (annotCfg.enabled) {
				ReviewDecorationsManager.getInstance().applyFromReview(review, filteredDiff);
			}
		} catch (err) {
			outputChannel.appendLine(`[Annotations] Error: ${err}`);
		}

		// F-031: Update Findings Explorer tree view
		try {
			if (findingsTreeProvider && (structuredReview?.findings || secretFindings.length > 0)) {
				findingsTreeProvider.setFindings(review, filteredDiff);
				void vscode.commands.executeCommand('setContext', 'ollama-code-review.hasFindings', findingsTreeProvider.count > 0)
					.then(undefined, (err: unknown) => {
						outputChannel.appendLine(`[FindingsExplorer] Failed to set context: ${String(err)}`);
					});
			}
		} catch (err) {
			outputChannel.appendLine(`[FindingsExplorer] Error: ${err}`);
		}

		// F-018: Send notifications (non-blocking, failures are logged)
		{
			const cfg = vscode.workspace.getConfiguration('ollama-code-review');
			const notifPayload: NotificationPayload = {
				reviewText: review,
				model: metrics?.model ?? getOllamaModel(cfg),
				profile: getActiveProfileName(context) ?? 'general',
				score: scoreResult.score,
				findingCounts,
			};
			// Attempt to get branch for notification label
			try {
				const gitAPI = getGitAPI();
				const repo = gitAPI?.repositories?.[0];
				notifPayload.branch = repo?.state?.HEAD?.name ?? undefined;
				notifPayload.repoName = repo?.rootUri
					? vscode.workspace.asRelativePath(repo.rootUri)
					: undefined;
			} catch { /* ignore */ }
			sendNotifications(notifPayload, outputChannel).catch(() => { /* already logged inside */ });
		}

		progress.report({ message: "Displaying review..." });
		OllamaReviewPanel.createOrShow(review, filteredDiff, context, metrics, structuredReview, reviewResult.reviewPrompt);
	});
}

/**
 * F-019: Run a review on arbitrary file/folder/selection content (no Git diff required).
 *
 * Bypasses diff filtering and uses a simpler file-review prompt so the model
 * knows there is no diff context. Integrates with F-016 scoring and F-018 notifications.
 */
async function runFileReview(content: string, label: string, context: vscode.ExtensionContext, reviewType: import('../reviewScore').ReviewType = 'file') {
	if (!content || !content.trim()) {
		vscode.window.showInformationMessage('No content to review.');
		return;
	}

	const reviewStartTime = Date.now();
	const mcpEnabled = vscode.workspace.getConfiguration('ollama-code-review').get<boolean>('mcp.enabled', false);

	if (mcpEnabled) {
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "Ollama Code Review",
			cancellable: false,
		}, async (progress) => {
			progress.report({ message: `Building review prompt for ${label}...` });
			// Get the raw prompt instead of calling AI
			const prompt = await getOllamaFileReview(content, label, context, true);
			await vscode.env.clipboard.writeText(prompt);
			vscode.window.setStatusBarMessage('$(clippy) Review prompt copied to clipboard for MCP use', 5000);
			outputChannel.appendLine(`[File Review] MCP mode enabled for ${label}. Prompt copied to clipboard.`);
		});

		vscode.window.showInformationMessage(
			`MCP is enabled, so the review prompt for '${label}' was copied to your clipboard instead of being sent to an LLM.`
		);
		return;
	}

	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: "Ollama Code Review",
		cancellable: false,
	}, async (progress) => {
		progress.report({ message: `${label} — asking AI for review…` });

		// Use a file-review flavoured prompt that does not mention git diff format
		const review = await getOllamaFileReview(content, label, context);

		// F-016: Score
		const findingCounts = parseFindingCounts(review);
		const scoreResult = computeScore(findingCounts);
		if (extensionGlobalStoragePath) {
			const store = ReviewScoreStore.getInstance(extensionGlobalStoragePath);
			const scoreEntry: ReviewScore = {
				id: Date.now().toString(),
				timestamp: new Date().toISOString(),
				repo: 'local',
				branch: 'n/a',
				model: getOllamaModel(vscode.workspace.getConfiguration('ollama-code-review')),
				profile: getActiveProfileName(context) ?? 'general',
				label,
				...scoreResult,
				findingCounts,
				// F-011: Analytics fields
				durationMs: Date.now() - reviewStartTime,
				reviewType,
				categories: parseIssueCategories(review),
			};
			store.addScore(scoreEntry);
		}
		showScoreStatusBar(scoreResult.score);

		// F-018: Notifications
		const notifPayload: NotificationPayload = {
			reviewText: review,
			model: getOllamaModel(vscode.workspace.getConfiguration('ollama-code-review')),
			profile: getActiveProfileName(context) ?? 'general',
			score: scoreResult.score,
			findingCounts,
			label,
		};
		sendNotifications(notifPayload, outputChannel).catch(() => { /* already logged inside */ });

		progress.report({ message: "Displaying review..." });
		// Show review panel — pass content as the "diff" so follow-up chat has it as context
		const metrics = getLastPerformanceMetrics();
		OllamaReviewPanel.createOrShow(review, content, context, metrics ?? undefined);
	});
}

/**
 * Build and execute a file-review prompt (no git diff context).
 * Reuses the AI provider routing from getOllamaReview().
 */
async function getOllamaFileReview(content: string, label: string, context?: vscode.ExtensionContext, returnPromptOnly: boolean = false): Promise<string> {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const model = getOllamaModel(config);
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
	const temperature = config.get<number>('temperature', 0);
	const frameworksList = (await getEffectiveFrameworks(outputChannel)).join(', ');

	let skillContext = '';
	if (context) {
		const selectedSkills = context.globalState.get<any[]>('selectedSkills', []);
		if (selectedSkills?.length > 0) {
			const skillContents = selectedSkills.map((skill, i) =>
				`### Skill ${i + 1}: ${skill.name}\n${skill.content}`
			).join('\n\n');
			skillContext = `\n\nAdditional Review Guidelines (${selectedSkills.length} skill(s) applied):\n${skillContents}\n`;
		}
	}

	let profileContext = '';
	if (context) {
		const profile = getActiveProfile(context);
		profileContext = buildProfilePromptContext(profile);
	}

	// F-012: Build knowledge base context for file reviews
	let knowledgeContext = '';
	const fileKbConfig = getKnowledgeBaseConfig();
	if (fileKbConfig.enabled) {
		try {
			const knowledge = await loadKnowledgeBase(outputChannel);
			if (knowledge) {
				knowledgeContext = formatKnowledgeForPrompt(knowledge, fileKbConfig.maxEntries);
			}
		} catch {
			// Non-fatal — continue without knowledge base
		}
	}

	// F-026: Inject rules from .ollama-review/rules/*.md (coexists with F-012)
	let rulesContext = '';
	try {
		rulesContext = await loadRulesDirectory(outputChannel);
	} catch {
		// Non-fatal — continue without rules directory
	}

	// F-032: Build Contentstack schema validation context for file reviews
	let csContext = '';
	const fileCsConfig = getContentstackConfig();
	if (fileCsConfig.enabled) {
		try {
			const schemas = await loadContentstackSchemas(outputChannel);
			if (schemas && schemas.length > 0) {
				const parseResult = parseContentstackAccesses(content, label);
				if (parseResult.accesses.length > 0 || parseResult.contentTypeUids.length > 0) {
					const validation = validateFieldAccesses(parseResult, schemas);
					csContext = buildContentstackPromptSection(validation, parseResult, fileCsConfig);
					outputChannel.appendLine(
						`[Contentstack] File review schema validation: ${validation.stats.totalAccesses} field access(es), `
						+ `${validation.stats.invalidFields} potential mismatch(es).`
					);
				}
			}
		} catch {
			// Non-fatal — continue without Contentstack validation
		}
	}

	const prompt = `You are an expert software engineer and code reviewer with deep knowledge of **${frameworksList}**.
${skillContext}${profileContext}${knowledgeContext}${rulesContext}${csContext}
Review the following code and provide constructive, actionable feedback. This is a direct file review (no git diff context).
${label}

**Review Focus:**
- Potential bugs or logical errors
- Security vulnerabilities
- Performance issues
- Code style and readability
- Maintainability concerns

Use Markdown for formatting. For each finding include a severity badge (🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low) and a concrete suggestion.

If you find no issues, respond with: "I have reviewed the code and found no significant issues."

Code to review:
\`\`\`
${content}
\`\`\``;

	if (returnPromptOnly) {
		return prompt;
	}

	// Copy the full prompt to clipboard so the user can paste it into other LLM chats immediately
	try {
		await vscode.env.clipboard.writeText(prompt);
		vscode.window.setStatusBarMessage('$(clippy) Review prompt copied to clipboard — paste into any LLM chat', 5000);
		outputChannel.appendLine('[File Review] Full prompt (with context) copied to clipboard.');
	} catch (err) {
		outputChannel.appendLine(`[File Review] Failed to copy prompt to clipboard: ${err}`);
	}

	clearPerformanceMetrics();
	const requestContext: ProviderRequestContext = {
		config,
		model,
		endpoint,
		temperature,
	};
	return providerRegistry.resolve(model).generate(prompt, requestContext, { captureMetrics: true });
}

const IMPORT_PER_FILE_LIMIT = 8_000;
const IMPORT_TOTAL_BUDGET = 64_000;
const IMPORT_MAX_DEPTH = 3;

/**
 * Resolve a bare (non-relative) import specifier to a workspace file URI using
 * the {@link MonorepoResolver}.  Handles scoped packages (`@scope/pkg/sub`)
 * and unscoped packages (`pkg/sub`).
 *
 * Resolution order inside the discovered package:
 *   1. `srcPath/<subpath>` with TS extension resolution
 *   2. `rootPath/src/<subpath>` with TS extension resolution
 *   3. `rootPath/<subpath>` with TS extension resolution
 *   4. Package entry point (index file) when no subpath is specified
 */
async function resolveMonorepoImport(
	specifier: string,
	resolver: MonorepoResolver,
	workspaceRoot: string,
): Promise<vscode.Uri | undefined> {
	// Split specifier into package name and optional subpath.
	// Scoped: `@scope/pkg`         → name=`@scope/pkg`, sub=undefined
	// Scoped: `@scope/pkg/utils`   → name=`@scope/pkg`, sub=`utils`
	// Unscoped: `my-lib/foo`       → name=`my-lib`,     sub=`foo`
	let pkgName: string;
	let subpath: string | undefined;

	if (specifier.startsWith('@')) {
		// Scoped package: first two segments are the name.
		const parts = specifier.split('/');
		pkgName = parts.slice(0, 2).join('/');
		subpath = parts.length > 2 ? parts.slice(2).join('/') : undefined;
	} else {
		const slashIdx = specifier.indexOf('/');
		pkgName = slashIdx === -1 ? specifier : specifier.slice(0, slashIdx);
		subpath = slashIdx === -1 ? undefined : specifier.slice(slashIdx + 1);
	}

	const pkg = await resolver.findPackageByName(pkgName, workspaceRoot);
	if (!pkg) { return undefined; }

	const wsRootUri = vscode.Uri.file(workspaceRoot);

	// Try resolving the subpath (or index) inside the package.
	const candidateRoots: string[] = [];
	if (pkg.srcPath) { candidateRoots.push(pkg.srcPath); }
	candidateRoots.push(path.join(pkg.rootPath, 'src'));
	candidateRoots.push(pkg.rootPath);

	const target = subpath ?? 'index';

	for (const root of candidateRoots) {
		const relFromWs = path.relative(workspaceRoot, path.join(root, target));
		const resolved = await resolveImport(relFromWs, '', wsRootUri);
		if (resolved) { return resolved; }
	}

	return undefined;
}

/**
 * Recursively resolve local imports for a file, returning all imported file contents.
 * Skips node_modules, already-visited files, and respects depth and budget limits.
 *
 * When a {@link MonorepoResolver} is provided, bare specifiers (e.g. `@myapp/shared`)
 * that match a local workspace package are also followed.
 */
async function resolveImportsRecursively(
	fileUri: vscode.Uri,
	workspaceRoot: vscode.Uri,
	visited: Set<string>,
	depth: number,
	budget: { remaining: number },
	resolver?: MonorepoResolver,
): Promise<Array<{ relativePath: string; content: string }>> {
	if (visited.has(fileUri.fsPath) || depth > IMPORT_MAX_DEPTH || budget.remaining <= 0) {
		return [];
	}
	visited.add(fileUri.fsPath);

	const content = await readFileContent(fileUri, IMPORT_PER_FILE_LIMIT);
	if (!content) {
		return [];
	}

	const imports = parseImports(content);
	const results: Array<{ relativePath: string; content: string }> = [];
	const relativeSrc = vscode.workspace.asRelativePath(fileUri);

	for (const imp of imports) {
		let resolved: vscode.Uri | undefined;

		if (imp.isRelative || imp.specifier.startsWith('src/')) {
			// Relative or src/-prefixed import — use standard file resolution.
			resolved = await resolveImport(imp.specifier, relativeSrc, workspaceRoot);
		} else if (resolver) {
			// Bare specifier — try monorepo workspace package resolution.
			resolved = await resolveMonorepoImport(
				imp.specifier, resolver, workspaceRoot.fsPath,
			);
		}

		if (!resolved || visited.has(resolved.fsPath)) {
			continue;
		}

		if (budget.remaining <= 0) {
			break;
		}

		const importedContent = await readFileContent(resolved, IMPORT_PER_FILE_LIMIT);
		if (!importedContent) {
			continue;
		}

		const truncated = importedContent.slice(0, Math.min(importedContent.length, budget.remaining));
		budget.remaining -= truncated.length;
		const relPath = vscode.workspace.asRelativePath(resolved);
		results.push({ relativePath: relPath, content: truncated });

		// Recurse into this file's imports
		const nested = await resolveImportsRecursively(resolved, workspaceRoot, visited, depth + 1, budget, resolver);
		results.push(...nested);
	}

	return results;
}

async function buildReviewPrompt(
	diff: string,
	context?: vscode.ExtensionContext,
	contextBundle?: ContextBundle,
	promptMode: import('../reviewPromptBuilder').ReviewPromptMode = 'default',
): Promise<string> {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
	let prompt = await buildSharedReviewPrompt({
		context,
		contextBundle,
		diff,
		outputChannel,
		promptMode,
	});

	const ragConfig = getRagConfig();
	if (ragConfig.enabled && ragVectorStore && ragVectorStore.chunkCount > 0) {
		try {
			if (ragUseOllamaEmbeddings === undefined) {
				ragUseOllamaEmbeddings = await isEmbeddingModelAvailable(ragConfig.embeddingModel, endpoint);
			}

			const changedFiles: string[] = [];
			for (const line of diff.split('\n')) {
				const m = line.match(/^\+\+\+ b\/(.+)$/);
				if (m) { changedFiles.push(m[1]); }
			}

			const ragCtx = await getRagContext(
				diff,
				changedFiles,
				ragVectorStore,
				ragConfig,
				endpoint,
				ragUseOllamaEmbeddings!,
			);
			if (ragCtx.results.length > 0) {
				prompt += buildRagContextSection(ragCtx.results);
				outputChannel.appendLine(`[RAG] ${ragCtx.summary}`);
			}
		} catch (err) {
			outputChannel.appendLine(`[RAG] Error: ${err}`);
		}
	}

	const csConfig = getContentstackConfig();
	if (csConfig.enabled) {
		try {
			const schemas = await loadContentstackSchemas(outputChannel);
			if (schemas && schemas.length > 0) {
				const parseResult = parseContentstackAccesses(diff, 'review-diff');
				if (parseResult.accesses.length > 0 || parseResult.contentTypeUids.length > 0) {
					const validation = validateFieldAccesses(parseResult, schemas);
					const csSection = buildContentstackPromptSection(validation, parseResult, csConfig);
					prompt += csSection;
					outputChannel.appendLine(
						`[Contentstack] Schema validation: ${validation.stats.totalAccesses} field access(es), `
						+ `${validation.stats.invalidFields} potential mismatch(es), `
						+ `${validation.resolvedContentTypes.length} content type(s) resolved.`
					);
				}
			}
		} catch (err) {
			outputChannel.appendLine(`[Contentstack] Error: ${err}`);
		}
	}

	return prompt;
}

async function getOllamaReview(diff: string, context?: vscode.ExtensionContext, contextBundle?: ContextBundle, _onChunk?: (text: string) => void): Promise<ReviewGenerationResult> {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const model = getOllamaModel(config);
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
	const temperature = config.get<number>('temperature', 0);
	const prompt = await buildReviewPrompt(diff, context, contextBundle);

	// Copy the full prompt (with all context) to clipboard so the user can paste it into other LLM chats immediately
	try {
		await vscode.env.clipboard.writeText(prompt);
		vscode.window.setStatusBarMessage('$(clippy) Review prompt copied to clipboard — paste into any LLM chat', 5000);
		outputChannel.appendLine('[Review] Full prompt (with context) copied to clipboard.');
	} catch (err) {
		outputChannel.appendLine(`[Review] Failed to copy prompt to clipboard: ${err}`);
	}

	// Clear previous metrics before the API call
	clearPerformanceMetrics();
	const provider = providerRegistry.resolve(model);
	const requestContext: ProviderRequestContext = {
		config,
		model,
		endpoint,
		temperature,
	};
	const rawResponse = await provider.generate(prompt, requestContext, {
		captureMetrics: true,
		responseFormat: 'structured-review',
	});
	const structuredReview = normalizeReviewResult(rawResponse, diff);
	const reviewText = renderValidatedReviewMarkdown(structuredReview);
	if (_onChunk) {
		_onChunk(reviewText);
	}

	return {
		reviewText,
		rawResponse,
		reviewPrompt: prompt,
		structuredReview,
	};
}

async function getOllamaCommitMessage(diff: string, existingMessage?: string, ticketId?: string): Promise<string | 'PROMPT_COPIED'> {
	const config = vscode.workspace.getConfiguration('ollama-code-review');
	const mcpEnabled = config.get<boolean>('mcp.enabled', false);
	const model = getOllamaModel(config);
	const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
	const temperature = config.get<number>('temperature', 0.2); // Slightly more creative for commit messages

	// Resolve commit prompt using config hierarchy: default → settings → .ollama-review.yaml
	const promptTemplate = await getEffectiveCommitPrompt(DEFAULT_COMMIT_MESSAGE_PROMPT, outputChannel);

	const variables: Record<string, string> = {
		diff: diff,
		draftMessage: existingMessage && existingMessage.trim() ? existingMessage : '(none provided)',
	};

	let prompt = resolvePrompt(promptTemplate, variables);

	// Inject Jira ticket ID formatting rule into the prompt
	if (ticketId) {
		prompt += `\n\n### Jira Ticket Convention:\nThe subject line MUST include the ticket ID in square brackets immediately after the colon and space.\nFormat: <type>(<scope>): [${ticketId}] <short description>\nExample: feat(ui): [${ticketId}] add login button\nThis is mandatory — every commit message must include [${ticketId}] in the subject line.`;
	}

	if (mcpEnabled) {
		await vscode.env.clipboard.writeText(prompt);
		vscode.window.showInformationMessage('Commit message prompt copied to clipboard!');
		return 'PROMPT_COPIED';
	}

	try {
		let message = await providerRegistry.resolve(model).generate(prompt, {
			config,
			model,
			endpoint,
			temperature,
		});

		// Sometimes models add quotes or markdown blocks around the message, so we trim them.
		if (message.startsWith('```') && message.endsWith('```')) {
			message = message.substring(3, message.length - 3).trim();
		}
		if ((message.startsWith('"') && message.endsWith('"')) || (message.startsWith("'") && message.endsWith("'"))) {
			message = message.substring(1, message.length - 1);
		}

		// Ensure the ticket ID is present in the subject line even if the model forgot
		if (ticketId && !message.includes(`[${ticketId}]`)) {
			// Insert after the first ": " (type(scope): ...)
			const colonIdx = message.indexOf(': ');
			if (colonIdx !== -1) {
				message = message.slice(0, colonIdx + 2) + `[${ticketId}] ` + message.slice(colonIdx + 2);
			}
		}

		return message;
	} catch (error) {
		throw error;
	}
}


function handleError(error: unknown, contextMessage: string) {
	let errorMessage = `${contextMessage}\n`;
	if (error && typeof error === 'object' && 'stderr' in error && (error as any).stderr) {
		errorMessage += `Git Error: ${(error as any).stderr}`;
	} else if (axios.isAxiosError(error)) {
		const url = error.config?.url || '';
		const status = error.response?.status;
		const responseData = error.response?.data;

		// Determine which API caused the error based on URL
		if (url.includes('anthropic.com')) {
			errorMessage += `Claude API Error (${status}): ${responseData?.error?.message || error.message}`;
		} else if (url.includes('z.ai') || url.includes('bigmodel.cn')) {
			errorMessage += `GLM API Error (${status}): ${responseData?.error?.message || error.message}`;
		} else if (url.includes('huggingface.co') || url.includes('router.huggingface.co')) {
			const hfError = responseData?.error || responseData?.message || error.message;
			errorMessage += `Hugging Face API Error (${status}): ${hfError}`;
			if (status === 410) {
				errorMessage += '\nThe model may not be available. Try a different model like "Qwen/Qwen2.5-Coder-7B-Instruct" or "mistralai/Mistral-7B-Instruct-v0.3"';
			} else if (status === 503) {
				errorMessage += '\nThe model is loading. Please try again in a few seconds.';
			}
		} else if (url.includes('generativelanguage.googleapis.com')) {
			const geminiError = responseData?.error?.message || error.message;
			errorMessage += `Gemini API Error (${status}): ${geminiError}`;
			if (status === 429) {
				errorMessage += '\nRate limit exceeded. Free tier allows 15 RPM for Flash, 5 RPM for Pro.';
			} else if (status === 503) {
				errorMessage += '\nThe model is loading. Please try again in a few seconds.';
			}
		} else if (url.includes('api.mistral.ai')) {
			const mistralError = responseData?.error?.message || responseData?.message || error.message;
			errorMessage += `Mistral API Error (${status}): ${mistralError}`;
			if (status === 429) {
				errorMessage += '\nRate limit exceeded. Please wait and try again.';
			}
		} else if (url.includes('api.minimax.io')) {
			const minimaxError = responseData?.error?.message || responseData?.message || error.message;
			errorMessage += `MiniMax API Error (${status}): ${minimaxError}`;
			if (status === 429) {
				errorMessage += '\nRate limit exceeded. Please wait and try again.';
			}
		} else if (url.includes('/chat/completions') && !url.includes('localhost:11434')) {
			// OpenAI-compatible provider
			const oaiError = responseData?.error?.message || responseData?.message || error.message;
			errorMessage += `OpenAI-compatible API Error (${status}): ${oaiError}`;
			if (!status || error.code === 'ECONNREFUSED') {
				errorMessage += '\nMake sure your server (LM Studio, vLLM, LocalAI, etc.) is running.';
				errorMessage += '\nCheck the endpoint in Settings > Ollama Code Review > OpenAI Compatible > Endpoint';
			} else if (status === 429) {
				errorMessage += '\nRate limit exceeded. Please wait and try again.';
			}
		} else {
			errorMessage += `Ollama API Error: ${error.message}. Is Ollama running? Check the endpoint in settings.`;
		}
	} else if (error instanceof Error) {
		errorMessage += `${error.message}`;
	} else {
		errorMessage += `An unexpected error occurred: ${String(error)}`;
	}

	vscode.window.showErrorMessage(errorMessage, { modal: true });
	console.error(error);

	outputChannel.appendLine("\n--- ERROR ---");
	outputChannel.appendLine(errorMessage);
	outputChannel.show(true);
}

export function deactivate() {
	// Dispose webview panels
	if (OllamaReviewPanel.currentPanel) {
		OllamaReviewPanel.currentPanel.dispose();
	}
	if (SkillsBrowserPanel.currentPanel) {
		SkillsBrowserPanel.currentPanel.dispose();
	}
	if (ExplainCodePanel.currentPanel) {
		ExplainCodePanel.currentPanel.dispose();
	}
	if (GenerateTestsPanel.currentPanel) {
		GenerateTestsPanel.currentPanel.dispose();
	}
	if (FixPreviewPanel.currentPanel) {
		FixPreviewPanel.currentPanel.dispose();
	}
	if (DocumentationPreviewPanel.currentPanel) {
		DocumentationPreviewPanel.currentPanel.dispose();
	}

	// Stop MCP server if running
	if (mcpServerInstance?.isRunning()) {
		mcpServerInstance.stop().catch(() => {});
		mcpServerInstance = undefined;
	}

	// Dispose skills service (clears in-memory caches)
	if (skillsServiceInstance) {
		skillsServiceInstance.dispose();
		skillsServiceInstance = null;
	}

	// Dispose output channel
	if (outputChannel) {
		outputChannel.dispose();
	}
}
