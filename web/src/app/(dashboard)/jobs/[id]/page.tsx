"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  Clock,
  MoreHorizontal,
  Pencil,
  UserPlus,
  FileText,
  Trash2,
  ArrowRight,
} from "lucide-react";
import { api } from "@/lib/api";
import Dropdown from "@/components/dropdown";
import { useToast } from "@/components/toast";

/* --- Types --- */

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

/* --- Constants --- */

const STATUS_COLORS: Record<string, string> = {
  pending: "text-yellow-500",
  confirmed: "text-blue-400",
  dispatched: "text-purple-400",
  en_route: "text-orange-400",
  arrived: "text-teal-400",
  in_progress: "text-[var(--t-accent)]",
  completed: "text-emerald-400",
  cancelled: "text-[var(--t-error)]",
};

const JOB_TYPE_COLORS: Record<string, string> = {
  delivery: "text-blue-400",
  pickup: "text-orange-400",
  exchange: "text-purple-400",
};

const SIZE_COLORS: Record<string, string> = {
  "10yd": "text-sky-400",
  "15yd": "text-indigo-400",
  "20yd": "text-violet-400",
  "30yd": "text-amber-400",
  "40yd": "text-rose-400",
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
  confirmed: { label: "Confirm", className: "bg-[var(--t-accent)] text-black hover:opacity-90", icon: CheckCircle2 },
  dispatched: { label: "Dispatch", className: "bg-[var(--t-accent)] text-black hover:opacity-90", icon: Truck },
  en_route: { label: "En Route", className: "bg-[var(--t-accent)] text-black hover:opacity-90", icon: Truck },
  arrived: { label: "Arrived", className: "bg-[var(--t-accent)] text-black hover:opacity-90", icon: MapPin },
  in_progress: { label: "Start Work", className: "bg-[var(--t-accent)] text-black hover:opacity-90", icon: AlertCircle },
  completed: { label: "Complete", className: "bg-[var(--t-accent)] text-black hover:opacity-90", icon: CheckCircle2 },
  cancelled: { label: "Cancel", className: "border border-[var(--t-error)]/20 text-[var(--t-error)] hover:bg-[var(--t-error-soft)]", icon: XCircle },
};

const TIMELINE_STEPS = [
  { key: "created_at", label: "Created", status: "pending" },
  { key: "confirmed", label: "Confirmed", status: "confirmed" },
  { key: "dispatched_at", label: "Dispatched", status: "dispatched" },
  { key: "en_route_at", label: "En Route", status: "en_route" },
  { key: "arrived_at", label: "Arrived", status: "arrived" },
  { key: "completed_at", label: "Completed", status: "completed" },
];

/* --- Helpers --- */

import { formatCurrency } from "@/lib/utils";
function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return formatCurrency(n);
}

