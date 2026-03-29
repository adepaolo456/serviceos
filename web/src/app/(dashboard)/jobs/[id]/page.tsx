"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
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
} from "lucide-react";
import { api } from "@/lib/api";

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
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-400",
  confirmed: "bg-blue-500/10 text-blue-400",
  dispatched: "bg-purple-500/10 text-purple-400",
  en_route: "bg-orange-500/10 text-orange-400",
  arrived: "bg-teal-500/10 text-teal-400",
  in_progress: "bg-brand/10 text-brand",
  completed: "bg-emerald-500/10 text-emerald-400",
  cancelled: "bg-red-500/10 text-red-400",
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
  confirmed: { label: "Confirm", className: "bg-blue-500 hover:bg-blue-600 text-white", icon: CheckCircle2 },
  dispatched: { label: "Dispatch", className: "bg-purple-500 hover:bg-purple-600 text-white", icon: Truck },
  en_route: { label: "Mark En Route", className: "bg-orange-500 hover:bg-orange-600 text-white", icon: Truck },
  arrived: { label: "Mark Arrived", className: "bg-teal-500 hover:bg-teal-600 text-white", icon: MapPin },
  in_progress: { label: "Start Work", className: "bg-[#2ECC71] hover:bg-[#1FA855] text-white", icon: AlertCircle },
  completed: { label: "Complete", className: "bg-[#2ECC71] hover:bg-[#1FA855] text-white", icon: CheckCircle2 },
  cancelled: { label: "Cancel", className: "bg-red-500/20 hover:bg-red-500/30 text-red-400", icon: XCircle },
};

