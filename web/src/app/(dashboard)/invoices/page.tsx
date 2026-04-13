"use client";

import { Suspense, useState, useEffect, useCallback, useMemo, useRef, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus,
  FileText,
  Trash2,
  Search,
  ArrowDownUp,
  Download,
  AlertTriangle,
  Calendar,
  Clock,
  DollarSign,
  ArrowRight,
  Bell,
  MoreHorizontal,
  Send,
  XCircle,
  CreditCard,
} from "lucide-react";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";
import Dropdown from "@/components/dropdown";
import { useToast } from "@/components/toast";
import { useTenantTimezone } from "@/lib/use-modules";
import { getTenantToday, getTenantNowParts } from "@/lib/utils/tenantDate";

/* --- Types --- */

interface InvoiceLineItem {
  id: string;
  line_type: string;
  name: string;
  description?: string;
  quantity: number;
  unit_rate: number;
  amount: number;
  discount_amount: number;
  net_amount: number;
  is_taxable: boolean;
  tax_rate: number;
  tax_amount: number;
  sort_order: number;
}

interface Invoice {
  id: string;
  invoice_number: number;
  revision: number;
  status: string;
  customer_type: string;
  invoice_date: string;
  due_date: string;
  service_date: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  total_cogs: number;
  profit: number;
  summary_of_work: string;
  project_name: string;
  po_number: string;
  sent_at: string;
  paid_at: string;
  voided_at: string;
  created_at: string;
  line_items: InvoiceLineItem[];
  customer: { id: string; first_name: string; last_name: string; company_name?: string } | null;
  job: { id: string; job_number: string } | null;
}

