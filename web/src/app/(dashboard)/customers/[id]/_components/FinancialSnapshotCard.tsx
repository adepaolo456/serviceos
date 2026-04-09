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

  const hasAnyMetric =
    data.unpaidCount > 0 ||
    data.overdueCount > 0 ||
    data.overdueThirtyPlusCount > 0;

  return (
    <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-3">
      <div className="flex items-start justify-between mb-2 gap-3">
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

      <div className="mb-2">
        <p className="text-[10px] uppercase tracking-wider text-[var(--t-text-muted)]">
          {L.fields.balance}
        </p>
        <p
          className="text-xl font-bold tabular-nums"
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

      {/* Metric tiles only render when there's something to show.
          Good-standing customers skip this row entirely. */}
      {hasAnyMetric && (
        <div className="flex items-center gap-3 text-[11px] mb-2 flex-wrap">
          <span className="text-[var(--t-text-muted)]">
            {L.fields.unpaid}:{" "}
            <span className="text-[var(--t-text-primary)] font-semibold tabular-nums">
              {data.unpaidCount}
            </span>
          </span>
          <span className="text-[var(--t-text-muted)]">
            {L.fields.overdue}:{" "}
            <span
              className="font-semibold tabular-nums"
              style={{
                color:
                  data.overdueCount > 0
                    ? "var(--t-error)"
                    : "var(--t-text-primary)",
              }}
            >
              {data.overdueCount}
            </span>
          </span>
          <span className="text-[var(--t-text-muted)]">
            {L.fields.overdueThirtyPlus}:{" "}
            <span
              className="font-semibold tabular-nums"
              style={{
                color:
                  data.overdueThirtyPlusCount > 0
                    ? "var(--t-error)"
                    : "var(--t-text-primary)",
              }}
            >
              {data.overdueThirtyPlusCount}
            </span>
          </span>
        </div>
      )}

      <div className="border-t border-[var(--t-border)] pt-2">
        <p className="text-[10px] uppercase tracking-wider text-[var(--t-text-muted)] mb-1">
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
