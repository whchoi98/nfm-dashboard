import { NextRequest, NextResponse } from 'next/server';
import {
  buildAuthUrls,
  clearTransientCookie,
  safeEqual,
  sessionCookie,
  verifyIdToken,
  NONCE_COOKIE_NAME,
  PKCE_COOKIE_NAME,
  STATE_COOKIE_NAME,
} from '@/lib/auth';

const TRANSIENT_COOKIES = [PKCE_COOKIE_NAME, STATE_COOKIE_NAME, NONCE_COOKIE_NAME];

/** One-shot login material: clear the transient cookies on every terminal response. */
function clearTransients(res: NextResponse): NextResponse {
  for (const name of TRANSIENT_COOKIES) {
    res.headers.append('Set-Cookie', clearTransientCookie(name));
  }
  return res;
}

export async function GET(req: NextRequest) {
  const base = process.env.APP_URL || req.nextUrl.origin;
  try {
    const code = req.nextUrl.searchParams.get('code');
    if (!code) throw new Error('missing code');

    // CSRF: the state echoed by Cognito must equal the one bound to this browser.
    const state = req.nextUrl.searchParams.get('state');
    const cookieState = req.cookies.get(STATE_COOKIE_NAME)?.value;
    if (!state || !cookieState || !(await safeEqual(state, cookieState))) {
      throw new Error('state mismatch');
    }

    const codeVerifier = req.cookies.get(PKCE_COOKIE_NAME)?.value;
    if (!codeVerifier) throw new Error('missing pkce verifier');
    const nonce = req.cookies.get(NONCE_COOKIE_NAME)?.value;
    if (!nonce) throw new Error('missing nonce cookie');

    // Public client (no secret) — plain form POST, no Basic auth.
    // PKCE code_verifier proves this callback belongs to the /login that started the flow.
    const res = await fetch(buildAuthUrls().token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.COGNITO_CLIENT_ID ?? '',
        code,
        redirect_uri: `${base}/api/auth/callback`,
        code_verifier: codeVerifier,
      }),
    });
    if (!res.ok) throw new Error(`token endpoint returned ${res.status}`);

    const { id_token: idToken } = (await res.json()) as { id_token?: string };
    if (!idToken) throw new Error('missing id_token');

    // Replay protection: id_token's nonce claim must match this login's nonce.
    const user = await verifyIdToken(idToken, { nonce });
    if (!user) throw new Error('id_token verification failed');

    const redirect = NextResponse.redirect(new URL('/', base), 302);
    redirect.headers.set('Set-Cookie', sessionCookie(idToken));
    return clearTransients(redirect);
  } catch {
    return clearTransients(NextResponse.redirect(new URL('/login?error=1', base), 302));
  }
}
