"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Users, MoreHorizontal, Trash2 } from "lucide-react";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";
import Dropdown from "@/components/dropdown";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";

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

const typeFilters = ["all", "residential", "commercial"] as const;

export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const { toast } = useToast();

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete customer "${name}"?`)) return;
    try {
      await api.delete(`/customers/${id}`);
      toast("success", "Customer deleted");
      fetchCustomers();
    } catch { toast("error", "Failed to delete customer"); }
  };

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (search) params.set("search", search);
      if (typeFilter !== "all") params.set("type", typeFilter);
      const res = await api.get<CustomersResponse>(
        `/customers?${params.toString()}`
      );
      setCustomers(res.data);
      setTotal(res.meta.total);
    } catch {
      /* redirect handled by api client */
    } finally {
      setLoading(false);
    }
  }, [page, search, typeFilter]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  useEffect(() => {
    setPage(1);
  }, [search, typeFilter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            Customers
          </h1>
          <p className="mt-1 text-muted">{total} total customers</p>
        </div>
        <button
          onClick={() => setPanelOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1FA855] btn-press"
        >
          <Plus className="h-4 w-4" />
          New Customer
        </button>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            placeholder="Search by name, email, or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-[#1E2D45] bg-[#111C2E] py-2.5 pl-10 pr-4 text-sm text-white placeholder-muted outline-none transition-colors focus:border-[#2ECC71] focus:ring-1 focus:ring-[#2ECC71]"
          />
        </div>
        <div className="flex gap-1">
          {typeFilters.map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`rounded-full px-4 py-1.5 text-xs font-medium capitalize transition-colors btn-press ${
                typeFilter === t
                  ? "bg-brand/15 text-brand"
                  : "bg-dark-card text-muted hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-dark-card overflow-hidden border border-[#1E2D45] shadow-lg shadow-black/10">
        <div className="table-scroll">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#1E2D45]">
              <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-muted">
                Name
              </th>
              <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-muted">
                Type
              </th>
              <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-muted">
                Phone
              </th>
              <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-muted">
                Email
              </th>
              <th className="px-6 py-3.5 text-right text-xs font-medium uppercase tracking-wider text-muted">
                Jobs
              </th>
              <th className="px-6 py-3.5 text-right text-xs font-medium uppercase tracking-wider text-muted">
                Revenue
              </th>
              <th className="px-6 py-3.5 text-center text-xs font-medium uppercase tracking-wider text-muted">
                Status
              </th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={8} className="px-6 py-1">
                    <div className="h-12 w-full skeleton rounded" />
                  </td>
                </tr>
              ))
            ) : customers.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-16">
                  <div className="flex flex-col items-center justify-center text-center">
                    <Users className="h-12 w-12 text-[#7A8BA3]/30 mb-4" />
                    <h3 className="text-lg font-semibold text-white mb-1">No customers yet</h3>
                    <p className="text-sm text-muted mb-4">Add your first customer to get started</p>
                    <button
                      onClick={() => setPanelOpen(true)}
                      className="rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1FA855] btn-press"
                    >
                      New Customer
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              customers.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => router.push(`/customers/${c.id}`)}
                  className="border-b border-[#1E2D45] last:border-0 cursor-pointer transition-colors hover:bg-[#1A2740]/50"
                >
                  <td className="px-6 py-4 font-medium text-white">
                    {c.first_name} {c.last_name}
                    {c.company_name && (
                      <span className="ml-2 text-xs text-muted">
                        {c.company_name}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        c.type === "commercial"
                          ? "bg-blue-500/10 text-blue-400"
                          : "bg-brand/10 text-brand"
                      }`}
                    >
                      {c.type}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-foreground">
                    {c.phone || "—"}
                  </td>
                  <td className="px-6 py-4 text-foreground">
                    {c.email || "—"}
                  </td>
                  <td className="px-6 py-4 text-right text-foreground">
                    {c.total_jobs}
                  </td>
                  <td className="px-6 py-4 text-right text-foreground tabular-nums">
                    ${Number(c.lifetime_revenue).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        c.is_active ? "bg-brand" : "bg-red-500"
                      }`}
                    />
                  </td>
                  <td className="px-2 py-4" onClick={(e) => e.stopPropagation()}>
                    <Dropdown
                      align="right"
                      trigger={
                        <button className="rounded p-1 text-muted hover:text-white hover:bg-dark-elevated transition-colors">
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      }
                    >
                      <button
                        onClick={() => router.push(`/customers/${c.id}`)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-dark-card-hover"
                      >
                        View Details
                      </button>
                      <button
                        onClick={() => handleDelete(c.id, `${c.first_name} ${c.last_name}`)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
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

      {total > 20 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted">
          <span>
            Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of{" "}
            {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-lg bg-dark-card px-3 py-1.5 transition-colors hover:bg-dark-card-hover disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page * 20 >= total}
              className="rounded-lg bg-dark-card px-3 py-1.5 transition-colors hover:bg-dark-card-hover disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <SlideOver
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title="New Customer"
      >
        <NewCustomerForm
          onSuccess={() => {
            setPanelOpen(false);
            fetchCustomers();
          }}
        />
      </SlideOver>
    </div>
  );
}

function NewCustomerForm({ onSuccess }: { onSuccess: () => void }) {
  const [type, setType] = useState<"residential" | "commercial">("residential");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [address, setAddress] = useState<AddressValue>({ street: "", city: "", state: "", zip: "", lat: null, lng: null });
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const billingAddress = address.street
          ? { street: address.street, city: address.city, state: address.state, zip: address.zip, lat: address.lat, lng: address.lng }
          : undefined;
      await api.post("/customers", {
        type,
        firstName,
        lastName,
        email: email || undefined,
        phone: phone || undefined,
        companyName: type === "commercial" ? companyName || undefined : undefined,
        billingAddress,
        notes: notes || undefined,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-[#1E2D45] bg-[#111C2E] px-4 py-2.5 text-sm text-white placeholder-muted outline-none transition-colors focus:border-brand";
  const labelClass = "block text-sm font-medium text-[#7A8BA3] mb-1.5";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div>
        <label className={labelClass}>Type</label>
        <div className="flex gap-1 rounded-lg bg-dark-card p-1">
          {(["residential", "commercial"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`flex-1 rounded-md py-2 text-sm font-medium capitalize transition-colors btn-press ${
                type === t
                  ? "bg-brand text-dark-primary"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {type === "commercial" && (
        <div>
          <label className={labelClass}>Company Name</label>
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className={inputClass}
            placeholder="Acme Construction"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>First Name</label>
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            className={inputClass}
            placeholder="Jane"
          />
        </div>
        <div>
          <label className={labelClass}>Last Name</label>
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
            className={inputClass}
            placeholder="Smith"
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
          placeholder="jane@example.com"
        />
      </div>

      <div>
        <label className={labelClass}>Phone</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={inputClass}
          placeholder="555-234-5678"
        />
      </div>

      <div>
        <label className={labelClass}>Billing Address</label>
        <AddressAutocomplete value={address} onChange={setAddress} placeholder="Search address..." />
      </div>

      <div>
        <label className={labelClass}>Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className={`${inputClass} resize-none`}
          placeholder="Internal notes about this customer..."
        />
      </div>

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1FA855] disabled:opacity-50 btn-press"
      >
        {saving ? "Creating..." : "Create Customer"}
      </button>
    </form>
  );
}
