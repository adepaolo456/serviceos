/**
 * Centralized Feature Description Registry
 * Single source of truth for labels, tooltips, guide content, and future tenant overrides.
 */

export type FeatureCategory =
  | "getting_started"
  | "dashboard"
  | "customers"
  | "assets"
  | "operations"
  | "billing"
  | "pricing"
  | "team"
  | "analytics"
  | "marketplace"
  | "notifications"
  | "settings"
  | "admin";

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
  // ── Dashboard ──
  dashboard: {
    id: "dashboard", label: "Dashboard", category: "dashboard",
    shortDescription: "Overview of your business metrics and today's activity.",
    guideDescription: "The Dashboard provides a high-level snapshot of revenue, active jobs, fleet status, and upcoming tasks. Use it as your daily starting point to understand what needs attention and track business performance over time.",
    routeOrSurface: "/", tenantOverrideKey: "dashboard",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["home", "overview", "metrics", "revenue", "summary"],
  },

  // ── Customers ──
  customers: {
    id: "customers", label: "Customers", category: "customers",
    shortDescription: "View and manage customer accounts and contacts.",
    guideDescription: "The Customers page stores all customer information including contact details, billing addresses, service history, and custom pricing overrides. Use it to look up customer records, edit details, or review past job and invoice history.",
    routeOrSurface: "/customers", tenantOverrideKey: "customers",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["client", "account", "contact", "billing", "address"],
  },

  // ── Assets ──
  assets: {
    id: "assets", label: "Assets", category: "assets",
    shortDescription: "Track dumpsters, containers, and equipment.",
    guideDescription: "The Assets page shows your fleet of dumpsters and containers with their current status, location, and assignment. Use it to check availability, find specific units by ID, and review operational history for each asset.",
    routeOrSurface: "/assets", tenantOverrideKey: "assets",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["dumpster", "container", "equipment", "fleet", "inventory", "unit"],
  },

  // ── Operations ──
  jobs: {
    id: "jobs", label: "Jobs", category: "operations",
    shortDescription: "Manage deliveries, pickups, exchanges, and dump runs.",
    guideDescription: "The Jobs page lists all scheduled and completed work orders. Filter by status, date, driver, or customer to find specific jobs. Each job tracks the full lifecycle from booking through completion, including pricing, assignment, and billing.",
    routeOrSurface: "/jobs", tenantOverrideKey: "jobs",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["work", "order", "delivery", "pickup", "exchange", "dump", "task"],
  },
  dispatch_board: {
    id: "dispatch_board", label: "Dispatch Board", category: "operations",
    shortDescription: "Assign and manage driver routes for the day.",
    guideDescription: "The Dispatch Board shows all drivers as columns with their assigned jobs. Drag jobs between columns to reassign, reorder stops within a route, and monitor each driver's load. Use bulk selection to assign multiple unassigned jobs at once.",
    routeOrSurface: "/dispatch", tenantOverrideKey: "dispatch_board",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["route", "driver", "assign", "schedule", "board", "drag"],
  },
  dump_sites: {
    id: "dump_sites", label: "Dump Sites", category: "operations",
    shortDescription: "Manage dump facilities, rates, and disposal locations.",
    guideDescription: "The Dump Sites page tracks disposal facilities your drivers use, including addresses, accepted waste types, per-ton rates, and surcharges. Keep this updated so dump cost calculations and dump run scheduling stay accurate.",
    routeOrSurface: "/dump-locations", tenantOverrideKey: "dump_sites",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["dump", "disposal", "facility", "landfill", "transfer", "waste"],
  },
  new_booking: {
    id: "new_booking", label: "New Booking", category: "operations",
    shortDescription: "Internal booking wizard used by customer-scoped New Job and Quick Quote Book Now.",
    guideDescription: "The booking wizard is accessed from the customer dashboard (New Job) or via Quick Quote's Book Now button. It walks through customer selection, address, dumpster size, delivery dates, and pricing. For new bookings, use Quick Quote from the sidebar. For repeat customer work, use New Job from the customer dashboard.",
    routeOrSurface: "wizard_internal", tenantOverrideKey: "new_booking",
    isUserFacing: false, isGuideEligible: false,
    keywords: ["book", "order", "create", "schedule", "wizard", "internal"],
  },
  exchange_detection: {
    id: "exchange_detection", label: "Exchange Detection", category: "operations",
    shortDescription: "Exchange selected — active dumpster found at this site",
    guideDescription: "When a customer already has an active dumpster at the selected service address, the booking wizard automatically defaults to Exchange instead of New Delivery. You can always override this by manually selecting a different job type.",
    routeOrSurface: "wizard_internal", tenantOverrideKey: "exchange_detection",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["exchange", "detection", "auto", "onsite", "dumpster", "swap", "active"],
  },
  exchange_availability: {
    id: "exchange_availability", label: "Replacement Inventory", category: "operations",
    shortDescription: "Replacement inventory",
    guideDescription: "Shows how many replacement dumpsters of the selected size are available for the exchange date. This checks the same fleet inventory used for new deliveries but displays with exchange-specific context.",
    routeOrSurface: "wizard_internal", tenantOverrideKey: "exchange_availability",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["exchange", "replacement", "inventory", "availability", "dumpster", "swap"],
  },
  dispatch_unassigned: {
    id: "dispatch_unassigned", label: "Unassigned", category: "operations",
    shortDescription: "Jobs not yet assigned to a driver.",
    guideDescription: "The Unassigned column shows all jobs for the selected date that have no driver assigned. Drag jobs from here into driver columns to assign them, or use bulk selection to assign multiple jobs at once.",
    routeOrSurface: "dispatch_panel", tenantOverrideKey: "dispatch_unassigned",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["unassigned", "pending", "available", "assign", "driver"],
  },
  dispatch_awaiting_dump: {
    id: "dispatch_awaiting_dump", label: "Awaiting Dump", category: "operations",
    shortDescription: "Containers at the yard ready for dump facility runs.",
    guideDescription: "Awaiting Dump shows containers that have been picked up and staged at the yard but not yet taken to a dump facility. Create dump runs from this list to schedule disposal trips.",
    routeOrSurface: "dispatch_panel", tenantOverrideKey: "dispatch_awaiting_dump",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["dump", "yard", "staged", "disposal", "facility", "waiting"],
  },
  dispatch_quick_view: {
    id: "dispatch_quick_view", label: "Quick View", category: "operations",
    shortDescription: "Preview job details without leaving the dispatch board.",
    guideDescription: "Double-click any job card on the Dispatch Board to open Quick View. It shows customer info, address, billing status, and dispatch notes. You can edit notes and delivery instructions inline without navigating away from dispatch.",
    routeOrSurface: "dispatch_panel", tenantOverrideKey: "dispatch_quick_view",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["preview", "detail", "inspect", "sidebar", "panel"],
  },
  dispatch_filters: {
    id: "dispatch_filters", label: "Dispatch Filters", category: "operations",
    shortDescription: "Filter dispatch jobs by type, status, or search terms.",
    guideDescription: "The filter bar at the top of the Dispatch Board lets you narrow visible jobs by type (deliveries, pickups, exchanges, dump runs) or search by customer name, address, or job number. Use filters to focus on specific work during busy dispatch sessions.",
    routeOrSurface: "dispatch_panel", tenantOverrideKey: "dispatch_filters",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["filter", "search", "type", "status", "find"],
  },
  dispatch_driver_columns: {
    id: "dispatch_driver_columns", label: "Driver Columns", category: "operations",
    shortDescription: "Each column represents a driver's route for the day.",
    guideDescription: "Driver columns show the ordered list of stops for each driver. Drag to reorder stops within a route, check the load indicator for workload balance, and use the route time summary to see the estimated span of each driver's day.",
    routeOrSurface: "dispatch_panel", tenantOverrideKey: "dispatch_driver_columns",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["column", "driver", "route", "lane", "stops", "order"],
  },

  // ── Billing ──
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

  // ── Pricing ──
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
  price_breakdown: {
    id: "price_breakdown", label: "Price Breakdown", category: "pricing",
    shortDescription: "Shows how the job price was calculated.",
    guideDescription: "This section explains how pricing was determined for a job, including distance from yard, pricing tier applied, base price, included tonnage, and any adjustments or surcharges. Use this to verify, explain, or troubleshoot job pricing.",
    routeOrSurface: "quick_view_panel", tenantOverrideKey: "price_breakdown",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["pricing", "cost", "calculation", "rate", "how much", "breakdown"],
  },
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

  // ── Team ──
  team: {
    id: "team", label: "Team", category: "team",
    shortDescription: "Manage drivers, staff, and user accounts.",
    guideDescription: "The Team page shows all users in your organization including drivers, dispatchers, and admins. Manage roles, contact info, vehicle assignments, and track time entries. Driver profiles include real-time location and route status.",
    routeOrSurface: "/team", tenantOverrideKey: "team",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["driver", "staff", "employee", "user", "role", "account"],
  },
  vehicles: {
    id: "vehicles", label: "Vehicles", category: "team",
    shortDescription: "Track trucks, trailers, and fleet vehicles.",
    guideDescription: "The Vehicles page lists your fleet of trucks and trailers with make, model, plate numbers, and assigned drivers. Use it to manage vehicle assignments and keep fleet records current for dispatch and reporting.",
    routeOrSurface: "/vehicles", tenantOverrideKey: "vehicles",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["truck", "trailer", "fleet", "vehicle", "plate", "transport"],
  },

  // ── Analytics ──
  analytics: {
    id: "analytics", label: "Analytics", category: "analytics",
    shortDescription: "Revenue, costs, and business performance metrics.",
    guideDescription: "Analytics provides detailed breakdowns of revenue, dump costs, profit margins, driver performance, asset utilization, and customer activity. Use date range filters and tabs to drill into specific areas of your business.",
    routeOrSurface: "/analytics", tenantOverrideKey: "analytics",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["report", "revenue", "profit", "chart", "performance", "data"],
  },

  // ── Marketplace ──
  marketplace: {
    id: "marketplace", label: "Marketplace", category: "marketplace",
    shortDescription: "Your public-facing booking page for customers.",
    guideDescription: "The Marketplace manages your customer-facing booking widget and public website. Customers can browse available sizes, get instant pricing, and book dumpster deliveries online. Orders flow directly into your Jobs and Invoices.",
    routeOrSurface: "/marketplace", tenantOverrideKey: "marketplace",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["website", "booking", "public", "online", "widget", "storefront"],
  },

  // ── Notifications ──
  notifications: {
    id: "notifications", label: "Notifications", category: "notifications",
    shortDescription: "View and manage system alerts and messages.",
    guideDescription: "The Notifications page shows alerts for job updates, billing events, overdue rentals, and system messages. Configure notification preferences to control which alerts you receive via email, SMS, or in-app.",
    routeOrSurface: "/notifications", tenantOverrideKey: "notifications",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["alert", "message", "email", "sms", "reminder", "notify"],
  },

  // ── Settings ──
  settings: {
    id: "settings", label: "Settings", category: "settings",
    shortDescription: "Configure your account, business details, and preferences.",
    guideDescription: "Settings lets you update your business name, address, contact info, yard locations, and operational preferences. This is also where you manage integrations like Stripe for payments and Mapbox for geocoding.",
    routeOrSurface: "/settings", tenantOverrideKey: "settings",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["config", "preferences", "account", "business", "setup", "yard"],
  },

  // ── Fleet ──
  fleet: {
    id: "fleet", label: "Fleet", category: "assets",
    shortDescription: "Manage company vehicles, equipment, and related operating records.",
    guideDescription: "Fleet is where you manage your company's vehicles and equipment. Use it to keep a complete record of each vehicle including details and specifications, purchase information, insurance coverage, maintenance history and service logs, fuel logs, and day-to-day operational tracking. Fleet helps you stay on top of compliance, cost tracking, and scheduled maintenance so nothing falls through the cracks.",
    routeOrSurface: "/vehicles", tenantOverrideKey: "fleet",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["vehicle", "truck", "equipment", "maintenance", "fuel", "insurance", "fleet", "purchase", "service", "repair"],
  },

  // ── Admin ──
  help_analytics: {
    id: "help_analytics", label: "Help Analytics", category: "admin",
    shortDescription: "Usage analytics for Help Center and tooltip interactions.",
    guideDescription: "Help Analytics provides internal usage data for Help Center and tooltip help discovery. View topic views, tooltip clicks, search queries, related topic navigation, and identify unregistered feature references. Use it to understand which help content is most accessed and where documentation gaps exist.",
    routeOrSurface: "/admin/help-analytics", tenantOverrideKey: "help_analytics",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["analytics", "help", "usage", "tracking", "admin", "internal"],
  },
  help_center: {
    id: "help_center", label: "Help Center", category: "admin",
    shortDescription: "Find answers and learn how ServiceOS works.",
    guideDescription: "The Help Center provides searchable documentation for every feature in ServiceOS. Browse by category or search for specific topics. Each entry explains what the feature does, where to find it, and how to use it effectively.",
    routeOrSurface: "/help", tenantOverrideKey: "help_center",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["help", "guide", "documentation", "learn", "how to", "support"],
  },

  // ── Quick Quote ──
  quick_quote: {
    id: "quick_quote", label: "Quick Quote", category: "operations",
    shortDescription: "Generate an instant dumpster rental quote for phone inquiries.",
    guideDescription: "Quick Quote lets you generate a price estimate in seconds from the sidebar. Select a dumpster size and enter a delivery address to get a full quote powered by your pricing rules, distance surcharges, and tenant fees. From the quote, you can Book Now to continue into the full booking flow, or Email Quote to send the customer a branded email with a one-click Book Now link.",
    routeOrSurface: "sidebar_drawer", tenantOverrideKey: "quick_quote",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["quote", "estimate", "price", "phone", "inquiry", "quick", "instant"],
  },
  quick_quote_email: {
    id: "quick_quote_email", label: "Email Quote", category: "operations",
    shortDescription: "Send a branded quote email with a Book Now link.",
    guideDescription: "Email Quote sends the customer a branded email containing the quote summary, pricing breakdown, and a secure Book Now button. Clicking that link takes the customer to your tenant website booking wizard with the quote details pre-filled. Quotes expire after 30 days.",
    routeOrSurface: "sidebar_drawer", tenantOverrideKey: "quick_quote_email",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["email", "send", "quote", "customer", "link", "book"],
  },
  quick_quote_book_now: {
    id: "quick_quote_book_now", label: "Book Now", category: "operations",
    shortDescription: "Continue a quick quote directly into the booking flow.",
    guideDescription: "Book Now takes the dumpster size and delivery address from your quick quote and pre-fills them into the standard New Booking wizard. The booking follows all normal pricing, payment, and dispatch rules — no shortcuts or parallel booking path.",
    routeOrSurface: "sidebar_drawer", tenantOverrideKey: "quick_quote_book_now",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["book", "reserve", "schedule", "convert", "quote", "order"],
  },
  quick_quote_dumpster_size: {
    id: "quick_quote_dumpster_size", label: "Dumpster Size", category: "operations",
    shortDescription: "Select dumpster size from your active pricing rules.",
    guideDescription: "The dumpster size selector shows all active pricing rules for your tenant. Each pill displays the size name and base price. Selecting a size begins the quote calculation.",
    routeOrSurface: "sidebar_drawer", tenantOverrideKey: "quick_quote_dumpster_size",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["size", "dumpster", "yard", "container", "select"],
  },
  quick_quote_delivery_address: {
    id: "quick_quote_delivery_address", label: "Delivery Address", category: "operations",
    shortDescription: "Enter delivery address for distance-based pricing.",
    guideDescription: "The delivery address field uses Mapbox autocomplete to resolve a full address with coordinates. Once entered, the system calculates the full quote including distance surcharges, tenant fees, and tax using your pricing engine.",
    routeOrSurface: "sidebar_drawer", tenantOverrideKey: "quick_quote_delivery_address",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["address", "delivery", "location", "distance", "zone", "map"],
  },

  // ── Quotes Pipeline ──
  quotes_page: {
    id: "quotes_page", label: "Quotes", category: "billing",
    shortDescription: "Track sent quotes, conversions, and quote pipeline.",
    guideDescription: "The Quotes page shows all quotes sent from Quick Quote. Filter by status (open, converted, expired), search by customer or quote number, and view conversion metrics. Open any quote to see full details, re-send the email, or copy the booking link.",
    routeOrSurface: "/quotes", tenantOverrideKey: "quotes_page",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["quote", "pipeline", "conversion", "sent", "tracking", "email"],
  },
  quote_detail: {
    id: "quote_detail", label: "Quote Detail", category: "billing",
    shortDescription: "View quote snapshot, pricing, status, and booking linkage.",
    guideDescription: "The Quote Detail panel shows the full quote record including customer info, pricing breakdown, delivery address, timeline, and conversion status. If the quote was booked, a link to the resulting job is shown. You can re-send the quote email or copy the booking link for internal use.",
    routeOrSurface: "slide_over", tenantOverrideKey: "quote_detail",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["quote", "detail", "snapshot", "pricing", "status", "booking"],
  },
  quote_history: {
    id: "quote_history", label: "Quote History", category: "customers",
    shortDescription: "Customer's quote history and conversion status.",
    guideDescription: "The Quote History tab on the customer dashboard shows all quotes associated with that customer. Each entry displays the quote number, dumpster size, quoted amount, status (open, converted, expired), and date. Use it to understand a customer's quoting history before creating a new job.",
    routeOrSurface: "customer_tab", tenantOverrideKey: "quote_history",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["quote", "history", "customer", "conversion", "pipeline"],
  },

  // ── Job Lifecycle Display States ──
  job_status_pending_payment: {
    id: "job_status_pending_payment", label: "Pending Payment", category: "operations",
    shortDescription: "Job is awaiting payment before it can be dispatched.",
    guideDescription: "A job in Pending Payment status has not yet satisfied the payment requirement. It will not appear on the dispatch board until the invoice is paid or a credit override is applied. Use Quick Quote or the booking wizard to collect payment and advance the job.",
    routeOrSurface: "job_status", tenantOverrideKey: "job_status_pending_payment",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["pending", "payment", "unpaid", "invoice", "gate", "block"],
  },
  job_status_unassigned: {
    id: "job_status_unassigned", label: "Unassigned", category: "operations",
    shortDescription: "Job is dispatch-ready but not yet assigned to a driver.",
    guideDescription: "An Unassigned job has passed payment requirements and is ready for dispatch. Drag it onto a driver column on the Dispatch Board to assign it, or use bulk assignment. Once assigned, the job becomes Assigned.",
    routeOrSurface: "job_status", tenantOverrideKey: "job_status_unassigned",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["unassigned", "ready", "dispatch", "queue", "available"],
  },
  job_status_assigned: {
    id: "job_status_assigned", label: "Assigned", category: "operations",
    shortDescription: "Job has been assigned to a driver and route.",
    guideDescription: "An Assigned job has a driver and is part of a route. The driver will see it in their mobile app. When the driver starts heading to the job, it moves to En Route.",
    routeOrSurface: "job_status", tenantOverrideKey: "job_status_assigned",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["assigned", "driver", "route", "dispatched", "scheduled"],
  },
  job_status_arrived: {
    id: "job_status_arrived", label: "Arrived", category: "operations",
    shortDescription: "Driver has arrived at the job site.",
    guideDescription: "An Arrived job means the driver is physically at the delivery or pickup location. This status helps track on-site time. When the driver finishes the job, it moves to Completed.",
    routeOrSurface: "job_status", tenantOverrideKey: "job_status_arrived",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["arrived", "on-site", "driver", "location", "active"],
  },
  job_status_en_route: {
    id: "job_status_en_route", label: "En Route", category: "operations",
    shortDescription: "Driver is traveling to the job site.",
    guideDescription: "An En Route job means the driver has left the yard or their previous stop and is heading to the delivery or pickup location. Customers may receive an ETA notification at this point. When the driver reaches the site the job moves to Arrived.",
    routeOrSurface: "job_status", tenantOverrideKey: "job_status_en_route",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["en route", "driving", "driver", "eta", "traveling", "heading"],
  },
  job_status_completed: {
    id: "job_status_completed", label: "Completed", category: "operations",
    shortDescription: "Job has been completed on-site.",
    guideDescription: "A Completed job has been finished by the driver. The customer can now be invoiced (if billing was deferred) and any billing follow-ups (unpaid balances, completion review) surface from this state.",
    routeOrSurface: "job_status", tenantOverrideKey: "job_status_completed",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["completed", "done", "finished", "delivered", "picked up"],
  },
  job_status_blocked: {
    id: "job_status_blocked", label: "Blocked", category: "operations",
    shortDescription: "Job is flagged for operator attention due to a billing issue.",
    guideDescription: "Blocked is a computed flag — not a stored job status. A job is Blocked when it has an open billing issue OR when it was completed while its linked invoice still has an unpaid balance. Blocked jobs stay on their normal dispatch track but surface in the Jobs page top strip and get a red left-border so operators can resolve the money problem without losing sight of the dispatch lifecycle.",
    routeOrSurface: "job_status", tenantOverrideKey: "job_status_blocked",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["blocked", "billing", "issue", "unpaid", "review", "attention", "money"],
  },
  blocked_subview_all: {
    id: "blocked_subview_all", label: "All Blocked", category: "operations",
    shortDescription: "Show every blocked job regardless of reason.",
    guideDescription: "",
    routeOrSurface: "blocked_reason", tenantOverrideKey: "blocked_subview_all",
    // Not guide-eligible on purpose. This entry exists so the sub-filter
    // pill label flows entirely through the registry (tenant overrides
    // still apply). The Blocked *concept* is already documented under
    // `job_status_blocked`; registering this UI-widget label as a
    // separate guide entry would duplicate that guide content with no
    // new information and pollute Help Center search results.
    isUserFacing: true, isGuideEligible: false,
    keywords: ["all", "blocked", "reason", "sub-filter", "drill-down"],
  },
  blocked_reason_billing_issue: {
    id: "blocked_reason_billing_issue", label: "Billing Issue", category: "operations",
    shortDescription: "Job has at least one open billing issue flagged by the billing detector.",
    guideDescription: "A Billing Issue reason appears on a Blocked job when the billing issue detector has raised one or more open issues against it (for example, a price mismatch, a completed_unpaid_review flag, or a customer credit override pending approval). Click the badge to jump to the Billing Issues page to review and resolve the underlying issue. Once the issue is resolved the Blocked flag and red row border clear automatically on the next Jobs page refresh.",
    routeOrSurface: "blocked_reason", tenantOverrideKey: "blocked_reason_billing_issue",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["blocked", "reason", "billing", "issue", "detector", "review", "resolve"],
  },
  blocked_reason_unpaid_completed_invoice: {
    id: "blocked_reason_unpaid_completed_invoice", label: "Unpaid Invoice", category: "operations",
    shortDescription: "Job was completed but its linked invoice still has an unpaid balance.",
    guideDescription: "An Unpaid Invoice reason appears on a Blocked job when the job has reached Completed but its linked invoice still has a balance due and is not yet marked paid or partial. This surfaces jobs where the work was delivered but collection is outstanding. Click the badge to jump to the invoice and collect payment, send a reminder, or write off the balance. Once the invoice is fully collected or voided the Blocked flag and red row border clear automatically on the next Jobs page refresh.",
    routeOrSurface: "blocked_reason", tenantOverrideKey: "blocked_reason_unpaid_completed_invoice",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["blocked", "reason", "unpaid", "completed", "invoice", "collect", "balance", "delivered"],
  },
  billing_issues_job_scope: {
    id: "billing_issues_job_scope", label: "Showing issues for this job", category: "operations",
    shortDescription: "The Billing Issues list is currently scoped to a single job via deep-link from the Jobs page.",
    guideDescription: "When you click a Billing Issue reason chip on the Jobs page, you are deep-linked to the Billing Issues page scoped to that specific job. A scoped banner at the top of the list confirms which job you are viewing and the existing status and type filters still apply on top of the scope so you can further narrow within the job's issues. Click 'View all issues' in the banner to clear the scope and return to the full Billing Issues list.",
    routeOrSurface: "billing_issues", tenantOverrideKey: "billing_issues_job_scope",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["billing", "issues", "scope", "job", "deep-link", "filter", "drill-down"],
  },
  billing_issues_clear_job_scope: {
    id: "billing_issues_clear_job_scope", label: "View all issues", category: "operations",
    shortDescription: "Clear the current job scope and return to the full Billing Issues list.",
    guideDescription: "",
    routeOrSurface: "billing_issues", tenantOverrideKey: "billing_issues_clear_job_scope",
    // Not guide-eligible — this is a UI action label for the scoped banner.
    // The workflow is documented under `billing_issues_job_scope`; a
    // separate guide entry for the clear-scope button would duplicate
    // that text with no new information.
    isUserFacing: true, isGuideEligible: false,
    keywords: ["clear", "all", "billing", "issues", "back", "scope"],
  },
  job_blocked_panel: {
    id: "job_blocked_panel", label: "Job is blocked", category: "operations",
    shortDescription: "Contextual panel on the Job detail page shown when the job is blocked by a billing issue or unpaid completed invoice.",
    guideDescription: "When you open a Blocked job the Job detail page shows a contextual panel above the quick actions that tells you WHY the job is blocked (billing issue vs. unpaid completed invoice), how many open issues exist for this job, and gives you one-click CTAs to the right resolution workflow — Review in Billing Issues for the billing_issue case, or Open Invoice for the unpaid_completed_invoice case. The panel is a navigation surface only; it never resolves or dismisses issues directly. Blocked resolution still happens on the Billing Issues page or the Invoice page using the existing, authorized resolution flows.",
    routeOrSurface: "job_detail", tenantOverrideKey: "job_blocked_panel",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["job", "detail", "blocked", "panel", "billing", "issue", "unpaid", "invoice", "resolve"],
  },
  job_blocked_panel_cta_review_issues: {
    id: "job_blocked_panel_cta_review_issues", label: "Review in Billing Issues", category: "operations",
    shortDescription: "Deep-link from the Job detail blocked panel to the scoped Billing Issues list for this job.",
    guideDescription: "",
    routeOrSurface: "job_detail", tenantOverrideKey: "job_blocked_panel_cta_review_issues",
    // Not guide-eligible — CTA button label. The workflow it triggers
    // is documented under `job_blocked_panel` and `billing_issues_job_scope`.
    isUserFacing: true, isGuideEligible: false,
    keywords: ["review", "billing", "issues", "blocked", "cta"],
  },
  job_blocked_panel_cta_open_invoice: {
    id: "job_blocked_panel_cta_open_invoice", label: "Open Invoice", category: "operations",
    shortDescription: "Deep-link from the Job detail blocked panel to the linked invoice for collection or write-off.",
    guideDescription: "",
    routeOrSurface: "job_detail", tenantOverrideKey: "job_blocked_panel_cta_open_invoice",
    // Not guide-eligible — CTA button label. The workflow is documented
    // under `job_blocked_panel`.
    isUserFacing: true, isGuideEligible: false,
    keywords: ["open", "invoice", "collect", "payment", "blocked", "cta"],
  },
  job_blocked_resolution_drawer: {
    id: "job_blocked_resolution_drawer", label: "Resolve Blockers", category: "operations",
    shortDescription: "Job-scoped resolution surface that consolidates billing blockers, predicts which will clear after payment, and offers the shortest correct next action without page bouncing.",
    guideDescription: "The Resolve Blockers drawer opens from the Job detail blocked panel and stays on the Job page. It groups every actionable billing blocker for the current job, classifies them by likely root cause (payment-related vs needs separate review vs uncertain), and tells you in advance how many are expected to clear if you record payment versus how many will still need attention. When the linked invoice has an unpaid balance, the drawer offers Record Payment inline using the same authorized payment endpoint as the Invoice page — you never leave the Job page. After you record payment, the drawer compares the issue list before and after, shows you exactly what cleared, and auto-closes if everything is resolved (1.5s after success). Backend auto-resolution clears the related past_due_payment and completed_unpaid issues automatically — you do not need to resolve them one by one. For non-payment issues that need separate attention (price mismatch, missing dump slip, etc.), the drawer offers a fallback to the existing Billing Issues workflow. The prediction layer is conservative: when uncertain it says so, never overpromises, and always preserves a path to the dedicated Billing Issues page for full guided resolution.",
    routeOrSurface: "job_detail", tenantOverrideKey: "job_blocked_resolution_drawer",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["resolve", "blockers", "drawer", "job", "payment", "billing", "issues", "root cause", "unpaid", "predict", "guidance"],
  },
  job_blocked_resolution_cta_primary: {
    id: "job_blocked_resolution_cta_primary", label: "Fix Billing", category: "operations",
    shortDescription: "Open the Job Blocked Resolution Drawer.",
    guideDescription: "",
    routeOrSurface: "job_detail", tenantOverrideKey: "job_blocked_resolution_cta_primary",
    // Not guide-eligible — CTA button label. The workflow is documented
    // under `job_blocked_resolution_drawer`.
    isUserFacing: true, isGuideEligible: false,
    keywords: ["fix", "billing", "resolve", "blockers", "cta"],
  },
  job_blocked_resolution_payment_first: {
    id: "job_blocked_resolution_payment_first", label: "Record Payment", category: "operations",
    shortDescription: "Section title inside the resolution drawer for the inline payment-first action.",
    guideDescription: "",
    routeOrSurface: "job_detail", tenantOverrideKey: "job_blocked_resolution_payment_first",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["record", "payment", "resolve", "blockers", "drawer", "section"],
  },
  job_blocked_resolution_other_issues: {
    id: "job_blocked_resolution_other_issues", label: "Other open issues", category: "operations",
    shortDescription: "Section title for billing issues on this job that need separate attention.",
    guideDescription: "",
    routeOrSurface: "job_detail", tenantOverrideKey: "job_blocked_resolution_other_issues",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["other", "issues", "billing", "resolve", "drawer", "section"],
  },
  job_blocked_resolution_open_in_billing_issues: {
    id: "job_blocked_resolution_open_in_billing_issues", label: "Open in Billing Issues", category: "operations",
    shortDescription: "Fallback CTA from the resolution drawer to the scoped Billing Issues page for full issue resolution flows.",
    guideDescription: "",
    routeOrSurface: "job_detail", tenantOverrideKey: "job_blocked_resolution_open_in_billing_issues",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["open", "billing", "issues", "fallback", "scoped"],
  },

  // ── Phase 5: predictive blocker intelligence ──
  // All non-guide-eligible — these are micro-copy for the resolution
  // drawer's predictive summary section. The drawer concept itself is
  // documented under `job_blocked_resolution_drawer` above; adding
  // separate guide entries for individual prediction phrases would
  // duplicate that text with no new conceptual content.
  blocker_prediction_payment_will_clear: {
    id: "blocker_prediction_payment_will_clear", label: "Recording payment is expected to clear these blockers.", category: "operations",
    shortDescription: "Lead phrase shown in the resolution drawer when every visible blocker is expected to clear after payment.",
    guideDescription: "",
    routeOrSurface: "job_detail", tenantOverrideKey: "blocker_prediction_payment_will_clear",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["predict", "payment", "blockers", "clear"],
  },
  blocker_prediction_payment_with_remaining: {
    id: "blocker_prediction_payment_with_remaining", label: "Recording payment is expected to clear payment-related blockers. Others will still need separate review.", category: "operations",
    shortDescription: "Lead phrase shown when payment will clear some blockers but others need manual attention.",
    guideDescription: "",
    routeOrSurface: "job_detail", tenantOverrideKey: "blocker_prediction_payment_with_remaining",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["predict", "payment", "remaining", "review"],
  },
  blocker_prediction_payment_with_uncertain: {
    id: "blocker_prediction_payment_with_uncertain", label: "Recording payment is expected to clear most blockers. A few may also clear but warrant a quick review.", category: "operations",
    shortDescription: "Lead phrase when payment will clear obvious blockers but uncertain ones may also clear.",
    guideDescription: "",
    routeOrSurface: "job_detail", tenantOverrideKey: "blocker_prediction_payment_with_uncertain",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["predict", "payment", "uncertain", "review"],
  },
  blocker_prediction_mixed: {
    id: "blocker_prediction_mixed", label: "Recording payment is expected to clear payment-related blockers. Other blockers will need separate review and a few may need a closer look.", category: "operations",
    shortDescription: "Lead phrase for the mixed case: payment-rooted + non-payment + uncertain blockers all present.",
    guideDescription: "",
    routeOrSurface: "job_detail", tenantOverrideKey: "blocker_prediction_mixed",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["predict", "payment", "mixed", "review"],
  },
  blocker_prediction_non_payment_only: {
    id: "blocker_prediction_non_payment_only", label: "These blockers need manual review and aren’t payment-related.", category: "operations",
    shortDescription: "Lead phrase when no blocker is payment-rooted — operators must use the dedicated Billing Issues workflow.",
    guideDescription: "",
    routeOrSurface: "job_detail", tenantOverrideKey: "blocker_prediction_non_payment_only",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["predict", "manual", "review", "non-payment"],
  },
  blocker_prediction_uncertain_only: {
    id: "blocker_prediction_uncertain_only", label: "These blockers may need manual review.", category: "operations",
    shortDescription: "Conservative lead phrase when only uncertain-bucket blockers are present.",
    guideDescription: "",
    routeOrSurface: "job_detail", tenantOverrideKey: "blocker_prediction_uncertain_only",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["predict", "uncertain", "review"],
  },
  blocker_prediction_no_blockers: {
    id: "blocker_prediction_no_blockers", label: "No actionable blockers found for this job.", category: "operations",
    shortDescription: "Empty-state lead phrase when the drawer's classification produces zero blockers.",
    guideDescription: "",
    routeOrSurface: "job_detail", tenantOverrideKey: "blocker_prediction_no_blockers",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["predict", "empty", "no blockers"],
  },
  blocker_prediction_payment_first_no_classified: {
    id: "blocker_prediction_payment_first_no_classified", label: "Recording payment will close the unpaid balance on this invoice.", category: "operations",
    shortDescription: "Lead phrase shown when the linked invoice has an unpaid balance and there are no individually classified blockers — payment is still the recommended action.",
    guideDescription: "",
    routeOrSurface: "job_detail", tenantOverrideKey: "blocker_prediction_payment_first_no_classified",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["predict", "payment", "first", "unpaid", "balance"],
  },
  blocker_prediction_payment_first_with_review: {
    id: "blocker_prediction_payment_first_with_review", label: "Recording payment will close the unpaid balance. Some blockers may still need a closer look afterward.", category: "operations",
    shortDescription: "Lead phrase shown when the linked invoice is unpaid AND there are uncertain or non-payment blockers that may still need attention after payment.",
    guideDescription: "",
    routeOrSurface: "job_detail", tenantOverrideKey: "blocker_prediction_payment_first_with_review",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["predict", "payment", "first", "review", "afterward"],
  },
  blocker_prediction_section_payment_rooted: {
    id: "blocker_prediction_section_payment_rooted", label: "Will clear after payment", category: "operations",
    shortDescription: "Section header inside the drawer for blockers that backend auto-resolution will clear once payment is recorded.",
    guideDescription: "",
    routeOrSurface: "job_detail", tenantOverrideKey: "blocker_prediction_section_payment_rooted",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["section", "payment", "clear", "rooted"],
  },
  blocker_prediction_section_non_payment: {
    id: "blocker_prediction_section_non_payment", label: "Needs separate review", category: "operations",
    shortDescription: "Section header for blockers that require manual handling on the Billing Issues page.",
    guideDescription: "",
    routeOrSurface: "job_detail", tenantOverrideKey: "blocker_prediction_section_non_payment",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["section", "manual", "review"],
  },
  blocker_prediction_section_uncertain: {
    id: "blocker_prediction_section_uncertain", label: "May need review", category: "operations",
    shortDescription: "Section header for blockers the drawer can't confidently classify.",
    guideDescription: "",
    routeOrSurface: "job_detail", tenantOverrideKey: "blocker_prediction_section_uncertain",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["section", "uncertain", "review"],
  },
  blocker_result_all_cleared: {
    id: "blocker_result_all_cleared", label: "All blockers cleared", category: "operations",
    shortDescription: "Post-action result shown when the after-refetch comparison finds zero remaining blockers.",
    guideDescription: "",
    routeOrSurface: "job_detail", tenantOverrideKey: "blocker_result_all_cleared",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["result", "cleared", "success"],
  },
  blocker_result_some_cleared: {
    id: "blocker_result_some_cleared", label: "Some blockers cleared. Others still need attention.", category: "operations",
    shortDescription: "Post-action result shown when payment cleared at least one blocker but at least one remains.",
    guideDescription: "",
    routeOrSurface: "job_detail", tenantOverrideKey: "blocker_result_some_cleared",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["result", "partial", "remaining"],
  },
  blocker_result_none_cleared: {
    id: "blocker_result_none_cleared", label: "No blockers cleared yet — backend is catching up. Refresh in a moment if state still looks stale.", category: "operations",
    shortDescription: "Post-action result shown when the refetch returns the same blocker set, usually because the 60s stale-cleanup cooldown is in effect.",
    guideDescription: "",
    routeOrSurface: "job_detail", tenantOverrideKey: "blocker_result_none_cleared",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["result", "stale", "cooldown", "catching up"],
  },

  // ── Credit-control Phase 3: customer detail Accounting & Credit panel ──
  // ONE guide-eligible entry that documents the new visibility surface,
  // its data sources, and the explicit "enforcement not active yet"
  // disclaimer. Everything else below is non-guide-eligible micro-copy
  // (field labels, payment terms display strings, source labels, etc).
  customer_credit_panel: {
    id: "customer_credit_panel", label: "Accounting & Credit", category: "operations",
    shortDescription: "Per-customer Accounting & Credit visibility panel — open AR, past due, payment terms, credit limit, manual + policy hold state. Booking-flow enforcement is server-authoritative.",
    guideDescription: "The Accounting & Credit panel on the customer detail page shows the full credit posture for a customer in one place: total open AR, total past due, oldest past-due age, the effective payment terms (with source — customer override vs tenant default vs system default), the effective credit limit and available credit, and the hold state (manual + policy + effective). When a hold is active the panel surfaces structured reason cards explaining why. Admin and owner roles see inline controls to edit payment terms, set credit limit, and set or release a manual hold with a required reason. ENFORCEMENT (Phase 4A + 4B): the booking flow respects this state at both layers. The frontend (Phase 4A) gates the booking submit button and surfaces a warn/block banner so operators see the hold immediately. The backend (Phase 4B) is now server-authoritative — booking creation endpoints (POST /bookings/complete and POST /bookings/create-with-booking) call CustomerCreditService directly, evaluate the same warn/block aggregation server-side, and reject the request with a structured 403 (CREDIT_HOLD_BLOCK) if the customer is on a block-mode hold. Bypassing the frontend by hitting the API directly will not work — the backend will reject the booking with the same structured error the banner renders. When 'Allow Office Override' is enabled in the tenant credit policy AND the operator's JWT role is admin or owner, the booking POST can include `creditOverride: { reason }` to override the block. The backend validates eligibility (role from JWT, not payload; policy from DB, not payload), builds the audit note from the JWT user + ISO timestamp + the supplied reason, and writes it to the new job's placement_notes inside the same booking-creation transaction. Audit format: '[Credit Override] {reason} (by {userId} at {timestamp})'. If credit-state evaluation cannot be performed (database unavailable, etc.) the backend fails CLOSED — the booking is rejected with a 503 (CREDIT_STATE_UNAVAILABLE) rather than silently allowed. DISPATCH VISIBILITY (Phase 4D): the dispatch QuickView panel (opened by double-clicking a job card) shows a warning banner when the customer is on credit hold. This is informational only — dispatch operations (assignment, drag-drop, status changes) remain fully functional regardless of credit hold state. The warning shows structured hold reasons (manual hold with reason/who/when, credit limit exceeded with AR vs limit, or past due threshold exceeded with actual vs threshold days) and a link to the full customer profile. The dispatch board itself does not show credit indicators on job cards to avoid N+1 performance issues — the credit state is fetched on demand only when the QuickView opens. Important: 'job blocked' (billing issue or unpaid completed invoice on a specific job) and 'customer credit hold' (aggregate AR/policy state) are distinct concepts. A job can be blocked without the customer being on hold, and vice versa. The Jobs page, and existing scheduled jobs are NOT affected by credit holds — only new booking creation is enforced. The hold state is re-evaluated live from the API on every booking attempt.",
    routeOrSurface: "customer_detail", tenantOverrideKey: "customer_credit_panel",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["accounting", "credit", "ar", "past due", "payment terms", "credit limit", "hold", "billing", "invoice", "customer", "booking", "enforcement", "override", "server-authoritative", "fail-closed"],
  },
  customer_credit_field_total_open_ar: {
    id: "customer_credit_field_total_open_ar", label: "Open AR", category: "operations",
    shortDescription: "Sum of balance_due across all open invoices for this customer.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "customer_credit_field_total_open_ar",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["ar", "receivable", "balance", "open"],
  },
  customer_credit_field_total_past_due: {
    id: "customer_credit_field_total_past_due", label: "Past Due", category: "operations",
    shortDescription: "Sum of balance_due on invoices where due_date is before today.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "customer_credit_field_total_past_due",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["past due", "overdue", "ar"],
  },
  customer_credit_field_oldest_past_due: {
    id: "customer_credit_field_oldest_past_due", label: "Oldest Past Due", category: "operations",
    shortDescription: "Days since the oldest past-due invoice's due_date.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "customer_credit_field_oldest_past_due",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["oldest", "past due", "days"],
  },
  customer_credit_field_payment_terms: {
    id: "customer_credit_field_payment_terms", label: "Payment Terms", category: "operations",
    shortDescription: "Effective payment terms after applying customer override → tenant default → system default precedence.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "customer_credit_field_payment_terms",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["payment terms", "net 30", "due on receipt"],
  },
  customer_credit_field_credit_limit: {
    id: "customer_credit_field_credit_limit", label: "Credit Limit", category: "operations",
    shortDescription: "Effective credit ceiling for this customer.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "customer_credit_field_credit_limit",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["credit limit", "ceiling"],
  },
  customer_credit_field_available_credit: {
    id: "customer_credit_field_available_credit", label: "Available Credit", category: "operations",
    shortDescription: "Effective credit limit minus total open AR.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "customer_credit_field_available_credit",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["available credit"],
  },
  customer_credit_field_hold_status: {
    id: "customer_credit_field_hold_status", label: "Hold Status", category: "operations",
    shortDescription: "Effective hold state — manual or policy.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "customer_credit_field_hold_status",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["hold", "credit hold", "status"],
  },
  customer_credit_no_limit_configured: {
    id: "customer_credit_no_limit_configured", label: "No limit configured", category: "operations",
    shortDescription: "Shown when no customer override and no tenant default credit limit are set.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "customer_credit_no_limit_configured",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["no limit"],
  },
  customer_credit_no_past_due: {
    id: "customer_credit_no_past_due", label: "None", category: "operations",
    shortDescription: "Shown for the oldest-past-due field when zero invoices are past due.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "customer_credit_no_past_due",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["none", "no past due"],
  },
  customer_credit_hold_active: {
    id: "customer_credit_hold_active", label: "On Hold", category: "operations",
    shortDescription: "Effective hold is active.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "customer_credit_hold_active",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["on hold", "active"],
  },
  customer_credit_hold_inactive: {
    id: "customer_credit_hold_inactive", label: "No Hold", category: "operations",
    shortDescription: "Effective hold is inactive.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "customer_credit_hold_inactive",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["no hold", "inactive"],
  },
  customer_credit_hold_reason_manual: {
    id: "customer_credit_hold_reason_manual", label: "Manual Hold", category: "operations",
    shortDescription: "Hold was set explicitly by an operator.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "customer_credit_hold_reason_manual",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["manual hold", "operator"],
  },
  customer_credit_hold_reason_credit_limit_exceeded: {
    id: "customer_credit_hold_reason_credit_limit_exceeded", label: "Credit Limit Exceeded", category: "operations",
    shortDescription: "Total open AR exceeds the effective credit limit.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "customer_credit_hold_reason_credit_limit_exceeded",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["credit limit exceeded"],
  },
  customer_credit_hold_reason_overdue_threshold: {
    id: "customer_credit_hold_reason_overdue_threshold", label: "Past Due Threshold Reached", category: "operations",
    shortDescription: "Oldest past-due invoice age meets or exceeds the configured threshold.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "customer_credit_hold_reason_overdue_threshold",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["overdue threshold"],
  },
  payment_terms_due_on_receipt: {
    id: "payment_terms_due_on_receipt", label: "Due on Receipt", category: "operations",
    shortDescription: "Payment is due immediately upon invoice issuance.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "payment_terms_due_on_receipt",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["payment terms", "due on receipt"],
  },
  payment_terms_cod: {
    id: "payment_terms_cod", label: "COD", category: "operations",
    shortDescription: "Cash on delivery — payment collected at the time of service.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "payment_terms_cod",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["cod", "cash on delivery"],
  },
  payment_terms_net_7: {
    id: "payment_terms_net_7", label: "Net 7", category: "operations",
    shortDescription: "Payment due 7 days after invoice issuance.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "payment_terms_net_7",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["net 7"],
  },
  payment_terms_net_15: {
    id: "payment_terms_net_15", label: "Net 15", category: "operations",
    shortDescription: "Payment due 15 days after invoice issuance.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "payment_terms_net_15",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["net 15"],
  },
  payment_terms_net_30: {
    id: "payment_terms_net_30", label: "Net 30", category: "operations",
    shortDescription: "Payment due 30 days after invoice issuance.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "payment_terms_net_30",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["net 30"],
  },
  payment_terms_net_60: {
    id: "payment_terms_net_60", label: "Net 60", category: "operations",
    shortDescription: "Payment due 60 days after invoice issuance.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "payment_terms_net_60",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["net 60"],
  },
  payment_terms_custom: {
    id: "payment_terms_custom", label: "Custom", category: "operations",
    shortDescription: "Custom payment terms — operator-defined per invoice.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "payment_terms_custom",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["custom"],
  },
  credit_source_customer_override: {
    id: "credit_source_customer_override", label: "Customer override", category: "operations",
    shortDescription: "The effective value comes from a customer-specific override.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "credit_source_customer_override",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["customer override"],
  },
  credit_source_tenant_default: {
    id: "credit_source_tenant_default", label: "Tenant default", category: "operations",
    shortDescription: "The effective value comes from the tenant credit policy.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "credit_source_tenant_default",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["tenant default"],
  },
  credit_source_app_default: {
    id: "credit_source_app_default", label: "System default", category: "operations",
    shortDescription: "The effective value comes from the application-level fallback.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "credit_source_app_default",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["system default"],
  },
  credit_source_none: {
    id: "credit_source_none", label: "Not configured", category: "operations",
    shortDescription: "No value is configured at any level.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "credit_source_none",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["not configured"],
  },
  customer_credit_action_edit_settings: {
    id: "customer_credit_action_edit_settings", label: "Edit credit settings", category: "operations",
    shortDescription: "Open the inline editor for payment terms and credit limit. Admin/owner only.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "customer_credit_action_edit_settings",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["edit", "credit settings"],
  },
  customer_credit_action_set_hold: {
    id: "customer_credit_action_set_hold", label: "Set credit hold", category: "operations",
    shortDescription: "Set the manual credit hold flag with a required reason. Admin/owner only.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "customer_credit_action_set_hold",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["set hold"],
  },
  customer_credit_action_release_hold: {
    id: "customer_credit_action_release_hold", label: "Release credit hold", category: "operations",
    shortDescription: "Release the manual credit hold. Admin/owner only.",
    guideDescription: "",
    routeOrSurface: "customer_detail", tenantOverrideKey: "customer_credit_action_release_hold",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["release hold"],
  },

  // ── Credit-control Phase 3: tenant settings credit policy section ──
  tenant_credit_policy_section: {
    id: "tenant_credit_policy_section", label: "Credit Policy", category: "settings",
    shortDescription: "Tenant-wide credit policy configuration — default payment terms, default credit limit, and policy-hold rules.",
    guideDescription: "The Credit Policy section on the Settings page configures the tenant-wide defaults that apply to every customer who does not have their own override. This includes default payment terms, default credit limit, and a set of policy-hold rules (overdue threshold, credit-limit enforcement, unpaid exceptions). Admin and owner roles can edit these settings. IMPORTANT: enforcement is not yet active. Configuring a rule here stores the configuration but the dispatch board, booking flow, and blocked-job drawer do not yet read from it. Future phases will wire enforcement on top of these settings.",
    routeOrSurface: "settings", tenantOverrideKey: "tenant_credit_policy_section",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["credit policy", "settings", "default", "payment terms", "credit limit", "hold", "tenant", "configuration"],
  },
  tenant_credit_policy_field_default_payment_terms: {
    id: "tenant_credit_policy_field_default_payment_terms", label: "Default Payment Terms", category: "settings",
    shortDescription: "Payment terms applied to customers with no own override.",
    guideDescription: "",
    routeOrSurface: "settings", tenantOverrideKey: "tenant_credit_policy_field_default_payment_terms",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["default payment terms"],
  },
  tenant_credit_policy_field_default_credit_limit: {
    id: "tenant_credit_policy_field_default_credit_limit", label: "Default Credit Limit", category: "settings",
    shortDescription: "Credit limit applied to customers with no own override.",
    guideDescription: "",
    routeOrSurface: "settings", tenantOverrideKey: "tenant_credit_policy_field_default_credit_limit",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["default credit limit"],
  },
  tenant_credit_policy_field_overdue_block: {
    id: "tenant_credit_policy_field_overdue_block", label: "Past Due Threshold Block", category: "settings",
    shortDescription: "Block when an invoice is overdue beyond N days.",
    guideDescription: "",
    routeOrSurface: "settings", tenantOverrideKey: "tenant_credit_policy_field_overdue_block",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["overdue block", "past due block"],
  },
  tenant_credit_policy_field_ar_threshold_block: {
    id: "tenant_credit_policy_field_ar_threshold_block", label: "Credit Limit Block", category: "settings",
    shortDescription: "Block when total open AR exceeds the customer's credit limit.",
    guideDescription: "",
    routeOrSurface: "settings", tenantOverrideKey: "tenant_credit_policy_field_ar_threshold_block",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["credit limit block", "ar threshold"],
  },
  tenant_credit_policy_field_unpaid_exceptions: {
    id: "tenant_credit_policy_field_unpaid_exceptions", label: "Unpaid Exceptions Block", category: "settings",
    shortDescription: "Block when there are unpaid exception charges (overage, weight, surcharge, etc.) on the customer's account. Reserved — not yet computed by the backend.",
    guideDescription: "",
    routeOrSurface: "settings", tenantOverrideKey: "tenant_credit_policy_field_unpaid_exceptions",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["unpaid exceptions", "exception charges"],
  },
  tenant_credit_policy_field_allow_office_override: {
    id: "tenant_credit_policy_field_allow_office_override", label: "Allow Office Override", category: "settings",
    shortDescription: "When enabled, operators with sufficient role can override an automatic block on a per-action basis.",
    guideDescription: "",
    routeOrSurface: "settings", tenantOverrideKey: "tenant_credit_policy_field_allow_office_override",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["office override"],
  },
  tenant_credit_policy_mode_warn: {
    id: "tenant_credit_policy_mode_warn", label: "Warn", category: "settings",
    shortDescription: "Surface a notification but do not block the action.",
    guideDescription: "",
    routeOrSurface: "settings", tenantOverrideKey: "tenant_credit_policy_mode_warn",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["warn"],
  },
  tenant_credit_policy_mode_block: {
    id: "tenant_credit_policy_mode_block", label: "Block", category: "settings",
    shortDescription: "Prevent the action entirely (with operator override capability if allow_office_override is enabled).",
    guideDescription: "",
    routeOrSurface: "settings", tenantOverrideKey: "tenant_credit_policy_mode_block",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["block"],
  },
  tenant_credit_policy_visibility_only_notice: {
    id: "tenant_credit_policy_visibility_only_notice", label: "Booking flows enforce this policy. Dispatch shows warnings but is not blocked.", category: "settings",
    shortDescription: "Disclaimer shown on the credit policy section. Booking-flow enforcement is active as of Phase 4. Dispatch shows informational credit hold warnings in QuickView as of Phase 4D but does not block operations.",
    guideDescription: "",
    routeOrSurface: "settings", tenantOverrideKey: "tenant_credit_policy_visibility_only_notice",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["enforcement", "booking", "dispatch"],
  },

  // ── Credit-control Phase 4: booking-flow enforcement banner labels ──
  // All non-guide-eligible — these are micro-copy for the banner that
  // appears in the BookingWizard and customer-first booking form. The
  // workflow concept is documented under `customer_credit_panel`.
  booking_credit_block_header: {
    id: "booking_credit_block_header", label: "Customer on hold", category: "operations",
    shortDescription: "Header shown on the booking enforcement banner when the customer is on credit hold and booking is blocked.",
    guideDescription: "",
    routeOrSurface: "booking", tenantOverrideKey: "booking_credit_block_header",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["customer on hold", "block", "booking"],
  },
  booking_credit_block_body: {
    id: "booking_credit_block_body", label: "Booking is blocked while this customer is on credit hold.", category: "operations",
    shortDescription: "Body shown on the booking enforcement banner in block state.",
    guideDescription: "",
    routeOrSurface: "booking", tenantOverrideKey: "booking_credit_block_body",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["block", "credit hold"],
  },
  booking_credit_warn_header: {
    id: "booking_credit_warn_header", label: "Customer credit warning", category: "operations",
    shortDescription: "Header shown on the booking enforcement banner when the customer has a warn-only policy hold.",
    guideDescription: "",
    routeOrSurface: "booking", tenantOverrideKey: "booking_credit_warn_header",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["warning", "credit"],
  },
  booking_credit_warn_body: {
    id: "booking_credit_warn_body", label: "This customer has an active credit warning. You may proceed.", category: "operations",
    shortDescription: "Body shown on the booking enforcement banner in warn state.",
    guideDescription: "",
    routeOrSurface: "booking", tenantOverrideKey: "booking_credit_warn_body",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["warning", "proceed"],
  },
  booking_credit_override_cta: {
    id: "booking_credit_override_cta", label: "Override & Continue", category: "operations",
    shortDescription: "Button label for the operator override on a blocked booking. Visible only when allow_office_override is enabled and user role is admin/owner.",
    guideDescription: "",
    routeOrSurface: "booking", tenantOverrideKey: "booking_credit_override_cta",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["override", "continue"],
  },
  booking_credit_override_confirm: {
    id: "booking_credit_override_confirm", label: "Confirm override", category: "operations",
    shortDescription: "Confirm button label inside the inline override reason form.",
    guideDescription: "",
    routeOrSurface: "booking", tenantOverrideKey: "booking_credit_override_confirm",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["confirm override"],
  },
  booking_credit_override_cancel: {
    id: "booking_credit_override_cancel", label: "Cancel override", category: "operations",
    shortDescription: "Cancel button / link label inside the inline override reason form.",
    guideDescription: "",
    routeOrSurface: "booking", tenantOverrideKey: "booking_credit_override_cancel",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["cancel override"],
  },
  booking_credit_override_reason_label: {
    id: "booking_credit_override_reason_label", label: "Override reason (required)", category: "operations",
    shortDescription: "Label above the override reason textarea.",
    guideDescription: "",
    routeOrSurface: "booking", tenantOverrideKey: "booking_credit_override_reason_label",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["override reason"],
  },
  booking_credit_override_reason_placeholder: {
    id: "booking_credit_override_reason_placeholder", label: "Why are you overriding this credit hold? Recorded as part of the audit trail.", category: "operations",
    shortDescription: "Placeholder text inside the override reason textarea.",
    guideDescription: "",
    routeOrSurface: "booking", tenantOverrideKey: "booking_credit_override_reason_placeholder",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["override placeholder"],
  },
  booking_credit_override_reason_required: {
    id: "booking_credit_override_reason_required", label: "A reason is required to override.", category: "operations",
    shortDescription: "Inline error shown when the operator tries to confirm an override without entering a reason.",
    guideDescription: "",
    routeOrSurface: "booking", tenantOverrideKey: "booking_credit_override_reason_required",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["reason required"],
  },
  booking_credit_override_applied: {
    id: "booking_credit_override_applied", label: "Credit hold override applied", category: "operations",
    shortDescription: "Header shown on the green confirmation card after an override is applied.",
    guideDescription: "",
    routeOrSurface: "booking", tenantOverrideKey: "booking_credit_override_applied",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["override applied"],
  },
  booking_credit_override_reason_prefix: {
    id: "booking_credit_override_reason_prefix", label: "Reason", category: "operations",
    shortDescription: "Prefix label preceding the displayed override reason.",
    guideDescription: "",
    routeOrSurface: "booking", tenantOverrideKey: "booking_credit_override_reason_prefix",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["reason prefix"],
  },
  booking_credit_override_audit_notice: {
    id: "booking_credit_override_audit_notice", label: "This override will be recorded on the new job's notes for audit.", category: "operations",
    shortDescription: "Footer text on the override-applied card explaining the audit behavior.",
    guideDescription: "",
    routeOrSurface: "booking", tenantOverrideKey: "booking_credit_override_audit_notice",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["audit", "recorded", "notes"],
  },
  booking_credit_override_not_permitted: {
    id: "booking_credit_override_not_permitted", label: "This block cannot be overridden from your account. Contact an administrator.", category: "operations",
    shortDescription: "Footer shown on a blocked booking when the operator does not have override permission.",
    guideDescription: "",
    routeOrSurface: "booking", tenantOverrideKey: "booking_credit_override_not_permitted",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["override not permitted", "administrator"],
  },

  // ── Credit-control Phase 4D: dispatch QuickView credit hold warnings ──
  // Warning-only — dispatch remains fully operational. No blocking.
  dispatch_credit_hold_header: {
    id: "dispatch_credit_hold_header", label: "Customer Credit Hold", category: "operations",
    shortDescription: "Header shown in the dispatch QuickView when the customer has an active credit hold.",
    guideDescription: "",
    routeOrSurface: "dispatch", tenantOverrideKey: "dispatch_credit_hold_header",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["dispatch", "credit hold", "warning"],
  },
  dispatch_credit_hold_disclaimer: {
    id: "dispatch_credit_hold_disclaimer", label: "Informational only — dispatch is not blocked", category: "operations",
    shortDescription: "Disclaimer shown below the credit hold header in dispatch QuickView. Clarifies that the warning does not restrict dispatch actions.",
    guideDescription: "",
    routeOrSurface: "dispatch", tenantOverrideKey: "dispatch_credit_hold_disclaimer",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["dispatch", "informational", "not blocked"],
  },
  dispatch_credit_hold_manual: {
    id: "dispatch_credit_hold_manual", label: "Manual hold", category: "operations",
    shortDescription: "Label for a manual credit hold reason in dispatch QuickView.",
    guideDescription: "",
    routeOrSurface: "dispatch", tenantOverrideKey: "dispatch_credit_hold_manual",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["manual hold", "dispatch"],
  },
  dispatch_credit_hold_credit_limit: {
    id: "dispatch_credit_hold_credit_limit", label: "Credit limit exceeded", category: "operations",
    shortDescription: "Label for a credit-limit-exceeded hold reason in dispatch QuickView.",
    guideDescription: "",
    routeOrSurface: "dispatch", tenantOverrideKey: "dispatch_credit_hold_credit_limit",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["credit limit", "exceeded", "dispatch"],
  },
  dispatch_credit_hold_overdue: {
    id: "dispatch_credit_hold_overdue", label: "Past due threshold exceeded", category: "operations",
    shortDescription: "Label for an overdue-threshold-exceeded hold reason in dispatch QuickView.",
    guideDescription: "",
    routeOrSurface: "dispatch", tenantOverrideKey: "dispatch_credit_hold_overdue",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["past due", "overdue", "threshold", "dispatch"],
  },
  dispatch_credit_hold_view_account: {
    id: "dispatch_credit_hold_view_account", label: "View Account", category: "operations",
    shortDescription: "Link label in dispatch QuickView credit hold section that navigates to the customer's full profile.",
    guideDescription: "",
    routeOrSurface: "dispatch", tenantOverrideKey: "dispatch_credit_hold_view_account",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["view account", "customer", "dispatch"],
  },

  // ── Phase 5: dispatch enforcement ──
  dispatch_enforcement_section: {
    id: "dispatch_enforcement_section", label: "Dispatch Enforcement", category: "settings",
    shortDescription: "Tenant-configurable dispatch restrictions when customers are on credit hold. OFF by default.",
    guideDescription: "Dispatch enforcement allows you to optionally restrict specific dispatch actions (assigning a driver, marking en route, arrived, or completed) when the customer is on credit hold. This is OFF by default — no dispatch blocking occurs until you enable it. When enabled, you choose which actions to block and whether dispatchers can override the block with a reason. Booking enforcement (always active) and dispatch enforcement (configurable) are separate — enabling one does not affect the other. The blocked-job concept (billing issue or unpaid invoice on a specific job) is distinct from customer credit hold (aggregate AR/policy state).",
    routeOrSurface: "settings", tenantOverrideKey: "dispatch_enforcement_section",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["dispatch", "enforcement", "block", "assignment", "status", "credit hold"],
  },
  dispatch_enforcement_enabled: {
    id: "dispatch_enforcement_enabled", label: "Enable dispatch enforcement", category: "settings",
    shortDescription: "Master toggle — must be ON for any dispatch blocking to occur.",
    guideDescription: "",
    routeOrSurface: "settings", tenantOverrideKey: "dispatch_enforcement_enabled",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["enable", "dispatch enforcement"],
  },
  dispatch_enforcement_block_on_hold: {
    id: "dispatch_enforcement_block_on_hold", label: "Block dispatch actions when customer is on hold", category: "settings",
    shortDescription: "When ON, selected dispatch actions are prevented for customers with an active credit hold.",
    guideDescription: "",
    routeOrSurface: "settings", tenantOverrideKey: "dispatch_enforcement_block_on_hold",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["block", "on hold", "dispatch"],
  },
  dispatch_enforcement_action_assignment: {
    id: "dispatch_enforcement_action_assignment", label: "Block driver assignment", category: "settings",
    shortDescription: "Prevent assigning a driver to a job when the customer is on hold.",
    guideDescription: "",
    routeOrSurface: "settings", tenantOverrideKey: "dispatch_enforcement_action_assignment",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["assignment", "driver", "block"],
  },
  dispatch_enforcement_action_en_route: {
    id: "dispatch_enforcement_action_en_route", label: "Block en route", category: "settings",
    shortDescription: "Prevent marking a job as en route when the customer is on hold.",
    guideDescription: "",
    routeOrSurface: "settings", tenantOverrideKey: "dispatch_enforcement_action_en_route",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["en route", "block"],
  },
  dispatch_enforcement_action_arrived: {
    id: "dispatch_enforcement_action_arrived", label: "Block arrived", category: "settings",
    shortDescription: "Prevent marking a job as arrived when the customer is on hold.",
    guideDescription: "",
    routeOrSurface: "settings", tenantOverrideKey: "dispatch_enforcement_action_arrived",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["arrived", "block"],
  },
  dispatch_enforcement_action_completed: {
    id: "dispatch_enforcement_action_completed", label: "Block completed", category: "settings",
    shortDescription: "Prevent marking a job as completed when the customer is on hold.",
    guideDescription: "",
    routeOrSurface: "settings", tenantOverrideKey: "dispatch_enforcement_action_completed",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["completed", "block"],
  },
  dispatch_enforcement_allow_override: {
    id: "dispatch_enforcement_allow_override", label: "Allow dispatch override", category: "settings",
    shortDescription: "When ON, eligible roles can override dispatch blocks with a reason.",
    guideDescription: "",
    routeOrSurface: "settings", tenantOverrideKey: "dispatch_enforcement_allow_override",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["override", "dispatch"],
  },
  dispatch_enforcement_require_reason: {
    id: "dispatch_enforcement_require_reason", label: "Require override reason", category: "settings",
    shortDescription: "When ON, a non-empty reason is required to override a dispatch block.",
    guideDescription: "",
    routeOrSurface: "settings", tenantOverrideKey: "dispatch_enforcement_require_reason",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["require reason", "override"],
  },
  dispatch_credit_block_message: {
    id: "dispatch_credit_block_message", label: "Action blocked — customer is on credit hold", category: "operations",
    shortDescription: "Message shown when a dispatch action is blocked due to credit hold.",
    guideDescription: "",
    routeOrSurface: "dispatch", tenantOverrideKey: "dispatch_credit_block_message",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["blocked", "credit hold", "dispatch"],
  },
  dispatch_credit_override_cta: {
    id: "dispatch_credit_override_cta", label: "Override & Continue", category: "operations",
    shortDescription: "Button label for overriding a dispatch credit block.",
    guideDescription: "",
    routeOrSurface: "dispatch", tenantOverrideKey: "dispatch_credit_override_cta",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["override", "continue", "dispatch"],
  },

  // ── Phase 6: billing issues — customer credit context ──
  billing_issue_credit_context_header: {
    id: "billing_issue_credit_context_header", label: "Customer Credit Context", category: "billing",
    shortDescription: "Section header in the billing issue resolution panel showing the customer's overall credit posture.",
    guideDescription: "The Customer Credit Context section in the billing issue resolution panel shows whether this job's billing issue is part of a broader customer credit problem. It displays the customer's hold status, total open AR, past-due AR, and hold reasons if any. This is informational only — resolving a billing issue does not change a credit hold, and a credit hold does not create or resolve billing issues. They are separate concepts: a billing issue is about a specific job's invoice state, while a credit hold is about the customer's aggregate financial posture.",
    routeOrSurface: "billing_issues", tenantOverrideKey: "billing_issue_credit_context_header",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["credit context", "billing issue", "customer", "hold", "ar"],
  },
  billing_issue_credit_context_disclaimer: {
    id: "billing_issue_credit_context_disclaimer", label: "Customer-level context — separate from this job issue", category: "billing",
    shortDescription: "Disclaimer clarifying that credit context is informational and separate from the billing issue itself.",
    guideDescription: "",
    routeOrSurface: "billing_issues", tenantOverrideKey: "billing_issue_credit_context_disclaimer",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["disclaimer", "separate", "context"],
  },
  billing_issue_credit_on_hold: {
    id: "billing_issue_credit_on_hold", label: "On Hold", category: "billing",
    shortDescription: "Badge shown when the customer has an active credit hold.",
    guideDescription: "",
    routeOrSurface: "billing_issues", tenantOverrideKey: "billing_issue_credit_on_hold",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["on hold", "credit"],
  },
  billing_issue_credit_no_hold: {
    id: "billing_issue_credit_no_hold", label: "No Hold", category: "billing",
    shortDescription: "Badge shown when the customer has no active credit hold.",
    guideDescription: "",
    routeOrSurface: "billing_issues", tenantOverrideKey: "billing_issue_credit_no_hold",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["no hold", "clear"],
  },
  billing_issue_credit_view_profile: {
    id: "billing_issue_credit_view_profile", label: "Full Credit Details", category: "billing",
    shortDescription: "Link to the customer profile for full credit information.",
    guideDescription: "",
    routeOrSurface: "billing_issues", tenantOverrideKey: "billing_issue_credit_view_profile",
    isUserFacing: true, isGuideEligible: false,
    keywords: ["view profile", "credit details"],
  },

  // ── Phase 7: credit control audit dashboard ──
  credit_audit_dashboard: {
    id: "credit_audit_dashboard", label: "Credit Control Audit", category: "admin",
    shortDescription: "Centralized log of all credit-control actions — holds, overrides, policy changes, and credit settings updates.",
    guideDescription: "The Credit Control Audit dashboard provides a centralized, chronological record of every sensitive credit-control action taken by operators. Events tracked: manual hold set/released, booking overrides, dispatch overrides, tenant credit policy updates, and customer credit settings changes. Each event captures who performed the action, when, the customer or job involved, the reason (if applicable), and structured metadata. Viewable by admin and owner roles only. Use this to answer questions like: Who overrode a booking block? When was a customer placed on hold? Who changed the credit policy?",
    routeOrSurface: "credit_audit", tenantOverrideKey: "credit_audit_dashboard",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["audit", "credit", "hold", "override", "policy", "governance"],
  },
  credit_audit_event_hold_set: {
    id: "credit_audit_event_hold_set", label: "Hold Set", category: "admin",
    shortDescription: "A manual credit hold was placed on a customer.",
    guideDescription: "", routeOrSurface: "credit_audit", tenantOverrideKey: "credit_audit_event_hold_set",
    isUserFacing: true, isGuideEligible: false, keywords: ["hold set"],
  },
  credit_audit_event_hold_released: {
    id: "credit_audit_event_hold_released", label: "Hold Released", category: "admin",
    shortDescription: "A manual credit hold was released from a customer.",
    guideDescription: "", routeOrSurface: "credit_audit", tenantOverrideKey: "credit_audit_event_hold_released",
    isUserFacing: true, isGuideEligible: false, keywords: ["hold released"],
  },
  credit_audit_event_booking_override: {
    id: "credit_audit_event_booking_override", label: "Booking Override", category: "admin",
    shortDescription: "A booking was allowed despite a credit hold via operator override.",
    guideDescription: "", routeOrSurface: "credit_audit", tenantOverrideKey: "credit_audit_event_booking_override",
    isUserFacing: true, isGuideEligible: false, keywords: ["booking", "override"],
  },
  credit_audit_event_dispatch_override: {
    id: "credit_audit_event_dispatch_override", label: "Dispatch Override", category: "admin",
    shortDescription: "A dispatch action was allowed despite a credit hold via operator override.",
    guideDescription: "", routeOrSurface: "credit_audit", tenantOverrideKey: "credit_audit_event_dispatch_override",
    isUserFacing: true, isGuideEligible: false, keywords: ["dispatch", "override"],
  },
  credit_audit_event_policy_updated: {
    id: "credit_audit_event_policy_updated", label: "Policy Updated", category: "admin",
    shortDescription: "The tenant credit policy was modified.",
    guideDescription: "", routeOrSurface: "credit_audit", tenantOverrideKey: "credit_audit_event_policy_updated",
    isUserFacing: true, isGuideEligible: false, keywords: ["policy", "updated"],
  },
  credit_audit_event_settings_updated: {
    id: "credit_audit_event_settings_updated", label: "Settings Updated", category: "admin",
    shortDescription: "Customer-level credit settings (payment terms or credit limit) were changed.",
    guideDescription: "", routeOrSurface: "credit_audit", tenantOverrideKey: "credit_audit_event_settings_updated",
    isUserFacing: true, isGuideEligible: false, keywords: ["settings", "credit limit", "payment terms"],
  },
  credit_audit_col_timestamp: {
    id: "credit_audit_col_timestamp", label: "Timestamp", category: "admin",
    shortDescription: "Column header for event timestamp.", guideDescription: "",
    routeOrSurface: "credit_audit", tenantOverrideKey: "credit_audit_col_timestamp",
    isUserFacing: true, isGuideEligible: false, keywords: ["timestamp"],
  },
  credit_audit_col_event: {
    id: "credit_audit_col_event", label: "Event", category: "admin",
    shortDescription: "Column header for event type.", guideDescription: "",
    routeOrSurface: "credit_audit", tenantOverrideKey: "credit_audit_col_event",
    isUserFacing: true, isGuideEligible: false, keywords: ["event"],
  },
  credit_audit_col_summary: {
    id: "credit_audit_col_summary", label: "Summary", category: "admin",
    shortDescription: "Column header for event summary.", guideDescription: "",
    routeOrSurface: "credit_audit", tenantOverrideKey: "credit_audit_col_summary",
    isUserFacing: true, isGuideEligible: false, keywords: ["summary"],
  },
  credit_audit_filter_customer: {
    id: "credit_audit_filter_customer", label: "Customer ID...", category: "admin",
    shortDescription: "Placeholder for the customer ID filter input.", guideDescription: "",
    routeOrSurface: "credit_audit", tenantOverrideKey: "credit_audit_filter_customer",
    isUserFacing: true, isGuideEligible: false, keywords: ["filter", "customer"],
  },

  // ── Phase 8: credit control analytics dashboard ──
  credit_analytics_dashboard: {
    id: "credit_analytics_dashboard", label: "Credit Control Analytics", category: "analytics",
    shortDescription: "Operational insights from credit-control activity — holds, overrides, policy changes, and trends.",
    guideDescription: "The Credit Control Analytics dashboard provides at-a-glance operational metrics for the credit-control system. Summary cards show current active holds, manual holds, and 30-day counts of booking overrides, dispatch overrides, and policy changes. A trend chart visualizes daily event volumes over the last 30 days. Top Customers shows which customers trigger the most credit events. Top Overriders shows which operators override credit holds most frequently. Use this to identify systemic payment problems, monitor override frequency, and track the effectiveness of credit policy changes. Viewable by admin and owner roles only.",
    routeOrSurface: "credit_analytics", tenantOverrideKey: "credit_analytics_dashboard",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["analytics", "credit", "holds", "overrides", "trends", "dashboard"],
  },
  credit_analytics_active_holds: {
    id: "credit_analytics_active_holds", label: "Active Holds", category: "analytics",
    shortDescription: "Count of customers currently on manual credit hold.",
    guideDescription: "", routeOrSurface: "credit_analytics", tenantOverrideKey: "credit_analytics_active_holds",
    isUserFacing: true, isGuideEligible: false, keywords: ["active holds"],
  },
  credit_analytics_manual_holds: {
    id: "credit_analytics_manual_holds", label: "Manual Holds", category: "analytics",
    shortDescription: "Subset of active holds that are manually set (vs policy-driven).",
    guideDescription: "", routeOrSurface: "credit_analytics", tenantOverrideKey: "credit_analytics_manual_holds",
    isUserFacing: true, isGuideEligible: false, keywords: ["manual holds"],
  },
  credit_analytics_booking_overrides: {
    id: "credit_analytics_booking_overrides", label: "Booking Overrides", category: "analytics",
    shortDescription: "Number of booking overrides in the last 30 days.",
    guideDescription: "", routeOrSurface: "credit_analytics", tenantOverrideKey: "credit_analytics_booking_overrides",
    isUserFacing: true, isGuideEligible: false, keywords: ["booking overrides"],
  },
  credit_analytics_dispatch_overrides: {
    id: "credit_analytics_dispatch_overrides", label: "Dispatch Overrides", category: "analytics",
    shortDescription: "Number of dispatch overrides in the last 30 days.",
    guideDescription: "", routeOrSurface: "credit_analytics", tenantOverrideKey: "credit_analytics_dispatch_overrides",
    isUserFacing: true, isGuideEligible: false, keywords: ["dispatch overrides"],
  },
  credit_analytics_policy_changes: {
    id: "credit_analytics_policy_changes", label: "Policy Changes", category: "analytics",
    shortDescription: "Number of credit policy updates in the last 30 days.",
    guideDescription: "", routeOrSurface: "credit_analytics", tenantOverrideKey: "credit_analytics_policy_changes",
    isUserFacing: true, isGuideEligible: false, keywords: ["policy changes"],
  },
  credit_analytics_trends_title: {
    id: "credit_analytics_trends_title", label: "Event Trends (Last 30 Days)", category: "analytics",
    shortDescription: "Chart title for the daily credit event trend visualization.",
    guideDescription: "", routeOrSurface: "credit_analytics", tenantOverrideKey: "credit_analytics_trends_title",
    isUserFacing: true, isGuideEligible: false, keywords: ["trends", "chart"],
  },
  credit_analytics_top_customers: {
    id: "credit_analytics_top_customers", label: "Top Customers", category: "analytics",
    shortDescription: "Table showing customers with the most credit-control events.",
    guideDescription: "", routeOrSurface: "credit_analytics", tenantOverrideKey: "credit_analytics_top_customers",
    isUserFacing: true, isGuideEligible: false, keywords: ["top customers"],
  },
  credit_analytics_top_users: {
    id: "credit_analytics_top_users", label: "Top Overriders", category: "analytics",
    shortDescription: "Table showing operators who override credit holds most frequently.",
    guideDescription: "", routeOrSurface: "credit_analytics", tenantOverrideKey: "credit_analytics_top_users",
    isUserFacing: true, isGuideEligible: false, keywords: ["top users", "overriders"],
  },
  credit_analytics_col_customer: {
    id: "credit_analytics_col_customer", label: "Customer", category: "analytics",
    shortDescription: "Column header.", guideDescription: "",
    routeOrSurface: "credit_analytics", tenantOverrideKey: "credit_analytics_col_customer",
    isUserFacing: true, isGuideEligible: false, keywords: ["customer"],
  },
  credit_analytics_col_holds: {
    id: "credit_analytics_col_holds", label: "Holds", category: "analytics",
    shortDescription: "Column header.", guideDescription: "",
    routeOrSurface: "credit_analytics", tenantOverrideKey: "credit_analytics_col_holds",
    isUserFacing: true, isGuideEligible: false, keywords: ["holds"],
  },
  credit_analytics_col_overrides: {
    id: "credit_analytics_col_overrides", label: "Overrides", category: "analytics",
    shortDescription: "Column header.", guideDescription: "",
    routeOrSurface: "credit_analytics", tenantOverrideKey: "credit_analytics_col_overrides",
    isUserFacing: true, isGuideEligible: false, keywords: ["overrides"],
  },
  credit_analytics_col_last: {
    id: "credit_analytics_col_last", label: "Last Event", category: "analytics",
    shortDescription: "Column header.", guideDescription: "",
    routeOrSurface: "credit_analytics", tenantOverrideKey: "credit_analytics_col_last",
    isUserFacing: true, isGuideEligible: false, keywords: ["last event"],
  },
  credit_analytics_col_user: {
    id: "credit_analytics_col_user", label: "User", category: "analytics",
    shortDescription: "Column header.", guideDescription: "",
    routeOrSurface: "credit_analytics", tenantOverrideKey: "credit_analytics_col_user",
    isUserFacing: true, isGuideEligible: false, keywords: ["user"],
  },
  credit_analytics_col_booking: {
    id: "credit_analytics_col_booking", label: "Booking", category: "analytics",
    shortDescription: "Column header.", guideDescription: "",
    routeOrSurface: "credit_analytics", tenantOverrideKey: "credit_analytics_col_booking",
    isUserFacing: true, isGuideEligible: false, keywords: ["booking"],
  },
  credit_analytics_col_dispatch: {
    id: "credit_analytics_col_dispatch", label: "Dispatch", category: "analytics",
    shortDescription: "Column header.", guideDescription: "",
    routeOrSurface: "credit_analytics", tenantOverrideKey: "credit_analytics_col_dispatch",
    isUserFacing: true, isGuideEligible: false, keywords: ["dispatch"],
  },
  credit_analytics_col_total: {
    id: "credit_analytics_col_total", label: "Total", category: "analytics",
    shortDescription: "Column header.", guideDescription: "",
    routeOrSurface: "credit_analytics", tenantOverrideKey: "credit_analytics_col_total",
    isUserFacing: true, isGuideEligible: false, keywords: ["total"],
  },
  credit_analytics_view_audit_log: {
    id: "credit_analytics_view_audit_log", label: "View Full Audit Log", category: "analytics",
    shortDescription: "Link to the Phase 7 credit audit event log.", guideDescription: "",
    routeOrSurface: "credit_analytics", tenantOverrideKey: "credit_analytics_view_audit_log",
    isUserFacing: true, isGuideEligible: false, keywords: ["audit log"],
  },

  // ── Phase 9: credit review / workflow queue ──
  credit_queue_dashboard: {
    id: "credit_queue_dashboard", label: "Credit Review Queue", category: "operations",
    shortDescription: "Customers needing credit-related attention — holds, frequent overrides, and high activity.",
    guideDescription: "The Credit Review Queue surfaces customers who need credit-related follow-up in a single operational worklist. Customers appear if they are on manual credit hold, have had booking or dispatch overrides in the last 30 days, or have 3+ credit events recently. This is a workflow tool — it does not enforce anything or change what's blocked. Use it to identify systemic payment problems, prioritize follow-up calls, and track which customers need attention. Click a row to see full credit state, hold reasons, and recent audit activity. Links to customer profiles and audit logs are provided for deeper investigation.",
    routeOrSurface: "credit_queue", tenantOverrideKey: "credit_queue_dashboard",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["queue", "review", "workflow", "credit", "follow-up", "collections"],
  },
  credit_queue_col_customer: {
    id: "credit_queue_col_customer", label: "Customer", category: "operations",
    shortDescription: "Column header.", guideDescription: "",
    routeOrSurface: "credit_queue", tenantOverrideKey: "credit_queue_col_customer",
    isUserFacing: true, isGuideEligible: false, keywords: ["customer"],
  },
  credit_queue_col_status: {
    id: "credit_queue_col_status", label: "Status", category: "operations",
    shortDescription: "Column header.", guideDescription: "",
    routeOrSurface: "credit_queue", tenantOverrideKey: "credit_queue_col_status",
    isUserFacing: true, isGuideEligible: false, keywords: ["status"],
  },
  credit_queue_col_overrides: {
    id: "credit_queue_col_overrides", label: "Overrides", category: "operations",
    shortDescription: "Column header — override count in last 30 days.", guideDescription: "",
    routeOrSurface: "credit_queue", tenantOverrideKey: "credit_queue_col_overrides",
    isUserFacing: true, isGuideEligible: false, keywords: ["overrides"],
  },
  credit_queue_col_events: {
    id: "credit_queue_col_events", label: "Events", category: "operations",
    shortDescription: "Column header — total credit events in last 30 days.", guideDescription: "",
    routeOrSurface: "credit_queue", tenantOverrideKey: "credit_queue_col_events",
    isUserFacing: true, isGuideEligible: false, keywords: ["events"],
  },
  credit_queue_col_last_activity: {
    id: "credit_queue_col_last_activity", label: "Last Activity", category: "operations",
    shortDescription: "Column header.", guideDescription: "",
    routeOrSurface: "credit_queue", tenantOverrideKey: "credit_queue_col_last_activity",
    isUserFacing: true, isGuideEligible: false, keywords: ["last activity"],
  },
  credit_queue_col_reason: {
    id: "credit_queue_col_reason", label: "Reason", category: "operations",
    shortDescription: "Column header — why this customer is in the queue.", guideDescription: "",
    routeOrSurface: "credit_queue", tenantOverrideKey: "credit_queue_col_reason",
    isUserFacing: true, isGuideEligible: false, keywords: ["reason"],
  },
  credit_queue_status_on_hold: {
    id: "credit_queue_status_on_hold", label: "On Hold", category: "operations",
    shortDescription: "Badge for customers currently on credit hold.", guideDescription: "",
    routeOrSurface: "credit_queue", tenantOverrideKey: "credit_queue_status_on_hold",
    isUserFacing: true, isGuideEligible: false, keywords: ["on hold"],
  },
  credit_queue_status_normal: {
    id: "credit_queue_status_normal", label: "Active", category: "operations",
    shortDescription: "Badge for customers not on hold but needing review.", guideDescription: "",
    routeOrSurface: "credit_queue", tenantOverrideKey: "credit_queue_status_normal",
    isUserFacing: true, isGuideEligible: false, keywords: ["active"],
  },
  credit_queue_empty_title: {
    id: "credit_queue_empty_title", label: "Queue is clear", category: "operations",
    shortDescription: "Title when no customers need review.", guideDescription: "",
    routeOrSurface: "credit_queue", tenantOverrideKey: "credit_queue_empty_title",
    isUserFacing: true, isGuideEligible: false, keywords: ["empty", "clear"],
  },
  credit_queue_empty_desc: {
    id: "credit_queue_empty_desc", label: "No customers currently need credit review.", category: "operations",
    shortDescription: "Description when queue is empty.", guideDescription: "",
    routeOrSurface: "credit_queue", tenantOverrideKey: "credit_queue_empty_desc",
    isUserFacing: true, isGuideEligible: false, keywords: ["empty"],
  },
  credit_queue_view_customer: {
    id: "credit_queue_view_customer", label: "View Customer", category: "operations",
    shortDescription: "Link to the customer profile.", guideDescription: "",
    routeOrSurface: "credit_queue", tenantOverrideKey: "credit_queue_view_customer",
    isUserFacing: true, isGuideEligible: false, keywords: ["view customer"],
  },
  credit_queue_view_audit: {
    id: "credit_queue_view_audit", label: "View Audit Log", category: "operations",
    shortDescription: "Link to filtered audit log for this customer.", guideDescription: "",
    routeOrSurface: "credit_queue", tenantOverrideKey: "credit_queue_view_audit",
    isUserFacing: true, isGuideEligible: false, keywords: ["view audit"],
  },

  // ── Phase 10: team permissions ──
  team_permissions_section: {
    id: "team_permissions_section", label: "Team Permissions", category: "settings",
    shortDescription: "Control which roles can perform credit-control actions.",
    guideDescription: "Team Permissions lets the tenant owner configure which roles (Admin, Dispatcher, Office) can perform specific credit-control actions. Owner always has full access and cannot be restricted. Permissions include: editing credit policy, managing credit holds, overriding booking and dispatch blocks, viewing audit dashboards, analytics, and the review queue. When no configuration exists, defaults match the pre-configured behavior (admins have all credit permissions, dispatchers and office have none). Changes are audited.",
    routeOrSurface: "settings", tenantOverrideKey: "team_permissions_section",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["permissions", "roles", "team", "admin", "dispatcher", "office", "rbac"],
  },
  perm_credit_policy_edit: {
    id: "perm_credit_policy_edit", label: "Edit credit policy", category: "settings",
    shortDescription: "Permission to modify tenant credit policy settings.",
    guideDescription: "", routeOrSurface: "settings", tenantOverrideKey: "perm_credit_policy_edit",
    isUserFacing: true, isGuideEligible: false, keywords: ["credit policy", "edit"],
  },
  perm_credit_hold_manage: {
    id: "perm_credit_hold_manage", label: "Manage credit holds", category: "settings",
    shortDescription: "Permission to set and release manual credit holds on customers.",
    guideDescription: "", routeOrSurface: "settings", tenantOverrideKey: "perm_credit_hold_manage",
    isUserFacing: true, isGuideEligible: false, keywords: ["credit hold", "manage"],
  },
  perm_booking_override: {
    id: "perm_booking_override", label: "Override booking blocks", category: "settings",
    shortDescription: "Permission to override credit-hold blocks during booking.",
    guideDescription: "", routeOrSurface: "settings", tenantOverrideKey: "perm_booking_override",
    isUserFacing: true, isGuideEligible: false, keywords: ["booking", "override"],
  },
  perm_dispatch_override: {
    id: "perm_dispatch_override", label: "Override dispatch blocks", category: "settings",
    shortDescription: "Permission to override credit-hold blocks during dispatch actions.",
    guideDescription: "", routeOrSurface: "settings", tenantOverrideKey: "perm_dispatch_override",
    isUserFacing: true, isGuideEligible: false, keywords: ["dispatch", "override"],
  },
  perm_credit_audit_view: {
    id: "perm_credit_audit_view", label: "View audit dashboard", category: "settings",
    shortDescription: "Permission to view the credit audit event log.",
    guideDescription: "", routeOrSurface: "settings", tenantOverrideKey: "perm_credit_audit_view",
    isUserFacing: true, isGuideEligible: false, keywords: ["audit", "view"],
  },
  perm_credit_analytics_view: {
    id: "perm_credit_analytics_view", label: "View analytics", category: "settings",
    shortDescription: "Permission to view the credit analytics dashboard.",
    guideDescription: "", routeOrSurface: "settings", tenantOverrideKey: "perm_credit_analytics_view",
    isUserFacing: true, isGuideEligible: false, keywords: ["analytics", "view"],
  },
  perm_credit_queue_manage: {
    id: "perm_credit_queue_manage", label: "Access review queue", category: "settings",
    shortDescription: "Permission to access and use the credit review queue.",
    guideDescription: "", routeOrSurface: "settings", tenantOverrideKey: "perm_credit_queue_manage",
    isUserFacing: true, isGuideEligible: false, keywords: ["queue", "review"],
  },
  perm_role_owner: {
    id: "perm_role_owner", label: "Owner", category: "settings",
    shortDescription: "Owner role — always has full access.", guideDescription: "",
    routeOrSurface: "settings", tenantOverrideKey: "perm_role_owner",
    isUserFacing: true, isGuideEligible: false, keywords: ["owner"],
  },
  perm_role_admin: {
    id: "perm_role_admin", label: "Admin", category: "settings",
    shortDescription: "Admin role.", guideDescription: "",
    routeOrSurface: "settings", tenantOverrideKey: "perm_role_admin",
    isUserFacing: true, isGuideEligible: false, keywords: ["admin"],
  },
  perm_role_dispatcher: {
    id: "perm_role_dispatcher", label: "Dispatcher", category: "settings",
    shortDescription: "Dispatcher role.", guideDescription: "",
    routeOrSurface: "settings", tenantOverrideKey: "perm_role_dispatcher",
    isUserFacing: true, isGuideEligible: false, keywords: ["dispatcher"],
  },
  perm_role_office: {
    id: "perm_role_office", label: "Office", category: "settings",
    shortDescription: "Office/staff role.", guideDescription: "",
    routeOrSurface: "settings", tenantOverrideKey: "perm_role_office",
    isUserFacing: true, isGuideEligible: false, keywords: ["office", "staff"],
  },
  perm_col_permission: {
    id: "perm_col_permission", label: "Permission", category: "settings",
    shortDescription: "Column header for permission name.", guideDescription: "",
    routeOrSurface: "settings", tenantOverrideKey: "perm_col_permission",
    isUserFacing: true, isGuideEligible: false, keywords: ["permission"],
  },
  perm_save: {
    id: "perm_save", label: "Save permissions", category: "settings",
    shortDescription: "Save button for permissions config.", guideDescription: "",
    routeOrSurface: "settings", tenantOverrideKey: "perm_save",
    isUserFacing: true, isGuideEligible: false, keywords: ["save"],
  },

  // ── Phase 11: collections workflow actions + timeline ──
  credit_queue_actions_header: {
    id: "credit_queue_actions_header", label: "Actions", category: "operations",
    shortDescription: "Section header for collection workflow action buttons.",
    guideDescription: "Manual workflow actions let operators record what they've done about a customer's credit situation. Send Reminder logs that a payment reminder was sent (no actual message is sent — this is a manual record). Mark Contacted records that the customer was reached. Add Note attaches a free-text note to the customer's collections timeline. Escalate flags the customer for higher-level review. All actions are recorded with the operator's identity and timestamp.",
    routeOrSurface: "credit_queue", tenantOverrideKey: "credit_queue_actions_header",
    isUserFacing: true, isGuideEligible: true,
    keywords: ["actions", "collections", "workflow", "reminder", "contacted", "escalate", "note"],
  },
  credit_queue_action_reminder: {
    id: "credit_queue_action_reminder", label: "Reminder", category: "operations",
    shortDescription: "Log that a payment reminder was sent.", guideDescription: "",
    routeOrSurface: "credit_queue", tenantOverrideKey: "credit_queue_action_reminder",
    isUserFacing: true, isGuideEligible: false, keywords: ["reminder"],
  },
  credit_queue_action_contacted: {
    id: "credit_queue_action_contacted", label: "Contacted", category: "operations",
    shortDescription: "Record that the customer was contacted.", guideDescription: "",
    routeOrSurface: "credit_queue", tenantOverrideKey: "credit_queue_action_contacted",
    isUserFacing: true, isGuideEligible: false, keywords: ["contacted"],
  },
  credit_queue_action_escalate: {
    id: "credit_queue_action_escalate", label: "Escalate", category: "operations",
    shortDescription: "Flag customer for escalated review.", guideDescription: "",
    routeOrSurface: "credit_queue", tenantOverrideKey: "credit_queue_action_escalate",
    isUserFacing: true, isGuideEligible: false, keywords: ["escalate"],
  },
  credit_queue_action_note: {
    id: "credit_queue_action_note", label: "Add Note", category: "operations",
    shortDescription: "Add a free-text collections note.", guideDescription: "",
    routeOrSurface: "credit_queue", tenantOverrideKey: "credit_queue_action_note",
    isUserFacing: true, isGuideEligible: false, keywords: ["note"],
  },
  credit_queue_note_placeholder: {
    id: "credit_queue_note_placeholder", label: "Note text...", category: "operations",
    shortDescription: "Placeholder for note input.", guideDescription: "",
    routeOrSurface: "credit_queue", tenantOverrideKey: "credit_queue_note_placeholder",
    isUserFacing: true, isGuideEligible: false, keywords: ["placeholder"],
  },
  credit_queue_timeline_header: {
    id: "credit_queue_timeline_header", label: "Collections Timeline", category: "operations",
    shortDescription: "Section header for the chronological collections activity log.",
    guideDescription: "",
    routeOrSurface: "credit_queue", tenantOverrideKey: "credit_queue_timeline_header",
    isUserFacing: true, isGuideEligible: false, keywords: ["timeline", "collections"],
  },

  // ── Shared UI micro-labels (pagination, loading, etc.) ──
  ui_loading: { id: "ui_loading", label: "Loading...", category: "operations", shortDescription: "Loading indicator text.", guideDescription: "", routeOrSurface: "global", tenantOverrideKey: "ui_loading", isUserFacing: true, isGuideEligible: false, keywords: ["loading"] },
  ui_refresh: { id: "ui_refresh", label: "Refresh", category: "operations", shortDescription: "Refresh button label.", guideDescription: "", routeOrSurface: "global", tenantOverrideKey: "ui_refresh", isUserFacing: true, isGuideEligible: false, keywords: ["refresh"] },
  ui_prev: { id: "ui_prev", label: "Prev", category: "operations", shortDescription: "Previous page button.", guideDescription: "", routeOrSurface: "global", tenantOverrideKey: "ui_prev", isUserFacing: true, isGuideEligible: false, keywords: ["prev"] },
  ui_next: { id: "ui_next", label: "Next", category: "operations", shortDescription: "Next page button.", guideDescription: "", routeOrSurface: "global", tenantOverrideKey: "ui_next", isUserFacing: true, isGuideEligible: false, keywords: ["next"] },
  credit_audit_empty: { id: "credit_audit_empty", label: "No audit events found", category: "admin", shortDescription: "Empty state for audit dashboard.", guideDescription: "", routeOrSurface: "credit_audit", tenantOverrideKey: "credit_audit_empty", isUserFacing: true, isGuideEligible: false, keywords: ["empty"] },

  // ── Phase 13B: portal account summary ──
  portal_account_summary_title: { id: "portal_account_summary_title", label: "Account Summary", category: "customers", shortDescription: "Title for the customer portal account summary card.", guideDescription: "The Account Summary shows your current balance, any past due amounts, and how many unpaid invoices you have. If your account has a restriction, a banner will appear across the portal explaining what to do.", routeOrSurface: "portal", tenantOverrideKey: "portal_account_summary_title", isUserFacing: true, isGuideEligible: true, keywords: ["account", "summary", "portal", "balance"] },
  portal_account_current_balance: { id: "portal_account_current_balance", label: "Current Balance", category: "customers", shortDescription: "Label for total outstanding balance.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_account_current_balance", isUserFacing: true, isGuideEligible: false, keywords: ["balance"] },
  portal_account_past_due: { id: "portal_account_past_due", label: "Past Due", category: "customers", shortDescription: "Label for past due amount.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_account_past_due", isUserFacing: true, isGuideEligible: false, keywords: ["past due"] },
  portal_account_unpaid_invoices: { id: "portal_account_unpaid_invoices", label: "Unpaid Invoices", category: "customers", shortDescription: "Label for unpaid invoice count.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_account_unpaid_invoices", isUserFacing: true, isGuideEligible: false, keywords: ["unpaid", "invoices"] },
  portal_account_view_invoices: { id: "portal_account_view_invoices", label: "View Invoices", category: "customers", shortDescription: "CTA linking to the invoices page.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_account_view_invoices", isUserFacing: true, isGuideEligible: false, keywords: ["view", "invoices"] },
  portal_account_status_good_standing: { id: "portal_account_status_good_standing", label: "Good Standing", category: "customers", shortDescription: "Badge for accounts with no issues.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_account_status_good_standing", isUserFacing: true, isGuideEligible: false, keywords: ["good standing"] },
  portal_account_status_payment_due: { id: "portal_account_status_payment_due", label: "Payment Due", category: "customers", shortDescription: "Badge for accounts with unpaid invoices.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_account_status_payment_due", isUserFacing: true, isGuideEligible: false, keywords: ["payment due"] },
  portal_account_status_past_due: { id: "portal_account_status_past_due", label: "Past Due", category: "customers", shortDescription: "Badge for accounts with overdue invoices.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_account_status_past_due", isUserFacing: true, isGuideEligible: false, keywords: ["past due"] },
  portal_account_status_service_restricted: { id: "portal_account_status_service_restricted", label: "Service Restricted", category: "customers", shortDescription: "Badge for accounts with a service restriction.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_account_status_service_restricted", isUserFacing: true, isGuideEligible: false, keywords: ["restricted"] },
  portal_pay_now: { id: "portal_pay_now", label: "Pay Now", category: "customers", shortDescription: "CTA to navigate to invoice payment.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_pay_now", isUserFacing: true, isGuideEligible: false, keywords: ["pay now"] },
  portal_pay_invoice: { id: "portal_pay_invoice", label: "Pay Invoice", category: "customers", shortDescription: "Button to initiate payment for a specific invoice.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_pay_invoice", isUserFacing: true, isGuideEligible: false, keywords: ["pay invoice"] },
  portal_payment_processing: { id: "portal_payment_processing", label: "Processing payment...", category: "customers", shortDescription: "Loading state during payment preparation.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_payment_processing", isUserFacing: true, isGuideEligible: false, keywords: ["processing"] },
  portal_payment_success: { id: "portal_payment_success", label: "Payment submitted successfully", category: "customers", shortDescription: "Success message after payment.", guideDescription: "After you submit a payment, it will be processed and applied to your invoice. You will receive a confirmation. If the payment does not appear within a few minutes, please contact us.", routeOrSurface: "portal", tenantOverrideKey: "portal_payment_success", isUserFacing: true, isGuideEligible: true, keywords: ["payment", "success"] },
  portal_payment_failed: { id: "portal_payment_failed", label: "Payment could not be processed", category: "customers", shortDescription: "Failure message when payment fails.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_payment_failed", isUserFacing: true, isGuideEligible: false, keywords: ["payment", "failed"] },
  portal_payment_try_again: { id: "portal_payment_try_again", label: "Please try again or contact us.", category: "customers", shortDescription: "Recovery guidance after payment failure.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_payment_try_again", isUserFacing: true, isGuideEligible: false, keywords: ["try again"] },
  portal_no_invoices: { id: "portal_no_invoices", label: "No invoices yet", category: "customers", shortDescription: "Empty state when customer has no invoices.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_no_invoices", isUserFacing: true, isGuideEligible: false, keywords: ["no invoices"] },
  portal_confirm_payment: { id: "portal_confirm_payment", label: "Confirm Payment", category: "customers", shortDescription: "Payment confirmation modal title.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_confirm_payment", isUserFacing: true, isGuideEligible: false, keywords: ["confirm"] },
  portal_back_to_dashboard: { id: "portal_back_to_dashboard", label: "Back to Dashboard", category: "customers", shortDescription: "CTA returning to portal dashboard.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_back_to_dashboard", isUserFacing: true, isGuideEligible: false, keywords: ["dashboard"] },

  // ── Phase 15: portal real-time pricing ──
  portal_request_title: { id: "portal_request_title", label: "Request a Dumpster", category: "customers", shortDescription: "Page title.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_title", isUserFacing: true, isGuideEligible: false, keywords: ["request"] },
  portal_request_subtitle: { id: "portal_request_subtitle", label: "Choose your size and schedule delivery.", category: "customers", shortDescription: "Page subtitle.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_subtitle", isUserFacing: true, isGuideEligible: false, keywords: ["request"] },
  portal_request_select_size: { id: "portal_request_select_size", label: "Select Size", category: "customers", shortDescription: "Size selector label.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_select_size", isUserFacing: true, isGuideEligible: false, keywords: ["size"] },
  portal_request_address: { id: "portal_request_address", label: "Delivery Address", category: "customers", shortDescription: "Address field label.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_address", isUserFacing: true, isGuideEligible: false, keywords: ["address"] },
  portal_request_date: { id: "portal_request_date", label: "Preferred Delivery Date", category: "customers", shortDescription: "Date field label.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_date", isUserFacing: true, isGuideEligible: false, keywords: ["date"] },
  portal_request_duration: { id: "portal_request_duration", label: "Rental Duration", category: "customers", shortDescription: "Duration selector label.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_duration", isUserFacing: true, isGuideEligible: false, keywords: ["duration"] },
  portal_request_instructions: { id: "portal_request_instructions", label: "Special Instructions", category: "customers", shortDescription: "Instructions field label.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_instructions", isUserFacing: true, isGuideEligible: false, keywords: ["instructions"] },
  portal_request_optional: { id: "portal_request_optional", label: "optional", category: "customers", shortDescription: "Optional field hint.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_optional", isUserFacing: true, isGuideEligible: false, keywords: ["optional"] },
  portal_request_estimated_cost: { id: "portal_request_estimated_cost", label: "Estimated Cost", category: "customers", shortDescription: "Pricing section header.", guideDescription: "Pricing is calculated based on your delivery address, dumpster size, and rental duration. The price shown is an estimate — the final price may vary based on distance and disposal fees.", routeOrSurface: "portal", tenantOverrideKey: "portal_request_estimated_cost", isUserFacing: true, isGuideEligible: true, keywords: ["pricing", "estimate", "cost"] },
  portal_request_enter_address: { id: "portal_request_enter_address", label: "Enter an address to see pricing.", category: "customers", shortDescription: "Shown before address is entered.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_enter_address", isUserFacing: true, isGuideEligible: false, keywords: ["address", "pricing"] },
  portal_request_calculating: { id: "portal_request_calculating", label: "Calculating price...", category: "customers", shortDescription: "Loading state during pricing.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_calculating", isUserFacing: true, isGuideEligible: false, keywords: ["calculating"] },
  portal_request_estimated_total: { id: "portal_request_estimated_total", label: "Estimated Total", category: "customers", shortDescription: "Total price label.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_estimated_total", isUserFacing: true, isGuideEligible: false, keywords: ["total"] },
  portal_request_price_disclaimer: { id: "portal_request_price_disclaimer", label: "Final price may vary based on location and disposal fees.", category: "customers", shortDescription: "Pricing disclaimer.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_price_disclaimer", isUserFacing: true, isGuideEligible: false, keywords: ["disclaimer"] },
  portal_request_price_unavailable: { id: "portal_request_price_unavailable", label: "Unable to calculate price. Please try again or contact us.", category: "customers", shortDescription: "Error state for pricing.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_price_unavailable", isUserFacing: true, isGuideEligible: false, keywords: ["error", "pricing"] },
  portal_request_submitted: { id: "portal_request_submitted", label: "Request Submitted!", category: "customers", shortDescription: "Success heading.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_submitted", isUserFacing: true, isGuideEligible: false, keywords: ["submitted"] },
  portal_request_confirmation: { id: "portal_request_confirmation", label: "Your request has been received. We'll confirm availability and contact you shortly.", category: "customers", shortDescription: "Success message.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_confirmation", isUserFacing: true, isGuideEligible: false, keywords: ["confirmation"] },
  portal_request_another: { id: "portal_request_another", label: "Request Another", category: "customers", shortDescription: "CTA to submit another request.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_another", isUserFacing: true, isGuideEligible: false, keywords: ["another"] },
  portal_request_error: { id: "portal_request_error", label: "Something went wrong. Please try again.", category: "customers", shortDescription: "Generic submission error.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_error", isUserFacing: true, isGuideEligible: false, keywords: ["error"] },
  portal_request_submit: { id: "portal_request_submit", label: "Submit Request", category: "customers", shortDescription: "Submit button.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_submit", isUserFacing: true, isGuideEligible: false, keywords: ["submit"] },
  portal_request_submitting: { id: "portal_request_submitting", label: "Submitting...", category: "customers", shortDescription: "Loading state for submit.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_submitting", isUserFacing: true, isGuideEligible: false, keywords: ["submitting"] },
  portal_request_days_included: { id: "portal_request_days_included", label: "days included", category: "customers", shortDescription: "Suffix for included rental period.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_days_included", isUserFacing: true, isGuideEligible: false, keywords: ["included", "days"] },
  portal_request_pickup_date: { id: "portal_request_pickup_date", label: "Estimated Pickup Date", category: "customers", shortDescription: "Auto-derived pickup date label.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_pickup_date", isUserFacing: true, isGuideEligible: false, keywords: ["pickup"] },
  portal_request_pickup_auto: { id: "portal_request_pickup_auto", label: "Set delivery date to see pickup date", category: "customers", shortDescription: "Placeholder before delivery date is set.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_pickup_auto", isUserFacing: true, isGuideEligible: false, keywords: ["pickup", "auto"] },
  portal_request_no_extra_charge: { id: "portal_request_no_extra_charge", label: "no additional charge for extra days", category: "customers", shortDescription: "Shown when customer type has unlimited rental days.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_no_extra_charge", isUserFacing: true, isGuideEligible: false, keywords: ["no charge", "extra days"] },
  portal_booking_payment_required: { id: "portal_booking_payment_required", label: "Payment Required to Complete Booking", category: "customers", shortDescription: "Heading when payment is needed after booking submission.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_booking_payment_required", isUserFacing: true, isGuideEligible: false, keywords: ["payment required"] },
  portal_booking_payment_message: { id: "portal_booking_payment_message", label: "Your booking will be scheduled after payment is confirmed.", category: "customers", shortDescription: "Message explaining booking is pending payment.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_booking_payment_message", isUserFacing: true, isGuideEligible: false, keywords: ["payment", "scheduled"] },
  portal_booking_amount_due: { id: "portal_booking_amount_due", label: "Amount Due", category: "customers", shortDescription: "Label for payment amount after booking.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_booking_amount_due", isUserFacing: true, isGuideEligible: false, keywords: ["amount due"] },
  portal_booking_pay_later: { id: "portal_booking_pay_later", label: "Pay Later", category: "customers", shortDescription: "Secondary CTA to defer payment.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_booking_pay_later", isUserFacing: true, isGuideEligible: false, keywords: ["pay later"] },
  portal_request_service_restricted: { id: "portal_request_service_restricted", label: "Your account has an outstanding balance that must be resolved before new service can be scheduled. Please make a payment or contact us.", category: "customers", shortDescription: "Shown when booking is blocked by credit enforcement.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_request_service_restricted", isUserFacing: true, isGuideEligible: false, keywords: ["restricted", "blocked", "balance"] },
  credit_analytics_empty_trends: { id: "credit_analytics_empty_trends", label: "No events in the last 30 days", category: "analytics", shortDescription: "Empty state for trends chart.", guideDescription: "", routeOrSurface: "credit_analytics", tenantOverrideKey: "credit_analytics_empty_trends", isUserFacing: true, isGuideEligible: false, keywords: ["empty", "trends"] },
  credit_analytics_empty_customers: { id: "credit_analytics_empty_customers", label: "No customer events recorded", category: "analytics", shortDescription: "Empty state for top customers.", guideDescription: "", routeOrSurface: "credit_analytics", tenantOverrideKey: "credit_analytics_empty_customers", isUserFacing: true, isGuideEligible: false, keywords: ["empty", "customers"] },
  credit_analytics_empty_users: { id: "credit_analytics_empty_users", label: "No overrides recorded", category: "analytics", shortDescription: "Empty state for top users.", guideDescription: "", routeOrSurface: "credit_analytics", tenantOverrideKey: "credit_analytics_empty_users", isUserFacing: true, isGuideEligible: false, keywords: ["empty", "overrides"] },

  // ── Phase 18B: portal activity (tenant-side) ──
  portal_activity_title: { id: "portal_activity_title", label: "Portal Activity", category: "operations", shortDescription: "Tenant-side page showing customer portal requests.", guideDescription: "The Portal Activity page shows all service requests submitted by customers through the self-service portal. Each request shows the customer, dumpster size, delivery date, payment status, and portal origin badge. Use the filters to find requests awaiting payment, paid and ready for dispatch, or from net-term customers. Portal requests go through the same booking path as tenant-side bookings — invoices are created, credit holds are enforced, and payment gating is applied.", routeOrSurface: "portal_activity", tenantOverrideKey: "portal_activity_title", isUserFacing: true, isGuideEligible: true, keywords: ["portal", "activity", "requests"] },
  portal_activity_subtitle: { id: "portal_activity_subtitle", label: "Customer requests from the self-service portal", category: "operations", shortDescription: "Page subtitle.", guideDescription: "", routeOrSurface: "portal_activity", tenantOverrideKey: "portal_activity_subtitle", isUserFacing: true, isGuideEligible: false, keywords: ["portal"] },
  portal_activity_filter_all: { id: "portal_activity_filter_all", label: "All", category: "operations", shortDescription: "Filter: all portal jobs.", guideDescription: "", routeOrSurface: "portal_activity", tenantOverrideKey: "portal_activity_filter_all", isUserFacing: true, isGuideEligible: false, keywords: ["all"] },
  portal_activity_filter_awaiting: { id: "portal_activity_filter_awaiting", label: "Awaiting Payment", category: "operations", shortDescription: "Filter: unpaid portal jobs.", guideDescription: "", routeOrSurface: "portal_activity", tenantOverrideKey: "portal_activity_filter_awaiting", isUserFacing: true, isGuideEligible: false, keywords: ["awaiting"] },
  portal_activity_filter_paid: { id: "portal_activity_filter_paid", label: "Paid / Ready", category: "operations", shortDescription: "Filter: paid portal jobs.", guideDescription: "", routeOrSurface: "portal_activity", tenantOverrideKey: "portal_activity_filter_paid", isUserFacing: true, isGuideEligible: false, keywords: ["paid"] },
  portal_activity_filter_net_terms: { id: "portal_activity_filter_net_terms", label: "Net Terms", category: "operations", shortDescription: "Filter: net-term customer requests.", guideDescription: "", routeOrSurface: "portal_activity", tenantOverrideKey: "portal_activity_filter_net_terms", isUserFacing: true, isGuideEligible: false, keywords: ["net terms"] },
  portal_activity_col_customer: { id: "portal_activity_col_customer", label: "Customer", category: "operations", shortDescription: "Column header.", guideDescription: "", routeOrSurface: "portal_activity", tenantOverrideKey: "portal_activity_col_customer", isUserFacing: true, isGuideEligible: false, keywords: ["customer"] },
  portal_activity_col_size: { id: "portal_activity_col_size", label: "Size", category: "operations", shortDescription: "Column header.", guideDescription: "", routeOrSurface: "portal_activity", tenantOverrideKey: "portal_activity_col_size", isUserFacing: true, isGuideEligible: false, keywords: ["size"] },
  portal_activity_col_date: { id: "portal_activity_col_date", label: "Delivery", category: "operations", shortDescription: "Column header.", guideDescription: "", routeOrSurface: "portal_activity", tenantOverrideKey: "portal_activity_col_date", isUserFacing: true, isGuideEligible: false, keywords: ["delivery"] },
  portal_activity_col_total: { id: "portal_activity_col_total", label: "Total", category: "operations", shortDescription: "Column header.", guideDescription: "", routeOrSurface: "portal_activity", tenantOverrideKey: "portal_activity_col_total", isUserFacing: true, isGuideEligible: false, keywords: ["total"] },
  portal_activity_col_payment: { id: "portal_activity_col_payment", label: "Payment", category: "operations", shortDescription: "Column header.", guideDescription: "", routeOrSurface: "portal_activity", tenantOverrideKey: "portal_activity_col_payment", isUserFacing: true, isGuideEligible: false, keywords: ["payment"] },
  portal_activity_col_origin: { id: "portal_activity_col_origin", label: "Origin", category: "operations", shortDescription: "Column header.", guideDescription: "", routeOrSurface: "portal_activity", tenantOverrideKey: "portal_activity_col_origin", isUserFacing: true, isGuideEligible: false, keywords: ["origin"] },
  portal_activity_origin_badge: { id: "portal_activity_origin_badge", label: "Portal", category: "operations", shortDescription: "Badge for portal-originated jobs.", guideDescription: "", routeOrSurface: "portal_activity", tenantOverrideKey: "portal_activity_origin_badge", isUserFacing: true, isGuideEligible: false, keywords: ["portal", "badge"] },
  portal_activity_net_terms: { id: "portal_activity_net_terms", label: "Net Terms", category: "operations", shortDescription: "Badge for net-term customers.", guideDescription: "", routeOrSurface: "portal_activity", tenantOverrideKey: "portal_activity_net_terms", isUserFacing: true, isGuideEligible: false, keywords: ["net terms"] },
  portal_activity_status_paid: { id: "portal_activity_status_paid", label: "Paid", category: "operations", shortDescription: "Payment status badge.", guideDescription: "", routeOrSurface: "portal_activity", tenantOverrideKey: "portal_activity_status_paid", isUserFacing: true, isGuideEligible: false, keywords: ["paid"] },
  portal_activity_status_awaiting: { id: "portal_activity_status_awaiting", label: "Awaiting Payment", category: "operations", shortDescription: "Payment status badge.", guideDescription: "", routeOrSurface: "portal_activity", tenantOverrideKey: "portal_activity_status_awaiting", isUserFacing: true, isGuideEligible: false, keywords: ["awaiting"] },
  portal_activity_status_no_invoice: { id: "portal_activity_status_no_invoice", label: "Pending", category: "operations", shortDescription: "Payment status badge.", guideDescription: "", routeOrSurface: "portal_activity", tenantOverrideKey: "portal_activity_status_no_invoice", isUserFacing: true, isGuideEligible: false, keywords: ["pending"] },
  portal_activity_metric_today: { id: "portal_activity_metric_today", label: "Today", category: "operations", shortDescription: "Dashboard tile: requests today.", guideDescription: "", routeOrSurface: "portal_activity", tenantOverrideKey: "portal_activity_metric_today", isUserFacing: true, isGuideEligible: false, keywords: ["today"] },
  portal_activity_metric_awaiting: { id: "portal_activity_metric_awaiting", label: "Awaiting Payment", category: "operations", shortDescription: "Dashboard tile: awaiting payment.", guideDescription: "", routeOrSurface: "portal_activity", tenantOverrideKey: "portal_activity_metric_awaiting", isUserFacing: true, isGuideEligible: false, keywords: ["awaiting"] },
  portal_activity_metric_paid: { id: "portal_activity_metric_paid", label: "Paid / Ready", category: "operations", shortDescription: "Dashboard tile: paid and ready.", guideDescription: "", routeOrSurface: "portal_activity", tenantOverrideKey: "portal_activity_metric_paid", isUserFacing: true, isGuideEligible: false, keywords: ["paid"] },
  portal_activity_metric_total: { id: "portal_activity_metric_total", label: "Total Active", category: "operations", shortDescription: "Dashboard tile: total active portal jobs.", guideDescription: "", routeOrSurface: "portal_activity", tenantOverrideKey: "portal_activity_metric_total", isUserFacing: true, isGuideEligible: false, keywords: ["total"] },
  portal_activity_empty: { id: "portal_activity_empty", label: "No portal requests", category: "operations", shortDescription: "Empty state.", guideDescription: "", routeOrSurface: "portal_activity", tenantOverrideKey: "portal_activity_empty", isUserFacing: true, isGuideEligible: false, keywords: ["empty"] },

  // ── Phase 19: portal dashboard customer-safe statuses + service history ──
  portal_status_scheduled: { id: "portal_status_scheduled", label: "Scheduled", category: "customers", shortDescription: "Customer-safe status for pending/confirmed jobs.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_status_scheduled", isUserFacing: true, isGuideEligible: false, keywords: ["scheduled"] },
  portal_status_on_the_way: { id: "portal_status_on_the_way", label: "On the Way", category: "customers", shortDescription: "Customer-safe status for en_route jobs.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_status_on_the_way", isUserFacing: true, isGuideEligible: false, keywords: ["on the way"] },
  portal_status_in_progress: { id: "portal_status_in_progress", label: "In Progress", category: "customers", shortDescription: "Customer-safe status for arrived/in_progress jobs.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_status_in_progress", isUserFacing: true, isGuideEligible: false, keywords: ["in progress"] },
  portal_status_completed: { id: "portal_status_completed", label: "Completed", category: "customers", shortDescription: "Customer-safe status for completed jobs.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_status_completed", isUserFacing: true, isGuideEligible: false, keywords: ["completed"] },
  portal_status_cancelled: { id: "portal_status_cancelled", label: "Cancelled", category: "customers", shortDescription: "Customer-safe status for cancelled jobs.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_status_cancelled", isUserFacing: true, isGuideEligible: false, keywords: ["cancelled"] },
  portal_section_active_rentals: { id: "portal_section_active_rentals", label: "Active Rentals", category: "customers", shortDescription: "Dashboard section header.", guideDescription: "Active Rentals shows your current dumpster rentals that are in progress. You can see the delivery date, pickup date, and how many days remain.", routeOrSurface: "portal", tenantOverrideKey: "portal_section_active_rentals", isUserFacing: true, isGuideEligible: true, keywords: ["active", "rentals"] },
  portal_section_upcoming: { id: "portal_section_upcoming", label: "Upcoming", category: "customers", shortDescription: "Dashboard section header for scheduled deliveries.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_section_upcoming", isUserFacing: true, isGuideEligible: false, keywords: ["upcoming"] },
  portal_section_history: { id: "portal_section_history", label: "Service History", category: "customers", shortDescription: "Dashboard section for completed rentals.", guideDescription: "Service History shows your recently completed rentals. You can see when the service was delivered and completed.", routeOrSurface: "portal", tenantOverrideKey: "portal_section_history", isUserFacing: true, isGuideEligible: true, keywords: ["history", "completed"] },
  portal_empty_active: { id: "portal_empty_active", label: "No active rentals", category: "customers", shortDescription: "Empty state for active rentals.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_empty_active", isUserFacing: true, isGuideEligible: false, keywords: ["empty"] },
  portal_empty_history: { id: "portal_empty_history", label: "No completed services yet", category: "customers", shortDescription: "Empty state for service history.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_empty_history", isUserFacing: true, isGuideEligible: false, keywords: ["empty", "history"] },
  portal_action_view_details: { id: "portal_action_view_details", label: "View Details", category: "customers", shortDescription: "CTA for rental details.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_action_view_details", isUserFacing: true, isGuideEligible: false, keywords: ["details"] },
  portal_action_extend: { id: "portal_action_extend", label: "Extend Rental", category: "customers", shortDescription: "CTA to extend rental period.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_action_extend", isUserFacing: true, isGuideEligible: false, keywords: ["extend"] },
  portal_action_early_pickup: { id: "portal_action_early_pickup", label: "Request Early Pickup", category: "customers", shortDescription: "CTA to request early pickup.", guideDescription: "", routeOrSurface: "portal", tenantOverrideKey: "portal_action_early_pickup", isUserFacing: true, isGuideEligible: false, keywords: ["early pickup"] },
};

