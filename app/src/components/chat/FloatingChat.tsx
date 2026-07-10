'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { ExternalLink, MessageCircle, X } from 'lucide-react';
import ChatPanel from './ChatPanel';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { chatOpenMode } from '@/lib/ua';

/**
 * Bottom-right chat FAB → right-side slide-over drawer on desktop, full-screen
 * sheet on mobile. "Open in new window" branches on the browser (see lib/ua.ts):
 * Firefox gets a real window.open popup (immediate iframe fallback if blocked),
 * Chrome and other desktop browsers get an overlay modal with an /chat-popup
 * iframe, mobile keeps the inline full-screen sheet. ESC closes; Tab focus is
 * trapped inside the open dialog and restored to the FAB on close.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Minimal dialog focus management (no dependency): while `active`, move focus
 * into the container, close on Escape, wrap Tab/Shift+Tab at the edges, and
 * restore focus to `restoreRef` (the FAB) on close/unmount.
 */
function useDialogFocus(
  active: boolean,
  containerRef: RefObject<HTMLDivElement | null>,
  onClose: () => void,
  restoreRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    // Move focus into the dialog (container has tabIndex=-1 so it can hold
    // focus without hijacking the tab order).
    container.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusables.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const current = document.activeElement;
      const outside = !(current instanceof HTMLElement) || !container.contains(current);
      if (e.shiftKey) {
        if (outside || current === first || current === container) {
          e.preventDefault();
          last.focus();
        }
      } else if (outside || current === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // By cleanup time React has already committed the next tree, so the FAB
      // is back in the DOM when the dialog closes.
      restoreRef.current?.focus();
    };
  }, [active, containerRef, onClose, restoreRef]);
}

export default function FloatingChat() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [iframeOpen, setIframeOpen] = useState(false);
  // Two-phase mount → slide-in: start off-canvas, translate to 0 next frame.
  const [entered, setEntered] = useState(false);

  const fabRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const iframeModalRef = useRef<HTMLDivElement | null>(null);

  const closeDrawer = useCallback(() => setOpen(false), []);
  const closeIframe = useCallback(() => setIframeOpen(false), []);

  useDialogFocus(open, drawerRef, closeDrawer, fabRef);
  useDialogFocus(iframeOpen, iframeModalRef, closeIframe, fabRef);

  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const openInWindow = () => {
    switch (chatOpenMode(navigator.userAgent)) {
      case 'mobile-sheet':
        // Popups are unusable on mobile — the inline sheet IS the window.
        setOpen(true);
        return;
      case 'desktop-popup': {
        const win = window.open('/chat-popup', 'nfmchat', 'width=420,height=640');
        // Blocked outright → fall back to the iframe modal immediately.
        if (!win) setIframeOpen(true);
        setOpen(false);
        return;
      }
      case 'desktop-iframe':
        setIframeOpen(true);
        setOpen(false);
        return;
    }
  };

  const iconBtnCls =
    'flex h-8 w-8 items-center justify-center rounded-lg text-ink/50 hover:bg-surface hover:text-ink dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white';

  const header = (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-black/5 px-4 py-3 dark:border-white/10">
      <h2 className="text-sm font-semibold">{t('chat.title')}</h2>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={openInWindow}
          data-testid="chat-open-popup"
          aria-label={t('chat.openInNewWindow')}
          title={t('chat.openInNewWindow')}
          className={iconBtnCls}
        >
          <ExternalLink size={15} aria-hidden />
        </button>
        <button
          type="button"
          onClick={closeDrawer}
          aria-label={t('common.close')}
          className={iconBtnCls}
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
          ref={fabRef}
          data-testid="floating-chat-fab"
          onClick={() => setOpen(true)}
          aria-label={t('chat.title')}
          className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-white shadow-lg transition-transform hover:scale-105 dark:bg-white dark:text-ink lg:bottom-6 lg:right-6"
        >
          <MessageCircle size={24} strokeWidth={1.75} aria-hidden />
        </button>
      )}

      {open && (
        <>
          {/* Light scrim behind the desktop drawer (mobile sheet is full-screen). */}
          <div
            aria-hidden
            onClick={closeDrawer}
            className={`fixed inset-0 z-50 hidden bg-black/20 transition-opacity duration-300 lg:block ${
              entered ? 'opacity-100' : 'opacity-0'
            }`}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('chat.title')}
            ref={drawerRef}
            tabIndex={-1}
            data-testid="chat-drawer"
            className={`fixed inset-0 z-[60] flex flex-col bg-white pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] outline-none transition-transform duration-300 ease-out dark:bg-ink lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[26rem] lg:max-w-[90vw] lg:rounded-l-card lg:border-l lg:border-black/5 lg:pb-0 lg:pt-0 lg:shadow-xl lg:dark:border-white/10 ${
              entered ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            {header}
            <div className="min-h-0 flex-1">
              <ChatPanel compact />
            </div>
          </div>
        </>
      )}

      {iframeOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          onClick={closeIframe}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('chat.title')}
            ref={iframeModalRef}
            tabIndex={-1}
            data-testid="chat-iframe-modal"
            className="relative flex h-[640px] max-h-[90vh] w-[420px] max-w-full flex-col overflow-hidden rounded-card bg-white shadow-xl outline-none dark:bg-ink"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-4 py-3 dark:border-white/10">
              <h2 className="text-sm font-semibold">{t('chat.title')}</h2>
              <button
                type="button"
                onClick={closeIframe}
                aria-label={t('common.close')}
                className={iconBtnCls}
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
