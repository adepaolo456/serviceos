/**
 * Tenant-aware date helpers — the backend source of truth for
 * "today" and day-boundary date ranges.
 *
 * All public helpers return `YYYY-MM-DD` strings so they slot
 * directly into the existing string-based query/filter patterns
 * used throughout the API (rental_chains.expected_pickup_date,
 * ReportingService date ranges, etc.). Do NOT introduce
 * Date-returning variants: callers that received a Date would
 * immediately call `.toISOString().split('T')[0]`, which is the
 * exact UTC-rollover bug this module exists to fix.
 *
 * Tenant timezone is loaded from `tenant_settings.timezone` at the
 * call site and passed in. Canonical fallback is 'America/New_York'
 * so existing tenants whose timezone is still NULL keep working.
 *
 * Keep this file in lockstep with
 * `web/src/lib/utils/tenantDate.ts` — the backend and frontend
 * must produce the same output for the same timezone.
 */

const DEFAULT_TZ = 'America/New_York';

interface NowParts {
  year: number;
  month: number; // 1-12
  day: number; //   1-31
}

/**
 * Internal primitive. Returns the tenant-local wall-clock year,
 * month (1-indexed), and day-of-month as integers. Uses
 * `Intl.DateTimeFormat.formatToParts` rather than locale-dependent
 * `format()` output so behavior is engine-portable and not reliant
 * on any particular locale tag formatting as YYYY-MM-DD.
 */
export function getTenantNowParts(timezone?: string): NowParts {
  const tz = timezone ?? DEFAULT_TZ;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const get = (t: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === t)?.value ?? '';

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
  };
}

/**
 * Returns the tenant-local current date as 'YYYY-MM-DD'.
 * Replaces `new Date().toISOString().split('T')[0]`, which leaks
 * UTC midnight rollover (e.g. shows "tomorrow" at 8pm Eastern).
 */
export function getTenantToday(timezone?: string): string {
  const { year, month, day } = getTenantNowParts(timezone);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * Returns the tenant-local day range as `{ start, end }` — both
 * YYYY-MM-DD strings pointing at the same day. Shaped to match
 * existing query-param / `BETWEEN ? AND ?` filter patterns that
 * pass `dateFrom` / `dateTo` of the same day for today-scoped
 * reports.
 */
export function getTenantDateRangeToday(timezone?: string): {
  start: string;
  end: string;
} {
  const today = getTenantToday(timezone);
  return { start: today, end: today };
}
