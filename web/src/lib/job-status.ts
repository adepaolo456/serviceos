/**
 * Job Display Status — derived from stored status + invoice state.
 * Stored DB values are NOT changed. This is a display-layer mapping only.
 */

export type DisplayStatus =
  | "pending_payment"
  | "unassigned"
  | "assigned"
  | "en_route"
  | "arrived"
  | "completed"
  | "cancelled"
  | "needs_reschedule";

/**
 * Minimum shape required to derive a live display status from a job.
 *
 * All fields except `status` are optional so any call site can pass
 * whatever it has on hand, but at least one of `assigned_driver_id` /
 * `assigned_driver` MUST be present for the "Assigned" precedence
 * check to kick in — otherwise the call falls through to the legacy
 * status-only branch (same behavior as passing a bare string). See
 * `deriveDisplayStatus` below for the precedence rules.
 *
 * NOTE: historical execution-state timestamps (`en_route_at`,
 * `arrived_at`, `completed_at`, `dispatched_at`) are intentionally
 * NOT part of this input contract. They look like they could act as
 * a "don't regress" guard, but they cannot distinguish a still-live
 * state from one that an operator has deliberately overridden back
 * to an earlier state. Reverts must be visually reversible, so
 * derivation is sourced from the raw `status` column and the live
 * driver_id only — never from audit-history timestamps. Passing a
 * full job object is still safe: TypeScript's structural typing
 * allows the extra fields, they're just ignored for derivation.
 */
export interface DeriveDisplayStatusInput {
  status: string;
  /**
   * Current `assigned_driver_id` column value. `null` / `undefined` /
   * empty string all mean "no driver currently assigned". This is
   * the authoritative source for the Assigned display state — NOT
   * any historical `assigned_at` / `dispatched_at` timestamp.
   */
  assigned_driver_id?: string | null;
  /**
   * Some fetch paths (notably the dispatch board) serialize the
   * driver as a nested object instead of a bare id. Both forms are
   * accepted: a truthy value here is treated the same as a truthy
   * `assigned_driver_id`.
   */
  assigned_driver?: unknown;
}

/**
 * Derive the operator-facing display status for a job.
 *
 * Two input forms are supported:
 *
 *   1. `deriveDisplayStatus("dispatched")` — legacy string form used
 *      by status-label dropdowns, override-note builders, and toast
 *      messages. Returns the plain status-to-label mapping with no
 *      driver-awareness. Intentionally unchanged behavior — these
 *      call sites are converting status STRINGS to display labels,
 *      not rendering a live job, so `driver_id` isn't knowable.
 *
 *   2. `deriveDisplayStatus(job, invoiceStatus?)` — live derivation
 *      for a specific fetched job. This is the form every status
 *      chip / lifecycle timeline SHOULD use. Applies strict
 *      top-to-bottom precedence:
 *
 *        cancelled         → cancelled
 *        needs_reschedule  → needs_reschedule
 *        status=completed                    → completed
 *        status=arrived / in_progress        → arrived
 *        status=en_route                     → en_route
 *        assigned_driver_id (or obj)         → assigned
 *        pending + unpaid invoice            → pending_payment
 *        otherwise                           → unassigned
 *
 *      KEY RULES:
 *        • "assigned" is a LIVE derived state, not a sticky
 *          historical milestone. A job whose raw status is
 *          `dispatched` but whose driver has been unassigned
 *          (assigned_driver_id is null) falls through to
 *          `unassigned` even though a historical dispatch
 *          timestamp may still exist on the row.
 *        • Execution-state precedence is sourced from the raw
 *          `status` column ONLY. Historical timestamps
 *          (`en_route_at`, `arrived_at`, `completed_at`) are NOT
 *          used as a fallback because they cannot distinguish
 *          between a live state and an operator-overridden-back
 *          state. Reverts (e.g., an accidental En Route being
 *          corrected back to Assigned) must be visually
 *          reversible, and the only way to honor that is to let
 *          raw `status` be authoritative.
 */
