import { DataSource } from 'typeorm';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds?: number;
}

export async function checkRateLimit(
  dataSource: DataSource,
  ip: string,
  endpoint: string,
  maxRequests: number,
  windowMinutes: number,
): Promise<RateLimitResult> {
  const countResult = await dataSource.query(
    `SELECT COUNT(*) as count FROM rate_limit_log
     WHERE ip_address = $1 AND endpoint = $2
     AND created_at > NOW() - INTERVAL '${windowMinutes} minutes'`,
    [ip, endpoint],
  );

  const count = parseInt(countResult[0]?.count || '0', 10);

  if (count >= maxRequests) {
    return { allowed: false, remaining: 0, retryAfterSeconds: 60 };
  }

  // Record this request
  await dataSource.query(
    `INSERT INTO rate_limit_log (ip_address, endpoint) VALUES ($1, $2)`,
    [ip, endpoint],
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
