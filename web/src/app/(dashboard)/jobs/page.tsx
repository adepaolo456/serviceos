"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useBooking } from "@/components/booking-provider";
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
  rescheduled_by_customer?: boolean;
  rescheduled_from_date?: string;
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

const STATUS_LABELS: Record<string, string> = {
  all: "All", overdue: "Overdue", pending: "Pending", confirmed: "Confirmed", dispatched: "Dispatched",
  en_route: "En Route", arrived: "Arrived", in_progress: "In Progress",
  completed: "Completed", cancelled: "Cancelled",
};

/* ─── Status text colors (no badge backgrounds) ─── */

function statusTextClass(s: string): string {
  if (s === "completed") return "text-[#22C55E]";
  if (s === "confirmed") return "text-[#22C55E]";
  if (s === "overdue" || s === "cancelled") return "text-[#F87171]";
  if (s === "pending") return "text-[#FCD34D]";
  if (s === "dispatched") return "text-[#FCD34D]";
  if (s === "en_route") return "text-[#FCD34D]";
  if (s === "in_progress") return "text-[#3B82F6]";
  return "text-[var(--t-text-muted)]";
}

/* ─── Job type text (no badge backgrounds) ─── */

function jobTypeTextClass(t: string): string {
  if (t === "delivery") return "text-[#3B82F6]";
  if (t === "pickup") return "text-[#F97316]";
  if (t === "exchange") return "text-[#A855F7]";
  return "text-[var(--t-text-muted)]";
}

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
  if (!d) return "\u2014";
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
  const { openWizard } = useBooking();
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

  const totalCount = getCount("all");
  const todayStr = new Date().toISOString().split("T")[0];
  const todayCount = jobs.filter((j) => j.scheduled_date === todayStr).length;
  const unassignedCount = statusCounts.filter((c) => ["pending", "confirmed"].includes(c.status)).reduce((s, c) => s + Number(c.count), 0);

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
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-1px", color: "var(--t-frame-text)" }}>
            Jobs
          </h1>
          <p style={{ fontSize: 14, color: "var(--t-frame-text-muted)", marginTop: 4 }}>
            {totalCount} total &middot;{" "}
            <span style={{ color: "var(--t-frame-text)" }}>{todayCount} today</span> &middot;{" "}
            {unassignedCount > 0 ? (
              <span style={{ color: "var(--t-error)" }}>{unassignedCount} unassigned</span>
            ) : (
              <span style={{ color: "#22C55E" }}>All assigned</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Date range pills */}
          <div className="flex overflow-hidden" style={{ borderRadius: 24, border: "1px solid rgba(255,255,255,0.08)" }}>
            {DATE_RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDateRange(opt.value)}
                style={{
                  padding: "6px 14px", fontSize: 12, fontWeight: 500,
                  background: dateRange === opt.value ? "var(--t-accent-soft)" : "transparent",
                  color: dateRange === opt.value ? "#22C55E" : "var(--t-frame-text-muted)",
                  border: "none", cursor: "pointer", transition: "all 0.15s ease",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => openWizard()}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: "#22C55E", color: "#000", fontWeight: 600, fontSize: 14,
              padding: "10px 20px", borderRadius: 24,
              transition: "opacity 0.15s ease", cursor: "pointer", border: "none",
            }}
            onMouseOver={(e) => (e.currentTarget.style.opacity = "0.9")}
            onMouseOut={(e) => (e.currentTarget.style.opacity = "1")}
          >
            <Plus className="h-4 w-4" />
            New Booking
          </button>
        </div>
      </div>

      {/* ─── Filter Tabs (Pills) ─── */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {STATUSES.map((s) => {
          const isActive = statusFilter === s;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 14px", borderRadius: 24, fontSize: 13, fontWeight: 500,
                background: isActive ? "var(--t-accent-soft)" : "rgba(255,255,255,0.06)",
                color: isActive ? "#22C55E" : "var(--t-frame-text-muted)",
                border: isActive ? "1px solid transparent" : "1px solid rgba(255,255,255,0.08)",
                transition: "all 0.15s ease", cursor: "pointer",
              }}
            >
              {STATUS_LABELS[s]}
              <span style={{ fontSize: 11, opacity: 0.7 }}>{getCount(s)}</span>
            </button>
          );
        })}
      </div>

      {/* Search & Sort */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "var(--t-frame-text-muted)" }} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search job #, customer, phone, address..."
            style={{
              width: "100%", borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.06)", padding: "10px 16px 10px 40px",
              fontSize: 14, color: "var(--t-frame-text)", outline: "none",
              transition: "border 0.15s ease",
            }}
          />
        </div>
        <Dropdown
          trigger={
            <button
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 24, fontSize: 13, fontWeight: 500,
                border: "1px solid var(--t-frame-border)", background: "transparent",
                color: "var(--t-frame-text-muted)", cursor: "pointer", transition: "all 0.15s ease",
              }}
            >
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
              className="block w-full px-4 py-2 text-left text-sm transition-colors"
              style={{
                color: sortBy === opt.value ? "#22C55E" : "var(--t-text-primary)",
                background: sortBy === opt.value ? "var(--t-accent-soft)" : "transparent",
              }}
            >
              {opt.label}
            </button>
          ))}
        </Dropdown>
      </div>

      {/* ─── Job Table ─── */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 w-full skeleton" style={{ borderRadius: 14 }} />
          ))}
        </div>
      ) : filteredJobs.length === 0 ? (
        <div className="py-24 flex flex-col items-center justify-center text-center">
          <Briefcase size={48} style={{ color: "var(--t-text-muted)", opacity: 0.3 }} className="mb-4" />
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--t-text-primary)" }} className="mb-1">
            {searchQuery ? "No matching jobs" : "No jobs yet"}
          </h2>
          <p style={{ fontSize: 14, color: "var(--t-text-muted)" }} className="mb-6">
            {searchQuery ? "Try a different search" : "Create your first job to get started"}
          </p>
          {!searchQuery && (
            <button
              onClick={() => setPanelOpen(true)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                background: "#22C55E", color: "#000", fontWeight: 600, fontSize: 14,
                padding: "10px 20px", borderRadius: 24,
                transition: "opacity 0.15s ease", cursor: "pointer", border: "none",
              }}
            >
              <Plus className="h-4 w-4" />
              New Job
            </button>
          )}
        </div>
      ) : (
        <div style={{ borderRadius: 14, border: "1px solid var(--t-border)", background: "var(--t-bg-card)", overflow: "hidden" }}>
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--t-border)" }}>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Customer</th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Address</th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Schedule</th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Type</th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Size</th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Driver</th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Status</th>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Price</th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map((job) => {
                  const customerName = job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : "No customer";
                  const address = fmtAddress(job.service_address);
                  const hasRental = job.rental_start_date && job.rental_end_date;
                  const rentalDays = hasRental ? daysBetween(job.rental_start_date, job.rental_end_date) : job.rental_days;

                  return (
                    <tr
                      key={job.id}
                      onClick={() => router.push(`/jobs/${job.id}`)}
                      className="cursor-pointer"
                      style={{ borderBottom: "1px solid var(--t-border)", transition: "background 0.15s ease" }}
                      onMouseOver={(e) => (e.currentTarget.style.background = "var(--t-bg-card-hover)")}
                      onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      {/* Customer */}
                      <td style={{ padding: "14px 16px" }}>
                        <p style={{ fontWeight: 600, fontSize: 14, color: "var(--t-text-primary)" }}>{customerName}</p>
                        <p style={{ fontSize: 12, color: "var(--t-text-muted)", fontFamily: "monospace" }}>{job.job_number}</p>
                      </td>

                      {/* Address */}
                      <td style={{ padding: "14px 16px", maxWidth: 220 }} className="truncate">
                        {address ? (
                          <span style={{ fontSize: 13, color: "var(--t-text-muted)" }}>{address}</span>
                        ) : (
                          <span style={{ fontSize: 13, color: "var(--t-text-muted)", opacity: 0.5 }}>\u2014</span>
                        )}
                      </td>

                      {/* Schedule */}
                      <td style={{ padding: "14px 16px" }}>
                        <p style={{ fontSize: 13, color: "var(--t-text-primary)" }}>
                          {job.scheduled_date ? fmtDateFull(job.scheduled_date) : "Unscheduled"}
                        </p>
                        {job.scheduled_window_start && (
                          <p style={{ fontSize: 12, color: "var(--t-text-muted)" }}>
                            {fmtTime(job.scheduled_window_start)}{job.scheduled_window_end ? ` \u2013 ${fmtTime(job.scheduled_window_end)}` : ""}
                          </p>
                        )}
                      </td>

                      {/* Type */}
                      <td style={{ padding: "14px 16px" }}>
                        <span className={jobTypeTextClass(job.job_type)} style={{ fontSize: 11, fontWeight: 600, textTransform: "capitalize" }}>
                          {job.job_type}
                        </span>
                      </td>

                      {/* Size */}
                      <td style={{ padding: "14px 16px" }}>
                        {job.asset?.subtype ? (
                          <span style={{ fontSize: 13, color: "var(--t-text-muted)" }}>{job.asset.subtype}</span>
                        ) : (
                          <span style={{ fontSize: 13, color: "var(--t-text-muted)", opacity: 0.5 }}>\u2014</span>
                        )}
                      </td>

                      {/* Driver */}
                      <td style={{ padding: "14px 16px" }}>
                        {job.assigned_driver ? (
                          <span style={{ fontSize: 13, color: "var(--t-text-primary)" }}>
                            {job.assigned_driver.first_name} {job.assigned_driver.last_name}
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, fontWeight: 600, color: "#FCD34D" }}>Unassigned</span>
                        )}
                      </td>

                      {/* Status */}
                      <td style={{ padding: "14px 16px" }}>
                        <span className={statusTextClass(job.status)} style={{ fontSize: 11, fontWeight: 600 }}>
                          {STATUS_LABELS[job.status] || job.status.replace(/_/g, " ")}
                        </span>
                        {job.is_overdue && (
                          <p style={{ fontSize: 10, fontWeight: 700, color: "var(--t-error)", marginTop: 2 }}>
                            OVERDUE {job.extra_days}d
                          </p>
                        )}
                        {job.rescheduled_by_customer && (
                          <p style={{ fontSize: 10, fontWeight: 500, color: "#FCD34D", marginTop: 2 }}>
                            Rescheduled by customer
                          </p>
                        )}
                      </td>

                      {/* Price */}
                      <td style={{ padding: "14px 16px", textAlign: "right" }}>
                        {job.total_price > 0 ? (
                          <span className="tabular-nums" style={{ fontSize: 14, fontWeight: 600, color: "var(--t-text-primary)" }}>
                            ${Number(job.total_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <span style={{ fontSize: 13, color: "var(--t-text-muted)", opacity: 0.5 }}>\u2014</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {total > 30 && (
        <div className="mt-6 flex items-center justify-between" style={{ fontSize: 14, color: "var(--t-text-muted)" }}>
          <span>Showing {(page - 1) * 30 + 1}\u2013{Math.min(page * 30, total)} of {total}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              style={{
                padding: "6px 14px", borderRadius: 24, fontSize: 13,
                border: "1px solid var(--t-border)", background: "var(--t-bg-card)",
                color: "var(--t-text-muted)", cursor: "pointer",
                transition: "all 0.15s ease", opacity: page === 1 ? 0.4 : 1,
              }}
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page * 30 >= total}
              style={{
                padding: "6px 14px", borderRadius: 24, fontSize: 13,
                border: "1px solid var(--t-border)", background: "var(--t-bg-card)",
                color: "var(--t-text-muted)", cursor: "pointer",
                transition: "all 0.15s ease", opacity: page * 30 >= total ? 0.4 : 1,
              }}
            >
              Next
            </button>
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

  const inp: React.CSSProperties = {
    width: "100%", borderRadius: 14, border: "1px solid var(--t-border)",
    background: "var(--t-bg-card)", padding: "10px 16px",
    fontSize: 14, color: "var(--t-text-primary)", outline: "none",
  };
  const lbl: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 500, color: "var(--t-text-muted)", marginBottom: 6 };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div style={{ borderRadius: 14, background: "var(--t-error-soft)", padding: "12px 16px", fontSize: 14, color: "var(--t-error)" }}>{error}</div>
      )}

      {/* Customer search */}
      <div className="relative">
        <label style={lbl}>Customer</label>
        {selectedCustomerName ? (
          <div className="flex items-center justify-between" style={{ borderRadius: 14, border: "1px solid var(--t-border)", background: "var(--t-bg-card)", padding: "10px 16px" }}>
            <span style={{ fontSize: 14, color: "var(--t-text-primary)" }}>{selectedCustomerName}</span>
            <button type="button" onClick={() => { setCustomerId(""); setSelectedCustomerName(""); setCustomerSearch(""); }} style={{ fontSize: 12, color: "var(--t-text-muted)", background: "none", border: "none", cursor: "pointer" }}>Clear</button>
          </div>
        ) : (
          <input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} onFocus={() => customerResults.length > 0 && setShowCustomerDropdown(true)} style={inp} placeholder="Search customers..." />
        )}
        {showCustomerDropdown && customerResults.length > 0 && (
          <div className="absolute z-10 mt-1 w-full" style={{ borderRadius: 14, border: "1px solid var(--t-border)", background: "var(--t-bg-primary)", boxShadow: "0 10px 30px rgba(0,0,0,0.3)" }}>
            {customerResults.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { setCustomerId(c.id); setSelectedCustomerName(`${c.first_name} ${c.last_name}`); setShowCustomerDropdown(false); setCustomerSearch(""); }}
                className="w-full text-left transition-colors first:rounded-t-[14px] last:rounded-b-[14px]"
                style={{ padding: "10px 16px", fontSize: 14, color: "var(--t-text-primary)", background: "transparent", border: "none", cursor: "pointer" }}
                onMouseOver={(e) => (e.currentTarget.style.background = "var(--t-bg-card-hover)")}
                onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {c.first_name} {c.last_name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label style={lbl}>Job Type</label>
          <select value={jobType} onChange={(e) => setJobType(e.target.value)} style={{ ...inp, appearance: "none" as const }}>
            <option value="delivery">Delivery</option>
            <option value="pickup">Pickup</option>
            <option value="exchange">Exchange</option>
          </select>
        </div>
        <div>
          <label style={lbl}>Service Type</label>
          <select value={serviceType} onChange={(e) => setServiceType(e.target.value)} style={{ ...inp, appearance: "none" as const }}>
            <option value="dumpster_rental">Dumpster Rental</option>
            <option value="pod_storage">Pod Storage</option>
            <option value="restroom_service">Restroom Service</option>
          </select>
        </div>
      </div>

      <div>
        <label style={lbl}>Dumpster Size</label>
        <div className="flex gap-1 rounded-[20px] p-1" style={{ background: "var(--t-bg-card)" }}>
          {["10yd", "15yd", "20yd", "30yd", "40yd"].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setAssetSubtype(s)}
              className="flex-1 py-2 text-sm font-medium"
              style={{
                borderRadius: 10, border: "none", cursor: "pointer",
                background: assetSubtype === s ? "#22C55E" : "transparent",
                color: assetSubtype === s ? "#000" : "var(--t-text-muted)",
                transition: "all 0.15s ease",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label style={lbl}>Scheduled Date</label>
        <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} style={inp} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div><label style={lbl}>Window Start</label><input type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} style={inp} /></div>
        <div><label style={lbl}>Window End</label><input type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} style={inp} /></div>
      </div>

      <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
        <legend style={{ fontSize: 14, fontWeight: 500, color: "var(--t-text-primary)", marginBottom: 12 }}>Service Address</legend>
        <div className="space-y-3">
          <input value={street} onChange={(e) => setStreet(e.target.value)} style={inp} placeholder="Street address" />
          <div className="grid grid-cols-3 gap-3">
            <input value={city} onChange={(e) => setCity(e.target.value)} style={inp} placeholder="City" />
            <input value={addrState} onChange={(e) => setAddrState(e.target.value)} style={inp} placeholder="State" />
            <input value={zip} onChange={(e) => setZip(e.target.value)} style={inp} placeholder="ZIP" />
          </div>
        </div>
      </fieldset>

      <div>
        <label style={lbl}>Placement Notes</label>
        <textarea value={placementNotes} onChange={(e) => setPlacementNotes(e.target.value)} rows={2} style={{ ...inp, resize: "none" as const }} placeholder="Where to place the dumpster..." />
      </div>

      <div>
        <label style={lbl}>Assign Asset</label>
        <select value={assetId} onChange={(e) => setAssetId(e.target.value)} style={{ ...inp, appearance: "none" as const }}>
          <option value="">Auto-assign later</option>
          {assets.filter((a) => a.subtype === assetSubtype).map((a) => (
            <option key={a.id} value={a.id}>{a.identifier} ({a.subtype})</option>
          ))}
        </select>
      </div>

      {/* Price */}
      {priceQuote && (
        <div className="space-y-2" style={{ borderRadius: 14, border: "1px solid var(--t-border)", background: "var(--t-bg-card)", padding: 16 }}>
          <div className="flex justify-between text-sm">
            <span style={{ color: "var(--t-text-muted)" }}>Base Price</span>
            <span className="tabular-nums" style={{ color: "var(--t-text-primary)" }}>${priceQuote.breakdown.basePrice.toFixed(2)}</span>
          </div>
          {priceQuote.breakdown.distanceSurcharge > 0 && (
            <div className="flex justify-between text-sm">
              <span style={{ color: "var(--t-text-muted)" }}>Distance Surcharge</span>
              <span className="tabular-nums" style={{ color: "var(--t-text-primary)" }}>${priceQuote.breakdown.distanceSurcharge.toFixed(2)}</span>
            </div>
          )}
          {priceQuote.breakdown.jobFee > 0 && (
            <div className="flex justify-between text-sm">
              <span style={{ color: "var(--t-text-muted)" }}>Service Fee</span>
              <span className="tabular-nums" style={{ color: "var(--t-text-primary)" }}>${priceQuote.breakdown.jobFee.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm pt-2 mt-2" style={{ borderTop: "1px solid var(--t-border)" }}>
            <span style={{ fontWeight: 600, color: "var(--t-text-primary)" }}>Total</span>
            <span className="tabular-nums" style={{ fontWeight: 700, color: "#22C55E" }}>${priceQuote.breakdown.total.toFixed(2)}</span>
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={saving}
        style={{
          width: "100%", background: "#22C55E", color: "#000", fontWeight: 600, fontSize: 14,
          padding: "10px 20px", borderRadius: 24, border: "none",
          cursor: "pointer", transition: "opacity 0.15s ease",
          opacity: saving ? 0.5 : 1,
        }}
      >
        {saving ? "Creating..." : "Create Job"}
      </button>
    </form>
  );
}
