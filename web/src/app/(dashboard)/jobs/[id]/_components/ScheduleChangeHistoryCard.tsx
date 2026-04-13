"use client";

import { Calendar, ArrowRight, ArrowDown, ArrowUp, User, Building2 } from "lucide-react";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";

/**
 * Phase B4 — Schedule Change History Card
 *
 * Renders the latest reschedule audit trio that lives directly on
 * the `jobs` row:
 *   - rescheduled_by_customer  (boolean — true when the change came
 *                               through a portal customer action)
 *   - rescheduled_at           (timestamp of the change)
 *   - rescheduled_from_date    (the previous YYYY-MM-DD)
 *   - rescheduled_reason       (machine code, resolved to a human
 *                               label via the feature registry)
 *
 * The component renders ONLY when there is a meaningful prior
 * date — i.e. `rescheduled_from_date` is present AND differs from
 * the current `scheduled_date`. On a fresh job that has never been
 * rescheduled, the card does not appear.
 *
 * Phase 1 scope intentionally: latest change only. A durable full
 * timeline backed by an event log is a Phase 2 follow-up — see
 * the Issues Consolidation Audit + Portal Date Change Audit
 * deliverables for the planned approach.
 *
 * All labels resolve through the feature registry — there are no
 * hardcoded user-facing strings in this component.
 */

export interface ScheduleChangeHistoryCardProps {
  /** Current `jobs.scheduled_date` — YYYY-MM-DD. */
  scheduledDate: string | null | undefined;
  /** `jobs.rescheduled_from_date` — YYYY-MM-DD before the change. */
  rescheduledFromDate: string | null | undefined;
  /** `jobs.rescheduled_at` — ISO timestamp of the change. */
  rescheduledAt: string | Date | null | undefined;
  /** `jobs.rescheduled_reason` — machine code, e.g. `customer_portal_extend`. */
  rescheduledReason: string | null | undefined;
  /** `jobs.rescheduled_by_customer` — true if a portal action drove the change. */
  rescheduledByCustomer: boolean | null | undefined;
}

function formatLongDate(d: string | null | undefined): string {
  if (!d) return "—";
  // Parse as local-noon to avoid the `T00:00:00` timezone-rollover
  // class of bug — the same defensive parsing used elsewhere on
  // the job detail page.
  return new Date(`${d}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimestamp(t: string | Date | null | undefined): string {
  if (!t) return "";
  const dt = typeof t === "string" ? new Date(t) : t;
  return dt.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ScheduleChangeHistoryCard({
  scheduledDate,
  rescheduledFromDate,
  rescheduledAt,
  rescheduledReason,
  rescheduledByCustomer,
}: ScheduleChangeHistoryCardProps) {
  // Render gate — must have both a prior date AND a current date,
  // and they must differ. A reschedule that ended up at the same
  // YYYY-MM-DD (which `updateScheduledDate` allows but is a no-op)
  // is intentionally invisible here.
  if (
    !rescheduledFromDate ||
    !scheduledDate ||
    rescheduledFromDate === scheduledDate
  ) {
    return null;
  }

  const direction: "earlier" | "later" =
    scheduledDate < rescheduledFromDate ? "earlier" : "later";

  const directionLabel =
    direction === "earlier"
      ? FEATURE_REGISTRY.schedule_change_earlier?.label ?? "Moved earlier"
      : FEATURE_REGISTRY.schedule_change_later?.label ?? "Moved later";

  const actorLabel = rescheduledByCustomer
    ? FEATURE_REGISTRY.schedule_change_changed_by_customer?.label ??
      "Changed by customer (portal)"
    : FEATURE_REGISTRY.schedule_change_changed_by_office?.label ??
      "Changed by office";

  // Backend reason codes are resolved through the feature registry
  // so the office UI shows "Extend Rental" instead of
  // "customer_portal_extend". Falls back to the raw code if no
  // registry entry exists, which surfaces missing translations
  // loudly without crashing the render.
  const reasonLabel = rescheduledReason
    ? FEATURE_REGISTRY[
        rescheduledReason as keyof typeof FEATURE_REGISTRY
      ]?.label ?? rescheduledReason
    : null;

  const ActorIcon = rescheduledByCustomer ? User : Building2;
  const DirectionIcon = direction === "earlier" ? ArrowDown : ArrowUp;

  return (
    <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5">
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="h-4 w-4 text-[var(--t-text-muted)]" />
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)] flex-1">
          {FEATURE_REGISTRY.schedule_change_history_title?.label ??
            "Schedule Change History"}
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
            direction === "earlier"
              ? "bg-[var(--t-accent-soft)] text-[var(--t-accent)]"
              : "bg-amber-500/10 text-amber-500"
          }`}
        >
          <DirectionIcon className="h-3 w-3" />
          {directionLabel}
        </span>
      </div>

      {/* Old → New date row */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-[var(--t-text-muted)] line-through">
          {formatLongDate(rescheduledFromDate)}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-[var(--t-text-muted)] shrink-0" />
        <span className="font-semibold text-[var(--t-text-primary)]">
          {formatLongDate(scheduledDate)}
        </span>
      </div>

      {/* Actor + reason + timestamp */}
      <div className="mt-3 flex items-center gap-2 text-[11px] text-[var(--t-text-muted)]">
        <ActorIcon className="h-3 w-3 shrink-0" />
        <span className="text-[var(--t-text-primary)]">{actorLabel}</span>
        {reasonLabel && (
          <>
            <span>·</span>
            <span>{reasonLabel}</span>
          </>
        )}
        {rescheduledAt && (
          <>
            <span>·</span>
            <span>{formatTimestamp(rescheduledAt)}</span>
          </>
        )}
      </div>
    </div>
  );
}
