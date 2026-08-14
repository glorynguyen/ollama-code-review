const Module = require('module');
const fs = require('fs/promises');
const path = require('path');

const workspaceRoot = process.env.VSCODE_NODE_TEST_WORKSPACE || process.cwd();

class Uri {
    constructor(fsPath) {
        this.fsPath = path.resolve(String(fsPath));
        this.path = this.fsPath;
        this.scheme = 'file';
    }

    static file(fsPath) {
        return new Uri(fsPath);
    }

    static joinPath(base, ...segments) {
        return new Uri(path.join(base.fsPath || String(base), ...segments));
    }

    toString() {
        return this.fsPath;
    }
}

class ThemeIcon {
    constructor(id, color) {
        this.id = id;
        this.color = color;
    }
}

class ThemeColor {
    constructor(id) {
        this.id = id;
    }
}

class TreeItem {
    constructor(label, collapsibleState) {
        this.label = label;
        this.collapsibleState = collapsibleState;
    }
}

class CodeAction {
    constructor(title, kind) {
        this.title = title;
        this.kind = kind;
    }
}

class Range {
    constructor(startLine, startCharacter, endLine, endCharacter) {
        this.start = { line: startLine, character: startCharacter };
        this.end = { line: endLine, character: endCharacter };
        this.isEmpty = startLine === endLine && startCharacter === endCharacter;
    }
}

class Position {
    constructor(line, character) {
        this.line = line;
        this.character = character;
    }
}

class Selection extends Range {}

function createConfiguration() {
    const values = new Map([
        ['diffFilter', {}],
        ['cache', {}],
        ['coverage', {}],
        ['mcp.allowedOrigins', ['chrome-extension://*']],
        ['mcp.authToken', ''],
        ['mcp.port', 19840],
        ['mcp.enabled', true],
        ['mcp.autoKillPortConflicts', true],
        ['mcp.semble.pythonPath', ''],
    ]);
    const overrides = globalThis.__vscodeTestConfig || {};

    return {
        get(key, defaultValue) {
            if (Object.prototype.hasOwnProperty.call(overrides, key)) {
                return overrides[key];
            }
            return values.has(key) ? values.get(key) : defaultValue;
        },
    };
}

const vscodeMock = {
    Uri,
    ThemeIcon,
    ThemeColor,
    TreeItem,
    TreeItemCollapsibleState: {
        None: 0,
        Collapsed: 1,
        Expanded: 2,
    },
    OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
    CodeAction,
    CodeActionKind: {
        QuickFix: 'quickfix',
        Refactor: 'refactor',
        RefactorExtract: 'refactor.extract',
        RefactorRewrite: 'refactor.rewrite',
    },
    SymbolKind: {
        File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4,
        Method: 5, Property: 6, Field: 7, Constructor: 8, Enum: 9,
        Interface: 10, Function: 11, Variable: 12, Constant: 13,
        String: 14, Number: 15, Boolean: 16, Array: 17, Object: 18,
        Key: 19, Null: 20, EnumMember: 21, Struct: 22, Event: 23,
        Operator: 24, TypeParameter: 25,
    },
    Range,
    Position,
    Selection,
    workspace: {
        workspaceFolders: [{
            uri: Uri.file(workspaceRoot),
            name: path.basename(workspaceRoot),
            index: 0,
        }],
        getConfiguration() {
            return createConfiguration();
        },
        openTextDocument: async () => ({ getText: () => '', uri: Uri.file(''), languageId: 'plaintext', lineCount: 0, lineAt: () => ({ text: '' }) }),
        asRelativePath: (p) => (typeof p === 'string' ? p : (p && p.fsPath) || ''),
        fs: {
            readFile: async uri => fs.readFile(uri.fsPath || String(uri)),
        },
    },
    window: {
        showInformationMessage: async () => undefined,
        showWarningMessage: async () => undefined,
        showErrorMessage: async () => undefined,
        createOutputChannel: () => ({
            appendLine: () => undefined,
            append: () => undefined,
            clear: () => undefined,
            show: () => undefined,
            hide: () => undefined,
            dispose: () => undefined,
        }),
        createTextEditorDecorationType: () => ({ key: 'mock', dispose: () => undefined }),
    },
    commands: {
        registerCommand: () => ({ dispose: () => undefined }),
        executeCommand: async () => undefined,
    },
    extensions: {
        getExtension: () => undefined,
    },
    env: {
        clipboard: {
            writeText: async () => undefined,
            readText: async () => '',
        },
    },
    EventEmitter: class {
        constructor() {
            this.listeners = [];
            this.event = listener => {
                this.listeners.push(listener);
                return { dispose: () => undefined };
            };
        }

        fire(value) {
            for (const listener of this.listeners) {
                listener(value);
            }
        }

        dispose() {
            this.listeners = [];
        }
    },
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
    if (request === 'vscode') {
        return vscodeMock;
    }
    return originalLoad.call(this, request, parent, isMain);
};
