import { NextRequest, NextResponse } from 'next/server';

// NOTE: For wildcard subdomains to work on Vercel, add *.serviceos.com
// as a domain in Vercel project settings → Domains.
export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || '';
  const allowedDomains = ['serviceos.com', 'serviceos-web-zeta.vercel.app', 'localhost:3000'];

  let slug: string | null = null;
  for (const domain of allowedDomains) {
    if (hostname.endsWith(domain) && hostname !== domain && hostname !== `www.${domain}`) {
      slug = hostname.replace(`.${domain}`, '').split('.')[0];
      break;
    }
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
