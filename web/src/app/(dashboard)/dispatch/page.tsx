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
  Search,
  CheckCircle2,
  AlertTriangle,
  GripVertical,
  RefreshCw,
  Zap,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";

/* ---- Types ---- */

interface DispatchJob {
  id: string;
  job_number: string;
  job_type: string;
  service_type: string;
  status: string;
  priority: string;
  scheduled_window_start: string;
  scheduled_window_end: string;
  service_address: Record<string, string> | null;
  route_order: number | null;
  total_price: number;
  customer: { id: string; first_name: string; last_name: string } | null;
  asset: { id: string; identifier: string; subtype?: string } | null;
  assigned_driver: { id: string; first_name: string; last_name: string } | null;
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

const TYPE_CONFIG: Record<string, { label: string; letter: string; cls: string; border: string }> = {
  delivery: { label: "Drop Off", letter: "D", cls: "bg-blue-500/15 text-blue-400", border: "border-l-blue-500" },
  pickup: { label: "Pick Up", letter: "P", cls: "bg-orange-500/15 text-orange-400", border: "border-l-orange-500" },
  exchange: { label: "Exchange", letter: "E", cls: "bg-purple-500/15 text-purple-400", border: "border-l-purple-500" },
};

const STATUS_BORDER: Record<string, string> = {
  pending: "border-l-zinc-500",
  confirmed: "border-l-blue-500",
  dispatched: "border-l-purple-500",
  en_route: "border-l-yellow-500",
  arrived: "border-l-teal-500",
  in_progress: "border-l-orange-500",
  completed: "border-l-emerald-500",
  cancelled: "border-l-red-500",
};

const FILTER_TABS = [
  { key: "all", label: "All" },
  { key: "delivery", label: "Deliveries" },
  { key: "pickup", label: "Pickups" },
  { key: "exchange", label: "Exchanges" },
  { key: "completed", label: "Completed" },
];

/* ---- Helpers ---- */

function today() { return new Date().toISOString().split("T")[0]; }

function shiftDate(d: string, n: number) {
  const dt = new Date(d + "T00:00:00");
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().split("T")[0];
}

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function fmtTime(t: string | null) {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hr = parseInt(h);
  return `${hr === 0 ? 12 : hr > 12 ? hr - 12 : hr}:${m} ${hr >= 12 ? "PM" : "AM"}`;
}

function jobTitle(job: DispatchJob) {
  const size = job.asset?.identifier || job.service_type?.replace(/_/g, " ") || "";
  const type = TYPE_CONFIG[job.job_type]?.label || job.job_type;
  return `${size} ${type}`.trim();
}

function filterJobs(jobs: DispatchJob[], filter: string, search: string) {
  let filtered = jobs;
  if (filter === "completed") filtered = filtered.filter(j => j.status === "completed");
  else if (filter !== "all") filtered = filtered.filter(j => j.job_type === filter);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(j =>
      j.job_number.toLowerCase().includes(q) ||
      j.customer?.first_name.toLowerCase().includes(q) ||
      j.customer?.last_name.toLowerCase().includes(q) ||
      j.service_address?.street?.toLowerCase().includes(q) ||
      j.service_address?.city?.toLowerCase().includes(q)
    );
  }
  return filtered;
}

/* ---- Page ---- */

