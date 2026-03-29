"use client";

import {
  DollarSign,
  Briefcase,
  Users,
  Box,
  TrendingUp,
  TrendingDown,
  ArrowRight,
} from "lucide-react";

interface StatCardProps {
  title: string;
  value: string;
  change: string;
  trend: "up" | "down";
  icon: React.ElementType;
}

function StatCard({ title, value, change, trend, icon: Icon }: StatCardProps) {
  return (
    <div className="group rounded-2xl bg-dark-card p-6 transition-colors hover:bg-dark-card-hover">
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
        <p className="font-display text-3xl font-bold tracking-tight text-white">
          {value}
        </p>
        <p className="mt-1 text-sm text-muted">{title}</p>
      </div>
    </div>
  );
}

interface ActivityItem {
  id: string;
  text: string;
  time: string;
}

const recentActivity: ActivityItem[] = [
  { id: "1", text: "Job #JOB-20260329-001 completed", time: "2 min ago" },
  { id: "2", text: "New customer: Acme Construction", time: "15 min ago" },
  { id: "3", text: "Invoice INV-2026-0042 paid — $450.00", time: "1 hr ago" },
  { id: "4", text: "20yd dumpster D-014 deployed to 456 Oak Ave", time: "2 hr ago" },
  { id: "5", text: "Marketplace booking RT-2026-XYZ accepted", time: "3 hr ago" },
];

export default function DashboardPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold tracking-tight text-white">
          Dashboard
        </h1>
        <p className="mt-1 text-muted">
          Welcome back. Here&apos;s your business at a glance.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Revenue"
          value="$48,250"
          change="+12.5%"
          trend="up"
          icon={DollarSign}
        />
        <StatCard
          title="Active Jobs"
          value="24"
          change="+8.2%"
          trend="up"
          icon={Briefcase}
        />
        <StatCard
          title="Total Customers"
          value="156"
          change="+4.1%"
          trend="up"
          icon={Users}
        />
        <StatCard
          title="Asset Utilization"
          value="78%"
          change="-2.3%"
          trend="down"
          icon={Box}
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-2xl bg-dark-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-white">
              Recent Activity
            </h2>
            <button className="flex items-center gap-1 text-sm text-brand hover:text-brand-light transition-colors">
              View all <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-4 space-y-0">
            {recentActivity.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between border-b border-white/5 py-3.5 last:border-0"
              >
                <p className="text-sm text-foreground">{item.text}</p>
                <span className="ml-4 shrink-0 text-xs text-muted">
                  {item.time}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl bg-dark-card p-6">
          <h2 className="font-display text-lg font-semibold text-white">
            Jobs by Status
          </h2>
          <div className="mt-4 space-y-3">
            {[
              { label: "Pending", count: 8, pct: 33, color: "bg-yellow-500" },
              { label: "Confirmed", count: 6, pct: 25, color: "bg-blue-500" },
              { label: "In Progress", count: 5, pct: 21, color: "bg-brand" },
              { label: "Completed", count: 4, pct: 17, color: "bg-emerald-600" },
              { label: "Cancelled", count: 1, pct: 4, color: "bg-red-500" },
            ].map((item) => (
              <div key={item.label}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{item.label}</span>
                  <span className="text-muted">{item.count}</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full rounded-full bg-dark-elevated">
                  <div
                    className={`h-full rounded-full ${item.color}`}
                    style={{ width: `${item.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
