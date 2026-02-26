import * as vscode from 'vscode';

/**
 * Manages inline diff decorations for the Inline Edit Mode (F-024).
 * Shows removed (red) and added (green) line highlights in the editor
 * while streaming the AI-generated replacement.
 */
export class DiffDecorator {
	private static readonly _removedDecorationType = vscode.window.createTextEditorDecorationType({
		backgroundColor: new vscode.ThemeColor('diffEditor.removedLineBackground'),
		isWholeLine: true,
		overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.deletedForeground'),
		overviewRulerLane: vscode.OverviewRulerLane.Left,
	});

	private static readonly _addedDecorationType = vscode.window.createTextEditorDecorationType({
		backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
		isWholeLine: true,
		overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
		overviewRulerLane: vscode.OverviewRulerLane.Left,
	});

	private _editor: vscode.TextEditor;
	private _originalRange: vscode.Range;

	constructor(editor: vscode.TextEditor, originalRange: vscode.Range) {
		this._editor = editor;
		this._originalRange = originalRange;
	}

	/**
	 * Highlight the original selection as "removed" while the AI streams its replacement.
	 */
	public markOriginalAsRemoved(): void {
		this._editor.setDecorations(DiffDecorator._removedDecorationType, [
			{ range: this._originalRange },
		]);
	}

	/**
	 * Clear all decorations from the editor (called on accept, reject, or error).
	 */
	public clearAll(): void {
		this._editor.setDecorations(DiffDecorator._removedDecorationType, []);
		this._editor.setDecorations(DiffDecorator._addedDecorationType, []);
	}

	public dispose(): void {
		this.clearAll();
	}
}
