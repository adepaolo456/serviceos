// Tenant subdomain rewriter for *.rentthisapp.com
// Vercel domain configuration:
//  - rentthisapp.com (apex, redirects to app.rentthisapp.com)
//  - www.rentthisapp.com (redirects to app.rentthisapp.com)
//  - app.rentthisapp.com (dashboard, pass-through)
//  - *.rentthisapp.com (tenant subdomains, rewritten to /site)
// Reserved subdomains pass through without rewrite: app, www, api, admin
import { NextRequest, NextResponse } from 'next/server';
import { extractSlugFromHost } from '@/lib/tenant/extractSlugFromHost';

export function middleware(request: NextRequest) {
  // Normalize hostname once — DNS is case-insensitive per RFC 4343.
  const hostname = (request.headers.get('host') || '').toLowerCase();

  // Apex + www canonical redirect to app.rentthisapp.com. Production-only
  // (not for legacy Vercel preview hostname or localhost dev).
  if (hostname === 'rentthisapp.com' || hostname === 'www.rentthisapp.com') {
    const redirectUrl = new URL(request.url);
    redirectUrl.hostname = 'app.rentthisapp.com';
    redirectUrl.protocol = 'https:';
    redirectUrl.port = '';
    return NextResponse.redirect(redirectUrl, 308);
  }

  // Shared routing rules live in the utility — kept identical to the
  // client-side resolver in site/layout.tsx for in-sync host handling.
  const slug = extractSlugFromHost(hostname);

  if (!slug) return NextResponse.next();

  const path = request.nextUrl.pathname;
  const skip = ['/dashboard', '/admin', '/api', '/_next', '/login', '/register', '/portal', '/favicon', '/site'];
  if (skip.some(s => path.startsWith(s)) || path === '/favicon.ico') return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/site${path === '/' ? '' : path}`;
  url.searchParams.set('slug', slug);
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|widget\\.js).*)'],
};
