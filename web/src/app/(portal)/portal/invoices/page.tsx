"use client";

import { useState, useEffect } from "react";
import { portalApi } from "@/lib/portal-api";
import { formatCurrency } from "@/lib/utils";
import { FileText, CreditCard, CheckCircle2, AlertTriangle, Clock } from "lucide-react";

interface Invoice {
  id: string;
  invoice_number: number;
  status: string;
  due_date: string;
  total: number;
  amount_paid: number;
  balance_due: number;
  line_items: { name: string; quantity: number; unit_rate: number; net_amount: number }[];
  created_at: string;
  paid_at: string | null;
  summary_of_work: string | null;
}

interface Payment {
  id: string;
  amount: number;
  payment_method: string;
  status: string;
  processed_at: string | null;
  created_at: string;
  notes: string | null;
}

interface InvoiceDetail {
  invoice: Invoice;
  payments: Payment[];
}

function invoiceStatusText(status: string, dueDate: string) {
  const overdue = status === "open" && new Date(dueDate) < new Date();
  if (overdue) return <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--t-error)]"><AlertTriangle className="h-3 w-3" />Overdue</span>;
  const map: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
    draft: { cls: "text-[var(--t-text-muted)]", icon: <Clock className="h-3 w-3" />, label: "Draft" },
    open: { cls: "text-amber-500", icon: <FileText className="h-3 w-3" />, label: "Unpaid" },
    paid: { cls: "text-[var(--t-accent)]", icon: <CheckCircle2 className="h-3 w-3" />, label: "Paid" },
  };
  const s = map[status] || map.draft;
  return <span className={`inline-flex items-center gap-1 text-xs font-medium ${s.cls}`}>{s.icon}{s.label}</span>;
}

