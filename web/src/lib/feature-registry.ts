/**
 * Centralized Feature Description Registry
 * Single source of truth for labels, tooltips, guide content, and future tenant overrides.
 */

export type FeatureCategory =
  | "navigation"
  | "operations"
  | "billing"
  | "pricing"
  | "dispatch"
  | "inventory"
  | "customers"
  | "reporting"
  | "settings";

export interface FeatureDescription {
  id: string;
  label: string;
  shortDescription: string;
  guideDescription: string;
  category: FeatureCategory;
  routeOrSurface: string;
  tenantOverrideKey: string;
  isUserFacing: boolean;
  isGuideEligible: boolean;
  keywords: string[];
}

export const FEATURE_REGISTRY: Record<string, FeatureDescription> = {
  // ── Navigation ──
  dashboard: {
    id: "dashboard", label: "Dashboard", category: "navigation",
    shortDescription: "Overview of your business metrics and today's activity.",
    guideDescription: "The Dashboard provides a high-level snapshot of revenue, active jobs, fleet status, and upcoming tasks. Use it as your daily starting point to understand what needs attention and track business performance over time.",
    routeOrSurface: "/", tenantOverrideKey: "dashboard",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["home", "overview", "metrics", "revenue", "summary"],
  },
  jobs: {
    id: "jobs", label: "Jobs", category: "operations",
    shortDescription: "Manage deliveries, pickups, exchanges, and dump runs.",
    guideDescription: "The Jobs page lists all scheduled and completed work orders. Filter by status, date, driver, or customer to find specific jobs. Each job tracks the full lifecycle from booking through completion, including pricing, assignment, and billing.",
    routeOrSurface: "/jobs", tenantOverrideKey: "jobs",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["work", "order", "delivery", "pickup", "exchange", "dump", "task"],
  },
  dispatch_board: {
    id: "dispatch_board", label: "Dispatch", category: "dispatch",
    shortDescription: "Assign and manage driver routes for the day.",
    guideDescription: "The Dispatch Board shows all drivers as columns with their assigned jobs. Drag jobs between columns to reassign, reorder stops within a route, and monitor each driver's load. Use bulk selection to assign multiple unassigned jobs at once.",
    routeOrSurface: "/dispatch", tenantOverrideKey: "dispatch_board",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["route", "driver", "assign", "schedule", "board", "drag"],
  },
  customers: {
    id: "customers", label: "Customers", category: "customers",
    shortDescription: "View and manage customer accounts and contacts.",
    guideDescription: "The Customers page stores all customer information including contact details, billing addresses, service history, and custom pricing overrides. Use it to look up customer records, edit details, or review past job and invoice history.",
    routeOrSurface: "/customers", tenantOverrideKey: "customers",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["client", "account", "contact", "billing", "address"],
  },
  assets: {
    id: "assets", label: "Assets", category: "inventory",
    shortDescription: "Track dumpsters, containers, and equipment.",
    guideDescription: "The Assets page shows your fleet of dumpsters and containers with their current status, location, and assignment. Use it to check availability, find specific units by ID, and review operational history for each asset.",
    routeOrSurface: "/assets", tenantOverrideKey: "assets",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["dumpster", "container", "equipment", "fleet", "inventory", "unit"],
  },
  invoices: {
    id: "invoices", label: "Invoices", category: "billing",
    shortDescription: "Create, send, and manage customer invoices.",
    guideDescription: "The Invoices page handles all billing documents. Create invoices from jobs, add line items and surcharges, apply payments, and track collection status. Each invoice maintains a full revision history for audit purposes.",
    routeOrSurface: "/invoices", tenantOverrideKey: "invoices",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["bill", "payment", "charge", "receipt", "money", "collect"],
  },
  billing_issues: {
    id: "billing_issues", label: "Billing Issues", category: "billing",
    shortDescription: "Detect and resolve billing discrepancies automatically.",
    guideDescription: "Billing Issues scans your invoices for common problems like overdue charges, weight overages, missing dump slips, and price mismatches. Auto-resolvable issues are fixed automatically. Others are flagged for your review with suggested actions.",
    routeOrSurface: "/billing-issues", tenantOverrideKey: "billing_issues",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["problem", "error", "discrepancy", "overdue", "mismatch", "fix"],
  },
  pricing_issues: {
    id: "pricing_issues", label: "Pricing Issues", category: "pricing",
    shortDescription: "Find and fix jobs with pricing problems or missing data.",
    guideDescription: "This page identifies jobs where pricing could not be calculated, needs review, or has been modified. Use it to find and resolve issues like missing addresses, unsupported sizes, or stale pricing snapshots. Each tile at the top acts as a quick filter to drill into specific issue types.",
    routeOrSurface: "/pricing-qa", tenantOverrideKey: "pricing_issues",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["pricing", "cost", "rate", "snapshot", "blocked", "fix", "resolve"],
  },
  pricing_config: {
    id: "pricing_config", label: "Pricing", category: "pricing",
    shortDescription: "Configure pricing rules, rates, and surcharges.",
    guideDescription: "The Pricing page lets you set base prices, rental periods, extra day rates, tonnage allowances, delivery fees, and distance-based surcharges for each dumpster size. Changes create new pricing versions — existing jobs keep their original pricing.",
    routeOrSurface: "/pricing", tenantOverrideKey: "pricing_config",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["rate", "rule", "surcharge", "fee", "configure", "setup"],
  },
  team: {
    id: "team", label: "Team", category: "settings",
    shortDescription: "Manage drivers, staff, and user accounts.",
    guideDescription: "The Team page shows all users in your organization including drivers, dispatchers, and admins. Manage roles, contact info, vehicle assignments, and track time entries. Driver profiles include real-time location and route status.",
    routeOrSurface: "/team", tenantOverrideKey: "team",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["driver", "staff", "employee", "user", "role", "account"],
  },
  analytics: {
    id: "analytics", label: "Analytics", category: "reporting",
    shortDescription: "Revenue, costs, and business performance metrics.",
    guideDescription: "Analytics provides detailed breakdowns of revenue, dump costs, profit margins, driver performance, asset utilization, and customer activity. Use date range filters and tabs to drill into specific areas of your business.",
    routeOrSurface: "/analytics", tenantOverrideKey: "analytics",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["report", "revenue", "profit", "chart", "performance", "data"],
  },

  // ── Pricing Issues tiles ──
  issue_geocode_blocked: {
    id: "issue_geocode_blocked", label: "Geocode Blocked", category: "pricing",
    shortDescription: "Address exists but could not be converted to coordinates.",
    guideDescription: "This job has a service address on file, but the system could not determine its geographic coordinates. This blocks distance-based pricing. Open the job to verify or correct the address, then retry geocoding.",
    routeOrSurface: "/pricing-qa", tenantOverrideKey: "issue_geocode_blocked",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["geocode", "coordinates", "location", "map", "address", "blocked"],
  },
  issue_missing_address: {
    id: "issue_missing_address", label: "Missing Address", category: "pricing",
    shortDescription: "No service address on file for this job.",
    guideDescription: "This job has no service address entered. Without an address, the system cannot calculate distance-based pricing or generate a pricing snapshot. Add the address in the issue panel to unblock pricing.",
    routeOrSurface: "/pricing-qa", tenantOverrideKey: "issue_missing_address",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["address", "missing", "location", "empty", "blank"],
  },
  issue_no_snapshot: {
    id: "issue_no_snapshot", label: "No Snapshot", category: "pricing",
    shortDescription: "Job has no saved pricing calculation.",
    guideDescription: "A pricing snapshot records the exact calculation used for a job. Without one, pricing is not formally locked. Use the Generate Snapshot action once the address, coordinates, and dumpster size are all valid.",
    routeOrSurface: "/pricing-qa", tenantOverrideKey: "issue_no_snapshot",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["snapshot", "calculation", "pricing", "missing", "generate"],
  },
  issue_unsupported_size: {
    id: "issue_unsupported_size", label: "Unsupported Size", category: "pricing",
    shortDescription: "This dumpster size has no active pricing rule.",
    guideDescription: "The dumpster size assigned to this job does not have a corresponding pricing rule configured. Either change the size to one with active pricing, or add a pricing rule for this size in Pricing settings.",
    routeOrSurface: "/pricing-qa", tenantOverrideKey: "issue_unsupported_size",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["size", "subtype", "rule", "unsupported", "pricing", "configure"],
  },
  issue_no_size: {
    id: "issue_no_size", label: "No Size Set", category: "pricing",
    shortDescription: "No dumpster size assigned to this job.",
    guideDescription: "This job does not have a dumpster size selected. Pricing requires a size to look up the correct rate. Assign a size in the issue panel to unblock pricing calculation.",
    routeOrSurface: "/pricing-qa", tenantOverrideKey: "issue_no_size",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["size", "dumpster", "missing", "assign", "select"],
  },
  issue_locked: {
    id: "issue_locked", label: "Locked", category: "pricing",
    shortDescription: "Pricing is finalized and protected from recalculation.",
    guideDescription: "A locked job's pricing has been reviewed and confirmed. It will not change if pricing rules are updated. This protects historical accuracy for invoiced or completed jobs. Locked status is informational — no action needed.",
    routeOrSurface: "/pricing-qa", tenantOverrideKey: "issue_locked",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["locked", "finalized", "protected", "snapshot", "confirmed"],
  },
  issue_recalculated: {
    id: "issue_recalculated", label: "Recalculated", category: "pricing",
    shortDescription: "Pricing changed due to updated job data.",
    guideDescription: "This job's price was recalculated because inputs changed — such as an address update, size change, or explicit recalculation request. Review the audit history to see what changed and confirm the new price is correct.",
    routeOrSurface: "/pricing-qa", tenantOverrideKey: "issue_recalculated",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["recalculate", "changed", "updated", "audit", "history", "price"],
  },
  issue_exchange: {
    id: "issue_exchange", label: "Exchange Jobs", category: "pricing",
    shortDescription: "Container swap jobs with special tonnage rules.",
    guideDescription: "Exchange jobs involve picking up one container and delivering another. Tonnage overage is calculated based on the pickup container, not the dropoff. This ensures the disposal allowance matches the dumpster being hauled to the dump facility.",
    routeOrSurface: "/pricing-qa", tenantOverrideKey: "issue_exchange",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["exchange", "swap", "container", "tonnage", "pickup", "dropoff"],
  },

  // ── Dispatch items ──
  dispatch_unassigned: {
    id: "dispatch_unassigned", label: "Unassigned", category: "dispatch",
    shortDescription: "Jobs not yet assigned to a driver.",
    guideDescription: "The Unassigned column shows all jobs for the selected date that have no driver assigned. Drag jobs from here into driver columns to assign them, or use bulk selection to assign multiple jobs at once.",
    routeOrSurface: "/dispatch", tenantOverrideKey: "dispatch_unassigned",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["unassigned", "pending", "available", "assign", "driver"],
  },
  dispatch_awaiting_dump: {
    id: "dispatch_awaiting_dump", label: "Awaiting Dump", category: "dispatch",
    shortDescription: "Containers at the yard ready for dump facility runs.",
    guideDescription: "Awaiting Dump shows containers that have been picked up and staged at the yard but not yet taken to a dump facility. Create dump runs from this list to schedule disposal trips.",
    routeOrSurface: "/dispatch", tenantOverrideKey: "dispatch_awaiting_dump",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["dump", "yard", "staged", "disposal", "facility", "waiting"],
  },

  // ── Price Breakdown ──
  price_breakdown: {
    id: "price_breakdown", label: "Price Breakdown", category: "pricing",
    shortDescription: "Shows how the job price was calculated.",
    guideDescription: "This section explains how pricing was determined for a job, including distance from yard, pricing tier applied, base price, included tonnage, and any adjustments or surcharges. Use this to verify, explain, or troubleshoot job pricing.",
    routeOrSurface: "quick_view_panel", tenantOverrideKey: "price_breakdown",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["pricing", "cost", "calculation", "rate", "how much", "breakdown"],
  },
};

