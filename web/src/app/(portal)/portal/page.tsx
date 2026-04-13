"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { portalApi } from "@/lib/portal-api";
import { formatCurrency } from "@/lib/utils";
import { formatDateOnly, daysUntilDateOnly } from "@/lib/utils/format-date";
import { formatRentalTitle, rentalSizeLabel } from "@/lib/job-status";
import { Package, FileText, PlusCircle, Calendar, MapPin, Clock, ArrowUpRight, AlertCircle, CreditCard, ChevronRight, DollarSign } from "lucide-react";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import PortalChangePickupDateModal from "@/components/portal-change-pickup-date-modal";

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
  service_address: { formatted?: string; street?: string; city?: string } | null;
  asset: { identifier?: string; size?: string; subtype?: string } | null;
}

interface Invoice {
  id: string;
  invoice_number: number;
  status: string;
  due_date: string;
  total: number;
  balance_due: number;
}

const ISSUE_REASONS = [
  "Blocked Access",
  "Not Ready for Pickup",
  "Overfilled",
  "Wrong Size",
  "Damaged",
  "Other",
] as const;

const MAX_DASHBOARD_RENTALS = 3;

/* Customer-safe status mapping — never expose raw internal states */
function customerStatus(internalStatus: string): { label: string; color: string } {
  switch (internalStatus) {
    case "pending":
    case "confirmed":
    case "dispatched":
      return { label: FEATURE_REGISTRY.portal_status_scheduled?.label ?? "Scheduled", color: "var(--t-accent)" };
    case "en_route":
      return { label: FEATURE_REGISTRY.portal_status_on_the_way?.label ?? "On the Way", color: "#8B5CF6" };
    case "arrived":
    case "in_progress":
      return { label: FEATURE_REGISTRY.portal_status_in_progress?.label ?? "In Progress", color: "var(--t-accent)" };
    case "completed":
      return { label: FEATURE_REGISTRY.portal_status_completed?.label ?? "Completed", color: "var(--t-text-muted)" };
    case "cancelled":
      return { label: FEATURE_REGISTRY.portal_status_cancelled?.label ?? "Cancelled", color: "var(--t-error)" };
    default:
      return { label: FEATURE_REGISTRY.portal_status_scheduled?.label ?? "Scheduled", color: "var(--t-text-muted)" };
  }
}

// Phase B6 — `daysRemaining` used to live here and parsed the
// YYYY-MM-DD end date via `new Date(endDate)`, which in any US
// timezone yielded UTC midnight (previous local day) and produced
// off-by-one day counts. Replaced with `daysUntilDateOnly` from
// `@/lib/utils/format-date`, which parses as local noon and uses
// noon-to-noon arithmetic so daylight-saving transitions round
// cleanly.

