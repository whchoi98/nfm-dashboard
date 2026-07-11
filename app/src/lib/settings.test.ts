import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings';

describe('parseSettings', () => {
  it('returns defaults for null (no stored value)', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults for invalid JSON', () => {
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults for non-object JSON (array / scalar)', () => {
    expect(parseSettings('[1,2]')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('42')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS);
  });

  it('parses a fully valid payload', () => {
    const stored = {
      defaultRange: '24h',
      retransThreshold: 20,
      timeoutThreshold: 2,
      costPerGb: 0.05,
      anomalySigma: 2.5,
      monitorFilter: 'monitor-a',
    };
    expect(parseSettings(JSON.stringify(stored))).toEqual(stored);
  });

  it('merges a partial payload over defaults', () => {
    expect(parseSettings(JSON.stringify({ anomalySigma: 4 }))).toEqual({
      ...DEFAULT_SETTINGS,
      anomalySigma: 4,
    });
  });

  it('ignores out-of-type or invalid values per field', () => {
    const stored = {
      defaultRange: '2h', // not a TimeRange
      retransThreshold: 'high', // not a number
      timeoutThreshold: null,
      costPerGb: 0.02, // valid — kept
      anomalySigma: {}, // not a number
      monitorFilter: 7, // not a string
    };
    expect(parseSettings(JSON.stringify(stored))).toEqual({
      ...DEFAULT_SETTINGS,
      costPerGb: 0.02,
    });
  });

  it('ignores empty-string monitorFilter', () => {
    expect(parseSettings(JSON.stringify({ monitorFilter: '' }))).toEqual(DEFAULT_SETTINGS);
  });

  it('has the documented defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      defaultRange: '1h',
      retransThreshold: 10,
      timeoutThreshold: 5,
      costPerGb: 0.01,
      anomalySigma: 3,
      monitorFilter: 'all',
    });
  });
});
