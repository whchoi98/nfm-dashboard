import { describe, it, expect } from 'vitest';
import { portLabel } from './port-mix';

describe('portLabel', () => {
  it('labels well-known ports and falls back to port N / unknown', () => {
    expect(portLabel(443)).toBe('HTTPS (443)');
    expect(portLabel(12345)).toBe('port 12345');
    expect(portLabel(undefined)).toBe('unknown');
  });
});
