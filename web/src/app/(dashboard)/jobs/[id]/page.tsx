"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  MapPin,
  Calendar,
  Truck,
  User,
  Box,
  DollarSign,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  MoreHorizontal,
  Pencil,
  UserPlus,
  FileText,
  Trash2,
  ArrowRight,
  Send,
  StickyNote,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { api } from "@/lib/api";
import Dropdown from "@/components/dropdown";
import { useToast } from "@/components/toast";
import MapboxMap from "@/components/mapbox-map";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import { getBlockedReason } from "@/lib/blocked-job";
import { JobBlockedResolutionDrawer } from "@/components/job-blocked-resolution-drawer";

/* --- Types --- */

interface Job {
  id: string;
  job_number: string;
  job_type: string;
  service_type: string;
  status: string;
  priority: string;
  scheduled_date: string;
  scheduled_window_start: string;
  scheduled_window_end: string;
  service_address: Record<string, string> | null;
  placement_notes: string;
  rental_start_date: string;
  rental_end_date: string;
  rental_days: number;
  base_price: number;
  total_price: number;
  deposit_amount: number;
  source: string;
  driver_notes: string;
  signature_url: string;
  photos: Array<{ url: string }>;
  dispatched_at: string;
  en_route_at: string;
  arrived_at: string;
  completed_at: string;
  cancelled_at: string;
  cancellation_reason: string;
  created_at: string;
  customer: { id: string; first_name: string; last_name: string; phone: string; email: string } | null;
  asset: { id: string; identifier: string; asset_type: string; subtype: string } | null;
  assigned_driver: { id: string; first_name: string; last_name: string; phone: string } | null;
  is_failed_trip?: boolean;
  failed_reason?: string;
  failed_at?: string;
  attempt_count?: number;
  is_overdue?: boolean;
  extra_days?: number;
  extra_day_rate?: number;
  extra_day_charges?: number;
}

/* --- Constants --- */

import { deriveDisplayStatus, DISPLAY_STATUS_LABELS, displayStatusColor } from "@/lib/job-status";

const JOB_TYPE_COLORS: Record<string, string> = {
  delivery: "text-blue-400",
  pickup: "text-orange-400",
  exchange: "text-purple-400",
};

const SIZE_COLORS: Record<string, string> = {
  "10yd": "text-sky-400",
  "15yd": "text-indigo-400",
  "20yd": "text-violet-400",
  "30yd": "text-amber-400",
  "40yd": "text-rose-400",
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["dispatched", "cancelled"],
  dispatched: ["en_route", "cancelled"],
  en_route: ["arrived", "cancelled"],
  arrived: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
};

const TRANSITION_STYLES: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  confirmed: { label: "Mark Ready", className: "bg-[var(--t-accent)] text-[var(--t-accent-on-accent)] hover:opacity-90", icon: CheckCircle2 },
  dispatched: { label: "Assign", className: "bg-[var(--t-accent)] text-[var(--t-accent-on-accent)] hover:opacity-90", icon: Truck },
  en_route: { label: "En Route", className: "bg-[var(--t-accent)] text-[var(--t-accent-on-accent)] hover:opacity-90", icon: Truck },
  arrived: { label: "Arrived", className: "bg-[var(--t-accent)] text-[var(--t-accent-on-accent)] hover:opacity-90", icon: MapPin },
  in_progress: { label: "On Site", className: "bg-[var(--t-accent)] text-[var(--t-accent-on-accent)] hover:opacity-90", icon: AlertCircle },
  completed: { label: "Complete", className: "bg-[var(--t-accent)] text-[var(--t-accent-on-accent)] hover:opacity-90", icon: CheckCircle2 },
  cancelled: { label: "Cancel", className: "border border-[var(--t-error)]/20 text-[var(--t-error)] hover:bg-[var(--t-error-soft)]", icon: XCircle },
};

// Office can only trigger these as primary actions
const OFFICE_ALLOWED_TRANSITIONS = new Set(["confirmed", "dispatched", "cancelled"]);

// Override corrections: current stored status → allowed correction targets
const OVERRIDE_TARGETS: Record<string, string[]> = {
  dispatched: ["en_route"],
  en_route: ["dispatched", "arrived", "in_progress"],
  arrived: ["en_route", "in_progress", "completed"],
  in_progress: ["arrived", "completed"],
};

const TIMELINE_STEPS = [
  { key: "created_at", label: "Created", status: "pending" },
  { key: "confirmed", label: "Unassigned", status: "confirmed" },
  { key: "dispatched_at", label: "Assigned", status: "dispatched" },
  { key: "en_route_at", label: "En Route", status: "en_route" },
  { key: "arrived_at", label: "Arrived", status: "arrived" },
  { key: "completed_at", label: "Completed", status: "completed" },
];

/* --- Helpers --- */

import { formatCurrency, formatSourceLabel } from "@/lib/utils";
function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return formatCurrency(n);
}

