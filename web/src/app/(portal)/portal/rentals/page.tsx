"use client";

import { useState, useEffect } from "react";
import { portalApi } from "@/lib/portal-api";
import { formatCurrency } from "@/lib/utils";
import { deriveCustomerTimeline, formatRentalTitle, type CustomerTimelineStep } from "@/lib/job-status";
import { Package, Calendar, MapPin, ChevronRight, CalendarClock } from "lucide-react";

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
  const target = new Date(dateStr).getTime();
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

export default function PortalRentalsPage() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<typeof tabs[number]>("Active");
  const [detail, setDetail] = useState<Rental | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [rescheduling, setRescheduling] = useState(false);

  useEffect(() => {
    portalApi.get<Rental[]>("/portal/rentals").then(setRentals).catch(() => {}).finally(() => setLoading(false));
  }, []);

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
      <div className="space-y-6">
        <button onClick={() => setDetail(null)} className="text-sm text-[var(--t-accent)] font-medium hover:underline">&larr; Back to rentals</button>
        <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
            <div>
              <h2 className="text-lg font-bold text-[var(--t-text-primary)]">{formatRentalTitle(detail)}</h2>
              <p className="text-sm text-[var(--t-text-muted)]">{detail.job_number}</p>
            </div>
            <span className={`text-xs font-medium ${STATUS_COLORS[detail.status] || ""}`}>{STATUS_LABELS[detail.status] || detail.status}</span>
          </div>

          {/* Horizontal Timeline */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-2">Progress</h3>
            <HorizontalTimeline steps={timelineSteps} />
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-[var(--t-text-muted)]">Address</span><p className="font-medium text-[var(--t-text-primary)] mt-0.5">{detail.service_address?.formatted || detail.service_address?.street || "—"}</p></div>
            <div><span className="text-[var(--t-text-muted)]">Duration</span><p className="font-medium text-[var(--t-text-primary)] mt-0.5">{detail.rental_days || "—"} days</p></div>
            <div><span className="text-[var(--t-text-muted)]">Total Cost</span><p className="font-medium text-[var(--t-text-primary)] mt-0.5">{formatCurrency(detail.total_price)}</p></div>
            <div><span className="text-[var(--t-text-muted)]">Asset</span><p className="font-medium text-[var(--t-text-primary)] mt-0.5">{detail.asset?.identifier || "—"}</p></div>
          </div>

          {/* Change Date / Reschedule */}
          {canChangeDate && (
            <div className="mt-6">
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
                      className="rounded-full border border-[var(--t-border)] px-4 py-2 text-sm font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors flex items-center gap-1.5">
                      <CalendarClock className="h-4 w-4" /> Change Date
                    </button>
                  )}
                </div>
              ) : (
                <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-primary)] p-4 space-y-3">
                  <p className="text-sm font-semibold text-[var(--t-text-primary)]">Reschedule Delivery</p>
                  <div>
                    <label className="block text-xs font-medium text-[var(--t-text-primary)] mb-1">New Date</label>
                    <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
                      min={new Date(Date.now() + 86400000).toISOString().split("T")[0]}
                      className={inputCls} />
                  </div>
                  {detail.rental_days && newDate && (
                    <p className="text-xs text-[var(--t-text-muted)]">
                      New pickup by: {new Date(new Date(newDate).getTime() + detail.rental_days * 86400000).toLocaleDateString()}
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
                        const result = await portalApi.patch<any>(`/portal/rentals/${detail.id}/reschedule`, { scheduledDate: newDate, reason: rescheduleReason, source: "customer_portal" });
                        const updated = { ...detail, ...result, scheduled_date: newDate };
                        setDetail(updated);
                        setRentals(prev => prev.map(r => r.id === updated.id ? updated : r));
                        setRescheduleOpen(false);
                        setRescheduleReason("");
                      } catch (err: any) {
                        alert(err.message || "Failed to reschedule");
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
                      {r.rental_start_date && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(r.rental_start_date).toLocaleDateString()}</span>}
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
