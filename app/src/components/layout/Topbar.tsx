'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Moon, RotateCw, Sun } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { NAV_ITEMS, isActive } from './nav';

const THEME_KEY = 'nfm-theme';

export default function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { lang, setLang, t } = useLanguage();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
  };

  const current = NAV_ITEMS.find(({ href }) => isActive(pathname, href));
  const pageName = current ? t(current.key) : t('nav.overview');

  return (
    <header className="flex h-14 items-center justify-between border-b border-black/5 bg-white px-4 dark:border-white/10 dark:bg-ink">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-ink/40 dark:text-white/40">NFM</span>
        <span className="text-ink/40 dark:text-white/40">/</span>
        <span className="font-medium text-ink dark:text-white">{pageName}</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => router.refresh()}
          title={t('common.refresh')}
          aria-label={t('common.refresh')}
          className="flex h-9 w-9 items-center justify-center rounded-card text-ink/60 hover:bg-surface hover:text-ink dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
        >
          <RotateCw size={16} strokeWidth={1.5} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setLang(lang === 'ko' ? 'en' : 'ko')}
          title={t('common.switchLang')}
          aria-label={t('common.switchLang')}
          className="flex h-9 min-w-9 items-center justify-center rounded-card px-2 text-xs font-semibold text-ink/60 hover:bg-surface hover:text-ink dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
        >
          {lang === 'ko' ? 'ko' : 'EN'}
        </button>
        <button
          type="button"
          onClick={toggleTheme}
          title={t('common.toggleTheme')}
          aria-label={t('common.toggleTheme')}
          className="flex h-9 w-9 items-center justify-center rounded-card text-ink/60 hover:bg-surface hover:text-ink dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
        >
          {dark ? <Sun size={16} strokeWidth={1.5} aria-hidden /> : <Moon size={16} strokeWidth={1.5} aria-hidden />}
        </button>
      </div>
    </header>
  );
}
