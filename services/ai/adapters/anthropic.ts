import {
  AIProviderError,
  mapHttpAIError,
  type AIGenerateInput,
  type AIProvider,
} from '../types';

export interface AnthropicAdapterConfig {
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  fetchImpl?: typeof fetch;
}

function normalizeMessagesUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/messages')) return trimmed;
  return `${trimmed}/messages`;
}

export class AnthropicAdapter implements AIProvider {
  readonly id = 'anthropic';
  readonly name = 'Anthropic-Compatible';
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultModel: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: AnthropicAdapterConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.defaultModel = config.defaultModel;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }
    return headers;
  }

  async *generate(input: AIGenerateInput): AsyncIterable<string> {
    const url = normalizeMessagesUrl(this.baseUrl);
    const nonSystem = input.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const combinedSystem = [
      input.systemPrompt,
      ...input.messages.filter((m) => m.role === 'system').map((m) => m.content),
    ]
      .filter(Boolean)
      .join('\n\n');

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: input.model || this.defaultModel,
          system: combinedSystem || undefined,
          messages: nonSystem,
          temperature: input.temperature ?? 0.2,
          max_tokens: input.maxTokens ?? 2048,
          stream: true,
        }),
        signal: input.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new AIProviderError('Generation stopped by user.', 'ABORTED');
      }
      throw new AIProviderError(
        `Network error reaching ${this.baseUrl}. Check endpoint URL and host permissions.`,
        'NETWORK_ERROR',
      );
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw mapHttpAIError(response.status, bodyText);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!response.body || contentType.includes('application/json')) {
      const json = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const text = json.content?.map((c) => c.text ?? '').join('') ?? '';
      if (text) yield text;
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;

          try {
            const evt = JSON.parse(payload) as {
              type?: string;
              delta?: { type?: string; text?: string };
            };
            if (evt.type === 'content_block_delta' && evt.delta?.text) {
              yield evt.delta.text;
            }
          } catch {
            // Skip keepalive events
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new AIProviderError('Generation stopped by user.', 'ABORTED');
      }
      throw new AIProviderError('Stream interrupted while reading Anthropic response.', 'NETWORK_ERROR');
    } finally {
      reader.releaseLock();
    }
  }

  async validateConfiguration(): Promise<{ ok: boolean; message: string }> {
    const url = normalizeMessagesUrl(this.baseUrl);
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: this.defaultModel,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 4,
          stream: false,
        }),
      });
      if (res.ok) {
        return { ok: true, message: `Connected to Anthropic (${this.defaultModel}).` };
      }
      const errBody = await res.text().catch(() => '');
      const mapped = mapHttpAIError(res.status, errBody);
      return { ok: false, message: mapped.message };
    } catch {
      return {
        ok: false,
        message: `Could not reach ${this.baseUrl}. Check endpoint URL and grant host permission.`,
      };
    }
  }
}
