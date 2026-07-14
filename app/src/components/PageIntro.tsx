'use client';
// Per-page intro box: a compact "what this dashboard is (개요) / what it does
// (기능)" banner rendered directly under each page title, so a viewer grasps
// each of the 17 sidebar pages at a glance. Copy lives in i18n
// (pageintro.<page>.what / .features); the row labels come from
// pageintro.overview / pageintro.features. Colors use SnowUI token classes
// only (no hardcoded hex). Presentational + client-only (uses useLanguage).
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function PageIntro({ page }: { page: string }) {
  const { t } = useLanguage();
  return (
    <div
      data-testid="page-intro"
      data-page={page}
      className="rounded-card border border-ink/10 bg-surface px-4 py-3 text-sm dark:border-white/10 dark:bg-white/5"
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="shrink-0 font-semibold text-ink/45 dark:text-white/45">
          {t('pageintro.overview')}
        </dt>
        <dd className="text-ink/80 dark:text-white/80">{t(`pageintro.${page}.what`)}</dd>
        <dt className="shrink-0 font-semibold text-ink/45 dark:text-white/45">
          {t('pageintro.features')}
        </dt>
        <dd className="text-ink/65 dark:text-white/65">{t(`pageintro.${page}.features`)}</dd>
      </dl>
    </div>
  );
}
