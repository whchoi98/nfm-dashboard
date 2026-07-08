/**
 * Client-side SSE-over-POST reader for /api/ai and /api/diagnose.
 * EventSource cannot send a POST body, so we fetch + read the stream manually.
 * Event contract (see /api/ai, /api/diagnose): `event: status|chunk|done|error`.
 */

export interface SseStatus { stage: string; message?: string }
export interface SseChunk { delta: string }
export interface SseDone {
  content: string;
  usedTools?: string[];
  elapsedMs: number;
  model: string;
  regenerate?: boolean;
}
export interface SseError { message: string }

export interface SseHandlers {
  onStatus?: (s: SseStatus) => void;
  onChunk?: (c: SseChunk) => void;
  onDone?: (d: SseDone) => void;
  onError?: (e: SseError) => void;
}

export interface SseRequest {
  /** Resolves when the stream ends (done, error or abort) — never rejects. */
  done: Promise<void>;
  /** Cancel the in-flight request; no handler is called afterwards. */
  abort: () => void;
}

/** Parse one `event:`/`data:` frame and dispatch it to the matching handler. */
function dispatchFrame(frame: string, handlers: SseHandlers): void {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    // comment lines (`:` keepalives) and unknown fields are ignored per SSE spec
  }
  if (dataLines.length === 0) return;
  let data: unknown;
  try {
    data = JSON.parse(dataLines.join('\n'));
  } catch {
    return; // malformed frame — skip rather than kill the stream
  }
  switch (event) {
    case 'status': handlers.onStatus?.(data as SseStatus); break;
    case 'chunk': handlers.onChunk?.(data as SseChunk); break;
    case 'done': handlers.onDone?.(data as SseDone); break;
    case 'error': handlers.onError?.(data as SseError); break;
  }
}

/**
 * POST `body` as JSON to `url` and stream the SSE response into `handlers`.
 * Frames are separated by `\n\n`; an incomplete frame is buffered across
 * reads so a frame split between two network chunks is still parsed once.
 */
export function sendSse(url: string, body: unknown, handlers: SseHandlers): SseRequest {
  const controller = new AbortController();

  const done = (async () => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        handlers.onError?.({ message: `request failed (HTTP ${res.status})` });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });
        // Split complete frames off the buffer; the trailing remainder (if
        // any) is an incomplete frame kept for the next read.
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          if (frame.trim()) dispatchFrame(frame, handlers);
        }
      }
      if (buffer.trim()) dispatchFrame(buffer, handlers); // stream ended mid-frame
    } catch (e) {
      if ((e as Error).name === 'AbortError') return; // caller cancelled — not an error
      handlers.onError?.({ message: (e as Error).message });
    }
  })();

  return { done, abort: () => controller.abort() };
}
