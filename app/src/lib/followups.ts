/** Follow-up question generation for the chat SSE routes (/api/ai, /api/diagnose). */
import { converseOnce } from './bedrock';

/**
 * Parse raw model output into up to 3 clean follow-up questions.
 * Pure: splits on newlines, strips leading bullets/numbering (`-`, `*`, `•`,
 * `1.`, `1)`), trims, keeps lines of 5..120 chars, caps at 3.
 */
export function parseFollowups(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((line) => line.length >= 5 && line.length <= 120)
    .slice(0, 3);
}

/**
 * Generate 3 suggested follow-up questions from the assistant's answer and the
 * user's last question, via a short NON-streaming Converse call. Graceful: any
 * failure (model error, throttle, timeout) resolves to `[]` — never throws.
 */
export async function generateFollowups(
  answer: string,
  lastUser: string,
  lang: 'ko' | 'en',
): Promise<string[]> {
  if (!answer.trim()) return [];
  try {
    const system = [{ text: [
      'You are an AWS Network Flow Monitor (NFM) operations assistant for a dashboard',
      ' monitoring EKS/EC2 network traffic (flows, pods, paths, retransmissions, timeouts,',
      ' latency, AWS network resources). Given the previous answer and the last user',
      ' question, suggest EXACTLY 3 short, distinct follow-up questions the user is likely',
      ' to ask next. Output one question per line — no numbering, no bullets, no headers,',
      ' no extra text.',
      ` Write the questions in ${lang === 'ko' ? 'Korean' : 'English'}.`,
    ].join('') }];
    const { response } = await converseOnce({
      system,
      messages: [{ role: 'user', content: [{ text:
        `Previous answer:\n${answer.slice(0, 1200)}\n\nLast user question:\n${lastUser.slice(0, 300)}` }] }],
      inferenceConfig: { maxTokens: 300, temperature: 0.7 },
    });
    const text = (response.output?.message?.content ?? [])
      .map((b) => ('text' in b && b.text) ? b.text : '')
      .join('\n');
    return parseFollowups(text);
  } catch (e) {
    console.warn('[followups] generation failed — skipping:', e);
    return [];
  }
}