export function deriveDisplayStatus(
  jobOrStatus: string | DeriveDisplayStatusInput,
  invoiceStatus?: string | null,
): DisplayStatus {
  // Legacy string form — dropdowns, label lookups, override notes.
  // Preserved byte-for-byte so existing call sites keep working.
  if (typeof jobOrStatus === "string") {
    return deriveFromStatusString(jobOrStatus, invoiceStatus);
  }

  const job = jobOrStatus;
  const { status } = job;

  // ── Strict top-to-bottom precedence ──

  // Terminal states
  if (status === "cancelled") return "cancelled";
  if (status === "needs_reschedule") return "needs_reschedule";

  // Execution states — sourced from raw `status` only. See the
  // DeriveDisplayStatusInput docblock for why historical timestamps
  // are deliberately NOT consulted here (tl;dr: overrides must be
  // visually reversible, and stale `en_route_at` on a job that was
  // reverted to `dispatched` would keep the En Route step stuck).
  if (status === "completed") return "completed";
  if (status === "arrived" || status === "in_progress") return "arrived";
  if (status === "en_route") return "en_route";

  // KEY FIX: assignment is derived from the CURRENT driver_id, not
  // from the raw `dispatched` status or any historical assignment
  // timestamp. Both naming conventions across the codebase
  // (`assigned_driver_id` bare column / `assigned_driver` nested
  // object) are accepted.
  const hasLiveDriver =
    (job.assigned_driver_id !== undefined && job.assigned_driver_id !== null && job.assigned_driver_id !== "") ||
    Boolean(job.assigned_driver);
  if (hasLiveDriver) return "assigned";

  // No driver currently assigned. Refine "pending + unpaid" into
  // the dedicated pending_payment state; everything else rolls up
  // to unassigned.
  if (status === "pending" && invoiceStatus && invoiceStatus !== "paid" && invoiceStatus !== "partial") {
    return "pending_payment";
  }
  return "unassigned";
}

/**
 * Legacy status-only mapping. Preserved for string-form call sites
 * that convert a status constant to a display label (dropdowns,
 * toast messages, override builders). NEVER call this path for a
 * live job — use the object form instead.
 */
function deriveFromStatusString(
  storedStatus: string,
  invoiceStatus?: string | null,
): DisplayStatus {
  switch (storedStatus) {
    case "pending": {
      if (!invoiceStatus || invoiceStatus === "paid" || invoiceStatus === "partial") {
        return "unassigned";
      }
      return "pending_payment";
    }
    case "confirmed":
      return "unassigned";
    case "scheduled":
      return "assigned";
    case "dispatched":
      return "assigned";
    case "en_route":
      return "en_route";
    case "arrived":
    case "in_progress":
      return "arrived";
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "needs_reschedule":
      return "needs_reschedule";
    default:
      return storedStatus as DisplayStatus;
  }
}

/** Human-readable labels for display statuses */
export const DISPLAY_STATUS_LABELS: Record<DisplayStatus, string> = {
  pending_payment: "Pending Payment",
  unassigned: "Unassigned",
  assigned: "Assigned",
  en_route: "En Route",
  arrived: "Arrived",
  completed: "Completed",
  cancelled: "Cancelled",
  needs_reschedule: "Needs Reschedule",
};

/** Canonical job type identifiers (matches stored job.type values) */
export type JobType = "delivery" | "pickup" | "exchange" | "dump_run" | "driver_task";

/** Human-readable labels for job types — single source of truth for dispatch UI */
export const JOB_TYPE_LABELS: Record<JobType, string> = {
  delivery: "Drop Off",
  pickup: "Pick Up",
  exchange: "Exchange",
  dump_run: "Dump Run",
  // Driver Task V1 — internal one-off operational items. See
  // `JobsService.createDriverTask` in the api package.
  driver_task: "Driver Task",
};

// ─────────────────────────────────────────────────────────────────
// Customer-facing rental lifecycle timeline
//
// Single source of truth for the 5-step progress indicator shown to
// customers in the portal. Derivation logic lives here (not in any
// React component) so it can be reused and tested independently.
// ─────────────────────────────────────────────────────────────────

/** Fallback noun used when a rental has no asset subtype */
export const RENTAL_TITLE_FALLBACK = "Dumpster";

/** Suffix appended to customer-facing rental titles (e.g. "10yd Rental") */
export const RENTAL_TITLE_SUFFIX = "Rental";

/**
 * Customer-safe dumpster size label, e.g. "10yd" / "20yd" / "Dumpster".
 *
 * Single source of truth for the portal's size fallback chain. Prefer this
 * when composing any customer-facing copy that includes a dumpster size —
 * do NOT inline the chain at the call site and do NOT read `asset?.size`
 * (which does not exist on the Asset entity) or `service_type` (which
 * stores internal snake_case values).
 *
 * Priority order:
 *   1. `asset_subtype` (top-level Job column — set at booking time, present
 *      even before a physical dumpster is allocated to the rental)
 *   2. `asset.subtype` (from the loaded asset relation — only populated
 *      once the rental has been assigned a specific dumpster)
 *   3. Fallback to "Dumpster"
 */
export function rentalSizeLabel(rental: {
  asset_subtype?: string | null;
  asset?: { subtype?: string | null } | null;
}): string {
  return rental.asset_subtype || rental.asset?.subtype || RENTAL_TITLE_FALLBACK;
}

