import type * as vscode from 'vscode';
import type { PerformanceMetrics } from './commands';

type CommandsModule = typeof import('./commands');

let commandsModule: CommandsModule | null = null;

function loadCommands(): CommandsModule {
	if (!commandsModule) {
		commandsModule = require('./commands') as CommandsModule;
	}
	return commandsModule;
}

export async function activate(context: vscode.ExtensionContext) {
	return loadCommands().activate(context);
}

export function deactivate() {
	return loadCommands().deactivate();
}

export async function checkActiveModels(config: vscode.WorkspaceConfiguration): Promise<PerformanceMetrics['activeModel'] | undefined> {
	return loadCommands().checkActiveModels(config);
}

export function getLastPerformanceMetrics(): PerformanceMetrics | null {
	return loadCommands().getLastPerformanceMetrics();
}

export function clearPerformanceMetrics(): void {
	loadCommands().clearPerformanceMetrics();
}

export type { PerformanceMetrics };
