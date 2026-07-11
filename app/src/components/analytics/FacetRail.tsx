'use client';
// Reusable faceted filter rail (Datadog-CNM style): a column of radio facet
// groups with option counts. Desktop = always-open left rail; mobile = a
// collapsible top panel (toggle button) so the page never h-scrolls. Group and
// option labels arrive pre-translated from the caller; only the panel heading
// ('facet.filters') is translated here.
import { useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface FacetOption {
  value: string;
  label: string;
  count?: number;
}

export interface FacetGroup {
  key: string;
  label: string;
  options: FacetOption[];
}

export default function FacetRail({
  facets,
  value,
  onChange,
}: {
  facets: FacetGroup[];
  value: Record<string, string>;
  onChange: (key: string, val: string) => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <aside data-testid="facet-rail" className="rounded-card bg-surface p-3 dark:bg-white/5">
      {/* Mobile: collapsible header; desktop: static heading. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-xs font-semibold text-ink dark:text-white lg:hidden"
      >
        <span className="flex items-center gap-1.5">
          <SlidersHorizontal size={14} strokeWidth={1.5} aria-hidden />
          {t('facet.filters')}
        </span>
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          aria-hidden
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <p className="hidden items-center gap-1.5 text-xs font-semibold lg:flex">
        <SlidersHorizontal size={14} strokeWidth={1.5} aria-hidden />
        {t('facet.filters')}
      </p>

      <div className={`${open ? 'mt-3 flex' : 'hidden'} flex-col gap-4 lg:mt-3 lg:flex`}>
        {facets.map((g) => (
          <fieldset key={g.key}>
            <legend className="mb-1 text-[11px] font-medium text-ink/60 dark:text-white/60">
              {g.label}
            </legend>
            <div className="flex flex-col gap-0.5">
              {g.options.map((o) => (
                <label
                  key={o.value}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-xs ${
                    value[g.key] === o.value
                      ? 'bg-black/5 font-medium text-ink dark:bg-white/10 dark:text-white'
                      : 'text-ink/70 hover:bg-black/[.03] dark:text-white/70 dark:hover:bg-white/5'
                  }`}
                >
                  <input
                    type="radio"
                    name={`facet-${g.key}`}
                    value={o.value}
                    checked={value[g.key] === o.value}
                    onChange={() => onChange(g.key, o.value)}
                    className="h-3 w-3 shrink-0 accent-chartViolet"
                  />
                  <span className="min-w-0 flex-1 truncate" title={o.label}>
                    {o.label}
                  </span>
                  {o.count != null ? (
                    <span className="shrink-0 text-[10px] tabular-nums text-ink/40 dark:text-white/40">
                      {o.count}
                    </span>
                  ) : null}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </aside>
  );
}
