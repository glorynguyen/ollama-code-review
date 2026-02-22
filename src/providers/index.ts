import { createDefaultProviderRegistry } from './registry';

export { ProviderRegistry } from './registry';
export type { ModelProvider, ProviderRequestContext, GenerateOptions, StreamOptions } from './types';

export const providerRegistry = createDefaultProviderRegistry();
