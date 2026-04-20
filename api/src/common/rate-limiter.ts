import { DataSource } from 'typeorm';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds?: number;
}

export type RateLimitKeyType = 'ip' | 'email';

/**
 * Generalized rate limiter. Historically this function was IP-only; Phase 1
 * of the password-reset sprint generalized it to an arbitrary `key_type` +
 * `key_value` pair so email-keyed throttling (e.g. forgot-password) can
 * share the same `rate_limit_log` table.
 *
 * Lookup is authoritative on `(endpoint, key_type, key_value)`. The legacy
 * `ip_address` column is still written (set to `key_value` regardless of
 * key type) for backward compat with pre-existing observability queries,
 * but it is NEVER read for limit enforcement.
 *
 * Existing 5-arg callers preserve behavior via the default `keyType='ip'`.
 */
export async function checkRateLimit(
  dataSource: DataSource,
  keyValue: string,
  endpoint: string,
  maxRequests: number,
  windowMinutes: number,
  keyType: RateLimitKeyType = 'ip',
): Promise<RateLimitResult> {
  const countResult = await dataSource.query(
    `SELECT COUNT(*) as count FROM rate_limit_log
     WHERE endpoint = $1 AND key_type = $2 AND key_value = $3
     AND created_at > NOW() - INTERVAL '${windowMinutes} minutes'`,
    [endpoint, keyType, keyValue],
  );

  const count = parseInt(countResult[0]?.count || '0', 10);

  if (count >= maxRequests) {
    return { allowed: false, remaining: 0, retryAfterSeconds: 60 };
  }

  // Write all three columns. ip_address mirrors key_value as a non-semantic
  // fallback so the legacy NOT NULL constraint is satisfied; lookups no
  // longer read it.
  await dataSource.query(
    `INSERT INTO rate_limit_log (ip_address, endpoint, key_type, key_value)
     VALUES ($1, $2, $3, $4)`,
    [keyValue, endpoint, keyType, keyValue],
  );

  // Fire-and-forget cleanup of old entries
  dataSource
    .query(
      `DELETE FROM rate_limit_log WHERE endpoint = $1 AND created_at < NOW() - INTERVAL '10 minutes'`,
      [endpoint],
    )
    .catch(() => {});

  return { allowed: true, remaining: maxRequests - count - 1 };
}
