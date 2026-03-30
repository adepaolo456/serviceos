"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  DollarSign,
  Briefcase,
  TrendingUp,
  TrendingDown,
  Box,
  Users,
  Truck,
  Download,
  ChevronDown,
  ChevronUp,
  BarChart3,
  Clock,
  FileText,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { api } from "@/lib/api";

/* ─── Types ─── */

interface DashboardData {
  revenue: { total: number; thisMonth: number };
  jobs: { total: number; thisMonth: number; completed: number; cancelled: number; averageValue: number };
  customers: { total: number; newThisMonth: number };
  assets: { total: number; byStatus: { status: string; count: number }[]; utilizationRate: number };
}

interface RevenueDay { date: string; revenue: number }
interface StatusCount { status: string; count: number }

/* ─── Constants ─── */

const DATE_RANGES = [
  { value: "week", label: "This Week", days: 7 },
  { value: "month", label: "This Month", days: 30 },
  { value: "quarter", label: "This Quarter", days: 90 },
  { value: "year", label: "This Year", days: 365 },
] as const;

const STATUS_COLORS: Record<string, string> = {
  pending: "#EAB308", confirmed: "#3B82F6", dispatched: "#A855F7",
  en_route: "#F97316", arrived: "#14B8A6", in_progress: "#2ECC71",
  completed: "#10B981", cancelled: "#EF4444",
};

const CHART_GREEN = "#2ECC71";
const GRID_COLOR = "#1E2D45";
const TEXT_COLOR = "#7A8BA3";

/* ─── Helpers ─── */

import { formatCurrency } from "@/lib/utils";

function fmt(n: number): string {
  if (isNaN(n)) return "$0.00";
  if (n >= 10000) return `$${(n / 1000).toFixed(1)}k`;
  return formatCurrency(n);
}

const fmtFull = (n: number) => formatCurrency(n);

function fmtPct(n: number): string { return `${Math.round(n)}%`; }

function getDateRange(days: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date(); start.setDate(end.getDate() - days);
  return { start: start.toISOString().split("T")[0], end: end.toISOString().split("T")[0] };
}

/* ─── Page ─── */

