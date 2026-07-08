'use client';

import ChatPanel from '@/components/chat/ChatPanel';

// Standalone chat window: AppShell renders this route without sidebar/topbar
// (and without FloatingChat) so it works as a window.open popup or an iframe.
export default function ChatPopupPage() {
  return (
    <div className="flex h-dvh flex-col bg-white dark:bg-ink">
      <ChatPanel compact />
    </div>
  );
}
