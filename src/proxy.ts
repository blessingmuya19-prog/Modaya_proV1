import { NextRequest, NextResponse } from 'next/server';

// Routes that require a valid session
const PROTECTED = ['/dashboard', '/editor', '/upload'];
// Routes only for guests (redirect to dashboard if already logged in)
const GUEST_ONLY = ['/login', '/signup'];

/**
 * Edge-safe middleware: checks only for the presence of the session cookie.
 * Full JWT cryptographic verification happens in each API route handler
 * (which runs in the Node.js runtime, not the Edge runtime).
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Presence-check only — no Node.js modules
  const hasCookie = !!req.cookies.get('modaya_session')?.value;

  const isProtected = PROTECTED.some(p => pathname.startsWith(p));
  const isGuestOnly = GUEST_ONLY.some(p => pathname.startsWith(p));

  if (isProtected && !hasCookie) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (isGuestOnly && hasCookie) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/editor/:path*', '/upload/:path*', '/login', '/signup'],
};
