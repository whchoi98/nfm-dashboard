import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, verifyIdToken } from '@/lib/auth';

const PUBLIC_PATHS = ['/login', '/api/health', '/favicon.ico'];
const PUBLIC_PREFIXES = ['/api/auth/', '/_next/'];
// Static assets served from /public (images, fonts, manifest, …).
const STATIC_FILE = /\.(?:ico|png|svg|jpg|jpeg|gif|webp|css|js|map|txt|xml|json|woff2?)$/;

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p)) ||
    // Static asset extensions never bypass auth for API paths.
    (!pathname.startsWith('/api/') && STATIC_FILE.test(pathname))
  );
}

export async function middleware(req: NextRequest) {
  // Dev bypass: Cognito is provisioned later (Task 18 AppStack).
  if (process.env.AUTH_DISABLED === '1') return NextResponse.next();

  const { pathname } = req.nextUrl;

  // ALB target-group healthcheck hits the container directly (no CloudFront header).
  if (pathname === '/api/health') return NextResponse.next();

  // CloudFront → ALB origin verification (skipped when unset, e.g. local dev).
  const originSecret = process.env.ORIGIN_VERIFY_SECRET;
  if (originSecret && req.headers.get('x-origin-verify') !== originSecret) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (isPublicPath(pathname)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const user = token ? await verifyIdToken(token) : null;
  if (!user) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', req.url), 302);
  }
  return NextResponse.next();
}

export const config = {
  // Run on pages and api routes; skip build assets for performance.
  matcher: ['/((?!_next/static|_next/image).*)'],
};
