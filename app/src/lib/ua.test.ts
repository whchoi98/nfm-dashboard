// app/src/lib/ua.test.ts
import { it, expect } from 'vitest';
import { chatOpenMode } from './ua';
const FF = 'Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/128.0';
const CH = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1';
it('firefox → popup', () => expect(chatOpenMode(FF)).toBe('popup'));
it('chrome → iframe-modal', () => expect(chatOpenMode(CH)).toBe('iframe-modal'));
it('iphone → mobile-sheet', () => expect(chatOpenMode(IOS)).toBe('mobile-sheet'));
