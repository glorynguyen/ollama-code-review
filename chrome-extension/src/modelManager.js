"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelManager = void 0;
const web_llm_1 = require("@mlc-ai/web-llm");
class ModelManager {
    engine = null;
    loadedModel = '';
    status = 'idle';
    getStatus() {
        return this.status;
    }
    async ensureLoaded(modelId, onProgress) {
        if (this.engine && this.loadedModel === modelId) {
            onProgress?.({ status: 'ready', text: `Model ready: ${modelId}`, progress: 1 });
            return;
        }
        this.status = 'checking-webgpu';
        onProgress?.({ status: this.status, text: 'Checking WebGPU support...' });
        if (!('gpu' in navigator)) {
            this.status = 'error';
            throw new Error('WebGPU is not available in this Chrome profile.');
        }
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            this.status = 'error';
            throw new Error('No WebGPU adapter is available.');
        }
        this.status = 'loading';
        onProgress?.({ status: this.status, text: `Loading model ${modelId}...` });
        this.engine = await (0, web_llm_1.CreateMLCEngine)(modelId, {
            initProgressCallback: (report) => {
                onProgress?.({
                    status: 'loading',
                    text: report.text ?? `Loading ${modelId}...`,
                    progress: report.progress,
                });
            },
        });
        this.loadedModel = modelId;
        this.status = 'ready';
        onProgress?.({ status: this.status, text: `Model ready: ${modelId}`, progress: 1 });
    }
    async reviewDiff(input, onToken) {
        if (!this.engine || this.loadedModel !== input.modelId) {
            throw new Error('The selected model is not loaded yet.');
        }
        this.status = 'generating';
        let output = '';
        const stream = await this.engine.chat.completions.create({
            model: input.modelId,
            stream: true,
            temperature: 0.2,
            messages: [
                {
                    role: 'system',
                    content: 'You are an expert software engineer reviewing pull requests. ' +
                        'Respond in markdown with sections: Summary, Findings, Suggestions. ' +
                        'If there are no significant issues, say so clearly.',
                },
                {
                    role: 'user',
                    content: [
                        `PR Title: ${input.prTitle}`,
                        `PR Description: ${input.prDescription || '(none)'}`,
                        '',
                        'Review the following diff:',
                        '```diff',
                        input.diff,
                        '```',
                    ].join('\n'),
                },
            ],
        });
        for await (const chunk of stream) {
            const token = chunk.choices?.[0]?.delta?.content ?? '';
            if (!token) {
                continue;
            }
            output += token;
            onToken(token);
        }
        this.status = 'ready';
        return output;
    }
}
exports.ModelManager = ModelManager;
//# sourceMappingURL=modelManager.js.map