import type { AIConfiguration } from '../../types';
import { AI_PROVIDER_PRESETS, type AIProvider } from './types';
import { OpenAICompatibleAdapter } from './adapters/openaiCompatible';
import { AnthropicAdapter } from './adapters/anthropic';

export function createAIProvider(
  config: AIConfiguration,
  apiKey?: string,
  fetchImpl?: typeof fetch,
): AIProvider {
  const preset = AI_PROVIDER_PRESETS[config.provider];
  const baseUrl = (config.baseUrl?.trim() || preset.defaultBaseUrl).replace(/\/+$/, '');
  const model = config.model.trim() || preset.defaultModel;

  if (config.provider === 'anthropic') {
    return new AnthropicAdapter({
      baseUrl,
      apiKey,
      defaultModel: model,
      fetchImpl,
    });
  }

  return new OpenAICompatibleAdapter({
    id: config.provider,
    name: preset.name,
    baseUrl,
    apiKey,
    defaultModel: model,
    fetchImpl,
  });
}
