"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Briefcase,
  Search,
  Truck,
  ArrowDownUp,
  MapPin,
  Calendar,
  Clock,
  User,
  Box,
  DollarSign,
  ArrowRight,
  AlertCircle,
  Filter,
} from "lucide-react";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";
import Dropdown from "@/components/dropdown";
import { useToast } from "@/components/toast";

/* ─── Types ─── */

interface Job {
  id: string;
  job_number: string;
  job_type: string;
  service_type: string;
  status: string;
  priority: string;
  scheduled_date: string;
  scheduled_window_start: string;
  scheduled_window_end: string;
  service_address: Record<string, string> | null;
  rental_start_date: string;
  rental_end_date: string;
  rental_days: number;
  base_price: number;
  total_price: number;
  customer: { id: string; first_name: string; last_name: string; phone?: string } | null;
  asset: { id: string; identifier: string; asset_type: string; subtype: string } | null;
  assigned_driver: { id: string; first_name: string; last_name: string } | null;
  is_overdue?: boolean;
  extra_days?: number;
  created_at: string;
}

interface JobsResponse {
  data: Job[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface StatusCount {
  status: string;
  count: number;
}

interface CustomerOption { id: string; first_name: string; last_name: string }
interface AssetOption { id: string; identifier: string; asset_type: string; subtype: string }
interface DriverOption { id: string; first_name: string; last_name: string }
interface PriceQuote { breakdown: { basePrice: number; total: number; tax: number; distanceSurcharge: number; extraDayCharges: number; jobFee: number } }

/* ─── Constants ─── */

const STATUSES = ["all", "overdue", "pending", "confirmed", "dispatched", "en_route", "in_progress", "completed", "cancelled"] as const;

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  overdue:     { bg: "bg-red-500/10",    text: "text-red-400",    dot: "bg-red-400" },
  pending:     { bg: "bg-yellow-500/10", text: "text-yellow-400", dot: "bg-yellow-400" },
  confirmed:   { bg: "bg-blue-500/10",   text: "text-blue-400",   dot: "bg-blue-400" },
  dispatched:  { bg: "bg-purple-500/10", text: "text-purple-400", dot: "bg-purple-400" },
  en_route:    { bg: "bg-orange-500/10", text: "text-orange-400", dot: "bg-orange-400" },
  arrived:     { bg: "bg-teal-500/10",   text: "text-teal-400",   dot: "bg-teal-400" },
  in_progress: { bg: "bg-brand/10",      text: "text-brand",      dot: "bg-brand" },
  completed:   { bg: "bg-emerald-500/10",text: "text-emerald-400",dot: "bg-emerald-400" },
  cancelled:   { bg: "bg-red-500/10",    text: "text-red-400",    dot: "bg-red-400" },
};

const STATUS_LABELS: Record<string, string> = {
  all: "All", overdue: "Overdue", pending: "Pending", confirmed: "Confirmed", dispatched: "Dispatched",
  en_route: "En Route", arrived: "Arrived", in_progress: "In Progress",
  completed: "Completed", cancelled: "Cancelled",
};

const JOB_TYPE_BADGE: Record<string, { icon: string; color: string }> = {
  delivery: { icon: "🔵", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  pickup:   { icon: "🟠", color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  exchange: { icon: "🟣", color: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
};

const SIZE_BADGE: Record<string, string> = {
  "10yd": "bg-sky-500/10 text-sky-400 border-sky-500/20",
  "15yd": "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  "20yd": "bg-violet-500/10 text-violet-400 border-violet-500/20",
  "30yd": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "40yd": "bg-rose-500/10 text-rose-400 border-rose-500/20",
};

const DATE_RANGE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "all", label: "All Time" },
] as const;

const SORT_OPTIONS = [
  { value: "date_desc", label: "Newest First" },
  { value: "date_asc", label: "Oldest First" },
  { value: "job_number", label: "Job Number" },
  { value: "customer", label: "Customer Name" },
  { value: "status", label: "Status" },
] as const;

/* ─── Helpers ─── */

function fmtDate(d: string): string {
  if (!d) return "";
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtDateFull(d: string): string {
  if (!d) return "—";
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtTime(t: string): string {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  return `${hour > 12 ? hour - 12 : hour || 12}:${m} ${ampm}`;
}

function fmtAddress(addr: Record<string, string> | null): string {
  if (!addr) return "";
  return [addr.street, addr.city, addr.state].filter(Boolean).join(", ");
}

function daysBetween(a: string, b: string): number {
  if (!a || !b) return 0;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function getDateRange(range: string): { dateFrom?: string; dateTo?: string } {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  if (range === "today") return { dateFrom: fmt(today), dateTo: fmt(today) };
  if (range === "week") {
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { dateFrom: fmt(start), dateTo: fmt(end) };
  }
  if (range === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { dateFrom: fmt(start), dateTo: fmt(end) };
  }
  return {};
}

/* ─── Main Page ─── */

export default function JobsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateRange, setDateRange] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("date_desc");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [statusCounts, setStatusCounts] = useState<StatusCount[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      if (statusFilter === "overdue") {
        const overdueJobs = await api.get<any[]>("/automation/overdue");
        setJobs(overdueJobs as unknown as Job[]);
        setTotal(overdueJobs.length);
      } else {
        const params = new URLSearchParams({ page: String(page), limit: "30" });
        if (statusFilter !== "all") params.set("status", statusFilter);
        const range = getDateRange(dateRange);
        if (range.dateFrom) params.set("dateFrom", range.dateFrom);
        if (range.dateTo) params.set("dateTo", range.dateTo);
        const res = await api.get<JobsResponse>(`/jobs?${params.toString()}`);
        setJobs(res.data);
        setTotal(res.meta.total);
      }
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [page, statusFilter, dateRange]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  useEffect(() => {
    api.get<StatusCount[]>("/analytics/jobs-by-status").then(setStatusCounts).catch(() => {});
    api.get<any[]>("/automation/overdue").then((r) => setOverdueCount(r.length)).catch(() => {});
  }, []);

  useEffect(() => { setPage(1); }, [statusFilter, dateRange]);

  const getCount = (s: string) => {
    if (s === "all") return statusCounts.reduce((sum, c) => sum + Number(c.count), 0);
    if (s === "overdue") return overdueCount;
    return Number(statusCounts.find((c) => c.status === s)?.count ?? 0);
  };

  // Counts for subtitle
  const totalCount = getCount("all");
  const todayStr = new Date().toISOString().split("T")[0];
  const todayCount = jobs.filter((j) => j.scheduled_date === todayStr).length;
  const unassignedCount = statusCounts.filter((c) => ["pending", "confirmed"].includes(c.status)).reduce((s, c) => s + Number(c.count), 0);

  // Client-side search + sort
  const filteredJobs = useMemo(() => {
    let result = [...jobs];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((j) => {
        const customerName = j.customer ? `${j.customer.first_name} ${j.customer.last_name}`.toLowerCase() : "";
        const phone = j.customer?.phone || "";
        const addr = fmtAddress(j.service_address).toLowerCase();
        return (
          j.job_number.toLowerCase().includes(q) ||
          customerName.includes(q) ||
          phone.includes(q) ||
          addr.includes(q)
        );
      });
    }
    result.sort((a, b) => {
      if (sortBy === "date_desc") return (b.scheduled_date || b.created_at).localeCompare(a.scheduled_date || a.created_at);
      if (sortBy === "date_asc") return (a.scheduled_date || a.created_at).localeCompare(b.scheduled_date || b.created_at);
      if (sortBy === "job_number") return a.job_number.localeCompare(b.job_number);
      if (sortBy === "customer") {
        const an = a.customer ? `${a.customer.first_name} ${a.customer.last_name}` : "";
        const bn = b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : "";
        return an.localeCompare(bn);
      }
      if (sortBy === "status") return a.status.localeCompare(b.status);
      return 0;
    });
    return result;
  }, [jobs, searchQuery, sortBy]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">Jobs</h1>
          <p className="mt-1 text-sm text-muted">
            {totalCount} total &middot;{" "}
            <span className="text-white">{todayCount} today</span> &middot;{" "}
            {unassignedCount > 0 ? (
              <span className="text-red-400">{unassignedCount} unassigned</span>
            ) : (
              <span className="text-emerald-400">All assigned</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Date range */}
          <div className="flex rounded-lg border border-[#1E2D45] overflow-hidden">
            {DATE_RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDateRange(opt.value)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  dateRange === opt.value ? "bg-brand/10 text-brand" : "text-muted hover:text-white"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => router.push("/book")}
            className="flex items-center gap-2 rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1FA855] btn-press"
          >
            <Plus className="h-4 w-4" />
            New Booking
          </button>
        </div>
      </div>

      {/* Status Tabs */}
      <div className="mb-6 flex gap-0 overflow-x-auto border-b border-[#1E2D45]">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`relative shrink-0 px-4 py-3 text-sm font-medium transition-colors btn-press ${
              statusFilter === s ? "text-brand" : "text-muted hover:text-foreground"
            }`}
          >
            {STATUS_LABELS[s]}
            <span className={`ml-1.5 text-xs ${statusFilter === s ? "text-brand/70" : "text-muted/50"}`}>
              {getCount(s)}
            </span>
            {statusFilter === s && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brand rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Search & Sort */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search job #, customer, phone, address..."
            className="w-full rounded-lg bg-[#111C2E] border border-[#1E2D45] pl-10 pr-4 py-2 text-sm text-white placeholder-muted outline-none transition-colors focus:border-brand"
          />
        </div>
        <Dropdown
          trigger={
            <button className="flex items-center gap-2 rounded-lg border border-[#1E2D45] bg-[#111C2E] px-3 py-2 text-sm text-muted hover:text-white transition-colors">
              <ArrowDownUp className="h-3.5 w-3.5" />
              {SORT_OPTIONS.find((o) => o.value === sortBy)?.label}
            </button>
          }
          align="right"
        >
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSortBy(opt.value)}
              className={`block w-full px-4 py-2 text-left text-sm transition-colors ${
                sortBy === opt.value ? "text-brand bg-brand/5" : "text-foreground hover:bg-dark-card"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </Dropdown>
      </div>

      {/* Job Cards */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 w-full skeleton rounded-2xl" />
          ))}
        </div>
      ) : filteredJobs.length === 0 ? (
        <div className="py-24 flex flex-col items-center justify-center text-center">
          <Briefcase size={48} className="text-[#7A8BA3]/30 mb-4" />
          <h2 className="text-lg font-semibold text-white mb-1">
            {searchQuery ? "No matching jobs" : "No jobs yet"}
          </h2>
          <p className="text-sm text-muted mb-6">
            {searchQuery ? "Try a different search" : "Create your first job to get started"}
          </p>
          {!searchQuery && (
            <button
              onClick={() => setPanelOpen(true)}
              className="flex items-center gap-2 rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1FA855] btn-press"
            >
              <Plus className="h-4 w-4" />
              New Job
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredJobs.map((job) => (
            <JobCard key={job.id} job={job} onClick={() => router.push(`/jobs/${job.id}`)} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > 30 && (
        <div className="mt-6 flex items-center justify-between text-sm text-muted">
          <span>Showing {(page - 1) * 30 + 1}–{Math.min(page * 30, total)} of {total}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded-lg bg-dark-card px-3 py-1.5 transition-colors hover:bg-dark-card-hover disabled:opacity-40">Previous</button>
            <button onClick={() => setPage((p) => p + 1)} disabled={page * 30 >= total} className="rounded-lg bg-dark-card px-3 py-1.5 transition-colors hover:bg-dark-card-hover disabled:opacity-40">Next</button>
          </div>
        </div>
      )}

      {/* New Job Slide-Over */}
      <SlideOver open={panelOpen} onClose={() => setPanelOpen(false)} title="New Job">
        <NewJobForm onSuccess={() => { setPanelOpen(false); fetchJobs(); toast("success", "Job created"); }} />
      </SlideOver>
    </div>
  );
}

/* ─── Job Card ─── */

function JobCard({ job, onClick }: { job: Job; onClick: () => void }) {
  const status = STATUS_COLORS[job.status] || STATUS_COLORS.pending;
  const typeBadge = JOB_TYPE_BADGE[job.job_type] || JOB_TYPE_BADGE.delivery;
  const sizeBadge = job.asset?.subtype ? (SIZE_BADGE[job.asset.subtype] || "bg-zinc-500/10 text-zinc-400 border-zinc-500/20") : null;
  const customerName = job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : "No customer";
  const address = fmtAddress(job.service_address);
  const hasRental = job.rental_start_date && job.rental_end_date;
  const rentalDays = hasRental ? daysBetween(job.rental_start_date, job.rental_end_date) : job.rental_days;

  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl border border-[#1E2D45] bg-dark-card p-4 text-left transition-all hover:bg-dark-card-hover hover:border-white/10 card-hover btn-press"
    >
      <div className="flex items-start gap-4">
        {/* Left — Job # + Status */}
        <div className="shrink-0 w-32">
          <p className="font-mono text-sm font-semibold text-white">{job.job_number}</p>
          <span className={`inline-flex items-center gap-1.5 mt-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${status.bg} ${status.text}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
            {STATUS_LABELS[job.status] || job.status.replace(/_/g, " ")}
          </span>
          {job.is_overdue && (
            <span className="inline-flex items-center gap-1 mt-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-400">
              OVERDUE {job.extra_days}d
            </span>
          )}
        </div>

        {/* Center — Customer, Address, Type/Size */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-semibold text-white truncate">{customerName}</p>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${typeBadge.color}`}>
              {typeBadge.icon} {job.job_type}
            </span>
            {sizeBadge && (
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${sizeBadge}`}>
                {job.asset?.subtype}
              </span>
            )}
          </div>
          {address && (
            <p className="text-xs text-muted truncate max-w-[400px]">
              <MapPin className="inline h-3 w-3 mr-1 -mt-0.5" />{address}
            </p>
          )}
          {/* Rental period */}
          {hasRental && (
            <p className="text-xs text-muted mt-1">
              {fmtDate(job.rental_start_date)} <ArrowRight className="inline h-3 w-3 mx-0.5" /> {fmtDate(job.rental_end_date)}
              {rentalDays ? ` (${rentalDays} days)` : ""}
            </p>
          )}
        </div>

        {/* Right — Date, Driver, Price */}
        <div className="shrink-0 text-right space-y-1">
          <div className="flex items-center gap-1.5 justify-end">
            <Calendar className="h-3 w-3 text-muted" />
            <span className="text-xs text-foreground">{job.scheduled_date ? fmtDateFull(job.scheduled_date) : "Unscheduled"}</span>
          </div>
          {job.scheduled_window_start && (
            <div className="flex items-center gap-1.5 justify-end">
              <Clock className="h-3 w-3 text-muted" />
              <span className="text-xs text-muted">
                {fmtTime(job.scheduled_window_start)}{job.scheduled_window_end ? ` – ${fmtTime(job.scheduled_window_end)}` : ""}
              </span>
            </div>
          )}
          <div className="flex items-center gap-1.5 justify-end">
            <User className="h-3 w-3 text-muted" />
            {job.assigned_driver ? (
              <span className="text-xs text-foreground">{job.assigned_driver.first_name} {job.assigned_driver.last_name}</span>
            ) : (
              <span className="text-xs text-red-400 font-medium">Unassigned</span>
            )}
          </div>
          {job.total_price > 0 && (
            <p className="text-sm font-semibold text-white tabular-nums">${Number(job.total_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          )}
        </div>
      </div>
    </button>
  );
}

/* ─── New Job Form ─── */

function NewJobForm({ onSuccess }: { onSuccess: () => void }) {
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerOption[]>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [selectedCustomerName, setSelectedCustomerName] = useState("");
  const [jobType, setJobType] = useState("delivery");
  const [serviceType, setServiceType] = useState("dumpster_rental");
  const [assetSubtype, setAssetSubtype] = useState("20yd");
  const [scheduledDate, setScheduledDate] = useState("");
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [addrState, setAddrState] = useState("");
  const [zip, setZip] = useState("");
  const [placementNotes, setPlacementNotes] = useState("");
  const [assetId, setAssetId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [priceQuote, setPriceQuote] = useState<PriceQuote | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    api.get<{ data: AssetOption[] }>("/assets?status=available&limit=100").then((r) => setAssets(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!customerSearch || customerSearch.length < 2) { setCustomerResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await api.get<{ data: CustomerOption[] }>(`/customers?search=${encodeURIComponent(customerSearch)}&limit=8`);
        setCustomerResults(res.data);
        setShowCustomerDropdown(true);
      } catch { /* */ }
    }, 300);
  }, [customerSearch]);

  useEffect(() => {
    if (!serviceType || !assetSubtype) return;
    api.post<PriceQuote>("/pricing/calculate", {
      serviceType, assetSubtype, jobType,
      customerLat: 30.27, customerLng: -97.74, yardLat: 30.35, yardLng: -97.7,
    }).then(setPriceQuote).catch(() => setPriceQuote(null));
  }, [serviceType, assetSubtype, jobType]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!customerId) { setError("Please select a customer"); return; }
    setError("");
    setSaving(true);
    try {
      const serviceAddress = street || city || addrState || zip ? { street, city, state: addrState, zip } : undefined;
      await api.post("/jobs", {
        customerId, jobType, serviceType,
        scheduledDate: scheduledDate || undefined,
        scheduledWindowStart: windowStart || undefined,
        scheduledWindowEnd: windowEnd || undefined,
        serviceAddress,
        placementNotes: placementNotes || undefined,
        assetId: assetId || undefined,
        assignedDriverId: driverId || undefined,
        basePrice: priceQuote?.breakdown.basePrice,
        totalPrice: priceQuote?.breakdown.total,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  const inp = "w-full rounded-lg bg-[#111C2E] border border-[#1E2D45] px-4 py-2.5 text-sm text-white placeholder-muted outline-none transition-colors focus:border-brand";
  const lbl = "block text-sm font-medium text-[#7A8BA3] mb-1.5";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}

      {/* Customer search */}
      <div className="relative">
        <label className={lbl}>Customer</label>
        {selectedCustomerName ? (
          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-dark-card px-4 py-2.5">
            <span className="text-sm text-white">{selectedCustomerName}</span>
            <button type="button" onClick={() => { setCustomerId(""); setSelectedCustomerName(""); setCustomerSearch(""); }} className="text-xs text-muted hover:text-red-400">Clear</button>
          </div>
        ) : (
          <input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} onFocus={() => customerResults.length > 0 && setShowCustomerDropdown(true)} className={inp} placeholder="Search customers..." />
        )}
        {showCustomerDropdown && customerResults.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-lg border border-white/10 bg-dark-secondary shadow-xl">
            {customerResults.map((c) => (
              <button key={c.id} type="button" onClick={() => { setCustomerId(c.id); setSelectedCustomerName(`${c.first_name} ${c.last_name}`); setShowCustomerDropdown(false); setCustomerSearch(""); }} className="w-full px-4 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-dark-card-hover first:rounded-t-lg last:rounded-b-lg">
                {c.first_name} {c.last_name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Job Type</label>
          <select value={jobType} onChange={(e) => setJobType(e.target.value)} className={`${inp} appearance-none`}>
            <option value="delivery">Delivery</option>
            <option value="pickup">Pickup</option>
            <option value="exchange">Exchange</option>
          </select>
        </div>
        <div>
          <label className={lbl}>Service Type</label>
          <select value={serviceType} onChange={(e) => setServiceType(e.target.value)} className={`${inp} appearance-none`}>
            <option value="dumpster_rental">Dumpster Rental</option>
            <option value="pod_storage">Pod Storage</option>
            <option value="restroom_service">Restroom Service</option>
          </select>
        </div>
      </div>

      <div>
        <label className={lbl}>Dumpster Size</label>
        <div className="flex gap-1 rounded-lg bg-dark-card p-1">
          {["10yd", "15yd", "20yd", "30yd", "40yd"].map((s) => (
            <button key={s} type="button" onClick={() => setAssetSubtype(s)} className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors btn-press ${assetSubtype === s ? "bg-brand text-dark-primary" : "text-muted hover:text-foreground"}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={lbl}>Scheduled Date</label>
        <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className={inp} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div><label className={lbl}>Window Start</label><input type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} className={inp} /></div>
        <div><label className={lbl}>Window End</label><input type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} className={inp} /></div>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-foreground mb-3">Service Address</legend>
        <div className="space-y-3">
          <input value={street} onChange={(e) => setStreet(e.target.value)} className={inp} placeholder="Street address" />
          <div className="grid grid-cols-3 gap-3">
            <input value={city} onChange={(e) => setCity(e.target.value)} className={inp} placeholder="City" />
            <input value={addrState} onChange={(e) => setAddrState(e.target.value)} className={inp} placeholder="State" />
            <input value={zip} onChange={(e) => setZip(e.target.value)} className={inp} placeholder="ZIP" />
          </div>
        </div>
      </fieldset>

      <div>
        <label className={lbl}>Placement Notes</label>
        <textarea value={placementNotes} onChange={(e) => setPlacementNotes(e.target.value)} rows={2} className={`${inp} resize-none`} placeholder="Where to place the dumpster..." />
      </div>

      <div>
        <label className={lbl}>Assign Asset</label>
        <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className={`${inp} appearance-none`}>
          <option value="">Auto-assign later</option>
          {assets.filter((a) => a.subtype === assetSubtype).map((a) => (
            <option key={a.id} value={a.id}>{a.identifier} ({a.subtype})</option>
          ))}
        </select>
      </div>

      {/* Price */}
      {priceQuote && (
        <div className="rounded-xl border border-[#1E2D45] bg-[#111C2E] p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted">Base Price</span>
            <span className="text-foreground tabular-nums">${priceQuote.breakdown.basePrice.toFixed(2)}</span>
          </div>
          {priceQuote.breakdown.distanceSurcharge > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted">Distance Surcharge</span>
              <span className="text-foreground tabular-nums">${priceQuote.breakdown.distanceSurcharge.toFixed(2)}</span>
            </div>
          )}
          {priceQuote.breakdown.jobFee > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted">Service Fee</span>
              <span className="text-foreground tabular-nums">${priceQuote.breakdown.jobFee.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm border-t border-[#1E2D45] pt-2 mt-2">
            <span className="text-white font-semibold">Total</span>
            <span className="text-brand font-bold tabular-nums">${priceQuote.breakdown.total.toFixed(2)}</span>
          </div>
        </div>
      )}

      <button type="submit" disabled={saving} className="w-full rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1FA855] disabled:opacity-50 btn-press">
        {saving ? "Creating..." : "Create Job"}
      </button>
    </form>
  );
}
