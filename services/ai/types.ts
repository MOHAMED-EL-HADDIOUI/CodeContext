import type { AIProviderType } from '../../types';

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIGenerateInput {
  messages: AIMessage[];
  systemPrompt?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface AIProvider {
  id: string;
  name: string;
  generate(input: AIGenerateInput): AsyncIterable<string>;
  validateConfiguration(): Promise<{ ok: boolean; message: string }>;
}

export type AIErrorCode =
  | 'INVALID_API_KEY'
  | 'RATE_LIMITED'
  | 'MODEL_UNSUPPORTED'
  | 'TOKEN_LIMIT'
  | 'PROVIDER_DOWN'
  | 'NETWORK_ERROR'
  | 'ABORTED'
  | 'UNKNOWN';

export class AIProviderError extends Error {
  readonly code: AIErrorCode;
  readonly status?: number;

  constructor(message: string, code: AIErrorCode, status?: number) {
    super(message);
    this.name = 'AIProviderError';
    this.code = code;
    this.status = status;
  }
}

export interface AIProviderPreset {
  id: AIProviderType;
  name: string;
  description: string;
  defaultBaseUrl: string;
  defaultModel: string;
  suggestedModels: string[];
  requiresApiKey: boolean;
}

export const AI_PROVIDER_PRESETS: Record<AIProviderType, AIProviderPreset> = {
  openai: {
    id: 'openai',
    name: 'OpenAI-Compatible',
    description: 'OpenAI API and OpenAI-compatible cloud gateways.',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    suggestedModels: ['gpt-4o-mini', 'gpt-4o', 'o3-mini'],
    requiresApiKey: true,
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic-Compatible',
    description: 'Anthropic Claude Messages API.',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-latest',
    suggestedModels: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'],
    requiresApiKey: true,
  },
  nvidia: {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    description: 'NVIDIA NIM OpenAI-compatible inference endpoint with custom model ID.',
    defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'meta/llama-3.1-70b-instruct',
    suggestedModels: [
      'meta/llama-3.1-70b-instruct',
      'qwen/qwen2.5-coder-32b-instruct',
      'mistralai/codestral-22b-instruct-v0.1',
    ],
    requiresApiKey: true,
  },
  custom: {
    id: 'custom',
    name: 'Custom Endpoint',
    description: 'Self-hosted or third-party OpenAI-compatible API (Ollama, vLLM, OpenRouter, LiteLLM).',
    defaultBaseUrl: 'http://localhost:11434/v1',
    defaultModel: 'qwen2.5-coder:7b',
    suggestedModels: ['qwen2.5-coder:7b', 'llama3.1:8b', 'deepseek-coder-v2'],
    requiresApiKey: false,
  },
};

export function mapHttpAIError(status: number, bodyText: string): AIProviderError {
  const lower = bodyText.toLowerCase();
  if (status === 401 || status === 403) {
    return new AIProviderError(
      'Invalid or unauthorized API key. Verify your session API key in Settings.',
      'INVALID_API_KEY',
      status,
    );
  }
  if (status === 429) {
    return new AIProviderError(
      'AI provider rate limit exceeded. Wait a moment before trying again.',
      'RATE_LIMITED',
      status,
    );
  }
  if (
    status === 404 ||
    lower.includes('model_not_found') ||
    lower.includes('does not exist') ||
    lower.includes('unknown model')
  ) {
    return new AIProviderError(
      'The configured model ID was not found or is unsupported by this endpoint.',
      'MODEL_UNSUPPORTED',
      status,
    );
  }
  if (
    lower.includes('context_length') ||
    lower.includes('maximum context') ||
    lower.includes('too many tokens')
  ) {
    return new AIProviderError(
      'Prompt exceeded the model context window. Reduce context size or choose a larger-context model.',
      'TOKEN_LIMIT',
      status,
    );
  }
  if (status >= 500) {
    return new AIProviderError(
      `AI provider service is temporarily unavailable (HTTP ${status}).`,
      'PROVIDER_DOWN',
      status,
    );
  }
  return new AIProviderError(
    `AI provider request failed (HTTP ${status}): ${bodyText.slice(0, 220)}`,
    'UNKNOWN',
    status,
  );
}
