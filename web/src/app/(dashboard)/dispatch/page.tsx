"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ChevronLeft, ChevronRight, Calendar, Clock, MapPin, UserPlus, Truck,
  Phone, Plus, Box, Search, CheckCircle2, RefreshCw, Zap, X, ExternalLink,
  ChevronDown as ChevDown, ChevronUp as ChevUp, ArrowUp, ArrowDown, Navigation, Mail, Copy,
} from "lucide-react";
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
  customer: { id: string; first_name: string; last_name: string; phone?: string; email?: string } | null;
  asset: { id: string; identifier: string; subtype?: string } | null;
  assigned_driver: { id: string; first_name: string; last_name: string } | null;
  is_overdue?: boolean;
  extra_days?: number;
  rescheduled_by_customer?: boolean;
  rescheduled_from_date?: string;
  is_failed_trip?: boolean;
  failed_reason?: string;
  source?: string;
}

interface Driver { id: string; firstName: string; lastName: string; phone: string; }

interface DriverColumn {
  driver: Driver;
  route: { id: string; status: string; total_stops: number } | null;
  jobs: DispatchJob[]; jobCount: number;
}

interface DispatchBoard { date: string; drivers: DriverColumn[]; unassigned: DispatchJob[]; }

/* ---- Constants ---- */

const TYPE_CONFIG: Record<string, { label: string; letter: string; color: string }> = {
  delivery: { label: "Drop Off", letter: "D", color: "var(--t-accent)" },
  pickup: { label: "Pick Up", letter: "P", color: "var(--t-warning)" },
  exchange: { label: "Exchange", letter: "E", color: "#a78bfa" },
  dump_run: { label: "Dump Run", letter: "DR", color: "var(--t-warning)" },
};

