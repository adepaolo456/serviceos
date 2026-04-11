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
import { CreditCard, FileWarning, MapPinOff } from "lucide-react";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import { getBlockedReason, isJobBlocked } from "@/lib/blocked-job";

/* ─── Types ─── */

interface JobChainLinkRef {
  jobId: string;
  taskType: string;
  scheduledDate: string;
  assetSubtype: string | null;
}

interface JobChainContext {
  chainId: string;
  sequenceNumber: number;
  previousLink: JobChainLinkRef | null;
  nextLink: JobChainLinkRef | null;
}

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
  // Board-enrichment fields — populated when the fetch passes
  // ?enrichment=board. Optional to preserve backward compatibility with
  // the raw /jobs response shape used by the legacy status filter path.
  linked_invoice?: { id: string; status: string; balance_due: number } | null;
  chain?: JobChainContext | null;
  open_billing_issue_count?: number;
  dispatch_ready?: boolean;
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

import { deriveDisplayStatus, DISPLAY_STATUS_LABELS, displayStatusColor } from "@/lib/job-status";

const STATUS_LABELS: Record<string, string> = {
  all: "All", overdue: "Overdue",
  pending_payment: "Pending Payment", unassigned: "Unassigned",
  assigned: "Assigned", en_route: "En Route", arrived: "Arrived",
  completed: "Completed", cancelled: "Cancelled",
  // Legacy stored values → display labels (for filter counts from API)
  pending: "Pending Payment", confirmed: "Unassigned", dispatched: "Assigned",
  in_progress: "Arrived",
};

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
  // Blocked drill-down sub-filter. Only meaningful when statusFilter === "blocked".
  // Operates on the already-fetched blocked slice — does NOT re-fetch.
  const [blockedSubview, setBlockedSubview] = useState<
    "all" | "billing_issue" | "unpaid_completed_invoice"
  >("all");
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
  // Tenant-wide blocker counts for the top strip tiles. Sourced from the
  // new /analytics/jobs-by-blocker endpoint, refreshed on mount.
  const [blockerCounts, setBlockerCounts] = useState<{
    payment_blocked: number;
    billing_issue: number;
    unassigned_active: number;
  }>({ payment_blocked: 0, billing_issue: 0, unassigned_active: 0 });
  // Jobs page top-strip counts — single source of truth for the 5 tiles.
  // Tenant-scoped on the server via /analytics/jobs-summary. `blocked` is
  // a computed UNION, not a stored status.
  const [summary, setSummary] = useState<{
    unassigned: number;
    assigned: number;
    enRoute: number;
    completed: number;
    blocked: number;
  }>({ unassigned: 0, assigned: 0, enRoute: 0, completed: 0, blocked: 0 });

  // Multi-status KPI groups: tile filter value → actual stored API statuses
  const MULTI_STATUS: Record<string, string[]> = {
    unassigned: ["pending", "confirmed"],
    arrived: ["arrived", "in_progress"],
  };

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      if (statusFilter === "overdue") {
        const overdueJobs = await api.get<any[]>("/automation/overdue");
        setJobs(overdueJobs as unknown as Job[]);
        setTotal(overdueJobs.length);
      } else if (MULTI_STATUS[statusFilter]) {
        // Multi-status KPI tiles: fetch each status in parallel and merge
        const statuses = MULTI_STATUS[statusFilter];
        const range = getDateRange(dateRange);
        const results = await Promise.all(
          statuses.map(s => {
            const params = new URLSearchParams({ page: "1", limit: "50", status: s, enrichment: "board" });
            if (range.dateFrom) params.set("dateFrom", range.dateFrom);
            if (range.dateTo) params.set("dateTo", range.dateTo);
            return api.get<JobsResponse>(`/jobs?${params.toString()}`);
          })
        );
        const merged = results.flatMap(r => r.data);
        setJobs(merged);
        setTotal(results.reduce((sum, r) => sum + r.meta.total, 0));
      } else if (statusFilter === "blocked") {
        // "Blocked" is a computed UI layer — NOT a stored job status.
        // Phase 2: hits the dedicated /analytics/jobs-blocked endpoint
        // which uses the IDENTICAL shared SQL predicate as
        // /analytics/jobs-summary.blocked, so the full blocked list and
        // the top-strip tile count can never drift. Replaces the
        // previous Phase 1 approach which fetched a 200-row slice of
        // /jobs and filtered client-side (a slice that could miss
        // blocked rows for large tenants). getBlockedReason /
        // isJobBlocked are still used client-side for per-row reason
        // chips and sub-filter segmentation.
        const params = new URLSearchParams();
        const range = getDateRange(dateRange);
        if (range.dateFrom) params.set("dateFrom", range.dateFrom);
        if (range.dateTo) params.set("dateTo", range.dateTo);
        const qs = params.toString();
        const blocked = await api.get<Job[]>(
          `/analytics/jobs-blocked${qs ? `?${qs}` : ""}`,
        );
        setJobs(blocked);
        setTotal(blocked.length);
      } else {
        const params = new URLSearchParams({ page: String(page), limit: "30", enrichment: "board" });
        // Map display filter keys to stored status values for API
        const DISPLAY_TO_STORED: Record<string, string> = { assigned: "dispatched", pending_payment: "pending" };
        const apiStatus = DISPLAY_TO_STORED[statusFilter] || statusFilter;
        if (apiStatus !== "all") params.set("status", apiStatus);
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
    // Tenant-wide blocker counts for the new Payment Blocked tile.
    api
      .get<{ payment_blocked: number; billing_issue: number; unassigned_active: number }>(
        "/analytics/jobs-by-blocker",
      )
      .then(setBlockerCounts)
      .catch(() => {});
    // Top-strip summary counts (unassigned / assigned / en route / completed / blocked).
    api
      .get<{
        unassigned: number;
        assigned: number;
        enRoute: number;
        completed: number;
        blocked: number;
      }>("/analytics/jobs-summary")
      .then(setSummary)
      .catch(() => {});
  }, []);

  useEffect(() => { setPage(1); }, [statusFilter, dateRange]);

  // Reset the Blocked sub-view whenever the user leaves the Blocked
  // filter, so re-entering always starts clean on "all".
  useEffect(() => {
    if (statusFilter !== "blocked") setBlockedSubview("all");
  }, [statusFilter]);

  const getCount = (s: string) => {
    if (s === "all") return statusCounts.reduce((sum, c) => sum + Number(c.count), 0);
    if (s === "overdue") return overdueCount;
    // Map display filter keys to stored status values
    if (s === "unassigned") return statusCounts.filter((c) => ["pending", "confirmed"].includes(c.status)).reduce((sum, c) => sum + Number(c.count), 0);
    if (s === "assigned") return Number(statusCounts.find((c) => c.status === "dispatched")?.count ?? 0);
    if (s === "arrived") return statusCounts.filter((c) => ["arrived", "in_progress"].includes(c.status)).reduce((sum, c) => sum + Number(c.count), 0);
    return Number(statusCounts.find((c) => c.status === s)?.count ?? 0);
  };

  const totalCount = getCount("all");
  const unassignedCount = statusCounts.filter((c) => ["pending", "confirmed"].includes(c.status)).reduce((s, c) => s + Number(c.count), 0);

  const PRIMARY_STATUSES = ["all", "overdue", "unassigned", "assigned"] as const;
  const SECONDARY_STATUSES = ["en_route", "arrived", "completed", "cancelled"] as const;

  // Per-reason counts inside the current blocked slice, used by the
  // sub-filter pills. Recomputed whenever the fetched slice changes.
  const blockedReasonCounts = useMemo(() => {
    if (statusFilter !== "blocked") {
      return { all: 0, billing_issue: 0, unpaid_completed_invoice: 0 };
    }
    let billing_issue = 0;
    let unpaid_completed_invoice = 0;
    for (const j of jobs) {
      const reason = getBlockedReason(j);
      if (reason === "billing_issue") billing_issue++;
      else if (reason === "unpaid_completed_invoice") unpaid_completed_invoice++;
    }
    return { all: jobs.length, billing_issue, unpaid_completed_invoice };
  }, [jobs, statusFilter]);

  const filteredJobs = useMemo(() => {
    let result = [...jobs];
    // Blocked drill-down: narrow the already-fetched blocked slice by
    // reason. Pure client-side — no extra fetch.
    if (statusFilter === "blocked" && blockedSubview !== "all") {
      result = result.filter((j) => getBlockedReason(j) === blockedSubview);
    }
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
  }, [jobs, searchQuery, sortBy, statusFilter, blockedSubview]);

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
      </div>

      {/* ─── Stat strip ─── */}
      {/*
       * Registry-driven top strip. Labels + tooltips resolve through
       * FEATURE_REGISTRY so tenant overrides and the Help Center stay in
       * sync. Counts come from /analytics/jobs-summary (tenant-scoped on
       * the server). Blocked is a computed union — see isJobBlocked().
       */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {[
          {
            key: "unassigned",
            featureId: "job_status_unassigned",
            value: summary.unassigned,
            color: summary.unassigned > 0 ? "var(--t-warning)" : "var(--t-text-primary)",
            filter: "unassigned" as const,
            icon: AlertCircle,
            clickable: true,
          },
          {
            key: "assigned",
            featureId: "job_status_assigned",
            value: summary.assigned,
            color: "var(--t-info, #3b82f6)",
            filter: "assigned" as const,
            icon: Send,
            clickable: true,
          },
          {
            key: "en_route",
            featureId: "job_status_en_route",
            value: summary.enRoute,
            color: "var(--t-info, #3b82f6)",
            filter: "en_route" as const,
            icon: Truck,
            clickable: true,
          },
          {
            key: "completed",
            featureId: "job_status_completed",
            value: summary.completed,
            color: "var(--t-accent)",
            filter: "completed" as const,
            icon: CheckCircle2,
            clickable: true,
          },
          {
            key: "blocked",
            featureId: "job_status_blocked",
            value: summary.blocked,
            color: summary.blocked > 0 ? "var(--t-error)" : "var(--t-text-primary)",
            // Blocked is a computed UI layer, not a stored status — the
            // fetchJobs branch for "blocked" handles the filtering by
            // applying isJobBlocked to a wide enriched slice.
            filter: "blocked" as const,
            icon: FileWarning,
          },
        ].map((stat) => {
          const feature = FEATURE_REGISTRY[stat.featureId];
          const label = feature?.label ?? stat.key;
          const tooltip = feature?.shortDescription;
          const Icon = stat.icon;
          return (
            <button
              key={stat.key}
              onClick={() => { setStatusFilter(stat.filter); setDateRange("all"); }}
              className="surface-card card-hover text-left px-4 py-3"
              title={tooltip}
            >
              <div className="flex items-center justify-between mb-1">
                <Icon style={{ width: 14, height: 14, color: stat.color }} />
                {stat.key === "blocked" && stat.value > 0 && (
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--t-error)", display: "inline-block" }} />
                )}
                {stat.key === "unassigned" && stat.value > 0 && (
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--t-warning)", display: "inline-block" }} />
                )}
              </div>
              <p style={{ fontSize: 24, fontWeight: 700, color: stat.color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{stat.value}</p>
              <p style={{ fontSize: 11, fontWeight: 500, color: "var(--t-text-muted)", marginTop: 4 }}>{label}</p>
            </button>
          );
        })}
      </div>

      {/* ─── Controls bar ─── */}
      <div className="surface-card mb-5" style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Row 1: Primary filters + secondary overflow + date range */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Primary statuses */}
          <div style={{ display: "inline-flex", borderRadius: 22, backgroundColor: "var(--t-bg-secondary)", border: "1px solid var(--t-border)", padding: 3, gap: 2 }}>
            {PRIMARY_STATUSES.map((s) => {
              const isActive = statusFilter === s;
              const count = getCount(s);
              return (
                <button key={s} onClick={() => setStatusFilter(s)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 18, fontSize: 12, fontWeight: 600, background: isActive ? "var(--t-accent)" : "transparent", color: isActive ? "#fff" : "var(--t-text-muted)", border: "none", cursor: "pointer", transition: "all 0.15s ease" }}>
                  {STATUS_LABELS[s]}
                  {count > 0 && <span style={{ fontSize: 10, fontWeight: 700, opacity: isActive ? 0.85 : 0.6, color: !isActive && s === "overdue" ? "var(--t-error)" : undefined }}>{count}</span>}
                </button>
              );
            })}
          </div>
          {/* Secondary statuses */}
          <div style={{ display: "inline-flex", borderRadius: 22, backgroundColor: "var(--t-bg-secondary)", border: "1px solid var(--t-border)", padding: 3, gap: 2 }}>
            {SECONDARY_STATUSES.map((s) => {
              const isActive = statusFilter === s;
              const count = getCount(s);
              return (
                <button key={s} onClick={() => setStatusFilter(s)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 18, fontSize: 11, fontWeight: 600, background: isActive ? "var(--t-accent)" : "transparent", color: isActive ? "#fff" : "var(--t-text-muted)", border: "none", cursor: "pointer", transition: "all 0.15s ease" }}>
                  {STATUS_LABELS[s]}
                  {count > 0 && <span style={{ fontSize: 10, fontWeight: 700, opacity: isActive ? 0.85 : 0.5 }}>{count}</span>}
                </button>
              );
            })}
          </div>
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

      {/* ─── Blocked sub-filter (reason segmentation) ─── */}
      {/*
       * Only rendered when the Blocked tile is active. Pure client-side
       * narrowing of the already-fetched blocked slice — no extra fetch,
       * no new endpoint. Labels resolve through FEATURE_REGISTRY so
       * tenant overrides and Help Center tooltips stay consistent with
       * the Blocked tile itself.
       */}
      {statusFilter === "blocked" && (
        <div className="surface-card mb-5" style={{ padding: "8px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: "var(--t-text-muted)" }}>
            Reason:
          </span>
          {([
            {
              key: "all" as const,
              // Fully registry-driven — no inline composition. The
              // `blocked_subview_all` entry exists specifically to keep
              // this label flowing through FEATURE_REGISTRY so tenant
              // overrides apply uniformly across every pill.
              label: FEATURE_REGISTRY.blocked_subview_all?.label ?? "All Blocked",
              count: blockedReasonCounts.all,
              featureId: "blocked_subview_all",
            },
            {
              key: "billing_issue" as const,
              label: FEATURE_REGISTRY.blocked_reason_billing_issue?.label ?? "Billing Issue",
              count: blockedReasonCounts.billing_issue,
              featureId: "blocked_reason_billing_issue",
            },
            {
              key: "unpaid_completed_invoice" as const,
              label: FEATURE_REGISTRY.blocked_reason_unpaid_completed_invoice?.label ?? "Unpaid Invoice",
              count: blockedReasonCounts.unpaid_completed_invoice,
              featureId: "blocked_reason_unpaid_completed_invoice",
            },
          ]).map((opt) => {
            const isActive = blockedSubview === opt.key;
            const tooltip = FEATURE_REGISTRY[opt.featureId]?.shortDescription;
            return (
              <button
                key={opt.key}
                onClick={() => setBlockedSubview(opt.key)}
                title={tooltip}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "4px 10px", borderRadius: 6,
                  fontSize: 11, fontWeight: isActive ? 600 : 500,
                  background: isActive ? "var(--t-error-soft)" : "transparent",
                  color: isActive ? "var(--t-error)" : "var(--t-text-secondary)",
                  border: "none", cursor: "pointer", transition: "all 0.12s ease",
                }}
              >
                {opt.label}
                <span style={{ fontSize: 10, fontWeight: 700, opacity: isActive ? 1 : 0.6 }}>
                  {opt.count}
                </span>
              </button>
            );
          })}
        </div>
      )}

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
          {(() => {
            // Contextual empty state. Blocked + sub-filter gets its own
            // copy so operators understand WHY the list is empty — the
            // sub-filter may be hiding rows that exist in "All Blocked".
            let heading: string;
            let description: string;
            if (statusFilter === "blocked") {
              const rangeSuffix = dateRange === "all" ? "" : " in this date range";
              if (blockedSubview === "billing_issue") {
                const label = FEATURE_REGISTRY.blocked_reason_billing_issue?.label ?? "Billing Issue";
                heading = `No blocked jobs with a ${label}`;
                description = `No jobs currently have open billing issues${rangeSuffix}. Try another reason or clear the sub-filter.`;
              } else if (blockedSubview === "unpaid_completed_invoice") {
                const label = FEATURE_REGISTRY.blocked_reason_unpaid_completed_invoice?.label ?? "Unpaid Invoice";
                heading = `No blocked jobs with an ${label}`;
                description = `No completed jobs currently have an unpaid invoice${rangeSuffix}. Try another reason or clear the sub-filter.`;
              } else {
                heading = "No blocked jobs";
                description = `Everything is unblocked${rangeSuffix} — nice.`;
              }
            } else if (statusFilter !== "all" || dateRange !== "all" || searchQuery) {
              heading = "No matching jobs";
              description = "Try adjusting your filters or search";
            } else {
              heading = "No jobs yet";
              description = "Create your first job to get started";
            }
            return (
              <>
                <h2 style={{ fontSize: 17, fontWeight: 600, color: "var(--t-text-primary)" }} className="mb-1">
                  {heading}
                </h2>
                <p style={{ fontSize: 13, color: "var(--t-text-muted)" }} className="mb-5">
                  {description}
                </p>
              </>
            );
          })()}
          {(statusFilter !== "all" || dateRange !== "all" || searchQuery) ? (
            <button onClick={() => { setStatusFilter("all"); setDateRange("all"); setSearchQuery(""); }}
              className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors"
              style={{ borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}>
              Clear Filters
            </button>
          ) : (
            <button onClick={() => openWizard()} className="btn-primary inline-flex items-center gap-2 text-sm">
              <Plus className="h-4 w-4" /> New Booking
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

                  return (
                    <tr
                      key={job.id}
                      onClick={() => router.push(`/jobs/${job.id}`)}
                      className="table-row cursor-pointer"
                      style={(() => {
                        // Visual priority ladder. Exactly ONE border per row.
                        //   1. Blocked      → red    (overrides everything)
                        //   2. Unassigned   → orange
                        //   3. Assigned/En Route → blue
                        //   4. Completed    → green
                        // Blocked uses the isJobBlocked() predicate, which
                        // mirrors AnalyticsService.getJobsSummary() so the
                        // top-strip count and the borders never diverge.
                        const base: React.CSSProperties = { borderBottom: "1px solid var(--t-border-subtle)" };
                        if (isJobBlocked(job)) {
                          return { ...base, borderLeft: "3px solid var(--t-error)" };
                        }
                        if (["pending", "confirmed"].includes(job.status)) {
                          return { ...base, borderLeft: "3px solid var(--t-warning)" };
                        }
                        if (["dispatched", "en_route"].includes(job.status)) {
                          return { ...base, borderLeft: "3px solid var(--t-info, #3b82f6)" };
                        }
                        if (job.status === "completed") {
                          return { ...base, borderLeft: "3px solid var(--t-success, #22c55e)" };
                        }
                        return { ...base, borderLeft: "3px solid transparent" };
                      })()}
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

                      {/* Customer (primary) + Job # (secondary) + blocked reason (blocked view only) */}
                      <td style={{ padding: "12px 16px" }}>
                        <p style={{ fontWeight: 600, fontSize: 13, color: "var(--t-text-primary)", lineHeight: 1.3 }}>{customerName || <span style={{ color: "var(--t-text-tertiary)" }}>No customer</span>}</p>
                        <p style={{ fontSize: 11, color: "var(--t-text-muted)", fontVariantNumeric: "tabular-nums", marginTop: 1 }}>{job.job_number}</p>
                        {statusFilter === "blocked" && (() => {
                          // Reason badge with quick-action navigation. Only rendered
                          // in the Blocked drill-down view. Clicking the badge jumps
                          // to the existing workflow for that reason — reuse, not
                          // new routes. `stopPropagation` prevents the row-click
                          // from also firing (which would navigate to the job).
                          const reason = getBlockedReason(job);
                          if (!reason) return null;
                          const featureId = reason === "billing_issue"
                            ? "blocked_reason_billing_issue"
                            : "blocked_reason_unpaid_completed_invoice";
                          const feature = FEATURE_REGISTRY[featureId];
                          const target = reason === "billing_issue"
                            ? `/billing-issues?jobId=${job.id}`
                            : `/invoices?jobId=${job.id}`;
                          return (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); router.push(target); }}
                              title={feature?.shortDescription}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 4,
                                marginTop: 4, padding: "1px 6px",
                                borderRadius: 4, border: "none", cursor: "pointer",
                                background: "var(--t-error-soft)",
                                color: "var(--t-error)",
                                fontSize: 10, fontWeight: 600,
                              }}
                            >
                              {feature?.label ?? reason}
                              <ArrowRight style={{ width: 9, height: 9 }} />
                            </button>
                          );
                        })()}
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

                      {/* Status — dispatch lifecycle only; payment state renders beside Price */}
                      <td style={{ padding: "12px 16px" }}>
                        {(() => {
                          const displayStatus = deriveDisplayStatus(job.status);
                          return (
                            <span style={{ fontSize: 11, fontWeight: 600, color: displayStatusColor(displayStatus) }}>
                              {DISPLAY_STATUS_LABELS[displayStatus]}
                            </span>
                          );
                        })()}
                        {job.is_overdue && (
                          <p className="badge-error" style={{ fontSize: 9, fontWeight: 700, marginTop: 3, padding: "0px 5px", display: "inline-block" }}>
                            +{job.extra_days}d
                          </p>
                        )}
                      </td>

                      {/* Price + payment indicator */}
                      <td style={{ padding: "12px 16px", textAlign: "right" }}>
                        {job.total_price > 0 ? (
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--t-text-primary)", fontVariantNumeric: "tabular-nums" }}>
                            ${Number(job.total_price).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </span>
                        ) : (
                          <span style={{ color: "var(--t-text-tertiary)" }}>&mdash;</span>
                        )}
                        {(() => {
                          // Secondary badge: payment state lives next to Price,
                          // NOT in the Status column. Status column is dispatch
                          // lifecycle only.
                          const inv = job.linked_invoice;
                          if (!inv) return null;
                          if (inv.status === "partial") {
                            return (
                              <span style={{ display: "block", marginTop: 2, fontSize: 10, fontWeight: 600, color: "var(--t-warning)" }}>
                                Partial
                              </span>
                            );
                          }
                          if (Number(inv.balance_due) > 0 && inv.status !== "paid") {
                            return (
                              <span style={{ display: "block", marginTop: 2, fontSize: 10, fontWeight: 600, color: "var(--t-error)" }}>
                                Pending Payment
                              </span>
                            );
                          }
                          return null;
                        })()}
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
