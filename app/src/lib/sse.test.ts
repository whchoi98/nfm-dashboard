import { it, expect, vi } from 'vitest';
import { sseEvent, simulateStreaming } from './sse';
it('sseEvent formats event frame', () => {
  expect(sseEvent('chunk', { delta: 'hi' })).toBe('event: chunk\ndata: {"delta":"hi"}\n\n');
});
it('simulateStreaming emits 50-char chunks', async () => {
  vi.useFakeTimers();
  const chunks: string[] = [];
  const p = simulateStreaming('a'.repeat(120), d => chunks.push(d), 50, 15);
  await vi.runAllTimersAsync(); await p;
  expect(chunks.map(c => c.length)).toEqual([50, 50, 20]);
});
