/**
 * Client-side SSE-over-POST reader for /api/ai and /api/diagnose.
 * EventSource cannot send a POST body, so we fetch + read the stream manually.
 * Event contract (see /api/ai, /api/diagnose):
 * `event: status|chunk|followups|done|error`.
 */

export interface SseStatus { stage: string; message?: string }
export interface SseChunk { delta: string }
export interface SseDone {
  content: string;
  usedTools?: string[];
  elapsedMs: number;
  model: string;
  regenerate?: boolean;
  followups?: string[];
}
export interface SseError { message: string }

export interface SseHandlers {
  onStatus?: (s: SseStatus) => void;
  onChunk?: (c: SseChunk) => void;
  onFollowups?: (questions: string[]) => void;
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
    case 'followups': {
      const questions = (data as { questions?: unknown }).questions;
      // Tolerate missing/non-array payloads: skip rather than kill the stream.
      if (Array.isArray(questions)) {
        handlers.onFollowups?.(questions.filter((q): q is string => typeof q === 'string'));
      }
      break;
    }
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
      if (!res.ok) {
        // Non-OK responses (e.g. 401 from middleware) carry a JSON body, not
        // an SSE stream — never read them as one. Surface a stable,
        // machine-usable reason; the caller localizes it.
        handlers.onError?.({ message: res.status === 401 ? 'unauthorized' : `HTTP ${res.status}` });
        return;
      }
      if (!res.body) {
        handlers.onError?.({ message: `HTTP ${res.status}` });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          if (controller.signal.aborted) break;
          const { value, done: finished } = await reader.read();
          if (finished) break;
          buffer += decoder.decode(value, { stream: true });
          // Split complete frames off the buffer; the trailing remainder (if
          // any) is an incomplete frame kept for the next read. A handler may
          // call abort() mid-buffer — frames after that must not dispatch.
          let sep: number;
          while (!controller.signal.aborted && (sep = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            if (frame.trim()) dispatchFrame(frame, handlers);
          }
        }
        if (!controller.signal.aborted && buffer.trim()) {
          dispatchFrame(buffer, handlers); // stream ended mid-frame
        }
      } finally {
        // A throwing handler (or abort mid-read) must not leave the reader
        // locked and the connection lingering — always release it.
        try {
          await reader.cancel();
        } catch {
          /* stream already closed or errored — nothing to release */
        }
      }
    } catch (e) {
      // Caller cancelled — not an error, and no handler may fire after abort().
      if (controller.signal.aborted || (e as Error).name === 'AbortError') return;
      handlers.onError?.({ message: (e as Error).message });
    }
  })();

  return { done, abort: () => controller.abort() };
}
