'use client';

// /search — unified entity search: one debounced query box matched against the
// topology snapshot, recent flow endpoints, and DNS names (/api/search), with
// results grouped by entity type and deep-linked to the relevant page.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Box, Boxes, Globe, Hash, Network, Server, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { Card, TextInput } from '@/components/ui/Controls';
import Widget from '@/components/analytics/Widget';
import { LensState } from '@/app/insights/tabs/shared';
import { MIN_QUERY_LENGTH, type SearchResult, type SearchResultType } from '@/lib/search';

const DEBOUNCE_MS = 300;

const TYPE_ORDER: SearchResultType[] = ['pod', 'service', 'node', 'ip', 'subnet', 'domain'];

const TYPE_ICON: Record<SearchResultType, LucideIcon> = {
  pod: Box,
  service: Boxes,
  node: Server,
  ip: Hash,
  subnet: Network,
  domain: Globe,
};

function ResultRow({ result }: { result: SearchResult }) {
  const Icon = TYPE_ICON[result.type];
  return (
    <li>
      <Link
        href={result.href}
        className="flex items-center gap-3 rounded-lg bg-black/5 px-3 py-2 transition-colors hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10"
      >
        <Icon size={16} strokeWidth={1.75} className="shrink-0 text-ink/60 dark:text-white/60" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium" title={result.label}>
            {result.label}
          </span>
          {result.sublabel ? (
            <span className="block truncate text-[11px] text-ink/50 dark:text-white/50" title={result.sublabel}>
              {result.sublabel}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

export default function SearchPage() {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    if (debounced.length < MIN_QUERY_LENGTH) {
      setResults(null);
      setError(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`/api/search?q=${encodeURIComponent(debounced)}`, { signal: ctrl.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ results: SearchResult[] }>;
      })
      .then((data) => {
        setResults(data.results ?? []);
        setError(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return; // superseded by a newer query
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [debounced]);

  const groups = useMemo(() => {
    const byType = new Map<SearchResultType, SearchResult[]>();
    for (const r of results ?? []) {
      const list = byType.get(r.type);
      if (list) list.push(r);
      else byType.set(r.type, [r]);
    }
    return TYPE_ORDER.filter((type) => byType.has(type)).map(
      (type) => [type, byType.get(type) as SearchResult[]] as const,
    );
  }, [results]);

  const active = debounced.length >= MIN_QUERY_LENGTH;

  return (
    <div data-testid="search-page" className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{t('search.title')}</h1>

      <Card>
        <TextInput
          label={t('search.query')}
          value={query}
          onChange={setQuery}
          placeholder={t('search.placeholder')}
        />
      </Card>

      {!active ? (
        <p className="flex h-32 items-center justify-center px-4 text-center text-sm text-ink/40 dark:text-white/40">
          {t('search.hint')}
        </p>
      ) : (
        <LensState
          loading={loading && !results}
          error={error}
          empty={(results ?? []).length === 0}
          emptyLabel={t('search.noResults')}
        >
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            {groups.map(([type, items]) => (
              <Widget
                key={type}
                title={`${t(`search.type.${type}`)} (${items.length})`}
                testId={`search-group-${type}`}
              >
                <ul className="flex flex-col gap-2">
                  {items.map((r) => (
                    <ResultRow key={`${r.type}:${r.label}`} result={r} />
                  ))}
                </ul>
              </Widget>
            ))}
          </div>
        </LensState>
      )}
    </div>
  );
}