const TIMELINE_STEPS = [
  { key: "created_at", label: "Created", status: "pending" },
  { key: "confirmed", label: "Confirmed", status: "confirmed" },
  { key: "dispatched_at", label: "Dispatched", status: "dispatched" },
  { key: "en_route_at", label: "En Route", status: "en_route" },
  { key: "arrived_at", label: "Arrived", status: "arrived" },
  { key: "completed_at", label: "Completed", status: "completed" },
];

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchJob = async () => {
    try {
      const data = await api.get<Job>(`/jobs/${id}`);
      setJob(data);
    } catch {
      /* handled */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJob();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const changeStatus = async (newStatus: string) => {
    if (actionLoading) return;
    if (newStatus === "cancelled") {
      const reason = prompt("Cancellation reason:");
      if (!reason) return;
      setActionLoading(true);
      try {
        await api.patch(`/jobs/${id}/status`, { status: newStatus, cancellationReason: reason });
        await fetchJob();
      } catch {
        /* */
      } finally {
        setActionLoading(false);
      }
      return;
    }
    setActionLoading(true);
    try {
      await api.patch(`/jobs/${id}/status`, { status: newStatus });
      await fetchJob();
    } catch {
      /* */
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="py-10">
        <div className="mb-6 h-4 w-28 animate-pulse rounded bg-white/5" />
        <div className="mb-8 flex items-start justify-between">
          <div className="space-y-2">
            <div className="h-7 w-40 animate-pulse rounded bg-white/5" />
            <div className="h-4 w-56 animate-pulse rounded bg-white/5" />
          </div>
        </div>
        <div className="mb-8 rounded-2xl bg-dark-card border border-[#1E2D45] p-6">
          <div className="h-5 w-32 animate-pulse rounded bg-white/5 mb-5" />
          <div className="flex items-center justify-between gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center flex-1">
                <div className="h-8 w-8 animate-pulse rounded-full bg-white/5" />
                <div className="mt-2 h-3 w-14 animate-pulse rounded bg-white/5" />
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <div className="grid grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-2xl bg-dark-card border border-[#1E2D45] p-5">
                  <div className="h-3 w-16 animate-pulse rounded bg-white/5 mb-3" />
                  <div className="h-4 w-28 animate-pulse rounded bg-white/5" />
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-6">
            <div className="rounded-2xl bg-dark-card border border-[#1E2D45] p-5">
              <div className="h-4 w-20 animate-pulse rounded bg-white/5 mb-4" />
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-4 w-full animate-pulse rounded bg-white/5" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!job) {
    return <div className="flex items-center justify-center py-32 text-muted">Job not found</div>;
  }

  const addr = job.service_address;
  const transitions = VALID_TRANSITIONS[job.status] || [];
  const statusIdx = TIMELINE_STEPS.findIndex((s) => s.status === job.status);

  return (
    <div>
      <Link
        href="/jobs"
        className="mb-6 inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Jobs
      </Link>

      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="font-display text-2xl font-bold text-white">
              {job.job_number}
            </h1>
            <span
              className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${STATUS_COLORS[job.status] || ""}`}
            >
              {job.status.replace(/_/g, " ")}
            </span>
          </div>
          <p className="text-sm text-muted">
            {job.service_type || job.job_type} &middot; Created{" "}
            {new Date(job.created_at).toLocaleDateString()}
            {job.source && ` &middot; Source: ${job.source}`}
          </p>
        </div>
        {transitions.length > 0 && (
          <div className="flex gap-2">
            {transitions.map((t) => {
              const style = TRANSITION_STYLES[t];
              if (!style) return null;
              const Icon = style.icon;
              return (
                <button
                  key={t}
                  onClick={() => changeStatus(t)}
                  disabled={actionLoading}
                  className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${style.className}`}
                >
                  <Icon className="h-4 w-4" />
                  {style.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="mb-8 rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-6">
        <h2 className="font-display text-base font-semibold text-white mb-5">
          Status Timeline
        </h2>
        <div className="flex items-center justify-between">
          {TIMELINE_STEPS.map((step, i) => {
            const isCompleted = i <= statusIdx && job.status !== "cancelled";
            const isCurrent = i === statusIdx;
            const timestamp = (job as unknown as Record<string, string>)[step.key];
            return (
              <div key={step.key} className="flex flex-1 items-center">
                <div className="flex flex-col items-center">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                      isCurrent
                        ? "bg-brand text-dark-primary"
                        : isCompleted
                          ? "bg-brand/20 text-brand"
                          : "bg-dark-elevated text-muted"
                    }`}
                  >
                    {i + 1}
                  </div>
                  <span
                    className={`mt-2 text-xs font-medium ${isCurrent ? "text-brand" : isCompleted ? "text-foreground" : "text-muted"}`}
                  >
                    {step.label}
                  </span>
                  {timestamp && (
                    <span className="mt-0.5 text-[10px] text-muted">
                      {new Date(timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
                {i < TIMELINE_STEPS.length - 1 && (
                  <div
                    className={`mx-2 h-0.5 flex-1 rounded-full ${
                      i < statusIdx && job.status !== "cancelled"
                        ? "bg-brand/30"
                        : "bg-dark-elevated"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
        {job.status === "cancelled" && (
          <div className="mt-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            Cancelled{job.cancelled_at && ` on ${new Date(job.cancelled_at).toLocaleString()}`}
            {job.cancellation_reason && ` — ${job.cancellation_reason}`}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: Details */}
        <div className="space-y-6 lg:col-span-2">
          {/* Info grid */}
          <div className="grid grid-cols-2 gap-4">
            <InfoCard
              icon={User}
              label="Customer"
              value={job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : "—"}
              sub={job.customer?.phone || job.customer?.email}
              href={job.customer ? `/customers/${job.customer.id}` : undefined}
            />
            <InfoCard
              icon={Truck}
              label="Driver"
              value={
                job.assigned_driver
                  ? `${job.assigned_driver.first_name} ${job.assigned_driver.last_name}`
                  : "Unassigned"
              }
              sub={job.assigned_driver?.phone}
            />
            <InfoCard
              icon={Box}
              label="Asset"
              value={job.asset ? `${job.asset.identifier}` : "None"}
              sub={job.asset ? `${job.asset.asset_type} ${job.asset.subtype || ""}` : undefined}
            />
            <InfoCard
              icon={Calendar}
              label="Scheduled"
              value={job.scheduled_date || "Not set"}
              sub={
                job.scheduled_window_start && job.scheduled_window_end
                  ? `${job.scheduled_window_start} – ${job.scheduled_window_end}`
                  : undefined
              }
            />
          </div>

          {/* Service address */}
          {addr && (addr.street || addr.city) && (
            <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-5">
              <div className="flex items-center gap-2 mb-3">
                <MapPin className="h-4 w-4 text-muted" />
                <span className="text-sm font-medium text-white">Service Address</span>
              </div>
              <p className="text-sm text-foreground">
                {[addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(", ")}
              </p>
              {job.placement_notes && (
                <p className="mt-2 text-sm text-muted italic">{job.placement_notes}</p>
              )}
            </div>
          )}

          {/* Driver notes */}
          {job.driver_notes && (
            <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-5">
              <h3 className="text-sm font-medium text-white mb-2">Driver Notes</h3>
              <p className="text-sm text-foreground whitespace-pre-wrap">{job.driver_notes}</p>
            </div>
          )}

          {/* Photos */}
          {job.photos && job.photos.length > 0 && (
            <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-5">
              <h3 className="text-sm font-medium text-white mb-3">Photos ({job.photos.length})</h3>
              <div className="grid grid-cols-3 gap-3">
                {job.photos.map((p, i) => (
                  <div key={i} className="aspect-square rounded-lg bg-dark-elevated overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Pricing */}
        <div className="space-y-6">
          <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-5">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="h-4 w-4 text-brand" />
              <h3 className="text-sm font-semibold text-white">Pricing</h3>
            </div>
            <div className="space-y-2 text-sm">
              <Row label="Base Price" value={fmt(job.base_price)} />
              {job.rental_days && <Row label="Rental Days" value={String(job.rental_days)} />}
              {job.rental_start_date && <Row label="Rental Start" value={job.rental_start_date} />}
              {job.rental_end_date && <Row label="Rental End" value={job.rental_end_date} />}
              {job.deposit_amount > 0 && <Row label="Deposit" value={fmt(job.deposit_amount)} />}
              <div className="flex justify-between border-t border-[#1E2D45] pt-2 font-semibold text-white">
                <span>Total</span>
                <span className="tabular-nums">{fmt(job.total_price)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-5">
            <h3 className="text-sm font-semibold text-white mb-3">Details</h3>
            <div className="space-y-2 text-sm">
              <Row label="Job Type" value={job.job_type} capitalize />
              <Row label="Service" value={job.service_type || "—"} />
              <Row label="Priority" value={job.priority} capitalize />
              <Row label="Source" value={job.source || "manual"} capitalize />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
  sub,
  href,
}: {
  icon: typeof User;
  label: string;
  value: string;
  sub?: string;
  href?: string;
}) {
  const content = (
    <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-5 transition-colors hover:bg-dark-card-hover hover:border-[#2A3D5A]">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-muted" />
        <span className="text-xs font-medium uppercase tracking-wider text-muted">
          {label}
        </span>
      </div>
      <p className="text-sm font-medium text-white">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
  if (href)
    return (
      <Link href={href} className="block">
        {content}
      </Link>
    );
  return content;
}

function Row({
  label,
  value,
  capitalize: cap,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className={`text-foreground ${cap ? "capitalize" : ""} ${value.startsWith("$") ? "tabular-nums" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
