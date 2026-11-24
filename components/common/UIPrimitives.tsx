import React from 'react';
import { motion } from 'framer-motion';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
  size?: 'xs' | 'sm' | 'md';
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'sm',
  className = '',
  disabled,
  ...props
}) => {
  const base =
    'inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition-all duration-150 cursor-pointer active:scale-[0.98] disabled:opacity-45 disabled:cursor-not-allowed disabled:active:scale-100 select-none whitespace-nowrap';

  const sizes: Record<NonNullable<ButtonProps['size']>, string> = {
    xs: 'h-6.5 px-2 text-[11px]',
    sm: 'h-8 px-2.5 text-[12px]',
    md: 'h-9 px-3.5 text-[12.5px]',
  };

  const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
    primary:
      'bg-[var(--accent-solid)] text-white hover:bg-[var(--accent-solid-hover)] border border-white/10 shadow-[var(--shadow-xs)]',
    secondary:
      'bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-[var(--border-default)] shadow-[var(--shadow-xs)]',
    subtle:
      'bg-[var(--accent-soft)] text-[var(--accent-text)] hover:brightness-110 border border-[var(--accent-border)]',
    ghost:
      'bg-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-transparent',
    danger:
      'bg-[var(--danger-soft)] text-[var(--danger-text)] hover:brightness-110 border border-[var(--danger-border)]',
  };

  return (
    <button
      type={props.type ?? 'button'}
      disabled={disabled}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    />
  );
};

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  tone?: 'neutral' | 'danger';
  size?: 'xs' | 'sm';
}

export const IconButton: React.FC<IconButtonProps> = ({
  active = false,
  tone = 'neutral',
  size = 'sm',
  className = '',
  ...props
}) => {
  const dims = size === 'xs' ? 'w-6 h-6' : 'w-7 h-7';
  const style = active
    ? 'bg-[var(--accent-soft)] text-[var(--accent-text)] border-[var(--accent-border)]'
    : tone === 'danger'
      ? 'text-[var(--text-muted)] hover:text-[var(--danger-text)] hover:bg-[var(--danger-soft)] border-transparent'
      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border-transparent';

  return (
    <button
      type={props.type ?? 'button'}
      className={`inline-flex items-center justify-center rounded-lg border transition-all duration-150 active:scale-95 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed shrink-0 ${dims} ${style} ${className}`}
      {...props}
    />
  );
};

interface BadgeProps {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ children, tone = 'neutral', className = '' }) => {
  const tones: Record<NonNullable<BadgeProps['tone']>, string> = {
    neutral:
      'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)]',
    accent:
      'bg-[var(--accent-soft)] text-[var(--accent-text)] border border-[var(--accent-border)]',
    success:
      'bg-[var(--success-soft)] text-[var(--success-text)] border border-[var(--success-border)]',
    warning:
      'bg-[var(--warning-soft)] text-[var(--warning-text)] border border-[var(--warning-border)]',
    danger:
      'bg-[var(--danger-soft)] text-[var(--danger-text)] border border-[var(--danger-border)]',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10.5px] font-medium leading-tight tabular-nums ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
};

export const StatusDot: React.FC<{
  tone: 'success' | 'warning' | 'danger' | 'accent' | 'neutral';
  pulse?: boolean;
}> = ({ tone, pulse = false }) => {
  const colorMap = {
    success: 'bg-[var(--success-text)]',
    warning: 'bg-[var(--warning-text)]',
    danger: 'bg-[var(--danger-text)]',
    accent: 'bg-[var(--accent-text)]',
    neutral: 'bg-[var(--text-muted)]',
  };

  return (
    <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden="true">
      {pulse && (
        <span
          className={`absolute inline-flex h-full w-full rounded-full opacity-55 animate-ping ${colorMap[tone]}`}
        />
      )}
      <span className={`relative inline-flex rounded-full h-2 w-2 ${colorMap[tone]}`} />
    </span>
  );
};

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input: React.FC<InputProps> = ({ className = '', ...props }) => (
  <input
    className={`w-full h-8 px-2.5 rounded-lg text-[12.5px] bg-[var(--bg-input)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] border border-[var(--border-default)] hover:border-[var(--border-strong)] focus:border-[var(--accent-text)] focus:shadow-[0_0_0_3px_var(--accent-ring)] transition-all duration-150 ${className}`}
    {...props}
  />
);

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select: React.FC<SelectProps> = ({ className = '', ...props }) => (
  <select
    className={`h-8 px-2.5 rounded-lg text-[12px] bg-[var(--bg-input)] text-[var(--text-primary)] border border-[var(--border-default)] hover:border-[var(--border-strong)] focus:border-[var(--accent-text)] transition-colors cursor-pointer ${className}`}
    {...props}
  />
);

