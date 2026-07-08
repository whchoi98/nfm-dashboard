'use client';

import { AlertTriangle, CircleCheck, CircleHelp } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

/**
 * Network health badge, dual-encoded (icon + text, never color alone).
 * value: NFM HealthIndicator — 0 = healthy, >0 = degraded, null = unknown/collecting.
 */
export default function StatusBadge({ value, testId }: { value: number | null; testId?: string }) {
  const { t } = useLanguage();
  if (value == null) {
    return (
      <span
        data-testid={testId}
        className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 text-xs font-medium text-ink/60 dark:bg-white/10 dark:text-white/60"
      >
        <CircleHelp size={14} strokeWidth={1.5} aria-hidden />
        {t('status.unknown')}
      </span>
    );
  }
  const healthy = value === 0;
  return (
    <span
      data-testid={testId}
      className={
        healthy
          ? 'inline-flex items-center gap-1.5 rounded-full bg-accentMint px-3 py-1 text-xs font-semibold text-ink'
          : 'inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white dark:bg-white dark:text-ink'
      }
    >
      {healthy ? (
        <CircleCheck size={14} strokeWidth={2} aria-hidden />
      ) : (
        <AlertTriangle size={14} strokeWidth={2} aria-hidden />
      )}
      {healthy ? t('status.healthy') : t('status.degraded')}
    </span>
  );
}