/**
 * Format a customer-facing rental title.
 *
 * Examples: "10yd Rental", "20yd Rental", "Dumpster Rental" (fallback).
 *
 * Used by both the rentals page (list + detail) and the dashboard Active
 * Rentals card so copy stays consistent. For contexts that need a different
 * noun (e.g. "Delivery") or a different combined format (e.g. size + address
 * in the Report Issue picker), call `rentalSizeLabel` directly and compose
 * your own surrounding copy.
 */
export function formatRentalTitle(rental: {
  asset_subtype?: string | null;
  asset?: { subtype?: string | null } | null;
}): string {
  return `${rentalSizeLabel(rental)} ${RENTAL_TITLE_SUFFIX}`;
}

/**
 * Display-format a stored job_number for human reading.
 *
 * Stored values are NEVER mutated by this helper — it is presentation
 * only. Lookups, FK references (none today), invoice references, audit
 * trails, and uniqueness all continue to use the raw `job.job_number`
 * string from the database.
 *
 * Transforms supported:
 *   • `D-1001`, `P-1002`, `X-1003`, `J-1004` → passthrough (canonical
 *       tenant-scoped sequential format issued by the backend's
 *       `issueNextJobNumber()` utility; no reformatting needed).
 *   • `JOB-YYYYMMDD-NNN`       → `J-YYMMDD-NNN`         (legacy, most common)
 *   • `JOB-YYYYMMDD-XXXX`      → `J-YYMMDD-XXXX`        (legacy random suffix)
 *   • `JOB-YYYYMMDD-XXXXD|P|X` → `J-YYMMDD-XXXXD|P|X`   (legacy rental-chain tagged)
 *   • Anything else            → returned unchanged (defensive — no throw)
 *
 * Goals: shorter to scan, easier to read aloud over the phone, less
 * "JOB-" prefix noise. New-format values already meet all three goals
 * (e.g. "D-1001" is five characters and reads cleanly), so the helper
 * is a no-op on them.
 */
export function formatJobNumber(raw: string | null | undefined): string {
  if (!raw) return "";
  // Fast path #1: new canonical tenant-scoped format (D-1001, P-1002,
  // X-1003, J-1004). Nothing to shorten — return as-is.
  if (/^[DPXJ]-\d+$/.test(raw)) return raw;
  // Fast path #2: already in the legacy short form (J-YYMMDD-...).
  if (raw.startsWith("J-")) return raw;
  // Legacy format: JOB-YYYYMMDD-suffix (suffix can be digits, hex, or hex+letter tag)
  const m = raw.match(/^JOB-(\d{2})(\d{6})-(.+)$/);
  if (m) {
    // m[1] = century digits ("20"), m[2] = YYMMDD, m[3] = suffix
    return `J-${m[2]}-${m[3]}`;
  }
  // Unknown shape — return as-is so we never hide data from the operator.
  return raw;
}

/** Canonical step keys for the customer rental lifecycle timeline */
export type CustomerTimelineStepKey =
  | "ordered"
  | "delivery_in_progress"
  | "delivered"
  | "in_use"
  | "pickup_scheduled"
  | "pickup_in_progress"
  | "picked_up";

/** Human-readable labels — the ONLY place these strings live */
export const CUSTOMER_TIMELINE_LABELS: Record<CustomerTimelineStepKey, string> = {
  ordered: "Ordered",
  delivery_in_progress: "Delivery In Progress",
  delivered: "Delivered",
  in_use: "In Use",
  pickup_scheduled: "Pickup Scheduled",
  pickup_in_progress: "Pickup In Progress",
  picked_up: "Picked Up",
};

/** Rendered timeline step */
export type CustomerTimelineStep = {
  key: CustomerTimelineStepKey;
  label: string;
  state: "done" | "current" | "future";
};

/** Minimal job shape required to derive the customer timeline */
export type CustomerTimelineJob = {
  id: string;
  job_type: string;
  status: string;
  service_address: { formatted?: string; street?: string } | null;
};

/**
 * Derive the 5-step rental-lifecycle timeline a customer sees.
 *
 * Logic was extracted verbatim from the portal rentals page to consolidate
 * status mapping into one shared location. Pickup jobs are correlated by
 * formatted service address — pre-existing behavior, tracked as follow-up.
 */
