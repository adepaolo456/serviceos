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
        <div className="mb-8 h-8 w-64 animate-pulse rounded bg-gray-200" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-200" />
          ))}
        </div>
      </div>
    );
  }

  const stats = [
    { label: "Monthly Revenue", value: `$${(data?.mrr ?? 0).toLocaleString()}`, icon: DollarSign, color: "bg-emerald-50 text-emerald-600", href: "/admin/subscriptions" },
    { label: "Total Tenants", value: String(data?.totalTenants ?? 0), icon: Building2, color: "bg-blue-50 text-blue-600", href: "/admin/tenants" },
    { label: "Active Subscriptions", value: String(data?.activeSubs ?? 0), icon: CreditCard, color: "bg-purple-50 text-purple-600", href: "/admin/subscriptions" },
    { label: "New This Week", value: String(data?.newSignupsThisWeek ?? 0), icon: UserPlus, color: "bg-amber-50 text-amber-600", href: "/admin/tenants" },
    { label: "Total Users", value: String(data?.totalUsers ?? 0), icon: Users, color: "bg-indigo-50 text-indigo-600", href: "/admin/tenants" },
    { label: "Total Jobs", value: String(data?.totalJobs ?? 0), icon: Briefcase, color: "bg-cyan-50 text-cyan-600", href: "/admin/tenants" },
    { label: "Total Customers", value: String(data?.totalCustomers ?? 0), icon: TrendingUp, color: "bg-pink-50 text-pink-600", href: "/admin/tenants" },
    { label: "Total Assets", value: String(data?.totalAssets ?? 0), icon: Box, color: "bg-orange-50 text-orange-600", href: "/admin/tenants" },
  ];

  const tierColors: Record<string, string> = {
    trial: "bg-gray-100 text-gray-600",
    starter: "bg-blue-100 text-blue-700",
    professional: "bg-purple-100 text-purple-700",
    business: "bg-amber-100 text-amber-700",
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Platform Overview</h1>
        <p className="mt-1 text-sm text-gray-500">ServiceOS SaaS metrics at a glance</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="group relative rounded-xl border border-gray-200 bg-white p-5 shadow-sm cursor-pointer transition-all hover:shadow-lg hover:border-[#2ECC71]/30"
          >
            <ArrowUpRight className="absolute top-4 right-4 h-4 w-4 text-gray-300 opacity-0 transition-opacity group-hover:opacity-100 group-hover:text-[#2ECC71]" />
            <div className="flex items-center gap-3 mb-3">
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${s.color}`}>
                <s.icon className="h-4.5 w-4.5" />
              </div>
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{s.label}</span>
            </div>
            <p className="text-3xl font-bold text-gray-900 tabular-nums">{s.value}</p>
          </Link>
        ))}
      </div>

      {/* Tier breakdown */}
      <div className="mt-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900 mb-4">Subscription Breakdown</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(data?.tierBreakdown ?? []).map((t) => (
            <Link
              key={t.tier}
              href={`/admin/tenants?tier=${t.tier}`}
              className="group rounded-lg bg-gray-50 p-4 text-center cursor-pointer transition-all hover:bg-gray-100 hover:ring-1 hover:ring-[#2ECC71]/30"
            >
              <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium capitalize ${tierColors[t.tier] || tierColors.trial}`}>
                {t.tier}
              </span>
              <p className="mt-2 text-2xl font-bold text-gray-900 tabular-nums">{t.count}</p>
              <p className="text-xs text-gray-500">tenants</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
