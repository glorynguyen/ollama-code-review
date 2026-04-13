import * as vscode from 'vscode';
import { SuggestionContentProvider } from './uiHelpers';

/**
 * Shared services and state that extracted command modules can depend on.
 * This keeps feature modules from reaching back into `index.ts` globals.
 */
export interface CommandContext {
	extensionContext: vscode.ExtensionContext;
	outputChannel: vscode.OutputChannel;
	suggestionProvider: SuggestionContentProvider;
	getGlobalStoragePath(): string | undefined;
	showScoreStatusBar(score: number): void;
}