export default function PortalHomePage() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [changePickupJobId, setChangePickupJobId] = useState<string | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueReason, setIssueReason] = useState("");
  const [issueNotes, setIssueNotes] = useState("");
  const [issueJobId, setIssueJobId] = useState("");
  const [issueSubmitting, setIssueSubmitting] = useState(false);
  const [issueSuccess, setIssueSuccess] = useState(false);
  const [accountSummary, setAccountSummary] = useState<{
    current_balance: number; past_due_amount: number; unpaid_invoice_count: number;
    account_status: string; status_message: string | null; payment_eligible: boolean;
  } | null>(null);
  const customer = portalApi.getCustomer();

  useEffect(() => {
    Promise.all([
      portalApi.get<Rental[]>("/portal/rentals").catch(() => [] as Rental[]),
      portalApi.get<Invoice[]>("/portal/invoices").catch(() => [] as Invoice[]),
      portalApi.get<typeof accountSummary>("/portal/account-summary").catch(() => null),
    ]).then(([r, i, s]) => {
      setRentals(r);
      setInvoices(i);
      if (s) setAccountSummary(s);
    }).finally(() => setLoading(false));
  }, []);

  const handleIssueSubmit = async () => {
    if (!issueReason) return;
    setIssueSubmitting(true);
    try {
      await portalApi.post("/portal/report-issue", {
        reason: issueReason,
        notes: issueNotes || undefined,
        jobId: issueJobId || undefined,
      });
      setIssueSuccess(true);
      setIssueReason("");
      setIssueNotes("");
      setIssueJobId("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to submit. Please try again.";
      alert(message);
    } finally {
      setIssueSubmitting(false);
    }
  };

  const refreshRentals = () => portalApi.get<Rental[]>("/portal/rentals").then(setRentals).catch(() => {});

  const active = rentals.filter(r => !["completed", "cancelled"].includes(r.status) && r.job_type === "delivery");
  // Phase B7 — Upcoming must only show *future* rentals. Parse YYYY-MM-DD
  // as local noon to avoid the UTC-midnight off-by-one (same pattern used
  // by daysUntilDateOnly). A rental is "upcoming" if either its delivery
  // or pickup date is still in the future relative to today's local date.
  const todayNoon = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();
  const isFutureDay = (iso?: string | null) => {
    if (!iso) return false;
    const t = new Date(`${iso}T12:00:00`).getTime();
    return !Number.isNaN(t) && t > todayNoon;
  };
  const upcoming = rentals.filter(r =>
    r.status === "pending" &&
    r.job_type === "delivery" &&
    (isFutureDay(r.scheduled_date) || isFutureDay(r.rental_end_date))
  );
  const history = rentals.filter(r => r.status === "completed" && r.job_type === "delivery").slice(0, 5);

  // The rental being modified in the Change Pickup Date modal
  const changePickupRental = changePickupJobId ? active.find(r => r.id === changePickupJobId) : null;

  return (
    <div className="space-y-6">
      {/* Welcome + Quick Actions */}
      <div>
        <h1 className="text-2xl sm:text-[28px] font-bold tracking-[-1px] leading-tight break-words [overflow-wrap:anywhere]" style={{ color: "var(--t-frame-text)" }}>
          Welcome back, {customer?.firstName || "there"}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--t-frame-text-muted)" }}>Here&apos;s an overview of your rentals and account.</p>

        {/* Quick Actions — Phase B11: natural wrap with compact pills so the
            row feels intentional, not balloon-stretched on mobile. */}
        <div className="flex flex-wrap gap-2 mt-4">
          <Link href="/portal/request"
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-xs sm:text-sm font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
            <PlusCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-[var(--t-accent)] shrink-0" />
            Request
          </Link>
          <button onClick={() => { setIssueOpen(true); setIssueSuccess(false); }}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-xs sm:text-sm font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
            <AlertCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-[var(--t-error)] shrink-0" />
            Report an Issue
          </button>
          <Link href="/portal/invoices"
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-xs sm:text-sm font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
            <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-blue-400 shrink-0" />
            Invoices
          </Link>
        </div>
      </div>

      {/* Account Summary — Phase B10: balance + pill stack cleanly on mobile */}
      {accountSummary && (
        <Link href="/portal/invoices" className="block rounded-[16px] border p-4 min-w-0 transition-colors hover:border-[var(--t-accent)]" style={{
          borderColor: "var(--t-border)",
          background: "var(--t-bg-card)",
        }}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--t-accent-soft)]">
                <DollarSign className="h-4 w-4 text-[var(--t-accent)]" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wider truncate" style={{ color: "var(--t-text-muted)" }}>
                  {FEATURE_REGISTRY.portal_account_summary_title?.label ?? "Account Summary"}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-lg font-bold tabular-nums" style={{ color: "var(--t-text-primary)" }}>
                    {formatCurrency(accountSummary.current_balance)}
                  </p>
                  {accountSummary.account_status !== "good_standing" && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{
                      background: accountSummary.account_status === "service_restricted" ? "var(--t-error-soft)" : accountSummary.account_status === "past_due" ? "var(--t-warning-soft, #FFF8E1)" : "var(--t-accent-soft)",
                      color: accountSummary.account_status === "service_restricted" ? "var(--t-error)" : accountSummary.account_status === "past_due" ? "var(--t-warning, #F59E0B)" : "var(--t-accent)",
                    }}>
                      {FEATURE_REGISTRY[`portal_account_status_${accountSummary.account_status}`]?.label ?? accountSummary.account_status.replace(/_/g, " ")}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {accountSummary.payment_eligible && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--t-accent)] px-3 sm:px-4 py-2 text-xs font-semibold text-[var(--t-accent-on-accent)] hover:opacity-90 transition-opacity">
                  <CreditCard className="h-3.5 w-3.5" />
                  {FEATURE_REGISTRY.portal_pay_now?.label ?? "Pay Now"}
                </span>
              )}
              <ChevronRight className="h-4 w-4 text-[var(--t-text-muted)]" />
            </div>
          </div>
        </Link>
      )}

      {/* My Rentals — compact summary module */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-[var(--t-text-primary)]">{FEATURE_REGISTRY.portal_section_my_rentals?.label ?? "My Rentals"}</h2>
          {active.length > MAX_DASHBOARD_RENTALS && (
            <Link href="/portal/rentals" className="text-xs font-medium text-[var(--t-accent)] hover:underline flex items-center gap-1">
              View all ({active.length}) <ArrowUpRight className="h-3 w-3" />
            </Link>
          )}
        </div>
        {loading ? (
          <div className="space-y-3">
            {[1, 2].map(i => <div key={i} className="h-24 rounded-[16px] bg-[var(--t-bg-card)] border border-[var(--t-border)] animate-pulse" />)}
          </div>
        ) : active.length === 0 ? (
          <div className="rounded-[16px] border border-dashed border-[var(--t-border)] bg-[var(--t-bg-card)] p-6 text-center">
            <Package className="mx-auto h-8 w-8 text-[var(--t-text-muted)]/30 mb-2" />
            <p className="text-sm font-medium text-[var(--t-text-muted)]">{FEATURE_REGISTRY.portal_empty_active?.label ?? "No active rentals"}</p>
            <Link href="/portal/request" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[var(--t-accent)] hover:underline">
              Request a dumpster <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        ) : (
          <div className="grid gap-3">
            {active.slice(0, MAX_DASHBOARD_RENTALS).map(r => {
              const days = daysUntilDateOnly(r.rental_end_date);
              const overdue = days !== null && days < 0;
              return (
                <div key={r.id} className={`rounded-[16px] border bg-[var(--t-bg-card)] p-3.5 sm:p-4 min-w-0 ${overdue ? "border-[var(--t-error)]/30" : "border-[var(--t-border)]"}`}>
                  {/* Phase B11 — tighter padding + auto-width actions so the
                      card reads as contained instead of edge-to-edge. */}

                  {/* Title row */}
                  <p className="text-sm sm:text-base font-bold text-[var(--t-text-primary)] truncate mb-1.5">
                    {formatRentalTitle(r)}
                  </p>

                  {/* Status + countdown pills */}
                  <div className="flex flex-wrap items-center gap-1.5 mb-2">
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--t-bg-primary)] border border-[var(--t-border)]"
                      style={{ color: customerStatus(r.status).color }}
                    >
                      {customerStatus(r.status).label}
                    </span>
                    {days !== null && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        overdue
                          ? "bg-[var(--t-error-soft)] text-[var(--t-error)]"
                          : days <= 2
                            ? "bg-amber-500/10 text-amber-500"
                            : "bg-[var(--t-accent-soft)] text-[var(--t-accent)]"
                      }`}>
                        {overdue ? `${Math.abs(days)}d overdue` : `${days}d left`}
                      </span>
                    )}
                  </div>

                  {/* Address — Phase B12: span needs its own min-w-0 so the
                      intrinsic nowrap width of `truncate` can't push the
                      parent flex container past the card edge. */}
                  {r.service_address && (
                    <div className="flex items-start gap-1.5 text-xs text-[var(--t-text-muted)] mb-1 min-w-0 w-full">
                      <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span className="truncate min-w-0 flex-1">{r.service_address.formatted || r.service_address.street || "—"}</span>
                    </div>
                  )}

                  {/* Delivery / Pickup dates */}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] sm:text-xs text-[var(--t-text-muted)]">
                    {r.scheduled_date && (
                      <span className="flex items-center gap-1 shrink-0">
                        <Calendar className="h-3 w-3" />
                        {FEATURE_REGISTRY.portal_dashboard_delivery_label?.label ?? "Delivery"}: {formatDateOnly(r.scheduled_date)}
                      </span>
                    )}
                    {r.rental_end_date && (
                      <span className="flex items-center gap-1 shrink-0">
                        <Clock className="h-3 w-3" />
                        {FEATURE_REGISTRY.portal_dashboard_pickup_label?.label ?? "Pickup"}: {formatDateOnly(r.rental_end_date)}
                      </span>
                    )}
                  </div>

                  {/* Actions — auto-width inline, right-aligned; wraps to the
                      next line on very narrow screens without stretching. */}
                  <div className="mt-3 pt-2.5 border-t border-[var(--t-border)] flex flex-wrap items-center justify-end gap-2">
                    <button
                      onClick={() => setChangePickupJobId(r.id)}
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--t-border)] px-3 py-1.5 text-[11px] sm:text-xs font-semibold text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors"
                    >
                      {FEATURE_REGISTRY.portal_action_change_date_short?.label ?? "Change Date"}
                    </button>
                    <Link
                      href={`/portal/rentals/${r.id}`}
                      className="inline-flex items-center gap-1 rounded-full bg-[var(--t-accent)] px-3 py-1.5 text-[11px] sm:text-xs font-semibold text-[var(--t-accent-on-accent)] hover:opacity-90 transition-opacity"
                    >
                      {FEATURE_REGISTRY.portal_action_view_details?.label ?? "View Details"} <ChevronRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              );
            })}
            {active.length > MAX_DASHBOARD_RENTALS && (
              <Link href="/portal/rentals"
                className="block text-center rounded-[16px] border border-dashed border-[var(--t-border)] bg-[var(--t-bg-card)] py-3 text-xs font-medium text-[var(--t-accent)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
                View all {active.length} rentals →
              </Link>
            )}
          </div>
        )}
      </section>

      {/* Upcoming — Phase B12: min-w-0 guards and truncate on the left block */}
      {!loading && upcoming.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-[var(--t-text-primary)] mb-3">{FEATURE_REGISTRY.portal_section_upcoming?.label ?? "Upcoming"}</h2>
          <div className="grid gap-3">
            {upcoming.map(r => (
              <Link key={r.id} href={`/portal/rentals/${r.id}`}
                className="rounded-[16px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4 flex items-center justify-between gap-3 min-w-0 hover:bg-[var(--t-bg-card-hover)] transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--t-text-primary)] truncate">{rentalSizeLabel(r)} Delivery</p>
                  <p className="text-xs text-[var(--t-text-muted)] mt-0.5 truncate">
                    <Calendar className="inline h-3 w-3 mr-1" />
                    {FEATURE_REGISTRY.portal_dashboard_delivery_label?.label ?? "Delivery"}: {r.scheduled_date ? formatDateOnly(r.scheduled_date) : "TBD"}
                  </p>
                </div>
                <span className="text-xs font-medium shrink-0 whitespace-nowrap" style={{ color: customerStatus(r.status).color }}>{customerStatus(r.status).label}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Service History — Phase B12: long addresses must not push the card */}
      {!loading && history.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-[var(--t-text-primary)] mb-3">{FEATURE_REGISTRY.portal_section_history?.label ?? "Service History"}</h2>
          <div className="space-y-2">
            {history.map(r => (
              <div key={r.id} className="rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-3 flex items-center justify-between gap-3 min-w-0" style={{ opacity: 0.7 }}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--t-text-primary)] truncate">{formatRentalTitle(r)}</p>
                  <p className="text-xs text-[var(--t-text-muted)] mt-0.5 truncate">
                    {r.scheduled_date && formatDateOnly(r.scheduled_date)}
                    {r.service_address && ` · ${r.service_address.street || r.service_address.formatted || ""}`}
                  </p>
                </div>
                <span className="text-xs font-medium shrink-0 whitespace-nowrap" style={{ color: customerStatus(r.status).color }}>{customerStatus(r.status).label}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Change Pickup Date Modal — Phase B13: shared component */}
      <PortalChangePickupDateModal
        rental={changePickupRental ?? null}
        onClose={() => setChangePickupJobId(null)}
        onSuccess={async () => { await refreshRentals(); }}
      />

      {/* Report Issue Modal */}
      {issueOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => { setIssueOpen(false); setIssueSuccess(false); }}>
          <div className="rounded-2xl border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            {issueSuccess ? (
              <div className="text-center py-4">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--t-accent-soft)]">
                  <AlertCircle className="h-6 w-6 text-[var(--t-accent)]" />
                </div>
                <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-1">Issue Reported</h3>
                <p className="text-xs text-[var(--t-text-muted)]">Our office has been notified and will follow up shortly.</p>
                <button onClick={() => { setIssueOpen(false); setIssueSuccess(false); }}
                  className="mt-4 rounded-full bg-[var(--t-accent)] px-5 py-2 text-sm font-semibold text-[var(--t-accent-on-accent)] hover:opacity-90 transition-opacity">
                  Done
                </button>
              </div>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-4">Report an Issue</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--t-text-primary)] mb-1">What happened?</label>
                    <select value={issueReason} onChange={e => setIssueReason(e.target.value)}
                      className="w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2.5 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] appearance-none">
                      <option value="">Select a reason...</option>
                      {ISSUE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--t-text-primary)] mb-1">Which rental? (optional)</label>
                    <select value={issueJobId} onChange={e => setIssueJobId(e.target.value)}
                      className="w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2.5 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] appearance-none">
                      <option value="">All rentals</option>
                      {active.map(r => (
                        <option key={r.id} value={r.id}>
                          {rentalSizeLabel(r)} - {r.service_address?.formatted || r.service_address?.street || r.job_number}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--t-text-primary)] mb-1">Additional details (optional)</label>
                    <textarea value={issueNotes} onChange={e => setIssueNotes(e.target.value)}
                      placeholder="Tell us more about the issue..."
                      rows={3}
                      className="w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2.5 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none focus:border-[var(--t-accent)] resize-none" />
                  </div>
                </div>
                <div className="flex gap-2 justify-end mt-4">
                  <button onClick={() => setIssueOpen(false)} className="rounded-full px-4 py-2 text-xs font-medium text-[var(--t-text-muted)]">Cancel</button>
                  <button onClick={handleIssueSubmit} disabled={!issueReason || issueSubmitting}
                    className="rounded-full bg-[var(--t-accent)] px-4 py-2 text-xs font-semibold text-[var(--t-accent-on-accent)] disabled:opacity-40 hover:opacity-90 transition-opacity">
                    {issueSubmitting ? "Submitting..." : "Submit Report"}
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
