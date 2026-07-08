import { it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import { buildAuthUrls, pkceChallenge, randomUrlToken, sessionCookie } from './auth';

// jsdom lacks SubtleCrypto; fall back to Node's Web Crypto implementation in tests.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const env = { COGNITO_DOMAIN: 'https://d.auth.ap-northeast-2.amazoncognito.com',
  COGNITO_CLIENT_ID: 'cid', APP_URL: 'https://x.cloudfront.net' };
const B64URL = /^[A-Za-z0-9_-]+$/;

it('authorize URL has code flow params', () => {
  const u = new URL(buildAuthUrls(env).authorize);
  expect(u.searchParams.get('response_type')).toBe('code');
  expect(u.searchParams.get('redirect_uri')).toBe('https://x.cloudfront.net/api/auth/callback');
});
it('session cookie is httpOnly+secure', () => {
  expect(sessionCookie('tok')).toMatch(/HttpOnly/i);
  expect(sessionCookie('tok')).toMatch(/Secure/i);
});
it('pkceChallenge is deterministic base64url and differs from the verifier', async () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const [a, b] = [await pkceChallenge(verifier), await pkceChallenge(verifier)];
  expect(a).toBe(b);
  expect(a).toMatch(B64URL);
  expect(a).not.toBe(verifier);
});
it('buildAuthUrls appends state/code_challenge/nonce only when provided', () => {
  const withOpts = new URL(buildAuthUrls(env, { state: 's1', codeChallenge: 'c1', nonce: 'n1' }).authorize);
  expect(withOpts.searchParams.get('state')).toBe('s1');
  expect(withOpts.searchParams.get('code_challenge')).toBe('c1');
  expect(withOpts.searchParams.get('code_challenge_method')).toBe('S256');
  expect(withOpts.searchParams.get('nonce')).toBe('n1');
  const without = new URL(buildAuthUrls(env).authorize);
  for (const p of ['state', 'code_challenge', 'code_challenge_method', 'nonce']) {
    expect(without.searchParams.get(p)).toBeNull();
  }
});
it('randomUrlToken returns distinct base64url values', () => {
  const a = randomUrlToken();
  const b = randomUrlToken();
  expect(a).not.toBe(b);
  expect(a).toMatch(B64URL);
  expect(b).toMatch(B64URL);
});