export default function DispatchPage() {
  const [date, setDate] = useState(today);
  const [board, setBoard] = useState<DispatchBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [activeJob, setActiveJob] = useState<DispatchJob | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const fetchBoard = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const data = await api.get<DispatchBoard>(`/dispatch/board?date=${date}`);
      setBoard(data);
    } catch { /* */ }
    finally { setLoading(false); setRefreshing(false); }
  }, [date]);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(() => fetchBoard(true), 30000);
    return () => clearInterval(interval);
  }, [fetchBoard]);

  const handleDragStart = (e: DragStartEvent) => {
    const allJobs = [...(board?.unassigned || []), ...(board?.drivers.flatMap(d => d.jobs) || [])];
    setActiveJob(allJobs.find(j => j.id === e.active.id) || null);
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveJob(null);
    const { active, over } = e;
    if (!over || !board) return;

    const jobId = active.id as string;
    const targetId = over.id as string;

    // Determine target driver (or unassigned)
    let targetDriverId: string | null = null;
    if (targetId.startsWith("col-")) {
      targetDriverId = targetId.replace("col-", "");
      if (targetDriverId === "unassigned") targetDriverId = null;
    } else {
      // Dropped on another job — find which column it's in
      for (const col of board.drivers) {
        if (col.jobs.some(j => j.id === targetId)) {
          targetDriverId = col.driver.id;
          break;
        }
      }
      // Check unassigned
      if (board.unassigned.some(j => j.id === targetId)) {
        targetDriverId = null;
      }
    }

    // Find current driver
    const allJobs = [...board.unassigned, ...board.drivers.flatMap(d => d.jobs)];
    const job = allJobs.find(j => j.id === jobId);
    if (!job) return;

    const currentDriverId = job.assigned_driver?.id || null;
    if (currentDriverId === targetDriverId) return; // No change

    try {
      if (targetDriverId) {
        await api.patch(`/jobs/${jobId}/assign`, { assignedDriverId: targetDriverId });
        const driver = board.drivers.find(d => d.driver.id === targetDriverId)?.driver;
        toast("success", `Assigned to ${driver?.firstName || "driver"}`);
      } else {
        await api.patch(`/jobs/${jobId}/assign`, { assignedDriverId: null });
        toast("success", "Unassigned from driver");
      }
      await fetchBoard(true);
    } catch {
      toast("error", "Failed to reassign");
    }
  };

  const totalJobs = board ? board.unassigned.length + board.drivers.reduce((s, d) => s + d.jobs.length, 0) : 0;
  const outstandingJobs = board ? (board.unassigned.length + board.drivers.reduce((s, d) => s + d.jobs.filter(j => j.status !== "completed" && j.status !== "cancelled").length, 0)) : 0;

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col">
      {/* Top bar */}
      <div className="shrink-0 mb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button onClick={() => setDate(d => shiftDate(d, -1))} className="rounded-lg bg-dark-card border border-[#1E2D45] p-2 text-muted hover:text-white active:scale-95 transition-all">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input type="date" value={date} onChange={e => setDate(e.target.value)}
                  className="rounded-lg border border-[#1E2D45] bg-[#111C2E] py-2 pl-10 pr-3 text-sm font-medium text-white outline-none focus:border-brand w-52" />
              </div>
              <button onClick={() => setDate(d => shiftDate(d, 1))} className="rounded-lg bg-dark-card border border-[#1E2D45] p-2 text-muted hover:text-white active:scale-95 transition-all">
                <ChevronRight className="h-4 w-4" />
              </button>
              <button onClick={() => setDate(today())} className={`ml-1 rounded-lg border px-3 py-2 text-xs font-medium transition-all active:scale-95 ${date === today() ? "bg-brand/10 border-brand/20 text-brand" : "bg-dark-card border-[#1E2D45] text-muted hover:text-white"}`}>Today</button>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-sm text-muted">
              <span className="font-medium text-white">{fmtDate(date)}</span>
              <span>·</span>
              <span>{outstandingJobs} outstanding</span>
              <span>·</span>
              <span>{totalJobs} total</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => fetchBoard(true)} disabled={refreshing} className="rounded-lg bg-dark-card border border-[#1E2D45] p-2 text-muted hover:text-white transition-all active:scale-95 disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <button className="flex items-center gap-1.5 rounded-lg bg-brand/10 border border-brand/20 px-3 py-2 text-xs font-semibold text-brand hover:bg-brand/20 transition-all active:scale-95">
              <Zap className="h-3.5 w-3.5" /> Optimize Day
            </button>
          </div>
        </div>

        {/* Filters + search */}
        <div className="flex items-center gap-3 mt-3">
          <div className="flex gap-1">
            {FILTER_TABS.map(t => (
              <button key={t.key} onClick={() => setFilter(t.key)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${filter === t.key ? "bg-brand text-dark-primary" : "bg-dark-card text-muted hover:text-white"}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search jobs or locations..."
              className="w-full rounded-lg bg-[#111C2E] border border-[#1E2D45] py-1.5 pl-9 pr-3 text-xs text-white placeholder-muted outline-none focus:border-brand" />
          </div>
        </div>
      </div>

      {/* Main content: board + map placeholder */}
      <div className="flex flex-1 gap-3 min-h-0">
        {/* Board (60%) */}
        <div className="flex-[3] min-w-0 overflow-hidden">
          {loading ? (
            <div className="flex h-full gap-3 overflow-x-auto pb-2">
              {[1,2,3,4].map(i => (
                <div key={i} className="w-64 shrink-0 space-y-2">
                  <div className="h-16 skeleton rounded-xl" />
                  {[1,2,3].map(j => <div key={j} className="h-24 skeleton rounded-lg" />)}
                </div>
              ))}
            </div>
          ) : !board ? (
            <div className="flex h-full items-center justify-center text-muted">Failed to load</div>
          ) : totalJobs === 0 && board.drivers.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center">
              <Truck className="h-14 w-14 text-muted/15 mb-3" />
              <h2 className="font-display text-base font-semibold text-white">No jobs for {fmtDate(date)}</h2>
              <p className="mt-1 text-xs text-muted">Schedule some deliveries!</p>
              <Link href="/" className="mt-3 flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-dark-primary hover:bg-brand-light active:scale-95 transition-all">
                <Plus className="h-3.5 w-3.5" /> New Job
              </Link>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
              <div className="flex h-full gap-2.5 overflow-x-auto pb-2">
                {/* Unassigned */}
                <Column
                  id="unassigned"
                  title="Unassigned"
                  icon={<UserPlus className="h-3.5 w-3.5 text-red-400" />}
                  count={board.unassigned.length}
                  accentCls="bg-red-500/10 text-red-400"
                  jobs={filterJobs(board.unassigned, filter, search)}
                  drivers={board.drivers.map(d => d.driver)}
                  onAssign={async (jobId, driverId) => {
                    try {
                      await api.patch(`/jobs/${jobId}/assign`, { assignedDriverId: driverId });
                      const driver = board.drivers.find(d => d.driver.id === driverId)?.driver;
                      toast("success", `Assigned to ${driver?.firstName}`);
                      await fetchBoard(true);
                    } catch { toast("error", "Failed to assign"); }
                  }}
                />
                {/* Driver columns */}
                {board.drivers.map(col => {
                  const completed = col.jobs.filter(j => j.status === "completed").length;
                  return (
                    <Column
                      key={col.driver.id}
                      id={col.driver.id}
                      title={`${col.driver.firstName} ${col.driver.lastName}`}
                      icon={
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/15 text-[10px] font-bold text-brand">
                          {col.driver.firstName[0]}{col.driver.lastName[0]}
                        </div>
                      }
                      count={col.jobs.length}
                      progress={col.jobs.length > 0 ? { completed, total: col.jobs.length } : undefined}
                      phone={col.driver.phone}
                      jobs={filterJobs(col.jobs, filter, search)}
                    />
                  );
                })}
                {board.drivers.length === 0 && board.unassigned.length > 0 && (
                  <div className="flex w-56 shrink-0 flex-col items-center justify-center rounded-xl bg-[#111C2E] border border-dashed border-[#1E2D45] p-4">
                    <Truck className="h-8 w-8 text-muted/15 mb-2" />
                    <p className="text-xs text-muted text-center">Add drivers in Settings &gt; Team</p>
                  </div>
                )}
              </div>
              <DragOverlay>
                {activeJob && <JobCardContent job={activeJob} isDragging />}
              </DragOverlay>
            </DndContext>
          )}
        </div>

        {/* Map placeholder (40%) */}
        <div className="hidden lg:flex flex-[2] rounded-xl bg-[#111C2E] border border-[#1E2D45] items-center justify-center">
          <div className="text-center">
            <MapPin className="mx-auto h-10 w-10 text-muted/15 mb-2" />
            <p className="text-sm font-medium text-muted">Map View</p>
            <p className="text-xs text-muted/60 mt-1">Coming soon</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Column ---- */

function Column({ id, title, icon, count, accentCls, progress, phone, jobs, drivers, onAssign }: {
  id: string;
  title: string;
  icon: React.ReactNode;
  count: number;
  accentCls?: string;
  progress?: { completed: number; total: number };
  phone?: string;
  jobs: DispatchJob[];
  drivers?: Driver[];
  onAssign?: (jobId: string, driverId: string) => void;
}) {
  const { setNodeRef, isOver } = useSortable({ id: `col-${id}`, disabled: true });

  return (
    <div
      ref={setNodeRef}
      className={`flex w-64 shrink-0 flex-col rounded-xl bg-[#111C2E] transition-all ${isOver ? "ring-2 ring-brand/40" : ""}`}
    >
      <div className="px-3 py-2.5 border-b border-[#1E2D45]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {typeof icon === "object" && "type" in (icon as object) ? (
              <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${accentCls || "bg-dark-elevated"}`}>{icon}</div>
            ) : icon}
            <div>
              <p className="text-xs font-semibold text-white truncate max-w-[120px]">{title}</p>
              {phone && <a href={`tel:${phone}`} className="text-[10px] text-muted hover:text-brand"><Phone className="inline h-2 w-2 mr-0.5" />{phone}</a>}
            </div>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${accentCls || "bg-dark-elevated text-foreground"}`}>{count}</span>
        </div>
        {progress && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1 flex-1 rounded-full bg-dark-elevated overflow-hidden">
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(progress.completed / progress.total) * 100}%` }} />
            </div>
            <span className="text-[9px] text-muted tabular-nums">{progress.completed}/{progress.total}</span>
          </div>
        )}
      </div>
      <SortableContext items={jobs.map(j => j.id)} strategy={verticalListSortingStrategy}>
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5" data-column={id}>
          {jobs.length === 0 ? (
            <div className="py-8 text-center">
              <Box className="mx-auto h-6 w-6 text-muted/15 mb-1" />
              <p className="text-[10px] text-muted">{id === "unassigned" ? "All assigned" : "No jobs"}</p>
            </div>
          ) : (
            jobs.map((job, i) => (
              <SortableJobCard key={job.id} job={job} order={i + 1} drivers={drivers} onAssign={onAssign} />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}

/* ---- Sortable Job Card ---- */

function SortableJobCard({ job, order, drivers, onAssign }: {
  job: DispatchJob; order: number; drivers?: Driver[];
  onAssign?: (jobId: string, driverId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: job.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 };
  const [showDrivers, setShowDrivers] = useState(false);

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div className="relative">
        <div {...listeners} className="absolute left-1 top-1/2 -translate-y-1/2 cursor-grab p-1 text-muted/30 hover:text-muted active:cursor-grabbing z-10">
          <GripVertical className="h-3 w-3" />
        </div>
        <Link href={`/jobs/${job.id}`} className="block">
          <JobCardContent job={job} order={order} />
        </Link>
        {drivers && onAssign && !job.assigned_driver && (
          <div className="px-2.5 pb-2.5">
            <button onClick={(e) => { e.preventDefault(); setShowDrivers(!showDrivers); }}
              className="flex w-full items-center justify-center gap-1 rounded bg-brand/10 border border-brand/20 py-1.5 text-[10px] font-semibold text-brand hover:bg-brand/20 transition-all active:scale-[0.98]">
              <UserPlus className="h-3 w-3" /> Assign
            </button>
            {showDrivers && (
              <div className="absolute left-2 right-2 z-30 mt-1 rounded-lg border border-[#1E2D45] bg-dark-secondary shadow-xl overflow-hidden">
                {drivers.map(d => (
                  <button key={d.id} onClick={(e) => { e.preventDefault(); onAssign(job.id, d.id); setShowDrivers(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-dark-card-hover">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-brand/10 text-[8px] font-bold text-brand">{d.firstName[0]}{d.lastName[0]}</div>
                    {d.firstName} {d.lastName}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- Job Card Content ---- */

function JobCardContent({ job, order, isDragging }: { job: DispatchJob; order?: number; isDragging?: boolean }) {
  const isCompleted = job.status === "completed";
  const tc = TYPE_CONFIG[job.job_type] || { label: job.job_type, letter: "?", cls: "bg-zinc-500/10 text-zinc-400", border: "border-l-zinc-500" };
  const statusBorder = STATUS_BORDER[job.status] || "border-l-zinc-500";
  const addr = job.service_address;
  const addrStr = addr ? [addr.street, addr.city, addr.state].filter(Boolean).join(", ") : "";

  return (
    <div className={`rounded-lg bg-[#162033] border border-[#1E2D45] border-l-[3px] ${statusBorder} p-2.5 pl-7 transition-all ${isDragging ? "shadow-xl shadow-black/30 ring-2 ring-brand/30 scale-105" : "hover:border-[#2ECC71]/20"} ${isCompleted ? "opacity-60" : ""}`}>
      {/* Title row */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {order && (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-dark-elevated text-[9px] font-bold text-muted tabular-nums">{order}</span>
          )}
          <span className={`shrink-0 flex h-5 w-5 items-center justify-center rounded text-[9px] font-bold ${tc.cls}`}>{tc.letter}</span>
          <span className="text-xs font-semibold text-white truncate">{jobTitle(job)}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {job.priority === "high" && <span className="rounded bg-red-500/15 px-1 py-0.5 text-[8px] font-bold text-red-400">H</span>}
          {isCompleted && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
        </div>
      </div>

      {/* Customer */}
      <p className="text-[11px] font-medium text-foreground truncate">
        {job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : job.job_number}
      </p>

      {/* Address */}
      {addrStr && (
        <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted truncate">
          <MapPin className="h-2.5 w-2.5 shrink-0" />{addrStr}
        </p>
      )}

      {/* Time */}
      {(job.scheduled_window_start || job.scheduled_window_end) && (
        <p className="mt-1 flex items-center gap-1 text-[10px] text-muted">
          <Clock className="h-2.5 w-2.5" />
          {fmtTime(job.scheduled_window_start)}{job.scheduled_window_end && ` – ${fmtTime(job.scheduled_window_end)}`}
        </p>
      )}
    </div>
  );
}
