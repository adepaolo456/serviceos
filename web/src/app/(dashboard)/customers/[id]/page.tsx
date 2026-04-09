"use client";

import { useState, useEffect, use, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useBooking } from "@/components/booking-provider";
import {
  ArrowLeft, Mail, Phone, MapPin, Building, Calendar, Pencil, Trash2,
  Briefcase, FileText, FileCheck, DollarSign, Clock, Plus, MessageSquare,
  CreditCard, Send, Tag, Settings, User,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import { deriveDisplayStatus, DISPLAY_STATUS_LABELS, displayStatusColor } from "@/lib/job-status";
import SlideOver from "@/components/slide-over";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";
import MapboxMap from "@/components/mapbox-map";
import { CUSTOMER_DASHBOARD_LABELS } from "@/lib/customer-dashboard-labels";

/* ---- Types ---- */

interface Customer {
  id: string; type: string; first_name: string; last_name: string;
  email: string; phone: string; company_name: string; account_id: string;
  billing_address: Record<string, string> | null;
  service_addresses: Record<string, string>[];
  notes: string; tags: string[]; lead_source: string;
  customer_preferences: Record<string, unknown>;
  total_jobs: number; lifetime_revenue: number; is_active: boolean; created_at: string;
}

interface Job {
  id: string; job_number: string; job_type: string; service_type: string;
  status: string; scheduled_date: string; total_price: number;
  asset: { id: string; identifier: string } | null;
  created_at: string;
}

interface Invoice {
  id: string; invoice_number: number; status: string; total: number;
  balance_due: number; due_date: string; created_at: string;
}

interface Note {
  id: string; content: string; type: string; author_name: string; created_at: string;
}

/* ---- Helpers ---- */

import { formatPhone, formatCurrency } from "@/lib/utils";

const fmtPhone = formatPhone;
const fmtMoney = (n: number) => formatCurrency(n);
const fmtMoneyShort = (n: number) => formatCurrency(n);

function timeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

const STATUS_CLS: Record<string, string> = {
  pending: "text-yellow-500", confirmed: "text-blue-400",
  dispatched: "text-purple-400", en_route: "text-orange-400",
  in_progress: "text-[var(--t-accent)]", completed: "text-emerald-400",
  cancelled: "text-[var(--t-error)]", draft: "text-[var(--t-text-muted)]",
  sent: "text-blue-400", paid: "text-[var(--t-accent)]",
  overdue: "text-[var(--t-error)]", void: "text-[var(--t-text-muted)]",
};

const TABS = [
  { key: "overview", label: "Overview", icon: User },
  { key: "billing", label: "Billing", icon: CreditCard },
  { key: "jobs", label: "Jobs", icon: Briefcase },
  { key: "quotes", label: "Quotes", icon: FileCheck },
  { key: "invoices", label: "Invoices", icon: FileText },
  { key: "pricing", label: "Pricing", icon: DollarSign },
  { key: "notes", label: "Notes", icon: MessageSquare },
  { key: "settings", label: "Settings", icon: Settings },
] as const;

type Tab = typeof TABS[number]["key"];

/** Overview-tab interactive tile keys — drives the shared detail panel. */
type OverviewTile = "jobs" | "revenue" | "avgValue" | "active" | "lastJob";

/* ---- Page ---- */

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { openWizard } = useBooking();
  const { toast } = useToast();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [customerQuotes, setCustomerQuotes] = useState<Array<{ id: string; quote_number: string; asset_subtype: string; total_quoted: number; derived_status: string; created_at: string; customer_name: string | null }>>([]);
  const [creditMemos, setCreditMemos] = useState<{ id: string; amount: number; reason: string; status: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedTile, setSelectedTile] = useState<OverviewTile | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [c, j, i, n] = await Promise.all([
          api.get<Customer>(`/customers/${id}`),
          api.get<{ data: Job[] }>(`/jobs?customerId=${id}&limit=100`),
          api.get<{ data: Invoice[] }>(`/invoices?customerId=${id}&limit=100`),
          api.get<Note[]>(`/customers/${id}/notes`).catch(() => []),
        ]);
        setCustomer(c); setJobs(j.data); setInvoices(i.data); setNotes(n);
        api.get<{ data: any[] }>(`/quotes?customerId=${id}&limit=50`)
          .then((r) => setCustomerQuotes(r.data || []))
          .catch(() => setCustomerQuotes([]));
        api.get<{ id: string; amount: number; reason: string; status: string }[]>(`/invoices/credit-memos/by-customer/${id}`)
          .then(setCreditMemos).catch(() => setCreditMemos([]));
      } catch { /* */ }
      finally { setLoading(false); }
    }
    load();
  }, [id]);

  // Default selected tile once jobs are loaded: Active if there are any
  // active rentals, otherwise Jobs. Runs exactly once per customer load —
  // after the user clicks a tile we keep their selection.
  useEffect(() => {
    if (loading || selectedTile !== null) return;
    const hasActive = jobs.some(
      (j) => !["completed", "cancelled"].includes(j.status),
    );
    setSelectedTile(hasActive ? "active" : "jobs");
  }, [loading, jobs, selectedTile]);

  const handleDelete = async () => {
    if (!confirm("Delete this customer?")) return;
    try { await api.delete(`/customers/${id}`); toast("success", "Deleted"); router.push("/customers"); }
    catch { toast("error", "Failed"); }
  };

  const addNote = async () => {
    if (!newNote.trim()) return;
    setAddingNote(true);
    try {
      const note = await api.post<Note>(`/customers/${id}/notes`, { content: newNote });
      setNotes(prev => [note, ...prev]);
      setNewNote("");
      toast("success", "Note added");
    } catch { toast("error", "Failed"); }
    finally { setAddingNote(false); }
  };

  if (loading) {
    return <div className="space-y-4"><div className="h-8 w-48 rounded bg-[var(--t-bg-card)] animate-pulse" /><div className="h-40 rounded-[20px] bg-[var(--t-bg-card)] animate-pulse" /><div className="h-64 rounded-[20px] bg-[var(--t-bg-card)] animate-pulse" /></div>;
  }
  if (!customer) return <div className="py-20 text-center text-[var(--t-text-muted)]">Not found</div>;

  const activeJobs = jobs.filter(j => !["completed", "cancelled"].includes(j.status));
  const unpaidBalance = invoices.reduce((s, i) => s + Number(i.balance_due), 0);
  const totalCredits = creditMemos.filter(m => m.status === "issued").reduce((s, m) => s + Number(m.amount), 0);
  const netBalance = Math.round((unpaidBalance - totalCredits) * 100) / 100;
  const avgValue = customer.total_jobs > 0 ? Math.round(Number(customer.lifetime_revenue) / customer.total_jobs) : 0;
  const lastJob = jobs[0];
  const daysSinceLastJob = lastJob ? Math.floor((Date.now() - new Date(lastJob.scheduled_date || lastJob.created_at).getTime()) / 86400000) : null;

  return (
    <div>
      {/* Back */}
      <Link href="/customers" className="inline-flex items-center gap-1.5 text-xs text-[var(--t-frame-text-muted)] hover:text-[var(--t-frame-text)] transition-colors mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> Customers
      </Link>

      {/* ===== HEADER (compressed — inline status strip at bottom) ===== */}
      <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-4 mb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] text-base font-bold ${customer.type === "commercial" ? "bg-purple-500/15 text-purple-400" : "bg-blue-500/15 text-blue-400"}`}>
              {customer.first_name[0]}{customer.last_name[0]}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-[22px] font-bold tracking-[-0.5px] text-[var(--t-text-primary)]">{customer.first_name} {customer.last_name}</h1>
                <span className={`text-xs font-medium capitalize ${customer.type === "commercial" ? "text-purple-400" : "text-blue-400"}`}>{customer.type}</span>
                {activeJobs.length > 0 && <span className="text-xs font-medium text-yellow-500">Active Rental</span>}
                {netBalance > 0 && <span className="text-xs font-medium text-[var(--t-error)]">Balance Due</span>}
                {netBalance < 0 && <span className="text-xs font-medium text-[var(--t-accent)]">Credit</span>}
              </div>
              {customer.company_name && <p className="text-xs text-[var(--t-text-muted)] mt-0.5">{customer.company_name}</p>}
              <div className="flex items-center gap-3 mt-1.5 text-xs text-[var(--t-text-muted)] flex-wrap">
                {customer.account_id && <span>ID: {customer.account_id}</span>}
                <span>Balance: <span className={netBalance > 0 ? "text-[var(--t-error)] font-medium" : "text-[var(--t-accent)]"}>{netBalance < 0 ? `-${fmtMoney(Math.abs(netBalance))} credit` : fmtMoney(netBalance)}</span></span>
                <span className={`inline-flex items-center gap-1 ${customer.is_active ? "text-[var(--t-accent)]" : "text-[var(--t-error)]"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${customer.is_active ? "bg-[var(--t-accent)]" : "bg-[var(--t-error)]"}`} />{customer.is_active ? "Active" : "Inactive"}
                </span>
              </div>
            </div>
          </div>
          {/* Quick Actions */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button onClick={() => openWizard({ customerId: id })} className="flex items-center gap-1.5 rounded-full bg-[var(--t-accent)] px-4 py-2 text-xs font-semibold text-[var(--t-accent-on-accent)] hover:opacity-90 transition-opacity border-none cursor-pointer"><Plus className="h-3.5 w-3.5" /> New Job</button>
            {customer.phone && <a href={`tel:${customer.phone}`} className="flex items-center gap-1.5 rounded-full border border-[var(--t-border)] bg-transparent px-3 py-2 text-xs font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors"><Phone className="h-3.5 w-3.5" /> Call</a>}
            {customer.email && <a href={`mailto:${customer.email}`} className="flex items-center gap-1.5 rounded-full border border-[var(--t-border)] bg-transparent px-3 py-2 text-xs font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors"><Mail className="h-3.5 w-3.5" /> Email</a>}
            <button onClick={() => setEditOpen(true)} className="rounded-full border border-[var(--t-border)] bg-transparent p-2 text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
            <button onClick={handleDelete} className="rounded-full border border-[var(--t-error)]/20 bg-transparent p-2 text-[var(--t-error)] hover:bg-[var(--t-error-soft)] transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </div>

      {/* ===== TABS (promoted to top-level — no Advanced wrapper) ===== */}
      <div className="flex gap-0 border-b border-[var(--t-frame-border)] mb-5 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors shrink-0 ${tab === t.key ? "text-[var(--t-accent)]" : "text-[var(--t-frame-text-muted)] hover:text-[var(--t-frame-text)]"}`}>
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
            {t.key === "jobs" && <span className="text-[9px] text-[var(--t-frame-text-muted)] ml-0.5">{jobs.length}</span>}
            {t.key === "invoices" && <span className="text-[9px] text-[var(--t-frame-text-muted)] ml-0.5">{invoices.length}</span>}
            {t.key === "notes" && notes.length > 0 && <span className="text-[9px] text-[var(--t-frame-text-muted)] ml-0.5">{notes.length}</span>}
            {tab === t.key && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--t-accent)] rounded-full" />}
          </button>
        ))}
      </div>

      {/* ===== OVERVIEW TAB ===== */}
      {tab === "overview" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4">
            {/* Contact */}
            <Card title="Contact">
              <Row label="Phone" value={customer.phone ? <a href={`tel:${customer.phone}`} className="text-[var(--t-text-primary)] hover:text-[var(--t-accent)]">{fmtPhone(customer.phone)}</a> : "—"} />
              <Row label="Email" value={customer.email ? <a href={`mailto:${customer.email}`} className="text-[var(--t-text-primary)] hover:text-[var(--t-accent)]">{customer.email}</a> : "—"} />
              <Row label="Type" value={<span className="capitalize">{customer.type}</span>} />
              {customer.lead_source && <Row label="Source" value={<span className="capitalize">{customer.lead_source}</span>} />}
              <Row label="Since" value={new Date(customer.created_at).toLocaleDateString()} />
            </Card>
            {/* Billing Address */}
            {customer.billing_address?.street && (
              <Card title="Billing Address">
                <p className="text-sm text-[var(--t-text-primary)]">{customer.billing_address.street}</p>
                <p className="text-xs text-[var(--t-text-muted)]">{[customer.billing_address.city, customer.billing_address.state, customer.billing_address.zip].filter(Boolean).join(", ")}</p>
              </Card>
            )}
            {/* Tags */}
            {customer.tags?.length > 0 && (
              <Card title="Tags">
                <div className="flex flex-wrap gap-1.5">{customer.tags.map(t => <span key={t} className="rounded-full border border-[var(--t-border)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--t-text-primary)]">{t}</span>)}</div>
              </Card>
            )}
            {customer.notes && <Card title="Notes"><p className="text-sm text-[var(--t-text-primary)] whitespace-pre-wrap">{customer.notes}</p></Card>}
          </div>

          <div className="lg:col-span-2 space-y-4">
            {/* Location Map */}
            {(() => {
              const mapPins = (customer.service_addresses || [])
                .filter((a: any) => a.lat && a.lng)
                .map((a: any, i: number) => ({
                  id: `svc-${i}`, lat: Number(a.lat), lng: Number(a.lng),
                  type: "customer" as const, label: String(i + 1),
                  popupContent: { title: a.street || "Service Address", subtitle: [a.city, a.state, a.zip].filter(Boolean).join(", ") },
                }));
              return mapPins.length > 0 ? (
                <MapboxMap markers={mapPins} style={{ height: 200, width: "100%" }} interactive={false} showControls={false} />
              ) : null;
            })()}
            {/* Interactive tiles — selecting a tile drives the shared detail panel below */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {(
                [
                  { key: "jobs" as const, label: CUSTOMER_DASHBOARD_LABELS.tile.jobs, value: customer.total_jobs },
                  { key: "revenue" as const, label: CUSTOMER_DASHBOARD_LABELS.tile.revenue, value: fmtMoneyShort(customer.lifetime_revenue) },
                  { key: "avgValue" as const, label: CUSTOMER_DASHBOARD_LABELS.tile.avgValue, value: `$${avgValue}` },
                  { key: "active" as const, label: CUSTOMER_DASHBOARD_LABELS.tile.active, value: activeJobs.length },
                  { key: "lastJob" as const, label: CUSTOMER_DASHBOARD_LABELS.tile.lastJob, value: daysSinceLastJob !== null ? `${daysSinceLastJob}d` : "—" },
                ]
              ).map(s => {
                const isSelected = selectedTile === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setSelectedTile(s.key)}
                    className="rounded-[20px] border p-3 text-center transition-colors cursor-pointer"
                    style={{
                      background: isSelected ? "var(--t-accent-soft, rgba(34,197,94,0.08))" : "var(--t-bg-card)",
                      borderColor: isSelected ? "var(--t-accent)" : "var(--t-border)",
                    }}
                    aria-pressed={isSelected}
                  >
                    <p
                      className="text-base font-bold tabular-nums"
                      style={{ color: isSelected ? "var(--t-accent)" : "var(--t-text-primary)" }}
                    >
                      {s.value}
                    </p>
                    <p className="text-[9px] text-[var(--t-text-muted)]">{s.label}</p>
                  </button>
                );
              })}
            </div>

            {/* Shared detail panel — only the selected tile's content is rendered */}
            {selectedTile && (
              <OverviewTilePanel
                tile={selectedTile}
                jobs={jobs}
                invoices={invoices}
                customer={customer}
              />
            )}
          </div>
        </div>
      )}

      {/* ===== BILLING TAB ===== */}
      {tab === "billing" && (
        <div className="space-y-4 max-w-2xl">
          <div className="grid grid-cols-2 gap-4">
            <Card title="Current Balance"><p className={`text-2xl font-bold tabular-nums ${netBalance > 0 ? "text-[var(--t-error)]" : "text-[var(--t-accent)]"}`}>{netBalance < 0 ? `-${fmtMoney(Math.abs(netBalance))}` : fmtMoney(netBalance)}</p>{totalCredits > 0 && <p className="text-xs mt-1" style={{ color: "var(--t-accent)" }}>{fmtMoney(totalCredits)} credit available</p>}</Card>
            <Card title="Lifetime Revenue"><p className="text-2xl font-bold text-[var(--t-text-primary)] tabular-nums">{fmtMoney(customer.lifetime_revenue)}</p></Card>
          </div>
          <Card title="Payment History">
            {invoices.filter(i => i.status === "paid").length === 0 ? <p className="py-4 text-center text-xs text-[var(--t-text-muted)]">No payments recorded</p> : (
              <div className="divide-y divide-[var(--t-border)] -mx-4">
                {invoices.filter(i => i.status === "paid").map(i => (
                  <div key={i.id} className="flex items-center justify-between px-4 py-2">
                    <div><p className="text-xs font-medium text-[var(--t-text-primary)]">#{i.invoice_number}</p><p className="text-[10px] text-[var(--t-text-muted)]">{new Date(i.created_at).toLocaleDateString()}</p></div>
                    <span className="text-sm font-medium text-[var(--t-accent)] tabular-nums">{fmtMoney(i.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Unpaid Invoices">
            {invoices.filter(i => ["open", "overdue", "draft", "partial"].includes(i.status)).length === 0 ? <p className="py-4 text-center text-xs text-[var(--t-text-muted)]">All paid up</p> : (
              <div className="divide-y divide-[var(--t-border)] -mx-4">
                {invoices.filter(i => ["open", "overdue", "draft", "partial"].includes(i.status)).map(i => (
                  <Link key={i.id} href={`/invoices/${i.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-[var(--t-bg-card-hover)] transition-colors">
                    <div><p className="text-xs font-medium text-[var(--t-text-primary)]">#{i.invoice_number}</p><p className="text-[10px] text-[var(--t-text-muted)]">Due: {i.due_date || "—"}</p></div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-medium ${STATUS_CLS[i.status] || ""}`}>{i.status}</span>
                      <span className="text-sm font-medium text-[var(--t-error)] tabular-nums">{fmtMoney(i.balance_due)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ===== JOBS TAB ===== */}
      {tab === "jobs" && (
        <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] overflow-hidden">
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--t-border)]">
                {["Job #", "Type", "Date", "Asset", "Status", "Price"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {jobs.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-xs text-[var(--t-text-muted)]">No jobs</td></tr> :
                  jobs.map(j => (
                    <tr key={j.id} onClick={() => router.push(`/jobs/${j.id}`)} className="border-b border-[var(--t-border)] last:border-0 cursor-pointer hover:bg-[var(--t-bg-card-hover)] transition-colors">
                      <td className="px-4 py-3 font-medium text-[var(--t-text-primary)]">{j.job_number}</td>
                      <td className="px-4 py-3 text-[var(--t-text-primary)] capitalize">{j.job_type}</td>
                      <td className="px-4 py-3 text-[var(--t-text-primary)]">{j.scheduled_date || "—"}</td>
                      <td className="px-4 py-3 text-[var(--t-text-muted)]">{j.asset?.identifier || "—"}</td>
                      <td className="px-4 py-3"><span className="text-[10px] font-medium" style={{ color: displayStatusColor(deriveDisplayStatus(j.status)) }}>{DISPLAY_STATUS_LABELS[deriveDisplayStatus(j.status)]}</span></td>
                      <td className="px-4 py-3 text-[var(--t-text-primary)] tabular-nums">{j.total_price ? fmtMoneyShort(j.total_price) : "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== QUOTES TAB ===== */}
      {tab === "quotes" && (
        <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] overflow-hidden">
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--t-border)]">
                {["Quote #", "Size", "Amount", "Status", "Date"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {customerQuotes.length === 0 ? <tr><td colSpan={5} className="py-12 text-center text-xs text-[var(--t-text-muted)]">No quotes for this customer</td></tr> :
                  customerQuotes.map(q => (
                    <tr key={q.id} onClick={() => router.push(`/quotes`)} className="border-b border-[var(--t-border)] last:border-0 cursor-pointer hover:bg-[var(--t-bg-card-hover)] transition-colors">
                      <td className="px-4 py-3 font-medium text-[var(--t-accent)]">{q.quote_number}</td>
                      <td className="px-4 py-3 text-[var(--t-text-primary)]">{q.asset_subtype}</td>
                      <td className="px-4 py-3 text-[var(--t-text-primary)] tabular-nums">${Number(q.total_quoted).toFixed(2)}</td>
                      <td className="px-4 py-3"><span className="text-[10px] font-medium capitalize" style={{ color: q.derived_status === "converted" ? "var(--t-success, #22c55e)" : q.derived_status === "expired" ? "var(--t-error)" : "var(--t-accent)" }}>{q.derived_status}</span></td>
                      <td className="px-4 py-3 text-[var(--t-text-muted)]">{new Date(q.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== INVOICES TAB ===== */}
      {tab === "invoices" && (
        <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] overflow-hidden">
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--t-border)]">
                {["Invoice #", "Date", "Due", "Status", "Total", "Balance"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {invoices.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-xs text-[var(--t-text-muted)]">No invoices</td></tr> :
                  invoices.map(i => (
                    <tr key={i.id} onClick={() => router.push(`/invoices/${i.id}`)} className="border-b border-[var(--t-border)] last:border-0 cursor-pointer hover:bg-[var(--t-bg-card-hover)] transition-colors">
                      <td className="px-4 py-3 font-medium text-[var(--t-text-primary)]">#{i.invoice_number}</td>
                      <td className="px-4 py-3 text-[var(--t-text-primary)]">{new Date(i.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-[var(--t-text-primary)]">{i.due_date || "—"}</td>
                      <td className="px-4 py-3"><span className={`text-[10px] font-medium capitalize ${STATUS_CLS[i.status] || ""}`}>{i.status}</span></td>
                      <td className="px-4 py-3 text-[var(--t-text-primary)] tabular-nums">{fmtMoney(i.total)}</td>
                      <td className="px-4 py-3 text-[var(--t-text-primary)] tabular-nums">{fmtMoney(i.balance_due)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== PRICING TAB ===== */}
      {tab === "pricing" && customer && (
        <CustomerPricingTab customerId={customer.id} customerName={`${customer.first_name} ${customer.last_name}`} />
      )}

      {/* ===== NOTES TAB ===== */}
      {tab === "notes" && (
        <div className="max-w-2xl space-y-4">
          {/* Add note */}
          <div className="flex gap-2">
            <input value={newNote} onChange={e => setNewNote(e.target.value)} onKeyDown={e => e.key === "Enter" && addNote()}
              className="flex-1 rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] px-4 py-2.5 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none focus:border-[var(--t-accent)]"
              placeholder="Add a note..." />
            <button onClick={addNote} disabled={addingNote || !newNote.trim()}
              className="rounded-full bg-[var(--t-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--t-accent-on-accent)] hover:opacity-90 disabled:opacity-40 transition-opacity">
              {addingNote ? "..." : "Add"}
            </button>
          </div>
          {/* Notes timeline */}
          {notes.length === 0 ? (
            <div className="py-12 text-center"><MessageSquare className="mx-auto h-8 w-8 text-[var(--t-text-muted)]/20 mb-2" /><p className="text-xs text-[var(--t-text-muted)]">No notes yet</p></div>
          ) : (
            <div className="space-y-2">
              {notes.map(n => (
                <div key={n.id} className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-3">
                  <p className="text-sm text-[var(--t-text-primary)]">{n.content}</p>
                  <div className="flex items-center gap-2 mt-2 text-[10px] text-[var(--t-text-muted)]">
                    <span>{n.author_name || "System"}</span>
                    <span>·</span>
                    <span>{timeAgo(n.created_at)}</span>
                    {n.type === "system" && <span className="text-[8px] text-[var(--t-text-muted)]">AUTO</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== SETTINGS TAB ===== */}
      {tab === "settings" && customer && (
        <div className="max-w-2xl space-y-6">
          <Card title="Client Type">
            <p className="text-sm capitalize" style={{ color: "var(--t-text-primary)" }}>{customer.type}</p>
            <p className="text-xs mt-1" style={{ color: "var(--t-text-muted)" }}>Change via the Edit Customer button above</p>
          </Card>
          <Card title="Terms Template">
            <p className="text-sm" style={{ color: "var(--t-text-muted)" }}>
              Using {customer.type === "commercial" ? "Commercial" : "Residential"} Standard (default)
            </p>
            <Link href="/pricing/terms" className="text-xs text-[var(--t-accent)] hover:underline mt-1 inline-block">
              Manage Templates
            </Link>
          </Card>
          <Card title="Service Addresses">
            {(customer.service_addresses || []).length === 0 ? (
              <p className="text-sm" style={{ color: "var(--t-text-muted)" }}>No service addresses on file</p>
            ) : (
              <div className="space-y-2">
                {customer.service_addresses.map((addr, i) => (
                  <div key={i} className="rounded-[14px] border border-[var(--t-border)] p-3">
                    <p className="text-sm" style={{ color: "var(--t-text-primary)" }}>{addr.street || "—"}</p>
                    <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>{[addr.city, addr.state, addr.zip].filter(Boolean).join(", ")}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Notification Preferences">
            <p className="text-xs mb-3" style={{ color: "var(--t-text-muted)" }}>
              Control which notifications this customer receives
            </p>
            {[
              "Booking Confirmation", "Service Reminder", "On Our Way", "Service Complete",
              "Invoice Sent", "Payment Confirmation", "Overdue Reminder", "Pickup Reminder",
              "Rental Extension", "Failed Trip Notice", "Schedule Change", "Dump Ticket Ready",
            ].map(cat => (
              <div key={cat} className="flex items-center justify-between py-2 border-b border-[var(--t-border)] last:border-0">
                <span className="text-sm" style={{ color: "var(--t-text-primary)" }}>{cat}</span>
                <div className="flex gap-3">
                  <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--t-text-muted)" }}>
                    <input type="checkbox" defaultChecked className="accent-[var(--t-accent)]" /> Email
                  </label>
                  <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--t-text-muted)" }}>
                    <input type="checkbox" defaultChecked className="accent-[var(--t-accent)]" /> SMS
                  </label>
                </div>
              </div>
            ))}
            {/* TODO: Connect to backend notification preferences endpoint when available */}
          </Card>
          {customer.notes && (
            <Card title="Internal Notes">
              <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--t-text-primary)" }}>{customer.notes}</p>
            </Card>
          )}
        </div>
      )}

      {/* Edit */}
      <SlideOver open={editOpen} onClose={() => setEditOpen(false)} title="Edit Customer">
        <EditForm customer={customer} onSuccess={c => { setCustomer(c); setEditOpen(false); toast("success", "Updated"); }} />
      </SlideOver>
    </div>
  );
}

/* ---- Reusable Card ---- */

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-[var(--t-text-muted)] uppercase tracking-wider font-semibold">{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-center justify-between py-1.5 text-sm"><span className="text-[var(--t-text-muted)]">{label}</span><span className="text-[var(--t-text-primary)]">{value}</span></div>;
}

/* ---- Overview Tile Detail Panel ----
 * Shared panel rendered below the Overview tile row. Its content changes
 * based on which tile the user selected. All data comes from the existing
 * customer-page fetches — no new network calls.
 */

function OverviewTilePanel({
  tile,
  jobs,
  invoices,
  customer,
}: {
  tile: OverviewTile;
  jobs: Job[];
  invoices: Invoice[];
  customer: Customer;
}) {
  const L = CUSTOMER_DASHBOARD_LABELS;

  // — Jobs: most-recent-first, up to 10 —
  if (tile === "jobs") {
    const recent = [...jobs].slice(0, 10);
    return (
      <Card title={L.tilePanel.jobs}>
        {recent.length === 0 ? (
          <EmptyRow>{L.tileEmpty.jobs}</EmptyRow>
        ) : (
          <div className="divide-y divide-[var(--t-border)] -mx-4">
            {recent.map((j) => (
              <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-[var(--t-bg-card-hover)] transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-medium text-[var(--t-text-primary)]">{j.job_number}</span>
                  <span className="text-[10px] text-[var(--t-text-muted)] capitalize">{j.job_type}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-[var(--t-text-muted)]">{j.scheduled_date || "—"}</span>
                  <span className={`text-[10px] font-medium ${STATUS_CLS[j.status] || ""}`}>{j.status.replace(/_/g, " ")}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    );
  }

  // — Revenue: paid invoices, sum + list —
  if (tile === "revenue") {
    const paidInvoices = invoices.filter((i) => i.status === "paid");
    const lifetimeRevenue = Number(customer.lifetime_revenue) || 0;
    return (
      <Card title={L.tilePanel.revenue}>
        <div className="mb-3 flex items-baseline justify-between">
          <p className="text-[10px] uppercase tracking-wider text-[var(--t-text-muted)]">
            Lifetime
          </p>
          <p className="text-lg font-bold tabular-nums text-[var(--t-text-primary)]">
            {fmtMoney(lifetimeRevenue)}
          </p>
        </div>
        {paidInvoices.length === 0 ? (
          <EmptyRow>{L.tileEmpty.revenue}</EmptyRow>
        ) : (
          <div className="divide-y divide-[var(--t-border)] -mx-4">
            {paidInvoices.slice(0, 10).map((i) => (
              <Link key={i.id} href={`/invoices/${i.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-[var(--t-bg-card-hover)] transition-colors">
                <div>
                  <p className="text-xs font-medium text-[var(--t-text-primary)]">#{i.invoice_number}</p>
                  <p className="text-[10px] text-[var(--t-text-muted)]">{new Date(i.created_at).toLocaleDateString()}</p>
                </div>
                <span className="text-sm font-medium text-[var(--t-accent)] tabular-nums">{fmtMoney(i.total)}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    );
  }

  // — Avg Value: jobs sorted by total_price descending, highlight average —
  if (tile === "avgValue") {
    const priced = jobs
      .filter((j) => Number(j.total_price) > 0)
      .sort((a, b) => Number(b.total_price) - Number(a.total_price));
    const avg = priced.length > 0
      ? Math.round(priced.reduce((s, j) => s + Number(j.total_price), 0) / priced.length)
      : 0;
    return (
      <Card title={L.tilePanel.avgValue}>
        <div className="mb-3 flex items-baseline justify-between">
          <p className="text-[10px] uppercase tracking-wider text-[var(--t-text-muted)]">
            Average
          </p>
          <p className="text-lg font-bold tabular-nums text-[var(--t-text-primary)]">
            ${avg}
          </p>
        </div>
        {priced.length === 0 ? (
          <EmptyRow>{L.tileEmpty.avgValue}</EmptyRow>
        ) : (
          <div className="divide-y divide-[var(--t-border)] -mx-4">
            {priced.slice(0, 10).map((j) => (
              <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-[var(--t-bg-card-hover)] transition-colors">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[var(--t-text-primary)]">{j.job_number}</span>
                  <span className="text-[10px] text-[var(--t-text-muted)] capitalize">{j.job_type}</span>
                </div>
                <span className="text-xs font-medium tabular-nums text-[var(--t-text-primary)]">{fmtMoneyShort(Number(j.total_price))}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    );
  }

  // — Active: active (non-completed, non-cancelled) jobs only —
  if (tile === "active") {
    const active = jobs.filter((j) => !["completed", "cancelled"].includes(j.status));
    return (
      <Card title={L.tilePanel.active}>
        {active.length === 0 ? (
          <EmptyRow>{L.tileEmpty.active}</EmptyRow>
        ) : (
          <div className="divide-y divide-[var(--t-border)] -mx-4">
            {active.map((j) => (
              <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-[var(--t-bg-card-hover)] transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-medium text-[var(--t-text-primary)]">{j.job_number}</span>
                  {j.asset && <span className="text-[10px] text-[var(--t-text-muted)]">{j.asset.identifier}</span>}
                  <span className="text-[10px] text-[var(--t-text-muted)] capitalize">{j.job_type}</span>
                </div>
                <span className={`text-[10px] font-medium capitalize shrink-0 ${STATUS_CLS[j.status] || ""}`}>
                  {j.status.replace(/_/g, " ")}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    );
  }

  // — Last Job: single card with latest job summary —
  if (tile === "lastJob") {
    const last = jobs[0];
    return (
      <Card title={L.tilePanel.lastJob}>
        {!last ? (
          <EmptyRow>{L.tileEmpty.lastJob}</EmptyRow>
        ) : (
          <Link href={`/jobs/${last.id}`} className="block rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card-hover)] p-3 hover:opacity-90 transition-opacity">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-[var(--t-text-primary)]">{last.job_number}</span>
              <span className={`text-[10px] font-medium capitalize ${STATUS_CLS[last.status] || ""}`}>
                {last.status.replace(/_/g, " ")}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-[var(--t-text-muted)] flex-wrap">
              <span className="capitalize">{last.job_type}</span>
              {last.asset && <span>{last.asset.identifier}</span>}
              {last.scheduled_date && <span>{last.scheduled_date}</span>}
              {Number(last.total_price) > 0 && (
                <span className="text-[var(--t-text-primary)] font-medium tabular-nums">
                  {fmtMoney(Number(last.total_price))}
                </span>
              )}
              <span>· {timeAgo(last.created_at)}</span>
            </div>
          </Link>
        )}
      </Card>
    );
  }

  return null;
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-4 text-center text-xs text-[var(--t-text-muted)]">
      {children}
    </p>
  );
}

/* ---- Edit Form ---- */

function EditForm({ customer, onSuccess }: { customer: Customer; onSuccess: (c: Customer) => void }) {
  const [firstName, setFirstName] = useState(customer.first_name);
  const [lastName, setLastName] = useState(customer.last_name);
  const [email, setEmail] = useState(customer.email || "");
  const [phone, setPhone] = useState(customer.phone || "");
  const [companyName, setCompanyName] = useState(customer.company_name || "");
  const [notes, setNotes] = useState(customer.notes || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const inputCls = "w-full bg-[var(--t-bg-card)] border border-[var(--t-border)] rounded-[20px] px-4 py-3 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]";

  return (
    <form onSubmit={async (e: FormEvent) => {
      e.preventDefault(); setError(""); setSaving(true);
      try { const u = await api.patch<Customer>(`/customers/${customer.id}`, { firstName, lastName, email: email || undefined, phone: phone || undefined, companyName: companyName || undefined, notes: notes || undefined }); onSuccess(u); }
      catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
      finally { setSaving(false); }
    }} className="space-y-4">
      {error && <div className="rounded-[20px] bg-[var(--t-error-soft)] px-4 py-3 text-sm text-[var(--t-error)]">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <input value={firstName} onChange={e => setFirstName(e.target.value)} required className={inputCls} placeholder="First" />
        <input value={lastName} onChange={e => setLastName(e.target.value)} required className={inputCls} placeholder="Last" />
      </div>
      <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} placeholder="Phone" />
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="Email" />
      <input value={companyName} onChange={e => setCompanyName(e.target.value)} className={inputCls} placeholder="Company" />
      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={`${inputCls} resize-none`} placeholder="Notes" />
      <button type="submit" disabled={saving} className="w-full rounded-full bg-[var(--t-accent)] py-3 text-sm font-bold text-[var(--t-accent-on-accent)] hover:opacity-90 disabled:opacity-50 transition-opacity">
        {saving ? "Saving..." : "Save"}
      </button>
    </form>
  );
}

/* ---- Customer Pricing Tab ---- */

interface PricingOverride {
  id: string;
  pricing_rule_id: string;
  base_price: number | null;
  weight_allowance_tons: number | null;
  overage_per_ton: number | null;
  daily_overage_rate: number | null;
  rental_days: number | null;
  effective_from: string;
  effective_to: string | null;
  pricing_rule?: { id: string; name: string; asset_subtype: string; base_price: number; included_tons: number; overage_per_ton: number; extra_day_rate: number; rental_period_days: number };
}

interface SurchargeOverride {
  id: string;
  surcharge_template_id: string;
  amount: number;
  available_for_billing: boolean;
  surcharge_template?: { id: string; name: string; default_amount: number };
}

interface PricingRuleLite {
  id: string;
  name: string;
  asset_subtype: string;
  base_price: number;
  included_tons: number;
  overage_per_ton: number;
  extra_day_rate: number;
  rental_period_days: number;
  is_active: boolean;
}

function CustomerPricingTab({ customerId }: { customerId: string; customerName: string }) {
  const L = CUSTOMER_DASHBOARD_LABELS.pricing;
  const [rules, setRules] = useState<PricingRuleLite[]>([]);
  const [overrides, setOverrides] = useState<PricingOverride[]>([]);
  const [surcharges, setSurcharges] = useState<SurchargeOverride[]>([]);
  const [allTemplates, setAllTemplates] = useState<Array<{ id: string; name: string; default_amount: number }>>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchData = async () => {
    setLoading(true);
    try {
      const [rulesRes, ov, sc, tpl] = await Promise.all([
        api.get<{ data: PricingRuleLite[] } | PricingRuleLite[]>("/pricing"),
        api.get<PricingOverride[]>(`/customers/${customerId}/pricing-overrides`),
        api.get<SurchargeOverride[]>(`/customers/${customerId}/surcharge-overrides`),
        api.get<Array<{ id: string; name: string; default_amount: number }>>("/surcharge-templates"),
      ]);
      const ruleList: PricingRuleLite[] = Array.isArray(rulesRes)
        ? rulesRes
        : Array.isArray((rulesRes as any)?.data)
          ? (rulesRes as any).data
          : [];
      setRules(ruleList.filter((r) => r.is_active !== false));
      setOverrides(Array.isArray(ov) ? ov : []);
      setSurcharges(Array.isArray(sc) ? sc : []);
      setAllTemplates(Array.isArray(tpl) ? tpl : []);
    } catch { /* */ } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [customerId]);

  if (loading) {
    return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-[20px]" style={{ background: "var(--t-bg-card)" }} />)}</div>;
  }

  const overridesByRuleId = new Map(overrides.map((o) => [o.pricing_rule_id, o]));
  const overridesActiveCount = overrides.filter((o) => o.base_price != null).length;

  return (
    <div className="space-y-8 max-w-3xl">
      {/* ── Section 1: Custom Pricing ── */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
              {L.sections.customPricing}
            </h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--t-text-muted)" }}>
              {L.sections.customPricingDescription}
            </p>
          </div>
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold shrink-0"
            style={{
              background: overridesActiveCount > 0
                ? "var(--t-accent-soft, rgba(34,197,94,0.12))"
                : "var(--t-bg-card-hover)",
              color: overridesActiveCount > 0 ? "var(--t-accent)" : "var(--t-text-muted)",
            }}
          >
            {overridesActiveCount > 0
              ? `${L.status.customActive} · ${overridesActiveCount}`
              : L.status.usingGlobal}
          </span>
        </div>

        {rules.length === 0 ? (
          <div className="rounded-[20px] border p-6 text-center" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
            <p className="text-sm" style={{ color: "var(--t-text-muted)" }}>{L.empty.noRules}</p>
            <p className="text-xs mt-1" style={{ color: "var(--t-text-muted)" }}>{L.empty.noRulesHint}</p>
          </div>
        ) : (
          <div className="rounded-[20px] border overflow-hidden" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
            {rules.map((rule, idx) => (
              <PricingOverrideRow
                key={rule.id}
                customerId={customerId}
                rule={rule}
                override={overridesByRuleId.get(rule.id) ?? null}
                isLast={idx === rules.length - 1}
                onChanged={fetchData}
                onToast={toast}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Section 2: Surcharge Amounts ── */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
              {L.sections.surcharges}
            </h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--t-text-muted)" }}>
              {L.sections.surchargesDescription}
            </p>
          </div>
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold shrink-0"
            style={{
              background: surcharges.length > 0
                ? "var(--t-accent-soft, rgba(34,197,94,0.12))"
                : "var(--t-bg-card-hover)",
              color: surcharges.length > 0 ? "var(--t-accent)" : "var(--t-text-muted)",
            }}
          >
            {surcharges.length > 0
              ? `${L.status.customSurchargesActive} · ${surcharges.length}`
              : L.status.usingGlobalSurcharges}
          </span>
        </div>

        {allTemplates.length === 0 ? (
          <div className="rounded-[20px] border p-6 text-center" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
            <p className="text-sm" style={{ color: "var(--t-text-muted)" }}>{L.empty.noSurcharges}</p>
          </div>
        ) : (
          <div className="rounded-[20px] border overflow-hidden" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
            {allTemplates.map((tpl, idx) => (
              <SurchargeOverrideRow
                key={tpl.id}
                customerId={customerId}
                template={tpl}
                override={surcharges.find((s) => s.surcharge_template_id === tpl.id) ?? null}
                isLast={idx === allTemplates.length - 1}
                onChanged={fetchData}
                onToast={toast}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Single editable row for a pricing rule → customer override. */
function PricingOverrideRow({
  customerId,
  rule,
  override,
  isLast,
  onChanged,
  onToast,
}: {
  customerId: string;
  rule: PricingRuleLite;
  override: PricingOverride | null;
  isLast: boolean;
  onChanged: () => void;
  onToast: (variant: "success" | "error" | "warning", msg: string) => void;
}) {
  const L = CUSTOMER_DASHBOARD_LABELS.pricing;
  const [input, setInput] = useState<string>(
    override?.base_price != null ? String(override.base_price) : "",
  );
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Keep input in sync if parent refetches
  useEffect(() => {
    setInput(override?.base_price != null ? String(override.base_price) : "");
  }, [override?.base_price]);

  const globalBase = Number(rule.base_price);
  const parsed = input.trim() === "" ? null : Number(input);
  const isValid = parsed !== null && !isNaN(parsed) && parsed > 0;
  const currentOverride = override?.base_price != null ? Number(override.base_price) : null;
  const isDirty = isValid && parsed !== currentOverride;
  const effective = currentOverride ?? globalBase;

  const handleSave = async () => {
    if (!isValid || !isDirty) return;
    setSaving(true);
    try {
      if (override) {
        await api.put(`/customers/${customerId}/pricing-overrides/${override.id}`, {
          base_price: parsed,
        });
      } else {
        await api.post(`/customers/${customerId}/pricing-overrides`, {
          customer_id: customerId,
          pricing_rule_id: rule.id,
          base_price: parsed,
        });
      }
      onToast("success", L.toast.saved);
      onChanged();
    } catch {
      onToast("error", L.toast.failed);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!override) return;
    setClearing(true);
    try {
      await api.delete(`/customers/${customerId}/pricing-overrides/${override.id}`);
      onToast("success", L.toast.cleared);
      onChanged();
    } catch {
      onToast("error", L.toast.failed);
    } finally {
      setClearing(false);
    }
  };

  const hasOverride = currentOverride != null;

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 flex-wrap"
      style={{ borderBottom: isLast ? "none" : "1px solid var(--t-border)" }}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>
          {rule.asset_subtype}
        </p>
        <p className="text-[10px]" style={{ color: "var(--t-text-muted)" }}>
          {L.fields.global}: {formatCurrency(globalBase)}
          {" · "}
          {L.fields.effective}:{" "}
          <span style={{ color: hasOverride ? "var(--t-accent)" : "var(--t-text-muted)", fontWeight: hasOverride ? 600 : 400 }}>
            {formatCurrency(effective)}
          </span>
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="relative">
          <span
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs pointer-events-none"
            style={{ color: "var(--t-text-muted)" }}
          >
            $
          </span>
          <input
            type="number"
            inputMode="decimal"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={L.fields.overridePlaceholder}
            className="w-28 rounded-full border bg-[var(--t-bg-card-hover)] pl-5 pr-2.5 py-1.5 text-xs text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] transition-colors tabular-nums"
            style={{ borderColor: "var(--t-border)" }}
          />
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || !isValid || saving}
          className="rounded-full px-3 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-40"
          style={{
            background: "var(--t-accent)",
            color: "var(--t-accent-on-accent)",
            cursor: !isDirty || !isValid ? "not-allowed" : "pointer",
          }}
        >
          {saving ? L.actions.saving : L.actions.save}
        </button>
        {hasOverride && (
          <button
            type="button"
            onClick={handleClear}
            disabled={clearing}
            className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40"
            style={{
              borderColor: "var(--t-border)",
              color: "var(--t-text-muted)",
            }}
          >
            {clearing ? "…" : L.actions.clear}
          </button>
        )}
      </div>
    </div>
  );
}

/** Single editable row for a surcharge template → customer override. */
function SurchargeOverrideRow({
  customerId,
  template,
  override,
  isLast,
  onChanged,
  onToast,
}: {
  customerId: string;
  template: { id: string; name: string; default_amount: number };
  override: SurchargeOverride | null;
  isLast: boolean;
  onChanged: () => void;
  onToast: (variant: "success" | "error" | "warning", msg: string) => void;
}) {
  const L = CUSTOMER_DASHBOARD_LABELS.pricing;
  const [input, setInput] = useState<string>(
    override?.amount != null ? String(override.amount) : "",
  );
  const [active, setActive] = useState<boolean>(override?.available_for_billing ?? true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    setInput(override?.amount != null ? String(override.amount) : "");
    setActive(override?.available_for_billing ?? true);
  }, [override?.amount, override?.available_for_billing]);

  const defaultAmount = Number(template.default_amount);
  const parsed = input.trim() === "" ? null : Number(input);
  const isValid = parsed !== null && !isNaN(parsed) && parsed >= 0;
  const currentAmount = override?.amount != null ? Number(override.amount) : null;
  const currentActive = override?.available_for_billing ?? true;
  const isDirty =
    (isValid && parsed !== currentAmount) ||
    (override != null && active !== currentActive);

  const effective = override && currentActive ? currentAmount! : defaultAmount;
  const hasOverride = override != null;

  const handleSave = async () => {
    if (!isValid || !isDirty) return;
    setSaving(true);
    try {
      if (override) {
        await api.put(`/customers/${customerId}/surcharge-overrides/${override.id}`, {
          amount: parsed,
          available_for_billing: active,
        });
      } else {
        await api.post(`/customers/${customerId}/surcharge-overrides`, {
          customer_id: customerId,
          surcharge_template_id: template.id,
          amount: parsed,
          available_for_billing: active,
        });
      }
      onToast("success", L.toast.saved);
      onChanged();
    } catch {
      onToast("error", L.toast.failed);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!override) return;
    setClearing(true);
    try {
      await api.delete(`/customers/${customerId}/surcharge-overrides/${override.id}`);
      onToast("success", L.toast.cleared);
      onChanged();
    } catch {
      onToast("error", L.toast.failed);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 flex-wrap"
      style={{ borderBottom: isLast ? "none" : "1px solid var(--t-border)" }}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>
          {template.name}
        </p>
        <p className="text-[10px]" style={{ color: "var(--t-text-muted)" }}>
          {L.fields.default}: {formatCurrency(defaultAmount)}
          {" · "}
          {L.fields.effective}:{" "}
          <span
            style={{
              color: hasOverride && currentActive ? "var(--t-accent)" : "var(--t-text-muted)",
              fontWeight: hasOverride && currentActive ? 600 : 400,
            }}
          >
            {formatCurrency(effective)}
          </span>
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="relative">
          <span
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs pointer-events-none"
            style={{ color: "var(--t-text-muted)" }}
          >
            $
          </span>
          <input
            type="number"
            inputMode="decimal"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={L.fields.overridePlaceholder}
            className="w-24 rounded-full border bg-[var(--t-bg-card-hover)] pl-5 pr-2.5 py-1.5 text-xs text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] transition-colors tabular-nums"
            style={{ borderColor: "var(--t-border)" }}
          />
        </div>

        {/* Active toggle — only meaningful once an override exists */}
        <label
          className={`inline-flex items-center gap-1.5 ${hasOverride ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
        >
          <button
            type="button"
            onClick={() => hasOverride && setActive((v) => !v)}
            disabled={!hasOverride}
            className={`relative h-5 w-9 rounded-full transition-colors ${
              active ? "bg-[var(--t-accent)]" : "bg-[var(--t-bg-card-hover)]"
            }`}
            style={{ border: "1px solid var(--t-border)" }}
          >
            <span
              className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                active ? "left-[18px]" : "left-0.5"
              }`}
            />
          </button>
          <span className="text-[10px]" style={{ color: "var(--t-text-muted)" }}>
            {L.fields.active}
          </span>
        </label>

        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || !isValid || saving}
          className="rounded-full px-3 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-40"
          style={{
            background: "var(--t-accent)",
            color: "var(--t-accent-on-accent)",
            cursor: !isDirty || !isValid ? "not-allowed" : "pointer",
          }}
        >
          {saving ? L.actions.saving : L.actions.save}
        </button>
        {hasOverride && (
          <button
            type="button"
            onClick={handleClear}
            disabled={clearing}
            className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40"
            style={{
              borderColor: "var(--t-border)",
              color: "var(--t-text-muted)",
            }}
          >
            {clearing ? "…" : L.actions.clear}
          </button>
        )}
      </div>
    </div>
  );
}
