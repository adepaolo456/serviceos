"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  DollarSign,
  TrendingUp,
  AlertTriangle,
  Activity,
  CheckCircle2,
  Repeat,
  ChevronUp,
  ChevronDown,
  ArrowRight,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";

/* ── Types (mirror backend) ── */

interface LifecycleSummary {
  total_rental_revenue: number;
  total_lifecycle_cost: number;
  total_profit: number;
  average_rental_duration: number;
  active_rentals: number;
  overdue_rentals: number;
  completed_rentals: number;
  exchange_rate: number;
  revenue_per_chain: number;
  profit_per_chain: number;
  standalone_jobs: number;
}

interface LifecycleChainRow {
  chain_id: string;
  customer_name: string;
  address: string;
  dumpster_size: string;
  drop_off_date: string;
  expected_pickup_date: string | null;
  actual_pickup_date: string | null;
  status: string;
  revenue: number;
  cost: number;
  profit: number;
  duration_days: number | null;
  exchange_count: number;
}

interface TrendPoint {
  period: string;
  revenue: number;
  cost: number;
  profit: number;
  completed_chains: number;
}

interface LifecycleReport {
  summary: LifecycleSummary;
  chains: LifecycleChainRow[];
  trend: TrendPoint[];
}

type SortKey =
  | "customer_name"
  | "drop_off_date"
  | "status"
  | "revenue"
  | "cost"
  | "profit"
  | "duration_days"
  | "exchange_count";

type StatusFilter = "all" | "active" | "completed";
type GroupBy = "day" | "week" | "month";

/* ── Helpers ── */

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().split("T")[0];
}

/* ── Page ── */

