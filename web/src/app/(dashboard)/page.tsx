"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useBooking } from "@/components/booking-provider";
import {
  Plus,
  UserPlus,
  Search,
  Clock,
  MapPin,
  Phone,
  AlertTriangle,
  Truck,
  ArrowRight,
  DollarSign,
  Briefcase,
  CheckCircle2,
  UserPlus2,
  BarChart3,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";

/* ---- Types ---- */

interface DashboardData {
  revenue: { total: number; thisMonth: number };
  jobs: { total: number; thisMonth: number; completed: number; cancelled: number; averageValue: number };
  customers: { total: number; newThisMonth: number };
  assets: { total: number; byStatus: Array<{ status: string; count: number }>; utilizationRate: number };
}

interface TodayJob {
  id: string;
  job_number: string;
  job_type: string;
  status: string;
  scheduled_date: string;
  scheduled_window_start: string;
  scheduled_window_end: string;
  service_address: Record<string, string> | null;
  total_price: number;
  customer: { id: string; first_name: string; last_name: string } | null;
  asset: { id: string; identifier: string } | null;
  assigned_driver: { id: string; first_name: string; last_name: string } | null;
}

interface JobsResponse {
  data: TodayJob[];
  meta: { total: number };
}

interface SearchResult {
  type: "customer" | "job" | "asset";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

interface UserProfile {
  firstName: string;
  lastName: string;
}

/* ---- Helpers ---- */

const JOB_TYPE_COLOR: Record<string, string> = {
  delivery: "var(--t-accent)",
  pickup: "var(--t-warning)",
  exchange: "var(--t-text-muted)",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "var(--t-warning)",
  confirmed: "var(--t-accent)",
  dispatched: "var(--t-text-muted)",
  en_route: "var(--t-warning)",
  in_progress: "var(--t-accent)",
  completed: "var(--t-accent)",
  cancelled: "var(--t-error)",
};

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function formatTime(t: string | null): string {
  if (!t) return "";
  return t.slice(0, 5);
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function shiftDate(d: string, n: number): string {
  const dt = new Date(d + "T00:00:00");
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().split("T")[0];
}

function fmtShortDate(d: string): string {
  const t = today();
  if (d === t) return "Today";
  if (d === shiftDate(t, 1)) return "Tomorrow";
  if (d === shiftDate(t, -1)) return "Yesterday";
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function fmtLongDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

/* ---- Component ---- */

export default function DashboardPage() {
  const router = useRouter();
  const { openWizard } = useBooking();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [todayJobs, setTodayJobs] = useState<TodayJob[]>([]);
  const [unassignedJobs, setUnassignedJobs] = useState<TodayJob[]>([]);
  const [overdueJobs, setOverdueJobs] = useState<any[]>([]);
  const [rescheduledJobs, setRescheduledJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [fleet, setFleet] = useState<{ totalAssets: number; byStatus: Record<string, number> } | null>(null);
  const [arSummary, setArSummary] = useState<{ totalOutstanding: number; totalOverdue: number } | null>(null);
  const [jobPanelOpen, setJobPanelOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(today);

  // Keyboard shortcuts: B=booking, arrows=date nav, T=today
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target !== document.body || e.metaKey || e.ctrlKey) return;
      if (e.key === "ArrowLeft") setScheduleDate(d => shiftDate(d, -1));
      else if (e.key === "ArrowRight") setScheduleDate(d => shiftDate(d, 1));
      else if (e.key === "t") setScheduleDate(today());
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [router]);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(null);

  // Load dashboard data
  useEffect(() => {
    async function loadDashboard() {
      try {
        const [d, u] = await Promise.all([
          api.get<DashboardData>("/analytics/dashboard"),
          api.get<UserProfile>("/auth/profile"),
        ]);
        setDashboard(d);
        setUser(u);
      } catch { /* handled */ }
      finally { setLoading(false); }
    }
    loadDashboard();
    api.get<any[]>("/automation/overdue").then(setOverdueJobs).catch(() => {});
    api.get<{ totalAssets: number; byStatus: Record<string, number> }>("/reporting/assets").then(setFleet).catch(() => {});
    api.get<{ totalOutstanding: number; totalOverdue: number }>("/reporting/accounts-receivable").then(setArSummary).catch(() => {});
    api.get<{ data: any[] }>("/jobs?limit=10").then(res => {
      const rescheduled = (res.data || []).filter((j: any) => j.rescheduled_by_customer);
      setRescheduledJobs(rescheduled);
    }).catch(() => {});
  }, []);

  // Load jobs for selected schedule date
  useEffect(() => {
    async function loadJobs() {
      try {
        const tj = await api.get<JobsResponse>(`/jobs?dateFrom=${scheduleDate}&dateTo=${scheduleDate}&limit=50`);
        setTodayJobs(tj.data.filter((j) => j.status !== "cancelled"));
        setUnassignedJobs(tj.data.filter((j) => !j.assigned_driver && j.status !== "cancelled" && j.status !== "completed"));
      } catch { /* */ }
    }
    loadJobs();
  }, [scheduleDate]);

  // Global search
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!searchQuery || searchQuery.length < 2) { setSearchResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      try {
        const [customers, jobs] = await Promise.all([
          api.get<{ data: Array<{ id: string; first_name: string; last_name: string; phone: string; company_name: string }> }>(`/customers?search=${encodeURIComponent(searchQuery)}&limit=5`),
          api.get<{ data: Array<{ id: string; job_number: string; status: string; customer: { first_name: string; last_name: string } | null }> }>(`/jobs?limit=5`),
        ]);
        const results: SearchResult[] = [];
        for (const c of customers.data) {
          results.push({ type: "customer", id: c.id, title: `${c.first_name} ${c.last_name}`, subtitle: c.phone || c.company_name || "Customer", href: `/customers/${c.id}` });
        }
        for (const j of jobs.data) {
          if (j.job_number.toLowerCase().includes(searchQuery.toLowerCase()) || j.customer?.first_name.toLowerCase().includes(searchQuery.toLowerCase())) {
            results.push({ type: "job", id: j.id, title: j.job_number, subtitle: j.customer ? `${j.customer.first_name} ${j.customer.last_name}` : j.status, href: `/jobs/${j.id}` });
          }
        }
        setSearchResults(results.slice(0, 8));
        setSearchOpen(results.length > 0);
      } catch { /* */ }
    }, 300);
  }, [searchQuery]);

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div className="skeleton" style={{ height: 56, borderRadius: 14 }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16 }}>
          {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton" style={{ height: 88, borderRadius: 14 }} />)}
        </div>
        <div className="skeleton" style={{ height: 400, borderRadius: 14 }} />
      </div>
    );
  }

  const activeRentals = (dashboard?.jobs.total ?? 0) - (dashboard?.jobs.completed ?? 0) - (dashboard?.jobs.cancelled ?? 0);

  const deployed = fleet?.byStatus?.deployed || fleet?.byStatus?.on_site || 0;
  const fleetTotal = fleet?.totalAssets || 0;
  const utilRate = fleetTotal > 0 ? Math.round((deployed / fleetTotal) * 100) : 0;

  const kpis = [
    { label: "Revenue", value: `$${(dashboard?.revenue.thisMonth ?? 0).toLocaleString()}`, trend: "+12%", positive: true },
    { label: "Jobs This Month", value: String(dashboard?.jobs.thisMonth ?? 0), trend: "+3", positive: true },
    { label: "Completed", value: String(dashboard?.jobs.completed ?? 0), trend: null, positive: true },
    { label: "Active Rentals", value: String(activeRentals), trend: null, positive: true },
    { label: "Fleet", value: `${deployed}/${fleetTotal} deployed`, trend: `${utilRate}%`, positive: utilRate < 80 },
    { label: "AR Outstanding", value: `$${(arSummary?.totalOutstanding ?? 0).toLocaleString()}`, trend: arSummary?.totalOverdue ? `$${arSummary.totalOverdue.toLocaleString()} overdue` : null, positive: !(arSummary?.totalOverdue) },
  ];

  return (
    <div>
      {/* ---- Greeting + Quick Actions ---- */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: "-1px",
          color: "var(--t-frame-text)",
          lineHeight: 1.2,
          marginBottom: 4,
        }}>
          {getGreeting()}, {user?.firstName || "Anthony"}
        </h1>
        <p style={{ fontSize: 14, color: "var(--t-frame-text-muted)", marginBottom: 20 }}>
          {fmtLongDate(today())} &middot; {todayJobs.length} job{todayJobs.length !== 1 ? "s" : ""} today
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => openWizard()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              backgroundColor: "var(--t-accent)",
              color: "#000",
              fontSize: 14,
              fontWeight: 600,
              padding: "10px 20px",
              borderRadius: 24,
              border: "none",
              cursor: "pointer",
              transition: "opacity 0.15s ease",
            }}
          >
            <Plus style={{ width: 16, height: 16 }} strokeWidth={2.5} />
            New Booking
          </button>
          <Link
            href="/customers"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              backgroundColor: "transparent",
              color: "var(--t-frame-text)",
              fontSize: 14,
              fontWeight: 600,
              padding: "10px 20px",
              borderRadius: 24,
              border: "1px solid var(--t-frame-border)",
              textDecoration: "none",
              transition: "all 0.15s ease",
            }}
          >
            <UserPlus style={{ width: 16, height: 16, color: "var(--t-frame-text-muted)" }} />
            New Customer
          </Link>

          {/* Search */}
          <div style={{ position: "relative", flex: 1, maxWidth: 340, marginLeft: "auto" }}>
            <Search style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: "var(--t-frame-text-muted)" }} />
            <input
              type="text"
              placeholder="Search customers, jobs, assets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
              style={{
                width: "100%",
                backgroundColor: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 24,
                padding: "10px 16px 10px 38px",
                fontSize: 14,
                color: "var(--t-frame-text)",
                outline: "none",
                transition: "border-color 0.15s ease",
              }}
            />
            {searchOpen && searchResults.length > 0 && (
              <div style={{
                position: "absolute",
                zIndex: 30,
                marginTop: 6,
                width: "100%",
                borderRadius: 14,
                border: "1px solid var(--t-border)",
                backgroundColor: "var(--t-bg-card)",
                overflow: "hidden",
                boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
              }}>
                {searchResults.map((r) => (
                  <button
                    key={`${r.type}-${r.id}`}
                    onMouseDown={() => router.push(r.href)}
                    style={{
                      display: "flex",
                      width: "100%",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 16px",
                      textAlign: "left",
                      transition: "background 0.15s ease",
                      backgroundColor: "transparent",
                      border: "none",
                      cursor: "pointer",
                    }}
                    className="hover:bg-dark-card-hover"
                  >
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      color: r.type === "customer" ? "var(--t-accent)" : "var(--t-text-muted)",
                    }}>
                      {r.type}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontSize: 14, fontWeight: 500, color: "var(--t-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</p>
                      <p style={{ fontSize: 12, color: "var(--t-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.subtitle}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---- KPI Cards ---- */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 24 }} className="lg:!grid-cols-4">
        {kpis.map((kpi) => (
          <Link key={kpi.label} href="/analytics" style={{
            backgroundColor: "var(--t-bg-card)",
            border: "1px solid var(--t-border)",
            borderRadius: 14,
            padding: "18px 16px",
            textDecoration: "none",
            transition: "background 0.15s ease",
          }} className="hover:bg-dark-card-hover">
            <p style={{
              fontSize: 12,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "var(--t-text-muted)",
              marginBottom: 6,
            }}>
              {kpi.label}
            </p>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: "-0.5px",
                color: "var(--t-text-primary)",
                fontVariantNumeric: "tabular-nums",
              }}>
                {kpi.value}
              </span>
              {kpi.trend && (
                <span style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: kpi.positive ? "var(--t-accent)" : "var(--t-error)",
                }}>
                  {kpi.trend}
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>

      {/* ---- Overdue Alerts ---- */}
      {overdueJobs.length > 0 && (
        <div style={{
          backgroundColor: "var(--t-error-soft)",
          border: "1px solid var(--t-border)",
          borderRadius: 14,
          padding: "14px 16px",
          marginBottom: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "var(--t-error)", flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--t-error)" }}>
              {overdueJobs.length} Overdue Rental{overdueJobs.length > 1 ? "s" : ""}
            </span>
            <span style={{ fontSize: 12, color: "var(--t-text-muted)" }}>
              &mdash; ${overdueJobs.reduce((s: number, j: any) => s + Number(j.extra_day_charges || 0), 0).toFixed(2)} in extra charges
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {overdueJobs.slice(0, 5).map((j: any) => (
              <div key={j.id} style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor: "var(--t-bg-card)",
                border: "1px solid var(--t-border)",
                borderRadius: 10,
                padding: "8px 12px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--t-error)" }}>{j.extra_days}d</span>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: "var(--t-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {j.customer ? `${j.customer.first_name} ${j.customer.last_name}` : j.job_number}
                    </p>
                    <p style={{ fontSize: 11, color: "var(--t-text-muted)" }}>{j.asset?.identifier || j.service_type} &middot; ${Number(j.extra_day_charges || 0).toFixed(2)} charges</p>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  <button onClick={() => { api.post(`/automation/overdue/${j.id}/action`, { action: "schedule_pickup" }).then(() => api.get<any[]>("/automation/overdue").then(setOverdueJobs)).catch(() => {}); }}
                    style={{ fontSize: 11, fontWeight: 500, color: "var(--t-text-primary)", backgroundColor: "transparent", border: "1px solid var(--t-border)", borderRadius: 20, padding: "4px 10px", cursor: "pointer", transition: "background 0.15s ease" }}>
                    Pickup
                  </button>
                  <button onClick={() => { api.post(`/automation/overdue/${j.id}/action`, { action: "extend", days: 7 }).then(() => api.get<any[]>("/automation/overdue").then(setOverdueJobs)).catch(() => {}); }}
                    style={{ fontSize: 11, fontWeight: 500, color: "var(--t-text-primary)", backgroundColor: "transparent", border: "1px solid var(--t-border)", borderRadius: 20, padding: "4px 10px", cursor: "pointer", transition: "background 0.15s ease" }}>
                    +7 Days
                  </button>
                  <button onClick={() => { api.post(`/automation/overdue/${j.id}/action`, { action: "dismiss" }).then(() => api.get<any[]>("/automation/overdue").then(setOverdueJobs)).catch(() => {}); }}
                    style={{ fontSize: 11, fontWeight: 500, color: "var(--t-text-muted)", backgroundColor: "transparent", border: "1px solid var(--t-border)", borderRadius: 20, padding: "4px 10px", cursor: "pointer", transition: "background 0.15s ease" }}>
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- Reschedule Alerts ---- */}
      {rescheduledJobs.length > 0 && (
        <div style={{
          backgroundColor: "var(--t-warning-soft)",
          border: "1px solid var(--t-border)",
          borderRadius: 14,
          padding: "14px 16px",
          marginBottom: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: "var(--t-warning)", flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--t-warning)" }}>
              {rescheduledJobs.length} Customer Reschedule{rescheduledJobs.length > 1 ? "s" : ""}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rescheduledJobs.slice(0, 3).map((j: any) => (
              <div key={j.id} style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor: "var(--t-bg-card)",
                border: "1px solid var(--t-border)",
                borderRadius: 10,
                padding: "8px 12px",
              }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: "var(--t-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {j.customer ? `${j.customer.first_name} ${j.customer.last_name}` : j.job_number}
                  </p>
                  <p style={{ fontSize: 11, color: "var(--t-text-muted)" }}>Moved from {j.rescheduled_from_date} &rarr; {j.scheduled_date}</p>
                </div>
                <button onClick={() => { api.patch(`/jobs/${j.id}`, { rescheduledByCustomer: false }).then(() => setRescheduledJobs(prev => prev.filter(x => x.id !== j.id))).catch(() => {}); }}
                  style={{ fontSize: 11, fontWeight: 500, color: "var(--t-text-muted)", backgroundColor: "transparent", border: "1px solid var(--t-border)", borderRadius: 20, padding: "4px 10px", cursor: "pointer", flexShrink: 0, marginLeft: 8, transition: "all 0.15s ease" }}>
                  Acknowledge
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- Today's Schedule + Sidebar ---- */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20, marginBottom: 32 }} className="lg:!grid-cols-5">
        {/* Schedule */}
        <div className="lg:col-span-3" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{
            backgroundColor: "var(--t-bg-card)",
            border: "1px solid var(--t-border)",
            borderRadius: 14,
            overflow: "hidden",
          }}>
            {/* Date nav header */}
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 16px",
              borderBottom: "1px solid var(--t-border)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
                <button
                  onClick={() => setScheduleDate(d => shiftDate(d, -1))}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    color: "var(--t-text-muted)",
                    backgroundColor: "transparent",
                    border: "none",
                    cursor: "pointer",
                    transition: "color 0.15s ease",
                  }}
                >
                  <ChevronLeft style={{ width: 18, height: 18 }} />
                </button>
                {scheduleDate !== today() && (
                  <button
                    onClick={() => setScheduleDate(today())}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--t-accent)",
                      backgroundColor: "var(--t-accent-soft)",
                      border: "none",
                      borderRadius: 20,
                      padding: "4px 10px",
                      cursor: "pointer",
                      margin: "0 4px",
                      transition: "opacity 0.15s ease",
                    }}
                  >
                    Today
                  </button>
                )}
                <div style={{ minWidth: 140, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <Clock style={{ width: 14, height: 14, color: "var(--t-text-muted)", flexShrink: 0 }} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--t-text-primary)", whiteSpace: "nowrap" }}>
                    {fmtShortDate(scheduleDate)}
                  </span>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--t-accent)",
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {todayJobs.length}
                  </span>
                </div>
                <button
                  onClick={() => setScheduleDate(d => shiftDate(d, 1))}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    color: "var(--t-text-muted)",
                    backgroundColor: "transparent",
                    border: "none",
                    cursor: "pointer",
                    transition: "color 0.15s ease",
                  }}
                >
                  <ChevronRight style={{ width: 18, height: 18 }} />
                </button>
              </div>
              <Link href="/dispatch" style={{ fontSize: 12, color: "var(--t-accent)", textDecoration: "none", display: "flex", alignItems: "center", gap: 4, transition: "opacity 0.15s ease" }}>
                Dispatch <ArrowRight style={{ width: 12, height: 12 }} />
              </Link>
            </div>

            {/* Job list */}
            <div key={scheduleDate} className="animate-fade-in">
              {todayJobs.length === 0 ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 16px" }}>
                  <Briefcase style={{ width: 40, height: 40, color: "var(--t-text-muted)", opacity: 0.3, marginBottom: 8 }} />
                  <p style={{ fontSize: 14, color: "var(--t-text-muted)" }}>No jobs scheduled for {fmtShortDate(scheduleDate).toLowerCase()}</p>
                  <Link href="/book" style={{ marginTop: 12, fontSize: 12, color: "var(--t-accent)", textDecoration: "none" }}>+ Create a job</Link>
                </div>
              ) : (
                <div>
                  {todayJobs.slice(0, 8).map((job, idx) => {
                    const addr = job.service_address;
                    const addrStr = addr ? [addr.street, addr.city].filter(Boolean).join(", ") : "";
                    return (
                      <Link
                        key={job.id}
                        href={`/jobs/${job.id}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 16,
                          padding: "12px 20px",
                          textDecoration: "none",
                          borderBottom: idx < todayJobs.slice(0, 8).length - 1 ? "1px solid var(--t-border)" : "none",
                          transition: "background 0.15s ease",
                        }}
                        className="hover:bg-dark-card-hover"
                      >
                        {/* Time */}
                        <div style={{ width: 52, flexShrink: 0, textAlign: "center" }}>
                          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--t-text-primary)", fontVariantNumeric: "tabular-nums" }}>
                            {formatTime(job.scheduled_window_start)}
                          </p>
                          {job.scheduled_window_end && (
                            <p style={{ fontSize: 11, color: "var(--t-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                              {formatTime(job.scheduled_window_end)}
                            </p>
                          )}
                        </div>

                        {/* Customer + Address */}
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--t-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : job.job_number}
                          </p>
                          {addrStr && (
                            <p style={{ fontSize: 12, color: "var(--t-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
                              <MapPin style={{ width: 12, height: 12, flexShrink: 0 }} />{addrStr}
                            </p>
                          )}
                        </div>

                        {/* Job type */}
                        <span style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: JOB_TYPE_COLOR[job.job_type] || "var(--t-text-muted)",
                          textTransform: "capitalize",
                          flexShrink: 0,
                        }}>
                          {job.job_type}
                        </span>

                        {/* Driver + Asset */}
                        <div style={{ width: 80, flexShrink: 0, textAlign: "right" }}>
                          {job.assigned_driver ? (
                            <p style={{ fontSize: 12, color: "var(--t-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {job.assigned_driver.first_name}
                            </p>
                          ) : (
                            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--t-error)" }}>Unassigned</span>
                          )}
                          {job.asset && (
                            <p style={{ fontSize: 11, color: "var(--t-text-muted)" }}>{job.asset.identifier}</p>
                          )}
                        </div>

                        {/* Status */}
                        <span style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: STATUS_COLOR[job.status] || "var(--t-text-muted)",
                          textTransform: "capitalize",
                          flexShrink: 0,
                        }}>
                          {job.status.replace(/_/g, " ")}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar: Week View + Unassigned */}
        <div className="lg:col-span-2" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* This Week */}
          <div style={{
            backgroundColor: "var(--t-bg-card)",
            border: "1px solid var(--t-border)",
            borderRadius: 14,
            overflow: "hidden",
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              borderBottom: "1px solid var(--t-border)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <BarChart3 style={{ width: 16, height: 16, color: "var(--t-text-muted)" }} />
                <span style={{ fontSize: 15, fontWeight: 600, color: "var(--t-text-primary)" }}>This Week</span>
              </div>
            </div>
            <WeekView scheduleDate={scheduleDate} onSelectDay={setScheduleDate} />
          </div>

          {/* Unassigned */}
          {unassignedJobs.length > 0 && (
            <div style={{
              backgroundColor: "var(--t-bg-card)",
              border: "1px solid var(--t-border)",
              borderRadius: 14,
              overflow: "hidden",
            }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 16px",
                borderBottom: "1px solid var(--t-border)",
              }}>
                <UserPlus2 style={{ width: 16, height: 16, color: "var(--t-error)" }} />
                <span style={{ fontSize: 15, fontWeight: 600, color: "var(--t-text-primary)" }}>Unassigned</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--t-error)" }}>{unassignedJobs.length}</span>
              </div>
              <div>
                {unassignedJobs.slice(0, 5).map((job, idx) => (
                  <Link
                    key={job.id}
                    href={`/jobs/${job.id}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 16px",
                      textDecoration: "none",
                      borderBottom: idx < unassignedJobs.slice(0, 5).length - 1 ? "1px solid var(--t-border)" : "none",
                      transition: "background 0.15s ease",
                    }}
                    className="hover:bg-dark-card-hover"
                  >
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 500, color: "var(--t-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : job.job_number}
                      </p>
                      <p style={{ fontSize: 11, color: "var(--t-text-muted)", textTransform: "capitalize" }}>
                        {job.job_type} &middot; {job.asset?.identifier || "No asset"}
                      </p>
                    </div>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: JOB_TYPE_COLOR[job.job_type] || "var(--t-text-muted)",
                      textTransform: "capitalize",
                      flexShrink: 0,
                    }}>
                      {job.job_type}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quick Job Create SlideOver */}
      <SlideOver open={jobPanelOpen} onClose={() => setJobPanelOpen(false)} title="Quick Create Job">
        <QuickJobForm onSuccess={() => { setJobPanelOpen(false); window.location.reload(); }} />
      </SlideOver>
    </div>
  );
}

/* ============ Quick Job Create Form ============ */

interface CustomerOption { id: string; first_name: string; last_name: string; phone: string; }
interface AssetOption { id: string; identifier: string; asset_type: string; subtype: string; }
interface PriceQuote { breakdown: { total: number; basePrice: number } }

function QuickJobForm({ onSuccess }: { onSuccess: () => void }) {
  const [step, setStep] = useState(1);
  // Customer
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  // Job
  const [jobType, setJobType] = useState("delivery");
  const [assetSubtype, setAssetSubtype] = useState("20yd");
  const [scheduledDate, setScheduledDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  });
  const [timeWindow, setTimeWindow] = useState("morning");
  // Address
  const [address, setAddress] = useState<AddressValue>({ street: "", city: "", state: "", zip: "", lat: null, lng: null });
  // Price
  const [priceQuote, setPriceQuote] = useState<PriceQuote | null>(null);
  const [priceOverride, setPriceOverride] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(null);

  // Customer search
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!customerSearch || customerSearch.length < 2) { setCustomerResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await api.get<{ data: CustomerOption[] }>(`/customers?search=${encodeURIComponent(customerSearch)}&limit=6`);
        setCustomerResults(res.data);
      } catch { /* */ }
    }, 250);
  }, [customerSearch]);

  // Price calc
  useEffect(() => {
    if (step < 4) return;
    api.post<PriceQuote>("/pricing/calculate", {
      serviceType: "dumpster_rental", assetSubtype, jobType,
      customerLat: address.lat || 42.0834, customerLng: address.lng || -71.0184,
    }).then(setPriceQuote).catch(() => {});
  }, [step, assetSubtype, jobType, address.lat, address.lng]);

  const handleSubmit = async () => {
    setError(""); setSaving(true);
    try {
      let cId = customerId;
      if (isNewCustomer) {
        const nc = await api.post<{ id: string }>("/customers", { firstName: newFirstName, lastName: newLastName, phone: newPhone || undefined, type: "residential" });
        cId = nc.id;
      }
      const windows: Record<string, [string, string]> = { morning: ["08:00", "12:00"], afternoon: ["12:00", "17:00"], fullday: ["08:00", "17:00"] };
      const [wStart, wEnd] = windows[timeWindow] || windows.morning;
      const price = priceOverride ? Number(priceOverride) : priceQuote?.breakdown.total;
      await api.post("/jobs", {
        customerId: cId, jobType, serviceType: "dumpster_rental", scheduledDate,
        scheduledWindowStart: wStart, scheduledWindowEnd: wEnd,
        serviceAddress: address.street ? { street: address.street, city: address.city, state: address.state, zip: address.zip, lat: address.lat, lng: address.lng } : undefined,
        basePrice: price, totalPrice: price,
      });
      onSuccess();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to create job"); }
    finally { setSaving(false); }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    backgroundColor: "var(--t-bg-card)",
    border: "1px solid var(--t-border)",
    borderRadius: 10,
    padding: "12px 16px",
    fontSize: 14,
    color: "var(--t-text-primary)",
    outline: "none",
    transition: "border-color 0.15s ease",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--t-text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    marginBottom: 6,
  };

  const pillBtnActive: React.CSSProperties = {
    backgroundColor: "var(--t-accent)",
    color: "#000",
    fontWeight: 600,
    fontSize: 13,
    borderRadius: 10,
    padding: "10px 0",
    border: "none",
    cursor: "pointer",
    transition: "all 0.15s ease",
  };

  const pillBtnInactive: React.CSSProperties = {
    backgroundColor: "var(--t-bg-card)",
    color: "var(--t-text-muted)",
    fontWeight: 500,
    fontSize: 13,
    borderRadius: 10,
    padding: "10px 0",
    border: "1px solid var(--t-border)",
    cursor: "pointer",
    transition: "all 0.15s ease",
  };

  const primaryBtn: React.CSSProperties = {
    width: "100%",
    backgroundColor: "var(--t-accent)",
    color: "#000",
    fontWeight: 600,
    fontSize: 14,
    borderRadius: 24,
    padding: "12px 0",
    border: "none",
    cursor: "pointer",
    transition: "opacity 0.15s ease",
  };

  const secondaryBtn: React.CSSProperties = {
    flex: 1,
    backgroundColor: "transparent",
    color: "var(--t-text-muted)",
    fontWeight: 500,
    fontSize: 14,
    borderRadius: 24,
    padding: "12px 0",
    border: "1px solid var(--t-border)",
    cursor: "pointer",
    transition: "all 0.15s ease",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {error && (
        <div style={{
          backgroundColor: "var(--t-error-soft)",
          border: "1px solid var(--t-border)",
          borderRadius: 10,
          padding: "12px 16px",
          fontSize: 13,
          color: "var(--t-error)",
        }}>
          {error}
        </div>
      )}

      {/* Progress */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {[1, 2, 3, 4].map((s) => (
          <div key={s} style={{
            height: 3,
            flex: 1,
            borderRadius: 2,
            backgroundColor: step >= s ? "var(--t-accent)" : "var(--t-border)",
            transition: "background 0.15s ease",
          }} />
        ))}
      </div>

      {/* Step 1: Customer */}
      {step === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--t-text-primary)" }}>Who is this for?</h3>
          {customerId ? (
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderRadius: 10,
              border: "1px solid var(--t-border)",
              backgroundColor: "var(--t-accent-soft)",
              padding: "12px 16px",
            }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: "var(--t-text-primary)" }}>{customerName}</span>
              <button onClick={() => { setCustomerId(""); setCustomerName(""); setIsNewCustomer(false); }}
                style={{ fontSize: 12, color: "var(--t-text-muted)", background: "none", border: "none", cursor: "pointer" }}>Change</button>
            </div>
          ) : isNewCustomer ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <input value={newFirstName} onChange={(e) => setNewFirstName(e.target.value)} style={inputStyle} placeholder="First name" />
                <input value={newLastName} onChange={(e) => setNewLastName(e.target.value)} style={inputStyle} placeholder="Last name" />
              </div>
              <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} style={inputStyle} placeholder="Phone (optional)" />
              <button onClick={() => setIsNewCustomer(false)} style={{ fontSize: 12, color: "var(--t-text-muted)", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                &larr; Search existing
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} style={inputStyle} placeholder="Type name or phone number..." autoFocus />
              {customerResults.length > 0 && (
                <div style={{ borderRadius: 10, border: "1px solid var(--t-border)", backgroundColor: "var(--t-bg-card)", overflow: "hidden" }}>
                  {customerResults.map((c) => (
                    <button key={c.id} onClick={() => { setCustomerId(c.id); setCustomerName(`${c.first_name} ${c.last_name}`); setCustomerSearch(""); }}
                      style={{
                        display: "flex",
                        width: "100%",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 16px",
                        fontSize: 14,
                        color: "var(--t-text-primary)",
                        backgroundColor: "transparent",
                        border: "none",
                        borderBottom: "1px solid var(--t-border)",
                        cursor: "pointer",
                        transition: "background 0.15s ease",
                      }}
                      className="hover:bg-dark-card-hover"
                    >
                      <span style={{ fontWeight: 500 }}>{c.first_name} {c.last_name}</span>
                      {c.phone && <span style={{ fontSize: 12, color: "var(--t-text-muted)" }}>{c.phone}</span>}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => setIsNewCustomer(true)} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--t-accent)", background: "none", border: "none", cursor: "pointer" }}>
                <UserPlus style={{ width: 12, height: 12 }} /> Create new customer
              </button>
            </div>
          )}
          <button
            onClick={() => step === 1 && (customerId || (isNewCustomer && newFirstName)) && setStep(2)}
            disabled={!customerId && !(isNewCustomer && newFirstName)}
            style={{ ...primaryBtn, opacity: (!customerId && !(isNewCustomer && newFirstName)) ? 0.4 : 1 }}
          >
            Next: Job Details
          </button>
        </div>
      )}

      {/* Step 2: Job Details */}
      {step === 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--t-text-primary)" }}>Job Details</h3>
          <div>
            <label style={labelStyle}>Job Type</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {(["delivery", "pickup", "exchange"] as const).map((t) => (
                <button key={t} onClick={() => setJobType(t)} style={{ ...(jobType === t ? pillBtnActive : pillBtnInactive), textTransform: "capitalize" }}>{t}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={labelStyle}>Dumpster Size</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
              {["10yd", "20yd", "30yd", "40yd"].map((s) => (
                <button key={s} onClick={() => setAssetSubtype(s)} style={assetSubtype === s ? pillBtnActive : pillBtnInactive}>{s}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={labelStyle}>Date</label>
            <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Time Window</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {([["morning", "AM (8-12)"], ["afternoon", "PM (12-5)"], ["fullday", "All Day"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setTimeWindow(k)} style={{ ...(timeWindow === k ? pillBtnActive : pillBtnInactive), fontSize: 12 }}>{label}</button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setStep(1)} style={secondaryBtn}>Back</button>
            <button onClick={() => setStep(3)} style={{ ...primaryBtn, flex: 2 }}>Next: Address</button>
          </div>
        </div>
      )}

      {/* Step 3: Address */}
      {step === 3 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--t-text-primary)" }}>Service Address</h3>
          <AddressAutocomplete
            value={address}
            onChange={setAddress}
            label="Address"
            placeholder="Start typing an address..."
          />
          {address.street && (
            <div style={{
              borderRadius: 10,
              backgroundColor: "var(--t-bg-card)",
              border: "1px solid var(--t-border)",
              padding: 12,
            }}>
              <p style={{ fontSize: 13, fontWeight: 500, color: "var(--t-text-primary)" }}>{address.street}</p>
              <p style={{ fontSize: 12, color: "var(--t-text-muted)" }}>{address.city}, {address.state} {address.zip}</p>
              {address.lat && <p style={{ fontSize: 11, color: "var(--t-text-muted)", marginTop: 4 }}>GPS: {address.lat.toFixed(4)}, {address.lng?.toFixed(4)}</p>}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setStep(2)} style={secondaryBtn}>Back</button>
            <button onClick={() => setStep(4)} style={{ ...primaryBtn, flex: 2 }}>Next: Review</button>
          </div>
        </div>
      )}

      {/* Step 4: Review & Confirm */}
      {step === 4 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--t-text-primary)" }}>Review & Create</h3>
          <div style={{
            borderRadius: 10,
            backgroundColor: "var(--t-bg-card)",
            border: "1px solid var(--t-border)",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}>
            {[
              ["Customer", isNewCustomer ? `${newFirstName} ${newLastName}` : customerName],
              ["Type", jobType],
              ["Size", assetSubtype],
              ["Date", scheduledDate],
              ["Window", timeWindow === "fullday" ? "All Day" : timeWindow === "morning" ? "AM (8-12)" : "PM (12-5)"],
              ...(address.street ? [["Address", `${address.street}, ${address.city}`]] : []),
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                <span style={{ color: "var(--t-text-muted)" }}>{label}</span>
                <span style={{ color: "var(--t-text-primary)", fontWeight: 500, textTransform: "capitalize" }}>{value}</span>
              </div>
            ))}
          </div>
          {priceQuote && (
            <div style={{
              borderRadius: 10,
              border: "1px solid var(--t-border)",
              backgroundColor: "var(--t-accent-soft)",
              padding: 16,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: "var(--t-accent)" }}>Estimated Price</span>
                <span style={{ fontSize: 22, fontWeight: 700, color: "var(--t-accent)", letterSpacing: "-0.5px", fontVariantNumeric: "tabular-nums" }}>
                  ${priceQuote.breakdown.total}
                </span>
              </div>
              <div style={{ marginTop: 8 }}>
                <input value={priceOverride} onChange={(e) => setPriceOverride(e.target.value)} style={{ ...inputStyle, marginTop: 4 }} placeholder={`Override price (default: $${priceQuote.breakdown.total})`} />
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setStep(3)} style={secondaryBtn}>Back</button>
            <button onClick={handleSubmit} disabled={saving} style={{ ...primaryBtn, flex: 2, opacity: saving ? 0.5 : 1 }}>
              {saving ? "Creating..." : "Create Job"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- Week View Component ---- */

function WeekView({ scheduleDate, onSelectDay }: { scheduleDate: string; onSelectDay: (d: string) => void }) {
  const [weekJobs, setWeekJobs] = useState<Record<string, { total: number; deliveries: number; pickups: number; exchanges: number }>>({});

  useEffect(() => {
    async function loadWeek() {
      const days: string[] = [];
      for (let i = 0; i < 7; i++) days.push(shiftDate(today(), i));
      try {
        const res = await api.get<JobsResponse>(`/jobs?dateFrom=${days[0]}&dateTo=${days[6]}&limit=200`);
        const byDay: Record<string, { total: number; deliveries: number; pickups: number; exchanges: number }> = {};
        for (const d of days) byDay[d] = { total: 0, deliveries: 0, pickups: 0, exchanges: 0 };
        for (const j of res.data) {
          const d = j.scheduled_date?.split("T")[0];
          if (d && byDay[d]) {
            byDay[d].total++;
            if (j.job_type === "delivery") byDay[d].deliveries++;
            else if (j.job_type === "pickup") byDay[d].pickups++;
            else if (j.job_type === "exchange") byDay[d].exchanges++;
          }
        }
        setWeekJobs(byDay);
      } catch { /* */ }
    }
    loadWeek();
  }, []);

  const days: string[] = [];
  for (let i = 0; i < 7; i++) days.push(shiftDate(today(), i));

  return (
    <>
      {days.map((d, idx) => {
        const isToday = d === today();
        const isSelected = d === scheduleDate;
        const data = weekJobs[d] || { total: 0, deliveries: 0, pickups: 0, exchanges: 0 };
        const dayName = new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" });
        const dayNum = new Date(d + "T00:00:00").getDate();

        const parts: string[] = [];
        if (data.deliveries) parts.push(`${data.deliveries}D`);
        if (data.pickups) parts.push(`${data.pickups}P`);
        if (data.exchanges) parts.push(`${data.exchanges}E`);

        return (
          <button
            key={d}
            onClick={() => onSelectDay(d)}
            style={{
              display: "flex",
              width: "100%",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 16px",
              textAlign: "left",
              backgroundColor: isSelected ? "var(--t-accent-soft)" : "transparent",
              borderLeft: isSelected ? "2px solid var(--t-accent)" : "2px solid transparent",
              borderRight: "none",
              borderTop: "none",
              borderBottom: idx < days.length - 1 ? "1px solid var(--t-border)" : "none",
              cursor: "pointer",
              transition: "background 0.15s ease",
            }}
            className="hover:bg-dark-card-hover"
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 40, textAlign: "center", color: isToday ? "var(--t-accent)" : "var(--t-text-muted)" }}>
                <p style={{ fontSize: 10, textTransform: "uppercase", fontWeight: isToday ? 700 : 500 }}>{dayName}</p>
                <p style={{ fontSize: 14, fontWeight: 600 }}>{dayNum}</p>
              </div>
              {data.total > 0 ? (
                <div>
                  <p style={{ fontSize: 14, fontWeight: 500, color: "var(--t-text-primary)" }}>
                    {data.total} {data.total === 1 ? "job" : "jobs"}
                  </p>
                  <p style={{ fontSize: 11, color: "var(--t-text-muted)" }}>{parts.join(", ")}</p>
                </div>
              ) : (
                <p style={{ fontSize: 12, color: "var(--t-text-muted)", opacity: 0.5 }}>No jobs</p>
              )}
            </div>
            {data.total > 0 && (
              <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                {Array.from({ length: Math.min(data.total, 5) }).map((_, i) => (
                  <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: "var(--t-accent)", opacity: 0.4 }} />
                ))}
                {data.total > 5 && <span style={{ fontSize: 9, color: "var(--t-text-muted)" }}>+{data.total - 5}</span>}
              </div>
            )}
          </button>
        );
      })}
    </>
  );
}
