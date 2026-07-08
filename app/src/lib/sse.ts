/** Server-Sent Events helpers for /api/ai (and /api/diagnose fallback streaming). */

/** Format a single SSE frame: `event: X\ndata: {json}\n\n`. */
export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Emit `text` in fixed-size chunks with a small delay, simulating token
 * streaming for non-streaming responses (fallback util).
 */
export async function simulateStreaming(
  text: string,
  emit: (delta: string) => void,
  chunkSize = 50,
  delayMs = 15,
): Promise<void> {
  for (let i = 0; i < text.length; i += chunkSize) {
    emit(text.slice(i, i + chunkSize));
    if (i + chunkSize < text.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/**
 * Start a keepalive comment/status timer on an SSE stream.
 * Returns a stop function; always call it when the stream ends.
 */
export function keepalive(
  emit: (frame: string) => void,
  intervalMs = 15000,
): () => void {
  const timer = setInterval(() => emit(sseEvent('status', { stage: 'keepalive' })), intervalMs);
  return () => clearInterval(timer);
}
