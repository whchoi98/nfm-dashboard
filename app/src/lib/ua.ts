/** Browser-specific strategy for opening the chat outside the inline drawer. */
export type ChatOpenMode = 'mobile-sheet' | 'desktop-popup' | 'desktop-iframe';

/**
 * Pick how the chat should open for the given user agent.
 * - Mobile (iPhone|iPad|Android): full-screen sheet — popups are unusable there.
 * - Firefox (`Firefox/` token, excluding Seamonkey): real `window.open` popup
 *   works reliably; if the opener returns null (blocked) callers fall back to
 *   the iframe modal immediately — no timers, no re-checking.
 * - Chrome & other desktop browsers: iframe modal — Chrome demotes `window.open`
 *   to a tab when the Site Engagement Score is low, so an iframe is the safe default.
 */
export function chatOpenMode(userAgent: string): ChatOpenMode {
  if (/iPhone|iPad|Android/.test(userAgent)) return 'mobile-sheet';
  if (userAgent.includes('Firefox/') && !userAgent.includes('Seamonkey')) return 'desktop-popup';
  return 'desktop-iframe';
}
