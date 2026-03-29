"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  DollarSign,
  Briefcase,
  Users,
  Box,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  ArrowUpRight,
  Activity,
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

interface UserProfile {
  firstName: string;
  lastName: string;
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
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
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [d, j, u] = await Promise.all([
          api.get<DashboardData>("/analytics/dashboard"),
          api.get<StatusCount[]>("/analytics/jobs-by-status"),
          api.get<UserProfile>("/auth/profile"),
        ]);
        setDashboard(d);
        setJobsByStatus(j);
        setUser(u);
      } catch {
        /* handled */
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
          <div className="h-8 w-64 skeleton rounded" />
          <div className="mt-2 h-4 w-48 skeleton rounded" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 skeleton rounded-2xl" />
          ))}
        </div>
        <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="h-80 skeleton rounded-2xl" />
          <div className="h-80 skeleton rounded-2xl" />
        </div>
      </div>
    );
  }

  const totalJobs = jobsByStatus.reduce((s, c) => s + Number(c.count), 0);

  const stats = [
    {
      label: "Total Revenue",
      value: `$${(dashboard?.revenue.total ?? 0).toLocaleString()}`,
      sub: dashboard?.revenue.thisMonth
        ? `+$${dashboard.revenue.thisMonth.toLocaleString()} this month`
        : "No revenue yet",
      trend: "up" as const,
      icon: DollarSign,
      href: "/invoices",
    },
    {
      label: "Active Jobs",
      value: String(dashboard?.jobs.thisMonth ?? 0),
      sub: `${dashboard?.jobs.total ?? 0} total`,
      trend: "up" as const,
      icon: Briefcase,
      href: "/jobs",
    },
    {
      label: "Customers",
      value: String(dashboard?.customers.total ?? 0),
      sub: `+${dashboard?.customers.newThisMonth ?? 0} this month`,
      trend: (dashboard?.customers.newThisMonth ?? 0) > 0 ? ("up" as const) : ("down" as const),
      icon: Users,
      href: "/customers",
    },
    {
      label: "Utilization",
      value: `${dashboard?.assets.utilizationRate ?? 0}%`,
      sub: `${dashboard?.assets.total ?? 0} assets`,
      trend: (dashboard?.assets.utilizationRate ?? 0) >= 50 ? ("up" as const) : ("down" as const),
      icon: Box,
      href: "/assets",
    },
  ];

  return (
    <div>
      {/* Greeting */}
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">
          {getGreeting()}, {user?.firstName || "there"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          Here&apos;s how your business is doing today.
        </p>
      </div>

      {/* Stat cards — Robinhood style */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="group relative rounded-2xl border border-[#1E2D45] bg-dark-card p-5 card-hover cursor-pointer"
          >
            <ArrowUpRight className="absolute top-4 right-4 h-4 w-4 text-muted opacity-0 group-hover:opacity-100 group-hover:text-brand transition-opacity" />
            <div className="flex items-center gap-2 mb-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10">
                <s.icon className="h-4 w-4 text-brand" />
              </div>
              <span className="text-xs font-medium text-muted uppercase tracking-wider">{s.label}</span>
            </div>
            <p className="font-display text-3xl font-bold tracking-tight tabular-nums text-white">
              {s.value}
            </p>
            <div className="mt-2 flex items-center gap-1.5">
              {s.trend === "up" ? (
                <TrendingUp className="h-3 w-3 text-brand" />
              ) : (
                <TrendingDown className="h-3 w-3 text-red-400" />
              )}
              <span className={`text-xs font-medium ${s.trend === "up" ? "text-brand" : "text-red-400"}`}>
                {s.sub}
              </span>
            </div>
          </Link>
        ))}
      </div>

      {/* Bottom grid */}
      <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Job Performance */}
        <div className="rounded-2xl border border-[#1E2D45] bg-dark-card p-6 card-hover">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-brand" />
              <h2 className="font-display text-base font-semibold text-white">
                Job Performance
              </h2>
            </div>
            <Link href="/jobs" className="flex items-center gap-1 text-xs text-brand hover:text-brand-light transition-colors btn-press">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="space-y-0">
            {[
              { label: "Total Jobs", value: dashboard?.jobs.total ?? 0, color: "text-white" },
              { label: "Completed", value: dashboard?.jobs.completed ?? 0, color: "text-brand" },
              { label: "Cancelled", value: dashboard?.jobs.cancelled ?? 0, color: "text-red-400" },
              { label: "Avg Value", value: `$${(dashboard?.jobs.averageValue ?? 0).toFixed(0)}`, color: "text-white" },
              { label: "New Customers", value: dashboard?.customers.newThisMonth ?? 0, color: "text-white" },
            ].map((row, i, arr) => (
              <div
                key={row.label}
                className={`flex items-center justify-between py-3.5 ${i < arr.length - 1 ? "border-b border-[#1E2D45]" : ""}`}
              >
                <span className="text-sm text-muted">{row.label}</span>
                <span className={`text-sm font-semibold tabular-nums ${row.color}`}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Jobs by Status */}
        <div className="rounded-2xl border border-[#1E2D45] bg-dark-card p-6 card-hover">
          <div className="flex items-center gap-2 mb-5">
            <Briefcase className="h-4 w-4 text-brand" />
            <h2 className="font-display text-base font-semibold text-white">
              Jobs by Status
            </h2>
          </div>
          {jobsByStatus.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Briefcase className="h-12 w-12 text-[#7A8BA3]/20 mb-3" />
              <p className="text-sm font-medium text-muted">No jobs yet</p>
              <p className="text-xs text-muted/70 mt-1">Create your first job to see status breakdown</p>
            </div>
          ) : (
            <div className="space-y-3">
              {jobsByStatus.map((item) => {
                const pct = totalJobs > 0 ? Math.round((Number(item.count) / totalJobs) * 100) : 0;
                return (
                  <Link key={item.status} href={`/jobs?status=${item.status}`} className="block group">
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="text-foreground capitalize group-hover:text-brand transition-colors">{item.status.replace(/_/g, " ")}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted tabular-nums">{pct}%</span>
                        <span className="text-sm font-medium text-white tabular-nums w-6 text-right">{item.count}</span>
                      </div>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-dark-elevated overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${STATUS_COLORS[item.status] || "bg-zinc-500"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
