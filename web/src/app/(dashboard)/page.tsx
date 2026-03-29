"use client";

import { useState, useEffect } from "react";
import {
  DollarSign,
  Briefcase,
  Users,
  Box,
  TrendingUp,
  TrendingDown,
  ArrowRight,
} from "lucide-react";
import { api } from "@/lib/api";

interface DashboardData {
  revenue: { total: number; thisMonth: number };
  jobs: {
    total: number;
    thisMonth: number;
    completed: number;
    cancelled: number;
    averageValue: number;
  };
  customers: { total: number; newThisMonth: number };
  assets: {
    total: number;
    byStatus: Array<{ status: string; count: number }>;
    utilizationRate: number;
  };
}

interface StatusCount {
  status: string;
  count: number;
}

interface StatCardProps {
  title: string;
  value: string;
  change: string;
  trend: "up" | "down";
  icon: React.ElementType;
}

function StatCard({ title, value, change, trend, icon: Icon }: StatCardProps) {
  return (
    <div className="group rounded-2xl border border-[#1E2D45] shadow-lg shadow-black/10 bg-dark-card p-6 transition-colors hover:bg-dark-card-hover">
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10">
          <Icon className="h-5 w-5 text-brand" />
        </div>
        <div
          className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
            trend === "up"
              ? "bg-brand/10 text-brand"
              : "bg-red-500/10 text-red-400"
          }`}
        >
          {trend === "up" ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          {change}
        </div>
      </div>
      <div className="mt-4">
        <p className="font-display text-3xl font-bold tracking-tight tabular-nums text-white">
          {value}
        </p>
        <p className="mt-1 text-sm text-muted">{title}</p>
      </div>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500",
  confirmed: "bg-blue-500",
  dispatched: "bg-purple-500",
  en_route: "bg-orange-500",
  in_progress: "bg-brand",
  completed: "bg-emerald-600",
  cancelled: "bg-red-500",
};

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [jobsByStatus, setJobsByStatus] = useState<StatusCount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [d, j] = await Promise.all([
          api.get<DashboardData>("/analytics/dashboard"),
          api.get<StatusCount[]>("/analytics/jobs-by-status"),
        ]);
        setDashboard(d);
        setJobsByStatus(j);
      } catch {
        /* handled by api client */
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div>
        <div className="mb-8">
          <div className="h-8 w-48 skeleton rounded" />
          <div className="mt-2 h-4 w-72 skeleton rounded" />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 skeleton rounded-2xl" />
          ))}
        </div>
        <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="h-72 skeleton rounded-2xl" />
          <div className="h-72 skeleton rounded-2xl" />
        </div>
      </div>
    );
  }

  const totalJobs = jobsByStatus.reduce((s, c) => s + Number(c.count), 0);

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">
          Dashboard
        </h1>
        <p className="mt-1 text-muted">
          Welcome back. Here&apos;s your business at a glance.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Revenue"
          value={`$${(dashboard?.revenue.total ?? 0).toLocaleString()}`}
          change={dashboard?.revenue.thisMonth ? `$${dashboard.revenue.thisMonth.toLocaleString()} this mo` : "—"}
          trend="up"
          icon={DollarSign}
        />
        <StatCard
          title="Active Jobs"
          value={String(dashboard?.jobs.thisMonth ?? 0)}
          change={`${dashboard?.jobs.total ?? 0} total`}
          trend="up"
          icon={Briefcase}
        />
        <StatCard
          title="Total Customers"
          value={String(dashboard?.customers.total ?? 0)}
          change={`+${dashboard?.customers.newThisMonth ?? 0} this month`}
          trend={dashboard?.customers.newThisMonth ? "up" : "down"}
          icon={Users}
        />
        <StatCard
          title="Asset Utilization"
          value={`${dashboard?.assets.utilizationRate ?? 0}%`}
          change={`${dashboard?.assets.total ?? 0} total assets`}
          trend={(dashboard?.assets.utilizationRate ?? 0) >= 50 ? "up" : "down"}
          icon={Box}
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Recent jobs summary */}
        <div className="rounded-2xl border border-[#1E2D45] shadow-lg shadow-black/10 bg-dark-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-white">
              Job Performance
            </h2>
            <a href="/jobs" className="flex items-center gap-1 text-sm text-brand hover:text-brand-light transition-colors">
              View all <ArrowRight className="h-4 w-4" />
            </a>
          </div>
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between border-b border-[#1E2D45] pb-3">
              <span className="text-sm text-foreground">Total Jobs</span>
              <span className="text-sm font-medium tabular-nums text-white">{dashboard?.jobs.total ?? 0}</span>
            </div>
            <div className="flex items-center justify-between border-b border-[#1E2D45] pb-3">
              <span className="text-sm text-foreground">Completed</span>
              <span className="text-sm font-medium tabular-nums text-brand">{dashboard?.jobs.completed ?? 0}</span>
            </div>
            <div className="flex items-center justify-between border-b border-[#1E2D45] pb-3">
              <span className="text-sm text-foreground">Cancelled</span>
              <span className="text-sm font-medium tabular-nums text-red-400">{dashboard?.jobs.cancelled ?? 0}</span>
            </div>
            <div className="flex items-center justify-between border-b border-[#1E2D45] pb-3">
              <span className="text-sm text-foreground">Avg Job Value</span>
              <span className="text-sm font-medium tabular-nums text-white">${(dashboard?.jobs.averageValue ?? 0).toFixed(0)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">New Customers</span>
              <span className="text-sm font-medium tabular-nums text-white">{dashboard?.customers.newThisMonth ?? 0}</span>
            </div>
          </div>
        </div>

        {/* Jobs by status */}
        <div className="rounded-2xl border border-[#1E2D45] shadow-lg shadow-black/10 bg-dark-card p-6">
          <h2 className="font-display text-lg font-semibold text-white">
            Jobs by Status
          </h2>
          <div className="mt-4 space-y-3">
            {jobsByStatus.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">No jobs yet</p>
            ) : (
              jobsByStatus.map((item) => {
                const pct = totalJobs > 0 ? Math.round((Number(item.count) / totalJobs) * 100) : 0;
                return (
                  <div key={item.status}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-foreground capitalize">{item.status.replace(/_/g, " ")}</span>
                      <span className="text-muted tabular-nums">{item.count}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full rounded-full bg-dark-elevated">
                      <div
                        className={`h-full rounded-full ${STATUS_COLORS[item.status] || "bg-zinc-500"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
