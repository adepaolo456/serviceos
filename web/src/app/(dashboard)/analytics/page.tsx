"use client";

import { useState, useEffect } from "react";
import {
  DollarSign,
  Briefcase,
  Box,
  Users,
  TrendingUp,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";
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

interface RevenueDay {
  date: string;
  revenue: number;
}

interface StatusCount {
  status: string;
  count: number;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "#EAB308",
  confirmed: "#3B82F6",
  dispatched: "#A855F7",
  en_route: "#F97316",
  arrived: "#14B8A6",
  in_progress: "#2ECC71",
  completed: "#10B981",
  cancelled: "#EF4444",
};

const ASSET_STATUS_COLORS: Record<string, string> = {
  available: "#2ECC71",
  on_site: "#EAB308",
  in_transit: "#3B82F6",
  maintenance: "#EF4444",
  retired: "#6B7280",
};

function last30Days(): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return {
    start: start.toISOString().split("T")[0],
    end: end.toISOString().split("T")[0],
  };
}

export default function AnalyticsPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [revenueData, setRevenueData] = useState<RevenueDay[]>([]);
  const [jobsByStatus, setJobsByStatus] = useState<StatusCount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const { start, end } = last30Days();
        const [d, r, j] = await Promise.all([
          api.get<DashboardData>("/analytics/dashboard"),
          api.get<RevenueDay[]>(
            `/analytics/revenue?startDate=${start}&endDate=${end}`
          ),
          api.get<StatusCount[]>("/analytics/jobs-by-status"),
        ]);
        setDashboard(d);
        setRevenueData(r);
        setJobsByStatus(j);
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
          <div className="h-8 w-40 skeleton rounded-lg" />
          <div className="mt-2 h-4 w-56 skeleton rounded-lg" />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 skeleton rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="h-72 skeleton rounded-xl lg:col-span-2" />
          <div className="h-72 skeleton rounded-xl" />
          <div className="h-72 skeleton rounded-xl" />
        </div>
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="flex items-center justify-center py-32 text-muted">
        Failed to load
      </div>
    );
  }

  const totalJobs = jobsByStatus.reduce((s, c) => s + Number(c.count), 0);

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">
          Analytics
        </h1>
        <p className="mt-1 text-muted">Business performance overview</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <KpiCard
          icon={DollarSign}
          label="Total Revenue"
          value={`$${dashboard.revenue.total.toLocaleString()}`}
          sub={`$${dashboard.revenue.thisMonth.toLocaleString()} this month`}
        />
        <KpiCard
          icon={Briefcase}
          label="Jobs This Month"
          value={String(dashboard.jobs.thisMonth)}
          sub={`${dashboard.jobs.total} total · avg $${dashboard.jobs.averageValue.toFixed(0)}`}
        />
        <KpiCard
          icon={Box}
          label="Asset Utilization"
          value={`${dashboard.assets.utilizationRate}%`}
          sub={`${dashboard.assets.total} total assets`}
        />
        <KpiCard
          icon={Users}
          label="New Customers"
          value={String(dashboard.customers.newThisMonth)}
          sub={`${dashboard.customers.total} total`}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Revenue chart */}
        <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-6 lg:col-span-2">
          <div className="flex items-center gap-2 mb-6">
            <TrendingUp className="h-4 w-4 text-brand" />
            <h2 className="font-display text-base font-semibold text-white">
              Revenue — Last 30 Days
            </h2>
          </div>
          <div className="h-72">
            {revenueData.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3">
                <TrendingUp size={48} className="text-[#7A8BA3]/30" />
                <p className="text-sm font-medium text-muted">No revenue data</p>
                <p className="text-xs text-muted">Revenue will appear here once jobs are completed</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueData}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2ECC71" stopOpacity={0.3} />
                      <stop
                        offset="100%"
                        stopColor="#2ECC71"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "#7A8BA3", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: string) => {
                      const d = new Date(v + "T00:00:00");
                      return `${d.getMonth() + 1}/${d.getDate()}`;
                    }}
                  />
                  <YAxis
                    tick={{ fill: "#7A8BA3", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `$${v}`}
                    width={60}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#162033",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 8,
                      color: "#E8ECF1",
                      fontSize: 13,
                    }}
                    formatter={(v) => [`$${Number(v).toLocaleString()}`, "Revenue"]}
                    labelFormatter={(l) => String(l)}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#2ECC71"
                    strokeWidth={2}
                    fill="url(#revGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Jobs by status donut */}
        <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-6">
          <h2 className="font-display text-base font-semibold text-white mb-4">
            Jobs by Status
          </h2>
          {jobsByStatus.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3">
              <Briefcase size={48} className="text-[#7A8BA3]/30" />
              <p className="text-sm font-medium text-muted">No job data</p>
              <p className="text-xs text-muted">Job status breakdown will appear here once jobs are created</p>
            </div>
          ) : (
            <div className="flex items-center gap-6">
              <div className="h-52 w-52 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={jobsByStatus}
                      dataKey="count"
                      nameKey="status"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={80}
                      strokeWidth={0}
                    >
                      {jobsByStatus.map((entry) => (
                        <Cell
                          key={entry.status}
                          fill={STATUS_COLORS[entry.status] || "#6B7280"}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#162033",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 8,
                        color: "#E8ECF1",
                        fontSize: 13,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-2">
                {jobsByStatus.map((s) => (
                  <div
                    key={s.status}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{
                          backgroundColor:
                            STATUS_COLORS[s.status] || "#6B7280",
                        }}
                      />
                      <span className="text-foreground capitalize">
                        {s.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-white font-medium">{s.count}</span>
                      <span className="text-xs text-muted w-8 text-right">
                        {totalJobs > 0
                          ? `${Math.round((Number(s.count) / totalJobs) * 100)}%`
                          : "0%"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Asset utilization bar chart */}
        <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-semibold text-white">
              Asset Utilization
            </h2>
            <span className="text-2xl font-display font-bold text-brand">
              {dashboard.assets.utilizationRate}%
            </span>
          </div>
          {dashboard.assets.byStatus.length === 0 ? (
            <div className="flex h-52 flex-col items-center justify-center gap-3">
              <Box size={48} className="text-[#7A8BA3]/30" />
              <p className="text-sm font-medium text-muted">No assets</p>
              <p className="text-xs text-muted">Asset utilization will appear here once assets are added</p>
            </div>
          ) : (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dashboard.assets.byStatus} barCategoryGap="20%">
                  <XAxis
                    dataKey="status"
                    tick={{ fill: "#7A8BA3", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: string) =>
                      v.replace(/_/g, " ")
                    }
                  />
                  <YAxis
                    tick={{ fill: "#7A8BA3", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                    width={30}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#162033",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 8,
                      color: "#E8ECF1",
                      fontSize: 13,
                    }}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {dashboard.assets.byStatus.map((entry) => (
                      <Cell
                        key={entry.status}
                        fill={ASSET_STATUS_COLORS[entry.status] || "#6B7280"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- KPI Card ---------- */

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-6">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/10">
          <Icon className="h-4 w-4 text-brand" />
        </div>
        <span className="text-sm font-medium text-muted">{label}</span>
      </div>
      <p className="font-display text-3xl font-bold tracking-tight text-white tabular-nums">
        {value}
      </p>
      <p className="mt-1 text-xs text-muted">{sub}</p>
    </div>
  );
}
