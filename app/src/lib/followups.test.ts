import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseFollowups, generateFollowups } from './followups';
import { converseOnce } from './bedrock';

vi.mock('./bedrock', () => ({ converseOnce: vi.fn() }));

describe('parseFollowups', () => {
  it('strips -, * and • bullets', () => {
    expect(parseFollowups('- first question here\n* second question here\n• third question here'))
      .toEqual(['first question here', 'second question here', 'third question here']);
  });

  it('strips 1. and 1) numbering', () => {
    expect(parseFollowups('1. numbered question one\n2) numbered question two'))
      .toEqual(['numbered question one', 'numbered question two']);
  });

  it('drops blank lines, lines under 5 chars and lines over 120 chars', () => {
    const long = 'x'.repeat(121);
    expect(parseFollowups(`\n   \nok?\n${long}\na valid question here\n`))
      .toEqual(['a valid question here']);
  });

  it('caps the result at 3 questions', () => {
    const out = parseFollowups('question one?\nquestion two?\nquestion three?\nquestion four?');
    expect(out).toEqual(['question one?', 'question two?', 'question three?']);
  });

  it('returns [] for empty or whitespace-only input', () => {
    expect(parseFollowups('')).toEqual([]);
    expect(parseFollowups('   \n \t \n')).toEqual([]);
  });

  it('parses a realistic 3-line model output into 3 clean questions', () => {
    const text = [
      '- 어떤 파드가 가장 많은 재전송을 보이나요?',
      '- INTER_AZ 경로의 지연 시간 추이는 어떤가요?',
      '- 특정 엣지의 타임아웃을 자세히 볼 수 있나요?',
    ].join('\n');
    expect(parseFollowups(text)).toEqual([
      '어떤 파드가 가장 많은 재전송을 보이나요?',
      'INTER_AZ 경로의 지연 시간 추이는 어떤가요?',
      '특정 엣지의 타임아웃을 자세히 볼 수 있나요?',
    ]);
  });
});

describe('generateFollowups', () => {
  beforeEach(() => { vi.mocked(converseOnce).mockReset(); });

  it('returns parsed questions from a converse response', async () => {
    vi.mocked(converseOnce).mockResolvedValue({
      response: { output: { message: { content: [
        { text: 'first follow-up question?\nsecond follow-up question?\nthird follow-up question?' },
      ] } } },
      modelId: 'test-model',
    } as never);
    const out = await generateFollowups('the answer text', 'the user question', 'en');
    expect(out).toEqual([
      'first follow-up question?',
      'second follow-up question?',
      'third follow-up question?',
    ]);
  });

  it('returns [] when the model call throws', async () => {
    vi.mocked(converseOnce).mockRejectedValue(new Error('throttled'));
    await expect(generateFollowups('the answer text', 'q', 'ko')).resolves.toEqual([]);
  });

  it('returns [] without calling bedrock when the answer is empty', async () => {
    await expect(generateFollowups('   ', 'q', 'ko')).resolves.toEqual([]);
    expect(converseOnce).not.toHaveBeenCalled();
  });
});
