/**
 * DemoBadge
 *
 * Renders a small "DEMO" pill if the provided tags array contains "demo".
 * Returns null otherwise.
 *
 * Used in operational list views (where demo customers are intentionally
 * NOT excluded from display) to visually distinguish test/seed data from
 * real customer records.
 *
 * Demo classification source: customers.tags JSONB column.
 *
 * Currently rendered in:
 *   - app/(dashboard)/customers/page.tsx
 *
 * Backlog (deferred):
 *   - Render in /invoices, /jobs, /dispatch list views.
 *     Requires backend DTO expansion: invoice/job/dispatch responses do
 *     not currently project customer.tags. Tracked separately.
 */

interface DemoBadgeProps {
  /** Tags array from a customer record. Renders if it includes "demo". */
  tags?: string[] | null;
}

export default function DemoBadge({ tags }: DemoBadgeProps) {
  if (!tags?.includes("demo")) return null;

  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{
        background: "var(--t-warning-soft, rgb(254 243 199))",
        color: "var(--t-warning, rgb(146 64 14))",
        border: "1px solid var(--t-warning-border, rgb(252 211 77))",
      }}
      aria-label="Demo customer"
      title="This customer is tagged as demo/test data and is excluded from analytics"
    >
      Demo
    </span>
  );
}
