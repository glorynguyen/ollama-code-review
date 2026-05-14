import * as assert from 'assert';
import { scanDiffForSecrets, toStructuredFindings } from '../secretScanner';

suite('Secret Scanner Test Suite', () => {
	test('Should find AWS Access Key', () => {
		const diff = `
--- a/config.ts
+++ b/config.ts
@@ -1,5 +1,6 @@
 export const config = {
     port: 3000,
+    awsKey: 'AKIAIOSFODNN7EXAMPLE',
     debug: true
 };
 `;
		const findings = scanDiffForSecrets(diff);
		assert.strictEqual(findings.length, 1);
		assert.strictEqual(findings[0].severity, 'critical');
		assert.strictEqual(findings[0].file, 'config.ts');
		assert.strictEqual(findings[0].line, 3);
		assert.ok(findings[0].message.includes('AWS Access Key ID'));
	});

	test('Should ignore secrets in deleted lines', () => {
		const diff = `
--- a/config.ts
+++ b/config.ts
@@ -1,5 +1,5 @@
 export const config = {
     port: 3000,
-    awsKey: 'AKIAIOSFODNN7EXAMPLE',
+    awsKey: process.env.AWS_KEY,
     debug: true
 };
 `;
		const findings = scanDiffForSecrets(diff);
		assert.strictEqual(findings.length, 0);
	});

	test('Should find generic API Key / Token assignments', () => {
		const diff = `
--- a/app.js
+++ b/app.js
@@ -10,2 +10,3 @@
 function init() {
+    const api_token = "abc123xyz456def789ghi012jkl345";
 }
 `;
		const findings = scanDiffForSecrets(diff);
		assert.strictEqual(findings.length, 1);
		assert.ok(findings[0].message.includes('Generic API Key / Token'));
	});

	test('Should handle multiple secrets in one diff', () => {
		const diff = `
--- a/secrets.txt
+++ b/secrets.txt
@@ -0,0 +1,2 @@
+github_token=ghp_ABC123DEF456GHI789JKL012MNO345PQR678
+stripe_key=sk_test_4eC39HqLyjWDarjtT1zdp7dc
`;
		const findings = scanDiffForSecrets(diff);
		assert.strictEqual(findings.length, 2);
		assert.strictEqual(findings[0].line, 1);
		assert.strictEqual(findings[1].line, 2);
	});

	test('Should truncate long added lines without hanging', () => {
		const longTail = ' '.repeat(6000); // Changed from 'a' to ' ' to ensure word boundary
		const diff = `
--- a/config.ts
+++ b/config.ts
@@ -1,1 +1,2 @@
 export const config = {};
+export const awsKey = "AKIAIOSFODNN7EXAMPLE${longTail}";
`;
		const findings = scanDiffForSecrets(diff);
		assert.strictEqual(findings.length, 1);
		assert.ok(findings[0].message.includes('AWS Access Key ID'));
	});

	test('Should not scan beyond truncation limit', () => {
		const longPrefix = 'a'.repeat(6000);
		const diff = `
--- a/config.ts
+++ b/config.ts
@@ -1,1 +1,2 @@
 export const config = {};
+export const awsKey = "${longPrefix}AKIAIOSFODNN7EXAMPLE";
`;
		const findings = scanDiffForSecrets(diff);
		assert.strictEqual(findings.length, 0);
	});

	test('Should ignore binary diffs without hunks', () => {
		const diff = `
diff --git a/image.png b/image.png
index e69de29..4b825dc 100644
Binary files a/image.png and b/image.png differ
`;
		const findings = scanDiffForSecrets(diff);
		assert.strictEqual(findings.length, 0);
	});

	test('Should ignore password assignments to process.env', () => {
		const diff = `
--- a/app.ts
+++ b/app.ts
@@ -1,1 +1,2 @@
 export const cfg = {};
+export const password = process.env.APP_PASSWORD;
`;
		const findings = scanDiffForSecrets(diff);
		assert.strictEqual(findings.length, 0);
	});

	test('Should mask detected secret values in messages', () => {
		const diff = `
--- a/payments.ts
+++ b/payments.ts
@@ -1,1 +1,2 @@
 export const payments = {};
+export const stripeKey = "sk_test_4eC39HqLyjWDarjtT1zdp7dc";
`;
		const findings = scanDiffForSecrets(diff);

		assert.strictEqual(findings.length, 1);
		assert.ok(findings[0].message.includes('sk_t**********p7dc'));
		assert.ok(!findings[0].message.includes('sk_test_4eC39HqLyjWDarjtT1zdp7dc'));
	});

	test('Should ignore readable identifier-like API token assignments', () => {
		const diff = `
--- a/ui.ts
+++ b/ui.ts
@@ -1,1 +1,2 @@
 export const cfg = {};
+export const apiToken = "HomepageTemplateLeftColumnBlocksTextList";
`;
		const findings = scanDiffForSecrets(diff);

		assert.strictEqual(findings.length, 0);
	});

	test('Should convert secret findings to structured review findings', () => {
		const diff = `
--- a/config.ts
+++ b/config.ts
@@ -20,1 +20,2 @@
 export const cfg = {};
+export const awsKey = "AKIAIOSFODNN7EXAMPLE";
`;
		const findings = scanDiffForSecrets(diff);
		const structured = toStructuredFindings(findings);

		assert.strictEqual(structured.length, 1);
		assert.strictEqual(structured[0].id, 'secret-0');
		assert.strictEqual(structured[0].severity, 'critical');
		assert.strictEqual(structured[0].category, 'Security');
		assert.deepStrictEqual(structured[0].anchor, { file: 'config.ts', line: 21 });
		assert.strictEqual(structured[0].anchorValidation.status, 'valid');
		assert.ok(structured[0].fix?.summary);
	});
});
