"use client";

import { useState, useEffect, useCallback, memo, useRef } from "react";
import { deriveDisplayStatus, DISPLAY_STATUS_LABELS, displayStatusColor, JOB_TYPE_LABELS, formatJobNumber, type JobType } from "@/lib/job-status";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  ChevronLeft, ChevronRight, Calendar, Clock, MapPin, UserPlus, Truck,
  Phone, Plus, Box, Search, CheckCircle2, RefreshCw, Zap, X, ExternalLink,
  ChevronDown, ChevronUp, Navigation, Mail, MoreHorizontal, Eye, EyeOff,
  FileText, Send, Map as MapIcon, LayoutDashboard, AlertTriangle, DollarSign,
} from "lucide-react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useTheme } from "@/components/theme-provider";
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
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import { useLifecycleSync, useVisibilityRefresh } from "@/lib/lifecycle-sync";
import { useTenantTimezone } from "@/lib/use-modules";
import { getTenantToday } from "@/lib/utils/tenantDate";

/* ---- Types ---- */

interface DispatchJob {
  id: string; job_number: string; job_type: string; service_type: string; asset_subtype?: string;
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
  failed_at?: string; attempt_count?: number;
  dump_status?: string;
  dump_disposition?: string;
  // Phase 2 (Dispatch Prepayment UX) — additive board annotations.
  // `payment_required` is true when the dispatch prepayment gate
  // would block an assign attempt for this job; the card badge keys
  // off this flag. `linked_invoice_id` is the most relevant unpaid
  // invoice id for the "View Invoice" navigation in the blocking
  // modal (null = no invoice yet → operator should open Customer
  // Billing instead).
  payment_required?: boolean;
  linked_invoice_id?: string | null;
}

interface Driver { id: string; firstName: string; lastName: string; phone: string; vehicleInfo?: { year?: string; make?: string; model?: string } | null; }
interface DriverColumn { driver: Driver; route: { id: string; status: string; total_stops: number } | null; jobs: DispatchJob[]; jobCount: number; }
interface DispatchBoard { date: string; drivers: DriverColumn[]; unassigned: DispatchJob[]; }

/* ---- Credit state (Phase 4D — dispatch QuickView warning) ---- */
type DispatchHoldReason =
  | { type: "manual_hold"; set_by: string | null; set_at: string | null; reason: string | null }
  | { type: "credit_limit_exceeded"; limit: number; current_ar: number }
  | { type: "overdue_threshold_exceeded"; threshold_days: number; oldest_past_due_days: number };

interface DispatchCreditState {
  hold: {
    effective_active: boolean;
    manual_active: boolean;
    policy_active: boolean;
    reasons: DispatchHoldReason[];
  };
}

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

/* ---- Credit enforcement error helper ---- */

/**
 * Phase 2 (Dispatch Prepayment UX) — error introspection helpers.
 *
 * The api client now attaches the parsed JSON body to thrown
 * Errors as `err.body`, so these helpers can key off the structured
 * `code` and `hold` fields instead of substring-matching the
 * (registry-driven, tenant-overridable, translatable) message.
 */
type ApiErrorBody = {
  code?: string;
  message?: string;
  hold?: { override_allowed?: boolean; reasons?: unknown[] };
};

function getErrorBody(err: unknown): ApiErrorBody | null {
  if (!err || typeof err !== "object") return null;
  const body = (err as { body?: ApiErrorBody }).body;
  return body && typeof body === "object" ? body : null;
}

function isCreditBlockError(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const body = getErrorBody(err);
  const code = body?.code;
  if (
    code === "DISPATCH_PREPAYMENT_BLOCK" ||
    code === "DISPATCH_PREPAYMENT_OVERRIDE_NOT_PERMITTED" ||
    code === "DISPATCH_PREPAYMENT_OVERRIDE_REASON_REQUIRED"
  ) {
    return (
      FEATURE_REGISTRY.dispatch_prepayment_block_message?.label ??
      body?.message ??
      null
    );
  }
  if (
    code === "DISPATCH_CREDIT_BLOCK" ||
    code === "DISPATCH_CREDIT_OVERRIDE_NOT_PERMITTED" ||
    code === "DISPATCH_CREDIT_OVERRIDE_REASON_REQUIRED"
  ) {
    return (
      FEATURE_REGISTRY.dispatch_credit_block_message?.label ??
      body?.message ??
      null
    );
  }
  // Legacy substring fallbacks for callers that haven't been
  // re-deployed yet or for proxied errors stripped of the body.
  const msg = (err as Error).message || "";
  if (
    msg.includes("Payment required before dispatch") ||
    msg.includes("prepayment terms")
  ) {
    return FEATURE_REGISTRY.dispatch_prepayment_block_message?.label ?? msg;
  }
  if (msg.includes("credit hold") || msg.includes("DISPATCH_CREDIT")) {
    return FEATURE_REGISTRY.dispatch_credit_block_message?.label ?? msg;
  }
  return null;
}

/**
 * Returns a structured prepayment-block descriptor when the error
 * is a per-job DISPATCH_PREPAYMENT_BLOCK. Used by the dispatch board
 * to pop the actionable blocking modal instead of a vague toast.
 * Returns null for any other error type so the caller falls through
 * to its existing toast path.
 */
function getPrepaymentBlock(
  err: unknown,
): { code: string; message?: string; overrideAllowed: boolean } | null {
  const body = getErrorBody(err);
  if (!body) return null;
  if (
    body.code === "DISPATCH_PREPAYMENT_BLOCK" ||
    body.code === "DISPATCH_PREPAYMENT_OVERRIDE_NOT_PERMITTED"
  ) {
    return {
      code: body.code,
      message: body.message,
      overrideAllowed: !!body.hold?.override_allowed,
    };
  }
  return null;
}

/* ---- Constants ---- */

// Styling-only map (letter + stripe). Labels come from JOB_TYPE_LABELS registry.
const TYPE_CONFIG: Record<string, { letter: string; stripe: string }> = {
  delivery: { letter: "D", stripe: "var(--t-accent)" },
  pickup: { letter: "P", stripe: "var(--t-warning)" },
  exchange: { letter: "E", stripe: "#a78bfa" },
  dump_run: { letter: "DR", stripe: "var(--t-error)" },
  // Driver Task V1 — distinct teal stripe + "T" letter so dispatchers
  // instantly recognize these as internal operational items, not
  // customer lifecycle jobs. The letter and stripe are the ONLY
  // visual distinction; the rest of the tile renders normally
  // through the existing JobTile components.
  driver_task: { letter: "T", stripe: "#14b8a6" },
};

// Phase 2 polish — registry IDs for the dispatch prepayment override
// reason presets shown in the blocked-assignment modal. The labels
// themselves come from FEATURE_REGISTRY at render time so tenant
// overrides flow through the existing tenantOverrideKey path. Order
// here is the display order in the modal. Keep in sync with the
// matching entries in `web/src/lib/feature-registry.ts`.
const PREPAY_OVERRIDE_REASON_PRESET_IDS = [
  "dispatch_prepayment_override_reason_paying_on_site",
  "dispatch_prepayment_override_reason_trusted_account",
  "dispatch_prepayment_override_reason_paid_offline",
  "dispatch_prepayment_override_reason_office_approved",
] as const;
const PREPAY_OVERRIDE_REASON_OTHER_ID = "dispatch_prepayment_override_reason_other";

/** Registry-driven type label with passthrough fallback for unknown types. */
const getTypeLabel = (t: string): string => JOB_TYPE_LABELS[t as JobType] ?? t;

const FILTER_TABS = [
  { key: "all", label: "All" }, { key: "delivery", label: "Deliveries" },
  { key: "pickup", label: "Pickups" }, { key: "exchange", label: "Exchanges" },
  { key: "dump_run", label: "Dump Runs" }, { key: "completed", label: "Completed" },
];

/* ---- Helpers ---- */

// Phase B3 — delegates to the tenant-aware helper. Keeping the
// local `today()` name avoids rewriting every call site. The tz
// argument is optional so older unmigrated call sites still work
// (they fall back to 'America/New_York').
//
// Bug history: the previous module-level `today()` used
// `new Date().toISOString().split("T")[0]`, which rolled the
// dispatch board to "tomorrow" at local evening for any user
// west of UTC (≈8 PM Eastern triggered the next UTC day). The
// tenant-aware helper reads the tenant's IANA timezone from the
// cached /auth/profile slice and formats via Intl, so dispatch
// stays on the correct local date until local midnight.
function today(tz?: string): string {
  return getTenantToday(tz);
}

