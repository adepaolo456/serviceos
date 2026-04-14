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
 * Derive the operator-facing display status from stored job status + invoice context.
 *
 * @param storedStatus - The raw job.status from the database
 * @param invoiceStatus - The invoice status if one exists (null/undefined = no invoice)
 */
export function deriveDisplayStatus(
  storedStatus: string,
  invoiceStatus?: string | null,
): DisplayStatus {
  switch (storedStatus) {
    case "pending": {
      // Pending + no invoice or paid invoice = dispatch-ready → Unassigned
      // Pending + open/unpaid invoice = Pending Payment
      if (!invoiceStatus || invoiceStatus === "paid" || invoiceStatus === "partial") {
        return "unassigned";
      }
      return "pending_payment";
    }
    case "confirmed":
      return "unassigned";
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
  if (["pending", "confirmed"].includes(status) && jobType === "delivery") {
    push("ordered", "current");
  } else {
    push("ordered", "done");
  }

  // Step 2: Delivery in progress / Delivered
  if (["dispatched", "en_route", "arrived"].includes(status) && jobType === "delivery") {
    push("delivery_in_progress", "current");
  } else if (["pending", "confirmed"].includes(status) && jobType === "delivery") {
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
