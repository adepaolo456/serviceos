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
  MoreHorizontal,
  Send,
  CheckCircle2,
  FileText,
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
  asset_subtype?: string;
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
  if (s === "completed") return "text-[var(--t-accent-text)]";
  if (s === "confirmed") return "text-[var(--t-accent-text)]";
  if (s === "overdue" || s === "cancelled") return "text-[var(--t-error)]";
  if (s === "pending") return "text-[var(--t-warning)]";
  if (s === "dispatched") return "text-[var(--t-warning)]";
  if (s === "en_route") return "text-[var(--t-warning)]";
  if (s === "in_progress") return "text-[var(--t-info)]";
  return "text-[var(--t-text-muted)]";
}

/* ─── Job type text (no badge backgrounds) ─── */

function jobTypeTextClass(t: string): string {
  if (t === "delivery") return "text-[var(--t-info)]";
  if (t === "pickup") return "text-[var(--t-warning)]";
  if (t === "exchange") return "text-[var(--t-text-secondary)]";
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
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);

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
  const inProgressCount = getCount("in_progress") + getCount("en_route");
  const completedCount = getCount("completed");

  const PRIMARY_STATUSES = ["all", "overdue", "pending", "confirmed"] as const;
  const SECONDARY_STATUSES = ["dispatched", "en_route", "in_progress", "completed", "cancelled"] as const;

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

  const thStyle: React.CSSProperties = { padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--t-text-muted)", whiteSpace: "nowrap" };

  return (
    <div>
      {/* ─── Header ─── */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--t-text-primary)" }}>Jobs</h1>
          <p className="mt-1" style={{ fontSize: 13, color: "var(--t-text-muted)" }}>
            {totalCount} total{unassignedCount > 0 && <> &middot; <span style={{ fontWeight: 600, color: "var(--t-warning)" }}>{unassignedCount} unassigned</span></>}
          </p>
        </div>
        <button onClick={() => openWizard()} className="btn-primary inline-flex items-center gap-1.5 text-sm shrink-0">
          <Plus className="h-4 w-4" strokeWidth={2.5} /> New Booking
        </button>
      </div>

      {/* ─── Stat strip ─── */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: "Unassigned", value: unassignedCount, color: unassignedCount > 0 ? "var(--t-warning)" : "var(--t-accent)", bg: unassignedCount > 0 ? "var(--t-warning-soft)" : undefined, filter: "pending", icon: AlertCircle },
          { label: "Today", value: todayCount, color: "var(--t-text-primary)", filter: "all", icon: Calendar },
          { label: "In Progress", value: inProgressCount, color: "var(--t-info)", filter: "in_progress", icon: Truck },
          { label: "Completed", value: completedCount, color: "var(--t-accent)", filter: "completed", icon: CheckCircle2 },
        ].map((stat) => (
          <button
            key={stat.label}
            onClick={() => { setStatusFilter(stat.filter); if (stat.label === "Today") setDateRange("today"); }}
            className="surface-card card-hover text-left px-4 py-3"
            style={stat.bg ? { backgroundColor: stat.bg } : undefined}
          >
            <div className="flex items-center justify-between mb-1">
              <stat.icon style={{ width: 14, height: 14, color: stat.color }} />
              {stat.value > 0 && stat.label === "Unassigned" && (
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--t-warning)", display: "inline-block" }} />
              )}
            </div>
            <p style={{ fontSize: 24, fontWeight: 700, color: stat.color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{stat.value}</p>
            <p style={{ fontSize: 11, fontWeight: 500, color: "var(--t-text-muted)", marginTop: 4 }}>{stat.label}</p>
          </button>
        ))}
      </div>

      {/* ─── Controls bar ─── */}
      <div className="surface-card mb-5" style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Row 1: Primary filters + secondary overflow + date range */}
        <div className="flex items-center gap-1 flex-wrap">
          {/* Primary statuses */}
          {PRIMARY_STATUSES.map((s) => {
            const isActive = statusFilter === s;
            const count = getCount(s);
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: isActive ? 600 : 500,
                  background: isActive ? "var(--t-accent-soft)" : "transparent",
                  color: isActive ? "var(--t-accent-text)" : "var(--t-text-secondary)",
                  border: "none", cursor: "pointer", transition: "all 0.12s ease",
                }}
              >
                {STATUS_LABELS[s]}
                {count > 0 && <span style={{ fontSize: 10, fontWeight: 700, opacity: isActive ? 1 : 0.6, color: s === "overdue" ? "var(--t-error)" : undefined }}>{count}</span>}
              </button>
            );
          })}
          {/* Separator */}
          <span style={{ width: 1, height: 16, background: "var(--t-border)", margin: "0 4px" }} />
          {/* Secondary statuses */}
          {SECONDARY_STATUSES.map((s) => {
            const isActive = statusFilter === s;
            const count = getCount(s);
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: isActive ? 600 : 400,
                  background: isActive ? "var(--t-accent-soft)" : "transparent",
                  color: isActive ? "var(--t-accent-text)" : "var(--t-text-muted)",
                  border: "none", cursor: "pointer", transition: "all 0.12s ease",
                }}
              >
                {STATUS_LABELS[s]}
                {count > 0 && <span style={{ fontSize: 10, fontWeight: 600, opacity: isActive ? 1 : 0.4 }}>{count}</span>}
              </button>
            );
          })}
          {/* Date range — pushed right */}
          <div className="ml-auto" style={{ display: "flex", borderRadius: 8, border: "1px solid var(--t-border)", overflow: "hidden" }}>
            {DATE_RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDateRange(opt.value)}
                style={{
                  padding: "5px 12px", fontSize: 11, fontWeight: 500, border: "none", cursor: "pointer",
                  background: dateRange === opt.value ? "var(--t-accent-soft)" : "transparent",
                  color: dateRange === opt.value ? "var(--t-accent-text)" : "var(--t-text-muted)",
                  transition: "all 0.12s ease",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Search + sort */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "var(--t-text-muted)" }} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search job #, customer, phone, address..."
              className="input-field"
              style={{ paddingLeft: 32, fontSize: 13, borderRadius: 8, padding: "7px 12px 7px 32px" }}
            />
          </div>
          <Dropdown
            trigger={
              <button className="btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, padding: "6px 10px", border: "1px solid var(--t-border)", borderRadius: 8 }}>
                <ArrowDownUp className="h-3 w-3" />
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
                  color: sortBy === opt.value ? "var(--t-accent-text)" : "var(--t-text-primary)",
                  background: sortBy === opt.value ? "var(--t-accent-soft)" : "transparent",
                  border: "none", cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            ))}
          </Dropdown>
        </div>
      </div>

      {/* ─── Job Table ─── */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 w-full skeleton" style={{ borderRadius: 14 }} />
          ))}
        </div>
      ) : filteredJobs.length === 0 ? (
        <div className="surface-card py-20 flex flex-col items-center justify-center text-center">
          <Briefcase size={44} style={{ color: "var(--t-text-tertiary)" }} className="mb-3" />
          <h2 style={{ fontSize: 17, fontWeight: 600, color: "var(--t-text-primary)" }} className="mb-1">
            {searchQuery ? "No matching jobs" : "No jobs yet"}
          </h2>
          <p style={{ fontSize: 13, color: "var(--t-text-muted)" }} className="mb-5">
            {searchQuery ? "Try a different search" : "Create your first job to get started"}
          </p>
          {!searchQuery && (
            <button onClick={() => setPanelOpen(true)} className="btn-primary inline-flex items-center gap-2 text-sm">
              <Plus className="h-4 w-4" /> New Job
            </button>
          )}
        </div>
      ) : (
        <div className="surface-card" style={{ overflow: "hidden", padding: 0 }}>
          <div className="table-scroll">
            <table className="w-full" style={{ fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr className="table-header" style={{ borderBottom: "1px solid var(--t-border)" }}>
                  <th style={{ ...thStyle, padding: "10px 6px 10px 14px", width: 36 }}>
                    <input
                      type="checkbox"
                      checked={filteredJobs.length > 0 && filteredJobs.every(j => selectedJobIds.has(j.id))}
                      onChange={() => {
                        const allSelected = filteredJobs.every(j => selectedJobIds.has(j.id));
                        setSelectedJobIds(prev => {
                          const next = new Set(prev);
                          if (allSelected) filteredJobs.forEach(j => next.delete(j.id));
                          else filteredJobs.forEach(j => next.add(j.id));
                          return next;
                        });
                      }}
                      className="h-3.5 w-3.5 rounded cursor-pointer accent-[var(--t-accent)]"
                    />
                  </th>
                  <th style={{ ...thStyle, width: 72 }}>Size</th>
                  <th style={{ ...thStyle, width: 80 }}>Type</th>
                  <th style={thStyle}>Customer</th>
                  <th style={thStyle}>Address</th>
                  <th style={{ ...thStyle, width: 130 }}>Schedule</th>
                  <th style={{ ...thStyle, width: 100 }}>Driver</th>
                  <th style={{ ...thStyle, width: 90 }}>Status</th>
                  <th style={{ ...thStyle, textAlign: "right", width: 90 }}>Price</th>
                  <th style={{ ...thStyle, width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map((job) => {
                  const customerName = job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : "";
                  const address = fmtAddress(job.service_address);
                  const isToday = job.scheduled_date === todayStr;

                  return (
                    <tr
                      key={job.id}
                      onClick={() => router.push(`/jobs/${job.id}`)}
                      className="table-row cursor-pointer"
                      style={{
                        borderBottom: "1px solid var(--t-border-subtle)",
                        ...(job.is_overdue ? { borderLeft: "3px solid var(--t-error)", backgroundColor: "var(--t-error-soft)" }
                          : !job.assigned_driver && !["completed", "cancelled"].includes(job.status) ? { borderLeft: "3px solid var(--t-warning)", backgroundColor: "var(--t-warning-soft)" }
                          : isToday ? { borderLeft: "3px solid var(--t-accent)", backgroundColor: "var(--t-accent-soft)" }
                          : { borderLeft: "3px solid transparent" }),
                      }}
                    >
                      <td style={{ padding: "12px 6px 12px 14px", width: 36 }}>
                        <input
                          type="checkbox"
                          checked={selectedJobIds.has(job.id)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            e.stopPropagation();
                            setSelectedJobIds(prev => {
                              const next = new Set(prev);
                              if (next.has(job.id)) next.delete(job.id); else next.add(job.id);
                              return next;
                            });
                          }}
                          className="h-3.5 w-3.5 rounded cursor-pointer accent-[var(--t-accent)]"
                        />
                      </td>

                      {/* Size */}
                      <td style={{ padding: "12px 16px 12px 12px" }}>
                        {(job.asset_subtype || job.asset?.subtype) ? (
                          <span style={{ fontSize: 13, fontWeight: 800, color: "var(--t-text-primary)", background: "var(--t-accent-soft)", padding: "2px 7px", borderRadius: 5, whiteSpace: "nowrap", letterSpacing: "0.02em" }}>
                            {(job.asset_subtype || job.asset?.subtype || "").replace(/yd$/i, "Y").toUpperCase()}
                          </span>
                        ) : (
                          <span style={{ color: "var(--t-text-tertiary)" }}>&mdash;</span>
                        )}
                      </td>

                      {/* Type */}
                      <td style={{ padding: "12px 16px" }}>
                        <span className={jobTypeTextClass(job.job_type)} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          {job.job_type}
                        </span>
                      </td>

                      {/* Customer (primary) + Job # (secondary) */}
                      <td style={{ padding: "12px 16px" }}>
                        <p style={{ fontWeight: 600, fontSize: 13, color: "var(--t-text-primary)", lineHeight: 1.3 }}>{customerName || <span style={{ color: "var(--t-text-tertiary)" }}>No customer</span>}</p>
                        <p style={{ fontSize: 11, color: "var(--t-text-muted)", fontVariantNumeric: "tabular-nums", marginTop: 1 }}>{job.job_number}</p>
                      </td>

                      {/* Address */}
                      <td style={{ padding: "12px 16px", maxWidth: 240 }}>
                        {address ? (
                          <span style={{ fontSize: 12, color: "var(--t-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{address}</span>
                        ) : (
                          <span style={{ color: "var(--t-text-tertiary)" }}>&mdash;</span>
                        )}
                      </td>

                      {/* Schedule */}
                      <td style={{ padding: "12px 16px" }}>
                        <p style={{ fontSize: 12, fontWeight: 500, color: "var(--t-text-primary)", lineHeight: 1.3 }}>
                          {job.scheduled_date ? fmtDate(job.scheduled_date) : <span style={{ color: "var(--t-text-tertiary)" }}>TBD</span>}
                        </p>
                        {job.scheduled_window_start && (
                          <p style={{ fontSize: 11, color: "var(--t-text-muted)", fontVariantNumeric: "tabular-nums", marginTop: 1 }}>
                            {fmtTime(job.scheduled_window_start)}{job.scheduled_window_end ? `–${fmtTime(job.scheduled_window_end)}` : ""}
                          </p>
                        )}
                      </td>

                      {/* Driver */}
                      <td style={{ padding: "12px 16px" }}>
                        {job.assigned_driver ? (
                          <span style={{ fontSize: 12, color: "var(--t-text-secondary)" }}>
                            {job.assigned_driver.first_name} {job.assigned_driver.last_name?.[0]}.
                          </span>
                        ) : (
                          <span className="badge-warning" style={{ fontSize: 10, padding: "1px 6px" }}>Unassigned</span>
                        )}
                      </td>

                      {/* Status */}
                      <td style={{ padding: "12px 16px" }}>
                        <span className={statusTextClass(job.status)} style={{ fontSize: 11, fontWeight: 600, textTransform: "capitalize" }}>
                          {STATUS_LABELS[job.status] || job.status.replace(/_/g, " ")}
                        </span>
                        {job.is_overdue && (
                          <p className="badge-error" style={{ fontSize: 9, fontWeight: 700, marginTop: 3, padding: "0px 5px", display: "inline-block" }}>
                            +{job.extra_days}d
                          </p>
                        )}
                      </td>

                      {/* Price */}
                      <td style={{ padding: "12px 16px", textAlign: "right" }}>
                        {job.total_price > 0 ? (
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--t-text-primary)", fontVariantNumeric: "tabular-nums" }}>
                            ${Number(job.total_price).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </span>
                        ) : (
                          <span style={{ color: "var(--t-text-tertiary)" }}>&mdash;</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: "12px 8px 12px 0", textAlign: "center" }}>
                        <Dropdown
                          trigger={
                            <button
                              onClick={(e) => e.stopPropagation()}
                              className="btn-ghost rounded-md p-1"
                              style={{ color: "var(--t-text-tertiary)" }}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          }
                          align="right"
                        >
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await api.patch(`/jobs/${job.id}/status`, { status: "completed" });
                                toast("success", "Job marked complete");
                                fetchJobs();
                              } catch { toast("error", "Failed to update status"); }
                            }}
                            className="flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors"
                            style={{ color: "var(--t-text-primary)", border: "none", background: "none", cursor: "pointer" }}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "var(--t-accent)" }} /> Mark Complete
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await api.patch(`/jobs/${job.id}/status`, { status: "dispatched" });
                                toast("success", "Job sent to driver");
                                fetchJobs();
                              } catch { toast("error", "Failed to update status"); }
                            }}
                            className="flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors"
                            style={{ color: "var(--t-text-primary)", border: "none", background: "none", cursor: "pointer" }}
                          >
                            <Send className="h-3.5 w-3.5" style={{ color: "var(--t-warning)" }} /> Send to Driver
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/invoices?jobId=${job.id}`);
                            }}
                            className="flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors"
                            style={{ color: "var(--t-text-primary)", border: "none", background: "none", cursor: "pointer" }}
                          >
                            <FileText className="h-3.5 w-3.5" style={{ color: "var(--t-text-muted)" }} /> View Invoice
                          </button>
                        </Dropdown>
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
        <div className="mt-5 flex items-center justify-between" style={{ fontSize: 13, color: "var(--t-text-muted)" }}>
          <span>Showing {(page - 1) * 30 + 1}–{Math.min(page * 30, total)} of {total}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn-ghost"
              style={{ padding: "5px 12px", fontSize: 12, border: "1px solid var(--t-border)", borderRadius: 8, opacity: page === 1 ? 0.4 : 1 }}
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page * 30 >= total}
              className="btn-ghost"
              style={{ padding: "5px 12px", fontSize: 12, border: "1px solid var(--t-border)", borderRadius: 8, opacity: page * 30 >= total ? 0.4 : 1 }}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Bulk Action Floating Bar */}
      {selectedJobIds.size > 0 && (
        <div
          className="surface-elevated animate-fade-in"
          style={{
            position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 50,
            padding: "10px 20px", display: "flex", alignItems: "center", gap: 16,
            boxShadow: "var(--t-shadow-lg)", backdropFilter: "blur(12px)",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--t-text-primary)" }}>
            {bulkProgress || `${selectedJobIds.size} selected`}
          </span>
          <div style={{ width: 1, height: 20, background: "var(--t-border)" }} />
          {!bulkProgress && (
            <>
              <button
                onClick={async () => {
                  if (selectedJobIds.size > 25) { toast("error", "Select 25 or fewer jobs for bulk actions"); return; }
                  const driverId = prompt("Driver ID:");
                  if (!driverId) return;
                  const ids = Array.from(selectedJobIds);
                  for (let i = 0; i < ids.length; i++) {
                    setBulkProgress(`Assigning ${i + 1} of ${ids.length}...`);
                    try { await api.patch(`/jobs/${ids[i]}`, { assignedDriverId: driverId }); } catch { /* continue */ }
                  }
                  setBulkProgress(null);
                  setSelectedJobIds(new Set());
                  toast("success", `Assigned ${ids.length} job(s)`);
                  fetchJobs();
                }}
                className="rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-95"
                style={{ background: "var(--t-warning)", color: "var(--t-accent-on-accent)" }}
              >
                Assign Driver
              </button>
              <button
                onClick={async () => {
                  if (selectedJobIds.size > 25) { toast("error", "Select 25 or fewer jobs for bulk actions"); return; }
                  const ids = Array.from(selectedJobIds);
                  for (let i = 0; i < ids.length; i++) {
                    setBulkProgress(`Completing ${i + 1} of ${ids.length}...`);
                    try { await api.patch(`/jobs/${ids[i]}/status`, { status: "completed" }); } catch { /* continue */ }
                  }
                  setBulkProgress(null);
                  setSelectedJobIds(new Set());
                  toast("success", `Marked ${ids.length} job(s) as completed`);
                  fetchJobs();
                }}
                className="rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-95"
                style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}
              >
                Mark Complete
              </button>
            </>
          )}
          <div style={{ width: 1, height: 20, background: "var(--t-border)" }} />
          <button
            onClick={() => { setSelectedJobIds(new Set()); setBulkProgress(null); }}
            className="btn-ghost text-xs"
          >
            Clear
          </button>
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

  // 2A: Pre-fill driver from last job
  useEffect(() => {
    const lastDriver = sessionStorage.getItem("serviceos_lastJobDriver");
    if (lastDriver) setDriverId(lastDriver);
  }, []);

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
      if (driverId) sessionStorage.setItem("serviceos_lastJobDriver", driverId);
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
                background: assetSubtype === s ? "var(--t-accent)" : "transparent",
                color: assetSubtype === s ? "var(--t-accent-on-accent)" : "var(--t-text-muted)",
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
            <span className="tabular-nums" style={{ fontWeight: 700, color: "var(--t-accent-text)" }}>${priceQuote.breakdown.total.toFixed(2)}</span>
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={saving}
        style={{
          width: "100%", background: "var(--t-accent)", color: "var(--t-accent-on-accent)", fontWeight: 600, fontSize: 14,
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