export default function AnalyticsPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [revenue, setRevenue] = useState<RevenueDay[]>([]);
  const [jobsByStatus, setJobsByStatus] = useState<StatusCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState("month");
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const days = DATE_RANGES.find((r) => r.value === dateRange)?.days || 30;
  const { start, end } = useMemo(() => getDateRange(days), [days]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, rev, jobs] = await Promise.all([
        api.get<DashboardData>("/analytics/dashboard"),
        api.get<RevenueDay[]>(`/analytics/revenue?startDate=${start}&endDate=${end}`),
        api.get<StatusCount[]>("/analytics/jobs-by-status"),
      ]);
      setDashboard(dash);
      setRevenue(rev);
      setJobsByStatus(jobs);
    } catch { /* */ } finally { setLoading(false); }
  }, [start, end]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalRevenue = revenue.reduce((s, r) => s + Number(r.revenue), 0);
  const completedJobs = dashboard?.jobs.completed || 0;
  const avgJobValue = completedJobs > 0 ? totalRevenue / completedJobs : 0;
  const utilization = dashboard?.assets.utilizationRate || 0;
  const totalJobs = jobsByStatus.reduce((s, j) => s + Number(j.count), 0);

  const toggleSection = (section: string) => setExpandedSection(expandedSection === section ? null : section);
  const scrollTo = (id: string) => { setExpandedSection(id); setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 100); };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">Analytics</h1>
          <p className="mt-1 text-sm text-muted">Business performance insights</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-[#1E2D45] overflow-hidden">
            {DATE_RANGES.map((opt) => (
              <button key={opt.value} onClick={() => setDateRange(opt.value)} className={`px-3 py-1.5 text-xs font-medium transition-colors ${dateRange === opt.value ? "bg-brand/10 text-brand" : "text-muted hover:text-white"}`}>
                {opt.label}
              </button>
            ))}
          </div>
          <button className="flex items-center gap-1.5 rounded-lg border border-[#1E2D45] px-3 py-1.5 text-xs font-medium text-muted hover:text-white transition-colors">
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        </div>
      </div>

      {/* KPI Tiles */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 skeleton rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          <KPITile icon={DollarSign} label="Revenue" value={fmt(totalRevenue)} sparkData={revenue.slice(-14).map((r) => Number(r.revenue))} color="brand" onClick={() => scrollTo("revenue")} />
          <KPITile icon={Briefcase} label="Jobs Completed" value={String(completedJobs)} sparkData={[]} color="blue" onClick={() => scrollTo("jobs")} />
          <KPITile icon={TrendingUp} label="Avg Job Value" value={fmtFull(avgJobValue)} sparkData={[]} color="violet" onClick={() => scrollTo("revenue")} />
          <KPITile icon={Box} label="Asset Utilization" value={fmtPct(utilization)} sparkData={[]} color={utilization > 70 ? "emerald" : utilization > 40 ? "yellow" : "red"} onClick={() => scrollTo("fleet")} />
        </div>
      )}

      {/* Revenue */}
      <Section id="revenue" title="Revenue" icon={DollarSign} expanded={expandedSection === "revenue"} onToggle={() => toggleSection("revenue")}>
        {revenue.length > 0 ? (
          <div className="space-y-6">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenue}>
                  <defs><linearGradient id="rg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={CHART_GREEN} stopOpacity={0.3} /><stop offset="95%" stopColor={CHART_GREEN} stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                  <XAxis dataKey="date" tick={{ fill: TEXT_COLOR, fontSize: 11 }} tickFormatter={(d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} />
                  <YAxis tick={{ fill: TEXT_COLOR, fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip contentStyle={{ background: "#162033", border: "1px solid #1E2D45", borderRadius: 8, color: "#fff", fontSize: 13 }} formatter={(v) => [fmtFull(Number(v)), "Revenue"]} labelFormatter={(d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} />
                  <Area type="monotone" dataKey="revenue" stroke={CHART_GREEN} fill="url(#rg)" strokeWidth={2} dot={false} animationDuration={800} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {["10yd", "15yd", "20yd", "30yd", "40yd"].map((size) => (
                <div key={size} className="rounded-xl border border-[#1E2D45] bg-[#111C2E] p-3 text-center">
                  <p className="text-xs text-muted mb-1">{size}</p>
                  <p className="text-sm font-bold text-white">—</p>
                  <p className="text-[10px] text-muted">Coming soon</p>
                </div>
              ))}
            </div>
          </div>
        ) : <Placeholder text="Complete more jobs to see revenue data" />}
      </Section>

      {/* Jobs */}
      <Section id="jobs" title="Jobs" icon={Briefcase} expanded={expandedSection === "jobs"} onToggle={() => toggleSection("jobs")}>
        {jobsByStatus.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <h4 className="text-sm font-medium text-white mb-3">Jobs by Status</h4>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={jobsByStatus} dataKey="count" nameKey="status" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} animationDuration={800}>
                      {jobsByStatus.map((e) => <Cell key={e.status} fill={STATUS_COLORS[e.status] || "#64748B"} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#162033", border: "1px solid #1E2D45", borderRadius: 8, color: "#fff", fontSize: 13 }} formatter={(v, name) => [Number(v), String(name).replace(/_/g, " ")]} />
                    <Legend formatter={(v) => <span className="text-xs text-muted capitalize">{v.replace(/_/g, " ")}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="space-y-3">
              <Stat label="Total Jobs" value={String(totalJobs)} icon={Briefcase} />
              <Stat label="Completion Rate" value={totalJobs > 0 ? fmtPct((completedJobs / Math.max(totalJobs - (dashboard?.jobs.cancelled || 0), 1)) * 100) : "—"} icon={TrendingUp} accent="emerald" />
              <Stat label="Average Job Value" value={fmtFull(avgJobValue)} icon={DollarSign} accent="brand" />
              <Stat label="Avg Completion Time" value="—" sub="Coming soon" icon={Clock} />
            </div>
          </div>
        ) : <Placeholder text="No job data yet" />}
      </Section>

      {/* Fleet */}
      <Section id="fleet" title="Fleet & Assets" icon={Box} expanded={expandedSection === "fleet"} onToggle={() => toggleSection("fleet")}>
        {dashboard?.assets ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <h4 className="text-sm font-medium text-white mb-3">Assets by Status</h4>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dashboard.assets.byStatus} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                    <XAxis type="number" tick={{ fill: TEXT_COLOR, fontSize: 11 }} />
                    <YAxis type="category" dataKey="status" tick={{ fill: TEXT_COLOR, fontSize: 11 }} tickFormatter={(v) => v.replace(/_/g, " ")} width={80} />
                    <Tooltip contentStyle={{ background: "#162033", border: "1px solid #1E2D45", borderRadius: 8, color: "#fff", fontSize: 13 }} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]} animationDuration={800}>
                      {dashboard.assets.byStatus.map((e) => <Cell key={e.status} fill={STATUS_COLORS[e.status] || CHART_GREEN} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="space-y-3">
              <div className={`rounded-xl border p-4 ${utilization > 70 ? "border-emerald-500/20 bg-emerald-500/5" : utilization > 40 ? "border-yellow-500/20 bg-yellow-500/5" : "border-red-500/20 bg-red-500/5"}`}>
                <p className="text-xs text-muted mb-1">Current Utilization</p>
                <p className={`text-3xl font-bold ${utilization > 70 ? "text-emerald-400" : utilization > 40 ? "text-yellow-400" : "text-red-400"}`}>{fmtPct(utilization)}</p>
                <div className="mt-2 h-2 w-full rounded-full bg-dark-elevated overflow-hidden">
                  <div className={`h-full rounded-full ${utilization > 70 ? "bg-emerald-500" : utilization > 40 ? "bg-yellow-500" : "bg-red-500"}`} style={{ width: `${Math.min(utilization, 100)}%` }} />
                </div>
              </div>
              <Stat label="Total Fleet" value={`${dashboard.assets.total} units`} icon={Box} />
              <Stat label="Avg Rental Duration" value="—" sub="Coming soon" icon={Clock} />
              <Stat label="Overdue Rate" value="—" sub="Coming soon" icon={Clock} />
            </div>
          </div>
        ) : <Placeholder text="No fleet data yet" />}
      </Section>

      {/* Customers */}
      <Section id="customers" title="Customers" icon={Users} expanded={expandedSection === "customers"} onToggle={() => toggleSection("customers")}>
        {dashboard?.customers ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total Customers" value={String(dashboard.customers.total)} />
            <StatCard label="New This Month" value={String(dashboard.customers.newThisMonth)} accent />
            <StatCard label="Repeat Rate" value="—" sub="Coming soon" />
            <StatCard label="Top Source" value="—" sub="Coming soon" />
          </div>
        ) : <Placeholder text="No customer data yet" />}
      </Section>

      {/* Drivers */}
      <Section id="drivers" title="Driver Performance" icon={Truck} expanded={expandedSection === "drivers"} onToggle={() => toggleSection("drivers")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Jobs per Driver" value="—" sub="Coming soon" />
          <StatCard label="Revenue per Driver" value="—" sub="Coming soon" />
          <StatCard label="On-Time Rate" value="—" sub="Coming soon" />
          <StatCard label="Avg Jobs/Day" value="—" sub="Coming soon" />
        </div>
      </Section>

      {/* Financial */}
      <Section id="financial" title="Financial Overview" icon={FileText} expanded={expandedSection === "financial"} onToggle={() => toggleSection("financial")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Accounts Receivable" value="—" sub="Coming soon" />
          <StatCard label="Avg Days to Payment" value="—" sub="Coming soon" />
          <StatCard label="Overdue Amount" value="—" sub="Coming soon" />
          <StatCard label="Collection Rate" value="—" sub="Coming soon" />
        </div>
      </Section>

      {/* Profit */}
      <Section id="profit" title="Profit per Job" icon={TrendingUp} expanded={expandedSection === "profit"} onToggle={() => toggleSection("profit")}>
        <Placeholder text="Coming soon — complete more jobs to see per-job profitability analysis including fuel costs, driver pay, dump fees, and net profit margins" />
      </Section>
    </div>
  );
}

