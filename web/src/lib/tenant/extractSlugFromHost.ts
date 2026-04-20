/**
 * Tenant slug extraction from a hostname.
 *
 * Used by:
 * - web/src/middleware.ts (server-side, edge runtime)
 * - web/src/app/site/layout.tsx (client-side, browser)
 *
 * MUST stay in sync with the host-routing rules. If you change the rules
 * (reserved subdomains, slug format, allowed root domains), they propagate
 * to both surfaces automatically via this utility.
 */

export const RESERVED_SUBDOMAINS: readonly string[] = ['app', 'www', 'api', 'admin'];
export const SLUG_FORMAT = /^[a-z0-9-]+$/;

export const ROOT_DOMAINS: readonly string[] = [
  'rentthisapp.com',
  'serviceos-web-zeta.vercel.app', // legacy Vercel preview, retained during transition
  'localhost:3000',
];

/**
 * Returns the tenant slug derived from a hostname, or null if the hostname
 * is bare apex, www, reserved, nested, malformed, or not on a known root.
 *
 * Examples:
 *   acme.rentthisapp.com         → 'acme'
 *   ACME.rentthisapp.com         → 'acme'           (lowercased internally)
 *   rentthisapp.com              → null              (bare apex)
 *   www.rentthisapp.com          → null              (www)
 *   app.rentthisapp.com          → null              (reserved)
 *   acme.preview.rentthisapp.com → null              (nested subdomain)
 *   foo_bar.rentthisapp.com      → null              (underscore fails format)
 *   acme.localhost:3000          → 'acme'            (dev)
 */
export function extractSlugFromHost(hostnameRaw: string): string | null {
  // Normalize once — DNS is case-insensitive per RFC 4343.
  const hostname = (hostnameRaw || '').toLowerCase();

  for (const root of ROOT_DOMAINS) {
    if (!hostname.endsWith(root)) continue;
    if (hostname === root) return null;                          // bare apex
    if (hostname === `www.${root}`) return null;                 // www

    // Suffix-only strip via slice — defense-in-depth vs. replace()'s
    // accidental substring matching. Guarantees we peel the exact domain.
    const stripped = hostname.slice(0, -(`.${root}`.length));

    if (stripped.includes('.')) return null;                     // nested subdomain
    if (RESERVED_SUBDOMAINS.includes(stripped)) return null;     // reserved
    if (!SLUG_FORMAT.test(stripped)) return null;                // malformed

    return stripped;
  }

  return null;
}
