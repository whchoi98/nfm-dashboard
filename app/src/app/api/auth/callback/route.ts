import { NextRequest, NextResponse } from 'next/server';
import { buildAuthUrls, sessionCookie } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const base = process.env.APP_URL || req.nextUrl.origin;
  try {
    const code = req.nextUrl.searchParams.get('code');
    if (!code) throw new Error('missing code');

    // Public client (no secret) — plain form POST, no Basic auth.
    const res = await fetch(buildAuthUrls().token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.COGNITO_CLIENT_ID ?? '',
        code,
        redirect_uri: `${base}/api/auth/callback`,
      }),
    });
    if (!res.ok) throw new Error(`token endpoint returned ${res.status}`);

    const { id_token: idToken } = (await res.json()) as { id_token?: string };
    if (!idToken) throw new Error('missing id_token');

    const redirect = NextResponse.redirect(new URL('/', base), 302);
    redirect.headers.set('Set-Cookie', sessionCookie(idToken));
    return redirect;
  } catch {
    return NextResponse.redirect(new URL('/login?error=1', base), 302);
  }
}
