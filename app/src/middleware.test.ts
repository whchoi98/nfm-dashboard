// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';
import { SESSION_COOKIE_NAME } from '@/lib/auth';

// Real safeEqual/SESSION_COOKIE_NAME; only the network-bound JWT verify is stubbed.
vi.mock('@/lib/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth')>();
  return {
    ...mod,
    verifyIdToken: vi.fn(async (token: string) =>
      token === 'valid-token' ? { email: 'admin@example.com' } : null),
  };
});

const req = (path: string, init?: { cookie?: string; originVerify?: string }) => {
  const headers = new Headers();
  if (init?.cookie) headers.set('cookie', init.cookie);
  if (init?.originVerify) headers.set('x-origin-verify', init.originVerify);
  return new NextRequest(`https://app.example${path}`, { headers });
};

afterEach(() => vi.unstubAllEnvs());

describe('session gate (default: auth enforced)', () => {
  it('redirects unauthenticated page requests to /login', async () => {
    const res = await middleware(req('/topology'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://app.example/login');
  });

  it('returns 401 JSON for unauthenticated API requests', async () => {
    const res = await middleware(req('/api/flows'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('lets a valid session cookie through', async () => {
    const res = await middleware(req('/topology', { cookie: `${SESSION_COOKIE_NAME}=valid-token` }));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('AUTH_DISABLED=1 (operator toggle, honored in production — ADR-005)', () => {
  it('skips the session gate for pages and APIs', async () => {
    vi.stubEnv('AUTH_DISABLED', '1');
    for (const path of ['/topology', '/api/flows']) {
      const res = await middleware(req(path));
      expect(res.status, path).toBe(200);
      expect(res.headers.get('location'), path).toBeNull();
    }
  });

  it('still enforces the x-origin-verify perimeter (missing/wrong header → 403)', async () => {
    vi.stubEnv('AUTH_DISABLED', '1');
    vi.stubEnv('ORIGIN_VERIFY_SECRET', 's3cret');
    expect((await middleware(req('/topology'))).status).toBe(403);
    expect((await middleware(req('/api/flows', { originVerify: 'wrong' }))).status).toBe(403);
    expect((await middleware(req('/topology', { originVerify: 's3cret' }))).status).toBe(200);
  });
});

describe('paths exempt from the session gate in both modes', () => {
  it('always passes the ALB healthcheck, even without the origin header', async () => {
    vi.stubEnv('ORIGIN_VERIFY_SECRET', 's3cret');
    expect((await middleware(req('/api/health'))).status).toBe(200);
  });

  it('keeps /login and /api/auth/* public when auth is enforced', async () => {
    vi.stubEnv('ORIGIN_VERIFY_SECRET', 's3cret');
    for (const path of ['/login', '/api/auth/login']) {
      const res = await middleware(req(path, { originVerify: 's3cret' }));
      expect(res.status, path).toBe(200);
      expect(res.headers.get('location'), path).toBeNull();
    }
  });
});
