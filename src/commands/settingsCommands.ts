import * as vscode from 'vscode';
import { SkillsBrowserPanel } from '../skillsBrowserPanel';
import { maybeShowSetupGuide, showSetupGuide } from '../setupGuide';
import {
	ReviewProfile,
	BUILTIN_PROFILES,
	COMPLIANCE_PROFILES,
	getAllProfiles,
	getActiveProfileName,
	setActiveProfileName,
	saveCustomProfile,
	deleteCustomProfile,
} from '../profiles';
import { SkillsService } from '../skillsService';
import { getOllamaModel } from '../utils';
import { CLOUD_MODELS_METADATA } from '../providers';
import { getModelRecommendation } from '../modelAdvisor';
import type { ModelAdvisorInput } from '../modelAdvisor';
import { type CommandContext } from './commandContext';
import {
	addRecentHfModel,
	distinctByProperty,
	showHfModelPicker,
	showOpenAICompatiblePicker,
	updateModelStatusBar,
	updateProfileStatusBar,
} from './uiHelpers';

interface ModelQuickPickItem extends vscode.QuickPickItem {
	label: string;
	description?: string;
	detail?: string;
}

interface RegisterSettingsCommandsOptions {
	commandContext: CommandContext;
	skillsService: SkillsService;
	modelStatusBarItem: vscode.StatusBarItem;
	profileStatusBarItem: vscode.StatusBarItem;
	v0Models: ModelQuickPickItem[];
}

