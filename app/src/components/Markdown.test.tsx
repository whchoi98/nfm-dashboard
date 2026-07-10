// Render tests for the unified chat markdown renderer (Phase 5 Task 1):
// GFM elements, rehype-highlight on fenced blocks, and the CodeBlock copy
// button (clipboard write + transient "copied" label).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import ko from '@/lib/i18n/translations/ko.json';
import Markdown from './Markdown';

// No vitest globals in this repo, so testing-library's auto-cleanup does not
// register itself — clean the DOM between tests explicitly.
afterEach(cleanup);

function wrap(md: string) {
  return render(
    <LanguageProvider>
      <Markdown>{md}</Markdown>
    </LanguageProvider>,
  );
}

const CODE = '{ "a": 1 }';
const FENCED = '```json\n' + CODE + '\n```';

describe('Markdown', () => {
  it('renders headings, lists, tables and inline code inside .chat-markdown', () => {
    const { container } = wrap(
      [
        '# Title',
        '',
        '- item one',
        '- item two',
        '',
        'Use `kubectl` here.',
        '',
        '| col1 | col2 |',
        '| ---- | ---- |',
        '| a    | b    |',
      ].join('\n'),
    );
    expect(container.querySelector('.chat-markdown')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy();
    const list = screen.getByRole('list');
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByText('item one')).toBeTruthy();
    const inline = screen.getByText('kubectl');
    expect(inline.tagName).toBe('CODE');
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'col1' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'b' })).toBeTruthy();
  });

  it('highlights fenced code blocks (hljs class) and shows a copy button', () => {
    const { container } = wrap(FENCED);
    const code = container.querySelector('pre code');
    expect(code).toBeTruthy();
    expect(code?.className).toContain('hljs');
    expect(code?.className).toContain('language-json');
    // rehype-highlight tokenized the JSON into hljs spans.
    expect(code?.querySelector('[class*="hljs-"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: ko['chat.copy'] })).toBeTruthy();
  });

  it('copies the raw code text to the clipboard and toggles the label', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    wrap(FENCED);
    fireEvent.click(screen.getByRole('button', { name: ko['chat.copy'] }));
    expect(await screen.findByRole('button', { name: ko['chat.copied'] })).toBeTruthy();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(CODE);
  });
});
