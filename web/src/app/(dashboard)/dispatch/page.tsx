"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Clock,
  MapPin,
  UserPlus,
  Truck,
  Phone,
} from "lucide-react";
import { api } from "@/lib/api";

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
  asset: { id: string; identifier: string } | null;
}

interface Driver {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
}

interface DriverColumn {
  driver: Driver;
  route: {
    id: string;
    status: string;
    total_stops: number;
  } | null;
  jobs: DispatchJob[];
  jobCount: number;
}

interface DispatchBoard {
  date: string;
  drivers: DriverColumn[];
  unassigned: DispatchJob[];
}

const STATUS_CARD: Record<string, { bg: string; border: string; dot: string }> =
  {
    pending: {
      bg: "bg-dark-card",
      border: "border-[#1E2D45]",
      dot: "bg-zinc-500",
    },
    confirmed: {
      bg: "bg-blue-500/5",
      border: "border-blue-500/15",
      dot: "bg-blue-500",
    },
    dispatched: {
      bg: "bg-purple-500/5",
      border: "border-purple-500/15",
      dot: "bg-purple-500",
    },
    en_route: {
      bg: "bg-yellow-500/5",
      border: "border-yellow-500/15",
      dot: "bg-yellow-500",
    },
    arrived: {
      bg: "bg-teal-500/5",
      border: "border-teal-500/15",
      dot: "bg-teal-500",
    },
    in_progress: {
      bg: "bg-brand/5",
      border: "border-brand/15",
      dot: "bg-brand",
    },
    completed: {
      bg: "bg-emerald-500/5",
      border: "border-emerald-500/15",
      dot: "bg-emerald-500",
    },
    cancelled: {
      bg: "bg-red-500/5",
      border: "border-red-500/15",
      dot: "bg-red-500",
    },
  };

const JOB_TYPE_BADGE: Record<string, string> = {
  delivery: "bg-blue-500/10 text-blue-400",
  pickup: "bg-orange-500/10 text-orange-400",
  exchange: "bg-purple-500/10 text-purple-400",
};

function formatToday() {
  return new Date().toISOString().split("T")[0];
}

