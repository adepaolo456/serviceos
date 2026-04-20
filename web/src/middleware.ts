// Tenant subdomain rewriter for *.rentthisapp.com
// Vercel domain configuration:
//  - rentthisapp.com (apex, redirects to app.rentthisapp.com)
//  - www.rentthisapp.com (redirects to app.rentthisapp.com)
//  - app.rentthisapp.com (dashboard, pass-through)
//  - *.rentthisapp.com (tenant subdomains, rewritten to /site)
// Reserved subdomains pass through without rewrite: app, www, api, admin
import { NextRequest, NextResponse } from 'next/server';

const RESERVED_SUBDOMAINS: string[] = ['app', 'www', 'api', 'admin'];
const SLUG_FORMAT = /^[a-z0-9-]+$/;

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

  const allowedDomains = [
    'rentthisapp.com',
    'serviceos-web-zeta.vercel.app', // legacy Vercel preview, retained during transition
    'localhost:3000',
  ];

  let slug: string | null = null;
  for (const domain of allowedDomains) {
    if (!hostname.endsWith(domain)) continue;
    if (hostname === domain) continue;              // bare apex — no subdomain to extract
    if (hostname === `www.${domain}`) continue;     // www handled by redirect block above for rentthisapp.com

    // Suffix-only strip via slice — defense-in-depth vs. replace()'s
    // accidental substring matching. Guarantees we peel the exact domain.
    const stripped = hostname.slice(0, -(`.${domain}`.length));

    // Nested subdomain (e.g., acme.preview.rentthisapp.com) — not supported.
    // Skip extraction so the request falls through to the bare path.
    if (stripped.includes('.')) continue;

    // Reserved subdomain — never treat as tenant slug. Dashboard (app),
    // www mirror, api surface, admin surface all pass through unchanged.
    if (RESERVED_SUBDOMAINS.includes(stripped)) continue;

    // Format gate — only URL-safe tenant slugs proceed. Malformed hostnames
    // fall through; backend's /public/tenant/:slug would 404 anyway, but
    // this prevents the round trip and the "Website not found" render.
    if (!SLUG_FORMAT.test(stripped)) continue;

    slug = stripped;
    break;
  }

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
