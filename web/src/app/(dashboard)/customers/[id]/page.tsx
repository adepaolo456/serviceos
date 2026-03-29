"use client";

import { useState, useEffect, use, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Mail, Phone, MapPin, Building, Calendar, Pencil, Trash2,
  Briefcase, FileText, DollarSign, Clock, Plus,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import SlideOver from "@/components/slide-over";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";

/* ---- Types ---- */

interface Customer {
  id: string; type: string; first_name: string; last_name: string;
  email: string; phone: string; company_name: string;
  billing_address: Record<string, string> | null;
  notes: string; tags: string[]; lead_source: string;
  total_jobs: number; lifetime_revenue: number; is_active: boolean;
  created_at: string;
}

interface Job {
  id: string; job_number: string; job_type: string; service_type: string;
  status: string; scheduled_date: string; total_price: number;
}

interface Invoice {
  id: string; invoice_number: string; status: string; total: number;
  balance_due: number; created_at: string;
}

/* ---- Helpers ---- */

function fmtPhone(p: string | null): string {
  if (!p) return "";
  const d = p.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1") return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return p;
}

const STATUS_CLS: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-400", confirmed: "bg-blue-500/10 text-blue-400",
  dispatched: "bg-purple-500/10 text-purple-400", en_route: "bg-orange-500/10 text-orange-400",
  in_progress: "bg-brand/10 text-brand", completed: "bg-emerald-500/10 text-emerald-400",
  cancelled: "bg-red-500/10 text-red-400", draft: "bg-zinc-500/10 text-zinc-400",
  sent: "bg-blue-500/10 text-blue-400", paid: "bg-brand/10 text-brand",
  overdue: "bg-red-500/10 text-red-400", void: "bg-zinc-500/10 text-zinc-400",
};

const TABS = ["overview", "jobs", "invoices"] as const;
type Tab = typeof TABS[number];

