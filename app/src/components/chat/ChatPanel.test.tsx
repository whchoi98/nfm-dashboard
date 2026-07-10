// Component tests for the reworked ChatPanel (Phase 5 Task 4): guided empty
// state, mocked SSE stream → live bubble + follow-up chips, Stop keeps the
// partial answer, localized error + retry. sendSse is mocked so every test
// drives the stream deterministically (no network, no timers).
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import ko from '@/lib/i18n/translations/ko.json';
import type { SseHandlers, SseRequest } from '@/lib/use-sse';
import ChatPanel from './ChatPanel';

// Partial mock: stub the network (sendSse) but keep the real sseErrorKey so
// the error-localization path under test uses the production mapping.
vi.mock('@/lib/use-sse', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/use-sse')>()),
  sendSse: vi.fn(),
}));
import { sendSse } from '@/lib/use-sse';

const sendSseMock = vi.mocked(sendSse);

let handlers: SseHandlers;
let abortMock: Mock<() => void>;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  abortMock = vi.fn<() => void>();
  sendSseMock.mockReset();
  sendSseMock.mockImplementation((_url, _body, h) => {
    handlers = h;
    return { done: Promise.resolve(), abort: abortMock } satisfies SseRequest;
  });
});

// No vitest globals in this repo, so testing-library's auto-cleanup does not
// register itself — clean the DOM between tests explicitly.
afterEach(cleanup);

function renderPanel() {
  return render(
    <LanguageProvider>
      <ChatPanel />
    </LanguageProvider>,
  );
}

function typeAndSend(text: string) {
  const input = screen.getByTestId('chat-input');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

function lastRequestMessages() {
  const body = sendSseMock.mock.calls[sendSseMock.mock.calls.length - 1][1] as {
    messages: { role: string; content: string }[];
  };
  return body.messages;
}

describe('ChatPanel', () => {
  it('shows 5 suggested prompts when empty and clicking one sends it', () => {
    renderPanel();
    const box = screen.getByTestId('chat-suggestions');
    const chips = within(box).getAllByRole('button');
    expect(chips).toHaveLength(5);
    expect(chips[0].textContent).toBe(ko['chat.suggested.1']);

    fireEvent.click(chips[0]);
    expect(sendSseMock).toHaveBeenCalledTimes(1);
    expect(sendSseMock.mock.calls[0][0]).toBe('/api/ai');
    const msgs = lastRequestMessages();
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: ko['chat.suggested.1'] });
    // conversation started — the guided empty state is gone
    expect(screen.queryByTestId('chat-suggestions')).toBeNull();
  });

  it('streams chunks into a live bubble, then shows follow-up chips that resend', () => {
    renderPanel();
    const input = screen.getByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'hello' } });
    // Shift+Enter inserts a newline instead of sending
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(sendSseMock).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(sendSseMock).toHaveBeenCalledTimes(1);

    act(() => {
      handlers.onStatus?.({ stage: 'thinking' });
      handlers.onChunk?.({ delta: 'Hello ' });
      handlers.onChunk?.({ delta: 'world' });
    });
    // in-flight bubble renders the partial markdown
    expect(screen.getByText('Hello world')).toBeTruthy();
    expect(screen.queryByTestId('chat-followups')).toBeNull();

    act(() => {
      handlers.onFollowups?.(['x', 'y']);
      handlers.onDone?.({
        content: 'Hello world',
        usedTools: ['get_metrics'],
        elapsedMs: 5,
        model: 'test-model',
      });
    });
    const chips = within(screen.getByTestId('chat-followups')).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['x', 'y']);
    // tool trace footer survives the end of streaming
    const trace = screen.getByTestId('chat-usedtools');
    expect(trace.textContent).toContain('get_metrics');
    expect(trace.textContent).toContain('thinking');

    fireEvent.click(chips[0]);
    expect(sendSseMock).toHaveBeenCalledTimes(2);
    const msgs = lastRequestMessages();
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'x' });
  });

  it('Stop aborts the request and keeps the partial answer in the history', () => {
    renderPanel();
    typeAndSend('question');
    act(() => {
      handlers.onChunk?.({ delta: 'partial answer' });
    });

    const stopBtn = screen.getByTestId('chat-stop');
    expect(stopBtn.getAttribute('aria-label')).toBe(ko['chat.stop']);
    fireEvent.click(stopBtn);

    expect(abortMock).toHaveBeenCalledTimes(1);
    // partial text settled into the list; input is back to Send mode
    expect(screen.getByText('partial answer')).toBeTruthy();
    expect(screen.queryByTestId('chat-stop')).toBeNull();
    expect(screen.getByTestId('chat-send')).toBeTruthy();
    // Stop ran the finish path itself: the partial answer is persisted
    const stored = JSON.parse(sessionStorage.getItem('nfm-chat') ?? '[]');
    expect(stored[stored.length - 1]).toMatchObject({ role: 'assistant', content: 'partial answer' });
  });

  it('localizes stable error tokens and Retry re-sends the last user message', () => {
    renderPanel();
    typeAndSend('who am i');
    act(() => {
      handlers.onError?.({ message: 'unauthorized' });
    });
    expect(screen.getByText(ko['chat.errAuth'])).toBeTruthy();

    fireEvent.click(screen.getByTestId('chat-retry'));
    expect(sendSseMock).toHaveBeenCalledTimes(2);
    const msgs = lastRequestMessages();
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'who am i' });
    // banner cleared while the retried request is in flight
    expect(screen.queryByText(ko['chat.errAuth'])).toBeNull();

    // non-auth tokens fall back to the generic message
    act(() => {
      handlers.onError?.({ message: 'HTTP 500' });
    });
    expect(screen.getByText(ko['chat.errGeneric'])).toBeTruthy();
    expect(screen.getByTestId('chat-retry')).toBeTruthy();
  });
});
