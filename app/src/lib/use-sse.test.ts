import { afterEach, expect, it, vi } from 'vitest';
import { sendSse } from './use-sse';

/** Build a Response-like object whose body streams the given string chunks. */
function sseResponse(chunks: string[]) {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

afterEach(() => vi.unstubAllGlobals());

it('parses two chunk frames even when a frame is split across reader chunks', async () => {
  const stream =
    'event: chunk\ndata: {"delta":"a"}\n\n' +
    'event: chunk\ndata: {"delta":"b"}\n\n' +
    'event: done\ndata: {"content":"ab","elapsedMs":5,"model":"m"}\n\n';
  // Split mid-way through the SECOND frame: the parser must buffer the
  // incomplete frame across reads instead of dropping it.
  const cut = stream.indexOf('{"delta":"b"') + 5;
  vi.stubGlobal('fetch', vi.fn(async () => sseResponse([stream.slice(0, cut), stream.slice(cut)])));

  const onChunk = vi.fn();
  const onDone = vi.fn();
  const onError = vi.fn();
  await sendSse('/api/ai', { messages: [] }, { onChunk, onDone, onError }).done;

  expect(onChunk).toHaveBeenCalledTimes(2);
  expect(onChunk).toHaveBeenNthCalledWith(1, { delta: 'a' });
  expect(onChunk).toHaveBeenNthCalledWith(2, { delta: 'b' });
  expect(onDone).toHaveBeenCalledWith({ content: 'ab', elapsedMs: 5, model: 'm' });
  expect(onError).not.toHaveBeenCalled();
});

it('dispatches status and error events', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    sseResponse([
      'event: status\ndata: {"stage":"tool:get_flows"}\n\n',
      'event: error\ndata: {"message":"boom"}\n\n',
    ]),
  ));
  const onStatus = vi.fn();
  const onError = vi.fn();
  await sendSse('/api/ai', {}, { onStatus, onError }).done;
  expect(onStatus).toHaveBeenCalledWith({ stage: 'tool:get_flows' });
  expect(onError).toHaveBeenCalledWith({ message: 'boom' });
});

it('reports non-2xx responses through onError as `HTTP <status>`', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    ({ ok: false, status: 500, body: null }) as unknown as Response,
  ));
  const onError = vi.fn();
  await sendSse('/api/ai', {}, { onError }).done;
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenCalledWith({ message: 'HTTP 500' });
});

it('maps 401 to a stable "unauthorized" message without reading the body as a stream', async () => {
  // middleware returns a JSON body on 401 — the client must NOT try to
  // read it as an SSE stream.
  const getReader = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () =>
    ({ ok: false, status: 401, body: { getReader } }) as unknown as Response,
  ));
  const onError = vi.fn();
  const onChunk = vi.fn();
  await sendSse('/api/ai', {}, { onError, onChunk }).done;
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenCalledWith({ message: 'unauthorized' });
  expect(getReader).not.toHaveBeenCalled();
  expect(onChunk).not.toHaveBeenCalled();
});

it('parses a followups frame and calls onFollowups, in stream order', async () => {
  const stream =
    'event: status\ndata: {"stage":"thinking"}\n\n' +
    'event: chunk\ndata: {"delta":"a"}\n\n' +
    'event: chunk\ndata: {"delta":"b"}\n\n' +
    'event: followups\ndata: {"questions":["a","b","c"]}\n\n' +
    'event: done\ndata: {"content":"ab","elapsedMs":5,"model":"m"}\n\n';
  // Split mid-way through the followups frame: it must survive buffering
  // across reads like every other frame type.
  const cut = stream.indexOf('"questions"') + 14;
  vi.stubGlobal('fetch', vi.fn(async () => sseResponse([stream.slice(0, cut), stream.slice(cut)])));

  const order: string[] = [];
  const onStatus = vi.fn(() => order.push('status'));
  const onChunk = vi.fn(() => order.push('chunk'));
  const onFollowups = vi.fn(() => order.push('followups'));
  const onDone = vi.fn(() => order.push('done'));
  const onError = vi.fn();
  await sendSse('/api/ai', {}, { onStatus, onChunk, onFollowups, onDone, onError }).done;

  expect(order).toEqual(['status', 'chunk', 'chunk', 'followups', 'done']);
  expect(onFollowups).toHaveBeenCalledTimes(1);
  expect(onFollowups).toHaveBeenCalledWith(['a', 'b', 'c']);
  expect(onError).not.toHaveBeenCalled();
});

it('skips followups frames with missing or non-array questions and keeps streaming', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    sseResponse([
      'event: followups\ndata: {"nope":true}\n\n',
      'event: followups\ndata: {"questions":"not-an-array"}\n\n',
      'event: done\ndata: {"content":"x","elapsedMs":1,"model":"m"}\n\n',
    ]),
  ));
  const onFollowups = vi.fn();
  const onDone = vi.fn();
  const onError = vi.fn();
  await sendSse('/api/ai', {}, { onFollowups, onDone, onError }).done;
  expect(onFollowups).not.toHaveBeenCalled();
  expect(onDone).toHaveBeenCalledTimes(1);
  expect(onError).not.toHaveBeenCalled();
});

it('abort() mid-stream stops dispatch of frames already buffered', async () => {
  // All frames arrive in a SINGLE read; the first handler call aborts.
  // The remaining frames sitting in the buffer must NOT be dispatched.
  vi.stubGlobal('fetch', vi.fn(async () =>
    sseResponse([
      'event: chunk\ndata: {"delta":"a"}\n\n' +
      'event: chunk\ndata: {"delta":"b"}\n\n' +
      'event: followups\ndata: {"questions":["q"]}\n\n' +
      'event: done\ndata: {"content":"ab","elapsedMs":5,"model":"m"}\n\n',
    ]),
  ));
  const onChunk = vi.fn(() => req.abort());
  const onFollowups = vi.fn();
  const onDone = vi.fn();
  const onError = vi.fn();
  const req = sendSse('/api/ai', {}, { onChunk, onFollowups, onDone, onError });
  await req.done;
  expect(onChunk).toHaveBeenCalledTimes(1); // second buffered chunk suppressed
  expect(onFollowups).not.toHaveBeenCalled();
  expect(onDone).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

it('releases the reader when a handler throws', async () => {
  const cancelled = vi.fn();
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode('event: chunk\ndata: {"delta":"a"}\n\n'));
      // stream deliberately left open — only reader.cancel() releases it
    },
    cancel: cancelled,
  });
  vi.stubGlobal('fetch', vi.fn(async () =>
    ({ ok: true, status: 200, body }) as unknown as Response,
  ));
  const onError = vi.fn();
  await sendSse('/api/ai', {}, {
    onChunk: () => { throw new Error('handler boom'); },
    onError,
  }).done;
  expect(cancelled).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenCalledWith({ message: 'handler boom' });
});

it('abort() cancels without calling onError', async () => {
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () =>
        reject(new DOMException('aborted', 'AbortError')),
      );
    }),
  ));
  const onError = vi.fn();
  const req = sendSse('/api/ai', {}, { onError });
  req.abort();
  await req.done;
  expect(onError).not.toHaveBeenCalled();
});
