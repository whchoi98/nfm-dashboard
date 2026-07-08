// app/src/lib/i18n/i18n.test.tsx
import { it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { LanguageProvider, useLanguage } from './LanguageContext';

it('t() resolves ko/en with params and falls back to key', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    <LanguageProvider>{children}</LanguageProvider>;
  const { result } = renderHook(() => useLanguage(), { wrapper });
  act(() => result.current.setLang('en'));
  expect(result.current.t('nav.overview')).toBe('Overview');
  act(() => result.current.setLang('ko'));
  expect(result.current.t('nav.overview')).toBe('개요');
  expect(result.current.t('common.updatedAgo', { min: 5 })).toContain('5');
  expect(result.current.t('no.such.key')).toBe('no.such.key');
});