function fmtDateFull(d: string): string {
  if (!d) return "—";
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function fmtTime(t: string): string {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hour = parseInt(h);
  return `${hour > 12 ? hour - 12 : hour || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
}

function daysBetween(a: string, b: string): number {
  if (!a || !b) return 0;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

/* --- Page --- */

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchJob = async () => {
    try {
      const data = await api.get<Job>(`/jobs/${id}`);
      setJob(data);
    } catch { /* */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchJob(); }, [id]);

  const changeStatus = async (newStatus: string) => {
    if (actionLoading) return;
    if (newStatus === "cancelled") {
      const reason = prompt("Cancellation reason:");
      if (!reason) return;
      setActionLoading(true);
      try {
        await api.patch(`/jobs/${id}/status`, { status: newStatus, cancellationReason: reason });
        toast("success", "Job cancelled");
        await fetchJob();
      } catch { toast("error", "Failed to update"); } finally { setActionLoading(false); }
      return;
    }
    setActionLoading(true);
    try {
      await api.patch(`/jobs/${id}/status`, { status: newStatus });
      toast("success", `Job marked as ${newStatus.replace(/_/g, " ")}`);
      await fetchJob();
    } catch { toast("error", "Failed to update"); } finally { setActionLoading(false); }
  };

  const deleteJob = async () => {
    if (!confirm("Delete this job permanently?")) return;
    try {
      await api.delete(`/jobs/${id}`);
      toast("success", "Job deleted");
      router.push("/jobs");
    } catch { toast("error", "Failed to delete"); }
  };

  const scheduleNext = async (type: string) => {
    const scheduledDate = prompt(`Scheduled date for ${type.replace(/_/g, " ")} (YYYY-MM-DD):`);
    if (!scheduledDate) return;
    setActionLoading(true);
    try {
      await api.post(`/jobs/${id}/schedule-next`, { type, scheduledDate });
      toast("success", `${type.replace(/_/g, " ")} scheduled for ${scheduledDate}`);
      await fetchJob();
    } catch { toast("error", "Failed to schedule"); } finally { setActionLoading(false); }
  };

  if (loading) {
    return (
      <div className="py-10">
        <div className="mb-6 h-4 w-28 animate-pulse rounded bg-[var(--t-bg-card)]" />
        <div className="mb-8 space-y-2"><div className="h-7 w-40 animate-pulse rounded bg-[var(--t-bg-card)]" /><div className="h-4 w-56 animate-pulse rounded bg-[var(--t-bg-card)]" /></div>
        <div className="mb-8 rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-6">
          <div className="flex items-center justify-between gap-4">{Array.from({ length: 6 }).map((_, i) => (<div key={i} className="flex flex-col items-center flex-1"><div className="h-8 w-8 animate-pulse rounded-full bg-[var(--t-border)]" /><div className="mt-2 h-3 w-14 animate-pulse rounded bg-[var(--t-border)]" /></div>))}</div>
        </div>
      </div>
    );
  }

  if (!job) return <div className="flex items-center justify-center py-32 text-[var(--t-text-muted)]">Job not found</div>;

  const addr = job.service_address;
  const transitions = VALID_TRANSITIONS[job.status] || [];
  const statusIdx = TIMELINE_STEPS.findIndex((s) => s.status === job.status);
  const typeColor = JOB_TYPE_COLORS[job.job_type] || "text-blue-400";
  const sizeColor = job.asset?.subtype ? (SIZE_COLORS[job.asset.subtype] || "text-[var(--t-text-muted)]") : "";
  const rentalDays = job.rental_start_date && job.rental_end_date ? daysBetween(job.rental_start_date, job.rental_end_date) : job.rental_days;

  return (
    <div>
      <Link href="/jobs" className="mb-6 inline-flex items-center gap-2 text-sm text-[var(--t-frame-text-muted)] transition-colors hover:text-[var(--t-frame-text)]">
        <ArrowLeft className="h-4 w-4" /> Back to Jobs
      </Link>

      {/* --- Header --- */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)]">{job.job_number}</h1>
            <span className={`text-xs font-medium ${STATUS_COLORS[job.status] || ""}`}>
              {job.status.replace(/_/g, " ")}
            </span>
            <span className={`text-[11px] font-medium capitalize ${typeColor}`}>
              {job.job_type}
            </span>
            {sizeColor && (
              <span className={`text-[11px] font-medium ${sizeColor}`}>
                {job.asset?.subtype}
              </span>
            )}
          </div>
          {job.customer && (
            <Link href={`/customers/${job.customer.id}`} className="text-sm text-[var(--t-accent)] hover:underline">
              {job.customer.first_name} {job.customer.last_name}
            </Link>
          )}
          <p className="text-xs text-[var(--t-frame-text-muted)] mt-0.5">
            Created {new Date(job.created_at).toLocaleDateString()} {job.source && `· Source: ${job.source}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Status transition buttons */}
          {transitions.filter((t) => t !== "cancelled").map((t) => {
            const style = TRANSITION_STYLES[t];
            if (!style) return null;
            const Icon = style.icon;
            return (
              <button key={t} onClick={() => changeStatus(t)} disabled={actionLoading} className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all disabled:opacity-50 ${style.className}`}>
                <Icon className="h-4 w-4" /> {style.label}
              </button>
            );
          })}

          {/* Actions menu */}
          <Dropdown
            trigger={<button className="rounded-full border border-[var(--t-border)] p-2 text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] transition-colors"><MoreHorizontal className="h-4 w-4" /></button>}
            align="right"
          >
            {transitions.includes("cancelled") && (
              <button onClick={() => changeStatus("cancelled")} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[var(--t-error)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
                <XCircle className="h-3.5 w-3.5" /> Cancel Job
              </button>
            )}
            <button onClick={deleteJob} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[var(--t-error)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
              <Trash2 className="h-3.5 w-3.5" /> Delete Job
            </button>
            {job.status === "completed" && (job.job_type === "delivery" || job.job_type === "drop_off") && (
              <>
                <div className="my-1 border-t border-[var(--t-border)]" />
                <button onClick={() => scheduleNext("pickup")} disabled={actionLoading} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
                  <ArrowRight className="h-3.5 w-3.5" /> Schedule Pickup
                </button>
                <button onClick={() => scheduleNext("exchange")} disabled={actionLoading} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
                  <ArrowRight className="h-3.5 w-3.5" /> Schedule Exchange
                </button>
                <button onClick={() => scheduleNext("dump_and_return")} disabled={actionLoading} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
                  <ArrowRight className="h-3.5 w-3.5" /> Schedule Dump & Return
                </button>
              </>
            )}
          </Dropdown>
        </div>
      </div>

      {/* --- Timeline --- */}
      <div className="mb-8 rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-6">
        <div className="flex items-center justify-between">
          {TIMELINE_STEPS.map((step, i) => {
            const isCompleted = i <= statusIdx && job.status !== "cancelled";
            const isCurrent = i === statusIdx;
            const timestamp = (job as unknown as Record<string, string>)[step.key];
            return (
              <div key={step.key} className="flex flex-1 items-center">
                <div className="flex flex-col items-center">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                    job.status === "cancelled" && i > statusIdx ? "bg-[var(--t-border)] text-[var(--t-text-muted)]" :
                    isCurrent ? "bg-[var(--t-accent)] text-black ring-4 ring-[var(--t-accent)]/20" :
                    isCompleted ? "bg-[var(--t-accent)]/20 text-[var(--t-accent)]" : "bg-[var(--t-border)] text-[var(--t-text-muted)]"
                  }`}>
                    {job.status === "cancelled" && isCurrent ? (
                      <XCircle className="h-4 w-4 text-[var(--t-error)]" />
                    ) : isCompleted ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      i + 1
                    )}
                  </div>
                  <span className={`mt-2 text-[11px] font-medium ${isCurrent ? "text-[var(--t-accent)]" : isCompleted ? "text-[var(--t-text-primary)]" : "text-[var(--t-text-muted)]"}`}>
                    {step.label}
                  </span>
                  {timestamp && (
                    <span className="mt-0.5 text-[10px] text-[var(--t-text-muted)] tabular-nums">
                      {new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </div>
                {i < TIMELINE_STEPS.length - 1 && (
                  <div className={`mx-2 h-0.5 flex-1 rounded-full transition-colors ${
                    i < statusIdx && job.status !== "cancelled" ? "bg-[var(--t-accent)]/30" : "bg-[var(--t-border)]"
                  }`} />
                )}
              </div>
            );
          })}
        </div>
        {job.status === "cancelled" && (
          <div className="mt-4 rounded-[20px] bg-[var(--t-error-soft)] border border-[var(--t-error)]/20 px-4 py-3 text-sm text-[var(--t-error)]">
            <XCircle className="inline h-4 w-4 mr-1.5 -mt-0.5" />
            Cancelled{job.cancelled_at && ` on ${new Date(job.cancelled_at).toLocaleString()}`}
            {job.cancellation_reason && ` — ${job.cancellation_reason}`}
          </div>
        )}
      </div>

      {/* --- Two Column Layout --- */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Left Column (60%) */}
        <div className="space-y-6 lg:col-span-3">
          {/* Service Details */}
          <Card title="Service Details" icon={Truck}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Job Type" value={job.job_type} capitalize />
              <Field label="Service" value={job.service_type?.replace(/_/g, " ") || "—"} capitalize />
              <Field label="Asset" value={job.asset ? `${job.asset.identifier} (${job.asset.subtype})` : "None assigned"} />
              <Field label="Priority" value={job.priority} capitalize />
            </div>
            {addr && (addr.street || addr.city) && (
              <div className="mt-4 pt-4 border-t border-[var(--t-border)]">
                <p className="text-xs text-[var(--t-text-muted)] mb-1">Service Address</p>
                <p className="text-sm text-[var(--t-text-primary)]">{[addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(", ")}</p>
                {job.placement_notes && <p className="mt-1 text-xs text-[var(--t-text-muted)] italic">Placement: {job.placement_notes}</p>}
              </div>
            )}
          </Card>

          {/* Scheduling */}
          <Card title="Scheduling" icon={Calendar}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Scheduled Date" value={job.scheduled_date ? fmtDateFull(job.scheduled_date) : "Not set"} />
              <Field label="Time Window" value={
                job.scheduled_window_start
                  ? `${fmtTime(job.scheduled_window_start)}${job.scheduled_window_end ? ` – ${fmtTime(job.scheduled_window_end)}` : ""}`
                  : "Any time"
              } />
              {job.rental_start_date && <Field label="Rental Start" value={fmtDateFull(job.rental_start_date)} />}
              {job.rental_end_date && <Field label="Rental End" value={fmtDateFull(job.rental_end_date)} />}
              {rentalDays ? <Field label="Rental Days" value={`${rentalDays} days`} /> : null}
            </div>
            {job.rental_start_date && job.rental_end_date && (
              <div className="mt-3 pt-3 border-t border-[var(--t-border)] text-xs text-[var(--t-text-muted)]">
                {fmtDateFull(job.rental_start_date)} <ArrowRight className="inline h-3 w-3 mx-1" /> {fmtDateFull(job.rental_end_date)} ({rentalDays} days)
              </div>
            )}
          </Card>

          {/* Driver Notes */}
          {job.driver_notes && (
            <Card title="Driver Notes" icon={Truck}>
              <p className="text-sm text-[var(--t-text-primary)] whitespace-pre-wrap">{job.driver_notes}</p>
            </Card>
          )}

          {/* Photos */}
          {job.photos && job.photos.length > 0 && (
            <Card title={`Photos (${job.photos.length})`} icon={Box}>
              <div className="grid grid-cols-3 gap-3">
                {job.photos.map((p, i) => (
                  <div key={i} className="aspect-square rounded-[20px] bg-[var(--t-border)] overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* Right Column (40%) */}
        <div className="space-y-6 lg:col-span-2">
          {/* Pricing */}
          <Card title="Pricing" icon={DollarSign}>
            <div className="space-y-2.5 text-sm">
              <PriceRow label="Base Price" value={fmt(job.base_price)} />
              {job.deposit_amount > 0 && <PriceRow label="Deposit" value={fmt(job.deposit_amount)} />}
              {job.rental_days && job.rental_days > 0 && <PriceRow label="Rental Period" value={`${job.rental_days} days`} />}
              <div className="flex justify-between border-t border-[var(--t-border)] pt-2.5 font-semibold">
                <span className="text-[var(--t-text-primary)]">Total</span>
                <span className="text-[var(--t-accent)] tabular-nums text-base">{fmt(job.total_price)}</span>
              </div>
            </div>
          </Card>

          {/* Customer */}
          {job.customer && (
            <Link href={`/customers/${job.customer.id}`} className="block">
              <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5 transition-colors hover:bg-[var(--t-bg-card-hover)]">
                <div className="flex items-center gap-2 mb-3">
                  <User className="h-4 w-4 text-[var(--t-text-muted)]" />
                  <span className="text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Customer</span>
                </div>
                <p className="text-sm font-semibold text-[var(--t-text-primary)]">{job.customer.first_name} {job.customer.last_name}</p>
                {job.customer.phone && <a href={`tel:${job.customer.phone}`} className="block text-xs text-[var(--t-text-muted)] mt-0.5 hover:text-[var(--t-accent)]">{job.customer.phone}</a>}
                {job.customer.email && <p className="text-xs text-[var(--t-text-muted)]">{job.customer.email}</p>}
              </div>
            </Link>
          )}

          {/* Driver */}
          <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5">
            <div className="flex items-center gap-2 mb-3">
              <Truck className="h-4 w-4 text-[var(--t-text-muted)]" />
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Driver</span>
            </div>
            {job.assigned_driver ? (
              <>
                <p className="text-sm font-semibold text-[var(--t-text-primary)]">{job.assigned_driver.first_name} {job.assigned_driver.last_name}</p>
                {job.assigned_driver.phone && <a href={`tel:${job.assigned_driver.phone}`} className="block text-xs text-[var(--t-text-muted)] mt-0.5 hover:text-[var(--t-accent)]">{job.assigned_driver.phone}</a>}
              </>
            ) : (
              <p className="text-sm font-medium text-[var(--t-error)]">Unassigned</p>
            )}
          </div>

          {/* Asset */}
          <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5">
            <div className="flex items-center gap-2 mb-3">
              <Box className="h-4 w-4 text-[var(--t-text-muted)]" />
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Asset</span>
            </div>
            {job.asset ? (
              <>
                <p className="text-sm font-semibold text-[var(--t-text-primary)]">{job.asset.identifier}</p>
                <p className="text-xs text-[var(--t-text-muted)] mt-0.5 capitalize">{job.asset.asset_type} &middot; {job.asset.subtype}</p>
              </>
            ) : (
              <p className="text-sm text-[var(--t-text-muted)]">None assigned</p>
            )}
          </div>

          {/* Signature */}
          {job.signature_url && (
            <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5">
              <h3 className="text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)] mb-3">Signature</h3>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={job.signature_url} alt="Signature" className="max-h-20 rounded bg-white p-2" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* --- Reusable Components --- */

function Card({ title, icon: Icon, children }: { title: string; icon: typeof User; children: React.ReactNode }) {
  return (
    <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="h-4 w-4 text-[var(--t-text-muted)]" />
        <h3 className="text-sm font-semibold text-[var(--t-text-primary)]">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, capitalize: cap }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div>
      <p className="text-xs text-[var(--t-text-muted)] mb-0.5">{label}</p>
      <p className={`text-sm text-[var(--t-text-primary)] font-medium ${cap ? "capitalize" : ""}`}>{value}</p>
    </div>
  );
}

function PriceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[var(--t-text-muted)]">{label}</span>
      <span className={`text-[var(--t-text-primary)] ${value.startsWith("$") ? "tabular-nums" : ""}`}>{value}</span>
    </div>
  );
}
