import { it, expect } from 'vitest';
import { buildAuthUrls, sessionCookie } from './auth';
const env = { COGNITO_DOMAIN: 'https://d.auth.ap-northeast-2.amazoncognito.com',
  COGNITO_CLIENT_ID: 'cid', APP_URL: 'https://x.cloudfront.net' };
it('authorize URL has code flow params', () => {
  const u = new URL(buildAuthUrls(env).authorize);
  expect(u.searchParams.get('response_type')).toBe('code');
  expect(u.searchParams.get('redirect_uri')).toBe('https://x.cloudfront.net/api/auth/callback');
});
it('session cookie is httpOnly+secure', () => {
  expect(sessionCookie('tok')).toMatch(/HttpOnly/i);
  expect(sessionCookie('tok')).toMatch(/Secure/i);
});
