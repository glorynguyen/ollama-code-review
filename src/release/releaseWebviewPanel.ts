import * as vscode from 'vscode';
import * as path from 'path';
import { ReleaseService, Commit, ConflictState } from './releaseService';
import { ADOProvider } from './adoProvider';

interface GitBranch {
    name?: string;
    remote?: boolean;
}

interface GitRepository {
    rootUri: vscode.Uri;
    getBranches(query: { remote: boolean }): Promise<GitBranch[]>;
    fetch(options?: { remote: string }): Promise<void>;
    state: {
        HEAD?: {
            name?: string;
        };
    };
}

interface GitAPI {
    repositories: GitRepository[];
}

interface ReleaseHistory {
    [branchName: string]: {
        created?: string;
        base?: string;
        commits: string[];
        notes?: string;
    };
}

interface ReleaseMapping {
    [ticketId: string]: {
        id: string;
        title: string;
        commits: string[];
    };
}

interface AdoStatus {
    orgUrl: string;
    project: string;
    repoId: string;
    hasToken: boolean;
    isConfigured: boolean;
    isConnected: boolean;
}

export class ReleaseWebviewPanel {
    public static currentPanel: ReleaseWebviewPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionContext: vscode.ExtensionContext;
    private _disposables: vscode.Disposable[] = [];
    private _releaseService: ReleaseService;
    private _adoProvider: ADOProvider | undefined;
    private _sourceBranch: string | undefined;
    private _targetBranch: string | undefined;
    private _isUpdating: boolean = false;
    private _currentConflictState: ConflictState | undefined;
    private readonly _outputChannel: vscode.OutputChannel;

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, workspaceRoot: string) {
        this._panel = panel;
        this._extensionContext = context;
        this._releaseService = new ReleaseService(workspaceRoot);
        this._outputChannel = vscode.window.createOutputChannel('Ollama Code Review - Release Orchestrator');
        
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'webviewReady':
                        await this._postAdoStatus();
                        this._updateData();
                        return;
                    case 'getAdoStatus':
                        await this._postAdoStatus();
                        return;
                    case 'saveAdoToken':
                        if (typeof message.token !== 'string' || !message.token.trim()) {
                            this._panel.webview.postMessage({ command: 'adoStatusResult', success: false, message: 'Enter an Azure DevOps PAT before saving.' });
                            return;
                        }
                        await this._extensionContext.secrets.store('ado.token', message.token.trim());
                        await this._initializeProvider();
                        await this._postAdoStatus('Azure DevOps PAT saved securely.');
                        return;
                    case 'testAdoConnection':
                        await this._testAdoConnection();
                        return;
                    case 'openAdoSettings':
                        await vscode.commands.executeCommand('workbench.action.openSettings', 'ollama-code-review.ado');
                        return;
                    case 'openDiff':
                        try {
                            const doc = await vscode.workspace.openTextDocument({
                                content: message.diff,
                                language: 'diff'
                            });
                            await vscode.window.showTextDocument(doc);
                        } catch (e) {
                            vscode.window.showErrorMessage('Failed to open diff in editor: ' + e);
                        }
                        return;
                    case 'refreshData':
                        this._updateData();
                        return;
                    case 'saveMapping':
                        await this._extensionContext.workspaceState.update('releaseMapping', message.data);
                        return;
                    case 'saveAvailability':
                        if (typeof message.targetBranch === 'string') {
                            const availabilityByBranch = this._extensionContext.workspaceState.get<Record<string, Record<string, string>>>('commitAvailability', {});
                            availabilityByBranch[message.targetBranch] = message.data;
                            await this._extensionContext.workspaceState.update('commitAvailability', availabilityByBranch);
                        } else {
                            await this._extensionContext.workspaceState.update('commitAvailability', message.data);
                        }
                        return;
                    case 'getCommitBody':
                        if (typeof message.hash !== 'string') {return;}
                        try {
                            const body = await this._releaseService.getCommitBody(message.hash);
                            this._panel.webview.postMessage({ command: 'commitBody', data: body, hash: message.hash });
                        } catch (e) {
                            this._panel.webview.postMessage({ command: 'error', message: 'Failed to fetch commit body' });
                        }
                        return;
                    case 'getPRDiff':
                        if (typeof message.source !== 'string' || typeof message.target !== 'string') {return;}
                        try {
                            const diff = await this._releaseService.getPRDiff(message.source, message.target);
                            this._panel.webview.postMessage({ command: 'prDiff', data: diff, source: message.source, target: message.target });
                        } catch (e) {
                            this._panel.webview.postMessage({ command: 'error', message: 'Failed to fetch PR diff' });
                        }
                        return;
                    case 'getTicketDetailsBulk':
                        if (!Array.isArray(message.ids) || message.ids.length === 0) {
                            return;
                        }
                        if (this._adoProvider) {
                            try {
                                const tickets = await this._adoProvider.getTicketDetailsBulk(message.ids);
                                this._panel.webview.postMessage({ command: 'ticketDetailsBulk', data: tickets });
                            } catch (e) {
                                console.error('[ReleaseOrchestrator] Bulk lookup failed:', e);
                                this._panel.webview.postMessage({ command: 'error', message: 'Failed to fetch ticket details' });
                            }
                        }
                        return;
                    case 'appendRelease':
                        if (typeof message.branchName !== 'string' || !Array.isArray(message.hashes) || typeof message.baseBranch !== 'string') {
                            this._panel.webview.postMessage({ command: 'error', message: 'Invalid appendRelease message format' });
                            return;
                        }
                        const appendResult = await this._releaseService.appendToRelease(message.branchName, message.hashes, message.baseBranch);
                        if (appendResult.requiresConflictResolution) {
                            this._currentConflictState = appendResult.conflictState;
                        }
                        if (appendResult.success) {
                            const history = this._extensionContext.workspaceState.get<ReleaseHistory>('releaseHistory', {});
                            if (history[message.branchName]) {
                                history[message.branchName].commits = [...new Set([...(history[message.branchName].commits || []), ...message.hashes])];
                                history[message.branchName].base = history[message.branchName].base || message.baseBranch;
                                history[message.branchName].created = history[message.branchName].created || new Date().toISOString();
                                await this._extensionContext.workspaceState.update('releaseHistory', history);
                            }
                        }
                        this._panel.webview.postMessage({ command: 'releaseResult', data: appendResult });
                        return;
                    case 'saveReleaseNotes':
                        const notesHistory = this._extensionContext.workspaceState.get<ReleaseHistory>('releaseHistory', {});
                        if (notesHistory[message.branchName]) {
                            notesHistory[message.branchName].notes = message.notes;
                            await this._extensionContext.workspaceState.update('releaseHistory', notesHistory);
                            this._panel.webview.postMessage({ command: 'notesSaved', success: true });
                        }
                        return;
                    case 'deleteRelease':
                        const delHistory = this._extensionContext.workspaceState.get<ReleaseHistory>('releaseHistory', {});
                        delete delHistory[message.branchName];
                        await this._extensionContext.workspaceState.update('releaseHistory', delHistory);
                        this._panel.webview.postMessage({ command: 'releaseDeleted', success: true });
                        return;
                    case 'resolveConflict':
                        if (!this._currentConflictState || typeof message.filename !== 'string' || typeof message.resolvedContent !== 'string') {
                            this._panel.webview.postMessage({ command: 'releaseResult', data: { success: false, message: 'Invalid conflict resolution request' } });
                            return;
                        }
                        {
                            const previousState = this._currentConflictState;
                            const result = await this._releaseService.resolveConflictFile(previousState, message.filename, message.resolvedContent);
                            if (result.requiresConflictResolution) {
                                this._currentConflictState = result.conflictState;
                            } else if (result.success) {
                                this._currentConflictState = undefined;
                                const history = this._extensionContext.workspaceState.get<ReleaseHistory>('releaseHistory', {});
                                const branchName = previousState.branchName;
                                const existing = history[branchName];
                                const commits = previousState.isAppending
                                    ? [...new Set([...(existing?.commits || []), ...previousState.selectedHashes])]
                                    : previousState.selectedHashes;
                                history[branchName] = {
                                    created: existing?.created || new Date().toISOString(),
                                    base: existing?.base || previousState.baseBranch,
                                    commits,
                                    notes: existing?.notes || ''
                                };
                                await this._extensionContext.workspaceState.update('releaseHistory', history);
                            }
                            this._panel.webview.postMessage({ command: 'releaseResult', data: result });
                        }
                        return;
                    case 'abortCherryPick':
                        {
                            const result = await this._releaseService.abortCherryPick();
                            this._currentConflictState = undefined;
                            this._panel.webview.postMessage({ command: 'releaseResult', data: result });
                        }
                        return;
                    case 'getBranches':
                        try {
                            const gitAPI = vscode.extensions.getExtension('vscode.git')?.exports?.getAPI(1) as GitAPI;
                            const repo = gitAPI?.repositories?.[0];
                            if (repo) {
                                if (message.refresh) {
                                    await repo.fetch();
                                }
                                const branches = await repo.getBranches({ remote: true });
                                const names = branches.map((b: GitBranch) => b.name || '').filter(Boolean);
                                this._panel.webview.postMessage({ command: 'branchList', data: names });
                            }
                        } catch (e) {
                            this._panel.webview.postMessage({ command: 'error', message: 'Failed to fetch branches' });
                        }
                        return;
                    case 'getPullRequests':
                        if (typeof message.targetBranch !== 'string') {return;}
                        if (this._adoProvider) {
                            try {
                                const prs = await this._adoProvider.getPullRequests(message.targetBranch);
                                this._panel.webview.postMessage({ command: 'pullRequests', data: prs });
                            } catch (e) {
                                this._panel.webview.postMessage({ command: 'error', message: 'Failed to fetch PRs' });
                            }
                        }
                        return;
                    case 'lookupTicket':
                        if (typeof message.id !== 'string' || !message.id.trim()) {
                            this._panel.webview.postMessage({ command: 'error', message: 'Invalid ticket ID' });
                            return;
                        }
                        if (!this._adoProvider) {
                            const action = await vscode.window.showErrorMessage('Azure DevOps PAT not found or configuration incomplete.', 'Set Token');
                            if (action === 'Set Token') {
                                vscode.commands.executeCommand('ollama-code-review.setAdoToken');
                            }
                            return;
                        }
                        try {
                            const ticket = await this._adoProvider.lookupTicket(message.id);
                            this._panel.webview.postMessage({ command: 'ticketDetails', data: ticket });
                        } catch (e) {
                            console.error('[ReleaseOrchestrator] Lookup failed:', e);
                            // Fallback for manual entry if ticket not found in ADO
                            this._panel.webview.postMessage({ 
                                command: 'ticketDetails', 
                                data: { id: message.id, title: 'Manual Entry', state: 'Unknown' } 
                            });
                        }
                        return;
                    case 'searchTickets':
                        if (typeof message.query !== 'string' || !message.query.trim()) {
                            return;
                        }
                        if (this._adoProvider) {
                            try {
                                const results = await this._adoProvider.searchTicketsByTitle(message.query);
                                this._panel.webview.postMessage({ command: 'searchResults', data: results });
                            } catch (e) {
                                console.error('[ReleaseOrchestrator] Search failed:', e);
                                this._panel.webview.postMessage({ command: 'error', message: 'Failed to search tickets' });
                            }
                        }
                        return;
                    case 'selectBranch':
                        if (message.type !== 'source' && message.type !== 'target') {
                            this._panel.webview.postMessage({ command: 'error', message: 'Invalid branch type' });
                            return;
                        }
                        try {
                            const gitAPI = vscode.extensions.getExtension('vscode.git')?.exports?.getAPI(1) as GitAPI;
                            const repo = gitAPI?.repositories?.[0];
                            if (repo) {
                                const branches = await repo.getBranches({ remote: true });
                                const localBranches = await repo.getBranches({ remote: false });
                                const allBranchNames = [...new Set([
                                    ...localBranches.map((b: GitBranch) => b.name || ''),
                                    ...branches.map((b: GitBranch) => b.name || '')
                                ])].filter(Boolean).sort();

                                const selected = await vscode.window.showQuickPick(allBranchNames, {
                                    placeHolder: `Select ${message.type} branch`
                                });

                                if (selected) {
                                    if (message.type === 'source') {
                                        this._sourceBranch = selected;
                                    } else {
                                        this._targetBranch = selected;
                                    }
                                    this._updateData();
                                }
                            }
                        } catch (e) {
                            console.error('[ReleaseOrchestrator] Branch selection failed:', e);
                            vscode.window.showErrorMessage('Failed to fetch branches');
                        }
                        return;
                    case 'createRelease':
                        if (typeof message.branchName !== 'string' || !message.branchName.trim()) {
                            this._panel.webview.postMessage({ command: 'error', message: 'Invalid release branch name' });
                            return;
                        }
                        if (!Array.isArray(message.hashes) || message.hashes.length === 0) {
                            this._panel.webview.postMessage({ command: 'error', message: 'No commits selected for release' });
                            return;
                        }

                        if (!message.force) {
                            const risks = await this._releaseService.analyzeDependencyRisks(message.hashes, message.baseBranch, this._sourceBranch || 'develop');
                            if (risks.length > 0) {
                                this._panel.webview.postMessage({ 
                                    command: 'releaseResult', 
                                    data: { success: false, requiresConfirmation: true, risks: risks } 
                                });
                                return;
                            }
                        }
                        try {
                            const result = await this._releaseService.executeCherryPick(message.branchName, message.hashes, message.baseBranch);
                            if (result.requiresConflictResolution) {
                                this._currentConflictState = result.conflictState;
                            }
                            if (result.success) {
                                const history = this._extensionContext.workspaceState.get<ReleaseHistory>('releaseHistory', {});
                                history[message.branchName] = {
                                    created: new Date().toISOString(),
                                    base: message.baseBranch,
                                    commits: message.hashes,
                                    notes: ''
                                };
                                await this._extensionContext.workspaceState.update('releaseHistory', history);
                            }
                            this._panel.webview.postMessage({ command: 'releaseResult', data: result });
                        } catch (e) {
                            console.error('[ReleaseOrchestrator] Release creation failed:', e);
                            this._panel.webview.postMessage({ 
                                command: 'releaseResult', 
                                data: { success: false, error: 'Failed to create release. Check the output for details.' } 
                            });
                        }
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    private async _initializeProvider() {
        const config = vscode.workspace.getConfiguration('ollama-code-review.ado');
        const orgUrl = config.get<string>('orgUrl');
        const project = config.get<string>('project');
        const repoId = config.get<string>('repoId');
        const token = (await this._extensionContext.secrets.get('ado.token'))?.trim();

        this._adoProvider = undefined;
        if (orgUrl && project && token && repoId) {
            this._adoProvider = new ADOProvider(orgUrl, project, token, repoId);
        }
    }

    private async _getAdoStatus(): Promise<AdoStatus> {
        const config = vscode.workspace.getConfiguration('ollama-code-review.ado');
        const orgUrl = config.get<string>('orgUrl') || '';
        const project = config.get<string>('project') || '';
        const repoId = config.get<string>('repoId') || '';
        const token = await this._extensionContext.secrets.get('ado.token');
        const isConfigured = Boolean(orgUrl && project && repoId);

        return {
            orgUrl,
            project,
            repoId,
            hasToken: Boolean(token),
            isConfigured,
            isConnected: Boolean(isConfigured && token && this._adoProvider)
        };
    }

    private async _postAdoStatus(message?: string) {
        const status = await this._getAdoStatus();
        this._panel.webview.postMessage({ command: 'adoStatus', data: status, message });
    }

    private _appendAdoTestLog(message: string, level: 'info' | 'success' | 'error' = 'info', clear = false) {
        const line = `[${new Date().toISOString()}] [ADO PAT Test] ${message}`;
        this._outputChannel.appendLine(line);
        this._panel.webview.postMessage({
            command: 'adoTestLog',
            level,
            message,
            timestamp: new Date().toLocaleTimeString(),
            clear
        });
    }

    private async _testAdoConnection() {
        this._appendAdoTestLog('Starting Azure DevOps PAT connection test.', 'info', true);
        await this._initializeProvider();
        const status = await this._getAdoStatus();
        this._appendAdoTestLog(`Configuration loaded: orgUrl=${status.orgUrl || '(missing)'}, project=${status.project || '(missing)'}, repoId=${status.repoId || '(missing)'}, pat=${status.hasToken ? 'present' : 'missing'}.`);

        if (!status.isConfigured) {
            this._appendAdoTestLog('Stopped before API request: org URL, project, or repository setting is missing.', 'error');
            this._outputChannel.show(true);
            this._panel.webview.postMessage({
                command: 'adoStatusResult',
                success: false,
                message: 'Azure DevOps settings are incomplete. Set org URL, project, and repository first.'
            });
            await this._postAdoStatus();
            return;
        }

        if (!status.hasToken || !this._adoProvider) {
            this._appendAdoTestLog('Stopped before API request: Azure DevOps PAT is missing from VS Code Secrets.', 'error');
            this._outputChannel.show(true);
            this._panel.webview.postMessage({
                command: 'adoStatusResult',
                success: false,
                message: 'Azure DevOps PAT is missing.'
            });
            await this._postAdoStatus();
            return;
        }

        try {
            this._appendAdoTestLog('Sending repository lookup request to Azure DevOps.');
            await this._adoProvider.testConnection();
            this._appendAdoTestLog('Azure DevOps accepted the PAT and repository lookup succeeded.', 'success');
            this._panel.webview.postMessage({
                command: 'adoStatusResult',
                success: true,
                message: 'Azure DevOps connection looks good.'
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            this._appendAdoTestLog(`Connection test failed: ${message}`, 'error');
            if (error instanceof Error && error.stack) {
                this._outputChannel.appendLine(error.stack);
            }
            this._outputChannel.show(true);
            this._panel.webview.postMessage({
                command: 'adoStatusResult',
                success: false,
                message
            });
        }
        await this._postAdoStatus();
    }

    public static async createOrShow(context: vscode.ExtensionContext) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;
        
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('Please open a workspace to use the Release Orchestrator.');
            return;
        }
        const workspaceRoot = workspaceFolders[0].uri.fsPath;

        if (ReleaseWebviewPanel.currentPanel) {
            ReleaseWebviewPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'releaseMapper',
            'AI Release Orchestrator',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(path.join(context.extensionUri.fsPath, 'media'))]
            }
        );

        const instance = new ReleaseWebviewPanel(panel, context, workspaceRoot);
        await instance._initializeProvider();
        await instance._update();
        ReleaseWebviewPanel.currentPanel = instance;
    }

    private async _update() {
        const styleUri = this._panel.webview.asWebviewUri(vscode.Uri.joinPath(this._extensionContext.extensionUri, 'media', 'diff2html.min.css'));
        const coreScriptUri = this._panel.webview.asWebviewUri(vscode.Uri.joinPath(this._extensionContext.extensionUri, 'media', 'diff2html.min.js'));
        const scriptUri = this._panel.webview.asWebviewUri(vscode.Uri.joinPath(this._extensionContext.extensionUri, 'media', 'diff2html-ui.min.js'));

        this._panel.title = 'AI Release Orchestrator';
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview, styleUri, coreScriptUri, scriptUri);
    }

    private async _updateData() {
        if (this._isUpdating) {
            return;
        }

        this._isUpdating = true;
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Comparing branches...",
            cancellable: false
        }, async (progress) => {
            try {
                const config = vscode.workspace.getConfiguration('ollama-code-review');
                const defaultBaseBranch = config.get<string>('defaultBaseBranch', 'main');
                
                const gitAPI = vscode.extensions.getExtension('vscode.git')?.exports?.getAPI(1) as GitAPI;
                const repo = gitAPI?.repositories?.find((r: GitRepository) => r.rootUri.fsPath === this._releaseService.getWorkspaceRoot()) || gitAPI?.repositories?.[0];
                
                if (!repo) {
                    throw new Error('Git repository not found for this workspace.');
                }

                const sourceBranch = this._sourceBranch || repo?.state.HEAD?.name || 'develop';
                const targetBranch = this._targetBranch || defaultBaseBranch;

                this._sourceBranch = sourceBranch;
                this._targetBranch = targetBranch;

                // Try to fetch both branches if they are remotes
                if (sourceBranch.includes('/') || targetBranch.includes('/')) {
                    progress.report({ message: 'Fetching remotes...' });
                    try {
                        const remote = sourceBranch.split('/')[0] || targetBranch.split('/')[0] || 'origin';
                        await repo.fetch({ remote });
                    } catch (e) {
                        console.error('Fetch failed, continuing with local data', e);
                    }
                }

                progress.report({ message: 'Analyzing differences...' });
                const uniqueHashes = await this._releaseService.getUniqueHashesByContent(targetBranch, sourceBranch);
                const rawCommits = await this._releaseService.getCommits(sourceBranch, targetBranch);
                const targetMessages = await this._releaseService.getBranchCommitMessages(targetBranch);
                
                console.log(`[ReleaseOrchestrator] Raw Commits: ${rawCommits.length}`);
                console.log(`[ReleaseOrchestrator] Unique Hashes (git cherry): ${uniqueHashes.size}`);
                console.log(`[ReleaseOrchestrator] Target Branch Messages: ${targetMessages.size}`);

                const candidates: Commit[] = [];
                for (const c of rawCommits) {
                    const isUniqueHash = uniqueHashes.has(c.hash) || uniqueHashes.has(c.hash.substring(0, 7));
                    const isNewMessage = !targetMessages.has(c.message);
                    
                    if (isUniqueHash && isNewMessage) {
                        const hasChanges = await this._releaseService.hasCodeChanges(c.hash);
                        if (hasChanges) {
                            candidates.push(c);
                        } else {
                            console.log(`[ReleaseOrchestrator] Skipping commit ${c.hash.substring(0,7)}: No code changes detected ("${c.message}")`);
                        }
                    } else {
                        if (!isUniqueHash) {console.log(`[ReleaseOrchestrator] Skipping commit ${c.hash.substring(0,7)}: Already in target (by content) ("${c.message}")`);}
                        if (!isNewMessage) {console.log(`[ReleaseOrchestrator] Skipping commit ${c.hash.substring(0,7)}: Already in target (by message) ("${c.message}")`);}
                    }
                    
                    if (candidates.length >= 50) {break;}
                }
                
                console.log(`[ReleaseOrchestrator] Final Candidates Selected: ${candidates.length}`);

                if (candidates.length === 0 && rawCommits.length > 0) {
                    // If no content-unique commits, but there are new commits, maybe they are all already cherry-picked?
                    // We'll show a hint in the UI later, but for now just send empty list.
                }

                progress.report({ message: 'Processing commit details...' });
                const processedCommits = await this._releaseService.processUniqueCommits(candidates, targetBranch);
                const mapping = this._extensionContext.workspaceState.get<ReleaseMapping>('releaseMapping', {});
                const availabilityState = this._extensionContext.workspaceState.get<Record<string, any>>('commitAvailability', {});
                const looksBranchScoped = availabilityState[targetBranch] && typeof availabilityState[targetBranch] === 'object';
                const availabilityMap = looksBranchScoped ? availabilityState[targetBranch] : availabilityState;
                const releaseHistory = this._extensionContext.workspaceState.get<ReleaseHistory>('releaseHistory', {});
                
                const adoConfigRaw = vscode.workspace.getConfiguration('ollama-code-review.ado');
                const orgUrl = adoConfigRaw.get<string>('orgUrl') || '';
                const project = adoConfigRaw.get<string>('project') || '';

                // Basic sanitization for UI display
                const sanitizedOrgUrl = orgUrl.replace(/[^-a-zA-Z0-9:\/._]/g, '');
                const sanitizedProject = project.replace(/[^a-zA-Z0-9\s-_]/g, '');

                this._panel.webview.postMessage({ 
                    command: 'initData', 
                    commits: processedCommits, 
                    mapping: mapping, 
                    availability: availabilityMap,
                    releaseHistory,
                    adoConfig: { orgUrl: sanitizedOrgUrl, project: sanitizedProject },
                    sourceBranch, 
                    targetBranch 
                });
            } catch (e: any) {
                console.error('[ReleaseOrchestrator] Update failed:', e);
                this._panel.webview.postMessage({ 
                    command: 'error', 
                    message: 'Failed to update release data. Please check your git configuration and branch selection.' 
                });
            } finally {
                this._isUpdating = false;
            }
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview, styleUri: vscode.Uri, coreScriptUri: vscode.Uri, scriptUri: vscode.Uri) {
        const nonce = getNonce();
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} https:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Release Orchestrator</title>
    <link rel="stylesheet" href="${styleUri}">
    <script nonce="${nonce}" src="${coreScriptUri}"></script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
    <style>
        :root {
            --primary: var(--vscode-button-background);
            --bg: var(--vscode-sideBar-background);
            --border: var(--vscode-panel-border);
            --text: var(--vscode-foreground);
            --muted: var(--vscode-descriptionForeground);
            --surface: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-foreground) 12%);
            --surface-soft: color-mix(in srgb, var(--vscode-editor-background) 94%, var(--vscode-foreground) 6%);
            --focus: var(--vscode-focusBorder, var(--vscode-button-background));
        }
        body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--text); margin: 0; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
        header { background: var(--vscode-editor-background); padding: 12px 28px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; gap: 18px; z-index: 10; }
        .top-left, .top-actions, .branch-flow, .branch-picker { display: flex; align-items: center; }
        .top-left { gap: 16px; min-width: 0; }
        .top-actions { gap: 8px; }
        .branch-flow { gap: 8px; min-width: 0; }
        .branch-picker { gap: 7px; font-weight: 600; }
        .branch-label { color: var(--muted); font-size: 0.74rem; font-weight: 500; text-transform: uppercase; }
        .branch-tag { cursor: pointer; padding: 4px 8px; border-radius: 4px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-family: monospace; border: 1px solid transparent; }
        .branch-tag:hover { border-color: var(--focus); background: var(--vscode-button-secondaryHoverBackground); }
        .branch-arrow { color: var(--muted); font-size: 1.05rem; }
        .ado-chip { border: 1px solid var(--border); border-radius: 999px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); padding: 5px 12px; font-size: 0.8rem; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
        .ado-chip.connected { border-color: rgba(63, 185, 80, 0.55); color: #3fb950; }
        .ado-chip.warning { border-color: rgba(210, 153, 34, 0.65); color: #d29922; }
        .ado-chip.error { border-color: rgba(248, 81, 73, 0.65); color: #ff7b72; }
        .main-container { display: flex; flex: 1; overflow: hidden; }
        .col-left { width: 400px; background: var(--vscode-sideBar-background); border-right: 1px solid color-mix(in srgb, var(--border) 72%, transparent); display: flex; flex-direction: column; overflow: hidden; }
        .col-right { flex: 1; display: flex; flex-direction: column; background: var(--vscode-editor-background); overflow: hidden; }
        .list-header { padding: 14px 18px 10px; background: var(--vscode-sideBar-background); font-weight: 650; font-size: 0.78rem; letter-spacing: 0; text-transform: uppercase; border-bottom: 1px solid color-mix(in srgb, var(--border) 78%, transparent); display:flex; justify-content:space-between; align-items:center; gap: 10px; }
        .list-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .list-kicker { color: var(--muted); font-size: 0.72rem; font-weight: 500; text-transform: none; }
        .section-actions { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .section-toggle { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border-radius: 4px; }
        .section-toggle .collapse-icon { width: 0; height: 0; border-top: 4px solid transparent; border-bottom: 4px solid transparent; border-left: 6px solid currentColor; transform: rotate(0deg); transition: transform 0.14s ease; }
        .section-toggle[aria-expanded="true"] .collapse-icon { transform: rotate(90deg); }
        .section-refresh { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border-radius: 4px; }
        .commit-pool { flex: 1; overflow-y: auto; padding: 10px; }
        .commit-card { background: var(--vscode-editor-background); border: 1px solid var(--border); border-radius: 6px; padding: 9px; margin-bottom: 8px; cursor: move; transition: 0.2s; position: relative; }
        .commit-card:hover { border-color: var(--focus); }
        .commit-card.selected { border-color: var(--primary); background: var(--vscode-editor-selectionBackground); }
        .commit-card.dragging { opacity: 0.5; }
        .c-msg { font-size: 0.9rem; font-weight: 500; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .c-meta { font-size: 0.75rem; opacity: 0.8; display: flex; justify-content: space-between; }
        .c-tag { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 1px 4px; border-radius: 3px; font-family: monospace; }
        
        .plan-header { padding: 16px 28px; border-bottom: 1px solid var(--border); display: grid; grid-template-columns: minmax(260px, 1fr) auto; gap: 16px; align-items: end; background: var(--vscode-editor-background); }
        .plan-title { margin: 0 0 4px; font-size: 1rem; font-weight: 650; }
        .plan-subtitle { color: var(--muted); font-size: 0.82rem; }
        .ticket-entry { display: flex; gap: 8px; align-items: center; justify-content: flex-end; min-width: 420px; }
        .ticket-search-wrapper { position: relative; flex: 1; min-width: 220px; }
        .ticket-input { padding: 8px 10px; border: 1px solid var(--border); border-radius: 5px; width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); outline: none; }
        .ticket-input:focus { border-color: var(--focus); }
        .search-results { display: none; position: absolute; top: 100%; left: 0; right: 0; z-index: 20; max-height: 260px; overflow-y: auto; border: 1px solid var(--border); background: var(--vscode-menu-background); color: var(--vscode-menu-foreground); box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
        .search-item { padding: 8px 10px; cursor: pointer; border-bottom: 1px solid var(--border); }
        .search-item:hover { background: var(--vscode-menu-selectionBackground); color: var(--vscode-menu-selectionForeground); }
        
        .plan-board { flex: 1; overflow-y: auto; padding: 18px 28px 28px; background: var(--vscode-panel-background); display: flex; flex-direction: column; gap: 14px; }
        .draft-panel { background: var(--vscode-editor-background); border: 1px solid var(--border); border-radius: 8px; padding: 18px; }
        .draft-panel.is-empty { min-height: 260px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; }
        .draft-title { margin: 0; font-size: 1.15rem; font-weight: 700; }
        .draft-copy { color: var(--muted); line-height: 1.45; margin: 8px 0 0; max-width: 620px; }
        .setup-steps { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 10px; margin: 18px 0; width: 100%; }
        .setup-step { border: 1px solid color-mix(in srgb, var(--border) 78%, transparent); border-radius: 6px; padding: 10px; background: var(--surface-soft); }
        .setup-step strong { display: block; margin-bottom: 5px; font-size: 0.82rem; }
        .setup-step span { color: var(--muted); font-size: 0.78rem; line-height: 1.35; }
        .draft-actions, .draft-metrics { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .draft-metrics { margin-top: 14px; }
        .metric { border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; min-width: 120px; background: var(--surface-soft); }
        .metric-value { font-size: 1.1rem; font-weight: 700; }
        .metric-label { color: var(--muted); font-size: 0.74rem; }
        .ticket-bucket { background: var(--vscode-editor-background); border-radius: 8px; border: 1px solid var(--border); overflow: hidden; display: flex; flex-direction: column; }
        .tb-header { padding: 10px 15px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
        .tb-title { font-weight: 600; display: flex; align-items: center; gap: 10px; }
        .tb-content { min-height: 60px; padding: 10px; background: var(--vscode-editor-background); }
        .tb-content.drag-over { background: var(--vscode-editor-selectionBackground); }
        .empty-bucket { text-align: center; color: var(--muted); font-size: 0.9rem; padding: 18px; border: 1px dashed color-mix(in srgb, var(--border) 82%, transparent); border-radius: 6px; background: var(--surface-soft); line-height: 1.45; }
        .empty-bucket strong { color: var(--text); display: block; margin-bottom: 4px; }
        .empty-action { margin-top: 10px; }
        
        .btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 1px solid transparent; padding: 8px 14px; border-radius: 5px; cursor: pointer; font-weight: 600; line-height: 1.1; }
        .btn:hover { background: var(--vscode-button-hoverBackground); }
        .btn-sec { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn-sec:hover { background: var(--vscode-button-secondaryHoverBackground); }
        .btn:disabled, .btn-sec:disabled { opacity: 0.55; cursor: not-allowed; }
        
        /* New Filter & Availability Styles */
        .filter-controls { display: flex; gap: 6px; padding: 10px 18px 12px; background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--border); }
        .filter-btn { flex: 1; padding: 7px 0; font-size: 0.78rem; border: 1px solid var(--border); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border-radius: 5px; cursor: pointer; }
        .filter-btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); }
        
        .commit-card.user-excluded { opacity: 0.5; background: var(--vscode-editor-inactiveSelectionBackground); border-style: dashed; }
        .commit-card.user-excluded .c-msg { text-decoration: line-through; }
        .excluded-badge { font-size: 0.65rem; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 1px 4px; border-radius: 3px; margin-left: 5px; }

        .c-link { color: var(--vscode-textLink-foreground); text-decoration: none; font-weight: bold; margin-left: 8px; }
        .c-link:hover { text-decoration: underline; }

        .context-menu { position: absolute; background: var(--vscode-menu-background); color: var(--vscode-menu-foreground); border: 1px solid var(--vscode-menu-border); box-shadow: 0 2px 10px rgba(0,0,0,0.2); border-radius: 4px; z-index: 1000; display: none; min-width: 160px; }
        .context-menu ul { list-style: none; margin: 0; padding: 5px 0; }
        .context-menu li { padding: 8px 15px; cursor: pointer; font-size: 0.85rem; }
        .context-menu li:hover { background: var(--vscode-menu-selectionBackground); color: var(--vscode-menu-selectionForeground); }
        
        .modal-overlay { display: none; position: fixed; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.5); z-index: 100; align-items: center; justify-content: center; }
        .modal { background: var(--vscode-editor-background); padding: 25px; border-radius: 5px; width: 450px; border: 1px solid var(--border); }
        .modal.large { width: 90%; height: 90%; display: flex; flex-direction: column; }
        .modal-row { margin-bottom: 12px; }
        .modal-row label { display: block; margin-bottom: 5px; font-size: 0.78rem; color: var(--vscode-descriptionForeground); text-transform: uppercase; }
        .modal-readonly, .modal-input { width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid var(--border); border-radius: 3px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
        .modal-readonly { color: var(--vscode-descriptionForeground); }
        .setup-hint { color: var(--vscode-descriptionForeground); font-size: 0.82rem; line-height: 1.45; margin-top: 8px; }
        .setup-status { display: none; margin-top: 10px; font-size: 0.85rem; }
        .setup-status.success { color: #3fb950; }
        .setup-status.error { color: #ff7b72; }
        .setup-log { display: none; margin-top: 14px; border: 1px solid var(--border); border-radius: 6px; background: var(--vscode-textCodeBlock-background, var(--surface-soft)); max-height: 170px; overflow: auto; font-family: var(--vscode-editor-font-family); font-size: 0.76rem; line-height: 1.45; }
        .setup-log-header { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 7px 9px; border-bottom: 1px solid var(--border); color: var(--muted); font-family: var(--vscode-font-family); font-size: 0.75rem; }
        .setup-log-body { padding: 8px 9px; white-space: pre-wrap; }
        .setup-log-line { margin-bottom: 4px; }
        .setup-log-line.success { color: #3fb950; }
        .setup-log-line.error { color: #ff7b72; }
        .diff-container { flex: 1; overflow: auto; background: var(--vscode-editor-background); padding: 10px; border: 1px solid var(--border); margin-top: 15px; }
        .release-list-container { max-height: 220px; overflow-y: auto; border-bottom: 1px solid var(--border); }
        .release-list-container.is-collapsed { display: none; }
        .release-item, .pr-item { padding: 8px 10px; border-bottom: 1px solid var(--border); cursor: pointer; font-size: 0.85rem; }
        .release-item:hover, .pr-item:hover { background: var(--vscode-list-hoverBackground); }
        .release-item.drag-over { outline: 2px dashed var(--primary); outline-offset: -4px; }
        .ri-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ri-meta, .pr-meta { opacity: 0.75; font-size: 0.75rem; margin-top: 3px; }
        .btn-del { background: transparent; border: none; color: var(--vscode-descriptionForeground); cursor: pointer; font-size: 1rem; }
        .btn-del:hover { color: var(--vscode-errorForeground); }
        .commit-row-sm { padding: 5px 0; border-bottom: 1px solid var(--border); font-size: 0.85rem; }
        .notes-textarea { width: 100%; min-height: 160px; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--border); padding: 8px; font-family: var(--vscode-editor-font-family); }
        .conflict-file-list { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
        .conflict-file-btn { border: 1px solid var(--border); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); padding: 4px 8px; cursor: pointer; }
        .conflict-file-btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .conflict-editor { width: 100%; height: 45vh; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--border); font-family: var(--vscode-editor-font-family); padding: 10px; }

        @media (max-width: 920px) {
            header, .plan-header { align-items: stretch; flex-direction: column; }
            .plan-header { display: flex; }
            .ticket-entry { min-width: 0; justify-content: stretch; }
            .setup-steps { grid-template-columns: 1fr 1fr; }
        }

        /* diff2html professional VS Code theme integration */
        :root {
            --diff-bg: var(--vscode-editor-background);
            --diff-surface: var(--vscode-sideBar-background);
            --diff-line-bg: color-mix(in srgb, var(--vscode-editor-background) 94%, var(--vscode-foreground) 6%);
            --diff-gutter-bg: color-mix(in srgb, var(--vscode-editor-background) 90%, var(--vscode-foreground) 10%);
            --diff-empty-bg: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-foreground) 12%);
            --diff-text: var(--vscode-editor-foreground);
            --diff-muted: var(--vscode-descriptionForeground);
            --diff-added-bg: var(--vscode-diffEditor-insertedLineBackground, rgba(46, 160, 67, 0.16));
            --diff-added-gutter: color-mix(in srgb, var(--diff-added-bg) 70%, transparent);
            --diff-added-border: var(--vscode-diffEditor-insertedTextBorder, rgba(63, 185, 80, 0.55));
            --diff-added-token: var(--vscode-diffEditor-insertedTextBackground, rgba(46, 160, 67, 0.34));
            --diff-deleted-bg: var(--vscode-diffEditor-removedLineBackground, rgba(248, 81, 73, 0.14));
            --diff-deleted-gutter: color-mix(in srgb, var(--diff-deleted-bg) 70%, transparent);
            --diff-deleted-border: var(--vscode-diffEditor-removedTextBorder, rgba(248, 81, 73, 0.55));
            --diff-deleted-token: var(--vscode-diffEditor-removedTextBackground, rgba(248, 81, 73, 0.32));
            --d2h-bg-color: var(--diff-bg);
            --d2h-border-color: var(--border);
            --d2h-dim-color: var(--diff-muted);
            --d2h-line-border-color: var(--border);
            --d2h-file-header-bg-color: var(--diff-surface);
            --d2h-file-header-border-color: var(--border);
            --d2h-empty-placeholder-bg-color: var(--diff-empty-bg);
            --d2h-empty-placeholder-border-color: var(--border);
            --d2h-ins-bg-color: var(--diff-added-bg);
            --d2h-ins-border-color: var(--diff-added-border);
            --d2h-ins-highlight-bg-color: var(--diff-added-token);
            --d2h-ins-label-color: #3fb950;
            --d2h-del-bg-color: var(--diff-deleted-bg);
            --d2h-del-border-color: var(--diff-deleted-border);
            --d2h-del-highlight-bg-color: var(--diff-deleted-token);
            --d2h-del-label-color: #ff7b72;
            --d2h-info-bg-color: var(--vscode-editor-lineHighlightBackground, var(--diff-line-bg));
            --d2h-info-border-color: var(--border);
        }
        .d2h-wrapper,
        .d2h-file-diff,
        .d2h-file-side-diff,
        .d2h-diff-table,
        .d2h-diff-tbody,
        .d2h-code-line,
        .d2h-code-side-line {
            background-color: var(--diff-bg) !important;
            color: var(--diff-text) !important;
        }
        .d2h-file-wrapper {
            border: 1px solid var(--border) !important;
            border-radius: 6px !important;
            margin-bottom: 1em;
            overflow: hidden;
            background-color: var(--diff-bg) !important;
        }
        .d2h-file-header {
            background-color: var(--diff-surface) !important;
            border-bottom: 1px solid var(--border) !important;
            color: var(--vscode-foreground) !important;
        }
        .d2h-file-name-wrapper,
        .d2h-file-name {
            color: var(--vscode-foreground) !important;
        }
        .d2h-code-line-prefix {
            color: var(--diff-muted) !important;
            opacity: 0.85;
        }
        .d2h-code-line-ctn {
            color: var(--diff-text) !important;
        }
        .d2h-code-linenumber,
        .d2h-code-side-linenumber {
            background-color: var(--diff-gutter-bg) !important;
            border-color: var(--border) !important;
            color: var(--diff-muted) !important;
        }
        .diff-container .d2h-file-side-diff {
            overflow-x: auto !important;
        }
        .diff-container .d2h-code-side-line {
            align-items: stretch;
            display: inline-flex !important;
            min-width: 100%;
            padding: 0 !important;
            width: max-content !important;
        }
        .diff-container .d2h-code-side-linenumber {
            align-items: center;
            display: inline-flex !important;
            flex: 0 0 4em;
            justify-content: flex-end;
            padding: 0 0.5em;
            position: static !important;
        }
        .diff-container .d2h-code-side-line .d2h-code-line-prefix {
            flex: 0 0 auto;
            padding: 0 0.35em;
        }
        .diff-container .d2h-code-side-line .d2h-code-line-ctn {
            flex: 1 0 auto;
            min-width: 0;
        }
        .d2h-code-side-emptyplaceholder,
        .d2h-emptyplaceholder {
            background-color: var(--diff-empty-bg) !important;
            border-color: var(--border) !important;
        }
        .d2h-info {
            background-color: var(--vscode-editor-lineHighlightBackground, var(--diff-line-bg)) !important;
            color: var(--diff-muted) !important;
            border-color: var(--border) !important;
        }
        .d2h-ins {
            background-color: var(--diff-added-bg) !important;
            border-color: var(--diff-added-border) !important;
        }
        .d2h-ins .d2h-code-linenumber,
        .d2h-ins .d2h-code-side-linenumber {
            background-color: var(--diff-added-gutter) !important;
            color: var(--diff-muted) !important;
        }
        .d2h-del {
            background-color: var(--diff-deleted-bg) !important;
            border-color: var(--diff-deleted-border) !important;
        }
        .d2h-del .d2h-code-linenumber,
        .d2h-del .d2h-code-side-linenumber {
            background-color: var(--diff-deleted-gutter) !important;
            color: var(--diff-muted) !important;
        }
        .d2h-code-line ins,
        .d2h-code-side-line ins {
            background-color: var(--diff-added-token) !important;
            border-radius: 3px;
            color: var(--diff-text) !important;
        }
        .d2h-code-line del,
        .d2h-code-side-line del {
            background-color: var(--diff-deleted-token) !important;
            border-radius: 3px;
            color: var(--diff-text) !important;
        }
        .d2h-added-tag,
        .d2h-deleted-tag,
        .d2h-tag {
            background-color: var(--diff-bg) !important;
        }
    </style>
</head>
<body>
    <header>
        <div class="top-left">
            <div class="branch-flow">
                <span class="branch-label">Compare</span>
                <div class="branch-picker">
                    <span id="source-branch" class="branch-tag" title="Click to change source branch">...</span>
                    <span class="branch-arrow">→</span>
                    <span id="target-branch" class="branch-tag" title="Click to change target branch">...</span>
                </div>
            </div>
            <button class="btn btn-sec" id="refresh-btn" title="Compare branches and refresh commits">↻ Compare</button>
            <button class="ado-chip warning" id="ado-status-chip" title="Configure Azure DevOps connection">ADO: Checking...</button>
        </div>
        <div class="top-actions">
            <span id="action-status" style="font-size:0.8rem; color:#00875a; display:none; font-weight:bold;">Copied!</span>
            <button class="btn btn-sec" id="ai-prompt-btn" title="Generate AI Release Note Prompt">AI Notes</button>
            <button class="btn btn-sec" id="copy-cp-btn" title="Copy cherry-pick command for all planned commits">Copy Command</button>
            <button class="btn" id="show-release-modal-btn">Create Release</button>
        </div>
    </header>
    <div class="main-container">
        <div class="col-left">
            <div class="list-header">
                <div class="list-title">
                    <span>Active Releases</span>
                    <span class="list-kicker">Previously created plans</span>
                </div>
                <div class="section-actions">
                    <button class="btn btn-sec section-toggle" id="toggle-releases-btn" type="button" title="Expand active releases" aria-label="Expand active releases" aria-controls="release-list" aria-expanded="false"><span class="collapse-icon" aria-hidden="true"></span></button>
                    <button class="btn btn-sec section-refresh" id="refresh-releases-btn" title="Refresh releases">↻</button>
                </div>
            </div>
            <div id="release-list" class="release-list-container is-collapsed" hidden></div>
            <div class="list-header" style="margin-top: 8px;">
                <div class="list-title">
                    <span>Pull Requests</span>
                    <span class="list-kicker">From Azure DevOps</span>
                </div>
                <div class="section-actions">
                    <button class="btn btn-sec section-toggle" id="toggle-prs-btn" type="button" title="Expand pull requests" aria-label="Expand pull requests" aria-controls="pr-section" aria-expanded="false"><span class="collapse-icon" aria-hidden="true"></span></button>
                    <button class="btn btn-sec section-refresh" id="refresh-prs-btn" title="Refresh pull requests">↻</button>
                </div>
            </div>
            <div id="pr-section" class="release-list-container is-collapsed" hidden></div>
            <div class="list-header" style="display: block;">
                <div style="display:flex; justify-content:space-between; margin-bottom: 5px;">
                    <span>Unassigned Commits (<span id="pool-count">0</span>)</span>
                </div>
                <input id="commit-search" type="text" placeholder="Filter commits by message..." style="width:100%; box-sizing:border-box; padding:7px 8px; border:1px solid var(--border); border-radius:5px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); font-size:0.9rem;">
            </div>
            <div class="filter-controls">
                <button class="filter-btn active" id="filter-all">Show All</button>
                <button class="filter-btn" id="filter-pickable">Pickable Only</button>
            </div>
            <div id="commit-pool" class="commit-pool"></div>
        </div>
        <div class="col-right">
            <div class="plan-header">
                <div>
                    <h2 class="plan-title">Release Draft</h2>
                    <div class="plan-subtitle">Search ADO tickets, add manual placeholders, then drag commits into the right ticket.</div>
                </div>
                <div class="ticket-entry">
                    <div class="ticket-search-wrapper">
                        <input type="text" id="ticket-input" class="ticket-input" placeholder="Ticket ID, title, or manual note">
                        <div id="search-results" class="search-results"></div>
                    </div>
                    <button class="btn btn-sec" id="add-ticket-btn" title="Search for ticket in ADO">Search ADO</button>
                    <button class="btn btn-sec" id="add-manual-btn" title="Create a manual placeholder ticket">Manual</button>
                </div>
            </div>
            <div id="plan-board" class="plan-board"></div>
        </div>
    </div>

    <div class="modal-overlay" id="release-modal">
        <div class="modal">
            <h3>Create Release Branch</h3>
            <input type="text" id="rel-branch-name" style="width:100%; padding:8px; margin-bottom:15px;" value="release/${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_v1">
            <div style="text-align:right;">
                <button class="btn btn-sec" id="cancel-release-btn">Cancel</button>
                <button class="btn" id="confirm-release-btn">Confirm</button>
            </div>
        </div>
    </div>

    <div class="modal-overlay" id="ado-setup-modal">
        <div class="modal" style="width: 520px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 14px;">
                <h3 style="margin:0;">Azure DevOps Connection</h3>
                <button class="btn-del" id="close-ado-setup-btn">×</button>
            </div>
            <div class="modal-row">
                <label>Organization URL</label>
                <input id="ado-org-url" class="modal-readonly" readonly>
            </div>
            <div class="modal-row">
                <label>Project</label>
                <input id="ado-project" class="modal-readonly" readonly>
            </div>
            <div class="modal-row">
                <label>Repository ID or Name</label>
                <input id="ado-repo-id" class="modal-readonly" readonly>
            </div>
            <div class="modal-row">
                <label>Personal Access Token</label>
                <div style="display:flex; gap:8px;">
                    <input id="ado-token-input" class="modal-input" type="password" placeholder="Paste Azure DevOps PAT">
                    <button class="btn-sec" id="toggle-ado-token-btn" style="white-space:nowrap;">Show</button>
                </div>
                <div class="setup-hint">PAT is stored securely in VS Code Secrets. You can paste a raw PAT or an already Base64-encoded Basic token value.</div>
            </div>
            <div id="ado-setup-status" class="setup-status"></div>
            <div id="ado-test-log" class="setup-log" aria-live="polite">
                <div class="setup-log-header">
                    <span>Connection test log</span>
                    <button class="btn-sec" id="clear-ado-log-btn" style="padding:2px 6px;">Clear</button>
                </div>
                <div id="ado-test-log-body" class="setup-log-body"></div>
            </div>
            <div style="display:flex; justify-content:space-between; gap:8px; margin-top:18px;">
                <button class="btn-sec" id="open-ado-settings-btn">Open ADO Settings</button>
                <div style="display:flex; gap:8px;">
                    <button class="btn-sec" id="test-ado-btn">Test Connection</button>
                    <button class="btn" id="save-ado-token-btn">Save PAT</button>
                </div>
            </div>
        </div>
    </div>

    <div class="modal-overlay" id="diff-modal">
        <div class="modal large">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <h3 id="diff-title">Commit Diff</h3>
                <div style="display:flex; gap:10px;">
                    <button class="btn btn-sec" id="open-editor-btn">📂 Open in Editor</button>
                    <button class="btn btn-sec" id="close-diff-modal-btn">Close</button>
                </div>
            </div>
            <div id="diff-content" class="diff-container"></div>
        </div>
    </div>

    <div class="modal-overlay" id="release-details-modal">
        <div class="modal" style="width: 650px; max-height: 90vh; overflow-y: auto;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <h3 id="rd-title" style="margin:0;">Release Details</h3>
                <button class="btn-del" id="close-release-details-btn">×</button>
            </div>
            <div id="rd-commits" style="margin-top:12px; max-height:240px; overflow-y:auto;"></div>
            <h4>Release Notes</h4>
            <textarea id="release-notes-input" class="notes-textarea" placeholder="Release notes in Markdown"></textarea>
            <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:10px;">
                <span id="notes-save-status" style="display:none; align-self:center; color:#00875a;">Saved</span>
                <button class="btn" id="save-notes-btn">Save Notes</button>
            </div>
        </div>
    </div>

    <div class="modal-overlay" id="conflict-modal">
        <div class="modal large">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <h3 style="margin:0;">Cherry-pick Conflict</h3>
                    <div id="conflict-summary" class="ri-meta"></div>
                </div>
                <button class="btn-sec" id="abort-conflict-btn">Abort Cherry-pick</button>
            </div>
            <div id="conflict-files" class="conflict-file-list" style="margin-top:14px;"></div>
            <textarea id="conflict-editor" class="conflict-editor"></textarea>
            <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:10px;">
                <button class="btn" id="resolve-conflict-btn">Mark File Resolved</button>
            </div>
        </div>
    </div>

    <!-- Context Menu -->
    <div id="context-menu" class="context-menu">
        <ul>
            <li id="ctx-copy-body">Copy Commit Body</li>
            <li id="ctx-copy-diff">Copy Changes</li>
            <li id="ctx-toggle-avail">Mark as Unavailable</li>
            <li id="ctx-copy-hash">Copy Full Hash</li>
        </ul>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let allCommits = [];
        let commitMap = {};
        let mapping = {};
        let availabilityMap = {};
        let releaseHistory = {};
        let adoConfig = {};
        let targetBranch = '';
        let sourceBranch = '';
        let filterMode = 'all';
        let currentContextMenuHash = null;
        let currentReleaseName = null;
        let adoStatus = null;
        let activeConflictState = null;
        let selectedConflictFile = null;
        let pendingTicketDetailsResolve = null;
        let pendingCommitBodyResolve = null;
        let pendingPrDiffResolve = null;
        const savedWebviewState = vscode.getState() || {};
        let collapsedSections = {
            releases: savedWebviewState.collapsedSections?.releases ?? true,
            prs: savedWebviewState.collapsedSections?.prs ?? true
        };
        const collapsibleSectionConfig = {
            releases: {
                buttonId: 'toggle-releases-btn',
                containerId: 'release-list',
                label: 'active releases'
            },
            prs: {
                buttonId: 'toggle-prs-btn',
                containerId: 'pr-section',
                label: 'pull requests'
            }
        };

        window.addEventListener('click', () => {
            document.getElementById('context-menu').style.display = 'none';
            const results = document.getElementById('search-results');
            if (results) {
                results.style.display = 'none';
            }
        });

        window.addEventListener('message', event => {
            const message = event.data;
            switch(message.command) {
                case 'initData':
                    allCommits = message.commits;
                    commitMap = allCommits.reduce((acc, c) => { 
                        acc[c.hash] = { ...c }; 
                        return acc; 
                    }, {});
                    mapping = message.mapping;
                    availabilityMap = message.availability || {};
                    releaseHistory = message.releaseHistory || {};
                    adoConfig = message.adoConfig || {};
                    targetBranch = message.targetBranch;
                    sourceBranch = message.sourceBranch;
                    document.getElementById('source-branch').innerText = message.sourceBranch;
                    document.getElementById('target-branch').innerText = message.targetBranch;
                    document.getElementById('refresh-btn').innerText = '↻ Compare';
                    init();
                    loadPullRequests();
                    break;
                case 'error':
                    alert('Error: ' + message.message);
                    document.getElementById('refresh-btn').innerText = '↻ Compare';
                    break;
                case 'ticketDetailsBulk':
                    if (pendingTicketDetailsResolve) {
                        pendingTicketDetailsResolve(message.data || []);
                        pendingTicketDetailsResolve = null;
                    }
                    break;
                case 'commitBody':
                    if (pendingCommitBodyResolve) {
                        pendingCommitBodyResolve(message.data || '');
                        pendingCommitBodyResolve = null;
                    }
                    break;
                case 'prDiff':
                    if (pendingPrDiffResolve) {
                        pendingPrDiffResolve(message.data || '');
                        pendingPrDiffResolve = null;
                    }
                    break;
                case 'pullRequests':
                    renderPullRequests(message.data || []);
                    break;
                case 'searchResults':
                    renderSearchResults(message.data || []);
                    break;
                case 'adoStatus':
                    adoStatus = message.data;
                    renderAdoStatus(message.data);
                    if (message.message) {
                        showAdoSetupStatus(message.message, true);
                    }
                    break;
                case 'adoStatusResult':
                    showAdoSetupStatus(message.message, !!message.success);
                    break;
                case 'adoTestLog':
                    appendAdoTestLog(message);
                    break;
                case 'releaseDeleted':
                    showStatus('Release Deleted');
                    vscode.postMessage({ command: 'refreshData' });
                    break;
                case 'notesSaved':
                    document.getElementById('notes-save-status').style.display = 'inline';
                    setTimeout(() => document.getElementById('notes-save-status').style.display = 'none', 2000);
                    break;
                case 'ticketDetails':
                    const ticket = message.data;
                    addTicketToBoardFromData(ticket);
                    break;
                case 'releaseResult':
                    const data = message.data;
                    if (data.success) {
                        activeConflictState = null;
                        closeModal('conflict-modal');
                        alert('SUCCESS: ' + data.message);
                        closeModal('release-modal');
                        vscode.postMessage({ command: 'refreshData' });
                    } else if (data.requiresConfirmation) {
                        const riskMsg = data.risks.map(r => 
                            \`⚠️ File: \${r.file}\\n   Picked: \${r.pickedCommit.substring(0,7)}\\n   Skipped (Older): \${r.skippedCommit.substring(0,7)} ("\${r.skippedMessage}")\`
                        ).join('\\n\\n');
                        
                        if (confirm(\`DEPENDENCY RISK DETECTED!\\n\\n\${riskMsg}\\n\\nDo you want to proceed anyway?\`)) {
                            const branchName = document.getElementById('rel-branch-name').value;
                            let hashes = [];
                            document.querySelectorAll('.ticket-bucket').forEach(bucket => {
                                bucket.querySelectorAll('.commit-card').forEach(c => hashes.push(c.dataset.hash));
                            });

                            vscode.postMessage({ 
                                command: 'createRelease', 
                                branchName: branchName, 
                                hashes: hashes,
                                baseBranch: targetBranch,
                                force: true
                            });
                        }
                    } else if (data.requiresConflictResolution) {
                        activeConflictState = data.conflictState;
                        showConflictModal(activeConflictState);
                    } else {
                        alert('ERROR: ' + data.message);
                    }
                    break;
            }
        });

        function persistCollapsibleSectionState() {
            const currentState = vscode.getState() || {};
            vscode.setState({
                ...currentState,
                collapsedSections
            });
        }

        function setSectionCollapsed(section, collapsed, persist = true) {
            const config = collapsibleSectionConfig[section];
            if (!config) return;

            collapsedSections[section] = collapsed;

            const button = document.getElementById(config.buttonId);
            const container = document.getElementById(config.containerId);
            const action = collapsed ? 'Expand' : 'Collapse';

            if (container) {
                container.hidden = collapsed;
                container.classList.toggle('is-collapsed', collapsed);
            }

            if (button) {
                button.setAttribute('aria-expanded', String(!collapsed));
                button.title = action + ' ' + config.label;
                button.setAttribute('aria-label', action + ' ' + config.label);
            }

            if (persist) {
                persistCollapsibleSectionState();
            }
        }

        function toggleSection(section) {
            setSectionCollapsed(section, !collapsedSections[section]);
        }

        function syncCollapsibleSections() {
            Object.keys(collapsibleSectionConfig).forEach(section => {
                setSectionCollapsed(section, collapsedSections[section], false);
            });
        }

        function init() {
            const pool = document.getElementById('commit-pool');
            pool.innerHTML = '';
            const board = document.getElementById('plan-board');
            board.innerHTML = '';
            renderDraftPanel();
            
            const assignedHashes = new Set();
            Object.values(mapping).forEach(ticket => {
                if(ticket.commits) ticket.commits.forEach(h => assignedHashes.add(h));
            });

            let count = 0;
            allCommits.forEach(c => {
                if(!assignedHashes.has(c.hash)) {
                    pool.appendChild(createCommitEl(c));
                    count++;
                }
            });

            if (count === 0 && allCommits.length === 0) {
                pool.innerHTML = '<div class="empty-bucket"><strong>No branch differences</strong>No unique commits found between these branches.</div>';
            } else if (count === 0 && allCommits.length > 0) {
                pool.innerHTML = '<div class="empty-bucket"><strong>All commits assigned</strong>Every available commit is already in the release draft.</div>';
            }
            
            Object.values(mapping).forEach(t => {
                renderTicketBucket(t);
                const container = document.getElementById('content-' + t.id);
                if(t.commits) {
                    t.commits.forEach(h => {
                        if(commitMap[h]) {
                            const empty = container.querySelector('.empty-bucket');
                            if(empty) empty.remove();
                            container.appendChild(createCommitEl(commitMap[h]));
                        }
                    });
                }
            });
            updateCounts();
            renderReleaseList();
            setupDragAndDrop();
        }

        function renderDraftPanel() {
            const board = document.getElementById('plan-board');
            const panel = document.createElement('div');
            panel.id = 'draft-panel';
            panel.className = 'draft-panel';
            board.appendChild(panel);
            updateDraftSummary();
        }

        function updateDraftSummary() {
            const panel = document.getElementById('draft-panel');
            if (!panel) return;

            const tickets = Array.from(document.querySelectorAll('.ticket-bucket'));
            const plannedCommits = Array.from(document.querySelectorAll('.ticket-bucket .commit-card'));
            const hasAdo = !!(adoStatus && adoStatus.isConfigured && adoStatus.hasToken);

            if (tickets.length === 0) {
                panel.className = 'draft-panel is-empty';
                const connectLabel = hasAdo ? 'ADO Connected' : 'Connect Azure DevOps';
                const connectDisabled = hasAdo ? ' disabled' : '';
                panel.innerHTML =
                    '<h2 class="draft-title">Create a release</h2>' +
                    '<p class="draft-copy">Start by connecting Azure DevOps or adding a manual ticket, then compare branches and drag commits into the release draft.</p>' +
                    '<div class="setup-steps">' +
                        '<div class="setup-step"><strong>1. Connect</strong><span>Load pull requests and searchable ADO tickets.</span></div>' +
                        '<div class="setup-step"><strong>2. Compare</strong><span>Find commits that have not reached the target branch.</span></div>' +
                        '<div class="setup-step"><strong>3. Select</strong><span>Add tickets, then assign commits to each one.</span></div>' +
                        '<div class="setup-step"><strong>4. Release</strong><span>Generate notes, copy commands, or create the branch.</span></div>' +
                    '</div>' +
                    '<div class="draft-actions">' +
                        '<button class="btn" id="draft-connect-ado-btn"' + connectDisabled + '>' + connectLabel + '</button>' +
                        '<button class="btn btn-sec" id="draft-manual-btn">Add Manual Ticket</button>' +
                        '<button class="btn btn-sec" id="draft-compare-btn">Compare Branches</button>' +
                    '</div>';

                const connectBtn = document.getElementById('draft-connect-ado-btn');
                if (connectBtn && !hasAdo) {
                    connectBtn.addEventListener('click', showAdoSetupModal);
                }
                const manualBtn = document.getElementById('draft-manual-btn');
                if (manualBtn) {
                    manualBtn.addEventListener('click', () => {
                        document.getElementById('ticket-input').focus();
                    });
                }
                const compareBtn = document.getElementById('draft-compare-btn');
                if (compareBtn) {
                    compareBtn.addEventListener('click', refreshComparison);
                }
                return;
            }

            panel.className = 'draft-panel';
            panel.innerHTML =
                '<div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">' +
                    '<div>' +
                        '<h2 class="draft-title">Release Draft</h2>' +
                        '<p class="draft-copy">Review the selected tickets and commits before creating the release branch.</p>' +
                    '</div>' +
                    '<div class="draft-actions">' +
                        '<button class="btn btn-sec" id="draft-ai-notes-btn">AI Notes</button>' +
                        '<button class="btn btn-sec" id="draft-copy-command-btn">Copy Command</button>' +
                        '<button class="btn" id="draft-create-release-btn">Create Release</button>' +
                    '</div>' +
                '</div>' +
                '<div class="draft-metrics">' +
                    '<div class="metric"><div class="metric-value">' + tickets.length + '</div><div class="metric-label">Tickets selected</div></div>' +
                    '<div class="metric"><div class="metric-value">' + plannedCommits.length + '</div><div class="metric-label">Commits planned</div></div>' +
                    '<div class="metric"><div class="metric-value">' + document.getElementById('pool-count').innerText + '</div><div class="metric-label">Unassigned commits</div></div>' +
                '</div>';

            document.getElementById('draft-ai-notes-btn').addEventListener('click', generateAiPrompt);
            document.getElementById('draft-copy-command-btn').addEventListener('click', copyLocalCherryPick);
            document.getElementById('draft-create-release-btn').addEventListener('click', showReleaseModal);
        }

        function renderReleaseList() {
            const container = document.getElementById('release-list');
            container.innerHTML = '';
            const entries = Object.entries(releaseHistory).sort((a, b) => {
                const aDate = new Date(a[1].created || 0).getTime();
                const bDate = new Date(b[1].created || 0).getTime();
                return bDate - aDate;
            });

            if (entries.length === 0) {
                container.innerHTML = '<div class="empty-bucket" style="margin:8px;"><strong>No releases yet</strong>Created release branches will appear here.</div>';
                return;
            }

            entries.forEach(([name, data]) => {
                const div = document.createElement('div');
                div.className = 'release-item';
                div.innerHTML =
                    '<div style="display:flex; justify-content:space-between; gap:8px;">' +
                        '<div style="min-width:0;">' +
                            '<div class="ri-name"></div>' +
                            '<div class="ri-meta"></div>' +
                        '</div>' +
                        '<button class="btn-del" title="Delete release history">×</button>' +
                    '</div>';
                div.querySelector('.ri-name').innerText = name;
                const count = data.commits ? data.commits.length : 0;
                const dateText = data.created ? new Date(data.created).toLocaleDateString() : 'No date';
                div.querySelector('.ri-meta').innerText = dateText + ' · ' + count + ' commits';
                div.querySelector('.btn-del').addEventListener('click', (event) => {
                    event.stopPropagation();
                    deleteRelease(name);
                });
                div.addEventListener('click', () => showReleaseDetails(name, data));
                div.addEventListener('dragover', (event) => {
                    event.preventDefault();
                    div.classList.add('drag-over');
                });
                div.addEventListener('dragleave', () => div.classList.remove('drag-over'));
                div.addEventListener('drop', (event) => dropToRelease(event, name));
                container.appendChild(div);
            });
        }

        function addTicketToBoardFromData(ticket) {
            if (!ticket || !ticket.id || document.getElementById('ticket-' + ticket.id)) {
                return;
            }
            renderTicketBucket(ticket);
            const pool = document.getElementById('commit-pool');
            const container = document.getElementById('content-' + ticket.id);
            allCommits.forEach(c => {
                if (c.workItemNumber == ticket.id) {
                    const el = document.getElementById('c-' + c.hash);
                    if (el && el.parentElement === pool) {
                        const empty = container.querySelector('.empty-bucket');
                        if (empty) empty.remove();
                        container.appendChild(el);
                    }
                }
            });
            document.getElementById('search-results').style.display = 'none';
            updateCounts();
            saveState();
        }

        function renderSearchResults(results) {
            const resultsDiv = document.getElementById('search-results');
            resultsDiv.innerHTML = '';
            if (!results || results.length === 0) {
                resultsDiv.innerHTML = '<div class="search-item">No results found</div>';
                resultsDiv.style.display = 'block';
                return;
            }

            results.slice(0, 10).forEach(item => {
                const div = document.createElement('div');
                div.className = 'search-item';
                div.innerHTML = '<strong></strong><div></div><small></small>';
                div.querySelector('strong').innerText = '#' + item.id;
                div.querySelector('div').innerText = item.title || 'Untitled';
                div.querySelector('small').innerText = item.state || '';
                div.addEventListener('click', () => {
                    addTicketToBoardFromData(item);
                    document.getElementById('ticket-input').value = '';
                });
                resultsDiv.appendChild(div);
            });
            resultsDiv.style.display = 'block';
        }

        function showReleaseDetails(name, data) {
            currentReleaseName = name;
            document.getElementById('rd-title').innerText = name;
            document.getElementById('release-notes-input').value = data.notes || '';
            const list = document.getElementById('rd-commits');
            list.innerHTML = '';
            const commits = data.commits || [];
            if (commits.length === 0) {
                list.innerHTML = '<div class="empty-bucket">No commits recorded.</div>';
            } else {
                commits.forEach(hash => {
                    const row = document.createElement('div');
                    row.className = 'commit-row-sm';
                    const commit = commitMap[hash];
                    row.innerText = hash.substring(0, 7) + '  ' + (commit ? commit.message : '(Commit not in current comparison)');
                    list.appendChild(row);
                });
            }
            document.getElementById('release-details-modal').style.display = 'flex';
        }

        function deleteRelease(name) {
            if (!confirm('Delete release history for "' + name + '"? This does not delete the git branch.')) return;
            vscode.postMessage({ command: 'deleteRelease', branchName: name });
        }

        function saveReleaseNotes() {
            if (!currentReleaseName) return;
            const notes = document.getElementById('release-notes-input').value;
            vscode.postMessage({ command: 'saveReleaseNotes', branchName: currentReleaseName, notes });
            if (releaseHistory[currentReleaseName]) {
                releaseHistory[currentReleaseName].notes = notes;
            }
        }

        function dropToRelease(ev, branchName) {
            ev.preventDefault();
            ev.currentTarget.classList.remove('drag-over');
            const dataId = ev.dataTransfer.getData('text');
            if (!dataId || !dataId.startsWith('c-')) return;
            const el = document.getElementById(dataId);
            if (!el) return;
            const hash = el.dataset.hash;
            if (!confirm('Append commit ' + hash.substring(0, 7) + ' to release "' + branchName + '"?')) return;
            vscode.postMessage({ command: 'appendRelease', branchName, hashes: [hash], baseBranch: targetBranch });
        }

        function loadPullRequests() {
            const container = document.getElementById('pr-section');
            if (!adoStatus || !adoStatus.isConfigured || !adoStatus.hasToken) {
                container.innerHTML =
                    '<div class="empty-bucket" style="margin:8px;">' +
                    '<strong>Azure DevOps is not connected</strong>' +
                    'Connect to view pull requests linked to this branch.' +
                    '<br><button class="btn btn-sec empty-action" id="connect-ado-inline-btn">Connect Azure DevOps</button>' +
                    '</div>';
                const btn = document.getElementById('connect-ado-inline-btn');
                if (btn) {
                    btn.addEventListener('click', showAdoSetupModal);
                }
                return;
            }
            container.innerHTML = '<div class="empty-bucket" style="margin:8px;">Loading pull requests...</div>';
            vscode.postMessage({ command: 'getPullRequests', targetBranch });
        }

        function renderPullRequests(prs) {
            const container = document.getElementById('pr-section');
            container.innerHTML = '';
            if (!prs || prs.length === 0) {
                container.innerHTML = '<div class="empty-bucket" style="margin:8px;"><strong>No pull requests found</strong>Try changing the compared branches or refreshing ADO.</div>';
                return;
            }

            prs.forEach(pr => {
                const div = document.createElement('div');
                div.className = 'pr-item';
                div.innerHTML =
                    '<div style="display:flex; justify-content:space-between; gap:8px;">' +
                        '<div style="min-width:0;">' +
                            '<div class="ri-name"></div>' +
                            '<div class="pr-meta"></div>' +
                        '</div>' +
                        '<button class="btn-sec copy-pr-diff-btn" style="white-space:nowrap;">Copy Diff</button>' +
                    '</div>';
                div.querySelector('.ri-name').innerText = '#' + pr.id + ' ' + pr.title;
                div.querySelector('.pr-meta').innerText = pr.status + ' · ' + pr.sourceBranch + ' → ' + pr.targetBranch;
                div.querySelector('.copy-pr-diff-btn').addEventListener('click', (event) => {
                    event.stopPropagation();
                    copyPRChanges(pr.sourceBranch, pr.targetBranch);
                });
                div.addEventListener('click', () => {
                    if (pr.url) {
                        window.location.href = pr.url;
                    }
                });
                container.appendChild(div);
            });
        }

        function requestTicketDetailsBulk(ids) {
            return new Promise(resolve => {
                pendingTicketDetailsResolve = resolve;
                vscode.postMessage({ command: 'getTicketDetailsBulk', ids });
                setTimeout(() => {
                    if (pendingTicketDetailsResolve === resolve) {
                        pendingTicketDetailsResolve = null;
                        resolve([]);
                    }
                }, 10000);
            });
        }

        function requestCommitBody(hash) {
            return new Promise(resolve => {
                pendingCommitBodyResolve = resolve;
                vscode.postMessage({ command: 'getCommitBody', hash });
                setTimeout(() => {
                    if (pendingCommitBodyResolve === resolve) {
                        pendingCommitBodyResolve = null;
                        resolve('');
                    }
                }, 5000);
            });
        }

        function requestPRDiff(source, target) {
            return new Promise(resolve => {
                pendingPrDiffResolve = resolve;
                vscode.postMessage({ command: 'getPRDiff', source, target });
                setTimeout(() => {
                    if (pendingPrDiffResolve === resolve) {
                        pendingPrDiffResolve = null;
                        resolve('');
                    }
                }, 15000);
            });
        }

        function renderAdoStatus(status) {
            const chip = document.getElementById('ado-status-chip');
            const searchBtn = document.getElementById('add-ticket-btn');
            const aiPromptBtn = document.getElementById('ai-prompt-btn');
            chip.classList.remove('connected', 'warning', 'error');

            if (!status || !status.isConfigured) {
                chip.innerText = 'ADO: Settings Missing';
                chip.classList.add('error');
                searchBtn.disabled = true;
                aiPromptBtn.disabled = true;
            } else if (!status.hasToken) {
                chip.innerText = 'ADO: PAT Missing';
                chip.classList.add('warning');
                searchBtn.disabled = true;
                aiPromptBtn.disabled = true;
            } else {
                chip.innerText = 'ADO: Connected';
                chip.classList.add('connected');
                searchBtn.disabled = false;
                aiPromptBtn.disabled = false;
            }

            document.getElementById('ado-org-url').value = status?.orgUrl || 'Not configured';
            document.getElementById('ado-project').value = status?.project || 'Not configured';
            document.getElementById('ado-repo-id').value = status?.repoId || 'Not configured';
            updateDraftSummary();
        }

        function showAdoSetupModal() {
            renderAdoStatus(adoStatus || {});
            document.getElementById('ado-token-input').value = '';
            document.getElementById('ado-setup-status').style.display = 'none';
            document.getElementById('ado-setup-modal').style.display = 'flex';
            vscode.postMessage({ command: 'getAdoStatus' });
        }

        function showAdoSetupStatus(message, success) {
            const status = document.getElementById('ado-setup-status');
            status.innerText = message || '';
            status.classList.toggle('success', success);
            status.classList.toggle('error', !success);
            status.style.display = message ? 'block' : 'none';
            if (!document.getElementById('ado-setup-modal').style.display || document.getElementById('ado-setup-modal').style.display === 'none') {
                showStatus(message, !success);
            }
        }

        function appendAdoTestLog(entry) {
            const log = document.getElementById('ado-test-log');
            const body = document.getElementById('ado-test-log-body');
            if (!log || !body) return;

            if (entry.clear) {
                body.innerHTML = '';
            }

            const line = document.createElement('div');
            line.className = 'setup-log-line ' + (entry.level || 'info');
            line.innerText = '[' + (entry.timestamp || new Date().toLocaleTimeString()) + '] ' + (entry.message || '');
            body.appendChild(line);
            log.style.display = 'block';
            log.scrollTop = log.scrollHeight;
        }

        function clearAdoTestLog() {
            const body = document.getElementById('ado-test-log-body');
            const log = document.getElementById('ado-test-log');
            if (body) {
                body.innerHTML = '';
            }
            if (log) {
                log.style.display = 'none';
            }
        }

        function saveAdoToken() {
            const token = document.getElementById('ado-token-input').value.trim();
            if (!token) {
                showAdoSetupStatus('Enter an Azure DevOps PAT before saving.', false);
                return;
            }
            vscode.postMessage({ command: 'saveAdoToken', token });
        }

        function testAdoConnection() {
            appendAdoTestLog({ clear: true, level: 'info', message: 'Preparing connection test...', timestamp: new Date().toLocaleTimeString() });
            vscode.postMessage({ command: 'testAdoConnection' });
        }

        function createCommitEl(c) {
            const el = document.createElement('div');
            const isExcluded = availabilityMap[c.hash] === 'unavailable';
            const hasDiff = c.diff && c.diff.length > 0;
            const isOverridden = !!c.isOverridden;
            const isPickable = !isExcluded && !isOverridden && hasDiff;
            
            el.className = 'commit-card' + (isPickable ? '' : ' non-pickable') + (hasDiff ? '' : ' disabled') + (isExcluded ? ' user-excluded' : '');
            
            // Consistent dimming for all non-pickable states
            if (!isPickable) {
                el.style.opacity = '0.5';
            }
            
            el.draggable = true;
            el.id = 'c-' + c.hash;
            el.dataset.hash = c.hash;
            el.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData("text", ev.target.id); });
            el.addEventListener('click', () => {
                if (hasDiff) showDiff(c);
            });
            
            // Context Menu
            el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                currentContextMenuHash = c.hash;
                const menu = document.getElementById('context-menu');
                const toggleBtn = document.getElementById('ctx-toggle-avail');
                toggleBtn.innerText = availabilityMap[c.hash] === 'unavailable' ? 'Mark as Available' : 'Mark as Unavailable';
                menu.style.display = 'block';
                menu.style.left = e.pageX + 'px';
                menu.style.top = e.pageY + 'px';
            });

            const workItemBaseUrl = \`\${adoConfig.orgUrl}/\${adoConfig.project}/_workitems/edit/\`;
            let adolink = '';
            if (c.workItemNumber && /^\d+$/.test(c.workItemNumber)) {
                adolink = \`<a href="\${workItemBaseUrl}\${c.workItemNumber}/" class="c-link" onclick="event.stopPropagation()">#\${c.workItemNumber} ↗</a>\`;
            }

            el.innerHTML = \`
                <div class="c-msg"></div>
                <div class="c-meta">
                    <div>
                        <span class="c-tag"></span>
                        \${adolink}
                    </div>
                    \${c.isOverridden ? '<span class="c-tag" style="background:#666; color:white;">Overridden</span>' : ''}
                    \${isExcluded ? '<span class="excluded-badge">Unavailable</span>' : ''}
                    <span class="c-author"></span>
                </div>
            \`;
            el.querySelector('.c-msg').innerText = c.message;
            el.querySelector('.c-tag').innerText = c.hash.substring(0,7);
            el.querySelector('.c-author').innerText = c.author;
            return el;
        }

        let selectedHash = null;

        function showDiff(c) {
            if (selectedHash) {
                const prev = document.getElementById('c-' + selectedHash);
                if (prev) prev.classList.remove('selected');
            }
            selectedHash = c.hash;
            const el = document.getElementById('c-' + c.hash);
            if (el) el.classList.add('selected');

            const modal = document.getElementById('diff-modal');
            const content = document.getElementById('diff-content');
            const title = document.getElementById('diff-title');
            
            title.innerText = \`Diff for: \${c.message.substring(0, 50)}\${c.message.length > 50 ? '...' : ''}\`;
            content.innerHTML = '';
            
            const diff2htmlUi = new Diff2HtmlUI(content, c.diff, {
                drawFileList: true,
                matching: 'lines',
                outputFormat: 'side-by-side',
                renderNothingWhenEmpty: false
            });
            diff2htmlUi.draw();
            
            // Setup Open in Editor button
            const openBtn = document.getElementById('open-editor-btn');
            const newOpenBtn = openBtn.cloneNode(true);
            openBtn.parentNode.replaceChild(newOpenBtn, openBtn);
            newOpenBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'openDiff', hash: c.hash, diff: c.diff, message: c.message });
            });

            modal.style.display = 'flex';
        }

        function renderTicketBucket(t) {
            const board = document.getElementById('plan-board');
            const div = document.createElement('div');
            div.className = 'ticket-bucket';
            div.id = 'ticket-' + t.id;
            div.innerHTML = \`
                <div class="tb-header">
                    <div class="tb-title"></div>
                    <button class="btn-sec remove-ticket-btn">×</button>
                </div>
                <div class="tb-content">
                    <div class="empty-bucket">Drag commits here</div>
                </div>
            \`;
            div.querySelector('.tb-content').id = 'content-' + t.id;
            const displayId = t.id.startsWith('MANUAL-') ? 'Manual' : '#' + t.id;
            div.querySelector('.tb-title').innerText = \`\${displayId} - \${t.title}\`;
            div.querySelector('.remove-ticket-btn').addEventListener('click', () => {
                div.remove();
                saveState();
                init(); // Refresh pool
            });
            
            const content = div.querySelector('.tb-content');
            content.addEventListener('dragover', allowDrop);
            content.addEventListener('drop', (ev) => drop(ev, 'ticket', t.id));
            
            board.appendChild(div);
        }

        function setupDragAndDrop() {
            const pool = document.getElementById('commit-pool');
            pool.addEventListener('dragover', allowDrop);
            pool.addEventListener('drop', (ev) => drop(ev, 'pool'));
        }

        function allowDrop(ev) { ev.preventDefault(); }
        
        function drop(ev, targetType, ticketId) {
            ev.preventDefault();
            const data = ev.dataTransfer.getData("text");
            const el = document.getElementById(data);
            if(!el) return;
            
            if (targetType === 'pool') {
                document.getElementById('commit-pool').appendChild(el);
            } else {
                const container = document.getElementById('content-' + ticketId);
                const empty = container.querySelector('.empty-bucket');
                if(empty) empty.remove();
                container.appendChild(el);
            }
            updateCounts();
            saveState();
        }

        function saveState() {
            const newMapping = {};
            document.querySelectorAll('.ticket-bucket').forEach(bucket => {
                const id = bucket.id.replace('ticket-', '');
                const titleText = bucket.querySelector('.tb-title').innerText;
                const title = titleText.substring(titleText.indexOf(' - ') + 3);
                const commits = [];
                bucket.querySelectorAll('.commit-card').forEach(c => commits.push(c.dataset.hash));
                newMapping[id] = { id, title, commits };
            });
            mapping = newMapping;
            vscode.postMessage({ command: 'saveMapping', data: newMapping });
        }

        function showStatus(text, isError = false) {
            const status = document.getElementById('action-status');
            status.innerText = text;
            status.style.color = isError ? '#de350b' : '#00875a';
            status.style.display = 'inline-block';
            setTimeout(() => {
                status.style.display = 'none';
            }, 3000);
        }

        function stripHtml(html) {
            const div = document.createElement('div');
            div.innerHTML = html || '';
            return (div.textContent || div.innerText || '').replace(/\\n\\s*\\n/g, '\\n').trim();
        }

        function copyLocalCherryPick() {
            let hashes = [];
            document.querySelectorAll('.ticket-bucket').forEach(bucket => {
                bucket.querySelectorAll('.commit-card').forEach(c => {
                    const hash = c.dataset.hash;
                    if (commitMap[hash]) {
                        hashes.push(commitMap[hash]);
                    }
                });
            });

            if(hashes.length === 0) return alert('No commits planned in any tickets.');

            // Sort by date ascending to ensure correct order
            hashes.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

            const hashString = [...new Set(hashes.map(h => h.hash))].join(' ');
            const command = \`git cherry-pick \${hashString}\`;

            navigator.clipboard.writeText(command).then(() => {
                showStatus('Command Copied!');
            }).catch(err => {
                console.error('Copy failed', err);
                showStatus('Copy Failed', true);
            });
        }

        async function generateAiPrompt() {
            if (!adoStatus || !adoStatus.isConfigured || !adoStatus.hasToken) {
                showAdoSetupModal();
                return;
            }

            const ticketIds = Object.keys(mapping);
            if(ticketIds.length === 0) return alert('No tickets planned.');

            const btn = document.getElementById('ai-prompt-btn');
            const originalText = btn.innerText;
            btn.innerText = '⌛ Fetching...';
            btn.disabled = true;

            try {
                const adoIds = ticketIds.filter(id => !id.startsWith('MANUAL-'));
                let ticketsDetails = [];

                if (adoIds.length > 0) {
                    ticketsDetails = await requestTicketDetailsBulk(adoIds);
                }

                const detailById = ticketsDetails.reduce((acc, ticket) => {
                    acc[String(ticket.id)] = ticket;
                    return acc;
                }, {});

                let prompt = "Act as a Senior Release Manager. Create professional Release Notes based on the following tickets.\\n\\n";
                prompt += "Formatting Rules:\\n";
                prompt += "- Use Markdown format.\\n";
                prompt += "- Group by Ticket Type (e.g., Feature, Bug Fix).\\n";
                prompt += "- Summarize the technical description into user-friendly language.\\n";
                prompt += "- Do not include internal technical jargon unless necessary.\\n\\n";
                prompt += "--- TICKET DATA ---\\n\\n";

                Object.values(mapping).forEach(t => {
                    const details = detailById[String(t.id)] || {};
                    const type = details.type ? ' (' + details.type + ')' : '';
                    const description = stripHtml(details.description || '').substring(0, 1500);
                    prompt += \`Ticket: #\${t.id}\${type}\\n\`;
                    prompt += \`Title: \${details.title || t.title}\\n\`;
                    if (description) {
                        prompt += \`Context/Description: \${description}\\n\`;
                    }
                    prompt += "--------------------------------------------------\\n\\n";
                });

                navigator.clipboard.writeText(prompt).then(() => {
                    showStatus('Prompt Copied!');
                });
            } catch (e) {
                showStatus('Error generating prompt', true);
            } finally {
                btn.innerText = originalText;
                btn.disabled = false;
            }
        }

        function toggleCommitAvailability() {
            if (!currentContextMenuHash) return;
            const newState = availabilityMap[currentContextMenuHash] === 'unavailable' ? 'available' : 'unavailable';
            if (newState === 'unavailable') {
                availabilityMap[currentContextMenuHash] = 'unavailable';
            } else {
                delete availabilityMap[currentContextMenuHash];
            }
            
            vscode.postMessage({ command: 'saveAvailability', data: availabilityMap, targetBranch });
            
            // Refresh element
            const el = document.getElementById('c-' + currentContextMenuHash);
            if (el) {
                const newEl = createCommitEl(commitMap[currentContextMenuHash]);
                el.replaceWith(newEl);
            }
            applyFilters();
        }

        function copyFullHash() {
            if (!currentContextMenuHash) return;
            navigator.clipboard.writeText(currentContextMenuHash).then(() => {
                showStatus('Hash Copied!');
            });
        }

        async function copyCommitBody() {
            if (!currentContextMenuHash) return;
            const body = await requestCommitBody(currentContextMenuHash);
            if (!body) {
                showStatus('No commit body', true);
                return;
            }
            navigator.clipboard.writeText(body).then(() => showStatus('Body Copied!'));
        }

        function copyChanges() {
            if (!currentContextMenuHash) return;
            const commit = commitMap[currentContextMenuHash];
            if (!commit || !commit.diff) {
                showStatus('No diff available', true);
                return;
            }
            navigator.clipboard.writeText(commit.diff).then(() => showStatus('Diff Copied!'));
        }

        async function copyPRChanges(source, target) {
            const diff = await requestPRDiff(source, target);
            if (!diff || diff.startsWith('Error')) {
                showStatus('PR diff failed', true);
                return;
            }
            navigator.clipboard.writeText(diff).then(() => showStatus('PR Diff Copied!'));
        }

        function showConflictModal(state) {
            if (!state) return;
            activeConflictState = state;
            document.getElementById('conflict-summary').innerText =
                state.branchName + ' · commit ' + state.currentCommit.substring(0, 7) +
                ' · completed ' + state.completedCommits + '/' + state.totalCommits;

            const files = document.getElementById('conflict-files');
            files.innerHTML = '';
            (state.conflictingFiles || []).forEach(file => {
                const btn = document.createElement('button');
                btn.className = 'conflict-file-btn';
                btn.innerText = file;
                btn.addEventListener('click', () => selectConflictFile(file));
                files.appendChild(btn);
            });

            const first = state.conflictingFiles && state.conflictingFiles[0];
            if (first) {
                selectConflictFile(first);
            }
            document.getElementById('conflict-modal').style.display = 'flex';
        }

        function selectConflictFile(file) {
            selectedConflictFile = file;
            document.querySelectorAll('.conflict-file-btn').forEach(btn => {
                btn.classList.toggle('active', btn.innerText === file);
            });
            document.getElementById('conflict-editor').value = (activeConflictState.fileContents || {})[file] || '';
        }

        function resolveSelectedConflict() {
            if (!activeConflictState || !selectedConflictFile) return;
            const resolvedContent = document.getElementById('conflict-editor').value;
            vscode.postMessage({
                command: 'resolveConflict',
                filename: selectedConflictFile,
                resolvedContent
            });
        }

        function setFilterMode(mode) {
            filterMode = mode;
            document.querySelectorAll('.filter-btn').forEach(btn => {
                btn.classList.toggle('active', btn.id === 'filter-' + mode);
            });
            applyFilters();
        }

        function applyFilters() {
            const val = document.getElementById('commit-search').value.toLowerCase();
            document.querySelectorAll('#commit-pool .commit-card').forEach(el => {
                const hash = el.dataset.hash;
                const commitData = commitMap[hash];
                
                const txt = el.innerText.toLowerCase();
                const isUserExcluded = availabilityMap[hash] === 'unavailable';
                const hasDiff = commitData && commitData.diff && commitData.diff.length > 0;
                const isOverridden = commitData && !!commitData.isOverridden;
                
                const matchesSearch = txt.includes(val);
                let matchesMode = true;
                
                if (filterMode === 'pickable') {
                    // Unified logic: anything dimmed in 'Show All' is hidden in 'Pickable Only'
                    const isPickable = !isUserExcluded && !isOverridden && hasDiff;
                    if (!isPickable) {
                        matchesMode = false;
                    }
                }
                
                el.style.display = (matchesSearch && matchesMode) ? 'block' : 'none';
            });
            updateCounts();
        }

        function searchTicketADO() {
            if (!adoStatus || !adoStatus.isConfigured || !adoStatus.hasToken) {
                showAdoSetupModal();
                return;
            }

            const input = document.getElementById('ticket-input');
            const id = input.value.trim().replace('#', '');
            if (!id) return;
            // If it looks like a manual ID, just add it directly
            if (id.startsWith('MANUAL-')) {
                return; 
            }
            if (/^\\d+$/.test(id)) {
                vscode.postMessage({ command: 'lookupTicket', id: id });
                input.value = '';
            } else {
                vscode.postMessage({ command: 'searchTickets', query: id });
            }
        }

        function addManualTicket() {
            console.log('[ReleaseWebview] addManualTicket called');
            const input = document.getElementById('ticket-input');
            const title = input.value.trim();
            if (!title) {
                alert('Please enter a title or description for the manual ticket.');
                return;
            }
            const id = 'MANUAL-' + Date.now();
            renderTicketBucket({ id, title, state: 'Manual' });
            updateCounts();
            saveState();
            input.value = '';
        }

        function showReleaseModal() { document.getElementById('release-modal').style.display = 'flex'; }
        function closeModal(id) { document.getElementById(id).style.display = 'none'; }
        function updateCounts() {
            document.getElementById('pool-count').innerText = document.getElementById('commit-pool').querySelectorAll('.commit-card').length;
            updateDraftSummary();
        }

        function refreshComparison() {
            document.getElementById('refresh-btn').innerText = 'Comparing...';
            vscode.postMessage({ command: 'refreshData' });
        }

        // Setup all event listeners
        function setupEventListeners() {
            document.getElementById('ticket-input').addEventListener('keyup', (e) => {
                if(e.key === 'Enter') searchTicketADO();
            });

            document.getElementById('commit-search').addEventListener('keyup', applyFilters);

            document.getElementById('filter-all').addEventListener('click', () => setFilterMode('all'));
            document.getElementById('filter-pickable').addEventListener('click', () => setFilterMode('pickable'));

            document.getElementById('ctx-copy-body').addEventListener('click', copyCommitBody);
            document.getElementById('ctx-copy-diff').addEventListener('click', copyChanges);
            document.getElementById('ctx-toggle-avail').addEventListener('click', toggleCommitAvailability);
            document.getElementById('ctx-copy-hash').addEventListener('click', copyFullHash);

            document.getElementById('add-ticket-btn').addEventListener('click', searchTicketADO);
            document.getElementById('add-manual-btn').addEventListener('click', addManualTicket);
            document.getElementById('ai-prompt-btn').addEventListener('click', generateAiPrompt);
            document.getElementById('copy-cp-btn').addEventListener('click', copyLocalCherryPick);

            document.getElementById('confirm-release-btn').addEventListener('click', () => {
                const branchName = document.getElementById('rel-branch-name').value;
                let hashes = [];
                document.querySelectorAll('.ticket-bucket').forEach(bucket => {
                    bucket.querySelectorAll('.commit-card').forEach(c => hashes.push(c.dataset.hash));
                });

                if(hashes.length === 0) return alert('No commits selected for release.');
                hashes = [...new Set(hashes.map(hash => commitMap[hash]).filter(Boolean).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).map(c => c.hash))];

                vscode.postMessage({ 
                    command: 'createRelease', 
                    branchName, 
                    hashes,
                    baseBranch: targetBranch
                });
            });

            document.getElementById('cancel-release-btn').addEventListener('click', () => closeModal('release-modal'));
            document.getElementById('show-release-modal-btn').addEventListener('click', showReleaseModal);
            document.getElementById('close-diff-modal-btn').addEventListener('click', () => closeModal('diff-modal'));
            document.getElementById('close-release-details-btn').addEventListener('click', () => closeModal('release-details-modal'));
            document.getElementById('save-notes-btn').addEventListener('click', saveReleaseNotes);
            document.getElementById('toggle-releases-btn').addEventListener('click', () => toggleSection('releases'));
            document.getElementById('refresh-releases-btn').addEventListener('click', () => renderReleaseList());
            document.getElementById('toggle-prs-btn').addEventListener('click', () => toggleSection('prs'));
            document.getElementById('refresh-prs-btn').addEventListener('click', loadPullRequests);
            document.getElementById('ado-status-chip').addEventListener('click', showAdoSetupModal);
            document.getElementById('close-ado-setup-btn').addEventListener('click', () => closeModal('ado-setup-modal'));
            document.getElementById('open-ado-settings-btn').addEventListener('click', () => vscode.postMessage({ command: 'openAdoSettings' }));
            document.getElementById('save-ado-token-btn').addEventListener('click', saveAdoToken);
            document.getElementById('test-ado-btn').addEventListener('click', testAdoConnection);
            document.getElementById('clear-ado-log-btn').addEventListener('click', clearAdoTestLog);
            document.getElementById('toggle-ado-token-btn').addEventListener('click', () => {
                const input = document.getElementById('ado-token-input');
                const button = document.getElementById('toggle-ado-token-btn');
                const shouldShow = input.type === 'password';
                input.type = shouldShow ? 'text' : 'password';
                button.innerText = shouldShow ? 'Hide' : 'Show';
            });
            document.getElementById('resolve-conflict-btn').addEventListener('click', resolveSelectedConflict);
            document.getElementById('abort-conflict-btn').addEventListener('click', () => {
                if (confirm('Abort the current cherry-pick?')) {
                    vscode.postMessage({ command: 'abortCherryPick' });
                }
            });

            document.getElementById('source-branch').addEventListener('click', () => {
                vscode.postMessage({ command: 'selectBranch', type: 'source' });
            });
            document.getElementById('target-branch').addEventListener('click', () => {
                vscode.postMessage({ command: 'selectBranch', type: 'target' });
            });

            document.getElementById('refresh-btn').addEventListener('click', refreshComparison);
        }

        // Initialize
        setupEventListeners();
        syncCollapsibleSections();

        // Signal that webview is ready to receive data
        vscode.postMessage({ command: 'webviewReady' });
    </script>
</body>
</html>`;
    }

    public dispose() {
        ReleaseWebviewPanel.currentPanel = undefined;
        this._panel.dispose();
        this._outputChannel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
