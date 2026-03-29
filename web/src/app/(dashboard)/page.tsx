"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  UserPlus,
  Calculator,
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

const JOB_TYPE_BADGE: Record<string, string> = {
  delivery: "bg-blue-500/10 text-blue-400",
  pickup: "bg-orange-500/10 text-orange-400",
  exchange: "bg-purple-500/10 text-purple-400",
};

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-400",
  confirmed: "bg-blue-500/10 text-blue-400",
  dispatched: "bg-purple-500/10 text-purple-400",
  en_route: "bg-orange-500/10 text-orange-400",
  in_progress: "bg-brand/10 text-brand",
  completed: "bg-emerald-500/10 text-emerald-400",
  cancelled: "bg-red-500/10 text-red-400",
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

/* ---- Component ---- */

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [todayJobs, setTodayJobs] = useState<TodayJob[]>([]);
  const [unassignedJobs, setUnassignedJobs] = useState<TodayJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobPanelOpen, setJobPanelOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(today);

  // "B" keyboard shortcut to open booking
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "b" && !e.metaKey && !e.ctrlKey && e.target === document.body) {
        router.push("/book");
      }
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
  }, []);

  // Load jobs for selected schedule date
  useEffect(() => {
    async function loadJobs() {
      try {
        const tj = await api.get<JobsResponse>(`/jobs?scheduledDate=${scheduleDate}&limit=50`);
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
      <div className="space-y-6">
        <div className="h-14 skeleton rounded-xl" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3 h-96 skeleton rounded-2xl" />
          <div className="lg:col-span-2 h-96 skeleton rounded-2xl" />
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 skeleton rounded-xl" />)}
        </div>
      </div>
    );
  }

  const activeRentals = (dashboard?.jobs.total ?? 0) - (dashboard?.jobs.completed ?? 0) - (dashboard?.jobs.cancelled ?? 0);

  return (
    <div>
      {/* Greeting */}
      <p className="text-sm text-muted mb-4">
        {getGreeting()}, {user?.firstName || "there"}
      </p>

      {/* ============ SECTION 1: Quick Actions ============ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center mb-8">
        <Link
          href="/book"
          className="flex items-center gap-2 rounded-xl bg-[#2ECC71] px-5 py-3 text-sm font-bold text-white shadow-lg shadow-brand/20 transition-all hover:bg-[#1FA855] active:scale-95"
        >
          <Plus className="h-5 w-5" strokeWidth={2.5} />
          New Booking
        </Link>
        <Link
          href="/customers"
          className="flex items-center gap-2 rounded-xl bg-[#1E2D45] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#1A2740] active:scale-95"
        >
          <UserPlus className="h-4 w-4" />
          New Customer
        </Link>
        <Link
          href="/pricing"
          className="flex items-center gap-2 rounded-xl bg-[#1E2D45] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#1A2740] active:scale-95"
        >
          <Calculator className="h-4 w-4" />
          New Quote
        </Link>

        {/* Global search */}
        <div className="relative flex-1 max-w-sm sm:ml-auto">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search customers, jobs, assets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
            className="w-full rounded-xl bg-[#111C2E] border border-[#1E2D45] py-2.5 pl-10 pr-4 text-sm text-white placeholder-muted outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
          {searchOpen && searchResults.length > 0 && (
            <div className="absolute z-30 mt-1 w-full rounded-xl border border-[#1E2D45] bg-dark-secondary shadow-xl overflow-hidden">
              {searchResults.map((r) => (
                <button
                  key={`${r.type}-${r.id}`}
                  onMouseDown={() => router.push(r.href)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-dark-card-hover"
                >
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${r.type === "customer" ? "bg-brand/10 text-brand" : r.type === "job" ? "bg-blue-500/10 text-blue-400" : "bg-orange-500/10 text-orange-400"}`}>
                    {r.type}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white truncate">{r.title}</p>
                    <p className="text-xs text-muted truncate">{r.subtitle}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ============ SECTION 2: Today's Overview ============ */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5 mb-8">
        {/* Left: Today's Schedule */}
        <div className="lg:col-span-3 space-y-5">
          <div className="rounded-2xl border border-[#1E2D45] bg-dark-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#1E2D45]">
              <div className="flex items-center gap-2">
                <button onClick={() => setScheduleDate(d => shiftDate(d, -1))} className="rounded p-1 text-muted hover:text-white transition-colors active:scale-90">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button onClick={() => setScheduleDate(today())} className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-brand" />
                  <h2 className="font-display text-sm font-semibold text-white">{fmtShortDate(scheduleDate)}</h2>
                </button>
                <button onClick={() => setScheduleDate(d => shiftDate(d, 1))} className="rounded p-1 text-muted hover:text-white transition-colors active:scale-90">
                  <ChevronRight className="h-4 w-4" />
                </button>
                <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">{todayJobs.length}</span>
              </div>
              <Link href="/dispatch" className="text-xs text-brand hover:text-brand-light transition-colors">
                Dispatch <ArrowRight className="inline h-3 w-3" />
              </Link>
            </div>
            {todayJobs.length === 0 ? (
              <div className="flex flex-col items-center py-12">
                <Briefcase className="h-10 w-10 text-muted/20 mb-2" />
                <p className="text-sm text-muted">No jobs scheduled for {fmtShortDate(scheduleDate).toLowerCase()}</p>
                <button onClick={() => setJobPanelOpen(true)} className="mt-3 text-xs text-brand hover:text-brand-light">+ Create a job</button>
              </div>
            ) : (
              <div className="divide-y divide-[#1E2D45]">
                {todayJobs.slice(0, 8).map((job) => {
                  const addr = job.service_address;
                  const addrStr = addr ? [addr.street, addr.city].filter(Boolean).join(", ") : "";
                  return (
                    <Link key={job.id} href={`/jobs/${job.id}`} className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-dark-card-hover">
                      <div className="w-16 shrink-0 text-center">
                        <p className="text-sm font-medium text-white tabular-nums">{formatTime(job.scheduled_window_start)}</p>
                        {job.scheduled_window_end && <p className="text-[10px] text-muted tabular-nums">{formatTime(job.scheduled_window_end)}</p>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-white truncate">
                          {job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : job.job_number}
                        </p>
                        {addrStr && <p className="text-xs text-muted truncate flex items-center gap-1"><MapPin className="h-3 w-3 shrink-0" />{addrStr}</p>}
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${JOB_TYPE_BADGE[job.job_type] || "bg-zinc-500/10 text-zinc-400"}`}>{job.job_type}</span>
                      <div className="w-20 shrink-0 text-right">
                        {job.assigned_driver ? (
                          <p className="text-xs text-foreground truncate">{job.assigned_driver.first_name}</p>
                        ) : (
                          <span className="text-[10px] text-red-400">Unassigned</span>
                        )}
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_BADGE[job.status] || "bg-zinc-500/10 text-zinc-400"}`}>{job.status.replace(/_/g, " ")}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right: This Week + Unassigned (if any) */}
        <div className="lg:col-span-2 space-y-5">
          {/* This Week */}
          <div className="rounded-2xl border border-[#1E2D45] bg-dark-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#1E2D45]">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-brand" />
                <h2 className="font-display text-sm font-semibold text-white">This Week</h2>
              </div>
            </div>
            <div className="divide-y divide-[#1E2D45]">
              <WeekView scheduleDate={scheduleDate} onSelectDay={setScheduleDate} />
            </div>
          </div>

          {/* Unassigned Jobs — only show if there are any */}
          {unassignedJobs.length > 0 && (
            <div className="rounded-2xl border border-red-500/10 bg-dark-card overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-[#1E2D45]">
                <UserPlus2 className="h-4 w-4 text-red-400" />
                <h2 className="font-display text-sm font-semibold text-white">Unassigned</h2>
                <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-400">{unassignedJobs.length}</span>
              </div>
              <div className="divide-y divide-[#1E2D45]">
                {unassignedJobs.slice(0, 5).map((job) => (
                  <Link key={job.id} href={`/jobs/${job.id}`} className="flex items-center justify-between px-5 py-2.5 transition-colors hover:bg-dark-card-hover">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : job.job_number}
                      </p>
                      <p className="text-[10px] text-muted capitalize">{job.job_type} · {job.asset?.identifier || "No asset"}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${JOB_TYPE_BADGE[job.job_type] || "bg-zinc-500/10 text-zinc-400"}`}>{job.job_type}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ============ SECTION 3: Business Snapshot ============ */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Revenue This Month", value: `$${(dashboard?.revenue.thisMonth ?? 0).toLocaleString()}`, icon: DollarSign },
          { label: "Jobs This Month", value: String(dashboard?.jobs.thisMonth ?? 0), icon: Briefcase },
          { label: "Completed", value: String(dashboard?.jobs.completed ?? 0), icon: CheckCircle2 },
          { label: "Active Rentals", value: String(activeRentals), icon: Truck },
        ].map((s) => (
          <Link key={s.label} href="/analytics" className="group flex items-center gap-3 rounded-xl border border-[#1E2D45] bg-dark-card p-4 transition-all hover:bg-dark-card-hover hover:border-brand/20">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/10 shrink-0">
              <s.icon className="h-4 w-4 text-brand" />
            </div>
            <div>
              <p className="text-lg font-bold text-white tabular-nums">{s.value}</p>
              <p className="text-[10px] text-muted">{s.label}</p>
            </div>
          </Link>
        ))}
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
      customerLat: address.lat || 30.27, customerLng: address.lng || -97.74,
      // yardLat/yardLng omitted — API auto-fetches from primary yard
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

  const inputClass = "w-full bg-[#111C2E] border border-[#1E2D45] rounded-lg px-4 py-3 text-sm text-white placeholder-muted outline-none focus:border-brand focus:ring-1 focus:ring-brand";
  const labelClass = "block text-xs font-medium text-muted uppercase tracking-wider mb-1.5";

  return (
    <div className="space-y-5">
      {error && <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}

      {/* Progress */}
      <div className="flex items-center gap-2">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${step >= s ? "bg-brand" : "bg-dark-elevated"}`} />
        ))}
      </div>

      {/* Step 1: Customer */}
      {step === 1 && (
        <div className="space-y-4">
          <h3 className="font-display text-base font-semibold text-white">Who is this for?</h3>
          {customerId ? (
            <div className="flex items-center justify-between rounded-lg border border-brand/20 bg-brand/5 px-4 py-3">
              <span className="text-sm text-white font-medium">{customerName}</span>
              <button onClick={() => { setCustomerId(""); setCustomerName(""); setIsNewCustomer(false); }} className="text-xs text-muted hover:text-red-400">Change</button>
            </div>
          ) : isNewCustomer ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input value={newFirstName} onChange={(e) => setNewFirstName(e.target.value)} className={inputClass} placeholder="First name" />
                <input value={newLastName} onChange={(e) => setNewLastName(e.target.value)} className={inputClass} placeholder="Last name" />
              </div>
              <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} className={inputClass} placeholder="Phone (optional)" />
              <button onClick={() => setIsNewCustomer(false)} className="text-xs text-muted hover:text-white">← Search existing</button>
            </div>
          ) : (
            <div className="space-y-3">
              <input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} className={inputClass} placeholder="Type name or phone number..." autoFocus />
              {customerResults.length > 0 && (
                <div className="rounded-lg border border-[#1E2D45] bg-dark-secondary overflow-hidden">
                  {customerResults.map((c) => (
                    <button key={c.id} onClick={() => { setCustomerId(c.id); setCustomerName(`${c.first_name} ${c.last_name}`); setCustomerSearch(""); }}
                      className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-foreground hover:bg-dark-card-hover">
                      <span className="font-medium text-white">{c.first_name} {c.last_name}</span>
                      {c.phone && <span className="text-xs text-muted">{c.phone}</span>}
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => setIsNewCustomer(true)} className="flex items-center gap-1.5 text-xs text-brand hover:text-brand-light">
                <UserPlus className="h-3 w-3" /> Create new customer
              </button>
            </div>
          )}
          <button
            onClick={() => step === 1 && (customerId || (isNewCustomer && newFirstName)) && setStep(2)}
            disabled={!customerId && !(isNewCustomer && newFirstName)}
            className="w-full rounded-lg bg-[#2ECC71] py-3 text-sm font-semibold text-white disabled:opacity-40 hover:bg-[#1FA855] active:scale-[0.98] transition-all"
          >
            Next: Job Details
          </button>
        </div>
      )}

      {/* Step 2: Job Details */}
      {step === 2 && (
        <div className="space-y-4">
          <h3 className="font-display text-base font-semibold text-white">Job Details</h3>
          <div>
            <label className={labelClass}>Job Type</label>
            <div className="grid grid-cols-3 gap-2">
              {(["delivery", "pickup", "exchange"] as const).map((t) => (
                <button key={t} onClick={() => setJobType(t)} className={`rounded-lg py-2.5 text-sm font-medium capitalize transition-colors ${jobType === t ? "bg-brand text-dark-primary" : "bg-dark-elevated text-muted hover:text-white"}`}>{t}</button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelClass}>Dumpster Size</label>
            <div className="grid grid-cols-4 gap-2">
              {["10yd", "20yd", "30yd", "40yd"].map((s) => (
                <button key={s} onClick={() => setAssetSubtype(s)} className={`rounded-lg py-2.5 text-sm font-medium transition-colors ${assetSubtype === s ? "bg-brand text-dark-primary" : "bg-dark-elevated text-muted hover:text-white"}`}>{s}</button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelClass}>Date</label>
            <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Time Window</label>
            <div className="grid grid-cols-3 gap-2">
              {([["morning", "AM (8-12)"], ["afternoon", "PM (12-5)"], ["fullday", "All Day"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setTimeWindow(k)} className={`rounded-lg py-2.5 text-xs font-medium transition-colors ${timeWindow === k ? "bg-brand text-dark-primary" : "bg-dark-elevated text-muted hover:text-white"}`}>{label}</button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="flex-1 rounded-lg bg-dark-elevated py-3 text-sm text-muted hover:text-white">Back</button>
            <button onClick={() => setStep(3)} className="flex-[2] rounded-lg bg-[#2ECC71] py-3 text-sm font-semibold text-white hover:bg-[#1FA855] active:scale-[0.98] transition-all">Next: Address</button>
          </div>
        </div>
      )}

      {/* Step 3: Address */}
      {step === 3 && (
        <div className="space-y-4">
          <h3 className="font-display text-base font-semibold text-white">Service Address</h3>
          <AddressAutocomplete
            value={address}
            onChange={setAddress}
            label="Address"
            placeholder="Start typing an address..."
          />
          {address.street && (
            <div className="rounded-lg bg-dark-elevated p-3 text-xs text-muted space-y-1">
              <p className="text-white font-medium">{address.street}</p>
              <p>{address.city}, {address.state} {address.zip}</p>
              {address.lat && <p className="text-[10px]">GPS: {address.lat.toFixed(4)}, {address.lng?.toFixed(4)}</p>}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="flex-1 rounded-lg bg-dark-elevated py-3 text-sm text-muted hover:text-white">Back</button>
            <button onClick={() => setStep(4)} className="flex-[2] rounded-lg bg-[#2ECC71] py-3 text-sm font-semibold text-white hover:bg-[#1FA855] active:scale-[0.98] transition-all">Next: Review</button>
          </div>
        </div>
      )}

      {/* Step 4: Review & Confirm */}
      {step === 4 && (
        <div className="space-y-4">
          <h3 className="font-display text-base font-semibold text-white">Review & Create</h3>
          <div className="rounded-lg bg-dark-elevated p-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted">Customer</span><span className="text-white font-medium">{isNewCustomer ? `${newFirstName} ${newLastName}` : customerName}</span></div>
            <div className="flex justify-between"><span className="text-muted">Type</span><span className="text-white capitalize">{jobType}</span></div>
            <div className="flex justify-between"><span className="text-muted">Size</span><span className="text-white">{assetSubtype}</span></div>
            <div className="flex justify-between"><span className="text-muted">Date</span><span className="text-white">{scheduledDate}</span></div>
            <div className="flex justify-between"><span className="text-muted">Window</span><span className="text-white capitalize">{timeWindow === "fullday" ? "All Day" : timeWindow === "morning" ? "AM (8-12)" : "PM (12-5)"}</span></div>
            {address.street && <div className="flex justify-between"><span className="text-muted">Address</span><span className="text-white truncate ml-4">{address.street}, {address.city}</span></div>}
          </div>
          {priceQuote && (
            <div className="rounded-lg border border-brand/20 bg-brand/5 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-brand font-medium">Estimated Price</span>
                <span className="font-display text-xl font-bold text-brand tabular-nums">${priceQuote.breakdown.total}</span>
              </div>
              <div className="mt-2">
                <input value={priceOverride} onChange={(e) => setPriceOverride(e.target.value)} className={`${inputClass} mt-1`} placeholder={`Override price (default: $${priceQuote.breakdown.total})`} />
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => setStep(3)} className="flex-1 rounded-lg bg-dark-elevated py-3 text-sm text-muted hover:text-white">Back</button>
            <button onClick={handleSubmit} disabled={saving} className="flex-[2] rounded-lg bg-[#2ECC71] py-3 text-sm font-bold text-white hover:bg-[#1FA855] active:scale-[0.98] transition-all disabled:opacity-50">
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
      {days.map((d) => {
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
            className={`flex w-full items-center justify-between px-5 py-2.5 text-left transition-colors hover:bg-dark-card-hover ${isSelected ? "border-l-2 border-l-brand bg-brand/5" : "border-l-2 border-l-transparent"}`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 text-center ${isToday ? "text-brand font-bold" : "text-muted"}`}>
                <p className="text-[10px] uppercase">{dayName}</p>
                <p className="text-sm font-semibold">{dayNum}</p>
              </div>
              {data.total > 0 ? (
                <div>
                  <p className="text-sm font-medium text-white">{data.total} {data.total === 1 ? "job" : "jobs"}</p>
                  <p className="text-[10px] text-muted">{parts.join(", ")}</p>
                </div>
              ) : (
                <p className="text-xs text-muted/50">No jobs</p>
              )}
            </div>
            {data.total > 0 && (
              <div className="flex gap-0.5">
                {Array.from({ length: Math.min(data.total, 5) }).map((_, i) => (
                  <div key={i} className="h-1.5 w-1.5 rounded-full bg-brand/40" />
                ))}
                {data.total > 5 && <span className="text-[8px] text-muted">+{data.total - 5}</span>}
              </div>
            )}
          </button>
        );
      })}
    </>
  );
}