export function registerSettingsCommands(options: RegisterSettingsCommandsOptions): vscode.Disposable[] {
	const { commandContext, skillsService, modelStatusBarItem, profileStatusBarItem, v0Models } = options;
	const context = commandContext.extensionContext;

	const selectProfileCommand = vscode.commands.registerCommand('ollama-code-review.selectProfile', async () => {
		const profiles = getAllProfiles(context);
		const currentName = getActiveProfileName(context);

		const makeItem = (p: ReviewProfile) => ({
			label: p.name === currentName ? `$(check) ${p.name}` : p.name,
			description: p.description,
			detail: `${p.severity} severity | ${p.focusAreas.length} focus areas${p.includeExplanations ? ' | detailed explanations' : ''}`,
			profileName: p.name,
			kind: vscode.QuickPickItemKind.Default,
		});

		const builtinNames = new Set(BUILTIN_PROFILES.map(p => p.name));
		const complianceNames = new Set(COMPLIANCE_PROFILES.map(p => p.name));
		const builtinItems = profiles.filter(p => builtinNames.has(p.name)).map(makeItem);
		const complianceItems = profiles.filter(p => complianceNames.has(p.name)).map(makeItem);
		const customItems = profiles.filter(p => !builtinNames.has(p.name) && !complianceNames.has(p.name)).map(makeItem);

		const items: Array<{ label: string; description?: string; detail?: string; profileName: string; kind?: vscode.QuickPickItemKind }> = [
			...builtinItems,
			{ label: 'Compliance', profileName: '', kind: vscode.QuickPickItemKind.Separator },
			...complianceItems,
		];

		if (customItems.length > 0) {
			items.push({ label: 'Custom', profileName: '', kind: vscode.QuickPickItemKind.Separator });
			items.push(...customItems);
		}

		items.push(
			{ label: '', description: '', detail: '', profileName: '', kind: vscode.QuickPickItemKind.Separator },
			{ label: '$(add) Create Custom Profile...', description: 'Define a new review profile', detail: '', profileName: '__create__' },
			{ label: '$(trash) Delete Custom Profile...', description: 'Remove a user-defined profile', detail: '', profileName: '__delete__' },
		);

		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: `Current: ${currentName} | Select a review profile`,
			matchOnDescription: true,
			matchOnDetail: true,
		});

		if (!selected || !selected.profileName) {
			return;
		}

		if (selected.profileName === '__create__') {
			const name = await vscode.window.showInputBox({
				prompt: 'Profile name (lowercase, no spaces)',
				placeHolder: 'e.g., api-review',
				validateInput: (v) => {
					if (!v || !v.trim()) { return 'Name is required'; }
					if (/\s/.test(v)) { return 'No spaces allowed'; }
					if (v !== v.toLowerCase()) { return 'Must be lowercase'; }
					return undefined;
				},
			});
			if (!name) { return; }

			const description = await vscode.window.showInputBox({
				prompt: 'Short description',
				placeHolder: 'e.g., Focus on REST API design and error handling',
			});
			if (description === undefined) { return; }

			const focusInput = await vscode.window.showInputBox({
				prompt: 'Focus areas (comma-separated)',
				placeHolder: 'e.g., REST conventions, Error responses, Input validation',
			});
			if (!focusInput) { return; }

			const severityPick = await vscode.window.showQuickPick(
				['lenient', 'balanced', 'strict'],
				{ placeHolder: 'Severity level' },
			);
			if (!severityPick) { return; }

			const newProfile: ReviewProfile = {
				name,
				description: description || name,
				focusAreas: focusInput.split(',').map(s => s.trim()).filter(Boolean),
				severity: severityPick as 'lenient' | 'balanced' | 'strict',
				includeExplanations: severityPick !== 'strict',
			};

			await saveCustomProfile(context, newProfile);
			await setActiveProfileName(context, name);
			updateProfileStatusBar(profileStatusBarItem, context);
			vscode.window.showInformationMessage(`Created and activated profile: ${name}`);
			return;
		}

		if (selected.profileName === '__delete__') {
			const customProfiles = getAllProfiles(context).filter(
				p => !BUILTIN_PROFILES.some(b => b.name === p.name) && !COMPLIANCE_PROFILES.some(c => c.name === p.name),
			);
			if (customProfiles.length === 0) {
				vscode.window.showInformationMessage('No custom profiles to delete.');
				return;
			}
			const toDelete = await vscode.window.showQuickPick(
				customProfiles.map(p => ({ label: p.name, description: p.description })),
				{ placeHolder: 'Select a custom profile to delete' },
			);
			if (toDelete) {
				const deleted = await deleteCustomProfile(context, toDelete.label);
				if (deleted) {
					updateProfileStatusBar(profileStatusBarItem, context);
					vscode.window.showInformationMessage(`Deleted profile: ${toDelete.label}`);
				}
			}
			return;
		}

		await setActiveProfileName(context, selected.profileName);
		updateProfileStatusBar(profileStatusBarItem, context);
		vscode.window.showInformationMessage(`Review profile changed to: ${selected.profileName}`);
	});

	const selectModelCommand = vscode.commands.registerCommand('ollama-code-review.selectModel', async () => {
		const config = vscode.workspace.getConfiguration('ollama-code-review');
		const currentModel = getOllamaModel(config);

		const cloudModels: ModelQuickPickItem[] = CLOUD_MODELS_METADATA.map(m => ({
			label: m.id,
			description: m.description
		}));

		const applyModelSelection = async (selected: ModelQuickPickItem): Promise<void> => {
			if (selected.label === 'huggingface') {
				const hfModel = await showHfModelPicker(context, config);
				if (hfModel) {
					await config.update('model', 'huggingface', vscode.ConfigurationTarget.Global);
					await config.update('hfModel', hfModel, vscode.ConfigurationTarget.Global);
					await addRecentHfModel(context, hfModel);
					updateModelStatusBar(modelStatusBarItem);
					vscode.window.showInformationMessage(`Hugging Face model changed to: ${hfModel}`);
				}
				return;
			}

			if (selected.label === 'openai-compatible') {
				await showOpenAICompatiblePicker(config);
				await config.update('model', 'openai-compatible', vscode.ConfigurationTarget.Global);
				updateModelStatusBar(modelStatusBarItem);
				return;
			}

			await config.update('model', selected.label, vscode.ConfigurationTarget.Global);
			updateModelStatusBar(modelStatusBarItem);
			vscode.window.showInformationMessage(`Ollama model changed to: ${selected.label}`);
		};

		try {
			const endpoint = config.get<string>('endpoint', 'http://localhost:11434/api/generate');
			const baseUrl = endpoint.replace(/\/api\/generate\/?$/, '').replace(/\/$/, '');
			const tagsUrl = `${baseUrl}/api/tags`;

			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 5000);

			const response = await fetch(tagsUrl, { signal: controller.signal });
			clearTimeout(timeout);

			if (!response.ok) {
				throw new Error(`${response.status}: ${response.statusText}`);
			}

			const data = await response.json() as {
				models: Array<{
					name: string;
					modified_at?: string;
					size?: number;
					details?: {
						parameter_size?: string;
						family?: string;
						format?: string;
						quantized_level?: string;
					};
				}>;
			};

			const localModels: ModelQuickPickItem[] = data.models.map((model) => {
				const details: string[] = [];
				if (model.details?.family) {
					details.push(model.details.family);
				}
				if (model.details?.parameter_size) {
					details.push(model.details.parameter_size);
				}
				if (model.size) {
					const sizeGB = (model.size / (1024 ** 3)).toFixed(1);
					details.push(`${sizeGB}GB`);
				}

				return {
					label: model.name,
					description: details.join(' • ') || 'Local Ollama model',
				};
			});

			localModels.sort((a, b) => a.label.localeCompare(b.label));

			let recommendedItem: ModelQuickPickItem | undefined;
			try {
				const advisorInput: ModelAdvisorInput = { taskType: 'review', languages: [], contentLength: 0 };
				const advice = await getModelRecommendation(advisorInput, config);
				recommendedItem = {
					label: advice.recommended.modelId,
					description: `⭐ Recommended — ${advice.recommended.reason}`,
					detail: `Score: ${Math.round(advice.recommended.score * 100)}%`,
				};
			} catch {
				// Non-fatal: skip recommendation.
			}

			const allItems: ModelQuickPickItem[] = [
				...cloudModels,
				...localModels,
				{ label: 'custom', description: 'Use custom model from settings' },
			];
			if (recommendedItem && !allItems.find(m => m.label === recommendedItem.label && m.description?.startsWith('⭐'))) {
				allItems.unshift(recommendedItem);
			}
			const models = distinctByProperty(allItems, 'label');

			const currentItem = models.find(m => m.label === currentModel);
			const selected = await vscode.window.showQuickPick(models, {
				placeHolder: `Current: ${currentItem?.label || currentModel || 'None'} | Select Ollama model`,
				matchOnDescription: true,
			});

			if (selected) {
				await applyModelSelection(selected);
			}
		} catch (error) {
			vscode.window.showWarningMessage(`Could not connect to Ollama (${error}). Showing available cloud options.`);

			const fallbackModels: ModelQuickPickItem[] = [
				...cloudModels,
				{ label: 'custom', description: 'Use custom model from settings' },
			];

			if (currentModel && !fallbackModels.find(m => m.label === currentModel)) {
				fallbackModels.unshift({
					label: currentModel,
					description: 'Currently configured',
				});
			}

			const currentItem = fallbackModels.find(m => m.label === currentModel);
			const selected = await vscode.window.showQuickPick(fallbackModels, {
				placeHolder: `Current: ${currentItem?.label || currentModel || 'None'} | Select model (Ollama unreachable)`,
			});

			if (selected) {
				await applyModelSelection(selected);
			}
		}
	});

	const setupGuideCommand = vscode.commands.registerCommand(
		'ollama-code-review.openSetupGuide',
		() => showSetupGuide(context),
	);

	maybeShowSetupGuide(context);

	const configurationWatcher = vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('ollama-code-review.model') ||
			e.affectsConfiguration('ollama-code-review.customModel')) {
			updateModelStatusBar(modelStatusBarItem);
		}
	});

	const browseSkillsCommand = vscode.commands.registerCommand(
		'ollama-code-review.browseAgentSkills',
		async () => {
			try {
				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: 'Loading Agent Skills',
					cancellable: false,
				}, async (progress) => {
					progress.report({ message: 'Fetching skills from configured repositories...' });

					const skills = await skillsService.fetchAvailableSkillsFromAllRepos(true);

					progress.report({ message: 'Opening skills browser...' });
					await SkillsBrowserPanel.createOrShow(skillsService, skills);
				});
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to load agent skills: ${error}`);
			}
		},
	);

	const applySkillCommand = vscode.commands.registerCommand(
		'ollama-code-review.applySkillToReview',
		async () => {
			const cachedSkills = skillsService.listCachedSkills();

			if (cachedSkills.length === 0) {
				const browse = await vscode.window.showInformationMessage(
					'No skills installed. Would you like to browse available skills?',
					'Browse Skills',
					'Cancel',
				);

				if (browse === 'Browse Skills') {
					void vscode.commands.executeCommand('ollama-code-review.browseAgentSkills');
				}
				return;
			}

			// 1. Pick scope (Global or Project)
			const scopePick = await vscode.window.showQuickPick(
				[
					{ label: '$(globe) Global', description: 'Apply to all projects', scope: 'global' },
					{ label: '$(project) Project', description: 'Apply to this project only', scope: 'workspace' },
				],
				{ placeHolder: 'Apply skills to which scope?' },
			);

			if (!scopePick) { return; }

			const isWorkspace = scopePick.scope === 'workspace';
			const state = isWorkspace ? context.workspaceState : context.globalState;

			const currentlySelected = state.get<any[]>('selectedSkills', []);
			const currentlySelectedNames = new Set(currentlySelected.map(s => `${s.repository}/${s.name}`));

			const selectedSkills = await vscode.window.showQuickPick(
				cachedSkills.map(skill => ({
					label: skill.name,
					description: `${skill.description} (${skill.repository})`,
					skill,
					picked: currentlySelectedNames.has(`${skill.repository}/${skill.name}`),
				})),
				{
					placeHolder: `Select skills for ${scopePick.scope} scope (multiple allowed)`,
					canPickMany: true,
				},
			);

			if (selectedSkills && selectedSkills.length > 0) {
				const skillNames = selectedSkills.map(s => s.skill.name).join(', ');
				vscode.window.showInformationMessage(
					`${selectedSkills.length} skill(s) will be applied to ${scopePick.scope} review: ${skillNames}`,
				);
				await state.update('selectedSkills', selectedSkills.map(s => s.skill));
			} else if (selectedSkills && selectedSkills.length === 0) {
				vscode.window.showInformationMessage(`All ${scopePick.scope} skills have been deselected`);
				await state.update('selectedSkills', []);
			}
		},
	);

	const clearSkillsCommand = vscode.commands.registerCommand(
		'ollama-code-review.clearSelectedSkills',
		async () => {
			const globalSkills = context.globalState.get<any[]>('selectedSkills', []);
			const workspaceSkills = context.workspaceState.get<any[]>('selectedSkills', []);

			if (globalSkills.length === 0 && workspaceSkills.length === 0) {
				vscode.window.showInformationMessage('No skills are currently selected in any scope');
				return;
			}

			const clearPick = await vscode.window.showQuickPick(
				[
					{ label: 'Clear Global Skills', count: globalSkills.length, scope: 'global' },
					{ label: 'Clear Project Skills', count: workspaceSkills.length, scope: 'workspace' },
					{ label: 'Clear All Scopes', count: globalSkills.length + workspaceSkills.length, scope: 'all' },
				].filter(p => p.count > 0),
				{ placeHolder: 'Which skills would you like to clear?' },
			);

			if (!clearPick) { return; }

			if (clearPick.scope === 'global' || clearPick.scope === 'all') {
				await context.globalState.update('selectedSkills', []);
			}
			if (clearPick.scope === 'workspace' || clearPick.scope === 'all') {
				await context.workspaceState.update('selectedSkills', []);
			}

			vscode.window.showInformationMessage(`Cleared selected skill(s) from ${clearPick.scope} scope`);
		},
	);

	return [
		selectProfileCommand,
		selectModelCommand,
		setupGuideCommand,
		configurationWatcher,
		browseSkillsCommand,
		applySkillCommand,
		clearSkillsCommand,
	];
}
