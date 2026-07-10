'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, Loader2, RotateCcw, Send, Square } from 'lucide-react';
import ChatMessages, { type ChatMessage } from './ChatMessages';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { sendSse, sseErrorKey, type SseRequest } from '@/lib/use-sse';

// History shared across the inline panel, the /chat-popup iframe (same-tab
// sessionStorage) and the window.open popup (gets a copy on open).
const STORAGE_KEY = 'nfm-chat';

// Auto-growing textarea cap: ~5 lines of leading-5 text + vertical padding.
const INPUT_MAX_PX = 120;

const SUGGESTION_KEYS = [
  'chat.suggested.1',
  'chat.suggested.2',
  'chat.suggested.3',
  'chat.suggested.4',
  'chat.suggested.5',
] as const;

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
 * Chat UI over /api/ai SSE. Settled messages live in `messages` (persisted to
 * sessionStorage + synced across frames via `storage` events); the in-flight
 * answer streams into `streamText` and is only appended to `messages` when the
 * request finishes (done / stop / error) — so completed bubbles keep stable
 * references and skip re-parsing on every chunk (see ChatMessages).
 */
export default function ChatPanel({ compact = false }: { compact?: boolean }) {
  const { t, lang } = useLanguage();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [followups, setFollowups] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);

  // Mirrors for values read inside SSE callbacks / compound handlers, where
  // state from the closure could be one render behind.
  const messagesRef = useRef<ChatMessage[]>([]);
  const streamingRef = useRef(false);
  const streamRef = useRef('');
  const stagesRef = useRef<string[]>([]);
  const lastUserRef = useRef<string | null>(null);
  const atBottomRef = useRef(true);
  const reqRef = useRef<SseRequest | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const setHistory = (next: ChatMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  };

  // Load shared history on mount; follow writes from the other document
  // (iframe ↔ parent share sessionStorage, so `storage` events sync them).
  useEffect(() => {
    setHistory(loadHistory());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setHistory(loadHistory());
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      reqRef.current?.abort();
    };
  }, []);

  // Smart autoscroll: follow new content only while the user is at the bottom.
  useEffect(() => {
    if (!atBottomRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamText, stage, followups, errorMsg]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
    atBottomRef.current = near;
    setAtBottom(near);
  };

  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setAtBottom(true);
  };

  const persist = (msgs: ChatMessage[]) => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
    } catch {
      /* storage full/unavailable — chat still works in-memory */
    }
  };

  /** End the in-flight request, optionally appending its settled answer. */
  const settle = (msg: ChatMessage | null) => {
    const next = msg ? [...messagesRef.current, msg] : messagesRef.current;
    setHistory(next);
    streamingRef.current = false;
    setStreaming(false);
    setStage(null);
    setStreamText(null);
    persist(next);
  };

  const seenStages = () => (stagesRef.current.length ? [...stagesRef.current] : undefined);

  const localizeError = (message: string) => t(sseErrorKey(message));

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text || streamingRef.current) return;
    setInput('');
    if (inputRef.current) inputRef.current.style.height = '';
    setErrorMsg(null);
    setFollowups([]);
    lastUserRef.current = text;

    setHistory([...messagesRef.current, { role: 'user', content: text }]);
    streamingRef.current = true;
    setStreaming(true);
    setStage('connecting');
    streamRef.current = '';
    setStreamText('');
    stagesRef.current = [];

    // Failed answers are kept in the UI but excluded from the model context.
    const history = messagesRef.current
      .filter((m) => !m.error)
      .map((m) => ({ role: m.role, content: m.content }));

    reqRef.current = sendSse('/api/ai', { messages: history, lang }, {
      onStatus: (s) => {
        if (s.stage === 'keepalive') return;
        setStage(s.stage);
        if (!stagesRef.current.includes(s.stage)) stagesRef.current.push(s.stage);
      },
      onChunk: (c) => {
        setStage(null); // answer text is flowing — drop the thinking/tool badge
        streamRef.current += c.delta;
        setStreamText(streamRef.current);
      },
      onFollowups: (qs) => setFollowups(qs.slice(0, 3)),
      onDone: (d) => {
        if (d.followups?.length) setFollowups(d.followups.slice(0, 3));
        settle({
          role: 'assistant',
          content: d.content,
          usedTools: d.usedTools?.length ? d.usedTools : undefined,
          stages: seenStages(),
        });
      },
      onError: (e) => {
        // use-sse surfaces stable tokens ('unauthorized', 'HTTP <n>') —
        // localize here. Keep any partially streamed answer in the list.
        setErrorMsg(localizeError(e.message));
        const partial = streamRef.current;
        settle(
          partial
            ? { role: 'assistant', content: partial, error: true, stages: seenStages() }
            : null,
        );
      },
    });
  };

  // abort() suppresses all further SSE handlers (incl. onDone), so Stop runs
  // the finish path itself: persist the partial answer and clear the stream.
  const stop = () => {
    reqRef.current?.abort();
    const partial = streamRef.current;
    settle(
      partial
        ? { role: 'assistant', content: partial, stages: seenStages() }
        : null,
    );
  };

  // Re-send the last user message, replacing the failed exchange so the
  // retried question doesn't show up twice.
  const retry = () => {
    const text = lastUserRef.current;
    if (!text || streamingRef.current) return;
    const next = [...messagesRef.current];
    if (next.length && next[next.length - 1].role === 'assistant' && next[next.length - 1].error) {
      next.pop();
    }
    if (next.length && next[next.length - 1].role === 'user' && next[next.length - 1].content === text) {
      next.pop();
    }
    setHistory(next);
    setErrorMsg(null);
    send(text);
  };

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_PX)}px`;
  };

  const stageLabel =
    stage === null ? null : stage.startsWith('tool:')
      ? t('chat.tool', { name: stage.slice(5) })
      : t('chat.thinking');

  const showFollowups =
    !streaming &&
    followups.length > 0 &&
    messages.length > 0 &&
    messages[messages.length - 1].role === 'assistant' &&
    !messages[messages.length - 1].error;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className={`h-full space-y-3 overflow-y-auto ${compact ? 'p-3' : 'p-4'}`}
        >
          {messages.length === 0 && !streaming ? (
            <div className="flex flex-col items-center gap-4 px-2 pt-8">
              <p className="text-center text-sm text-ink/40 dark:text-white/40">
                {t('chat.empty')}
              </p>
              <div data-testid="chat-suggestions" className="flex w-full max-w-md flex-col gap-2">
                {SUGGESTION_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => send(t(key))}
                    className="rounded-card border border-black/10 bg-surface px-3.5 py-2.5 text-left text-[13px] leading-snug text-ink/80 transition-colors hover:border-chartViolet/50 hover:text-ink dark:border-white/10 dark:bg-white/5 dark:text-white/70 dark:hover:border-chartViolet/50 dark:hover:text-white"
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <ChatMessages messages={messages} streamText={streaming ? streamText : null} />

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

          {errorMsg && !streaming ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-2 rounded-card border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-600 dark:text-red-400"
            >
              <span>{errorMsg}</span>
              <button
                type="button"
                data-testid="chat-retry"
                onClick={retry}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-red-500/30 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-red-500/15"
              >
                <RotateCcw size={12} aria-hidden />
                {t('chat.retry')}
              </button>
            </div>
          ) : null}

          {showFollowups ? (
            <div
              role="group"
              data-testid="chat-followups"
              aria-label={t('chat.followups')}
              className="flex flex-wrap gap-1.5"
            >
              {followups.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => send(q)}
                  className="rounded-full border border-chartViolet/40 bg-chartViolet/10 px-3 py-1.5 text-left text-xs leading-snug text-ink/80 transition-colors hover:bg-chartViolet/20 dark:text-white/80 dark:hover:text-white"
                >
                  {q}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {!atBottom ? (
          <button
            type="button"
            data-testid="chat-scroll-bottom"
            onClick={jumpToBottom}
            className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-ink shadow-md transition-colors hover:bg-surface dark:border-white/15 dark:bg-ink dark:text-white dark:hover:bg-white/10"
          >
            <ArrowDown size={12} aria-hidden />
            {t('chat.scrollToBottom')}
          </button>
        ) : null}
      </div>

      <form
        className={`flex shrink-0 items-end gap-2 border-t border-black/5 dark:border-white/10 ${compact ? 'p-3' : 'p-4'}`}
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          ref={inputRef}
          data-testid="chat-input"
          rows={1}
          value={input}
          disabled={streaming}
          onChange={(e) => {
            setInput(e.target.value);
            autoGrow(e.currentTarget);
          }}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter inserts a newline; never send while
            // an IME composition (Korean input) is still in progress.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(input);
            }
          }}
          aria-label={t('chat.placeholder')}
          placeholder={t('chat.placeholder')}
          className="max-h-[120px] min-h-10 min-w-0 flex-1 resize-none rounded-lg border border-black/10 bg-white px-3 py-2.5 text-sm leading-5 text-ink outline-none focus:border-chartViolet disabled:opacity-50 dark:border-white/15 dark:bg-ink dark:text-white"
        />
        {streaming ? (
          <button
            type="button"
            data-testid="chat-stop"
            onClick={stop}
            aria-label={t('chat.stop')}
            title={t('chat.stop')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink text-white transition-opacity hover:opacity-90 dark:bg-white dark:text-ink"
          >
            <Square size={14} aria-hidden />
          </button>
        ) : (
          <button
            type="submit"
            data-testid="chat-send"
            disabled={!input.trim()}
            aria-label={t('chat.send')}
            title={t('chat.send')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-ink"
          >
            <Send size={16} aria-hidden />
          </button>
        )}
      </form>
    </div>
  );
}
