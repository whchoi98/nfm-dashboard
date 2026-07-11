'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown, Moon, RotateCw, Sun } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { APP_VERSION } from '@/lib/version';
import { NAV_ITEMS, isActive } from './nav';

const THEME_KEY = 'nfm-theme';

// Items shown inline in the horizontal menu; the rest live under "More".
const PRIMARY_HREFS = ['/', '/topology', '/network', '/insights', '/monitors', '/alerts'];

export default function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { lang, setLang, t } = useLanguage();
  const [dark, setDark] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  // Close the "More" dropdown on route change (covers keyboard navigation too).
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // Close the "More" dropdown on outside click or Escape.
  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMoreOpen(false);
        moreButtonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [moreOpen]);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
  };

  const primary = NAV_ITEMS.filter(({ href }) => PRIMARY_HREFS.includes(href));
  const more = NAV_ITEMS.filter(({ href }) => !PRIMARY_HREFS.includes(href));
  const moreActive = more.some(({ href }) => isActive(pathname, href));

  return (
    <header
      data-testid="top-nav"
      className="sticky top-0 z-40 border-b border-black/5 bg-white dark:border-white/10 dark:bg-ink"
    >
      <div className="mx-auto flex h-14 w-full max-w-[1536px] items-center gap-3 px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accentLav text-xs font-semibold text-ink">
            N
          </span>
          <span className="hidden text-sm font-semibold text-ink sm:inline dark:text-white">NFM Dashboard</span>
        </Link>
        {/* Version label — synced to CHANGELOG.md via APP_VERSION (lib/version.ts). */}
        <span data-testid="app-version" className="shrink-0 text-[11px] text-ink/40 dark:text-white/40">
          v{APP_VERSION}
        </span>

        {/* Desktop horizontal menu — mobile navigation lives in MobileTabs. */}
        <nav className="hidden min-w-0 flex-1 items-center gap-1 lg:flex">
          {primary.map(({ href, key, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-card px-2.5 py-1.5 text-sm transition-colors ${
                  active
                    ? 'bg-surface font-medium text-ink dark:bg-white/10 dark:text-white'
                    : 'text-ink/60 hover:bg-surface/60 hover:text-ink dark:text-white/60 dark:hover:bg-white/5 dark:hover:text-white'
                }`}
              >
                <Icon size={16} strokeWidth={1.5} aria-hidden />
                {t(key)}
              </Link>
            );
          })}
          <div ref={moreRef} className="relative">
            <button
              ref={moreButtonRef}
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              data-testid="top-nav-more"
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-card px-2.5 py-1.5 text-sm transition-colors ${
                moreActive || moreOpen
                  ? 'bg-surface font-medium text-ink dark:bg-white/10 dark:text-white'
                  : 'text-ink/60 hover:bg-surface/60 hover:text-ink dark:text-white/60 dark:hover:bg-white/5 dark:hover:text-white'
              }`}
            >
              {t('nav.more')}
              <ChevronDown
                size={14}
                strokeWidth={1.5}
                aria-hidden
                className={`transition-transform ${moreOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {moreOpen && (
              <div
                data-testid="top-nav-more-menu"
                className="absolute left-0 top-full mt-1 w-56 rounded-card border border-black/5 bg-white p-2 shadow-lg dark:border-white/10 dark:bg-ink"
              >
                {more.map(({ href, key, icon: Icon }) => {
                  const active = isActive(pathname, href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setMoreOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={`flex min-h-9 items-center gap-3 rounded-card px-3 text-sm ${
                        active
                          ? 'bg-surface font-medium text-ink dark:bg-white/10 dark:text-white'
                          : 'text-ink/60 hover:bg-surface/60 hover:text-ink dark:text-white/60 dark:hover:bg-white/5 dark:hover:text-white'
                      }`}
                    >
                      <Icon size={18} strokeWidth={1.5} aria-hidden />
                      {t(key)}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </nav>

        {/* Toggles — visible on all breakpoints so mobile keeps refresh/lang/theme. */}
        <div className="ml-auto flex shrink-0 items-center gap-1 lg:ml-0">
          <button
            type="button"
            onClick={() => router.refresh()}
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
            className="flex h-11 w-11 items-center justify-center rounded-card text-ink/60 hover:bg-surface hover:text-ink lg:h-9 lg:w-9 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <RotateCw size={16} strokeWidth={1.5} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')}
            title={t('common.switchLang')}
            aria-label={t('common.switchLang')}
            className="flex h-11 min-w-11 items-center justify-center rounded-card px-2 text-xs font-semibold text-ink/60 hover:bg-surface hover:text-ink lg:h-9 lg:min-w-9 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
          >
            {lang === 'ko' ? 'ko' : 'EN'}
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            title={t('common.toggleTheme')}
            aria-label={t('common.toggleTheme')}
            className="flex h-11 w-11 items-center justify-center rounded-card text-ink/60 hover:bg-surface hover:text-ink lg:h-9 lg:w-9 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
          >
            {dark ? <Sun size={16} strokeWidth={1.5} aria-hidden /> : <Moon size={16} strokeWidth={1.5} aria-hidden />}
          </button>
        </div>
      </div>
    </header>
  );
}
