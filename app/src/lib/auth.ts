import { CognitoJwtVerifier } from 'aws-jwt-verify';

export const SESSION_COOKIE_NAME = 'nfm_id_token';
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60; // 8h

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

/** Builds the Cognito Hosted UI OAuth2 URLs (authorize / token / logout). */
export function buildAuthUrls(env: AuthEnv = envFromProcess()) {
  const authorize = new URL(`${env.COGNITO_DOMAIN}/oauth2/authorize`);
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: env.COGNITO_CLIENT_ID,
    redirect_uri: `${env.APP_URL}/api/auth/callback`,
    scope: 'openid email',
  }).toString();

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

/** Verifies a Cognito id token; returns the email claim or null on any failure. */
export async function verifyIdToken(token: string): Promise<{ email: string } | null> {
  try {
    verifier ??= createVerifier();
    const payload = await verifier.verify(token);
    return { email: String(payload.email ?? '') };
  } catch {
    return null;
  }
}
