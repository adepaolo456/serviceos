"use client";

import { useState, useEffect, useCallback, useRef, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, FileText, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";

interface Invoice {
  id: string;
  invoice_number: string;
  status: string;
  due_date: string;
  subtotal: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  created_at: string;
  customer: { id: string; first_name: string; last_name: string } | null;
}

interface InvoicesResponse {
  data: Invoice[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const TABS = ["all", "draft", "sent", "paid", "overdue"] as const;

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-zinc-500/10 text-zinc-400",
  sent: "bg-blue-500/10 text-blue-400",
  paid: "bg-brand/10 text-brand",
  overdue: "bg-red-500/10 text-red-400",
  void: "bg-zinc-500/10 text-zinc-500 line-through",
};

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "$0.00";
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function InvoicesPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMode, setPanelMode] = useState<"create" | "from-job">("create");

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (tab !== "all") params.set("status", tab);
      const res = await api.get<InvoicesResponse>(
        `/invoices?${params.toString()}`
      );
      setInvoices(res.data);
      setTotal(res.meta.total);
    } catch {
      /* handled */
    } finally {
      setLoading(false);
    }
  }, [page, tab]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  useEffect(() => {
    setPage(1);
  }, [tab]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-white">
            Invoices
          </h1>
          <p className="mt-1 text-muted">{total} invoices</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setPanelMode("from-job");
              setPanelOpen(true);
            }}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-dark-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-dark-card-hover"
          >
            <FileText className="h-4 w-4" />
            Generate from Job
          </button>
          <button
            onClick={() => {
              setPanelMode("create");
              setPanelOpen(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-dark-primary transition-colors hover:bg-brand-light"
          >
            <Plus className="h-4 w-4" />
            New Invoice
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-0 border-b border-white/5">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative px-5 py-3 text-sm font-medium capitalize transition-colors ${
              tab === t ? "text-brand" : "text-muted hover:text-foreground"
            }`}
          >
            {t}
            {tab === t && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brand rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-2xl bg-dark-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5">
              {[
                "Invoice #",
                "Customer",
                "Date",
                "Due Date",
                "Total",
                "Paid",
                "Balance",
                "Status",
              ].map((h, i) => (
                <th
                  key={h}
                  className={`px-5 py-3.5 text-xs font-medium uppercase tracking-wider text-muted ${i >= 4 ? "text-right" : "text-left"}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-5 py-16 text-center text-muted">
                  Loading...
                </td>
              </tr>
            ) : invoices.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-16 text-center text-muted">
                  No invoices found
                </td>
              </tr>
            ) : (
              invoices.map((inv) => (
                <tr
                  key={inv.id}
                  onClick={() => router.push(`/invoices/${inv.id}`)}
                  className="border-b border-white/5 last:border-0 cursor-pointer transition-colors hover:bg-dark-card-hover"
                >
                  <td className="px-5 py-4 font-medium text-white">
                    {inv.invoice_number}
                  </td>
                  <td className="px-5 py-4 text-foreground">
                    {inv.customer
                      ? `${inv.customer.first_name} ${inv.customer.last_name}`
                      : "—"}
                  </td>
                  <td className="px-5 py-4 text-foreground">
                    {new Date(inv.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-4 text-foreground">
                    {inv.due_date || "—"}
                  </td>
                  <td className="px-5 py-4 text-right text-foreground">
                    {fmt(inv.total)}
                  </td>
                  <td className="px-5 py-4 text-right text-foreground">
                    {fmt(inv.amount_paid)}
                  </td>
                  <td className="px-5 py-4 text-right font-medium text-white">
                    {fmt(inv.balance_due)}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[inv.status] || "bg-zinc-500/10 text-zinc-400"}`}
                    >
                      {inv.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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
        title={panelMode === "from-job" ? "Generate from Job" : "New Invoice"}
      >
        {panelMode === "from-job" ? (
          <FromJobForm
            onSuccess={() => {
              setPanelOpen(false);
              fetchInvoices();
            }}
          />
        ) : (
          <CreateInvoiceForm
            onSuccess={() => {
              setPanelOpen(false);
              fetchInvoices();
            }}
          />
        )}
      </SlideOver>
    </div>
  );
}

/* ---------- Generate from Job ---------- */

interface JobOption {
  id: string;
  job_number: string;
  status: string;
  customer: { first_name: string; last_name: string } | null;
}

function FromJobForm({ onSuccess }: { onSuccess: () => void }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<JobOption[]>([]);
  const [selectedJob, setSelectedJob] = useState<JobOption | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (timeout.current) clearTimeout(timeout.current);
    if (!search || search.length < 2) {
      setResults([]);
      return;
    }
    timeout.current = setTimeout(async () => {
      try {
        const res = await api.get<{ data: JobOption[] }>(
          `/jobs?status=completed&limit=10`
        );
        setResults(
          res.data.filter(
            (j) =>
              j.job_number.toLowerCase().includes(search.toLowerCase()) ||
              (j.customer &&
                `${j.customer.first_name} ${j.customer.last_name}`
                  .toLowerCase()
                  .includes(search.toLowerCase()))
          )
        );
      } catch {
        /* */
      }
    }, 300);
  }, [search]);

  const handleGenerate = async () => {
    if (!selectedJob) return;
    setError("");
    setSaving(true);
    try {
      await api.post(`/invoices/from-job/${selectedJob.id}`);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-white/10 bg-dark-card px-4 py-2.5 text-sm text-white placeholder-muted outline-none transition-colors focus:border-brand";

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <p className="text-sm text-muted">
        Search for a completed job to auto-generate an invoice from its pricing
        data.
      </p>

      {selectedJob ? (
        <div className="flex items-center justify-between rounded-lg border border-brand/20 bg-brand/5 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-white">
              {selectedJob.job_number}
            </p>
            {selectedJob.customer && (
              <p className="text-xs text-muted">
                {selectedJob.customer.first_name}{" "}
                {selectedJob.customer.last_name}
              </p>
            )}
          </div>
          <button
            onClick={() => setSelectedJob(null)}
            className="text-xs text-muted hover:text-red-400"
          >
            Clear
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputClass}
            placeholder="Search completed jobs..."
          />
          {results.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-white/10 bg-dark-secondary shadow-xl overflow-hidden">
              {results.map((j) => (
                <button
                  key={j.id}
                  onClick={() => {
                    setSelectedJob(j);
                    setSearch("");
                    setResults([]);
                  }}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-dark-card-hover"
                >
                  <span className="font-medium text-white">
                    {j.job_number}
                  </span>
                  {j.customer && (
                    <span className="text-xs text-muted">
                      {j.customer.first_name} {j.customer.last_name}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        onClick={handleGenerate}
        disabled={!selectedJob || saving}
        className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-dark-primary transition-colors hover:bg-brand-light disabled:opacity-50"
      >
        {saving ? "Generating..." : "Generate Invoice"}
      </button>
    </div>
  );
}

/* ---------- Create Invoice ---------- */

interface CustomerOption {
  id: string;
  first_name: string;
  last_name: string;
}

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

function CreateInvoiceForm({ onSuccess }: { onSuccess: () => void }) {
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerOption[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [customerName, setCustomerName] = useState("");

  const [dueDate, setDueDate] = useState("");
  const [taxRate, setTaxRate] = useState("0");
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: "", quantity: 1, unitPrice: 0, amount: 0 },
  ]);

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout>>(null);

  // Customer search
  useEffect(() => {
    if (timeout.current) clearTimeout(timeout.current);
    if (!customerSearch || customerSearch.length < 2) {
      setCustomerResults([]);
      return;
    }
    timeout.current = setTimeout(async () => {
      try {
        const res = await api.get<{ data: CustomerOption[] }>(
          `/customers?search=${encodeURIComponent(customerSearch)}&limit=8`
        );
        setCustomerResults(res.data);
        setShowDropdown(true);
      } catch {
        /* */
      }
    }, 300);
  }, [customerSearch]);

  const updateLineItem = (
    idx: number,
    field: keyof LineItem,
    value: string | number
  ) => {
    setLineItems((prev) => {
      const items = [...prev];
      const item = { ...items[idx] };
      if (field === "description") {
        item.description = value as string;
      } else {
        const num = Number(value) || 0;
        if (field === "quantity") item.quantity = num;
        if (field === "unitPrice") item.unitPrice = num;
        item.amount = Math.round(item.quantity * item.unitPrice * 100) / 100;
      }
      items[idx] = item;
      return items;
    });
  };

  const addLine = () =>
    setLineItems((p) => [
      ...p,
      { description: "", quantity: 1, unitPrice: 0, amount: 0 },
    ]);
  const removeLine = (idx: number) =>
    setLineItems((p) => p.filter((_, i) => i !== idx));

  const subtotal = lineItems.reduce((s, l) => s + l.amount, 0);
  const tax = Math.round(subtotal * Number(taxRate) * 100) / 100;
  const invoiceTotal = Math.round((subtotal + tax) * 100) / 100;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!customerId) {
      setError("Please select a customer");
      return;
    }
    setError("");
    setSaving(true);
    try {
      await api.post("/invoices", {
        customerId,
        dueDate: dueDate || undefined,
        taxRate: Number(taxRate) || undefined,
        lineItems: lineItems.filter((l) => l.description),
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
    "w-full rounded-lg border border-white/10 bg-dark-card px-4 py-2.5 text-sm text-white placeholder-muted outline-none transition-colors focus:border-brand";
  const labelClass = "block text-sm font-medium text-foreground mb-1.5";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Customer search */}
      <div className="relative">
        <label className={labelClass}>Customer</label>
        {customerName ? (
          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-dark-card px-4 py-2.5">
            <span className="text-sm text-white">{customerName}</span>
            <button
              type="button"
              onClick={() => {
                setCustomerId("");
                setCustomerName("");
              }}
              className="text-xs text-muted hover:text-red-400"
            >
              Clear
            </button>
          </div>
        ) : (
          <input
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            onFocus={() =>
              customerResults.length > 0 && setShowDropdown(true)
            }
            className={inputClass}
            placeholder="Search customers..."
          />
        )}
        {showDropdown && customerResults.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-lg border border-white/10 bg-dark-secondary shadow-xl overflow-hidden">
            {customerResults.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setCustomerId(c.id);
                  setCustomerName(`${c.first_name} ${c.last_name}`);
                  setShowDropdown(false);
                  setCustomerSearch("");
                }}
                className="w-full px-4 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-dark-card-hover"
              >
                {c.first_name} {c.last_name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Due Date</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Tax Rate</label>
          <input
            type="number"
            step="0.0001"
            value={taxRate}
            onChange={(e) => setTaxRate(e.target.value)}
            className={inputClass}
            placeholder="0.0825"
          />
        </div>
      </div>

      {/* Line items */}
      <div>
        <label className={labelClass}>Line Items</label>
        <div className="space-y-2">
          {lineItems.map((line, idx) => (
            <div key={idx} className="flex gap-2 items-start">
              <input
                value={line.description}
                onChange={(e) =>
                  updateLineItem(idx, "description", e.target.value)
                }
                className={`flex-1 ${inputClass}`}
                placeholder="Description"
              />
              <input
                type="number"
                value={line.quantity || ""}
                onChange={(e) =>
                  updateLineItem(idx, "quantity", e.target.value)
                }
                className={`w-16 ${inputClass}`}
                placeholder="Qty"
              />
              <input
                type="number"
                step="0.01"
                value={line.unitPrice || ""}
                onChange={(e) =>
                  updateLineItem(idx, "unitPrice", e.target.value)
                }
                className={`w-24 ${inputClass}`}
                placeholder="Price"
              />
              <span className="flex items-center py-2.5 text-sm text-foreground w-20 justify-end">
                {fmt(line.amount)}
              </span>
              {lineItems.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLine(idx)}
                  className="p-2.5 text-muted hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addLine}
          className="mt-2 text-sm text-brand hover:text-brand-light"
        >
          + Add line item
        </button>
      </div>

      {/* Totals */}
      <div className="rounded-lg bg-dark-elevated p-4 space-y-1 text-sm">
        <div className="flex justify-between text-foreground">
          <span>Subtotal</span>
          <span>{fmt(subtotal)}</span>
        </div>
        {tax > 0 && (
          <div className="flex justify-between text-foreground">
            <span>Tax</span>
            <span>{fmt(tax)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-white/10 pt-2 font-semibold text-white">
          <span>Total</span>
          <span>{fmt(invoiceTotal)}</span>
        </div>
      </div>

      <div>
        <label className={labelClass}>Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className={`${inputClass} resize-none`}
          placeholder="Net 30, etc."
        />
      </div>

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-dark-primary transition-colors hover:bg-brand-light disabled:opacity-50"
      >
        {saving ? "Creating..." : "Create Invoice"}
      </button>
    </form>
  );
}
