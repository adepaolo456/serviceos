"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ChevronLeft, ChevronRight, Calendar, Clock, MapPin, UserPlus, Truck,
  Phone, Plus, Box, Search, CheckCircle2, RefreshCw, Zap, X,
  ChevronDown as ChevDown, ChevronUp as ChevUp, ArrowUp, ArrowDown,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatPhone } from "@/lib/utils";
import { useToast } from "@/components/toast";
import QuickView from "@/components/quick-view";
import Dropdown from "@/components/dropdown";

/* ---- Types ---- */

interface DispatchJob {
  id: string; job_number: string; job_type: string; service_type: string;
  status: string; priority: string; scheduled_window_start: string;
  scheduled_window_end: string; service_address: Record<string, string> | null;
  route_order: number | null; total_price: number;
  customer: { id: string; first_name: string; last_name: string } | null;
  asset: { id: string; identifier: string; subtype?: string } | null;
  assigned_driver: { id: string; first_name: string; last_name: string } | null;
  is_overdue?: boolean;
  extra_days?: number;
  rescheduled_by_customer?: boolean;
  rescheduled_from_date?: string;
}

interface Driver { id: string; firstName: string; lastName: string; phone: string; }

interface DriverColumn {
  driver: Driver;
  route: { id: string; status: string; total_stops: number } | null;
  jobs: DispatchJob[]; jobCount: number;
}

interface DispatchBoard { date: string; drivers: DriverColumn[]; unassigned: DispatchJob[]; }

/* ---- Constants ---- */

const TYPE_CONFIG: Record<string, { label: string; letter: string; cls: string }> = {
  delivery: { label: "Drop Off", letter: "D", cls: "bg-blue-500/15 text-blue-400" },
  pickup: { label: "Pick Up", letter: "P", cls: "bg-orange-500/15 text-orange-400" },
  exchange: { label: "Exchange", letter: "E", cls: "bg-purple-500/15 text-purple-400" },
};

const STATUS_BORDER: Record<string, string> = {
  pending: "border-l-zinc-500", confirmed: "border-l-blue-500", dispatched: "border-l-purple-500",
  en_route: "border-l-yellow-500", arrived: "border-l-teal-500", in_progress: "border-l-orange-500",
  completed: "border-l-emerald-500", cancelled: "border-l-red-500",
};

const FILTER_TABS = [
  { key: "all", label: "All" }, { key: "delivery", label: "Deliveries" },
  { key: "pickup", label: "Pickups" }, { key: "exchange", label: "Exchanges" },
  { key: "completed", label: "Completed" },
];

/* ---- Helpers ---- */

function today() { return new Date().toISOString().split("T")[0]; }
function shiftDate(d: string, n: number) { const dt = new Date(d + "T00:00:00"); dt.setDate(dt.getDate() + n); return dt.toISOString().split("T")[0]; }
function fmtDate(d: string) { return new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }); }
function fmtTime(t: string | null) { if (!t) return ""; const [h, m] = t.split(":"); const hr = parseInt(h); return `${hr === 0 ? 12 : hr > 12 ? hr - 12 : hr}:${m} ${hr >= 12 ? "PM" : "AM"}`; }
function jobTitle(job: DispatchJob) { const size = job.asset?.identifier || job.service_type?.replace(/_/g, " ") || ""; const type = TYPE_CONFIG[job.job_type]?.label || job.job_type; return `${size} ${type}`.trim(); }

