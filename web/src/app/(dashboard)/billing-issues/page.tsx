"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  AlertTriangle, Clock, Scale, FileX, Tag, DollarSign, FileText,
  RefreshCw, CheckCircle2, XCircle, Ban, Search, Plus, LinkIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import { formatCurrency } from "@/lib/utils";
import SlideOver from "@/components/slide-over";

const fmt = (n: number | null | undefined) => formatCurrency(n as number);

interface BillingIssue {
  id: string;
  issue_type: string;
  invoice_id: string | null;
  job_id: string | null;
  rental_chain_id: string | null;
  description: string;
  suggested_action: string | null;
  auto_resolvable: boolean;
  calculated_amount: number | null;
  days_overdue: number | null;
  status: string;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

interface Summary { total: number; by_type: Record<string, number> }

const ISSUE_TYPES = [
  { key: "all", label: "All", icon: AlertTriangle, color: "var(--t-text-primary)" },
  { key: "overdue_days", label: "Overdue Days", icon: Clock, color: "var(--t-warning)" },
  { key: "weight_overage", label: "Weight Overage", icon: Scale, color: "var(--t-warning)" },
  { key: "missing_dump_slip", label: "Missing Dump Slip", icon: FileX, color: "var(--t-text-muted)" },
  { key: "surcharge_gap", label: "Surcharge Gap", icon: Tag, color: "var(--t-warning)" },
  { key: "past_due_payment", label: "Past Due", icon: DollarSign, color: "var(--t-error)" },
  { key: "no_invoice", label: "No Invoice", icon: FileText, color: "var(--t-error)" },
  { key: "price_mismatch", label: "Price Mismatch", icon: AlertTriangle, color: "var(--t-warning)" },
];

const STATUS_FILTERS = [
  { value: "", label: "All Open" },
  { value: "open", label: "Open" },
  { value: "auto_resolved", label: "Auto-Resolved" },
  { value: "manually_resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
];

const RESOLUTION_REASONS = [
  { value: "invoice_corrected", label: "Invoice corrected" },
  { value: "payment_matched", label: "Payment matched" },
  { value: "duplicate_dismissed", label: "Duplicate dismissed" },
  { value: "false_positive", label: "False positive / not an issue" },
  { value: "customer_contacted", label: "Customer contacted" },
  { value: "resolved_externally", label: "Resolved externally" },
  { value: "manual_review", label: "Manual review completed" },
];

/* ── UI Labels — single source for all user-facing strings ── */
const UI_LABELS = {
  panelTitle: "Resolve Issue",
  resolve: "Resolve",
  dismiss: "Dismiss",
  cancel: "Cancel",
  resolving: "Resolving...",
  confirmResolution: "Confirm Resolution",
  actionPrompt: "How would you like to resolve this?",
  recommended: "Recommended",
  invoicePreview: "Invoice Preview",
  noJobData: "No linked job data available",
  searchPlaceholder: "Search by invoice #, customer...",
  searching: "Searching...",
  noInvoicesFound: "No invoices found",
  reasonLabel: "Resolution Reason *",
  reasonPlaceholder: "Select a reason...",
  notesLabel: "Notes (optional)",
  notesPlaceholder: "Additional context...",
  fallbackGuided: "Guided resolution is not yet available for this issue type. Select a reason below.",
  suggested: "Suggested:",
  viewInvoice: "View Invoice",
  issueResolved: "Issue resolved",
  failedToResolve: "Failed to resolve",
  previewCustomer: "Customer",
  previewAddress: "Address",
  previewSize: "Size",
  previewBasePrice: "Base Price",
  previewRentalPeriod: "Rental Period",
  previewIncludedTons: "Included Tons",
  previewDeliveryFee: "Delivery Fee",
  emptyFilterTitle: "No matching issues",
  emptyAllTitle: "All clear!",
  emptyFilterDesc: "No billing issues match the current filters.",
  emptyAllDesc: "No billing issues found.",
  clearFilters: "Clear Filters",
  runDetection: "Run Detection",
  prev: "Prev",
  next: "Next",
  // Pricing resolution labels
  pricingComparison: "Pricing Comparison",
  currentInvoiceRate: "Current Invoice Rate",
  correctPricingRate: "Correct Pricing Rate",
  priceDifference: "Difference",
  recalculating: "Recalculating...",
  surchargeItems: "Flagged Surcharge Items",
  surchargeGuidance: "The driver flagged surcharge items during the job. Review and add them to the invoice if applicable.",
  missingRuleGuidance: "No matching pricing rule found for this configuration. Create a rule on the Pricing page, then recalculate.",
  recalculateDisabled: "A matching pricing rule is required before recalculating. Create one on the Pricing page first.",
  invoiceCreateMissingPricing: "Cannot create invoice — no valid pricing found for this job configuration.",
  pricingPage: "Go to Pricing",
  jobConfig: "Job Configuration",
  showResolved: "Show Resolved",
  resolvedBadge: "Resolved",
  dismissedBadge: "Dismissed",
  // Past-due resolution labels
  pastDueMarkPaid: "Mark as Paid",
  pastDueMarkPaidDesc: "Record payment and close this issue",
  pastDueSendReminder: "Send Reminder",
  pastDueSendReminderDesc: "Send a payment reminder to the customer",
  pastDueNoAction: "No Action Required",
  pastDueNoActionDesc: "Dismiss this issue with a reason",
  pastDueHelperText: "This invoice is past due. Choose how to handle it.",
  pastDueReminderSent: "Payment reminder sent",
  pastDueMarkedPaid: "Invoice marked as paid — issue resolved",
  pastDueInvoiceNumber: "Invoice",
  pastDueCustomer: "Customer",
  pastDueBalanceDue: "Balance Due",
  pastDueDaysOverdue: "Days Overdue",
  pastDueDueDate: "Due Date",
  // Guided resolution action labels
  createInvoiceLabel: "Create Invoice",
  createInvoiceDesc: "Generate an invoice from the linked job data",
  linkInvoiceLabel: "Link Existing Invoice",
  linkInvoiceDesc: "Connect an existing invoice to this job",
  noInvoiceRequiredLabel: "No Invoice Required",
  noInvoiceRequiredDesc: "Mark as resolved without creating an invoice",
  recalculateLabel: "Recalculate from Current Pricing",
  recalculateDesc: "Update the invoice rental line to match the current pricing rule",
  keepPricingLabel: "Keep Current Pricing",
  keepPricingDesc: "Accept the current invoice pricing as-is",
  addSurchargesLabel: "Add Surcharge Items",
  addSurchargesDesc: "Add the flagged surcharge items to the invoice",
  noSurchargesLabel: "No Surcharges Needed",
  noSurchargesDesc: "Dismiss — surcharge items are not billable",
  // Shared confirm / success labels
  confirmResolutionLabel: "Confirm Resolution",
  createAndResolve: "Create & Resolve",
  linkAndResolve: "Link & Resolve",
  recalculateAndResolve: "Recalculate & Resolve",
  addAndResolve: "Add & Resolve",
  markPaidAndResolve: "Mark Paid & Resolve",
  invoiceCreatedResolved: "Invoice created & issue resolved",
  invoiceLinkedResolved: "Invoice linked & issue resolved",
  pricingCorrectedResolved: "Pricing corrected & issue resolved",
  surchargesAddedResolved: "Surcharges added & issue resolved",
};

/* ── Guided Resolution Config ── */
interface ResolutionAction {
  key: string;
  label: string;
  description: string;
  type: "primary" | "secondary" | "dismiss";
  autoReason: string;
  confirmLabel: string;
  successMessage: string;
}

interface IssueResolutionConfig {
  issueType: string;
  actions: ResolutionAction[];
}

const GUIDED_RESOLUTIONS: IssueResolutionConfig[] = [
  {
    issueType: "no_invoice",
    actions: [
      { key: "create_invoice", label: UI_LABELS.createInvoiceLabel, description: UI_LABELS.createInvoiceDesc, type: "primary", autoReason: "invoice_created", confirmLabel: UI_LABELS.createAndResolve, successMessage: UI_LABELS.invoiceCreatedResolved },
      { key: "link_invoice", label: UI_LABELS.linkInvoiceLabel, description: UI_LABELS.linkInvoiceDesc, type: "secondary", autoReason: "invoice_linked", confirmLabel: UI_LABELS.linkAndResolve, successMessage: UI_LABELS.invoiceLinkedResolved },
      { key: "dismiss", label: UI_LABELS.noInvoiceRequiredLabel, description: UI_LABELS.noInvoiceRequiredDesc, type: "dismiss", autoReason: "", confirmLabel: UI_LABELS.confirmResolutionLabel, successMessage: UI_LABELS.issueResolved },
    ],
  },
  {
    issueType: "price_mismatch",
    actions: [
      { key: "recalculate_pricing", label: UI_LABELS.recalculateLabel, description: UI_LABELS.recalculateDesc, type: "primary", autoReason: "pricing_recalculated", confirmLabel: UI_LABELS.recalculateAndResolve, successMessage: UI_LABELS.pricingCorrectedResolved },
      { key: "dismiss", label: UI_LABELS.keepPricingLabel, description: UI_LABELS.keepPricingDesc, type: "dismiss", autoReason: "pricing_accepted", confirmLabel: UI_LABELS.confirmResolutionLabel, successMessage: UI_LABELS.issueResolved },
    ],
  },
  {
    issueType: "surcharge_gap",
    actions: [
      { key: "add_surcharges", label: UI_LABELS.addSurchargesLabel, description: UI_LABELS.addSurchargesDesc, type: "primary", autoReason: "surcharges_added", confirmLabel: UI_LABELS.addAndResolve, successMessage: UI_LABELS.surchargesAddedResolved },
      { key: "dismiss", label: UI_LABELS.noSurchargesLabel, description: UI_LABELS.noSurchargesDesc, type: "dismiss", autoReason: "surcharges_dismissed", confirmLabel: UI_LABELS.confirmResolutionLabel, successMessage: UI_LABELS.issueResolved },
    ],
  },
  {
    issueType: "past_due_payment",
    actions: [
      { key: "mark_paid", label: UI_LABELS.pastDueMarkPaid, description: UI_LABELS.pastDueMarkPaidDesc, type: "primary", autoReason: "payment_confirmed", confirmLabel: UI_LABELS.markPaidAndResolve, successMessage: UI_LABELS.pastDueMarkedPaid },
      { key: "send_reminder", label: UI_LABELS.pastDueSendReminder, description: UI_LABELS.pastDueSendReminderDesc, type: "secondary", autoReason: "", confirmLabel: UI_LABELS.pastDueSendReminder, successMessage: UI_LABELS.pastDueReminderSent },
      { key: "dismiss", label: UI_LABELS.pastDueNoAction, description: UI_LABELS.pastDueNoActionDesc, type: "dismiss", autoReason: "", confirmLabel: UI_LABELS.confirmResolutionLabel, successMessage: UI_LABELS.issueResolved },
    ],
  },
];

function getResolutionConfig(issueType: string): IssueResolutionConfig | null {
  return GUIDED_RESOLUTIONS.find(c => c.issueType === issueType) || null;
}

/* ── Types for guided resolution ── */
interface DumpOverageItem { type: string; label: string; quantity: number; chargePerUnit: number; total: number }

interface JobDetail {
  id: string; job_number: string; status: string; job_type: string;
  asset_subtype: string | null; base_price: number; total_price: number;
  rental_days: number; scheduled_date: string;
  service_address: Record<string, string> | null;
  customer: { id: string; first_name: string; last_name: string } | null;
  dump_overage_items?: DumpOverageItem[];
}

interface InvoiceSearchResult {
  id: string; invoice_number: number; status: string; total: number; balance_due: number;
  customer: { first_name: string; last_name: string } | null;
}

interface InvoiceDetail {
  id: string; invoice_number: number; total: number; balance_due: number; status: string;
  due_date: string | null;
  customer: { id: string; first_name: string; last_name: string } | null;
  line_items: { id: string; line_type: string; name: string; quantity: number; unit_rate: number; amount: number; sort_order: number }[];
  job: { id: string; asset_subtype: string; dump_overage_items?: any[] } | null;
}

export default function BillingIssuesPage() {
  const [issues, setIssues] = useState<BillingIssue[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, by_type: {} });
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [resolveTarget, setResolveTarget] = useState<BillingIssue | null>(null);
  const [resolveReason, setResolveReason] = useState("");
  const [resolveNotes, setResolveNotes] = useState("");
  const [resolving, setResolving] = useState(false);
  const [selectedAction, setSelectedAction] = useState<string>("");
  const [jobDetail, setJobDetail] = useState<JobDetail | null>(null);
  const [jobLoading, setJobLoading] = useState(false);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceResults, setInvoiceResults] = useState<InvoiceSearchResult[]>([]);
  const [invoiceSearching, setInvoiceSearching] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [pricingRules, setPricingRules] = useState<{ asset_subtype: string; base_price: number; rental_period_days: number; included_tons: number; delivery_fee: number }[]>([]);
  const [invoiceDetail, setInvoiceDetail] = useState<InvoiceDetail | null>(null);
  const { toast } = useToast();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (statusFilter) params.set("status", statusFilter);
      else if (showResolved) params.set("status", "all");
      if (typeFilter) params.set("issueType", typeFilter);
      const [res, sum] = await Promise.all([
        api.get<{ data: BillingIssue[]; meta: { total: number } }>(`/billing-issues?${params}`),
        api.get<Summary>("/billing-issues/summary"),
      ]);
      setIssues(res.data);
      setTotal(res.meta.total);
      setSummary(sum);
    } catch { /* */ } finally { setLoading(false); }
  }, [page, statusFilter, typeFilter, showResolved]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { setPage(1); }, [statusFilter, typeFilter, showResolved]);
  useEffect(() => { api.get<{ data: typeof pricingRules }>("/pricing").then(r => setPricingRules(r.data || [])).catch(() => {}); }, []);

  const handleDetect = async () => {
    setDetecting(true);
    try {
      const result = await api.post<{ total_issues_found: number }>("/billing-issues/detect");
      toast("success", `Detection complete — ${result.total_issues_found} issue(s) found`);
      await fetchData();
    } catch { toast("error", "Detection failed"); }
    finally { setDetecting(false); }
  };

  const openResolvePanel = async (issue: BillingIssue) => {
    setResolveTarget(issue);
    setResolveReason("");
    setResolveNotes("");
    setSelectedAction("");
    setJobDetail(null);
    setInvoiceDetail(null);
    setInvoiceSearch("");
    setInvoiceResults([]);
    setSelectedInvoiceId(null);
    // Load job detail for guided resolution if job_id exists
    if (issue.job_id) {
      setJobLoading(true);
      try {
        const job = await api.get<JobDetail>(`/jobs/${issue.job_id}`);
        setJobDetail(job);
      } catch { /* */ }
      finally { setJobLoading(false); }
    }
    // Load invoice detail for pricing issues
    if (issue.invoice_id) {
      api.get<InvoiceDetail>(`/invoices/${issue.invoice_id}`).then(setInvoiceDetail).catch(() => {});
    }
  };

  const searchInvoices = async (q: string) => {
    setInvoiceSearch(q);
    if (q.length < 2) { setInvoiceResults([]); return; }
    setInvoiceSearching(true);
    try {
      const res = await api.get<{ data: InvoiceSearchResult[] }>(`/invoices?search=${encodeURIComponent(q)}&limit=10`);
      setInvoiceResults(res.data);
    } catch { setInvoiceResults([]); }
    finally { setInvoiceSearching(false); }
  };

  const confirmResolve = async () => {
    if (!resolveTarget) return;
    const config = getResolutionConfig(resolveTarget.issue_type);
    const action = config?.actions.find(a => a.key === selectedAction);

    // For guided actions, validate based on action type
    if (action) {
      if (action.key === "create_invoice" && !jobDetail) return;
      if (action.key === "link_invoice" && !selectedInvoiceId) return;
      if (action.key === "recalculate_pricing" && !invoiceDetail) return;
      if (action.key === "add_surcharges" && !invoiceDetail) return;
      if (action.key === "dismiss" && !resolveReason) return;
    } else {
      // Fallback: require reason
      if (!resolveReason) return;
    }

    setResolving(true);
    try {
      let linkedInvoiceId: string | undefined;
      const reason = action?.autoReason || resolveReason;

      if (action?.key === "create_invoice" && jobDetail) {
        // Create invoice via the standard job-linked flow — omit line_items so
        // the backend auto-creates pricing-aware rental lines from PriceResolutionService
        // (same path normal invoices use: pricing snapshot, rental chain, source tracking)
        const rule = pricingRules.find(r => r.asset_subtype === jobDetail.asset_subtype);
        const createBasePrice = Number(rule?.base_price) || Number(jobDetail.base_price) || 0;
        if (!isFinite(createBasePrice) || createBasePrice <= 0) { toast("error", UI_LABELS.invoiceCreateMissingPricing); setResolving(false); return; }

        const inv = await api.post<{ id: string; invoice_number: number }>("/invoices", {
          customer_id: jobDetail.customer?.id,
          job_id: jobDetail.id,
          service_date: jobDetail.scheduled_date,
        });
        linkedInvoiceId = inv.id;
        toast("success", `Invoice #${inv.invoice_number} created`);
      }

      if (action?.key === "link_invoice" && selectedInvoiceId) {
        // Link existing invoice to job by updating the invoice's job_id
        await api.put(`/invoices/${selectedInvoiceId}`, { job_id: resolveTarget.job_id });
        linkedInvoiceId = selectedInvoiceId;
      }

      if (action?.key === "recalculate_pricing" && invoiceDetail) {
        // Update the rental line item to the correct pricing, then save via PUT (triggers recalculateTotals → reconcileBalance)
        const subtype = invoiceDetail.job?.asset_subtype;
        const rule = pricingRules.find(r => r.asset_subtype === subtype);
        if (!rule) { toast("error", "No matching pricing rule found"); setResolving(false); return; }
        const updatedLineItems = invoiceDetail.line_items.map(li => ({
          line_type: li.line_type,
          name: li.line_type === "rental" ? `${rule.asset_subtype} Rental` : li.name,
          quantity: li.quantity,
          unit_rate: li.line_type === "rental" ? rule.base_price : li.unit_rate,
        }));
        await api.put(`/invoices/${invoiceDetail.id}`, { line_items: updatedLineItems });
        linkedInvoiceId = invoiceDetail.id;
      }

      if (action?.key === "add_surcharges" && invoiceDetail && jobDetail) {
        // Append surcharge line items from job.dump_overage_items to the invoice
        const existingItems = invoiceDetail.line_items.map(li => ({
          line_type: li.line_type, name: li.name, quantity: li.quantity, unit_rate: li.unit_rate,
        }));
        const surchargeItems = jobDetail.dump_overage_items || [];
        const newItems = surchargeItems.map((item) => ({
          line_type: "surcharge", name: item.label || item.type, quantity: item.quantity, unit_rate: item.chargePerUnit,
        }));
        await api.put(`/invoices/${invoiceDetail.id}`, { line_items: [...existingItems, ...newItems] });
        linkedInvoiceId = invoiceDetail.id;
      }

      if (action?.key === "mark_paid" && invoiceDetail) {
        // Record full payment via existing billing pipeline (triggers reconcileBalance)
        const balance = Number(invoiceDetail.balance_due);
        if (!balance || balance <= 0) { toast("error", "No balance to pay"); setResolving(false); return; }
        await api.post(`/invoices/${invoiceDetail.id}/payments`, {
          amount: balance,
          payment_method: "manual",
          notes: resolveNotes || "Marked as paid from billing issues",
        });
        linkedInvoiceId = invoiceDetail.id;
      }

      if (action?.key === "send_reminder" && invoiceDetail) {
        // Send payment reminder via notification dispatch — does NOT resolve the issue
        await api.post("/notifications/dispatch", {
          customerId: invoiceDetail.customer?.id,
          notificationType: "invoice_reminder",
          invoiceId: invoiceDetail.id,
        });
        toast("success", UI_LABELS.pastDueReminderSent);
        setResolving(false);
        return; // Do not resolve — issue stays open
      }

      // Resolve the billing issue
      await api.put(`/billing-issues/${resolveTarget.id}/resolve`, {
        reason,
        notes: resolveNotes || undefined,
        linkedInvoiceId,
      });

      toast("success", action?.successMessage || UI_LABELS.issueResolved);
      setResolveTarget(null);
      await fetchData();
    } catch (err: any) { toast("error", err?.message || UI_LABELS.failedToResolve); }
    finally { setResolving(false); }
  };

  const handleDismiss = async (id: string) => {
    try {
      await api.put(`/billing-issues/${id}/dismiss`);
      toast("success", "Issue dismissed");
      await fetchData();
    } catch { toast("error", "Failed to dismiss"); }
  };

  const getTypeInfo = (type: string) => ISSUE_TYPES.find(t => t.key === type) || ISSUE_TYPES[0];

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)]">Billing Issues</h1>
          <p className="mt-1 text-[13px] text-[var(--t-frame-text-muted)]">{summary.total} open issue{summary.total !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleDetect}
            disabled={detecting}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--t-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--t-accent-on-accent)] transition-all hover:brightness-110 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${detecting ? "animate-spin" : ""}`} />
            {detecting ? "Scanning..." : "Detect Issues"}
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
        {ISSUE_TYPES.map(t => {
          const isAll = t.key === "all";
          const count = isAll ? summary.total : (summary.by_type[t.key] || 0);
          const active = isAll ? typeFilter === "" : typeFilter === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTypeFilter(active && !isAll ? "" : isAll ? "" : t.key)}
              className={`rounded-[16px] border p-3 text-left transition-all ${active ? "ring-2 ring-[var(--t-accent)]" : ""}`}
              style={{ background: active ? "var(--t-bg-elevated)" : "var(--t-bg-card)", borderColor: active ? "var(--t-accent)" : "var(--t-border)" }}
            >
              <t.icon className="h-4 w-4 mb-1.5" style={{ color: count > 0 ? t.color : "var(--t-text-muted)" }} />
              <p className="text-lg font-bold tabular-nums" style={{ color: count > 0 ? t.color : "var(--t-text-muted)" }}>
                {count}
              </p>
              <p className="text-[11px] font-medium" style={{ color: active ? "var(--t-text-primary)" : "var(--t-text-muted)" }}>
                {t.label}
              </p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="rounded-[14px] border px-3 py-2 text-sm outline-none"
          style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
        >
          {STATUS_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="rounded-[14px] border px-3 py-2 text-sm outline-none"
          style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
        >
          <option value="">All Types</option>
          {ISSUE_TYPES.filter(t => t.key !== "all").map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-xs cursor-pointer select-none" style={{ color: "var(--t-text-muted)" }}>
          <input
            type="checkbox"
            checked={showResolved}
            onChange={e => setShowResolved(e.target.checked)}
            className="accent-[var(--t-accent)]"
          />
          {UI_LABELS.showResolved}
        </label>
        {(statusFilter || typeFilter) && (
          <button onClick={() => { setStatusFilter(""); setTypeFilter(""); }}
            className="text-xs text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)]">
            {UI_LABELS.clearFilters}
          </button>
        )}
      </div>

      {/* Issues List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 w-full animate-pulse rounded-[20px]" style={{ background: "var(--t-bg-card)" }} />
          ))}
        </div>
      ) : issues.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <CheckCircle2 className="h-12 w-12 mb-4" style={{ color: "var(--t-accent)" }} />
          <h3 className="text-lg font-semibold mb-1" style={{ color: "var(--t-frame-text)" }}>
            {(statusFilter || typeFilter) ? UI_LABELS.emptyFilterTitle : UI_LABELS.emptyAllTitle}
          </h3>
          <p className="text-sm mb-4" style={{ color: "var(--t-frame-text-muted)" }}>
            {(statusFilter || typeFilter) ? UI_LABELS.emptyFilterDesc : UI_LABELS.emptyAllDesc}
          </p>
          {(statusFilter || typeFilter) ? (
            <button onClick={() => { setStatusFilter(""); setTypeFilter(""); }}
              className="rounded-full px-5 py-2.5 text-sm font-medium border transition-colors"
              style={{ borderColor: "var(--t-border)", color: "var(--t-frame-text-muted)" }}>
              {UI_LABELS.clearFilters}
            </button>
          ) : (
            <button onClick={handleDetect} disabled={detecting}
              className="rounded-full px-5 py-2.5 text-sm font-medium border transition-colors"
              style={{ borderColor: "var(--t-border)", color: "var(--t-frame-text-muted)" }}>
              {UI_LABELS.runDetection}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {issues.map(issue => {
            const typeInfo = getTypeInfo(issue.issue_type);
            const isOpen = issue.status === "open";
            const isAutoResolved = issue.status === "auto_resolved";
            const isActionable = isOpen || isAutoResolved;
            const isResolved = issue.status === "manually_resolved";
            const isDismissed = issue.status === "dismissed";
            return (
              <div
                key={issue.id}
                className="rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4"
                style={{ borderLeftWidth: 3, borderLeftColor: isActionable ? typeInfo.color : "var(--t-border)", opacity: isActionable ? 1 : 0.6 }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <typeInfo.icon className="h-4 w-4 shrink-0" style={{ color: isActionable ? typeInfo.color : "var(--t-text-muted)" }} />
                      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: isActionable ? typeInfo.color : "var(--t-text-muted)" }}>
                        {typeInfo.label}
                      </span>
                      <span
                        className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                        style={{
                          background: isOpen ? "var(--t-error-soft)" : isAutoResolved ? "var(--t-accent-soft)" : "var(--t-bg-elevated)",
                          color: isOpen ? "var(--t-error)" : isAutoResolved ? "var(--t-accent)" : "var(--t-text-muted)",
                        }}
                      >
                        {isResolved ? UI_LABELS.resolvedBadge : isDismissed ? UI_LABELS.dismissedBadge : issue.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="text-sm font-medium mb-1" style={{ color: isActionable ? "var(--t-text-primary)" : "var(--t-text-muted)" }}>
                      {issue.description}
                    </p>
                    <div className="flex items-center gap-4 text-xs" style={{ color: "var(--t-text-muted)" }}>
                      {issue.invoice_id && (
                        <Link href={`/invoices/${issue.invoice_id}`} className="hover:text-[var(--t-accent)]">
                          {UI_LABELS.viewInvoice}
                        </Link>
                      )}
                      {issue.calculated_amount != null && (
                        <span className="tabular-nums font-medium" style={{ color: isActionable ? typeInfo.color : "var(--t-text-muted)" }}>
                          {fmt(issue.calculated_amount)}
                        </span>
                      )}
                      {issue.days_overdue != null && (
                        <span>{issue.days_overdue} day{issue.days_overdue !== 1 ? "s" : ""} overdue</span>
                      )}
                      <span>{new Date(issue.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => openResolvePanel(issue)}
                        className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--t-accent-soft)]"
                        style={{ borderColor: "var(--t-accent)", color: "var(--t-accent)" }}
                      >
                        <CheckCircle2 className="h-3 w-3" /> {UI_LABELS.resolve}
                      </button>
                      <button
                        onClick={() => handleDismiss(issue.id)}
                        className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--t-bg-card-hover)]"
                        style={{ borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}
                      >
                        <Ban className="h-3 w-3" /> {UI_LABELS.dismiss}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > 25 && (
        <div className="flex items-center justify-between mt-6 text-sm" style={{ color: "var(--t-text-muted)" }}>
          <span>Showing {(page - 1) * 25 + 1}-{Math.min(page * 25, total)} of {total}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="rounded-full border px-4 py-1.5 text-sm disabled:opacity-30"
              style={{ borderColor: "var(--t-border)" }}>{UI_LABELS.prev}</button>
            <button onClick={() => setPage(p => p + 1)} disabled={page * 25 >= total}
              className="rounded-full border px-4 py-1.5 text-sm disabled:opacity-30"
              style={{ borderColor: "var(--t-border)" }}>{UI_LABELS.next}</button>
          </div>
        </div>
      )}

      {/* Resolve Workflow Panel */}
      <SlideOver open={!!resolveTarget} onClose={() => setResolveTarget(null)} title={UI_LABELS.panelTitle}>
        {resolveTarget && (() => {
          const typeInfo = getTypeInfo(resolveTarget.issue_type);
          const config = getResolutionConfig(resolveTarget.issue_type);
          const isGuided = !!config;
          const action = config?.actions.find(a => a.key === selectedAction);
          const recalcSubtype = invoiceDetail?.job?.asset_subtype;
          const recalcRule = recalcSubtype ? pricingRules.find(r => r.asset_subtype === recalcSubtype) : null;
          const hasValidPricingRule = !!(recalcRule && Number(recalcRule.base_price) > 0);

          const createRule = jobDetail?.asset_subtype ? pricingRules.find(r => r.asset_subtype === jobDetail.asset_subtype) : null;
          const createBasePrice = Number(createRule?.base_price) || Number(jobDetail?.base_price) || 0;
          const hasValidCreatePayload = !!(jobDetail && jobDetail.customer?.id && isFinite(createBasePrice) && createBasePrice > 0);

          const canConfirm = isGuided
            ? (selectedAction === "create_invoice" && hasValidCreatePayload)
              || (selectedAction === "link_invoice" && selectedInvoiceId)
              || (selectedAction === "recalculate_pricing" && invoiceDetail && hasValidPricingRule)
              || (selectedAction === "add_surcharges" && invoiceDetail)
              || (selectedAction === "mark_paid" && invoiceDetail && Number(invoiceDetail.balance_due) > 0)
              || (selectedAction === "send_reminder" && invoiceDetail)
              || (selectedAction === "dismiss" && resolveReason)
            : !!resolveReason;

          return (
            <div className="space-y-5">
              {/* Issue summary */}
              <div className="rounded-xl border p-4" style={{ background: "var(--t-bg-elevated)", borderColor: "var(--t-border)", borderLeftWidth: 3, borderLeftColor: typeInfo.color }}>
                <div className="flex items-center gap-2 mb-2">
                  <typeInfo.icon className="h-4 w-4" style={{ color: typeInfo.color }} />
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: typeInfo.color }}>{typeInfo.label}</span>
                </div>
                <p className="text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>{resolveTarget.description}</p>
                <div className="flex items-center gap-3 mt-2 text-xs" style={{ color: "var(--t-text-muted)" }}>
                  {resolveTarget.calculated_amount != null && <span className="font-medium tabular-nums" style={{ color: typeInfo.color }}>{fmt(resolveTarget.calculated_amount)}</span>}
                  {resolveTarget.days_overdue != null && <span>{resolveTarget.days_overdue} days overdue</span>}
                  <span>{new Date(resolveTarget.created_at).toLocaleDateString()}</span>
                </div>
                {resolveTarget.invoice_id && (
                  <Link href={`/invoices/${resolveTarget.invoice_id}`} className="inline-flex items-center gap-1 text-xs font-medium mt-2" style={{ color: "var(--t-accent)" }}>{UI_LABELS.viewInvoice}</Link>
                )}
              </div>

              {resolveTarget.suggested_action && (
                <div className="rounded-xl border p-3 text-xs" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}>
                  <span className="font-semibold" style={{ color: "var(--t-text-primary)" }}>{UI_LABELS.suggested}</span> {resolveTarget.suggested_action}
                </div>
              )}

              {/* Guided resolution: action selection */}
              {isGuided ? (
                <>
                  <div>
                    <p className="text-xs font-semibold mb-2" style={{ color: "var(--t-text-primary)" }}>{UI_LABELS.actionPrompt}</p>
                    <div className="space-y-2">
                      {config.actions.map(a => (
                        <button key={a.key} onClick={() => { setSelectedAction(a.key); setSelectedInvoiceId(null); setInvoiceSearch(""); setInvoiceResults([]); if (a.autoReason) setResolveReason(a.autoReason); else setResolveReason(""); }}
                          className={`w-full rounded-xl border p-3 text-left transition-all ${selectedAction === a.key ? "ring-2 ring-[var(--t-accent)]" : ""}`}
                          style={{ background: selectedAction === a.key ? "var(--t-bg-elevated)" : "var(--t-bg-card)", borderColor: selectedAction === a.key ? "var(--t-accent)" : "var(--t-border)" }}>
                          <div className="flex items-center gap-2">
                            {a.type === "primary" ? <Plus className="h-3.5 w-3.5" style={{ color: "var(--t-accent)" }} /> : a.type === "secondary" ? <LinkIcon className="h-3.5 w-3.5" style={{ color: "var(--t-text-muted)" }} /> : <Ban className="h-3.5 w-3.5" style={{ color: "var(--t-text-muted)" }} />}
                            <span className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>{a.label}</span>
                            {a.type === "primary" && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: "var(--t-accent-soft)", color: "var(--t-accent)" }}>{UI_LABELS.recommended}</span>}
                          </div>
                          <p className="text-xs mt-1" style={{ color: "var(--t-text-muted)" }}>{a.description}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Option A: Create Invoice preview */}
                  {selectedAction === "create_invoice" && (
                    <div className="rounded-xl border p-4" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-accent)" }}>
                      <p className="text-xs font-semibold mb-3" style={{ color: "var(--t-accent)" }}>{UI_LABELS.invoicePreview}</p>
                      {jobLoading ? (
                        <div className="h-20 animate-pulse rounded-lg" style={{ background: "var(--t-bg-elevated)" }} />
                      ) : jobDetail ? (() => {
                        const rule = pricingRules.find(r => r.asset_subtype === jobDetail.asset_subtype);
                        const price = rule?.base_price || jobDetail.base_price || 0;
                        const addr = jobDetail.service_address;
                        return (
                          <div className="space-y-2 text-xs">
                            <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>{UI_LABELS.previewCustomer}</span><span className="font-medium" style={{ color: "var(--t-text-primary)" }}>{jobDetail.customer ? `${jobDetail.customer.first_name} ${jobDetail.customer.last_name}` : "—"}</span></div>
                            {addr && <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>{UI_LABELS.previewAddress}</span><span className="font-medium truncate ml-4" style={{ color: "var(--t-text-primary)" }}>{[addr.street, addr.city, addr.state].filter(Boolean).join(", ")}</span></div>}
                            <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>{UI_LABELS.previewSize}</span><span className="font-medium" style={{ color: "var(--t-text-primary)" }}>{jobDetail.asset_subtype || "—"}</span></div>
                            <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>{UI_LABELS.previewBasePrice}</span><span className="font-bold" style={{ color: "var(--t-accent)" }}>{fmt(price)}</span></div>
                            {rule && <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>{UI_LABELS.previewRentalPeriod}</span><span style={{ color: "var(--t-text-primary)" }}>{rule.rental_period_days} days</span></div>}
                            {rule && Number(rule.included_tons) > 0 && <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>{UI_LABELS.previewIncludedTons}</span><span style={{ color: "var(--t-text-primary)" }}>{rule.included_tons}</span></div>}
                            {rule && Number(rule.delivery_fee) > 0 && <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>{UI_LABELS.previewDeliveryFee}</span><span style={{ color: "var(--t-text-primary)" }}>{fmt(rule.delivery_fee)}</span></div>}
                            {!hasValidCreatePayload && (
                              <div className="mt-3 rounded-lg border px-3 py-2" style={{ borderColor: "var(--t-error)", background: "var(--t-error-soft)" }}>
                                <p className="text-xs font-medium" style={{ color: "var(--t-error)" }}>{UI_LABELS.invoiceCreateMissingPricing}</p>
                              </div>
                            )}
                          </div>
                        );
                      })() : (
                        <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>{UI_LABELS.noJobData}</p>
                      )}
                    </div>
                  )}

                  {/* Option B: Link Existing Invoice */}
                  {selectedAction === "link_invoice" && (
                    <div className="space-y-3">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--t-text-muted)" }} />
                        <input value={invoiceSearch} onChange={e => searchInvoices(e.target.value)}
                          placeholder={UI_LABELS.searchPlaceholder}
                          className="w-full rounded-[14px] border py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[var(--t-accent)]"
                          style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} />
                      </div>
                      {invoiceSearching && <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>{UI_LABELS.searching}</p>}
                      {invoiceResults.length > 0 && (
                        <div className="space-y-1.5 max-h-48 overflow-y-auto">
                          {invoiceResults.map(inv => (
                            <button key={inv.id} onClick={() => setSelectedInvoiceId(inv.id)}
                              className={`w-full rounded-lg border p-3 text-left text-xs transition-all ${selectedInvoiceId === inv.id ? "ring-2 ring-[var(--t-accent)]" : ""}`}
                              style={{ background: selectedInvoiceId === inv.id ? "var(--t-bg-elevated)" : "var(--t-bg-card)", borderColor: selectedInvoiceId === inv.id ? "var(--t-accent)" : "var(--t-border)" }}>
                              <div className="flex justify-between">
                                <span className="font-semibold" style={{ color: "var(--t-text-primary)" }}>#{inv.invoice_number}</span>
                                <span className="font-medium tabular-nums" style={{ color: "var(--t-text-primary)" }}>{fmt(inv.total)}</span>
                              </div>
                              <div className="flex justify-between mt-0.5" style={{ color: "var(--t-text-muted)" }}>
                                <span>{inv.customer ? `${inv.customer.first_name} ${inv.customer.last_name}` : "—"}</span>
                                <span>{inv.status}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      {invoiceSearch.length >= 2 && !invoiceSearching && invoiceResults.length === 0 && (
                        <p className="text-xs text-center py-3" style={{ color: "var(--t-text-muted)" }}>{UI_LABELS.noInvoicesFound}</p>
                      )}
                    </div>
                  )}

                  {/* Pricing: Recalculate comparison */}
                  {selectedAction === "recalculate_pricing" && invoiceDetail && (
                    <div className="rounded-xl border p-4" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-accent)" }}>
                      <p className="text-xs font-semibold mb-3" style={{ color: "var(--t-accent)" }}>{UI_LABELS.pricingComparison}</p>
                      {(() => {
                        const rentalLine = invoiceDetail.line_items.find(li => li.line_type === "rental");
                        const subtype = invoiceDetail.job?.asset_subtype;
                        const rule = pricingRules.find(r => r.asset_subtype === subtype);
                        const currentRate = rentalLine ? rentalLine.unit_rate : 0;
                        const correctRate = rule?.base_price || 0;
                        const delta = correctRate - currentRate;
                        return (
                          <div className="space-y-2 text-xs">
                            <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>{UI_LABELS.previewSize}</span><span className="font-medium" style={{ color: "var(--t-text-primary)" }}>{subtype || "—"}</span></div>
                            <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>{UI_LABELS.currentInvoiceRate}</span><span className="font-medium" style={{ color: "var(--t-error)" }}>{fmt(currentRate)}</span></div>
                            <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>{UI_LABELS.correctPricingRate}</span><span className="font-bold" style={{ color: "var(--t-accent)" }}>{fmt(correctRate)}</span></div>
                            {rule && <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>{UI_LABELS.previewRentalPeriod}</span><span style={{ color: "var(--t-text-primary)" }}>{rule.rental_period_days} days</span></div>}
                            <div className="flex justify-between border-t pt-2" style={{ borderColor: "var(--t-border)" }}>
                              <span className="font-semibold" style={{ color: "var(--t-text-primary)" }}>{UI_LABELS.priceDifference}</span>
                              <span className="font-bold" style={{ color: delta > 0 ? "var(--t-accent)" : delta < 0 ? "var(--t-error)" : "var(--t-text-muted)" }}>{delta > 0 ? "+" : ""}{fmt(delta)}</span>
                            </div>
                            {!rule && (
                              <div className="mt-3 rounded-lg border px-3 py-2" style={{ borderColor: "var(--t-error)", background: "var(--t-error-soft)" }}>
                                <p className="text-xs font-medium" style={{ color: "var(--t-error)" }}>{UI_LABELS.recalculateDisabled}</p>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Pricing: Surcharge gap */}
                  {selectedAction === "add_surcharges" && (
                    <div className="rounded-xl border p-4" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-warning)" }}>
                      <p className="text-xs font-semibold mb-2" style={{ color: "var(--t-warning)" }}>{UI_LABELS.surchargeItems}</p>
                      <p className="text-xs mb-3" style={{ color: "var(--t-text-muted)" }}>{UI_LABELS.surchargeGuidance}</p>
                      {jobDetail?.dump_overage_items?.map((item, i) => (
                        <div key={i} className="flex justify-between text-xs py-1.5" style={{ borderTop: i > 0 ? "1px solid var(--t-border)" : undefined }}>
                          <span style={{ color: "var(--t-text-primary)" }}>{item.label || item.type} {item.quantity > 1 ? `×${item.quantity}` : ""}</span>
                          <span className="font-medium tabular-nums" style={{ color: "var(--t-warning)" }}>{fmt(item.total)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Past-due: invoice context */}
                  {(selectedAction === "mark_paid" || selectedAction === "send_reminder") && invoiceDetail && (
                    <div className="rounded-xl border p-4" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-error)" }}>
                      <p className="text-xs font-semibold mb-3" style={{ color: "var(--t-error)" }}>{UI_LABELS.pastDueHelperText}</p>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>{UI_LABELS.pastDueInvoiceNumber}</span><span className="font-medium" style={{ color: "var(--t-text-primary)" }}>#{invoiceDetail.invoice_number}</span></div>
                        {invoiceDetail.customer && <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>{UI_LABELS.pastDueCustomer}</span><span className="font-medium" style={{ color: "var(--t-text-primary)" }}>{invoiceDetail.customer.first_name} {invoiceDetail.customer.last_name}</span></div>}
                        <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>{UI_LABELS.pastDueBalanceDue}</span><span className="font-bold" style={{ color: "var(--t-error)" }}>{fmt(invoiceDetail.balance_due)}</span></div>
                        {resolveTarget.days_overdue != null && (
                          <div className="flex justify-between">
                            <span style={{ color: "var(--t-text-muted)" }}>{UI_LABELS.pastDueDaysOverdue}</span>
                            <span className="font-medium" style={{ color: resolveTarget.days_overdue > 30 ? "var(--t-error)" : "var(--t-warning)" }}>{resolveTarget.days_overdue}</span>
                          </div>
                        )}
                        {invoiceDetail.due_date && <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>{UI_LABELS.pastDueDueDate}</span><span style={{ color: "var(--t-text-primary)" }}>{new Date(invoiceDetail.due_date).toLocaleDateString()}</span></div>}
                      </div>
                    </div>
                  )}

                  {/* Dismiss — reason required */}
                  {selectedAction === "dismiss" && (
                    <div>
                      <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--t-text-primary)" }}>{UI_LABELS.reasonLabel}</label>
                      <select value={resolveReason} onChange={e => setResolveReason(e.target.value)}
                        className="w-full rounded-[14px] border px-3 py-2.5 text-sm outline-none focus:border-[var(--t-accent)]"
                        style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}>
                        <option value="">{UI_LABELS.reasonPlaceholder}</option>
                        {RESOLUTION_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </div>
                  )}
                </>
              ) : (
                /* Fallback: reason-only flow for unsupported issue types */
                <>
                  <div className="rounded-xl border p-3 text-xs" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}>
                    {UI_LABELS.fallbackGuided}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--t-text-primary)" }}>{UI_LABELS.reasonLabel}</label>
                    <select value={resolveReason} onChange={e => setResolveReason(e.target.value)}
                      className="w-full rounded-[14px] border px-3 py-2.5 text-sm outline-none focus:border-[var(--t-accent)]"
                      style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}>
                      <option value="">{UI_LABELS.reasonPlaceholder}</option>
                      {RESOLUTION_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </div>
                </>
              )}

              {/* Notes (always available) */}
              {(selectedAction || !isGuided) && (
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: "var(--t-text-primary)" }}>{UI_LABELS.notesLabel}</label>
                  <textarea value={resolveNotes} onChange={e => setResolveNotes(e.target.value)} rows={2}
                    className="w-full rounded-[14px] border px-3 py-2.5 text-sm outline-none focus:border-[var(--t-accent)] resize-none"
                    style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
                    placeholder={UI_LABELS.notesPlaceholder} />
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button onClick={confirmResolve} disabled={!canConfirm || resolving}
                  className="flex-1 flex items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold transition-all disabled:opacity-40"
                  style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}>
                  <CheckCircle2 className="h-4 w-4" />
                  {resolving ? UI_LABELS.resolving : action?.confirmLabel || UI_LABELS.confirmResolution}
                </button>
                <button onClick={() => setResolveTarget(null)}
                  className="rounded-full border px-4 py-2.5 text-sm font-medium transition-colors"
                  style={{ borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}>
                  {UI_LABELS.cancel}
                </button>
              </div>
            </div>
          );
        })()}
      </SlideOver>
    </div>
  );
}
