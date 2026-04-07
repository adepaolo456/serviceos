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