function shiftDate(d: string, n: number): string {
  // Pure YYYY-MM-DD arithmetic — tz-independent. We explicitly
  // construct in UTC and format via UTC getters so there is no
  // browser-local rollover. Do not replace with local-parse
  // helpers (the previous `new Date(d + "T00:00:00").setDate()`
  // version drifted by a day for any browser in a positive UTC
  // offset).
  const [y, m, dd] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, dd || 1));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const ddd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${ddd}`;
}
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
  // Phase B3 — tenant-wide timezone. Shares the /auth/profile cache
  // with useModules so this adds no extra fetch. Threaded through
  // every `today(tz)` call in this component so the board's "today"
  // label, Today button, keyboard shortcut, and initial state all
  // stay anchored to the tenant's local date — not the browser's
  // UTC-derived date, which was the source of the 8 PM rollover bug.
  const timezone = useTenantTimezone();
  const [date, setDate] = useState(() => today(timezone));
  const [board, setBoard] = useState<DispatchBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [quickViewJob, setQuickViewJob] = useState<DispatchJob | null>(null);
  const [qvDetail, setQvDetail] = useState<any>(null);
  const [qvLoading, setQvLoading] = useState(false);
  const [qvCreditState, setQvCreditState] = useState<DispatchCreditState | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [collapsedCols, setCollapsedCols] = useState<Set<string>>(new Set());
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [showColumns, setShowColumns] = useState(true);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [optimizing, setOptimizing] = useState(false);
  const [sendingRoutes, setSendingRoutes] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; job: DispatchJob } | null>(null);
  const [rescheduleJob, setRescheduleJob] = useState<DispatchJob | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [yardQueue, setYardQueue] = useState<Array<{
    id: string; identifier: string; subtype: string; status: string;
    needs_dump: boolean; staged_at: string; staged_waste_type: string;
    staged_notes: string; yard_id: string; yard?: { id: string; name: string };
    current_job_id: string;
  }>>([]);
  const [showYardPanel, setShowYardPanel] = useState(false);
  const [rescheduleQueue, setRescheduleQueue] = useState<DispatchJob[]>([]);
  const [unassignedRail, setUnassignedRail] = useState(false);
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  // Phase 2 (Dispatch Prepayment UX) — blocking-modal state for the
  // "Payment Required Before Dispatch" dialog. Set when an assign
  // attempt fails with a DISPATCH_PREPAYMENT_BLOCK; cleared by user
  // action (cancel / view / override). Single-job only — bulk-drag
  // failures fall back to the existing toast pipeline.
  const [blockedAssign, setBlockedAssign] = useState<{
    job: DispatchJob;
    targetDriverId: string | null;
    overrideAllowed: boolean;
  } | null>(null);
  const [blockedOverrideMode, setBlockedOverrideMode] = useState(false);
  // Phase 2 polish — preset reasons. `blockedOverrideOtherMode` flips
  // to true when the operator picks the "Other" preset, revealing
  // the free-text textarea. Otherwise the modal renders the preset
  // chips and the reason text is auto-filled from the selected
  // preset's registry label. Final submitted reason is always the
  // string in `blockedOverrideReason` (preset label OR custom text)
  // so the backend audit trail format is unchanged.
  const [blockedOverrideOtherMode, setBlockedOverrideOtherMode] = useState(false);
  const [blockedOverrideReason, setBlockedOverrideReason] = useState("");
  const [blockedOverriding, setBlockedOverriding] = useState(false);
  // Driver Task V1 — slide-over create state. Opened via the "New Task"
  // button next to Optimize Routes on the dispatch top bar. See
  // `NewTaskDrawer` component below the main page component.
  const [newTaskOpen, setNewTaskOpen] = useState<null | {
    defaultDriverId?: string;
    defaultDate: string;
  }>(null);
  const lastClickedRef = useRef<string | null>(null);
  const saveOrderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();

  // Selection handler: plain click = select only this, cmd/ctrl = toggle, shift = range
  const handleSelectJob = useCallback((jobId: string, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
    if (!board) return;
    const isModifier = e.metaKey || e.ctrlKey;

    if (e.shiftKey && lastClickedRef.current) {
      // Range select
      const allJobsFlat = [...board.unassigned, ...board.drivers.flatMap(d => d.jobs)];
      const lastIdx = allJobsFlat.findIndex(j => j.id === lastClickedRef.current);
      const curIdx = allJobsFlat.findIndex(j => j.id === jobId);
      if (lastIdx >= 0 && curIdx >= 0) {
        const from = Math.min(lastIdx, curIdx);
        const to = Math.max(lastIdx, curIdx);
        setSelectedJobs(prev => {
          const next = new Set(prev);
          for (let i = from; i <= to; i++) next.add(allJobsFlat[i].id);
          return next;
        });
        lastClickedRef.current = jobId;
        return;
      }
    }

    if (isModifier) {
      // Cmd/Ctrl+click: toggle this job in/out of selection
      setSelectedJobs(prev => {
        const next = new Set(prev);
        if (next.has(jobId)) next.delete(jobId); else next.add(jobId);
        return next;
      });
    } else {
      // Plain click: select only this job (replace selection)
      setSelectedJobs(new Set([jobId]));
    }
    lastClickedRef.current = jobId;
  }, [board]);

  // Checkbox always toggles (never replaces)
  const handleCheckboxToggle = useCallback((jobId: string, e: { shiftKey: boolean }) => {
    if (!board) return;
    if (e.shiftKey && lastClickedRef.current) {
      const allJobsFlat = [...board.unassigned, ...board.drivers.flatMap(d => d.jobs)];
      const lastIdx = allJobsFlat.findIndex(j => j.id === lastClickedRef.current);
      const curIdx = allJobsFlat.findIndex(j => j.id === jobId);
      if (lastIdx >= 0 && curIdx >= 0) {
        const from = Math.min(lastIdx, curIdx);
        const to = Math.max(lastIdx, curIdx);
        setSelectedJobs(prev => {
          const next = new Set(prev);
          for (let i = from; i <= to; i++) next.add(allJobsFlat[i].id);
          return next;
        });
        lastClickedRef.current = jobId;
        return;
      }
    }
    setSelectedJobs(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId); else next.add(jobId);
      return next;
    });
    lastClickedRef.current = jobId;
  }, [board]);

  const clearSelection = useCallback(() => {
    setSelectedJobs(new Set());
    lastClickedRef.current = null;
  }, []);

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

  const fetchYardQueue = useCallback(() => {
    api.get<{data: typeof yardQueue}>("/assets/awaiting-dump").then(r => setYardQueue(r.data || [])).catch(() => {});
  }, []);

  const fetchRescheduleQueue = useCallback(() => {
    api.get<{data: DispatchJob[]}>("/jobs?status=needs_reschedule&limit=50")
      .then(r => setRescheduleQueue(r.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => { fetchBoard(); fetchYardQueue(); fetchRescheduleQueue(); }, [fetchBoard, fetchYardQueue, fetchRescheduleQueue]);
  useEffect(() => { const i = setInterval(() => { fetchBoard(true); fetchYardQueue(); fetchRescheduleQueue(); }, 30000); return () => clearInterval(i); }, [fetchBoard, fetchYardQueue, fetchRescheduleQueue]);

  // Phase 9: refetch quietly when a rentals/lifecycle mutation fires
  // a sync signal (same tab or cross-tab via BroadcastChannel) and
  // when the tab regains visibility/focus after being backgrounded.
  // Silent mode keeps scroll position intact.
  useLifecycleSync(() => {
    fetchBoard(true);
    fetchYardQueue();
    fetchRescheduleQueue();
  });
  useVisibilityRefresh(() => {
    fetchBoard(true);
    fetchYardQueue();
    fetchRescheduleQueue();
  });

  const handleOptimize = async () => {
    if (!board) return;
    setOptimizing(true);
    try {
      let optimized = 0;
      for (const col of board.drivers) {
        if (col.jobs.length > 1) {
          await api.post("/dispatch/optimize", { driverId: col.driver.id, date });
          optimized++;
        }
      }
      await fetchBoard(true);
      toast("success", optimized > 0 ? `Optimized ${optimized} route(s)` : "No routes to optimize");
    } catch { toast("error", "Failed to optimize routes"); }
    finally { setOptimizing(false); }
  };

  const handleSendRoutes = async () => {
    if (!board) return;
    setSendingRoutes(true);
    try {
      const driverIds = board.drivers.filter(d => d.jobs.length > 0).map(d => d.driver.id);
      const result = await api.post<{ message: string; jobsDispatched: number }>("/dispatch/send-routes", { driverIds, date });
      await fetchBoard(true);
      toast("success", `${result.jobsDispatched} job(s) dispatched to drivers`);
    } catch { toast("error", "Failed to send routes"); }
    finally { setSendingRoutes(false); }
  };

  /**
   * Phase 2 (Dispatch Prepayment UX) — single-job assign with
   * prepayment-block handling. Used by all non-drag entry points
   * (unassigned-column quick assign, driver-column reassign, etc.)
   * so every assign path on the dispatch board funnels through the
   * same UX: success → toast + refresh; prepayment block → modal;
   * other failures → toast.
   *
   * The drag handler still calls the assign endpoint directly so it
   * can batch many jobs in one Promise.all; it inlines the same
   * prepayment detection because bulk and single-job cases differ
   * (bulk falls through to a toast, single pops the modal).
   */
  const assignWithBlockHandling = useCallback(
    async (job: DispatchJob, targetDriverId: string | null) => {
      try {
        await api.patch(`/jobs/${job.id}/assign`, { assignedDriverId: targetDriverId });
        toast("success", targetDriverId ? "Assigned" : "Unassigned");
        await fetchBoard(true);
      } catch (err) {
        const prepay = getPrepaymentBlock(err);
        if (prepay) {
          setBlockedAssign({
            job,
            targetDriverId,
            overrideAllowed: prepay.overrideAllowed,
          });
          setBlockedOverrideMode(false);
          setBlockedOverrideOtherMode(false);
          setBlockedOverrideReason("");
          return;
        }
        toast(
          "error",
          isCreditBlockError(err) ??
            (err instanceof Error ? err.message : "Failed"),
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleContextMenu = (e: React.MouseEvent, job: DispatchJob) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, job });
  };

  const handleReschedule = async () => {
    if (!rescheduleJob || !rescheduleDate) return;
    try {
      await api.patch(`/jobs/${rescheduleJob.id}/reschedule`, { scheduledDate: rescheduleDate, reason: "Rescheduled from dispatch board" });
      toast("success", `${formatJobNumber(rescheduleJob.job_number)} moved to ${rescheduleDate}`);
      setRescheduleJob(null);
      setRescheduleDate("");
      await fetchBoard(true);
    } catch { toast("error", "Failed to reschedule"); }
  };

  const handleUnassign = async (job: DispatchJob) => {
    try {
      await api.patch(`/jobs/${job.id}/assign`, { assignedDriverId: null });
      toast("success", `${formatJobNumber(job.job_number)} unassigned`);
      await fetchBoard(true);
    } catch { toast("error", "Failed to unassign"); }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") { setQuickViewJob(null); setCtxMenu(null); setRescheduleJob(null); setShowYardPanel(false); clearSelection(); }
      else if (e.key === "ArrowLeft") setDate(d => shiftDate(d, -1));
      else if (e.key === "ArrowRight") setDate(d => shiftDate(d, 1));
      else if (e.key === "t" || e.key === "T") setDate(today(timezone));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Close context menu on click outside
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [ctxMenu]);

  const allJobs = board ? [...board.unassigned, ...board.drivers.flatMap(d => d.jobs)] : [];
  const findColumnForJob = (jobId: string): string => {
    if (!board) return "unassigned";
    if (board.unassigned.some(j => j.id === jobId)) return "unassigned";
    for (const col of board.drivers) { if (col.jobs.some(j => j.id === jobId)) return col.driver.id; }
    return "unassigned";
  };

  const handleDragStart = (event: DragStartEvent) => {
    const draggedId = event.active.id as string;
    setActiveId(draggedId);
    // If dragging an unselected job, clear selection (single-drag mode)
    if (!selectedJobs.has(draggedId)) clearSelection();
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || !board) return;

    const activeJobId = active.id as string;
    const overId = over.id as string;
    const columnIds = ["unassigned", ...board.drivers.map(d => d.driver.id)];
    const sourceCol = findColumnForJob(activeJobId);
    const targetCol = columnIds.includes(overId) ? overId : findColumnForJob(overId);

    // Determine which jobs are being moved (bulk or single)
    const movingIds = selectedJobs.has(activeJobId) && selectedJobs.size > 1
      ? selectedJobs
      : new Set([activeJobId]);

    // Save board snapshot for rollback
    const snapshot = JSON.parse(JSON.stringify(board)) as DispatchBoard;

    if (sourceCol === targetCol && !columnIds.includes(overId) && movingIds.size === 1) {
      // ── Same column reorder (single job only) ──
      const getJobs = (col: string) => col === "unassigned" ? board.unassigned : (board.drivers.find(d => d.driver.id === col)?.jobs || []);
      const colJobs = [...getJobs(sourceCol)];
      const oldIndex = colJobs.findIndex(j => j.id === activeJobId);
      const newIndex = colJobs.findIndex(j => j.id === overId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      const reordered = arrayMove(colJobs, oldIndex, newIndex);

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
        setBoard(snapshot);
      }
    } else if (sourceCol !== targetCol || (movingIds.size > 1 && sourceCol !== targetCol)) {
      // ── Cross-column move (single or bulk) ──
      const newBoard = JSON.parse(JSON.stringify(board)) as DispatchBoard;
      const targetDriverId = targetCol === "unassigned" ? null : targetCol;

      // Collect all moving jobs from their source columns, preserving relative order
      const movingJobs: DispatchJob[] = [];
      const allJobsFlat = [...newBoard.unassigned, ...newBoard.drivers.flatMap(d => d.jobs)];
      for (const j of allJobsFlat) {
        if (movingIds.has(j.id)) movingJobs.push(j);
      }

      // Remove moving jobs from all source columns
      newBoard.unassigned = newBoard.unassigned.filter((j: DispatchJob) => !movingIds.has(j.id));
      for (const d of newBoard.drivers) {
        d.jobs = d.jobs.filter((j: DispatchJob) => !movingIds.has(j.id));
      }

      // Insert into target column
      const dstJobs = targetCol === "unassigned" ? newBoard.unassigned : (newBoard.drivers.find(d => d.driver.id === targetCol)?.jobs || []);
      if (!columnIds.includes(overId)) {
        const dstIdx = dstJobs.findIndex((j: DispatchJob) => j.id === overId);
        dstJobs.splice(dstIdx >= 0 ? dstIdx : dstJobs.length, 0, ...movingJobs);
      } else {
        dstJobs.push(...movingJobs);
      }

      // Update counts
      for (const d of newBoard.drivers) d.jobCount = d.jobs.length;

      // Optimistic update
      setBoard(newBoard);

      const driverName = targetDriverId ? board.drivers.find(d => d.driver.id === targetDriverId)?.driver : null;
      const countLabel = movingJobs.length > 1 ? `${movingJobs.length} jobs` : formatJobNumber(movingJobs[0]?.job_number) || "Job";
      toast("success", targetDriverId ? `${countLabel} → ${driverName?.firstName}'s route` : `${countLabel} → Unassigned`);

      try {
        // Assign all moving jobs to target driver
        await Promise.all(movingJobs.map(j =>
          api.patch(`/jobs/${j.id}/assign`, { assignedDriverId: targetDriverId })
        ));
        // Persist the new route order in the destination column
        await api.patch("/jobs/bulk-reorder", { jobIds: dstJobs.map((j: DispatchJob) => j.id) });
        clearSelection();
      } catch (err) {
        // Always restore the visual snapshot on failure — the modal
        // (if shown) re-runs the assign through fetchBoard after the
        // override succeeds.
        setBoard(snapshot);
        // Phase 2 — single-job prepayment blocks pop the actionable
        // modal instead of the vague toast. Bulk drags still toast
        // (we don't want N stacked modals; operator can retry the
        // failed job individually).
        const prepay = getPrepaymentBlock(err);
        if (prepay && movingJobs.length === 1) {
          setBlockedAssign({
            job: movingJobs[0],
            targetDriverId,
            overrideAllowed: prepay.overrideAllowed,
          });
          setBlockedOverrideMode(false);
          setBlockedOverrideOtherMode(false);
          setBlockedOverrideReason("");
          return;
        }
        toast(
          "error",
          isCreditBlockError(err) ??
            (err instanceof Error ? err.message : "Failed to move job(s)"),
        );
      }
    }
  };

  const openQuickView = (j: DispatchJob) => {
    setQuickViewJob(j);
    setQvLoading(true);
    setQvDetail(null);
    setQvCreditState(null);
    // Fetch job detail and credit state in parallel. Credit state is
    // best-effort — a failure does not block the QuickView from opening.
    api.get(`/jobs/${j.id}`).then(setQvDetail).catch(() => {}).finally(() => setQvLoading(false));
    if (j.customer?.id) {
      api.get<DispatchCreditState>(`/customers/${j.customer.id}/credit-state`).then(setQvCreditState).catch(() => {});
    }
  };

  // Move job to top or bottom within its column
  const handleMoveJob = useCallback(async (jobId: string, position: "top" | "bottom") => {
    if (!board) return;
    const snapshot = JSON.parse(JSON.stringify(board)) as DispatchBoard;
    const colId = findColumnForJob(jobId);
    const getJobs = (col: string) => col === "unassigned" ? board.unassigned : (board.drivers.find(d => d.driver.id === col)?.jobs || []);
    const colJobs = [...getJobs(colId)];
    const idx = colJobs.findIndex(j => j.id === jobId);
    if (idx === -1) return;
    if (position === "top" && idx === 0) return;
    if (position === "bottom" && idx === colJobs.length - 1) return;

    const [moved] = colJobs.splice(idx, 1);
    if (position === "top") colJobs.unshift(moved); else colJobs.push(moved);

    setBoard(prev => {
      if (!prev) return prev;
      if (colId === "unassigned") return { ...prev, unassigned: colJobs };
      return { ...prev, drivers: prev.drivers.map(d => d.driver.id === colId ? { ...d, jobs: colJobs } : d) };
    });

    try {
      await api.patch("/jobs/bulk-reorder", { jobIds: colJobs.map(j => j.id) });
      toast("success", position === "top" ? "Moved to first stop" : "Moved to last stop");
    } catch {
      toast("error", "Failed to reorder");
      setBoard(snapshot);
    }
  }, [board, toast, findColumnForJob]);

  const totalJobs = board ? board.unassigned.length + board.drivers.reduce((s, d) => s + d.jobs.length, 0) : 0;
  const driverCount = board?.drivers.length || 0;
  const avgJobCount = driverCount > 0 ? board!.drivers.reduce((s, d) => s + d.jobs.length, 0) / driverCount : 0;
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

  // Step 5: Compute driver job cities for proximity suggestions
  const driverJobCities = board?.drivers.map(d => ({
    driverName: `${d.driver.firstName}`,
    cities: [...new Set(d.jobs.map(j => j.service_address?.city).filter(Boolean) as string[])],
  })) || [];

  return (
    <div className="flex h-[calc(100vh-5rem)] flex-col">
      {/* ── Top bar ── */}
      <div className="shrink-0 mb-4">
        <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)] mb-3">Dispatch</h1>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button onClick={() => setDate(d => shiftDate(d, -1))} className="p-2 rounded-[20px] border transition-all" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-frame-text-muted)" }}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--t-frame-text-muted)" }} />
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-[20px] py-2 pl-10 pr-3 text-sm font-medium outline-none w-52"
                  style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)", color: "var(--t-frame-text)" }} />
              </div>
              <button onClick={() => setDate(d => shiftDate(d, 1))} className="p-2 rounded-[20px] border transition-all" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-frame-text-muted)" }}>
                <ChevronRight className="h-4 w-4" />
              </button>
              <button onClick={() => setDate(today(timezone))} className="ml-1 rounded-full px-3 py-2 text-xs font-medium border"
                style={{ background: date === today(timezone) ? "var(--t-accent-soft)" : "var(--t-bg-card)", borderColor: date === today(timezone) ? "var(--t-accent)" : "var(--t-border)", color: date === today(timezone) ? "var(--t-accent)" : "var(--t-frame-text-muted)" }}>
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
              style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-frame-text-muted)" }}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
            <button onClick={() => setShowColumns(!showColumns)} className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium border"
              style={{ borderColor: "var(--t-border)", color: "var(--t-frame-text-muted)" }}>
              {showColumns ? <MapIcon className="h-3.5 w-3.5" /> : <LayoutDashboard className="h-3.5 w-3.5" />}
              {showColumns ? "Map View" : "Show Columns"}
            </button>
            {/* Driver Task V1 — New Task opens a slide-over form that
                posts to `/jobs/driver-task`. Placed next to Optimize
                Routes because both are dispatch-first actions that
                operate on the currently-visible day. */}
            <button
              onClick={() => setNewTaskOpen({ defaultDate: date })}
              className="flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium border"
              style={{ borderColor: "var(--t-border)", color: "var(--t-frame-text-muted)" }}
              title={FEATURE_REGISTRY.dispatch_new_task_cta?.shortDescription ?? "Create an internal driver task"}
            >
              <Plus className="h-3.5 w-3.5" /> {FEATURE_REGISTRY.dispatch_new_task_cta?.label ?? "New Task"}
            </button>
            <button onClick={handleOptimize} disabled={optimizing} className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold active:scale-95 disabled:opacity-50" style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}>
              <Zap className={`h-3.5 w-3.5 ${optimizing ? "animate-spin" : ""}`} /> {optimizing ? "Optimizing…" : "Optimize Routes"}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-3">
          <div style={{ display: "inline-flex", borderRadius: 22, backgroundColor: "var(--t-bg-secondary)", border: "1px solid var(--t-border)", padding: 3, gap: 2 }}>
            {FILTER_TABS.map(t => (
              <button key={t.key} onClick={() => setFilter(t.key)}
                style={{ fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 18, border: "none", cursor: "pointer", backgroundColor: filter === t.key ? "var(--t-accent)" : "transparent", color: filter === t.key ? "#fff" : "var(--t-text-muted)", transition: "all 0.15s ease" }}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "var(--t-frame-text-muted)" }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search jobs..."
              className="w-full rounded-[20px] py-1.5 pl-9 pr-3 text-xs outline-none"
              style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)", color: "var(--t-frame-text)" }} />
          </div>
          {/* Show hidden columns */}
          {(hiddenDrivers.length > 0 || hiddenCols.has("unassigned")) && (
            <Dropdown trigger={
              <button className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border"
                style={{ borderColor: "var(--t-border)", color: "var(--t-frame-text-muted)" }}>
                <EyeOff className="h-3 w-3" /> {hiddenDrivers.length + (hiddenCols.has("unassigned") ? 1 : 0)} hidden
              </button>
            }>
              {hiddenCols.has("unassigned") && (
                <button onClick={() => showColumn("unassigned")} className="flex w-full items-center gap-2 px-3 py-2 text-xs whitespace-nowrap" style={{ color: "var(--t-text-primary)" }}>
                  <Eye className="h-3 w-3" /> Unassigned
                </button>
              )}
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
          {/* Awaiting Dump chip */}
          {yardQueue.length > 0 && (
            <button onClick={() => setShowYardPanel(true)} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border"
              style={{ borderColor: "rgba(217,119,6,0.3)", background: "rgba(217,119,6,0.06)", color: "var(--t-warning)" }}>
              <Box className="h-3 w-3" /> Awaiting Dump ({yardQueue.length})
            </button>
          )}
          {/* Reschedule chip */}
          {rescheduleQueue.length > 0 && (
            <span className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border"
              style={{ borderColor: "rgba(220,38,38,0.3)", background: "rgba(220,38,38,0.06)", color: "var(--t-error)" }}>
              <AlertTriangle className="h-3 w-3" /> Reschedule ({rescheduleQueue.length})
            </span>
          )}
        </div>
      </div>

      {/* ── Selection bar ── */}
      {selectedJobs.size > 0 && (
        <div className="shrink-0 flex items-center gap-3 px-4 py-2 mb-2 rounded-[14px] border"
          style={{ background: "var(--t-accent-soft)", borderColor: "var(--t-accent)", color: "var(--t-accent)" }}>
          <CheckCircle2 className="h-4 w-4" />
          <span className="text-xs font-bold">{selectedJobs.size} job{selectedJobs.size > 1 ? "s" : ""} selected</span>
          <span className="text-[10px]" style={{ color: "var(--t-text-muted)" }}>Drag to assign · Esc to clear</span>
          <button onClick={clearSelection} className="ml-auto rounded-full p-1 transition-all"
            style={{ color: "var(--t-text-muted)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--t-bg-card-hover)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Board ── */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex-1 min-h-0 overflow-hidden relative">
          <DispatchMap board={board} activeJobId={activeId} />
          {/* Map dimming layer — board is primary, map is secondary */}
          <div style={{ position: "absolute", inset: 0, zIndex: 5, background: "var(--t-bg-primary)", opacity: 0.55, pointerEvents: "none" }} />
          <div style={{ position: "relative", zIndex: 10, height: "100%", pointerEvents: "none" }}>
            <div style={{ height: "100%", pointerEvents: "none" }}>
          {loading ? (
            <div className="flex h-full gap-3 overflow-x-auto pb-2" style={{ pointerEvents: "auto" }}>
              {[1,2,3,4].map(i => <div key={i} className="w-[330px] shrink-0"><div className="h-20 skeleton rounded-t-[20px]" /><div className="space-y-2 mt-2">{[1,2,3].map(j => <div key={j} className="h-24 skeleton rounded-[14px]" />)}</div></div>)}
            </div>
          ) : !board ? (
            <div className="flex h-full items-center justify-center" style={{ color: "var(--t-frame-text-muted)", pointerEvents: "auto" }}>Failed to load</div>
          ) : totalJobs === 0 && board.drivers.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center" style={{ pointerEvents: "auto" }}>
              <Truck className="h-14 w-14 mb-3" style={{ color: "var(--t-frame-text-muted)", opacity: 0.15 }} />
              <h2 className="text-base font-semibold" style={{ color: "var(--t-frame-text)" }}>No jobs for {fmtDate(date)}</h2>
              <p className="mt-1 text-xs" style={{ color: "var(--t-frame-text-muted)" }}>Schedule some deliveries!</p>
              <Link href="/" className="mt-3 flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold active:scale-95" style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}>
                <Plus className="h-3.5 w-3.5" /> New Job
              </Link>
            </div>
          ) : showColumns ? (
            <div className="flex gap-4 overflow-x-auto pb-2 items-start h-full" style={{ pointerEvents: "auto" }}
              onClick={(e) => { if (e.target === e.currentTarget) clearSelection(); }}>
              {/* Unassigned — collapsible rail or full column */}
              {!hiddenCols.has("unassigned") && (
                unassignedRail ? (
                  /* Collapsed rail */
                  <div
                    onClick={() => setUnassignedRail(false)}
                    className="shrink-0 rounded-[20px] cursor-pointer transition-all duration-200 flex flex-col items-center py-4 gap-3"
                    style={{
                      width: 52, minWidth: 52, height: "100%",
                      background: board.unassigned.length > 0 ? "var(--t-warning-soft)" : "var(--t-bg-secondary)",
                      border: "1px solid var(--t-border-strong)",
                    }}>
                    <UserPlus className="h-4 w-4 shrink-0" style={{ color: "var(--t-warning)" }} />
                    <span className="text-[10px] font-bold" style={{ color: "var(--t-warning)", writingMode: "vertical-lr", transform: "rotate(180deg)" }}>UNASSIGNED</span>
                    {board.unassigned.length > 0 && (
                      <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
                        style={{ background: "rgba(217,119,6,0.15)", color: "var(--t-warning)" }}>
                        {board.unassigned.length}
                      </span>
                    )}
                  </div>
                ) : (
                  /* Expanded column */
                  <div className="shrink-0" style={{ transition: "width 0.2s ease" }}>
                    <ColumnCard columnId="unassigned" title="Unassigned" isUnassigned count={board.unassigned.length}
                      jobs={filterJobs(board.unassigned, filter, search)} drivers={board.drivers.map(d => d.driver)}
                      onAssign={async (jid, did) => {
                        const j = board.unassigned.find((x) => x.id === jid);
                        if (!j) return;
                        await assignWithBlockHandling(j, did);
                      }}
                      onQuickView={openQuickView} onCtxMenu={handleContextMenu} activeId={activeId}
                      onStatusChange={async (jid, s) => { try { await api.patch(`/jobs/${jid}/status`, { status: s, cancellationReason: s === "failed" ? "Dispatcher override" : undefined }); toast("success", `Status → ${s.replace(/_/g, " ")}`); await fetchBoard(true); } catch (err) { toast("error", isCreditBlockError(err) ?? "Failed"); } }}
                      collapsed={collapsedCols.has("unassigned")} onToggleCollapse={() => toggleCollapse("unassigned")}
                      onHide={() => setUnassignedRail(true)}
                      driverJobCities={driverJobCities}
                      selectedJobs={selectedJobs} onSelectJob={handleSelectJob} onCheckboxToggle={handleCheckboxToggle}
                      onMoveJob={handleMoveJob} />
                  </div>
                )
              )}
              {visibleDrivers.map((col, idx) => (
                <ColumnCard key={col.driver.id} columnId={col.driver.id} title={`${col.driver.firstName} ${col.driver.lastName}`}
                  driver={col.driver} count={col.jobs.length}
                  progress={{ completed: col.jobs.filter(j => j.status === "completed").length, total: col.jobs.length }}
                  jobs={filterJobs(col.jobs, filter, search)}
                  onUnassign={async (jid) => { try { await api.patch(`/jobs/${jid}/assign`, { assignedDriverId: null }); toast("success", "Unassigned"); await fetchBoard(true); } catch { toast("error", "Failed"); } }}
                  onQuickView={openQuickView} onCtxMenu={handleContextMenu} activeId={activeId}
                  onStatusChange={async (jid, s) => { try { await api.patch(`/jobs/${jid}/status`, { status: s, cancellationReason: s === "failed" ? "Dispatcher override" : undefined }); toast("success", `Status → ${s.replace(/_/g, " ")}`); await fetchBoard(true); } catch (err) { toast("error", isCreditBlockError(err) ?? "Failed"); } }}
                  collapsed={collapsedCols.has(col.driver.id)} onToggleCollapse={() => toggleCollapse(col.driver.id)}
                  onHide={() => hideColumn(col.driver.id)}
                  onColumnDrag={makeColumnDrag(col.driver.id)}
                  selectedJobs={selectedJobs} onSelectJob={handleSelectJob} onCheckboxToggle={handleCheckboxToggle}
                  onMoveJob={handleMoveJob} avgJobCount={avgJobCount}
                />
              ))}
            </div>
          ) : null}
            </div>
          </div>
        </div>
        <DragOverlay>{activeJob ? <JobTileGhost job={activeJob} bulkCount={selectedJobs.has(activeJob.id) ? selectedJobs.size : 1} /> : null}</DragOverlay>
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
            <button onClick={handleSendRoutes} disabled={sendingRoutes} className="rounded-full border px-3 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ background: "var(--t-accent-soft)", borderColor: "var(--t-accent)", color: "var(--t-accent)" }}>{sendingRoutes ? "Sending…" : "Send Routes to Drivers"}</button>
          </div>
        </div>
      )}

      {/* ── Context Menu ── */}
      {ctxMenu && createPortal(
        <div className="fixed z-[9999] rounded-xl border py-1 shadow-xl" style={{ left: ctxMenu.x, top: ctxMenu.y, background: "var(--t-bg-card)", borderColor: "var(--t-border)", minWidth: 180 }}
          onClick={e => e.stopPropagation()}>
          <button className="flex w-full items-center gap-2 px-4 py-2.5 text-xs hover:bg-white/5" style={{ color: "var(--t-text-primary)" }}
            onClick={() => { setRescheduleJob(ctxMenu.job); setRescheduleDate(""); setCtxMenu(null); }}>
            <Calendar className="h-3.5 w-3.5" /> Reschedule
          </button>
          {ctxMenu.job.assigned_driver && (
            <button className="flex w-full items-center gap-2 px-4 py-2.5 text-xs hover:bg-white/5" style={{ color: "var(--t-text-primary)" }}
              onClick={() => { handleUnassign(ctxMenu.job); setCtxMenu(null); }}>
              <UserPlus className="h-3.5 w-3.5" /> Unassign Driver
            </button>
          )}
          <Link href={`/jobs/${ctxMenu.job.id}`} className="flex w-full items-center gap-2 px-4 py-2.5 text-xs hover:bg-white/5" style={{ color: "var(--t-text-primary)" }}
            onClick={() => setCtxMenu(null)}>
            <ExternalLink className="h-3.5 w-3.5" /> View Details
          </Link>
        </div>,
        document.body,
      )}

      {/* ── Phase 2 — Payment Required Before Dispatch modal ── */}
      {blockedAssign && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
          onClick={() => {
            if (blockedOverriding) return;
            setBlockedAssign(null);
            setBlockedOverrideMode(false);
            setBlockedOverrideOtherMode(false);
            setBlockedOverrideReason("");
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="dispatch-prepay-modal-title"
        >
          <div
            className="rounded-2xl border p-6 w-[420px] max-w-[92vw]"
            style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-3">
              <div
                className="rounded-full p-2 shrink-0"
                style={{ background: "var(--t-error-soft)" }}
              >
                <AlertTriangle className="h-5 w-5" style={{ color: "var(--t-error)" }} />
              </div>
              <div className="min-w-0">
                <h3
                  id="dispatch-prepay-modal-title"
                  className="text-sm font-bold leading-tight"
                  style={{ color: "var(--t-text-primary)" }}
                >
                  {FEATURE_REGISTRY.dispatch_prepayment_modal_title?.label ??
                    "Payment Required Before Dispatch"}
                </h3>
                <p className="mt-1 text-xs" style={{ color: "var(--t-text-muted)" }}>
                  {formatJobNumber(blockedAssign.job.job_number)}
                  {blockedAssign.job.customer
                    ? ` · ${blockedAssign.job.customer.first_name} ${blockedAssign.job.customer.last_name}`
                    : ""}
                </p>
              </div>
            </div>

            <p
              className="text-sm mb-4 leading-relaxed"
              style={{ color: "var(--t-text-secondary)" }}
            >
              {FEATURE_REGISTRY.dispatch_prepayment_modal_body?.label ??
                "This customer requires payment before dispatch and this job has no paid invoice."}
            </p>

            {blockedOverrideMode ? (
              <div className="space-y-3 mb-4">
                {/* Phase 2 polish — preset reason quick-select. The
                    presets fill `blockedOverrideReason` directly with
                    their registry label so the submit path is
                    unchanged: backend still receives a single
                    `creditOverride.reason` string and the audit row
                    stores it verbatim. "Other" reveals the textarea
                    for the free-text path. */}
                <div className="flex flex-wrap gap-1.5">
                  {PREPAY_OVERRIDE_REASON_PRESET_IDS.map((presetId) => {
                    const presetLabel = FEATURE_REGISTRY[presetId]?.label ?? presetId;
                    const isSelected =
                      !blockedOverrideOtherMode &&
                      blockedOverrideReason === presetLabel;
                    return (
                      <button
                        key={presetId}
                        type="button"
                        onClick={() => {
                          setBlockedOverrideOtherMode(false);
                          setBlockedOverrideReason(presetLabel);
                        }}
                        disabled={blockedOverriding}
                        className="rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all disabled:opacity-50"
                        style={{
                          background: isSelected
                            ? "var(--t-accent)"
                            : "var(--t-bg-card-hover, var(--t-bg-card))",
                          color: isSelected
                            ? "var(--t-accent-on-accent)"
                            : "var(--t-text-primary)",
                          border: `1px solid ${isSelected ? "var(--t-accent)" : "var(--t-border)"}`,
                        }}
                      >
                        {presetLabel}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      setBlockedOverrideOtherMode(true);
                      setBlockedOverrideReason("");
                    }}
                    disabled={blockedOverriding}
                    className="rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all disabled:opacity-50"
                    style={{
                      background: blockedOverrideOtherMode
                        ? "var(--t-accent)"
                        : "var(--t-bg-card-hover, var(--t-bg-card))",
                      color: blockedOverrideOtherMode
                        ? "var(--t-accent-on-accent)"
                        : "var(--t-text-primary)",
                      border: `1px solid ${blockedOverrideOtherMode ? "var(--t-accent)" : "var(--t-border)"}`,
                    }}
                  >
                    {FEATURE_REGISTRY[PREPAY_OVERRIDE_REASON_OTHER_ID]?.label ?? "Other"}
                  </button>
                </div>

                {blockedOverrideOtherMode && (
                  <textarea
                    value={blockedOverrideReason}
                    onChange={(e) => setBlockedOverrideReason(e.target.value)}
                    placeholder={
                      FEATURE_REGISTRY.dispatch_prepayment_override_reason_placeholder?.label ??
                      "Reason for override (required)"
                    }
                    rows={3}
                    className="w-full rounded-[12px] border px-3 py-2 text-sm outline-none resize-none focus:border-[var(--t-accent)]"
                    style={{
                      borderColor: "var(--t-border)",
                      color: "var(--t-text-primary)",
                      background: "var(--t-bg-input, var(--t-bg-card))",
                    }}
                    disabled={blockedOverriding}
                    autoFocus
                  />
                )}

                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => {
                      setBlockedOverrideMode(false);
                      setBlockedOverrideOtherMode(false);
                      setBlockedOverrideReason("");
                    }}
                    disabled={blockedOverriding}
                    className="rounded-full px-4 py-2 text-xs font-medium disabled:opacity-50"
                    style={{ color: "var(--t-text-muted)" }}
                  >
                    {FEATURE_REGISTRY.dispatch_prepayment_action_cancel?.label ?? "Cancel"}
                  </button>
                  <button
                    onClick={async () => {
                      if (!blockedOverrideReason.trim()) {
                        toast("error", "Reason required");
                        return;
                      }
                      setBlockedOverriding(true);
                      try {
                        await api.patch(
                          `/jobs/${blockedAssign.job.id}/assign`,
                          {
                            assignedDriverId: blockedAssign.targetDriverId,
                            creditOverride: { reason: blockedOverrideReason },
                          },
                        );
                        toast(
                          "success",
                          `${formatJobNumber(blockedAssign.job.job_number)} assigned with override`,
                        );
                        setBlockedAssign(null);
                        setBlockedOverrideMode(false);
                        setBlockedOverrideOtherMode(false);
                        setBlockedOverrideReason("");
                        await fetchBoard(true);
                      } catch (err) {
                        toast(
                          "error",
                          isCreditBlockError(err) ??
                            (err instanceof Error ? err.message : "Override failed"),
                        );
                      } finally {
                        setBlockedOverriding(false);
                      }
                    }}
                    disabled={blockedOverriding || !blockedOverrideReason.trim()}
                    className="rounded-full px-4 py-2 text-xs font-semibold disabled:opacity-50"
                    style={{
                      background: "var(--t-accent)",
                      color: "var(--t-accent-on-accent)",
                    }}
                  >
                    {blockedOverriding
                      ? "Overriding…"
                      : FEATURE_REGISTRY.dispatch_prepayment_action_override?.label ??
                        "Override & Dispatch"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {blockedAssign.job.linked_invoice_id && (
                  <Link
                    href={`/invoices/${blockedAssign.job.linked_invoice_id}`}
                    className="rounded-[12px] border px-4 py-2 text-sm font-medium text-center transition-colors hover:bg-[var(--t-bg-card-hover)]"
                    style={{
                      borderColor: "var(--t-border)",
                      color: "var(--t-text-primary)",
                    }}
                    onClick={() => {
                      setBlockedAssign(null);
                      setBlockedOverrideMode(false);
                      setBlockedOverrideOtherMode(false);
                      setBlockedOverrideReason("");
                    }}
                  >
                    {FEATURE_REGISTRY.dispatch_prepayment_action_view_invoice?.label ??
                      "View Invoice"}
                  </Link>
                )}
                {blockedAssign.job.customer?.id && (
                  <Link
                    href={`/customers/${blockedAssign.job.customer.id}`}
                    className="rounded-[12px] border px-4 py-2 text-sm font-medium text-center transition-colors hover:bg-[var(--t-bg-card-hover)]"
                    style={{
                      borderColor: "var(--t-border)",
                      color: "var(--t-text-primary)",
                    }}
                    onClick={() => {
                      setBlockedAssign(null);
                      setBlockedOverrideMode(false);
                      setBlockedOverrideOtherMode(false);
                      setBlockedOverrideReason("");
                    }}
                  >
                    {FEATURE_REGISTRY.dispatch_prepayment_action_open_customer_billing?.label ??
                      "Open Customer Account"}
                  </Link>
                )}
                <div className="flex gap-2 justify-end mt-1">
                  <button
                    onClick={() => {
                      setBlockedAssign(null);
                      setBlockedOverrideMode(false);
                      setBlockedOverrideOtherMode(false);
                      setBlockedOverrideReason("");
                    }}
                    className="rounded-full px-4 py-2 text-xs font-medium"
                    style={{ color: "var(--t-text-muted)" }}
                  >
                    {FEATURE_REGISTRY.dispatch_prepayment_action_cancel?.label ?? "Cancel"}
                  </button>
                  {blockedAssign.overrideAllowed && (
                    <button
                      onClick={() => {
                        setBlockedOverrideMode(true);
                        setBlockedOverrideOtherMode(false);
                        setBlockedOverrideReason("");
                      }}
                      className="rounded-full px-4 py-2 text-xs font-semibold"
                      style={{
                        background: "var(--t-accent)",
                        color: "var(--t-accent-on-accent)",
                      }}
                    >
                      {FEATURE_REGISTRY.dispatch_prepayment_action_override?.label ??
                        "Override & Dispatch"}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}

      {/* ── Reschedule Modal ── */}
      {rescheduleJob && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={() => setRescheduleJob(null)}>
          <div className="rounded-2xl border p-6 w-80" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}
            onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--t-text-primary)" }}>Reschedule {formatJobNumber(rescheduleJob.job_number)}</h3>
            <p className="text-xs mb-4" style={{ color: "#8A8A8A" }}>
              {rescheduleJob.customer ? `${rescheduleJob.customer.first_name} ${rescheduleJob.customer.last_name}` : ""}
            </p>
            <input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm mb-4 outline-none"
              style={{ background: "var(--t-bg-primary)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setRescheduleJob(null)} className="rounded-full px-4 py-2 text-xs font-medium"
                style={{ color: "#8A8A8A" }}>Cancel</button>
              <button onClick={handleReschedule} disabled={!rescheduleDate} className="rounded-full px-4 py-2 text-xs font-semibold disabled:opacity-40"
                style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}>Move Job</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ── QuickView ── */}
      <QuickView isOpen={!!quickViewJob} onClose={() => { setQuickViewJob(null); setQvDetail(null); setQvCreditState(null); }}
        title={quickViewJob ? `${quickViewJob.asset_subtype || quickViewJob.asset?.subtype || ""} ${getTypeLabel(quickViewJob.job_type)}`.trim() : ""}
        subtitle={formatJobNumber(quickViewJob?.job_number)}
        actions={quickViewJob ? <Link href={`/jobs/${quickViewJob.id}`} className="rounded-full px-3 py-1.5 text-xs font-medium" style={{ background: "var(--t-bg-card-hover)", color: "var(--t-text-primary)" }}><ExternalLink className="h-3 w-3 inline mr-1" />Full Detail</Link> : undefined}
        footer={quickViewJob ? (
          <div className="flex gap-2">
            {quickViewJob.customer?.phone && <a href={`tel:${quickViewJob.customer.phone}`} className="flex-1 flex items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-semibold" style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}><Phone className="h-3.5 w-3.5" /> Call</a>}
            {quickViewJob.service_address && <button onClick={() => { const a = quickViewJob.service_address!; window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([a.street, a.city, a.state].filter(Boolean).join(", "))}`, "_blank"); }}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-full py-2.5 text-xs font-semibold border" style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}><Navigation className="h-3.5 w-3.5" /> Navigate</button>}
          </div>
        ) : undefined}
      >
        {quickViewJob && qvLoading ? <QuickViewSkeleton /> : quickViewJob && qvDetail ? (
          <QVContent job={quickViewJob} detail={qvDetail} board={board} creditState={qvCreditState} onAssign={async (jid, did, creditOverride) => {
            await api.patch(`/jobs/${jid}/assign`, { assignedDriverId: did, ...(creditOverride ? { creditOverride } : {}) }); toast("success", "Reassigned"); await fetchBoard(true);
          }} onRefresh={() => fetchBoard(true)} toast={toast} />
        ) : null}
      </QuickView>

      {/* ── Awaiting Dump slide panel ── */}
      <QuickView
        isOpen={showYardPanel}
        onClose={() => setShowYardPanel(false)}
        title="Awaiting Dump"
        subtitle={`${yardQueue.length} asset${yardQueue.length !== 1 ? "s" : ""} staged`}
      >
        <div className="space-y-4">
          {(() => {
            const byYard = new Map<string, typeof yardQueue>();
            yardQueue.forEach(a => {
              const yardName = a.yard?.name || "Unspecified Yard";
              if (!byYard.has(yardName)) byYard.set(yardName, []);
              byYard.get(yardName)!.push(a);
            });
            return Array.from(byYard.entries()).map(([yardName, assets]) => (
              <div key={yardName}>
                <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--t-text-muted)" }}>{yardName}</p>
                <div className="space-y-2">
                  {assets.map(asset => {
                    const waitHours = asset.staged_at ? Math.round((Date.now() - new Date(asset.staged_at).getTime()) / 3600000) : 0;
                    const sizeLabel = (asset.subtype || "").replace(/yd$/i, "Y").toUpperCase();
                    return (
                      <div key={asset.id} className="rounded-xl border px-4 py-3 flex items-center justify-between"
                        style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-extrabold" style={{ color: "var(--t-text-primary)" }}>{sizeLabel || "\u2014"}</span>
                            <span className="text-xs font-bold" style={{ color: "var(--t-accent-text)" }}>{asset.identifier}</span>
                          </div>
                          <p className="text-[11px] mt-0.5" style={{ color: waitHours > 24 ? "var(--t-error)" : "var(--t-warning)" }}>
                            {waitHours > 0 ? `${waitHours}h waiting` : "Just arrived"}
                          </p>
                          {asset.staged_waste_type && <p className="text-[10px] mt-0.5" style={{ color: "var(--t-text-muted)" }}>{asset.staged_waste_type}</p>}
                        </div>
                        <Dropdown
                          trigger={
                            <button onClick={e => e.stopPropagation()} className="shrink-0 rounded-full px-3 py-1.5 text-[10px] font-semibold"
                              style={{ background: "rgba(217,119,6,0.1)", color: "var(--t-warning)", border: "1px solid rgba(217,119,6,0.2)" }}>
                              Create Run
                            </button>
                          }
                          align="right"
                        >
                          <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--t-text-muted)" }}>Assign Driver</p>
                          <button onClick={async () => {
                            try {
                              await api.post("/jobs/dump-run", { assetIds: [asset.id], scheduledDate: date });
                              toast("success", `Dump run created for ${asset.identifier} (unassigned)`);
                              fetchBoard(true); fetchYardQueue();
                            } catch (err: any) { toast("error", err.message || "Failed to create dump run"); }
                          }} className="flex w-full items-center gap-2 px-3 py-2 text-xs whitespace-nowrap" style={{ color: "var(--t-text-muted)" }}>
                            Unassigned
                          </button>
                          {board?.drivers.map(col => (
                            <button key={col.driver.id} onClick={async () => {
                              try {
                                await api.post("/jobs/dump-run", { assetIds: [asset.id], assignedDriverId: col.driver.id, scheduledDate: date });
                                toast("success", `Dump run created for ${asset.identifier} → ${col.driver.firstName} ${col.driver.lastName}`);
                                fetchBoard(true); fetchYardQueue();
                              } catch (err: any) { toast("error", err.message || "Failed to create dump run"); }
                            }} className="flex w-full items-center gap-2 px-3 py-2 text-xs whitespace-nowrap" style={{ color: "var(--t-text-primary)" }}>
                              <div className="flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold" style={{ background: "var(--t-accent-soft)", color: "var(--t-accent)" }}>
                                {col.driver.firstName[0]}{col.driver.lastName[0]}
                              </div>
                              {col.driver.firstName} {col.driver.lastName}
                            </button>
                          ))}
                        </Dropdown>
                      </div>
                    );
                  })}
                </div>
              </div>
            ));
          })()}
          {yardQueue.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10">
              <CheckCircle2 className="h-6 w-6 mb-2" style={{ color: "var(--t-accent)", opacity: 0.4 }} />
              <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>No assets awaiting dump</p>
            </div>
          )}
        </div>
      </QuickView>

      {/* Driver Task V1 — create drawer */}
      {newTaskOpen && (
        <NewTaskDrawer
          drivers={board?.drivers || []}
          defaultDriverId={newTaskOpen.defaultDriverId}
          defaultDate={newTaskOpen.defaultDate}
          onClose={() => setNewTaskOpen(null)}
          onCreated={async () => {
            setNewTaskOpen(null);
            toast("success", FEATURE_REGISTRY.dispatch_new_task_created?.label ?? "Task created");
            await fetchBoard(true);
          }}
          onError={(msg) => toast("error", msg)}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Driver Task V1 — create drawer
   ═══════════════════════════════════════════════════

   Lightweight slide-over launched from the dispatch top bar. Posts to
   `/jobs/driver-task` which creates a job with `job_type =
   'driver_task'` — the same precedent as `createDumpRun`. The drawer
   intentionally keeps V1 lean: title, driver, date, optional address,
   optional notes. No billing, no customer, no lifecycle integration.
*/
function NewTaskDrawer({
  drivers,
  defaultDriverId,
  defaultDate,
  onClose,
  onCreated,
  onError,
}: {
  drivers: Array<{ driver: { id: string; firstName: string; lastName: string } }>;
  defaultDriverId?: string;
  defaultDate: string;
  onClose: () => void;
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [driverId, setDriverId] = useState<string>(defaultDriverId || "");
  const [scheduledDate, setScheduledDate] = useState(defaultDate);
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const inputCls =
    "w-full rounded-[14px] border bg-[var(--t-bg-card)] border-[var(--t-border)] px-4 py-2.5 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)]";
  const labelCls =
    "block text-[11px] font-semibold uppercase tracking-wide mb-1.5 text-[var(--t-text-muted)]";

  const handleSubmit = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      onError(FEATURE_REGISTRY.dispatch_new_task_title_required?.label ?? "Task title is required");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/jobs/driver-task", {
        title: trimmed,
        assignedDriverId: driverId || null,
        scheduledDate,
        serviceAddress: address.trim()
          ? { street: address.trim() }
          : null,
        notes: notes.trim() || null,
      });
      onCreated();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create task";
      onError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-stretch justify-end bg-black/50"
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-md overflow-y-auto border-l"
        style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b px-5 py-4"
          style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
          <div>
            <h2 className="text-base font-bold text-[var(--t-text-primary)]">
              {FEATURE_REGISTRY.dispatch_new_task_drawer_title?.label ?? "New Driver Task"}
            </h2>
            <p className="text-[11px] mt-0.5 text-[var(--t-text-muted)]">
              {FEATURE_REGISTRY.dispatch_new_task_drawer_subtitle?.shortDescription
                ?? "Internal one-off task — not a customer rental job."}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--t-bg-card-hover)]">
            <X className="h-4 w-4 text-[var(--t-text-muted)]" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className={labelCls}>
              {FEATURE_REGISTRY.dispatch_new_task_field_title?.label ?? "Task Title"}
              <span className="text-[var(--t-error, #ef4444)] ml-0.5">*</span>
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                FEATURE_REGISTRY.dispatch_new_task_field_title_placeholder?.label
                  ?? "e.g. Bring truck to Smith Auto Repair"
              }
              className={inputCls}
              autoFocus
            />
          </div>

          <div>
            <label className={labelCls}>
              {FEATURE_REGISTRY.dispatch_new_task_field_driver?.label ?? "Assigned Driver"}
            </label>
            <select
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              className={inputCls}
            >
              <option value="">Unassigned</option>
              {drivers.map((d) => (
                <option key={d.driver.id} value={d.driver.id}>
                  {d.driver.firstName} {d.driver.lastName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelCls}>
              {FEATURE_REGISTRY.dispatch_new_task_field_date?.label ?? "Scheduled Date"}
            </label>
            <input
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>
              {FEATURE_REGISTRY.dispatch_new_task_field_address?.label ?? "Address / Location"}
              <span className="text-[10px] font-normal text-[var(--t-text-muted)] ml-1 normal-case">
                (optional)
              </span>
            </label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={
                FEATURE_REGISTRY.dispatch_new_task_field_address_placeholder?.label
                  ?? "e.g. 123 Shop Ln, Portland, ME"
              }
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>
              {FEATURE_REGISTRY.dispatch_new_task_field_notes?.label ?? "Notes / Instructions"}
              <span className="text-[10px] font-normal text-[var(--t-text-muted)] ml-1 normal-case">
                (optional)
              </span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder={
                FEATURE_REGISTRY.dispatch_new_task_field_notes_placeholder?.label
                  ?? "Any additional context for the driver…"
              }
              className={inputCls}
              style={{ resize: "vertical" }}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSubmit}
              disabled={submitting || !title.trim()}
              className="flex-1 rounded-full py-3 text-sm font-bold disabled:opacity-40"
              style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}
            >
              {submitting
                ? (FEATURE_REGISTRY.dispatch_new_task_submit_busy?.label ?? "Creating…")
                : (FEATURE_REGISTRY.dispatch_new_task_submit?.label ?? "Create Task")}
            </button>
            <button
              onClick={onClose}
              className="rounded-full px-6 py-3 text-sm font-medium border text-[var(--t-text-muted)]"
              style={{ borderColor: "var(--t-border)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ═══════════════════════════════════════════════════
   Dispatch Map — Mapbox GL background
   ═══════════════════════════════════════════════════ */

function DispatchMap({ board, activeJobId }: { board: DispatchBoard | null; activeJobId: string | null }) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const { theme } = useTheme();

  const mapStyle = theme === "light"
    ? "mapbox://styles/mapbox/light-v11"
    : "mapbox://styles/mapbox/dark-v11";

  useEffect(() => {
    if (!HAS_MAP || !mapContainer.current || map.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: mapStyle,
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

  // Switch map style on theme change
  useEffect(() => {
    if (!map.current) return;
    map.current.setStyle(mapStyle);
  }, [mapStyle]);

  // Update job pins when board changes
  useEffect(() => {
    if (!map.current || !board) return;
    // Clear old markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // Find driver name for each job
    const driverMap = new Map<string, string>();
    if (board.drivers) {
      for (const col of board.drivers) {
        for (const j of col.jobs) {
          driverMap.set(j.id, `${col.driver.firstName} ${col.driver.lastName}`);
        }
      }
    }

    const allJobs = [...board.unassigned, ...board.drivers.flatMap(d => d.jobs)];
    for (const job of allJobs) {
      const coords = getJobCoords(job);
      if (!coords) continue;
      const tc = TYPE_CONFIG[job.job_type] || { letter: "?", stripe: "#8A8A8A" };
      const isActive = job.id === activeJobId;
      const el = document.createElement("div");
      el.style.cssText = `width:${isActive ? 40 : 32}px;height:${isActive ? 40 : 32}px;border-radius:50%;background:${tc.stripe};border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:${isActive ? 14 : 11}px;font-weight:bold;color:#fff;cursor:pointer;transition:all 0.2s;box-shadow:0 2px 8px rgba(0,0,0,0.3);`;
      el.textContent = tc.letter;

      const custName = job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : formatJobNumber(job.job_number);
      const addrStr = [job.service_address?.street, job.service_address?.city].filter(Boolean).join(", ") || "No address";
      const typeStr = `${job.asset_subtype || job.asset?.subtype || ""} ${getTypeLabel(job.job_type)}`.trim();
      const driverName = driverMap.get(job.id) || "Unassigned";
      const statusStr = DISPLAY_STATUS_LABELS[deriveDisplayStatus(job.status || "pending")];

      const textColor = theme === "light" ? "#0a0a0a" : "#fff";
      const mutedColor = theme === "light" ? "#666" : "#888";
      const subColor = theme === "light" ? "#888" : "#999";
      const popupHtml = `<div style="font-family:-apple-system,system-ui,sans-serif;padding:6px 2px;min-width:180px">
        <div style="font-size:14px;font-weight:700;color:${textColor};margin-bottom:4px">${custName}</div>
        <div style="font-size:12px;color:${subColor};margin-bottom:8px">${addrStr}</div>
        <div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0"><span style="color:${mutedColor}">Type</span><span style="color:${tc.stripe};font-weight:600">${typeStr}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0"><span style="color:${mutedColor}">Status</span><span style="color:${textColor};text-transform:capitalize">${statusStr}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0"><span style="color:${mutedColor}">Driver</span><span style="color:${textColor}">${driverName}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0"><span style="color:${mutedColor}">Job</span><span style="color:${textColor}">${formatJobNumber(job.job_number)}</span></div>
        <a href="/jobs/${job.id}" style="display:inline-block;margin-top:8px;font-size:12px;color:var(--t-accent-text);text-decoration:none;font-weight:600">View Job →</a>
      </div>`;

      const popup = new mapboxgl.Popup({ offset: 15, closeButton: false, maxWidth: "260px" }).setHTML(popupHtml);
      const marker = new mapboxgl.Marker(el).setLngLat(coords).setPopup(popup).addTo(map.current!);
      markersRef.current.push(marker);
    }

    // Dump location pins
    for (const [name, coords] of Object.entries(DUMP_COORDS)) {
      const el = document.createElement("div");
      el.style.cssText = "width:26px;height:26px;border-radius:50%;background:#8B5CF6;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;color:#fff;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.3);";
      el.textContent = "♻";
      const popup = new mapboxgl.Popup({ offset: 10, closeButton: false }).setHTML(
        `<div style="font-family:-apple-system,system-ui,sans-serif;padding:4px 2px"><div style="font-size:13px;font-weight:600;color:${theme === "light" ? "#0a0a0a" : "#fff"}">${name}</div><div style="font-size:11px;color:#8B5CF6;margin-top:2px">Dump Facility</div></div>`
      );
      const marker = new mapboxgl.Marker(el).setLngLat(coords).setPopup(popup).addTo(map.current!);
      markersRef.current.push(marker);
    }
  }, [board, activeJobId]);

  if (!HAS_MAP) {
    // Fallback dark grid background
    return (
      <div style={{ position: "absolute", inset: 0, background: "var(--t-bg-primary)", zIndex: 0 }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle, var(--t-border) 1px, transparent 1px)", backgroundSize: "30px 30px", opacity: 0.5 }} />
        <div style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", background: "rgba(217,119,6,0.15)", border: "1px solid rgba(217,119,6,0.3)", borderRadius: 12, padding: "8px 16px", fontSize: 12, color: "var(--t-warning)", zIndex: 5 }}>
          Add Mapbox token in Settings to enable the live dispatch map
        </div>
      </div>
    );
  }

  const popupBg = theme === "light" ? "#ffffff" : "#212121";
  const popupBorder = theme === "light" ? "#e5e5e5" : "#333";
  const popupShadow = theme === "light" ? "rgba(0,0,0,0.15)" : "rgba(0,0,0,0.5)";

  return (
    <>
      <style>{`
        .dispatch-map-container .mapboxgl-popup-content {
          background: ${popupBg} !important;
          border-radius: 14px !important;
          padding: 10px 14px !important;
          box-shadow: 0 8px 30px ${popupShadow} !important;
          border: 1px solid ${popupBorder} !important;
        }
        .dispatch-map-container .mapboxgl-popup-tip {
          border-top-color: ${popupBg} !important;
        }
        .dispatch-map-container .mapboxgl-popup-anchor-bottom .mapboxgl-popup-tip {
          border-top-color: ${popupBg} !important;
        }
        .dispatch-map-container .mapboxgl-popup-anchor-top .mapboxgl-popup-tip {
          border-bottom-color: ${popupBg} !important;
        }
        .dispatch-map-container .mapboxgl-popup-anchor-left .mapboxgl-popup-tip {
          border-right-color: ${popupBg} !important;
        }
        .dispatch-map-container .mapboxgl-popup-anchor-right .mapboxgl-popup-tip {
          border-left-color: ${popupBg} !important;
        }
        .dispatch-map-container .mapboxgl-popup-close-button {
          color: #888 !important;
          font-size: 18px !important;
        }
      `}</style>
      <div ref={mapContainer} style={{ position: "absolute", inset: 0, zIndex: 0 }} className="dispatch-map-container" />
    </>
  );
}

/* ═══════════════════════════════════════════════════
   Column Card — white card with accordion collapse
   ═══════════════════════════════════════════════════ */

function ColumnCard({ columnId, title, driver, isUnassigned, count, progress, jobs, drivers, onAssign, onUnassign, onQuickView, onStatusChange, onCtxMenu, activeId, collapsed, onToggleCollapse, onHide, onColumnDrag, driverJobCities, selectedJobs, onSelectJob, onCheckboxToggle, onMoveJob, avgJobCount }: {
  columnId: string; title: string; driver?: Driver; isUnassigned?: boolean;
  count: number; progress?: { completed: number; total: number };
  jobs: DispatchJob[]; drivers?: Driver[];
  onAssign?: (jobId: string, driverId: string | null) => void;
  onUnassign?: (jobId: string) => void;
  onQuickView: (job: DispatchJob) => void;
  onStatusChange?: (jobId: string, newStatus: string) => void;
  onCtxMenu?: (e: React.MouseEvent, job: DispatchJob) => void;
  activeId: string | null;
  collapsed: boolean; onToggleCollapse: () => void; onHide?: () => void;
  onColumnDrag?: { onDragStart: (e: React.DragEvent) => void; onDragOver: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void; onDragEnd: (e: React.DragEvent) => void };
  driverJobCities?: Array<{ driverName: string; cities: string[] }>;
  selectedJobs?: Set<string>;
  onSelectJob?: (jobId: string, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void;
  onCheckboxToggle?: (jobId: string, e: { shiftKey: boolean }) => void;
  onMoveJob?: (jobId: string, position: "top" | "bottom") => void;
  avgJobCount?: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId });
  const completedCount = progress?.completed || 0;
  const totalCount = progress?.total || count;

  // Step 3: Capacity type breakdown counts
  const deliveryCount = jobs.filter(j => j.job_type === 'delivery').length;
  const pickupCount = jobs.filter(j => j.job_type === 'pickup').length;
  const exchangeCount = jobs.filter(j => j.job_type === 'exchange').length;

  // Step 2: Next Stop Preview logic
  const activeJob = jobs.find(j => j.status === 'en_route' || j.status === 'in_progress');
  const nextJob = activeJob || jobs.find(j => j.status !== 'completed' && j.status !== 'cancelled');
  const allDone = jobs.length > 0 && jobs.every(j => j.status === 'completed' || j.status === 'cancelled');

  // Step 5: Proximity suggestion for unassigned jobs
  const getSuggestion = (job: DispatchJob): string | undefined => {
    if (!isUnassigned || !driverJobCities) return;
    const jobCity = job.service_address?.city;
    if (!jobCity) return;
    const match = driverJobCities.find(d => d.cities.some(c => c.toLowerCase() === jobCity.toLowerCase()));
    return match ? `Near ${match.driverName}'s route` : undefined;
  };

  const firstIncomplete = jobs.find(j => j.status !== "completed");
  const hiddenCount = collapsed && jobs.length > 1 ? jobs.length - 1 : 0;

  // Load indicator
  const loadLevel = totalCount <= 3 ? "light" : totalCount <= 6 ? "medium" : "heavy";
  const loadColor = loadLevel === "light" ? "var(--t-accent)" : loadLevel === "medium" ? "var(--t-warning)" : "var(--t-error)";
  const loadPercent = Math.min(totalCount / 10, 1); // 10 jobs = full bar

  // Route time span
  const jobTimes = jobs
    .filter(j => j.scheduled_window_start && j.status !== "cancelled")
    .map(j => j.scheduled_window_start)
    .sort();
  const jobEndTimes = jobs
    .filter(j => j.scheduled_window_end && j.status !== "cancelled")
    .map(j => j.scheduled_window_end)
    .sort();
  const firstTime = jobTimes[0] || null;
  const lastTime = jobEndTimes[jobEndTimes.length - 1] || jobTimes[jobTimes.length - 1] || null;

  // Needs review: heavy load OR significantly above average OR wide time spread (>8h)
  const timeSpreadHours = firstTime && lastTime
    ? (() => { const [h1, m1] = firstTime.split(":").map(Number); const [h2, m2] = lastTime.split(":").map(Number); return (h2 + m2 / 60) - (h1 + m1 / 60); })()
    : 0;
  const isOverloaded = !isUnassigned && totalCount >= 8;
  const isImbalanced = !isUnassigned && avgJobCount != null && avgJobCount > 0 && totalCount > avgJobCount * 1.5 && totalCount >= 4;
  const isWideSpread = !isUnassigned && timeSpreadHours > 8;
  const needsReview = isOverloaded || isImbalanced || isWideSpread;

  return (
    <div ref={setNodeRef}
      className="shrink-0 rounded-[20px] transition-all duration-200"
      style={{
        width: 340, minWidth: 340,
        border: isOver && activeId ? "2px solid var(--t-accent)" : "1px solid var(--t-border-strong)",
        background: isOver && activeId
          ? "var(--t-bg-elevated)"
          : isUnassigned ? "var(--t-bg-secondary)" : "var(--t-bg-secondary)",
        boxShadow: isOver && activeId
          ? "0 0 0 1px var(--t-accent), 0 8px 32px var(--t-shadow)"
          : "0 8px 32px var(--t-shadow)",
      }}>

      {/* ── Header — control bar feel ── */}
      <div className="px-4 pt-3.5 pb-3 shrink-0"
        draggable={!isUnassigned && !!onColumnDrag}
        onDragStart={onColumnDrag?.onDragStart}
        onDragOver={onColumnDrag?.onDragOver}
        onDrop={onColumnDrag?.onDrop}
        onDragEnd={onColumnDrag?.onDragEnd}
        style={{
          borderBottom: "1px solid var(--t-border)",
          cursor: !isUnassigned && onColumnDrag ? "grab" : "default",
          background: isUnassigned ? "var(--t-warning-soft)" : "var(--t-bg-inset)",
          borderRadius: "20px 20px 0 0",
        }}>
        {/* Row 1: Avatar + Full Name + Menu */}
        <div className="flex items-center gap-2.5">
          {isUnassigned ? (
            <div className="flex h-9 w-9 items-center justify-center rounded-full shrink-0" style={{ background: "rgba(217,119,6,0.15)", color: "var(--t-warning)" }}>
              <UserPlus className="h-4.5 w-4.5" />
            </div>
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-bold shrink-0" style={{ background: "var(--t-accent-soft)", color: "var(--t-accent)" }}>
              {title.split(" ").map(n => n[0]).join("")}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[15px] font-extrabold leading-tight tracking-[-0.3px]" style={{ color: isUnassigned ? "var(--t-warning)" : "var(--t-text-primary)" }}>{title}</p>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums" style={{ background: isUnassigned ? "rgba(217,119,6,0.1)" : "var(--t-badge-bg)", color: isUnassigned ? "var(--t-warning)" : "var(--t-badge-text)" }}>
                {count}
              </span>
            </div>
            {driver?.phone && <p className="text-[11px] mt-0.5" style={{ color: "var(--t-text-muted)" }}>{formatPhone(driver.phone)}</p>}
          </div>
          {(
            <Dropdown trigger={
              <button className="shrink-0 p-1 rounded-lg transition-all" style={{ color: "#8A8A8A" }}
                onMouseEnter={e => { e.currentTarget.style.background = "var(--t-bg-card-hover)"; }} onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
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
        {/* Row 2: Load bar + stops + type breakdown + review badge */}
        <div className="flex items-center gap-2 mt-2">
          {/* Load bar (segmented feel) */}
          {!isUnassigned && count > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="w-12 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--t-bg-card-hover)" }}>
                <div className="h-full rounded-full transition-all duration-300" style={{ width: `${loadPercent * 100}%`, background: loadColor }} />
              </div>
            </div>
          )}
          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums"
            style={{ background: "var(--t-bg-card-hover)", color: "var(--t-text-secondary)" }}>
            {completedCount > 0 ? `${completedCount}/${totalCount} done` : count === 1 ? "1 stop" : `${count} stops`}
          </span>
          {(deliveryCount > 0 || pickupCount > 0 || exchangeCount > 0) && (
            <span className="text-[10px] tabular-nums" style={{ color: "var(--t-text-muted)" }}>
              {deliveryCount > 0 && `${deliveryCount}D`}{pickupCount > 0 && ` ${pickupCount}P`}{exchangeCount > 0 && ` ${exchangeCount}X`}
            </span>
          )}
          {needsReview && (
            <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold" style={{ background: "var(--t-warning-soft)", color: "var(--t-warning)" }}>
              {isOverloaded ? "HEAVY" : isWideSpread ? "SPREAD" : "IMBAL"}
            </span>
          )}
          {progress && progress.total > 0 && (
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--t-bg-card-hover)" }}>
              <div className="h-full rounded-full" style={{ width: `${(progress.completed / progress.total) * 100}%`, background: "var(--t-accent)", transition: "width 0.3s ease" }} />
            </div>
          )}
          <button onClick={onToggleCollapse} className="shrink-0 p-1 rounded-lg transition-all ml-auto" style={{ color: "var(--t-text-muted)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "var(--t-bg-card-hover)"; }} onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
            <ChevronDown className="h-4 w-4 transition-transform duration-200" style={{ transform: collapsed ? "rotate(0deg)" : "rotate(180deg)" }} />
          </button>
        </div>
        {/* Row 3: Route time summary */}
        {!isUnassigned && (firstTime || lastTime) && (
          <div className="flex items-center gap-1.5 mt-1.5 text-[10px] tabular-nums" style={{ color: "var(--t-text-muted)" }}>
            <Clock className="h-3 w-3 shrink-0" />
            <span>{fmtTime(firstTime)}</span>
            {lastTime && firstTime !== lastTime && <><span>→</span><span>{fmtTime(lastTime)}</span></>}
            {timeSpreadHours > 0 && <span style={{ color: timeSpreadHours > 8 ? "var(--t-warning)" : "var(--t-text-muted)" }}>({Math.round(timeSpreadHours)}h)</span>}
          </div>
        )}
      </div>

      {/* ── Next Stop Preview ── */}
      {!isUnassigned && jobs.length > 0 && (
        <div style={{ padding: "8px 12px", background: "var(--t-bg-card-hover)", borderBottom: "1px solid var(--t-border)", fontSize: 12 }}>
          {allDone ? (
            <div className="flex items-center gap-1.5" style={{ color: "var(--t-accent-text)" }}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span className="font-medium">All stops complete</span>
            </div>
          ) : activeJob ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "var(--t-accent)", animation: "pulse 2s infinite", flexShrink: 0 }} />
              <span className="font-bold" style={{ color: "var(--t-accent-text)" }}>NOW:</span>
              <span className="truncate" style={{ color: "var(--t-text-primary)" }}>
                {(activeJob.asset_subtype || activeJob.asset?.subtype || "").replace(/yd$/i, "Y").toUpperCase()}{" "}
                {getTypeLabel(activeJob.job_type).toUpperCase()}
                {activeJob.service_address ? ` — ${[activeJob.service_address.street, activeJob.service_address.city].filter(Boolean).join(", ")}` : ""}
              </span>
            </div>
          ) : nextJob ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-bold" style={{ color: "var(--t-text-muted)" }}>NEXT:</span>
              <span className="truncate" style={{ color: "var(--t-text-primary)" }}>
                {(nextJob.asset_subtype || nextJob.asset?.subtype || "").replace(/yd$/i, "Y").toUpperCase()}{" "}
                {getTypeLabel(nextJob.job_type).toUpperCase()}
                {nextJob.service_address ? ` — ${[nextJob.service_address.street, nextJob.service_address.city].filter(Boolean).join(", ")}` : ""}
              </span>
            </div>
          ) : null}
        </div>
      )}

      {/* ── Job cards area ── */}
      <SortableContext items={jobs.map(j => j.id)} strategy={verticalListSortingStrategy}>
        <div style={{
          maxHeight: collapsed ? 120 : 2000,
          overflow: "hidden",
          transition: "max-height 0.25s ease",
          background: isUnassigned && jobs.length > 0 ? "var(--t-warning-soft)" : "transparent",
          padding: jobs.length > 0 ? "8px 10px" : 0,
        }}>
          {jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8" style={{ padding: 10 }}>
              {isUnassigned
                ? <><CheckCircle2 className="h-5 w-5 mb-1.5" style={{ color: "var(--t-accent)", opacity: 0.5 }} /><p className="text-[12px] font-medium" style={{ color: "var(--t-accent)" }}>All assigned</p></>
                : <><Box className="h-5 w-5 mb-1.5" style={{ color: "var(--t-text-tertiary)" }} /><p className="text-[12px]" style={{ color: "var(--t-text-muted)" }}>No jobs</p></>}
            </div>
          ) : (
            <div className="space-y-0">
              {jobs.map((job, idx) => {
                const prevJob = idx > 0 ? jobs[idx - 1] : null;
                const needsYardStop = job.job_type === 'delivery' && prevJob?.job_type === 'delivery' &&
                  (job.asset_subtype || job.asset?.subtype) && (prevJob.asset_subtype || prevJob.asset?.subtype) &&
                  (job.asset_subtype || job.asset?.subtype) !== (prevJob.asset_subtype || prevJob.asset?.subtype);
                return (
                  <div key={job.id}>
                    {/* Connector line between stops */}
                    {idx > 0 && !isUnassigned && (
                      <div className="flex justify-center py-0.5">
                        <div style={{ width: 1, height: 6, background: "var(--t-border-strong)" }} />
                      </div>
                    )}
                    {isUnassigned && idx > 0 && <div style={{ height: 8 }} />}
                    <JobTile key={job.id} job={job} isUnassigned={!!isUnassigned} drivers={drivers}
                      onAssign={onAssign} onUnassign={onUnassign} onQuickView={() => onQuickView(job)}
                      onStatusChange={onStatusChange} onCtxMenu={onCtxMenu}
                      needsYardStop={!!needsYardStop}
                      proximitySuggestion={getSuggestion(job)}
                      isSelected={selectedJobs?.has(job.id) || false}
                      onSelectJob={onSelectJob}
                      onCheckboxToggle={onCheckboxToggle}
                      stopNumber={isUnassigned ? undefined : idx + 1}
                      totalStops={isUnassigned ? undefined : jobs.length}
                      onMoveToTop={!isUnassigned && idx > 0 ? () => onMoveJob?.(job.id, "top") : undefined}
                      onMoveToBottom={!isUnassigned && idx < jobs.length - 1 ? () => onMoveJob?.(job.id, "bottom") : undefined} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SortableContext>

      {/* "+N more" indicator when collapsed */}
      {collapsed && hiddenCount > 0 && (
        <div className="text-center py-1.5 cursor-pointer" onClick={onToggleCollapse}
          style={{ background: "var(--t-bg-card-hover)", borderTop: "1px solid var(--t-border)", transition: "opacity 0.2s ease" }}>
          <span className="text-[11px] font-medium" style={{ color: "#8A8A8A" }}>+{hiddenCount} more stop{hiddenCount > 1 ? "s" : ""}</span>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Job Tile — white card, entire tile draggable
   ═══════════════════════════════════════════════════ */

const JobTile = memo(function JobTile({ job, isUnassigned, drivers, onAssign, onUnassign, onQuickView, onStatusChange, onCtxMenu, needsYardStop, proximitySuggestion, isSelected, onSelectJob, onCheckboxToggle, stopNumber, totalStops, onMoveToTop, onMoveToBottom }: {
  job: DispatchJob; isUnassigned: boolean; drivers?: Driver[];
  onAssign?: (jobId: string, driverId: string | null) => void;
  onUnassign?: (jobId: string) => void;
  onQuickView: () => void;
  onStatusChange?: (jobId: string, newStatus: string) => void;
  onCtxMenu?: (e: React.MouseEvent, job: DispatchJob) => void;
  needsYardStop?: boolean;
  proximitySuggestion?: string;
  isSelected?: boolean;
  onSelectJob?: (jobId: string, e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void;
  onCheckboxToggle?: (jobId: string, e: { shiftKey: boolean }) => void;
  stopNumber?: number;
  totalStops?: number;
  onMoveToTop?: () => void;
  onMoveToBottom?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: job.id });
  const isCompleted = job.status === "completed";
  const tc = TYPE_CONFIG[job.job_type] || { letter: "?", stripe: "#8A8A8A" };
  const typeLabel = getTypeLabel(job.job_type);
  const addr = job.service_address;
  const addrStr = addr ? [addr.street, addr.city].filter(Boolean).join(", ") : "";
  const size = job.asset_subtype || job.asset?.subtype || "";

  return (
    <div ref={setNodeRef} {...attributes} {...listeners}
      style={{
        transform: CSS.Transform.toString(transform), transition,
        opacity: isDragging ? 0.3 : 1,
        border: isSelected ? "1.5px solid var(--t-accent)" : "1px solid var(--t-border)",
        boxShadow: isDragging ? "0 8px 24px rgba(0,0,0,0.15)" : isSelected ? "0 0 0 1px var(--t-accent)" : "0 1px 3px rgba(0,0,0,0.06)",
        cursor: isDragging ? "grabbing" : "grab",
        touchAction: "none",
        backgroundColor: isSelected ? "var(--t-accent-soft)" : isCompleted ? "var(--t-bg-card-hover)" : "var(--t-bg-card)",
      }}
      className="group relative rounded-[14px]"
      onClick={(e) => {
        // Don't select if clicking interactive controls (buttons, links, dropdowns)
        const target = e.target as HTMLElement;
        if (target.closest("button") || target.closest("a") || target.closest("[data-no-select]")) return;
        onSelectJob?.(job.id, { shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
      }}
      onDoubleClick={onQuickView}
      onContextMenu={onCtxMenu ? (e) => onCtxMenu(e, job) : undefined}
    >
      {/* Left accent bar — colored by job type */}
      <div className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full" style={{ background: tc.stripe }} />

      {/* Warning dot for overdue or failed trip */}
      {(job.is_overdue || job.is_failed_trip) && (
        <div
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 7,
            height: 7,
            borderRadius: "50%",
            backgroundColor: job.is_failed_trip ? "var(--t-error)" : "var(--t-warning)",
            zIndex: 1,
            pointerEvents: "none",
          }}
        />
      )}

      <div className="py-2.5 pl-2 pr-2 flex items-center gap-2">
        {/* Stop number or checkbox */}
        <button
          onClick={(e) => { e.stopPropagation(); onCheckboxToggle?.(job.id, { shiftKey: e.shiftKey }); }}
          className="shrink-0 flex items-center justify-center w-6 h-6 rounded-lg text-[11px] font-bold tabular-nums transition-all"
          style={{
            border: isSelected ? "1.5px solid var(--t-accent)" : "1px solid var(--t-border-strong)",
            background: isSelected ? "var(--t-accent)" : "transparent",
            color: isSelected ? "var(--t-accent-on-accent)" : "var(--t-text-muted)",
          }}>
          {isSelected ? <CheckCircle2 className="h-3 w-3" /> : stopNumber || "—"}
        </button>
        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Line 1: Size (primary) + Type (secondary) */}
          <div className="flex items-baseline gap-1.5 flex-wrap">
            {size && <span className="text-[14px] font-extrabold leading-none" style={{ color: "var(--t-text-primary)" }}>{size.replace(/yd$/i, "Y").toUpperCase()}</span>}
            <span className="text-[11px] font-semibold uppercase tracking-wide leading-none" style={{ color: "var(--t-text-muted)" }}>{typeLabel}</span>
            {isCompleted && <CheckCircle2 className="h-3 w-3 ml-0.5" style={{ color: "var(--t-accent-text)" }} />}
            {/* Phase 2 (Dispatch Prepayment UX) — Payment Required
                badge. Shown only when the backend `payment_required`
                flag is true (resolved per-job in DispatchService.
                computePaymentRequiredMap). Polish pass: error palette
                + DollarSign icon for stronger visual scannability —
                hard block, not a soft warning. Still compact and
                inline; does not redesign the card. */}
            {job.payment_required && !isCompleted && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide leading-none inline-flex items-center gap-1"
                style={{
                  background: "var(--t-error-soft, rgba(220,38,38,0.12))",
                  color: "var(--t-error, #DC2626)",
                  border: "1px solid var(--t-error, #DC2626)",
                }}
                title={
                  FEATURE_REGISTRY.dispatch_prepayment_modal_body?.label ??
                  "Customer requires payment before dispatch."
                }
              >
                <DollarSign className="h-2.5 w-2.5 shrink-0" strokeWidth={3} aria-hidden="true" />
                {FEATURE_REGISTRY.dispatch_card_badge_payment_required?.label ??
                  "Payment Required"}
              </span>
            )}
          </div>
          {/* Line 2: Address (promoted — highly readable) */}
          {addrStr && <p className="text-[13px] font-medium mt-1 truncate" style={{ color: "var(--t-text-primary)" }}>{addrStr}</p>}
          {proximitySuggestion && <p className="text-[10px] mt-0.5 italic" style={{ color: "var(--t-text-muted)" }}>{proximitySuggestion}</p>}
          {/* Line 3: Customer + secondary metadata (de-emphasized) */}
          <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--t-text-muted)" }}>
            <span>{job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : formatJobNumber(job.job_number)}</span>
            {(job.scheduled_window_start || job.scheduled_window_end) && (
              <>
                <span aria-hidden="true"> · </span>
                <span className="tabular-nums">
                  {fmtTime(job.scheduled_window_start)}{job.scheduled_window_end ? `–${fmtTime(job.scheduled_window_end)}` : ""}
                </span>
              </>
            )}
            {job.asset?.identifier && (
              <>
                <span aria-hidden="true"> · </span>
                <span className="font-semibold" style={{ color: "var(--t-text-secondary, var(--t-text-muted))" }}>{job.asset.identifier}</span>
              </>
            )}
          </p>
          {/* Subtle state chip — at most one, neutral outlined (color-noise-free) */}
          {(() => {
            // Priority: OVERDUE > FAILED > FROM FAILED > AT YARD > YARD STOP
            // DUMPED / AWAITING DUMP removed as post-completion chatter per Sprint 2 polish.
            let state: string | null = null;
            if (job.is_overdue) state = `OVERDUE ${job.extra_days ?? ""}d`.trim();
            else if (job.is_failed_trip) state = "FAILED";
            else if (job.source === "rescheduled_from_failure") state = "FROM FAILED";
            else if (job.dump_disposition === "staged") state = "AT YARD";
            else if (needsYardStop) state = "YARD STOP";
            if (!state) return null;
            return (
              <div className="mt-1">
                <span
                  className="inline-block text-[9px] font-semibold tracking-wide px-1.5 py-0.5 rounded"
                  style={{
                    border: "1px solid var(--t-border)",
                    color: "var(--t-text-muted)",
                    background: "transparent",
                  }}
                >
                  {state}
                </span>
              </div>
            );
          })()}
        </div>
        {/* Quick actions — visible on hover */}
        <div className="shrink-0 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" data-no-select>
          {onMoveToTop && (
            <button onClick={(e) => { e.stopPropagation(); onMoveToTop(); }}
              className="flex items-center justify-center w-5 h-5 rounded transition-all"
              title="Move to first stop"
              style={{ color: "var(--t-text-muted)" }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--t-bg-card-hover)"; e.currentTarget.style.color = "var(--t-text-primary)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-muted)"; }}>
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
          )}
          {onMoveToBottom && (
            <button onClick={(e) => { e.stopPropagation(); onMoveToBottom(); }}
              className="flex items-center justify-center w-5 h-5 rounded transition-all"
              title="Move to last stop"
              style={{ color: "var(--t-text-muted)" }}
              onMouseEnter={e => { e.currentTarget.style.background = "var(--t-bg-card-hover)"; e.currentTarget.style.color = "var(--t-text-primary)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--t-text-muted)"; }}>
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════════
   Drag Ghost
   ═══════════════════════════════════════════════════ */

/* ═══ Status Dropdown (portal-based to escape overflow) ═══ */

const STATUSES = ["pending", "confirmed", "en_route", "arrived", "in_progress", "completed", "failed", "cancelled"];

function StatusDropdown({ jobId, currentStatus, onStatusChange }: { jobId: string; currentStatus: string; onStatusChange: (jobId: string, s: string) => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onScroll = () => setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", onScroll, true);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("scroll", onScroll, true); };
  }, [open]);

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      setPos({
        top: spaceBelow > 280 ? r.bottom + 4 : r.top - 280,
        left: Math.min(r.left, window.innerWidth - 200),
      });
    }
    setOpen(!open);
  };

  return (
    <>
      <button ref={btnRef} onClick={handleOpen}
        className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium ml-auto"
        style={{ borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}>
        Status: {DISPLAY_STATUS_LABELS[deriveDisplayStatus(currentStatus)]} ▾
      </button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div onMouseDown={e => e.stopPropagation()}
          className="fixed rounded-[14px] border shadow-2xl animate-dropdown py-1"
          style={{ top: pos.top, left: pos.left, zIndex: 9999, background: "var(--t-bg-secondary)", borderColor: "var(--t-border)", minWidth: 180, maxHeight: 280, overflowY: "auto" }}>
          {STATUSES.map(s => (
            <button key={s} disabled={s === currentStatus}
              onClick={(e) => { e.stopPropagation(); setOpen(false); if (confirm(`Change status to "${s.replace(/_/g, " ")}"?`)) onStatusChange(jobId, s); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs whitespace-nowrap disabled:opacity-30 transition-colors"
              style={{ color: s === currentStatus ? "var(--t-text-muted)" : "var(--t-text-primary)" }}
              onMouseEnter={e => { if (s !== currentStatus) (e.currentTarget as HTMLElement).style.background = "var(--t-bg-card-hover)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
              <span className="w-2 h-2 rounded-full" style={{ background: s === "completed" ? "var(--t-accent)" : s === "failed" || s === "cancelled" ? "var(--t-error)" : s === "pending" ? "var(--t-warning)" : "var(--t-info)" }} />
              {s.replace(/_/g, " ")}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

function JobTileGhost({ job, bulkCount = 1 }: { job: DispatchJob; bulkCount?: number }) {
  const tc = TYPE_CONFIG[job.job_type] || { letter: "?", stripe: "#8A8A8A" };
  const typeLabel = getTypeLabel(job.job_type);
  const size = job.asset_subtype || job.asset?.subtype || "";
  return (
    <div className="relative" style={{ width: 310 }}>
      {/* Stacked card shadows behind for bulk moves */}
      {bulkCount > 2 && (
        <div className="absolute rounded-[14px]" style={{ inset: 0, top: -6, left: 6, background: "var(--t-bg-card-hover)", border: "1px solid var(--t-border)", opacity: 0.4 }} />
      )}
      {bulkCount > 1 && (
        <div className="absolute rounded-[14px]" style={{ inset: 0, top: -3, left: 3, background: "var(--t-bg-card-hover)", border: "1px solid var(--t-border)", opacity: 0.6 }} />
      )}
      {/* Main card */}
      <div className="relative rounded-[14px] bg-white px-4 py-3" style={{ border: "2px solid var(--t-accent)", boxShadow: "0 12px 32px rgba(0,0,0,0.2)" }}>
        <div className="absolute left-0 top-2.5 bottom-2.5 w-[4px] rounded-full" style={{ background: tc.stripe }} />
        <div className="flex items-center gap-2 pl-2">
          {size && <span className="rounded-md px-2 py-0.5 text-[13px] font-extrabold" style={{ background: "#F0F0F0", border: "1px solid #E0E0E0", color: "#0A0A0A" }}>{size.replace(/yd$/i, "Y").toUpperCase()}</span>}
          <span className="text-[13px] font-extrabold uppercase" style={{ color: tc.stripe }}>{typeLabel.toUpperCase()}</span>
          <span className="text-[12px] font-medium" style={{ color: "#666" }}>{job.customer ? `${job.customer.first_name} ${job.customer.last_name}` : formatJobNumber(job.job_number)}</span>
        </div>
      </div>
      {/* Count badge */}
      {bulkCount > 1 && (
        <div className="absolute -top-3 -right-3 flex items-center justify-center min-w-7 h-7 rounded-full px-1.5 text-[12px] font-bold"
          style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)", boxShadow: "0 2px 8px rgba(0,0,0,0.25)" }}>
          {bulkCount}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   QuickView Content
   ═══════════════════════════════════════════════════ */

function QVContent({ job, detail, board, creditState, onAssign, onRefresh, toast }: {
  job: DispatchJob; detail: any; board: DispatchBoard | null;
  creditState: DispatchCreditState | null;
  onAssign: (jobId: string, driverId: string | null, creditOverride?: { reason: string }) => Promise<void>;
  onRefresh: () => Promise<void>;
  toast: (type: "success" | "error" | "warning", msg: string) => void;
}) {
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [newDate, setNewDate] = useState(detail?.scheduled_date || "");
  const [reason, setReason] = useState("");
  const [rescheduling, setRescheduling] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [editingPlacement, setEditingPlacement] = useState(false);
  const [placementValue, setPlacementValue] = useState("");
  // Phase 5 — dispatch credit enforcement override state
  const [creditBlock, setCreditBlock] = useState<{ action: string; hold: any } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overriding, setOverriding] = useState(false);
  const [savingPlacement, setSavingPlacement] = useState(false);
  const tc = TYPE_CONFIG[job.job_type] || { letter: "?", stripe: "#8A8A8A" };
  const typeLabel = getTypeLabel(job.job_type);
  const isCompleted = job.status === "completed";
  const d = detail || job;
  const addr = d.service_address;
  const cust = d.customer;

  // Billing fields (graceful: show if present)
  const balanceDue = d.balance_due ?? d.amount_due ?? null;
  const isPastDue = d.is_past_due || d.past_due || (balanceDue != null && balanceDue > 0 && d.billing_status === "past_due");
  const billingStatus = d.billing_status || null;

  const handleReschedule = async () => {
    if (!newDate) return; setRescheduling(true);
    try { await api.patch(`/jobs/${job.id}/reschedule`, { scheduledDate: newDate, reason, source: "dispatcher" }); toast("success", `Moved to ${new Date(newDate).toLocaleDateString()}`); setRescheduleOpen(false); await onRefresh(); }
    catch { toast("error", "Failed"); } finally { setRescheduling(false); }
  };

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try { await api.patch(`/jobs/${job.id}`, { dispatch_notes: notesValue }); toast("success", "Notes saved"); setEditingNotes(false); await onRefresh(); }
    catch { toast("error", "Failed to save notes"); } finally { setSavingNotes(false); }
  };

  const handleSavePlacement = async () => {
    setSavingPlacement(true);
    try { await api.patch(`/jobs/${job.id}`, { placement_notes: placementValue }); toast("success", "Delivery instructions saved"); setEditingPlacement(false); await onRefresh(); }
    catch { toast("error", "Failed to save"); } finally { setSavingPlacement(false); }
  };

  return (
    <div className="space-y-4">
      {/* Billing warning banner */}
      {(isPastDue || (balanceDue != null && balanceDue > 0)) && (
        <div className="rounded-[14px] px-4 py-3 flex items-center gap-3" style={{ background: "var(--t-error-soft)", border: "1px solid var(--t-error)" }}>
          <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: "var(--t-error)" }} />
          <div>
            <p className="text-xs font-bold" style={{ color: "var(--t-error)" }}>
              {isPastDue ? "Past Due" : "Balance Due"}
            </p>
            {balanceDue != null && <p className="text-sm font-bold tabular-nums" style={{ color: "var(--t-error)" }}>${Number(balanceDue).toLocaleString()}</p>}
            {billingStatus && <p className="text-[10px] capitalize" style={{ color: "var(--t-text-muted)" }}>{billingStatus.replace(/_/g, " ")}</p>}
          </div>
          {cust?.id && (
            <Link href={`/customers/${cust.id}`} className="ml-auto text-[10px] font-semibold rounded-full px-2.5 py-1 border"
              style={{ borderColor: "var(--t-error)", color: "var(--t-error)" }}>
              View Account
            </Link>
          )}
        </div>
      )}

      {/* Credit block override panel (Phase 5 — only shown after a blocked action) */}
      {creditBlock && (
        <div className="rounded-[14px] px-4 py-3" style={{ background: "var(--t-error-soft)", border: "1px solid var(--t-error)" }}>
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--t-error)" }} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold" style={{ color: "var(--t-error)" }}>
                {FEATURE_REGISTRY.dispatch_credit_block_message?.label ?? "Action blocked — customer is on credit hold"}
              </p>
              <p className="text-[10px] mt-0.5" style={{ color: "var(--t-text-muted)" }}>
                {creditBlock.action.replace(/_/g, " ")} is restricted by tenant credit policy
              </p>
              {creditBlock.hold?.override_allowed && (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Override reason (required)"
                    rows={2}
                    className="w-full rounded-[10px] border px-3 py-2 text-xs outline-none resize-none"
                    style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)", background: "var(--t-bg-input, var(--t-bg-card))" }}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        if (!overrideReason.trim()) { toast("error", "Reason required"); return; }
                        setOverriding(true);
                        try {
                          if (creditBlock.action === "assignment") {
                            await onAssign(job.id, job.assigned_driver?.id ?? "", { reason: overrideReason });
                          } else {
                            await api.patch(`/jobs/${job.id}/status`, {
                              status: creditBlock.action,
                              creditOverride: { reason: overrideReason },
                            });
                            toast("success", `Status → ${creditBlock.action.replace(/_/g, " ")}`);
                            await onRefresh();
                          }
                          setCreditBlock(null);
                          setOverrideReason("");
                        } catch (err) {
                          toast("error", isCreditBlockError(err) ?? "Override failed");
                        } finally {
                          setOverriding(false);
                        }
                      }}
                      disabled={overriding || !overrideReason.trim()}
                      className="rounded-full px-3 py-1 text-[10px] font-semibold disabled:opacity-50"
                      style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}
                    >
                      {overriding ? "Overriding..." : FEATURE_REGISTRY.dispatch_credit_override_cta?.label ?? "Override & Continue"}
                    </button>
                    <button
                      onClick={() => { setCreditBlock(null); setOverrideReason(""); }}
                      className="rounded-full px-3 py-1 text-[10px]"
                      style={{ color: "var(--t-text-muted)" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {!creditBlock.hold?.override_allowed && (
                <p className="mt-2 text-[10px]" style={{ color: "var(--t-text-muted)" }}>
                  Override not available — contact an administrator.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Credit hold warning (Phase 4D — informational only, no dispatch blocking) */}
      {creditState?.hold.effective_active && !creditBlock && (
        <div className="rounded-[14px] px-4 py-3" style={{ background: "var(--t-warning-soft, #FFF8E1)", border: "1px solid var(--t-warning, #F59E0B)" }}>
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "var(--t-warning, #F59E0B)" }} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold" style={{ color: "var(--t-text-primary)" }}>
                {FEATURE_REGISTRY.dispatch_credit_hold_header?.label ?? "Customer Credit Hold"}
              </p>
              <p className="text-[10px] mt-0.5" style={{ color: "var(--t-text-muted)" }}>
                {FEATURE_REGISTRY.dispatch_credit_hold_disclaimer?.label ?? "Informational only — dispatch is not blocked"}
              </p>
              {/* Structured hold reasons — concise for dense dispatch context */}
              <div className="mt-2 space-y-1.5">
                {creditState.hold.reasons.map((r, i) => {
                  if (r.type === "manual_hold") {
                    return (
                      <div key={i} className="text-[11px]" style={{ color: "var(--t-text-secondary)" }}>
                        <span className="font-semibold">{FEATURE_REGISTRY.dispatch_credit_hold_manual?.label ?? "Manual hold"}</span>
                        {r.reason && <span> — {r.reason}</span>}
                        {r.set_by && <span className="block text-[10px]" style={{ color: "var(--t-text-muted)" }}>Set by {r.set_by}{r.set_at ? ` on ${new Date(r.set_at).toLocaleDateString()}` : ""}</span>}
                      </div>
                    );
                  }
                  if (r.type === "credit_limit_exceeded") {
                    return (
                      <div key={i} className="text-[11px]" style={{ color: "var(--t-text-secondary)" }}>
                        <span className="font-semibold">{FEATURE_REGISTRY.dispatch_credit_hold_credit_limit?.label ?? "Credit limit exceeded"}</span>
                        <span className="tabular-nums"> — ${Number(r.current_ar).toLocaleString()} / ${Number(r.limit).toLocaleString()}</span>
                      </div>
                    );
                  }
                  if (r.type === "overdue_threshold_exceeded") {
                    return (
                      <div key={i} className="text-[11px]" style={{ color: "var(--t-text-secondary)" }}>
                        <span className="font-semibold">{FEATURE_REGISTRY.dispatch_credit_hold_overdue?.label ?? "Past due threshold exceeded"}</span>
                        <span className="tabular-nums"> — {r.oldest_past_due_days}d past due (threshold: {r.threshold_days}d)</span>
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            </div>
            {cust?.id && (
              <Link href={`/customers/${cust.id}`} className="shrink-0 text-[10px] font-semibold rounded-full px-2.5 py-1 border"
                style={{ borderColor: "var(--t-warning, #F59E0B)", color: "var(--t-warning, #F59E0B)" }}>
                {FEATURE_REGISTRY.dispatch_credit_hold_view_account?.label ?? "View Account"}
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium" style={{ color: tc.stripe }}>{typeLabel}</span>
        <span className="text-xs font-medium" style={{ color: displayStatusColor(deriveDisplayStatus(job.status)) }}>{DISPLAY_STATUS_LABELS[deriveDisplayStatus(job.status)]}</span>
        {(d.asset_subtype || d.asset?.subtype) && <span className="rounded-md px-2 py-0.5 text-[11px] font-bold" style={{ background: "#F0F0F0", border: "1px solid #E0E0E0", color: "#0A0A0A" }}>{d.asset_subtype || d.asset?.subtype}</span>}
        {d.asset?.identifier && <span className="text-xs font-bold" style={{ color: "var(--t-accent)" }}>{d.asset.identifier}</span>}
      </div>
      {cust && (
        <div className="rounded-[20px] border p-4" style={{ borderColor: "var(--t-border)" }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] uppercase tracking-wider" style={{ color: "var(--t-text-muted)" }}>Customer</p>
            <Link href={`/customers/${cust.id}`} className="text-[10px] font-medium" style={{ color: "var(--t-accent)" }}>Full Profile →</Link>
          </div>
          <p className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>{cust.first_name} {cust.last_name}</p>
          {cust.phone && <a href={`tel:${cust.phone}`} className="flex items-center gap-1.5 mt-2 text-xs" style={{ color: "var(--t-accent)" }}><Phone className="h-3 w-3" />{formatPhone(cust.phone)}</a>}
          {cust.email && <a href={`mailto:${cust.email}`} className="flex items-center gap-1.5 mt-1 text-xs" style={{ color: "var(--t-text-muted)" }}><Mail className="h-3 w-3" />{cust.email}</a>}
        </div>
      )}
      {addr && (
        <div className="rounded-[20px] border p-4" style={{ borderColor: "var(--t-border)" }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] uppercase tracking-wider" style={{ color: "var(--t-text-muted)" }}>Service Address</p>
            {!editingPlacement && (
              <button onClick={() => { setEditingPlacement(true); setPlacementValue(d.placement_notes || ""); }}
                className="text-[10px] font-medium" style={{ color: "var(--t-accent)" }}>
                {d.placement_notes ? "Edit" : "Add"} Instructions
              </button>
            )}
          </div>
          <p className="text-sm" style={{ color: "var(--t-text-primary)" }}>{addr.street}</p>
          <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>{[addr.city, addr.state, addr.zip].filter(Boolean).join(", ")}</p>
          {editingPlacement ? (
            <div className="mt-2 space-y-2">
              <textarea value={placementValue} onChange={e => setPlacementValue(e.target.value)}
                placeholder="Delivery/placement instructions..."
                rows={2} className="w-full rounded-[10px] border px-3 py-2 text-xs outline-none resize-none"
                style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)", background: "var(--t-bg-input)" }} />
              <div className="flex gap-2">
                <button onClick={handleSavePlacement} disabled={savingPlacement}
                  className="rounded-full px-3 py-1 text-[10px] font-semibold disabled:opacity-50"
                  style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}>
                  {savingPlacement ? "Saving..." : "Save"}
                </button>
                <button onClick={() => setEditingPlacement(false)} className="rounded-full px-3 py-1 text-[10px]"
                  style={{ color: "var(--t-text-muted)" }}>Cancel</button>
              </div>
            </div>
          ) : d.placement_notes ? (
            <p className="text-xs mt-2 italic" style={{ color: "var(--t-text-muted)" }}>"{d.placement_notes}"</p>
          ) : null}
        </div>
      )}

      {/* Dispatch Notes — editable */}
      <div className="rounded-[20px] border p-4" style={{ borderColor: "var(--t-border)" }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] uppercase tracking-wider" style={{ color: "var(--t-text-muted)" }}>Dispatch Notes</p>
          {!editingNotes && (
            <button onClick={() => { setEditingNotes(true); setNotesValue(d.dispatch_notes || d.internal_notes || ""); }}
              className="text-[10px] font-medium" style={{ color: "var(--t-accent)" }}>
              {(d.dispatch_notes || d.internal_notes) ? "Edit" : "Add Note"}
            </button>
          )}
        </div>
        {editingNotes ? (
          <div className="space-y-2">
            <textarea value={notesValue} onChange={e => setNotesValue(e.target.value)}
              placeholder="Internal dispatch notes..."
              rows={3} className="w-full rounded-[10px] border px-3 py-2 text-xs outline-none resize-none"
              style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)", background: "var(--t-bg-input)" }} />
            <div className="flex gap-2">
              <button onClick={handleSaveNotes} disabled={savingNotes}
                className="rounded-full px-3 py-1 text-[10px] font-semibold disabled:opacity-50"
                style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}>
                {savingNotes ? "Saving..." : "Save"}
              </button>
              <button onClick={() => setEditingNotes(false)} className="rounded-full px-3 py-1 text-[10px]"
                style={{ color: "var(--t-text-muted)" }}>Cancel</button>
            </div>
          </div>
        ) : (d.dispatch_notes || d.internal_notes) ? (
          <p className="text-xs" style={{ color: "var(--t-text-secondary)" }}>{d.dispatch_notes || d.internal_notes}</p>
        ) : (
          <p className="text-xs" style={{ color: "var(--t-text-tertiary)" }}>No notes</p>
        )}
        {d.customer_notes && (
          <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--t-border)" }}>
            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--t-text-muted)" }}>Customer Notes</p>
            <p className="text-xs italic" style={{ color: "var(--t-text-secondary)" }}>"{d.customer_notes}"</p>
          </div>
        )}
      </div>
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
            {!job.assigned_driver && board.drivers.length === 1 ? (
              <button
                onClick={async () => {
                  try { await onAssign(job.id, board.drivers[0].driver.id); }
                  catch (err) {
                    const msg = isCreditBlockError(err);
                    if (msg) { setCreditBlock({ action: "assignment", hold: { override_allowed: true } }); }
                    else { toast("error", "Failed"); }
                  }
                }}
                className="text-xs font-medium rounded-full px-3 py-1.5 transition-all duration-150 active:scale-95"
                style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)", border: "none", cursor: "pointer" }}
              >
                Assign to {board.drivers[0].driver.firstName} {board.drivers[0].driver.lastName}
              </button>
            ) : (
              <Dropdown trigger={<button className="text-xs font-medium" style={{ color: "var(--t-accent)" }}>{job.assigned_driver ? "Reassign" : "Assign Driver"}</button>}>
                <button onClick={() => onAssign(job.id, null).catch(() => toast("error", "Failed"))} className="flex w-full items-center gap-2 px-3 py-2 text-xs" style={{ color: "var(--t-error)" }}>Unassign</button>
                {board.drivers.map(col => (
                  <button key={col.driver.id} onClick={async () => {
                    try { await onAssign(job.id, col.driver.id); }
                    catch (err) {
                      const msg = isCreditBlockError(err);
                      if (msg) { setCreditBlock({ action: "assignment", hold: { override_allowed: true } }); }
                      else { toast("error", "Failed"); }
                    }
                  }} className="flex w-full items-center gap-2 px-3 py-2 text-xs whitespace-nowrap" style={{ color: "var(--t-text-primary)" }}>
                    <div className="flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold" style={{ background: "var(--t-accent-soft)", color: "var(--t-accent)" }}>{col.driver.firstName[0]}{col.driver.lastName[0]}</div>
                    {col.driver.firstName} {col.driver.lastName}
                  </button>
                ))}
              </Dropdown>
            )}
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
            <button onClick={() => { setRescheduleOpen(true); setNewDate(d.scheduled_date || ""); }} className="w-full rounded-full border py-2.5 text-xs font-semibold" style={{ borderColor: "var(--t-border)", color: "var(--t-info)" }}>
              <Calendar className="h-3.5 w-3.5 inline mr-1.5" />Reschedule
            </button>
          ) : (
            <div className="rounded-[20px] border p-4 space-y-3" style={{ borderColor: "var(--t-border)" }}>
              <p className="text-xs font-semibold" style={{ color: "var(--t-info)" }}>Reschedule Job</p>
              <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="w-full rounded-[10px] border px-3 py-2 text-sm outline-none" style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} />
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (optional)" className="w-full rounded-[10px] border px-3 py-2 text-sm outline-none" style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} />
              <div className="flex gap-2">
                <button onClick={handleReschedule} disabled={!newDate || rescheduling} className="flex-1 rounded-full py-2 text-xs font-semibold disabled:opacity-50" style={{ background: "var(--t-info)", color: "var(--t-accent-on-accent)" }}>{rescheduling ? "Moving..." : "Confirm"}</button>
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