function filterJobs(jobs: DispatchJob[], filter: string, search: string) {
  let filtered = jobs;
  if (filter === "completed") filtered = filtered.filter(j => j.status === "completed");
  else if (filter !== "all") filtered = filtered.filter(j => j.job_type === filter);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(j =>
      j.job_number.toLowerCase().includes(q) || j.customer?.first_name.toLowerCase().includes(q) ||
      j.customer?.last_name.toLowerCase().includes(q) || j.service_address?.street?.toLowerCase().includes(q) ||
      j.service_address?.city?.toLowerCase().includes(q));
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
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchBoard = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try { setBoard(await api.get<DispatchBoard>(`/dispatch/board?date=${date}`)); }
    catch { /* */ } finally { setLoading(false); setRefreshing(false); }
  }, [date]);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);
  useEffect(() => { const i = setInterval(() => fetchBoard(true), 30000); return () => clearInterval(i); }, [fetchBoard]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "Escape") { setSelectedJobId(null); setQuickViewJob(null); }
      else if (e.key === "ArrowLeft") setDate(d => shiftDate(d, -1));
      else if (e.key === "ArrowRight") setDate(d => shiftDate(d, 1));
      else if (e.key === "t" || e.key === "T") setDate(today());
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  /* ---- Find selected job ---- */
  const allJobs = board ? [...board.unassigned, ...board.drivers.flatMap(d => d.jobs)] : [];
  const selectedJob = selectedJobId ? allJobs.find(j => j.id === selectedJobId) || null : null;

  const findColumnForJob = (jobId: string): string => {
    if (!board) return "unassigned";
    if (board.unassigned.some(j => j.id === jobId)) return "unassigned";
    for (const col of board.drivers) { if (col.jobs.some(j => j.id === jobId)) return col.driver.id; }
    return "unassigned";
  };

  /* ---- Move job to a column — API call + full refetch ---- */
  const moveJobTo = async (jobId: string, targetDriverId: string | null) => {
    if (!board) return;
    const sourceCol = findColumnForJob(jobId);
    const targetCol = targetDriverId || "unassigned";
    if (sourceCol === targetCol) return;

    setBusyJobId(jobId);
    setSelectedJobId(null);

    let success = false;
    try {
      const result = await api.patch<{ id: string; assigned_driver_id: string | null }>(`/jobs/${jobId}/assign`, { assignedDriverId: targetDriverId });
      console.log("[dispatch] assign response:", result.id, "driver:", result.assigned_driver_id);
      const driverName = targetDriverId ? board.drivers.find(d => d.driver.id === targetDriverId)?.driver : null;
      toast("success", targetDriverId ? `Assigned to ${driverName?.firstName} ${driverName?.lastName}` : "Moved to Unassigned");
      success = true;
    } catch (err) {
      console.error("[dispatch] assign failed:", err);
      toast("error", err instanceof Error ? err.message : "Failed to move job");
    }

    // Always re-fetch from server to ensure UI matches DB
    try {
      const data = await api.get<DispatchBoard>(`/dispatch/board?date=${date}`);
      console.log("[dispatch] refetch: unassigned=", data.unassigned.length, "drivers=", data.drivers.map(d => `${d.driver.firstName}(${d.jobs.length})`).join(", "));
      setBoard(data);
    } catch (err) {
      console.error("[dispatch] refetch failed:", err);
    }
    setBusyJobId(null);
  };

  /* ---- Reorder within column ---- */
  const reorderJob = async (jobId: string, direction: "up" | "down") => {
    if (!board) return;
    const colId = findColumnForJob(jobId);
    const colJobs = colId === "unassigned" ? [...board.unassigned] : [...(board.drivers.find(d => d.driver.id === colId)?.jobs || [])];
    const idx = colJobs.findIndex(j => j.id === jobId);
    if (idx === -1) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= colJobs.length) return;

    [colJobs[idx], colJobs[newIdx]] = [colJobs[newIdx], colJobs[idx]];

    // Persist route order then refetch
    try {
      await Promise.all(colJobs.map((j, i) => api.patch(`/jobs/${j.id}`, { routeOrder: i + 1 }).catch(() => {})));
      await fetchBoard(true);
    } catch { /* best-effort */ }
  };

  /* ---- Computed ---- */
  const totalJobs = board ? board.unassigned.length + board.drivers.reduce((s, d) => s + d.jobs.length, 0) : 0;
  const driverCount = board?.drivers.length || 0;
  const unassignedCount = board?.unassigned.length || 0;
  const completedJobs = board ? board.drivers.reduce((s, d) => s + d.jobs.filter(j => j.status === "completed").length, 0) : 0;
  const totalStops = totalJobs - completedJobs;

  /* ---- All columns for the floating action bar ---- */
  const columnTargets = board ? [
    { id: "unassigned", label: "Unassigned", driverId: null },
    ...board.drivers.map(d => ({ id: d.driver.id, label: `${d.driver.firstName} ${d.driver.lastName}`, driverId: d.driver.id })),
  ] : [];

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col">
      {/* Top bar */}
      <div className="shrink-0 mb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button onClick={() => setDate(d => shiftDate(d, -1))} className="rounded-lg bg-dark-card border border-[#1E2D45] p-2 text-muted hover:text-white active:scale-95 transition-all"><ChevronLeft className="h-4 w-4" /></button>
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-lg border border-[#1E2D45] bg-[#111C2E] py-2 pl-10 pr-3 text-sm font-medium text-white outline-none focus:border-brand w-52" />
              </div>
              <button onClick={() => setDate(d => shiftDate(d, 1))} className="rounded-lg bg-dark-card border border-[#1E2D45] p-2 text-muted hover:text-white active:scale-95 transition-all"><ChevronRight className="h-4 w-4" /></button>
              <button onClick={() => setDate(today())} className={`ml-1 rounded-lg border px-3 py-2 text-xs font-medium transition-all active:scale-95 ${date === today() ? "bg-brand/10 border-brand/20 text-brand" : "bg-dark-card border-[#1E2D45] text-muted hover:text-white"}`}>Today</button>
            </div>
            <div className="hidden sm:flex items-center gap-2 text-sm text-muted">
              <span className="font-medium text-white">{fmtDate(date)}</span>
              <span>·</span><span>{totalJobs} jobs</span><span>·</span><span>{driverCount} drivers</span>
              {unassignedCount > 0 && <><span>·</span><span className="text-red-400 font-medium">{unassignedCount} unassigned</span></>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => fetchBoard(true)} disabled={refreshing} className="rounded-lg bg-dark-card border border-[#1E2D45] p-2 text-muted hover:text-white transition-all active:scale-95 disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <button className="flex items-center gap-1.5 rounded-lg bg-[#2ECC71] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1FA855] transition-all active:scale-95"><Zap className="h-3.5 w-3.5" /> Optimize Routes</button>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-3">
          <div className="flex gap-1">
            {FILTER_TABS.map(t => (
              <button key={t.key} onClick={() => setFilter(t.key)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${filter === t.key ? "bg-brand text-dark-primary" : "bg-dark-card text-muted hover:text-white"}`}>{t.label}</button>
            ))}
          </div>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search jobs or locations..."
              className="w-full rounded-lg bg-[#111C2E] border border-[#1E2D45] py-1.5 pl-9 pr-3 text-xs text-white placeholder-muted outline-none focus:border-brand" />
          </div>
        </div>
      </div>

      {/* Board */}
      <div className="flex flex-1 gap-3 min-h-0">
        <div className="flex-1 min-w-0 overflow-hidden">
          {loading ? (
            <div className="flex h-full gap-3 overflow-x-auto pb-2">
              {[1,2,3,4].map(i => (<div key={i} className="w-64 shrink-0 space-y-2"><div className="h-16 skeleton rounded-xl" />{[1,2,3].map(j => <div key={j} className="h-24 skeleton rounded-lg" />)}</div>))}
            </div>
          ) : !board ? (
            <div className="flex h-full items-center justify-center text-muted">Failed to load</div>
          ) : totalJobs === 0 && board.drivers.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center">
              <Truck className="h-14 w-14 text-muted/15 mb-3" />
              <h2 className="font-display text-base font-semibold text-white">No jobs for {fmtDate(date)}</h2>
              <p className="mt-1 text-xs text-muted">Schedule some deliveries!</p>
              <Link href="/" className="mt-3 flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-dark-primary hover:bg-brand-light active:scale-95 transition-all"><Plus className="h-3.5 w-3.5" /> New Job</Link>
            </div>
          ) : (
            <div className="flex h-full gap-2.5 overflow-x-auto pb-2">
              {/* Unassigned */}
              <Column id="unassigned" title="Unassigned" icon={<UserPlus className="h-3.5 w-3.5 text-red-400" />}
                count={board.unassigned.length} accentCls="bg-red-500/10 text-red-400"
                jobs={filterJobs(board.unassigned, filter, search)} drivers={board.drivers.map(d => d.driver)}
                onAssign={moveJobTo} selectedJobId={selectedJobId} onSelectJob={setSelectedJobId}
                onQuickView={setQuickViewJob} onReorder={reorderJob} busyJobId={busyJobId} isUnassigned />
              {/* Driver columns */}
              {board.drivers.map(col => {
                const completed = col.jobs.filter(j => j.status === "completed").length;
                return (
                  <Column key={col.driver.id} id={col.driver.id}
                    title={`${col.driver.firstName} ${col.driver.lastName}`}
                    icon={<div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/15 text-[10px] font-bold text-brand">{col.driver.firstName[0]}{col.driver.lastName[0]}</div>}
                    count={col.jobs.length}
                    progress={col.jobs.length > 0 ? { completed, total: col.jobs.length } : undefined}
                    phone={col.driver.phone}
                    jobs={filterJobs(col.jobs, filter, search)}
                    selectedJobId={selectedJobId} onSelectJob={setSelectedJobId}
                    onUnassign={(jid) => moveJobTo(jid, null)}
                    onQuickView={setQuickViewJob} onReorder={reorderJob} busyJobId={busyJobId} />
                );
              })}
              {board.drivers.length === 0 && board.unassigned.length > 0 && (
                <div className="flex w-56 shrink-0 flex-col items-center justify-center rounded-xl bg-[#111C2E] border border-dashed border-[#1E2D45] p-4">
                  <Truck className="h-8 w-8 text-muted/15 mb-2" /><p className="text-xs text-muted text-center">Add drivers in Settings &gt; Team</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Floating Action Bar — appears when a job is selected */}
      {selectedJob && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className="flex items-center gap-2 rounded-2xl bg-[#111C2E] border border-[#2ECC71]/30 shadow-2xl shadow-black/40 px-4 py-3">
            <span className="text-xs text-muted mr-1">Move:</span>
            <span className="text-xs font-semibold text-white truncate max-w-[180px]">
              {selectedJob.customer ? `${selectedJob.customer.first_name} ${selectedJob.customer.last_name}` : selectedJob.job_number}
            </span>
            <span className="text-xs text-muted mx-1">→</span>
            {columnTargets.map(col => {
              const isCurrent = findColumnForJob(selectedJob.id) === col.id;
              return (
                <button key={col.id} onClick={() => moveJobTo(selectedJob.id, col.driverId)} disabled={isCurrent}
                  className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all active:scale-95 ${
                    isCurrent ? "bg-dark-elevated text-muted/50 cursor-not-allowed"
                    : col.id === "unassigned" ? "bg-red-500/15 text-red-400 hover:bg-red-500/25"
                    : "bg-brand/15 text-brand hover:bg-brand/25"
                  }`}>
                  {col.label}
                </button>
              );
            })}
            <button onClick={() => setSelectedJobId(null)} className="ml-1 rounded-lg p-1.5 text-muted hover:text-white hover:bg-dark-elevated transition-all">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Bottom Bar */}
      {!loading && board && totalJobs > 0 && !selectedJob && (
        <div className="shrink-0 mt-3 flex items-center justify-between rounded-xl bg-[#111C2E] border border-[#1E2D45] px-5 py-3">
          <div className="flex items-center gap-5 text-xs text-muted">
            <span><span className="text-white font-semibold">{totalStops}</span> stops remaining</span>
            <span><span className="text-white font-semibold">{completedJobs}</span> completed</span>
            <span><span className="text-white font-semibold">{driverCount}</span> active drivers</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-lg border border-[#1E2D45] px-3 py-1.5 text-xs font-medium text-muted hover:text-white transition-colors">Print Route Sheets</button>
            <button className="rounded-lg bg-brand/10 border border-brand/20 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/20 transition-colors">Send Routes to Drivers</button>
          </div>
        </div>
      )}

      {/* QuickView */}
      <QuickView isOpen={!!quickViewJob} onClose={() => setQuickViewJob(null)}
        title={quickViewJob ? jobTitle(quickViewJob) : ""} subtitle={quickViewJob?.job_number}
        actions={quickViewJob ? <Link href={`/jobs/${quickViewJob.id}`} className="rounded-lg bg-dark-elevated px-3 py-1.5 text-xs font-medium text-foreground hover:bg-dark-card-hover transition-colors">View Full Detail &rarr;</Link> : undefined}
        footer={quickViewJob ? (
          <div className="flex gap-2">
            <button onClick={() => setQuickViewJob(null)} className="flex-1 rounded-lg bg-dark-elevated py-2 text-xs font-medium text-muted hover:text-white transition-colors">Close</button>
            <Link href={`/jobs/${quickViewJob.id}`} className="flex-1 rounded-lg bg-brand py-2 text-xs font-semibold text-dark-primary text-center hover:bg-brand-light transition-colors">View Job</Link>
          </div>
        ) : undefined}
      >
        {quickViewJob && <JobQuickViewContent job={quickViewJob} />}
      </QuickView>
    </div>
  );
}

