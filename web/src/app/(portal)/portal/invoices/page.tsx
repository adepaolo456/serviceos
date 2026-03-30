"use client";

import { useState, useEffect } from "react";
import { portalApi } from "@/lib/portal-api";
import { formatCurrency } from "@/lib/utils";
import { FileText, CreditCard, CheckCircle2, AlertTriangle, Clock } from "lucide-react";

interface Invoice {
  id: string;
  invoice_number: string;
  status: string;
  due_date: string;
  total: number;
  amount_paid: number;
  balance_due: number;
  line_items: { description: string; quantity: number; unitPrice: number; amount: number }[];
  created_at: string;
  paid_at: string | null;
  notes: string | null;
}

function invoiceStatusBadge(status: string, dueDate: string) {
  const overdue = status === "sent" && new Date(dueDate) < new Date();
  if (overdue) return <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2.5 py-0.5 text-xs font-medium text-red-600"><AlertTriangle className="h-3 w-3" />Overdue</span>;
  const map: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
    draft: { cls: "bg-gray-50 border-gray-200 text-gray-600", icon: <Clock className="h-3 w-3" />, label: "Draft" },
    sent: { cls: "bg-amber-50 border-amber-200 text-amber-700", icon: <FileText className="h-3 w-3" />, label: "Unpaid" },
    paid: { cls: "bg-green-50 border-green-200 text-green-700", icon: <CheckCircle2 className="h-3 w-3" />, label: "Paid" },
  };
  const s = map[status] || map.draft;
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.icon}{s.label}</span>;
}

export default function PortalInvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Invoice | null>(null);

  useEffect(() => {
    portalApi.get<Invoice[]>("/portal/invoices").then(setInvoices).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const unpaid = invoices.filter(i => i.status === "sent");
  const totalOwed = unpaid.reduce((sum, i) => sum + Number(i.balance_due), 0);

  if (detail) {
    return (
      <div className="space-y-6">
        <button onClick={() => setDetail(null)} className="text-sm text-[#2ECC71] font-medium hover:underline">&larr; Back to invoices</button>
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">Invoice {detail.invoice_number}</h2>
              <p className="text-sm text-[#64748B]">Issued {new Date(detail.created_at).toLocaleDateString()}</p>
            </div>
            {invoiceStatusBadge(detail.status, detail.due_date)}
          </div>

          {/* Line items */}
          <table className="w-full text-sm mb-6">
            <thead>
              <tr className="border-b border-[#E2E8F0] text-[#64748B]">
                <th className="text-left pb-2 font-medium">Description</th>
                <th className="text-right pb-2 font-medium">Qty</th>
                <th className="text-right pb-2 font-medium">Rate</th>
                <th className="text-right pb-2 font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {detail.line_items.map((item, i) => (
                <tr key={i} className="border-b border-[#F1F5F9]">
                  <td className="py-2.5 text-[#0F172A]">{item.description}</td>
                  <td className="py-2.5 text-right text-[#64748B]">{item.quantity}</td>
                  <td className="py-2.5 text-right text-[#64748B]">{formatCurrency(item.unitPrice)}</td>
                  <td className="py-2.5 text-right font-medium text-[#0F172A]">{formatCurrency(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Summary */}
          <div className="flex justify-end">
            <div className="w-56 space-y-1.5 text-sm">
              <div className="flex justify-between text-[#64748B]"><span>Total</span><span className="font-medium text-[#0F172A]">{formatCurrency(detail.total)}</span></div>
              <div className="flex justify-between text-[#64748B]"><span>Paid</span><span className="text-green-600">{formatCurrency(detail.amount_paid)}</span></div>
              <div className="flex justify-between border-t border-[#E2E8F0] pt-1.5 font-semibold text-[#0F172A]"><span>Balance Due</span><span>{formatCurrency(detail.balance_due)}</span></div>
            </div>
          </div>

          {detail.status === "sent" && Number(detail.balance_due) > 0 && (
            <div className="mt-6 flex justify-end">
              <button className="flex items-center gap-2 rounded-lg bg-[#2ECC71] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#27AE60]">
                <CreditCard className="h-4 w-4" /> Pay {formatCurrency(detail.balance_due)}
              </button>
            </div>
          )}

          {detail.notes && (
            <div className="mt-6 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] p-4">
              <p className="text-xs font-medium text-[#64748B] mb-1">Notes</p>
              <p className="text-sm text-[#334155]">{detail.notes}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-[#0F172A]">Invoices</h1>
        {totalOwed > 0 && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-sm">
            <span className="text-amber-700 font-medium">Outstanding balance: {formatCurrency(totalOwed)}</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-20 rounded-xl bg-[#E2E8F0] animate-pulse" />)}</div>
      ) : invoices.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#CBD5E1] bg-white p-8 text-center">
          <FileText className="mx-auto h-10 w-10 text-[#CBD5E1] mb-3" />
          <p className="text-sm font-medium text-[#64748B]">No invoices yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {invoices.map(inv => (
            <button key={inv.id} onClick={() => setDetail(inv)}
              className="w-full text-left rounded-xl border border-[#E2E8F0] bg-white p-4 hover:border-[#2ECC71]/30 hover:shadow-sm transition-all">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-semibold text-[#0F172A]">{inv.invoice_number}</p>
                    {invoiceStatusBadge(inv.status, inv.due_date)}
                  </div>
                  <div className="flex flex-wrap gap-x-4 text-xs text-[#64748B]">
                    <span>Due: {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : "—"}</span>
                    <span className="font-medium text-[#0F172A]">{formatCurrency(inv.total)}</span>
                    {Number(inv.balance_due) > 0 && <span className="text-amber-600">Balance: {formatCurrency(inv.balance_due)}</span>}
                  </div>
                </div>
                {inv.status === "sent" && Number(inv.balance_due) > 0 && (
                  <span className="rounded-lg bg-[#2ECC71] px-3 py-1.5 text-xs font-semibold text-white shrink-0 ml-2">Pay Now</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
