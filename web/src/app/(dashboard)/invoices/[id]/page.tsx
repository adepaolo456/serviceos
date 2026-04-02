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
  Pencil,
  Plus,
  Trash2,
  Clock,
  Copy,
} from "lucide-react";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";
import RentalChainTimeline from "@/components/rental-chain-timeline";

interface ApiLineItem {
  id: string;
  line_type: string;
  name: string;
  description?: string;
  quantity: number;
  unit_rate: number;
  amount: number;
  discount_amount: number;
  net_amount: number;
  is_taxable: boolean;
  tax_rate: number;
  tax_amount: number;
  sort_order: number;
}

/* Adaptor so the existing edit form still works with description/unitPrice */
interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface Invoice {
  id: string;
  invoice_number: number;
  revision: number;
  status: string;
  customer_type: string;
  invoice_date: string;
  due_date: string;
  service_date: string;
  subtotal: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  total_cogs: number;
  profit: number;
  summary_of_work: string;
  rental_chain_id: string | null;
  job_id: string | null;
  line_items: ApiLineItem[];
  notes?: string;
  sent_at: string;
  paid_at: string;
  voided_at: string;
  created_at: string;
  customer: { id: string; first_name: string; last_name: string; email: string; company_name?: string } | null;
  job: { id: string; job_number: string; asset_subtype?: string; service_type?: string; rental_days?: number; base_price?: number; total_price?: number; extra_day_rate?: number; asset?: { id: string; identifier: string; subtype?: string } } | null;
  payments?: Array<{ id: string; amount: number; payment_method: string; applied_at: string; notes?: string }>;
  revisions?: Array<{ id: string; revision_number: number; change_summary: string; changed_at: string }>;
  last_contacted_at?: string;
  contact_attempt_count?: number;
  last_contact_method?: string;
  promise_to_pay_date?: string;
  promise_to_pay_amount?: number;
  dispute_status?: string;
  dispute_notes?: string;
}

interface PricingRule {
  id: string;
  name: string;
  service_type: string;
  asset_subtype: string;
  base_price: number;
  delivery_fee: number;
  rental_period_days: number;
  extra_day_rate: number;
  included_tons: number;
  overage_per_ton: number;
  included_miles: number;
  per_mile_charge: number;
}

interface Payment {
  id: string;
  amount: number;
  payment_method: string;
  status: string;
  notes: string;
  reference_number: string;
  applied_at: string;
}

interface PaymentsResponse {
  data: Payment[];
  meta: { total: number };
}

const STATUS_TEXT: Record<string, string> = {
  draft: "text-[var(--t-text-muted)]",
  sent: "text-blue-400",
  delivered: "text-blue-400",
  read: "text-teal-400",
  partial: "text-amber-400",
  paid: "text-[var(--t-accent)]",
  overdue: "text-[var(--t-error)]",
  voided: "text-[var(--t-text-muted)]",
  void: "text-[var(--t-text-muted)]",
};

const PAYMENT_STATUS: Record<string, string> = {
  pending: "text-yellow-500",
  succeeded: "text-[var(--t-accent)]",
  failed: "text-[var(--t-error)]",
  refunded: "text-purple-400",
};

