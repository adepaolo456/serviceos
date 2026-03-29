"use client";

import { useState, useEffect, use, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Send,
  DollarSign,
  XCircle,
  CreditCard,
  FileText,
  Calendar,
  User,
} from "lucide-react";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface Invoice {
  id: string;
  invoice_number: string;
  status: string;
  due_date: string;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  discount_amount: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  line_items: LineItem[];
  notes: string;
  sent_at: string;
  paid_at: string;
  created_at: string;
  customer: { id: string; first_name: string; last_name: string; email: string } | null;
  job: { id: string; job_number: string } | null;
}

interface Payment {
  id: string;
  amount: number;
  payment_method: string;
  status: string;
  notes: string;
  processed_at: string;
  created_at: string;
}

interface PaymentsResponse {
  data: Payment[];
  meta: { total: number };
}

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-zinc-500/10 text-zinc-400",
  sent: "bg-blue-500/10 text-blue-400",
  paid: "bg-brand/10 text-brand",
  overdue: "bg-red-500/10 text-red-400",
  void: "bg-zinc-600/10 text-zinc-500",
};

const PAYMENT_STATUS: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-400",
  succeeded: "bg-brand/10 text-brand",
  failed: "bg-red-500/10 text-red-400",
  refunded: "bg-purple-500/10 text-purple-400",
};

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "$0.00";
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [paymentPanel, setPaymentPanel] = useState(false);

  const fetchData = async () => {
    try {
      const [inv, pay] = await Promise.all([
        api.get<Invoice>(`/invoices/${id}`),
        api.get<PaymentsResponse>(`/payments?invoiceId=${id}&limit=50`),
      ]);
      setInvoice(inv);
      setPayments(pay.data);
    } catch {
      /* handled */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleSend = async () => {
    if (!invoice || actionLoading) return;
    setActionLoading(true);
    try {
      await api.post(`/invoices/${id}/send`);
      await fetchData();
    } catch {
      /* */
    } finally {
      setActionLoading(false);
    }
  };

  const handleVoid = async () => {
    if (!invoice || actionLoading) return;
    if (!confirm("Void this invoice? This cannot be undone.")) return;
    setActionLoading(true);
    try {
      await api.patch(`/invoices/${id}`, { status: "void" });
      await fetchData();
    } catch {
      /* */
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-muted">
        Loading...
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="flex items-center justify-center py-32 text-muted">
        Invoice not found
      </div>
    );
  }

  const canSend = invoice.status === "draft";
  const canPay = ["sent", "overdue"].includes(invoice.status);
  const canVoid = ["draft", "sent"].includes(invoice.status);

  return (
    <div>
      <Link
        href="/invoices"
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Invoices
      </Link>

      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="font-display text-2xl font-bold text-white">
              {invoice.invoice_number}
            </h1>
            <span
              className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${STATUS_BADGE[invoice.status] || ""}`}
            >
              {invoice.status}
            </span>
          </div>
          <p className="text-sm text-muted">
            Created {new Date(invoice.created_at).toLocaleDateString()}
            {invoice.sent_at &&
              ` · Sent ${new Date(invoice.sent_at).toLocaleDateString()}`}
            {invoice.paid_at &&
              ` · Paid ${new Date(invoice.paid_at).toLocaleDateString()}`}
          </p>
        </div>
        <div className="flex gap-2">
          {canSend && (
            <button
              onClick={handleSend}
              disabled={actionLoading}
              className="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              Send
            </button>
          )}
          {canPay && (
            <button
              onClick={() => setPaymentPanel(true)}
              className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-dark-primary transition-colors hover:bg-brand-light"
            >
              <CreditCard className="h-4 w-4" />
              Record Payment
            </button>
          )}
          {canVoid && (
            <button
              onClick={handleVoid}
              disabled={actionLoading}
              className="flex items-center gap-2 rounded-lg bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" />
              Void
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Info cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl bg-dark-card p-5">
              <div className="flex items-center gap-2 mb-2">
                <User className="h-4 w-4 text-muted" />
                <span className="text-xs font-medium uppercase tracking-wider text-muted">
                  Customer
                </span>
              </div>
              {invoice.customer ? (
                <Link
                  href={`/customers/${invoice.customer.id}`}
                  className="text-sm font-medium text-white hover:text-brand transition-colors"
                >
                  {invoice.customer.first_name} {invoice.customer.last_name}
                </Link>
              ) : (
                <p className="text-sm text-muted">—</p>
              )}
              {invoice.customer?.email && (
                <p className="text-xs text-muted mt-0.5">
                  {invoice.customer.email}
                </p>
              )}
            </div>
            <div className="rounded-2xl bg-dark-card p-5">
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="h-4 w-4 text-muted" />
                <span className="text-xs font-medium uppercase tracking-wider text-muted">
                  Due Date
                </span>
              </div>
              <p className="text-sm font-medium text-white">
                {invoice.due_date || "Not set"}
              </p>
              {invoice.job && (
                <Link
                  href={`/jobs/${invoice.job.id}`}
                  className="flex items-center gap-1 mt-1 text-xs text-brand hover:text-brand-light"
                >
                  <FileText className="h-3 w-3" />
                  Job {invoice.job.job_number}
                </Link>
              )}
            </div>
          </div>

          {/* Line items */}
          <div className="rounded-2xl bg-dark-card overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5">
              <h2 className="font-display text-base font-semibold text-white">
                Line Items
              </h2>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                    Description
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                    Qty
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                    Unit Price
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoice.line_items.map((item, i) => (
                  <tr
                    key={i}
                    className="border-b border-white/5 last:border-0"
                  >
                    <td className="px-6 py-3.5 text-foreground">
                      {item.description}
                    </td>
                    <td className="px-6 py-3.5 text-right text-foreground">
                      {item.quantity}
                    </td>
                    <td className="px-6 py-3.5 text-right text-foreground">
                      {fmt(item.unitPrice)}
                    </td>
                    <td className="px-6 py-3.5 text-right font-medium text-white">
                      {fmt(item.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Payment history */}
          <div className="rounded-2xl bg-dark-card overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5">
              <h2 className="font-display text-base font-semibold text-white">
                Payment History ({payments.length})
              </h2>
            </div>
            {payments.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted">
                No payments recorded
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                      Method
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                      Status
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-white/5 last:border-0"
                    >
                      <td className="px-6 py-3.5 text-foreground">
                        {new Date(p.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-3.5 text-foreground capitalize">
                        {p.payment_method}
                      </td>
                      <td className="px-6 py-3.5">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${PAYMENT_STATUS[p.status] || ""}`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-right font-medium text-white">
                        {fmt(p.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Sidebar totals */}
        <div className="space-y-6">
          <div className="rounded-2xl bg-dark-card p-6">
            <div className="flex items-center gap-2 mb-5">
              <DollarSign className="h-4 w-4 text-brand" />
              <h3 className="font-display text-base font-semibold text-white">
                Summary
              </h3>
            </div>
            <div className="space-y-2.5 text-sm">
              <div className="flex justify-between text-foreground">
                <span className="text-muted">Subtotal</span>
                <span>{fmt(invoice.subtotal)}</span>
              </div>
              {Number(invoice.discount_amount) > 0 && (
                <div className="flex justify-between text-foreground">
                  <span className="text-muted">Discount</span>
                  <span className="text-red-400">
                    -{fmt(invoice.discount_amount)}
                  </span>
                </div>
              )}
              {Number(invoice.tax_amount) > 0 && (
                <div className="flex justify-between text-foreground">
                  <span className="text-muted">
                    Tax ({(Number(invoice.tax_rate) * 100).toFixed(2)}%)
                  </span>
                  <span>{fmt(invoice.tax_amount)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-white/5 pt-2.5 font-semibold text-white">
                <span>Total</span>
                <span>{fmt(invoice.total)}</span>
              </div>
              <div className="flex justify-between text-foreground">
                <span className="text-muted">Paid</span>
                <span className="text-brand">{fmt(invoice.amount_paid)}</span>
              </div>
              <div className="flex justify-between border-t border-white/5 pt-2.5 font-bold text-white text-base">
                <span>Balance Due</span>
                <span>{fmt(invoice.balance_due)}</span>
              </div>
            </div>
          </div>

          {invoice.notes && (
            <div className="rounded-2xl bg-dark-card p-6">
              <h3 className="text-sm font-semibold text-white mb-2">Notes</h3>
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {invoice.notes}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Record Payment panel */}
      <SlideOver
        open={paymentPanel}
        onClose={() => setPaymentPanel(false)}
        title="Record Payment"
      >
        <RecordPaymentForm
          invoiceId={invoice.id}
          balanceDue={Number(invoice.balance_due)}
          onSuccess={() => {
            setPaymentPanel(false);
            fetchData();
          }}
        />
      </SlideOver>
    </div>
  );
}

/* ---------- Record Payment Form ---------- */

function RecordPaymentForm({
  invoiceId,
  balanceDue,
  onSuccess,
}: {
  invoiceId: string;
  balanceDue: number;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState(String(balanceDue));
  const [method, setMethod] = useState("card");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api.post("/payments", {
        invoiceId,
        amount: Number(amount),
        paymentMethod: method,
        status: "succeeded",
        notes: notes || undefined,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record");
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

      <div className="rounded-lg bg-dark-elevated p-4 text-center">
        <p className="text-xs text-muted mb-1">Balance Due</p>
        <p className="text-2xl font-display font-bold text-white">
          {fmt(balanceDue)}
        </p>
      </div>

      <div>
        <label className={labelClass}>Amount</label>
        <input
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>Payment Method</label>
        <div className="grid grid-cols-4 gap-1 rounded-lg bg-dark-card p-1">
          {(["card", "ach", "cash", "check"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={`rounded-md py-2 text-sm font-medium capitalize transition-colors ${
                method === m
                  ? "bg-brand text-dark-primary"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={labelClass}>Notes</label>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={inputClass}
          placeholder="Check #1234, etc."
        />
      </div>

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-dark-primary transition-colors hover:bg-brand-light disabled:opacity-50"
      >
        {saving ? "Recording..." : `Record ${fmt(Number(amount))}`}
      </button>
    </form>
  );
}
