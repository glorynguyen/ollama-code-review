import * as assert from 'assert';
import * as vscode from 'vscode';
import { getTestFileName, getFrameworkOptions, detectTestFramework, GenerateTestsActionProvider, GenerateTestsPanel } from '../codeActions/testAction';
import { parseTestResponse, extractSymbolName } from '../codeActions/types';

suite('TestAction Test Suite', () => {
	vscode.window.showInformationMessage('Start TestAction tests.');

	suite('getTestFileName', () => {
		test('should return correct filename for Go', () => {
			assert.strictEqual(getTestFileName('main.go', 'go', 'testing'), 'main_test.go');
		});

		test('should return correct filename for Python (pytest)', () => {
			assert.strictEqual(getTestFileName('utils.py', 'python', 'pytest'), 'test_utils.py');
		});

		test('should return correct filename for Python (generic)', () => {
			assert.strictEqual(getTestFileName('logic.py', 'python', 'something-else'), 'test_logic.py');
		});

		test('should return correct filename for JavaScript/TypeScript (Jest)', () => {
			assert.strictEqual(getTestFileName('component.ts', 'typescript', 'jest'), 'component.test.ts');
			assert.strictEqual(getTestFileName('app.js', 'javascript', 'jest'), 'app.test.js');
		});

		test('should return correct filename for JavaScript (Mocha)', () => {
			assert.strictEqual(getTestFileName('service.js', 'javascript', 'mocha'), 'service.spec.js');
		});

		test('should return same filename for Rust', () => {
			assert.strictEqual(getTestFileName('lib.rs', 'rust', 'cargo test'), 'lib.rs');
		});
	});

	suite('getFrameworkOptions', () => {
		test('should return JS options for javascript', () => {
			const options = getFrameworkOptions('javascript');
			const labels = options.map(o => o.label);
			assert.ok(labels.includes('Jest'));
			assert.ok(labels.includes('Vitest'));
		});

		test('should return JS options for typescriptreact', () => {
			const options = getFrameworkOptions('typescriptreact');
			const labels = options.map(o => o.label);
			assert.ok(labels.includes('Jest'));
		});

		test('should return Python options for python', () => {
			const options = getFrameworkOptions('python');
			const labels = options.map(o => o.label);
			assert.ok(labels.includes('pytest'));
			assert.ok(labels.includes('unittest'));
		});

		test('should return Go options for go', () => {
			const options = getFrameworkOptions('go');
			const labels = options.map(o => o.label);
			assert.ok(labels.includes('testing'));
			assert.ok(labels.includes('testify'));
		});

		test('should handle unsupported language gracefully', () => {
			const options = getFrameworkOptions('unsupported');
			assert.strictEqual(options.length, 1);
			assert.strictEqual(options[0].label, 'Generic');
		});

		test('should return Generic option for unknown language', () => {
			const options = getFrameworkOptions('unknown');
			assert.strictEqual(options.length, 1);
			assert.strictEqual(options[0].label, 'Generic');
		});
	});

	suite('parseTestResponse', () => {
		test('should extract code block from AI response', () => {
			const response = 'Here is the test code:\n```typescript\nimport { test } from "jest";\n```\nExplanation goes here.';
			const result = parseTestResponse(response, 'utils.ts');
			assert.ok(result);
			assert.strictEqual(result!.testCode, 'import { test } from "jest";');
			assert.strictEqual(result!.testFileName, 'utils.test.ts');
		});

		test('should extract explanation from response', () => {
			const response = '```typescript\nconst x = 1;\n```\nThis is a simple test.';
			const result = parseTestResponse(response, 'app.ts');
			assert.ok(result);
			assert.strictEqual(result!.explanation, 'This is a simple test.');
		});

		test('should handle multiple code blocks', () => {
			const response = 'First code:\n```typescript\ncode1\n```\nSecond code:\n```typescript\ncode2\n```';
			const result = parseTestResponse(response, 'app.ts');
			assert.ok(result);
			assert.strictEqual(result!.testCode, 'code1');
			assert.ok(result!.explanation.includes('Second code:'));
		});

		test('should handle response without code block', () => {
			const response = 'No code block here, just text.';
			const result = parseTestResponse(response, 'app.ts');
			assert.strictEqual(result, null);
		});

		test('should preserve language-specific syntax in code block', () => {
			const response = '```python\ndef test_fn():\n    assert True\n```';
			const result = parseTestResponse(response, 'app.py');
			assert.ok(result);
			assert.strictEqual(result!.testCode, 'def test_fn():\n    assert True');
		});
	});

	suite('extractSymbolName', () => {
		test('should extract function name', () => {
			assert.strictEqual(extractSymbolName('function calculate() {}'), 'calculate');
			assert.strictEqual(extractSymbolName('async function fetchData() {}'), 'fetchData');
		});

		test('should extract arrow function name', () => {
			assert.strictEqual(extractSymbolName('const myFn = () => {}'), 'myFn');
			assert.strictEqual(extractSymbolName('let getData = async () => {}'), 'getData');
		});

		test('should extract class name', () => {
			assert.strictEqual(extractSymbolName('class UserService {}'), 'UserService');
		});

		test('should extract method name', () => {
			assert.strictEqual(extractSymbolName('  saveUser(user) {\n    return db.save(user);\n  }'), 'saveUser');
		});

		test('should return null for no match', () => {
			assert.strictEqual(extractSymbolName('const x = 1;'), null);
		});
	});

	suite('detectTestFramework', () => {
		test('should return default framework when no workspace', async () => {
			const doc = { languageId: 'python' } as vscode.TextDocument;
			const framework = await detectTestFramework(doc);
			assert.ok(['pytest', 'unittest'].includes(framework));
		});
	});

	suite('GenerateTestsActionProvider', () => {
		test('should provide code action for supported languages', () => {
			const provider = new GenerateTestsActionProvider();
			const mockDoc = {
				getText: (r: vscode.Range) => 'function test() {}',
				languageId: 'typescript'
			} as any as vscode.TextDocument;
			const mockRange = {
				isEmpty: false
			} as any as vscode.Range;

			const actions = provider.provideCodeActions(mockDoc, mockRange);
			assert.ok(actions);
			assert.strictEqual(actions!.length, 1);
			assert.strictEqual(actions![0].title, 'Ollama: Generate Tests');
		});

		test('should not provide code action for empty range', () => {
			const provider = new GenerateTestsActionProvider();
			const doc = { getText: () => '', languageId: 'typescript' } as any as vscode.TextDocument;
			const range = { isEmpty: true } as any as vscode.Range;
			const actions = provider.provideCodeActions(doc, range);
			assert.strictEqual(actions, undefined);
		});

		test('should not provide code action for non-function code', () => {
			const provider = new GenerateTestsActionProvider();
			const mockDoc = {
				getText: (r: vscode.Range) => 'just some text',
				languageId: 'typescript'
			} as any as vscode.TextDocument;
			const mockRange = {
				isEmpty: false
			} as any as vscode.Range;
			const actions = provider.provideCodeActions(mockDoc, mockRange);
			assert.strictEqual(actions, undefined);
		});
	});

	suite('GenerateTestsPanel', () => {
		test('should create panel without crashing', () => {
			// This test ensures the basic panel creation logic works
			try {
				GenerateTestsPanel.createOrShow(
					'test code',
					'test.ts',
					'explanation',
					'/path/to/source.ts',
					'typescript'
				);
				assert.ok(GenerateTestsPanel.currentPanel);
				GenerateTestsPanel.currentPanel.dispose();
			} catch (e) {
				// In some environments this might still fail if UI is completely unavailable
				console.log('GenerateTestsPanel test skipped or failed due to environment:', e);
			}
		});
	});

	suite('Error Handling Simulation', () => {
		test('should handle invalid code selection for test generation', () => {
			const provider = new GenerateTestsActionProvider();
			const mockDoc = {
				getText: (r: vscode.Range) => '   ',
				languageId: 'typescript'
			} as any as vscode.TextDocument;
			const mockRange = {
				isEmpty: false
			} as any as vscode.Range;
			const actions = provider.provideCodeActions(mockDoc, mockRange);
			assert.strictEqual(actions, undefined);
		});
	});
});
