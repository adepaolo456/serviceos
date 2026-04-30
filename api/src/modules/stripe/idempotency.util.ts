/**
 * PR-C1b-1 — shared Stripe idempotency key builder. Used by every P0
 * Stripe write call site (StripeService + jobs.service.ts cancellation
 * refund loop) so the env-prefix logic lives in one place.
 *
 * Production: bare `parts.join(':')`.
 * Non-prod: prefixed with `${NODE_ENV}-${SHA8}-` to avoid Stripe sandbox
 * cache contamination across test runs and PR branches.
 *
 * Tenant namespacing (`tenant-{id}:` prefix) is the responsibility of
 * the CALLER — pass the tenant prefix as the first part. Stripe scopes
 * idempotency keys per Stripe account, but the platform-account
 * fallback path (when a tenant has no `stripe_connect_id`) means
 * non-Connect tenants share an idempotency namespace, so the tenant
 * prefix is mandatory for safety.
 */
export function buildStripeIdempotencyKey(parts: string[]): string {
  const env = process.env.NODE_ENV;
  if (env === 'production') {
    return parts.join(':');
  }
  const sha = (
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_SHA ||
    'local'
  ).slice(0, 8);
  return `${env || 'dev'}-${sha}-${parts.join(':')}`;
}