export function deriveCustomerTimeline(
  rental: CustomerTimelineJob,
  allRentals: CustomerTimelineJob[],
): CustomerTimelineStep[] {
  const status = rental.status;
  const jobType = rental.job_type;

  const pickupJob = allRentals.find(
    (r) =>
      r.job_type === "pickup" &&
      r.id !== rental.id &&
      r.service_address?.formatted === rental.service_address?.formatted,
  );

  const steps: CustomerTimelineStep[] = [];
  const push = (key: CustomerTimelineStepKey, state: CustomerTimelineStep["state"]) => {
    steps.push({ key, label: CUSTOMER_TIMELINE_LABELS[key], state });
  };

  // Step 1: Ordered
  //
  // "Ordered" covers the entire pre-execution phase from the
  // customer's perspective: booked, scheduled, and even
  // dispatcher-assigned (driver picked but not yet on the way).
  // KEY FIX: `dispatched` is now grouped with pending/confirmed
  // here. Previously `dispatched` was treated as "Delivery in
  // Progress" in step 2, which meant a customer saw "on the way"
  // for a job that was still sitting in the dispatch queue and —
  // worse — continued to show "on the way" after the office
  // unassigned the driver. The customer-facing semantic for
  // progress is now strictly tied to real execution states.
  if (["pending", "confirmed", "dispatched"].includes(status) && jobType === "delivery") {
    push("ordered", "current");
  } else {
    push("ordered", "done");
  }

  // Step 2: Delivery in progress / Delivered
  //
  // KEY FIX: only `en_route` / `arrived` mark this step as current.
  // A `dispatched` job is no longer treated as "Delivery in
  // Progress" — the portal must never imply the truck is on the
  // way unless the job is in an actual live execution state.
  if (["en_route", "arrived"].includes(status) && jobType === "delivery") {
    push("delivery_in_progress", "current");
  } else if (["pending", "confirmed", "dispatched"].includes(status) && jobType === "delivery") {
    push("delivery_in_progress", "future");
  } else {
    push("delivered", "done");
  }

  // Step 3: In Use
  if (status === "in_progress" && jobType === "delivery") {
    push("in_use", "current");
  } else if (status === "completed" && jobType === "delivery" && !pickupJob) {
    push("in_use", "current");
  } else if (
    ["pending", "confirmed", "dispatched", "en_route", "arrived"].includes(status) &&
    jobType === "delivery"
  ) {
    push("in_use", "future");
  } else {
    push("in_use", "done");
  }

  // Step 4: Pickup Scheduled
  if (pickupJob && ["pending", "confirmed"].includes(pickupJob.status)) {
    push("pickup_scheduled", "current");
  } else if (
    pickupJob &&
    ["dispatched", "en_route", "arrived", "in_progress", "completed"].includes(pickupJob.status)
  ) {
    push("pickup_scheduled", "done");
  } else {
    push("pickup_scheduled", "future");
  }

  // Step 5: Picked Up
  if (pickupJob && pickupJob.status === "completed") {
    push("picked_up", "done");
  } else if (
    pickupJob &&
    ["dispatched", "en_route", "arrived", "in_progress"].includes(pickupJob.status)
  ) {
    push("pickup_in_progress", "current");
  } else {
    push("picked_up", "future");
  }

  return steps;
}

/** CSS color variable for each display status */
export function displayStatusColor(status: DisplayStatus): string {
  switch (status) {
    case "pending_payment":
      return "var(--t-warning)";
    case "unassigned":
      return "var(--t-text-muted)";
    case "assigned":
      return "var(--t-accent)";
    case "en_route":
      return "var(--t-warning)";
    case "arrived":
      return "var(--t-info, #3b82f6)";
    case "completed":
      return "var(--t-success, #22c55e)";
    case "cancelled":
      return "var(--t-error)";
    case "needs_reschedule":
      return "var(--t-error)";
    default:
      return "var(--t-text-muted)";
  }
}

/** Filter options for Jobs page using display terminology */
export const DISPLAY_STATUS_FILTERS = [
  "all",
  "pending_payment",
  "unassigned",
  "assigned",
  "en_route",
  "arrived",
  "completed",
  "cancelled",
] as const;

/**
 * Map a display status filter back to stored status values for API queries.
 * Returns the stored status values that correspond to each display filter.
 */
export function displayFilterToStoredStatuses(displayFilter: string): string[] | null {
  switch (displayFilter) {
    case "all":
      return null; // no filter
    case "pending_payment":
      return ["pending"]; // frontend further filters by invoice status
    case "unassigned":
      return ["pending", "confirmed"]; // frontend further filters by invoice status
    case "assigned":
      return ["dispatched"];
    case "en_route":
      return ["en_route"];
    case "arrived":
      return ["arrived", "in_progress"];
    case "completed":
      return ["completed"];
    case "cancelled":
      return ["cancelled"];
    default:
      return null;
  }
}
