import { NextResponse } from 'next/server';
import { buildAuthUrls, clearCookie } from '@/lib/auth';

export function GET() {
  const res = NextResponse.redirect(buildAuthUrls().logout, 302);
  res.headers.set('Set-Cookie', clearCookie());
  return res;
}