interface InvoicesResponse {
  data: Invoice[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/* Legacy line item shape for the create form */
interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface CustomerOption { id: string; first_name: string; last_name: string }
interface JobOption { id: string; job_number: string; status: string; total_price: number; customer: { first_name: string; last_name: string } | null }

/* --- Constants --- */

const TABS = ["all", "paid", "open", "partial", "draft", "overdue", "voided"] as const;

const STATUS_COLOR: Record<string, string> = {
  draft:     "var(--t-text-muted)",
  open:      "var(--t-warning)",
  sent:      "var(--t-warning)",
  delivered: "var(--t-info, #3b82f6)",
  read:      "var(--t-info, #3b82f6)",
  partial:   "var(--t-warning)",
  paid:      "var(--t-accent)",
  overdue:   "var(--t-error)",
  voided:    "var(--t-text-muted)",
  void:      "var(--t-text-muted)",
};

const TAB_LABELS: Record<string, string> = {
  all: "All", draft: "Draft", open: "Pending", sent: "Pending", partial: "Partial", paid: "Paid", overdue: "Overdue", voided: "Voided",
};

const DATE_RANGES = [
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "quarter", label: "This Quarter" },
  { value: "all", label: "All Time" },
] as const;

const SORT_OPTIONS = [
  { value: "date_desc", label: "Newest First" },
  { value: "amount_desc", label: "Highest Amount" },
  { value: "status", label: "Status" },
  { value: "customer", label: "Customer Name" },
] as const;

const PAYMENT_TERMS = [
  { value: "0", label: "Due on Receipt" },
  { value: "15", label: "Net 15" },
  { value: "30", label: "Net 30" },
  { value: "60", label: "Net 60" },
] as const;

/* --- Helpers --- */

import { formatCurrency } from "@/lib/utils";
const fmt = (n: number | null | undefined) => formatCurrency(n as number);

function fmtDate(d: string): string {
  if (!d) return "--";
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Phase B3 — "days until due" relative to tenant-local today,
// not the browser's midnight. Parses the stored YYYY-MM-DD as a
// UTC date to avoid local-tz drift on the input, and anchors
// today to the tenant's wall clock.
function daysUntil(d: string, timezone: string | undefined): number {
  if (!d) return 0;
  const todayStr = getTenantToday(timezone);
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const [dy, dm, dd] = d.split("-").map(Number);
  const todayUtc = Date.UTC(ty, (tm || 1) - 1, td || 1);
  const dueUtc = Date.UTC(dy, (dm || 1) - 1, dd || 1);
  return Math.round((dueUtc - todayUtc) / 86400000);
}

// Phase B3 — tenant-aware date range. Week/month/quarter are all
// derived from the tenant's wall-clock Y/M/D, then walked in
// pure UTC so there is no local-vs-UTC drift in the emitted
// YYYY-MM-DD strings.
function getDateRange(range: string, timezone: string | undefined): { dateFrom?: string; dateTo?: string } {
  const { year, month, day } = getTenantNowParts(timezone);
  const utcToday = new Date(Date.UTC(year, month - 1, day));
  const f = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  if (range === "week") {
    const start = new Date(utcToday); start.setUTCDate(utcToday.getUTCDate() - utcToday.getUTCDay());
    const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
    return { dateFrom: f(start), dateTo: f(end) };
  }
  if (range === "month") {
    return { dateFrom: f(new Date(Date.UTC(year, month - 1, 1))), dateTo: f(new Date(Date.UTC(year, month, 0))) };
  }
  if (range === "quarter") {
    const qStart = Math.floor((month - 1) / 3) * 3;
    return { dateFrom: f(new Date(Date.UTC(year, qStart, 1))), dateTo: f(new Date(Date.UTC(year, qStart + 3, 0))) };
  }
  return {};
}

/* --- Main Page --- */

// Phase B2 — URL params that the invoices page honors on mount
// to drive the initial tab state. The KPI cards on the home
// dashboard (AR Outstanding, Overdue Invoices) link here with
// these values. The "outstanding" composite tab is a real tab
// key internally (line ~190 does a special two-fetch merge of
// open + overdue) even though it isn't in TAB_LABELS — it is a
// KPI-driven tab. Anything outside this allowlist falls through
// to "all" silently so malformed URLs don't crash the page.
const STATUS_TAB_ALLOWLIST = new Set([
  "all",
  "draft",
  "open",
  "sent",
  "partial",
  "paid",
  "overdue",
  "voided",
  "outstanding",
]);

/**
 * Page content lives in a child component because this page calls
 * `useSearchParams` at the top level. Next.js App Router requires any
 * `useSearchParams` consumer to be wrapped in a `<Suspense>` boundary
 * so the static prerender can skip the param-dependent subtree — the
 * default export below provides that boundary. Without the split the
 * production build fails with "useSearchParams() should be wrapped in
 * a suspense boundary at page '/invoices'".
 */
function InvoicesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  // Phase B3 — tenant-wide timezone. Threaded into `getDateRange`
  // and `daysUntil` so the AR filters and "X days until due"
  // labels agree with the tenant's wall clock instead of drifting
  // into UTC-tomorrow in the evening.
  const timezone = useTenantTimezone();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  // Phase B2 — initialize tab state from the ?status= URL param
  // if present and in the allowlist. Fixes the AR Outstanding /
  // Overdue Invoices tiles on the home dashboard which used to
  // silently drop the query string.
  const initialTab = (() => {
    const fromUrl = searchParams.get("status");
    return fromUrl && STATUS_TAB_ALLOWLIST.has(fromUrl) ? fromUrl : "all";
  })();
  const [tab, setTab] = useState(initialTab);
  const [dateRange, setDateRange] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("date_desc");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<"create" | "from-job">("create");
  const [allInvoices, setAllInvoices] = useState<Invoice[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "outstanding") {
        // Outstanding = open + overdue
        const range = getDateRange(dateRange, timezone);
        const fetchStatus = (status: string) => {
          const params = new URLSearchParams({ page: "1", limit: "100", status });
          if (range.dateFrom) params.set("dateFrom", range.dateFrom);
          if (range.dateTo) params.set("dateTo", range.dateTo);
          return api.get<InvoicesResponse>(`/invoices?${params.toString()}`);
        };
        const [open, overdue] = await Promise.all([fetchStatus("open"), fetchStatus("overdue")]);
        const merged = [...open.data, ...overdue.data];
        setInvoices(merged);
        setTotal(open.meta.total + overdue.meta.total);
      } else {
        const params = new URLSearchParams({ page: String(page), limit: "30" });
        if (tab !== "all") params.set("status", tab);
        const range = getDateRange(dateRange, timezone);
        if (range.dateFrom) params.set("dateFrom", range.dateFrom);
        if (range.dateTo) params.set("dateTo", range.dateTo);
        const res = await api.get<InvoicesResponse>(`/invoices?${params.toString()}`);
        setInvoices(res.data);
        setTotal(res.meta.total);
      }
    } catch { /* */ } finally { setLoading(false); }
  }, [page, tab, dateRange, timezone]);

  // Fetch all for aggregation (counts + totals)
  const fetchAllInvoices = useCallback(async () => {
    try {
      const res = await api.get<InvoicesResponse>("/invoices?limit=500");
      setAllInvoices(res.data);
    } catch { /* */ }
  }, []);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);
  useEffect(() => { fetchAllInvoices(); }, [fetchAllInvoices]);
  useEffect(() => { setPage(1); }, [tab, dateRange]);

  // Tab counts + dollar amounts
  const tabStats = useMemo(() => {
    const stats: Record<string, { count: number; amount: number }> = {};
    for (const t of TABS) stats[t] = { count: 0, amount: 0 };
    allInvoices.forEach((inv) => {
      stats.all.count++;
      stats.all.amount += Number(inv.balance_due);
      const s = inv.status as string;
      if (stats[s]) { stats[s].count++; stats[s].amount += Number(s === "paid" ? inv.total : inv.balance_due); }
    });
    return stats;
  }, [allInvoices]);

  const outstandingTotal = useMemo(() =>
    allInvoices.filter((i) => i.status === "open" || i.status === "overdue").reduce((s, i) => s + Number(i.balance_due), 0),
  [allInvoices]);

  const overdueInvoices = useMemo(() =>
    allInvoices.filter((i) => i.status === "overdue"),
  [allInvoices]);

  const collectedTotal = useMemo(() =>
    allInvoices.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.total), 0),
  [allInvoices]);

  const totalInvoiced = useMemo(() =>
    allInvoices.reduce((s, i) => s + Number(i.total), 0),
  [allInvoices]);

  const overdueTotal = useMemo(() =>
    overdueInvoices.reduce((s, i) => s + Number(i.balance_due), 0),
  [overdueInvoices]);

  // Client-side search + sort
  const filteredInvoices = useMemo(() => {
    let result = [...invoices];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((inv) => {
        const name = inv.customer ? `${inv.customer.first_name} ${inv.customer.last_name}`.toLowerCase() : "";
        return String(inv.invoice_number).includes(q) || name.includes(q);
      });
    }
    result.sort((a, b) => {
      if (sortBy === "date_desc") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortBy === "amount_desc") return Number(b.total) - Number(a.total);
      if (sortBy === "status") return a.status.localeCompare(b.status);
      if (sortBy === "customer") {
        const an = a.customer ? `${a.customer.first_name} ${a.customer.last_name}` : "";
        const bn = b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : "";
        return an.localeCompare(bn);
      }
      return 0;
    });
    return result;
  }, [invoices, searchQuery, sortBy]);

  /* --- KPI cards data --- */
  const kpis = [
    { label: "Total", value: fmt(totalInvoiced), filter: "all" as string },
    { label: "Collected", value: fmt(collectedTotal), color: "var(--t-accent)", filter: "paid" as string },
    { label: "Outstanding", value: fmt(outstandingTotal), color: "var(--t-warning)", filter: "outstanding" as string },
    { label: "Overdue", value: fmt(overdueTotal), color: "var(--t-error)", filter: "overdue" as string },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-1px", color: "var(--t-frame-text)" }}>
          Invoices
        </h1>
        <div className="flex gap-2">
          <button
            onClick={() => { setPanelMode("from-job"); setPanelOpen(true); }}
            className="flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium transition-all duration-150"
            style={{ borderColor: "var(--t-frame-border)", color: "var(--t-frame-text)", background: "transparent" }}
          >
            <FileText className="h-4 w-4" />
            Generate from Job
          </button>
          <button
            onClick={() => { setPanelMode("create"); setPanelOpen(true); }}
            className="flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-150 active:scale-95"
            style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}
          >
            <Plus className="h-4 w-4" />
            New Invoice
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {kpis.map((kpi) => {
          const isActive = tab === kpi.filter;
          return (
            <button key={kpi.label} onClick={() => { setTab(kpi.filter); setDateRange("all"); }}
              className="rounded-[20px] border p-4 text-left transition-all"
              style={{
                background: isActive ? "var(--t-bg-elevated)" : "var(--t-bg-card)",
                borderColor: isActive ? "var(--t-accent)" : "var(--t-border)",
                boxShadow: isActive ? "0 0 0 1px var(--t-accent)" : "",
                cursor: "pointer",
              }}>
              <p className="uppercase tracking-wider mb-1" style={{ fontSize: 13, color: isActive ? "var(--t-accent)" : "var(--t-text-muted)" }}>{kpi.label}</p>
              <p className="font-bold tabular-nums" style={{ fontSize: 24, color: kpi.color || "var(--t-text-primary)" }}>{kpi.value}</p>
            </button>
          );
        })}
      </div>

      {/* Overdue Alert */}
      {overdueInvoices.length > 0 && (
        <div className="mb-6 flex items-center justify-between rounded-[20px] border px-5 py-3"
          style={{ borderColor: "var(--t-error)", background: "var(--t-bg-card)" }}>
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5" style={{ color: "var(--t-error)" }} />
            <span className="text-sm font-medium" style={{ color: "var(--t-error)" }}>
              {overdueInvoices.length} invoice{overdueInvoices.length !== 1 ? "s" : ""} overdue totaling {fmt(overdueTotal)}
            </span>
          </div>
          <button className="flex items-center gap-1.5 text-sm font-medium transition-all duration-150"
            style={{ color: "var(--t-error)" }}>
            <Bell className="h-3.5 w-3.5" /> Send Reminders
          </button>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="mb-6">
        <div style={{ display: "inline-flex", borderRadius: 22, backgroundColor: "var(--t-bg-secondary)", border: "1px solid var(--t-border)", padding: 3, gap: 2 }}>
          {TABS.map((t) => {
            const stats = tabStats[t] || { count: 0, amount: 0 };
            const isActive = tab === t;
            return (
              <button key={t} onClick={() => setTab(t)}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 18, fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", transition: "all 0.15s ease", background: isActive ? "var(--t-accent)" : "transparent", color: isActive ? "#fff" : "var(--t-text-muted)" }}>
                {TAB_LABELS[t]}
                <span style={{ fontSize: 10, fontWeight: 700, opacity: isActive ? 0.85 : 0.6 }}>{stats.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Search & Sort */}
      <div className="flex items-center gap-3 mb-5">
        <label className="inline-flex items-center gap-2 cursor-pointer shrink-0" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={filteredInvoices.length > 0 && filteredInvoices.every(inv => selectedIds.has(inv.id))}
            onChange={() => {
              const allSelected = filteredInvoices.every(inv => selectedIds.has(inv.id));
              setSelectedIds(prev => {
                const next = new Set(prev);
                if (allSelected) {
                  filteredInvoices.forEach(inv => next.delete(inv.id));
                } else {
                  filteredInvoices.forEach(inv => next.add(inv.id));
                }
                return next;
              });
            }}
            className="h-4 w-4 rounded cursor-pointer accent-[var(--t-accent)]"
          />
          <span className="text-xs" style={{ color: "var(--t-frame-text-muted)" }}>All</span>
        </label>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "var(--t-frame-text-muted)" }} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search invoice #, customer name..."
            className="w-full rounded-[20px] py-2 pl-9 pr-4 text-sm outline-none transition-all duration-150"
            style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
          />
        </div>
        <div className="flex rounded-full border overflow-hidden" style={{ borderColor: "var(--t-frame-border)" }}>
          {DATE_RANGES.map((opt) => (
            <button key={opt.value} onClick={() => setDateRange(opt.value)}
              className="px-3 py-1.5 text-xs font-medium transition-all duration-150"
              style={{
                background: dateRange === opt.value ? "var(--t-accent-soft)" : "transparent",
                color: dateRange === opt.value ? "var(--t-accent)" : "var(--t-frame-text-muted)",
              }}>
              {opt.label}
            </button>
          ))}
        </div>
        <Dropdown
          trigger={
            <button className="flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-all duration-150"
              style={{ borderColor: "var(--t-frame-border)", background: "var(--t-frame-hover)", color: "var(--t-frame-text-muted)" }}>
              <ArrowDownUp className="h-3.5 w-3.5" />
              {SORT_OPTIONS.find((o) => o.value === sortBy)?.label}
            </button>
          }
          align="right"
        >
          {SORT_OPTIONS.map((opt) => (
            <button key={opt.value} onClick={() => setSortBy(opt.value)}
              className="block w-full px-4 py-2 text-left text-sm transition-all duration-150"
              style={{ color: sortBy === opt.value ? "var(--t-accent)" : "var(--t-text-primary)" }}>
              {opt.label}
            </button>
          ))}
        </Dropdown>
        <button
          onClick={async () => {
            try {
              const params = new URLSearchParams();
              if (tab !== "all") params.set("status", tab);
              const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://serviceos-api.vercel.app"}/reporting/invoices/export?${params}`, {
                headers: { Authorization: `Bearer ${localStorage.getItem("accessToken") || ""}` },
              });
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = "invoices.csv"; a.click();
              URL.revokeObjectURL(url);
            } catch { /* */ }
          }}
          className="flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-all duration-150"
          style={{ borderColor: "var(--t-frame-border)", background: "var(--t-frame-hover)", color: "var(--t-frame-text-muted)" }}
        >
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
      </div>

      {/* Invoice List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 w-full skeleton rounded-[20px]" />
          ))}
        </div>
      ) : filteredInvoices.length === 0 ? (
        <div className="py-16 flex flex-col items-center justify-center text-center">
          <FileText size={40} className="mb-3" style={{ color: "var(--t-text-muted)", opacity: 0.2 }} />
          <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--t-text-primary)" }} className="mb-1">{(tab !== "all" || searchQuery) ? "No matching invoices" : "No invoices yet"}</h2>
          <p style={{ fontSize: 12, color: "var(--t-text-muted)" }} className="mb-5">{(tab !== "all" || searchQuery) ? "Try adjusting your filters or search" : "Create an invoice or generate one from a completed job"}</p>
          {(tab !== "all" || searchQuery) ? (
            <button onClick={() => { setTab("all"); setSearchQuery(""); setDateRange("all"); }}
              className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors"
              style={{ borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}>
              Clear Filters
            </button>
          ) : (
            <button onClick={() => { setPanelMode("create"); setPanelOpen(true); }}
              className="flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-150 active:scale-95"
              style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}>
              <Plus className="h-4 w-4" /> New Invoice
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          {filteredInvoices.map((inv) => {
            const statusColor = STATUS_COLOR[inv.status] || STATUS_COLOR.draft;
            const customerName = inv.customer ? `${inv.customer.first_name} ${inv.customer.last_name}` : "No customer";
            const isOverdue = inv.status === "overdue";
            const days = daysUntil(inv.due_date, timezone);
            const lineDesc = inv.line_items?.length > 0 ? inv.line_items[0].name : "";

            return (
              <button
                key={inv.id}
                onClick={() => router.push(`/invoices/${inv.id}`)}
                className="w-full flex items-center gap-4 rounded-[20px] border px-5 py-3.5 text-left transition-all duration-150"
                style={{
                  background: "var(--t-bg-card)",
                  borderColor: "var(--t-border)",
                  ...(isOverdue || (inv.status === "open" && days < 0) ? { borderLeft: "3px solid var(--t-error)" } : {}),
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "var(--t-bg-card-hover)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "var(--t-bg-card)"; }}
              >
                {/* Checkbox for bulk selection */}
                <input
                  type="checkbox"
                  checked={selectedIds.has(inv.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation();
                    setSelectedIds(prev => {
                      const next = new Set(prev);
                      if (next.has(inv.id)) next.delete(inv.id); else next.add(inv.id);
                      return next;
                    });
                  }}
                  className="shrink-0 h-4 w-4 rounded cursor-pointer accent-[var(--t-accent)]"
                />
                {/* Left: Customer + invoice info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "var(--t-text-primary)" }}>{customerName}</p>
                  <p className="text-xs mt-0.5 truncate" style={{ color: "var(--t-text-muted)" }}>
                    #{inv.invoice_number}
                    {lineDesc && <span> · {lineDesc}</span>}
                  </p>
                </div>

                {/* Center: Date info */}
                <div className="hidden sm:block shrink-0 text-right" style={{ minWidth: 120 }}>
                  <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>{fmtDate(inv.created_at.split("T")[0])}</p>
                  {inv.due_date && inv.status !== "paid" && inv.status !== "void" && inv.status !== "draft" && (
                    <p className="text-[11px] mt-0.5" style={{ color: isOverdue ? "var(--t-error)" : days <= 3 ? "var(--t-warning)" : "var(--t-text-muted)" }}>
                      {isOverdue ? `${Math.abs(days)}d overdue` : `${days}d left`}
                    </p>
                  )}
                </div>

                {/* Actions menu */}
                <div className="shrink-0" onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}>
                  <Dropdown
                    trigger={
                      <button
                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                        className="rounded-full p-1.5 transition-colors hover:bg-[var(--t-bg-card-hover)]"
                        style={{ color: "var(--t-text-muted)", border: "none", background: "none", cursor: "pointer" }}
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
                          await api.post(`/invoices/${inv.id}/send`);
                          toast("success", "Invoice sent");
                          fetchInvoices(); fetchAllInvoices();
                        } catch { toast("error", "Failed to send invoice"); }
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors hover:bg-[var(--t-bg-card-hover)]"
                      style={{ color: "var(--t-text-primary)", border: "none", background: "none", cursor: "pointer" }}
                    >
                      <Send className="h-3.5 w-3.5" /> Send Invoice
                    </button>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (!confirm(`Void Invoice #${inv.invoice_number}? This cannot be undone.`)) return;
                        try {
                          await api.post(`/invoices/${inv.id}/void`);
                          toast("success", "Invoice voided");
                          fetchInvoices(); fetchAllInvoices();
                        } catch { toast("error", "Failed to void invoice"); }
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors hover:bg-[var(--t-bg-card-hover)]"
                      style={{ color: "var(--t-error)", border: "none", background: "none", cursor: "pointer" }}
                    >
                      <XCircle className="h-3.5 w-3.5" /> Void Invoice
                    </button>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        const amt = prompt("Payment amount:");
                        if (!amt || isNaN(Number(amt))) return;
                        try {
                          await api.post(`/invoices/${inv.id}/payments`, { amount: Number(amt) });
                          toast("success", "Payment recorded");
                          fetchInvoices(); fetchAllInvoices();
                        } catch { toast("error", "Failed to record payment"); }
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors hover:bg-[var(--t-bg-card-hover)]"
                      style={{ color: "var(--t-text-primary)", border: "none", background: "none", cursor: "pointer" }}
                    >
                      <CreditCard className="h-3.5 w-3.5" /> Record Payment
                    </button>
                  </Dropdown>
                </div>

                {/* Right: Amount + status */}
                <div className="shrink-0 text-right" style={{ minWidth: 100 }}>
                  <p className="text-sm font-bold tabular-nums" style={{ color: "var(--t-text-primary)" }}>{fmt(inv.total)}</p>
                  <p className="text-xs font-medium capitalize mt-0.5" style={{ color: statusColor, textDecoration: inv.status === "void" ? "line-through" : "none" }}>
                    {inv.status === "open" ? "Pending" : inv.status}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > 30 && (
        <div className="mt-6 flex items-center justify-between text-sm" style={{ color: "var(--t-text-muted)" }}>
          <span>Showing {(page - 1) * 30 + 1}--{Math.min(page * 30, total)} of {total}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
              className="rounded-full border px-3 py-1.5 transition-all duration-150 disabled:opacity-40"
              style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}>Previous</button>
            <button onClick={() => setPage((p) => p + 1)} disabled={page * 30 >= total}
              className="rounded-full border px-3 py-1.5 transition-all duration-150 disabled:opacity-40"
              style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}>Next</button>
          </div>
        </div>
      )}

      {/* Bulk Action Floating Bar */}
      {selectedIds.size > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 50,
            background: "rgba(23,23,23,0.95)",
            border: "1px solid var(--t-border)",
            borderRadius: 16,
            padding: "10px 20px",
            display: "flex",
            alignItems: "center",
            gap: 16,
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            backdropFilter: "blur(12px)",
          }}
        >
          <span className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
            {bulkProgress || `${selectedIds.size} selected`}
          </span>
          <div style={{ width: 1, height: 20, background: "var(--t-border)" }} />
          {!bulkProgress && (
            <>
              <button
                onClick={async () => {
                  if (selectedIds.size > 25) { toast("error", "Select 25 or fewer invoices for bulk actions"); return; }
                  const ids = Array.from(selectedIds);
                  for (let i = 0; i < ids.length; i++) {
                    setBulkProgress(`Sending ${i + 1} of ${ids.length}...`);
                    try { await api.post(`/invoices/${ids[i]}/send`); } catch { /* continue */ }
                  }
                  setBulkProgress(null);
                  setSelectedIds(new Set());
                  toast("success", `Sent ${ids.length} reminder(s)`);
                  fetchInvoices();
                  fetchAllInvoices();
                }}
                className="rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-95"
                style={{ background: "var(--t-warning)", color: "var(--t-accent-on-accent)" }}
              >
                Send Reminders
              </button>
              <button
                onClick={async () => {
                  if (selectedIds.size > 25) { toast("error", "Select 25 or fewer invoices for bulk actions"); return; }
                  const ids = Array.from(selectedIds);
                  const selectedInvs = allInvoices.filter(inv => ids.includes(inv.id));
                  for (let i = 0; i < selectedInvs.length; i++) {
                    setBulkProgress(`Marking paid ${i + 1} of ${selectedInvs.length}...`);
                    try { await api.post(`/invoices/${selectedInvs[i].id}/payments`, { amount: selectedInvs[i].balance_due }); } catch { /* continue */ }
                  }
                  setBulkProgress(null);
                  setSelectedIds(new Set());
                  toast("success", `Marked ${selectedInvs.length} invoice(s) as paid`);
                  fetchInvoices();
                  fetchAllInvoices();
                }}
                className="rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-95"
                style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}
              >
                Mark as Paid
              </button>
            </>
          )}
          <div style={{ width: 1, height: 20, background: "var(--t-border)" }} />
          <button
            onClick={() => { setSelectedIds(new Set()); setBulkProgress(null); }}
            className="text-xs font-medium transition-all duration-150"
            style={{ color: "var(--t-text-muted)" }}
          >
            Clear Selection
          </button>
        </div>
      )}

      {/* Panels */}
      <SlideOver open={panelOpen} onClose={() => setPanelOpen(false)} title={panelMode === "from-job" ? "Generate from Job" : "New Invoice"}>
        {panelMode === "from-job" ? (
          <FromJobForm onSuccess={() => { setPanelOpen(false); fetchInvoices(); fetchAllInvoices(); toast("success", "Invoice generated"); }} />
        ) : (
          <CreateInvoiceForm onSuccess={() => { setPanelOpen(false); fetchInvoices(); fetchAllInvoices(); toast("success", "Invoice created"); }} />
        )}
      </SlideOver>
    </div>
  );
}

