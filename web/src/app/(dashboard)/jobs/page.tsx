"use client";

import { Suspense, Fragment, useState, useEffect, useCallback, useMemo, useRef, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";
import Dropdown from "@/components/dropdown";
import { useToast } from "@/components/toast";
import { CreditCard, FileWarning, MapPinOff, Package } from "lucide-react";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import { useLifecycleSync, useVisibilityRefresh } from "@/lib/lifecycle-sync";
import { getBlockedReason, isJobBlocked } from "@/lib/blocked-job";
import { useTenantTimezone } from "@/lib/use-modules";
import { getTenantToday, getTenantNowParts } from "@/lib/utils/tenantDate";

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

import { deriveDisplayStatus, DISPLAY_STATUS_LABELS, displayStatusColor, formatJobNumber } from "@/lib/job-status";

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

// Canonical job-type filter chips for the standalone jobs section.
// Chains by definition mix multiple types so the filter only affects the
// standalone slice — that's the semantic the controls bar advertises.
const JOB_TYPE_CHIPS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "delivery", label: "Deliveries" },
  { value: "pickup", label: "Pickups" },
  { value: "exchange", label: "Exchanges" },
];

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

// Phase B3 — tenant-aware date range. `getTenantNowParts(tz)`
// returns the tenant's wall-clock Y/M/D; we then do all subsequent
// date arithmetic in pure UTC on those integers so there is no
// browser-local or UTC-rollover drift. The output is still plain
// YYYY-MM-DD strings, matching the server's query-param filters.
function getDateRange(range: string, timezone: string | undefined): { dateFrom?: string; dateTo?: string } {
  const { year, month, day } = getTenantNowParts(timezone);
  const utcToday = new Date(Date.UTC(year, month - 1, day));
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  if (range === "today") return { dateFrom: fmt(utcToday), dateTo: fmt(utcToday) };
  if (range === "week") {
    const start = new Date(utcToday);
    start.setUTCDate(utcToday.getUTCDate() - utcToday.getUTCDay());
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    return { dateFrom: fmt(start), dateTo: fmt(end) };
  }
  if (range === "month") {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0));
    return { dateFrom: fmt(start), dateTo: fmt(end) };
  }
  return {};
}

/* ─── Main Page ─── */

// Phase B2 — statusFilter values the jobs page honors on mount
// from the ?status= URL param. Sourced directly from the values
// the existing statusFilter state already supports internally
// (see MULTI_STATUS, DISPLAY_TO_STORED, SECONDARY_STATUSES, and
// the special "overdue" + "blocked" branches in fetchJobs). Any
// value outside this allowlist falls through to "all" silently.
const JOBS_STATUS_ALLOWLIST = new Set([
  "all",
  // Display keys used by the KPI tiles
  "unassigned",
  "assigned",
  "arrived",
  "overdue",
  "blocked",
  "pending_payment",
  // Bare stored values (DISPLAY_TO_STORED fall-through path)
  "pending",
  "confirmed",
  "dispatched",
  "in_progress",
  "en_route",
  "completed",
  "cancelled",
]);

/**
 * Page content lives in a child component because this page calls
 * `useSearchParams` at the top level. Next.js App Router requires any
 * `useSearchParams` consumer to be wrapped in a `<Suspense>` boundary
 * so the static prerender can skip the param-dependent subtree — the
 * default export below provides that boundary. Without the split the
 * production build fails with "useSearchParams() should be wrapped in
 * a suspense boundary at page '/jobs'".
 */
function JobsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { openWizard } = useBooking();
  const { toast } = useToast();
  // Phase B3 — tenant-wide timezone. Threaded into `getDateRange`
  // for week/month/today filter derivations and into the
  // "overdue" lifecycle stat comparison below. Shares the
  // /auth/profile cache with `useModules` — no extra fetch.
  const timezone = useTenantTimezone();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  // Phase B2 — initialize statusFilter from the ?status= URL
  // param if it's in the allowlist. Fixes the "Completed" KPI
  // card on the home dashboard which used to land on the mixed
  // jobs+lifecycles page with no filter applied.
  const initialStatusFilter = (() => {
    const fromUrl = searchParams.get("status");
    return fromUrl && JOBS_STATUS_ALLOWLIST.has(fromUrl) ? fromUrl : "all";
  })();
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter);
  // Blocked drill-down sub-filter. Only meaningful when statusFilter === "blocked".
  // Operates on the already-fetched blocked slice — does NOT re-fetch.
  const [blockedSubview, setBlockedSubview] = useState<
    "all" | "billing_issue" | "unpaid_completed_invoice"
  >("all");
  const [jobTypeFilter, setJobTypeFilter] = useState<Set<string>>(new Set());
  const [dateRange, setDateRange] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  // Expanded rental-chain IDs. Collapsed by default; expanding a chain
  // reveals its delivery / exchange / pickup child rows inline.
  const [expandedChains, setExpandedChains] = useState<Set<string>>(new Set());
  const toggleChain = useCallback((chainId: string) => {
    setExpandedChains((prev) => {
      const next = new Set(prev);
      if (next.has(chainId)) next.delete(chainId);
      else next.add(chainId);
      return next;
    });
  }, []);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [statusCounts, setStatusCounts] = useState<StatusCount[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);
  // Lifecycle view state
  const [chains, setChains] = useState<Array<{
    id: string; status: string; dumpster_size: string; rental_days: number;
    drop_off_date: string; expected_pickup_date: string | null;
    customer: { id: string; first_name: string; last_name: string } | null;
    asset: { id: string; identifier: string; subtype: string } | null;
    links: Array<{ job_id: string; task_type: string; sequence_number: number; status: string; scheduled_date: string;
      job: { id: string; job_number: string; status: string; service_address: Record<string, string> | null; asset_subtype?: string } | null;
    }>;
  }>>([]);
  const [chainsLoading, setChainsLoading] = useState(true);
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
        const range = getDateRange(dateRange, timezone);
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
        const range = getDateRange(dateRange, timezone);
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
        const range = getDateRange(dateRange, timezone);
        if (range.dateFrom) params.set("dateFrom", range.dateFrom);
        if (range.dateTo) params.set("dateTo", range.dateTo);
        const res = await api.get<JobsResponse>(`/jobs?${params.toString()}`);
        setJobs(res.data);
        setTotal(res.meta.total);
      }
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [page, statusFilter, dateRange, timezone]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  // Phase 9: lifecycle mutations elsewhere (rentals lifecycle page,
  // other tabs) should invalidate this list so a job that moved off
  // today's view disappears immediately — no manual refresh.
  useLifecycleSync(() => { fetchJobs(); });
  useVisibilityRefresh(() => { fetchJobs(); });

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
    // Fetch rental chains for lifecycle view
    api.get<typeof chains>("/rental-chains")
      .then(setChains)
      .catch(() => {})
      .finally(() => setChainsLoading(false));
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

  const toggleJobType = (t: string) => {
    setJobTypeFilter(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  };

  const filteredJobs = useMemo(() => {
    let result = [...jobs];
    // Job type filter (client-side, multi-select)
    if (jobTypeFilter.size > 0) {
      result = result.filter((j) => jobTypeFilter.has(j.job_type));
    }
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
    // Newest scheduled date first, falling back to creation date for
    // jobs without a scheduled date yet. The previous configurable
    // sortBy state was never wired to a UI control, so this hard-codes
    // the only path that ever ran in production.
    result.sort((a, b) => (b.scheduled_date || b.created_at).localeCompare(a.scheduled_date || a.created_at));
    return result;
  }, [jobs, searchQuery, statusFilter, blockedSubview, jobTypeFilter]);

  // ── Lifecycle rows derived from rental chains ──
  const chainedJobIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of chains) for (const l of c.links) if (l.job_id) ids.add(l.job_id);
    return ids;
  }, [chains]);

  function deriveLifecycleStatus(chain: typeof chains[0]): string {
    if (chain.status === "completed") return FEATURE_REGISTRY.lifecycle_status_completed?.label ?? "Completed";
    if (chain.status === "cancelled") return "Cancelled";
    const dropOff = chain.links.find(l => l.task_type === "drop_off");
    const pickUp = chain.links.find(l => l.task_type === "pick_up");
    const hasExchange = chain.links.some(l => l.task_type === "exchange");
    if (hasExchange) return FEATURE_REGISTRY.lifecycle_status_exchange?.label ?? "Exchange Scheduled";
    if (dropOff?.job?.status === "completed" && pickUp && pickUp.job?.status !== "completed")
      return FEATURE_REGISTRY.lifecycle_status_awaiting_pickup?.label ?? "Awaiting Pickup";
    if (dropOff?.job?.status === "completed" && !pickUp)
      return FEATURE_REGISTRY.lifecycle_status_on_site?.label ?? "On Site";
    return FEATURE_REGISTRY.lifecycle_status_awaiting_delivery?.label ?? "Awaiting Delivery";
  }

  const filteredChains = useMemo(() => {
    // Job-type chips are intentionally a "show me ONLY this kind of
    // job" filter. Chains by definition contain mixed task types, so
    // when any type chip is active we suppress the chains section
    // entirely and let the standalone-jobs section satisfy the
    // operator's intent. Without this, clicking "Pickups" would still
    // surface chains containing pickups alongside their sibling
    // delivery + exchange tasks — which is the opposite of what the
    // chip implies.
    if (jobTypeFilter.size > 0) return [];
    let result = [...chains];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c => {
        const cName = c.customer ? `${c.customer.first_name} ${c.customer.last_name}`.toLowerCase() : "";
        const addr = c.links[0]?.job?.service_address ? fmtAddress(c.links[0].job.service_address).toLowerCase() : "";
        const jobNums = c.links.map(l => l.job?.job_number || "").join(" ").toLowerCase();
        const size = (c.dumpster_size || "").toLowerCase();
        return cName.includes(q) || addr.includes(q) || jobNums.includes(q) || size.includes(q);
      });
    }
    if (dateRange !== "all") {
      const range = getDateRange(dateRange, timezone);
      result = result.filter(c => {
        if (range.dateFrom && c.drop_off_date < range.dateFrom) return false;
        if (range.dateTo && c.drop_off_date > range.dateTo) return false;
        return true;
      });
    }
    result.sort((a, b) => (b.drop_off_date || "").localeCompare(a.drop_off_date || ""));
    return result;
  }, [chains, searchQuery, dateRange, timezone, jobTypeFilter]);

  const standaloneJobs = useMemo(() => {
    // Default behavior: show ONLY jobs that aren't part of any chain
    // (chains are surfaced by the chains table above so we don't want
    // to double-count their member tasks).
    //
    // Type-chip override: when the operator has narrowed by job type
    // (Deliveries / Pickups / Exchanges), the goal is "show me every
    // job of this type" — most of which live inside a chain. We
    // broaden the slice to include chain members in that case so the
    // chip is actually useful, not just a filter on orphan jobs. The
    // chains section is hidden in this branch (see filteredChains
    // above) so there is no double-render.
    //
    // Driver Task V1 exclusion: driver_task jobs are internal
    // operational items (yard errands, repair-shop runs, etc.) and
    // should never appear on the Rental Lifecycles page. They live
    // on the dispatch board instead. Filter them out unconditionally
    // so the Rental Lifecycles view stays strictly lifecycle-focused.
    const base = (jobTypeFilter.size > 0 ? filteredJobs : filteredJobs.filter(j => !chainedJobIds.has(j.id)));
    return base.filter(j => j.job_type !== "driver_task");
  }, [filteredJobs, chainedJobIds, jobTypeFilter]);

  const thStyle: React.CSSProperties = { padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--t-text-muted)", whiteSpace: "nowrap" };

  return (
    <div>
      {/* ─── Header ─── */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--t-text-primary)" }}>
            {FEATURE_REGISTRY.lifecycle_dashboard?.label ?? "Rental Lifecycles"}
          </h1>
          <p className="mt-1" style={{ fontSize: 13, color: "var(--t-text-muted)" }}>
            {chains.length} rentals{standaloneJobs.length > 0 && <> &middot; {standaloneJobs.length} standalone</>}
          </p>
        </div>
      </div>

      {/* ─── Lifecycle stat strip ─── */}
      {(() => {
        const active = chains.filter(c => c.status === "active").length;
        const awaitingPickup = chains.filter(c => {
          if (c.status !== "active") return false;
          const d = c.links.find(l => l.task_type === "drop_off");
          const p = c.links.find(l => l.task_type === "pick_up");
          return d?.job?.status === "completed" && p && p.job?.status !== "completed";
        }).length;
        // Phase B3 — "overdue" compares against tenant-local today,
        // not UTC, so an Eastern evening view doesn't pre-flip
        // chains to overdue at 7pm.
        const todayStr = getTenantToday(timezone);
        const overdue = chains.filter(c => c.status === "active" && c.expected_pickup_date && c.expected_pickup_date < todayStr).length;
        const completed = chains.filter(c => c.status === "completed").length;
        const stats = [
          { label: FEATURE_REGISTRY.lifecycle_stat_active?.label ?? "Active Rentals", value: active, color: active > 0 ? "var(--t-accent)" : "var(--t-text-primary)", icon: Package },
          { label: FEATURE_REGISTRY.lifecycle_status_awaiting_pickup?.label ?? "Awaiting Pickup", value: awaitingPickup, color: awaitingPickup > 0 ? "var(--t-warning)" : "var(--t-text-primary)", icon: Clock },
          { label: "Overdue", value: overdue, color: overdue > 0 ? "var(--t-error)" : "var(--t-text-primary)", icon: AlertCircle },
          { label: FEATURE_REGISTRY.lifecycle_status_completed?.label ?? "Completed", value: completed, color: "var(--t-text-primary)", icon: CheckCircle2 },
        ];
        return (
          <div className="grid grid-cols-4 gap-3 mb-6">
            {stats.map(s => {
              const Icon = s.icon;
              return (
                <div key={s.label} className="surface-card text-left px-4 py-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon style={{ width: 13, height: 13, color: s.color }} />
                  </div>
                  <p style={{ fontSize: 22, fontWeight: 700, color: s.color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{s.value}</p>
                  <p style={{ fontSize: 11, fontWeight: 500, color: "var(--t-text-muted)", marginTop: 4 }}>{s.label}</p>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ─── Controls bar ─── */}
      <div className="surface-card mb-5" style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "var(--t-text-muted)" }} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search customer, address, job #, dumpster size..."
            className="w-full rounded-[20px] py-2 pl-9 pr-4 text-sm outline-none"
            style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
          />
        </div>
        {/*
         * Job-type chips. Multi-select: clicking a chip toggles its
         * value in `jobTypeFilter` and the standalone-jobs section
         * narrows accordingly. Chains are mixed-type by definition so
         * the filter intentionally only affects the standalone slice.
         */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} aria-label={FEATURE_REGISTRY.jobs_type_filter?.label ?? "Job type filter"}>
          {JOB_TYPE_CHIPS.map((chip) => {
            const active = jobTypeFilter.has(chip.value);
            return (
              <button
                key={chip.value}
                type="button"
                onClick={() => toggleJobType(chip.value)}
                aria-pressed={active}
                style={{
                  padding: "5px 12px",
                  fontSize: 11,
                  fontWeight: 600,
                  border: `1px solid ${active ? "var(--t-accent)" : "var(--t-border)"}`,
                  borderRadius: 999,
                  cursor: "pointer",
                  background: active ? "var(--t-accent-soft)" : "transparent",
                  color: active ? "var(--t-accent-text)" : "var(--t-text-muted)",
                  transition: "all 0.12s ease",
                }}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", borderRadius: 8, border: "1px solid var(--t-border)", overflow: "hidden" }}>
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

      {/* ─── Lifecycle Rows ─── */}
      {(loading || chainsLoading) ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 w-full skeleton" style={{ borderRadius: 14 }} />
          ))}
        </div>
      ) : filteredChains.length === 0 && standaloneJobs.length === 0 ? (
        <div className="surface-card py-16 flex flex-col items-center justify-center text-center">
          <Briefcase size={40} style={{ color: "var(--t-text-tertiary)" }} className="mb-3" />
          <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--t-text-primary)" }} className="mb-1">
            {searchQuery || dateRange !== "all" ? "No matching rentals" : "No rentals yet"}
          </h2>
          <p style={{ fontSize: 12, color: "var(--t-text-muted)" }} className="mb-5">
            {searchQuery || dateRange !== "all" ? "Try adjusting your filters or search" : "Create your first booking to get started"}
          </p>
          {(searchQuery || dateRange !== "all") ? (
            <button onClick={() => { setDateRange("all"); setSearchQuery(""); }}
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
        <>
          {/* Lifecycle rows (grouped — expandable) */}
          {filteredChains.length > 0 && (
            <div className="surface-card" style={{ overflow: "hidden", padding: 0 }}>
              <div className="table-scroll">
                <table className="w-full" style={{ fontSize: 13, borderCollapse: "collapse" }}>
                  <thead>
                    <tr className="table-header" style={{ borderBottom: "1px solid var(--t-border)" }}>
                      <th style={{ ...thStyle, width: 32 }} aria-label="Expand" />
                      <th style={{ ...thStyle, width: 72 }}>Size</th>
                      <th style={thStyle}>Customer</th>
                      <th style={thStyle}>Address</th>
                      <th style={{ ...thStyle, width: 110 }}>Delivered</th>
                      <th style={{ ...thStyle, width: 110 }}>Pickup</th>
                      <th style={{ ...thStyle, width: 120 }}>Tasks</th>
                      <th style={{ ...thStyle, width: 140 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredChains.map(chain => {
                      const cName = chain.customer ? `${chain.customer.first_name} ${chain.customer.last_name}` : "";
                      const addr = chain.links[0]?.job?.service_address ? fmtAddress(chain.links[0].job.service_address) : "";
                      const size = chain.dumpster_size || chain.asset?.subtype || "";
                      const completedTasks = chain.links.filter(l => l.job?.status === "completed").length;
                      const totalTasks = chain.links.length;
                      const lcStatus = deriveLifecycleStatus(chain);
                      const isCompleted = chain.status === "completed";
                      const isExpanded = expandedChains.has(chain.id);
                      // Child links sorted by sequence_number so delivery → exchange → pickup
                      // render in lifecycle order rather than fetch order.
                      const orderedLinks = [...chain.links].sort(
                        (a, b) => (a.sequence_number ?? 0) - (b.sequence_number ?? 0),
                      );
                      return (
                        <Fragment key={chain.id}>
                          <tr
                            onClick={() => toggleChain(chain.id)}
                            className="table-row cursor-pointer"
                            aria-expanded={isExpanded}
                            style={{
                              borderBottom: isExpanded ? "none" : "1px solid var(--t-border-subtle)",
                              borderLeft: isCompleted ? "3px solid var(--t-success, #22c55e)" : "3px solid var(--t-accent)",
                              background: isExpanded ? "var(--t-bg-card-hover)" : undefined,
                            }}
                          >
                            <td style={{ padding: "12px 0 12px 8px", width: 32 }}>
                              {isExpanded
                                ? <ChevronDown className="h-3.5 w-3.5" style={{ color: "var(--t-text-muted)" }} />
                                : <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--t-text-muted)" }} />}
                            </td>
                            <td style={{ padding: "12px 16px 12px 8px" }}>
                              {size ? (
                                <span style={{ fontSize: 13, fontWeight: 800, color: "var(--t-text-primary)", background: "var(--t-accent-soft)", padding: "2px 7px", borderRadius: 5, whiteSpace: "nowrap" }}>
                                  {size.replace(/yd$/i, "Y").toUpperCase()}
                                </span>
                              ) : <span style={{ color: "var(--t-text-tertiary)" }}>&mdash;</span>}
                            </td>
                            <td style={{ padding: "12px 16px" }}>
                              <p style={{ fontWeight: 600, fontSize: 13, color: "var(--t-text-primary)", lineHeight: 1.3 }}>{cName || <span style={{ color: "var(--t-text-tertiary)" }}>No customer</span>}</p>
                              <p style={{ fontSize: 11, color: "var(--t-text-muted)", marginTop: 1 }}>
                                {completedTasks}/{totalTasks} {totalTasks === 1 ? "task" : "tasks"}
                              </p>
                            </td>
                            <td style={{ padding: "12px 16px", maxWidth: 220 }}>
                              <span style={{ fontSize: 12, color: "var(--t-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{addr || "—"}</span>
                            </td>
                            <td style={{ padding: "12px 16px" }}>
                              <span style={{ fontSize: 12, fontWeight: 500, color: "var(--t-text-primary)" }}>{chain.drop_off_date ? fmtDate(chain.drop_off_date) : "—"}</span>
                            </td>
                            <td style={{ padding: "12px 16px" }}>
                              <span style={{ fontSize: 12, fontWeight: 500, color: "var(--t-text-primary)" }}>{chain.expected_pickup_date ? fmtDate(chain.expected_pickup_date) : "—"}</span>
                            </td>
                            <td style={{ padding: "12px 16px" }}>
                              {(() => {
                                const parts: string[] = [];
                                const dropOff = chain.links.find(l => l.task_type === "drop_off");
                                const pickUp = chain.links.find(l => l.task_type === "pick_up");
                                if (dropOff?.job?.status === "completed") parts.push("Delivered");
                                else if (dropOff) parts.push("Delivery pending");
                                if (chain.links.some(l => l.task_type === "exchange")) parts.push("Exchange");
                                if (pickUp?.job?.status === "completed") parts.push("Picked up");
                                else if (pickUp) parts.push("Pickup pending");
                                return <span style={{ fontSize: 11, color: "var(--t-text-muted)", lineHeight: 1.4 }}>{parts.join(" · ")}</span>;
                              })()}
                            </td>
                            <td style={{ padding: "12px 16px" }}>
                              <div className="flex items-center gap-2 justify-between">
                                <span style={{
                                  fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
                                  background: isCompleted ? "var(--t-bg-elevated)" : "var(--t-accent-soft)",
                                  color: isCompleted ? "var(--t-text-muted)" : "var(--t-accent)",
                                }}>{lcStatus}</span>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); router.push(`/rentals/${chain.id}`); }}
                                  className="p-1 rounded transition-colors"
                                  style={{ color: "var(--t-text-muted)" }}
                                  aria-label={FEATURE_REGISTRY.view_lifecycle?.label ?? "View full lifecycle"}
                                  title={FEATURE_REGISTRY.view_lifecycle?.label ?? "View full lifecycle"}
                                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-accent)"; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-muted)"; }}
                                >
                                  <ArrowRight className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded && orderedLinks.map((link, idx) => {
                            const childJob = link.job;
                            if (!childJob) return null;
                            const childDisplay = deriveDisplayStatus(childJob.status);
                            const isLastChild = idx === orderedLinks.length - 1;
                            return (
                              <tr
                                key={`${chain.id}-child-${link.job_id}`}
                                onClick={() => router.push(`/jobs/${childJob.id}`)}
                                className="table-row cursor-pointer"
                                style={{
                                  borderBottom: isLastChild ? "1px solid var(--t-border-subtle)" : "1px solid var(--t-border-subtle)",
                                  borderLeft: isCompleted ? "3px solid var(--t-success, #22c55e)" : "3px solid var(--t-accent)",
                                  background: "var(--t-bg-secondary, var(--t-bg-card))",
                                }}
                              >
                                <td />
                                <td colSpan={2} style={{ padding: "8px 16px 8px 32px" }}>
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--t-text-muted)" }}>
                                      {link.task_type === "drop_off" ? "Delivery"
                                        : link.task_type === "pick_up" ? "Pickup"
                                          : link.task_type === "exchange" ? "Exchange"
                                            : link.task_type}
                                    </span>
                                    <span className="text-xs font-medium" style={{ color: "var(--t-text-primary)" }}>
                                      {formatJobNumber(childJob.job_number)}
                                    </span>
                                  </div>
                                </td>
                                <td style={{ padding: "8px 16px", fontSize: 11, color: "var(--t-text-muted)" }}>
                                  {childJob.asset_subtype || "—"}
                                </td>
                                <td style={{ padding: "8px 16px", fontSize: 11, color: "var(--t-text-primary)" }}>
                                  {link.scheduled_date ? fmtDate(link.scheduled_date) : "—"}
                                </td>
                                <td />
                                <td style={{ padding: "8px 16px", fontSize: 10, color: "var(--t-text-muted)" }}>
                                  {/* intentionally empty — task-type summary already in the label */}
                                </td>
                                <td style={{ padding: "8px 16px" }}>
                                  <span className="text-[10px] font-medium" style={{ color: displayStatusColor(childDisplay) }}>
                                    {DISPLAY_STATUS_LABELS[childDisplay]}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Standalone Jobs */}
          {standaloneJobs.length > 0 && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold text-[var(--t-text-muted)] mb-3">
                {jobTypeFilter.size > 0
                  ? `${JOB_TYPE_CHIPS.filter(c => jobTypeFilter.has(c.value)).map(c => c.label).join(" · ")} (${standaloneJobs.length})`
                  : `${FEATURE_REGISTRY.lifecycle_standalone_jobs?.label ?? "Standalone Jobs"} (${standaloneJobs.length})`}
              </h2>
              <div className="surface-card" style={{ overflow: "hidden", padding: 0 }}>
                <div className="table-scroll">
                  <table className="w-full" style={{ fontSize: 13, borderCollapse: "collapse" }}>
                    <thead>
                      <tr className="table-header" style={{ borderBottom: "1px solid var(--t-border)" }}>
                        <th style={{ ...thStyle, width: 72 }}>Size</th>
                        <th style={{ ...thStyle, width: 80 }}>Type</th>
                        <th style={thStyle}>Customer</th>
                        <th style={thStyle}>Address</th>
                        <th style={{ ...thStyle, width: 110 }}>Date</th>
                        <th style={{ ...thStyle, width: 90 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {standaloneJobs.map(job => {
                        const customerName = job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : "";
                        const address = fmtAddress(job.service_address);
                        const displayStatus = deriveDisplayStatus(job.status);
                        return (
                          <tr key={job.id} onClick={() => router.push(`/jobs/${job.id}`)} className="table-row cursor-pointer"
                            style={{ borderBottom: "1px solid var(--t-border-subtle)", borderLeft: "3px solid var(--t-border)" }}>
                            <td style={{ padding: "10px 16px 10px 12px" }}>
                              {(job.asset_subtype || job.asset?.subtype) ? (
                                <span style={{ fontSize: 12, fontWeight: 800, color: "var(--t-text-primary)", background: "var(--t-accent-soft)", padding: "2px 6px", borderRadius: 5 }}>
                                  {(job.asset_subtype || job.asset?.subtype || "").replace(/yd$/i, "Y").toUpperCase()}
                                </span>
                              ) : <span style={{ color: "var(--t-text-tertiary)" }}>&mdash;</span>}
                            </td>
                            <td style={{ padding: "10px 16px" }}>
                              <span className={jobTypeTextClass(job.job_type)} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>{job.job_type}</span>
                            </td>
                            <td style={{ padding: "10px 16px" }}>
                              <p style={{ fontWeight: 600, fontSize: 12, color: "var(--t-text-primary)" }}>{customerName || <span style={{ color: "var(--t-text-tertiary)" }}>—</span>}</p>
                              <p style={{ fontSize: 10, color: "var(--t-text-muted)", marginTop: 1 }}>{formatJobNumber(job.job_number)}</p>
                            </td>
                            <td style={{ padding: "10px 16px", maxWidth: 200 }}>
                              <span style={{ fontSize: 12, color: "var(--t-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{address || "—"}</span>
                            </td>
                            <td style={{ padding: "10px 16px" }}>
                              <span style={{ fontSize: 12, color: "var(--t-text-primary)" }}>{job.scheduled_date ? fmtDate(job.scheduled_date) : "—"}</span>
                            </td>
                            <td style={{ padding: "10px 16px" }}>
                              <span style={{ fontSize: 11, fontWeight: 600, color: displayStatusColor(displayStatus) }}>{DISPLAY_STATUS_LABELS[displayStatus]}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
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

/**
 * Default export — Suspense boundary required by Next.js App Router
 * because `JobsPageContent` calls `useSearchParams`.
 */
export default function JobsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm" style={{ color: "var(--t-text-muted)" }}>
          Loading…
        </div>
      }
    >
      <JobsPageContent />
    </Suspense>
  );
}
