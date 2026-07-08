'use client';

import { LanguageProvider, useLanguage } from '@/lib/i18n/LanguageContext';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import MobileTabs from './MobileTabs';

function FooterAttribution() {
  const { t } = useLanguage();
  return (
    <footer className="px-4 pb-20 text-xs text-ink/40 dark:text-white/40 lg:pb-4">
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
    </LanguageProvider>
  );
}