/* --- Generate from Job --- */

function FromJobForm({ onSuccess }: { onSuccess: () => void }) {
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<JobOption | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.get<{ data: JobOption[] }>("/jobs?status=completed&limit=50")
      .then((res) => setJobs(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleGenerate = async () => {
    if (!selectedJob) return;
    setError(""); setSaving(true);
    try {
      await api.post(`/invoices/from-job/${selectedJob.id}`);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate");
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-5">
      {error && <div className="rounded-[20px] px-4 py-3 text-sm" style={{ background: "var(--t-error-soft)", color: "var(--t-error)" }}>{error}</div>}
      <p className="text-sm" style={{ color: "var(--t-text-muted)" }}>Select a completed job to auto-generate an invoice from its pricing.</p>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 skeleton rounded-[20px]" />)}</div>
      ) : jobs.length === 0 ? (
        <div className="py-8 text-center">
          <FileText className="mx-auto h-8 w-8 mb-2" style={{ color: "var(--t-text-muted)", opacity: 0.3 }} />
          <p className="text-sm" style={{ color: "var(--t-text-muted)" }}>No completed jobs without invoices</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {jobs.map((j) => (
            <button
              key={j.id}
              onClick={() => setSelectedJob(selectedJob?.id === j.id ? null : j)}
              className="w-full rounded-[20px] border p-3 text-left transition-all duration-150"
              style={{
                borderColor: selectedJob?.id === j.id ? "var(--t-accent)" : "var(--t-border)",
                background: selectedJob?.id === j.id ? "var(--t-accent-soft)" : "var(--t-bg-card)",
              }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>{j.job_number}</p>
                  {j.customer && <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>{j.customer.first_name} {j.customer.last_name}</p>}
                </div>
                {j.total_price > 0 && <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--t-accent)" }}>{fmt(j.total_price)}</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      <button onClick={handleGenerate} disabled={!selectedJob || saving}
        className="w-full rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-150 disabled:opacity-50 active:scale-95"
        style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}>
        {saving ? "Generating..." : "Generate Invoice"}
      </button>
    </div>
  );
}

/* --- Create Invoice Form --- */

function CreateInvoiceForm({ onSuccess }: { onSuccess: () => void }) {
  // Phase B3 — hook is called directly here (rather than prop-drilling)
  // because the form is a leaf component and already re-renders
  // independently. Shares the /auth/profile cache so this doesn't
  // trigger an extra fetch.
  const timezone = useTenantTimezone();
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerOption[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("30");
  const [dueDate, setDueDate] = useState(() => {
    // Phase B3 — default due date = tenant-today + 30 days, walked
    // purely in UTC to avoid browser-local or UTC-rollover drift.
    const todayStr = getTenantToday(timezone);
    const [ty, tm, td] = todayStr.split("-").map(Number);
    const dt = new Date(Date.UTC(ty, (tm || 1) - 1, td || 1));
    dt.setUTCDate(dt.getUTCDate() + 30);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  });
  const [taxRate, setTaxRate] = useState("0.0825");
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: "", quantity: 1, unitPrice: 0, amount: 0 },
  ]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMode, setSaveMode] = useState<"draft" | "send">("draft");
  const timeout = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (timeout.current) clearTimeout(timeout.current);
    if (!customerSearch || customerSearch.length < 2) { setCustomerResults([]); return; }
    timeout.current = setTimeout(async () => {
      try {
        const res = await api.get<{ data: CustomerOption[] }>(`/customers?search=${encodeURIComponent(customerSearch)}&limit=8`);
        setCustomerResults(res.data);
        setShowDropdown(true);
      } catch { /* */ }
    }, 300);
  }, [customerSearch]);

  // Update due date when payment terms change
  useEffect(() => {
    // Phase B3 — same tenant-today + N days pattern as the initial
    // default, kept in sync so the "today" anchor is never the
    // browser's midnight.
    const days = parseInt(paymentTerms) || 30;
    const todayStr = getTenantToday(timezone);
    const [ty, tm, td] = todayStr.split("-").map(Number);
    const dt = new Date(Date.UTC(ty, (tm || 1) - 1, td || 1));
    dt.setUTCDate(dt.getUTCDate() + days);
    setDueDate(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`);
  }, [paymentTerms, timezone]);

  const updateLineItem = (idx: number, field: keyof LineItem, value: string | number) => {
    setLineItems((prev) => {
      const items = [...prev];
      const item = { ...items[idx] };
      if (field === "description") item.description = value as string;
      else {
        const num = Number(value) || 0;
        if (field === "quantity") item.quantity = num;
        if (field === "unitPrice") item.unitPrice = num;
        item.amount = Math.round(item.quantity * item.unitPrice * 100) / 100;
      }
      items[idx] = item;
      return items;
    });
  };

  const addLine = () => setLineItems((p) => [...p, { description: "", quantity: 1, unitPrice: 0, amount: 0 }]);
  const removeLine = (idx: number) => setLineItems((p) => p.filter((_, i) => i !== idx));

  const subtotal = lineItems.reduce((s, l) => s + l.amount, 0);
  const tax = Math.round(subtotal * Number(taxRate) * 100) / 100;
  const invoiceTotal = Math.round((subtotal + tax) * 100) / 100;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!customerId) { setError("Please select a customer"); return; }
    setError(""); setSaving(true);
    try {
      const invoice = await api.post<{ id: string }>("/invoices", {
        customer_id: customerId,
        due_date: dueDate || undefined,
        line_items: lineItems.filter((l) => l.description).map((l) => ({
          line_type: "custom",
          name: l.description,
          quantity: l.quantity,
          unit_rate: l.unitPrice,
        })),
      });
      if (saveMode === "send" && invoice?.id) {
        try { await api.post(`/invoices/${invoice.id}/send`); } catch { /* send might fail, invoice still created */ }
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally { setSaving(false); }
  };

  const inp = "w-full rounded-[20px] px-4 py-2.5 text-sm outline-none transition-all duration-150";
  const inpStyle = { background: "var(--t-bg-card)", borderWidth: 1, borderStyle: "solid" as const, borderColor: "var(--t-border)", color: "var(--t-text-primary)" };
  const lbl = "block text-sm font-medium mb-1.5";
  const lblStyle = { color: "var(--t-text-muted)" };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <div className="rounded-[20px] px-4 py-3 text-sm" style={{ background: "var(--t-error-soft)", color: "var(--t-error)" }}>{error}</div>}

      {/* Customer */}
      <div className="relative">
        <label className={lbl} style={lblStyle}>Customer</label>
        {customerName ? (
          <div className="flex items-center justify-between rounded-[20px] border px-4 py-2.5"
            style={{ borderColor: "var(--t-border)", background: "var(--t-bg-card)" }}>
            <span className="text-sm" style={{ color: "var(--t-text-primary)" }}>{customerName}</span>
            <button type="button" onClick={() => { setCustomerId(""); setCustomerName(""); }}
              className="text-xs transition-all duration-150" style={{ color: "var(--t-text-muted)" }}>Clear</button>
          </div>
        ) : (
          <input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)}
            onFocus={() => customerResults.length > 0 && setShowDropdown(true)}
            className={inp} style={inpStyle} placeholder="Search customers..." />
        )}
        {showDropdown && customerResults.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-[20px] border shadow-xl overflow-hidden"
            style={{ borderColor: "var(--t-border)", background: "var(--t-bg-card)" }}>
            {customerResults.map((c) => (
              <button key={c.id} type="button"
                onClick={() => { setCustomerId(c.id); setCustomerName(`${c.first_name} ${c.last_name}`); setShowDropdown(false); setCustomerSearch(""); }}
                className="w-full px-4 py-2.5 text-left text-sm transition-all duration-150"
                style={{ color: "var(--t-text-primary)" }}>
                {c.first_name} {c.last_name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl} style={lblStyle}>Payment Terms</label>
          <select value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)}
            className={`${inp} appearance-none`} style={inpStyle}>
            {PAYMENT_TERMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl} style={lblStyle}>Due Date</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
            className={inp} style={inpStyle} />
        </div>
      </div>

      <div>
        <label className={lbl} style={lblStyle}>Tax Rate</label>
        <input type="number" step="0.0001" value={taxRate} onChange={(e) => setTaxRate(e.target.value)}
          className={inp} style={inpStyle} placeholder="0.0825" />
        <p className="mt-1 text-[10px]" style={{ color: "var(--t-text-muted)" }}>{(Number(taxRate) * 100).toFixed(2)}%</p>
      </div>

      {/* Line Items */}
      <div>
        <label className={lbl} style={lblStyle}>Line Items</label>
        {/* Quick Add Presets */}
        <div className="flex flex-wrap gap-2 mb-3">
          {[
            { description: "Overage Day", unitPrice: 10 },
            { description: "Distance Surcharge", unitPrice: 25 },
            { description: "Overweight Surcharge", unitPrice: 185 },
          ].map((preset) => (
            <button
              key={preset.description}
              type="button"
              onClick={() => setLineItems(prev => [...prev, { description: preset.description, quantity: 1, unitPrice: preset.unitPrice, amount: preset.unitPrice }])}
              className="rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150 active:scale-95"
              style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)", cursor: "pointer" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--t-accent)"; e.currentTarget.style.color = "var(--t-accent)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--t-border)"; e.currentTarget.style.color = "var(--t-text-primary)"; }}
            >
              + {preset.description} (${preset.unitPrice})
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {lineItems.map((line, idx) => (
            <div key={idx} className="flex gap-2 items-start">
              <input value={line.description} onChange={(e) => updateLineItem(idx, "description", e.target.value)}
                className={`flex-1 ${inp}`} style={inpStyle} placeholder="Description" />
              <input type="number" value={line.quantity || ""} onChange={(e) => updateLineItem(idx, "quantity", e.target.value)}
                className={`w-16 ${inp}`} style={inpStyle} placeholder="Qty" />
              <input type="number" step="0.01" value={line.unitPrice || ""} onChange={(e) => updateLineItem(idx, "unitPrice", e.target.value)}
                className={`w-24 ${inp}`} style={inpStyle} placeholder="Price" />
              <span className="flex items-center py-2.5 text-sm w-20 justify-end tabular-nums"
                style={{ color: "var(--t-text-primary)" }}>{fmt(line.amount)}</span>
              {lineItems.length > 1 && (
                <button type="button" onClick={() => removeLine(idx)} className="p-2.5 transition-all duration-150"
                  style={{ color: "var(--t-text-muted)" }}><Trash2 className="h-4 w-4" /></button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={addLine} className="mt-2 text-sm font-medium transition-all duration-150"
          style={{ color: "var(--t-accent)" }}>+ Add line item</button>
      </div>

      {/* Totals */}
      <div className="rounded-[20px] border p-4 space-y-2 text-sm"
        style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
        <div className="flex justify-between" style={{ color: "var(--t-text-primary)" }}><span>Subtotal</span><span className="tabular-nums">{fmt(subtotal)}</span></div>
        {tax > 0 && <div className="flex justify-between" style={{ color: "var(--t-text-primary)" }}><span>Tax ({(Number(taxRate) * 100).toFixed(2)}%)</span><span className="tabular-nums">{fmt(tax)}</span></div>}
        <div className="flex justify-between pt-2 font-semibold" style={{ borderTop: "1px solid var(--t-border)" }}>
          <span style={{ color: "var(--t-text-primary)" }}>Total</span>
          <span className="tabular-nums" style={{ color: "var(--t-accent)" }}>{fmt(invoiceTotal)}</span>
        </div>
      </div>

      <div>
        <label className={lbl} style={lblStyle}>Notes to Customer</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
          className={`${inp} resize-none`} style={inpStyle} placeholder="Payment instructions, thank you note..." />
      </div>

      {/* Save buttons */}
      <div className="flex gap-2">
        <button type="submit" onClick={() => setSaveMode("draft")} disabled={saving}
          className="flex-1 rounded-full border px-4 py-2.5 text-sm font-medium transition-all duration-150 disabled:opacity-50"
          style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)", background: "transparent" }}>
          {saving && saveMode === "draft" ? "Saving..." : "Save as Draft"}
        </button>
        <button type="submit" onClick={() => setSaveMode("send")} disabled={saving}
          className="flex-1 rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-150 disabled:opacity-50 active:scale-95"
          style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}>
          {saving && saveMode === "send" ? "Sending..." : "Save & Send"}
        </button>
      </div>
    </form>
  );
}

/**
 * Default export — Suspense boundary required by Next.js App Router
 * because `InvoicesPageContent` calls `useSearchParams`.
 */
export default function InvoicesPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm" style={{ color: "var(--t-text-muted)" }}>
          Loading…
        </div>
      }
    >
      <InvoicesPageContent />
    </Suspense>
  );
}
