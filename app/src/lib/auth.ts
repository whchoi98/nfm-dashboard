import { CognitoJwtVerifier } from 'aws-jwt-verify';

export const SESSION_COOKIE_NAME = 'nfm_id_token';
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60; // 8h

// Transient cookies carrying the per-login OAuth material (PKCE verifier / state / nonce).
export const PKCE_COOKIE_NAME = 'nfm_pkce';
export const STATE_COOKIE_NAME = 'nfm_state';
export const NONCE_COOKIE_NAME = 'nfm_nonce';
const TRANSIENT_MAX_AGE_SECONDS = 600; // 10 min — enough to complete the Hosted UI login.

export interface AuthEnv {
  COGNITO_DOMAIN: string;
  COGNITO_CLIENT_ID: string;
  APP_URL: string;
}

const envFromProcess = (): AuthEnv => ({
  COGNITO_DOMAIN: process.env.COGNITO_DOMAIN ?? '',
  COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID ?? '',
  APP_URL: process.env.APP_URL ?? '',
});

/** Optional authorize-URL hardening params (PKCE / CSRF state / OIDC nonce). */
export interface AuthorizeOptions {
  state?: string;
  codeChallenge?: string;
  nonce?: string;
}

/** Builds the Cognito Hosted UI OAuth2 URLs (authorize / token / logout). */
export function buildAuthUrls(env: AuthEnv = envFromProcess(), opts: AuthorizeOptions = {}) {
  const authorize = new URL(`${env.COGNITO_DOMAIN}/oauth2/authorize`);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.COGNITO_CLIENT_ID,
    redirect_uri: `${env.APP_URL}/api/auth/callback`,
    scope: 'openid email',
  });
  if (opts.state) params.set('state', opts.state);
  if (opts.codeChallenge) {
    params.set('code_challenge', opts.codeChallenge);
    params.set('code_challenge_method', 'S256');
  }
  if (opts.nonce) params.set('nonce', opts.nonce);
  authorize.search = params.toString();

  const logout = new URL(`${env.COGNITO_DOMAIN}/logout`);
  logout.search = new URLSearchParams({
    client_id: env.COGNITO_CLIENT_ID,
    logout_uri: `${env.APP_URL}/login`,
  }).toString();

  return {
    authorize: authorize.toString(),
    token: `${env.COGNITO_DOMAIN}/oauth2/token`,
    logout: logout.toString(),
  };
}

/** base64url (RFC 4648 §5, no padding) — Web-Crypto friendly, works on Edge and Node. */
function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Cryptographically random base64url token (default 32 bytes → 43 chars). */
export function randomUrlToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64Url(buf);
}

/** PKCE S256 code challenge: base64url(SHA-256(verifier)). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/**
 * Constant-time string equality. Compares SHA-256 digests so neither length
 * nor content of the secrets leaks through comparison timing.
 */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

/** Serializes a short-lived (10 min) cookie holding in-flight login state. */
export function transientCookie(name: string, value: string): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TRANSIENT_MAX_AGE_SECONDS}`;
}

/** Serializes an expired transient cookie to clear it. */
export function clearTransientCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** Serializes the session cookie carrying the Cognito id token (8h). */
export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

/** Serializes an expired session cookie to clear it. */
export function clearCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// Module-scope cache so the JWKS fetched by the verifier is reused across requests.
const createVerifier = () =>
  CognitoJwtVerifier.create({
    userPoolId: process.env.COGNITO_USER_POOL_ID ?? '',
    clientId: process.env.COGNITO_CLIENT_ID ?? '',
    tokenUse: 'id',
  });
let verifier: ReturnType<typeof createVerifier> | undefined;

/**
 * Verifies a Cognito id token; returns the email claim or null on any failure.
 * When `opts.nonce` is given (callback flow), the token's `nonce` claim must
 * match it — binds the id_token to the login request that minted the nonce.
 * The no-nonce form stays valid for middleware, which re-verifies the session
 * cookie long after the transient nonce cookie has expired.
 */
export async function verifyIdToken(
  token: string,
  opts?: { nonce?: string },
): Promise<{ email: string } | null> {
  try {
    verifier ??= createVerifier();
    const nonce = opts?.nonce;
    const payload =
      nonce === undefined
        ? await verifier.verify(token)
        : await verifier.verify(token, {
            customJwtCheck: ({ payload }) => {
              if (payload.nonce !== nonce) throw new Error('nonce mismatch');
            },
          });
    return { email: String(payload.email ?? '') };
  } catch (err) {
    // Only log the callback path (nonce present). The middleware calls this on
    // every request to re-check the session cookie; an expired/invalid cookie
    // there is normal (→ redirect to /login) and would be pure log noise.
    if (opts?.nonce !== undefined) {
      console.warn(
        '[auth/verify] callback id_token rejected:',
        err instanceof Error ? err.message : String(err),
      );
    }
    return null;
  }
}
