"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { portalApi } from "@/lib/portal-api";
import { formatCurrency } from "@/lib/utils";
import { Package, FileText, PlusCircle, Phone, Calendar, MapPin, Clock, ArrowUpRight } from "lucide-react";

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
  service_address: { formatted?: string; street?: string; city?: string } | null;
  asset: { identifier?: string; size?: string } | null;
}

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
  const [loading, setLoading] = useState(true);
  const customer = portalApi.getCustomer();

  useEffect(() => {
    portalApi.get<Rental[]>("/portal/rentals")
      .then(setRentals)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const active = rentals.filter(r => !["completed", "cancelled"].includes(r.status) && r.job_type === "delivery");
  const upcoming = rentals.filter(r => r.status === "pending" && r.job_type === "delivery");

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-text-primary)]">
          Welcome back, {customer?.firstName || "there"}
        </h1>
        <p className="mt-1 text-sm text-[var(--t-text-muted)]">Here&apos;s an overview of your rentals and account.</p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Link href="/portal/request" className="flex items-center gap-3 rounded-[18px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4 hover:bg-[var(--t-bg-card-hover)] transition-colors">
          <div className="flex h-10 w-10 items-center justify-center rounded-[18px] bg-[var(--t-accent-soft)]">
            <PlusCircle className="h-5 w-5 text-[var(--t-accent)]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--t-text-primary)]">Request a Dumpster</p>
            <p className="text-xs text-[var(--t-text-muted)]">Get a quote instantly</p>
          </div>
        </Link>
        <Link href="/portal/invoices" className="flex items-center gap-3 rounded-[18px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4 hover:bg-[var(--t-bg-card-hover)] transition-colors">
          <div className="flex h-10 w-10 items-center justify-center rounded-[18px] bg-blue-500/10">
            <FileText className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--t-text-primary)]">Pay Invoice</p>
            <p className="text-xs text-[var(--t-text-muted)]">View & pay open invoices</p>
          </div>
        </Link>
        <a href="tel:+1234567890" className="flex items-center gap-3 rounded-[18px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4 hover:bg-[var(--t-bg-card-hover)] transition-colors">
          <div className="flex h-10 w-10 items-center justify-center rounded-[18px] bg-[var(--t-warning-soft)]">
            <Phone className="h-5 w-5 text-amber-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--t-text-primary)]">Contact Us</p>
            <p className="text-xs text-[var(--t-text-muted)]">Call the office</p>
          </div>
        </a>
      </div>

      {/* Active Rentals */}
      <section>
        <h2 className="text-lg font-bold text-[var(--t-text-primary)] mb-4">Active Rentals</h2>
        {loading ? (
          <div className="space-y-3">
            {[1, 2].map(i => <div key={i} className="h-40 rounded-[18px] bg-[var(--t-bg-card)] border border-[var(--t-border)] animate-pulse" />)}
          </div>
        ) : active.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-[var(--t-border)] bg-[var(--t-bg-card)] p-8 text-center">
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
                <div key={r.id} className={`rounded-[18px] border bg-[var(--t-bg-card)] p-5 ${overdue ? "border-[var(--t-error)]/30" : "border-[var(--t-border)]"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-[var(--t-text-primary)]">{r.asset?.size || r.service_type || "Dumpster"} — {r.job_type === "delivery" ? "Rental" : "Pickup"}</p>
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
                    <button className="rounded-full border border-[var(--t-border)] px-3 py-1.5 text-xs font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
                      Extend Rental
                    </button>
                    <button className="rounded-full border border-[var(--t-error)]/20 px-3 py-1.5 text-xs font-medium text-[var(--t-error)] hover:bg-[var(--t-error-soft)] transition-colors">
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
              <div key={r.id} className="rounded-[18px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--t-text-primary)]">{r.asset?.size || "Dumpster"} Delivery</p>
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
    </div>
  );
}
