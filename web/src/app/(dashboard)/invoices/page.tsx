"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  FileText,
  Trash2,
  Search,
  ArrowDownUp,
  AlertTriangle,
  Calendar,
  Clock,
  DollarSign,
  ArrowRight,
  Bell,
} from "lucide-react";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";
import Dropdown from "@/components/dropdown";
import { useToast } from "@/components/toast";

/* ─── Types ─── */

interface Invoice {
  id: string;
  invoice_number: string;
  status: string;
  due_date: string;
  subtotal: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  line_items: LineItem[];
  notes: string;
  created_at: string;
  customer: { id: string; first_name: string; last_name: string } | null;
  job: { id: string; job_number: string } | null;
}

interface InvoicesResponse {
  data: Invoice[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface CustomerOption { id: string; first_name: string; last_name: string }
interface JobOption { id: string; job_number: string; status: string; total_price: number; customer: { first_name: string; last_name: string } | null }

/* ─── Constants ─── */

const TABS = ["all", "draft", "sent", "paid", "overdue", "void"] as const;

const STATUS_BADGE: Record<string, { bg: string; text: string; dot: string }> = {
  draft:   { bg: "bg-zinc-500/10", text: "text-zinc-400", dot: "bg-zinc-400" },
  sent:    { bg: "bg-blue-500/10", text: "text-blue-400", dot: "bg-blue-400" },
  paid:    { bg: "bg-emerald-500/10", text: "text-emerald-400", dot: "bg-emerald-400" },
  overdue: { bg: "bg-red-500/10", text: "text-red-400", dot: "bg-red-400" },
  void:    { bg: "bg-zinc-600/10", text: "text-zinc-500 line-through", dot: "bg-zinc-500" },
};

const TAB_LABELS: Record<string, string> = {
  all: "All", draft: "Draft", sent: "Sent", paid: "Paid", overdue: "Overdue", void: "Void",
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

/* ─── Helpers ─── */

import { formatCurrency } from "@/lib/utils";
const fmt = (n: number | null | undefined) => formatCurrency(n as number);

function fmtDate(d: string): string {
  if (!d) return "—";
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysUntil(d: string): number {
  if (!d) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(d + "T12:00:00");
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

function getDateRange(range: string): { dateFrom?: string; dateTo?: string } {
  const today = new Date();
  const f = (d: Date) => d.toISOString().split("T")[0];
  if (range === "week") {
    const start = new Date(today); start.setDate(today.getDate() - today.getDay());
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return { dateFrom: f(start), dateTo: f(end) };
  }
  if (range === "month") {
    return { dateFrom: f(new Date(today.getFullYear(), today.getMonth(), 1)), dateTo: f(new Date(today.getFullYear(), today.getMonth() + 1, 0)) };
  }
  if (range === "quarter") {
    const qStart = Math.floor(today.getMonth() / 3) * 3;
    return { dateFrom: f(new Date(today.getFullYear(), qStart, 1)), dateTo: f(new Date(today.getFullYear(), qStart + 3, 0)) };
  }
  return {};
}

/* ─── Main Page ─── */

export default function InvoicesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [tab, setTab] = useState("all");
  const [dateRange, setDateRange] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("date_desc");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<"create" | "from-job">("create");
  const [allInvoices, setAllInvoices] = useState<Invoice[]>([]);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "30" });
      if (tab !== "all") params.set("status", tab);
      const range = getDateRange(dateRange);
      if (range.dateFrom) params.set("dateFrom", range.dateFrom);
      if (range.dateTo) params.set("dateTo", range.dateTo);
      const res = await api.get<InvoicesResponse>(`/invoices?${params.toString()}`);
      setInvoices(res.data);
      setTotal(res.meta.total);
    } catch { /* */ } finally { setLoading(false); }
  }, [page, tab, dateRange]);

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
    allInvoices.filter((i) => i.status === "sent" || i.status === "overdue").reduce((s, i) => s + Number(i.balance_due), 0),
  [allInvoices]);

  const overdueInvoices = useMemo(() =>
    allInvoices.filter((i) => i.status === "overdue"),
  [allInvoices]);

  // Client-side search + sort
  const filteredInvoices = useMemo(() => {
    let result = [...invoices];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((inv) => {
        const name = inv.customer ? `${inv.customer.first_name} ${inv.customer.last_name}`.toLowerCase() : "";
        return inv.invoice_number.toLowerCase().includes(q) || name.includes(q);
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

  return (
    <div>
      {/* Overdue Alert */}
      {overdueInvoices.length > 0 && (
        <div className="mb-6 flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-3">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-red-400" />
            <span className="text-sm font-medium text-red-300">
              {overdueInvoices.length} invoice{overdueInvoices.length !== 1 ? "s" : ""} overdue totaling {fmt(overdueInvoices.reduce((s, i) => s + Number(i.balance_due), 0))}
            </span>
          </div>
          <button className="flex items-center gap-1.5 text-sm font-medium text-red-400 hover:text-red-300 transition-colors">
            <Bell className="h-3.5 w-3.5" /> Send Reminders
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">Invoices</h1>
          <p className="mt-1 text-sm text-muted">
            {tabStats.all.count} invoices
            {outstandingTotal > 0 && <> &middot; <span className="text-yellow-400">{fmt(outstandingTotal)} outstanding</span></>}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setPanelMode("from-job"); setPanelOpen(true); }}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-dark-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-dark-card-hover btn-press"
          >
            <FileText className="h-4 w-4" />
            Generate from Job
          </button>
          <button
            onClick={() => { setPanelMode("create"); setPanelOpen(true); }}
            className="flex items-center gap-2 rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1FA855] btn-press"
          >
            <Plus className="h-4 w-4" />
            New Invoice
          </button>
        </div>
      </div>

      {/* Status Tabs */}
      <div className="mb-6 flex gap-0 overflow-x-auto border-b border-[#1E2D45]">
        {TABS.map((t) => {
          const stats = tabStats[t] || { count: 0, amount: 0 };
          const isOverdueTab = t === "overdue" && stats.count > 0;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`relative shrink-0 px-4 py-3 text-sm font-medium transition-colors btn-press ${
                tab === t ? (isOverdueTab ? "text-red-400" : "text-brand") : isOverdueTab ? "text-red-400/70 hover:text-red-400" : "text-muted hover:text-foreground"
              }`}
            >
              {TAB_LABELS[t]}
              <span className={`ml-1.5 text-xs ${tab === t ? "opacity-70" : "opacity-40"}`}>
                {stats.count}
                {t !== "all" && t !== "void" && stats.amount > 0 && (
                  <span className="ml-1">&middot; {fmt(stats.amount)}</span>
                )}
                {isOverdueTab && " ⚠️"}
              </span>
              {tab === t && (
                <span className={`absolute inset-x-0 bottom-0 h-0.5 rounded-full ${isOverdueTab ? "bg-red-400" : "bg-brand"}`} />
              )}
            </button>
          );
        })}
      </div>

      {/* Search & Sort */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search invoice #, customer name..."
            className="w-full rounded-lg bg-[#111C2E] border border-[#1E2D45] pl-10 pr-4 py-2 text-sm text-white placeholder-muted outline-none transition-colors focus:border-brand"
          />
        </div>
        <div className="flex rounded-lg border border-[#1E2D45] overflow-hidden">
          {DATE_RANGES.map((opt) => (
            <button key={opt.value} onClick={() => setDateRange(opt.value)} className={`px-3 py-1.5 text-xs font-medium transition-colors ${dateRange === opt.value ? "bg-brand/10 text-brand" : "text-muted hover:text-white"}`}>
              {opt.label}
            </button>
          ))}
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
            <button key={opt.value} onClick={() => setSortBy(opt.value)} className={`block w-full px-4 py-2 text-left text-sm transition-colors ${sortBy === opt.value ? "text-brand bg-brand/5" : "text-foreground hover:bg-dark-card"}`}>
              {opt.label}
            </button>
          ))}
        </Dropdown>
      </div>

      {/* Invoice Cards */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-20 w-full skeleton rounded-xl" />
          ))}
        </div>
      ) : filteredInvoices.length === 0 ? (
        <div className="py-24 flex flex-col items-center justify-center text-center">
          <FileText size={48} className="text-[#7A8BA3]/30 mb-4" />
          <h2 className="text-lg font-semibold text-white mb-1">{searchQuery ? "No matching invoices" : "No invoices yet"}</h2>
          <p className="text-sm text-muted mb-6">{searchQuery ? "Try a different search" : "Create an invoice or generate one from a completed job"}</p>
          {!searchQuery && (
            <button onClick={() => { setPanelMode("create"); setPanelOpen(true); }} className="flex items-center gap-2 rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1FA855] btn-press">
              <Plus className="h-4 w-4" /> New Invoice
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredInvoices.map((inv) => {
            const badge = STATUS_BADGE[inv.status] || STATUS_BADGE.draft;
            const customerName = inv.customer ? `${inv.customer.first_name} ${inv.customer.last_name}` : "No customer";
            const isOverdue = inv.status === "overdue";
            const days = daysUntil(inv.due_date);
            const lineDesc = inv.line_items?.length > 0 ? inv.line_items[0].description : "";

            return (
              <button
                key={inv.id}
                onClick={() => router.push(`/invoices/${inv.id}`)}
                className={`w-full rounded-xl border p-4 text-left transition-all hover:bg-dark-card-hover card-hover btn-press ${
                  isOverdue ? "border-red-500/30 bg-dark-card border-l-4 border-l-red-500" : "border-[#1E2D45] bg-dark-card"
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* Left: Invoice # + Status */}
                  <div className="shrink-0 w-36">
                    <p className="font-mono text-sm font-semibold text-white">{inv.invoice_number}</p>
                    <span className={`inline-flex items-center gap-1.5 mt-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${badge.bg} ${badge.text}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${badge.dot} ${isOverdue ? "animate-pulse" : ""}`} />
                      {inv.status}
                    </span>
                  </div>

                  {/* Center: Customer + description + dates */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{customerName}</p>
                    {lineDesc && <p className="text-xs text-muted truncate mt-0.5">{lineDesc}</p>}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" /> {fmtDate(inv.created_at.split("T")[0])}
                      </span>
                      {inv.due_date && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" /> Due {fmtDate(inv.due_date)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: Amount + balance + days */}
                  <div className="shrink-0 text-right space-y-1">
                    <p className="text-lg font-bold text-white tabular-nums">{fmt(inv.total)}</p>
                    {Number(inv.amount_paid) > 0 && Number(inv.balance_due) > 0 && (
                      <p className="text-xs text-muted tabular-nums">Paid {fmt(inv.amount_paid)}</p>
                    )}
                    {Number(inv.balance_due) > 0 && inv.status !== "draft" && (
                      <p className={`text-xs font-medium tabular-nums ${isOverdue ? "text-red-400" : "text-foreground"}`}>
                        Balance {fmt(inv.balance_due)}
                      </p>
                    )}
                    {inv.due_date && inv.status !== "paid" && inv.status !== "void" && inv.status !== "draft" && (
                      <p className={`text-[10px] font-medium ${isOverdue ? "text-red-400" : days <= 3 ? "text-yellow-400" : "text-muted"}`}>
                        {isOverdue ? `⚠ ${Math.abs(days)} days overdue` : `${days} days left`}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
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

/* ─── Generate from Job ─── */

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
      {error && <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}
      <p className="text-sm text-muted">Select a completed job to auto-generate an invoice from its pricing.</p>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 skeleton rounded-lg" />)}</div>
      ) : jobs.length === 0 ? (
        <div className="py-8 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted/30 mb-2" />
          <p className="text-sm text-muted">No completed jobs without invoices</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {jobs.map((j) => (
            <button
              key={j.id}
              onClick={() => setSelectedJob(selectedJob?.id === j.id ? null : j)}
              className={`w-full rounded-lg border p-3 text-left transition-all ${
                selectedJob?.id === j.id ? "border-brand/30 bg-brand/5 ring-1 ring-brand/20" : "border-[#1E2D45] bg-[#111C2E] hover:bg-dark-card-hover"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">{j.job_number}</p>
                  {j.customer && <p className="text-xs text-muted">{j.customer.first_name} {j.customer.last_name}</p>}
                </div>
                {j.total_price > 0 && <span className="text-sm font-semibold text-brand tabular-nums">{fmt(j.total_price)}</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      <button onClick={handleGenerate} disabled={!selectedJob || saving} className="w-full rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1FA855] disabled:opacity-50 btn-press">
        {saving ? "Generating..." : "Generate Invoice"}
      </button>
    </div>
  );
}

/* ─── Create Invoice Form ─── */

function CreateInvoiceForm({ onSuccess }: { onSuccess: () => void }) {
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerOption[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("30");
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 30);
    return d.toISOString().split("T")[0];
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
    const days = parseInt(paymentTerms) || 30;
    const d = new Date(); d.setDate(d.getDate() + days);
    setDueDate(d.toISOString().split("T")[0]);
  }, [paymentTerms]);

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
        customerId,
        dueDate: dueDate || undefined,
        taxRate: Number(taxRate) || undefined,
        lineItems: lineItems.filter((l) => l.description),
        notes: notes || undefined,
      });
      if (saveMode === "send" && invoice?.id) {
        try { await api.post(`/invoices/${invoice.id}/send`); } catch { /* send might fail, invoice still created */ }
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally { setSaving(false); }
  };

  const inp = "w-full rounded-lg border border-[#1E2D45] bg-[#111C2E] px-4 py-2.5 text-sm text-white placeholder-muted outline-none transition-colors focus:border-brand";
  const lbl = "block text-sm font-medium text-[#7A8BA3] mb-1.5";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}

      {/* Customer */}
      <div className="relative">
        <label className={lbl}>Customer</label>
        {customerName ? (
          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-dark-card px-4 py-2.5">
            <span className="text-sm text-white">{customerName}</span>
            <button type="button" onClick={() => { setCustomerId(""); setCustomerName(""); }} className="text-xs text-muted hover:text-red-400">Clear</button>
          </div>
        ) : (
          <input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} onFocus={() => customerResults.length > 0 && setShowDropdown(true)} className={inp} placeholder="Search customers..." />
        )}
        {showDropdown && customerResults.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-lg border border-white/10 bg-dark-secondary shadow-xl overflow-hidden">
            {customerResults.map((c) => (
              <button key={c.id} type="button" onClick={() => { setCustomerId(c.id); setCustomerName(`${c.first_name} ${c.last_name}`); setShowDropdown(false); setCustomerSearch(""); }} className="w-full px-4 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-dark-card-hover">
                {c.first_name} {c.last_name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Payment Terms</label>
          <select value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} className={`${inp} appearance-none`}>
            {PAYMENT_TERMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Due Date</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inp} />
        </div>
      </div>

      <div>
        <label className={lbl}>Tax Rate</label>
        <input type="number" step="0.0001" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className={inp} placeholder="0.0825" />
        <p className="mt-1 text-[10px] text-muted">{(Number(taxRate) * 100).toFixed(2)}%</p>
      </div>

      {/* Line Items */}
      <div>
        <label className={lbl}>Line Items</label>
        <div className="space-y-2">
          {lineItems.map((line, idx) => (
            <div key={idx} className="flex gap-2 items-start">
              <input value={line.description} onChange={(e) => updateLineItem(idx, "description", e.target.value)} className={`flex-1 ${inp}`} placeholder="Description" />
              <input type="number" value={line.quantity || ""} onChange={(e) => updateLineItem(idx, "quantity", e.target.value)} className={`w-16 ${inp}`} placeholder="Qty" />
              <input type="number" step="0.01" value={line.unitPrice || ""} onChange={(e) => updateLineItem(idx, "unitPrice", e.target.value)} className={`w-24 ${inp}`} placeholder="Price" />
              <span className="flex items-center py-2.5 text-sm text-foreground w-20 justify-end tabular-nums">{fmt(line.amount)}</span>
              {lineItems.length > 1 && (
                <button type="button" onClick={() => removeLine(idx)} className="p-2.5 text-muted hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={addLine} className="mt-2 text-sm text-brand hover:text-brand-light btn-press">+ Add line item</button>
      </div>

      {/* Totals */}
      <div className="rounded-xl bg-[#111C2E] border border-[#1E2D45] p-4 space-y-2 text-sm">
        <div className="flex justify-between text-foreground"><span>Subtotal</span><span className="tabular-nums">{fmt(subtotal)}</span></div>
        {tax > 0 && <div className="flex justify-between text-foreground"><span>Tax ({(Number(taxRate) * 100).toFixed(2)}%)</span><span className="tabular-nums">{fmt(tax)}</span></div>}
        <div className="flex justify-between border-t border-[#1E2D45] pt-2 font-semibold"><span className="text-white">Total</span><span className="text-brand tabular-nums">{fmt(invoiceTotal)}</span></div>
      </div>

      <div>
        <label className={lbl}>Notes to Customer</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${inp} resize-none`} placeholder="Payment instructions, thank you note..." />
      </div>

      {/* Save buttons */}
      <div className="flex gap-2">
        <button type="submit" onClick={() => setSaveMode("draft")} disabled={saving} className="flex-1 rounded-lg border border-[#1E2D45] px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-dark-card-hover disabled:opacity-50 btn-press">
          {saving && saveMode === "draft" ? "Saving..." : "Save as Draft"}
        </button>
        <button type="submit" onClick={() => setSaveMode("send")} disabled={saving} className="flex-1 rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1FA855] disabled:opacity-50 btn-press">
          {saving && saveMode === "send" ? "Sending..." : "Save & Send"}
        </button>
      </div>
    </form>
  );
}
