'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import Markdown from '@/components/Markdown';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { sendSse, type SseRequest } from '@/lib/use-sse';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
}

// History shared across the inline panel, the /chat-popup iframe (same-tab
// sessionStorage) and the window.open popup (gets a copy on open).
const STORAGE_KEY = 'nfm-chat';

function loadHistory(): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Chat UI over /api/ai SSE: message list (user right / assistant left with
 * markdown), live-streaming assistant bubble, status badge for the current
 * agent stage (thinking / tool:<name>).
 */
export default function ChatPanel({ compact = false }: { compact?: boolean }) {
  const { t, lang } = useLanguage();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const reqRef = useRef<SseRequest | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load shared history on mount; follow writes from the other document
  // (iframe ↔ parent share sessionStorage, so `storage` events sync them).
  useEffect(() => {
    setMessages(loadHistory());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setMessages(loadHistory());
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      reqRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, stage]);

  const persist = (msgs: ChatMessage[]) => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
    } catch {
      /* storage full/unavailable — chat still works in-memory */
    }
  };

  const send = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    setStreaming(true);
    setStage('connecting');

    const history = [...messages.filter((m) => !m.error), { role: 'user' as const, content: text }];
    // Placeholder assistant bubble that the chunk handler streams into.
    let current: ChatMessage[] = [...messages, { role: 'user', content: text }, { role: 'assistant', content: '' }];
    setMessages(current);
    const patchLast = (patch: Partial<ChatMessage>) => {
      current = [...current.slice(0, -1), { ...current[current.length - 1], ...patch }];
      setMessages(current);
    };

    const finish = () => {
      setStreaming(false);
      setStage(null);
      persist(current);
    };
    reqRef.current = sendSse('/api/ai', { messages: history, lang }, {
      onStatus: (s) => {
        if (s.stage !== 'keepalive') setStage(s.stage);
      },
      onChunk: (c) => {
        setStage(null); // answer text is flowing — drop the thinking/tool badge
        patchLast({ content: current[current.length - 1].content + c.delta });
      },
      onDone: (d) => {
        patchLast({ content: d.content });
        finish();
      },
      onError: (e) => {
        // Keep any partially streamed answer, but append WHY it failed so the
        // reason isn't lost behind the error styling alone.
        const prev = current[current.length - 1].content;
        const reason = `${t('common.error')}: ${e.message}`;
        patchLast({
          content: prev ? `${prev}\n\n_⚠️ ${reason}_` : reason,
          error: true,
        });
        finish();
      },
    });
  };

  const stageLabel =
    stage === null ? null : stage.startsWith('tool:')
      ? t('chat.tool', { name: stage.slice(5) })
      : t('chat.thinking');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={`flex-1 space-y-3 overflow-y-auto ${compact ? 'p-3' : 'p-4'}`}>
        {messages.length === 0 && !streaming ? (
          <p className="pt-8 text-center text-sm text-ink/40 dark:text-white/40">
            {t('chat.empty')}
          </p>
        ) : null}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-card rounded-br-md bg-accentLav px-3.5 py-2.5 text-sm text-ink">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div
                data-testid="chat-assistant-msg"
                className={`max-w-[95%] rounded-card rounded-bl-md px-3.5 py-2.5 ${
                  m.error
                    ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                    : 'bg-surface text-ink dark:bg-white/5 dark:text-white'
                }`}
              >
                {m.content ? (
                  <Markdown>{m.content}</Markdown>
                ) : (
                  <Loader2 size={16} className="animate-spin text-ink/40 dark:text-white/40" aria-hidden />
                )}
              </div>
            </div>
          ),
        )}
        {stageLabel ? (
          <div className="flex justify-start">
            <span
              data-testid="chat-status"
              className="inline-flex items-center gap-1.5 rounded-full bg-accentBlue px-2.5 py-1 text-[11px] font-medium text-ink"
            >
              <Loader2 size={12} className="animate-spin" aria-hidden />
              {stageLabel}
            </span>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <form
        className={`flex shrink-0 items-center gap-2 border-t border-black/5 dark:border-white/10 ${compact ? 'p-3' : 'p-4'}`}
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          type="text"
          data-testid="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('chat.placeholder')}
          className="h-10 min-w-0 flex-1 rounded-lg border border-black/10 bg-white px-3 text-sm text-ink outline-none focus:border-chartViolet dark:border-white/15 dark:bg-ink dark:text-white"
        />
        <button
          type="submit"
          data-testid="chat-send"
          disabled={streaming || !input.trim()}
          aria-label={t('chat.send')}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-ink"
        >
          {streaming ? (
            <Loader2 size={16} className="animate-spin" aria-hidden />
          ) : (
            <Send size={16} aria-hidden />
          )}
        </button>
      </form>
    </div>
  );
}