function fmtDateFull(d: string): string {
  if (!d) return "—";
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function fmtTime(t: string): string {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hour = parseInt(h);
  return `${hour > 12 ? hour - 12 : hour || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
}

function daysBetween(a: string, b: string): number {
  if (!a || !b) return 0;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

/* --- Page --- */

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [job, setJob] = useState<Job | null>(null);
  const [isPostCreate, setIsPostCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [dumpTickets, setDumpTickets] = useState<Array<{
    id: string; ticket_number: string; waste_type: string; weight_tons: number;
    total_cost: number; customer_charges: number; status: string; ticket_photo: string;
    dump_location_name: string; submitted_at: string; overage_items: Array<{ label: string; quantity: number; total: number }>;
    revisions?: Array<{ revision: number; changedBy: string; changedByRole: string; changedAt: string; changes: Record<string, { old: unknown; new: unknown }>; reason?: string }>;
    voided_at?: string; void_reason?: string;
  }>>([]);
  const [showRevisions, setShowRevisions] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<{ id: string; invoice_number: number; status: string; total: number; balance_due: number } | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(true);
  // Open billing issues for THIS job — used by the contextual blocked
  // panel. Count comes from a scoped fetch of /billing-issues?jobId=...
  // which uses the same backend filter the Billing Issues page scoped
  // banner uses, so both surfaces agree on what's open.
  const [openBillingIssueCount, setOpenBillingIssueCount] = useState(0);
  // Phase 4: Job Blocked Resolution Drawer state. Opens from the
  // contextual blocked panel's primary "Fix Billing" CTA.
  const [resolveDrawerOpen, setResolveDrawerOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [editAddress, setEditAddress] = useState<AddressValue>({ street: "", city: "", state: "", zip: "", lat: null, lng: null });
  const [savingAddress, setSavingAddress] = useState(false);
  // Override modal state
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const fetchJob = async () => {
    try {
      const data = await api.get<Job>(`/jobs/${id}`);
      setJob(data);
    } catch { /* */ } finally {
      setLoading(false);
    }
  };

  const fetchDumpTickets = async () => {
    try {
      const data = await api.get<{ tickets: typeof dumpTickets }>(`/jobs/${id}/dump-slip`);
      setDumpTickets(data.tickets || []);
    } catch { /* */ }
  };

  const fetchInvoice = async () => {
    try {
      const res = await api.get<{ data: Array<{ id: string; invoice_number: number; status: string; total: number; balance_due: number }> }>(`/invoices?jobId=${id}&limit=1`);
      if (res.data && res.data.length > 0) setInvoice(res.data[0]);
    } catch { /* */ }
  };

  const fetchOpenBillingIssues = async () => {
    try {
      const res = await api.get<{ data: Array<{ id: string }>; meta: { total: number } }>(
        `/billing-issues?jobId=${id}&status=open&limit=1`,
      );
      setOpenBillingIssueCount(res.meta?.total ?? 0);
    } catch { /* silent — panel simply won't indicate billing issues */ }
  };

  useEffect(() => { fetchJob(); fetchDumpTickets(); fetchInvoice(); fetchOpenBillingIssues(); }, [id]);

  // Detect one-time postCreate flag and consume it
  useEffect(() => {
    if (searchParams.get("postCreate") === "1") {
      setIsPostCreate(true);
      // Clean the query param from URL without re-triggering navigation
      router.replace(`/jobs/${id}`, { scroll: false });
    }
  }, [searchParams, id, router]);

  const changeStatus = async (newStatus: string) => {
    if (actionLoading) return;
    if (newStatus === "cancelled") {
      const reason = prompt("Cancellation reason:");
      if (!reason) return;
      setActionLoading(true);
      try {
        await api.patch(`/jobs/${id}/status`, { status: newStatus, cancellationReason: reason });
        toast("success", "Job cancelled");
        await fetchJob();
      } catch { toast("error", "Failed to update"); } finally { setActionLoading(false); }
      return;
    }
    setActionLoading(true);
    try {
      await api.patch(`/jobs/${id}/status`, { status: newStatus });
      toast("success", `Job marked as ${DISPLAY_STATUS_LABELS[deriveDisplayStatus(newStatus)]}`);
      await fetchJob();
    } catch { toast("error", "Failed to update"); } finally { setActionLoading(false); }
  };

  const handleOverride = async () => {
    if (!overrideTarget || !overrideReason.trim()) return;
    setActionLoading(true);
    try {
      await api.patch(`/jobs/${id}/status`, { status: overrideTarget });
      // Record override as a note on the job
      const existing = job?.driver_notes || "";
      const overrideNote = `[Status Override] ${DISPLAY_STATUS_LABELS[deriveDisplayStatus(overrideTarget)]} — ${overrideReason.trim()}`;
      await api.patch(`/jobs/${id}`, { driver_notes: existing ? `${overrideNote}\n${existing}` : overrideNote });
      toast("success", `Status overridden to ${DISPLAY_STATUS_LABELS[deriveDisplayStatus(overrideTarget)]}`);
      setOverrideOpen(false);
      await fetchJob();
    } catch { toast("error", "Failed to override status"); } finally { setActionLoading(false); }
  };

  const deleteJob = async () => {
    if (!confirm("Delete this job permanently?")) return;
    try {
      await api.delete(`/jobs/${id}`);
      toast("success", "Job deleted");
      router.push("/jobs");
    } catch { toast("error", "Failed to delete"); }
  };

  const scheduleNext = async (type: string) => {
    const scheduledDate = prompt(`Scheduled date for ${type.replace(/_/g, " ")} (YYYY-MM-DD):`);
    if (!scheduledDate) return;
    setActionLoading(true);
    try {
      await api.post(`/jobs/${id}/schedule-next`, { type, scheduledDate });
      toast("success", `${type.replace(/_/g, " ")} scheduled for ${scheduledDate}`);
      await fetchJob();
    } catch { toast("error", "Failed to schedule"); } finally { setActionLoading(false); }
  };

  const startEditAddress = () => {
    const a = job?.service_address;
    setEditAddress({
      street: a?.street || "", city: a?.city || "", state: a?.state || "", zip: a?.zip || "",
      lat: a?.lat ? Number(a.lat) : null, lng: a?.lng ? Number(a.lng) : null,
    });
    setEditingAddress(true);
  };

  const saveAddress = async () => {
    if (!editAddress.lat || !editAddress.lng) { toast("error", "Address must be geocoded with coordinates"); return; }
    setSavingAddress(true);
    try {
      await api.patch(`/jobs/${id}`, { serviceAddress: editAddress });
      toast("success", "Service address updated");
      setEditingAddress(false);
      await fetchJob();
    } catch (err: any) { toast("error", err?.message || "Failed to update address"); }
    finally { setSavingAddress(false); }
  };

  if (loading) {
    return (
      <div className="py-10">
        <div className="mb-6 h-4 w-28 animate-pulse rounded bg-[var(--t-bg-card)]" />
        <div className="mb-8 space-y-2"><div className="h-7 w-40 animate-pulse rounded bg-[var(--t-bg-card)]" /><div className="h-4 w-56 animate-pulse rounded bg-[var(--t-bg-card)]" /></div>
        <div className="mb-8 rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-6">
          <div className="flex items-center justify-between gap-4">{Array.from({ length: 6 }).map((_, i) => (<div key={i} className="flex flex-col items-center flex-1"><div className="h-8 w-8 animate-pulse rounded-full bg-[var(--t-border)]" /><div className="mt-2 h-3 w-14 animate-pulse rounded bg-[var(--t-border)]" /></div>))}</div>
        </div>
      </div>
    );
  }

  if (!job) return <div className="flex items-center justify-center py-32 text-[var(--t-text-muted)]">Job not found</div>;

  const addr = job.service_address;
  const transitions = (VALID_TRANSITIONS[job.status] || []).filter((t) => t !== "dispatched" || !!job.assigned_driver);
  const statusIdx = TIMELINE_STEPS.findIndex((s) => s.status === job.status);
  const typeColor = JOB_TYPE_COLORS[job.job_type] || "text-blue-400";
  const sizeColor = job.asset?.subtype ? (SIZE_COLORS[job.asset.subtype] || "text-[var(--t-text-muted)]") : "";
  const rentalDays = job.rental_start_date && job.rental_end_date ? daysBetween(job.rental_start_date, job.rental_end_date) : job.rental_days;

  return (
    <div>
      <Link href="/jobs" className="mb-6 inline-flex items-center gap-2 text-sm text-[var(--t-frame-text-muted)] transition-colors hover:text-[var(--t-frame-text)]">
        <ArrowLeft className="h-4 w-4" /> Back to Jobs
      </Link>

      {/* --- Header --- */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)]">{job.job_number}</h1>
            <span className="text-xs font-medium" style={{ color: displayStatusColor(deriveDisplayStatus(job.status)) }}>
              {DISPLAY_STATUS_LABELS[deriveDisplayStatus(job.status)]}
            </span>
            <span className={`text-[11px] font-medium capitalize ${typeColor}`}>
              {job.job_type}
            </span>
            {sizeColor && (
              <span className={`text-[11px] font-medium ${sizeColor}`}>
                {job.asset?.subtype}
              </span>
            )}
          </div>
          {job.customer && (
            <Link href={`/customers/${job.customer.id}`} className="text-sm text-[var(--t-accent)] hover:underline">
              {job.customer.first_name} {job.customer.last_name}
            </Link>
          )}
          <p className="text-xs text-[var(--t-frame-text-muted)] mt-0.5">
            Created {new Date(job.created_at).toLocaleDateString()} {job.source && `· Source: ${formatSourceLabel(job.source)}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Status transition buttons — office-allowed only */}
          {transitions.filter((t) => OFFICE_ALLOWED_TRANSITIONS.has(t) && t !== "cancelled").map((t) => {
            const style = TRANSITION_STYLES[t];
            if (!style) return null;
            const Icon = style.icon;
            return (
              <button key={t} onClick={() => changeStatus(t)} disabled={actionLoading} className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all disabled:opacity-50 ${style.className}`}>
                <Icon className="h-4 w-4" /> {style.label}
              </button>
            );
          })}

          {/* Actions menu */}
          <Dropdown
            trigger={<button className="rounded-full border border-[var(--t-border)] p-2 text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] transition-colors"><MoreHorizontal className="h-4 w-4" /></button>}
            align="right"
          >
            {transitions.includes("cancelled") && (
              <button onClick={() => changeStatus("cancelled")} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[var(--t-error)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
                <XCircle className="h-3.5 w-3.5" /> Cancel Job
              </button>
            )}
            <button onClick={deleteJob} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[var(--t-error)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
              <Trash2 className="h-3.5 w-3.5" /> Delete Job
            </button>
            {(OVERRIDE_TARGETS[job.status]?.length ?? 0) > 0 && (
              <>
                <div className="my-1 border-t border-[var(--t-border)]" />
                <button onClick={() => { setOverrideTarget(OVERRIDE_TARGETS[job.status]?.[0] || ""); setOverrideReason(""); setOverrideOpen(true); }} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[var(--t-text-muted)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
                  <AlertTriangle className="h-3.5 w-3.5" /> Override Status
                </button>
              </>
            )}
            {job.status === "completed" && (job.job_type === "delivery" || job.job_type === "drop_off") && (
              <>
                <div className="my-1 border-t border-[var(--t-border)]" />
                <button onClick={() => scheduleNext("pickup")} disabled={actionLoading} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
                  <ArrowRight className="h-3.5 w-3.5" /> Schedule Pickup
                </button>
                <button onClick={() => scheduleNext("exchange")} disabled={actionLoading} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
                  <ArrowRight className="h-3.5 w-3.5" /> Schedule Exchange
                </button>
                <button onClick={() => scheduleNext("dump_and_return")} disabled={actionLoading} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
                  <ArrowRight className="h-3.5 w-3.5" /> Schedule Dump & Return
                </button>
              </>
            )}
          </Dropdown>
        </div>
      </div>

      {/* ─── Blocked panel (contextual — only shown when this job is blocked) ─── */}
      {/*
       * Uses the shared `getBlockedReason` helper from
       * @/lib/blocked-job so this panel and the Jobs page stay
       * perfectly in sync on "is this job blocked and why". The panel
       * is a navigation surface only — it never resolves issues
       * directly; operators click through to the authorized Billing
       * Issues or Invoice workflows. Labels and tooltips come from
       * FEATURE_REGISTRY.
       */}
      {(() => {
        const blockedShape = {
          status: job.status,
          open_billing_issue_count: openBillingIssueCount,
          linked_invoice: invoice
            ? { status: invoice.status, balance_due: invoice.balance_due }
            : null,
        };
        const reason = getBlockedReason(blockedShape);
        if (!reason) return null;
        const panelFeature = FEATURE_REGISTRY.job_blocked_panel;
        const reasonFeature =
          reason === "billing_issue"
            ? FEATURE_REGISTRY.blocked_reason_billing_issue
            : FEATURE_REGISTRY.blocked_reason_unpaid_completed_invoice;
        const reviewIssuesLabel =
          FEATURE_REGISTRY.job_blocked_panel_cta_review_issues?.label ?? "Review in Billing Issues";
        const openInvoiceLabel =
          FEATURE_REGISTRY.job_blocked_panel_cta_open_invoice?.label ?? "Open Invoice";
        return (
          <div
            className="mb-4 rounded-[20px] border-l-4 px-5 py-4"
            style={{
              backgroundColor: "var(--t-error-soft)",
              borderColor: "var(--t-error)",
              borderTop: "1px solid var(--t-border)",
              borderRight: "1px solid var(--t-border)",
              borderBottom: "1px solid var(--t-border)",
            }}
            role="alert"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" style={{ color: "var(--t-error)" }} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
                    {panelFeature?.label ?? "Job is blocked"}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--t-text-secondary)" }}>
                    {reasonFeature?.shortDescription ?? reasonFeature?.label ?? reason}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{ backgroundColor: "var(--t-error)", color: "var(--t-error-on-error, #fff)" }}
                    >
                      {reasonFeature?.label ?? reason}
                    </span>
                    {reason === "billing_issue" && openBillingIssueCount > 0 && (
                      <span className="text-[11px]" style={{ color: "var(--t-text-muted)" }}>
                        {openBillingIssueCount} open issue{openBillingIssueCount !== 1 ? "s" : ""} for this job
                      </span>
                    )}
                    {reason === "unpaid_completed_invoice" && invoice && (
                      <span className="text-[11px]" style={{ color: "var(--t-text-muted)" }}>
                        Invoice #{invoice.invoice_number} — {fmt(invoice.balance_due)} due
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/*
                 * Primary CTA — opens the Phase 4 job-scoped resolution
                 * drawer. The drawer keeps the operator on the Job page
                 * and offers root-cause-first resolution (record payment
                 * inline, related issues clear automatically) instead of
                 * forcing a Job → Billing Issues → Invoice → back-to-Job
                 * round trip.
                 */}
                <button
                  type="button"
                  onClick={() => setResolveDrawerOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
                  style={{ backgroundColor: "var(--t-error)", color: "var(--t-error-on-error, #fff)" }}
                  title={FEATURE_REGISTRY.job_blocked_resolution_drawer?.shortDescription}
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {FEATURE_REGISTRY.job_blocked_resolution_cta_primary?.label ?? "Fix Billing"}
                </button>
                {/*
                 * Secondary fallback CTAs preserved for operators who
                 * prefer the dedicated Billing Issues / Invoice surfaces
                 * (e.g., complex resolutions that the inline drawer
                 * cannot handle). The drawer is the recommended path,
                 * but the existing deep-links still work.
                 */}
                {reason === "billing_issue" && (
                  <Link
                    href={`/billing-issues?jobId=${id}`}
                    className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
                    style={{ borderColor: "var(--t-border)", color: "var(--t-text-secondary)" }}
                    title={FEATURE_REGISTRY.job_blocked_panel_cta_review_issues?.shortDescription}
                  >
                    <FileText className="h-3 w-3" /> {reviewIssuesLabel}
                  </Link>
                )}
                {reason === "unpaid_completed_invoice" && invoice && (
                  <Link
                    href={`/invoices/${invoice.id}?openPayment=1`}
                    className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
                    style={{ borderColor: "var(--t-border)", color: "var(--t-text-secondary)" }}
                    title={FEATURE_REGISTRY.job_blocked_panel_cta_open_invoice?.shortDescription}
                  >
                    <DollarSign className="h-3 w-3" /> {openInvoiceLabel}
                  </Link>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── Job Blocked Resolution Drawer (Phase 4) ─── */}
      {/*
       * Mounted unconditionally so SlideOver can animate in/out, but
       * only fetches its scoped issue list when `open === true`. The
       * `onRefetch` callback wires the drawer back into this page's
       * existing fetch routines so the contextual panel reflects the
       * latest invoice + issue state immediately after a payment.
       */}
      <JobBlockedResolutionDrawer
        open={resolveDrawerOpen}
        onClose={() => setResolveDrawerOpen(false)}
        jobId={id as string}
        invoice={invoice}
        onRefetch={() => {
          fetchJob();
          fetchInvoice();
          fetchOpenBillingIssues();
        }}
      />

      {/* --- Post-Create Billing Banner --- */}
      {isPostCreate && invoice && invoice.balance_due > 0 && (
        <div
          className="mb-4 flex items-center justify-between rounded-[20px] border-l-4 px-5 py-4"
          style={{ backgroundColor: "var(--t-accent-soft)", borderColor: "var(--t-accent)", borderTop: "1px solid var(--t-border)", borderRight: "1px solid var(--t-border)", borderBottom: "1px solid var(--t-border)" }}
        >
          <div className="flex items-center gap-3">
            <DollarSign className="h-5 w-5" style={{ color: "var(--t-accent)" }} />
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
                Invoice #{invoice.invoice_number} — {fmt(invoice.balance_due)} due
              </p>
              <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>
                Collect payment to complete this booking
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/invoices/${invoice.id}?openPayment=1`}
              className="flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ backgroundColor: "var(--t-accent)", color: "#fff" }}
            >
              <DollarSign className="h-3.5 w-3.5" /> Collect Payment
            </Link>
            <button
              onClick={() => setIsPostCreate(false)}
              className="rounded-full px-3 py-2 text-xs font-medium transition-colors hover:bg-[var(--t-bg-card-hover)]"
              style={{ color: "var(--t-text-muted)" }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {isPostCreate && invoice && invoice.balance_due <= 0 && (
        <div
          className="mb-4 flex items-center gap-3 rounded-[20px] border px-5 py-3"
          style={{ backgroundColor: "var(--t-bg-card)", borderColor: "var(--t-accent)" }}
        >
          <CheckCircle2 className="h-5 w-5" style={{ color: "var(--t-accent)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>
            Booking created — invoice paid
          </p>
        </div>
      )}
      {isPostCreate && !invoice && (
        <div
          className="mb-4 flex items-center justify-between rounded-[20px] border-l-4 px-5 py-3"
          style={{ backgroundColor: "var(--t-warning-soft, var(--t-bg-card))", borderColor: "var(--t-warning)", borderTop: "1px solid var(--t-border)", borderRight: "1px solid var(--t-border)", borderBottom: "1px solid var(--t-border)" }}
        >
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5" style={{ color: "var(--t-warning)" }} />
            <p className="text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>
              Booking created — no invoice found yet
            </p>
          </div>
        </div>
      )}

      {/* --- Quick Action Buttons --- */}
      <div className="mb-6 flex items-center gap-2 flex-wrap">
        <button
          onClick={async () => {
            if (!invoice) { toast("warning", "No invoice linked to this job"); return; }
            try {
              await api.post(`/invoices/${invoice.id}/send`);
              toast("success", "Invoice sent");
            } catch { toast("error", "Failed to send invoice"); }
          }}
          disabled={actionLoading}
          className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 hover:bg-[var(--t-bg-card-hover)]"
          style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)", background: "none", cursor: "pointer" }}
        >
          <Send className="h-3 w-3" /> Send Invoice
        </button>
        <button
          onClick={() => changeStatus("completed")}
          disabled={actionLoading || !transitions.includes("completed")}
          className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 hover:bg-[var(--t-bg-card-hover)]"
          style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)", background: "none", cursor: "pointer" }}
        >
          <CheckCircle2 className="h-3 w-3" /> Mark Complete
        </button>
        <button
          onClick={async () => {
            const note = prompt("Add a note:");
            if (!note) return;
            try {
              await api.patch(`/jobs/${id}`, { driver_notes: note });
              toast("success", "Note added");
              await fetchJob();
            } catch { toast("error", "Failed to add note"); }
          }}
          disabled={actionLoading}
          className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 hover:bg-[var(--t-bg-card-hover)]"
          style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)", background: "none", cursor: "pointer" }}
        >
          <StickyNote className="h-3 w-3" /> Add Note
        </button>
      </div>

      {/* --- Failed Trip Banner --- */}
      {job.is_failed_trip && (
        <div className="mb-6 rounded-[20px] border px-5 py-4" style={{ borderColor: "var(--t-error)", background: "rgba(220,38,38,0.05)" }}>
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" style={{ color: "var(--t-error)" }} />
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--t-error)" }}>
                Failed Trip
                {job.attempt_count && job.attempt_count > 1 && (
                  <span className="ml-2 text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "var(--t-error-soft)", color: "var(--t-error)" }}>
                    Attempt #{job.attempt_count}
                  </span>
                )}
              </p>
              {job.failed_reason && <p className="text-xs mt-1" style={{ color: "var(--t-text-primary)" }}>{job.failed_reason}</p>}
              {job.failed_at && <p className="text-[11px] mt-1" style={{ color: "var(--t-text-muted)" }}>Failed at {new Date(job.failed_at).toLocaleString()}</p>}
            </div>
          </div>
        </div>
      )}

      {/* --- Timeline --- */}
      <div className="mb-8 rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-6">
        <div className="flex items-center justify-between">
          {TIMELINE_STEPS.map((step, i) => {
            const isCompleted = i <= statusIdx && job.status !== "cancelled";
            const isCurrent = i === statusIdx;
            const timestamp = (job as unknown as Record<string, string>)[step.key];
            return (
              <div key={step.key} className="flex flex-1 items-center">
                <div className="flex flex-col items-center">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                    job.status === "cancelled" && i > statusIdx ? "bg-[var(--t-border)] text-[var(--t-text-muted)]" :
                    isCurrent ? "bg-[var(--t-accent)] text-[var(--t-accent-on-accent)] ring-4 ring-[var(--t-accent)]/20" :
                    isCompleted ? "bg-[var(--t-accent)]/20 text-[var(--t-accent)]" : "bg-[var(--t-border)] text-[var(--t-text-muted)]"
                  }`}>
                    {job.status === "cancelled" && isCurrent ? (
                      <XCircle className="h-4 w-4 text-[var(--t-error)]" />
                    ) : isCompleted ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      i + 1
                    )}
                  </div>
                  <span className={`mt-2 text-[11px] font-medium ${isCurrent ? "text-[var(--t-accent)]" : isCompleted ? "text-[var(--t-text-primary)]" : "text-[var(--t-text-muted)]"}`}>
                    {step.label}
                  </span>
                  {timestamp && (
                    <span className="mt-0.5 text-[10px] text-[var(--t-text-muted)] tabular-nums">
                      {new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </div>
                {i < TIMELINE_STEPS.length - 1 && (
                  <div className={`mx-2 h-0.5 flex-1 rounded-full transition-colors ${
                    i < statusIdx && job.status !== "cancelled" ? "bg-[var(--t-accent)]/30" : "bg-[var(--t-border)]"
                  }`} />
                )}
              </div>
            );
          })}
        </div>
        {job.status === "cancelled" && (
          <div className="mt-4 rounded-[20px] bg-[var(--t-error-soft)] border border-[var(--t-error)]/20 px-4 py-3 text-sm text-[var(--t-error)]">
            <XCircle className="inline h-4 w-4 mr-1.5 -mt-0.5" />
            Cancelled{job.cancelled_at && ` on ${new Date(job.cancelled_at).toLocaleString()}`}
            {job.cancellation_reason && ` — ${job.cancellation_reason}`}
          </div>
        )}
      </div>

      {/* --- Two Column Layout --- */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Left Column (60%) */}
        <div className="space-y-6 lg:col-span-3">
          {/* Service Details */}
          <Card title="Service Details" icon={Truck}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Job Type" value={job.job_type} capitalize />
              <Field label="Service" value={job.service_type?.replace(/_/g, " ") || "—"} capitalize />
              <Field label="Asset" value={job.asset ? `${job.asset.identifier} (${job.asset.subtype})` : "None assigned"} />
              <Field label="Priority" value={job.priority} capitalize />
            </div>
            <div className="mt-4 pt-4 border-t border-[var(--t-border)]">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-[var(--t-text-muted)]">Service Address</p>
                {!editingAddress && (
                  <button onClick={startEditAddress} className="flex items-center gap-1 text-[10px] font-medium text-[var(--t-accent)] hover:opacity-80">
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                )}
              </div>
              {editingAddress ? (
                <div className="space-y-3">
                  <AddressAutocomplete value={editAddress} onChange={setEditAddress} placeholder="Search address..." />
                  {editAddress.street && (
                    <p className="text-xs text-[var(--t-text-muted)]">
                      {[editAddress.street, editAddress.city, editAddress.state, editAddress.zip].filter(Boolean).join(", ")}
                      {editAddress.lat && editAddress.lng ? " ✓ Geocoded" : " — Missing coordinates"}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button onClick={saveAddress} disabled={savingAddress} className="rounded-full px-4 py-1.5 text-xs font-semibold bg-[var(--t-accent)] text-[var(--t-accent-on-accent)] disabled:opacity-50">
                      {savingAddress ? "Saving..." : "Save Address"}
                    </button>
                    <button onClick={() => setEditingAddress(false)} className="rounded-full px-4 py-1.5 text-xs font-medium border border-[var(--t-border)] text-[var(--t-text-muted)]">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : addr && (addr.street || addr.city) ? (
                <>
                  <p className="text-sm text-[var(--t-text-primary)]">{[addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(", ")}</p>
                  {job.placement_notes && <p className="mt-1 text-xs text-[var(--t-text-muted)] italic">Placement: {job.placement_notes}</p>}
                  {(job as any).placement_lat && (job as any).placement_lng && (
                    <div className="mt-4 rounded-[20px] border overflow-hidden" style={{ borderColor: "var(--t-accent)", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
                      <div className="px-4 py-3 flex items-center justify-between" style={{ background: "var(--t-accent-soft)" }}>
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "var(--t-accent)" }}>
                            <MapPin className="h-3.5 w-3.5" style={{ color: "var(--t-accent-on-accent, #fff)" }} />
                          </div>
                          <span className="text-sm font-bold" style={{ color: "var(--t-accent)" }}>
                            {FEATURE_REGISTRY.portal_placement_title?.label ?? "Drop Location"}
                          </span>
                        </div>
                        <a
                          href={`https://www.google.com/maps?q=${(job as any).placement_lat},${(job as any).placement_lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] font-semibold rounded-full border px-3 py-1"
                          style={{ borderColor: "var(--t-accent)", color: "var(--t-accent)" }}
                        >
                          {FEATURE_REGISTRY.portal_placement_open_maps?.label ?? "Open in Maps"} →
                        </a>
                      </div>
                      {/* Static satellite preview */}
                      <img
                        src={`https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/pin-l+FACC15(${(job as any).placement_lng},${(job as any).placement_lat})/${(job as any).placement_lng},${(job as any).placement_lat},17.5,0/600x200@2x?access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}`}
                        alt="Drop location"
                        className="w-full h-[160px] object-cover"
                        loading="lazy"
                      />
                      {(job as any).placement_pin_notes && (
                        <div className="px-4 py-3" style={{ borderTop: "1px solid var(--t-border)", background: "var(--t-bg-card)" }}>
                          <p className="text-xs" style={{ color: "var(--t-text-secondary)" }}>
                            <span className="font-semibold" style={{ color: "var(--t-text-primary)" }}>{FEATURE_REGISTRY.portal_placement_notes_label?.label ?? "Notes for the driver"}:</span> {(job as any).placement_pin_notes}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {addr.lat && addr.lng && !((job as any).placement_lat && (job as any).placement_lng) && (
                    <div className="mt-3">
                      <MapboxMap
                        markers={[{ id: job.id, lat: Number(addr.lat), lng: Number(addr.lng), type: job.job_type as any, label: job.asset?.subtype?.replace("yd","") || "" }]}
                        center={{ lat: Number(addr.lat), lng: Number(addr.lng) }}
                        zoom={14}
                        interactive={false}
                        showControls={false}
                        fitBounds={false}
                        style={{ height: 180, width: "100%" }}
                      />
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-[var(--t-text-muted)]">No address set — <button onClick={startEditAddress} className="text-[var(--t-accent)] hover:underline">add one</button></p>
              )}
            </div>
          </Card>

          {/* Scheduling */}
          <Card title="Scheduling" icon={Calendar}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Scheduled Date" value={job.scheduled_date ? fmtDateFull(job.scheduled_date) : "Not set"} />
              <Field label="Time Window" value={
                job.scheduled_window_start
                  ? `${fmtTime(job.scheduled_window_start)}${job.scheduled_window_end ? ` – ${fmtTime(job.scheduled_window_end)}` : ""}`
                  : "Any time"
              } />
              {job.rental_start_date && <Field label="Rental Start" value={fmtDateFull(job.rental_start_date)} />}
              {job.rental_end_date && <Field label="Rental End" value={fmtDateFull(job.rental_end_date)} />}
              {rentalDays ? <Field label="Rental Days" value={`${rentalDays} days`} /> : null}
            </div>
            {job.rental_start_date && job.rental_end_date && (
              <div className="mt-3 pt-3 border-t border-[var(--t-border)] text-xs text-[var(--t-text-muted)]">
                {fmtDateFull(job.rental_start_date)} <ArrowRight className="inline h-3 w-3 mx-1" /> {fmtDateFull(job.rental_end_date)} ({rentalDays} days)
              </div>
            )}
          </Card>

          {/* Driver Notes */}
          {job.driver_notes && (
            <Card title="Driver Notes" icon={Truck}>
              <p className="text-sm text-[var(--t-text-primary)] whitespace-pre-wrap">{job.driver_notes}</p>
            </Card>
          )}

          {/* Photos */}
          {job.photos && job.photos.length > 0 && (
            <Card title={`Photos (${job.photos.length})`} icon={Box}>
              <div className="grid grid-cols-3 gap-3">
                {job.photos.map((p, i) => (
                  <div key={i} className="aspect-square rounded-[20px] bg-[var(--t-border)] overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Dump Tickets */}
          {dumpTickets.length > 0 && (
            <Card title={`Dump Tickets (${dumpTickets.length})`} icon={FileText}>
              <div className="space-y-4">
                {dumpTickets.map((t) => {
                  const statusColors: Record<string, string> = {
                    submitted: "bg-yellow-500/10 text-yellow-500",
                    reviewed: "bg-emerald-500/10 text-emerald-400",
                    corrected: "bg-orange-500/10 text-orange-400",
                    voided: "bg-red-500/10 text-red-400",
                  };
                  return (
                    <div key={t.id} className={`rounded-xl border p-4 space-y-2 ${t.status === "voided" ? "opacity-50 border-red-500/20" : "border-[var(--t-border)]"}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-[var(--t-text-primary)]">
                          Ticket #{t.ticket_number || "—"}
                        </span>
                        <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${statusColors[t.status] || "bg-gray-500/10 text-gray-400"}`}>
                          {t.status}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-[var(--t-text-muted)]">Location: </span>
                          <span className="text-[var(--t-text-primary)]">{t.dump_location_name}</span>
                        </div>
                        <div>
                          <span className="text-[var(--t-text-muted)]">Waste: </span>
                          <span className="text-[var(--t-text-primary)] capitalize">{t.waste_type?.replace(/_/g, " ")}</span>
                        </div>
                        <div>
                          <span className="text-[var(--t-text-muted)]">Weight: </span>
                          <span className="text-[var(--t-text-primary)]">{Number(t.weight_tons).toFixed(2)} tons</span>
                        </div>
                        <div>
                          <span className="text-[var(--t-text-muted)]">Customer charges: </span>
                          <span className="text-[var(--t-text-primary)]">{fmt(t.customer_charges)}</span>
                        </div>
                      </div>
                      {t.void_reason && (
                        <p className="text-xs text-red-400">Void reason: {t.void_reason}</p>
                      )}
                      {/* Actions */}
                      {t.status !== "voided" && (
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={async () => {
                              const newWeight = prompt("Correct weight (tons):", String(t.weight_tons));
                              if (!newWeight) return;
                              const w = Number(newWeight);
                              if (w === 0) { if (!confirm("Weight is 0 — are you sure?")) return; }
                              else if (w > 10) { if (!confirm("Weight seems high (" + w + " tons) — are you sure?")) return; }
                              try {
                                await api.patch(`/dump-tickets/${t.id}`, { weightTons: w, reason: "Admin correction" });
                                toast("success", "Dump ticket updated");
                                fetchDumpTickets();
                              } catch (e: any) { toast("error", e.message || "Failed to update"); }
                            }}
                            className="text-[10px] font-medium text-[var(--t-accent)] hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            onClick={async () => {
                              if (!confirm(`Void ticket #${t.ticket_number || t.id}? This cannot be undone.`)) return;
                              const reason = prompt("Void reason:");
                              if (!reason) return;
                              try {
                                await api.post(`/dump-tickets/${t.id}/void`, { reason });
                                toast("success", "Dump ticket voided");
                                fetchDumpTickets();
                              } catch (e: any) { toast("error", e.message || "Failed to void"); }
                            }}
                            className="text-[10px] font-medium text-[var(--t-error)] hover:underline"
                          >
                            Void
                          </button>
                          {t.status === "submitted" && (
                            <button
                              onClick={async () => {
                                try {
                                  await api.post(`/jobs/${id}/dump-slip/review`);
                                  toast("success", "Dump slip reviewed");
                                  fetchDumpTickets();
                                } catch (e: any) { toast("error", e.message || "Failed"); }
                              }}
                              className="text-[10px] font-medium text-emerald-400 hover:underline"
                            >
                              Finalize
                            </button>
                          )}
                          {t.revisions && t.revisions.length > 0 && (
                            <button
                              onClick={() => setShowRevisions(showRevisions === t.id ? null : t.id)}
                              className="text-[10px] font-medium text-[var(--t-text-muted)] hover:underline"
                            >
                              {showRevisions === t.id ? "Hide" : "Show"} History ({t.revisions.length})
                            </button>
                          )}
                        </div>
                      )}
                      {/* Correction History */}
                      {showRevisions === t.id && t.revisions && t.revisions.length > 0 && (
                        <div className="mt-2 border-t border-[var(--t-border)] pt-2 space-y-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)]">Correction History</p>
                          {t.revisions.map((rev, ri) => (
                            <div key={ri} className="text-xs space-y-0.5 pl-2 border-l-2 border-[var(--t-border)]">
                              <p className="text-[var(--t-text-muted)]">
                                Rev {rev.revision} &middot; {rev.changedByRole} &middot; {new Date(rev.changedAt).toLocaleString()}
                              </p>
                              {rev.reason && <p className="text-[var(--t-text-secondary)]">Reason: {rev.reason}</p>}
                              {Object.entries(rev.changes).map(([field, val]) => (
                                <p key={field} className="text-[var(--t-text-primary)]">
                                  <span className="text-[var(--t-text-muted)]">{field.replace(/_/g, " ")}:</span>{" "}
                                  <span className="line-through text-red-400">{String(val.old)}</span>{" → "}
                                  <span className="text-emerald-400">{String(val.new)}</span>
                                </p>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Invoice Summary */}
          {invoice && (
            <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5">
              <button
                onClick={() => setInvoiceOpen(!invoiceOpen)}
                className="flex w-full items-center justify-between"
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
              >
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-[var(--t-text-muted)]" />
                  <h3 className="text-sm font-semibold text-[var(--t-text-primary)]">Invoice Summary</h3>
                </div>
                {invoiceOpen ? <ChevronUp className="h-4 w-4 text-[var(--t-text-muted)]" /> : <ChevronDown className="h-4 w-4 text-[var(--t-text-muted)]" />}
              </button>
              {invoiceOpen && (
                <div className="mt-4 space-y-2.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[var(--t-text-muted)]">Invoice #</span>
                    <span className="text-[var(--t-text-primary)] font-medium">{invoice.invoice_number}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--t-text-muted)]">Status</span>
                    <span className="capitalize font-medium" style={{
                      color: invoice.status === "paid" ? "var(--t-accent)" : invoice.status === "overdue" ? "var(--t-error)" : "var(--t-warning)"
                    }}>{invoice.status}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--t-text-muted)]">Total</span>
                    <span className="text-[var(--t-text-primary)] tabular-nums font-semibold">{fmt(invoice.total)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--t-text-muted)]">Balance Due</span>
                    <span className="tabular-nums font-semibold" style={{ color: invoice.balance_due > 0 ? "var(--t-warning)" : "var(--t-accent)" }}>{fmt(invoice.balance_due)}</span>
                  </div>
                  <div className="pt-2 border-t border-[var(--t-border)]">
                    <Link href={`/invoices/${invoice.id}`} className="flex items-center gap-1.5 text-xs font-medium text-[var(--t-accent)] hover:underline">
                      <ExternalLink className="h-3 w-3" /> View Full Invoice
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column (40%) */}
        <div className="space-y-6 lg:col-span-2">
          {/* Pricing */}
          <Card title="Pricing" icon={DollarSign}>
            <div className="space-y-2.5 text-sm">
              <PriceRow label="Base Price" value={fmt(job.base_price)} />
              {job.deposit_amount > 0 && <PriceRow label="Deposit" value={fmt(job.deposit_amount)} />}
              {job.rental_days && job.rental_days > 0 && <PriceRow label="Rental Period" value={`${job.rental_days} days`} />}
              <div className="flex justify-between border-t border-[var(--t-border)] pt-2.5 font-semibold">
                <span className="text-[var(--t-text-primary)]">Total</span>
                <span className="text-[var(--t-accent)] tabular-nums text-base">{fmt(job.total_price)}</span>
              </div>
              {job.extra_day_charges != null && job.extra_day_charges > 0 && (
                <PriceRow label={`Extra Days (${job.extra_days || 0}d)`} value={fmt(job.extra_day_charges)} />
              )}
            </div>
          </Card>

          {/* Rental Overage */}
          {(job.is_overdue || (job.extra_days != null && job.extra_days > 0)) && (
            <div className="rounded-[20px] border p-5" style={{ background: "var(--t-bg-card)", borderColor: job.is_overdue ? "var(--t-error)" : "var(--t-warning)" }}>
              <div className="flex items-center gap-2 mb-3">
                <Clock className="h-4 w-4" style={{ color: job.is_overdue ? "var(--t-error)" : "var(--t-warning)" }} />
                <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--t-text-muted)" }}>Rental Overage</span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span style={{ color: "var(--t-text-muted)" }}>Extra Days</span>
                  <span className="font-semibold tabular-nums" style={{ color: job.is_overdue ? "var(--t-error)" : "var(--t-text-primary)" }}>{job.extra_days || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "var(--t-text-muted)" }}>Daily Rate</span>
                  <span className="tabular-nums" style={{ color: "var(--t-text-primary)" }}>{fmt(job.extra_day_rate)}</span>
                </div>
                <div className="flex justify-between pt-2 font-semibold" style={{ borderTop: "1px solid var(--t-border)" }}>
                  <span style={{ color: "var(--t-text-primary)" }}>Extra Charges</span>
                  <span className="tabular-nums" style={{ color: job.is_overdue ? "var(--t-error)" : "var(--t-accent)" }}>{fmt(job.extra_day_charges)}</span>
                </div>
              </div>
              {job.rental_start_date && job.rental_end_date && (
                <p className="text-[11px] mt-3" style={{ color: "var(--t-text-muted)" }}>
                  Rental: {fmtDateFull(job.rental_start_date)} — {fmtDateFull(job.rental_end_date)} ({job.rental_days || 0} days included)
                </p>
              )}
            </div>
          )}

          {/* Customer */}
          {job.customer && (
            <Link href={`/customers/${job.customer.id}`} className="block">
              <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5 transition-colors hover:bg-[var(--t-bg-card-hover)]">
                <div className="flex items-center gap-2 mb-3">
                  <User className="h-4 w-4 text-[var(--t-text-muted)]" />
                  <span className="text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Customer</span>
                </div>
                <p className="text-sm font-semibold text-[var(--t-text-primary)]">{job.customer.first_name} {job.customer.last_name}</p>
                {job.customer.phone && <a href={`tel:${job.customer.phone}`} className="block text-xs text-[var(--t-text-muted)] mt-0.5 hover:text-[var(--t-accent)]">{job.customer.phone}</a>}
                {job.customer.email && <p className="text-xs text-[var(--t-text-muted)]">{job.customer.email}</p>}
              </div>
            </Link>
          )}

          {/* Driver */}
          <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5">
            <div className="flex items-center gap-2 mb-3">
              <Truck className="h-4 w-4 text-[var(--t-text-muted)]" />
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Driver</span>
            </div>
            {job.assigned_driver ? (
              <>
                <p className="text-sm font-semibold text-[var(--t-text-primary)]">{job.assigned_driver.first_name} {job.assigned_driver.last_name}</p>
                {job.assigned_driver.phone && <a href={`tel:${job.assigned_driver.phone}`} className="block text-xs text-[var(--t-text-muted)] mt-0.5 hover:text-[var(--t-accent)]">{job.assigned_driver.phone}</a>}
              </>
            ) : (
              <p className="text-sm font-medium text-[var(--t-error)]">Unassigned</p>
            )}
          </div>

          {/* Asset */}
          <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5">
            <div className="flex items-center gap-2 mb-3">
              <Box className="h-4 w-4 text-[var(--t-text-muted)]" />
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Asset</span>
            </div>
            {job.asset ? (
              <>
                <p className="text-sm font-semibold text-[var(--t-text-primary)]">{job.asset.identifier}</p>
                <p className="text-xs text-[var(--t-text-muted)] mt-0.5 capitalize">{job.asset.asset_type} &middot; {job.asset.subtype}</p>
              </>
            ) : (
              <p className="text-sm text-[var(--t-text-muted)]">None assigned</p>
            )}
          </div>

          {/* Signature */}
          {job.signature_url && (
            <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5">
              <h3 className="text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)] mb-3">Signature</h3>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={job.signature_url} alt="Signature" className="max-h-20 rounded bg-white p-2" />
            </div>
          )}
        </div>
      </div>

      {/* --- Override Status Modal --- */}
      {overrideOpen && job && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOverrideOpen(false)} />
          <div className="relative rounded-[20px] p-6 w-full max-w-md shadow-2xl" style={{ backgroundColor: "var(--t-bg-secondary)", border: "1px solid var(--t-border)" }}>
            <h3 className="text-base font-semibold mb-1" style={{ color: "var(--t-text-primary)" }}>Override Status</h3>
            <p className="text-xs mb-4" style={{ color: "var(--t-text-muted)" }}>
              Correct a driver status error. This action is recorded.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--t-text-muted)" }}>Target Status</label>
                <select
                  value={overrideTarget}
                  onChange={(e) => setOverrideTarget(e.target.value)}
                  className="w-full rounded-[14px] border px-3.5 py-2.5 text-sm outline-none focus:border-[var(--t-accent)]"
                  style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
                >
                  {(OVERRIDE_TARGETS[job.status] || []).map((s) => (
                    <option key={s} value={s}>{DISPLAY_STATUS_LABELS[deriveDisplayStatus(s)]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--t-text-muted)" }}>Reason (required)</label>
                <input
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="e.g. Driver tapped wrong button"
                  className="w-full rounded-[14px] border px-3.5 py-2.5 text-sm outline-none focus:border-[var(--t-accent)]"
                  style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleOverride}
                  disabled={!overrideTarget || !overrideReason.trim() || actionLoading}
                  className="flex-1 rounded-full py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{ backgroundColor: "var(--t-warning)", color: "#000" }}
                >
                  {actionLoading ? "Overriding..." : "Confirm Override"}
                </button>
                <button
                  onClick={() => setOverrideOpen(false)}
                  className="rounded-full px-5 py-2.5 text-sm font-medium border transition-colors hover:bg-[var(--t-bg-card-hover)]"
                  style={{ borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* --- Reusable Components --- */

function Card({ title, icon: Icon, children }: { title: string; icon: typeof User; children: React.ReactNode }) {
  return (
    <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="h-4 w-4 text-[var(--t-text-muted)]" />
        <h3 className="text-sm font-semibold text-[var(--t-text-primary)]">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, capitalize: cap }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div>
      <p className="text-xs text-[var(--t-text-muted)] mb-0.5">{label}</p>
      <p className={`text-sm text-[var(--t-text-primary)] font-medium ${cap ? "capitalize" : ""}`}>{value}</p>
    </div>
  );
}

function PriceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[var(--t-text-muted)]">{label}</span>
      <span className={`text-[var(--t-text-primary)] ${value.startsWith("$") ? "tabular-nums" : ""}`}>{value}</span>
    </div>
  );
}
