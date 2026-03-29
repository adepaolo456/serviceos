"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Clock,
  MapPin,
  UserPlus,
  Truck,
  Phone,
  Plus,
  Box,
  Briefcase,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";

/* ---- Types ---- */

interface DispatchJob {
  id: string;
  job_number: string;
  job_type: string;
  service_type: string;
  status: string;
  scheduled_window_start: string;
  scheduled_window_end: string;
  service_address: Record<string, string> | null;
  route_order: number | null;
  customer: { id: string; first_name: string; last_name: string } | null;
  asset: { id: string; identifier: string; subtype?: string } | null;
}

interface Driver {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
}

interface DriverColumn {
  driver: Driver;
  route: { id: string; status: string; total_stops: number } | null;
  jobs: DispatchJob[];
  jobCount: number;
}

interface DispatchBoard {
  date: string;
  drivers: DriverColumn[];
  unassigned: DispatchJob[];
}

/* ---- Constants ---- */

const JOB_TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  delivery: { label: "Delivery", cls: "bg-blue-500/15 text-blue-400 border border-blue-500/20" },
  pickup: { label: "Pickup", cls: "bg-orange-500/15 text-orange-400 border border-orange-500/20" },
  exchange: { label: "Exchange", cls: "bg-purple-500/15 text-purple-400 border border-purple-500/20" },
};

const STATUS_DOT: Record<string, string> = {
  pending: "bg-zinc-400",
  confirmed: "bg-blue-400",
  dispatched: "bg-purple-400",
  en_route: "bg-yellow-400",
  arrived: "bg-teal-400",
  in_progress: "bg-brand",
  completed: "bg-emerald-400",
  cancelled: "bg-red-400",
};

/* ---- Helpers ---- */

function formatToday() {
  return new Date().toISOString().split("T")[0];
}

