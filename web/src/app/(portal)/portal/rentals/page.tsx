"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { portalApi, resolvePortalErrorMessage } from "@/lib/portal-api";
import { formatCurrency } from "@/lib/utils";
import { formatDateOnly } from "@/lib/utils/format-date";
import { deriveCustomerTimeline, formatRentalTitle, rentalSizeLabel, type CustomerTimelineStep } from "@/lib/job-status";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import { Package, Calendar, MapPin, ChevronRight, CalendarClock } from "lucide-react";
import dynamic from "next/dynamic";

const PortalPlacementMap = dynamic(() => import("@/components/portal-placement-map"), { ssr: false });

interface Rental {
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

const tabs = ["Active", "Upcoming", "Completed", "All"] as const;

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

function isWithin24Hours(dateStr: string | null): boolean {
  if (!dateStr) return false;
  // Phase B6 — parse as local noon of the target calendar day
  // rather than UTC midnight. The previous `new Date(dateStr)`
  // form anchored the gate on UTC midnight (i.e. 8 PM ET the day
  // before the delivery), so customers saw the reschedule action
  // disable up to four hours earlier than it should have. Local
  // noon keeps the gate semantically "24 hours from the start of
  // the delivery day" in the customer's own timezone without
  // introducing a hardcoded timezone assumption.
  const target = new Date(`${dateStr}T12:00:00`).getTime();
  if (Number.isNaN(target)) return false;
  const now = Date.now();
  return target - now < 24 * 60 * 60 * 1000;
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

export default function PortalRentalsPageWrapper() {
  return (
    <Suspense fallback={<div className="py-10 text-center text-sm" style={{ color: "var(--t-text-muted)" }}>Loading rentals...</div>}>
      <PortalRentalsPage />
    </Suspense>
  );
}

function PortalRentalsPage() {
  const searchParams = useSearchParams();
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<typeof tabs[number]>("Active");
  const [detail, setDetail] = useState<Rental | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [rescheduling, setRescheduling] = useState(false);
  const rescheduleDateRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    portalApi.get<Rental[]>("/portal/rentals").then(setRentals).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Deep-link: if ?id= is present, auto-select that rental once loaded
  useEffect(() => {
    const deepLinkId = searchParams.get("id");
    if (!deepLinkId || loading || rentals.length === 0) return;
    const match = rentals.find(r => r.id === deepLinkId);
    if (match) setDetail(match);
  }, [searchParams, loading, rentals]);

  const filtered = rentals.filter(r => {
    if (tab === "All") return true;
    if (tab === "Active") return !["completed", "cancelled", "pending"].includes(r.status) && r.job_type === "delivery";
    if (tab === "Upcoming") return r.status === "pending" && r.job_type === "delivery";
    if (tab === "Completed") return r.status === "completed" || r.status === "cancelled";
    return true;
  });

  const inputCls = "w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)]";

  if (detail) {
    const timelineSteps = deriveCustomerTimeline(detail, rentals);
    const canChangeDate = ["pending", "confirmed"].includes(detail.status);
    const tooSoon = isWithin24Hours(detail.scheduled_date);

    return (
      <div className="space-y-4">
        <button onClick={() => setDetail(null)} className="text-sm text-[var(--t-accent)] font-medium hover:underline">&larr; Back to rentals</button>

        {/* ─── Top identity card — Phase B8: wider, denser, action-forward ─── */}
        <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5 sm:p-6">
          {/* Title row */}
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-[var(--t-text-primary)] leading-tight">
                {formatRentalTitle(detail)}
              </h1>
              <p className="text-xs text-[var(--t-text-muted)] mt-0.5">
                {detail.job_number}
              </p>
            </div>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full bg-[var(--t-bg-primary)] border border-[var(--t-border)] ${STATUS_COLORS[detail.status] || ""}`}>
              {STATUS_LABELS[detail.status] || detail.status}
            </span>
          </div>

          {/* Compact summary grid — horizontal-first, 2 → 3 → 4 cols on wider screens */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-3 text-sm">
            <div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">{FEATURE_REGISTRY.portal_detail_dumpster_size?.label ?? "Dumpster Size"}</span>
              <p className="font-semibold text-[var(--t-text-primary)] mt-0.5">{rentalSizeLabel(detail) || "—"}</p>
            </div>
            <div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">{FEATURE_REGISTRY.portal_detail_delivery_date?.label ?? "Delivery Date"}</span>
              <p className="font-semibold text-[var(--t-text-primary)] mt-0.5">{detail.scheduled_date ? formatDateOnly(detail.scheduled_date) : "—"}</p>
            </div>
            <div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">{FEATURE_REGISTRY.portal_detail_pickup_date?.label ?? "Pickup Date"}</span>
              <p className="font-semibold text-[var(--t-text-primary)] mt-0.5">{detail.rental_end_date ? formatDateOnly(detail.rental_end_date) : "—"}</p>
            </div>
            <div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">{FEATURE_REGISTRY.portal_detail_duration?.label ?? "Rental Duration"}</span>
              <p className="font-semibold text-[var(--t-text-primary)] mt-0.5">{detail.rental_days ? `${detail.rental_days} days` : "—"}</p>
            </div>
            <div>
              <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">{FEATURE_REGISTRY.portal_detail_total_cost?.label ?? "Total Cost"}</span>
              <p className="font-semibold text-[var(--t-text-primary)] mt-0.5">{formatCurrency(detail.total_price)}</p>
            </div>
            <div className="col-span-2 sm:col-span-3 lg:col-span-3">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">{FEATURE_REGISTRY.portal_detail_service_address?.label ?? "Service Address"}</span>
              <p className="font-semibold text-[var(--t-text-primary)] mt-0.5 flex items-start gap-1.5">
                <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-[var(--t-text-muted)]" />
                <span className="truncate">{detail.service_address?.formatted || detail.service_address?.street || "—"}</span>
              </p>
            </div>
          </div>

          {/* Change Date / Reschedule — Phase B8: surfaced immediately under the
              summary so the primary rental action is above the fold. */}
          {canChangeDate && (
            <div className="mt-5 pt-4 border-t border-[var(--t-border)]">
              {!rescheduleOpen ? (
                <div className="flex flex-wrap items-center gap-2">
                  {tooSoon ? (
                    <div className="flex items-center gap-2">
                      <button disabled
                        className="rounded-full border border-[var(--t-border)] px-4 py-2 text-sm font-medium text-[var(--t-text-muted)] opacity-50 cursor-not-allowed flex items-center gap-1.5">
                        <CalendarClock className="h-4 w-4" /> Change Date
                      </button>
                      <span className="text-xs text-amber-500">Cannot change within 24 hours of scheduled date</span>
                    </div>
                  ) : (
                    <button onClick={() => { setRescheduleOpen(true); setNewDate(detail.scheduled_date || ""); }}
                      className="rounded-full bg-[var(--t-accent)] px-4 py-2 text-sm font-semibold text-[var(--t-accent-on-accent)] hover:opacity-90 transition-opacity flex items-center gap-1.5">
                      <CalendarClock className="h-4 w-4" /> Change Date
                    </button>
                  )}
                </div>
              ) : (
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
                  {detail.rental_days && newDate && (
                    <p className="text-xs text-[var(--t-text-muted)]">
                      {/* Phase B6 — compute the predicted pickup date via
                          pure YYYY-MM-DD arithmetic so the preview label
                          renders in the correct local calendar day. */}
                      New pickup by: {(() => {
                        const start = new Date(`${newDate}T12:00:00`);
                        if (Number.isNaN(start.getTime())) return "—";
                        const end = new Date(start.getTime() + detail.rental_days * 86400000);
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
                  <div className="flex gap-2">
                    <button onClick={async () => {
                      setRescheduling(true);
                      try {
                        const result = await portalApi.patch<Partial<Rental>>(`/portal/rentals/${detail.id}/reschedule`, { scheduledDate: newDate, reason: rescheduleReason, source: "customer_portal" });
                        const updated = { ...detail, ...result, scheduled_date: newDate };
                        setDetail(updated);
                        setRentals(prev => prev.map(r => r.id === updated.id ? updated : r));
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
              )}
            </div>
          )}
        </div>

        {/* ─── Progress timeline — below the top card ─── */}
        <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5 sm:p-6">
          <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-2">Progress</h3>
          <HorizontalTimeline steps={timelineSteps} />
        </div>

        {/* ─── Drop location / Map — Phase B8: moved to the bottom of the page ─── */}
        {!["completed", "cancelled"].includes(detail.status) && (
          <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5 sm:p-6">
            <PortalPlacementMap jobId={detail.id} serviceAddress={detail.service_address} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)]">My Rentals</h1>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-[var(--t-border)]">
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`relative flex-1 px-3 py-2.5 text-sm font-medium transition-colors text-center ${tab === t ? "text-[var(--t-accent)]" : "text-[var(--t-frame-text-muted)] hover:text-[var(--t-frame-text)]"}`}>
            {t}
            {tab === t && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--t-accent)] rounded-full" />}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-28 rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-[var(--t-border)] bg-[var(--t-bg-card)] p-8 text-center">
          <Package className="mx-auto h-10 w-10 text-[var(--t-text-muted)]/30 mb-3" />
          <p className="text-sm font-medium text-[var(--t-text-muted)]">No {tab.toLowerCase()} rentals</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => {
            const steps = r.job_type === "delivery" ? deriveCustomerTimeline(r, rentals) : [];
            return (
              <button key={r.id} onClick={() => setDetail(r)}
                className="w-full text-left rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4 hover:bg-[var(--t-bg-card-hover)] transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-semibold text-[var(--t-text-primary)]">{formatRentalTitle(r)}</p>
                      <span className={`text-xs font-medium ${STATUS_COLORS[r.status] || ""}`}>{STATUS_LABELS[r.status] || r.status}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--t-text-muted)]">
                      <span>{r.job_number}</span>
                      {r.service_address && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{r.service_address.formatted || r.service_address.street}</span>}
                      {r.rental_start_date && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{formatDateOnly(r.rental_start_date)}</span>}
                      {r.total_price && <span className="font-medium text-[var(--t-text-primary)]">{formatCurrency(r.total_price)}</span>}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-[var(--t-text-muted)] shrink-0 ml-2" />
                </div>
                {steps.length > 0 && (
                  <div className="mt-2 border-t border-[var(--t-border)]/50 pt-1" onClick={e => e.stopPropagation()}>
                    <HorizontalTimeline steps={steps} />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
