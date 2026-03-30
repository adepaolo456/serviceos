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

/* ─── Types ─── */

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

/* ─── Constants ─── */

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  confirmed: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  dispatched: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  en_route: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  arrived: "bg-teal-500/10 text-teal-400 border-teal-500/20",
  in_progress: "bg-brand/10 text-brand border-brand/20",
  completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  cancelled: "bg-red-500/10 text-red-400 border-red-500/20",
};

const JOB_TYPE_BADGE: Record<string, { icon: string; color: string }> = {
  delivery: { icon: "🔵", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  pickup:   { icon: "🟠", color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  exchange: { icon: "🟣", color: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
};

const SIZE_BADGE: Record<string, string> = {
  "10yd": "bg-sky-500/10 text-sky-400 border-sky-500/20",
  "15yd": "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  "20yd": "bg-violet-500/10 text-violet-400 border-violet-500/20",
  "30yd": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "40yd": "bg-rose-500/10 text-rose-400 border-rose-500/20",
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
  en_route: { label: "En Route", className: "bg-orange-500 hover:bg-orange-600 text-white", icon: Truck },
  arrived: { label: "Arrived", className: "bg-teal-500 hover:bg-teal-600 text-white", icon: MapPin },
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

/* ─── Helpers ─── */

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

/* ─── Page ─── */

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

  if (loading) {
    return (
      <div className="py-10">
        <div className="mb-6 h-4 w-28 animate-pulse rounded bg-white/5" />
        <div className="mb-8 space-y-2"><div className="h-7 w-40 animate-pulse rounded bg-white/5" /><div className="h-4 w-56 animate-pulse rounded bg-white/5" /></div>
        <div className="mb-8 rounded-2xl bg-dark-card border border-[#1E2D45] p-6">
          <div className="flex items-center justify-between gap-4">{Array.from({ length: 6 }).map((_, i) => (<div key={i} className="flex flex-col items-center flex-1"><div className="h-8 w-8 animate-pulse rounded-full bg-white/5" /><div className="mt-2 h-3 w-14 animate-pulse rounded bg-white/5" /></div>))}</div>
        </div>
      </div>
    );
  }

  if (!job) return <div className="flex items-center justify-center py-32 text-muted">Job not found</div>;

  const addr = job.service_address;
  const transitions = VALID_TRANSITIONS[job.status] || [];
  const statusIdx = TIMELINE_STEPS.findIndex((s) => s.status === job.status);
  const typeBadge = JOB_TYPE_BADGE[job.job_type] || JOB_TYPE_BADGE.delivery;
  const sizeBadge = job.asset?.subtype ? (SIZE_BADGE[job.asset.subtype] || "") : "";
  const rentalDays = job.rental_start_date && job.rental_end_date ? daysBetween(job.rental_start_date, job.rental_end_date) : job.rental_days;

  return (
    <div>
      <Link href="/jobs" className="mb-6 inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Jobs
      </Link>

      {/* ─── Header ─── */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="font-display text-2xl font-bold text-white">{job.job_number}</h1>
            <span className={`inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-medium ${STATUS_COLORS[job.status] || ""}`}>
              {job.status.replace(/_/g, " ")}
            </span>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${typeBadge.color}`}>
              {typeBadge.icon} {job.job_type}
            </span>
            {sizeBadge && (
              <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${sizeBadge}`}>
                {job.asset?.subtype}
              </span>
            )}
          </div>
          {job.customer && (
            <Link href={`/customers/${job.customer.id}`} className="text-sm text-brand hover:underline">
              {job.customer.first_name} {job.customer.last_name}
            </Link>
          )}
          <p className="text-xs text-muted mt-0.5">
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
              <button key={t} onClick={() => changeStatus(t)} disabled={actionLoading} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${style.className}`}>
                <Icon className="h-4 w-4" /> {style.label}
              </button>
            );
          })}

          {/* Actions menu */}
          <Dropdown
            trigger={<button className="rounded-lg border border-[#1E2D45] p-2 text-muted hover:text-white transition-colors"><MoreHorizontal className="h-4 w-4" /></button>}
            align="right"
          >
            {transitions.includes("cancelled") && (
              <button onClick={() => changeStatus("cancelled")} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-dark-card transition-colors">
                <XCircle className="h-3.5 w-3.5" /> Cancel Job
              </button>
            )}
            <button onClick={deleteJob} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-dark-card transition-colors">
              <Trash2 className="h-3.5 w-3.5" /> Delete Job
            </button>
          </Dropdown>
        </div>
      </div>

      {/* ─── Timeline ─── */}
      <div className="mb-8 rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-6">
        <div className="flex items-center justify-between">
          {TIMELINE_STEPS.map((step, i) => {
            const isCompleted = i <= statusIdx && job.status !== "cancelled";
            const isCurrent = i === statusIdx;
            const timestamp = (job as unknown as Record<string, string>)[step.key];
            return (
              <div key={step.key} className="flex flex-1 items-center">
                <div className="flex flex-col items-center">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                    job.status === "cancelled" && i > statusIdx ? "bg-dark-elevated text-muted" :
                    isCurrent ? "bg-brand text-dark-primary ring-4 ring-brand/20" :
                    isCompleted ? "bg-brand/20 text-brand" : "bg-dark-elevated text-muted"
                  }`}>
                    {job.status === "cancelled" && isCurrent ? (
                      <XCircle className="h-4 w-4 text-red-400" />
                    ) : isCompleted ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      i + 1
                    )}
                  </div>
                  <span className={`mt-2 text-[11px] font-medium ${isCurrent ? "text-brand" : isCompleted ? "text-foreground" : "text-muted"}`}>
                    {step.label}
                  </span>
                  {timestamp && (
                    <span className="mt-0.5 text-[10px] text-muted tabular-nums">
                      {new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </div>
                {i < TIMELINE_STEPS.length - 1 && (
                  <div className={`mx-2 h-0.5 flex-1 rounded-full transition-colors ${
                    i < statusIdx && job.status !== "cancelled" ? "bg-brand/30" : "bg-dark-elevated"
                  }`} />
                )}
              </div>
            );
          })}
        </div>
        {job.status === "cancelled" && (
          <div className="mt-4 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
            <XCircle className="inline h-4 w-4 mr-1.5 -mt-0.5" />
            Cancelled{job.cancelled_at && ` on ${new Date(job.cancelled_at).toLocaleString()}`}
            {job.cancellation_reason && ` — ${job.cancellation_reason}`}
          </div>
        )}
      </div>

      {/* ─── Two Column Layout ─── */}
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
              <div className="mt-4 pt-4 border-t border-[#1E2D45]">
                <p className="text-xs text-muted mb-1">Service Address</p>
                <p className="text-sm text-white">{[addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(", ")}</p>
                {job.placement_notes && <p className="mt-1 text-xs text-muted italic">Placement: {job.placement_notes}</p>}
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
              <div className="mt-3 pt-3 border-t border-[#1E2D45] text-xs text-muted">
                {fmtDateFull(job.rental_start_date)} <ArrowRight className="inline h-3 w-3 mx-1" /> {fmtDateFull(job.rental_end_date)} ({rentalDays} days)
              </div>
            )}
          </Card>

          {/* Driver Notes */}
          {job.driver_notes && (
            <Card title="Driver Notes" icon={Truck}>
              <p className="text-sm text-foreground whitespace-pre-wrap">{job.driver_notes}</p>
            </Card>
          )}

          {/* Photos */}
          {job.photos && job.photos.length > 0 && (
            <Card title={`Photos (${job.photos.length})`} icon={Box}>
              <div className="grid grid-cols-3 gap-3">
                {job.photos.map((p, i) => (
                  <div key={i} className="aspect-square rounded-lg bg-dark-elevated overflow-hidden">
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
              <div className="flex justify-between border-t border-[#1E2D45] pt-2.5 font-semibold">
                <span className="text-white">Total</span>
                <span className="text-brand tabular-nums text-base">{fmt(job.total_price)}</span>
              </div>
            </div>
          </Card>

          {/* Customer */}
          {job.customer && (
            <Link href={`/customers/${job.customer.id}`} className="block">
              <div className="rounded-2xl bg-dark-card border border-[#1E2D45] p-5 transition-colors hover:bg-dark-card-hover hover:border-white/10">
                <div className="flex items-center gap-2 mb-3">
                  <User className="h-4 w-4 text-muted" />
                  <span className="text-xs font-medium uppercase tracking-wider text-muted">Customer</span>
                </div>
                <p className="text-sm font-semibold text-white">{job.customer.first_name} {job.customer.last_name}</p>
                {job.customer.phone && <p className="text-xs text-muted mt-0.5">{job.customer.phone}</p>}
                {job.customer.email && <p className="text-xs text-muted">{job.customer.email}</p>}
              </div>
            </Link>
          )}

          {/* Driver */}
          <div className="rounded-2xl bg-dark-card border border-[#1E2D45] p-5">
            <div className="flex items-center gap-2 mb-3">
              <Truck className="h-4 w-4 text-muted" />
              <span className="text-xs font-medium uppercase tracking-wider text-muted">Driver</span>
            </div>
            {job.assigned_driver ? (
              <>
                <p className="text-sm font-semibold text-white">{job.assigned_driver.first_name} {job.assigned_driver.last_name}</p>
                {job.assigned_driver.phone && <p className="text-xs text-muted mt-0.5">{job.assigned_driver.phone}</p>}
              </>
            ) : (
              <p className="text-sm font-medium text-red-400">Unassigned</p>
            )}
          </div>

          {/* Asset */}
          <div className="rounded-2xl bg-dark-card border border-[#1E2D45] p-5">
            <div className="flex items-center gap-2 mb-3">
              <Box className="h-4 w-4 text-muted" />
              <span className="text-xs font-medium uppercase tracking-wider text-muted">Asset</span>
            </div>
            {job.asset ? (
              <>
                <p className="text-sm font-semibold text-white">{job.asset.identifier}</p>
                <p className="text-xs text-muted mt-0.5 capitalize">{job.asset.asset_type} &middot; {job.asset.subtype}</p>
              </>
            ) : (
              <p className="text-sm text-muted">None assigned</p>
            )}
          </div>

          {/* Signature */}
          {job.signature_url && (
            <div className="rounded-2xl bg-dark-card border border-[#1E2D45] p-5">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted mb-3">Signature</h3>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={job.signature_url} alt="Signature" className="max-h-20 rounded bg-white p-2" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Reusable Components ─── */

function Card({ title, icon: Icon, children }: { title: string; icon: typeof User; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="h-4 w-4 text-muted" />
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, capitalize: cap }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted mb-0.5">{label}</p>
      <p className={`text-sm text-white font-medium ${cap ? "capitalize" : ""}`}>{value}</p>
    </div>
  );
}

function PriceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className={`text-foreground ${value.startsWith("$") ? "tabular-nums" : ""}`}>{value}</span>
    </div>
  );
}
