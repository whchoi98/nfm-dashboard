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

// Marks that we already auto-restarted this login once, so a second transient
// failure surfaces the error instead of looping.
const RETRY_COOKIE_NAME = 'nfm_auth_retry';

/** Transient/CSRF failures (state/pkce/nonce/code) — retryable: a concurrent
 *  /api/auth/login overwrote the one-shot cookies, or they expired. A fresh
 *  single flow (Cognito session now warm) usually completes cleanly. Token
 *  exchange / id_token verification failures are NOT this class. */
class RetryableAuthError extends Error {}

/** One-shot login material: clear the transient cookies on every terminal response. */
function clearTransients(res: NextResponse): NextResponse {
  for (const name of TRANSIENT_COOKIES) {
    res.headers.append('Set-Cookie', clearTransientCookie(name));
  }
  return res;
}

function setRetryMarker(res: NextResponse): NextResponse {
  res.headers.append(
    'Set-Cookie',
    `${RETRY_COOKIE_NAME}=1; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=120`,
  );
  return res;
}

function clearRetryMarker(res: NextResponse): NextResponse {
  res.headers.append(
    'Set-Cookie',
    `${RETRY_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  );
  return res;
}

export async function GET(req: NextRequest) {
  const base = process.env.APP_URL || req.nextUrl.origin;
  try {
    const code = req.nextUrl.searchParams.get('code');
    if (!code) throw new RetryableAuthError('missing code');

    // CSRF: the state echoed by Cognito must equal the one bound to this browser.
    const state = req.nextUrl.searchParams.get('state');
    const cookieState = req.cookies.get(STATE_COOKIE_NAME)?.value;
    if (!state || !cookieState || !(await safeEqual(state, cookieState))) {
      throw new RetryableAuthError('state mismatch');
    }

    const codeVerifier = req.cookies.get(PKCE_COOKIE_NAME)?.value;
    if (!codeVerifier) throw new RetryableAuthError('missing pkce verifier');
    const nonce = req.cookies.get(NONCE_COOKIE_NAME)?.value;
    if (!nonce) throw new RetryableAuthError('missing nonce cookie');

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
    return clearRetryMarker(clearTransients(redirect));
  } catch (err) {
    // Diagnostic: the thrown messages name the failing STEP (missing code /
    // state mismatch / missing pkce verifier / missing nonce cookie / token
    // endpoint returned N / missing id_token / id_token verification failed).
    // No token, code, or cookie VALUES are logged — only the step.
    console.warn(
      '[auth/callback] login failed:',
      err instanceof Error ? err.message : String(err),
    );

    // Transparent single auto-retry for transient/CSRF failures — most often a
    // concurrent /api/auth/login (stale tabs, double-click) clobbered the
    // one-shot state/pkce/nonce cookies. Restart the flow once; the warm
    // Cognito session then completes it without the user seeing an error.
    const alreadyRetried = req.cookies.get(RETRY_COOKIE_NAME)?.value === '1';
    if (err instanceof RetryableAuthError && !alreadyRetried) {
      return setRetryMarker(
        clearTransients(NextResponse.redirect(new URL('/api/auth/login', base), 302)),
      );
    }

    // Real failure, or the retry also failed → surface it and clear the marker.
    return clearRetryMarker(
      clearTransients(NextResponse.redirect(new URL('/login?error=1', base), 302)),
    );
  }
}