/* ======== Column ======== */

function Column({ id, title, icon, count, accentCls, progress, phone, jobs, drivers, onAssign, onUnassign, selectedJobId, onSelectJob, onQuickView, onReorder, busyJobId, isUnassigned }: {
  id: string; title: string; icon: React.ReactNode; count: number;
  accentCls?: string; progress?: { completed: number; total: number }; phone?: string;
  jobs: DispatchJob[]; drivers?: Driver[];
  onAssign?: (jobId: string, driverId: string | null) => void;
  onUnassign?: (jobId: string) => void;
  selectedJobId: string | null; onSelectJob: (id: string | null) => void;
  onQuickView?: (job: DispatchJob) => void;
  onReorder: (jobId: string, dir: "up" | "down") => void;
  busyJobId?: string | null;
  isUnassigned?: boolean;
}) {
  const storageKey = `dispatch-col-${id}`;
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && localStorage.getItem(storageKey) === "1");
  const toggleCollapse = () => { const n = !collapsed; setCollapsed(n); localStorage.setItem(storageKey, n ? "1" : "0"); };

  if (collapsed) {
    return (
      <div onClick={toggleCollapse}
        className="flex w-[60px] shrink-0 cursor-pointer flex-col items-center rounded-xl bg-[#111C2E] border border-[#1E2D45] py-3 hover:bg-[#162033] transition-all">
        <ChevDown className="h-3.5 w-3.5 text-muted mb-2" />
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${accentCls || "bg-dark-elevated text-foreground"}`}>{count}</span>
        <p className="mt-2 text-[9px] text-muted font-medium" style={{ writingMode: "vertical-lr" }}>{title}</p>
      </div>
    );
  }

  return (
    <div className={`flex shrink-0 flex-col rounded-xl bg-[#111C2E] border border-[#1E2D45] transition-all ${isUnassigned ? "min-w-[280px] w-[280px]" : "min-w-[300px] w-[300px]"}`}>
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-[#1E2D45] shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={toggleCollapse} className="text-muted hover:text-white p-0.5 -ml-0.5 shrink-0"><ChevUp className="h-3.5 w-3.5" /></button>
            {typeof icon === "object" && "type" in (icon as object)
              ? <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${accentCls || "bg-dark-elevated"}`}>{icon}</div>
              : icon}
            <div>
              <p className="text-xs font-semibold text-white truncate max-w-[120px]">{title}</p>
              {phone && <a href={`tel:${phone}`} className="text-[10px] text-muted hover:text-brand" onClick={e => e.stopPropagation()}><Phone className="inline h-2 w-2 mr-0.5" />{formatPhone(phone)}</a>}
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

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 max-h-[calc(100vh-280px)]" style={{ minHeight: 200 }}>
        {jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8" style={{ minHeight: 160 }}>
            {isUnassigned
              ? <><CheckCircle2 className="mx-auto h-6 w-6 text-emerald-400/40 mb-1" /><p className="text-[10px] text-emerald-400">All jobs assigned</p></>
              : <><Box className="mx-auto h-6 w-6 text-muted/15 mb-1" /><p className="text-[10px] text-muted">No jobs assigned</p></>}
          </div>
        ) : jobs.map((job, i) => (
          <JobCard key={job.id} job={job} order={i + 1} isFirst={i === 0} isLast={i === jobs.length - 1}
            isSelected={selectedJobId === job.id}
            isBusy={busyJobId === job.id}
            drivers={isUnassigned ? drivers : undefined}
            onAssign={isUnassigned ? onAssign : undefined}
            onUnassign={!isUnassigned ? onUnassign : undefined}
            onSelect={() => onSelectJob(selectedJobId === job.id ? null : job.id)}
            onQuickView={() => onQuickView?.(job)}
            onReorder={onReorder} />
        ))}
      </div>
    </div>
  );
}

/* ======== Job Card ======== */

function JobCard({ job, order, isFirst, isLast, isSelected, isBusy, drivers, onAssign, onUnassign, onSelect, onQuickView, onReorder }: {
  job: DispatchJob; order: number; isFirst: boolean; isLast: boolean; isSelected: boolean; isBusy?: boolean;
  drivers?: Driver[];
  onAssign?: (jobId: string, driverId: string | null) => void;
  onUnassign?: (jobId: string) => void;
  onSelect: () => void;
  onQuickView: () => void;
  onReorder: (jobId: string, dir: "up" | "down") => void;
}) {
  const isCompleted = job.status === "completed";
  const tc = TYPE_CONFIG[job.job_type] || { label: job.job_type, letter: "?", cls: "bg-zinc-500/10 text-zinc-400" };
  const statusBorder = STATUS_BORDER[job.status] || "border-l-zinc-500";
  const addr = job.service_address;
  const addrStr = addr ? [addr.street, addr.city, addr.state].filter(Boolean).join(", ") : "";

  return (
    <div className={`relative group rounded-lg bg-[#162033] border border-l-[3px] ${statusBorder} p-2.5 pl-3 transition-all duration-200 ${
      isSelected ? "ring-2 ring-[#2ECC71] border-[#2ECC71]/40 shadow-lg shadow-[#2ECC71]/10" : "border-[#1E2D45] hover:border-[#2ECC71]/20"
    } ${isCompleted ? "opacity-60" : ""} ${isBusy ? "opacity-50 pointer-events-none" : ""}`}>

      {/* Loading spinner overlay */}
      {isBusy && (
        <div className="absolute inset-0 flex items-center justify-center z-20 rounded-lg bg-[#162033]/60">
          <RefreshCw className="h-4 w-4 text-brand animate-spin" />
        </div>
      )}

      {/* Top-right action buttons */}
      <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1">
        {/* Reorder arrows — shown on hover */}
        {!isFirst && (
          <button onClick={(e) => { e.stopPropagation(); onReorder(job.id, "up"); }}
            className="rounded p-0.5 text-muted/30 hover:text-white hover:bg-dark-elevated transition-all opacity-0 group-hover:opacity-100">
            <ArrowUp className="h-3 w-3" />
          </button>
        )}
        {!isLast && (
          <button onClick={(e) => { e.stopPropagation(); onReorder(job.id, "down"); }}
            className="rounded p-0.5 text-muted/30 hover:text-white hover:bg-dark-elevated transition-all opacity-0 group-hover:opacity-100">
            <ArrowDown className="h-3 w-3" />
          </button>
        )}

        {/* Assign dropdown — unassigned cards */}
        {drivers && onAssign && (
          <div onClick={e => e.stopPropagation()}>
            <Dropdown trigger={
              <button className="flex items-center gap-0.5 rounded bg-brand/15 border border-brand/20 px-1.5 py-0.5 text-[9px] font-semibold text-brand hover:bg-brand/25 transition-all">
                <UserPlus className="h-2.5 w-2.5" /> Assign
              </button>
            } align="right">
              {drivers.map(d => (
                <button key={d.id} onClick={() => onAssign(job.id, d.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-dark-card-hover whitespace-nowrap">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-brand/10 text-[8px] font-bold text-brand">{d.firstName[0]}{d.lastName[0]}</div>
                  {d.firstName} {d.lastName}
                </button>
              ))}
            </Dropdown>
          </div>
        )}

        {/* Unassign button — driver cards */}
        {onUnassign && (
          <button onClick={(e) => { e.stopPropagation(); onUnassign(job.id); }}
            className="rounded bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-red-400 hover:bg-red-500/20 transition-all opacity-0 group-hover:opacity-100">
            <X className="inline h-2.5 w-2.5" />
          </button>
        )}
      </div>

      {/* Card body — left-click to select, double-click to QuickView */}
      <div onClick={onSelect} onDoubleClick={(e) => { e.stopPropagation(); onQuickView(); }} className="cursor-pointer">
        {/* Title row */}
        <div className="flex items-start justify-between gap-2 mb-1.5 pr-16">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-dark-elevated text-[9px] font-bold text-muted tabular-nums">{order}</span>
            <span className={`shrink-0 flex h-5 w-5 items-center justify-center rounded text-[9px] font-bold ${tc.cls}`}>{tc.letter}</span>
            <span className="text-xs font-semibold text-white truncate">{jobTitle(job)}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {job.rescheduled_by_customer && <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[8px] font-bold text-blue-400">RESCHEDULED</span>}
            {job.is_overdue && <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[8px] font-bold text-red-400">OVERDUE {job.extra_days}d</span>}
            {job.asset?.identifier && <span className="rounded bg-brand/10 text-brand px-1.5 py-0.5 text-[9px] font-bold">{job.asset.identifier}</span>}
            {job.priority === "high" && <span className="rounded bg-red-500/15 px-1 py-0.5 text-[8px] font-bold text-red-400">H</span>}
            {isCompleted && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
          </div>
        </div>

        <p className="text-[11px] font-medium text-foreground truncate">
          {job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : job.job_number}
        </p>
        {addrStr && <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted truncate"><MapPin className="h-2.5 w-2.5 shrink-0" />{addrStr}</p>}
        {(job.scheduled_window_start || job.scheduled_window_end) && (
          <p className="mt-1 flex items-center gap-1 text-[10px] text-muted">
            <Clock className="h-2.5 w-2.5" />{fmtTime(job.scheduled_window_start)}{job.scheduled_window_end && ` – ${fmtTime(job.scheduled_window_end)}`}
          </p>
        )}
      </div>
    </div>
  );
}

/* ======== QuickView Content ======== */

function JobQuickViewContent({ job }: { job: DispatchJob }) {
  const tc = TYPE_CONFIG[job.job_type] || { label: job.job_type, letter: "?", cls: "bg-zinc-500/10 text-zinc-400" };
  const addr = job.service_address;
  const isCompleted = job.status === "completed";

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${tc.cls}`}>{tc.label}</span>
        <span className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${isCompleted ? "bg-emerald-500/10 text-emerald-400" : "bg-yellow-500/10 text-yellow-400"}`}>{job.status.replace(/_/g, " ")}</span>
        {job.priority === "high" && <span className="rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-bold text-red-400">High Priority</span>}
      </div>
      <div className="rounded-lg bg-dark-card border border-[#1E2D45] p-4">
        <p className="text-xs text-muted uppercase tracking-wider mb-2">Customer</p>
        <p className="text-sm font-semibold text-white">{job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : "No customer"}</p>
      </div>
      {addr && (
        <div className="rounded-lg bg-dark-card border border-[#1E2D45] p-4">
          <p className="text-xs text-muted uppercase tracking-wider mb-2">Service Address</p>
          <p className="text-sm text-white">{addr.street}</p>
          <p className="text-xs text-muted">{[addr.city, addr.state, addr.zip].filter(Boolean).join(", ")}</p>
        </div>
      )}
      {(job.scheduled_window_start || job.scheduled_window_end) && (
        <div className="rounded-lg bg-dark-card border border-[#1E2D45] p-4">
          <p className="text-xs text-muted uppercase tracking-wider mb-2">Time Window</p>
          <p className="text-sm text-white flex items-center gap-2"><Clock className="h-4 w-4 text-muted" />{fmtTime(job.scheduled_window_start)}{job.scheduled_window_end && ` – ${fmtTime(job.scheduled_window_end)}`}</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-dark-card border border-[#1E2D45] p-4">
          <p className="text-xs text-muted uppercase tracking-wider mb-2">Asset</p>
          <p className="text-sm font-medium text-white">{job.asset?.identifier || "Not assigned"}</p>
        </div>
        <div className="rounded-lg bg-dark-card border border-[#1E2D45] p-4">
          <p className="text-xs text-muted uppercase tracking-wider mb-2">Driver</p>
          <p className="text-sm font-medium text-white">{job.assigned_driver ? `${job.assigned_driver.first_name} ${job.assigned_driver.last_name}` : "Unassigned"}</p>
        </div>
      </div>
      {job.total_price > 0 && (
        <div className="rounded-lg bg-brand/5 border border-brand/20 p-4">
          <p className="text-xs text-brand uppercase tracking-wider mb-1">Price</p>
          <p className="text-xl font-bold text-brand tabular-nums">${Number(job.total_price).toLocaleString()}</p>
        </div>
      )}
    </div>
  );
}
