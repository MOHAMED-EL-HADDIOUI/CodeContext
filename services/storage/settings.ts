import { AppSettingsSchema, type AppSettings } from '../../types';

const SETTINGS_STORAGE_KEY = 'codecontext_settings_v1';

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  ai: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    temperature: 0.2,
    maxTokens: 2048,
    contextWindow: 32000,
    enableLocalEmbeddings: false,
    consentGiven: false,
  },
  indexing: {
    maxFiles: 250,
    maxFileSizeKb: 256,
    maxTotalSizeMb: 15,
    concurrency: 5,
  },
  onboardingCompleted: false,
  activeRepositoryId: undefined,
};

let memorySettings: AppSettings = structuredClone(DEFAULT_SETTINGS);

function hasChromeLocalStorage(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.storage !== 'undefined' &&
    typeof chrome.storage.local !== 'undefined'
  );
}

export async function loadSettings(): Promise<AppSettings> {
  if (!hasChromeLocalStorage()) {
    return structuredClone(memorySettings);
  }
  const result = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  const raw = result[SETTINGS_STORAGE_KEY];
  if (!raw) return structuredClone(DEFAULT_SETTINGS);
  const parsed = AppSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    return structuredClone(DEFAULT_SETTINGS);
  }
  return parsed.data;
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  // Strip any unexpected fields so credentials can never sneak in
  const validated = AppSettingsSchema.parse(settings);
  if (!hasChromeLocalStorage()) {
    memorySettings = structuredClone(validated);
    return structuredClone(validated);
  }
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: validated });
  return validated;
}

export async function updateSettings(
  updater: (current: AppSettings) => AppSettings,
): Promise<AppSettings> {
  const current = await loadSettings();
  const next = updater(current);
  return saveSettings(next);
}

export async function resetSettings(): Promise<AppSettings> {
  return saveSettings(structuredClone(DEFAULT_SETTINGS));
}