export default function LifecycleReportPage() {
  const [startDate, setStartDate] = useState(monthsAgo(3));
  const [endDate, setEndDate] = useState(today());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("month");
  const [report, setReport] = useState<LifecycleReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("drop_off_date");
  const [sortDesc, setSortDesc] = useState(true);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
        status: statusFilter,
        groupBy,
      });
      const data = await api.get<LifecycleReport>(
        `/reporting/lifecycle?${params.toString()}`,
      );
      setReport(data);
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, statusFilter, groupBy]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const sortedChains = useMemo(() => {
    if (!report) return [];
    const rows = [...report.chains];
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return sortDesc ? bv - av : av - bv;
      }
      const as = String(av);
      const bs = String(bv);
      return sortDesc ? bs.localeCompare(as) : as.localeCompare(bs);
    });
    return rows;
  }, [report, sortKey, sortDesc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return null;
    return sortDesc ? (
      <ChevronDown className="inline h-3 w-3" />
    ) : (
      <ChevronUp className="inline h-3 w-3" />
    );
  };

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-xl font-bold text-[var(--t-text-primary)]">
          {FEATURE_REGISTRY.lifecycle_reporting?.label ?? "Lifecycle Reporting"}
        </h1>
        <p className="text-sm text-[var(--t-text-muted)] mt-1">
          KPIs computed per rental chain, not per task — revenue, cost,
          duration, and exchange rate across full rental lifecycles.
        </p>
      </div>

      {/* Filters */}
      <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)] block mb-1">
              Start date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-[12px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)]"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)] block mb-1">
              End date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-[12px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)]"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)] block mb-1">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="rounded-[12px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)]"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)] block mb-1">
              Group by
            </label>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              className="rounded-[12px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)]"
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          icon={<DollarSign className="h-4 w-4" />}
          label={FEATURE_REGISTRY.total_rental_revenue?.label ?? "Total Revenue"}
          value={loading || !report ? "—" : formatCurrency(report.summary.total_rental_revenue)}
          sub={
            loading || !report
              ? ""
              : `${FEATURE_REGISTRY.revenue_per_chain?.label ?? "Revenue per Chain"}: ${formatCurrency(report.summary.revenue_per_chain)}`
          }
        />
        <KpiCard
          icon={<TrendingUp className="h-4 w-4" />}
          label={FEATURE_REGISTRY.total_profit?.label ?? "Total Profit"}
          value={loading || !report ? "—" : formatCurrency(report.summary.total_profit)}
          sub={
            loading || !report
              ? ""
              : `${FEATURE_REGISTRY.profit_per_chain?.label ?? "Profit per Chain"}: ${formatCurrency(report.summary.profit_per_chain)}`
          }
          accent={report && report.summary.total_profit >= 0 ? "positive" : "negative"}
        />
        <KpiCard
          icon={<Activity className="h-4 w-4" />}
          label={FEATURE_REGISTRY.active_rentals_kpi?.label ?? "Active Rentals"}
          value={loading || !report ? "—" : String(report.summary.active_rentals)}
          sub={
            loading || !report
              ? ""
              : `${FEATURE_REGISTRY.average_rental_duration?.label ?? "Avg. Rental Duration"}: ${report.summary.average_rental_duration}d`
          }
        />
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label={FEATURE_REGISTRY.overdue_rentals_kpi?.label ?? "Overdue Rentals"}
          value={loading || !report ? "—" : String(report.summary.overdue_rentals)}
          accent={report && report.summary.overdue_rentals > 0 ? "warning" : undefined}
        />
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label={FEATURE_REGISTRY.completed_rentals_kpi?.label ?? "Completed Rentals"}
          value={loading || !report ? "—" : String(report.summary.completed_rentals)}
        />
        <KpiCard
          icon={<Repeat className="h-4 w-4" />}
          label={FEATURE_REGISTRY.exchange_rate_kpi?.label ?? "Exchange Rate"}
          value={loading || !report ? "—" : `${report.summary.exchange_rate.toFixed(1)}%`}
        />
      </div>

      {/* Trend chart */}
      <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5">
        <h2 className="text-sm font-semibold text-[var(--t-text-primary)] mb-4">
          Revenue & Profit Trend
        </h2>
        <div className="w-full h-64">
          {report && report.trend.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={report.trend} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--t-border)" />
                <XAxis
                  dataKey="period"
                  stroke="var(--t-text-muted)"
                  style={{ fontSize: 11 }}
                />
                <YAxis
                  stroke="var(--t-text-muted)"
                  style={{ fontSize: 11 }}
                  tickFormatter={(v) => `$${Math.round(Number(v)).toLocaleString()}`}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--t-bg-elevated)",
                    border: "1px solid var(--t-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v) => formatCurrency(Number(v ?? 0))}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="revenue" stroke="#22C55E" strokeWidth={2} dot={false} name="Revenue" />
                <Line type="monotone" dataKey="profit" stroke="var(--t-accent)" strokeWidth={2} dot={false} name="Profit" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-[var(--t-text-muted)]">
              {loading ? "Loading…" : "No data in range"}
            </div>
          )}
        </div>
      </div>

      {/* Performance table */}
      <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5">
        <h2 className="text-sm font-semibold text-[var(--t-text-primary)] mb-4">
          {FEATURE_REGISTRY.lifecycle_performance?.label ?? "Lifecycle Performance"} ({sortedChains.length})
        </h2>
        {loading && !report ? (
          <p className="text-xs text-[var(--t-text-muted)] py-6 text-center">Loading…</p>
        ) : sortedChains.length === 0 ? (
          <p className="text-xs text-[var(--t-text-muted)] py-6 text-center">No chains in range</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--t-border)] text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)]">
                  <th className="pb-2 pr-3 text-left cursor-pointer" onClick={() => toggleSort("customer_name")}>
                    Customer {sortIcon("customer_name")}
                  </th>
                  <th className="pb-2 pr-3 text-left">Address</th>
                  <th className="pb-2 pr-3 text-left">Size</th>
                  <th className="pb-2 pr-3 text-left cursor-pointer" onClick={() => toggleSort("drop_off_date")}>
                    Delivery {sortIcon("drop_off_date")}
                  </th>
                  <th className="pb-2 pr-3 text-left">Pickup</th>
                  <th className="pb-2 pr-3 text-left cursor-pointer" onClick={() => toggleSort("status")}>
                    Status {sortIcon("status")}
                  </th>
                  <th className="pb-2 pr-3 text-right cursor-pointer" onClick={() => toggleSort("revenue")}>
                    Revenue {sortIcon("revenue")}
                  </th>
                  <th className="pb-2 pr-3 text-right cursor-pointer" onClick={() => toggleSort("cost")}>
                    Cost {sortIcon("cost")}
                  </th>
                  <th className="pb-2 pr-3 text-right cursor-pointer" onClick={() => toggleSort("profit")}>
                    Profit {sortIcon("profit")}
                  </th>
                  <th className="pb-2 pr-3 text-right cursor-pointer" onClick={() => toggleSort("duration_days")}>
                    Days {sortIcon("duration_days")}
                  </th>
                  <th className="pb-2 pr-0 text-right cursor-pointer" onClick={() => toggleSort("exchange_count")}>
                    XC {sortIcon("exchange_count")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedChains.map((row) => {
                  const isOverdue =
                    row.status === "active" &&
                    row.expected_pickup_date &&
                    row.expected_pickup_date < today();
                  return (
                    <tr
                      key={row.chain_id}
                      className={`border-b border-[var(--t-border)]/50 hover:bg-[var(--t-bg-card-hover)] cursor-pointer transition-colors ${
                        isOverdue ? "bg-amber-500/5" : ""
                      }`}
                      onClick={() => (window.location.href = `/rentals/${row.chain_id}`)}
                    >
                      <td className="py-2 pr-3 font-medium text-[var(--t-text-primary)]">{row.customer_name}</td>
                      <td className="py-2 pr-3 text-[var(--t-text-muted)] max-w-[200px] truncate">{row.address}</td>
                      <td className="py-2 pr-3 text-[var(--t-text-muted)]">{row.dumpster_size || "—"}</td>
                      <td className="py-2 pr-3 text-[var(--t-text-muted)]">{fmtDate(row.drop_off_date)}</td>
                      <td className="py-2 pr-3 text-[var(--t-text-muted)]">
                        {fmtDate(row.actual_pickup_date || row.expected_pickup_date)}
                        {isOverdue && (
                          <span className="ml-1 text-[10px] font-semibold text-amber-500">OVERDUE</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-[var(--t-text-muted)] capitalize">{row.status}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-[var(--t-text-primary)]">
                        {formatCurrency(row.revenue)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-[var(--t-text-muted)]">
                        {formatCurrency(row.cost)}
                      </td>
                      <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${row.profit >= 0 ? "text-[var(--t-accent)]" : "text-[var(--t-error)]"}`}>
                        {formatCurrency(row.profit)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-[var(--t-text-muted)]">
                        {row.duration_days ?? "—"}
                      </td>
                      <td className="py-2 pr-0 text-right tabular-nums text-[var(--t-text-muted)]">
                        {row.exchange_count}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Standalone cleanup widget */}
      {report && report.summary.standalone_jobs > 0 && (
        <Link
          href="/admin/legacy-backfill"
          className="block rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-4 hover:border-[var(--t-accent)] transition-colors"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)]">
                {FEATURE_REGISTRY.standalone_jobs_remaining?.label ?? "Standalone Jobs Remaining"}
              </p>
              <p className="text-lg font-bold text-[var(--t-text-primary)] mt-0.5">
                {report.summary.standalone_jobs}
              </p>
              <p className="text-[11px] text-[var(--t-text-muted)] mt-0.5">
                These jobs aren&apos;t part of any rental chain yet. Review and link them in the legacy backfill page.
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-[var(--t-accent)]" />
          </div>
        </Link>
      )}
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: "positive" | "negative" | "warning";
}) {
  const accentClass =
    accent === "positive"
      ? "text-[var(--t-accent)]"
      : accent === "negative"
        ? "text-[var(--t-error)]"
        : accent === "warning"
          ? "text-amber-500"
          : "text-[var(--t-text-primary)]";
  return (
    <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-4">
      <div className="flex items-center gap-2 mb-2 text-[var(--t-text-muted)]">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-lg font-bold tabular-nums ${accentClass}`}>{value}</p>
      {sub && <p className="text-[10px] text-[var(--t-text-muted)] mt-1 truncate">{sub}</p>}
    </div>
  );
}
