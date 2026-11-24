import React, { useEffect } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Badge, BrandLogo } from '../../components/common/UIPrimitives';
import { SettingsView } from '../../components/settings/SettingsView';
import { useAppStore } from '../../stores/useAppStore';

export const OptionsApp: React.FC = () => {
  const { initialized, initialize } = useAppStore();

  useEffect(() => {
    void initialize();
  }, [initialize]);

  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)] text-[var(--text-secondary)]">
        Loading CodeContext settings…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-chrome)] cc-dot-grid">
        <div className="max-w-2xl mx-auto py-6 px-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-default)] shadow-[var(--shadow-sm)]">
              <BrandLogo size={30} />
            </div>
            <div>
              <h1 className="text-[18px] font-semibold tracking-[-0.02em] m-0 leading-tight">
                CodeContext Settings
              </h1>
              <p className="text-[12.5px] text-[var(--text-muted)] m-0 mt-0.5">
                AI providers, ephemeral session credentials, indexing limits, and local storage.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Badge tone="success">
              <ShieldCheck className="w-3 h-3" /> Local-first
            </Badge>
            <Badge tone="neutral">v1.0.0</Badge>
          </div>
        </div>
      </div>

      <main className="max-w-2xl mx-auto py-4 px-2">
        <SettingsView />
      </main>
    </div>
  );
};
