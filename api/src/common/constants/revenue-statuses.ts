// Invoice statuses that count as booked revenue.
// Drafts and voided invoices are excluded.
//
// SHARED across reporting + customers surfaces — both read live revenue
// totals via this predicate, so the /customers page and the reporting
// "top customers" widget always agree on what a lifetime-revenue number
// means. Matches the drift-prevention discipline from Item 5.
//
// If the allowed set ever changes, update this file and verify both
// consumers react consistently:
//   - reporting.service.ts (imports REVENUE_STATUSES + uses the local
//     REVENUE_STATUS_SQL raw-SQL fragment as a sibling)
//   - customers.service.ts (live-compute of customers.lifetime_revenue)
export const REVENUE_STATUSES = ['open', 'paid', 'partial'] as const;

export type RevenueStatus = (typeof REVENUE_STATUSES)[number];