function formatDateDisplay(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  const today = formatToday();
  const tomorrow = shiftDate(today, 1);
  const yesterday = shiftDate(today, -1);
  let prefix = "";
  if (dateStr === today) prefix = "Today — ";
  else if (dateStr === tomorrow) prefix = "Tomorrow — ";
  else if (dateStr === yesterday) prefix = "Yesterday — ";
  return prefix + d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function shiftDate(dateStr: string, days: number) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function formatTime(t: string | null): string {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

/* ---- Page ---- */

export default function DispatchPage() {
  const [date, setDate] = useState(formatToday);
  const [board, setBoard] = useState<DispatchBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<DispatchBoard>(`/dispatch/board?date=${date}`);
      setBoard(data);
    } catch { /* handled */ }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  const assignDriver = async (jobId: string, driverId: string, driverName: string) => {
    try {
      await api.patch(`/jobs/${jobId}/assign`, { assignedDriverId: driverId });
      toast("success", `Assigned to ${driverName}`);
      await fetchBoard();
    } catch {
      toast("error", "Failed to assign driver");
    }
  };

  const isToday = date === formatToday();
  const totalJobs = board ? board.unassigned.length + board.drivers.reduce((s, d) => s + d.jobs.length, 0) : 0;

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col">
      {/* Header */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between shrink-0">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            Dispatch Board
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-sm text-muted">{formatDateDisplay(date)}</p>
            {totalJobs > 0 && (
              <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand">{totalJobs} jobs</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDate((d) => shiftDate(d, -1))}
            className="rounded-lg bg-dark-card border border-[#1E2D45] p-2 text-muted transition-colors hover:bg-dark-card-hover hover:text-white active:scale-95"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setDate(formatToday)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors active:scale-95 ${
              isToday
                ? "bg-brand/10 border-brand/20 text-brand"
                : "bg-dark-card border-[#1E2D45] text-muted hover:bg-dark-card-hover hover:text-white"
            }`}
          >
            Today
          </button>
          <div className="relative">
            <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-[#1E2D45] bg-[#111C2E] py-2 pl-10 pr-3 text-sm text-white outline-none transition-colors focus:border-brand"
            />
          </div>
          <button
            onClick={() => setDate((d) => shiftDate(d, 1))}
            className="rounded-lg bg-dark-card border border-[#1E2D45] p-2 text-muted transition-colors hover:bg-dark-card-hover hover:text-white active:scale-95"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Board */}
      {loading ? (
        <div className="flex flex-1 gap-4 overflow-x-auto pb-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="w-72 shrink-0 space-y-3">
              <div className="h-14 skeleton rounded-xl" />
              <div className="h-28 skeleton rounded-lg" />
              <div className="h-28 skeleton rounded-lg" />
              <div className="h-28 skeleton rounded-lg" />
            </div>
          ))}
        </div>
      ) : !board ? (
        <div className="flex flex-1 items-center justify-center text-muted">Failed to load dispatch board</div>
      ) : totalJobs === 0 && board.drivers.length === 0 ? (
        /* Full empty state */
        <div className="flex flex-1 flex-col items-center justify-center">
          <Truck className="h-16 w-16 text-muted/20 mb-4" />
          <h2 className="font-display text-lg font-semibold text-white">No jobs for {formatDateDisplay(date)}</h2>
          <p className="mt-1 text-sm text-muted">Create a new job to get started</p>
          <Link href="/" className="mt-4 flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-dark-primary hover:bg-brand-light active:scale-95 transition-all">
            <Plus className="h-4 w-4" /> New Job
          </Link>
        </div>
      ) : (
        <div className="flex flex-1 gap-3 overflow-x-auto pb-4">
          {/* Unassigned column */}
          <div className="flex w-72 shrink-0 flex-col rounded-xl bg-[#111C2E]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1E2D45]">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-500/10">
                  <UserPlus className="h-3.5 w-3.5 text-red-400" />
                </div>
                <span className="text-sm font-semibold text-white">Unassigned</span>
              </div>
              {board.unassigned.length > 0 && (
                <span className="rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-bold text-red-400 tabular-nums">
                  {board.unassigned.length}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
              {board.unassigned.length === 0 ? (
                <div className="py-10 text-center">
                  <Box className="mx-auto h-8 w-8 text-muted/20 mb-2" />
                  <p className="text-xs text-muted">All jobs assigned</p>
                </div>
              ) : (
                board.unassigned.map((job) => (
                  <UnassignedCard
                    key={job.id}
                    job={job}
                    drivers={board.drivers.map((d) => d.driver)}
                    onAssign={assignDriver}
                  />
                ))
              )}
            </div>
          </div>

          {/* Driver columns */}
          {board.drivers.map((col) => (
            <DriverCol key={col.driver.id} column={col} />
          ))}

          {/* No drivers hint */}
          {board.drivers.length === 0 && board.unassigned.length > 0 && (
            <div className="flex w-72 shrink-0 flex-col items-center justify-center rounded-xl bg-[#111C2E] border border-dashed border-[#1E2D45] p-6">
              <Truck className="h-10 w-10 text-muted/20 mb-3" />
              <p className="text-sm font-medium text-muted text-center">No drivers yet</p>
              <p className="text-xs text-muted/70 text-center mt-1">Invite team members from Settings</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---- Driver Column ---- */

function DriverCol({ column }: { column: DriverColumn }) {
  const { driver, jobs, route } = column;
  const completedCount = jobs.filter((j) => j.status === "completed").length;

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl bg-[#111C2E]">
      <div className="px-4 py-3 border-b border-[#1E2D45]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/15 text-xs font-bold text-brand">
              {driver.firstName[0]}{driver.lastName[0]}
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{driver.firstName} {driver.lastName}</p>
              {driver.phone && (
                <a href={`tel:${driver.phone}`} className="flex items-center gap-1 text-[11px] text-muted hover:text-brand transition-colors">
                  <Phone className="h-2.5 w-2.5" />{driver.phone}
                </a>
              )}
            </div>
          </div>
          <span className="rounded-full bg-dark-elevated px-2.5 py-0.5 text-xs font-bold text-foreground tabular-nums">
            {jobs.length}
          </span>
        </div>
        {jobs.length > 0 && (
          <div className="mt-2.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-dark-elevated overflow-hidden">
              <div
                className="h-full rounded-full bg-brand transition-all duration-500"
                style={{ width: `${jobs.length > 0 ? (completedCount / jobs.length) * 100 : 0}%` }}
              />
            </div>
            <span className="text-[10px] text-muted tabular-nums">{completedCount}/{jobs.length}</span>
          </div>
        )}
        {route && (
          <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted">
            <Truck className="h-2.5 w-2.5" />
            <span className="capitalize">{route.status}</span>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
        {jobs.length === 0 ? (
          <div className="py-10 text-center">
            <Briefcase className="mx-auto h-8 w-8 text-muted/20 mb-2" />
            <p className="text-xs text-muted">No jobs today</p>
          </div>
        ) : (
          jobs.map((job, i) => <JobCard key={job.id} job={job} order={i + 1} />)
        )}
      </div>
    </div>
  );
}

/* ---- Job Card (in driver column) ---- */

function JobCard({ job, order }: { job: DispatchJob; order: number }) {
  const dot = STATUS_DOT[job.status] || STATUS_DOT.pending;
  const typeBadge = JOB_TYPE_BADGE[job.job_type] || { label: job.job_type, cls: "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20" };
  const addr = job.service_address;
  const addrStr = addr ? [addr.street, addr.city].filter(Boolean).join(", ") : "";

  return (
    <Link
      href={`/jobs/${job.id}`}
      className="block rounded-lg bg-[#162033] border border-[#1E2D45] p-3.5 transition-all hover:border-[#2ECC71]/30 hover:shadow-md hover:shadow-black/10 active:scale-[0.98]"
    >
      {/* Top row: order + time + type */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-dark-elevated text-[10px] font-bold text-muted tabular-nums">
            {order}
          </span>
          {(job.scheduled_window_start || job.scheduled_window_end) && (
            <span className="flex items-center gap-1 text-[11px] text-muted">
              <Clock className="h-3 w-3" />
              {formatTime(job.scheduled_window_start)}
              {job.scheduled_window_end && ` – ${formatTime(job.scheduled_window_end)}`}
            </span>
          )}
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${typeBadge.cls}`}>
          {typeBadge.label}
        </span>
      </div>

      {/* Customer name */}
      <p className="text-sm font-semibold text-white truncate">
        {job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : job.job_number}
      </p>

      {/* Address */}
      {addrStr && (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted truncate">
          <MapPin className="h-3 w-3 shrink-0" />{addrStr}
        </p>
      )}

      {/* Bottom: status + asset */}
      <div className="mt-2.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          <span className="text-[10px] font-medium text-muted capitalize">{job.status.replace(/_/g, " ")}</span>
        </div>
        {job.asset && (
          <span className="rounded bg-dark-elevated px-1.5 py-0.5 text-[10px] font-medium text-muted">
            {job.asset.identifier}
          </span>
        )}
      </div>
    </Link>
  );
}

/* ---- Unassigned Card ---- */

function UnassignedCard({
  job,
  drivers,
  onAssign,
}: {
  job: DispatchJob;
  drivers: Driver[];
  onAssign: (jobId: string, driverId: string, driverName: string) => void;
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const typeBadge = JOB_TYPE_BADGE[job.job_type] || { label: job.job_type, cls: "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20" };
  const addr = job.service_address;
  const addrStr = addr ? [addr.street, addr.city].filter(Boolean).join(", ") : "";

  return (
    <div className="rounded-lg bg-[#162033] border border-red-500/15 p-3.5">
      {/* Top: time + type */}
      <div className="flex items-center justify-between mb-2">
        {(job.scheduled_window_start || job.scheduled_window_end) ? (
          <span className="flex items-center gap-1 text-[11px] text-muted">
            <Clock className="h-3 w-3" />
            {formatTime(job.scheduled_window_start)}
            {job.scheduled_window_end && ` – ${formatTime(job.scheduled_window_end)}`}
          </span>
        ) : (
          <span className="text-[10px] text-muted">{job.job_number}</span>
        )}
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${typeBadge.cls}`}>
          {typeBadge.label}
        </span>
      </div>

      {/* Customer */}
      <p className="text-sm font-semibold text-white truncate">
        {job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : job.job_number}
      </p>

      {addrStr && (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted truncate">
          <MapPin className="h-3 w-3 shrink-0" />{addrStr}
        </p>
      )}

      {job.asset && (
        <p className="mt-1 text-[10px] text-muted">
          {job.asset.identifier}
        </p>
      )}

      {/* Assign button */}
      <div className="relative mt-3">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand/10 border border-brand/20 py-2 text-xs font-semibold text-brand transition-all hover:bg-brand/20 active:scale-[0.98]"
        >
          <UserPlus className="h-3.5 w-3.5" />
          Assign Driver
        </button>
        {showDropdown && (
          <div className="absolute left-0 right-0 z-20 mt-1 rounded-lg border border-[#1E2D45] bg-dark-secondary shadow-xl overflow-hidden">
            {drivers.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted text-center">No drivers available</p>
            ) : (
              drivers.map((d) => (
                <button
                  key={d.id}
                  onClick={() => {
                    onAssign(job.id, d.id, `${d.firstName} ${d.lastName}`);
                    setShowDropdown(false);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-dark-card-hover"
                >
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-brand/10 text-[10px] font-bold text-brand">
                    {d.firstName[0]}{d.lastName[0]}
                  </div>
                  <span className="font-medium">{d.firstName} {d.lastName}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
