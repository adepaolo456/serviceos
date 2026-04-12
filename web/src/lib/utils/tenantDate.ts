/**
 * Tenant-aware date helpers — the frontend source of truth for
 * "today" and day-boundary date ranges.
 *
 * Mirrors `api/src/common/utils/tenant-date.util.ts` exactly so the
 * backend and frontend produce the same YYYY-MM-DD output for a
 * given timezone. Both layers need their own copy because:
 *
 *   1. The frontend computes date ranges locally and sends them
 *      to the API as `dateFrom` / `dateTo` query params.
 *   2. The backend needs "today" server-side for detectors and
 *      reporting surfaces that do not receive a range from the
 *      client.
 *
 * Not "display only": the values returned here drive server-side
 * filtering, so they must match what the backend would compute for
 * the same tenant. Tenant timezone is read from
 * `useTenantTimezone()` in `@/lib/use-modules` (which shares the
 * `/auth/profile` cache with `useModules` — no extra fetch) and
 * passed in at call time. Canonical fallback is 'America/New_York'.
 *
 * All public helpers return YYYY-MM-DD strings because the
 * existing page-level filter code is string-based end-to-end
 * (see the various `getDateRange` helpers in jobs / invoices /
 * dashboard pages). Returning Date objects would push callers
 * back into `toISOString().split('T')[0]`, which is the bug.
 */

const DEFAULT_TZ = "America/New_York";

interface NowParts {
  year: number;
  month: number; // 1-12
  day: number; //   1-31
}

/**
 * Internal primitive. Exposed because callers computing week /
 * month / quarter ranges need the raw tenant-local Y/M/D to do
 * pure UTC date arithmetic on top (see `getDateRange` in
 * jobs/page.tsx and invoices/page.tsx). Uses
 * `Intl.DateTimeFormat.formatToParts` so behavior is
 * engine-portable.
 */
export function getTenantNowParts(timezone?: string): NowParts {
  const tz = timezone ?? DEFAULT_TZ;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const get = (t: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === t)?.value ?? "";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
  };
}

/**
 * Returns the tenant-local current date as 'YYYY-MM-DD'. Replaces
 * `new Date().toISOString().split('T')[0]`, which shows
 * "tomorrow" to evening Eastern users because the browser rolls
 * into UTC midnight before the tenant's wall-clock midnight.
 */
export function getTenantToday(timezone?: string): string {
  const { year, month, day } = getTenantNowParts(timezone);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Returns the tenant-local day range as `{ start, end }` — both
 * YYYY-MM-DD strings pointing at the same day. Matches the
 * existing `dateFrom` / `dateTo` query-param shape.
 */
export function getTenantDateRangeToday(timezone?: string): {
  start: string;
  end: string;
} {
  const today = getTenantToday(timezone);
  return { start: today, end: today };
}
