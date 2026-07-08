'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { LogIn } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

function LoginCard() {
  const { t } = useLanguage();
  const hasError = useSearchParams().get('error') === '1';
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-sm rounded-card bg-surface p-8 text-center dark:bg-white/5">
        <h1 className="text-xl font-semibold">NFM Dashboard</h1>
        {hasError && (
          <p className="mt-3 text-sm text-red-500" role="alert">
            {t('auth.loginError')}
          </p>
        )}
        <a
          href="/api/auth/login"
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 dark:bg-white dark:text-ink"
        >
          <LogIn size={16} aria-hidden />
          {t('auth.login')}
        </a>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginCard />
    </Suspense>
  );
}
