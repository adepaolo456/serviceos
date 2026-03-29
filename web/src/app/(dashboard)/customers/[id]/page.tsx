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

function fmtPhone(p: string | null): string {
  if (!p) return "";
  const d = p.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return p;
}

function fmtMoney(n: number): string { return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtMoneyShort(n: number): string { return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`; }

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
  pending: "bg-yellow-500/10 text-yellow-400", confirmed: "bg-blue-500/10 text-blue-400",
  dispatched: "bg-purple-500/10 text-purple-400", en_route: "bg-orange-500/10 text-orange-400",
  in_progress: "bg-brand/10 text-brand", completed: "bg-emerald-500/10 text-emerald-400",
  cancelled: "bg-red-500/10 text-red-400", draft: "bg-zinc-500/10 text-zinc-400",
  sent: "bg-blue-500/10 text-blue-400", paid: "bg-brand/10 text-brand",
  overdue: "bg-red-500/10 text-red-400", void: "bg-zinc-500/10 text-zinc-400",
};

const TABS = [
  { key: "overview", label: "Overview", icon: User },
  { key: "billing", label: "Billing", icon: CreditCard },
  { key: "jobs", label: "Jobs", icon: Briefcase },
  { key: "invoices", label: "Invoices", icon: FileText },
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
    return <div className="space-y-4"><div className="h-8 w-48 skeleton rounded" /><div className="h-40 skeleton rounded-2xl" /><div className="h-64 skeleton rounded-2xl" /></div>;
  }
  if (!customer) return <div className="py-20 text-center text-muted">Not found</div>;

  const activeJobs = jobs.filter(j => !["completed", "cancelled"].includes(j.status));
  const unpaidBalance = invoices.reduce((s, i) => s + Number(i.balance_due), 0);
  const avgValue = customer.total_jobs > 0 ? Math.round(Number(customer.lifetime_revenue) / customer.total_jobs) : 0;
  const lastJob = jobs[0];
  const daysSinceLastJob = lastJob ? Math.floor((Date.now() - new Date(lastJob.scheduled_date || lastJob.created_at).getTime()) / 86400000) : null;

  return (
    <div>
      {/* Back */}
      <Link href="/customers" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> Customers
      </Link>

      {/* ===== HEADER ===== */}
      <div className="rounded-2xl bg-dark-card border border-[#1E2D45] p-5 mb-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold ${customer.type === "commercial" ? "bg-purple-500/15 text-purple-400" : "bg-blue-500/15 text-blue-400"}`}>
              {customer.first_name[0]}{customer.last_name[0]}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-display text-xl font-bold text-white">{customer.first_name} {customer.last_name}</h1>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${customer.type === "commercial" ? "bg-purple-500/10 text-purple-400" : "bg-blue-500/10 text-blue-400"}`}>{customer.type}</span>
                {activeJobs.length > 0 && <span className="rounded-full bg-yellow-500/10 px-2 py-0.5 text-[10px] font-medium text-yellow-400">Active Rental</span>}
                {unpaidBalance > 0 && <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-400">Balance Due</span>}
              </div>
              {customer.company_name && <p className="text-xs text-muted mt-0.5">{customer.company_name}</p>}
              <div className="flex items-center gap-3 mt-1.5 text-xs text-muted flex-wrap">
                {customer.account_id && <span>ID: {customer.account_id}</span>}
                <span>Balance: <span className={unpaidBalance > 0 ? "text-red-400 font-medium" : "text-brand"}>{fmtMoney(unpaidBalance)}</span></span>
                <span className={`inline-flex items-center gap-1 ${customer.is_active ? "text-brand" : "text-red-400"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${customer.is_active ? "bg-brand" : "bg-red-500"}`} />{customer.is_active ? "Active" : "Inactive"}
                </span>
              </div>
            </div>
          </div>
          {/* Quick Actions */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <Link href="/book" className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand-light btn-press"><Plus className="h-3.5 w-3.5" /> New Job</Link>
            {customer.phone && <a href={`tel:${customer.phone}`} className="flex items-center gap-1.5 rounded-lg bg-dark-elevated px-3 py-2 text-xs font-medium text-foreground hover:bg-dark-card-hover btn-press"><Phone className="h-3.5 w-3.5" /> Call</a>}
            {customer.email && <a href={`mailto:${customer.email}`} className="flex items-center gap-1.5 rounded-lg bg-dark-elevated px-3 py-2 text-xs font-medium text-foreground hover:bg-dark-card-hover btn-press"><Mail className="h-3.5 w-3.5" /> Email</a>}
            <button onClick={() => setEditOpen(true)} className="rounded-lg bg-dark-elevated p-2 text-muted hover:text-foreground hover:bg-dark-card-hover btn-press"><Pencil className="h-3.5 w-3.5" /></button>
            <button onClick={handleDelete} className="rounded-lg bg-red-500/10 p-2 text-red-400 hover:bg-red-500/20 btn-press"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </div>

      {/* ===== TABS ===== */}
      <div className="flex gap-0 border-b border-[#1E2D45] mb-5 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors shrink-0 btn-press ${tab === t.key ? "text-brand" : "text-muted hover:text-foreground"}`}>
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
            {t.key === "jobs" && <span className="text-[9px] text-muted ml-0.5">{jobs.length}</span>}
            {t.key === "invoices" && <span className="text-[9px] text-muted ml-0.5">{invoices.length}</span>}
            {t.key === "notes" && notes.length > 0 && <span className="text-[9px] text-muted ml-0.5">{notes.length}</span>}
            {tab === t.key && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brand rounded-full" />}
          </button>
        ))}
      </div>

      {/* ===== OVERVIEW TAB ===== */}
      {tab === "overview" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4">
            {/* Contact */}
            <Card title="Contact">
              <Row label="Phone" value={customer.phone ? <a href={`tel:${customer.phone}`} className="text-foreground hover:text-brand">{fmtPhone(customer.phone)}</a> : "—"} />
              <Row label="Email" value={customer.email ? <a href={`mailto:${customer.email}`} className="text-foreground hover:text-brand">{customer.email}</a> : "—"} />
              <Row label="Type" value={<span className="capitalize">{customer.type}</span>} />
              {customer.lead_source && <Row label="Source" value={<span className="capitalize">{customer.lead_source}</span>} />}
              <Row label="Since" value={new Date(customer.created_at).toLocaleDateString()} />
            </Card>
            {/* Billing Address */}
            {customer.billing_address?.street && (
              <Card title="Billing Address">
                <p className="text-sm text-foreground">{customer.billing_address.street}</p>
                <p className="text-xs text-muted">{[customer.billing_address.city, customer.billing_address.state, customer.billing_address.zip].filter(Boolean).join(", ")}</p>
              </Card>
            )}
            {/* Tags */}
            {customer.tags?.length > 0 && (
              <Card title="Tags">
                <div className="flex flex-wrap gap-1.5">{customer.tags.map(t => <span key={t} className="rounded-full bg-dark-elevated px-2.5 py-0.5 text-[10px] font-medium text-foreground">{t}</span>)}</div>
              </Card>
            )}
            {customer.notes && <Card title="Notes"><p className="text-sm text-foreground whitespace-pre-wrap">{customer.notes}</p></Card>}
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
                <div key={s.label} className="rounded-xl bg-dark-card border border-[#1E2D45] p-3 text-center">
                  <p className="text-base font-bold text-white tabular-nums">{s.value}</p>
                  <p className="text-[9px] text-muted">{s.label}</p>
                </div>
              ))}
            </div>
            {/* Active Rentals */}
            {activeJobs.length > 0 && (
              <div className="rounded-xl bg-yellow-500/5 border border-yellow-500/15 p-4">
                <p className="text-xs text-yellow-400 uppercase tracking-wider font-semibold mb-2">Active Rentals ({activeJobs.length})</p>
                <div className="space-y-1.5">
                  {activeJobs.map(j => (
                    <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center justify-between rounded-lg bg-dark-card border border-[#1E2D45] px-3 py-2 hover:bg-dark-card-hover transition-colors">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-white">{j.job_number}</span>
                        {j.asset && <span className="text-[10px] text-muted">{j.asset.identifier}</span>}
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_CLS[j.status] || ""}`}>{j.status.replace(/_/g, " ")}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {/* Recent Jobs */}
            <Card title="Recent Jobs" action={<button onClick={() => setTab("jobs")} className="text-[10px] text-brand">View all</button>}>
              {jobs.length === 0 ? <p className="py-4 text-center text-xs text-muted">No jobs</p> : (
                <div className="divide-y divide-[#1E2D45] -mx-4">
                  {jobs.slice(0, 5).map(j => (
                    <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-dark-card-hover transition-colors">
                      <span className="text-xs font-medium text-white">{j.job_number}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted">{j.scheduled_date || "—"}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CLS[j.status] || ""}`}>{j.status.replace(/_/g, " ")}</span>
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
            <Card title="Current Balance"><p className={`text-2xl font-bold tabular-nums ${unpaidBalance > 0 ? "text-red-400" : "text-brand"}`}>{fmtMoney(unpaidBalance)}</p></Card>
            <Card title="Lifetime Revenue"><p className="text-2xl font-bold text-white tabular-nums">{fmtMoney(customer.lifetime_revenue)}</p></Card>
          </div>
          <Card title="Payment History">
            {invoices.filter(i => i.status === "paid").length === 0 ? <p className="py-4 text-center text-xs text-muted">No payments recorded</p> : (
              <div className="divide-y divide-[#1E2D45] -mx-4">
                {invoices.filter(i => i.status === "paid").map(i => (
                  <div key={i.id} className="flex items-center justify-between px-4 py-2">
                    <div><p className="text-xs font-medium text-white">{i.invoice_number}</p><p className="text-[10px] text-muted">{new Date(i.created_at).toLocaleDateString()}</p></div>
                    <span className="text-sm font-medium text-brand tabular-nums">{fmtMoney(i.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Unpaid Invoices">
            {invoices.filter(i => ["sent", "overdue", "draft"].includes(i.status)).length === 0 ? <p className="py-4 text-center text-xs text-muted">All paid up</p> : (
              <div className="divide-y divide-[#1E2D45] -mx-4">
                {invoices.filter(i => ["sent", "overdue", "draft"].includes(i.status)).map(i => (
                  <Link key={i.id} href={`/invoices/${i.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-dark-card-hover transition-colors">
                    <div><p className="text-xs font-medium text-white">{i.invoice_number}</p><p className="text-[10px] text-muted">Due: {i.due_date || "—"}</p></div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CLS[i.status] || ""}`}>{i.status}</span>
                      <span className="text-sm font-medium text-red-400 tabular-nums">{fmtMoney(i.balance_due)}</span>
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
        <div className="rounded-2xl bg-dark-card border border-[#1E2D45] overflow-hidden">
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[#1E2D45]">
                {["Job #", "Type", "Date", "Asset", "Status", "Price"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {jobs.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-xs text-muted">No jobs</td></tr> :
                  jobs.map(j => (
                    <tr key={j.id} onClick={() => router.push(`/jobs/${j.id}`)} className="border-b border-[#1E2D45] last:border-0 cursor-pointer hover:bg-dark-card-hover transition-colors">
                      <td className="px-4 py-3 font-medium text-white">{j.job_number}</td>
                      <td className="px-4 py-3 text-foreground capitalize">{j.job_type}</td>
                      <td className="px-4 py-3 text-foreground">{j.scheduled_date || "—"}</td>
                      <td className="px-4 py-3 text-muted">{j.asset?.identifier || "—"}</td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_CLS[j.status] || ""}`}>{j.status.replace(/_/g, " ")}</span></td>
                      <td className="px-4 py-3 text-white tabular-nums">{j.total_price ? fmtMoneyShort(j.total_price) : "—"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== INVOICES TAB ===== */}
      {tab === "invoices" && (
        <div className="rounded-2xl bg-dark-card border border-[#1E2D45] overflow-hidden">
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[#1E2D45]">
                {["Invoice #", "Date", "Due", "Status", "Total", "Balance"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {invoices.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-xs text-muted">No invoices</td></tr> :
                  invoices.map(i => (
                    <tr key={i.id} onClick={() => router.push(`/invoices/${i.id}`)} className="border-b border-[#1E2D45] last:border-0 cursor-pointer hover:bg-dark-card-hover transition-colors">
                      <td className="px-4 py-3 font-medium text-white">{i.invoice_number}</td>
                      <td className="px-4 py-3 text-foreground">{new Date(i.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-foreground">{i.due_date || "—"}</td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_CLS[i.status] || ""}`}>{i.status}</span></td>
                      <td className="px-4 py-3 text-white tabular-nums">{fmtMoney(i.total)}</td>
                      <td className="px-4 py-3 text-white tabular-nums">{fmtMoney(i.balance_due)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== NOTES TAB ===== */}
      {tab === "notes" && (
        <div className="max-w-2xl space-y-4">
          {/* Add note */}
          <div className="flex gap-2">
            <input value={newNote} onChange={e => setNewNote(e.target.value)} onKeyDown={e => e.key === "Enter" && addNote()}
              className="flex-1 rounded-lg bg-[#111C2E] border border-[#1E2D45] px-4 py-2.5 text-sm text-white placeholder-muted outline-none focus:border-brand"
              placeholder="Add a note..." />
            <button onClick={addNote} disabled={addingNote || !newNote.trim()}
              className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-40 btn-press">
              {addingNote ? "..." : "Add"}
            </button>
          </div>
          {/* Notes timeline */}
          {notes.length === 0 ? (
            <div className="py-12 text-center"><MessageSquare className="mx-auto h-8 w-8 text-muted/20 mb-2" /><p className="text-xs text-muted">No notes yet</p></div>
          ) : (
            <div className="space-y-2">
              {notes.map(n => (
                <div key={n.id} className={`rounded-lg border p-3 ${n.type === "system" ? "border-[#1E2D45] bg-dark-elevated" : "border-[#1E2D45] bg-dark-card"}`}>
                  <p className="text-sm text-foreground">{n.content}</p>
                  <div className="flex items-center gap-2 mt-2 text-[10px] text-muted">
                    <span>{n.author_name || "System"}</span>
                    <span>·</span>
                    <span>{timeAgo(n.created_at)}</span>
                    {n.type === "system" && <span className="rounded bg-dark-card px-1 py-0.5 text-[8px]">AUTO</span>}
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
    <div className="rounded-xl bg-dark-card border border-[#1E2D45] p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted uppercase tracking-wider font-semibold">{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-center justify-between py-1.5 text-sm"><span className="text-muted">{label}</span><span className="text-foreground">{value}</span></div>;
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

  const inputCls = "w-full bg-[#111C2E] border border-[#1E2D45] rounded-lg px-4 py-3 text-sm text-white placeholder-muted outline-none focus:border-brand focus:ring-1 focus:ring-brand";

  return (
    <form onSubmit={async (e: FormEvent) => {
      e.preventDefault(); setError(""); setSaving(true);
      try { const u = await api.patch<Customer>(`/customers/${customer.id}`, { firstName, lastName, email: email || undefined, phone: phone || undefined, companyName: companyName || undefined, notes: notes || undefined }); onSuccess(u); }
      catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
      finally { setSaving(false); }
    }} className="space-y-4">
      {error && <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <input value={firstName} onChange={e => setFirstName(e.target.value)} required className={inputCls} placeholder="First" />
        <input value={lastName} onChange={e => setLastName(e.target.value)} required className={inputCls} placeholder="Last" />
      </div>
      <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} placeholder="Phone" />
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="Email" />
      <input value={companyName} onChange={e => setCompanyName(e.target.value)} className={inputCls} placeholder="Company" />
      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={`${inputCls} resize-none`} placeholder="Notes" />
      <button type="submit" disabled={saving} className="w-full rounded-lg bg-brand py-3 text-sm font-bold text-white hover:bg-brand-light disabled:opacity-50 btn-press">
        {saving ? "Saving..." : "Save"}
      </button>
    </form>
  );
}
