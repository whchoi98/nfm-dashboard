'use client';

import { isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

// Recursively collect the plain text of a fenced code block. After
// rehype-highlight runs, the <code> children are a tree of <span
// class="hljs-*"> elements with string leaves, so a depth-first walk over
// React children is the robust way to recover the raw source.
function extractText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return extractText(node.props.children);
  return '';
}

// Fenced code block for the chat markdown renderer: highlighted <pre><code>
// (styles in globals.css under .chat-markdown / .hljs-*) plus a copy button
// pinned top-right. Token-styled, light/dark via the app's `dark` class.
export default function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the pending "copied" reset if the block unmounts mid-timeout.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handleCopy = async () => {
    // jsdom / insecure contexts have no clipboard — silently no-op.
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    try {
      // Fenced blocks carry a trailing newline from the markdown source.
      await navigator.clipboard.writeText(extractText(children).replace(/\n$/, ''));
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard write denied — keep the idle label instead of lying.
    }
  };

  const label = copied ? t('chat.copied') : t('chat.copy');
  return (
    <div className="relative">
      <pre className={className}>{children}</pre>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={label}
        className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-ink/[.06] px-2 py-1 text-[11px] font-medium text-ink/60 transition-colors hover:bg-ink/10 hover:text-ink dark:bg-white/10 dark:text-white/60 dark:hover:bg-white/20 dark:hover:text-white"
      >
        {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
        {label}
      </button>
    </div>
  );
}
