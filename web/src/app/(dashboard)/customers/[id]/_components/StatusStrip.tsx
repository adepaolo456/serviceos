"use client";

import {
  CUSTOMER_DASHBOARD_LABELS,
  reasonLabel,
  severityLabel,
} from "@/lib/customer-dashboard-labels";
import type { DashboardStatusStrip } from "@/lib/customer-dashboard-types";

type Variant = "card" | "inline";

/**
 * Single-row severity indicator. Severity + reasons come directly from
 * the backend aggregator — no client-side recomputation.
 *
 * Two variants:
 *   - "card" (default): standalone card with border, padding, background.
 *     Used when the strip is its own row on the page.
 *   - "inline": bare chip row with no card chrome. Used to embed the
 *     strip inside another card (e.g. the identity header) so the whole
 *     identity block fits in a single compact container.
 */
export default function StatusStrip({
  data,
  variant = "card",
}: {
  data: DashboardStatusStrip;
  variant?: Variant;
}) {
  const theme = severityTheme(data.severity);
  const isInline = variant === "inline";

  const content = (
    <>
      <div
        className={isInline ? "h-2 w-2 rounded-full shrink-0" : "h-2.5 w-2.5 rounded-full shrink-0"}
        style={{ background: theme.dot }}
        aria-hidden="true"
      />
      <span
        className={isInline ? "text-xs font-semibold" : "text-sm font-semibold"}
        style={{ color: theme.text }}
      >
        {severityLabel(data.severity)}
      </span>
      {data.reasons.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {data.reasons.map((key) => (
            <span
              key={key}
              className="rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
              style={{
                background: isInline
                  ? "var(--t-bg-card-hover)"
                  : "var(--t-bg-card)",
                borderColor: theme.border,
                color: theme.text,
              }}
            >
              {reasonLabel(key)}
            </span>
          ))}
        </div>
      )}
      <span className="sr-only">
        {CUSTOMER_DASHBOARD_LABELS.sections.statusStrip}
      </span>
    </>
  );

  if (isInline) {
    return (
      <div className="flex items-center gap-2.5 flex-wrap pt-3 border-t border-[var(--t-border)]">
        {content}
      </div>
    );
  }

  return (
    <div
      className="rounded-[20px] border p-4 mb-5 flex items-center gap-3 flex-wrap"
      style={{
        background: theme.bg,
        borderColor: theme.border,
      }}
    >
      {content}
    </div>
  );
}

function severityTheme(severity: "green" | "yellow" | "red") {
  switch (severity) {
    case "red":
      return {
        bg: "var(--t-error-soft, rgba(239, 68, 68, 0.08))",
        border: "color-mix(in srgb, var(--t-error) 35%, transparent)",
        text: "var(--t-error)",
        dot: "var(--t-error)",
      };
    case "yellow":
      return {
        bg: "var(--t-warning-soft, rgba(234, 179, 8, 0.08))",
        border: "color-mix(in srgb, var(--t-warning) 35%, transparent)",
        text: "var(--t-warning)",
        dot: "var(--t-warning)",
      };
    case "green":
    default:
      return {
        bg: "var(--t-accent-soft, rgba(34, 197, 94, 0.08))",
        border: "color-mix(in srgb, var(--t-accent) 30%, transparent)",
        text: "var(--t-accent)",
        dot: "var(--t-accent)",
      };
  }
}
