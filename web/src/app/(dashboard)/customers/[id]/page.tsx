"use client";

import { useState, useEffect, use, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Mail, Phone, MapPin, Building, Calendar, Pencil, Trash2,
  Briefcase, FileText, DollarSign, Clock, Plus, MessageSquare,
  CreditCard, Send, Tag, Settings, User,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import SlideOver from "@/components/slide-over";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";

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
  id: string; invoice_number: string; status: string; total: number;
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
  { key: "invoices", label: "Invoices", icon: FileText },
  { key: "pricing", label: "Pricing", icon: DollarSign },
  { key: "notes", label: "Notes", icon: MessageSquare },
] as const;

type Tab = typeof TABS[number]["key"];

/* ---- Page ---- */

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");
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
      } catch { /* */ }
      finally { setLoading(false); }
    }
    load();
  }, [id]);

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
  const avgValue = customer.total_jobs > 0 ? Math.round(Number(customer.lifetime_revenue) / customer.total_jobs) : 0;
  const lastJob = jobs[0];
  const daysSinceLastJob = lastJob ? Math.floor((Date.now() - new Date(lastJob.scheduled_date || lastJob.created_at).getTime()) / 86400000) : null;

  return (
    <div>
      {/* Back */}
      <Link href="/customers" className="inline-flex items-center gap-1.5 text-xs text-[var(--t-frame-text-muted)] hover:text-[var(--t-frame-text)] transition-colors mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> Customers
      </Link>

      {/* ===== HEADER ===== */}
      <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5 mb-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] text-lg font-bold ${customer.type === "commercial" ? "bg-purple-500/15 text-purple-400" : "bg-blue-500/15 text-blue-400"}`}>
              {customer.first_name[0]}{customer.last_name[0]}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-text-primary)]">{customer.first_name} {customer.last_name}</h1>
                <span className={`text-xs font-medium capitalize ${customer.type === "commercial" ? "text-purple-400" : "text-blue-400"}`}>{customer.type}</span>
                {activeJobs.length > 0 && <span className="text-xs font-medium text-yellow-500">Active Rental</span>}
                {unpaidBalance > 0 && <span className="text-xs font-medium text-[var(--t-error)]">Balance Due</span>}
              </div>
              {customer.company_name && <p className="text-xs text-[var(--t-text-muted)] mt-0.5">{customer.company_name}</p>}
              <div className="flex items-center gap-3 mt-1.5 text-xs text-[var(--t-text-muted)] flex-wrap">
                {customer.account_id && <span>ID: {customer.account_id}</span>}
                <span>Balance: <span className={unpaidBalance > 0 ? "text-[var(--t-error)] font-medium" : "text-[var(--t-accent)]"}>{fmtMoney(unpaidBalance)}</span></span>
                <span className={`inline-flex items-center gap-1 ${customer.is_active ? "text-[var(--t-accent)]" : "text-[var(--t-error)]"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${customer.is_active ? "bg-[var(--t-accent)]" : "bg-[var(--t-error)]"}`} />{customer.is_active ? "Active" : "Inactive"}
                </span>
              </div>
            </div>
          </div>
          {/* Quick Actions */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <Link href="/book" className="flex items-center gap-1.5 rounded-full bg-[var(--t-accent)] px-4 py-2 text-xs font-semibold text-black hover:opacity-90 transition-opacity"><Plus className="h-3.5 w-3.5" /> New Job</Link>
            {customer.phone && <a href={`tel:${customer.phone}`} className="flex items-center gap-1.5 rounded-full border border-[var(--t-border)] bg-transparent px-3 py-2 text-xs font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors"><Phone className="h-3.5 w-3.5" /> Call</a>}
            {customer.email && <a href={`mailto:${customer.email}`} className="flex items-center gap-1.5 rounded-full border border-[var(--t-border)] bg-transparent px-3 py-2 text-xs font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors"><Mail className="h-3.5 w-3.5" /> Email</a>}
            <button onClick={() => setEditOpen(true)} className="rounded-full border border-[var(--t-border)] bg-transparent p-2 text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
            <button onClick={handleDelete} className="rounded-full border border-[var(--t-error)]/20 bg-transparent p-2 text-[var(--t-error)] hover:bg-[var(--t-error-soft)] transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </div>

      {/* ===== TABS ===== */}
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
            {/* Quick Stats */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                { label: "Jobs", value: customer.total_jobs },
                { label: "Revenue", value: fmtMoneyShort(customer.lifetime_revenue) },
                { label: "Avg Value", value: `$${avgValue}` },
                { label: "Active", value: activeJobs.length },
                { label: "Last Job", value: daysSinceLastJob !== null ? `${daysSinceLastJob}d` : "—" },
              ].map(s => (
                <div key={s.label} className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-3 text-center">
                  <p className="text-base font-bold text-[var(--t-text-primary)] tabular-nums">{s.value}</p>
                  <p className="text-[9px] text-[var(--t-text-muted)]">{s.label}</p>
                </div>
              ))}
            </div>
            {/* Active Rentals */}
            {activeJobs.length > 0 && (
              <div className="rounded-[20px] border border-[var(--t-border)] p-4">
                <p className="text-xs text-yellow-500 uppercase tracking-wider font-semibold mb-2">Active Rentals ({activeJobs.length})</p>
                <div className="space-y-1.5">
                  {activeJobs.map(j => (
                    <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center justify-between rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] px-3 py-2 hover:bg-[var(--t-bg-card-hover)] transition-colors">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-[var(--t-text-primary)]">{j.job_number}</span>
                        {j.asset && <span className="text-[10px] text-[var(--t-text-muted)]">{j.asset.identifier}</span>}
                      </div>
                      <span className={`text-[10px] font-medium capitalize ${STATUS_CLS[j.status] || ""}`}>{j.status.replace(/_/g, " ")}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {/* Recent Jobs */}
            <Card title="Recent Jobs" action={<button onClick={() => setTab("jobs")} className="text-[10px] text-[var(--t-accent)]">View all</button>}>
              {jobs.length === 0 ? <p className="py-4 text-center text-xs text-[var(--t-text-muted)]">No jobs</p> : (
                <div className="divide-y divide-[var(--t-border)] -mx-4">
                  {jobs.slice(0, 5).map(j => (
                    <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-[var(--t-bg-card-hover)] transition-colors">
                      <span className="text-xs font-medium text-[var(--t-text-primary)]">{j.job_number}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-[var(--t-text-muted)]">{j.scheduled_date || "—"}</span>
                        <span className={`text-[10px] font-medium ${STATUS_CLS[j.status] || ""}`}>{j.status.replace(/_/g, " ")}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* ===== BILLING TAB ===== */}
      {tab === "billing" && (
        <div className="space-y-4 max-w-2xl">
          <div className="grid grid-cols-2 gap-4">
            <Card title="Current Balance"><p className={`text-2xl font-bold tabular-nums ${unpaidBalance > 0 ? "text-[var(--t-error)]" : "text-[var(--t-accent)]"}`}>{fmtMoney(unpaidBalance)}</p></Card>
            <Card title="Lifetime Revenue"><p className="text-2xl font-bold text-[var(--t-text-primary)] tabular-nums">{fmtMoney(customer.lifetime_revenue)}</p></Card>
          </div>
          <Card title="Payment History">
            {invoices.filter(i => i.status === "paid").length === 0 ? <p className="py-4 text-center text-xs text-[var(--t-text-muted)]">No payments recorded</p> : (
              <div className="divide-y divide-[var(--t-border)] -mx-4">
                {invoices.filter(i => i.status === "paid").map(i => (
                  <div key={i.id} className="flex items-center justify-between px-4 py-2">
                    <div><p className="text-xs font-medium text-[var(--t-text-primary)]">{i.invoice_number}</p><p className="text-[10px] text-[var(--t-text-muted)]">{new Date(i.created_at).toLocaleDateString()}</p></div>
                    <span className="text-sm font-medium text-[var(--t-accent)] tabular-nums">{fmtMoney(i.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Unpaid Invoices">
            {invoices.filter(i => ["sent", "overdue", "draft"].includes(i.status)).length === 0 ? <p className="py-4 text-center text-xs text-[var(--t-text-muted)]">All paid up</p> : (
              <div className="divide-y divide-[var(--t-border)] -mx-4">
                {invoices.filter(i => ["sent", "overdue", "draft"].includes(i.status)).map(i => (
                  <Link key={i.id} href={`/invoices/${i.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-[var(--t-bg-card-hover)] transition-colors">
                    <div><p className="text-xs font-medium text-[var(--t-text-primary)]">{i.invoice_number}</p><p className="text-[10px] text-[var(--t-text-muted)]">Due: {i.due_date || "—"}</p></div>
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
                      <td className="px-4 py-3"><span className={`text-[10px] font-medium capitalize ${STATUS_CLS[j.status] || ""}`}>{j.status.replace(/_/g, " ")}</span></td>
                      <td className="px-4 py-3 text-[var(--t-text-primary)] tabular-nums">{j.total_price ? fmtMoneyShort(j.total_price) : "—"}</td>
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
                      <td className="px-4 py-3 font-medium text-[var(--t-text-primary)]">{i.invoice_number}</td>
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
              className="rounded-full bg-[var(--t-accent)] px-4 py-2.5 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-40 transition-opacity">
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
      <button type="submit" disabled={saving} className="w-full rounded-full bg-[var(--t-accent)] py-3 text-sm font-bold text-black hover:opacity-90 disabled:opacity-50 transition-opacity">
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

function CustomerPricingTab({ customerId, customerName }: { customerId: string; customerName: string }) {
  const [overrides, setOverrides] = useState<PricingOverride[]>([]);
  const [surcharges, setSurcharges] = useState<SurchargeOverride[]>([]);
  const [allTemplates, setAllTemplates] = useState<Array<{ id: string; name: string; default_amount: number }>>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchData = async () => {
    setLoading(true);
    try {
      const [ov, sc, tpl] = await Promise.all([
        api.get<PricingOverride[]>(`/customers/${customerId}/pricing-overrides`),
        api.get<SurchargeOverride[]>(`/customers/${customerId}/surcharge-overrides`),
        api.get<Array<{ id: string; name: string; default_amount: number }>>("/surcharge-templates"),
      ]);
      setOverrides(Array.isArray(ov) ? ov : []);
      setSurcharges(Array.isArray(sc) ? sc : []);
      setAllTemplates(Array.isArray(tpl) ? tpl : []);
    } catch { /* */ } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [customerId]);

  const fmt = (n: number | null | undefined) => n != null ? formatCurrency(n) : null;

  if (loading) {
    return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-[20px]" style={{ background: "var(--t-bg-card)" }} />)}</div>;
  }

  return (
    <div className="space-y-8 max-w-3xl">
      {/* Pricing Overrides */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>Custom Pricing</h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--t-text-muted)" }}>Override global pricing rules for {customerName}</p>
          </div>
        </div>
        {overrides.length === 0 ? (
          <div className="rounded-[20px] border p-6 text-center" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
            <p className="text-sm" style={{ color: "var(--t-text-muted)" }}>Using global pricing — no custom overrides</p>
          </div>
        ) : (
          <div className="space-y-3">
            {overrides.map(o => {
              const rule = o.pricing_rule;
              return (
                <div key={o.id} className="rounded-[20px] border p-4" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
                      {rule?.asset_subtype || "Custom"} Dumpster
                    </h4>
                    <button onClick={async () => { await api.delete(`/customers/${customerId}/pricing-overrides/${o.id}`); toast("success", "Override removed"); fetchData(); }}
                      className="text-xs text-[var(--t-error)] hover:underline">Remove</button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                    {[
                      { label: "Base Price", val: o.base_price, global: rule?.base_price },
                      { label: "Weight Allow.", val: o.weight_allowance_tons, global: rule?.included_tons, suffix: " tons" },
                      { label: "Overage/Ton", val: o.overage_per_ton, global: rule?.overage_per_ton },
                      { label: "Daily Rate", val: o.daily_overage_rate, global: rule?.extra_day_rate },
                      { label: "Rental Days", val: o.rental_days, global: rule?.rental_period_days, suffix: " days" },
                    ].map(f => (
                      <div key={f.label}>
                        <p className="font-medium mb-0.5" style={{ color: "var(--t-text-muted)" }}>{f.label}</p>
                        {f.val != null ? (
                          <p className="font-semibold" style={{ color: "var(--t-accent)" }}>
                            {f.suffix ? `${f.val}${f.suffix}` : fmt(f.val)}
                          </p>
                        ) : (
                          <p style={{ color: "var(--t-text-muted)" }}>
                            {f.global != null ? (f.suffix ? `${f.global}${f.suffix}` : fmt(f.global)) : "—"} <span className="text-[10px]">(global)</span>
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Surcharge Overrides */}
      <div>
        <div className="mb-4">
          <h3 className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>Surcharge Amounts</h3>
          <p className="text-xs mt-0.5" style={{ color: "var(--t-text-muted)" }}>Override default surcharge amounts for this customer</p>
        </div>
        <div className="rounded-[20px] border overflow-hidden" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--t-border)]">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" style={{ color: "var(--t-text-muted)" }}>Surcharge</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider" style={{ color: "var(--t-text-muted)" }}>Default</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider" style={{ color: "var(--t-text-muted)" }}>Client Rate</th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider" style={{ color: "var(--t-text-muted)" }}>Active</th>
              </tr>
            </thead>
            <tbody>
              {allTemplates.map(tpl => {
                const override = surcharges.find(s => s.surcharge_template_id === tpl.id);
                return (
                  <tr key={tpl.id} className="border-b border-[var(--t-border)] last:border-0">
                    <td className="px-4 py-3" style={{ color: "var(--t-text-primary)" }}>{tpl.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: "var(--t-text-muted)" }}>{formatCurrency(tpl.default_amount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium" style={{ color: override ? "var(--t-accent)" : "var(--t-text-muted)" }}>
                      {override ? formatCurrency(Number(override.amount)) : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {override ? (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{
                          background: override.available_for_billing ? "var(--t-accent-soft)" : "var(--t-bg-elevated)",
                          color: override.available_for_billing ? "var(--t-accent)" : "var(--t-text-muted)",
                        }}>
                          {override.available_for_billing ? "Yes" : "No"}
                        </span>
                      ) : (
                        <span className="text-xs" style={{ color: "var(--t-text-muted)" }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
