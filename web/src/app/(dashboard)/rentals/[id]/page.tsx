"use client";

import { useState, useEffect, use, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import HelpTooltip from "@/components/ui/HelpTooltip";
import { ArrowLeft, Truck, MapPin, Calendar, Package, DollarSign, CheckCircle2, Clock, ArrowRight, FileText, Pencil, Repeat } from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { FEATURE_REGISTRY, getFeatureLabel } from "@/lib/feature-registry";
import { deriveDisplayStatus, DISPLAY_STATUS_LABELS, displayStatusColor } from "@/lib/job-status";
import { broadcastLifecycleChange } from "@/lib/lifecycle-sync";
import {
  selectActivePickupNode,
  toCandidateFromCamelCaseJob,
} from "@/lib/lifecycle-pickup";
import { navigateBack } from "@/lib/navigation";
import ScheduleExchangeModal from "@/components/schedule-exchange-modal";

/* ── Types (from /rental-chains/:id/lifecycle response) ── */

interface LifecycleJob {
  id: string;
  linkId?: string;
  linkStatus?: string;
  jobNumber: string;
  taskType: string;
  status: string;
  scheduledDate: string;
  completedAt: string | null;
  asset: { subtype: string; identifier: string } | null;
  driver: { name: string } | null;
  /** Projected from `link.sequence_number` by the
   *  `/rental-chains/:id/lifecycle` endpoint (see Prereq-0 commit 0b764ad).
   *  Fed into the canonical pickup-node selector so this page's CTA
   *  agrees with `LifecycleContextPanel` for back-dated exchange
   *  scenarios (where the newer pickup has a higher sequence_number but
   *  an earlier scheduled_date). Required and non-nullable — the
   *  underlying DB column is INT NOT NULL. */
  sequence_number: number;
}

interface LifecycleInvoice {
  id: string;
  invoiceNumber: number;
  total: number;
  status: string;
  balanceDue: number;
}

interface LifecyclePayment {
  id: string;
  amount: number;
  status: string;
  paymentMethod: string;
  appliedAt: string;
}

interface LifecycleDumpTicket {
  id: string;
  ticketNumber: string | null;
  weightTons: number;
  totalCost: number;
  customerCharges: number;
  wasteType: string | null;
}

interface LifecycleData {
  rentalChain: {
    id: string;
    status: string;
    dumpsterSize: string;
    rentalDays: number;
    /** Phase 10B: live tenant setting, not the chain's historical snapshot. */
    tenantRentalDays?: number;
    dropOffDate: string;
    expectedPickupDate: string | null;
    createdAt: string;
  };
  customer: { id: string; name: string; accountId: string } | null;
  jobs: LifecycleJob[];
  invoices: LifecycleInvoice[];
  payments: LifecyclePayment[];
  /** Phase 11B: disposal rollup surfaced from backend getLifecycle. */
  dumpTickets?: LifecycleDumpTicket[];
  /** Field names mirror the backend RentalChainLifecycleFinancialsDto
   *  (api/src/modules/rental-chains/dto/lifecycle-response.dto.ts).
   *  marginPercent is in the 0–100 range (e.g. 70 = 70%), not 0–1. */
  financials: { totalRevenue: number; totalCost: number; profit: number; marginPercent: number };
}

/* ── Helpers ── */

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const TASK_TYPE_LABELS: Record<string, string> = {
  drop_off: FEATURE_REGISTRY.rental_lifecycle_task_drop_off?.label ?? "Delivery",
  pick_up: FEATURE_REGISTRY.rental_lifecycle_task_pick_up?.label ?? "Pickup",
  exchange: FEATURE_REGISTRY.rental_lifecycle_task_exchange?.label ?? "Exchange",
};

const TASK_TYPE_COLORS: Record<string, string> = {
  drop_off: "text-blue-400",
  pick_up: "text-orange-400",
  exchange: "text-purple-400",
};

const STATUS_LABELS: Record<string, string> = {
  active: FEATURE_REGISTRY.rental_lifecycle_status_active?.label ?? "Active",
  completed: FEATURE_REGISTRY.rental_lifecycle_status_completed?.label ?? "Completed",
  cancelled: "Cancelled",
};

/* ── Date-rule helpers (Phase 10B) ── */

/**
 * Base date for auto pickup calculation — the LAST non-cancelled
 * exchange in the chain if one exists, otherwise the delivery date.
 * Matches the backend's rescheduleExchange/createExchange rule and
 * produces the same value the Phase 8 delivery shift preserves.
 */
function getAutoBaseDate(data: LifecycleData): string | null {
  const activeExchanges = (data.jobs ?? [])
    .filter(j => j.taskType === "exchange" && j.linkStatus === "scheduled" && j.scheduledDate)
    .sort((a, b) => (a.scheduledDate < b.scheduledDate ? 1 : -1)); // DESC
  if (activeExchanges.length > 0) return activeExchanges[0].scheduledDate;
  return data.rentalChain.dropOffDate || null;
}

function shiftDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

function fmtShortDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Substitute `{days}`/`{date}` placeholders in registry label text. */
function interp(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

/* ── Reusable components (Phase 10B) ── */

/**
 * Date input where a click anywhere in the field opens the native
 * calendar picker, not just the calendar icon. Falls back gracefully
 * on browsers without `showPicker()` support (pre-Safari 16.4).
 */
function LifecycleDateInput({
  value,
  onChange,
  min,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  min?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <input
      ref={ref}
      type="date"
      value={value}
      min={min}
      onChange={(e) => onChange(e.target.value)}
      onClick={() => {
        try {
          ref.current?.showPicker?.();
        } catch {
          /* Unsupported browser — native click already handled */
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          try {
            ref.current?.showPicker?.();
          } catch {
            /* ignore */
          }
        }
      }}
      className={className}
    />
  );
}

/**
 * Preview of the resulting pickup date for a lifecycle modal. Shows
 * either "Auto (N-day rental)" when the user-entered pickup matches
 * the auto-calculated value, or "(Override — auto would be <date>)"
 * when the two diverge. Computed in real time from base date + tenant
 * rental days — no API call.
 */
function PickupPreview({
  label,
  autoDate,
  overrideDate,
  rentalDays,
}: {
  label?: string;
  autoDate: string | null;
  /** If set, the user typed an explicit override. Otherwise the preview shows auto. */
  overrideDate?: string;
  rentalDays: number;
}) {
  const actual = overrideDate || autoDate;
  if (!actual) return null;
  const isAuto = !overrideDate || overrideDate === autoDate;
  const autoSuffixTpl =
    FEATURE_REGISTRY.auto_calculated_with_days?.label ?? "Auto ({days}-day rental)";
  const overrideSuffixTpl =
    FEATURE_REGISTRY.rental_rule_override?.label ?? "Override — auto would be {date}";
  const headerLabel =
    label ?? FEATURE_REGISTRY.date_change_preview?.label ?? "New pickup date will be:";
  return (
    <div className="mt-1 mb-3 flex items-start gap-1.5">
      <div className="flex-1 text-[11px] text-[var(--t-text-muted)] leading-relaxed">
        <span>{headerLabel}</span>{" "}
        <span className="font-semibold text-[var(--t-text-primary)]">{fmtShortDate(actual)}</span>{" "}
        <span>
          ({isAuto
            ? interp(autoSuffixTpl, { days: rentalDays })
            : interp(overrideSuffixTpl, { date: fmtShortDate(autoDate || "") })})
        </span>
      </div>
      <HelpTooltip featureId="help_rental_date_calculation" placement="left" />
    </div>
  );
}

/* ── Page ── */

export default function RentalLifecyclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<LifecycleData | null>(null);
  const [loading, setLoading] = useState(true);
  // Phase 2c — pickup-date editing now lives only in the Job Detail
  // Connected Job Lifecycle panel. The legacy modal/state on this
  // page was removed in favor of an explicit CTA that navigates to
  // the active pickup job (see actions row).
  // Phase 4b-extract — replaced inline exchange state with lightweight
  // open-state flags. The shared <ScheduleExchangeModal /> component
  // owns all form state, validation, pricing fetch, submit, and
  // broadcastLifecycleChange internally.
  const [createExchangeOpen, setCreateExchangeOpen] = useState(false);
  const [editExchange, setEditExchange] = useState<{
    linkId: string;
    currentDate: string;
  } | null>(null);
  // Edit delivery date modal state
  const [deliveryModalOpen, setDeliveryModalOpen] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryShift, setDeliveryShift] = useState(true);
  const [deliverySaving, setDeliverySaving] = useState(false);
  const [deliveryError, setDeliveryError] = useState("");

  const reload = () => api.get<LifecycleData>(`/rental-chains/${id}/lifecycle`).then(setData).catch(() => {});

  useEffect(() => {
    api.get<LifecycleData>(`/rental-chains/${id}/lifecycle`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  // Phase 4b-extract — pricing fetch now lives inside
  // <ScheduleExchangeModal /> (create mode), removed from this page.

  const handleDeliveryUpdate = async () => {
    if (!data || !deliveryDate) return;
    if (deliveryDate === data.rentalChain.dropOffDate) {
      setDeliveryError(FEATURE_REGISTRY.delivery_date_unchanged?.label ?? "New delivery date matches the current date");
      return;
    }
    setDeliverySaving(true);
    setDeliveryError("");
    try {
      await api.patch(`/rental-chains/${id}`, {
        drop_off_date: deliveryDate,
        shift_downstream: deliveryShift,
      });
      setDeliveryModalOpen(false);
      setDeliveryDate("");
      broadcastLifecycleChange(id);
      await reload();
    } catch (err: unknown) {
      setDeliveryError(err instanceof Error ? err.message : (FEATURE_REGISTRY.lifecycle_update_error?.label ?? "Failed to update lifecycle"));
    } finally {
      setDeliverySaving(false);
    }
  };

  // Phase 4b-extract — handleExchangeReschedule + handleScheduleExchange
  // were removed from this page. The shared <ScheduleExchangeModal />
  // component now owns both submit paths + broadcastLifecycleChange;
  // this page only provides an onSuccess callback that calls reload().

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 rounded-lg bg-[var(--t-bg-card)] animate-pulse" />
        <div className="h-40 rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] animate-pulse" />
        <div className="h-60 rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] animate-pulse" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-[var(--t-text-muted)]">Rental lifecycle not found.</p>
        <button onClick={() => router.back()} className="mt-3 text-sm text-[var(--t-accent)] hover:underline">Go back</button>
      </div>
    );
  }

  const rentalChain = data.rentalChain;
  const customer = data.customer;
  const jobs = data.jobs?.filter(j => j?.id) ?? [];
  const invoices = data.invoices ?? [];
  const payments = data.payments ?? [];
  const financials = data.financials ?? { totalRevenue: 0, totalCost: 0, profit: 0, marginPercent: 0 };
  const dumpTickets = data.dumpTickets ?? [];
  const totalDisposalCost = dumpTickets.reduce((sum, t) => sum + (Number(t.totalCost) || 0), 0);
  const totalDisposalCustomerCharges = dumpTickets.reduce((sum, t) => sum + (Number(t.customerCharges) || 0), 0);
  const deliveryJob = jobs.find(j => j.taskType === "drop_off");
  const isActive = rentalChain.status === "active";

  // Phase 2c — active pickup job for the deep-link CTA. Derivation
  // is delegated to @/lib/lifecycle-pickup so this surface and
  // LifecycleContextPanel are provably in agreement; see that
  // module's contract header for the canonical filter + tiebreak
  // rules.
  const pickupCandidate = selectActivePickupNode(
    jobs.map(toCandidateFromCamelCaseJob),
  );
  const pickupJob = pickupCandidate
    ? jobs.find((j) => j.id === pickupCandidate.id) ?? null
    : null;

  // Phase 10B — auto vs override derivation for the header pickup
  // badge. tenantRentalDays is the live setting (falls back to the
  // chain's historical snapshot if the live setting is absent).
  const tenantRentalDays =
    rentalChain.tenantRentalDays ?? rentalChain.rentalDays;
  const autoBaseDate = getAutoBaseDate(data);
  const autoPickupDate = autoBaseDate ? shiftDays(autoBaseDate, tenantRentalDays) : null;
  const isPickupAuto =
    !!rentalChain.expectedPickupDate &&
    !!autoPickupDate &&
    rentalChain.expectedPickupDate === autoPickupDate;

  return (
    <div className="space-y-6">
      {/* History-first back nav. The previous implementation
          called `router.back()` unconditionally, which did nothing
          on direct URL access (fresh tab, deep link, hard reload).
          Falls back to `/jobs` (the Rental Lifecycles hub) when
          there is no real history to pop. */}
      <button
        type="button"
        onClick={() => navigateBack(router, "/jobs")}
        className="flex items-center gap-1.5 text-sm text-[var(--t-accent)] font-medium hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {/* Header */}
      <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-[var(--t-text-primary)]">
              {FEATURE_REGISTRY.rental_lifecycle?.label ?? "Rental Lifecycle"}
            </h1>
            {customer && (
              <Link href={`/customers/${customer.id}`} className="text-sm text-[var(--t-accent)] hover:underline mt-0.5 block">
                {customer.name}
              </Link>
            )}
          </div>
          <span className={`text-xs font-semibold px-3 py-1 rounded-full ${isActive ? "bg-[var(--t-accent-soft)] text-[var(--t-accent)]" : "bg-[var(--t-bg-elevated)] text-[var(--t-text-muted)]"}`}>
            {STATUS_LABELS[rentalChain.status] || rentalChain.status}
          </span>
        </div>

        {/* Key details grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">
              {FEATURE_REGISTRY.job_detail_delivery_date?.label ?? "Delivery Date"}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-sm font-semibold text-[var(--t-text-primary)]">{fmtDate(rentalChain.dropOffDate)}</p>
              {isActive && (
                <button onClick={() => {
                    setDeliveryModalOpen(true);
                    setDeliveryDate(rentalChain.dropOffDate || "");
                    setDeliveryShift(true);
                    setDeliveryError("");
                  }}
                  className="text-[var(--t-accent)] hover:opacity-70 transition-opacity"
                  title={FEATURE_REGISTRY.edit_delivery_date?.label ?? "Edit Delivery Date"}>
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1">
              <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">
                {FEATURE_REGISTRY.job_detail_pickup_date?.label ?? "Pickup Date"}
              </p>
              <HelpTooltip featureId="help_auto_vs_manual_dates" placement="top" />
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-sm font-semibold text-[var(--t-text-primary)]">{fmtDate(rentalChain.expectedPickupDate)}</p>
              {/* Phase 2c — pencil removed; pickup-date editing now lives
                  only on Job Detail. The deep-link CTA in the actions
                  row is the single entry point. */}
            </div>
            {rentalChain.expectedPickupDate && (
              <p className="text-[10px] text-[var(--t-text-muted)] mt-0.5">
                {isPickupAuto
                  ? interp(
                      FEATURE_REGISTRY.auto_calculated_with_days?.label ?? "Auto ({days}-day rental)",
                      { days: tenantRentalDays },
                    )
                  : FEATURE_REGISTRY.manually_overridden?.label ?? "Manually set"}
              </p>
            )}
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Dumpster</p>
            <p className="text-sm font-semibold text-[var(--t-text-primary)] mt-0.5">{rentalChain.dumpsterSize || "—"}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Rental Days</p>
            <p className="text-sm font-semibold text-[var(--t-text-primary)] mt-0.5">{rentalChain.rentalDays ? `${rentalChain.rentalDays} days` : "—"}</p>
          </div>
        </div>

        {/* Phase 11A — current on-site asset, derived from the most
            recent completed delivery or exchange in the chain so it
            correctly reflects the physical state after exchanges. */}
        {(() => {
          const onSite = (jobs ?? [])
            .slice()
            .reverse()
            .find(
              (j) =>
                (j.taskType === "drop_off" || j.taskType === "exchange") &&
                j.status === "completed" &&
                j.asset,
            );
          if (!onSite?.asset) return null;
          return (
            <div className="mt-4 pt-4 border-t border-[var(--t-border)] flex items-center gap-2 text-sm text-[var(--t-text-muted)]">
              <Package className="h-3.5 w-3.5" />
              <span>
                On-site asset:{" "}
                <span className="text-[var(--t-text-primary)] font-medium">
                  {onSite.asset.identifier} ({onSite.asset.subtype})
                </span>
              </span>
            </div>
          );
        })()}
      </div>

      {/* Actions */}
      {/* Phase 2c Follow-Up #2 — gated on pickupJob to match
          LifecycleContextPanel's canScheduleExchange visibility rule.
          Both actions in this row depend on an active pickup node, so
          the row itself is gated rather than each button individually
          (avoids an empty flex container when pickupJob === null). */}
      {isActive && pickupJob && (
        <div className="flex gap-2">
          {/* Phase 2c — pickup-date editing has moved to Job Detail
              (Connected Job Lifecycle panel). This is an explicit,
              user-initiated deep link to the active pickup job; no
              auto-redirect. */}
          <Link
            href={`/jobs/${pickupJob.id}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2 text-xs font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors no-underline"
          >
            <Pencil className="h-3 w-3" />
            {getFeatureLabel("job_detail_edit_pickup_date_cta")}
            <ArrowRight className="h-3 w-3" />
          </Link>
          <button onClick={() => setCreateExchangeOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2 text-xs font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
            <Repeat className="h-3 w-3" /> {FEATURE_REGISTRY.schedule_exchange?.label ?? "Schedule Exchange"}
          </button>
        </div>
      )}

      {/* Connected Tasks */}
      <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="h-4 w-4 text-[var(--t-text-muted)]" />
          <h2 className="text-sm font-semibold text-[var(--t-text-primary)]">
            {FEATURE_REGISTRY.rental_lifecycle_connected_tasks?.label ?? "Connected Tasks"}
          </h2>
        </div>

        {/* Timeline */}
        <div className="space-y-2">
          {jobs.map((job, i) => {
            const status = job.status || "pending";
            // Live-derived: pass the full job so the connected-
            // task chip reflects the current driver assignment, not
            // just the raw stored status. The chain-connected job
            // shape carries `assigned_driver_id` (see interface
            // below); if it's missing on a legacy payload the
            // function falls through to the status-only branch.
            const ds = deriveDisplayStatus({ status, assigned_driver_id: (job as { assigned_driver_id?: string | null }).assigned_driver_id });
            const isDone = status === "completed";
            const isCancelled = status === "cancelled";
            const typeColor = TASK_TYPE_COLORS[job.taskType] || "text-[var(--t-text-muted)]";
            return (
              <div key={job.id || i} className="flex items-center gap-3">
                {/* Sequence indicator */}
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${
                  isDone ? "border-[var(--t-accent)] bg-[var(--t-accent)]" : isCancelled ? "border-[var(--t-error)]/30 bg-transparent" : "border-[var(--t-border)] bg-[var(--t-bg-card)]"
                }`}>
                  {isDone ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-[var(--t-accent-on-accent)]" />
                  ) : (
                    <span className={`text-[10px] font-bold ${isCancelled ? "text-[var(--t-error)]" : "text-[var(--t-text-muted)]"}`}>{i + 1}</span>
                  )}
                </div>
                {/* Task row */}
                <Link href={`/jobs/${job.id}`}
                  className="flex-1 flex items-center justify-between rounded-[14px] border border-[var(--t-border)] px-3.5 py-2.5 hover:bg-[var(--t-bg-card-hover)] transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`text-xs font-semibold ${typeColor}`}>{TASK_TYPE_LABELS[job.taskType] || job.taskType}</span>
                    <span className="text-xs font-medium text-[var(--t-text-primary)]">{job.jobNumber || "—"}</span>
                    <span className="text-xs text-[var(--t-text-muted)]">{fmtDate(job.scheduledDate)}</span>
                    {job.driver && <span className="text-xs text-[var(--t-text-muted)]">· {job.driver.name}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {job.taskType === "exchange" && isActive && job.linkId && status !== "completed" && status !== "cancelled" && job.linkStatus === "scheduled" && (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditExchange({
                            linkId: job.linkId!,
                            currentDate: job.scheduledDate || "",
                          });
                        }}
                        title={FEATURE_REGISTRY.edit_exchange_date?.label ?? "Edit Exchange Date"}
                        className="text-[var(--t-accent)] hover:opacity-70 transition-opacity"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                    <span className="text-[10px] font-semibold" style={{ color: displayStatusColor(ds) }}>
                      {DISPLAY_STATUS_LABELS[ds] || status}
                    </span>
                    <ArrowRight className="h-3 w-3 text-[var(--t-text-muted)]" />
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      </div>

      {/* Financials */}
      {(invoices.length > 0 || financials.totalRevenue > 0 || dumpTickets.length > 0) && (
        <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="h-4 w-4 text-[var(--t-text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--t-text-primary)]">
              {FEATURE_REGISTRY.rental_lifecycle_financials?.label ?? "Financials"}
            </h2>
          </div>

          {/* Summary row */}
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Revenue</p>
              <p className="text-sm font-bold text-[var(--t-text-primary)] tabular-nums">{formatCurrency(financials.totalRevenue)}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Cost</p>
              <p className="text-sm font-bold text-[var(--t-text-primary)] tabular-nums">{formatCurrency(financials.totalCost)}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Profit</p>
              <p className={`text-sm font-bold tabular-nums ${financials.profit >= 0 ? "text-[var(--t-accent)]" : "text-[var(--t-error)]"}`}>{formatCurrency(financials.profit)}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Margin</p>
              <p className="text-sm font-bold text-[var(--t-text-primary)] tabular-nums">{(financials.marginPercent ?? 0).toFixed(1)}%</p>
            </div>
          </div>

          {/* Invoices */}
          {invoices.length > 0 && (
            <div className="border-t border-[var(--t-border)] pt-4 space-y-2">
              {invoices.map(inv => {
                const isPaid = inv.status === "paid";
                const isOverdue = inv.status === "open" && inv.balanceDue > 0;
                return (
                  <Link key={inv.id} href={`/invoices`}
                    className="flex items-center justify-between rounded-[14px] border border-[var(--t-border)] px-3.5 py-2.5 hover:bg-[var(--t-bg-card-hover)] transition-colors">
                    <div className="flex items-center gap-3">
                      <FileText className="h-3.5 w-3.5 text-[var(--t-text-muted)]" />
                      <span className="text-xs font-medium text-[var(--t-text-primary)]">Invoice #{inv.invoiceNumber}</span>
                      <span className="text-xs text-[var(--t-text-muted)] tabular-nums">{formatCurrency(inv.total)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {!isPaid && inv.balanceDue > 0 && (
                        <span className="text-[10px] font-semibold text-amber-500 tabular-nums">Due: {formatCurrency(inv.balanceDue)}</span>
                      )}
                      <span className={`text-[10px] font-semibold ${isPaid ? "text-[var(--t-accent)]" : isOverdue ? "text-[var(--t-error)]" : "text-amber-500"}`}>
                        {isPaid ? "Paid" : inv.status === "draft" ? "Draft" : "Unpaid"}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Payments */}
          {payments.length > 0 && (
            <div className="border-t border-[var(--t-border)] pt-3 mt-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)] mb-2">Payments</p>
              <div className="space-y-1.5">
                {payments.map(p => (
                  <div key={p.id} className="flex items-center justify-between text-xs">
                    <span className="text-[var(--t-text-muted)]">{p.paymentMethod || "—"} · {p.appliedAt ? new Date(p.appliedAt).toLocaleDateString() : "—"}</span>
                    <span className={`font-medium tabular-nums ${p.status === "completed" ? "text-[var(--t-accent)]" : "text-[var(--t-text-muted)]"}`}>{formatCurrency(p.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Phase 11B — Disposal rollup. Totals come directly from
              the dump_tickets already returned by getLifecycle; no
              parallel calculation. */}
          {dumpTickets.length > 0 && (
            <div className="border-t border-[var(--t-border)] pt-3 mt-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">
                  {FEATURE_REGISTRY.dump_slip_section?.label ?? "Disposal Details"}
                </p>
                <p className="text-[11px] font-semibold text-[var(--t-text-primary)] tabular-nums">
                  {FEATURE_REGISTRY.disposal_cost_total?.label ?? "Total Disposal Cost"}: {formatCurrency(totalDisposalCost)}
                </p>
              </div>
              <div className="space-y-1.5">
                {dumpTickets.map((t) => (
                  <div key={t.id} className="flex items-center justify-between text-xs">
                    <span className="text-[var(--t-text-muted)]">
                      Ticket #{t.ticketNumber || "—"}
                      {t.wasteType ? ` · ${t.wasteType.replace(/_/g, " ")}` : ""}
                      {Number.isFinite(Number(t.weightTons)) ? ` · ${Number(t.weightTons).toFixed(2)}t` : ""}
                    </span>
                    <span className="font-medium text-[var(--t-text-primary)] tabular-nums">{formatCurrency(Number(t.totalCost) || 0)}</span>
                  </div>
                ))}
                {totalDisposalCustomerCharges > 0 && (
                  <div className="flex items-center justify-between text-[11px] text-[var(--t-text-muted)] pt-1 mt-1 border-t border-dashed border-[var(--t-border)]">
                    <span>Customer charges pass-through</span>
                    <span className="tabular-nums">{formatCurrency(totalDisposalCustomerCharges)}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {/* Edit Delivery Date Modal */}
      {deliveryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => setDeliveryModalOpen(false)}>
          <div className="rounded-2xl border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-1">
              {FEATURE_REGISTRY.edit_delivery_date?.label ?? "Edit Delivery Date"}
            </h3>
            <p className="text-xs text-[var(--t-text-muted)] mb-4">
              {FEATURE_REGISTRY.edit_delivery_date_description?.label ?? "Reschedule the delivery. Downstream tasks shift by the same number of days unless you opt out."}
            </p>
            <label className="text-xs text-[var(--t-text-muted)] mb-1 block">
              {FEATURE_REGISTRY.edit_delivery_date?.label ?? "Edit Delivery Date"}
            </label>
            <LifecycleDateInput
              value={deliveryDate}
              onChange={(v) => { setDeliveryDate(v); setDeliveryError(""); }}
              className="w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] mb-1"
            />
            {(() => {
              // Preview: what the terminal pickup date becomes after
              // the edit. Shift-downstream preserves the existing
              // pickup offset; shift-off leaves the pickup alone.
              if (!deliveryDate || deliveryDate === rentalChain.dropOffDate) return null;
              const currentPickup = rentalChain.expectedPickupDate;
              if (!currentPickup || !rentalChain.dropOffDate) return null;
              const offset = deliveryShift
                ? Math.round(
                    (new Date(deliveryDate + "T00:00:00Z").getTime() -
                      new Date(rentalChain.dropOffDate + "T00:00:00Z").getTime()) /
                      86400000,
                  )
                : 0;
              const shiftedPickup = shiftDays(currentPickup, offset);
              // After the shift, the "auto" base advances too (same
              // offset), so whether it's auto/override is preserved.
              const shiftedBase = autoBaseDate ? shiftDays(autoBaseDate, offset) : null;
              const autoAfter = shiftedBase ? shiftDays(shiftedBase, tenantRentalDays) : null;
              return (
                <PickupPreview
                  autoDate={autoAfter}
                  overrideDate={shiftedPickup === autoAfter ? undefined : shiftedPickup}
                  rentalDays={tenantRentalDays}
                />
              );
            })()}

            <label className="flex items-start gap-2 text-xs text-[var(--t-text-primary)] mb-1 cursor-pointer mt-1">
              <input type="checkbox" checked={deliveryShift}
                onChange={e => setDeliveryShift(e.target.checked)}
                className="mt-0.5" />
              <span>{FEATURE_REGISTRY.downstream_dates_shifted?.label ?? "Shift downstream exchange and pickup dates by the same number of days"}</span>
            </label>
            <p className="text-[10px] text-[var(--t-text-muted)] mb-3 ml-5">
              {deliveryShift
                ? (FEATURE_REGISTRY.downstream_dates_shifted_on_hint?.label ?? "Keeps the rental duration intact.")
                : (FEATURE_REGISTRY.downstream_dates_shifted_off_hint?.label ?? "Downstream dates stay put — the request fails if any would become invalid.")}
            </p>

            {deliveryError && (
              <p className="text-xs text-[var(--t-error)] mb-3">{deliveryError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeliveryModalOpen(false)} className="rounded-full px-4 py-2 text-xs font-medium text-[var(--t-text-muted)]">
                Cancel
              </button>
              <button onClick={handleDeliveryUpdate} disabled={!deliveryDate || deliverySaving}
                className="rounded-full bg-[var(--t-accent)] px-4 py-2 text-xs font-semibold text-[var(--t-accent-on-accent)] disabled:opacity-40 hover:opacity-90 transition-opacity">
                {deliverySaving ? (FEATURE_REGISTRY.lifecycle_action_saving?.label ?? "Saving...") : (FEATURE_REGISTRY.lifecycle_action_confirm?.label ?? "Confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase 4b-extract — shared Schedule Exchange modal.
          Handles both create and edit flows via discriminated-union
          props. broadcastLifecycleChange fires inside the component
          on success; this page only supplies `reload` via onSuccess. */}
      {editExchange && (
        <ScheduleExchangeModal
          mode="edit"
          chainId={id}
          deliveryDate={rentalChain.dropOffDate}
          tenantRentalDays={tenantRentalDays}
          linkId={editExchange.linkId}
          currentExchangeDate={editExchange.currentDate}
          onClose={() => setEditExchange(null)}
          onSuccess={() => {
            void reload();
          }}
        />
      )}
      {createExchangeOpen && (
        <ScheduleExchangeModal
          mode="create"
          chainId={id}
          deliveryDate={rentalChain.dropOffDate}
          tenantRentalDays={tenantRentalDays}
          currentDumpsterSize={rentalChain.dumpsterSize || ""}
          onClose={() => setCreateExchangeOpen(false)}
          onSuccess={() => {
            void reload();
          }}
        />
      )}

    </div>
  );
}
