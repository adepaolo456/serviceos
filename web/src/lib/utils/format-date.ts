/**
 * Phase B6 — safe display formatting for stored YYYY-MM-DD date-only
 * strings.
 *
 * Background: `new Date("2026-05-01")` parses the string as UTC
 * midnight per the ECMAScript spec. In any timezone west of UTC
 * (every US timezone), the resulting `Date` instance is the previous
 * calendar day in local time, so `.toLocaleDateString()` renders the
 * wrong day — the exact bug the portal was exhibiting where a
 * backend pickup date of `2026-05-01` was rendering as `4/30/2026`.
 *
 * Safe pattern: parse as local NOON of the target calendar day:
 *
 *     new Date(`${dateStr}T12:00:00`)
 *
 * Noon is safely inside the calendar day in every timezone on Earth
 * (from UTC−12 to UTC+14), so `.toLocaleDateString()` always returns
 * the intended calendar day. The same pattern is used by
 * `fmtDateFull` on the office job-detail page and by
 * `ScheduleChangeHistoryCard.formatLongDate` — this module is the
 * shared extraction.
 *
 * Scope: date-only DISPLAY formatting and date-only DAYS-UNTIL math.
 * This module is deliberately NOT about tenant-timezone-aware "today"
 * (that is `@/lib/utils/tenantDate`) because the bug class here is
 * browser-local rendering of a stored calendar string, which is a
 * different concept from the tenant-wide day-boundary computation
 * used by dispatch + reports.
 *
 * Out of scope (future cleanup): date-picker `min` attributes that
 * use `new Date().toISOString().split("T")[0]` for input constraints
 * rather than display — those are UTC-based and can allow or block
 * boundary dates wrong, but are not the reported bug.
 */

/**
 * Format a stored YYYY-MM-DD date-only string for display using the
 * browser's local calendar and the provided
 * `Intl.DateTimeFormatOptions` (defaults to the browser's default
 * short date style, same as calling `.toLocaleDateString()` with no
 * arguments — matching the current portal display).
 *
 * Returns `"—"` for nullish, empty, or malformed input so call sites
 * do not have to wrap every access. If the input does not match the
 * YYYY-MM-DD shape, the raw input is returned as-is (defensive:
 * renders a loud "wrong" that can be caught in review rather than
 * silently displaying an off-by-one).
 */
export function formatDateOnly(
  dateStr: string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!dateStr) return "—";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, options);
}

/**
 * Integer calendar-day difference from today (browser local) to the
 * target YYYY-MM-DD string. Positive = future, 0 = today, negative =
 * past. Returns `null` for nullish or malformed input so call sites
 * can disambiguate "unknown" from a real zero-day answer.
 *
 * Uses noon-to-noon arithmetic so daylight-saving transitions (23 or
 * 25 hour days) round cleanly to integer days and boundary checks
 * ("is the pickup today or tomorrow?") are stable regardless of the
 * current local time of day.
 */
export function daysUntilDateOnly(
  dateStr: string | null | undefined,
): number | null {
  if (!dateStr) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const target = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const todayNoon = new Date();
  todayNoon.setHours(12, 0, 0, 0);
  return Math.round(
    (target.getTime() - todayNoon.getTime()) / (24 * 60 * 60 * 1000),
  );
}
