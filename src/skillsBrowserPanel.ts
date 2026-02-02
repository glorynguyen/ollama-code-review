import * as vscode from 'vscode';
import { AgentSkill, SkillsService } from './skillsService';
import { escapeHtml } from './utils';

export class SkillsBrowserPanel {
    public static currentPanel: SkillsBrowserPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private skillsService: SkillsService;

    private currentSkills: AgentSkill[] = [];
    // Map for quick skill lookup by composite key (repository/name)
    private skillsMap: Map<string, AgentSkill> = new Map();
    // Track operations in progress to prevent race conditions
    private operationsInProgress: Set<string> = new Set();
    // Track if a global refresh is in progress
    private isRefreshing: boolean = false;

    private constructor(
        panel: vscode.WebviewPanel,
        skillsService: SkillsService,
        skills: AgentSkill[]
    ) {
        this._panel = panel;
        this.skillsService = skillsService;
        this.currentSkills = skills;
        this._update(skills);
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from webview
        this._panel.webview.onDidReceiveMessage(
            async message => {
                // Look up the full skill object from the map using repository and name
                let skill: AgentSkill | undefined;
                if (message.repository && message.name) {
                    const key = `${message.repository}/${message.name}`;
                    skill = this.skillsMap.get(key);
                }

                switch (message.command) {
                    case 'downloadSkill':
                        if (skill) {
                            await this.handleDownloadSkill(skill);
                        }
                        break;
                    case 'viewSkill':
                        if (skill) {
                            await this.handleViewSkill(skill);
                        }
                        break;
                    case 'deleteSkill':
                        if (skill) {
                            await this.handleDeleteSkill(skill);
                        }
                        break;
                    case 'refetchSkill':
                        if (skill) {
                            await this.handleRefetchSkill(skill);
                        }
                        break;
                    case 'refreshAll':
                        await this.handleRefreshAll();
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    public static async createOrShow(
        skillsService: SkillsService,
        skills: AgentSkill[]
    ) {
        const column = vscode.ViewColumn.One;

        if (SkillsBrowserPanel.currentPanel) {
            SkillsBrowserPanel.currentPanel._panel.reveal(column);
            SkillsBrowserPanel.currentPanel._update(skills);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'skillsBrowser',
            'Agent Skills Browser',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        SkillsBrowserPanel.currentPanel = new SkillsBrowserPanel(
            panel,
            skillsService,
            skills
        );
    }

    /**
     * Checks if an operation is already in progress for a skill
     */
    private isOperationInProgress(skill: AgentSkill): boolean {
        const key = `${skill.repository}/${skill.name}`;
        return this.operationsInProgress.has(key);
    }

    /**
     * Marks an operation as started for a skill
     */
    private startOperation(skill: AgentSkill): boolean {
        const key = `${skill.repository}/${skill.name}`;
        if (this.operationsInProgress.has(key)) {
            return false; // Operation already in progress
        }
        this.operationsInProgress.add(key);
        return true;
    }

    /**
     * Marks an operation as completed for a skill
     */
    private endOperation(skill: AgentSkill): void {
        const key = `${skill.repository}/${skill.name}`;
        this.operationsInProgress.delete(key);
    }

    private async handleDownloadSkill(skill: AgentSkill) {
        if (!this.startOperation(skill)) {
            vscode.window.showWarningMessage(`Operation already in progress for "${skill.name}"`);
            return;
        }

        try {
            const filePath = await this.skillsService.downloadSkill(skill);
            vscode.window.showInformationMessage(
                `Skill "${skill.name}" downloaded successfully!`
            );
            // Refresh the panel to update button states
            this._update(this.currentSkills);
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to download skill: ${error}`
            );
        } finally {
            this.endOperation(skill);
        }
    }

    private async handleViewSkill(skill: AgentSkill) {
        const doc = await vscode.workspace.openTextDocument({
            content: skill.content,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc, {
            preview: true,
            viewColumn: vscode.ViewColumn.Beside
        });
    }

    private async handleDeleteSkill(skill: AgentSkill) {
        if (this.isOperationInProgress(skill)) {
            vscode.window.showWarningMessage(`Operation already in progress for "${skill.name}"`);
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete "${skill.name}"?`,
            { modal: true },
            'Delete'
        );

        if (confirm === 'Delete') {
            if (!this.startOperation(skill)) {
                vscode.window.showWarningMessage(`Operation already in progress for "${skill.name}"`);
                return;
            }

            try {
                await this.skillsService.deleteSkill(skill);
                vscode.window.showInformationMessage(`Skill "${skill.name}" deleted successfully!`);
                // Refresh the panel to update button states
                this._update(this.currentSkills);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to delete skill: ${error}`);
            } finally {
                this.endOperation(skill);
            }
        }
    }

    private async handleRefetchSkill(skill: AgentSkill) {
        if (!this.startOperation(skill)) {
            vscode.window.showWarningMessage(`Operation already in progress for "${skill.name}"`);
            return;
        }

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Updating "${skill.name}"...`,
                    cancellable: false
                },
                async () => {
                    const updatedSkill = await this.skillsService.refetchSkill(skill);
                    // Update the skill in our local list
                    const index = this.currentSkills.findIndex(
                        s => s.repository === skill.repository && s.name === skill.name
                    );
                    if (index !== -1) {
                        this.currentSkills[index] = updatedSkill;
                    }
                    vscode.window.showInformationMessage(`Skill "${skill.name}" updated successfully!`);
                    // Refresh the panel
                    this._update(this.currentSkills);
                }
            );
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to update skill: ${error}`);
        } finally {
            this.endOperation(skill);
        }
    }

    private async handleRefreshAll() {
        if (this.isRefreshing) {
            vscode.window.showWarningMessage('Refresh already in progress');
            return;
        }

        this.isRefreshing = true;
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Refreshing skills from repositories...',
                    cancellable: false
                },
                async () => {
                    const skills = await this.skillsService.fetchAvailableSkillsFromAllRepos(true);
                    this.currentSkills = skills;
                    this._update(skills);
                    vscode.window.showInformationMessage(`Refreshed ${skills.length} skills from repositories`);
                }
            );
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to refresh skills: ${error}`);
        } finally {
            this.isRefreshing = false;
        }
    }

    private _update(skills: AgentSkill[]) {
        this.currentSkills = skills;
        // Rebuild the skills map for efficient lookup
        this.skillsMap.clear();
        skills.forEach(skill => {
            const key = `${skill.repository}/${skill.name}`;
            this.skillsMap.set(key, skill);
        });
        this._panel.webview.html = this._getHtmlForWebview(skills);
    }

    private _getHtmlForWebview(skills: AgentSkill[]) {
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Agent Skills Browser</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-editor-foreground);
            padding: 20px;
            line-height: 1.6;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
        }
        .header {
            margin-bottom: 30px;
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 20px;
        }
        .skill-card {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 15px;
            background: var(--vscode-editor-background);
        }
        .skill-card:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .skill-name {
            font-size: 18px;
            font-weight: bold;
            color: var(--vscode-symbolIcon-keywordForeground);
            margin-bottom: 4px;
        }
        .skill-repo {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
            opacity: 0.8;
        }
        .skill-repo a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
        }
        .skill-repo a:hover {
            text-decoration: underline;
        }
        .skill-description {
            color: var(--vscode-descriptionForeground);
            margin-bottom: 15px;
        }
        .skill-actions {
            display: flex;
            gap: 10px;
        }
        button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
        }
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .secondary-button {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .secondary-button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .danger-button {
            background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
            color: var(--vscode-inputValidation-errorForeground, #f48771);
            border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
        }
        .danger-button:hover {
            background: var(--vscode-inputValidation-errorBackground, #6b2222);
            opacity: 0.9;
        }
        .downloaded-badge {
            display: inline-block;
            background: var(--vscode-testing-iconPassed, #89d185);
            color: var(--vscode-editor-background);
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 10px;
            margin-left: 8px;
            font-weight: bold;
        }
        .header-actions {
            display: flex;
            gap: 10px;
            margin-top: 15px;
        }
        .filter-container {
            margin-bottom: 20px;
        }
        input[type="text"] {
            width: 100%;
            padding: 10px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎯 Agent Skills Browser</h1>
            <p>Browse and install agent skills for enhanced code review capabilities</p>
            <div class="header-actions">
                <button class="secondary-button refresh-all-btn">
                    🔄 Refresh All Skills
                </button>
            </div>
        </div>
        
        <div class="filter-container">
            <input 
                type="text" 
                id="searchInput" 
                placeholder="Search skills by name or description..."
                onkeyup="filterSkills()"
            />
        </div>

        <div id="skillsList">
            ${skills.map(skill => {
                const isDownloaded = this.skillsService.isSkillDownloaded(skill);
                // Only store identifying keys (repository and name) instead of full skill object
                // This reduces memory usage in the webview, especially for skills with large content
                return `
                <div class="skill-card" data-skill-name="${escapeHtml(skill.name.toLowerCase())}" data-skill-desc="${escapeHtml(skill.description.toLowerCase())}" data-skill-repo="${escapeHtml(skill.repository.toLowerCase())}" data-repository="${escapeHtml(skill.repository)}" data-name="${escapeHtml(skill.name)}" data-downloaded="${isDownloaded}">
                    <div class="skill-name">
                        ${escapeHtml(skill.name)}
                        ${isDownloaded ? '<span class="downloaded-badge">Downloaded</span>' : ''}
                    </div>
                    <div class="skill-repo">from <a href="https://github.com/${escapeHtml(skill.repository)}" title="View repository on GitHub">${escapeHtml(skill.repository)}</a></div>
                    <div class="skill-description">${escapeHtml(skill.description)}</div>
                    <div class="skill-actions">
                        ${isDownloaded ? `
                            <button class="refetch-btn">
                                🔄 Update
                            </button>
                            <button class="danger-button delete-btn">
                                🗑️ Delete
                            </button>
                        ` : `
                            <button class="download-btn">
                                ⬇️ Download
                            </button>
                        `}
                        <button class="secondary-button preview-btn">
                            👁️ Preview
                        </button>
                    </div>
                </div>
            `;}).join('')}
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        // Use event delegation for better security - avoids inline JSON in onclick handlers
        document.getElementById('skillsList').addEventListener('click', function(e) {
            const target = e.target;
            const skillCard = target.closest('.skill-card');
            if (!skillCard) return;

            // Only send identifying keys (repository and name) instead of full skill object
            // The extension host looks up the full skill from its map
            const repository = skillCard.getAttribute('data-repository');
            const name = skillCard.getAttribute('data-name');
            if (!repository || !name) return;

            if (target.classList.contains('download-btn')) {
                vscode.postMessage({
                    command: 'downloadSkill',
                    repository: repository,
                    name: name
                });
            } else if (target.classList.contains('preview-btn')) {
                vscode.postMessage({
                    command: 'viewSkill',
                    repository: repository,
                    name: name
                });
            } else if (target.classList.contains('delete-btn')) {
                vscode.postMessage({
                    command: 'deleteSkill',
                    repository: repository,
                    name: name
                });
            } else if (target.classList.contains('refetch-btn')) {
                vscode.postMessage({
                    command: 'refetchSkill',
                    repository: repository,
                    name: name
                });
            }
        });

        // Handle refresh all button click
        document.querySelector('.refresh-all-btn').addEventListener('click', function() {
            vscode.postMessage({ command: 'refreshAll' });
        });

        function filterSkills() {
            const searchValue = document.getElementById('searchInput').value.toLowerCase();
            const skillCards = document.querySelectorAll('.skill-card');

            skillCards.forEach(card => {
                const name = card.getAttribute('data-skill-name');
                const desc = card.getAttribute('data-skill-desc');
                const repo = card.getAttribute('data-skill-repo');

                if (name.includes(searchValue) || desc.includes(searchValue) || repo.includes(searchValue)) {
                    card.style.display = 'block';
                } else {
                    card.style.display = 'none';
                }
            });
        }
    </script>
</body>
</html>`;
    }

    public dispose() {
        SkillsBrowserPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}