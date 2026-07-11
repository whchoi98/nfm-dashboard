'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { APP_VERSION } from '@/lib/version';
import { NAV_GROUPS, isActive } from './nav';

export default function Sidebar() {
  const pathname = usePathname();
  const { t } = useLanguage();

  return (
    <aside
      data-testid="sidebar"
      className="hidden lg:flex lg:w-60 lg:flex-shrink-0 lg:flex-col lg:border-r lg:border-black/5 lg:bg-white lg:dark:border-white/10 lg:dark:bg-ink"
    >
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-black/5 px-4 dark:border-white/10">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accentLav text-xs font-semibold text-ink">
            N
          </span>
          <span className="text-sm font-semibold text-ink dark:text-white">NFM Dashboard</span>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.key} className="mb-4">
            <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-ink/40 dark:text-white/40">
              {t(group.labelKey)}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.items.map(({ href, key, icon: Icon }) => {
                const active = isActive(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-2.5 rounded-card px-3 py-2 text-sm transition-colors ${
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
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-auto shrink-0 border-t border-black/5 px-4 py-3 dark:border-white/10">
        {/* Version label — synced to CHANGELOG.md via APP_VERSION (lib/version.ts). */}
        <span data-testid="app-version" className="text-[11px] text-ink/40 dark:text-white/40">
          NFM Dashboard v{APP_VERSION}
        </span>
      </div>
    </aside>
  );
}
