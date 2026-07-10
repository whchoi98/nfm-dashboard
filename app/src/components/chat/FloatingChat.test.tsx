// Render-smoke tests for the FloatingChat drawer (Phase 5 Task 5): FAB opens
// the slide-over drawer (role=dialog), ESC closes it and restores focus to the
// FAB, and "open in new window" branches per lib/ua.ts — Firefox popup falls
// back to the iframe modal IMMEDIATELY when window.open is blocked (no timer).
// Full focus-trap behavior is not exercised (jsdom has no real tab order);
// we assert the dialog holds focus and contains focusable controls.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import ko from '@/lib/i18n/translations/ko.json';
import FloatingChat from './FloatingChat';

// ChatPanel is rendered inside the drawer — keep its SSE client inert.
vi.mock('@/lib/use-sse', () => ({ sendSse: vi.fn() }));

const FF_UA = 'Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/128.0';

function stubUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

// No vitest globals in this repo — clean the DOM and stubs between tests.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // Remove any per-test userAgent override (falls back to the prototype getter).
  delete (window.navigator as unknown as Record<string, unknown>).userAgent;
});

function renderChat() {
  return render(
    <LanguageProvider>
      <FloatingChat />
    </LanguageProvider>,
  );
}

function openDrawer() {
  fireEvent.click(screen.getByTestId('floating-chat-fab'));
  return screen.getByRole('dialog');
}

describe('FloatingChat', () => {
  it('FAB opens the drawer dialog with header controls and focus inside', () => {
    renderChat();
    const fab = screen.getByTestId('floating-chat-fab');
    expect(fab.getAttribute('aria-label')).toBe(ko['chat.title']);

    const dialog = openDrawer();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe(ko['chat.title']);
    // FAB unmounts while the drawer is open; focus moved into the dialog.
    expect(screen.queryByTestId('floating-chat-fab')).toBeNull();
    expect(dialog.contains(document.activeElement)).toBe(true);
    // Focusable controls exist for the tab trap to cycle through.
    expect(within(dialog).getByTestId('chat-open-popup').getAttribute('aria-label')).toBe(
      ko['chat.openInNewWindow'],
    );
    expect(within(dialog).getByLabelText(ko['common.close'])).toBeTruthy();
    expect(within(dialog).getByTestId('chat-input')).toBeTruthy();
  });

  it('ESC closes the drawer and restores focus to the FAB', () => {
    renderChat();
    openDrawer();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    const fab = screen.getByTestId('floating-chat-fab');
    expect(document.activeElement).toBe(fab);
  });

  it('open-in-window on non-Firefox desktop swaps the drawer for the iframe modal (ESC closes it)', () => {
    // jsdom's default UA is neither mobile nor Firefox → 'desktop-iframe'.
    const openSpy = vi.spyOn(window, 'open');
    renderChat();
    openDrawer();
    fireEvent.click(screen.getByTestId('chat-open-popup'));

    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('chat-drawer')).toBeNull();
    const modal = screen.getByTestId('chat-iframe-modal');
    expect(modal.getAttribute('aria-modal')).toBe('true');
    expect(modal.querySelector('iframe')?.getAttribute('src')).toBe('/chat-popup');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('chat-iframe-modal')).toBeNull();
  });

  it('Firefox: window.open succeeds → no iframe modal; blocked → immediate iframe fallback', () => {
    stubUserAgent(FF_UA);
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    renderChat();
    openDrawer();
    fireEvent.click(screen.getByTestId('chat-open-popup'));
    expect(openSpy).toHaveBeenCalledWith('/chat-popup', 'nfmchat', 'width=420,height=640');
    expect(screen.queryByRole('dialog')).toBeNull(); // drawer closed, popup owns the chat

    // Popup blocked (window.open → null): iframe modal appears synchronously.
    openSpy.mockReturnValue(null);
    openDrawer();
    fireEvent.click(screen.getByTestId('chat-open-popup'));
    expect(screen.getByTestId('chat-iframe-modal')).toBeTruthy();
    expect(screen.queryByTestId('chat-drawer')).toBeNull();
  });
});
