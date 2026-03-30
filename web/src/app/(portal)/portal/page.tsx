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

function statusBadge(status: string) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    pending: { bg: "bg-amber-50 border-amber-200", text: "text-amber-700", label: "Pending" },
    confirmed: { bg: "bg-blue-50 border-blue-200", text: "text-blue-700", label: "Confirmed" },
    dispatched: { bg: "bg-indigo-50 border-indigo-200", text: "text-indigo-700", label: "Dispatched" },
    en_route: { bg: "bg-purple-50 border-purple-200", text: "text-purple-700", label: "En Route" },
    arrived: { bg: "bg-cyan-50 border-cyan-200", text: "text-cyan-700", label: "Arrived" },
    in_progress: { bg: "bg-green-50 border-green-200", text: "text-green-700", label: "Delivered" },
    completed: { bg: "bg-gray-50 border-gray-200", text: "text-gray-600", label: "Completed" },
    cancelled: { bg: "bg-red-50 border-red-200", text: "text-red-600", label: "Cancelled" },
  };
  const s = map[status] || map.pending;
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}>{s.label}</span>;
}

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
        <h1 className="text-2xl font-bold text-[#0F172A]">
          Welcome back, {customer?.firstName || "there"}
        </h1>
        <p className="mt-1 text-sm text-[#64748B]">Here&apos;s an overview of your rentals and account.</p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Link href="/portal/request" className="flex items-center gap-3 rounded-xl border border-[#E2E8F0] bg-white p-4 hover:border-[#2ECC71] hover:shadow-md transition-all">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#2ECC71]/10">
            <PlusCircle className="h-5 w-5 text-[#2ECC71]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#0F172A]">Request a Dumpster</p>
            <p className="text-xs text-[#64748B]">Get a quote instantly</p>
          </div>
        </Link>
        <Link href="/portal/invoices" className="flex items-center gap-3 rounded-xl border border-[#E2E8F0] bg-white p-4 hover:border-[#2ECC71] hover:shadow-md transition-all">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
            <FileText className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#0F172A]">Pay Invoice</p>
            <p className="text-xs text-[#64748B]">View & pay open invoices</p>
          </div>
        </Link>
        <a href="tel:+1234567890" className="flex items-center gap-3 rounded-xl border border-[#E2E8F0] bg-white p-4 hover:border-[#2ECC71] hover:shadow-md transition-all">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50">
            <Phone className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#0F172A]">Contact Us</p>
            <p className="text-xs text-[#64748B]">Call the office</p>
          </div>
        </a>
      </div>

      {/* Active Rentals */}
      <section>
        <h2 className="text-lg font-bold text-[#0F172A] mb-4">Active Rentals</h2>
        {loading ? (
          <div className="space-y-3">
            {[1, 2].map(i => <div key={i} className="h-40 rounded-xl bg-[#E2E8F0] animate-pulse" />)}
          </div>
        ) : active.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#CBD5E1] bg-white p-8 text-center">
            <Package className="mx-auto h-10 w-10 text-[#CBD5E1] mb-3" />
            <p className="text-sm font-medium text-[#64748B]">No active rentals</p>
            <Link href="/portal/request" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[#2ECC71] hover:underline">
              Request a dumpster <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        ) : (
          <div className="grid gap-4">
            {active.map(r => {
              const days = daysRemaining(r.rental_end_date);
              const overdue = days !== null && days < 0;
              return (
                <div key={r.id} className={`rounded-xl border bg-white p-5 ${overdue ? "border-red-200" : "border-[#E2E8F0]"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-[#0F172A]">{r.asset?.size || r.service_type || "Dumpster"} — {r.job_type === "delivery" ? "Rental" : "Pickup"}</p>
                        {statusBadge(r.status)}
                      </div>
                      <p className="text-xs text-[#64748B] mt-1">{r.job_number}</p>
                    </div>
                    {days !== null && (
                      <div className={`rounded-lg px-3 py-1.5 text-xs font-bold ${overdue ? "bg-red-50 text-red-600" : days <= 2 ? "bg-amber-50 text-amber-600" : "bg-green-50 text-green-700"}`}>
                        {overdue ? `${Math.abs(days)} days overdue` : `${days} days left`}
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-[#64748B]">
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
                      className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F1F5F9]">
                      View Details
                    </Link>
                    <button className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-xs font-medium text-[#334155] hover:bg-[#F1F5F9]">
                      Extend Rental
                    </button>
                    <button className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
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
          <h2 className="text-lg font-bold text-[#0F172A] mb-4">Upcoming</h2>
          <div className="grid gap-3">
            {upcoming.map(r => (
              <div key={r.id} className="rounded-xl border border-[#E2E8F0] bg-white p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[#0F172A]">{r.asset?.size || "Dumpster"} Delivery</p>
                  <p className="text-xs text-[#64748B] mt-0.5">
                    <Calendar className="inline h-3 w-3 mr-1" />
                    Scheduled: {r.scheduled_date ? new Date(r.scheduled_date).toLocaleDateString() : "TBD"}
                  </p>
                </div>
                {statusBadge(r.status)}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
