import * as vscode from 'vscode';
import { clearProjectConfigCache } from '../config/promptLoader';
import { clearKnowledgeCache } from '../knowledge';
import { clearRulesCache } from '../rules/loader';
import { clearSchemaCache } from '../contentstack';
import { type CommandContext } from './commandContext';

function registerCacheWatcher(
	globPattern: string,
	invalidate: () => void,
	outputChannel: vscode.OutputChannel,
	messages: { changed: string; created: string; deleted: string },
): vscode.FileSystemWatcher {
	const watcher = vscode.workspace.createFileSystemWatcher(globPattern);
	watcher.onDidChange(() => {
		invalidate();
		outputChannel.appendLine(messages.changed);
	});
	watcher.onDidCreate(() => {
		invalidate();
		outputChannel.appendLine(messages.created);
	});
	watcher.onDidDelete(() => {
		invalidate();
		outputChannel.appendLine(messages.deleted);
	});
	return watcher;
}

export function registerReloadCommands(commandContext: CommandContext): vscode.Disposable[] {
	const { outputChannel } = commandContext;

	const reloadProjectConfigCommand = vscode.commands.registerCommand(
		'ollama-code-review.reloadProjectConfig',
		() => {
			clearProjectConfigCache();
			vscode.window.showInformationMessage('Ollama Code Review: .ollama-review.yaml config reloaded.');
			outputChannel.appendLine('[Ollama Code Review] Project config cache cleared. Will re-read .ollama-review.yaml on next review.');
		},
	);

	const yamlConfigWatcher = registerCacheWatcher(
		'**/.ollama-review.yaml',
		clearProjectConfigCache,
		outputChannel,
		{
			changed: '[Ollama Code Review] .ollama-review.yaml changed — config cache invalidated.',
			created: '[Ollama Code Review] .ollama-review.yaml created — config cache invalidated.',
			deleted: '[Ollama Code Review] .ollama-review.yaml deleted — config cache invalidated.',
		},
	);

	const reloadKnowledgeBaseCommand = vscode.commands.registerCommand(
		'ollama-code-review.reloadKnowledgeBase',
		() => {
			clearKnowledgeCache();
			vscode.window.showInformationMessage('Ollama Code Review: Knowledge base reloaded.');
			outputChannel.appendLine('[Ollama Code Review] Knowledge base cache cleared. Will re-read .ollama-review-knowledge.yaml on next review.');
		},
	);

	const knowledgeWatcher = registerCacheWatcher(
		'**/.ollama-review-knowledge.yaml',
		clearKnowledgeCache,
		outputChannel,
		{
			changed: '[Ollama Code Review] .ollama-review-knowledge.yaml changed — knowledge cache invalidated.',
			created: '[Ollama Code Review] .ollama-review-knowledge.yaml created — knowledge cache invalidated.',
			deleted: '[Ollama Code Review] .ollama-review-knowledge.yaml deleted — knowledge cache invalidated.',
		},
	);

	const reloadContentstackSchemaCommand = vscode.commands.registerCommand(
		'ollama-code-review.reloadContentstackSchema',
		() => {
			clearSchemaCache();
			vscode.window.showInformationMessage('Ollama Code Review: Contentstack schema cache cleared.');
			outputChannel.appendLine('[Ollama Code Review] Contentstack schema cache cleared. Will re-fetch on next review.');
		},
	);

	const csSchemaWatcher = registerCacheWatcher(
		'**/.contentstack/schema.json',
		clearSchemaCache,
		outputChannel,
		{
			changed: '[Ollama Code Review] Contentstack schema.json changed — schema cache invalidated.',
			created: '[Ollama Code Review] Contentstack schema.json created — schema cache invalidated.',
			deleted: '[Ollama Code Review] Contentstack schema.json deleted — schema cache invalidated.',
		},
	);

	const reloadRulesCommand = vscode.commands.registerCommand(
		'ollama-code-review.reloadRules',
		() => {
			clearRulesCache();
			vscode.window.showInformationMessage('Ollama Code Review: Rules directory reloaded.');
			outputChannel.appendLine('[Ollama Code Review] Rules cache cleared. Will re-read .ollama-review/rules/ on next review.');
		},
	);

	const rulesWatcher = registerCacheWatcher(
		'.ollama-review/rules/*.md',
		clearRulesCache,
		outputChannel,
		{
			changed: '[Ollama Code Review] Rules file changed — rules cache invalidated.',
			created: '[Ollama Code Review] Rules file created — rules cache invalidated.',
			deleted: '[Ollama Code Review] Rules file deleted — rules cache invalidated.',
		},
	);

	return [
		reloadProjectConfigCommand,
		yamlConfigWatcher,
		reloadKnowledgeBaseCommand,
		knowledgeWatcher,
		reloadContentstackSchemaCommand,
		csSchemaWatcher,
		reloadRulesCommand,
		rulesWatcher,
	];
}
