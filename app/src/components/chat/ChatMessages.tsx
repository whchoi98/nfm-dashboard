'use client';

import { memo } from 'react';
import { Loader2 } from 'lucide-react';
import Markdown from '@/components/Markdown';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** The request behind this answer failed (partial/absent content). */
  error?: boolean;
  /** Tool names reported by the `done` event (assistant answers only). */
  usedTools?: string[];
  /** Agent stages seen while this answer streamed (`status` events). */
  stages?: string[];
}

const assistantBubble = (error?: boolean) =>
  `mr-6 max-w-[95%] rounded-card rounded-bl-md border px-3.5 py-2.5 ${
    error
      ? 'border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400'
      : 'border-black/5 bg-surface text-ink dark:border-white/10 dark:bg-white/5 dark:text-white'
  }`;

/**
 * One settled bubble. Memoized so streaming chunks (which re-render the list)
 * never re-render completed messages: settled entries keep the same object
 * reference between renders, so both this memo and the inner <Markdown> memo
 * (string children) stay effective while only the live bubble updates.
 */
const Bubble = memo(function Bubble({ m }: { m: ChatMessage }) {
  const { t } = useLanguage();
  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="ml-10 max-w-[85%] whitespace-pre-wrap rounded-card rounded-br-md border border-chartViolet/20 bg-accentLav px-3.5 py-2.5 text-sm text-ink">
          {m.content}
        </div>
      </div>
    );
  }
  const hasTrace = (m.usedTools?.length ?? 0) > 0 || (m.stages?.length ?? 0) > 0;
  return (
    <div className="flex justify-start">
      <div data-testid="chat-assistant-msg" className={assistantBubble(m.error)}>
        <Markdown>{m.content}</Markdown>
        {hasTrace ? (
          <details
            data-testid="chat-usedtools"
            className="mt-2 border-t border-black/5 pt-1.5 dark:border-white/10"
          >
            <summary className="cursor-pointer select-none text-[11px] font-medium text-ink/50 dark:text-white/50">
              {t('chat.usedTools')}
              {m.usedTools?.length ? ` (${m.usedTools.length})` : ''}
            </summary>
            {m.usedTools?.length ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1 font-mono text-[10px] text-ink/60 dark:text-white/60">
                {/* The server dedupes, but history persisted before that (or
                    any non-unique input) must never produce duplicate keys. */}
                {m.usedTools.map((tool, i) => (
                  <span
                    key={`${tool}-${i}`}
                    className="rounded-full bg-black/5 px-2 py-0.5 dark:bg-white/10"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            ) : null}
            {m.stages?.length ? (
              <p className="mt-1 font-mono text-[10px] text-ink/40 dark:text-white/40">
                {m.stages.join(' → ')}
              </p>
            ) : null}
          </details>
        ) : null}
      </div>
    </div>
  );
});

/**
 * Message list: settled bubbles + one optional live streaming bubble.
 * `streamText` is non-null while a request is in flight; it re-renders on
 * every chunk while the settled <Bubble>s above it are skipped by memo.
 */
export default function ChatMessages({
  messages,
  streamText,
}: {
  messages: ChatMessage[];
  streamText: string | null;
}) {
  return (
    <div data-testid="chat-messages" aria-live="polite" className="space-y-3">
      {messages.map((m, i) => (
        <Bubble key={i} m={m} />
      ))}
      {streamText !== null ? (
        <div className="flex justify-start">
          <div data-testid="chat-assistant-msg" className={assistantBubble()}>
            {streamText ? (
              <Markdown>{streamText}</Markdown>
            ) : (
              <Loader2 size={16} className="animate-spin text-ink/40 dark:text-white/40" aria-hidden />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
