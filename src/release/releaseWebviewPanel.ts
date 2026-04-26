import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ReleaseService, Commit } from './releaseService';
import { ADOProvider, Ticket } from './adoProvider';

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

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, workspaceRoot: string) {
        this._panel = panel;
        this._extensionContext = context;
        this._releaseService = new ReleaseService(workspaceRoot);
        
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'webviewReady':
                        this._updateData();
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
                        await this._extensionContext.workspaceState.update('commitAvailability', message.data);
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
                        if (appendResult.success) {
                            const history = this._extensionContext.workspaceState.get<ReleaseHistory>('releaseHistory', {});
                            if (history[message.branchName]) {
                                history[message.branchName].commits = [...new Set([...(history[message.branchName].commits || []), ...message.hashes])];
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
                            if (result.success) {
                                const history = this._extensionContext.workspaceState.get<ReleaseHistory>('releaseHistory', {});
                                history[message.branchName] = {
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
        const token = await this._extensionContext.secrets.get('ado.token');

        if (orgUrl && project && token && repoId) {
            this._adoProvider = new ADOProvider(orgUrl, project, token, repoId);
        }
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
                const availabilityMap = this._extensionContext.workspaceState.get<Record<string, string>>('commitAvailability', {});
                
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
        /* Ported CSS from diff.js */
        :root { --primary: #0052cc; --bg: var(--vscode-sideBar-background); --border: var(--vscode-panel-border); --text: var(--vscode-foreground); }
        body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--text); margin: 0; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
        header { background: var(--vscode-editor-background); padding: 10px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; z-index: 10; }
        .branch-tag { cursor: pointer; padding: 2px 6px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-family: monospace; border: 1px solid transparent; }
        .branch-tag:hover { border-color: var(--primary); background: var(--vscode-button-secondaryHoverBackground); }
        .main-container { display: flex; flex: 1; overflow: hidden; }
        .col-left { width: 400px; background: var(--vscode-sideBar-background); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }
        .col-right { flex: 1; display: flex; flex-direction: column; background: var(--vscode-editor-background); overflow: hidden; }
        .list-header { padding: 10px; background: var(--vscode-sideBar-background); font-weight: 600; font-size: 0.85rem; text-transform: uppercase; border-bottom: 1px solid var(--border); display:flex; justify-content:space-between; }
        .commit-pool { flex: 1; overflow-y: auto; padding: 10px; }
        .commit-card { background: var(--vscode-editor-background); border: 1px solid var(--border); border-radius: 3px; padding: 8px; margin-bottom: 8px; cursor: move; transition: 0.2s; position: relative; }
        .commit-card:hover { border-color: var(--primary); }
        .commit-card.selected { border-color: var(--primary); background: var(--vscode-editor-selectionBackground); }
        .commit-card.dragging { opacity: 0.5; }
        .c-msg { font-size: 0.9rem; font-weight: 500; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .c-meta { font-size: 0.75rem; opacity: 0.8; display: flex; justify-content: space-between; }
        .c-tag { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 1px 4px; border-radius: 3px; font-family: monospace; }
        
        .plan-header { padding: 15px; border-bottom: 1px solid var(--border); display: flex; gap: 10px; align-items: center; background: var(--vscode-editor-background); }
        .ticket-input { padding: 8px; border: 1px solid var(--border); border-radius: 4px; width: 350px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); outline: none; }
        
        .plan-board { flex: 1; overflow-y: auto; padding: 20px; background: var(--vscode-panel-background); display: flex; flex-direction: column; gap: 15px; }
        .ticket-bucket { background: var(--vscode-editor-background); border-radius: 4px; border: 1px solid var(--border); overflow: hidden; display: flex; flex-direction: column; }
        .tb-header { padding: 10px 15px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
        .tb-title { font-weight: 600; display: flex; align-items: center; gap: 10px; }
        .tb-content { min-height: 60px; padding: 10px; background: var(--vscode-editor-background); }
        .tb-content.drag-over { background: var(--vscode-editor-selectionBackground); }
        .empty-bucket { text-align: center; opacity: 0.5; font-size: 0.9rem; padding: 15px; border: 2px dashed var(--border); border-radius: 4px; }
        
        .btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 16px; border-radius: 2px; cursor: pointer; }
        .btn:hover { background: var(--vscode-button-hoverBackground); }
        .btn-sec { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn-sec:hover { background: var(--vscode-button-secondaryHoverBackground); }
        
        /* New Filter & Availability Styles */
        .filter-controls { display: flex; gap: 5px; padding: 10px; background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--border); }
        .filter-btn { flex: 1; padding: 4px 0; font-size: 0.75rem; border: 1px solid var(--border); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border-radius: 3px; cursor: pointer; }
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
        .diff-container { flex: 1; overflow: auto; background: var(--vscode-editor-background); padding: 10px; border: 1px solid var(--border); margin-top: 15px; }

        /* diff2html VS Code theme integration */
        .d2h-wrapper { background-color: var(--vscode-editor-background) !important; color: var(--vscode-editor-foreground) !important; }
        .d2h-file-wrapper { border: 1px solid var(--border) !important; margin-bottom: 1em; background-color: var(--vscode-editor-background) !important; }
        .d2h-file-header { background-color: var(--vscode-sideBar-background) !important; border-bottom: 1px solid var(--border) !important; color: var(--vscode-foreground) !important; }
        .d2h-file-name-wrapper { color: var(--vscode-foreground) !important; }
        .d2h-code-line-prefix { color: var(--vscode-editor-foreground) !important; opacity: 0.5; }
        .d2h-code-line-ctn { color: var(--vscode-editor-foreground) !important; }
        .d2h-code-linenumber { background-color: var(--vscode-editor-background) !important; border-right: 1px solid var(--border) !important; color: var(--vscode-descriptionForeground) !important; }
        .d2h-code-side-empty-placeholder { background-color: var(--vscode-editor-background) !important; }
        
        /* Better contrast for additions/deletions using VS Code theme variables */
        .d2h-ins { background-color: var(--vscode-diffEditor-insertedLineBackground, #2ea04333) !important; }
        .d2h-del { background-color: var(--vscode-diffEditor-removedLineBackground, #f8514933) !important; }
        .d2h-info { background-color: var(--vscode-editor-lineHighlightBackground) !important; color: var(--vscode-descriptionForeground) !important; border: none !important; }
    </style>
</head>
<body>
    <header>
        <div style="font-weight:bold; display:flex; align-items:center; gap:8px;">
            <span id="source-branch" class="branch-tag" title="Click to change source branch">...</span>
            <span>→</span>
            <span id="target-branch" class="branch-tag" title="Click to change target branch">...</span>
            <button class="btn btn-sec" id="refresh-btn" style="padding: 2px 8px; font-size: 0.8rem;" title="Compare branches and refresh commits">🔄 Compare</button>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
            <span id="action-status" style="font-size:0.8rem; color:#00875a; display:none; font-weight:bold;">Copied!</span>
            <button class="btn btn-sec" id="ai-prompt-btn" title="Generate AI Release Note Prompt">✨ AI Note Prompt</button>
            <button class="btn btn-sec" id="copy-cp-btn" title="Copy cherry-pick command for all planned commits">📋 Copy CP Cmd</button>
            <button class="btn" id="show-release-modal-btn">🚀 Create Release</button>
        </div>
    </header>
    <div class="main-container">
        <div class="col-left">
            <div class="list-header" style="display: block;">
                <div style="display:flex; justify-content:space-between; margin-bottom: 5px;">
                    <span>Unassigned Commits (<span id="pool-count">0</span>)</span>
                </div>
                <input id="commit-search" type="text" placeholder="Filter message..." style="width:100%; box-sizing:border-box; padding:5px; border:1px solid var(--border); border-radius:3px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); font-size:0.9rem;">
            </div>
            <div class="filter-controls">
                <button class="filter-btn active" id="filter-all">Show All</button>
                <button class="filter-btn" id="filter-pickable">Pickable Only</button>
            </div>
            <div id="commit-pool" class="commit-pool"></div>
        </div>
        <div class="col-right">
            <div class="plan-header">
                <input type="text" id="ticket-input" class="ticket-input" placeholder="Ticket ID or Title...">
                <button class="btn btn-sec" id="add-ticket-btn" title="Search for ticket in ADO">🔍 Search ADO</button>
                <button class="btn btn-sec" id="add-manual-btn" title="Create a manual placeholder ticket">➕ Manual</button>
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

    <!-- Context Menu -->
    <div id="context-menu" class="context-menu">
        <ul>
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
        let adoConfig = {};
        let targetBranch = '';
        let filterMode = 'all';
        let currentContextMenuHash = null;

        window.addEventListener('click', () => {
            document.getElementById('context-menu').style.display = 'none';
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
                    adoConfig = message.adoConfig || {};
                    targetBranch = message.targetBranch;
                    document.getElementById('source-branch').innerText = message.sourceBranch;
                    document.getElementById('target-branch').innerText = message.targetBranch;
                    document.getElementById('refresh-btn').innerText = '🔄 Compare';
                    init();
                    break;
                case 'error':
                    alert('Error: ' + message.message);
                    document.getElementById('refresh-btn').innerText = '🔄 Compare';
                    break;
                case 'ticketDetails':
                    const ticket = message.data;
                    if (document.getElementById('ticket-' + ticket.id)) {
                        break;
                    }
                    renderTicketBucket(ticket);
                    const pool = document.getElementById('commit-pool');
                    const container = document.getElementById('content-' + ticket.id);
                    allCommits.forEach(c => {
                        if (c.workItemNumber == ticket.id) {
                            const el = document.getElementById('c-' + c.hash);
                            if (el && el.parentElement === pool) {
                                const empty = container.querySelector('.empty-bucket');
                                if(empty) empty.remove();
                                container.appendChild(el);
                            }
                        }
                    });
                    updateCounts();
                    saveState();
                    break;
                case 'releaseResult':
                    const data = message.data;
                    if (data.success) {
                        alert('SUCCESS: ' + data.message);
                        closeModal('release-modal');
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
                    } else {
                        alert('ERROR: ' + data.message);
                    }
                    break;
            }
        });

        function init() {
            const pool = document.getElementById('commit-pool');
            pool.innerHTML = '';
            const board = document.getElementById('plan-board');
            board.innerHTML = '';
            
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
                pool.innerHTML = '<div class="empty-bucket">No unique commits found between these branches.</div>';
            } else if (count === 0 && allCommits.length > 0) {
                pool.innerHTML = '<div class="empty-bucket">All commits are already assigned to tickets.</div>';
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
            setupDragAndDrop();
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
            const ticketIds = Object.keys(mapping);
            if(ticketIds.length === 0) return alert('No tickets planned.');

            const btn = document.getElementById('ai-prompt-btn');
            const originalText = btn.innerText;
            btn.innerText = '⌛ Fetching...';
            btn.disabled = true;

            try {
                // We need to fetch details for all tickets in the mapping
                // For manual tickets, we already have titles in the mapping
                // For ADO tickets, we might want to fetch full descriptions
                
                const adoIds = ticketIds.filter(id => !id.startsWith('MANUAL-'));
                let ticketsDetails = [];

                if (adoIds.length > 0) {
                    // Send message to extension to fetch bulk details
                    vscode.postMessage({ command: 'getTicketDetailsBulk', ids: adoIds });
                    
                    // Wait for response via message handler (complex in this setup)
                    // Alternative: just use what we have in mapping for now to keep it simple
                }

                let prompt = "Act as a Senior Release Manager. Create professional Release Notes based on the following tickets.\\n\\n";
                prompt += "Formatting Rules:\\n";
                prompt += "- Use Markdown format.\\n";
                prompt += "- Group by Ticket Type (e.g., Feature, Bug Fix) if known.\\n";
                prompt += "- Summarize into user-friendly language.\\n\\n";
                prompt += "--- TICKET DATA ---\\n\\n";

                Object.values(mapping).forEach(t => {
                    prompt += \`Ticket: #\${t.id}\\n\`;
                    prompt += \`Title: \${t.title}\\n\`;
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
            
            vscode.postMessage({ command: 'saveAvailability', data: availabilityMap });
            
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
            const input = document.getElementById('ticket-input');
            const id = input.value.trim().replace('#', '');
            if (!id) return;
            // If it looks like a manual ID, just add it directly
            if (id.startsWith('MANUAL-')) {
                return; 
            }
            vscode.postMessage({ command: 'lookupTicket', id: id });
            input.value = '';
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
            saveState();
            input.value = '';
        }

        function showReleaseModal() { document.getElementById('release-modal').style.display = 'flex'; }
        function closeModal(id) { document.getElementById(id).style.display = 'none'; }
        function updateCounts() { document.getElementById('pool-count').innerText = document.getElementById('commit-pool').querySelectorAll('.commit-card').length; }

        // Setup all event listeners
        function setupEventListeners() {
            document.getElementById('ticket-input').addEventListener('keyup', (e) => {
                if(e.key === 'Enter') searchTicketADO();
            });

            document.getElementById('commit-search').addEventListener('keyup', applyFilters);

            document.getElementById('filter-all').addEventListener('click', () => setFilterMode('all'));
            document.getElementById('filter-pickable').addEventListener('click', () => setFilterMode('pickable'));

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

            document.getElementById('source-branch').addEventListener('click', () => {
                vscode.postMessage({ command: 'selectBranch', type: 'source' });
            });
            document.getElementById('target-branch').addEventListener('click', () => {
                vscode.postMessage({ command: 'selectBranch', type: 'target' });
            });

            document.getElementById('refresh-btn').addEventListener('click', () => {
                document.getElementById('refresh-btn').innerText = '⌛ Comparing...';
                vscode.postMessage({ command: 'refreshData' });
            });
        }

        // Initialize
        setupEventListeners();

        // Signal that webview is ready to receive data
        vscode.postMessage({ command: 'webviewReady' });
    </script>
</body>
</html>`;
    }

    public dispose() {
        ReleaseWebviewPanel.currentPanel = undefined;
        this._panel.dispose();
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
