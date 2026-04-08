"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { portalApi } from "@/lib/portal-api";
import { formatCurrency } from "@/lib/utils";
import { formatRentalTitle, rentalSizeLabel } from "@/lib/job-status";
import { Package, FileText, PlusCircle, Phone, Calendar, MapPin, Clock, ArrowUpRight, AlertCircle, CreditCard, CalendarClock, AlertTriangle } from "lucide-react";

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

const STATUS_COLORS: Record<string, string> = {
  pending: "text-yellow-500",
  confirmed: "text-blue-400",
  dispatched: "text-indigo-400",
  en_route: "text-purple-400",
  arrived: "text-cyan-400",
  in_progress: "text-[var(--t-accent)]",
  completed: "text-[var(--t-text-muted)]",
  cancelled: "text-[var(--t-error)]",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  dispatched: "Dispatched",
  en_route: "En Route",
  arrived: "Arrived",
  in_progress: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};

function daysRemaining(endDate: string | null): number | null {
  if (!endDate) return null;
  const now = new Date();
  const end = new Date(endDate);
  return Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export default function PortalHomePage() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [extendJobId, setExtendJobId] = useState<string | null>(null);
  const [extendDate, setExtendDate] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueReason, setIssueReason] = useState("");
  const [issueNotes, setIssueNotes] = useState("");
  const [issueJobId, setIssueJobId] = useState("");
  const [issueSubmitting, setIssueSubmitting] = useState(false);
  const [issueSuccess, setIssueSuccess] = useState(false);
  const customer = portalApi.getCustomer();

  useEffect(() => {
    Promise.all([
      portalApi.get<Rental[]>("/portal/rentals").catch(() => [] as Rental[]),
      portalApi.get<Invoice[]>("/portal/invoices").catch(() => [] as Invoice[]),
    ]).then(([r, i]) => {
      setRentals(r);
      setInvoices(i);
    }).finally(() => setLoading(false));
  }, []);

  const unpaidInvoices = invoices.filter(i => i.status === "open");
  const totalOutstanding = unpaidInvoices.reduce((sum, i) => sum + Number(i.balance_due), 0);

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

  const handleExtend = async () => {
    if (!extendJobId || !extendDate) return;
    setActionLoading(true);
    try {
      await portalApi.post(`/portal/rentals/${extendJobId}/extend`, { newEndDate: extendDate });
      await refreshRentals();
      setExtendJobId(null);
      setExtendDate("");
    } catch (err: any) { alert(err.message || "Failed to extend rental"); }
    finally { setActionLoading(false); }
  };

  const handleEarlyPickup = async (jobId: string) => {
    if (!confirm("Request an early pickup for this rental?")) return;
    setActionLoading(true);
    try {
      await portalApi.post(`/portal/rentals/${jobId}/early-pickup`);
      alert("Early pickup requested! We'll be in touch to schedule.");
      await refreshRentals();
    } catch (err: any) { alert(err.message || "Failed to request pickup"); }
    finally { setActionLoading(false); }
  };

  const active = rentals.filter(r => !["completed", "cancelled"].includes(r.status) && r.job_type === "delivery");
  const upcoming = rentals.filter(r => r.status === "pending" && r.job_type === "delivery");

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-[28px] font-bold tracking-[-1px]" style={{ color: "var(--t-frame-text)" }}>
          Welcome back, {customer?.firstName || "there"}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--t-frame-text-muted)" }}>Here&apos;s an overview of your rentals and account.</p>
      </div>

      {/* Outstanding Balance */}
      {totalOutstanding > 0 && (
        <div className="rounded-[20px] border border-amber-500/30 bg-amber-500/5 p-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-amber-500 mb-1">Outstanding Balance</p>
            <p className="text-2xl font-bold text-[var(--t-text-primary)]">{formatCurrency(totalOutstanding)}</p>
            <p className="text-xs text-[var(--t-text-muted)] mt-0.5">{unpaidInvoices.length} unpaid invoice{unpaidInvoices.length !== 1 ? "s" : ""}</p>
          </div>
          <Link href="/portal/invoices"
            className="flex items-center gap-2 rounded-full bg-[var(--t-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--t-accent-on-accent)] hover:opacity-90 transition-opacity">
            <CreditCard className="h-4 w-4" /> Pay Now <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Link href="/portal/request" className="flex items-center gap-3 rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4 hover:bg-[var(--t-bg-card-hover)] transition-colors">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[20px] bg-[var(--t-accent-soft)]">
            <PlusCircle className="h-5 w-5 text-[var(--t-accent)]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--t-text-primary)]">Request a Dumpster</p>
            <p className="text-xs text-[var(--t-text-muted)]">Get a quote</p>
          </div>
        </Link>
        <Link href="/portal/rentals" className="flex items-center gap-3 rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4 hover:bg-[var(--t-bg-card-hover)] transition-colors">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[20px] bg-purple-500/10">
            <CalendarClock className="h-5 w-5 text-purple-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--t-text-primary)]">Change Pickup Date</p>
            <p className="text-xs text-[var(--t-text-muted)]">Reschedule</p>
          </div>
        </Link>
        <button onClick={() => { setIssueOpen(true); setIssueSuccess(false); }} className="flex items-center gap-3 rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4 hover:bg-[var(--t-bg-card-hover)] transition-colors text-left">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[20px] bg-[var(--t-error-soft)]">
            <AlertCircle className="h-5 w-5 text-[var(--t-error)]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--t-text-primary)]">Report an Issue</p>
            <p className="text-xs text-[var(--t-text-muted)]">Get help</p>
          </div>
        </button>
        <Link href="/portal/invoices" className="flex items-center gap-3 rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4 hover:bg-[var(--t-bg-card-hover)] transition-colors">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[20px] bg-blue-500/10">
            <FileText className="h-5 w-5 text-blue-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--t-text-primary)]">View Invoices</p>
            <p className="text-xs text-[var(--t-text-muted)]">Pay & review</p>
          </div>
        </Link>
      </div>

      {/* Active Rentals */}
      <section>
        <h2 className="text-lg font-bold text-[var(--t-text-primary)] mb-4">Active Rentals</h2>
        {loading ? (
          <div className="space-y-3">
            {[1, 2].map(i => <div key={i} className="h-40 rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] animate-pulse" />)}
          </div>
        ) : active.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-[var(--t-border)] bg-[var(--t-bg-card)] p-8 text-center">
            <Package className="mx-auto h-10 w-10 text-[var(--t-text-muted)]/30 mb-3" />
            <p className="text-sm font-medium text-[var(--t-text-muted)]">No active rentals</p>
            <Link href="/portal/request" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[var(--t-accent)] hover:underline">
              Request a dumpster <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        ) : (
          <div className="grid gap-4">
            {active.map(r => {
              const days = daysRemaining(r.rental_end_date);
              const overdue = days !== null && days < 0;
              return (
                <div key={r.id} className={`rounded-[20px] border bg-[var(--t-bg-card)] p-5 ${overdue ? "border-[var(--t-error)]/30" : "border-[var(--t-border)]"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-[var(--t-text-primary)]">{formatRentalTitle(r)}</p>
                        <span className={`text-xs font-medium ${STATUS_COLORS[r.status] || ""}`}>{STATUS_LABELS[r.status] || r.status}</span>
                      </div>
                      <p className="text-xs text-[var(--t-text-muted)] mt-1">{r.job_number}</p>
                    </div>
                    {days !== null && (
                      <div className={`text-xs font-bold ${overdue ? "text-[var(--t-error)]" : days <= 2 ? "text-amber-500" : "text-[var(--t-accent)]"}`}>
                        {overdue ? `${Math.abs(days)} days overdue` : `${days} days left`}
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-[var(--t-text-muted)]">
                    {r.service_address && (
                      <div className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{r.service_address.formatted || r.service_address.street || "—"}</div>
                    )}
                    {r.rental_start_date && (
                      <div className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />Delivered: {new Date(r.rental_start_date).toLocaleDateString()}</div>
                    )}
                    {r.rental_end_date && (
                      <div className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />Pickup: {new Date(r.rental_end_date).toLocaleDateString()}</div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4">
                    <Link href={`/portal/rentals?id=${r.id}`}
                      className="rounded-full border border-[var(--t-border)] px-3 py-1.5 text-xs font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
                      View Details
                    </Link>
                    <button onClick={() => { setExtendJobId(r.id); setExtendDate(r.rental_end_date || ""); }} disabled={actionLoading}
                      className="rounded-full border border-[var(--t-border)] px-3 py-1.5 text-xs font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors disabled:opacity-50">
                      Extend Rental
                    </button>
                    <button onClick={() => handleEarlyPickup(r.id)} disabled={actionLoading}
                      className="rounded-full border border-[var(--t-error)]/20 px-3 py-1.5 text-xs font-medium text-[var(--t-error)] hover:bg-[var(--t-error-soft)] transition-colors disabled:opacity-50">
                      Request Early Pickup
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-[var(--t-text-primary)] mb-4">Upcoming</h2>
          <div className="grid gap-3">
            {upcoming.map(r => (
              <div key={r.id} className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--t-text-primary)]">{rentalSizeLabel(r)} Delivery</p>
                  <p className="text-xs text-[var(--t-text-muted)] mt-0.5">
                    <Calendar className="inline h-3 w-3 mr-1" />
                    Scheduled: {r.scheduled_date ? new Date(r.scheduled_date).toLocaleDateString() : "TBD"}
                  </p>
                </div>
                <span className={`text-xs font-medium ${STATUS_COLORS[r.status] || ""}`}>{STATUS_LABELS[r.status] || r.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {/* Extend Modal */}
      {extendJobId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setExtendJobId(null)}>
          <div className="rounded-2xl border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6 w-80" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-4">Extend Rental</h3>
            <label className="text-xs text-[var(--t-text-muted)] mb-1 block">New end date</label>
            <input type="date" value={extendDate} onChange={e => setExtendDate(e.target.value)}
              className="w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] mb-4" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setExtendJobId(null)} className="rounded-full px-4 py-2 text-xs font-medium text-[var(--t-text-muted)]">Cancel</button>
              <button onClick={handleExtend} disabled={!extendDate || actionLoading}
                className="rounded-full bg-[var(--t-accent)] px-4 py-2 text-xs font-semibold text-[var(--t-accent-on-accent)] disabled:opacity-40">
                {actionLoading ? "Extending..." : "Confirm Extension"}
              </button>
            </div>
          </div>
        </div>
      )}

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
                      className="w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2.5 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] appearance-none">
                      <option value="">Select a reason...</option>
                      {ISSUE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--t-text-primary)] mb-1">Which rental? (optional)</label>
                    <select value={issueJobId} onChange={e => setIssueJobId(e.target.value)}
                      className="w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2.5 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] appearance-none">
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
                      className="w-full rounded-[16px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2.5 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none focus:border-[var(--t-accent)] resize-none" />
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
