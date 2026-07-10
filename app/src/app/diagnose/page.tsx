'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Play, RefreshCw } from 'lucide-react';
import Markdown from '@/components/Markdown';
import { Card } from '@/components/ui/Controls';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { sendSse, sseErrorKey, type SseDone, type SseRequest } from '@/lib/use-sse';

// AI network diagnosis: streams /api/diagnose (topology + anomaly context →
// sonnet) as markdown; Regenerate re-runs with a different analytical angle.
export default function DiagnosePage() {
  const { t, lang } = useLanguage();
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [meta, setMeta] = useState<Pick<SseDone, 'model' | 'elapsedMs'> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef<SseRequest | null>(null);

  useEffect(() => () => reqRef.current?.abort(), []);

  const run = (regenerate: boolean) => {
    if (running) return;
    setRunning(true);
    setOutput('');
    setMeta(null);
    setError(null);
    reqRef.current = sendSse('/api/diagnose', { lang, regenerate }, {
      onChunk: (c) => setOutput((prev) => prev + c.delta),
      onDone: (d) => {
        setOutput(d.content);
        setMeta({ model: d.model, elapsedMs: d.elapsedMs });
        setRunning(false);
      },
      onError: (e) => {
        // sendSse surfaces stable tokens ('unauthorized', 'HTTP <n>') —
        // localize them here, same mapping as ChatPanel.
        setError(t(sseErrorKey(e.message)));
        setRunning(false);
      },
    });
  };

  const btnCls =
    'inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-40';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('diagnose.title')}</h1>
          <p className="mt-1 text-sm text-ink/50 dark:text-white/50">{t('diagnose.hint')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="diagnose-run"
            onClick={() => run(false)}
            disabled={running}
            className={`${btnCls} bg-ink text-white dark:bg-white dark:text-ink`}
          >
            {running ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : (
              <Play size={15} aria-hidden />
            )}
            {t('diagnose.run')}
          </button>
          {(output || meta) && (
            <button
              type="button"
              data-testid="diagnose-regenerate"
              onClick={() => run(true)}
              disabled={running}
              className={`${btnCls} bg-surface text-ink dark:bg-white/10 dark:text-white`}
            >
              <RefreshCw size={15} aria-hidden />
              {t('diagnose.regenerate')}
            </button>
          )}
        </div>
      </div>

      {error && (
        <Card className="text-sm text-red-600 dark:text-red-400">
          {error}
        </Card>
      )}

      {(output || running) && (
        <Card testId="diagnose-output">
          {output ? (
            <Markdown>{output}</Markdown>
          ) : (
            <p className="flex items-center gap-2 text-sm text-ink/50 dark:text-white/50">
              <Loader2 size={15} className="animate-spin" aria-hidden />
              {t('diagnose.running')}
            </p>
          )}
          {meta && (
            <p className="mt-4 border-t border-black/5 pt-3 text-xs text-ink/40 dark:border-white/10 dark:text-white/40">
              {t('diagnose.meta', { model: meta.model, sec: (meta.elapsedMs / 1000).toFixed(1) })}
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
