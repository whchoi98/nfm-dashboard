'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { NAV_ITEMS, isActive } from './nav';

const PRIMARY_HREFS = ['/', '/topology', '/flows', '/diagnose'];

export default function MobileTabs() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const [moreOpen, setMoreOpen] = useState(false);

  const primary = NAV_ITEMS.filter(({ href }) => PRIMARY_HREFS.includes(href));
  const more = NAV_ITEMS.filter(({ href }) => !PRIMARY_HREFS.includes(href));
  const moreActive = more.some(({ href }) => isActive(pathname, href));

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-50 border-t border-black/5 bg-white pb-[env(safe-area-inset-bottom)] dark:border-white/10 dark:bg-ink">
      {moreOpen && (
        <div className="absolute bottom-full inset-x-0 border-t border-black/5 bg-white p-2 dark:border-white/10 dark:bg-ink">
          {more.map(({ href, key, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMoreOpen(false)}
              className={`flex min-h-11 items-center gap-3 rounded-card px-3 text-sm ${
                isActive(pathname, href)
                  ? 'bg-surface font-medium text-ink dark:bg-white/10 dark:text-white'
                  : 'text-ink/60 dark:text-white/60'
              }`}
            >
              <Icon size={18} strokeWidth={1.5} aria-hidden />
              {t(key)}
            </Link>
          ))}
        </div>
      )}
      <div className="flex">
        {primary.map(({ href, key, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setMoreOpen(false)}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] ${
                active ? 'font-medium text-ink dark:text-white' : 'text-ink/50 dark:text-white/50'
              }`}
            >
              <Icon size={20} strokeWidth={1.5} aria-hidden />
              {t(key)}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] ${
            moreActive || moreOpen ? 'font-medium text-ink dark:text-white' : 'text-ink/50 dark:text-white/50'
          }`}
        >
          <MoreHorizontal size={20} strokeWidth={1.5} aria-hidden />
          {t('nav.more')}
        </button>
      </div>
    </nav>
  );
}