/* ─── Components ─── */

function KPITile({ icon: Icon, label, value, sparkData, color, onClick }: {
  icon: typeof DollarSign; label: string; value: string; sparkData: number[]; color: string; onClick: () => void;
}) {
  const accentMap: Record<string, string> = {
    brand: "bg-brand/10 text-brand", blue: "bg-blue-500/10 text-blue-400",
    violet: "bg-violet-500/10 text-violet-400", emerald: "bg-emerald-500/10 text-emerald-400",
    yellow: "bg-yellow-500/10 text-yellow-400", red: "bg-red-500/10 text-red-400",
  };
  return (
    <button onClick={onClick} className="rounded-2xl border border-[#1E2D45] bg-dark-card p-5 text-left transition-all hover:bg-dark-card-hover hover:border-white/10 card-hover btn-press">
      <div className={`flex h-9 w-9 items-center justify-center rounded-xl mb-3 ${accentMap[color] || accentMap.brand}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-2xl font-bold text-white tabular-nums">{value}</p>
      <p className="text-xs text-muted mt-0.5">{label}</p>
      {sparkData.length > 3 && (
        <div className="mt-2 h-8">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkData.map((v, i) => ({ v, i }))}>
              <defs><linearGradient id={`sp-${label}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={CHART_GREEN} stopOpacity={0.3} /><stop offset="95%" stopColor={CHART_GREEN} stopOpacity={0} /></linearGradient></defs>
              <Area type="monotone" dataKey="v" stroke={CHART_GREEN} fill={`url(#sp-${label})`} strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </button>
  );
}

function Section({ id, title, icon: Icon, expanded, onToggle, children }: {
  id: string; title: string; icon: typeof DollarSign; expanded: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div id={id} className="mb-4">
      <button onClick={onToggle} className="w-full flex items-center justify-between rounded-2xl border border-[#1E2D45] bg-dark-card px-5 py-4 text-left transition-all hover:bg-dark-card-hover btn-press">
        <div className="flex items-center gap-3">
          <Icon className="h-5 w-5 text-muted" />
          <h2 className="font-display text-base font-semibold text-white">{title}</h2>
        </div>
        {expanded ? <ChevronUp className="h-5 w-5 text-muted" /> : <ChevronDown className="h-5 w-5 text-muted" />}
      </button>
      {expanded && (
        <div className="mt-2 rounded-2xl border border-[#1E2D45] bg-dark-card p-6 animate-fade-in">{children}</div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, icon: Icon, accent }: { label: string; value: string; sub?: string; icon: typeof DollarSign; accent?: string }) {
  return (
    <div className="rounded-xl border border-[#1E2D45] bg-[#111C2E] p-4 flex items-center justify-between">
      <div>
        <p className="text-xs text-muted">{label}</p>
        <p className={`text-xl font-bold ${accent === "emerald" ? "text-emerald-400" : accent === "brand" ? "text-brand" : "text-white"}`}>{value}</p>
        {sub && <p className="text-[10px] text-muted">{sub}</p>}
      </div>
      <Icon className="h-8 w-8 text-muted/20" />
    </div>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-[#1E2D45] bg-[#111C2E] p-4">
      <p className="text-xs text-muted mb-1">{label}</p>
      <p className={`text-xl font-bold ${accent ? "text-brand" : "text-white"}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted mt-0.5">{sub}</p>}
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="py-12 text-center">
      <BarChart3 className="mx-auto h-10 w-10 text-muted/20 mb-3" />
      <p className="text-sm text-muted">{text}</p>
    </div>
  );
}
