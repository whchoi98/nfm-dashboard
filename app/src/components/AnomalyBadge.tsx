'use client';

// Small anomaly-count badge (overview breaches area): danger-tinted pill,
// dual-encoded per the chart-tokens mandate (icon + localized count text,
// never color alone). Renders nothing when count is 0.
import { TriangleAlert } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { STATUS } from '@/lib/chart-tokens';

export default function AnomalyBadge({ count }: { count: number }) {
  const { t } = useLanguage();
  if (count <= 0) return null;
  return (
    <span
      data-testid="anomaly-badge"
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-ink"
      style={{ backgroundColor: STATUS.danger }}
    >
      <TriangleAlert size={14} strokeWidth={2} aria-hidden />
      {t('anomalies.badge', { count })}
    </span>
  );
}
