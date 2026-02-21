export function toModelLimitChatMessage(rawError: string, modelId: string): string | undefined {
	const text = rawError.toLowerCase();
	const isRateLimit = text.includes('rate limit') || text.includes('429') || text.includes('quota');
	const isContextLimit = text.includes('context length') || text.includes('token limit') || text.includes('max tokens') || text.includes('maximum context');
	const isTimeout = text.includes('timeout');

	if (isRateLimit) {
		return `Model limit reached for \`${modelId}\`: rate limit or quota exceeded. Please retry in a moment or switch models.`;
	}
	if (isContextLimit) {
		return `Model limit reached for \`${modelId}\`: context/token limit exceeded. Try a shorter prompt or clear older chat history.`;
	}
	if (isTimeout) {
		return `Model limit warning for \`${modelId}\`: request timed out. Try again or lower prompt size.`;
	}
	return undefined;
}
