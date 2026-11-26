import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Database,
  Download,
  KeyRound,
  Monitor,
  Moon,
  Shield,
  Sliders,
  Sun,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { AIProviderType, ThemeMode } from '../../types';
import { createAIProvider } from '../../services/ai/registry';
import { AI_PROVIDER_PRESETS } from '../../services/ai/types';
import { requestOriginPermission } from '../../services/browser/permissions';
import {
  getAIApiKey,
  getGitHubToken,
  maskSecret,
  setAIApiKey,
  setGitHubToken,
} from '../../services/storage/credentials';
import { exportUserData, getStorageStats } from '../../services/storage/db';
import { useAppStore } from '../../stores/useAppStore';
import { EmbeddingSettings } from './EmbeddingSettings';
import {
  AlertBanner,
  Badge,
  Button,
  IconButton,
  Input,
  SwitchControl,
} from '../common/UIPrimitives';

export const SettingsView: React.FC = () => {
  const {
    settings,
    repositories,
    hasSessionApiKey,
    hasSessionGitHubToken,
    updateAppSettings,
    refreshCredentialStatus,
    removeRepository,
    clearAllData,
  } = useAppStore();

  const [provider, setProvider] = useState<AIProviderType>(settings.ai.provider);
  const [baseUrl, setBaseUrl] = useState(
    settings.ai.baseUrl ?? AI_PROVIDER_PRESETS[settings.ai.provider].defaultBaseUrl,
  );
  const [model, setModel] = useState(settings.ai.model);
  const [temperature, setTemperature] = useState(settings.ai.temperature);
  const [maxTokens, setMaxTokens] = useState(settings.ai.maxTokens);
  const [contextWindow, setContextWindow] = useState(settings.ai.contextWindow);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [maskedKey, setMaskedKey] = useState('');
  const [ghTokenInput, setGhTokenInput] = useState('');
  const [maskedGhToken, setMaskedGhToken] = useState('');

  const [maxFiles, setMaxFiles] = useState(settings.indexing.maxFiles);
  const [maxFileSizeKb, setMaxFileSizeKb] = useState(settings.indexing.maxFileSizeKb);
  const [maxTotalSizeMb, setMaxTotalSizeMb] = useState(settings.indexing.maxTotalSizeMb);

  const [testState, setTestState] = useState<{
    status: 'idle' | 'testing' | 'ok' | 'err';
    message: string;
  }>({
    status: 'idle',
    message: '',
  });
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [stats, setStats] = useState({
    repositories: 0,
    files: 0,
    symbols: 0,
    chunks: 0,
    messages: 0,
    references: 0,
  });

  useEffect(() => {
    setProvider(settings.ai.provider);
    setBaseUrl(settings.ai.baseUrl ?? AI_PROVIDER_PRESETS[settings.ai.provider].defaultBaseUrl);
    setModel(settings.ai.model);
    setTemperature(settings.ai.temperature);
    setMaxTokens(settings.ai.maxTokens);
    setContextWindow(settings.ai.contextWindow);
    setMaxFiles(settings.indexing.maxFiles);
    setMaxFileSizeKb(settings.indexing.maxFileSizeKb);
    setMaxTotalSizeMb(settings.indexing.maxTotalSizeMb);
  }, [settings]);

  useEffect(() => {
    void getAIApiKey(provider).then((k) => setMaskedKey(maskSecret(k)));
    void getGitHubToken().then((t) => setMaskedGhToken(maskSecret(t)));
    void getStorageStats().then(setStats);
  }, [provider, repositories.length, hasSessionApiKey, hasSessionGitHubToken]);

  const handleProviderChange = (nextProvider: AIProviderType) => {
    const preset = AI_PROVIDER_PRESETS[nextProvider];
    setProvider(nextProvider);
    setBaseUrl(preset.defaultBaseUrl);
    setModel(preset.defaultModel);
    setTestState({ status: 'idle', message: '' });
  };

  const handleSaveAI = async (e: React.FormEvent) => {
    e.preventDefault();
    if (apiKeyInput.trim()) {
      await setAIApiKey(provider, apiKeyInput.trim());
      setApiKeyInput('');
    }
    await updateAppSettings((curr) => ({
      ...curr,
      ai: {
        ...curr.ai,
        provider,
        baseUrl: baseUrl.trim() || AI_PROVIDER_PRESETS[provider].defaultBaseUrl,
        model: model.trim() || AI_PROVIDER_PRESETS[provider].defaultModel,
        temperature: Number(temperature) || 0.2,
        maxTokens: Number(maxTokens) || 2048,
        contextWindow: Number(contextWindow) || 32000,
      },
    }));
    await refreshCredentialStatus();
    const currentKey = await getAIApiKey(provider);
    setMaskedKey(maskSecret(currentKey));
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 1800);
  };

  const handleClearApiKey = async () => {
    await setAIApiKey(provider, '');
    await refreshCredentialStatus();
    setMaskedKey('');
  };

  const handleTestConnection = async () => {
    setTestState({ status: 'testing', message: 'Testing endpoint connection…' });
    const targetUrl = baseUrl.trim() || AI_PROVIDER_PRESETS[provider].defaultBaseUrl;

    const granted = await requestOriginPermission(targetUrl);
    if (!granted) {
      setTestState({
        status: 'err',
        message: `Host permission for ${targetUrl} was denied. Grant access to connect.`,
      });
      return;
    }

    const activeKey = apiKeyInput.trim() || (await getAIApiKey(provider));
    const adapter = createAIProvider(
      {
        ...settings.ai,
        provider,
        baseUrl: targetUrl,
        model: model.trim() || AI_PROVIDER_PRESETS[provider].defaultModel,
      },
      activeKey,
    );
    const res = await adapter.validateConfiguration();
    setTestState({
      status: res.ok ? 'ok' : 'err',
      message: res.message,
    });
  };

  const handleSaveGitHubToken = async () => {
    await setGitHubToken(ghTokenInput.trim());
    setGhTokenInput('');
    await refreshCredentialStatus();
    const token = await getGitHubToken();
    setMaskedGhToken(maskSecret(token));
  };

  const handleSaveLimits = async () => {
    await updateAppSettings((curr) => ({
      ...curr,
      indexing: {
        ...curr.indexing,
        maxFiles: Math.max(10, Math.min(2000, Number(maxFiles) || 250)),
        maxFileSizeKb: Math.max(10, Math.min(2048, Number(maxFileSizeKb) || 256)),
        maxTotalSizeMb: Math.max(1, Math.min(100, Number(maxTotalSizeMb) || 15)),
      },
    }));
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 1800);
  };

  const handleExportData = async () => {
    const json = await exportUserData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `codecontext-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const preset = AI_PROVIDER_PRESETS[provider];

  return (
    <div className="h-full overflow-auto p-3.5 space-y-5 bg-[var(--bg-base)]">
      {/* AI Provider Section */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-[var(--text-primary)] m-0 flex items-center gap-1.5 tracking-[-0.01em]">
            <KeyRound className="w-4 h-4 text-[var(--accent-text)]" /> AI Provider
          </h2>
          {savedFeedback && (
            <Badge tone="success">
              <Check className="w-3 h-3" /> Saved
            </Badge>
          )}
        </div>

        <form onSubmit={handleSaveAI} className="cc-card rounded-xl p-3.5 space-y-3">
          {/* 2x2 Visual Provider Grid */}
          <div className="space-y-1.5">
            <span className="text-[11.5px] font-medium text-[var(--text-secondary)] block">
              Provider adapter
            </span>
            <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="AI provider">
              {(Object.keys(AI_PROVIDER_PRESETS) as AIProviderType[]).map((key) => {
                const p = AI_PROVIDER_PRESETS[key];
                const selected = provider === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => handleProviderChange(key)}
                    className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                      selected
                        ? 'bg-[var(--accent-soft)] border-[var(--accent-border)] text-[var(--text-primary)]'
                        : 'bg-[var(--bg-base)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[12px] font-semibold truncate">{p.name}</span>
                      {selected && <Check className="w-3.5 h-3.5 text-[var(--accent-text)] shrink-0" />}
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-[var(--text-muted)] m-0">{preset.description}</p>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="cc-baseurl"
              className="text-[11.5px] font-medium text-[var(--text-secondary)] block"
            >
              API Base URL
            </label>
            <Input
              id="cc-baseurl"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={preset.defaultBaseUrl}
              className="font-mono text-[12px]"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="cc-model"
              className="text-[11.5px] font-medium text-[var(--text-secondary)] block"
            >
              Model ID
            </label>
            <Input
              id="cc-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={preset.defaultModel}
              className="font-mono text-[12px]"
            />
            <div className="flex flex-wrap gap-1 pt-0.5">
              {preset.suggestedModels.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModel(m)}
                  className={`px-2 py-0.5 rounded-md text-[10.5px] font-mono border transition-colors cursor-pointer ${
                    model === m
                      ? 'bg-[var(--accent-soft)] border-[var(--accent-border)] text-[var(--accent-text)]'
                      : 'bg-[var(--bg-base)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label
                htmlFor="cc-apikey"
                className="text-[11.5px] font-medium text-[var(--text-secondary)]"
              >
                API Key (session-only)
              </label>
              {maskedKey && (
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[11px] text-[var(--success-text)]">
                    {maskedKey}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleClearApiKey()}
                    className="text-[11px] text-[var(--danger-text)] underline cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
            <Input
              id="cc-apikey"
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={maskedKey ? 'Enter new key to replace session key' : 'Paste API key…'}
              autoComplete="off"
            />
            <p className="text-[11px] text-[var(--text-muted)] m-0 leading-relaxed">
              Stored in browser session storage only (cleared on browser restart; never synced or saved in IndexedDB). Session storage is not a hardware-backed encrypted vault.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label htmlFor="cc-temp" className="text-[11px] text-[var(--text-muted)] block">
                Temp
              </label>
              <Input
                id="cc-temp"
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="cc-maxtokens" className="text-[11px] text-[var(--text-muted)] block">
                Max tokens
              </label>
              <Input
                id="cc-maxtokens"
                type="number"
                min="128"
                max="32768"
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="cc-ctx" className="text-[11px] text-[var(--text-muted)] block">
                Context
              </label>
              <Input
                id="cc-ctx"
                type="number"
                min="2048"
                max="2000000"
                value={contextWindow}
                onChange={(e) => setContextWindow(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" variant="primary" size="sm">
              Save provider
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void handleTestConnection()}
              disabled={testState.status === 'testing'}
            >
              {testState.status === 'testing' ? 'Testing…' : 'Test connection'}
            </Button>
          </div>

          {testState.status !== 'idle' && testState.message && (
            <AlertBanner
              tone={
                testState.status === 'ok'
                  ? 'success'
                  : testState.status === 'err'
                    ? 'danger'
                    : 'info'
              }
              icon={
                testState.status === 'ok' ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : testState.status === 'err' ? (
                  <XCircle className="w-3.5 h-3.5" />
                ) : undefined
              }
            >
              {testState.message}
            </AlertBanner>
          )}
        </form>
      </section>

      {/* GitHub Optional Auth */}
      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold text-[var(--text-primary)] m-0 flex items-center gap-1.5 tracking-[-0.01em]">
          <Shield className="w-4 h-4 text-[var(--accent-text)]" /> GitHub Access (Optional)
        </h2>
        <div className="cc-card rounded-xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between text-[11.5px]">
            <label htmlFor="cc-ghtoken" className="text-[var(--text-secondary)] font-medium">
              Fine-grained read-only session token
            </label>
            {maskedGhToken && (
              <span className="font-mono text-[var(--success-text)]">{maskedGhToken}</span>
            )}
          </div>
          <div className="flex gap-1.5">
            <Input
              id="cc-ghtoken"
              type="password"
              value={ghTokenInput}
              onChange={(e) => setGhTokenInput(e.target.value)}
              placeholder="github_pat_… (private repos or 5,000 req/hr)"
              autoComplete="off"
            />
            <Button size="sm" variant="secondary" onClick={() => void handleSaveGitHubToken()}>
              Save
            </Button>
            {maskedGhToken && (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await setGitHubToken('');
                  setMaskedGhToken('');
                  await refreshCredentialStatus();
                }}
              >
                Clear
              </Button>
            )}
          </div>
          <p className="text-[11px] text-[var(--text-muted)] m-0 leading-relaxed">
            Public repositories work without a token. For private repos, use a fine-grained PAT scoped strictly to read-only repository contents.
          </p>
        </div>
      </section>

      {/* Appearance & Privacy */}
      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold text-[var(--text-primary)] m-0 flex items-center gap-1.5 tracking-[-0.01em]">
          <Sliders className="w-4 h-4 text-[var(--accent-text)]" /> Appearance &amp; Privacy
        </h2>
        <div className="cc-card rounded-xl p-3.5 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium text-[var(--text-primary)]">Theme</span>
            <div className="inline-flex items-center p-0.5 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)] gap-0.5">
              {(
                [
                  ['dark', 'Dark', Moon],
                  ['light', 'Light', Sun],
                  ['system', 'System', Monitor],
                ] as Array<[ThemeMode, string, React.ComponentType<{ className?: string }>]>
              ).map(([mode, label, Icon]) => {
                const active = settings.theme === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => void updateAppSettings((curr) => ({ ...curr, theme: mode }))}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11.5px] font-medium cursor-pointer transition-colors ${
                      active
                        ? 'bg-[var(--accent-solid)] text-white'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="h-px bg-[var(--border-subtle)]" />

          <SwitchControl
            checked={settings.ai.consentGiven}
            onChange={(checked) =>
              void updateAppSettings((curr) => ({
                ...curr,
                ai: { ...curr.ai, consentGiven: checked },
              }))
            }
            label="External AI transmission consent"
            description="Allow sending retrieved code excerpts to your configured AI endpoint."
          />

          <EmbeddingSettings />
        </div>
      </section>

      {/* Indexing Limits */}
      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold text-[var(--text-primary)] m-0 tracking-[-0.01em]">
          Indexing Limits
        </h2>
        <div className="cc-card rounded-xl p-3.5 space-y-2.5">
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label htmlFor="cc-maxfiles" className="text-[11px] text-[var(--text-muted)] block">
                Max files
              </label>
              <Input
                id="cc-maxfiles"
                type="number"
                value={maxFiles}
                onChange={(e) => setMaxFiles(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="cc-maxkb" className="text-[11px] text-[var(--text-muted)] block">
                Max file (KB)
              </label>
              <Input
                id="cc-maxkb"
                type="number"
                value={maxFileSizeKb}
                onChange={(e) => setMaxFileSizeKb(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="cc-maxmb" className="text-[11px] text-[var(--text-muted)] block">
                Total (MB)
              </label>
              <Input
                id="cc-maxmb"
                type="number"
                value={maxTotalSizeMb}
                onChange={(e) => setMaxTotalSizeMb(Number(e.target.value))}
              />
            </div>
          </div>
          <Button size="xs" variant="secondary" onClick={() => void handleSaveLimits()}>
            Save limits
          </Button>
        </div>
      </section>

      {/* Storage & Data Management */}
      <section className="space-y-2 pb-4">
        <h2 className="text-[13px] font-semibold text-[var(--text-primary)] m-0 flex items-center gap-1.5 tracking-[-0.01em]">
          <Database className="w-4 h-4 text-[var(--accent-text)]" /> Local Data &amp; Cache
        </h2>
        <div className="cc-card rounded-xl p-3.5 space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2.5 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)]">
              <div className="text-[15px] font-semibold tabular-nums">{stats.repositories}</div>
              <div className="text-[10.5px] text-[var(--text-muted)]">Repos</div>
            </div>
            <div className="p-2.5 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)]">
              <div className="text-[15px] font-semibold tabular-nums">{stats.files}</div>
              <div className="text-[10.5px] text-[var(--text-muted)]">Files</div>
            </div>
            <div className="p-2.5 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)]">
              <div className="text-[15px] font-semibold tabular-nums">{stats.chunks}</div>
              <div className="text-[10.5px] text-[var(--text-muted)]">Chunks</div>
            </div>
          </div>

          {repositories.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-[var(--text-muted)]">
                Indexed Repositories
              </div>
              <div className="divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] overflow-hidden">
                {repositories.map((repo) => (
                  <div
                    key={repo.id}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[12px]"
                  >
                    <span className="font-mono truncate">{repo.fullName}</span>
                    <IconButton
                      size="xs"
                      tone="danger"
                      onClick={() => void removeRepository(repo.id)}
                      aria-label={`Delete ${repo.fullName}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </IconButton>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="sm" variant="secondary" onClick={() => void handleExportData()}>
              <Download className="w-3.5 h-3.5" /> Export JSON
            </Button>

            {!confirmClearAll ? (
              <Button size="sm" variant="danger" onClick={() => setConfirmClearAll(true)}>
                <Trash2 className="w-3.5 h-3.5" /> Clear all local data
              </Button>
            ) : (
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    await clearAllData();
                    setConfirmClearAll(false);
                  }}
                >
                  Confirm wipe
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmClearAll(false)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
