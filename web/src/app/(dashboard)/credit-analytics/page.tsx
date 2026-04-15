"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { BarChart3, Shield, Users, UserCheck, AlertTriangle, FileText, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { api } from "@/lib/api";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";

/* ── Types ── */

interface Summary {
  active_holds: number;
  manual_holds: number;
  booking_overrides_30d: number;
  dispatch_overrides_30d: number;
  policy_changes_30d: number;
}

interface TrendRow { day: string; event_type: string; count: number }

interface TopCustomer {
  customer_id: string;
  customer_name: string;
  event_count: number;
  hold_events: number;
  override_events: number;
  last_event: string;
}

interface TopUser {
  user_id: string | null;
  booking_overrides: number;
  dispatch_overrides: number;
  total: number;
}

/* ── Helpers ── */

function label(id: string, fallback: string): string {
  return FEATURE_REGISTRY[id]?.label ?? fallback;
}

/** Pivot trend rows into chart-friendly daily buckets. */
function pivotTrends(rows: TrendRow[]) {
  const map = new Map<string, Record<string, number>>();
  for (const r of rows) {
    if (typeof r.day !== "string") continue;
    const day = r.day.slice(0, 10);
    if (!map.has(day)) map.set(day, {});
    const bucket = map.get(day)!;
    bucket[r.event_type] = (bucket[r.event_type] ?? 0) + r.count;
  }
  return Array.from(map.entries())
    .map(([day, data]) => ({ ...data, day }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/* ── Page ── */

export default function CreditAnalyticsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trends, setTrends] = useState<TrendRow[]>([]);
  const [topCustomers, setTopCustomers] = useState<TopCustomer[]>([]);
  const [topUsers, setTopUsers] = useState<TopUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<Summary>("/credit-analytics/summary").catch(() => null),
      api.get<TrendRow[]>("/credit-analytics/trends").catch(() => []),
      api.get<TopCustomer[]>("/credit-analytics/top-customers").catch(() => []),
      api.get<TopUser[]>("/credit-analytics/top-users").catch(() => []),
    ]).then(([s, t, tc, tu]) => {
      setSummary(s);
      setTrends(t);
      setTopCustomers(tc);
      setTopUsers(tu);
    }).finally(() => setLoading(false));
  }, []);

  const chartData = pivotTrends(trends);
  const title = label("credit_analytics_dashboard", "Credit Control Analytics");

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <BarChart3 className="h-6 w-6" style={{ color: "var(--t-accent)" }} />
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--t-text-primary)" }}>{title}</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--t-text-muted)" }}>
            {FEATURE_REGISTRY.credit_analytics_dashboard?.shortDescription ?? "Operational insights from credit-control activity"}
          </p>
        </div>
      </div>

      {/* Section 1 — Summary metric cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <MetricCard icon={Shield} label={label("credit_analytics_active_holds", "Active Holds")} value={summary?.active_holds} color="var(--t-error)" loading={loading} />
        <MetricCard icon={UserCheck} label={label("credit_analytics_manual_holds", "Manual Holds")} value={summary?.manual_holds} color="var(--t-warning, #F59E0B)" loading={loading} />
        <MetricCard icon={AlertTriangle} label={label("credit_analytics_booking_overrides", "Booking Overrides")} value={summary?.booking_overrides_30d} suffix="30d" color="var(--t-accent)" loading={loading} />
        <MetricCard icon={AlertTriangle} label={label("credit_analytics_dispatch_overrides", "Dispatch Overrides")} value={summary?.dispatch_overrides_30d} suffix="30d" color="var(--t-info, #3B82F6)" loading={loading} />
        <MetricCard icon={FileText} label={label("credit_analytics_policy_changes", "Policy Changes")} value={summary?.policy_changes_30d} suffix="30d" color="var(--t-text-muted)" loading={loading} />
      </div>

      {/* Section 2 — Trends chart */}
      <div className="rounded-[20px] border p-5 mb-6" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
        <h2 className="text-sm font-bold mb-4" style={{ color: "var(--t-text-primary)" }}>
          <TrendingUp className="h-4 w-4 inline mr-1.5" style={{ color: "var(--t-accent)" }} />
          {label("credit_analytics_trends_title", "Event Trends (Last 30 Days)")}
        </h2>
        {loading ? (
          <div className="h-48 rounded-lg animate-pulse" style={{ background: "var(--t-bg-elevated)" }} />
        ) : chartData.length === 0 ? (
          <p className="text-xs py-12 text-center" style={{ color: "var(--t-text-muted)" }}>{label("credit_analytics_empty_trends", "No events in the last 30 days")}</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--t-border)" />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--t-text-muted)" }} tickFormatter={(v) => { const d = new Date(String(v) + "T00:00:00"); return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }} />
              <YAxis tick={{ fontSize: 10, fill: "var(--t-text-muted)" }} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 10, border: "1px solid var(--t-border)", background: "var(--t-bg-card)" }} />
              <Bar dataKey="credit_hold_set" name="Hold Set" fill="#EF4444" radius={[3, 3, 0, 0]} />
              <Bar dataKey="credit_hold_released" name="Hold Released" fill="#22C55E" radius={[3, 3, 0, 0]} />
              <Bar dataKey="booking_override" name="Booking Override" fill="#F59E0B" radius={[3, 3, 0, 0]} />
              <Bar dataKey="dispatch_override" name="Dispatch Override" fill="#3B82F6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Section 3 + 4 — Two-column tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Top customers */}
        <div className="rounded-[20px] border p-5" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
          <h2 className="text-sm font-bold mb-3" style={{ color: "var(--t-text-primary)" }}>
            <Users className="h-4 w-4 inline mr-1.5" style={{ color: "var(--t-accent)" }} />
            {label("credit_analytics_top_customers", "Top Customers")}
          </h2>
          {loading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-8 rounded animate-pulse" style={{ background: "var(--t-bg-elevated)" }} />)}</div>
          ) : topCustomers.length === 0 ? (
            <p className="text-xs py-6 text-center" style={{ color: "var(--t-text-muted)" }}>{label("credit_analytics_empty_customers", "No customer events recorded")}</p>
          ) : (
            <div className="space-y-0">
              <div className="grid grid-cols-[1fr_60px_60px_80px] gap-2 pb-2 text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--t-text-muted)", borderBottom: "1px solid var(--t-border)" }}>
                <span>{label("credit_analytics_col_customer", "Customer")}</span>
                <span className="text-right">{label("credit_analytics_col_holds", "Holds")}</span>
                <span className="text-right">{label("credit_analytics_col_overrides", "Overrides")}</span>
                <span className="text-right">{label("credit_analytics_col_last", "Last Event")}</span>
              </div>
              {topCustomers.map((c) => (
                <div key={c.customer_id} className="grid grid-cols-[1fr_60px_60px_80px] gap-2 py-2 items-center text-xs" style={{ borderBottom: "1px solid var(--t-border)" }}>
                  <Link href={`/customers/${c.customer_id}`} className="truncate font-medium" style={{ color: "var(--t-accent)" }}>{c.customer_name}</Link>
                  <span className="text-right tabular-nums" style={{ color: "var(--t-text-primary)" }}>{c.hold_events}</span>
                  <span className="text-right tabular-nums" style={{ color: "var(--t-text-primary)" }}>{c.override_events}</span>
                  <span className="text-right tabular-nums" style={{ color: "var(--t-text-muted)" }}>{new Date(c.last_event).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top users / overriders */}
        <div className="rounded-[20px] border p-5" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
          <h2 className="text-sm font-bold mb-3" style={{ color: "var(--t-text-primary)" }}>
            <UserCheck className="h-4 w-4 inline mr-1.5" style={{ color: "var(--t-accent)" }} />
            {label("credit_analytics_top_users", "Top Overriders")}
          </h2>
          {loading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-8 rounded animate-pulse" style={{ background: "var(--t-bg-elevated)" }} />)}</div>
          ) : topUsers.length === 0 ? (
            <p className="text-xs py-6 text-center" style={{ color: "var(--t-text-muted)" }}>{label("credit_analytics_empty_users", "No overrides recorded")}</p>
          ) : (
            <div className="space-y-0">
              <div className="grid grid-cols-[1fr_70px_70px_60px] gap-2 pb-2 text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--t-text-muted)", borderBottom: "1px solid var(--t-border)" }}>
                <span>{label("credit_analytics_col_user", "User")}</span>
                <span className="text-right">{label("credit_analytics_col_booking", "Booking")}</span>
                <span className="text-right">{label("credit_analytics_col_dispatch", "Dispatch")}</span>
                <span className="text-right">{label("credit_analytics_col_total", "Total")}</span>
              </div>
              {topUsers.map((u, idx) => (
                <div key={u.user_id ?? `system-${idx}`} className="grid grid-cols-[1fr_70px_70px_60px] gap-2 py-2 items-center text-xs" style={{ borderBottom: "1px solid var(--t-border)" }}>
                  <span className="truncate font-mono text-[11px]" style={{ color: "var(--t-text-primary)" }}>{u.user_id ? `${u.user_id.slice(0, 8)}...` : "system"}</span>
                  <span className="text-right tabular-nums" style={{ color: "var(--t-text-primary)" }}>{u.booking_overrides}</span>
                  <span className="text-right tabular-nums" style={{ color: "var(--t-text-primary)" }}>{u.dispatch_overrides}</span>
                  <span className="text-right tabular-nums font-semibold" style={{ color: "var(--t-accent)" }}>{u.total}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Link to full audit log */}
      <div className="text-center">
        <Link href="/credit-audit" className="text-xs font-medium" style={{ color: "var(--t-accent)" }}>
          {label("credit_analytics_view_audit_log", "View Full Audit Log")} →
        </Link>
      </div>
    </div>
  );
}

/* ── MetricCard ── */

function MetricCard({ icon: Icon, label: cardLabel, value, suffix, color, loading }: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  value: number | undefined | null;
  suffix?: string;
  color: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-[14px] border p-4" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4" style={{ color }} />
        <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--t-text-muted)" }}>{cardLabel}</span>
      </div>
      {loading ? (
        <div className="h-7 w-16 rounded animate-pulse" style={{ background: "var(--t-bg-elevated)" }} />
      ) : (
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold tabular-nums" style={{ color }}>{value ?? 0}</span>
          {suffix && <span className="text-[10px]" style={{ color: "var(--t-text-muted)" }}>{suffix}</span>}
        </div>
      )}
    </div>
  );
}
