// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PKCE_COOKIE_NAME, STATE_COOKIE_NAME, NONCE_COOKIE_NAME } from '@/lib/auth';

// Real safeEqual / cookie helpers / buildAuthUrls; only the network-bound
// id_token verification is stubbed.
vi.mock('@/lib/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth')>();
  return { ...mod, verifyIdToken: vi.fn(async () => ({ email: 'demo@example.com' })) };
});

import { GET } from './route';
import { verifyIdToken } from '@/lib/auth';

const APP = 'https://app.example';

beforeEach(() => {
  vi.clearAllMocks(); // reset call counts between cases (verifyIdToken is asserted on)
  vi.stubEnv('APP_URL', APP);
  vi.stubEnv('COGNITO_DOMAIN', 'https://cog.example');
  vi.stubEnv('COGNITO_CLIENT_ID', 'client123');
  // Default: token endpoint returns a usable id_token.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id_token: 'tok' }), { status: 200 })));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function callback(params: Record<string, string>, cookies: Record<string, string>) {
  const url = new URL(`${APP}/api/auth/callback`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = new Headers();
  const jar = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  if (jar) headers.set('cookie', jar);
  return GET(new NextRequest(url, { headers }));
}

const setCookies = (res: Response) => res.headers.getSetCookie().join('\n');
const good = { [STATE_COOKIE_NAME]: 'S', [PKCE_COOKIE_NAME]: 'v', [NONCE_COOKIE_NAME]: 'n' };

describe('auth callback', () => {
  it('success: sets the session cookie, redirects to /, clears transients + retry marker', async () => {
    const res = await callback({ code: 'c', state: 'S' }, good);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${APP}/`);
    const sc = setCookies(res);
    expect(sc).toContain('nfm_id_token=tok');
    expect(sc).toMatch(/nfm_auth_retry=;.*Max-Age=0/);
  });

  it('transient failure (state mismatch), no prior retry: auto-restarts login once + sets retry marker', async () => {
    const res = await callback({ code: 'c', state: 'A' }, { ...good, [STATE_COOKIE_NAME]: 'B' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${APP}/api/auth/login`);
    expect(setCookies(res)).toContain('nfm_auth_retry=1');
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('transient failure again (retry marker present): surfaces the error, clears the marker — no loop', async () => {
    const res = await callback({ code: 'c', state: 'A' }, { ...good, [STATE_COOKIE_NAME]: 'B', nfm_auth_retry: '1' });
    expect(res.headers.get('location')).toBe(`${APP}/login?error=1`);
    expect(setCookies(res)).toMatch(/nfm_auth_retry=;.*Max-Age=0/);
  });

  it('non-transient failure (token endpoint 400): does NOT auto-retry even without a marker', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 400 })));
    const res = await callback({ code: 'c', state: 'S' }, good);
    expect(res.headers.get('location')).toBe(`${APP}/login?error=1`);
    expect(setCookies(res)).not.toContain('nfm_auth_retry=1');
  });
});
