"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { portalApi } from "@/lib/portal-api";
import { formatCurrency } from "@/lib/utils";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import { FileText, CreditCard, CheckCircle2, AlertTriangle, Clock } from "lucide-react";

function label(id: string, fallback: string): string {
  return FEATURE_REGISTRY[id]?.label ?? fallback;
}

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

export default function PortalInvoicesPageWrapper() {
  return (
    <Suspense fallback={<div className="py-10 text-center text-sm" style={{ color: "var(--t-text-muted)" }}>Loading invoices...</div>}>
      <PortalInvoicesPage />
    </Suspense>
  );
}

function PortalInvoicesPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Invoice | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [payConfirmInvoice, setPayConfirmInvoice] = useState<Invoice | null>(null);
  const [paying, setPaying] = useState(false);
  const [payResult, setPayResult] = useState<{ success: boolean; message: string } | null>(null);

  const loadInvoices = () => portalApi.get<Invoice[]>("/portal/invoices").then(setInvoices).catch(() => {});

  useEffect(() => {
    loadInvoices().finally(() => setLoading(false));
  }, []);

  // Handle Stripe checkout return via query params
  useEffect(() => {
    const paymentStatus = searchParams.get("payment");
    const invoiceNum = searchParams.get("invoice");
    if (!paymentStatus) return;

    if (paymentStatus === "success") {
      setPayResult({ success: true, message: `${label("portal_payment_success", "Payment submitted successfully")}${invoiceNum ? ` for Invoice #${invoiceNum}` : ""}. It may take a moment for your balance to update.` });
      // Refresh invoices to pick up updated status from webhook
      loadInvoices();
    } else if (paymentStatus === "cancelled") {
      setPayResult({ success: false, message: label("portal_payment_cancelled", "Payment was cancelled. No charge was made.") });
    }
    // Clean up URL params
    router.replace("/portal/invoices", { scroll: false });
  }, [searchParams, router]);

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

  const handlePayInvoice = async (inv: Invoice) => {
    setPaying(true);
    setPayResult(null);
    try {
      const result = await portalApi.post<{ url?: string }>(
        "/portal/payments/prepare",
        { invoiceId: inv.id, amount: inv.balance_due }
      );
      if (result.url) {
        // Redirect to Stripe Checkout — success/cancel handled via return URL params
        window.location.href = result.url;
        return;
      }
      // No checkout URL returned — something went wrong server-side
      setPayResult({ success: false, message: `${label("portal_payment_failed", "Payment could not be processed")}. ${label("portal_payment_try_again", "Please try again or contact us.")}` });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "";
      const message = errMsg === "ONLINE_PAYMENTS_NOT_CONFIGURED"
        ? label("portal_payment_not_configured", "Online payments are not yet available. Please contact us to arrange payment.")
        : `${label("portal_payment_failed", "Payment could not be processed")}. ${label("portal_payment_try_again", "Please try again or contact us.")}`;
      setPayResult({ success: false, message });
    } finally {
      setPaying(false);
    }
  };

  // Sort: unpaid/overdue first (by due_date asc), then paid (by date desc)
  const sortedInvoices = [...invoices].sort((a, b) => {
    const aUnpaid = a.status === "open" && Number(a.balance_due) > 0 ? 1 : 0;
    const bUnpaid = b.status === "open" && Number(b.balance_due) > 0 ? 1 : 0;
    if (aUnpaid !== bUnpaid) return bUnpaid - aUnpaid; // unpaid first
    if (aUnpaid && bUnpaid) return new Date(a.due_date).getTime() - new Date(b.due_date).getTime(); // oldest due first
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime(); // newest first for paid
  });
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
              <button onClick={() => { setPayConfirmInvoice(detail); setPayResult(null); }}
                className="flex items-center gap-2 rounded-full bg-[var(--t-accent)] px-6 py-2.5 text-sm font-semibold text-[var(--t-accent-on-accent)] hover:opacity-90 transition-opacity">
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

      {/* Payment status banner (shown after Stripe checkout return) */}
      {payResult && !payConfirmInvoice && (
        <div className={`rounded-[14px] px-4 py-3 flex items-center gap-3 ${payResult.success ? "bg-[var(--t-accent-soft)] border border-[var(--t-accent)]" : "bg-[var(--t-error-soft)] border border-[var(--t-error)]"}`}>
          {payResult.success ? <CheckCircle2 className="h-4 w-4 text-[var(--t-accent)] shrink-0" /> : <AlertTriangle className="h-4 w-4 text-[var(--t-error)] shrink-0" />}
          <p className="text-sm font-medium text-[var(--t-text-primary)] flex-1">{payResult.message}</p>
          <button onClick={() => setPayResult(null)} className="text-xs font-medium text-[var(--t-text-muted)] shrink-0">Dismiss</button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-20 rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] animate-pulse" />)}</div>
      ) : invoices.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-[var(--t-border)] bg-[var(--t-bg-card)] p-8 text-center">
          <FileText className="mx-auto h-10 w-10 text-[var(--t-text-muted)]/30 mb-3" />
          <p className="text-sm font-medium text-[var(--t-text-muted)]">{label("portal_no_invoices", "No invoices yet")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedInvoices.map(inv => {
            const isOverdue = inv.status === "open" && inv.due_date && new Date(inv.due_date) < new Date();
            const isUnpaid = inv.status === "open" && Number(inv.balance_due) > 0;
            return (
              <button key={inv.id} onClick={() => openDetail(inv)}
                className="w-full text-left rounded-[20px] border p-4 hover:bg-[var(--t-bg-card-hover)] transition-colors"
                style={{
                  borderColor: isOverdue ? "var(--t-error)" : isUnpaid ? "var(--t-warning, #F59E0B)" : "var(--t-border)",
                  backgroundColor: "var(--t-bg-card)",
                }}>
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-semibold text-[var(--t-text-primary)]">#{inv.invoice_number}</p>
                      {invoiceStatusText(inv.status, inv.due_date)}
                    </div>
                    <div className="flex flex-wrap gap-x-4 text-xs text-[var(--t-text-muted)]">
                      <span>Due: {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : "—"}</span>
                      <span className="font-medium text-[var(--t-text-primary)]">{formatCurrency(inv.total)}</span>
                      {isUnpaid && <span className="font-semibold" style={{ color: isOverdue ? "var(--t-error)" : "var(--t-warning, #F59E0B)" }}>Balance: {formatCurrency(inv.balance_due)}</span>}
                    </div>
                  </div>
                  {isUnpaid && (
                    <button onClick={(e) => { e.stopPropagation(); if (!paying) { setPayConfirmInvoice(inv); setPayResult(null); } }}
                      disabled={paying}
                      className="rounded-full bg-[var(--t-accent)] px-4 py-2 text-xs font-semibold text-[var(--t-accent-on-accent)] shrink-0 ml-2 hover:opacity-90 transition-opacity disabled:opacity-40">
                      {label("portal_pay_now", "Pay Now")}
                    </button>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Payment Confirmation Modal */}
      {payConfirmInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => { setPayConfirmInvoice(null); setPayResult(null); }}>
          <div className="rounded-2xl border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            {payResult ? (
              <div className="text-center py-4">
                <div className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full ${payResult.success ? "bg-[var(--t-accent-soft)]" : "bg-[var(--t-error-soft)]"}`}>
                  {payResult.success ? (
                    <CheckCircle2 className="h-6 w-6 text-[var(--t-accent)]" />
                  ) : (
                    <AlertTriangle className="h-6 w-6 text-[var(--t-error)]" />
                  )}
                </div>
                <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-1">
                  {payResult.success ? label("portal_payment_success", "Payment submitted successfully") : label("portal_payment_failed", "Payment could not be processed")}
                </h3>
                <p className="text-xs text-[var(--t-text-muted)]">
                  {payResult.success ? payResult.message : label("portal_payment_try_again", "Please try again or contact us.")}
                </p>
                <div className="flex gap-2 justify-center mt-4">
                  <button onClick={() => { setPayConfirmInvoice(null); setPayResult(null); }}
                    className="rounded-full bg-[var(--t-accent)] px-5 py-2 text-sm font-semibold text-[var(--t-accent-on-accent)] hover:opacity-90 transition-opacity">
                    {label("portal_account_view_invoices", "View Invoices")}
                  </button>
                  <Link href="/portal"
                    className="rounded-full border border-[var(--t-border)] px-5 py-2 text-sm font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
                    {label("portal_back_to_dashboard", "Back to Dashboard")}
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-2">{label("portal_confirm_payment", "Confirm Payment")}</h3>
                <p className="text-sm text-[var(--t-text-muted)] mb-4">
                  Pay <span className="font-bold text-[var(--t-text-primary)]">{formatCurrency(payConfirmInvoice.balance_due)}</span> for Invoice <span className="font-bold text-[var(--t-text-primary)]">#{payConfirmInvoice.invoice_number}</span>?
                </p>
                <div className="rounded-[16px] bg-[var(--t-bg-primary)] border border-[var(--t-border)] p-3 mb-4">
                  <div className="flex justify-between text-xs text-[var(--t-text-muted)]">
                    <span>Invoice Total</span>
                    <span className="text-[var(--t-text-primary)] font-medium">{formatCurrency(payConfirmInvoice.total)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-[var(--t-text-muted)] mt-1">
                    <span>Already Paid</span>
                    <span className="text-[var(--t-accent)]">{formatCurrency(Number(payConfirmInvoice.total) - Number(payConfirmInvoice.balance_due))}</span>
                  </div>
                  <div className="flex justify-between text-xs font-semibold text-[var(--t-text-primary)] mt-1.5 pt-1.5 border-t border-[var(--t-border)]">
                    <span>Amount Due</span>
                    <span>{formatCurrency(payConfirmInvoice.balance_due)}</span>
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => { setPayConfirmInvoice(null); setPayResult(null); }}
                    className="rounded-full px-4 py-2 text-xs font-medium text-[var(--t-text-muted)]">Cancel</button>
                  <button onClick={() => handlePayInvoice(payConfirmInvoice)} disabled={paying}
                    className="flex items-center gap-1.5 rounded-full bg-[var(--t-accent)] px-5 py-2 text-sm font-semibold text-[var(--t-accent-on-accent)] disabled:opacity-40 hover:opacity-90 transition-opacity">
                    <CreditCard className="h-4 w-4" />
                    {paying ? label("portal_payment_processing", "Processing payment...") : `Pay ${formatCurrency(payConfirmInvoice.balance_due)}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
