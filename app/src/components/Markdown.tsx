'use client';

import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import CodeBlock from './CodeBlock';

// Unified markdown renderer for AI answers (ChatPanel bubbles, /diagnose).
// Element styles live in globals.css under `.chat-markdown` (SnowUI tokens,
// light/dark) so every consumer gets the same look; rehype-highlight adds
// hljs classes and the only component override routes fenced blocks through
// <CodeBlock> for the copy button.
// Memoized (children is a plain string, so the default shallow compare is
// exact): past messages skip the react-markdown/unified re-parse on every
// SSE chunk or keystroke in ChatPanel.
function Markdown({ children }: { children: string }) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // `node` (hast) must not leak onto the DOM element.
          pre: ({ node: _node, className, children: preChildren }) => (
            <CodeBlock className={className}>{preChildren}</CodeBlock>
          ),
          // Links open in a new tab so clicking one from the chat drawer /
          // popup doesn't navigate away and lose the conversation. Styling
          // stays in globals.css `.chat-markdown a`.
          a: ({ node: _node, ...props }) => <a target="_blank" rel="noreferrer" {...props} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export default memo(Markdown);
