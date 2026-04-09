"use client";

import Link from "next/link";
import { AlertTriangle, FileWarning, MapPinOff, PhoneOff } from "lucide-react";
import {
  CUSTOMER_DASHBOARD_LABELS,
  issueCategoryLabel,
} from "@/lib/customer-dashboard-labels";
import type { DashboardIssue } from "@/lib/customer-dashboard-types";

/**
 * Centralized actionable-issues panel. The backend aggregator already
 * filters to actionable-only (open billing issues, unresolved geocode
 * failures, active SMS opt-out, etc.), so this component just renders
 * what it's given — no client-side filtering rules.
 */
export default function AlertsIssuesPanel({
  issues,
}: {
  issues: DashboardIssue[];
}) {
  const L = CUSTOMER_DASHBOARD_LABELS;

  return (
    <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-3">
      <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--t-text-primary)] mb-2">
        {L.sections.issues}
      </h3>

      {issues.length === 0 ? (
        <p className="py-1 text-xs text-[var(--t-text-muted)]">
          {L.empty.noIssues}
        </p>
      ) : (
        <div className="space-y-1.5">
          {issues.map((issue) => (
            <IssueRow key={issue.id} issue={issue} />
          ))}
        </div>
      )}
    </div>
  );
}

function IssueRow({ issue }: { issue: DashboardIssue }) {
  const Icon = categoryIcon(issue.category);
  const theme = severityTheme(issue.severity);

  const inner = (
    <div
      className="flex items-start gap-2 rounded-[12px] border px-2.5 py-1.5"
      style={{ borderColor: theme.border, background: theme.bg }}
    >
      <Icon
        className="h-3.5 w-3.5 mt-0.5 shrink-0"
        style={{ color: theme.icon }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-[9px] font-semibold uppercase tracking-wider"
            style={{ color: theme.icon }}
          >
            {issueCategoryLabel(issue.category)}
          </span>
        </div>
        <p className="text-xs text-[var(--t-text-primary)] leading-snug">
          {issue.description}
        </p>
      </div>
    </div>
  );

  return issue.link ? (
    <Link href={issue.link} className="block hover:opacity-80 transition-opacity">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function categoryIcon(category: string) {
  switch (category) {
    case "billing":
      return FileWarning;
    case "address":
      return MapPinOff;
    case "sms_blocked":
      return PhoneOff;
    case "pricing":
    default:
      return AlertTriangle;
  }
}

function severityTheme(severity: "info" | "warning" | "critical") {
  switch (severity) {
    case "critical":
      return {
        bg: "var(--t-error-soft, rgba(239,68,68,0.06))",
        border: "color-mix(in srgb, var(--t-error) 25%, transparent)",
        icon: "var(--t-error)",
      };
    case "warning":
      return {
        bg: "var(--t-warning-soft, rgba(234,179,8,0.06))",
        border: "color-mix(in srgb, var(--t-warning) 25%, transparent)",
        icon: "var(--t-warning)",
      };
    case "info":
    default:
      return {
        bg: "var(--t-bg-card-hover)",
        border: "var(--t-border)",
        icon: "var(--t-text-muted)",
      };
  }
}
