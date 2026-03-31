"use client";

import { useState, useEffect, useCallback, memo, useRef } from "react";
import Link from "next/link";
import {
  ChevronLeft, ChevronRight, Calendar, Clock, MapPin, UserPlus, Truck,
  Phone, Plus, Box, Search, CheckCircle2, RefreshCw, Zap, X, ExternalLink,
  ChevronDown, ChevronUp, Navigation, Mail, MoreHorizontal, Eye, EyeOff,
  FileText, Send, Map as MapIcon, LayoutDashboard,
} from "lucide-react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  DndContext, closestCenter, DragOverlay, useSensor, useSensors, PointerSensor,
  DragStartEvent, DragEndEvent, useDroppable,
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
interface DriverColumn { driver: Driver; route: { id: string; status: string; total_stops: number } | null; jobs: DispatchJob[]; jobCount: number; }
interface DispatchBoard { date: string; drivers: DriverColumn[]; unassigned: DispatchJob[]; }

/* ---- Mapbox ---- */

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
const HAS_MAP = MAPBOX_TOKEN && MAPBOX_TOKEN !== "pk.placeholder";

const ADDR_COORDS: Record<string, [number, number]> = {
  "45 Pearl Street": [-71.0234, 42.0834],
  "15 Maple Drive": [-70.9340, 42.0801],
  "200 Centre Street": [-70.9451, 42.1051],
  "89 Tosca Drive": [-71.1010, 42.1241],
  "500 Industrial Drive": [-71.0300, 42.0750],
  "23 Josephs Road": [-71.0180, 42.0810],
  "78 Oak Street": [-71.1285, 42.0235],
  "120 West Elm Street": [-70.9450, 42.0350],
  "55 North Avenue": [-70.9070, 42.1295],
  "88 Summer Street": [-71.1010, 42.1240],
  "340 Bedford Street": [-70.9720, 42.0350],
  "150 Washington Street": [-70.8120, 42.1135],
};
const DUMP_COORDS: Record<string, [number, number]> = {
  "Recycling Solutions": [-71.0440, 41.9280],
  "Brockton Transfer Station": [-71.0190, 42.0830],
  "Stoughton Transfer Station": [-71.0980, 42.1250],
  "SEMASS Resource Recovery": [-70.8210, 41.7580],
};
const YARD_COORDS: [number, number] = [-71.0184, 42.0834];

function getJobCoords(job: DispatchJob): [number, number] | null {
  const addr = job.service_address;
  if (!addr) return null;
  if (addr.lng && addr.lat) return [Number(addr.lng), Number(addr.lat)];
  const street = addr.street || "";
  for (const [key, coords] of Object.entries(ADDR_COORDS)) {
    if (street.includes(key)) return coords;
  }
  return null;
}

/* ---- Constants ---- */

