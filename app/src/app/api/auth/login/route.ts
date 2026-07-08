import { NextResponse } from 'next/server';
import {
  buildAuthUrls,
  pkceChallenge,
  randomUrlToken,
  transientCookie,
  NONCE_COOKIE_NAME,
  PKCE_COOKIE_NAME,
  STATE_COOKIE_NAME,
} from '@/lib/auth';

export async function GET() {
  // Fresh per-login secrets: PKCE verifier, CSRF state, OIDC replay nonce.
  const verifier = randomUrlToken();
  const state = randomUrlToken();
  const nonce = randomUrlToken();
  const codeChallenge = await pkceChallenge(verifier);

  const { authorize } = buildAuthUrls(undefined, { state, codeChallenge, nonce });
  const res = NextResponse.redirect(authorize, 302);
  // Bound to this browser via HttpOnly transient cookies; checked in the callback.
  res.headers.append('Set-Cookie', transientCookie(PKCE_COOKIE_NAME, verifier));
  res.headers.append('Set-Cookie', transientCookie(STATE_COOKIE_NAME, state));
  res.headers.append('Set-Cookie', transientCookie(NONCE_COOKIE_NAME, nonce));
  return res;
}
