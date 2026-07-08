import { NextResponse } from 'next/server';
import { buildAuthUrls } from '@/lib/auth';

export function GET() {
  return NextResponse.redirect(buildAuthUrls().authorize, 302);
}
