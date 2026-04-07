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
