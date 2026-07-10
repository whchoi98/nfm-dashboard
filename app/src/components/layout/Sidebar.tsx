'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { APP_VERSION } from '@/lib/version';
import { NAV_ITEMS, isActive } from './nav';

export default function Sidebar() {
  const pathname = usePathname();
  const { t } = useLanguage();

  return (
    <aside className="hidden lg:flex w-56 shrink-0 flex-col border-r border-black/5 bg-white px-4 py-6 dark:border-white/10 dark:bg-ink">
      <Link href="/" className="mb-8 flex items-center gap-2 px-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accentLav text-xs font-semibold text-ink">
          N
        </span>
        <span className="text-sm font-semibold text-ink dark:text-white">NFM Dashboard</span>
      </Link>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ href, key, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-card px-3 py-2 text-sm transition-colors ${
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
      </nav>
      {/* Version label — synced to CHANGELOG.md via APP_VERSION (lib/version.ts). */}
      <div data-testid="app-version" className="mt-auto px-2 pt-6 text-[11px] text-ink/40 dark:text-white/40">
        NFM Dashboard v{APP_VERSION}
      </div>
    </aside>
  );
}
