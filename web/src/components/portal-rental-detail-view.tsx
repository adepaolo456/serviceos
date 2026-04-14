"use client";

/**
 * Phase B17 — Shared portal rental detail view.
 *
 * Extracted from rentals/page.tsx so the dynamic route
 * /portal/rentals/[id] can render it independently of the list view.
 * This decouples list and detail into two distinct pathnames, which
 * eliminates the Next.js App Router same-pathname navigation bugs
 * that previously left users trapped in detail mode after clearing
 * ?id= via router.replace.
 */

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { portalApi, resolvePortalErrorMessage } from "@/lib/portal-api";
import { formatCurrency } from "@/lib/utils";
import { formatDateOnly } from "@/lib/utils/format-date";
import { deriveCustomerTimeline, formatRentalTitle, rentalSizeLabel, formatJobNumber, type CustomerTimelineStep } from "@/lib/job-status";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import { MapPin, Pencil } from "lucide-react";
import PortalChangePickupDateModal from "@/components/portal-change-pickup-date-modal";

const PortalPlacementMap = dynamic(() => import("@/components/portal-placement-map"), { ssr: false });

export interface PortalRental {
  id: string;
  job_number: string;
  job_type: string;
  service_type: string;
  status: string;
  scheduled_date: string;
  rental_start_date: string;
  rental_end_date: string;
  rental_days: number;
  total_price: number;
  asset_subtype?: string | null;
  service_address: { formatted?: string; street?: string } | null;
  asset: { identifier?: string; subtype?: string } | null;
  completed_at: string | null;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "text-yellow-500",
  confirmed: "text-blue-400",
  dispatched: "text-indigo-400",
  en_route: "text-purple-400",
  in_progress: "text-[var(--t-accent)]",
  completed: "text-[var(--t-text-muted)]",
  cancelled: "text-[var(--t-error)]",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  dispatched: "Dispatched",
  en_route: "En Route",
  in_progress: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};

function isWithin24Hours(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const target = new Date(`${dateStr}T12:00:00`).getTime();
  if (Number.isNaN(target)) return false;
  return target - Date.now() < 24 * 60 * 60 * 1000;
}

