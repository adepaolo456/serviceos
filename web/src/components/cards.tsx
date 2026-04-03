import type { ReactNode, CSSProperties } from "react";

/**
 * KPI Card — compact metric display.
 * Minimal padding, large number, small label.
 */
export function KpiCard({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-[18px] ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

/**
 * Content Card — sections, tables, forms.
 * Softer background with subtle border.
 */
export function ContentCard({
  children,
  className = "",
  style,
  noPadding = false,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  noPadding?: boolean;
}) {
  return (
    <div
      className={`rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] ${noPadding ? "" : "p-5"} ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

/**
 * Alert Card — issues, warnings, notices.
 * Colored left border indicating severity.
 */
export function AlertCard({
  children,
  severity = "warning",
  className = "",
  style,
}: {
  children: ReactNode;
  severity?: "error" | "warning" | "success" | "info";
  className?: string;
  style?: CSSProperties;
}) {
  const borderColor = {
    error: "var(--t-error)",
    warning: "var(--t-warning)",
    success: "var(--t-accent)",
    info: "var(--t-text-muted)",
  }[severity];

  return (
    <div
      className={`rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4 ${className}`}
      style={{ borderLeftWidth: 3, borderLeftColor: borderColor, ...style }}
    >
      {children}
    </div>
  );
}
