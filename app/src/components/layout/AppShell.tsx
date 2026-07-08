'use client';

import { usePathname } from 'next/navigation';
import { LanguageProvider, useLanguage } from '@/lib/i18n/LanguageContext';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import MobileTabs from './MobileTabs';
import FloatingChat from '@/components/chat/FloatingChat';

function FooterAttribution() {
  const { t } = useLanguage();
  return (
    <footer className="px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] text-xs text-ink/40 dark:text-white/40 lg:pb-4">
      <a
        href="https://www.figma.com/@byewind"
        target="_blank"
        rel="noreferrer"
        className="hover:underline"
      >
        {t('footer.attribution')}
      </a>
    </footer>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // /chat-popup is a standalone window (popup / iframe): no shell chrome and
  // no FloatingChat (it would recurse into itself).
  if (pathname === '/chat-popup') {
    return <LanguageProvider>{children}</LanguageProvider>;
  }

  return (
    <LanguageProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 p-4 pb-20 lg:pb-4">{children}</main>
          <FooterAttribution />
        </div>
      </div>
      <MobileTabs />
      {/* /login is unauthenticated — /api/ai calls would just 401 there. */}
      {pathname !== '/login' && <FloatingChat />}
    </LanguageProvider>
  );
}