/* ---- Page ---- */

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [c, j, i] = await Promise.all([
          api.get<Customer>(`/customers/${id}`),
          api.get<{ data: Job[] }>(`/jobs?customerId=${id}&limit=50`),
          api.get<{ data: Invoice[] }>(`/invoices?customerId=${id}&limit=50`),
        ]);
        setCustomer(c);
        setJobs(j.data);
        setInvoices(i.data);
      } catch { /* */ }
      finally { setLoading(false); }
    }
    load();
  }, [id]);

  const handleDelete = async () => {
    if (!confirm("Delete this customer?")) return;
    setDeleting(true);
    try { await api.delete(`/customers/${id}`); toast("success", "Deleted"); router.push("/customers"); }
    catch { toast("error", "Failed to delete"); }
    finally { setDeleting(false); }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-6 w-40 skeleton rounded" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="h-64 skeleton rounded-2xl" />
          <div className="lg:col-span-2 h-64 skeleton rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!customer) return <div className="py-20 text-center text-muted">Customer not found</div>;

  const addr = customer.billing_address;
  const avgJobValue = customer.total_jobs > 0 ? Math.round(Number(customer.lifetime_revenue) / customer.total_jobs) : 0;
  const lastJob = jobs[0];
  const activeJobs = jobs.filter(j => !["completed", "cancelled"].includes(j.status));

  return (
    <div>
      {/* Back + Actions */}
      <div className="flex items-center justify-between mb-6">
        <Link href="/customers" className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Customers
        </Link>
        <div className="flex gap-2">
          <button onClick={() => setEditOpen(true)} className="flex items-center gap-1.5 rounded-lg bg-dark-elevated px-3 py-2 text-xs font-medium text-foreground hover:bg-dark-card-hover transition-colors btn-press">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
          <Link href="/book" className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand-light transition-colors btn-press">
            <Plus className="h-3.5 w-3.5" /> New Job
          </Link>
          <button onClick={handleDelete} disabled={deleting} className="flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors btn-press disabled:opacity-50">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Customer Header */}
      <div className="rounded-2xl bg-dark-card border border-[#1E2D45] p-5 mb-6">
        <div className="flex items-start gap-4">
          <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold ${
            customer.type === "commercial" ? "bg-purple-500/15 text-purple-400" : "bg-blue-500/15 text-blue-400"
          }`}>
            {customer.first_name[0]}{customer.last_name[0]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display text-xl font-bold text-white">{customer.first_name} {customer.last_name}</h1>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${customer.type === "commercial" ? "bg-purple-500/10 text-purple-400" : "bg-blue-500/10 text-blue-400"}`}>{customer.type}</span>
              {activeJobs.length > 0 && <span className="rounded-full bg-yellow-500/10 px-2 py-0.5 text-[10px] font-medium text-yellow-400">Active Rental</span>}
              <span className={`inline-flex items-center gap-1 text-[10px] ${customer.is_active ? "text-brand" : "text-red-400"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${customer.is_active ? "bg-brand" : "bg-red-500"}`} />{customer.is_active ? "Active" : "Inactive"}
              </span>
            </div>
            {customer.company_name && <p className="text-sm text-muted mt-0.5">{customer.company_name}</p>}
            <div className="flex items-center gap-4 mt-2 flex-wrap">
              {customer.phone && (
                <a href={`tel:${customer.phone}`} className="flex items-center gap-1.5 text-sm text-foreground hover:text-brand transition-colors">
                  <Phone className="h-3.5 w-3.5 text-muted" />{fmtPhone(customer.phone)}
                </a>
              )}
              {customer.email && (
                <a href={`mailto:${customer.email}`} className="flex items-center gap-1.5 text-sm text-foreground hover:text-brand transition-colors">
                  <Mail className="h-3.5 w-3.5 text-muted" />{customer.email}
                </a>
              )}
              <span className="flex items-center gap-1.5 text-xs text-muted">
                <Calendar className="h-3 w-3" />Since {new Date(customer.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="font-display text-2xl font-bold text-white tabular-nums">${Number(customer.lifetime_revenue).toLocaleString()}</p>
            <p className="text-[10px] text-muted">Lifetime Revenue</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-[#1E2D45] mb-6">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`relative px-5 py-3 text-sm font-medium capitalize transition-colors btn-press ${tab === t ? "text-brand" : "text-muted hover:text-foreground"}`}>
            {t}
            {t === "jobs" && <span className="ml-1 text-[10px] text-muted">{jobs.length}</span>}
            {t === "invoices" && <span className="ml-1 text-[10px] text-muted">{invoices.length}</span>}
            {tab === t && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brand rounded-full" />}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === "overview" && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Left: stats + info */}
          <div className="space-y-5">
            {/* Quick Stats */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Total Jobs", value: customer.total_jobs, icon: Briefcase },
                { label: "Avg Value", value: `$${avgJobValue}`, icon: DollarSign },
              ].map(s => (
                <div key={s.label} className="rounded-xl bg-dark-card border border-[#1E2D45] p-4 text-center">
                  <s.icon className="mx-auto h-4 w-4 text-muted mb-1" />
                  <p className="text-lg font-bold text-white tabular-nums">{s.value}</p>
                  <p className="text-[10px] text-muted">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Address */}
            {addr && addr.street && (
              <div className="rounded-xl bg-dark-card border border-[#1E2D45] p-4">
                <p className="text-xs text-muted uppercase tracking-wider mb-2">Billing Address</p>
                <p className="text-sm text-white">{addr.street}</p>
                <p className="text-xs text-muted">{[addr.city, addr.state, addr.zip].filter(Boolean).join(", ")}</p>
              </div>
            )}

            {/* Tags */}
            {customer.tags?.length > 0 && (
              <div className="rounded-xl bg-dark-card border border-[#1E2D45] p-4">
                <p className="text-xs text-muted uppercase tracking-wider mb-2">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {customer.tags.map(t => (
                    <span key={t} className="rounded-full bg-dark-elevated px-2.5 py-0.5 text-[10px] font-medium text-foreground">{t}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            {customer.notes && (
              <div className="rounded-xl bg-dark-card border border-[#1E2D45] p-4">
                <p className="text-xs text-muted uppercase tracking-wider mb-2">Notes</p>
                <p className="text-sm text-foreground whitespace-pre-wrap">{customer.notes}</p>
              </div>
            )}
          </div>

          {/* Right: active rentals + recent */}
          <div className="lg:col-span-2 space-y-5">
            {activeJobs.length > 0 && (
              <div className="rounded-xl bg-yellow-500/5 border border-yellow-500/15 p-4">
                <p className="text-xs text-yellow-400 uppercase tracking-wider font-semibold mb-3">Active Rentals ({activeJobs.length})</p>
                <div className="space-y-2">
                  {activeJobs.map(j => (
                    <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center justify-between rounded-lg bg-dark-card border border-[#1E2D45] px-4 py-2.5 hover:bg-dark-card-hover transition-colors">
                      <div>
                        <p className="text-sm font-medium text-white">{j.job_number}</p>
                        <p className="text-[10px] text-muted capitalize">{j.job_type} · {j.scheduled_date}</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_CLS[j.status] || "bg-zinc-500/10 text-zinc-400"}`}>{j.status.replace(/_/g, " ")}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Jobs Preview */}
            <div className="rounded-xl bg-dark-card border border-[#1E2D45] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#1E2D45]">
                <p className="text-xs text-muted uppercase tracking-wider font-semibold">Recent Jobs</p>
                <button onClick={() => setTab("jobs")} className="text-[10px] text-brand hover:text-brand-light">View all</button>
              </div>
              {jobs.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted">No jobs yet</div>
              ) : (
                <div className="divide-y divide-[#1E2D45]">
                  {jobs.slice(0, 5).map(j => (
                    <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-dark-card-hover transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-medium text-white">{j.job_number}</span>
                        <span className="text-[10px] text-muted capitalize">{j.job_type}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted">{j.scheduled_date || "—"}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_CLS[j.status] || ""}`}>{j.status.replace(/_/g, " ")}</span>
                        {j.total_price > 0 && <span className="text-xs text-white tabular-nums">${Number(j.total_price).toLocaleString()}</span>}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Jobs Tab */}
      {tab === "jobs" && (
        <div className="rounded-2xl bg-dark-card border border-[#1E2D45] overflow-hidden">
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1E2D45]">
                  {["Job #", "Type", "Date", "Status", "Price"].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.length === 0 ? (
                  <tr><td colSpan={5} className="py-12 text-center text-sm text-muted">No jobs</td></tr>
                ) : jobs.map(j => (
                  <tr key={j.id} onClick={() => router.push(`/jobs/${j.id}`)} className="border-b border-[#1E2D45] last:border-0 cursor-pointer hover:bg-dark-card-hover transition-colors">
                    <td className="px-5 py-3 font-medium text-white">{j.job_number}</td>
                    <td className="px-5 py-3 text-foreground capitalize">{j.job_type}</td>
                    <td className="px-5 py-3 text-foreground">{j.scheduled_date || "—"}</td>
                    <td className="px-5 py-3"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_CLS[j.status] || ""}`}>{j.status.replace(/_/g, " ")}</span></td>
                    <td className="px-5 py-3 text-white tabular-nums">{j.total_price ? `$${Number(j.total_price).toLocaleString()}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invoices Tab */}
      {tab === "invoices" && (
        <div className="rounded-2xl bg-dark-card border border-[#1E2D45] overflow-hidden">
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1E2D45]">
                  {["Invoice #", "Date", "Status", "Total", "Balance"].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 ? (
                  <tr><td colSpan={5} className="py-12 text-center text-sm text-muted">No invoices</td></tr>
                ) : invoices.map(inv => (
                  <tr key={inv.id} onClick={() => router.push(`/invoices/${inv.id}`)} className="border-b border-[#1E2D45] last:border-0 cursor-pointer hover:bg-dark-card-hover transition-colors">
                    <td className="px-5 py-3 font-medium text-white">{inv.invoice_number}</td>
                    <td className="px-5 py-3 text-foreground">{new Date(inv.created_at).toLocaleDateString()}</td>
                    <td className="px-5 py-3"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${STATUS_CLS[inv.status] || ""}`}>{inv.status}</span></td>
                    <td className="px-5 py-3 text-white tabular-nums">${Number(inv.total).toLocaleString()}</td>
                    <td className="px-5 py-3 text-white tabular-nums">${Number(inv.balance_due).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit Slide-over */}
      <SlideOver open={editOpen} onClose={() => setEditOpen(false)} title="Edit Customer">
        <EditCustomerForm customer={customer} onSuccess={(c) => { setCustomer(c); setEditOpen(false); toast("success", "Updated"); }} />
      </SlideOver>
    </div>
  );
}

/* ---- Edit Form ---- */

function EditCustomerForm({ customer, onSuccess }: { customer: Customer; onSuccess: (c: Customer) => void }) {
  const [firstName, setFirstName] = useState(customer.first_name);
  const [lastName, setLastName] = useState(customer.last_name);
  const [email, setEmail] = useState(customer.email || "");
  const [phone, setPhone] = useState(customer.phone || "");
  const [companyName, setCompanyName] = useState(customer.company_name || "");
  const [notes, setNotes] = useState(customer.notes || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const inputCls = "w-full bg-[#111C2E] border border-[#1E2D45] rounded-lg px-4 py-3 text-sm text-white placeholder-muted outline-none focus:border-brand focus:ring-1 focus:ring-brand";
  const labelCls = "block text-xs font-medium text-muted uppercase tracking-wider mb-1.5";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault(); setError(""); setSaving(true);
    try {
      const updated = await api.patch<Customer>(`/customers/${customer.id}`, {
        firstName, lastName, email: email || undefined, phone: phone || undefined,
        companyName: companyName || undefined, notes: notes || undefined,
      });
      onSuccess(updated);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>First Name</label><input value={firstName} onChange={e => setFirstName(e.target.value)} required className={inputCls} /></div>
        <div><label className={labelCls}>Last Name</label><input value={lastName} onChange={e => setLastName(e.target.value)} required className={inputCls} /></div>
      </div>
      <div><label className={labelCls}>Phone</label><input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} /></div>
      <div><label className={labelCls}>Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} /></div>
      <div><label className={labelCls}>Company</label><input value={companyName} onChange={e => setCompanyName(e.target.value)} className={inputCls} /></div>
      <div><label className={labelCls}>Notes</label><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={`${inputCls} resize-none`} /></div>
      <button type="submit" disabled={saving} className="w-full rounded-lg bg-brand py-3 text-sm font-bold text-white hover:bg-brand-light disabled:opacity-50 btn-press">
        {saving ? "Saving..." : "Save Changes"}
      </button>
    </form>
  );
}
