'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, MessageCircle, X } from 'lucide-react';
import ChatPanel from './ChatPanel';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { chatOpenMode } from '@/lib/ua';

/**
 * Bottom-right chat FAB → inline panel (mobile: full-screen sheet, desktop:
 * floating card). "Open as popup" branches on the browser (see lib/ua.ts):
 * Firefox gets a real window.open popup (iframe fallback if blocked), Chrome
 * and other desktop browsers get an overlay modal with an /chat-popup iframe,
 * mobile keeps the inline full-screen sheet.
 */
export default function FloatingChat() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [iframeOpen, setIframeOpen] = useState(false);
  const popupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (popupTimer.current) clearTimeout(popupTimer.current);
  }, []);

  const openPopup = () => {
    switch (chatOpenMode(navigator.userAgent)) {
      case 'mobile-sheet':
        // Popups are unusable on mobile — the inline sheet IS the popup.
        setOpen(true);
        return;
      case 'popup': {
        const win = window.open('/chat-popup', 'nfmchat', 'width=420,height=640');
        if (!win) {
          setIframeOpen(true); // blocked outright → iframe fallback
          setOpen(false);
          return;
        }
        // A blocker may still close it right after opening — verify shortly.
        popupTimer.current = setTimeout(() => {
          if (win.closed) setIframeOpen(true);
        }, 500);
        setOpen(false);
        return;
      }
      case 'iframe-modal':
        setIframeOpen(true);
        setOpen(false);
        return;
    }
  };

  const header = (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-black/5 px-4 py-3 dark:border-white/10">
      <h2 className="text-sm font-semibold">{t('chat.title')}</h2>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={openPopup}
          data-testid="chat-open-popup"
          aria-label={t('chat.openPopup')}
          title={t('chat.openPopup')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink/50 hover:bg-surface hover:text-ink dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
        >
          <ExternalLink size={15} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t('common.close')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink/50 hover:bg-surface hover:text-ink dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
    </div>
  );

  return (
    <>
      {!open && (
        <button
          type="button"
          data-testid="floating-chat-fab"
          onClick={() => setOpen(true)}
          aria-label={t('chat.title')}
          className="fixed bottom-16 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-white shadow-lg transition-transform hover:scale-105 dark:bg-white dark:text-ink lg:bottom-6 lg:right-6"
        >
          <MessageCircle size={24} strokeWidth={1.75} aria-hidden />
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label={t('chat.title')}
          className="fixed inset-0 z-[60] flex flex-col bg-white dark:bg-ink lg:inset-auto lg:bottom-6 lg:right-6 lg:h-[32rem] lg:w-96 lg:rounded-card lg:border lg:border-black/5 lg:shadow-xl lg:dark:border-white/10"
        >
          {header}
          <div className="min-h-0 flex-1">
            <ChatPanel compact />
          </div>
        </div>
      )}

      {iframeOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setIframeOpen(false)}
        >
          <div
            role="dialog"
            aria-label={t('chat.title')}
            data-testid="chat-iframe-modal"
            className="relative flex h-[640px] max-h-[90vh] w-[420px] max-w-full flex-col overflow-hidden rounded-card bg-white shadow-xl dark:bg-ink"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-4 py-3 dark:border-white/10">
              <h2 className="text-sm font-semibold">{t('chat.title')}</h2>
              <button
                type="button"
                onClick={() => setIframeOpen(false)}
                aria-label={t('common.close')}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink/50 hover:bg-surface hover:text-ink dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
              >
                <X size={16} aria-hidden />
              </button>
            </div>
            <iframe src="/chat-popup" title={t('chat.title')} className="h-full w-full flex-1" />
          </div>
        </div>
      )}
    </>
  );
}
