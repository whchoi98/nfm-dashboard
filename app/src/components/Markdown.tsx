'use client';

import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// SnowUI-styled markdown renderer for AI answers (chat bubbles, diagnosis).
// Tables and code blocks sit in flat cards and scroll horizontally instead of
// overflowing the layout; colors stay on the ink/surface token pair.
// Memoized (children is a plain string, so the default shallow compare is
// exact): past messages skip the react-markdown/unified re-parse on every
// SSE chunk or keystroke in ChatPanel.
function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => <h3 className="mt-4 text-base font-semibold first:mt-0" {...p} />,
          h2: (p) => <h4 className="mt-4 text-sm font-semibold first:mt-0" {...p} />,
          h3: (p) => <h5 className="mt-3 text-sm font-semibold first:mt-0" {...p} />,
          h4: (p) => <h6 className="mt-3 text-sm font-semibold first:mt-0" {...p} />,
          p: (p) => <p className="my-2 first:mt-0 last:mb-0" {...p} />,
          ul: (p) => <ul className="my-2 list-disc space-y-1 pl-5" {...p} />,
          ol: (p) => <ol className="my-2 list-decimal space-y-1 pl-5" {...p} />,
          a: (p) => (
            <a
              className="font-medium text-chartViolet underline underline-offset-2"
              target="_blank"
              rel="noreferrer"
              {...p}
            />
          ),
          blockquote: (p) => (
            <blockquote
              className="my-2 border-l-2 border-black/10 pl-3 text-ink/70 dark:border-white/20 dark:text-white/70"
              {...p}
            />
          ),
          hr: () => <hr className="my-3 border-black/5 dark:border-white/10" />,
          // Code blocks: card + horizontal scroll; inline code styling on the
          // child <code> is reset via the [&_code] variants below.
          pre: (p) => (
            <pre
              className="my-2 overflow-x-auto rounded-card bg-ink/[.04] p-3 text-xs dark:bg-white/10 [&_code]:rounded-none [&_code]:bg-transparent [&_code]:p-0"
              {...p}
            />
          ),
          code: (p) => (
            <code
              className="rounded bg-ink/[.06] px-1 py-0.5 font-mono text-[0.85em] dark:bg-white/15"
              {...p}
            />
          ),
          // GFM tables: wrapped in a scrollable card so wide tables never
          // stretch the chat bubble / page.
          table: (p) => (
            <div className="my-2 overflow-x-auto rounded-card bg-white p-1 dark:bg-white/5">
              <table className="w-full min-w-max border-collapse text-xs" {...p} />
            </div>
          ),
          thead: (p) => <thead className="text-left text-ink/60 dark:text-white/60" {...p} />,
          th: (p) => (
            <th className="border-b border-black/10 px-2.5 py-1.5 font-medium dark:border-white/15" {...p} />
          ),
          td: (p) => (
            <td className="border-b border-black/5 px-2.5 py-1.5 align-top dark:border-white/10" {...p} />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export default memo(Markdown);
