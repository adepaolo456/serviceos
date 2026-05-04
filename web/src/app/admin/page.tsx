"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Building2,
  Users,
  Briefcase,
  DollarSign,
  TrendingUp,
  CreditCard,
  UserPlus,
  Box,
  ArrowUpRight,
} from "lucide-react";
import { api } from "@/lib/api";

interface Dashboard {
  totalTenants: number;
  totalUsers: number;
  totalJobs: number;
  totalCustomers: number;
  totalAssets: number;
  activeSubs: number;
  newSignupsThisWeek: number;
  mrr: number;
  tierBreakdown: Array<{ tier: string; count: number }>;
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<Dashboard>("/admin/dashboard")
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div>
        <div className="mb-8 h-8 w-64 animate-pulse rounded bg-[var(--t-bg-card)]" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)]" />
          ))}
        </div>
      </div>
    );
  }

  const stats = [
    { label: "Monthly Revenue", value: `$${(data?.mrr ?? 0).toLocaleString()}`, icon: DollarSign, href: "/admin/subscriptions" },
    { label: "Total Tenants", value: String(data?.totalTenants ?? 0), icon: Building2, href: "/admin/tenants" },
    { label: "Active Subscriptions", value: String(data?.activeSubs ?? 0), icon: CreditCard, href: "/admin/subscriptions" },
    { label: "New This Week", value: String(data?.newSignupsThisWeek ?? 0), icon: UserPlus, href: "/admin/tenants" },
    { label: "Total Users", value: String(data?.totalUsers ?? 0), icon: Users, href: "/admin/tenants" },
    { label: "Total Jobs", value: String(data?.totalJobs ?? 0), icon: Briefcase, href: "/admin/tenants" },
    { label: "Total Customers", value: String(data?.totalCustomers ?? 0), icon: TrendingUp, href: "/admin/tenants" },
    { label: "Total Assets", value: String(data?.totalAssets ?? 0), icon: Box, href: "/admin/tenants" },
  ];

  const tierColors: Record<string, string> = {
    trial: "text-[var(--t-text-muted)]",
    starter: "text-blue-400",
    professional: "text-purple-400",
    business: "text-amber-400",
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-[28px] font-bold tracking-[-1px]" style={{ color: "var(--t-frame-text)" }}>Platform Overview</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--t-frame-text-muted)" }}>RentThisApp SaaS metrics at a glance</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="group relative rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5 cursor-pointer transition-colors hover:bg-[var(--t-bg-card-hover)]"
          >
            <ArrowUpRight className="absolute top-4 right-4 h-4 w-4 text-[var(--t-text-muted)] opacity-0 transition-opacity group-hover:opacity-100 group-hover:text-[var(--t-accent)]" />
            <div className="flex items-center gap-3 mb-3">
              <s.icon className="h-4.5 w-4.5 text-[var(--t-text-muted)]" />
              <span className="text-xs font-medium text-[var(--t-text-muted)] uppercase tracking-wider">{s.label}</span>
            </div>
            <p className="text-3xl font-bold text-[var(--t-text-primary)] tabular-nums">{s.value}</p>
          </Link>
        ))}
      </div>

      {/* Tier breakdown */}
      <div className="mt-8 rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6">
        <h2 className="text-base font-semibold text-[var(--t-text-primary)] mb-4">Subscription Breakdown</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(data?.tierBreakdown ?? []).map((t) => (
            <Link
              key={t.tier}
              href={`/admin/tenants?tier=${t.tier}`}
              className="group rounded-[20px] border border-[var(--t-border)] p-4 text-center cursor-pointer transition-colors hover:bg-[var(--t-bg-card-hover)]"
            >
              <span className={`text-xs font-medium capitalize ${tierColors[t.tier] || tierColors.trial}`}>
                {t.tier}
              </span>
              <p className="mt-2 text-2xl font-bold text-[var(--t-text-primary)] tabular-nums">{t.count}</p>
              <p className="text-xs text-[var(--t-text-muted)]">tenants</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
