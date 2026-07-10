'use client';
// Datadog-style toplist: ranked horizontal bars (width ∝ value / max value)
// with label, optional sub text and a right-aligned formatted value. Status is
// dual-encoded per the chart-tokens mandate: STATUS color + leading dot + an
// sr-only text label — never color alone.
import { SERIES_COLORS, STATUS } from '@/lib/chart-tokens';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export type ToplistRow = {
  label: string;
  value: number;
  sub?: string;
  status?: keyof typeof STATUS; // 'ok' | 'warn' | 'danger'
};

export default function Toplist({
  rows,
  valueFormatter = String,
  onSelect,
  testId = 'toplist',
}: {
  rows: ToplistRow[];
  valueFormatter?: (v: number) => string;
  onSelect?: (label: string) => void;
  testId?: string;
}) {
  const { t } = useLanguage();

  if (rows.length === 0) {
    return (
      <p data-testid={testId} className="py-6 text-center text-xs text-ink/40 dark:text-white/40">
        {t('toplist.empty')}
      </p>
    );
  }

  const max = Math.max(...rows.map((r) => r.value));

  return (
    <ul data-testid={testId} className="flex flex-col gap-1.5">
      {rows.map((r, i) => {
        const pct = max > 0 ? Math.max(0, (r.value / max) * 100) : 0;
        const barColor = r.status ? STATUS[r.status] : SERIES_COLORS[0];
        const rowCls =
          'relative flex w-full items-center gap-2 overflow-hidden rounded-lg px-2 py-1.5 text-left text-xs text-ink dark:text-white';
        const content = (
          <>
            <span
              aria-hidden
              data-testid="toplist-bar"
              className="absolute inset-y-0 left-0 rounded-lg opacity-70 dark:opacity-40"
              style={{ width: `${pct}%`, backgroundColor: barColor }}
            />
            <span className="relative flex min-w-0 flex-1 items-baseline gap-1.5">
              {r.status ? (
                <>
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 self-center rounded-full"
                    style={{ backgroundColor: STATUS[r.status] }}
                  />
                  <span className="sr-only">{t(`toplist.status.${r.status}`)}</span>
                </>
              ) : null}
              <span className="truncate font-medium">{r.label}</span>
              {r.sub ? (
                <span className="truncate text-[11px] text-ink/40 dark:text-white/40">{r.sub}</span>
              ) : null}
            </span>
            <span className="relative shrink-0 font-semibold tabular-nums">{valueFormatter(r.value)}</span>
          </>
        );
        return (
          <li key={`${r.label}-${i}`}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(r.label)}
                className={`${rowCls} cursor-pointer hover:bg-black/5 dark:hover:bg-white/10`}
              >
                {content}
              </button>
            ) : (
              <div className={rowCls}>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
