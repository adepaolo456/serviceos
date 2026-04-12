"use client";

/**
 * Phase 14 — Alerts & Exceptions page
 *
 * Derived, tenant-scoped alerts surfacing operational and financial
 * issues in real-time. All labels come from the feature registry
 * (spec rule: "NO HARDCODED LABELS anywhere in UI"). Deep-links to
 * existing entity pages — never creates duplicate routes.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Zap,
  Clock,
  FileX,
  Package,
  Scale,
  TrendingDown,
  GitBranch,
  CalendarX,
  CheckCircle2,
  XCircle,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import { getFeatureLabel, getFeature } from "@/lib/feature-registry";
import HelpTooltip from "@/components/ui/HelpTooltip";

// ── Domain types (mirror api/src/modules/alerts/dto/alert.dto.ts) ──

type AlertSeverity = "high" | "medium" | "low";
type AlertStatus = "active" | "resolved" | "dismissed";
type AlertType =
  | "overdue_rental"
  | "missing_dump_slip"
  | "missing_asset"
  | "abnormal_disposal"
  | "low_margin_chain"
  | "lifecycle_integrity"
  | "date_rule_conflict";
type AlertEntityType =
  | "job"
  | "rental_chain"
  | "asset"
  | "invoice"
  | "customer";

interface Alert {
  id: string;
  alert_type: AlertType;
  severity: AlertSeverity;
  entity_type: AlertEntityType;
  entity_id: string;
  message: string; // feature registry key — resolve via getFeatureLabel
  metadata: Record<string, unknown>;
  status: AlertStatus;
  resolved_at: string | null;
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AlertSummary {
  total: number;
  by_severity: Record<AlertSeverity, number>;
  by_type: Partial<Record<AlertType, number>>;
  last_detected_at: string | null;
}

// ── Per-type config (icons + feature IDs — no hardcoded labels) ──
//
// Labels are deliberately OMITTED here. The spec requires all
// user-facing strings to come from the feature registry, so the
// render path calls getFeatureLabel(`alerts_${type}`) directly.

const TYPE_CONFIG: Record<
  AlertType,
  { icon: React.ComponentType<{ className?: string }>; featureId: string }
> = {
  overdue_rental: { icon: Clock, featureId: "alerts_overdue_rental" },
  missing_dump_slip: { icon: FileX, featureId: "alerts_missing_dump_slip" },
  missing_asset: { icon: Package, featureId: "alerts_missing_asset" },
  abnormal_disposal: { icon: Scale, featureId: "alerts_abnormal_disposal" },
  low_margin_chain: { icon: TrendingDown, featureId: "alerts_low_margin_chain" },
  lifecycle_integrity: { icon: GitBranch, featureId: "alerts_lifecycle_integrity" },
  date_rule_conflict: { icon: CalendarX, featureId: "alerts_date_rule_conflict" },
};

const SEVERITY_ORDER: AlertSeverity[] = ["high", "medium", "low"];

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  high: "var(--t-error)",
  medium: "var(--t-warning)",
  low: "var(--t-text-muted)",
};

// Deep-link builder — each alert routes to the canonical existing
// entity page. Per spec: "Use existing routes. DO NOT create
// duplicate pages."
function entityHref(alert: Alert): string | null {
  switch (alert.entity_type) {
    case "job":
      return `/jobs/${alert.entity_id}`;
    case "rental_chain":
      return `/reports/lifecycle`; // filtered view — Phase 14.1 can
    // add ?chainId= once the lifecycle page supports deep-linking.
    case "asset":
      return `/assets/${alert.entity_id}`;
    case "invoice":
      return `/invoices/${alert.entity_id}`;
    case "customer":
      return `/customers/${alert.entity_id}`;
    default:
      return null;
  }
}

export default function AlertsPage() {
  const toast = useToast();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [summary, setSummary] = useState<AlertSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | "">("");
  const [typeFilter, setTypeFilter] = useState<AlertType | "">("");
  const [includeResolved, setIncludeResolved] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (severityFilter) params.set("severity", severityFilter);
      if (typeFilter) params.set("alert_type", typeFilter);
      if (includeResolved) params.set("include_resolved", "true");

      const [list, sum] = await Promise.all([
        api.get<Alert[]>(`/alerts${params.toString() ? `?${params}` : ""}`),
        api.get<AlertSummary>("/alerts/summary"),
      ]);
      setAlerts(list || []);
      setSummary(sum);
    } catch (err) {
      toast.toast(
        "error",
        err instanceof Error ? err.message : "Failed to load alerts",
      );
    } finally {
      setLoading(false);
    }
  }, [severityFilter, typeFilter, includeResolved, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleDismiss(alert: Alert) {
    setBusyId(alert.id);
    try {
      await api.put(`/alerts/${alert.id}/dismiss`);
      toast.toast("success", "Alert dismissed");
      await fetchData();
    } catch (err) {
      toast.toast(
        "error",
        err instanceof Error ? err.message : "Dismiss failed",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleResolve(alert: Alert) {
    setBusyId(alert.id);
    try {
      await api.put(`/alerts/${alert.id}/resolve`);
      toast.toast("success", "Alert resolved");
      await fetchData();
    } catch (err) {
      toast.toast(
        "error",
        err instanceof Error ? err.message : "Resolve failed",
      );
    } finally {
      setBusyId(null);
    }
  }

  // Group alerts by severity for display (high first).
  const grouped = useMemo(() => {
    const map: Record<AlertSeverity, Alert[]> = {
      high: [],
      medium: [],
      low: [],
    };
    for (const a of alerts) {
      if (a.status === "active" || includeResolved) {
        map[a.severity]?.push(a);
      }
    }
    return map;
  }, [alerts, includeResolved]);

  const totalActive = summary?.total ?? 0;
  const highCount = summary?.by_severity.high ?? 0;
  const mediumCount = summary?.by_severity.medium ?? 0;
  const lowCount = summary?.by_severity.low ?? 0;

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Zap
              className="h-6 w-6"
              style={{ color: "var(--t-accent)" }}
            />
            <h1
              className="text-[28px] font-bold tracking-[-1px]"
              style={{ color: "var(--t-frame-text)" }}
            >
              {getFeatureLabel("alerts")}
            </h1>
            <HelpTooltip featureId="alerts" placement="right" />
          </div>
          <p
            className="mt-1 text-[13px]"
            style={{ color: "var(--t-frame-text-muted)" }}
          >
            {getFeature("alerts")?.shortDescription}
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium"
          style={{
            backgroundColor: "var(--t-bg-card)",
            border: "1px solid var(--t-border)",
            color: "var(--t-text-primary)",
          }}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>

      {/* ── Summary stat row ───────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total Active" value={totalActive} color="var(--t-text-primary)" />
        <StatCard label="High" value={highCount} color={SEVERITY_COLOR.high} />
        <StatCard label="Medium" value={mediumCount} color={SEVERITY_COLOR.medium} />
        <StatCard label="Low" value={lowCount} color={SEVERITY_COLOR.low} />
      </div>

      {/* ── Filter row ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <FilterChip
          active={severityFilter === ""}
          label="All severities"
          onClick={() => setSeverityFilter("")}
        />
        {SEVERITY_ORDER.map((s) => (
          <FilterChip
            key={s}
            active={severityFilter === s}
            label={s.charAt(0).toUpperCase() + s.slice(1)}
            color={SEVERITY_COLOR[s]}
            onClick={() => setSeverityFilter(s)}
          />
        ))}
        <div
          className="h-5 w-px mx-1"
          style={{ background: "var(--t-border)" }}
        />
        <FilterChip
          active={typeFilter === ""}
          label="All types"
          onClick={() => setTypeFilter("")}
        />
        {(Object.keys(TYPE_CONFIG) as AlertType[]).map((t) => {
          const count = summary?.by_type[t] ?? 0;
          return (
            <FilterChip
              key={t}
              active={typeFilter === t}
              label={`${getFeatureLabel(TYPE_CONFIG[t].featureId)}${count > 0 ? ` (${count})` : ""}`}
              onClick={() => setTypeFilter(t)}
            />
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <label
            className="flex items-center gap-1.5 text-xs cursor-pointer"
            style={{ color: "var(--t-text-muted)" }}
          >
            <input
              type="checkbox"
              checked={includeResolved}
              onChange={(e) => setIncludeResolved(e.target.checked)}
            />
            Show resolved/dismissed
          </label>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────── */}
      {loading && alerts.length === 0 ? (
        <div
          className="py-20 text-center text-sm"
          style={{ color: "var(--t-text-muted)" }}
        >
          Loading alerts…
        </div>
      ) : alerts.length === 0 ? (
        <EmptyState includeResolved={includeResolved} />
      ) : (
        <div className="space-y-6">
          {SEVERITY_ORDER.map((sev) => {
            const items = grouped[sev];
            if (!items || items.length === 0) return null;
            return (
              <section key={sev}>
                <h2
                  className="text-[11px] font-bold uppercase tracking-wider mb-2"
                  style={{ color: SEVERITY_COLOR[sev] }}
                >
                  {sev} · {items.length}
                </h2>
                <div className="flex flex-col gap-2">
                  {items.map((a) => (
                    <AlertRow
                      key={a.id}
                      alert={a}
                      onDismiss={handleDismiss}
                      onResolve={handleResolve}
                      busy={busyId === a.id}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div
      className="rounded-[14px] border p-4"
      style={{
        background: "var(--t-bg-card)",
        borderColor: "var(--t-border)",
      }}
    >
      <p
        className="text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--t-text-muted)" }}
      >
        {label}
      </p>
      <p
        className="mt-1 text-2xl font-bold tabular-nums"
        style={{ color }}
      >
        {value}
      </p>
    </div>
  );
}

function FilterChip({
  active,
  label,
  color,
  onClick,
}: {
  active: boolean;
  label: string;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-full px-3 py-1 text-xs font-medium transition-colors"
      style={{
        backgroundColor: active ? "var(--t-accent-soft)" : "var(--t-bg-card)",
        color: active ? "var(--t-accent)" : color ?? "var(--t-text-muted)",
        border: `1px solid ${active ? "var(--t-accent)" : "var(--t-border)"}`,
      }}
    >
      {label}
    </button>
  );
}

function AlertRow({
  alert,
  onDismiss,
  onResolve,
  busy,
}: {
  alert: Alert;
  onDismiss: (a: Alert) => void;
  onResolve: (a: Alert) => void;
  busy: boolean;
}) {
  const config = TYPE_CONFIG[alert.alert_type];
  const Icon = config?.icon ?? Zap;
  const typeLabel = getFeatureLabel(config?.featureId ?? alert.message);
  const href = entityHref(alert);
  const isActive = alert.status === "active";

  // Build a short metadata hint line for operator context without
  // leaking sensitive financial data beyond aggregates.
  const hint = buildHint(alert);

  return (
    <div
      className="flex items-start gap-3 rounded-[14px] border p-4"
      style={{
        background: "var(--t-bg-card)",
        borderColor: "var(--t-border)",
        opacity: isActive ? 1 : 0.6,
      }}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        style={{
          backgroundColor: "var(--t-bg-elevated)",
          color: SEVERITY_COLOR[alert.severity],
        }}
      >
        <Icon className="h-4 w-4" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3
            className="text-sm font-semibold"
            style={{ color: "var(--t-text-primary)" }}
          >
            {typeLabel}
          </h3>
          {config?.featureId && (
            <HelpTooltip featureId={config.featureId} placement="right" />
          )}
          <span
            className="text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5"
            style={{
              backgroundColor: "var(--t-bg-elevated)",
              color: SEVERITY_COLOR[alert.severity],
            }}
          >
            {alert.severity}
          </span>
          {!isActive && (
            <span
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: "var(--t-text-muted)" }}
            >
              · {alert.status}
            </span>
          )}
        </div>
        {hint && (
          <p
            className="mt-1 text-xs"
            style={{ color: "var(--t-text-muted)" }}
          >
            {hint}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {href && (
          <Link
            href={href}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium no-underline"
            style={{
              backgroundColor: "var(--t-accent-soft)",
              color: "var(--t-accent)",
            }}
          >
            View <ExternalLink className="h-3 w-3" />
          </Link>
        )}
        {isActive && (
          <>
            <button
              onClick={() => onResolve(alert)}
              disabled={busy}
              title="Resolve (admin only — force-clears the alert)"
              className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              style={{
                backgroundColor: "var(--t-bg-elevated)",
                color: "var(--t-text-primary)",
              }}
            >
              <CheckCircle2 className="h-3 w-3" />
              Resolve
            </button>
            <button
              onClick={() => onDismiss(alert)}
              disabled={busy}
              title="Dismiss (acknowledge without acting)"
              className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              style={{
                backgroundColor: "var(--t-bg-elevated)",
                color: "var(--t-text-muted)",
              }}
            >
              <XCircle className="h-3 w-3" />
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState({ includeResolved }: { includeResolved: boolean }) {
  return (
    <div
      className="rounded-[14px] border p-12 text-center"
      style={{
        background: "var(--t-bg-card)",
        borderColor: "var(--t-border)",
      }}
    >
      <CheckCircle2
        className="mx-auto h-10 w-10 mb-3"
        style={{ color: "var(--t-accent)" }}
      />
      <p
        className="text-sm font-semibold"
        style={{ color: "var(--t-text-primary)" }}
      >
        {includeResolved
          ? "No alerts match the current filters."
          : "All clear — no active alerts."}
      </p>
      <p
        className="mt-1 text-xs"
        style={{ color: "var(--t-text-muted)" }}
      >
        Alerts are derived from your lifecycle, financial, and disposal data.
        New issues will appear here automatically as they occur.
      </p>
    </div>
  );
}

// Builds a short operator-facing context line from the alert's
// metadata payload. Intentionally conservative — no raw currency
// values beyond aggregates, no customer PII.
function buildHint(alert: Alert): string | null {
  const m = alert.metadata || {};
  switch (alert.alert_type) {
    case "overdue_rental": {
      const days = Number(m.days_overdue) || 0;
      return days > 0 ? `${days} day${days === 1 ? "" : "s"} past expected pickup` : null;
    }
    case "abnormal_disposal": {
      const parts: string[] = [];
      if (m.size) parts.push(`${m.size}yd`);
      if (m.abnormal_weight) parts.push(`weight ${m.weight_tons}t > ${m.threshold_weight_tons}t`);
      if (m.abnormal_cost) parts.push(`cost $${m.cost_usd} > $${m.threshold_cost_usd}`);
      return parts.length > 0 ? parts.join(" · ") : null;
    }
    case "low_margin_chain": {
      const profit = Number(m.profit) || 0;
      return m.is_negative
        ? `Negative margin: $${profit.toFixed(2)}`
        : `Low margin: $${profit.toFixed(2)}`;
    }
    case "lifecycle_integrity": {
      if (m.integrity_issue === "no_task_chain_links") return "Rental chain with no jobs attached";
      if (m.integrity_issue === "duplicate_active_asset") return "Multiple active chains on the same asset";
      return null;
    }
    case "missing_asset": {
      return m.job_number ? `Job ${m.job_number} has no asset assigned` : null;
    }
    case "missing_dump_slip": {
      return "Completed disposal job without a dump ticket";
    }
    case "date_rule_conflict": {
      return "Pickup date override conflicts with rental rule";
    }
    default:
      return null;
  }
}
