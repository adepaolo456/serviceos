"use client";

import {
  CUSTOMER_DASHBOARD_LABELS,
  financialStateLabel,
} from "@/lib/customer-dashboard-labels";
import type { DashboardFinancial } from "@/lib/customer-dashboard-types";
import { formatCurrency } from "@/lib/utils";

/**
 * Financial snapshot — balance, unpaid/overdue counts, latest invoice,
 * derived state pill. Everything comes from the backend aggregator; no
 * balance math happens here.
 */
export default function FinancialSnapshotCard({
  data,
}: {
  data: DashboardFinancial;
}) {
  const L = CUSTOMER_DASHBOARD_LABELS;
  const pill = statePillTheme(data.state);

  return (
    <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4">
      <div className="flex items-start justify-between mb-3 gap-3">
        <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--t-text-primary)]">
          {L.sections.financial}
        </h3>
        <span
          className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold shrink-0"
          style={{ background: pill.bg, color: pill.text }}
        >
          {financialStateLabel(data.state)}
        </span>
      </div>

      <div className="mb-3">
        <p className="text-[10px] uppercase tracking-wider text-[var(--t-text-muted)]">
          {L.fields.balance}
        </p>
        <p
          className="text-2xl font-bold tabular-nums"
          style={{
            color:
              data.outstandingBalance > 0
                ? "var(--t-error)"
                : "var(--t-text-primary)",
          }}
        >
          {formatCurrency(data.outstandingBalance)}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <MetricTile label={L.fields.unpaid} value={data.unpaidCount} />
        <MetricTile
          label={L.fields.overdue}
          value={data.overdueCount}
          emphasize={data.overdueCount > 0}
        />
        <MetricTile
          label={L.fields.overdueThirtyPlus}
          value={data.overdueThirtyPlusCount}
          emphasize={data.overdueThirtyPlusCount > 0}
        />
      </div>

      <div className="border-t border-[var(--t-border)] pt-3">
        <p className="text-[10px] uppercase tracking-wider text-[var(--t-text-muted)] mb-1.5">
          {L.fields.latestInvoice}
        </p>
        {data.latestInvoice ? (
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--t-text-primary)] capitalize">
              {data.latestInvoice.status}
            </span>
            <span className="tabular-nums text-[var(--t-text-primary)] font-medium">
              {formatCurrency(data.latestInvoice.total)}
            </span>
          </div>
        ) : (
          <p className="text-xs text-[var(--t-text-muted)]">
            {L.empty.noLatestInvoice}
          </p>
        )}
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <div className="rounded-[12px] border border-[var(--t-border)] bg-[var(--t-bg-card-hover)] px-2 py-2 text-center">
      <p
        className="text-base font-bold tabular-nums"
        style={{
          color: emphasize ? "var(--t-error)" : "var(--t-text-primary)",
        }}
      >
        {value}
      </p>
      <p className="text-[9px] uppercase tracking-wider text-[var(--t-text-muted)]">
        {label}
      </p>
    </div>
  );
}

function statePillTheme(state: "paid" | "partial" | "past_due" | "needs_review") {
  switch (state) {
    case "paid":
      return {
        bg: "var(--t-accent-soft, rgba(34,197,94,0.12))",
        text: "var(--t-accent)",
      };
    case "partial":
      return {
        bg: "var(--t-warning-soft, rgba(234,179,8,0.12))",
        text: "var(--t-warning)",
      };
    case "past_due":
      return {
        bg: "var(--t-error-soft, rgba(239,68,68,0.12))",
        text: "var(--t-error)",
      };
    case "needs_review":
    default:
      return {
        bg: "var(--t-bg-card-hover)",
        text: "var(--t-text-muted)",
      };
  }
}
