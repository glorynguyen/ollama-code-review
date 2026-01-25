import * as vscode from 'vscode';
import { AgentSkill, SkillsService } from './skillsService';

export class SkillsBrowserPanel {
    public static currentPanel: SkillsBrowserPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private skillsService: SkillsService;

    private constructor(
        panel: vscode.WebviewPanel,
        skillsService: SkillsService,
        skills: AgentSkill[]
    ) {
        this._panel = panel;
        this.skillsService = skillsService;
        this._update(skills);
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from webview
        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'downloadSkill':
                        await this.handleDownloadSkill(message.skill);
                        break;
                    case 'viewSkill':
                        await this.handleViewSkill(message.skill);
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

    private async handleDownloadSkill(skill: AgentSkill) {
        try {
            const filePath = await this.skillsService.downloadSkill(skill);
            vscode.window.showInformationMessage(
                `Skill "${skill.name}" downloaded successfully!`
            );
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to download skill: ${error}`
            );
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

    private _update(skills: AgentSkill[]) {
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
            margin-bottom: 8px;
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
            ${skills.map(skill => `
                <div class="skill-card" data-skill-name="${skill.name.toLowerCase()}" data-skill-desc="${skill.description.toLowerCase()}">
                    <div class="skill-name">${skill.name}</div>
                    <div class="skill-description">${skill.description}</div>
                    <div class="skill-actions">
                        <button onclick="downloadSkill(${JSON.stringify(skill).replace(/"/g, '&quot;')})">
                            📥 Download
                        </button>
                        <button class="secondary-button" onclick="viewSkill(${JSON.stringify(skill).replace(/"/g, '&quot;')})">
                            👁️ Preview
                        </button>
                    </div>
                </div>
            `).join('')}
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function downloadSkill(skill) {
            vscode.postMessage({
                command: 'downloadSkill',
                skill: skill
            });
        }

        function viewSkill(skill) {
            vscode.postMessage({
                command: 'viewSkill',
                skill: skill
            });
        }

        function filterSkills() {
            const searchValue = document.getElementById('searchInput').value.toLowerCase();
            const skillCards = document.querySelectorAll('.skill-card');
            
            skillCards.forEach(card => {
                const name = card.getAttribute('data-skill-name');
                const desc = card.getAttribute('data-skill-desc');
                
                if (name.includes(searchValue) || desc.includes(searchValue)) {
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