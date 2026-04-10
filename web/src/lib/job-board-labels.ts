/**
 * Jobs page (job-board) label registry.
 *
 * Every user-facing string rendered on the Jobs page belongs here, not
 * inlined in JSX. The Jobs page component imports from this file; no
 * hardcoded copy inside cells, badges, or action menus.
 */

export const JOB_BOARD_LABELS = {
  // ──────────────────────────────────────────────────────────
  // Top strip tiles
  // ──────────────────────────────────────────────────────────
  tiles: {
    unassigned: "Unassigned",
    overdue: "Overdue",
    paymentBlocked: "Payment Blocked",
    today: "Today",
  },

  // ──────────────────────────────────────────────────────────
  // Row-level blocker badges (inline under the Status cell)
  // ──────────────────────────────────────────────────────────
  badges: {
    unpaidInvoice: "Unpaid",
    billingIssue: "Billing Issue",
    addressUnverified: "Needs Address",
  },

  // ──────────────────────────────────────────────────────────
  // Row action menu — context-aware actions (Commit 3)
  // ──────────────────────────────────────────────────────────
  actions: {
    assign: "Assign",
    resolvePayment: "Resolve Payment",
    viewOnDispatchBoard: "View on Dispatch Board",
    reschedule: "Reschedule",
    viewCustomer: "View Customer",
    viewInvoice: "View Invoice",
    markComplete: "Mark Complete",
    sendToDriver: "Send to Driver",
  },

  // Owner-only Mark Complete confirmation dialog
  confirmations: {
    markCompleteTitle: "Bypass driver app flow?",
    markCompleteMessage:
      "This bypasses the driver app flow. Continue?",
    markCompleteConfirm: "Continue",
    markCompleteCancel: "Cancel",
  },

  // ──────────────────────────────────────────────────────────
  // Filters (Commit 4)
  // ──────────────────────────────────────────────────────────
  filters: {
    needsAction: "Needs Action",
    needsActionTooltip:
      "Jobs with any open blocker: overdue, payment blocked, open billing issue, needs reschedule, or unassigned active.",
  },

  // ──────────────────────────────────────────────────────────
  // Rental chain context (Commit 4)
  // ──────────────────────────────────────────────────────────
  chain: {
    previousJob: "From",
    nextJob: "Next",
    exchangeArrow: "↔",
    nonSwapArrow: "→",
  },

  // ──────────────────────────────────────────────────────────
  // Tooltips
  // ──────────────────────────────────────────────────────────
  tooltips: {
    paymentBlocker: "This job has an unpaid linked invoice",
    billingIssueBlocker: "This job has an open billing issue",
    addressBlocker: "This job's service address needs verification",
    dispatchNotReady:
      "Not yet ready to dispatch — missing driver or unpaid invoice",
    ownerOnly: "Owner-only action",
  },
} as const;
