import { z } from 'zod';

/**
 * Ephemeral credential manager.
 *
 * Security policy:
 * - API keys and GitHub tokens are stored ONLY in chrome.storage.session
 *   (or process memory during unit tests).
 * - Credentials are NEVER stored in IndexedDB, chrome.storage.sync, or localStorage.
 * - Credentials are NEVER exposed to content scripts or logged.
 * - Note: chrome.storage.session is cleared when the browser session closes and is
 *   NOT a hardware-backed secret vault or encrypted enclave.
 */

const SESSION_CREDENTIALS_KEY = 'codecontext_session_credentials_v1';

const SessionCredentialsSchema = z.object({
  aiApiKeys: z.record(z.string(), z.string()).default({}),
  githubToken: z.string().optional(),
});

type SessionCredentials = z.infer<typeof SessionCredentialsSchema>;

const memoryFallback: SessionCredentials = {
  aiApiKeys: {},
  githubToken: undefined,
};

function hasChromeSessionStorage(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.storage !== 'undefined' &&
    typeof chrome.storage.session !== 'undefined'
  );
}

async function readCredentials(): Promise<SessionCredentials> {
  if (!hasChromeSessionStorage()) {
    return {
      aiApiKeys: { ...memoryFallback.aiApiKeys },
      githubToken: memoryFallback.githubToken,
    };
  }
  const result = await chrome.storage.session.get(SESSION_CREDENTIALS_KEY);
  const parsed = SessionCredentialsSchema.safeParse(result[SESSION_CREDENTIALS_KEY]);
  if (!parsed.success) {
    return { aiApiKeys: {}, githubToken: undefined };
  }
  return parsed.data;
}

async function writeCredentials(creds: SessionCredentials): Promise<void> {
  const sanitized = SessionCredentialsSchema.parse(creds);
  if (!hasChromeSessionStorage()) {
    memoryFallback.aiApiKeys = { ...sanitized.aiApiKeys };
    memoryFallback.githubToken = sanitized.githubToken;
    return;
  }
  await chrome.storage.session.set({ [SESSION_CREDENTIALS_KEY]: sanitized });
}

export async function setAIApiKey(providerId: string, apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  const creds = await readCredentials();
  if (!trimmed) {
    delete creds.aiApiKeys[providerId];
  } else {
    creds.aiApiKeys[providerId] = trimmed;
  }
  await writeCredentials(creds);
}

export async function getAIApiKey(providerId: string): Promise<string | undefined> {
  const creds = await readCredentials();
  const value = creds.aiApiKeys[providerId];
  return value && value.trim().length > 0 ? value : undefined;
}

export async function hasAIApiKey(providerId: string): Promise<boolean> {
  const key = await getAIApiKey(providerId);
  return Boolean(key);
}

export async function setGitHubToken(token: string): Promise<void> {
  const trimmed = token.trim();
  const creds = await readCredentials();
  creds.githubToken = trimmed.length > 0 ? trimmed : undefined;
  await writeCredentials(creds);
}

export async function getGitHubToken(): Promise<string | undefined> {
  const creds = await readCredentials();
  return creds.githubToken;
}

export async function clearAllCredentials(): Promise<void> {
  memoryFallback.aiApiKeys = {};
  memoryFallback.githubToken = undefined;
  if (hasChromeSessionStorage()) {
    await chrome.storage.session.remove(SESSION_CREDENTIALS_KEY);
  }
}

export function maskSecret(secret: string | undefined): string {
  if (!secret || secret.length < 8) return secret ? '••••••••' : '';
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}