function formatDateDisplay(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function shiftDate(dateStr: string, days: number) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

export default function DispatchPage() {
  const [date, setDate] = useState(formatToday);
  const [board, setBoard] = useState<DispatchBoard | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<DispatchBoard>(
        `/dispatch/board?date=${date}`
      );
      setBoard(data);
    } catch {
      /* handled */
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    fetchBoard();
  }, [fetchBoard]);

  const assignDriver = async (jobId: string, driverId: string) => {
    try {
      await api.patch(`/jobs/${jobId}/assign`, {
        assignedDriverId: driverId,
      });
      await fetchBoard();
    } catch {
      /* handled */
    }
  };

  const isToday = date === formatToday();

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between shrink-0">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            Dispatch Board
          </h1>
          <p className="mt-1 text-muted">{formatDateDisplay(date)}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDate((d) => shiftDate(d, -1))}
            className="rounded-lg bg-dark-card p-2 text-muted transition-colors hover:bg-dark-card-hover hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setDate(formatToday)}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              isToday
                ? "bg-brand/10 text-brand"
                : "bg-dark-card text-muted hover:bg-dark-card-hover hover:text-white"
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
              className="rounded-lg border border-[#1E2D45] bg-[#111C2E] py-2 pl-10 pr-3 text-sm text-white outline-none transition-colors focus:border-[#2ECC71]"
            />
          </div>
          <button
            onClick={() => setDate((d) => shiftDate(d, 1))}
            className="rounded-lg bg-dark-card p-2 text-muted transition-colors hover:bg-dark-card-hover hover:text-white"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex gap-4">
            <div className="w-72 h-96 skeleton rounded-2xl" />
            <div className="w-72 h-96 skeleton rounded-2xl" />
            <div className="w-72 h-96 skeleton rounded-2xl" />
            <div className="w-72 h-96 skeleton rounded-2xl" />
          </div>
        </div>
      ) : !board ? (
        <div className="flex flex-1 items-center justify-center text-muted">
          Failed to load
        </div>
      ) : (
        <div className="flex flex-1 gap-4 overflow-x-auto pb-4">
          {/* Unassigned column */}
          <div className="flex w-72 shrink-0 flex-col rounded-2xl bg-dark-secondary border border-[#1E2D45] shadow-lg shadow-black/10">
            <div className="flex items-center justify-between border-b border-[#1E2D45] px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-red-500/10">
                  <UserPlus className="h-3.5 w-3.5 text-red-400" />
                </div>
                <span className="text-sm font-semibold text-white">
                  Unassigned
                </span>
              </div>
              <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">
                {board.unassigned.length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {board.unassigned.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted">
                  All jobs assigned
                </p>
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
            <DriverColumnView
              key={col.driver.id}
              column={col}
            />
          ))}

          {/* Empty state */}
          {board.drivers.length === 0 && (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <Truck size={48} className="text-[#7A8BA3]/30" />
                <p className="text-sm font-semibold text-white">No drivers available</p>
                <p className="text-xs text-muted">Invite team members to start dispatching jobs</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Driver Column ---------- */

function DriverColumnView({ column }: { column: DriverColumn }) {
  const { driver, jobs, route } = column;
  const completedCount = jobs.filter((j) => j.status === "completed").length;

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-2xl bg-dark-secondary border border-[#1E2D45] shadow-lg shadow-black/10">
      <div className="border-b border-[#1E2D45] px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand">
              {driver.firstName[0]}
              {driver.lastName[0]}
            </div>
            <div>
              <p className="text-sm font-semibold text-white">
                {driver.firstName} {driver.lastName}
              </p>
              {driver.phone && (
                <div className="flex items-center gap-1 text-[11px] text-muted">
                  <Phone className="h-2.5 w-2.5" />
                  {driver.phone}
                </div>
              )}
            </div>
          </div>
          <span className="rounded-full bg-dark-elevated px-2 py-0.5 text-xs font-medium text-foreground">
            {jobs.length}
          </span>
        </div>
        {/* Progress bar */}
        {jobs.length > 0 && (
          <div className="mt-2.5 flex items-center gap-2">
            <div className="h-1 flex-1 rounded-full bg-dark-elevated overflow-hidden">
              <div
                className="h-full rounded-full bg-brand transition-all"
                style={{
                  width: `${(completedCount / jobs.length) * 100}%`,
                }}
              />
            </div>
            <span className="text-[10px] text-muted">
              {completedCount}/{jobs.length}
            </span>
          </div>
        )}
        {route && (
          <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted">
            <span className="flex items-center gap-1">
              <Truck className="h-2.5 w-2.5" />
              {route.status}
            </span>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {jobs.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted">No jobs today</p>
        ) : (
          jobs.map((job, i) => <JobCard key={job.id} job={job} order={i + 1} />)
        )}
      </div>
    </div>
  );
}

/* ---------- Job Card (driver column) ---------- */

function JobCard({ job, order }: { job: DispatchJob; order: number }) {
  const style = STATUS_CARD[job.status] || STATUS_CARD.pending;
  const addr = job.service_address;
  const addrStr = addr
    ? [addr.street, addr.city].filter(Boolean).join(", ")
    : "";

  return (
    <div
      className={`rounded-xl border p-3 transition-colors ${style.bg} ${style.border}`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-dark-elevated text-[10px] font-bold text-muted">
            {order}
          </span>
          <span className="text-xs font-medium text-white">
            {job.job_number}
          </span>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            JOB_TYPE_BADGE[job.job_type] || "bg-zinc-500/10 text-zinc-400"
          }`}
        >
          {job.job_type}
        </span>
      </div>

      {/* Customer */}
      <p className="text-sm font-medium text-foreground truncate">
        {job.customer
          ? `${job.customer.first_name} ${job.customer.last_name}`
          : "—"}
      </p>

      {/* Time */}
      {(job.scheduled_window_start || job.scheduled_window_end) && (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
          <Clock className="h-3 w-3" />
          <span>
            {job.scheduled_window_start &&
              job.scheduled_window_start.slice(0, 5)}
            {job.scheduled_window_end &&
              ` – ${job.scheduled_window_end.slice(0, 5)}`}
          </span>
        </div>
      )}

      {/* Address */}
      {addrStr && (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">{addrStr}</span>
        </div>
      )}

      {/* Status dot */}
      <div className="mt-2 flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
        <span className="text-[10px] font-medium text-muted capitalize">
          {job.status.replace(/_/g, " ")}
        </span>
        {job.asset && (
          <span className="ml-auto text-[10px] text-muted">
            {job.asset.identifier}
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------- Unassigned Card ---------- */

function UnassignedCard({
  job,
  drivers,
  onAssign,
}: {
  job: DispatchJob;
  drivers: Driver[];
  onAssign: (jobId: string, driverId: string) => void;
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const addr = job.service_address;
  const addrStr = addr
    ? [addr.street, addr.city].filter(Boolean).join(", ")
    : "";

  return (
    <div className="rounded-xl border border-red-500/10 bg-dark-card p-3">
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs font-medium text-white">
          {job.job_number}
        </span>
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
            JOB_TYPE_BADGE[job.job_type] || "bg-zinc-500/10 text-zinc-400"
          }`}
        >
          {job.job_type}
        </span>
      </div>

      <p className="text-sm font-medium text-foreground truncate">
        {job.customer
          ? `${job.customer.first_name} ${job.customer.last_name}`
          : "—"}
      </p>

      {(job.scheduled_window_start || job.scheduled_window_end) && (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
          <Clock className="h-3 w-3" />
          <span>
            {job.scheduled_window_start &&
              job.scheduled_window_start.slice(0, 5)}
            {job.scheduled_window_end &&
              ` – ${job.scheduled_window_end.slice(0, 5)}`}
          </span>
        </div>
      )}

      {addrStr && (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">{addrStr}</span>
        </div>
      )}

      {/* Assign button */}
      <div className="relative mt-3">
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand/10 py-1.5 text-xs font-medium text-brand transition-colors hover:bg-brand/20"
        >
          <UserPlus className="h-3 w-3" />
          Assign Driver
        </button>
        {showDropdown && (
          <div className="absolute left-0 right-0 z-20 mt-1 rounded-lg border border-white/10 bg-dark-secondary shadow-xl overflow-hidden">
            {drivers.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted">No drivers</p>
            ) : (
              drivers.map((d) => (
                <button
                  key={d.id}
                  onClick={() => {
                    onAssign(job.id, d.id);
                    setShowDropdown(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-dark-card-hover"
                >
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-brand/10 text-[10px] font-bold text-brand">
                    {d.firstName[0]}
                    {d.lastName[0]}
                  </div>
                  {d.firstName} {d.lastName}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
