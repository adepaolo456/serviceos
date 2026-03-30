"use client";

import { useState, useEffect } from "react";
import { portalApi } from "@/lib/portal-api";
import { formatCurrency } from "@/lib/utils";
import { Package, Calendar, MapPin, ChevronRight } from "lucide-react";

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
  base_price: number;
  service_address: { formatted?: string; street?: string } | null;
  asset: { identifier?: string; size?: string } | null;
  completed_at: string | null;
  created_at: string;
}

const tabs = ["Active", "Upcoming", "Completed", "All"] as const;

function statusBadge(status: string) {
  const map: Record<string, { cls: string; label: string }> = {
    pending: { cls: "bg-amber-50 border-amber-200 text-amber-700", label: "Pending" },
    confirmed: { cls: "bg-blue-50 border-blue-200 text-blue-700", label: "Confirmed" },
    dispatched: { cls: "bg-indigo-50 border-indigo-200 text-indigo-700", label: "Dispatched" },
    en_route: { cls: "bg-purple-50 border-purple-200 text-purple-700", label: "En Route" },
    in_progress: { cls: "bg-green-50 border-green-200 text-green-700", label: "Delivered" },
    completed: { cls: "bg-gray-50 border-gray-200 text-gray-600", label: "Completed" },
    cancelled: { cls: "bg-red-50 border-red-200 text-red-600", label: "Cancelled" },
  };
  const s = map[status] || map.pending;
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

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

  if (detail) {
    const steps = [
      { label: "Requested", date: detail.created_at, done: true },
      { label: "Confirmed", date: detail.status !== "pending" ? detail.created_at : null, done: detail.status !== "pending" },
      { label: "Delivered", date: detail.rental_start_date, done: ["in_progress", "completed"].includes(detail.status) },
      { label: "Pickup Scheduled", date: detail.rental_end_date, done: detail.status === "completed" },
      { label: "Picked Up", date: detail.completed_at, done: detail.status === "completed" },
    ];

    return (
      <div className="space-y-6">
        <button onClick={() => setDetail(null)} className="text-sm text-[#2ECC71] font-medium hover:underline">&larr; Back to rentals</button>
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
            <div>
              <h2 className="text-lg font-bold text-[#0F172A]">{detail.asset?.size || detail.service_type || "Dumpster"} Rental</h2>
              <p className="text-sm text-[#64748B]">{detail.job_number}</p>
            </div>
            {statusBadge(detail.status)}
          </div>

          {/* Timeline */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-[#0F172A] mb-3">Timeline</h3>
            <div className="space-y-3">
              {steps.map((s, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${s.done ? "border-[#2ECC71] bg-[#2ECC71]" : "border-[#CBD5E1]"}`}>
                    {s.done && <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${s.done ? "text-[#0F172A]" : "text-[#94A3B8]"}`}>{s.label}</p>
                    {s.date && <p className="text-xs text-[#64748B]">{new Date(s.date).toLocaleDateString()}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-[#64748B]">Address</span><p className="font-medium text-[#0F172A] mt-0.5">{detail.service_address?.formatted || detail.service_address?.street || "—"}</p></div>
            <div><span className="text-[#64748B]">Duration</span><p className="font-medium text-[#0F172A] mt-0.5">{detail.rental_days || "—"} days</p></div>
            <div><span className="text-[#64748B]">Total Cost</span><p className="font-medium text-[#0F172A] mt-0.5">{formatCurrency(detail.total_price)}</p></div>
            <div><span className="text-[#64748B]">Asset</span><p className="font-medium text-[#0F172A] mt-0.5">{detail.asset?.identifier || "—"}</p></div>
          </div>

          {/* Reschedule */}
          {['pending', 'confirmed'].includes(detail.status) && (
            <div className="mt-6">
              {!rescheduleOpen ? (
                <button onClick={() => { setRescheduleOpen(true); setNewDate(detail.scheduled_date || ""); }}
                  className="rounded-lg border border-[#E2E8F0] px-4 py-2 text-sm font-medium text-[#334155] hover:bg-[#F1F5F9]">
                  Reschedule Delivery
                </button>
              ) : (
                <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 space-y-3">
                  <p className="text-sm font-semibold text-[#0F172A]">Reschedule Delivery</p>
                  <div>
                    <label className="block text-xs font-medium text-[#334155] mb-1">New Date</label>
                    <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
                      min={new Date(Date.now() + 86400000).toISOString().split("T")[0]}
                      className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#0F172A] outline-none focus:border-[#2ECC71]" />
                  </div>
                  {detail.rental_days && newDate && (
                    <p className="text-xs text-[#64748B]">
                      New pickup by: {new Date(new Date(newDate).getTime() + detail.rental_days * 86400000).toLocaleDateString()}
                    </p>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-[#334155] mb-1">Reason (optional)</label>
                    <input value={rescheduleReason} onChange={e => setRescheduleReason(e.target.value)}
                      placeholder="Why are you rescheduling?"
                      className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-2 text-sm text-[#0F172A] placeholder-[#94A3B8] outline-none focus:border-[#2ECC71]" />
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
                      className="rounded-lg bg-[#2ECC71] px-4 py-2 text-sm font-semibold text-white hover:bg-[#27AE60] disabled:opacity-50">
                      {rescheduling ? "Rescheduling..." : "Confirm Reschedule"}
                    </button>
                    <button onClick={() => setRescheduleOpen(false)} className="rounded-lg border border-[#E2E8F0] px-4 py-2 text-sm text-[#64748B]">Cancel</button>
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
      <h1 className="text-2xl font-bold text-[#0F172A]">My Rentals</h1>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-[#F1F5F9] p-1">
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === t ? "bg-white text-[#0F172A] shadow-sm" : "text-[#64748B] hover:text-[#0F172A]"}`}>
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-28 rounded-xl bg-[#E2E8F0] animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#CBD5E1] bg-white p-8 text-center">
          <Package className="mx-auto h-10 w-10 text-[#CBD5E1] mb-3" />
          <p className="text-sm font-medium text-[#64748B]">No {tab.toLowerCase()} rentals</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => (
            <button key={r.id} onClick={() => setDetail(r)}
              className="w-full text-left rounded-xl border border-[#E2E8F0] bg-white p-4 hover:border-[#2ECC71]/30 hover:shadow-sm transition-all">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-semibold text-[#0F172A]">{r.asset?.size || r.service_type || "Dumpster"}</p>
                    {statusBadge(r.status)}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#64748B]">
                    <span>{r.job_number}</span>
                    {r.service_address && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{r.service_address.formatted || r.service_address.street}</span>}
                    {r.rental_start_date && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(r.rental_start_date).toLocaleDateString()}</span>}
                    {r.total_price && <span className="font-medium text-[#0F172A]">{formatCurrency(r.total_price)}</span>}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-[#CBD5E1] shrink-0 ml-2" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