// ── Lookup helpers ──

export function getFeature(id: string): FeatureDescription | undefined {
  return FEATURE_REGISTRY[id];
}

export function getFeaturesByCategory(category: FeatureCategory): FeatureDescription[] {
  return Object.values(FEATURE_REGISTRY).filter(f => f.category === category);
}

export function getGuideEligibleFeatures(): FeatureDescription[] {
  return Object.values(FEATURE_REGISTRY).filter(f => f.isGuideEligible && f.isUserFacing);
}

export function getFeatureLabel(
  id: string,
  tenantOverrides?: Record<string, { label?: string; shortDescription?: string }>,
): string {
  const override = tenantOverrides?.[id];
  return override?.label || FEATURE_REGISTRY[id]?.label || id;
}

export function getFeatureTooltip(
  id: string,
  tenantOverrides?: Record<string, { label?: string; shortDescription?: string }>,
): string {
  const override = tenantOverrides?.[id];
  return override?.shortDescription || FEATURE_REGISTRY[id]?.shortDescription || "";
}

export function listFeaturesForGuide(
  category?: FeatureCategory,
  tenantOverrides?: Record<string, { label?: string }>,
): FeatureDescription[] {
  return Object.values(FEATURE_REGISTRY)
    .filter(f => f.isGuideEligible && f.isUserFacing)
    .filter(f => !category || f.category === category)
    .sort((a, b) => a.label.localeCompare(b.label));
}