const TYPE_CONFIG: Record<string, { label: string; letter: string; stripe: string }> = {
  delivery: { label: "Drop Off", letter: "D", stripe: "#22C55E" },
  pickup: { label: "Pick Up", letter: "P", stripe: "#D97706" },
  exchange: { label: "Exchange", letter: "E", stripe: "#a78bfa" },
  dump_run: { label: "Dump Run", letter: "DR", stripe: "#DC2626" },
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
  const [collapsedCols, setCollapsedCols] = useState<Set<string>>(new Set());
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [showColumns, setShowColumns] = useState(true);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [dragColId, setDragColId] = useState<string | null>(null);
  const saveOrderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();

  // Load saved column order on mount
  useEffect(() => {
    api.get<Record<string, unknown>>("/auth/preferences").then(prefs => {
      const saved = prefs?.dispatchColumnOrder;
      if (Array.isArray(saved) && saved.length > 0) setColumnOrder(saved as string[]);
    }).catch(() => {});
  }, []);

  const saveColumnOrder = (order: string[]) => {
    if (saveOrderTimer.current) clearTimeout(saveOrderTimer.current);
    saveOrderTimer.current = setTimeout(() => {
      api.patch("/auth/preferences", { dispatchColumnOrder: order }).catch(() => {});
    }, 500);
  };

  const makeColumnDrag = (colId: string) => ({
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/column-id", colId); setDragColId(colId); (e.currentTarget as HTMLElement).style.opacity = "0.5"; },
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); const from = e.dataTransfer.getData("text/column-id"); if (from && from !== colId) { setColumnOrder(prev => { const arr = [...prev]; const fi = arr.indexOf(from); const ti = arr.indexOf(colId); if (fi >= 0 && ti >= 0) { arr.splice(fi, 1); arr.splice(ti, 0, from); } saveColumnOrder(arr); return arr; }); } setDragColId(null); },
    onDragEnd: (e: React.DragEvent) => { (e.currentTarget as HTMLElement).style.opacity = "1"; setDragColId(null); },
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const toggleCollapse = (id: string) => setCollapsedCols(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const hideColumn = (id: string) => setHiddenCols(prev => new Set(prev).add(id));
  const showColumn = (id: string) => setHiddenCols(prev => { const n = new Set(prev); n.delete(id); return n; });
  const showAllColumns = () => setHiddenCols(new Set());

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

  const allJobs = board ? [...board.unassigned, ...board.drivers.flatMap(d => d.jobs)] : [];
  const findColumnForJob = (jobId: string): string => {
    if (!board) return "unassigned";
    if (board.unassigned.some(j => j.id === jobId)) return "unassigned";
    for (const col of board.drivers) { if (col.jobs.some(j => j.id === jobId)) return col.driver.id; }
    return "unassigned";
  };

  const handleDragStart = (event: DragStartEvent) => { setActiveId(event.active.id as string); };
  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || !board) return;

    const activeJobId = active.id as string;
    const overId = over.id as string;
    const columnIds = ["unassigned", ...board.drivers.map(d => d.driver.id)];
    const sourceCol = findColumnForJob(activeJobId);

    // Determine target column: if overId is a column, use it; otherwise find which column that job belongs to
    const targetCol = columnIds.includes(overId) ? overId : findColumnForJob(overId);
    if (sourceCol === targetCol && !columnIds.includes(overId)) {
      // ── Same column reorder ──
      const getJobs = (col: string) => col === "unassigned" ? board.unassigned : (board.drivers.find(d => d.driver.id === col)?.jobs || []);
      const colJobs = [...getJobs(sourceCol)];
      const oldIndex = colJobs.findIndex(j => j.id === activeJobId);
      const newIndex = colJobs.findIndex(j => j.id === overId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      const reordered = arrayMove(colJobs, oldIndex, newIndex);

      // Optimistic update
      setBoard(prev => {
        if (!prev) return prev;
        if (sourceCol === "unassigned") return { ...prev, unassigned: reordered };
        return { ...prev, drivers: prev.drivers.map(d => d.driver.id === sourceCol ? { ...d, jobs: reordered } : d) };
      });

      toast("success", "Route updated");

      try {
        await api.patch("/jobs/bulk-reorder", { jobIds: reordered.map(j => j.id) });
      } catch {
        toast("error", "Failed to save order");
        fetchBoard(true);
      }
    } else if (sourceCol !== targetCol) {
      // ── Cross-column move ──
      const newBoard = JSON.parse(JSON.stringify(board)) as DispatchBoard;

      // Remove from source
      const srcJobs = sourceCol === "unassigned" ? newBoard.unassigned : (newBoard.drivers.find(d => d.driver.id === sourceCol)?.jobs || []);
      const srcIdx = srcJobs.findIndex((j: DispatchJob) => j.id === activeJobId);
      if (srcIdx === -1) return;
      const [movedJob] = srcJobs.splice(srcIdx, 1);

      // Insert into target
      const dstJobs = targetCol === "unassigned" ? newBoard.unassigned : (newBoard.drivers.find(d => d.driver.id === targetCol)?.jobs || []);
      // If dropped on a specific job, insert at that position; otherwise append
      if (!columnIds.includes(overId)) {
        const dstIdx = dstJobs.findIndex((j: DispatchJob) => j.id === overId);
        dstJobs.splice(dstIdx >= 0 ? dstIdx : dstJobs.length, 0, movedJob);
      } else {
        dstJobs.push(movedJob);
      }

      // Update counts
      for (const d of newBoard.drivers) {
        d.jobCount = d.jobs.length;
      }

      // Optimistic update
      setBoard(newBoard);

      const targetDriverId = targetCol === "unassigned" ? null : targetCol;
      const driverName = targetDriverId ? board.drivers.find(d => d.driver.id === targetDriverId)?.driver : null;
      toast("success", targetDriverId ? `Moved to ${driverName?.firstName}'s route` : "Moved to Unassigned");

      try {
        await api.patch(`/jobs/${activeJobId}/assign`, { assignedDriverId: targetDriverId });
        // Also persist the new route order in the destination column
        await api.patch("/jobs/bulk-reorder", { jobIds: dstJobs.map((j: DispatchJob) => j.id) });
      } catch (err) {
        toast("error", err instanceof Error ? err.message : "Failed to move job");
        fetchBoard(true);
      }
    }
  };

  const openQuickView = (j: DispatchJob) => { setQuickViewJob(j); setQvLoading(true); setQvDetail(null); api.get(`/jobs/${j.id}`).then(setQvDetail).catch(() => {}).finally(() => setQvLoading(false)); };

  const totalJobs = board ? board.unassigned.length + board.drivers.reduce((s, d) => s + d.jobs.length, 0) : 0;
  const driverCount = board?.drivers.length || 0;
  const unassignedCount = board?.unassigned.length || 0;
  const completedJobs = allJobs.filter(j => j.status === "completed").length;
  const activeJob = activeId ? allJobs.find(j => j.id === activeId) : null;
  // Sync column order when board loads
  useEffect(() => {
    if (board?.drivers) {
      setColumnOrder(prev => {
        const ids = board.drivers.map(d => d.driver.id);
        // Keep existing order for known IDs, append new ones
        const ordered = prev.filter(id => ids.includes(id));
        ids.forEach(id => { if (!ordered.includes(id)) ordered.push(id); });
        return ordered;
      });
    }
  }, [board?.drivers]);

  const orderedDrivers = board?.drivers
    ? columnOrder
        .map(id => board.drivers.find(d => d.driver.id === id))
        .filter((d): d is DriverColumn => !!d && !hiddenCols.has(d.driver.id))
    : [];
  const visibleDrivers = orderedDrivers.length > 0 ? orderedDrivers : (board?.drivers.filter(d => !hiddenCols.has(d.driver.id)) || []);
  const hiddenDrivers = board?.drivers.filter(d => hiddenCols.has(d.driver.id)) || [];

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col">
      {/* ── Top bar ── */}
      <div className="shrink-0 mb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button onClick={() => setDate(d => shiftDate(d, -1))} className="p-2 rounded-[20px] border transition-all" style={{ background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.08)", color: "var(--t-frame-text-muted)" }}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--t-frame-text-muted)" }} />
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-[20px] py-2 pl-10 pr-3 text-sm font-medium outline-none w-52"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--t-frame-text)" }} />
              </div>
              <button onClick={() => setDate(d => shiftDate(d, 1))} className="p-2 rounded-[20px] border transition-all" style={{ background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.08)", color: "var(--t-frame-text-muted)" }}>
                <ChevronRight className="h-4 w-4" />
              </button>
              <button onClick={() => setDate(today())} className="ml-1 rounded-full px-3 py-2 text-xs font-medium border"
                style={{ background: date === today() ? "var(--t-accent-soft)" : "rgba(255,255,255,0.06)", borderColor: date === today() ? "var(--t-accent)" : "rgba(255,255,255,0.08)", color: date === today() ? "var(--t-accent)" : "var(--t-frame-text-muted)" }}>
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
            <button onClick={() => fetchBoard(true)} disabled={refreshing} className="p-2 rounded-[20px] border disabled:opacity-50"
              style={{ background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.08)", color: "var(--t-frame-text-muted)" }}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <button onClick={() => setShowColumns(!showColumns)} className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium border"
              style={{ borderColor: "rgba(255,255,255,0.12)", color: "var(--t-frame-text-muted)" }}>
              {showColumns ? <MapIcon className="h-3.5 w-3.5" /> : <LayoutDashboard className="h-3.5 w-3.5" />}
              {showColumns ? "Map View" : "Show Columns"}
            </button>
            <button className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold active:scale-95" style={{ background: "var(--t-accent)", color: "#000" }}>
              <Zap className="h-3.5 w-3.5" /> Optimize Routes
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-3">
          <div className="flex gap-1">
            {FILTER_TABS.map(t => (
              <button key={t.key} onClick={() => setFilter(t.key)} className="rounded-full px-3 py-1.5 text-xs font-medium"
                style={{ background: filter === t.key ? "var(--t-accent-soft)" : "rgba(255,255,255,0.06)", color: filter === t.key ? "var(--t-accent)" : "var(--t-frame-text-muted)" }}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "var(--t-frame-text-muted)" }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search jobs..."
              className="w-full rounded-[20px] py-1.5 pl-9 pr-3 text-xs outline-none"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--t-frame-text)" }} />
          </div>
          {/* Show hidden columns */}
          {hiddenDrivers.length > 0 && (
            <Dropdown trigger={
              <button className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border"
                style={{ borderColor: "rgba(255,255,255,0.12)", color: "var(--t-frame-text-muted)" }}>
                <EyeOff className="h-3 w-3" /> {hiddenDrivers.length} hidden
              </button>
            }>
              {hiddenDrivers.map(col => (
                <button key={col.driver.id} onClick={() => showColumn(col.driver.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs whitespace-nowrap" style={{ color: "var(--t-text-primary)" }}>
                  <Eye className="h-3 w-3" /> {col.driver.firstName} {col.driver.lastName}
                </button>
              ))}
              <button onClick={showAllColumns} className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold border-t whitespace-nowrap"
                style={{ color: "var(--t-accent)", borderColor: "var(--t-border)" }}>
                Show All
              </button>
            </Dropdown>
          )}
        </div>
      </div>

      {/* ── Board ── */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex-1 min-h-0 overflow-hidden relative">
          <DispatchMap board={board} activeJobId={activeId} />
          <div style={{ position: "relative", zIndex: 10, height: "100%", pointerEvents: "none" }}>
            <div style={{ pointerEvents: "auto", height: "100%" }}>
          {loading ? (
            <div className="flex h-full gap-3 overflow-x-auto pb-2">
              {[1,2,3,4].map(i => <div key={i} className="w-[330px] shrink-0"><div className="h-20 skeleton rounded-t-[20px]" /><div className="space-y-2 mt-2">{[1,2,3].map(j => <div key={j} className="h-24 skeleton rounded-[14px]" />)}</div></div>)}
            </div>
          ) : !board ? (
            <div className="flex h-full items-center justify-center" style={{ color: "var(--t-frame-text-muted)" }}>Failed to load</div>
          ) : totalJobs === 0 && board.drivers.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center">
              <Truck className="h-14 w-14 mb-3" style={{ color: "var(--t-frame-text-muted)", opacity: 0.15 }} />
              <h2 className="text-base font-semibold" style={{ color: "var(--t-frame-text)" }}>No jobs for {fmtDate(date)}</h2>
              <p className="mt-1 text-xs" style={{ color: "var(--t-frame-text-muted)" }}>Schedule some deliveries!</p>
              <Link href="/" className="mt-3 flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold active:scale-95" style={{ background: "var(--t-accent)", color: "#000" }}>
                <Plus className="h-3.5 w-3.5" /> New Job
              </Link>
            </div>
          ) : showColumns ? (
            <div className="flex gap-3 overflow-x-auto pb-2 items-start h-full">
              <ColumnCard columnId="unassigned" title="Unassigned" isUnassigned count={board.unassigned.length}
                jobs={filterJobs(board.unassigned, filter, search)} drivers={board.drivers.map(d => d.driver)}
                onAssign={async (jid, did) => { try { await api.patch(`/jobs/${jid}/assign`, { assignedDriverId: did }); toast("success", "Assigned"); await fetchBoard(true); } catch { toast("error", "Failed"); } }}
                onQuickView={openQuickView} activeId={activeId}
                onStatusChange={async (jid, s) => { try { await api.patch(`/jobs/${jid}/status`, { status: s, cancellationReason: s === "failed" ? "Dispatcher override" : undefined }); toast("success", `Status → ${s.replace(/_/g, " ")}`); await fetchBoard(true); } catch { toast("error", "Failed"); } }}
                collapsed={collapsedCols.has("unassigned")} onToggleCollapse={() => toggleCollapse("unassigned")} />
              {visibleDrivers.map((col, idx) => (
                <ColumnCard key={col.driver.id} columnId={col.driver.id} title={`${col.driver.firstName} ${col.driver.lastName}`}
                  driver={col.driver} count={col.jobs.length}
                  progress={{ completed: col.jobs.filter(j => j.status === "completed").length, total: col.jobs.length }}
                  jobs={filterJobs(col.jobs, filter, search)}
                  onUnassign={async (jid) => { try { await api.patch(`/jobs/${jid}/assign`, { assignedDriverId: null }); toast("success", "Unassigned"); await fetchBoard(true); } catch { toast("error", "Failed"); } }}
                  onQuickView={openQuickView} activeId={activeId}
                  onStatusChange={async (jid, s) => { try { await api.patch(`/jobs/${jid}/status`, { status: s, cancellationReason: s === "failed" ? "Dispatcher override" : undefined }); toast("success", `Status → ${s.replace(/_/g, " ")}`); await fetchBoard(true); } catch { toast("error", "Failed"); } }}
                  collapsed={collapsedCols.has(col.driver.id)} onToggleCollapse={() => toggleCollapse(col.driver.id)}
                  onHide={() => hideColumn(col.driver.id)}
                  onColumnDrag={makeColumnDrag(col.driver.id)}
                />
              ))}
            </div>
          ) : null}
            </div>
          </div>
        </div>
        <DragOverlay>{activeJob ? <JobTileGhost job={activeJob} /> : null}</DragOverlay>
      </DndContext>

      {/* ── Bottom bar ── */}
      {!loading && board && totalJobs > 0 && (
        <div className="shrink-0 mt-3 flex items-center justify-between px-5 py-3" style={{ borderTop: "1px solid var(--t-frame-border)" }}>
          <div className="flex items-center gap-5 text-xs" style={{ color: "var(--t-frame-text-muted)" }}>
            <span><span className="font-semibold" style={{ color: "var(--t-frame-text)" }}>{totalJobs - completedJobs}</span> stops remaining</span>
            <span><span className="font-semibold" style={{ color: "var(--t-frame-text)" }}>{completedJobs}</span> completed</span>
            <span><span className="font-semibold" style={{ color: "var(--t-frame-text)" }}>{driverCount}</span> active drivers</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-full border px-3 py-1.5 text-xs font-medium" style={{ borderColor: "var(--t-frame-border)", color: "var(--t-frame-text-muted)" }}>Print Route Sheets</button>
            <button className="rounded-full border px-3 py-1.5 text-xs font-semibold" style={{ background: "var(--t-accent-soft)", borderColor: "var(--t-accent)", color: "var(--t-accent)" }}>Send Routes to Drivers</button>
          </div>
        </div>
      )}

      {/* ── QuickView ── */}
      <QuickView isOpen={!!quickViewJob} onClose={() => { setQuickViewJob(null); setQvDetail(null); }}
        title={quickViewJob ? `${quickViewJob.asset?.subtype || ""} ${TYPE_CONFIG[quickViewJob.job_type]?.label || quickViewJob.job_type}`.trim() : ""}
        subtitle={quickViewJob?.job_number}
        actions={quickViewJob ? <Link href={`/jobs/${quickViewJob.id}`} className="rounded-full px-3 py-1.5 text-xs font-medium" style={{ background: "var(--t-bg-card-hover)", color: "var(--t-text-primary)" }}><ExternalLink className="h-3 w-3 inline mr-1" />Full Detail</Link> : undefined}
        footer={quickViewJob ? (
          <div className="flex gap-2">
            {quickViewJob.customer?.phone && <a href={`tel:${quickViewJob.customer.phone}`} className="flex-1 flex items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-semibold" style={{ background: "var(--t-accent)", color: "#000" }}><Phone className="h-3.5 w-3.5" /> Call</a>}
            {quickViewJob.service_address && <button onClick={() => { const a = quickViewJob.service_address!; window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([a.street, a.city, a.state].filter(Boolean).join(", "))}`, "_blank"); }}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-semibold border" style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}><Navigation className="h-3.5 w-3.5" /> Navigate</button>}
          </div>
        ) : undefined}
      >
        {quickViewJob && qvLoading ? <QuickViewSkeleton /> : quickViewJob && qvDetail ? (
          <QVContent job={quickViewJob} detail={qvDetail} board={board} onAssign={async (jid, did) => {
            try { await api.patch(`/jobs/${jid}/assign`, { assignedDriverId: did }); toast("success", "Reassigned"); await fetchBoard(true); } catch { toast("error", "Failed"); }
          }} onRefresh={() => fetchBoard(true)} toast={toast} />
        ) : null}
      </QuickView>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Dispatch Map — Mapbox GL background
   ═══════════════════════════════════════════════════ */

function DispatchMap({ board, activeJobId }: { board: DispatchBoard | null; activeJobId: string | null }) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  useEffect(() => {
    if (!HAS_MAP || !mapContainer.current || map.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: YARD_COORDS,
      zoom: 11,
    });
    map.current.addControl(new mapboxgl.NavigationControl(), "bottom-right");

    // Yard pin
    const yardEl = document.createElement("div");
    yardEl.innerHTML = `<div style="width:30px;height:30px;border-radius:50%;background:#3B82F6;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;color:#fff;">🏠</div>`;
    new mapboxgl.Marker(yardEl).setLngLat(YARD_COORDS).setPopup(new mapboxgl.Popup({ offset: 10 }).setHTML("<strong>Yard</strong><br>Brockton, MA")).addTo(map.current);

    return () => { map.current?.remove(); map.current = null; };
  }, []);

  // Update job pins when board changes
  useEffect(() => {
    if (!map.current || !board) return;
    // Clear old markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const allJobs = [...board.unassigned, ...board.drivers.flatMap(d => d.jobs)];
    for (const job of allJobs) {
      const coords = getJobCoords(job);
      if (!coords) continue;
      const tc = TYPE_CONFIG[job.job_type] || { letter: "?", stripe: "#8A8A8A" };
      const isActive = job.id === activeJobId;
      const el = document.createElement("div");
      el.style.cssText = `width:${isActive ? 40 : 32}px;height:${isActive ? 40 : 32}px;border-radius:50%;background:${tc.stripe};border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:${isActive ? 14 : 11}px;font-weight:bold;color:#fff;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(0,0,0,0.3);`;
      el.textContent = tc.letter;
      const popup = new mapboxgl.Popup({ offset: 15 }).setHTML(
        `<div style="font-family:system-ui;padding:4px"><strong>${job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : job.job_number}</strong><br><span style="font-size:12px;color:#666">${job.service_address?.street || ""}, ${job.service_address?.city || ""}</span><br><span style="font-size:11px;color:${tc.stripe};font-weight:600">${job.asset?.subtype || ""} ${TYPE_CONFIG[job.job_type]?.label || job.job_type}</span></div>`
      );
      const marker = new mapboxgl.Marker(el).setLngLat(coords).setPopup(popup).addTo(map.current!);
      markersRef.current.push(marker);
    }

    // Dump location pins
    for (const [name, coords] of Object.entries(DUMP_COORDS)) {
      const el = document.createElement("div");
      el.style.cssText = "width:26px;height:26px;border-radius:50%;background:#8B5CF6;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;color:#fff;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.3);";
      el.textContent = "♻";
      const popup = new mapboxgl.Popup({ offset: 10 }).setHTML(`<strong>${name}</strong>`);
      const marker = new mapboxgl.Marker(el).setLngLat(coords).setPopup(popup).addTo(map.current!);
      markersRef.current.push(marker);
    }
  }, [board, activeJobId]);

  if (!HAS_MAP) {
    // Fallback dark grid background
    return (
      <div style={{ position: "absolute", inset: 0, background: "#0A0A0A", zIndex: 0 }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle, #1a1a1a 1px, transparent 1px)", backgroundSize: "30px 30px", opacity: 0.5 }} />
        <div style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", background: "rgba(217,119,6,0.15)", border: "1px solid rgba(217,119,6,0.3)", borderRadius: 12, padding: "8px 16px", fontSize: 12, color: "#D97706", zIndex: 5 }}>
          Add Mapbox token in Settings to enable the live dispatch map
        </div>
      </div>
    );
  }

  return <div ref={mapContainer} style={{ position: "absolute", inset: 0, zIndex: 0 }} />;
}

/* ═══════════════════════════════════════════════════
   Column Card — white card with accordion collapse
   ═══════════════════════════════════════════════════ */

function ColumnCard({ columnId, title, driver, isUnassigned, count, progress, jobs, drivers, onAssign, onUnassign, onQuickView, onStatusChange, activeId, collapsed, onToggleCollapse, onHide, onColumnDrag }: {
  columnId: string; title: string; driver?: Driver; isUnassigned?: boolean;
  count: number; progress?: { completed: number; total: number };
  jobs: DispatchJob[]; drivers?: Driver[];
  onAssign?: (jobId: string, driverId: string | null) => void;
  onUnassign?: (jobId: string) => void;
  onQuickView: (job: DispatchJob) => void;
  onStatusChange?: (jobId: string, newStatus: string) => void;
  activeId: string | null;
  collapsed: boolean; onToggleCollapse: () => void; onHide?: () => void;
  onColumnDrag?: { onDragStart: (e: React.DragEvent) => void; onDragOver: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void; onDragEnd: (e: React.DragEvent) => void };
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId });
  const completedCount = progress?.completed || 0;
  const totalCount = progress?.total || count;

  const firstIncomplete = jobs.find(j => j.status !== "completed");
  const hiddenCount = collapsed && jobs.length > 1 ? jobs.length - 1 : 0;

  return (
    <div ref={setNodeRef}
      className="shrink-0 rounded-[20px] overflow-hidden transition-all duration-200"
      style={{
        width: 340, minWidth: 340,
        border: isOver && activeId ? "2px dashed var(--t-accent)" : "1px solid rgba(255,255,255,0.3)",
        background: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
      }}>

      {/* ── Header — two rows for full name ── */}
      <div className="px-4 pt-3.5 pb-3 shrink-0"
        draggable={!isUnassigned && !!onColumnDrag}
        onDragStart={onColumnDrag?.onDragStart}
        onDragOver={onColumnDrag?.onDragOver}
        onDrop={onColumnDrag?.onDrop}
        onDragEnd={onColumnDrag?.onDragEnd}
        style={{ borderBottom: "1px solid #F0F0F0", cursor: !isUnassigned && onColumnDrag ? "grab" : "default" }}>
        {/* Row 1: Avatar + Full Name + Menu */}
        <div className="flex items-center gap-2.5">
          {isUnassigned ? (
            <div className="flex h-9 w-9 items-center justify-center rounded-full shrink-0" style={{ background: "rgba(217,119,6,0.1)", color: "#D97706" }}>
              <UserPlus className="h-4 w-4" />
            </div>
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-bold shrink-0" style={{ background: "var(--t-accent-soft)", color: "var(--t-accent)" }}>
              {title.split(" ").map(n => n[0]).join("")}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-bold leading-tight" style={{ color: isUnassigned ? "#D97706" : "#0A0A0A" }}>{title}</p>
            {driver?.phone && <p className="text-[11px] mt-0.5" style={{ color: "#8A8A8A" }}>{formatPhone(driver.phone)}</p>}
          </div>
          {!isUnassigned && (
            <Dropdown trigger={
              <button className="shrink-0 p-1 rounded-lg transition-all" style={{ color: "#8A8A8A" }}
                onMouseEnter={e => { e.currentTarget.style.background = "#F5F5F5"; }} onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                <MoreHorizontal className="h-4 w-4" />
              </button>
            } align="right">
              {onHide && <button onClick={onHide} className="flex w-full items-center gap-2 px-3 py-2 text-xs" style={{ color: "var(--t-text-primary)" }}><EyeOff className="h-3 w-3" /> Hide Column</button>}
              <button onClick={onToggleCollapse} className="flex w-full items-center gap-2 px-3 py-2 text-xs" style={{ color: "var(--t-text-primary)" }}>
                {collapsed ? <Eye className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />} {collapsed ? "Show All" : "Collapse"}
              </button>
              <button className="flex w-full items-center gap-2 px-3 py-2 text-xs" style={{ color: "var(--t-text-primary)" }}><FileText className="h-3 w-3" /> Route Sheet</button>
              <button className="flex w-full items-center gap-2 px-3 py-2 text-xs" style={{ color: "var(--t-text-primary)" }}><Send className="h-3 w-3" /> Send Route</button>
            </Dropdown>
          )}
        </div>
        {/* Row 2: Count + Progress + Chevron */}
        <div className="flex items-center gap-2 mt-2">
          <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold tabular-nums"
            style={{ background: "#F0F0F0", color: "#5C5C5C" }}>
            {completedCount > 0 ? `${completedCount}/${totalCount}` : count === 1 ? "1 stop" : `${count} stops`}
          </span>
          {progress && progress.total > 0 && (
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "#F0F0F0" }}>
              <div className="h-full rounded-full" style={{ width: `${(progress.completed / progress.total) * 100}%`, background: "var(--t-accent)", transition: "width 0.3s ease" }} />
            </div>
          )}
          <button onClick={onToggleCollapse} className="shrink-0 p-1 rounded-lg transition-all ml-auto" style={{ color: "#8A8A8A" }}
            onMouseEnter={e => { e.currentTarget.style.background = "#F5F5F5"; }} onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
            <ChevronDown className="h-4 w-4 transition-transform duration-200" style={{ transform: collapsed ? "rotate(0deg)" : "rotate(180deg)" }} />
          </button>
        </div>
      </div>

      {/* ── Job cards area ── */}
      <SortableContext items={jobs.map(j => j.id)} strategy={verticalListSortingStrategy}>
        <div style={{
          maxHeight: collapsed ? 120 : 2000,
          overflow: "hidden",
          transition: "max-height 0.25s ease",
          background: "rgba(245,245,245,0.95)",
          padding: jobs.length > 0 ? 10 : 0,
        }}>
          {jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6" style={{ padding: 10 }}>
              {isUnassigned
                ? <><CheckCircle2 className="h-5 w-5 mb-1" style={{ color: "var(--t-accent)", opacity: 0.4 }} /><p className="text-[11px]" style={{ color: "var(--t-accent)" }}>All assigned</p></>
                : <><Box className="h-5 w-5 mb-1" style={{ color: "#ccc" }} /><p className="text-[11px]" style={{ color: "#999" }}>No jobs</p></>}
            </div>
          ) : (
            <div className="space-y-2">
              {jobs.map(job => (
                <JobTile key={job.id} job={job} isUnassigned={!!isUnassigned} drivers={drivers}
                  onAssign={onAssign} onUnassign={onUnassign} onQuickView={() => onQuickView(job)}
                  onStatusChange={onStatusChange} />
              ))}
            </div>
          )}
        </div>
      </SortableContext>

      {/* "+N more" indicator when collapsed */}
      {collapsed && hiddenCount > 0 && (
        <div className="text-center py-1.5 cursor-pointer" onClick={onToggleCollapse}
          style={{ background: "#FAFAFA", borderTop: "1px solid #F0F0F0", transition: "opacity 0.2s ease" }}>
          <span className="text-[11px] font-medium" style={{ color: "#8A8A8A" }}>+{hiddenCount} more stop{hiddenCount > 1 ? "s" : ""}</span>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Job Tile — white card, entire tile draggable
   ═══════════════════════════════════════════════════ */

const JobTile = memo(function JobTile({ job, isUnassigned, drivers, onAssign, onUnassign, onQuickView, onStatusChange }: {
  job: DispatchJob; isUnassigned: boolean; drivers?: Driver[];
  onAssign?: (jobId: string, driverId: string | null) => void;
  onUnassign?: (jobId: string) => void;
  onQuickView: () => void;
  onStatusChange?: (jobId: string, newStatus: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: job.id });
  const [expanded, setExpanded] = useState(false);
  const isCompleted = job.status === "completed";
  const tc = TYPE_CONFIG[job.job_type] || { label: job.job_type, letter: "?", stripe: "#8A8A8A" };
  const addr = job.service_address;
  const addrStr = addr ? [addr.street, addr.city].filter(Boolean).join(", ") : "";
  const size = job.asset?.subtype || "";

  return (
    <div ref={setNodeRef} {...attributes} {...listeners}
      style={{
        transform: CSS.Transform.toString(transform), transition,
        opacity: isDragging ? 0.3 : isCompleted ? 0.45 : 1,
        border: "1px solid #F0F0F0",
        boxShadow: isDragging ? "0 8px 24px rgba(0,0,0,0.15)" : "0 1px 4px rgba(0,0,0,0.04)",
        cursor: isDragging ? "grabbing" : "grab",
        touchAction: "none",
      }}
      className="group relative rounded-[14px] bg-white"
    >
      {/* Left stripe */}
      <div className="absolute left-0 top-2.5 bottom-2.5 w-[4px] rounded-full" style={{ background: tc.stripe }} />

      <div className="py-3 pl-4 pr-3">
        {/* Row 1 */}
        <div className="flex items-start gap-1.5">
          {size && <span className="shrink-0 rounded-md px-2 py-0.5 text-[12px] font-bold leading-tight mt-px" style={{ background: "#F0F0F0", border: "1px solid #E0E0E0", color: "#0A0A0A" }}>{size}</span>}
          <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white mt-px" style={{ background: tc.stripe }}>{tc.letter}</span>
          <div className="flex-1 min-w-0">
            <span className="text-[14px] font-semibold leading-snug cursor-pointer hover:underline" style={{ color: "#0A0A0A" }}
              onClick={(e) => { e.stopPropagation(); onQuickView(); }}>
              {job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : job.job_number}
            </span>
          </div>
          <span className="text-[11px] font-semibold capitalize shrink-0 mt-0.5 ml-1" style={{
            color: isCompleted ? "#16A34A" : job.status === "confirmed" ? "#22C55E" : job.status === "pending" ? "#D97706" : job.status === "en_route" ? "#3B82F6" : "#5C5C5C",
          }}>
            {isCompleted && <CheckCircle2 className="inline h-3 w-3 mr-0.5" />}
            {job.status.replace(/_/g, " ")}
          </span>
          <button onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }} className="shrink-0 p-0.5 mt-0.5 cursor-pointer" style={{ color: "#bbb" }}>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Row 2 */}
        <div className="flex items-center justify-between mt-1.5">
          {addrStr && <p className="flex items-center gap-1 text-[12px] truncate flex-1" style={{ color: "#5C5C5C" }}><MapPin className="h-3 w-3 shrink-0" style={{ color: "#bbb" }} />{addrStr}</p>}
          {(job.scheduled_window_start || job.scheduled_window_end) && (
            <p className="flex items-center gap-1 text-[11px] shrink-0 ml-2" style={{ color: "#8A8A8A" }}>
              <Clock className="h-2.5 w-2.5" />{fmtTime(job.scheduled_window_start)}{job.scheduled_window_end ? `–${fmtTime(job.scheduled_window_end)}` : ""}
            </p>
          )}
        </div>

        {/* Row 3: badges */}
        {(job.asset?.identifier || job.is_failed_trip || job.source === "rescheduled_from_failure" || job.is_overdue || (isUnassigned && drivers && onAssign)) && (
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {job.asset?.identifier && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(34,197,94,0.08)", color: "#22C55E" }}>{job.asset.identifier}</span>}
            {job.is_failed_trip && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(220,38,38,0.08)", color: "#DC2626" }}>FAILED</span>}
            {job.source === "rescheduled_from_failure" && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(217,119,6,0.08)", color: "#D97706" }}>FROM FAILED</span>}
            {job.is_overdue && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(220,38,38,0.08)", color: "#DC2626" }}>OVERDUE {job.extra_days}d</span>}
            {isUnassigned && drivers && onAssign && (
              <div onClick={e => e.stopPropagation()} className="ml-auto">
                <Dropdown trigger={<button className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(34,197,94,0.08)", borderColor: "#22C55E", color: "#22C55E" }}><UserPlus className="h-2.5 w-2.5" /> Assign</button>} align="right">
                  {drivers.map(d => (
                    <button key={d.id} onClick={() => onAssign(job.id, d.id)} className="flex w-full items-center gap-2 px-3 py-2 text-xs whitespace-nowrap" style={{ color: "var(--t-text-primary)" }}>
                      <div className="flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold" style={{ background: "var(--t-accent-soft)", color: "var(--t-accent)" }}>{d.firstName[0]}{d.lastName[0]}</div>
                      {d.firstName} {d.lastName}
                    </button>
                  ))}
                </Dropdown>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Expanded */}
      {expanded && (
        <div className="px-4 py-3 space-y-2" onClick={e => e.stopPropagation()} style={{ cursor: "default", borderTop: "1px solid #F0F0F0" }}>
          <div className="flex items-center gap-3 text-[11px]" style={{ color: "#5C5C5C" }}>
            <span>{job.job_number}</span>
            {job.asset?.identifier && <span className="font-semibold" style={{ color: "#22C55E" }}>{job.asset.identifier}</span>}
          </div>
          {job.placement_notes && <div className="rounded-lg px-2.5 py-1.5 text-[11px]" style={{ background: "#FFFBEB", color: "#92400E" }}>📌 {job.placement_notes}</div>}
          {job.failed_reason && <div className="rounded-lg px-2.5 py-1.5 text-[11px]" style={{ background: "#FEF2F2", color: "#DC2626" }}>Failed: {job.failed_reason}</div>}
          <div className="flex items-center gap-1.5 flex-wrap pt-1">
            {addr && <button onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([addr.street, addr.city, addr.state].filter(Boolean).join(", "))}`, "_blank")}
              className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium" style={{ borderColor: "#E5E5E5", color: "#5C5C5C" }}><Navigation className="h-2.5 w-2.5" /> Navigate</button>}
            {job.customer?.phone && <a href={`tel:${job.customer.phone}`} className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium" style={{ borderColor: "#E5E5E5", color: "#5C5C5C" }}><Phone className="h-2.5 w-2.5" /> Call</a>}
            <button onClick={onQuickView} className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium" style={{ borderColor: "#E5E5E5", color: "#5C5C5C" }}><ExternalLink className="h-2.5 w-2.5" /> Details</button>
            {!isUnassigned && onUnassign && <button onClick={() => onUnassign(job.id)} className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold" style={{ background: "rgba(220,38,38,0.06)", borderColor: "#DC2626", color: "#DC2626" }}><X className="h-2.5 w-2.5" /> Unassign</button>}
            {/* Status override dropdown */}
            {onStatusChange && (
              <Dropdown trigger={
                <button className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium ml-auto" style={{ borderColor: "#E5E5E5", color: "#5C5C5C" }}>
                  Status: {job.status.replace(/_/g, " ")} ▾
                </button>
              } align="right">
                {["pending", "confirmed", "en_route", "arrived", "in_progress", "completed", "failed", "cancelled"].map(s => (
                  <button key={s} disabled={s === job.status}
                    onClick={() => { if (confirm(`Change status from "${job.status.replace(/_/g, " ")}" to "${s.replace(/_/g, " ")}"?`)) onStatusChange(job.id, s); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-xs whitespace-nowrap disabled:opacity-30"
                    style={{ color: s === job.status ? "var(--t-text-muted)" : "var(--t-text-primary)" }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: s === "completed" ? "#22C55E" : s === "failed" || s === "cancelled" ? "#DC2626" : s === "pending" ? "#D97706" : "#3B82F6" }} />
                    {s.replace(/_/g, " ")}
                  </button>
                ))}
              </Dropdown>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

/* ═══════════════════════════════════════════════════
   Drag Ghost
   ═══════════════════════════════════════════════════ */

function JobTileGhost({ job }: { job: DispatchJob }) {
  const tc = TYPE_CONFIG[job.job_type] || { label: job.job_type, letter: "?", stripe: "#8A8A8A" };
  const size = job.asset?.subtype || "";
  return (
    <div className="relative rounded-[14px] bg-white px-4 py-3" style={{ width: 310, border: "2px solid var(--t-accent)", boxShadow: "0 12px 32px rgba(0,0,0,0.2)" }}>
      <div className="absolute left-0 top-2.5 bottom-2.5 w-[4px] rounded-full" style={{ background: tc.stripe }} />
      <div className="flex items-center gap-2 pl-2">
        {size && <span className="rounded-md px-2 py-0.5 text-[12px] font-bold" style={{ background: "#F0F0F0", border: "1px solid #E0E0E0", color: "#0A0A0A" }}>{size}</span>}
        <span className="flex h-[20px] w-[20px] items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: tc.stripe }}>{tc.letter}</span>
        <span className="text-[14px] font-semibold" style={{ color: "#0A0A0A" }}>{job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : job.job_number}</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   QuickView Content
   ═══════════════════════════════════════════════════ */

function QVContent({ job, detail, board, onAssign, onRefresh, toast }: {
  job: DispatchJob; detail: any; board: DispatchBoard | null;
  onAssign: (jobId: string, driverId: string | null) => Promise<void>;
  onRefresh: () => Promise<void>;
  toast: (type: "success" | "error" | "warning", msg: string) => void;
}) {
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [newDate, setNewDate] = useState(detail?.scheduled_date || "");
  const [reason, setReason] = useState("");
  const [rescheduling, setRescheduling] = useState(false);
  const tc = TYPE_CONFIG[job.job_type] || { label: job.job_type, letter: "?", stripe: "#8A8A8A" };
  const isCompleted = job.status === "completed";
  const d = detail || job;
  const addr = d.service_address;
  const cust = d.customer;

  const handleReschedule = async () => {
    if (!newDate) return; setRescheduling(true);
    try { await api.patch(`/jobs/${job.id}/reschedule`, { scheduledDate: newDate, reason, source: "dispatcher" }); toast("success", `Moved to ${new Date(newDate).toLocaleDateString()}`); setRescheduleOpen(false); await onRefresh(); }
    catch { toast("error", "Failed"); } finally { setRescheduling(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium" style={{ color: tc.stripe }}>{tc.label}</span>
        <span className="text-xs font-medium capitalize" style={{ color: isCompleted ? "var(--t-accent)" : "var(--t-warning)" }}>{job.status.replace(/_/g, " ")}</span>
        {d.asset?.subtype && <span className="rounded-md px-2 py-0.5 text-[11px] font-bold" style={{ background: "#F0F0F0", border: "1px solid #E0E0E0", color: "#0A0A0A" }}>{d.asset.subtype}</span>}
        {d.asset?.identifier && <span className="text-xs font-bold" style={{ color: "var(--t-accent)" }}>{d.asset.identifier}</span>}
      </div>
      {cust && (
        <div className="rounded-[20px] border p-4" style={{ borderColor: "var(--t-border)" }}>
          <p className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "var(--t-text-muted)" }}>Customer</p>
          <Link href={`/customers/${cust.id}`} className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>{cust.first_name} {cust.last_name}</Link>
          {cust.phone && <a href={`tel:${cust.phone}`} className="flex items-center gap-1.5 mt-2 text-xs" style={{ color: "var(--t-accent)" }}><Phone className="h-3 w-3" />{formatPhone(cust.phone)}</a>}
          {cust.email && <a href={`mailto:${cust.email}`} className="flex items-center gap-1.5 mt-1 text-xs" style={{ color: "var(--t-text-muted)" }}><Mail className="h-3 w-3" />{cust.email}</a>}
        </div>
      )}
      {addr && (
        <div className="rounded-[20px] border p-4" style={{ borderColor: "var(--t-border)" }}>
          <p className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "var(--t-text-muted)" }}>Service Address</p>
          <p className="text-sm" style={{ color: "var(--t-text-primary)" }}>{addr.street}</p>
          <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>{[addr.city, addr.state, addr.zip].filter(Boolean).join(", ")}</p>
          {d.placement_notes && <p className="text-xs mt-2 italic" style={{ color: "var(--t-text-muted)" }}>"{d.placement_notes}"</p>}
        </div>
      )}
      <div className="rounded-[20px] border p-4" style={{ borderColor: "var(--t-border)" }}>
        <p className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "var(--t-text-muted)" }}>Schedule</p>
        <div className="space-y-1.5 text-sm">
          {d.scheduled_date && <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Date</span><span className="font-medium" style={{ color: "var(--t-text-primary)" }}>{new Date(d.scheduled_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span></div>}
          {d.scheduled_window_start && <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Time</span><span style={{ color: "var(--t-text-primary)" }}>{fmtTime(d.scheduled_window_start)}{d.scheduled_window_end ? ` - ${fmtTime(d.scheduled_window_end)}` : ""}</span></div>}
          {d.rental_days && <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Rental</span><span style={{ color: "var(--t-text-primary)" }}>{d.rental_days} days</span></div>}
        </div>
      </div>
      {board && (
        <div className="rounded-[20px] border p-4" style={{ borderColor: "var(--t-border)" }}>
          <p className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "var(--t-text-muted)" }}>Assignment</p>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Driver</span><span style={{ color: job.assigned_driver ? "var(--t-text-primary)" : "var(--t-error)" }}>{job.assigned_driver ? `${job.assigned_driver.first_name} ${job.assigned_driver.last_name}` : "Unassigned"}</span></div>
            <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Asset</span><span style={{ color: "var(--t-text-primary)" }}>{d.asset?.identifier || "Not assigned"}</span></div>
          </div>
          <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--t-border)" }}>
            <Dropdown trigger={<button className="text-xs font-medium" style={{ color: "var(--t-accent)" }}>{job.assigned_driver ? "Reassign" : "Assign Driver"}</button>}>
              <button onClick={() => onAssign(job.id, null)} className="flex w-full items-center gap-2 px-3 py-2 text-xs" style={{ color: "var(--t-error)" }}>Unassign</button>
              {board.drivers.map(col => (
                <button key={col.driver.id} onClick={() => onAssign(job.id, col.driver.id)} className="flex w-full items-center gap-2 px-3 py-2 text-xs whitespace-nowrap" style={{ color: "var(--t-text-primary)" }}>
                  <div className="flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold" style={{ background: "var(--t-accent-soft)", color: "var(--t-accent)" }}>{col.driver.firstName[0]}{col.driver.lastName[0]}</div>
                  {col.driver.firstName} {col.driver.lastName}
                </button>
              ))}
            </Dropdown>
          </div>
        </div>
      )}
      {d.total_price > 0 && (
        <div className="rounded-[20px] border p-4" style={{ borderColor: "var(--t-border)" }}>
          <div className="flex justify-between items-center">
            <p className="text-[11px] uppercase tracking-wider" style={{ color: "var(--t-text-muted)" }}>Total</p>
            <p className="text-lg font-bold tabular-nums" style={{ color: "var(--t-accent)" }}>${Number(d.total_price).toLocaleString()}</p>
          </div>
        </div>
      )}
      {!isCompleted && job.status !== "cancelled" && (
        <>
          {!rescheduleOpen ? (
            <button onClick={() => { setRescheduleOpen(true); setNewDate(d.scheduled_date || ""); }} className="w-full rounded-full border py-2.5 text-xs font-semibold" style={{ borderColor: "var(--t-border)", color: "#3B82F6" }}>
              <Calendar className="h-3.5 w-3.5 inline mr-1.5" />Reschedule
            </button>
          ) : (
            <div className="rounded-[20px] border p-4 space-y-3" style={{ borderColor: "var(--t-border)" }}>
              <p className="text-xs font-semibold" style={{ color: "#3B82F6" }}>Reschedule Job</p>
              <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="w-full rounded-[10px] border px-3 py-2 text-sm outline-none" style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} />
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (optional)" className="w-full rounded-[10px] border px-3 py-2 text-sm outline-none" style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} />
              <div className="flex gap-2">
                <button onClick={handleReschedule} disabled={!newDate || rescheduling} className="flex-1 rounded-full py-2 text-xs font-semibold disabled:opacity-50" style={{ background: "#3B82F6", color: "#fff" }}>{rescheduling ? "Moving..." : "Confirm"}</button>
                <button onClick={() => setRescheduleOpen(false)} className="rounded-full px-4 py-2 text-xs" style={{ background: "var(--t-bg-card-hover)", color: "var(--t-text-muted)" }}>Cancel</button>
              </div>
            </div>
          )}
          <button onClick={async () => { if (!confirm("Cancel this job?")) return; try { await api.patch(`/jobs/${job.id}/status`, { status: "cancelled" }); toast("success", "Cancelled"); await onRefresh(); } catch { toast("error", "Failed"); } }}
            className="w-full rounded-full border py-2 text-xs font-medium" style={{ borderColor: "var(--t-error)", color: "var(--t-error)" }}>Cancel Job</button>
        </>
      )}
    </div>
  );
}
