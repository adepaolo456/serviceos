"use client";

import { useState, useEffect, useCallback, memo } from "react";
import Link from "next/link";
import {
  ChevronLeft, ChevronRight, Calendar, Clock, MapPin, UserPlus, Truck,
  Phone, Plus, Box, Search, CheckCircle2, RefreshCw, Zap, X, ExternalLink,
  ChevronDown, ChevronUp, Navigation, Mail, GripVertical,
} from "lucide-react";
import {
  DndContext, closestCenter, DragOverlay, useSensor, useSensors, PointerSensor,
  DragStartEvent, DragEndEvent, DragOverEvent, useDroppable,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "@/lib/api";
import { formatPhone } from "@/lib/utils";
import { useToast } from "@/components/toast";
import QuickView, { QuickViewSkeleton } from "@/components/quick-view";
import Dropdown from "@/components/dropdown";

/* ---- Types ---- */

interface DispatchJob {
  id: string; job_number: string; job_type: string; service_type: string;
  status: string; priority: string; scheduled_window_start: string;
  scheduled_window_end: string; service_address: Record<string, string> | null;
  route_order: number | null; total_price: number;
  placement_notes?: string;
  customer: { id: string; first_name: string; last_name: string; phone?: string; email?: string } | null;
  asset: { id: string; identifier: string; subtype?: string } | null;
  assigned_driver: { id: string; first_name: string; last_name: string } | null;
  is_overdue?: boolean; extra_days?: number;
  rescheduled_by_customer?: boolean; rescheduled_from_date?: string;
  is_failed_trip?: boolean; failed_reason?: string; source?: string;
}

interface Driver { id: string; firstName: string; lastName: string; phone: string; vehicleInfo?: { year?: string; make?: string; model?: string } | null; }

interface DriverColumn {
  driver: Driver;
  route: { id: string; status: string; total_stops: number } | null;
  jobs: DispatchJob[]; jobCount: number;
}

interface DispatchBoard { date: string; drivers: DriverColumn[]; unassigned: DispatchJob[]; }

/* ---- Constants ---- */

const TYPE_CONFIG: Record<string, { label: string; letter: string; color: string; stripe: string }> = {
  delivery: { label: "Drop Off", letter: "D", color: "var(--t-accent)", stripe: "#22C55E" },
  pickup: { label: "Pick Up", letter: "P", color: "var(--t-warning)", stripe: "#D97706" },
  exchange: { label: "Exchange", letter: "E", color: "#a78bfa", stripe: "#a78bfa" },
  dump_run: { label: "Dump Run", letter: "DR", color: "#F87171", stripe: "#DC2626" },
};

const FILTER_TABS = [
  { key: "all", label: "All" }, { key: "delivery", label: "Deliveries" },
  { key: "pickup", label: "Pickups" }, { key: "exchange", label: "Exchanges" },
  { key: "dump_run", label: "Dump Runs" }, { key: "completed", label: "Completed" },
];

/* ---- Helpers ---- */

function today() { return new Date().toISOString().split("T")[0]; }
function shiftDate(d: string, n: number) { const dt = new Date(d + "T00:00:00"); dt.setDate(dt.getDate() + n); return dt.toISOString().split("T")[0]; }
function fmtDate(d: string) { return new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }); }
function fmtTime(t: string | null) { if (!t) return ""; const [h, m] = t.split(":"); const hr = parseInt(h); return `${hr === 0 ? 12 : hr > 12 ? hr - 12 : hr}:${m} ${hr >= 12 ? "PM" : "AM"}`; }

function filterJobs(jobs: DispatchJob[], filter: string, search: string) {
  let filtered = jobs;
  if (filter === "completed") filtered = filtered.filter(j => j.status === "completed");
  else if (filter !== "all") filtered = filtered.filter(j => j.job_type === filter);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(j =>
      j.job_number.toLowerCase().includes(q) || j.customer?.first_name.toLowerCase().includes(q) ||
      j.customer?.last_name.toLowerCase().includes(q) || j.service_address?.street?.toLowerCase().includes(q) ||
      j.service_address?.city?.toLowerCase().includes(q) || j.asset?.identifier?.toLowerCase().includes(q));
  }
  return filtered;
}

/* ======== Page ======== */

