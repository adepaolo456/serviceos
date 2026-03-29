"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Search, Users, MoreHorizontal, Trash2, Phone as PhoneIcon,
  Mail, Briefcase, FileText, ArrowUpDown, Pencil,
} from "lucide-react";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";
import Dropdown from "@/components/dropdown";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";

/* ---- Types ---- */

interface Customer {
  id: string;
  type: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company_name: string;
  total_jobs: number;
  lifetime_revenue: number;
  is_active: boolean;
}

interface CustomersResponse {
  data: Customer[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/* ---- Helpers ---- */

function fmtPhone(p: string | null): string {
  if (!p) return "";
  const digits = p.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === "1") return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return p;
}

function fmtMoney(n: number): string {
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/* ---- Filters ---- */

const FILTERS = [
  { key: "all", label: "All" },
  { key: "residential", label: "Residential" },
  { key: "commercial", label: "Commercial" },
] as const;

type SortKey = "name" | "revenue" | "jobs" | "type";
type SortDir = "asc" | "desc";

/* ---- Page ---- */

export default function CustomersPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (search) params.set("search", search);
      if (typeFilter !== "all") params.set("type", typeFilter);
      const res = await api.get<CustomersResponse>(`/customers?${params}`);
      setCustomers(res.data);
      setTotal(res.meta.total);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [page, search, typeFilter]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);
  useEffect(() => { setPage(1); }, [search, typeFilter]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    try { await api.delete(`/customers/${id}`); toast("success", "Deleted"); fetchCustomers(); }
    catch { toast("error", "Failed to delete"); }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  // Client-side sort (on current page)
  const sorted = [...customers].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "name": return dir * (`${a.first_name} ${a.last_name}`).localeCompare(`${b.first_name} ${b.last_name}`);
      case "revenue": return dir * (Number(a.lifetime_revenue) - Number(b.lifetime_revenue));
      case "jobs": return dir * (a.total_jobs - b.total_jobs);
      case "type": return dir * a.type.localeCompare(b.type);
      default: return 0;
    }
  });

  const SortHeader = ({ label, sortKeyName, align }: { label: string; sortKeyName: SortKey; align?: string }) => (
    <th
      className={`px-5 py-3 text-xs font-medium uppercase tracking-wider text-muted cursor-pointer select-none hover:text-foreground transition-colors ${align === "right" ? "text-right" : "text-left"}`}
      onClick={() => toggleSort(sortKeyName)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === sortKeyName && <ArrowUpDown className="h-3 w-3 text-brand" />}
      </span>
    </th>
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">Customers</h1>
          <p className="mt-0.5 text-sm text-muted">{total} total</p>
        </div>
        <button onClick={() => setPanelOpen(true)} className="flex items-center gap-2 rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1FA855] btn-press transition-colors">
          <Plus className="h-4 w-4" /> New Customer
        </button>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center mb-5">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search name, phone, email, address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-[#1E2D45] bg-[#111C2E] py-2.5 pl-10 pr-4 text-sm text-white placeholder-muted outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
          {search && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted">
              {total} result{total !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setTypeFilter(f.key)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium capitalize transition-colors btn-press ${
                typeFilter === f.key ? "bg-brand/15 text-brand" : "bg-dark-card text-muted hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl bg-dark-card overflow-hidden border border-[#1E2D45] shadow-lg shadow-black/10">
        <div className="table-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1E2D45]">
                <SortHeader label="Customer" sortKeyName="name" />
                <SortHeader label="Type" sortKeyName="type" />
                <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">Phone</th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">Email</th>
                <SortHeader label="Jobs" sortKeyName="jobs" align="right" />
                <SortHeader label="Revenue" sortKeyName="revenue" align="right" />
                <th className="px-5 py-3 text-center text-xs font-medium uppercase tracking-wider text-muted">Status</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}><td colSpan={8} className="px-5 py-2"><div className="h-12 skeleton rounded" /></td></tr>
                ))
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-16">
                    <div className="flex flex-col items-center text-center">
                      <Users className="h-12 w-12 text-muted/20 mb-3" />
                      <p className="text-sm font-medium text-white mb-1">{search ? "No matches" : "No customers yet"}</p>
                      <p className="text-xs text-muted mb-4">{search ? `No results for "${search}"` : "Add your first customer"}</p>
                      {!search && (
                        <button onClick={() => setPanelOpen(true)} className="rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand-light btn-press">New Customer</button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                sorted.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => router.push(`/customers/${c.id}`)}
                    className="border-b border-[#1E2D45] last:border-0 cursor-pointer transition-colors hover:bg-[#1A2740]/50"
                  >
                    {/* Avatar + Name */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          c.type === "commercial" ? "bg-purple-500/15 text-purple-400" : "bg-blue-500/15 text-blue-400"
                        }`}>
                          {c.first_name?.[0]}{c.last_name?.[0]}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-white truncate">{c.first_name} {c.last_name}</p>
                          {c.company_name && <p className="text-[10px] text-muted truncate">{c.company_name}</p>}
                        </div>
                      </div>
                    </td>
                    {/* Type */}
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${
                        c.type === "commercial" ? "bg-purple-500/10 text-purple-400" : "bg-blue-500/10 text-blue-400"
                      }`}>{c.type}</span>
                    </td>
                    {/* Phone */}
                    <td className="px-5 py-3.5" onClick={(e) => e.stopPropagation()}>
                      {c.phone ? (
                        <a href={`tel:${c.phone}`} className="flex items-center gap-1.5 text-foreground hover:text-brand transition-colors">
                          <PhoneIcon className="h-3 w-3 text-muted" />{fmtPhone(c.phone)}
                        </a>
                      ) : <span className="text-muted">—</span>}
                    </td>
                    {/* Email */}
                    <td className="px-5 py-3.5" onClick={(e) => e.stopPropagation()}>
                      {c.email ? (
                        <a href={`mailto:${c.email}`} className="text-foreground hover:text-brand transition-colors truncate block max-w-[180px]">
                          {c.email}
                        </a>
                      ) : <span className="text-muted">—</span>}
                    </td>
                    {/* Jobs */}
                    <td className="px-5 py-3.5 text-right text-foreground tabular-nums">{c.total_jobs}</td>
                    {/* Revenue */}
                    <td className="px-5 py-3.5 text-right font-medium text-white tabular-nums">{fmtMoney(c.lifetime_revenue)}</td>
                    {/* Status */}
                    <td className="px-5 py-3.5 text-center">
                      <span className={`inline-flex items-center gap-1.5 text-[10px] font-medium ${c.is_active ? "text-brand" : "text-muted"}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${c.is_active ? "bg-brand" : "bg-zinc-500"}`} />
                        {c.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    {/* Actions */}
                    <td className="px-2 py-3.5" onClick={(e) => e.stopPropagation()}>
                      <Dropdown align="right" trigger={
                        <button className="rounded p-1 text-muted hover:text-white hover:bg-dark-elevated transition-colors">
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      }>
                        <button onClick={() => router.push(`/customers/${c.id}`)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-dark-card-hover">
                          <Users className="h-3.5 w-3.5" /> View Details
                        </button>
                        <button onClick={() => router.push(`/customers/${c.id}`)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-dark-card-hover">
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </button>
                        <button onClick={() => router.push(`/book`)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-dark-card-hover">
                          <Briefcase className="h-3.5 w-3.5" /> Create Job
                        </button>
                        <button onClick={() => router.push(`/invoices`)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-dark-card-hover">
                          <FileText className="h-3.5 w-3.5" /> Send Invoice
                        </button>
                        <div className="border-t border-[#1E2D45]" />
                        <button onClick={() => handleDelete(c.id, `${c.first_name} ${c.last_name}`)} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10">
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                      </Dropdown>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {total > 25 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted">
          <span>Showing {(page - 1) * 25 + 1}–{Math.min(page * 25, total)} of {total}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="rounded-lg bg-dark-card px-3 py-1.5 hover:bg-dark-card-hover disabled:opacity-40 transition-colors">Prev</button>
            <button onClick={() => setPage(p => p + 1)} disabled={page * 25 >= total} className="rounded-lg bg-dark-card px-3 py-1.5 hover:bg-dark-card-hover disabled:opacity-40 transition-colors">Next</button>
          </div>
        </div>
      )}

      {/* Create Slide-over */}
      <SlideOver open={panelOpen} onClose={() => setPanelOpen(false)} title="New Customer">
        <NewCustomerForm onSuccess={() => { setPanelOpen(false); fetchCustomers(); }} />
      </SlideOver>
    </div>
  );
}

/* ============================================================
   Create Customer Form
   ============================================================ */

function NewCustomerForm({ onSuccess }: { onSuccess: () => void }) {
  const [type, setType] = useState<"residential" | "commercial">("residential");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [billingAddress, setBillingAddress] = useState<AddressValue>({ street: "", city: "", state: "", zip: "", lat: null, lng: null });
  const [serviceAddresses, setServiceAddresses] = useState<AddressValue[]>([]);
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [leadSource, setLeadSource] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const inputCls = "w-full rounded-lg border border-[#1E2D45] bg-[#111C2E] px-4 py-2.5 text-sm text-white placeholder-muted outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-colors";
  const labelCls = "block text-xs font-medium text-muted uppercase tracking-wider mb-1.5";
  const sectionCls = "text-xs font-semibold text-muted uppercase tracking-wider pt-4 pb-2 border-t border-[#1E2D45] mt-4";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(""); setSaving(true);
    try {
      const addr = billingAddress.street ? { street: billingAddress.street, city: billingAddress.city, state: billingAddress.state, zip: billingAddress.zip, lat: billingAddress.lat, lng: billingAddress.lng } : undefined;
      await api.post("/customers", {
        type, firstName, lastName,
        email: email || undefined,
        phone: phone || undefined,
        companyName: type === "commercial" ? companyName || undefined : undefined,
        billingAddress: addr,
        notes: notes || undefined,
        tags: tags ? tags.split(",").map(t => t.trim()).filter(Boolean) : undefined,
        leadSource: leadSource || undefined,
      });
      onSuccess();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to create"); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}

      {/* Contact Info */}
      <p className={sectionCls} style={{ borderTop: "none", marginTop: 0, paddingTop: 0 }}>Contact Info</p>

      <div>
        <label className={labelCls}>Type</label>
        <div className="grid grid-cols-2 gap-2">
          {(["residential", "commercial"] as const).map(t => (
            <button key={t} type="button" onClick={() => setType(t)}
              className={`rounded-lg py-2.5 text-xs font-medium capitalize transition-all active:scale-95 ${type === t ? "bg-brand text-dark-primary" : "bg-dark-elevated text-muted hover:text-white"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {type === "commercial" && (
        <div><label className={labelCls}>Company</label><input value={companyName} onChange={e => setCompanyName(e.target.value)} className={inputCls} placeholder="Acme Construction" /></div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>First Name</label><input value={firstName} onChange={e => setFirstName(e.target.value)} required className={inputCls} placeholder="Jane" /></div>
        <div><label className={labelCls}>Last Name</label><input value={lastName} onChange={e => setLastName(e.target.value)} required className={inputCls} placeholder="Smith" /></div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>Phone</label><input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} placeholder="(508) 631-8884" /></div>
        <div><label className={labelCls}>Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="jane@example.com" /></div>
      </div>

      {/* Address */}
      <p className={sectionCls}>Billing Address</p>
      <AddressAutocomplete value={billingAddress} onChange={setBillingAddress} placeholder="Search address..." />

      {/* Service Addresses */}
      <p className={sectionCls}>Service Addresses</p>
      {serviceAddresses.map((addr, i) => (
        <div key={i} className="flex gap-2 items-start">
          <div className="flex-1">
            <AddressAutocomplete value={addr} onChange={(v) => setServiceAddresses(prev => { const n = [...prev]; n[i] = v; return n; })} placeholder={`Service address ${i + 1}`} />
          </div>
          <button type="button" onClick={() => setServiceAddresses(prev => prev.filter((_, j) => j !== i))} className="rounded p-2 text-muted hover:text-red-400 mt-1">×</button>
        </div>
      ))}
      <button type="button" onClick={() => setServiceAddresses(prev => [...prev, { street: "", city: "", state: "", zip: "", lat: null, lng: null }])}
        className="text-xs text-brand hover:text-brand-light transition-colors">+ Add service address</button>

      {/* Account */}
      <p className={sectionCls}>Account</p>
      <div>
        <label className={labelCls}>Lead Source</label>
        <select value={leadSource} onChange={e => setLeadSource(e.target.value)} className={`${inputCls} appearance-none`}>
          <option value="">Select source</option>
          <option value="phone">Phone Call</option>
          <option value="website">Website</option>
          <option value="marketplace">RentThis Marketplace</option>
          <option value="referral">Referral</option>
          <option value="google">Google</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div>
        <label className={labelCls}>Tags</label>
        <input value={tags} onChange={e => setTags(e.target.value)} className={inputCls} placeholder="VIP, Contractor, Repeat Customer (comma-separated)" />
      </div>

      <div>
        <label className={labelCls}>Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={`${inputCls} resize-none`} placeholder="Internal notes..." />
      </div>

      <button type="submit" disabled={saving} className="w-full rounded-lg bg-brand py-3 text-sm font-bold text-white hover:bg-brand-light disabled:opacity-50 btn-press transition-colors mt-4">
        {saving ? "Creating..." : "Create Customer"}
      </button>
    </form>
  );
}
