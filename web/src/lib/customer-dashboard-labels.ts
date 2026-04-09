/**
 * Customer Dashboard — centralized user-facing labels.
 *
 * The backend aggregator (`GET /customers/:id/dashboard`) returns
 * normalized reason keys and severity enums rather than display strings,
 * so the client controls all copy. Do not inline any of these strings
 * in JSX — import from here instead.
 */

export const CUSTOMER_DASHBOARD_LABELS = {
  sections: {
    statusStrip: "Status",
    serviceSites: "Service Sites",
    jobsTimeline: "Jobs Timeline",
    financial: "Financial Snapshot",
    issues: "Alerts & Issues",
    notes: "Notes & Instructions",
    advanced: "Advanced",
    advancedHint: "Legacy detail tabs, edit flows, and other less-used fields.",
  },

  severity: {
    green: "Good standing",
    yellow: "Attention needed",
    red: "Action required",
  },

  /**
   * Backend emits these stable keys in `statusStrip.reasons[]`. Map
   * key → user-facing chip text here. Never introduce a new key without
   * adding its label here or the chip will render blank.
   */
  reasons: {
    overdue_30_plus: "30+ days overdue",
    open_billing_issue: "Open billing issue",
    dispatch_blocker: "Dispatch blocked",
    balance_outstanding: "Balance outstanding",
    sms_opted_out: "SMS opted out",
    geocode_failure: "Address needs verification",
    expiring_quote: "Quote expiring soon",
  },

  smsStatus: {
    enabled: "SMS enabled",
    opted_out: "SMS opted out",
    no_phone: "No phone on file",
  },

  financialState: {
    paid: "Paid",
    partial: "Partial",
    past_due: "Past due",
    needs_review: "Needs review",
  },

  issueCategory: {
    billing: "Billing",
    pricing: "Pricing",
    address: "Address",
    sms_blocked: "SMS",
  },

  issueSeverity: {
    info: "Info",
    warning: "Warning",
    critical: "Critical",
  },

  empty: {
    noServiceSites: "No service addresses on file",
    noJobs: "No recent jobs",
    noChains: "No rental chains",
    noStandaloneJobs: "No one-off jobs",
    noIssues: "No open issues — customer is in the clear",
    noInternalNotes: "No internal notes yet",
    noDriverInstructions: "No driver instructions set",
    noLatestInvoice: "No invoices yet",
  },

  fields: {
    primary: "Primary",
    savedSite: "Saved site",
    verified: "Verified",
    needsVerification: "Needs verification",
    balance: "Outstanding balance",
    unpaid: "Unpaid",
    overdue: "Overdue",
    overdueThirtyPlus: "30+ days overdue",
    latestInvoice: "Latest invoice",
    chainLabel: "Rental chain",
    standaloneHeading: "One-off jobs",
    chainsHeading: "Rental chains",
    driverInstructionsHeading: "Driver instructions",
    internalNotesHeading: "Internal notes",
    driverInstructionsDescription:
      "Shown to drivers on the job card. Gate codes, placement notes, access instructions.",
    internalNotesDescription:
      "Office-only. Not visible to drivers or customers.",
  },

  jobTaskType: {
    delivery: "Delivery",
    pickup: "Pickup",
    exchange: "Exchange",
    dump_run: "Dump Run",
  },

  // ────────────────────────────────────────────────────────────────
  // Overview tab — interactive tiles + shared detail panel
  // ────────────────────────────────────────────────────────────────
  tile: {
    jobs: "Jobs",
    revenue: "Revenue",
    avgValue: "Avg Value",
    active: "Active",
    lastJob: "Last Job",
  },
  tilePanel: {
    jobs: "Recent Jobs",
    revenue: "Revenue History",
    avgValue: "Jobs by Value",
    active: "Active Rentals",
    lastJob: "Latest Job",
  },
  tileEmpty: {
    jobs: "No jobs yet",
    revenue: "No revenue history yet",
    avgValue: "No priced jobs yet",
    active: "No active rentals",
    lastJob: "No jobs yet",
  },

  // ────────────────────────────────────────────────────────────────
  // Customer > Pricing tab — editable overrides (Pass 1: base_price only)
  // ────────────────────────────────────────────────────────────────
  pricing: {
    sections: {
      customPricing: "Custom Pricing",
      customPricingDescription:
        "Override global base prices for specific dumpster sizes. Other fields continue to use global pricing.",
      surcharges: "Surcharge Amounts",
      surchargesDescription:
        "Override default surcharge amounts for this customer.",
    },
    status: {
      usingGlobal: "Using global pricing",
      usingGlobalSurcharges: "Using default surcharges",
      customActive: "Custom pricing active",
      customSurchargesActive: "Custom surcharges active",
    },
    fields: {
      size: "Size",
      global: "Global",
      override: "Override",
      effective: "Effective",
      default: "Default",
      clientRate: "Client Rate",
      active: "Active",
      overridePlaceholder: "Same as global",
    },
    actions: {
      save: "Save",
      clear: "Clear",
      saving: "Saving…",
    },
    empty: {
      noRules: "No pricing rules configured yet",
      noRulesHint:
        "Add tenant pricing rules on the Pricing page before setting customer overrides.",
      noSurcharges: "No surcharge templates configured yet",
    },
    toast: {
      saved: "Override saved",
      cleared: "Override removed",
      failed: "Failed to save override",
    },
  },
} as const;

// ──────────────────────────────────────────────────────────────────
// Typed lookup helpers — call these from components instead of
// indexing the object directly, so a missing key surfaces a TS error
// instead of a runtime `undefined`.
// ──────────────────────────────────────────────────────────────────

export type StatusReasonKey =
  | "overdue_30_plus"
  | "open_billing_issue"
  | "dispatch_blocker"
  | "balance_outstanding"
  | "sms_opted_out"
  | "geocode_failure"
  | "expiring_quote";

export type SeverityKey = "green" | "yellow" | "red";
export type SmsStatusKey = "enabled" | "opted_out" | "no_phone";
export type FinancialStateKey = "paid" | "partial" | "past_due" | "needs_review";
export type IssueCategoryKey = "billing" | "pricing" | "address" | "sms_blocked";
export type IssueSeverityKey = "info" | "warning" | "critical";

export function reasonLabel(key: string): string {
  return (
    CUSTOMER_DASHBOARD_LABELS.reasons[key as StatusReasonKey] ?? key
  );
}

export function severityLabel(key: SeverityKey): string {
  return CUSTOMER_DASHBOARD_LABELS.severity[key];
}

export function smsStatusLabel(key: SmsStatusKey): string {
  return CUSTOMER_DASHBOARD_LABELS.smsStatus[key];
}

export function financialStateLabel(key: FinancialStateKey): string {
  return CUSTOMER_DASHBOARD_LABELS.financialState[key];
}

export function issueCategoryLabel(key: string): string {
  return (
    CUSTOMER_DASHBOARD_LABELS.issueCategory[key as IssueCategoryKey] ?? key
  );
}

export function jobTaskTypeLabel(key: string): string {
  return (
    CUSTOMER_DASHBOARD_LABELS.jobTaskType[
      key as keyof typeof CUSTOMER_DASHBOARD_LABELS.jobTaskType
    ] ?? key
  );
}
