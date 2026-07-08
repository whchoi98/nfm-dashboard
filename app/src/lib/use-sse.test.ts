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

it('reports non-2xx responses through onError', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    ({ ok: false, status: 401, body: null }) as unknown as Response,
  ));
  const onError = vi.fn();
  await sendSse('/api/ai', {}, { onError }).done;
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError.mock.calls[0][0].message).toContain('401');
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