import { formatCurrency } from "@/lib/utils";
const fmt = (n: number | null | undefined) => formatCurrency(n as number);

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
  const [editing, setEditing] = useState(false);
  const [editItems, setEditItems] = useState<{ description: string; quantity: number; unitPrice: number }[]>([]);
  const [editDueDate, setEditDueDate] = useState("");
  const [editDiscount, setEditDiscount] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [newAssetSubtype, setNewAssetSubtype] = useState<string | null>(null);
  const [pricingRules, setPricingRules] = useState<PricingRule[]>([]);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const { toast } = useToast();

  const fetchData = async () => {
    try {
      const inv = await api.get<Invoice>(`/invoices/${id}`);
      setInvoice(inv);
      setPayments((inv.payments as Payment[]) || []);
    } catch {
      /* handled */
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try { setHistory(await api.get<any[]>(`/invoices/${id}/revisions`)); }
    catch { /* */ } finally { setHistoryLoading(false); }
  };

  // Close add menu on click outside (delayed to avoid same-tick close)
  useEffect(() => {
    if (!addMenuOpen) return;
    const close = () => setAddMenuOpen(false);
    const timer = setTimeout(() => window.addEventListener("click", close), 0);
    return () => { clearTimeout(timer); window.removeEventListener("click", close); };
  }, [addMenuOpen]);

  useEffect(() => {
    fetchData();
    fetchHistory();
    api.get<{ data: PricingRule[] }>("/pricing").then(r => setPricingRules(r.data || [])).catch(() => {});
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
    const reason = prompt(`Void Invoice #${invoice.invoice_number}?\n\nThis will create a credit memo for ${fmt(invoice.total)} and cannot be undone.\n\nEnter reason:`);
    if (!reason) return;
    setActionLoading(true);
    try {
      await api.post(`/invoices/${id}/void`, { reason });
      toast("success", "Invoice voided — credit memo created");
      await fetchData();
    } catch {
      toast("error", "Failed to void invoice");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDuplicate = async () => {
    if (!invoice || actionLoading) return;
    if (!confirm(`Create a copy of Invoice #${invoice.invoice_number} as a new draft?`)) return;
    setActionLoading(true);
    try {
      const dup = await api.post<{ id: string }>(`/invoices/${id}/duplicate`);
      toast("success", "Invoice duplicated");
      if (dup?.id) window.location.href = `/invoices/${dup.id}`;
    } catch {
      toast("error", "Failed to duplicate");
    } finally {
      setActionLoading(false);
    }
  };

  const isPaid = invoice?.status === "paid";
  const isVoid = invoice?.status === "voided" || invoice?.status === "void";

  const startEditing = () => {
    if (!invoice) return;
    setEditItems(invoice.line_items.map(li => ({ description: li.name, quantity: Number(li.quantity), unitPrice: Number(li.unit_rate) })));
    setEditDueDate(invoice.due_date || "");
    setEditDiscount("0");
    setEditNotes(invoice.summary_of_work || "");
    setNewAssetSubtype(null);
    setEditing(true);
  };

  const cancelEditing = () => { setEditing(false); setNewAssetSubtype(null); };

  const currentSubtype = invoice?.job?.asset_subtype || invoice?.job?.asset?.subtype || null;
  const currentRule = pricingRules.find(r => r.asset_subtype === currentSubtype);
  const activeRule = newAssetSubtype ? pricingRules.find(r => r.asset_subtype === newAssetSubtype) : currentRule;

  const buildRentalDesc = (rule: PricingRule) => {
    const parts = [`${rule.asset_subtype} Dumpster Rental`];
    const details: string[] = [];
    if (rule.rental_period_days) details.push(`${rule.rental_period_days} day rental`);
    if (Number(rule.included_tons) > 0) details.push(`${rule.included_tons} tons included`);
    if (Number(rule.extra_day_rate) > 0) details.push(`${fmt(rule.extra_day_rate)}/day extra`);
    if (Number(rule.overage_per_ton) > 0) details.push(`${fmt(rule.overage_per_ton)}/ton overage`);
    if (details.length) parts.push(details.join(", "));
    return parts.join(" — ");
  };

  const handleSizeChange = (size: string) => {
    if (!size || size === currentSubtype) { setNewAssetSubtype(null); return; }
    if (!confirm(`Changing from ${currentSubtype || "current"} to ${size} will update pricing, job details, and asset assignment. Continue?`)) return;
    const rule = pricingRules.find(r => r.asset_subtype === size);
    if (!rule) return;
    setNewAssetSubtype(size);
    // Replace auto-generated lines, keep manual ones (custom charges, discounts)
    const manualItems = editItems.filter(li =>
      !li.description.includes("Dumpster Rental") && !li.description.includes("Delivery") &&
      li.description !== "" && li.unitPrice !== 0
    );
    const items: { description: string; quantity: number; unitPrice: number }[] = [
      { description: buildRentalDesc(rule), quantity: 1, unitPrice: Number(rule.base_price) },
    ];
    if (Number(rule.delivery_fee) > 0) {
      items.push({ description: "Delivery Fee", quantity: 1, unitPrice: Number(rule.delivery_fee) });
    }
    setEditItems([...items, ...manualItems]);
  };

  const addPredefinedItem = (type: string) => {
    const rule = activeRule;
    setAddMenuOpen(false);
    switch (type) {
      case "rental":
        setEditItems(prev => [...prev, { description: rule ? buildRentalDesc(rule) : "Dumpster Rental", quantity: 1, unitPrice: Number(rule?.base_price || 0) }]);
        break;
      case "delivery":
        setEditItems(prev => [...prev, { description: "Delivery Fee", quantity: 1, unitPrice: Number(rule?.delivery_fee || 0) }]);
        break;
      case "extra_days":
        setEditItems(prev => [...prev, { description: `Extra days @ ${fmt(rule?.extra_day_rate || 0)}/day`, quantity: 1, unitPrice: Number(rule?.extra_day_rate || 0) }]);
        break;
      case "overage":
        setEditItems(prev => [...prev, { description: `Weight overage @ ${fmt(rule?.overage_per_ton || 0)}/ton`, quantity: 1, unitPrice: Number(rule?.overage_per_ton || 0) }]);
        break;
      case "discount": {
        const amt = prompt("Discount amount (enter as positive number):");
        if (!amt) return;
        setEditItems(prev => [...prev, { description: "Discount", quantity: 1, unitPrice: -Math.abs(Number(amt)) }]);
        break;
      }
      case "custom":
        setEditItems(prev => [...prev, { description: "", quantity: 1, unitPrice: 0 }]);
        break;
    }
  };

  const saveEditing = async () => {
    if (!invoice) return;
    setActionLoading(true);
    try {
      const body: Record<string, unknown> = { notes: editNotes };
      if (!isPaid) {
        body.lineItems = editItems;
        body.dueDate = editDueDate;
        body.discountAmount = Number(editDiscount) || 0;
      }
      if (newAssetSubtype) body.newAssetSubtype = newAssetSubtype;
      const result = await api.patch<any>(`/invoices/${invoice.id}/edit`, body);
      setEditing(false);
      setNewAssetSubtype(null);
      if (result?.cascade) {
        const c = result.cascade;
        const msg = c.upgrade
          ? `Upgraded to ${newAssetSubtype} — Price increased by ${fmt(c.difference)}. New balance: ${fmt(c.newBalanceDue)}`
          : c.downgrade
            ? `Downgraded to ${newAssetSubtype} — ${fmt(c.credit)} credit applied`
            : "Invoice updated";
        toast("success", msg);
        if (c.assetWarning) toast("error", c.assetWarning);
      } else {
        toast("success", "Invoice updated");
      }
      await fetchData();
      await fetchHistory();
    } catch { toast("error", "Failed to save"); }
    finally { setActionLoading(false); }
  };

  const updateEditItem = (i: number, field: string, value: string) => {
    setEditItems(prev => prev.map((li, idx) => idx === i ? { ...li, [field]: field === "description" ? value : Number(value) || 0 } : li));
  };
  const addEditItem = () => setEditItems(prev => [...prev, { description: "", quantity: 1, unitPrice: 0 }]);
  const removeEditItem = (i: number) => setEditItems(prev => prev.filter((_, idx) => idx !== i));

  // Computed totals for edit mode — negative unitPrice items are discounts
  const editSubtotal = editItems.filter(li => li.unitPrice >= 0).reduce((s, li) => s + li.quantity * li.unitPrice, 0);
  const editDiscountsFromItems = Math.abs(editItems.filter(li => li.unitPrice < 0).reduce((s, li) => s + li.quantity * li.unitPrice, 0));
  const editDiscountNum = (Number(editDiscount) || 0) + editDiscountsFromItems;
  const editTotal = Math.round((editSubtotal - editDiscountNum) * 100) / 100;
  const editBalanceDue = Math.round((editTotal - Number(invoice?.amount_paid || 0)) * 100) / 100;

  const inp = "w-full rounded-[14px] border border-[var(--t-border)] bg-transparent px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)]";

  if (loading) {
    return (
      <div className="py-10">
        <div className="mb-6 h-4 w-32 animate-pulse rounded bg-[var(--t-bg-card)]" />
        <div className="mb-8 flex items-start justify-between">
          <div className="space-y-2">
            <div className="h-7 w-36 animate-pulse rounded bg-[var(--t-bg-card)]" />
            <div className="h-4 w-52 animate-pulse rounded bg-[var(--t-bg-card)]" />
          </div>
          <div className="flex gap-2">
            <div className="h-9 w-24 animate-pulse rounded-full bg-[var(--t-bg-card)]" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <div className="grid grid-cols-2 gap-4">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5">
                  <div className="h-3 w-16 animate-pulse rounded bg-[var(--t-border)] mb-3" />
                  <div className="h-4 w-28 animate-pulse rounded bg-[var(--t-border)]" />
                </div>
              ))}
            </div>
            <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-6">
              <div className="h-5 w-24 animate-pulse rounded bg-[var(--t-border)] mb-4" />
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-4 w-full animate-pulse rounded bg-[var(--t-border)]" />
                ))}
              </div>
            </div>
          </div>
          <div>
            <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-6">
              <div className="h-5 w-20 animate-pulse rounded bg-[var(--t-border)] mb-5" />
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-4 w-full animate-pulse rounded bg-[var(--t-border)]" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="flex items-center justify-center py-32 text-[var(--t-text-muted)]">
        Invoice not found
      </div>
    );
  }

  const canSend = invoice.status === "draft";
  const canPay = ["open", "partial", "overdue"].includes(invoice.status);
  const canVoid = !["paid", "voided", "void"].includes(invoice.status);

  return (
    <div>
      <Link
        href="/invoices"
        className="mb-6 inline-flex items-center gap-2 text-sm text-[var(--t-frame-text-muted)] transition-colors hover:text-[var(--t-frame-text)]"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Invoices
      </Link>

      {/* Rental Chain Timeline */}
      {invoice.rental_chain_id && (
        <RentalChainTimeline chainId={invoice.rental_chain_id} currentJobId={invoice.job_id || undefined} />
      )}

      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)]">
              #{invoice.invoice_number}
            </h1>
            <span
              className={`text-xs font-medium capitalize ${STATUS_TEXT[invoice.status] || ""}`}
            >
              {invoice.status}
            </span>
            {invoice.revision > 1 && (
              <span className="text-xs text-[var(--t-text-muted)]">Rev {invoice.revision}</span>
            )}
          </div>
          <p className="text-sm text-[var(--t-frame-text-muted)]">
            Created {new Date(invoice.created_at).toLocaleDateString()}
            {invoice.sent_at &&
              ` · Sent ${new Date(invoice.sent_at).toLocaleDateString()}`}
            {invoice.paid_at &&
              ` · Paid ${new Date(invoice.paid_at).toLocaleDateString()}`}
          </p>
        </div>
        <div className="flex gap-2">
          {editing ? (
            <>
              <button onClick={saveEditing} disabled={actionLoading}
                className="flex items-center gap-2 rounded-full bg-[var(--t-accent)] px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50">
                {actionLoading ? "Saving..." : "Save Changes"}
              </button>
              <button onClick={cancelEditing}
                className="flex items-center gap-2 rounded-full border border-[var(--t-border)] px-5 py-2.5 text-sm font-medium text-[var(--t-frame-text-muted)] transition-colors hover:text-[var(--t-frame-text)]">
                Cancel
              </button>
            </>
          ) : (
            <>
              {canSend && (
                <button onClick={handleSend} disabled={actionLoading}
                  className="flex items-center gap-2 rounded-full bg-[var(--t-accent)] px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50">
                  <Send className="h-4 w-4" /> Send
                </button>
              )}
              {canPay && (
                <button onClick={() => setPaymentPanel(true)}
                  className="flex items-center gap-2 rounded-full bg-[var(--t-accent)] px-4 py-2 text-sm font-medium text-black transition-opacity hover:opacity-90">
                  <CreditCard className="h-4 w-4" /> Record Payment
                </button>
              )}
              {!isVoid && (
                <button onClick={startEditing}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-[var(--t-accent)] text-[var(--t-accent)] hover:bg-[var(--t-accent)] hover:text-white transition-colors">
                  <Pencil className="h-4 w-4" /> {isPaid ? "Edit Notes" : "Edit"}
                </button>
              )}
              <button onClick={handleDuplicate} disabled={actionLoading}
                className="flex items-center gap-2 px-4 py-2 rounded-full border border-[var(--t-border)] text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] transition-colors disabled:opacity-50">
                <Copy className="h-4 w-4" /> Duplicate
              </button>
              {canVoid && (
                <button onClick={handleVoid} disabled={actionLoading}
                  className="flex items-center gap-2 rounded-full border border-[var(--t-error)]/20 bg-transparent px-4 py-2 text-sm font-medium text-[var(--t-error)] transition-colors hover:bg-[var(--t-error-soft)] disabled:opacity-50">
                  <XCircle className="h-4 w-4" /> Void
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Info cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5">
              <div className="flex items-center gap-2 mb-2">
                <User className="h-4 w-4 text-[var(--t-text-muted)]" />
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">
                  Customer
                </span>
              </div>
              {invoice.customer ? (
                <Link
                  href={`/customers/${invoice.customer.id}`}
                  className="text-sm font-medium text-[var(--t-text-primary)] hover:text-[var(--t-accent)] transition-colors"
                >
                  {invoice.customer.first_name} {invoice.customer.last_name}
                </Link>
              ) : (
                <p className="text-sm text-[var(--t-text-muted)]">—</p>
              )}
              {invoice.customer?.email && (
                <p className="text-xs text-[var(--t-text-muted)] mt-0.5">
                  {invoice.customer.email}
                </p>
              )}
            </div>
            <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5">
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="h-4 w-4 text-[var(--t-text-muted)]" />
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">
                  Due Date
                </span>
              </div>
              {editing && !isPaid ? (
                <input type="date" value={editDueDate} onChange={e => setEditDueDate(e.target.value)} className={inp} />
              ) : (
                <p className="text-sm font-medium text-[var(--t-text-primary)]">{invoice.due_date || "Not set"}</p>
              )}
              {invoice.job && (
                <Link
                  href={`/jobs/${invoice.job.id}`}
                  className="flex items-center gap-1 mt-1 text-xs text-[var(--t-accent)] hover:underline"
                >
                  <FileText className="h-3 w-3" />
                  Job {invoice.job.job_number}
                </Link>
              )}
            </div>
          </div>

          {/* Line items */}
          <div className={`rounded-[20px] bg-[var(--t-bg-card)] border overflow-hidden ${editing && !isPaid ? "border-[var(--t-accent)]/30" : "border-[var(--t-border)]"}`}>
            <div className="px-6 py-4 border-b border-[var(--t-border)]">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-[var(--t-text-primary)]">Line Items</h2>
                {!editing && currentSubtype && (
                  <span className="text-xs font-medium text-[var(--t-text-muted)]">{currentSubtype} Dumpster</span>
                )}
              </div>
              {editing && !isPaid && invoice.job && (
                <div className="mt-3 flex items-center gap-3 flex-wrap">
                  <span className="text-xs text-[var(--t-text-muted)]">Dumpster Size:</span>
                  <select value={newAssetSubtype || currentSubtype || ""} onChange={e => handleSizeChange(e.target.value)}
                    className="rounded-[12px] border border-[var(--t-border)] bg-transparent px-3 py-1.5 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)]">
                    {pricingRules.filter(r => r.asset_subtype).map(r => (
                      <option key={r.id} value={r.asset_subtype}>{r.asset_subtype} — {fmt(r.base_price)}</option>
                    ))}
                  </select>
                  {newAssetSubtype && newAssetSubtype !== currentSubtype && (
                    <span className="text-xs font-medium px-2 py-1 rounded-full bg-[var(--t-accent-soft)] text-[var(--t-accent)]">
                      {currentSubtype} → {newAssetSubtype}
                      {currentRule && (() => { const newR = pricingRules.find(r => r.asset_subtype === newAssetSubtype); if (!newR) return ""; const diff = Number(newR.base_price) - Number(currentRule.base_price); return diff > 0 ? ` (+${fmt(diff)})` : diff < 0 ? ` (${fmt(diff)})` : ""; })()}
                    </span>
                  )}
                </div>
              )}
            </div>
            <table className="w-full text-sm table-fixed">
              <thead>
                <tr className="border-b border-[var(--t-border)]">
                  <th className="w-[50%] px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Description</th>
                  <th className="w-[10%] px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Qty</th>
                  <th className="w-[15%] px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Unit Price</th>
                  <th className="w-[15%] px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Amount</th>
                  {editing && !isPaid && <th className="w-[10%] px-3 py-3"></th>}
                </tr>
              </thead>
              <tbody>
                {editing && !isPaid ? (
                  <>
                    {editItems.map((item, i) => {
                      const amt = item.quantity * item.unitPrice;
                      const isNeg = item.unitPrice < 0;
                      return (
                        <tr key={i} className="border-b border-[var(--t-border)] last:border-0">
                          <td className="px-6 py-2.5"><input value={item.description} onChange={e => updateEditItem(i, "description", e.target.value)} className={`${inp} w-full`} placeholder="Description" /></td>
                          <td className="px-3 py-2.5"><input type="number" value={item.quantity} onChange={e => updateEditItem(i, "quantity", e.target.value)} className={`${inp} w-full text-right`} /></td>
                          <td className="px-3 py-2.5"><input type="number" step="0.01" value={item.unitPrice} onChange={e => updateEditItem(i, "unitPrice", e.target.value)} className={`${inp} w-full text-right`} /></td>
                          <td className={`px-3 py-2.5 text-right font-medium tabular-nums ${isNeg ? "text-[var(--t-error)]" : "text-[var(--t-text-primary)]"}`}>{fmt(amt)}</td>
                          <td className="px-3 py-2.5 text-center"><button onClick={() => removeEditItem(i)} className="p-1.5 rounded-lg hover:bg-[var(--t-bg-card-hover)] text-[var(--t-text-muted)] hover:text-[var(--t-error)] transition-colors"><Trash2 className="h-3.5 w-3.5" /></button></td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td colSpan={5} className="px-6 py-3 relative">
                        <button onClick={e => { e.stopPropagation(); setAddMenuOpen(!addMenuOpen); }} className="flex items-center gap-1.5 text-xs font-medium text-[var(--t-accent)] hover:opacity-80">
                          <Plus className="h-3.5 w-3.5" /> Add Line Item
                        </button>
                        {addMenuOpen && (
                          <div className="absolute left-6 bottom-full mb-1 z-20 rounded-xl border border-[var(--t-border)] bg-[var(--t-bg-card)] shadow-xl py-1 min-w-[240px]"
                            onClick={e => e.stopPropagation()}>
                            {[
                              { key: "rental", label: "Dumpster Rental", sub: activeRule ? fmt(activeRule.base_price) : "" },
                              { key: "delivery", label: "Delivery Fee", sub: activeRule ? fmt(activeRule.delivery_fee) : "" },
                              { key: "extra_days", label: "Extra Day Charges", sub: activeRule ? `${fmt(activeRule.extra_day_rate)}/day` : "" },
                              { key: "overage", label: "Weight Overage", sub: activeRule ? `${fmt(activeRule.overage_per_ton)}/ton` : "" },
                              { key: "discount", label: "Discount (credit)", sub: "enter amount" },
                              { key: "custom", label: "Custom Charge", sub: "blank row" },
                            ].map(opt => (
                              <button key={opt.key} onClick={() => addPredefinedItem(opt.key)}
                                className="flex w-full items-center justify-between px-4 py-2.5 text-sm hover:bg-[var(--t-bg-card-hover)] transition-colors">
                                <span className="text-[var(--t-text-primary)]">{opt.label}</span>
                                {opt.sub && <span className="text-xs text-[var(--t-text-muted)]">{opt.sub}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  </>
                ) : (
                  invoice.line_items.map((item, i) => {
                    const isNeg = Number(item.net_amount) < 0;
                    return (
                      <tr key={item.id || i} className="border-b border-[var(--t-border)] last:border-0">
                        <td className="px-6 py-3.5 text-[var(--t-text-primary)]">{item.name}</td>
                        <td className="px-3 py-3.5 text-right text-[var(--t-text-primary)]">{item.quantity}</td>
                        <td className={`px-3 py-3.5 text-right tabular-nums ${isNeg ? "text-[var(--t-error)]" : "text-[var(--t-text-primary)]"}`}>{fmt(Number(item.unit_rate))}</td>
                        <td className={`px-3 py-3.5 text-right font-medium tabular-nums ${isNeg ? "text-[var(--t-error)]" : "text-[var(--t-text-primary)]"}`}>{fmt(Number(item.net_amount))}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Payment history */}
          <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--t-border)]">
              <h2 className="text-base font-semibold text-[var(--t-text-primary)]">
                Payment History ({payments.length})
              </h2>
            </div>
            {payments.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-[var(--t-text-muted)]">
                No payments recorded
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--t-border)]">
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">
                      Method
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">
                      Status
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-[var(--t-border)] last:border-0"
                    >
                      <td className="px-6 py-3.5 text-[var(--t-text-primary)]">
                        {new Date(p.applied_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-3.5 text-[var(--t-text-primary)] capitalize">
                        {p.payment_method}
                      </td>
                      <td className="px-6 py-3.5">
                        <span
                          className={`text-xs font-medium capitalize ${PAYMENT_STATUS[p.status] || ""}`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-right font-medium text-[var(--t-text-primary)] tabular-nums">
                        {fmt(p.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {/* Audit History */}
          <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--t-border)]">
              <h2 className="text-base font-semibold text-[var(--t-text-primary)]">
                History
              </h2>
            </div>
            {historyLoading ? (
              <div className="px-6 py-8 text-center text-sm text-[var(--t-text-muted)]">Loading...</div>
            ) : history.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-[var(--t-text-muted)]">No history entries</div>
            ) : (
              <div className="divide-y divide-[var(--t-border)]">
                {history.map((entry: any) => {
                  const when = new Date(entry.changed_at || entry.created_at).toLocaleString();
                  const summary = entry.change_summary || `Revision ${entry.revision_number}`;
                  return (
                    <div key={entry.id} className="px-6 py-3 flex items-start gap-3">
                      <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[var(--t-text-muted)]" />
                      <div className="min-w-0">
                        <p className="text-sm text-[var(--t-text-primary)]">
                          <span className="font-medium">Rev {entry.revision_number}</span>{" "}
                          {summary}
                        </p>
                        <p className="text-xs text-[var(--t-text-muted)]">{when}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar totals */}
        <div className="space-y-6">
          <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-6">
            <div className="flex items-center gap-2 mb-5">
              <DollarSign className="h-4 w-4 text-[var(--t-accent)]" />
              <h3 className="text-base font-semibold text-[var(--t-text-primary)]">
                Summary
              </h3>
            </div>
            <div className="space-y-2.5 text-sm tabular-nums">
              <div className="flex justify-between text-[var(--t-text-primary)]">
                <span className="text-[var(--t-text-muted)]">Subtotal</span>
                <span>{fmt(editing && !isPaid ? editSubtotal : invoice.subtotal)}</span>
              </div>
              {editing && !isPaid ? (
                editDiscountNum > 0 ? (
                  <div className="flex justify-between text-[var(--t-text-primary)]">
                    <span className="text-[var(--t-text-muted)]">Discounts</span>
                    <span className="text-[var(--t-error)]">-{fmt(editDiscountNum)}</span>
                  </div>
                ) : null
              ) : null}
              {Number(invoice.tax_amount) > 0 && (
                <div className="flex justify-between text-[var(--t-text-primary)]">
                  <span className="text-[var(--t-text-muted)]">Tax</span>
                  <span>{fmt(invoice.tax_amount)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-[var(--t-border)] pt-2.5 font-semibold text-[var(--t-text-primary)]">
                <span>Total</span>
                <span>{fmt(editing && !isPaid ? editTotal : invoice.total)}</span>
              </div>
              <div className="flex justify-between text-[var(--t-text-primary)]">
                <span className="text-[var(--t-text-muted)]">Paid</span>
                <span className="text-[var(--t-accent)]">{fmt(invoice.amount_paid)}</span>
              </div>
              {Number(invoice.profit) !== 0 && (
                <div className="flex justify-between text-[var(--t-text-primary)]">
                  <span className="text-[var(--t-text-muted)]">Profit</span>
                  <span className={Number(invoice.profit) > 0 ? "text-emerald-400" : "text-[var(--t-error)]"}>{fmt(invoice.profit)}</span>
                </div>
              )}
              {(() => {
                const bd = editing && !isPaid ? editBalanceDue : Number(invoice.balance_due);
                return (
                  <div className={`flex justify-between border-t border-[var(--t-border)] pt-2.5 font-bold text-base ${bd <= 0 ? "text-emerald-400" : invoice.status === "overdue" ? "text-[var(--t-error)]" : "text-[var(--t-text-primary)]"}`}>
                    <span>Balance Due</span>
                    <span>{bd <= 0 ? "PAID" : fmt(bd)}</span>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Notes */}
          <div className={`rounded-[20px] bg-[var(--t-bg-card)] border p-6 ${editing ? "border-[var(--t-accent)]/30" : "border-[var(--t-border)]"}`}>
            <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-2">Notes</h3>
            {editing ? (
              <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={3}
                className="w-full rounded-[14px] border border-[var(--t-border)] bg-transparent px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] resize-none"
                placeholder="Invoice notes..." />
            ) : invoice.summary_of_work ? (
              <p className="text-sm text-[var(--t-text-primary)] whitespace-pre-wrap">{invoice.summary_of_work}</p>
            ) : (
              <p className="text-sm text-[var(--t-text-muted)]">No notes</p>
            )}
          </div>
        </div>
      </div>

      {/* Collections */}
      {(invoice.status === 'open' || invoice.status === 'overdue' || invoice.status === 'partial') && (
        <div className="rounded-[20px] border p-5 mt-6" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--t-text-primary)" }}>Collections</h3>
          <div className="space-y-3">
            {/* Log Contact */}
            <div className="flex gap-2">
              <select id="contactMethod" className="rounded-lg border px-3 py-2 text-xs" style={{ background: "var(--t-bg-primary)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}>
                <option value="phone">Phone</option>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
              <button onClick={async () => {
                const method = (document.getElementById('contactMethod') as HTMLSelectElement)?.value || 'phone';
                try {
                  await api.patch(`/invoices/${invoice.id}/collections`, { lastContactMethod: method });
                  toast("success", "Contact logged");
                  fetchData();
                } catch { toast("error", "Failed"); }
              }} className="rounded-lg px-3 py-2 text-xs font-medium" style={{ background: "var(--t-accent-soft)", color: "var(--t-accent)" }}>
                Log Contact
              </button>
            </div>
            {/* Info */}
            {invoice.last_contacted_at && (
              <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>
                Last contacted: {new Date(invoice.last_contacted_at).toLocaleDateString()} via {invoice.last_contact_method}
                {' '}({invoice.contact_attempt_count || 0} attempts)
              </p>
            )}
            {/* Promise to Pay */}
            <div className="flex items-center gap-2">
              <input type="date" id="ptpDate" className="rounded-lg border px-3 py-2 text-xs" style={{ background: "var(--t-bg-primary)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} />
              <button onClick={async () => {
                const ptpDate = (document.getElementById('ptpDate') as HTMLInputElement)?.value;
                if (!ptpDate) return;
                try {
                  await api.patch(`/invoices/${invoice.id}/collections`, { promiseToPayDate: ptpDate });
                  toast("success", "Promise recorded");
                  fetchData();
                } catch { toast("error", "Failed"); }
              }} className="rounded-lg px-3 py-2 text-xs font-medium" style={{ background: "var(--t-accent-soft)", color: "var(--t-accent)" }}>
                Record Promise
              </button>
            </div>
            {invoice.promise_to_pay_date && (
              <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>Promise to pay by: {invoice.promise_to_pay_date}</p>
            )}
            {/* Dispute */}
            <div className="flex items-center gap-2">
              <button onClick={async () => {
                const notes = prompt("Dispute notes:");
                if (!notes) return;
                try {
                  await api.patch(`/invoices/${invoice.id}/collections`, { disputeStatus: 'disputed', disputeNotes: notes });
                  toast("success", "Marked as disputed");
                  fetchData();
                } catch { toast("error", "Failed"); }
              }} className="rounded-lg px-3 py-2 text-xs font-medium border" style={{ borderColor: "var(--t-error)", color: "var(--t-error)" }}>
                Mark Disputed
              </button>
              {invoice.dispute_status === 'disputed' && (
                <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: "rgba(220,38,38,0.08)", color: "#DC2626" }}>DISPUTED</span>
              )}
            </div>
            {invoice.dispute_notes && <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>Dispute: {invoice.dispute_notes}</p>}
          </div>
        </div>
      )}

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
      await api.post(`/invoices/${invoiceId}/payments`, {
        amount: Number(amount),
        payment_method: method,
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
    "w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2.5 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none transition-colors focus:border-[var(--t-accent)]";
  const labelClass = "block text-sm font-medium text-[var(--t-text-primary)] mb-1.5";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-[20px] bg-[var(--t-error-soft)] px-4 py-3 text-sm text-[var(--t-error)]">
          {error}
        </div>
      )}

      <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-4 text-center">
        <p className="text-xs text-[var(--t-text-muted)] mb-1">Balance Due</p>
        <p className="text-2xl font-bold text-[var(--t-text-primary)] tabular-nums">
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
        <div className="grid grid-cols-4 gap-1 rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-1">
          {(["card", "ach", "cash", "check"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={`rounded-[10px] py-2 text-sm font-medium capitalize transition-colors ${
                method === m
                  ? "bg-[var(--t-accent)] text-black"
                  : "text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)]"
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
        className="w-full rounded-full bg-[var(--t-accent)] px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {saving ? "Recording..." : `Record ${fmt(Number(amount))}`}
      </button>
    </form>
  );
}
