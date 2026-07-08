import { describe, expect, it } from 'vitest';
import { formatBytes, formatCount, formatMicros } from './format';

// formatBytes uses decimal (SI, 1 KB = 1000 B) units — network transfer convention.
describe('formatBytes', () => {
  it('formats zero and sub-kilobyte values as bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(999)).toBe('999 B');
  });
  it('formats kilobytes with one decimal place', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1000)).toBe('1 KB');
    expect(formatBytes(10_500)).toBe('10.5 KB');
  });
  it('formats larger units', () => {
    expect(formatBytes(1_000_000)).toBe('1 MB');
    expect(formatBytes(2_340_000)).toBe('2.3 MB');
    expect(formatBytes(5_600_000_000)).toBe('5.6 GB');
    expect(formatBytes(1_200_000_000_000)).toBe('1.2 TB');
  });
  it('drops trailing .0', () => {
    expect(formatBytes(2000)).toBe('2 KB');
    expect(formatBytes(3_000_000)).toBe('3 MB');
  });
});

describe('formatCount', () => {
  it('keeps small numbers as-is with separators', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(42)).toBe('42');
    expect(formatCount(999)).toBe('999');
  });
  it('compacts thousands', () => {
    expect(formatCount(12_345)).toBe('12.3K');
    expect(formatCount(1000)).toBe('1K');
    expect(formatCount(7_265)).toBe('7.3K');
  });
  it('compacts millions and billions', () => {
    expect(formatCount(1_234_567)).toBe('1.2M');
    expect(formatCount(2_000_000_000)).toBe('2B');
  });
});

describe('formatMicros', () => {
  it('formats sub-millisecond values in µs', () => {
    expect(formatMicros(0)).toBe('0 µs');
    expect(formatMicros(900)).toBe('900 µs');
  });
  it('formats milliseconds', () => {
    expect(formatMicros(1500)).toBe('1.5 ms');
    expect(formatMicros(1000)).toBe('1 ms');
    expect(formatMicros(250_000)).toBe('250 ms');
  });
  it('formats seconds', () => {
    expect(formatMicros(1_500_000)).toBe('1.5 s');
    expect(formatMicros(2_000_000)).toBe('2 s');
  });
});
