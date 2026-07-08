'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import ko from './translations/ko.json';
import en from './translations/en.json';

type Lang = 'ko' | 'en';
const dict: Record<Lang, Record<string, string>> = { ko, en };
const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void;
  t: (k: string, p?: Record<string, string | number>) => string } | null>(null);

const syncHtmlLang = (l: Lang) => {
  if (typeof document !== 'undefined') document.documentElement.lang = l;
};

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('ko');
  useEffect(() => {
    const saved = localStorage.getItem('nfm-lang') as Lang | null;
    if (saved === 'ko' || saved === 'en') setLangState(saved);
    syncHtmlLang(saved === 'ko' || saved === 'en' ? saved : 'ko');
  }, []);
  const setLang = (l: Lang) => { setLangState(l); localStorage.setItem('nfm-lang', l); syncHtmlLang(l); };
  const t = (k: string, p?: Record<string, string | number>) => {
    let s = dict[lang][k] ?? k;
    for (const [key, v] of Object.entries(p ?? {})) s = s.replaceAll(`{${key}}`, String(v));
    return s;
  };
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}
export function useLanguage() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLanguage outside provider');
  return v;
}
