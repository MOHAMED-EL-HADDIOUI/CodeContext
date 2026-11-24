import {
  AIProviderError,
  mapHttpAIError,
  type AIGenerateInput,
  type AIProvider,
} from '../types';

export interface OpenAICompatibleAdapterConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  fetchImpl?: typeof fetch;
}

function normalizeEndpoint(baseUrl: string, path: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith(path)) return trimmed;
  return `${trimmed}${path}`;
}

export class OpenAICompatibleAdapter implements AIProvider {
  readonly id: string;
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultModel: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OpenAICompatibleAdapterConfig) {
    this.id = config.id;
    this.name = config.name;
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.defaultModel = config.defaultModel;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  async *generate(input: AIGenerateInput): AsyncIterable<string> {
    const url = normalizeEndpoint(this.baseUrl, '/chat/completions');
    const messages = [
      ...(input.systemPrompt ? [{ role: 'system' as const, content: input.systemPrompt }] : []),
      ...input.messages,
    ];

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: input.model || this.defaultModel,
          messages,
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
        `Network error reaching ${this.baseUrl}. Check endpoint URL, CORS/host permissions, and connectivity.`,
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
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = json.choices?.[0]?.message?.content ?? '';
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
          if (!line || !line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') return;

          try {
            const parsed = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const delta = parsed.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length > 0) {
              yield delta;
            }
          } catch {
            // Skip malformed SSE heartbeat fragments
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new AIProviderError('Generation stopped by user.', 'ABORTED');
      }
      throw new AIProviderError('Stream interrupted while reading AI response.', 'NETWORK_ERROR');
    } finally {
      reader.releaseLock();
    }
  }

  async validateConfiguration(): Promise<{ ok: boolean; message: string }> {
    const modelsUrl = normalizeEndpoint(this.baseUrl, '/models');
    try {
      const res = await this.fetchImpl(modelsUrl, {
        method: 'GET',
        headers: this.buildHeaders(),
      });
      if (res.ok) {
        return { ok: true, message: `Connected to ${this.name} (${this.baseUrl}).` };
      }
      // Some OpenAI-compatible gateways do not expose GET /models; fallback to minimal completion probe
      if (res.status === 404 || res.status === 405) {
        const chatUrl = normalizeEndpoint(this.baseUrl, '/chat/completions');
        const probe = await this.fetchImpl(chatUrl, {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify({
            model: this.defaultModel,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 4,
            stream: false,
          }),
        });
        if (probe.ok) {
          return { ok: true, message: `Connected to ${this.name} using model ${this.defaultModel}.` };
        }
        const errBody = await probe.text().catch(() => '');
        const mapped = mapHttpAIError(probe.status, errBody);
        return { ok: false, message: mapped.message };
      }
      const errBody = await res.text().catch(() => '');
      const mapped = mapHttpAIError(res.status, errBody);
      return { ok: false, message: mapped.message };
    } catch {
      return {
        ok: false,
        message: `Could not reach ${this.baseUrl}. Verify the URL and grant host permission when prompted.`,
      };
    }
  }
}