export default function DispatchPage() {
  const [date, setDate] = useState(today);
  const [board, setBoard] = useState<DispatchBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [quickViewJob, setQuickViewJob] = useState<DispatchJob | null>(null);
  const [qvDetail, setQvDetail] = useState<any>(null);
  const [qvLoading, setQvLoading] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const { toast } = useToast();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const fetchBoard = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try { setBoard(await api.get<DispatchBoard>(`/dispatch/board?date=${date}`)); }
    catch { /* */ } finally { setLoading(false); setRefreshing(false); }
  }, [date]);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);
  useEffect(() => { const i = setInterval(() => fetchBoard(true), 30000); return () => clearInterval(i); }, [fetchBoard]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") setQuickViewJob(null);
      else if (e.key === "ArrowLeft") setDate(d => shiftDate(d, -1));
      else if (e.key === "ArrowRight") setDate(d => shiftDate(d, 1));
      else if (e.key === "t" || e.key === "T") setDate(today());
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  /* ---- All jobs flat ---- */
  const allJobs = board ? [...board.unassigned, ...board.drivers.flatMap(d => d.jobs)] : [];

  const findColumnForJob = (jobId: string): string => {
    if (!board) return "unassigned";
    if (board.unassigned.some(j => j.id === jobId)) return "unassigned";
    for (const col of board.drivers) { if (col.jobs.some(j => j.id === jobId)) return col.driver.id; }
    return "unassigned";
  };

  /* ---- DnD handlers ---- */
  const handleDragStart = (event: DragStartEvent) => { setActiveId(event.active.id as string); };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || !board) return;

    const activeJobId = active.id as string;
    const overId = over.id as string;
    const sourceCol = findColumnForJob(activeJobId);

    // Determine target column: if dropped on a column droppable or a job in that column
    let targetCol = overId;
    if (!["unassigned", ...board.drivers.map(d => d.driver.id)].includes(overId)) {
      // Dropped on a job card — find which column it belongs to
      targetCol = findColumnForJob(overId);
    }

    if (sourceCol === targetCol) {
      // Reorder within the same column
      const colJobs = targetCol === "unassigned"
        ? [...board.unassigned]
        : [...(board.drivers.find(d => d.driver.id === targetCol)?.jobs || [])];

      const oldIndex = colJobs.findIndex(j => j.id === activeJobId);
      const newIndex = colJobs.findIndex(j => j.id === overId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      const reordered = arrayMove(colJobs, oldIndex, newIndex);

      // Optimistic update
      setBoard(prev => {
        if (!prev) return prev;
        if (targetCol === "unassigned") return { ...prev, unassigned: reordered };
        return { ...prev, drivers: prev.drivers.map(d => d.driver.id === targetCol ? { ...d, jobs: reordered } : d) };
      });

      // Persist
      try {
        await api.patch("/jobs/bulk-reorder", { jobIds: reordered.map(j => j.id) });
      } catch { fetchBoard(true); }
    } else {
      // Move between columns
      const targetDriverId = targetCol === "unassigned" ? null : targetCol;
      try {
        await api.patch(`/jobs/${activeJobId}/assign`, { assignedDriverId: targetDriverId });
        const driverName = targetDriverId ? board.drivers.find(d => d.driver.id === targetDriverId)?.driver : null;
        toast("success", targetDriverId ? `Moved to ${driverName?.firstName}'s route` : "Moved to Unassigned");
        await fetchBoard(true);
      } catch (err) {
        toast("error", err instanceof Error ? err.message : "Failed to move job");
        fetchBoard(true);
      }
    }
  };

  /* ---- Computed ---- */
  const totalJobs = board ? board.unassigned.length + board.drivers.reduce((s, d) => s + d.jobs.length, 0) : 0;
  const driverCount = board?.drivers.length || 0;
  const unassignedCount = board?.unassigned.length || 0;
  const completedJobs = allJobs.filter(j => j.status === "completed").length;
  const activeJob = activeId ? allJobs.find(j => j.id === activeId) : null;

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col">
      {/* Top bar */}
      <div className="shrink-0 mb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button onClick={() => setDate(d => shiftDate(d, -1))}
                className="p-2 rounded-[20px] border transition-all duration-150"
                style={{ background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.08)", color: "var(--t-frame-text-muted)" }}
                onMouseEnter={e => { e.currentTarget.style.color = "var(--t-frame-text)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "var(--t-frame-text-muted)"; }}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--t-frame-text-muted)" }} />
                <input type="date" value={date} onChange={e => setDate(e.target.value)}
                  className="rounded-[20px] py-2 pl-10 pr-3 text-sm font-medium outline-none w-52 transition-all duration-150"
                  style={{ background: "rgba(255,255,255,0.06)", borderWidth: 1, borderStyle: "solid", borderColor: "rgba(255,255,255,0.08)", color: "var(--t-frame-text)" }} />
              </div>
              <button onClick={() => setDate(d => shiftDate(d, 1))}
                className="p-2 rounded-[20px] border transition-all duration-150"
                style={{ background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.08)", color: "var(--t-frame-text-muted)" }}
                onMouseEnter={e => { e.currentTarget.style.color = "var(--t-frame-text)"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "var(--t-frame-text-muted)"; }}>
                <ChevronRight className="h-4 w-4" />
              </button>
              <button onClick={() => setDate(today())}
                className="ml-1 rounded-full px-3 py-2 text-xs font-medium transition-all duration-150 border"
                style={{
                  background: date === today() ? "var(--t-accent-soft)" : "rgba(255,255,255,0.06)",
                  borderColor: date === today() ? "var(--t-accent)" : "rgba(255,255,255,0.08)",
                  color: date === today() ? "var(--t-accent)" : "var(--t-frame-text-muted)",
                }}>
                Today
              </button>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-sm" style={{ color: "var(--t-frame-text-muted)" }}>
              <span className="font-medium" style={{ color: "var(--t-frame-text)" }}>{fmtDate(date)}</span>
              <span>·</span><span>{totalJobs} jobs</span><span>·</span><span>{driverCount} drivers</span>
              {unassignedCount > 0 && <><span>·</span><span className="font-medium" style={{ color: "var(--t-warning)" }}>{unassignedCount} unassigned</span></>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => fetchBoard(true)} disabled={refreshing}
              className="p-2 rounded-[20px] border transition-all duration-150 disabled:opacity-50"
              style={{ background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.08)", color: "var(--t-frame-text-muted)" }}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <button className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-all duration-150 active:scale-95"
              style={{ background: "var(--t-accent)", color: "#000" }}>
              <Zap className="h-3.5 w-3.5" /> Optimize Routes
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-3">
          <div className="flex gap-1">
            {FILTER_TABS.map(t => (
              <button key={t.key} onClick={() => setFilter(t.key)}
                className="rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150"
                style={{
                  background: filter === t.key ? "var(--t-accent-soft)" : "rgba(255,255,255,0.06)",
                  color: filter === t.key ? "var(--t-accent)" : "var(--t-frame-text-muted)",
                }}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "var(--t-frame-text-muted)" }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search jobs..."
              className="w-full rounded-[20px] py-1.5 pl-9 pr-3 text-xs outline-none transition-all duration-150"
              style={{ background: "rgba(255,255,255,0.06)", borderWidth: 1, borderStyle: "solid", borderColor: "rgba(255,255,255,0.08)", color: "var(--t-frame-text)" }} />
          </div>
        </div>
      </div>

      {/* Board with DnD */}
      <DndContext sensors={sensors} collisionDetection={closestCenter}
        onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex flex-1 gap-3 min-h-0">
          <div className="flex-1 min-w-0 overflow-hidden">
            {loading ? (
              <div className="flex h-full gap-3 overflow-x-auto pb-2">
                {[1,2,3,4].map(i => (<div key={i} className="w-[300px] shrink-0 space-y-2"><div className="h-20 skeleton rounded-t-[20px]" />{[1,2,3].map(j => <div key={j} className="h-24 skeleton rounded-[16px]" />)}</div>))}
              </div>
            ) : !board ? (
              <div className="flex h-full items-center justify-center" style={{ color: "var(--t-frame-text-muted)" }}>Failed to load</div>
            ) : totalJobs === 0 && board.drivers.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center">
                <Truck className="h-14 w-14 mb-3" style={{ color: "var(--t-frame-text-muted)", opacity: 0.15 }} />
                <h2 className="text-base font-semibold" style={{ color: "var(--t-frame-text)" }}>No jobs for {fmtDate(date)}</h2>
                <p className="mt-1 text-xs" style={{ color: "var(--t-frame-text-muted)" }}>Schedule some deliveries!</p>
                <Link href="/" className="mt-3 flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold active:scale-95 transition-all duration-150"
                  style={{ background: "var(--t-accent)", color: "#000" }}>
                  <Plus className="h-3.5 w-3.5" /> New Job
                </Link>
              </div>
            ) : (
              <div className="flex h-full gap-3 overflow-x-auto pb-2">
                {/* Unassigned */}
                <DriverColumnComponent
                  columnId="unassigned" title="Unassigned" isUnassigned
                  count={board.unassigned.length}
                  jobs={filterJobs(board.unassigned, filter, search)}
                  drivers={board.drivers.map(d => d.driver)}
                  onAssign={async (jid, did) => {
                    try { await api.patch(`/jobs/${jid}/assign`, { assignedDriverId: did }); toast("success", "Assigned"); await fetchBoard(true); }
                    catch { toast("error", "Failed"); }
                  }}
                  onQuickView={(j) => { setQuickViewJob(j); setQvLoading(true); setQvDetail(null); api.get(`/jobs/${j.id}`).then(setQvDetail).catch(() => {}).finally(() => setQvLoading(false)); }}
                  activeId={activeId}
                />
                {/* Driver columns */}
                {board.drivers.map(col => (
                  <DriverColumnComponent key={col.driver.id}
                    columnId={col.driver.id} title={`${col.driver.firstName} ${col.driver.lastName}`}
                    driver={col.driver}
                    count={col.jobs.length}
                    progress={{ completed: col.jobs.filter(j => j.status === "completed").length, total: col.jobs.length }}
                    jobs={filterJobs(col.jobs, filter, search)}
                    onUnassign={async (jid) => {
                      try { await api.patch(`/jobs/${jid}/assign`, { assignedDriverId: null }); toast("success", "Unassigned"); await fetchBoard(true); }
                      catch { toast("error", "Failed"); }
                    }}
                    onQuickView={(j) => { setQuickViewJob(j); setQvLoading(true); setQvDetail(null); api.get(`/jobs/${j.id}`).then(setQvDetail).catch(() => {}).finally(() => setQvLoading(false)); }}
                    activeId={activeId}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Drag overlay */}
        <DragOverlay>
          {activeJob ? <JobTileOverlay job={activeJob} /> : null}
        </DragOverlay>
      </DndContext>

      {/* Bottom Bar */}
      {!loading && board && totalJobs > 0 && (
        <div className="shrink-0 mt-3 flex items-center justify-between px-5 py-3"
          style={{ borderTop: "1px solid var(--t-frame-border)" }}>
          <div className="flex items-center gap-5 text-xs" style={{ color: "var(--t-frame-text-muted)" }}>
            <span><span className="font-semibold" style={{ color: "var(--t-frame-text)" }}>{totalJobs - completedJobs}</span> stops remaining</span>
            <span><span className="font-semibold" style={{ color: "var(--t-frame-text)" }}>{completedJobs}</span> completed</span>
            <span><span className="font-semibold" style={{ color: "var(--t-frame-text)" }}>{driverCount}</span> active drivers</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-150"
              style={{ borderColor: "var(--t-frame-border)", color: "var(--t-frame-text-muted)", background: "transparent" }}>
              Print Route Sheets
            </button>
            <button className="rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-150"
              style={{ background: "var(--t-accent-soft)", borderColor: "var(--t-accent)", color: "var(--t-accent)" }}>
              Send Routes to Drivers
            </button>
          </div>
        </div>
      )}

      {/* QuickView Panel */}
      <QuickView isOpen={!!quickViewJob} onClose={() => { setQuickViewJob(null); setQvDetail(null); }}
        title={quickViewJob ? `${quickViewJob.asset?.subtype || ""} ${TYPE_CONFIG[quickViewJob.job_type]?.label || quickViewJob.job_type}`.trim() : ""}
        subtitle={quickViewJob?.job_number}
        actions={quickViewJob ? <Link href={`/jobs/${quickViewJob.id}`} className="rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150" style={{ background: "var(--t-bg-card-hover)", color: "var(--t-text-primary)" }}><ExternalLink className="h-3 w-3 inline mr-1" />Full Detail</Link> : undefined}
        footer={quickViewJob ? (
          <div className="flex gap-2">
            {quickViewJob.customer?.phone && (
              <a href={`tel:${quickViewJob.customer.phone}`}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-semibold"
                style={{ background: "var(--t-accent)", color: "#000" }}>
                <Phone className="h-3.5 w-3.5" /> Call Customer
              </a>
            )}
            {quickViewJob.service_address && (
              <button onClick={() => { const a = quickViewJob.service_address!; const q = [a.street, a.city, a.state].filter(Boolean).join(", "); window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`, "_blank"); }}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-semibold border"
                style={{ background: "transparent", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}>
                <Navigation className="h-3.5 w-3.5" /> Navigate
              </button>
            )}
          </div>
        ) : undefined}
      >
        {quickViewJob && qvLoading ? <QuickViewSkeleton /> : quickViewJob && qvDetail ? (
          <JobQuickViewContent job={quickViewJob} detail={qvDetail} board={board} onAssign={async (jid, did) => {
            try { await api.patch(`/jobs/${jid}/assign`, { assignedDriverId: did }); toast("success", "Reassigned"); await fetchBoard(true); }
            catch { toast("error", "Failed"); }
          }} onRefresh={() => fetchBoard(true)} toast={toast} />
        ) : null}
      </QuickView>
    </div>
  );
}

/* ======== Driver Column ======== */

function DriverColumnComponent({ columnId, title, driver, isUnassigned, count, progress, jobs, drivers, onAssign, onUnassign, onQuickView, activeId }: {
  columnId: string; title: string; driver?: Driver; isUnassigned?: boolean;
  count: number; progress?: { completed: number; total: number };
  jobs: DispatchJob[]; drivers?: Driver[];
  onAssign?: (jobId: string, driverId: string | null) => void;
  onUnassign?: (jobId: string) => void;
  onQuickView: (job: DispatchJob) => void;
  activeId: string | null;
}) {
  const storageKey = `dispatch-col-${columnId}`;
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && localStorage.getItem(storageKey) === "1");
  const toggleCollapse = () => { const n = !collapsed; setCollapsed(n); localStorage.setItem(storageKey, n ? "1" : "0"); };

  const { setNodeRef, isOver } = useDroppable({ id: columnId });

  const vehicleStr = driver?.vehicleInfo ? [driver.vehicleInfo.year, driver.vehicleInfo.make, driver.vehicleInfo.model].filter(Boolean).join(" ") : null;

  if (collapsed) {
    return (
      <div onClick={toggleCollapse}
        className="flex w-[60px] shrink-0 cursor-pointer flex-col items-center rounded-[20px] py-3 transition-all duration-150"
        style={{ background: "#111111", border: "1px solid #1E1E1E" }}>
        <ChevronDown className="h-3.5 w-3.5 mb-2" style={{ color: "var(--t-frame-text-muted)" }} />
        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums"
          style={{ background: "rgba(255,255,255,0.08)", color: "var(--t-frame-text)" }}>{count}</span>
        <p className="mt-2 text-[9px] font-medium" style={{ writingMode: "vertical-lr", color: "var(--t-frame-text-muted)" }}>{title}</p>
      </div>
    );
  }

  return (
    <div ref={setNodeRef}
      className="flex shrink-0 flex-col rounded-[20px] overflow-hidden transition-all duration-200"
      style={{
        width: 300, minWidth: 300,
        border: isOver && activeId ? "2px dashed var(--t-accent)" : "1px solid #1E1E1E",
        background: "#0A0A0A",
      }}>
      {/* Dark header */}
      <div className="px-3.5 py-3 shrink-0" style={{ background: isUnassigned ? "#1A1400" : "#111111" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            {isUnassigned ? (
              <div className="flex h-8 w-8 items-center justify-center rounded-full shrink-0"
                style={{ background: "rgba(217,119,6,0.15)", color: "var(--t-warning)" }}>
                <UserPlus className="h-4 w-4" />
              </div>
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold shrink-0"
                style={{ background: "var(--t-accent-soft)", color: "var(--t-accent)" }}>
                {title.split(" ").map(n => n[0]).join("")}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-bold truncate" style={{ color: isUnassigned ? "var(--t-warning)" : "var(--t-frame-text)" }}>{title}</p>
              {vehicleStr && <p className="text-[10px] truncate" style={{ color: "var(--t-frame-text-muted)" }}>{vehicleStr}</p>}
              {driver?.phone && <p className="text-[10px]" style={{ color: "var(--t-frame-text-muted)" }}><Phone className="inline h-2.5 w-2.5 mr-0.5" />{formatPhone(driver.phone)}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="rounded-full px-2.5 py-1 text-[10px] font-bold tabular-nums"
              style={{ background: "rgba(255,255,255,0.08)", color: "var(--t-frame-text)" }}>{count}</span>
            <button onClick={toggleCollapse} className="p-1 transition-all duration-150" style={{ color: "var(--t-frame-text-muted)" }}>
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {progress && progress.total > 0 && (
          <div className="mt-2.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
              <div className="h-full rounded-full transition-all duration-300" style={{ width: `${(progress.completed / progress.total) * 100}%`, background: "var(--t-accent)" }} />
            </div>
            <span className="text-[10px] tabular-nums font-medium" style={{ color: "var(--t-frame-text-muted)" }}>{progress.completed}/{progress.total}</span>
          </div>
        )}
      </div>

      {/* Job cards area — dark body with white cards */}
      <SortableContext items={jobs.map(j => j.id)} strategy={verticalListSortingStrategy}>
        <div className="flex-1 overflow-y-auto p-2 space-y-2 max-h-[calc(100vh-300px)]" style={{ minHeight: 120 }}>
          {jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10">
              {isUnassigned
                ? <><CheckCircle2 className="h-6 w-6 mb-1.5" style={{ color: "var(--t-accent)", opacity: 0.4 }} /><p className="text-[10px]" style={{ color: "var(--t-accent)" }}>All jobs assigned</p></>
                : <><Box className="h-6 w-6 mb-1.5" style={{ color: "var(--t-frame-text-muted)", opacity: 0.15 }} /><p className="text-[10px]" style={{ color: "var(--t-frame-text-muted)" }}>No jobs</p></>}
            </div>
          ) : jobs.map(job => (
            <SortableJobTile key={job.id} job={job}
              isUnassigned={!!isUnassigned} drivers={drivers}
              onAssign={onAssign} onUnassign={onUnassign}
              onQuickView={() => onQuickView(job)} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

/* ======== Sortable Job Tile ======== */

const SortableJobTile = memo(function SortableJobTile({ job, isUnassigned, drivers, onAssign, onUnassign, onQuickView }: {
  job: DispatchJob; isUnassigned: boolean; drivers?: Driver[];
  onAssign?: (jobId: string, driverId: string | null) => void;
  onUnassign?: (jobId: string) => void;
  onQuickView: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: job.id });
  const [expanded, setExpanded] = useState(false);
  const isCompleted = job.status === "completed";
  const tc = TYPE_CONFIG[job.job_type] || { label: job.job_type, letter: "?", color: "var(--t-text-muted)", stripe: "#8A8A8A" };
  const addr = job.service_address;
  const addrStr = addr ? [addr.street, addr.city].filter(Boolean).join(", ") : "";
  const size = job.asset?.subtype || "";

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : isCompleted ? 0.45 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}
      className="group relative rounded-[16px] border bg-white transition-all duration-150"
      {...(!isDragging ? {} : {})}
    >
      {/* Left color stripe */}
      <div className="absolute left-0 top-3 bottom-3 w-[4px] rounded-full" style={{ background: tc.stripe }} />

      <div className="pl-4 pr-3 py-3">
        {/* Row 1: Size badge + Customer + Status + Expand */}
        <div className="flex items-center gap-2">
          {/* Drag handle */}
          <button {...listeners} className="shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-40 hover:!opacity-100 transition-opacity -ml-1 mr-0.5"
            style={{ color: "#999", touchAction: "none" }}>
            <GripVertical className="h-4 w-4" />
          </button>

          {/* Size badge */}
          {size && (
            <span className="shrink-0 rounded-md px-2 py-0.5 text-[13px] font-bold"
              style={{ background: "#F0F0F0", border: "1px solid #E0E0E0", color: "#0A0A0A" }}>
              {size}
            </span>
          )}

          {/* Type circle */}
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
            style={{ background: tc.stripe }}>
            {tc.letter}
          </span>

          {/* Customer name */}
          <span className="text-[13px] font-semibold truncate flex-1" style={{ color: "#0A0A0A" }}>
            {job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : job.job_number}
          </span>

          {/* Status */}
          <span className="text-[10px] font-semibold capitalize shrink-0" style={{
            color: isCompleted ? "#16A34A" : job.status === "confirmed" ? "#22C55E" : job.status === "pending" ? "#D97706" : job.status === "en_route" ? "#3B82F6" : "#5C5C5C",
          }}>
            {isCompleted && <CheckCircle2 className="inline h-3 w-3 mr-0.5" />}
            {job.status.replace(/_/g, " ")}
          </span>

          {/* Expand chevron */}
          <button onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="shrink-0 p-0.5 transition-all duration-150" style={{ color: "#999" }}>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Row 2: Address + Time */}
        <div className="flex items-center justify-between mt-1.5 ml-7">
          {addrStr && <p className="flex items-center gap-1 text-[11px] truncate flex-1" style={{ color: "#5C5C5C" }}><MapPin className="h-2.5 w-2.5 shrink-0" />{addrStr}</p>}
          {(job.scheduled_window_start || job.scheduled_window_end) && (
            <p className="flex items-center gap-1 text-[11px] shrink-0 ml-2" style={{ color: "#8A8A8A" }}>
              <Clock className="h-2.5 w-2.5" />{fmtTime(job.scheduled_window_start)}{job.scheduled_window_end ? ` - ${fmtTime(job.scheduled_window_end)}` : ""}
            </p>
          )}
        </div>

        {/* Badges row */}
        {(job.is_failed_trip || job.source === "rescheduled_from_failure" || job.is_overdue || job.asset?.identifier) && (
          <div className="flex items-center gap-1.5 mt-1.5 ml-7 flex-wrap">
            {job.is_failed_trip && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(220,38,38,0.08)", color: "#DC2626" }}>FAILED</span>}
            {job.source === "rescheduled_from_failure" && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(217,119,6,0.08)", color: "#D97706" }}>FROM FAILED</span>}
            {job.is_overdue && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(220,38,38,0.08)", color: "#DC2626" }}>OVERDUE {job.extra_days}d</span>}
            {job.asset?.identifier && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(34,197,94,0.08)", color: "#22C55E" }}>{job.asset.identifier}</span>}
          </div>
        )}

        {/* Expanded details */}
        {expanded && (
          <div className="mt-3 pt-3 ml-7 space-y-2" style={{ borderTop: "1px solid #F0F0F0" }}>
            <div className="flex items-center gap-3 text-[11px]" style={{ color: "#5C5C5C" }}>
              <span>{job.job_number}</span>
              {job.asset?.identifier && <span className="font-semibold" style={{ color: "#22C55E" }}>{job.asset.identifier}</span>}
            </div>
            {job.placement_notes && (
              <div className="rounded-lg px-2.5 py-1.5 text-[11px]" style={{ background: "#FFFBEB", color: "#92400E" }}>
                {job.placement_notes}
              </div>
            )}
            {job.failed_reason && (
              <div className="rounded-lg px-2.5 py-1.5 text-[11px]" style={{ background: "#FEF2F2", color: "#DC2626" }}>
                Failed: {job.failed_reason}
              </div>
            )}
            {/* Action buttons */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {addr && (
                <button onClick={() => { const q = [addr.street, addr.city, addr.state].filter(Boolean).join(", "); window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`, "_blank"); }}
                  className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-all duration-150"
                  style={{ borderColor: "#E5E5E5", color: "#5C5C5C" }}>
                  <Navigation className="h-2.5 w-2.5" /> Navigate
                </button>
              )}
              {job.customer?.phone && (
                <a href={`tel:${job.customer.phone}`}
                  className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-all duration-150"
                  style={{ borderColor: "#E5E5E5", color: "#5C5C5C" }}>
                  <Phone className="h-2.5 w-2.5" /> Call
                </a>
              )}
              <button onClick={(e) => { e.stopPropagation(); onQuickView(); }}
                className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-all duration-150"
                style={{ borderColor: "#E5E5E5", color: "#5C5C5C" }}>
                <ExternalLink className="h-2.5 w-2.5" /> Details
              </button>
              {/* Assign/Unassign inline */}
              {isUnassigned && drivers && onAssign && (
                <div onClick={e => e.stopPropagation()}>
                  <Dropdown trigger={
                    <button className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold"
                      style={{ background: "rgba(34,197,94,0.08)", borderColor: "#22C55E", color: "#22C55E" }}>
                      <UserPlus className="h-2.5 w-2.5" /> Assign
                    </button>
                  } align="right">
                    {drivers.map(d => (
                      <button key={d.id} onClick={() => onAssign(job.id, d.id)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-xs whitespace-nowrap"
                        style={{ color: "var(--t-text-primary)" }}>
                        <div className="flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold"
                          style={{ background: "var(--t-accent-soft)", color: "var(--t-accent)" }}>{d.firstName[0]}{d.lastName[0]}</div>
                        {d.firstName} {d.lastName}
                      </button>
                    ))}
                  </Dropdown>
                </div>
              )}
              {!isUnassigned && onUnassign && (
                <button onClick={(e) => { e.stopPropagation(); onUnassign(job.id); }}
                  className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold"
                  style={{ background: "rgba(220,38,38,0.06)", borderColor: "#DC2626", color: "#DC2626" }}>
                  <X className="h-2.5 w-2.5" /> Unassign
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Click overlay for quick view (not on expanded action buttons) */}
      {!expanded && (
        <div className="absolute inset-0 cursor-pointer rounded-[16px]" onClick={onQuickView}
          style={{ zIndex: 0 }} />
      )}
    </div>
  );
});

/* ======== Drag overlay (ghost card) ======== */

function JobTileOverlay({ job }: { job: DispatchJob }) {
  const tc = TYPE_CONFIG[job.job_type] || { label: job.job_type, letter: "?", color: "var(--t-text-muted)", stripe: "#8A8A8A" };
  const size = job.asset?.subtype || "";
  return (
    <div className="rounded-[16px] border bg-white px-4 py-3 shadow-2xl" style={{ width: 280, borderColor: "var(--t-accent)", opacity: 0.95 }}>
      <div className="absolute left-0 top-3 bottom-3 w-[4px] rounded-full" style={{ background: tc.stripe }} />
      <div className="flex items-center gap-2 pl-2">
        {size && <span className="rounded-md px-2 py-0.5 text-[13px] font-bold" style={{ background: "#F0F0F0", border: "1px solid #E0E0E0", color: "#0A0A0A" }}>{size}</span>}
        <span className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: tc.stripe }}>{tc.letter}</span>
        <span className="text-[13px] font-semibold truncate" style={{ color: "#0A0A0A" }}>
          {job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : job.job_number}
        </span>
      </div>
    </div>
  );
}

/* ======== QuickView Content ======== */

function JobQuickViewContent({ job, detail, board, onAssign, onRefresh, toast }: {
  job: DispatchJob; detail: any;
  board: DispatchBoard | null;
  onAssign: (jobId: string, driverId: string | null) => Promise<void>;
  onRefresh: () => Promise<void>;
  toast: (type: "success" | "error" | "warning", msg: string) => void;
}) {
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [newDate, setNewDate] = useState(detail?.scheduled_date || "");
  const [reason, setReason] = useState("");
  const [rescheduling, setRescheduling] = useState(false);

  const tc = TYPE_CONFIG[job.job_type] || { label: job.job_type, letter: "?", color: "var(--t-text-muted)", stripe: "#8A8A8A" };
  const isCompleted = job.status === "completed";
  const d = detail || job;
  const addr = d.service_address;
  const cust = d.customer;

  const handleReschedule = async () => {
    if (!newDate) return;
    setRescheduling(true);
    try {
      await api.patch(`/jobs/${job.id}/reschedule`, { scheduledDate: newDate, reason, source: "dispatcher" });
      toast("success", `Moved to ${new Date(newDate).toLocaleDateString()}`);
      setRescheduleOpen(false);
      await onRefresh();
    } catch { toast("error", "Failed to reschedule"); }
    finally { setRescheduling(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium" style={{ color: tc.color }}>{tc.label}</span>
        <span className="text-xs font-medium capitalize" style={{ color: isCompleted ? "var(--t-accent)" : "var(--t-warning)" }}>{job.status.replace(/_/g, " ")}</span>
        {job.priority === "high" && <span className="text-xs font-bold" style={{ color: "var(--t-error)" }}>High Priority</span>}
        {d.asset?.identifier && <span className="text-xs font-bold" style={{ color: "var(--t-accent)" }}>{d.asset.identifier}</span>}
        {d.asset?.subtype && <span className="rounded-md px-2 py-0.5 text-[11px] font-bold" style={{ background: "#F0F0F0", border: "1px solid #E0E0E0", color: "#0A0A0A" }}>{d.asset.subtype}</span>}
      </div>

      {cust && (
        <div className="rounded-[20px] border p-4" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
          <p className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "var(--t-text-muted)" }}>Customer</p>
          <Link href={`/customers/${cust.id}`} className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>{cust.first_name} {cust.last_name}</Link>
          {cust.phone && <a href={`tel:${cust.phone}`} className="flex items-center gap-1.5 mt-2 text-xs" style={{ color: "var(--t-accent)" }}><Phone className="h-3 w-3" />{formatPhone(cust.phone)}</a>}
          {cust.email && <a href={`mailto:${cust.email}`} className="flex items-center gap-1.5 mt-1 text-xs" style={{ color: "var(--t-text-muted)" }}><Mail className="h-3 w-3" />{cust.email}</a>}
        </div>
      )}

      {addr && (
        <div className="rounded-[20px] border p-4" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
          <p className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "var(--t-text-muted)" }}>Service Address</p>
          <p className="text-sm" style={{ color: "var(--t-text-primary)" }}>{addr.street}</p>
          <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>{[addr.city, addr.state, addr.zip].filter(Boolean).join(", ")}</p>
          {d.placement_notes && <p className="text-xs mt-2 italic" style={{ color: "var(--t-text-muted)" }}>"{d.placement_notes}"</p>}
        </div>
      )}

      <div className="rounded-[20px] border p-4" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
        <p className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "var(--t-text-muted)" }}>Schedule</p>
        <div className="space-y-1.5 text-sm">
          {d.scheduled_date && <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Date</span><span className="font-medium" style={{ color: "var(--t-text-primary)" }}>{new Date(d.scheduled_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span></div>}
          {d.scheduled_window_start && <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Time</span><span style={{ color: "var(--t-text-primary)" }}>{fmtTime(d.scheduled_window_start)}{d.scheduled_window_end ? ` - ${fmtTime(d.scheduled_window_end)}` : ""}</span></div>}
          {d.rental_days && <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Rental</span><span style={{ color: "var(--t-text-primary)" }}>{d.rental_days} days</span></div>}
        </div>
      </div>

      {board && (
        <div className="rounded-[20px] border p-4" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
          <p className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "var(--t-text-muted)" }}>Assignment</p>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Driver</span><span style={{ color: job.assigned_driver ? "var(--t-text-primary)" : "var(--t-error)" }}>{job.assigned_driver ? `${job.assigned_driver.first_name} ${job.assigned_driver.last_name}` : "Unassigned"}</span></div>
            <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Asset</span><span style={{ color: "var(--t-text-primary)" }}>{d.asset?.identifier || "Not assigned"}</span></div>
          </div>
          <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--t-border)" }}>
            <Dropdown trigger={<button className="text-xs font-medium" style={{ color: "var(--t-accent)" }}>{job.assigned_driver ? "Reassign" : "Assign Driver"}</button>}>
              <button onClick={() => onAssign(job.id, null)} className="flex w-full items-center gap-2 px-3 py-2 text-xs" style={{ color: "var(--t-error)" }}>Unassign</button>
              {board.drivers.map(col => (
                <button key={col.driver.id} onClick={() => onAssign(job.id, col.driver.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs whitespace-nowrap"
                  style={{ color: "var(--t-text-primary)" }}>
                  <div className="flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold"
                    style={{ background: "var(--t-accent-soft)", color: "var(--t-accent)" }}>{col.driver.firstName[0]}{col.driver.lastName[0]}</div>
                  {col.driver.firstName} {col.driver.lastName}
                </button>
              ))}
            </Dropdown>
          </div>
        </div>
      )}

      {d.total_price > 0 && (
        <div className="rounded-[20px] border p-4" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
          <div className="flex justify-between items-center">
            <p className="text-[11px] uppercase tracking-wider" style={{ color: "var(--t-text-muted)" }}>Total</p>
            <p className="text-lg font-bold tabular-nums" style={{ color: "var(--t-accent)" }}>${Number(d.total_price).toLocaleString()}</p>
          </div>
        </div>
      )}

      {!isCompleted && job.status !== "cancelled" && (
        <>
          {!rescheduleOpen ? (
            <button onClick={() => { setRescheduleOpen(true); setNewDate(d.scheduled_date || ""); }}
              className="w-full rounded-full border py-2.5 text-xs font-semibold"
              style={{ borderColor: "var(--t-border)", color: "#3B82F6" }}>
              <Calendar className="h-3.5 w-3.5 inline mr-1.5" />Reschedule
            </button>
          ) : (
            <div className="rounded-[20px] border p-4 space-y-3" style={{ borderColor: "var(--t-border)", background: "var(--t-bg-card)" }}>
              <p className="text-xs font-semibold" style={{ color: "#3B82F6" }}>Reschedule Job</p>
              <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
                className="w-full rounded-[10px] border px-3 py-2 text-sm outline-none"
                style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} />
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (optional)"
                className="w-full rounded-[10px] border px-3 py-2 text-sm outline-none"
                style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} />
              <div className="flex gap-2">
                <button onClick={handleReschedule} disabled={!newDate || rescheduling}
                  className="flex-1 rounded-full py-2 text-xs font-semibold disabled:opacity-50"
                  style={{ background: "#3B82F6", color: "#fff" }}>{rescheduling ? "Moving..." : "Confirm"}</button>
                <button onClick={() => setRescheduleOpen(false)}
                  className="rounded-full px-4 py-2 text-xs"
                  style={{ background: "var(--t-bg-card-hover)", color: "var(--t-text-muted)" }}>Cancel</button>
              </div>
            </div>
          )}
          <button onClick={async () => {
            if (!confirm("Cancel this job?")) return;
            try { await api.patch(`/jobs/${job.id}/status`, { status: "cancelled" }); toast("success", "Cancelled"); await onRefresh(); } catch { toast("error", "Failed"); }
          }} className="w-full rounded-full border py-2 text-xs font-medium"
            style={{ borderColor: "var(--t-error)", color: "var(--t-error)" }}>
            Cancel Job
          </button>
        </>
      )}
    </div>
  );
}
