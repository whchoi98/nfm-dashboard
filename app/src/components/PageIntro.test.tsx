import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import PageIntro from './PageIntro';

afterEach(cleanup);
const wrap = (ui: React.ReactNode) => render(<LanguageProvider>{ui}</LanguageProvider>);

describe('PageIntro', () => {
  it('renders the box with the 개요 / 기능 labels and the page key', () => {
    wrap(<PageIntro page="network" />);
    const box = screen.getByTestId('page-intro');
    expect(box).toBeTruthy();
    expect(box.getAttribute('data-page')).toBe('network');
    // Row labels come from the common pageintro.* keys (default locale = ko).
    expect(screen.getByText('개요')).toBeTruthy();
    expect(screen.getByText('기능')).toBeTruthy();
    // Two definition-value cells (what / features) are present.
    expect(box.querySelectorAll('dd').length).toBe(2);
  });
});
