'use client';

import { usePathname } from 'next/navigation';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import TopNav from './TopNav';
import MobileTabs from './MobileTabs';
import FloatingChat from '@/components/chat/FloatingChat';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // /chat-popup is a standalone window (popup / iframe): no shell chrome and
  // no FloatingChat (it would recurse into itself).
  if (pathname === '/chat-popup') {
    return <LanguageProvider>{children}</LanguageProvider>;
  }

  return (
    <LanguageProvider>
      <div className="flex min-h-screen flex-col">
        <TopNav />
        <main className="mx-auto w-full max-w-[1536px] flex-1 p-4 pb-20 lg:pb-4">{children}</main>
      </div>
      <MobileTabs />
      {/* /login is unauthenticated — /api/ai calls would just 401 there. */}
      {pathname !== '/login' && <FloatingChat />}
    </LanguageProvider>
  );
}
