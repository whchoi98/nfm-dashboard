import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import PageIntro from './PageIntro';
import ko from '@/lib/i18n/translations/ko.json';
import en from '@/lib/i18n/translations/en.json';

afterEach(cleanup);
const wrap = (ui: React.ReactNode) => render(<LanguageProvider>{ui}</LanguageProvider>);

// The 17 sidebar pages that carry an intro box (must match nav.ts + the wiring).
const PAGES = [
  'overview', 'topology', 'network', 'flows', 'paths', 'insights', 'workload',
  'monitors', 'history', 'alerts', 'anomalies', 'diagnose', 'agents', 'cost',
  'reports', 'search', 'settings',
];

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

describe('PageIntro i18n coverage', () => {
  const koRec = ko as Record<string, string>;
  const enRec = en as Record<string, string>;

  it('has the common 개요/기능 labels in both locales', () => {
    for (const rec of [koRec, enRec]) {
      expect(rec['pageintro.overview']).toBeTruthy();
      expect(rec['pageintro.features']).toBeTruthy();
    }
  });

  it('every one of the 17 pages has .what + .features in BOTH ko and en', () => {
    for (const page of PAGES) {
      for (const suffix of ['what', 'features'] as const) {
        const key = `pageintro.${page}.${suffix}`;
        expect(koRec[key], `missing ko: ${key}`).toBeTruthy();
        expect(enRec[key], `missing en: ${key}`).toBeTruthy();
      }
    }
  });
});
