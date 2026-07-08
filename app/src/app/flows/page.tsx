'use client';

import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function FlowsPage() {
  const { t } = useLanguage();
  return <h1 className="text-2xl font-semibold">{t('nav.flows')}</h1>;
}