const STATUS_LEFT_BORDER: Record<string, string> = {
  pending: "var(--t-warning)",
  confirmed: "var(--t-accent)",
  dispatched: "#a78bfa",
  en_route: "var(--t-warning)",
  arrived: "#2dd4bf",
  in_progress: "var(--t-warning)",
  completed: "var(--t-text-muted)",
  cancelled: "var(--t-error)",
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
  const [qvDetail, setQvDetail] = useState<any>(null);
  const [qvLoading, setQvLoading] = useState(false);
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
              style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}>
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
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search jobs or locations..."
              className="w-full rounded-[20px] py-1.5 pl-9 pr-3 text-xs outline-none transition-all duration-150"
              style={{ background: "rgba(255,255,255,0.06)", borderWidth: 1, borderStyle: "solid", borderColor: "rgba(255,255,255,0.08)", color: "var(--t-frame-text)" }} />
          </div>
        </div>
      </div>

      {/* Board */}
      <div className="flex flex-1 gap-3 min-h-0">
        <div className="flex-1 min-w-0 overflow-hidden">
          {loading ? (
            <div className="flex h-full gap-3 overflow-x-auto pb-2">
              {[1,2,3,4].map(i => (<div key={i} className="w-64 shrink-0 space-y-2"><div className="h-16 skeleton rounded-[20px]" />{[1,2,3].map(j => <div key={j} className="h-24 skeleton rounded-[20px]" />)}</div>))}
            </div>
          ) : !board ? (
            <div className="flex h-full items-center justify-center" style={{ color: "var(--t-text-muted)" }}>Failed to load</div>
          ) : totalJobs === 0 && board.drivers.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center">
              <Truck className="h-14 w-14 mb-3" style={{ color: "var(--t-text-muted)", opacity: 0.15 }} />
              <h2 className="text-base font-semibold" style={{ color: "var(--t-text-primary)", letterSpacing: "-0.025em" }}>No jobs for {fmtDate(date)}</h2>
              <p className="mt-1 text-xs" style={{ color: "var(--t-text-muted)" }}>Schedule some deliveries!</p>
              <Link href="/" className="mt-3 flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold active:scale-95 transition-all duration-150"
                style={{ background: "var(--t-accent)", color: "#000" }}>
                <Plus className="h-3.5 w-3.5" /> New Job
              </Link>
            </div>
          ) : (
            <div className="flex h-full gap-2.5 overflow-x-auto pb-2">
              {/* Unassigned */}
              <Column id="unassigned" title="Unassigned" icon={<UserPlus className="h-3.5 w-3.5" style={{ color: "var(--t-warning)" }} />}
                count={board.unassigned.length} isUnassignedHeader
                jobs={filterJobs(board.unassigned, filter, search)} drivers={board.drivers.map(d => d.driver)}
                onAssign={moveJobTo} selectedJobId={selectedJobId} onSelectJob={setSelectedJobId}
                onQuickView={(j) => { setQuickViewJob(j); setQvLoading(true); setQvDetail(null); api.get(`/jobs/${j.id}`).then(setQvDetail).catch(() => {}).finally(() => setQvLoading(false)); }}
                onReorder={reorderJob} busyJobId={busyJobId} isUnassigned />
              {/* Driver columns */}
              {board.drivers.map(col => {
                const completed = col.jobs.filter(j => j.status === "completed").length;
                return (
                  <Column key={col.driver.id} id={col.driver.id}
                    title={`${col.driver.firstName} ${col.driver.lastName}`}
                    icon={<div className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold" style={{ background: "var(--t-accent-soft)", color: "var(--t-accent)" }}>{col.driver.firstName[0]}{col.driver.lastName[0]}</div>}
                    count={col.jobs.length}
                    progress={col.jobs.length > 0 ? { completed, total: col.jobs.length } : undefined}
                    phone={col.driver.phone}
                    jobs={filterJobs(col.jobs, filter, search)}
                    selectedJobId={selectedJobId} onSelectJob={setSelectedJobId}
                    onUnassign={(jid) => moveJobTo(jid, null)}
                    onQuickView={(j) => { setQuickViewJob(j); setQvLoading(true); setQvDetail(null); api.get(`/jobs/${j.id}`).then(setQvDetail).catch(() => {}).finally(() => setQvLoading(false)); }}
                    onReorder={reorderJob} busyJobId={busyJobId} />
                );
              })}
              {board.drivers.length === 0 && board.unassigned.length > 0 && (
                <div className="flex w-56 shrink-0 flex-col items-center justify-center rounded-[20px] border border-dashed p-4"
                  style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
                  <Truck className="h-8 w-8 mb-2" style={{ color: "var(--t-text-muted)", opacity: 0.15 }} />
                  <p className="text-xs text-center" style={{ color: "var(--t-text-muted)" }}>Add drivers in Settings &gt; Team</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Floating Action Bar -- appears when a job is selected */}
      {selectedJob && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className="flex items-center gap-2 rounded-2xl border shadow-2xl shadow-black/40 px-4 py-3"
            style={{ background: "var(--t-bg-card)", borderColor: "var(--t-accent)" }}>
            <span className="text-xs mr-1" style={{ color: "var(--t-text-muted)" }}>Move:</span>
            <span className="text-xs font-semibold truncate max-w-[180px]" style={{ color: "var(--t-text-primary)" }}>
              {selectedJob.customer ? `${selectedJob.customer.first_name} ${selectedJob.customer.last_name}` : selectedJob.job_number}
            </span>
            <span className="text-xs mx-1" style={{ color: "var(--t-text-muted)" }}>→</span>
            {columnTargets.map(col => {
              const isCurrent = findColumnForJob(selectedJob.id) === col.id;
              return (
                <button key={col.id} onClick={() => moveJobTo(selectedJob.id, col.driverId)} disabled={isCurrent}
                  className="rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all duration-150 active:scale-95"
                  style={{
                    background: isCurrent ? "var(--t-bg-card-hover)" : col.id === "unassigned" ? "var(--t-warning-soft)" : "var(--t-accent-soft)",
                    color: isCurrent ? "var(--t-text-muted)" : col.id === "unassigned" ? "var(--t-warning)" : "var(--t-accent)",
                    cursor: isCurrent ? "not-allowed" : "pointer",
                    opacity: isCurrent ? 0.5 : 1,
                  }}>
                  {col.label}
                </button>
              );
            })}
            <button onClick={() => setSelectedJobId(null)}
              className="ml-1 rounded-full p-1.5 transition-all duration-150"
              style={{ color: "var(--t-text-muted)" }}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Bottom Bar */}
      {!loading && board && totalJobs > 0 && !selectedJob && (
        <div className="shrink-0 mt-3 flex items-center justify-between rounded-[20px] border px-5 py-3"
          style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
          <div className="flex items-center gap-5 text-xs" style={{ color: "var(--t-text-muted)" }}>
            <span><span className="font-semibold" style={{ color: "var(--t-text-primary)" }}>{totalStops}</span> stops remaining</span>
            <span><span className="font-semibold" style={{ color: "var(--t-text-primary)" }}>{completedJobs}</span> completed</span>
            <span><span className="font-semibold" style={{ color: "var(--t-text-primary)" }}>{driverCount}</span> active drivers</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-150"
              style={{ borderColor: "var(--t-border)", color: "var(--t-text-muted)", background: "transparent" }}>
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
        title={quickViewJob ? jobTitle(quickViewJob) : ""} subtitle={quickViewJob?.job_number}
        actions={quickViewJob ? <Link href={`/jobs/${quickViewJob.id}`} className="rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150" style={{ background: "var(--t-bg-card-hover)", color: "var(--t-text-primary)" }}><ExternalLink className="h-3 w-3 inline mr-1" />Full Detail</Link> : undefined}
        footer={quickViewJob ? (
          <div className="flex gap-2">
            {quickViewJob.customer?.phone && (
              <a href={`tel:${quickViewJob.customer.phone}`}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-semibold transition-all duration-150"
                style={{ background: "var(--t-accent)", color: "#000" }}>
                <Phone className="h-3.5 w-3.5" /> Call Customer
              </a>
            )}
            {quickViewJob.service_address && (
              <button onClick={() => { const a = quickViewJob.service_address!; const q = [a.street, a.city, a.state].filter(Boolean).join(", "); window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`, "_blank"); }}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-semibold transition-all duration-150 border"
                style={{ background: "transparent", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}>
                <Navigation className="h-3.5 w-3.5" /> Navigate
              </button>
            )}
          </div>
        ) : undefined}
      >
        {quickViewJob && (
          <JobQuickViewContent
            job={quickViewJob}
            detail={qvDetail}
            loading={qvLoading}
            board={board}
            date={date}
            onAssign={moveJobTo}
            onRefresh={() => fetchBoard(true)}
            toast={toast}
          />
        )}
      </QuickView>
    </div>
  );
}

/* ======== Column ======== */

function Column({ id, title, icon, count, isUnassignedHeader, progress, phone, jobs, drivers, onAssign, onUnassign, selectedJobId, onSelectJob, onQuickView, onReorder, busyJobId, isUnassigned }: {
  id: string; title: string; icon: React.ReactNode; count: number;
  isUnassignedHeader?: boolean; progress?: { completed: number; total: number }; phone?: string;
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
        className="flex w-[60px] shrink-0 cursor-pointer flex-col items-center rounded-[20px] border py-3 transition-all duration-150"
        style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
        <ChevDown className="h-3.5 w-3.5 mb-2" style={{ color: "var(--t-text-muted)" }} />
        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums"
          style={{ background: "var(--t-bg-card-hover)", color: "var(--t-text-primary)" }}>{count}</span>
        <p className="mt-2 text-[9px] font-medium" style={{ writingMode: "vertical-lr", color: "var(--t-text-muted)" }}>{title}</p>
      </div>
    );
  }

  return (
    <div className={`flex shrink-0 flex-col rounded-[20px] border transition-all duration-150 ${isUnassigned ? "min-w-[280px] w-[280px]" : "min-w-[300px] w-[300px]"}`}
      style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
      {/* Header */}
      <div className="px-3 py-2.5 shrink-0" style={{ borderBottom: "1px solid var(--t-border)" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={toggleCollapse} className="p-0.5 -ml-0.5 shrink-0 transition-all duration-150" style={{ color: "var(--t-text-muted)" }}>
              <ChevUp className="h-3.5 w-3.5" />
            </button>
            {typeof icon === "object" && "type" in (icon as object)
              ? <div className="flex h-7 w-7 items-center justify-center rounded-[10px]" style={{ background: "var(--t-bg-card-hover)" }}>{icon}</div>
              : icon}
            <div>
              <p className="text-xs font-bold truncate max-w-[120px]"
                style={{ color: isUnassignedHeader ? "var(--t-warning)" : "var(--t-text-primary)" }}>{title}</p>
              {phone && <a href={`tel:${phone}`} className="text-[10px] transition-all duration-150" style={{ color: "var(--t-text-muted)" }} onClick={e => e.stopPropagation()}><Phone className="inline h-2 w-2 mr-0.5" />{formatPhone(phone)}</a>}
            </div>
          </div>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums"
            style={{ color: "var(--t-text-muted)" }}>{count}</span>
        </div>
        {progress && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1 flex-1 rounded-full overflow-hidden" style={{ background: "var(--t-bg-card-hover)" }}>
              <div className="h-full rounded-full transition-all duration-150" style={{ width: `${(progress.completed / progress.total) * 100}%`, background: "var(--t-accent)" }} />
            </div>
            <span className="text-[9px] tabular-nums" style={{ color: "var(--t-text-muted)" }}>{progress.completed}/{progress.total}</span>
          </div>
        )}
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 max-h-[calc(100vh-280px)]" style={{ minHeight: 200 }}>
        {jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8" style={{ minHeight: 160 }}>
            {isUnassigned
              ? <><CheckCircle2 className="mx-auto h-6 w-6 mb-1" style={{ color: "var(--t-accent)", opacity: 0.4 }} /><p className="text-[10px]" style={{ color: "var(--t-accent)" }}>All jobs assigned</p></>
              : <><Box className="mx-auto h-6 w-6 mb-1" style={{ color: "var(--t-text-muted)", opacity: 0.15 }} /><p className="text-[10px]" style={{ color: "var(--t-text-muted)" }}>No jobs assigned</p></>}
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
  const tc = TYPE_CONFIG[job.job_type] || { label: job.job_type, letter: "?", color: "var(--t-text-muted)" };
  const statusColor = STATUS_LEFT_BORDER[job.status] || "var(--t-text-muted)";
  const addr = job.service_address;
  const addrStr = addr ? [addr.street, addr.city, addr.state].filter(Boolean).join(", ") : "";

  return (
    <div
      className="relative group rounded-[10px] border p-2.5 pl-3 transition-all duration-150"
      style={{
        background: "var(--t-bg-card)",
        borderColor: isSelected ? "var(--t-accent)" : "var(--t-border)",
        borderLeftWidth: 3,
        borderLeftColor: statusColor,
        opacity: isCompleted ? 0.6 : isBusy ? 0.5 : 1,
        pointerEvents: isBusy ? "none" : "auto",
        boxShadow: isSelected ? "0 0 12px rgba(0,0,0,0.2)" : "none",
      }}>

      {/* Loading spinner overlay */}
      {isBusy && (
        <div className="absolute inset-0 flex items-center justify-center z-20 rounded-[10px]" style={{ background: "var(--t-bg-card)", opacity: 0.6 }}>
          <RefreshCw className="h-4 w-4 animate-spin" style={{ color: "var(--t-accent)" }} />
        </div>
      )}

      {/* Top-right action buttons */}
      <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1">
        {/* Reorder arrows -- shown on hover */}
        {!isFirst && (
          <button onClick={(e) => { e.stopPropagation(); onReorder(job.id, "up"); }}
            className="rounded p-0.5 transition-all duration-150 opacity-0 group-hover:opacity-100"
            style={{ color: "var(--t-text-muted)" }}>
            <ArrowUp className="h-3 w-3" />
          </button>
        )}
        {!isLast && (
          <button onClick={(e) => { e.stopPropagation(); onReorder(job.id, "down"); }}
            className="rounded p-0.5 transition-all duration-150 opacity-0 group-hover:opacity-100"
            style={{ color: "var(--t-text-muted)" }}>
            <ArrowDown className="h-3 w-3" />
          </button>
        )}

        {/* Assign dropdown -- unassigned cards */}
        {drivers && onAssign && (
          <div onClick={e => e.stopPropagation()}>
            <Dropdown trigger={
              <button className="flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold transition-all duration-150"
                style={{ background: "var(--t-accent-soft)", borderColor: "var(--t-accent)", color: "var(--t-accent)" }}>
                <UserPlus className="h-2.5 w-2.5" /> Assign
              </button>
            } align="right">
              {drivers.map(d => (
                <button key={d.id} onClick={() => onAssign(job.id, d.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs whitespace-nowrap transition-all duration-150"
                  style={{ color: "var(--t-text-primary)" }}>
                  <div className="flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold"
                    style={{ background: "var(--t-accent-soft)", color: "var(--t-accent)" }}>{d.firstName[0]}{d.lastName[0]}</div>
                  {d.firstName} {d.lastName}
                </button>
              ))}
            </Dropdown>
          </div>
        )}

        {/* Unassign button -- driver cards */}
        {onUnassign && (
          <button onClick={(e) => { e.stopPropagation(); onUnassign(job.id); }}
            className="rounded-full border px-1.5 py-0.5 text-[9px] font-semibold transition-all duration-150 opacity-0 group-hover:opacity-100"
            style={{ background: "var(--t-error-soft)", borderColor: "var(--t-error)", color: "var(--t-error)" }}>
            <X className="inline h-2.5 w-2.5" />
          </button>
        )}

        {/* Move button -- opens floating bar for driver assignment */}
        <button onClick={(e) => { e.stopPropagation(); onSelect(); }}
          className="rounded-full px-1.5 py-0.5 text-[9px] font-medium transition-all duration-150 opacity-0 group-hover:opacity-100"
          style={{ background: "var(--t-bg-card-hover)", color: "var(--t-text-muted)" }}
          title="Move to another column">
          ↔
        </button>
      </div>

      {/* Card body -- click to open QuickView */}
      <div onClick={onQuickView} className="cursor-pointer">
        {/* Title row */}
        <div className="flex items-start justify-between gap-2 mb-1.5 pr-16">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold tabular-nums"
              style={{ background: "var(--t-bg-card-hover)", color: "var(--t-text-muted)" }}>{order}</span>
            <span className="shrink-0 text-[9px] font-bold" style={{ color: tc.color }}>{tc.letter}</span>
            <span className="text-xs font-semibold truncate" style={{ color: "var(--t-text-primary)" }}>{jobTitle(job)}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {job.is_failed_trip && <span className="text-[8px] font-bold" style={{ color: "var(--t-error)" }}>FAILED</span>}
            {job.source === "rescheduled_from_failure" && <span className="text-[8px] font-bold" style={{ color: "var(--t-warning)" }}>FROM FAILED</span>}
            {job.rescheduled_by_customer && <span className="text-[8px] font-bold" style={{ color: "#60a5fa" }}>RESCHEDULED</span>}
            {job.is_overdue && <span className="text-[8px] font-bold" style={{ color: "var(--t-error)" }}>OVERDUE {job.extra_days}d</span>}
            {job.asset?.identifier && <span className="text-[9px] font-bold" style={{ color: "var(--t-accent)" }}>{job.asset.identifier}</span>}
            {job.priority === "high" && <span className="text-[8px] font-bold" style={{ color: "var(--t-error)" }}>H</span>}
            {isCompleted && <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "var(--t-accent)" }} />}
          </div>
        </div>

        <p className="text-[11px] font-semibold" style={{ color: "var(--t-text-primary)" }}>
          {job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : job.job_number}
        </p>
        {addrStr && <p className="mt-0.5 flex items-center gap-1 text-[10px] truncate" style={{ color: "var(--t-text-muted)" }}><MapPin className="h-2.5 w-2.5 shrink-0" />{addrStr}</p>}
        {(job.scheduled_window_start || job.scheduled_window_end) && (
          <p className="mt-1 flex items-center gap-1 text-[10px]" style={{ color: "var(--t-text-muted)" }}>
            <Clock className="h-2.5 w-2.5" />{fmtTime(job.scheduled_window_start)}{job.scheduled_window_end && ` - ${fmtTime(job.scheduled_window_end)}`}
          </p>
        )}
      </div>
    </div>
  );
}

/* ======== QuickView Content ======== */

function JobQuickViewContent({ job, detail, loading, board, date, onAssign, onRefresh, toast }: {
  job: DispatchJob; detail: any; loading: boolean;
  board: DispatchBoard | null; date: string;
  onAssign: (jobId: string, driverId: string | null) => Promise<void>;
  onRefresh: () => Promise<void>;
  toast: (type: "success" | "error" | "warning", msg: string) => void;
}) {
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [newDate, setNewDate] = useState(detail?.scheduled_date || "");
  const [reason, setReason] = useState("");
  const [rescheduling, setRescheduling] = useState(false);

  const tc = TYPE_CONFIG[job.job_type] || { label: job.job_type, letter: "?", color: "var(--t-text-muted)" };
  const isCompleted = job.status === "completed";
  const d = detail || job; // Use detail if loaded, fallback to board data
  const addr = d.service_address;
  const cust = d.customer;

  if (loading) return <QuickViewSkeleton />;

  const handleReschedule = async () => {
    if (!newDate) return;
    setRescheduling(true);
    try {
      await api.patch(`/jobs/${job.id}/reschedule`, { scheduledDate: newDate, reason, source: "dispatcher" });
      const rentalDays = d.rental_days || 7;
      const pickupDate = new Date(newDate); pickupDate.setDate(pickupDate.getDate() + rentalDays);
      toast("success", `Moved to ${new Date(newDate).toLocaleDateString()}. Pickup updated to ${pickupDate.toLocaleDateString()}.`);
      setRescheduleOpen(false);
      await onRefresh();
    } catch { toast("error", "Failed to reschedule"); }
    finally { setRescheduling(false); }
  };

  return (
    <div className="space-y-4">
      {/* Badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium" style={{ color: tc.color }}>{tc.label}</span>
        <span className="text-xs font-medium capitalize" style={{ color: isCompleted ? "var(--t-accent)" : "var(--t-warning)" }}>{job.status.replace(/_/g, " ")}</span>
        {job.priority === "high" && <span className="text-xs font-bold" style={{ color: "var(--t-error)" }}>High Priority</span>}
        {job.rescheduled_by_customer && <span className="text-xs font-medium" style={{ color: "#60a5fa" }}>Rescheduled by customer</span>}
        {d.asset?.identifier && <span className="text-xs font-bold" style={{ color: "var(--t-accent)" }}>{d.asset.identifier}</span>}
      </div>

      {/* Customer */}
      <div className="rounded-[20px] border p-4" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
        <p className="text-[13px] uppercase tracking-wider mb-2" style={{ color: "var(--t-text-muted)" }}>Customer</p>
        {cust ? (
          <div>
            <Link href={`/customers/${cust.id}`} className="text-sm font-semibold transition-all duration-150" style={{ color: "var(--t-text-primary)" }}>{cust.first_name} {cust.last_name}</Link>
            {cust.phone && <a href={`tel:${cust.phone}`} className="flex items-center gap-1.5 mt-2 text-xs transition-all duration-150" style={{ color: "var(--t-accent)" }}><Phone className="h-3 w-3" />{formatPhone(cust.phone)}</a>}
            {cust.email && <a href={`mailto:${cust.email}`} className="flex items-center gap-1.5 mt-1 text-xs transition-all duration-150" style={{ color: "var(--t-text-muted)" }}><Mail className="h-3 w-3" />{cust.email}</a>}
          </div>
        ) : <p className="text-sm" style={{ color: "var(--t-text-muted)" }}>No customer</p>}
      </div>

      {/* Address */}
      {addr && (
        <div className="rounded-[20px] border p-4" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
          <p className="text-[13px] uppercase tracking-wider mb-2" style={{ color: "var(--t-text-muted)" }}>Service Address</p>
          <p className="text-sm" style={{ color: "var(--t-text-primary)" }}>{addr.street}</p>
          <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>{[addr.city, addr.state, addr.zip].filter(Boolean).join(", ")}</p>
          {d.placement_notes && <p className="text-xs mt-2 italic" style={{ color: "var(--t-text-muted)" }}>"{d.placement_notes}"</p>}
        </div>
      )}

      {/* Schedule */}
      <div className="rounded-[20px] border p-4" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
        <p className="text-[13px] uppercase tracking-wider mb-2" style={{ color: "var(--t-text-muted)" }}>Schedule</p>
        <div className="space-y-1.5 text-sm">
          {d.scheduled_date && <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Date</span><span className="font-medium" style={{ color: "var(--t-text-primary)" }}>{new Date(d.scheduled_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span></div>}
          {d.scheduled_window_start && <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Time</span><span style={{ color: "var(--t-text-primary)" }}>{fmtTime(d.scheduled_window_start)}{d.scheduled_window_end ? ` - ${fmtTime(d.scheduled_window_end)}` : ""}</span></div>}
          {d.rental_days && <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Rental</span><span style={{ color: "var(--t-text-primary)" }}>{d.rental_days} days</span></div>}
          {d.rental_end_date && <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Pickup by</span><span style={{ color: "var(--t-text-primary)" }}>{new Date(d.rental_end_date + "T00:00:00").toLocaleDateString()}</span></div>}
        </div>
        {job.rescheduled_from_date && <p className="text-xs mt-2" style={{ color: "#60a5fa" }}>Originally scheduled: {job.rescheduled_from_date}</p>}
      </div>

      {/* Assignment */}
      <div className="rounded-[20px] border p-4" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
        <p className="text-[13px] uppercase tracking-wider mb-2" style={{ color: "var(--t-text-muted)" }}>Assignment</p>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Driver</span><span style={{ color: job.assigned_driver ? "var(--t-text-primary)" : "var(--t-error)" }}>{job.assigned_driver ? `${job.assigned_driver.first_name} ${job.assigned_driver.last_name}` : "Unassigned"}</span></div>
          <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>Asset</span><span style={{ color: "var(--t-text-primary)" }}>{d.asset?.identifier || "Not assigned"}</span></div>
        </div>
        {board && (
          <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--t-border)" }} onClick={e => e.stopPropagation()}>
            <Dropdown trigger={<button className="text-xs font-medium" style={{ color: "var(--t-accent)" }}>{job.assigned_driver ? "Reassign Driver" : "Assign Driver"}</button>}>
              <button onClick={() => onAssign(job.id, null)} className="flex w-full items-center gap-2 px-3 py-2 text-xs" style={{ color: "var(--t-error)" }}>Unassign</button>
              {board.drivers.map(col => (
                <button key={col.driver.id} onClick={() => onAssign(job.id, col.driver.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs whitespace-nowrap transition-all duration-150"
                  style={{ color: "var(--t-text-primary)" }}>
                  <div className="flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold"
                    style={{ background: "var(--t-accent-soft)", color: "var(--t-accent)" }}>{col.driver.firstName[0]}{col.driver.lastName[0]}</div>
                  {col.driver.firstName} {col.driver.lastName}
                </button>
              ))}
            </Dropdown>
          </div>
        )}
      </div>

      {/* Price */}
      {d.total_price > 0 && (
        <div className="rounded-[20px] border p-4" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
          <div className="flex justify-between items-center">
            <p className="text-[13px] uppercase tracking-wider" style={{ color: "var(--t-text-muted)" }}>Total Price</p>
            <p className="text-lg font-bold tabular-nums" style={{ color: "var(--t-accent)" }}>${Number(d.total_price).toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* Reschedule Section */}
      {!isCompleted && job.status !== "cancelled" && (
        <div>
          {!rescheduleOpen ? (
            <button onClick={() => { setRescheduleOpen(true); setNewDate(d.scheduled_date || ""); }}
              className="w-full rounded-full border py-2.5 text-xs font-semibold transition-all duration-150"
              style={{ borderColor: "var(--t-border)", color: "#60a5fa", background: "transparent" }}>
              <Calendar className="h-3.5 w-3.5 inline mr-1.5" />Reschedule Job
            </button>
          ) : (
            <div className="rounded-[20px] border p-4 space-y-3" style={{ borderColor: "var(--t-border)", background: "var(--t-bg-card)" }}>
              <p className="text-xs font-semibold" style={{ color: "#60a5fa" }}>Reschedule Job</p>
              <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
                className="w-full rounded-[10px] border px-3 py-2 text-sm outline-none transition-all duration-150"
                style={{ background: "var(--t-bg-primary)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} />
              {d.rental_days && newDate && (
                <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>
                  New delivery: {new Date(newDate + "T00:00:00").toLocaleDateString()} · Pickup by: {new Date(new Date(newDate).getTime() + d.rental_days * 86400000).toLocaleDateString()}
                </p>
              )}
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (optional)"
                className="w-full rounded-[10px] border px-3 py-2 text-sm outline-none transition-all duration-150"
                style={{ background: "var(--t-bg-primary)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} />
              <div className="flex gap-2">
                <button onClick={handleReschedule} disabled={!newDate || rescheduling}
                  className="flex-1 rounded-full py-2 text-xs font-semibold disabled:opacity-50 transition-all duration-150"
                  style={{ background: "#3b82f6", color: "#fff" }}>{rescheduling ? "Moving..." : "Confirm Move"}</button>
                <button onClick={() => setRescheduleOpen(false)}
                  className="rounded-full px-4 py-2 text-xs transition-all duration-150"
                  style={{ background: "var(--t-bg-card-hover)", color: "var(--t-text-muted)" }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cancel */}
      {!isCompleted && job.status !== "cancelled" && (
        <button onClick={async () => {
          if (!confirm("Cancel this job? This cannot be undone.")) return;
          try { await api.patch(`/jobs/${job.id}/status`, { status: "cancelled" }); toast("success", "Job cancelled"); await onRefresh(); } catch { toast("error", "Failed to cancel"); }
        }} className="w-full rounded-full border py-2 text-xs font-medium transition-all duration-150"
          style={{ borderColor: "var(--t-error)", color: "var(--t-error)", background: "transparent" }}>
          Cancel Job
        </button>
      )}
    </div>
  );
}