function HorizontalTimeline({ steps }: { steps: CustomerTimelineStep[] }) {
  return (
    <div className="w-full overflow-x-auto py-3">
      <div className="flex items-center min-w-[400px]">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div className={`flex h-6 w-6 items-center justify-center rounded-full border-2 shrink-0 ${
                step.state === "done"
                  ? "border-[var(--t-accent)] bg-[var(--t-accent)]"
                  : step.state === "current"
                  ? "border-blue-500 bg-blue-500"
                  : "border-[var(--t-border)] bg-transparent"
              }`}>
                {step.state === "done" && (
                  <svg className="h-3 w-3 text-[var(--t-accent-on-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                )}
                {step.state === "current" && (
                  <div className="h-2 w-2 rounded-full bg-white" />
                )}
              </div>
              <span className={`mt-1.5 text-[10px] font-medium text-center leading-tight max-w-[72px] ${
                step.state === "done"
                  ? "text-[var(--t-accent)]"
                  : step.state === "current"
                  ? "text-blue-400"
                  : "text-[var(--t-text-muted)]"
              }`}>
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 mt-[-18px] ${
                step.state === "done" ? "bg-[var(--t-accent)]" : "bg-[var(--t-border)]"
              }`} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

interface Props {
  rental: PortalRental;
  rentals: PortalRental[];
  onBack: () => void;
  onUpdate: (updated: PortalRental) => void;
}

export default function PortalRentalDetailView({ rental, rentals, onBack, onUpdate }: Props) {
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [rescheduling, setRescheduling] = useState(false);
  const rescheduleDateRef = useRef<HTMLInputElement | null>(null);
  const [pickupModalOpen, setPickupModalOpen] = useState(false);

  const timelineSteps = deriveCustomerTimeline(rental, rentals);
  const canChangeDate = ["pending", "confirmed"].includes(rental.status);
  const tooSoon = isWithin24Hours(rental.scheduled_date);
  const canChangePickup = rental.job_type === "delivery" && !["completed", "cancelled"].includes(rental.status);

  const inputCls = "w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)]";

  // Editable date — Phase B17: solid accent underline at rest (no hover
  // needed), Pencil icon, and subtle background fill so the affordance
  // reads as "tap to edit" immediately on both desktop and mobile.
  const editableDateClass =
    "group mt-0.5 -mx-1 px-1 py-1 w-[calc(100%+0.5rem)] text-left rounded-md cursor-pointer transition-colors bg-[var(--t-accent-soft)] hover:bg-[var(--t-accent-soft)]/80 flex items-center gap-1.5";
  const editableDateTextClass =
    "font-semibold text-[var(--t-accent)] truncate underline decoration-solid underline-offset-4 decoration-[var(--t-accent)]/60 group-hover:decoration-[var(--t-accent)] flex-1 min-w-0";

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-[var(--t-accent)] font-medium hover:underline">
        &larr; {FEATURE_REGISTRY.portal_rentals_back?.label ?? "Back to rentals"}
      </button>

      {/* ─── Top identity card ─── */}
      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4 sm:p-6 min-w-0">
        {/* Title row */}
        <div className="flex flex-wrap items-start justify-between gap-2 sm:gap-3 mb-4 min-w-0">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg sm:text-2xl font-bold text-[var(--t-text-primary)] leading-tight break-words [overflow-wrap:anywhere]">
              {formatRentalTitle(rental)}
            </h1>
            <p className="text-[11px] sm:text-xs text-[var(--t-text-muted)] mt-0.5 font-mono break-all">
              {formatJobNumber(rental.job_number)}
            </p>
          </div>
          <span className={`text-[10px] sm:text-xs font-semibold px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full bg-[var(--t-bg-primary)] border border-[var(--t-border)] whitespace-nowrap shrink-0 ${STATUS_COLORS[rental.status] || ""}`}>
            {STATUS_LABELS[rental.status] || rental.status}
          </span>
        </div>

        {/* Compact summary grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-3 sm:gap-x-4 gap-y-3 text-sm">
          <div className="min-w-0">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">{FEATURE_REGISTRY.portal_detail_dumpster_size?.label ?? "Dumpster Size"}</span>
            <p className="font-semibold text-[var(--t-text-primary)] mt-0.5 truncate">{rentalSizeLabel(rental) || "—"}</p>
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">{FEATURE_REGISTRY.portal_detail_delivery_date?.label ?? "Delivery Date"}</span>
            {canChangeDate && !tooSoon ? (
              <button
                type="button"
                onClick={() => { setRescheduleOpen(true); setNewDate(rental.scheduled_date || ""); }}
                aria-label={FEATURE_REGISTRY.portal_action_change_date_short?.label ?? "Change Date"}
                className={editableDateClass}
              >
                <p className={editableDateTextClass}>
                  {rental.scheduled_date ? formatDateOnly(rental.scheduled_date) : "—"}
                </p>
                <Pencil className="h-3.5 w-3.5 shrink-0 text-[var(--t-accent)]" aria-hidden="true" />
              </button>
            ) : (
              <>
                <p className="font-semibold text-[var(--t-text-primary)] mt-0.5 truncate">{rental.scheduled_date ? formatDateOnly(rental.scheduled_date) : "—"}</p>
                {canChangeDate && tooSoon && (
                  <p className="text-[10px] text-amber-500 mt-0.5 leading-snug">
                    {FEATURE_REGISTRY.portal_detail_delivery_locked_hint?.label ?? "Locked — within 24 hours of delivery"}
                  </p>
                )}
              </>
            )}
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">{FEATURE_REGISTRY.portal_detail_pickup_date?.label ?? "Pickup Date"}</span>
            {canChangePickup ? (
              <button
                type="button"
                onClick={() => setPickupModalOpen(true)}
                aria-label={FEATURE_REGISTRY.portal_action_change_pickup_date?.label ?? "Change Pickup Date"}
                className={editableDateClass}
              >
                <p className={editableDateTextClass}>
                  {rental.rental_end_date ? formatDateOnly(rental.rental_end_date) : "—"}
                </p>
                <Pencil className="h-3.5 w-3.5 shrink-0 text-[var(--t-accent)]" aria-hidden="true" />
              </button>
            ) : (
              <p className="font-semibold text-[var(--t-text-primary)] mt-0.5 truncate">{rental.rental_end_date ? formatDateOnly(rental.rental_end_date) : "—"}</p>
            )}
          </div>
          <div className="min-w-0">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">{FEATURE_REGISTRY.portal_detail_duration?.label ?? "Rental Duration"}</span>
            <p className="font-semibold text-[var(--t-text-primary)] mt-0.5 truncate">{rental.rental_days ? `${rental.rental_days} days` : "—"}</p>
          </div>
          <div className="min-w-0 col-span-2 sm:col-span-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">{FEATURE_REGISTRY.portal_detail_total_cost?.label ?? "Total Cost"}</span>
            <p className="font-semibold text-[var(--t-text-primary)] mt-0.5">{formatCurrency(rental.total_price)}</p>
          </div>
          <div className="col-span-2 sm:col-span-3 lg:col-span-3 min-w-0">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">{FEATURE_REGISTRY.portal_detail_service_address?.label ?? "Service Address"}</span>
            <p className="font-semibold text-[var(--t-text-primary)] mt-0.5 flex items-start gap-1.5 min-w-0">
              <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-[var(--t-text-muted)]" />
              <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{rental.service_address?.formatted || rental.service_address?.street || "—"}</span>
            </p>
          </div>
        </div>

        {/* Reschedule drawer — opens inline when Delivery Date is clicked */}
        {rescheduleOpen && (
          <div className="mt-5 pt-4 border-t border-[var(--t-border)]">
            <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-primary)] p-4 space-y-3">
              <p className="text-sm font-semibold text-[var(--t-text-primary)]">Reschedule Delivery</p>
              <div>
                <label className="block text-xs font-medium text-[var(--t-text-primary)] mb-1">New Date</label>
                <div
                  className="relative cursor-pointer"
                  onClick={() => rescheduleDateRef.current?.showPicker?.()}
                >
                  <input
                    ref={rescheduleDateRef}
                    type="date"
                    value={newDate}
                    onChange={e => setNewDate(e.target.value)}
                    min={new Date(Date.now() + 86400000).toISOString().split("T")[0]}
                    className={`${inputCls} cursor-pointer`}
                  />
                </div>
              </div>
              {rental.rental_days && newDate && (
                <p className="text-xs text-[var(--t-text-muted)]">
                  New pickup by: {(() => {
                    const start = new Date(`${newDate}T12:00:00`);
                    if (Number.isNaN(start.getTime())) return "—";
                    const end = new Date(start.getTime() + rental.rental_days * 86400000);
                    const y = end.getFullYear();
                    const m = String(end.getMonth() + 1).padStart(2, "0");
                    const d = String(end.getDate()).padStart(2, "0");
                    return formatDateOnly(`${y}-${m}-${d}`);
                  })()}
                </p>
              )}
              <div>
                <label className="block text-xs font-medium text-[var(--t-text-primary)] mb-1">Reason (optional)</label>
                <input value={rescheduleReason} onChange={e => setRescheduleReason(e.target.value)}
                  placeholder="Why are you rescheduling?"
                  className={`${inputCls} placeholder-[var(--t-text-muted)]`} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={async () => {
                  setRescheduling(true);
                  try {
                    const result = await portalApi.patch<Partial<PortalRental>>(`/portal/rentals/${rental.id}/reschedule`, { scheduledDate: newDate, reason: rescheduleReason, source: "customer_portal" });
                    const updated = { ...rental, ...result, scheduled_date: newDate };
                    onUpdate(updated);
                    setRescheduleOpen(false);
                    setRescheduleReason("");
                  } catch (err: unknown) {
                    alert(resolvePortalErrorMessage(err));
                  } finally { setRescheduling(false); }
                }} disabled={!newDate || rescheduling}
                  className="rounded-full bg-[var(--t-accent)] px-4 py-2 text-sm font-semibold text-[var(--t-accent-on-accent)] hover:opacity-90 disabled:opacity-50 transition-opacity">
                  {rescheduling ? "Rescheduling..." : "Confirm Reschedule"}
                </button>
                <button onClick={() => setRescheduleOpen(false)} className="rounded-full border border-[var(--t-border)] px-4 py-2 text-sm text-[var(--t-text-muted)] hover:bg-[var(--t-bg-card-hover)] transition-colors">Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Progress timeline */}
      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4 sm:p-6">
        <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-2">Progress</h3>
        <HorizontalTimeline steps={timelineSteps} />
      </div>

      {/* Drop location / map */}
      {!["completed", "cancelled"].includes(rental.status) && (
        <PortalPlacementMap jobId={rental.id} serviceAddress={rental.service_address} />
      )}

      {/* Shared Change Pickup Date modal */}
      <PortalChangePickupDateModal
        rental={pickupModalOpen ? rental : null}
        onClose={() => setPickupModalOpen(false)}
        onSuccess={(updated) => {
          onUpdate({ ...rental, ...updated });
        }}
      />
    </div>
  );
}