export default function PortalInvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Invoice | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    portalApi.get<Invoice[]>("/portal/invoices").then(setInvoices).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const openDetail = async (inv: Invoice) => {
    setDetail(inv);
    setPayments([]);
    setDetailLoading(true);
    try {
      const data = await portalApi.get<InvoiceDetail>(`/portal/invoices/${inv.id}`);
      setDetail(data.invoice);
      setPayments(data.payments || []);
    } catch { /* fall back to list data */ }
    finally { setDetailLoading(false); }
  };

  const unpaid = invoices.filter(i => i.status === "open");
  const totalOwed = unpaid.reduce((sum, i) => sum + Number(i.balance_due), 0);

  if (detail) {
    return (
      <div className="space-y-6">
        <button onClick={() => setDetail(null)} className="text-sm text-[var(--t-accent)] font-medium hover:underline">&larr; Back to invoices</button>
        <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
            <div>
              <h2 className="text-lg font-bold text-[var(--t-text-primary)]">Invoice #{detail.invoice_number}</h2>
              <p className="text-sm text-[var(--t-text-muted)]">Issued {new Date(detail.created_at).toLocaleDateString()}</p>
            </div>
            {invoiceStatusText(detail.status, detail.due_date)}
          </div>

          {/* Line items */}
          <table className="w-full text-sm mb-6">
            <thead>
              <tr className="border-b border-[var(--t-border)] text-[var(--t-text-muted)]">
                <th className="text-left pb-2 font-medium">Description</th>
                <th className="text-right pb-2 font-medium">Qty</th>
                <th className="text-right pb-2 font-medium">Rate</th>
                <th className="text-right pb-2 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {detail.line_items.map((item, i) => (
                <tr key={i} className="border-b border-[var(--t-border)]/50">
                  <td className="py-2.5 text-[var(--t-text-primary)]">{item.name}</td>
                  <td className="py-2.5 text-right text-[var(--t-text-muted)]">{item.quantity}</td>
                  <td className="py-2.5 text-right text-[var(--t-text-muted)]">{formatCurrency(Number(item.unit_rate))}</td>
                  <td className="py-2.5 text-right font-medium text-[var(--t-text-primary)]">{formatCurrency(Number(item.net_amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Summary */}
          <div className="flex justify-end">
            <div className="w-56 space-y-1.5 text-sm">
              <div className="flex justify-between text-[var(--t-text-muted)]"><span>Total</span><span className="font-medium text-[var(--t-text-primary)]">{formatCurrency(detail.total)}</span></div>
              <div className="flex justify-between text-[var(--t-text-muted)]"><span>Paid</span><span className="text-[var(--t-accent)]">{formatCurrency(detail.amount_paid)}</span></div>
              <div className="flex justify-between border-t border-[var(--t-border)] pt-1.5 font-semibold text-[var(--t-text-primary)]"><span>Balance Due</span><span>{formatCurrency(detail.balance_due)}</span></div>
            </div>
          </div>

          {detail.status === "open" && Number(detail.balance_due) > 0 && (
            <div className="mt-6 flex justify-end">
              <button className="flex items-center gap-2 rounded-full bg-[var(--t-accent)] px-6 py-2.5 text-sm font-semibold text-black hover:opacity-90 transition-opacity">
                <CreditCard className="h-4 w-4" /> Pay {formatCurrency(detail.balance_due)}
              </button>
            </div>
          )}

          {detail.summary_of_work && (
            <div className="mt-6 rounded-[20px] bg-[var(--t-bg-primary)] border border-[var(--t-border)] p-4">
              <p className="text-xs font-medium text-[var(--t-text-muted)] mb-1">Summary of Work</p>
              <p className="text-sm text-[var(--t-text-primary)]">{detail.summary_of_work}</p>
            </div>
          )}

          {/* Payment History */}
          {detailLoading ? (
            <div className="mt-6 h-16 rounded-[20px] bg-[var(--t-bg-primary)] border border-[var(--t-border)] animate-pulse" />
          ) : payments.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-3">Payment History</h3>
              <div className="space-y-2">
                {payments.map(p => (
                  <div key={p.id} className="flex items-center justify-between rounded-[16px] border border-[var(--t-border)] bg-[var(--t-bg-primary)] px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-[var(--t-text-primary)]">{formatCurrency(p.amount)} via {p.payment_method}</p>
                      <p className="text-xs text-[var(--t-text-muted)]">{p.processed_at ? new Date(p.processed_at).toLocaleDateString() : new Date(p.created_at).toLocaleDateString()}</p>
                    </div>
                    <span className={`text-xs font-medium ${p.status === "succeeded" ? "text-[var(--t-accent)]" : p.status === "failed" ? "text-[var(--t-error)]" : "text-amber-500"}`}>
                      {p.status === "succeeded" ? "Paid" : p.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)]">Invoices</h1>
        {totalOwed > 0 && (
          <div className="text-sm">
            <span className="text-amber-500 font-medium">Outstanding balance: {formatCurrency(totalOwed)}</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-20 rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] animate-pulse" />)}</div>
      ) : invoices.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-[var(--t-border)] bg-[var(--t-bg-card)] p-8 text-center">
          <FileText className="mx-auto h-10 w-10 text-[var(--t-text-muted)]/30 mb-3" />
          <p className="text-sm font-medium text-[var(--t-text-muted)]">No invoices yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {invoices.map(inv => (
            <button key={inv.id} onClick={() => openDetail(inv)}
              className="w-full text-left rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4 hover:bg-[var(--t-bg-card-hover)] transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-semibold text-[var(--t-text-primary)]">#{inv.invoice_number}</p>
                    {invoiceStatusText(inv.status, inv.due_date)}
                  </div>
                  <div className="flex flex-wrap gap-x-4 text-xs text-[var(--t-text-muted)]">
                    <span>Due: {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : "—"}</span>
                    <span className="font-medium text-[var(--t-text-primary)]">{formatCurrency(inv.total)}</span>
                    {Number(inv.balance_due) > 0 && <span className="text-amber-500">Balance: {formatCurrency(inv.balance_due)}</span>}
                  </div>
                </div>
                {inv.status === "open" && Number(inv.balance_due) > 0 && (
                  <span className="rounded-full bg-[var(--t-accent)] px-3 py-1.5 text-xs font-semibold text-black shrink-0 ml-2">Pay Now</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