// ── Category display labels ──
export const CATEGORY_LABELS: Record<FeatureCategory, string> = {
  getting_started: "Getting Started",
  dashboard: "Dashboard",
  customers: "Customers",
  assets: "Assets & Inventory",
  operations: "Operations",
  billing: "Billing",
  pricing: "Pricing",
  team: "Team & Vehicles",
  analytics: "Analytics & Reports",
  marketplace: "Marketplace",
  notifications: "Notifications",
  settings: "Settings",
  admin: "Administration",
};

export const CATEGORY_ORDER: FeatureCategory[] = [
  "getting_started", "dashboard", "operations", "customers", "assets",
  "billing", "pricing", "team", "analytics", "marketplace",
  "notifications", "settings", "admin",
];

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
): FeatureDescription[] {
  return Object.values(FEATURE_REGISTRY)
    .filter(f => f.isGuideEligible && f.isUserFacing)
    .filter(f => !category || f.category === category)
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function isRegisteredFeature(id: string): boolean {
  return id in FEATURE_REGISTRY;
}

export function getAllFeatureIds(): string[] {
  return Object.keys(FEATURE_REGISTRY);
}

/**
 * Shared visibility filter — single source of truth for all Help Center views.
 * Respects admin-only gating and guide eligibility.
 */
export function getVisibleGuideFeatures(
  options?: { isAdmin?: boolean },
): FeatureDescription[] {
  return Object.values(FEATURE_REGISTRY)
    .filter(f => f.isUserFacing && f.isGuideEligible)
    .filter(f => f.category !== "admin" || options?.isAdmin);
}

/**
 * Related topics — scores other features by category overlap + shared keywords.
 * Deterministic: same input always produces same output. No randomness.
 */
export function getRelatedFeatures(
  featureId: string,
  options?: { max?: number; isAdmin?: boolean },
): FeatureDescription[] {
  const feature = FEATURE_REGISTRY[featureId];
  if (!feature) return [];

  const max = Math.min(options?.max || 3, 5);
  const pool = getVisibleGuideFeatures({ isAdmin: options?.isAdmin })
    .filter(f => f.id !== featureId);

  const featureKeywords = new Set(feature.keywords.map(k => k.toLowerCase()));

  const scored = pool.map(candidate => {
    let score = 0;
    if (candidate.category === feature.category) score += 10;
    for (const kw of candidate.keywords) {
      if (featureKeywords.has(kw.toLowerCase())) score += 3;
    }
    return { feature: candidate, score };
  });

  // Dev warnings
  if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
    if (feature.keywords.length < 3) {
      console.warn(`[Registry Quality] "${featureId}" has only ${feature.keywords.length} keywords — may produce weak related topics`);
    }
  }

  // Filter by minimum score, sort by score desc then label asc
  const results = scored
    .filter(s => s.score >= 3)
    .sort((a, b) => b.score - a.score || a.feature.label.localeCompare(b.feature.label))
    .slice(0, max)
    .map(s => s.feature);

  if (typeof window !== "undefined" && process.env.NODE_ENV === "development" && results.length === 0) {
    console.warn(`[Registry Quality] "${featureId}" has no strong related matches — consider improving keywords`);
  }

  return results;
}