export const SwitchControl: React.FC<{
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
}> = ({ checked, onChange, label, description }) => (
  <div className="flex items-start justify-between gap-3">
    <div className="space-y-0.5 min-w-0">
      <div className="text-[12px] font-medium text-[var(--text-primary)]">{label}</div>
      {description && (
        <div className="text-[11px] text-[var(--text-muted)] leading-snug">{description}</div>
      )}
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 cursor-pointer mt-0.5 ${
        checked
          ? 'bg-[var(--accent-solid)] border-[var(--accent-border)]'
          : 'bg-[var(--bg-elevated)] border-[var(--border-default)]'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-150 ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  </div>
);

export interface SegmentedItem<T extends string> {
  id: T;
  label: string;
  count?: number;
  icon?: React.ComponentType<{ className?: string }>;
}

export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  layoutId,
  className = '',
}: {
  items: Array<SegmentedItem<T>>;
  value: T | null;
  onChange: (next: T) => void;
  layoutId: string;
  className?: string;
}) {
  return (
    <div
      className={`inline-flex items-center p-0.5 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)] gap-0.5 ${className}`}
    >
      {items.map((item) => {
        const active = value === item.id;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            aria-pressed={active}
            className={`relative flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11.5px] font-medium transition-colors cursor-pointer select-none whitespace-nowrap ${
              active
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                className="absolute inset-0 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-[var(--shadow-xs)]"
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {Icon && (
                <Icon
                  className={`w-3.5 h-3.5 ${active ? 'text-[var(--accent-text)]' : 'opacity-80'}`}
                />
              )}
              <span>{item.label}</span>
              {item.count !== undefined && (
                <span className="text-[10px] text-[var(--text-muted)] tabular-nums">
                  {item.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export const EmptyState: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
}> = ({ icon: Icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center text-center px-6 py-10 space-y-3">
    <div className="w-11 h-11 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-[var(--shadow-xs)] flex items-center justify-center">
      <Icon className="w-5 h-5 text-[var(--accent-text)]" />
    </div>
    <div className="space-y-1 max-w-[260px]">
      <h3 className="text-[13.5px] font-semibold text-[var(--text-primary)] m-0 tracking-tight">
        {title}
      </h3>
      <p className="text-[12px] text-[var(--text-muted)] m-0 leading-relaxed">{description}</p>
    </div>
    {action && <div className="pt-1">{action}</div>}
  </div>
);

export const AlertBanner: React.FC<{
  tone: 'info' | 'success' | 'warning' | 'danger';
  icon?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}> = ({ tone, icon, children, action }) => {
  const styles = {
    info: 'bg-[var(--accent-soft)] text-[var(--accent-text)] border-[var(--accent-border)]',
    success: 'bg-[var(--success-soft)] text-[var(--success-text)] border-[var(--success-border)]',
    warning: 'bg-[var(--warning-soft)] text-[var(--warning-text)] border-[var(--warning-border)]',
    danger: 'bg-[var(--danger-soft)] text-[var(--danger-text)] border-[var(--danger-border)]',
  };

  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[11.5px] leading-snug ${styles[tone]}`}
    >
      {icon && <span className="shrink-0 mt-0.5">{icon}</span>}
      <div className="flex-1 min-w-0">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
};

export const BrandLogo: React.FC<{ size?: number }> = ({ size = 22 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 128 128"
    fill="none"
    aria-hidden="true"
    className="shrink-0"
  >
    <rect
      x="6"
      y="6"
      width="116"
      height="116"
      rx="24"
      fill="#0F172A"
      stroke="#334155"
      strokeWidth="4"
    />
    <path
      d="M48 42L28 64L48 86"
      stroke="#38BDF8"
      strokeWidth="9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M80 42L100 64L80 86"
      stroke="#38BDF8"
      strokeWidth="9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M58 88L70 40" stroke="#F8FAFC" strokeWidth="8" strokeLinecap="round" />
    <circle cx="96" cy="32" r="7" fill="#34D399" />
  </svg>
);

export const LANGUAGE_COLORS: Record<string, string> = {
  typescript: '#3178C6',
  tsx: '#3178C6',
  javascript: '#F7DF1E',
  jsx: '#F7DF1E',
  python: '#3776AB',
  rust: '#DEA584',
  go: '#00ADD8',
  java: '#ED8B00',
  kotlin: '#A97BFF',
  csharp: '#68217A',
  cpp: '#F34B7D',
  c: '#8A9BA8',
  php: '#777BB4',
  ruby: '#CC342D',
  swift: '#F05138',
  html: '#E34F26',
  css: '#38BDF8',
  scss: '#CD6799',
  vue: '#42B883',
  svelte: '#FF3E00',
  json: '#94A3B8',
  yaml: '#CB171E',
  markdown: '#64748B',
  sql: '#E38C00',
  bash: '#34D399',
  dockerfile: '#2496ED',
};

export function getLanguageColor(language: string): string {
  return LANGUAGE_COLORS[language.toLowerCase()] ?? '#64748B';
}
