"use client";

import { Suspense, useState, useEffect, use } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  Send,
  StickyNote,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  AlertTriangle,
  Plus,
} from "lucide-react";
import { api } from "@/lib/api";
import Dropdown from "@/components/dropdown";
import { useToast } from "@/components/toast";
import MapboxMap from "@/components/mapbox-map";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import { getBlockedReason } from "@/lib/blocked-job";
import { JobBlockedResolutionDrawer } from "@/components/job-blocked-resolution-drawer";
import LifecycleContextPanel from "./_components/LifecycleContextPanel";
import DumpTicketForm, { type DumpTicketFormTicket } from "./_components/DumpTicketForm";
import VoidDumpTicketDialog from "./_components/VoidDumpTicketDialog";
import ScheduleChangeHistoryCard from "./_components/ScheduleChangeHistoryCard";

// Sentinel value stored in `assetEditSelection` when the user chooses
// "No Asset / Unassign" in the Edit Asset modal. Distinct from `null`
// (nothing selected) so the Save button can enable for an explicit
// unassign. Maps to `assetId: null` on the backend PATCH payload.
const ASSET_UNASSIGN = "__unassign__";

// Cancellation Orchestrator Phase 2 — response shape for
// `GET /jobs/:id/cancellation-context` (shipped server-side in
// fab178c). Kept local to this file since the modal is the only
// consumer today; if other surfaces need it later, promote to a
// shared types module.
interface CancellationContext {
  isChain: boolean;
  jobs: Array<{
    id: string;
    job_number: string;
    job_type: string;
    status: string;
    scheduled_date: string | null;
    is_current: boolean;
  }>;
  invoices: Array<{
    id: string;
    invoice_number: string;
    invoice_status: string;
    amount_paid: number;
    balance_due: number;
    total_amount: number;
  }>;
  summary: {
    totalJobs: number;
    hasCompletedJobs: boolean;
    hasActiveJobs: boolean;
    hasInvoices: boolean;
    hasPaidInvoices: boolean;
    hasUnpaidInvoices: boolean;
  };
}

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
  is_failed_trip?: boolean;
  failed_reason?: string;
  failed_at?: string;
  attempt_count?: number;
  is_overdue?: boolean;
  extra_days?: number;
  extra_day_rate?: number;
  extra_day_charges?: number;
  parent_job_id?: string | null;
  linked_job_ids?: string[];
  // Phase 10A — chain-derived replacement tasks for cancelled jobs.
  rental_chain_id?: string | null;
  replacement_jobs?: Array<{
    job_id: string;
    job_number: string;
    job_type: string;
    task_type: string;
    scheduled_date: string;
    status: string;
  }>;
  // Phase 11A — asset enforcement + audit trail
  asset_id?: string | null;
  asset_subtype?: string | null;
  asset_change_history?: Array<{
    // Phase 14 — which column this entry describes. Absent on
    // entries written before Phase 14, in which case the history
    // renderer implicitly treats them as `asset_id` (pickup side).
    field?: "asset_id" | "drop_off_asset_id";
    previous_asset_id: string | null;
    new_asset_id: string;
    changed_by: string | null;
    changed_by_name: string | null;
    changed_at: string;
    reason: string | null;
    override_conflict?: boolean;
    size_mismatch?: boolean;
  }>;
  expected_on_site_asset?: {
    asset_id: string;
    identifier: string;
    subtype: string | null;
    source_job_id: string;
    source_job_number: string;
    source_task_type: string;
  } | null;
  // Phase 14 — drop-off (delivery) asset for exchange jobs. The
  // backend now eager-loads the relation in `findOne` so the
  // office job detail view can render both asset roles from a
  // single fetch. Null on non-exchange jobs and on exchanges that
  // have not yet captured the delivery asset.
  drop_off_asset_id?: string | null;
  drop_off_asset?: {
    id: string;
    identifier: string;
    asset_type: string;
    subtype: string | null;
  } | null;
  // Fix — rental chain context surfaced by findOne for required-size
  // derivation on the asset picker.
  rental_chain_dumpster_size?: string | null;
  // Phase B4 — reschedule audit trio surfaced on the job detail
  // page via the ScheduleChangeHistoryCard. Written by
  // `JobsService.updateScheduledDate` on every reschedule (both
  // portal customer actions and office dispatcher edits). The
  // card renders only when there is a meaningful prior date.
  rescheduled_by_customer?: boolean | null;
  rescheduled_at?: string | null;
  rescheduled_from_date?: string | null;
  rescheduled_reason?: string | null;
}

interface AssetOption {
  id: string;
  identifier: string;
  subtype?: string | null;
  status: string;
}

/* --- Constants --- */

import { deriveDisplayStatus, DISPLAY_STATUS_LABELS, displayStatusColor, formatJobNumber } from "@/lib/job-status";
import { navigateBack } from "@/lib/navigation";

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
  // Phase BA — "Mark Ready" (`confirmed`) removed from office-allowed
  // primary actions. `pending → confirmed` is now handled silently by
  // the assign-time auto-flip in `JobsService.assignJob`, which also
  // fires the `booking_confirmation` SMS when a driver is assigned.
  // The server-side transition path remains valid for direct API
  // callers and legacy scripts.
  dispatched: { label: "Assign", className: "bg-[var(--t-accent)] text-[var(--t-accent-on-accent)] hover:opacity-90", icon: Truck },
  en_route: { label: "En Route", className: "bg-[var(--t-accent)] text-[var(--t-accent-on-accent)] hover:opacity-90", icon: Truck },
  arrived: { label: "Arrived", className: "bg-[var(--t-accent)] text-[var(--t-accent-on-accent)] hover:opacity-90", icon: MapPin },
  in_progress: { label: "On Site", className: "bg-[var(--t-accent)] text-[var(--t-accent-on-accent)] hover:opacity-90", icon: AlertCircle },
  completed: { label: "Complete", className: "bg-[var(--t-accent)] text-[var(--t-accent-on-accent)] hover:opacity-90", icon: CheckCircle2 },
  cancelled: { label: "Cancel", className: "border border-[var(--t-error)]/20 text-[var(--t-error)] hover:bg-[var(--t-error-soft)]", icon: XCircle },
};

// Office can only trigger these as primary actions
const OFFICE_ALLOWED_TRANSITIONS = new Set(["dispatched", "cancelled"]);

// Override corrections: current stored status → allowed correction targets
//
// `confirmed` is the post-assign-auto-flip state from
// `JobsService.assignJob` (sets status='confirmed' when a driver is
// assigned to a pending job). The UI labels these jobs "Assigned" via
// `deriveDisplayStatus`'s live-driver branch, but the raw status is
// `confirmed`, not `dispatched`. Without this entry the office kebab
// hid Override Status for assigned jobs entirely, blocking the
// office completion workflow.
//
// `dispatched`, `en_route`, `arrived` widened to include `completed`
// so the office can shortcut from any active stage to completion in
// a single override. The backend admin override at
// `jobs.service.ts:864` already permits any forward transition for
// admin/dispatcher/owner — these targets just expose what's already
// legal server-side. Asset/dump-slip completion gates remain
// authoritative on the backend (see `delivery_completion_requires_asset`
// and `dump_slip_required` in `changeStatus`).
const OVERRIDE_TARGETS: Record<string, string[]> = {
  confirmed: ["dispatched", "en_route", "arrived", "in_progress", "completed"],
  dispatched: ["en_route", "arrived", "in_progress", "completed"],
  en_route: ["dispatched", "arrived", "in_progress", "completed"],
  arrived: ["en_route", "in_progress", "completed"],
  in_progress: ["arrived", "completed"],
};

const TIMELINE_STEPS = [
  { key: "created_at", label: "Created", status: "pending" },
  { key: "confirmed", label: "Unassigned", status: "confirmed" },
  { key: "dispatched_at", label: "Assigned", status: "dispatched" },
  { key: "en_route_at", label: "En Route", status: "en_route" },
  { key: "arrived_at", label: "Arrived", status: "arrived" },
  { key: "completed_at", label: "Completed", status: "completed" },
];

/* --- Helpers --- */

import { formatCurrency, formatSourceLabel } from "@/lib/utils";
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

/**
 * Page content lives in a child component because this page calls
 * `useSearchParams` at the top level. Next.js App Router requires any
 * `useSearchParams` consumer to be wrapped in a `<Suspense>` boundary
 * so the static prerender can skip the param-dependent subtree — the
 * default export below provides that boundary. Without the split the
 * production build fails with "useSearchParams() should be wrapped in
 * a suspense boundary at page '/jobs/[id]'".
 */
function JobDetailPageContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [job, setJob] = useState<Job | null>(null);
  const [isPostCreate, setIsPostCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  // Cancellation Orchestrator Phase 2 — guided-cancel modal state.
  // `cancelContext` is null while loading or on fetch failure; the
  // failure case routes through `cancelWithReasonFallback` below
  // which preserves the pre-Phase-2 prompt() flow.
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelContext, setCancelContext] =
    useState<CancellationContext | null>(null);
  const [cancelContextLoading, setCancelContextLoading] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  // Connected Lifecycle Navigation — separate state from the cancel
  // modal so the prev/current/next triplet under the job header can
  // render without waiting for (or depending on) the modal being
  // opened. Reuses the existing read-only /cancellation-context
  // endpoint — no new backend surface, no duplicated chain query
  // logic. `isChain === false` → section renders nothing; fetch
  // errors are silent and the section simply does not render.
  const [navContext, setNavContext] = useState<CancellationContext | null>(
    null,
  );
  const [navContextLoading, setNavContextLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setNavContextLoading(true);
    setNavContext(null);
    api
      .get<CancellationContext>(`/jobs/${id}/cancellation-context`)
      .then((ctx) => {
        if (cancelled) return;
        // Defensive shape check — same guard the cancel modal uses.
        if (
          ctx &&
          typeof ctx === "object" &&
          typeof ctx.isChain === "boolean" &&
          Array.isArray(ctx.jobs)
        ) {
          setNavContext(ctx);
        }
      })
      .catch(() => {
        /* silent — spec: do not render section on error */
      })
      .finally(() => {
        if (!cancelled) setNavContextLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Escape-to-dismiss for the cancellation modal. Ignores the event
  // while a confirm mutation is in flight so an accidental Escape
  // during the PATCH doesn't leave the operator unsure whether the
  // cancellation committed.
  useEffect(() => {
    if (!cancelModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !actionLoading) {
        setCancelModalOpen(false);
        setCancelReason("");
        setCancelContext(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancelModalOpen, actionLoading]);
  const [dumpTickets, setDumpTickets] = useState<Array<{
    id: string; ticket_number: string; waste_type: string; weight_tons: number;
    dump_location_id: string;
    total_cost: number; customer_charges: number; status: string; ticket_photo: string;
    dump_location_name: string; submitted_at: string; overage_items: Array<{ label: string; quantity: number; total: number }>;
    revisions?: Array<{ revision: number; changedBy: string; changedByRole: string; changedAt: string; changes: Record<string, { old: unknown; new: unknown }>; reason?: string }>;
    voided_at?: string; void_reason?: string;
  }>>([]);
  const [showRevisions, setShowRevisions] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<{ id: string; invoice_number: number; status: string; total: number; balance_due: number } | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(true);
  // Open billing issues for THIS job — used by the contextual blocked
  // panel. Count comes from a scoped fetch of /billing-issues?jobId=...
  // which uses the same backend filter the Billing Issues page scoped
  // banner uses, so both surfaces agree on what's open.
  const [openBillingIssueCount, setOpenBillingIssueCount] = useState(0);
  // Phase 4: Job Blocked Resolution Drawer state. Opens from the
  // contextual blocked panel's primary "Fix Billing" CTA.
  const [resolveDrawerOpen, setResolveDrawerOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [editAddress, setEditAddress] = useState<AddressValue>({ street: "", city: "", state: "", zip: "", lat: null, lng: null });
  const [savingAddress, setSavingAddress] = useState(false);
  // Override modal state
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  // Phase B3-Fix — stash of the in-progress override when the user
  // detours through the asset picker via cf28ef1's "Assign asset →"
  // button. After the asset save succeeds and the job refetches,
  // `handleAssetEditSave` auto-reopens the override modal with these
  // values pre-filled so the operator doesn't have to re-select
  // Completed and re-type the reason. Cleared on override cancel,
  // on successful override submission, or on a non-detour asset
  // save — null means "no pending reopen."
  const [pendingOverride, setPendingOverride] = useState<{
    target: string;
    reason: string;
  } | null>(null);
  // Phase B3-UI Issue 2 — current user's role, used to gate the
  // clickable lifecycle chip shortcut. Only office roles (owner,
  // admin, dispatcher) see chips as interactive; drivers see them
  // as static. Fetched once on mount; null while loading (chips
  // render as static until the role is known, avoiding a flash of
  // clickable UI before auth is confirmed).
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  useEffect(() => {
    api
      .get<{ role: string }>("/auth/profile")
      .then((p) => setCurrentUserRole(p?.role ?? null))
      .catch(() => setCurrentUserRole(null));
  }, []);
  const isOfficeRole =
    currentUserRole === "owner" ||
    currentUserRole === "admin" ||
    currentUserRole === "dispatcher";
  // Refresh signal for <LifecycleContextPanel/>. Bumped after any
  // mutation that can change a job's live status (override,
  // forward transition, cancel) so the panel refetches the
  // lifecycle-context response and node chips / timestamps
  // reflect the post-mutation backend truth instead of stale
  // cached data. Without this, the panel would keep rendering
  // the pre-override node status until the user hard-reloaded.
  const [lifecyclePanelRefresh, setLifecyclePanelRefresh] = useState(0);
  // Phase 15 — the full Connected Job Lifecycle (all chain jobs
  // + inline alerts) now lives inside <LifecycleContextPanel />,
  // which owns its own fetch to /jobs/:id/lifecycle-context. The
  // old parent_job_id / linked_job_ids-derived list was removed
  // when the chain-graph-driven panel shipped in Phase 15.
  // Rental chain ID for lifecycle link
  const [chainId, setChainId] = useState<string | null>(null);
  // Lifecycle strip data (compact summary from chain endpoint)
  const [lifecycleStrip, setLifecycleStrip] = useState<{
    dropOffDate: string | null; pickupDate: string | null; rentalDays: number | null;
    chainStatus: string; dropOffStatus: string | null; pickupStatus: string | null;
    hasExchange: boolean;
  } | null>(null);
  // Phase 11A — asset edit modal state
  const [assetEditOpen, setAssetEditOpen] = useState(false);
  const [assetOptions, setAssetOptions] = useState<AssetOption[]>([]);
  const [assetOptionsLoading, setAssetOptionsLoading] = useState(false);
  // Phase B3-UI Issue 3 — free-text search inside the Update Asset
  // modal. Client-side only; matches on identifier, subtype/size, or
  // any typed fragment (case-insensitive). Non-empty search flattens
  // the size-based grouping into a single filtered list; empty
  // search preserves the existing Matching/Other grouping behavior.
  // Cleared by `openAssetEdit` on every open so each launch starts
  // with a clean search.
  const [assetEditSearch, setAssetEditSearch] = useState("");
  const [assetEditSelection, setAssetEditSelection] = useState<string | null>(null);
  const [assetEditReason, setAssetEditReason] = useState("");
  const [assetEditConflict, setAssetEditConflict] = useState<string | null>(null);
  const [assetEditOverride, setAssetEditOverride] = useState(false);
  const [assetEditSaving, setAssetEditSaving] = useState(false);
  // Fix — "Show all sizes" toggle in the edit asset modal picker.
  // Default off so the common case (size-matching asset) shows a
  // short, correct list.
  const [assetEditShowAll, setAssetEditShowAll] = useState(false);
  const [assetEditMismatchAck, setAssetEditMismatchAck] = useState(false);
  // Phase 14 — which exchange asset role the modal is currently
  // editing. 'pickup' edits job.asset_id (same behavior as
  // Phase 11A — backward compatible for non-exchange jobs).
  // 'drop_off' edits job.drop_off_asset_id and submits only the
  // dropOffAssetId field to PATCH /jobs/:id/asset, leveraging the
  // Phase 14 backend that made both fields optional with a
  // runtime "at least one required" check.
  const [assetEditRole, setAssetEditRole] = useState<"pickup" | "drop_off">("pickup");
  // Phase 11B — dump slip modal state. DumpTicketForm owns form state
  // internally; the page only tracks which mode it's in, which ticket
  // is being edited, whether a pending completion is queued after save,
  // and the cached dump locations list shared with edit opens. Voiding
  // uses a separate dialog with its own internal state.
  const [addDumpSlipOpen, setAddDumpSlipOpen] = useState(false);
  const [dumpLocations, setDumpLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [dumpFormMode, setDumpFormMode] = useState<"create" | "edit">("create");
  const [editingTicket, setEditingTicket] = useState<DumpTicketFormTicket | null>(null);
  const [pendingCompleteAfterDumpSlip, setPendingCompleteAfterDumpSlip] = useState(false);
  const [voidingTicket, setVoidingTicket] = useState<{ id: string; ticket_number: string | null } | null>(null);

  const fetchJob = async () => {
    try {
      const data = await api.get<Job>(`/jobs/${id}`);
      setJob(data);
      // Phase 15 — LifecycleContextPanel owns the rental-chain
      // fetch; we still call resolveChainId for the separate
      // compact lifecycleStrip above the two-column grid.
      resolveChainId(data);
    } catch { /* */ } finally {
      setLoading(false);
    }
  };

  // Phase 11A — open the asset edit modal. Lazy-loads the tenant's
  // assets the first time it's opened, pre-selects the current
  // assignment, and surfaces availability so the office can see
  // what's free vs in-use before swapping.
  //
  // Fix — the asset list is now loaded WITHOUT a subtype filter so
  // the picker can group by matching / other. Required size is
  // derived from the chain (authoritative) or falls back to the
  // job's own asset_subtype for standalone jobs.
  //
  // Phase 14 — accepts an optional `role` parameter so the same
  // modal can edit either the pickup asset (`asset_id`, default)
  // or the delivery asset (`drop_off_asset_id`) on exchange jobs.
  // Prefill selection matches the role being edited.
  const openAssetEdit = async (role: "pickup" | "drop_off" = "pickup") => {
    if (!job) return;
    setAssetEditRole(role);
    setAssetEditOpen(true);
    // Preselect the current asset for the role being edited. On
    // 'drop_off' for an exchange with no delivery asset yet, this
    // leaves the selection empty so the office must pick one.
    const preselect =
      role === "drop_off"
        ? job.drop_off_asset_id || job.drop_off_asset?.id || null
        : job.asset_id || job.asset?.id || null;
    setAssetEditSelection(preselect);
    setAssetEditReason("");
    setAssetEditConflict(null);
    setAssetEditOverride(false);
    setAssetEditShowAll(false);
    setAssetEditMismatchAck(false);
    setAssetEditSearch("");
    setAssetOptionsLoading(true);
    try {
      const res = await api.get<{ data: AssetOption[] }>(`/assets?limit=200`);
      const list = (res.data ?? []).filter((a) => a.status !== "retired");
      list.sort((a, b) => {
        const av = a.status === "available" ? 0 : 1;
        const bv = b.status === "available" ? 0 : 1;
        if (av !== bv) return av - bv;
        return (a.identifier || "").localeCompare(b.identifier || "");
      });
      setAssetOptions(list);
    } catch {
      setAssetOptions([]);
    } finally {
      setAssetOptionsLoading(false);
    }
  };

  // Phase 11B — shared dump locations loader. Used by both create and
  // edit opens so the dropdown is cached for the session.
  const ensureDumpLocationsLoaded = async () => {
    if (dumpLocations.length > 0) return;
    try {
      const res = await api.get<Array<{ id: string; name: string }> | { data: Array<{ id: string; name: string }> }>(`/dump-locations`);
      const list = Array.isArray(res) ? res : (res as { data: Array<{ id: string; name: string }> }).data ?? [];
      setDumpLocations(list);
    } catch {
      /* handled by empty state in picker */
    }
  };

  // Opens the shared DumpTicketForm in create mode. Reuses the
  // canonical POST /jobs/:id/dump-slip path inside the form.
  const openDumpSlipCreate = async () => {
    setDumpFormMode("create");
    setEditingTicket(null);
    setAddDumpSlipOpen(true);
    await ensureDumpLocationsLoaded();
  };

  // Opens the shared DumpTicketForm in edit mode, prefilled from the
  // existing dump_tickets row. The form submits via PATCH
  // /dump-tickets/:ticketId — canonical edit path with full recalc +
  // audit trail server-side.
  const openDumpSlipEdit = async (t: DumpTicketFormTicket) => {
    setDumpFormMode("edit");
    setEditingTicket(t);
    setAddDumpSlipOpen(true);
    await ensureDumpLocationsLoaded();
  };

  // Shared callback fired by DumpTicketForm on successful save.
  // Refreshes job + tickets. If the save was triggered by the manual-
  // completion shortcut, transitions the job to completed via the
  // canonical changeStatus path — the server-side completion gate is
  // preserved, so this is purely UX plumbing.
  const handleDumpSlipSaved = async () => {
    await Promise.all([fetchJob(), fetchDumpTickets()]);
    if (pendingCompleteAfterDumpSlip) {
      setPendingCompleteAfterDumpSlip(false);
      await changeStatus("completed");
    }
  };

  // Manual-completion shortcut: when the office clicks Mark Complete
  // on a dump-slip-required job type that has no active ticket, we
  // intercept and open the shared form in create mode with a queued
  // completion. After save, handleDumpSlipSaved fires changeStatus.
  // If the job already has an active ticket, we fall straight through
  // to the normal changeStatus path. The completion gating rule is
  // NOT changed — the server still enforces it; this shortcut just
  // makes the fix path obvious and immediate to the operator.
  const tryMarkComplete = async () => {
    if (!job) return;
    const needsSlip = job.job_type === "pickup"
      || job.job_type === "exchange"
      || job.job_type === "removal";
    const activeTickets = dumpTickets.filter((t) => t.status !== "voided");
    if (needsSlip && activeTickets.length === 0) {
      setPendingCompleteAfterDumpSlip(true);
      await openDumpSlipCreate();
      return;
    }
    await changeStatus("completed");
  };

  const handleAssetEditSave = async () => {
    if (!job || !assetEditSelection) return;
    setAssetEditSaving(true);
    setAssetEditConflict(null);
    // Fix — detect size mismatch client-side and flag the request so
    // the backend audit trail records it. Required size is derived
    // from the chain (authoritative) or the job's asset_subtype for
    // standalone jobs. Size mismatch is ONLY enforced on the pickup
    // role because the delivery (drop-off) asset of an exchange can
    // legitimately be a different size than what is currently on
    // site — the whole point of an exchange is size-swapping.
    const required = job.rental_chain_dumpster_size || job.asset_subtype || null;
    const picked = assetOptions.find((a) => a.id === assetEditSelection);
    const pickedSize = picked?.subtype || null;
    const isMismatch =
      assetEditRole === "pickup" &&
      !!(required && pickedSize && pickedSize !== required);
    try {
      // Phase 14 — PATCH payload now sends either `assetId` (pickup
      // role) or `dropOffAssetId` (delivery role), never both in one
      // save. The backend's canonical assignAssetToJob path runs
      // identical validation / conflict / audit for both columns,
      // so the frontend picks exactly one per modal submission.
      const payload: Record<string, unknown> = {
        ...(assetEditOverride ? { overrideAssetConflict: true } : {}),
        ...(assetEditReason ? { reason: assetEditReason } : {}),
        ...(isMismatch ? { sizeMismatch: true } : {}),
      };
      if (assetEditRole === "pickup") {
        payload.assetId =
          assetEditSelection === ASSET_UNASSIGN ? null : assetEditSelection;
      } else {
        payload.dropOffAssetId = assetEditSelection;
      }
      await api.patch(`/jobs/${id}/asset`, payload);
      toast(
        "success",
        assetEditRole === "drop_off"
          ? FEATURE_REGISTRY.delivery_asset_updated_success?.label ??
              "Delivery asset updated successfully"
          : FEATURE_REGISTRY.asset_updated_success?.label ??
              "Asset updated successfully",
      );
      setAssetEditOpen(false);
      await fetchJob();
      // Phase B3-Fix — if the user reached the asset picker via the
      // "Assign asset →" button in the override modal, restore the
      // override context now that the asset is assigned and the job
      // has been refetched. The operator lands back in the override
      // modal with Completed pre-selected and their reason intact —
      // one more Confirm Override click finishes the flow. Runs only
      // when `pendingOverride` is set (so normal Edit Asset flows
      // that have no pending override are unaffected) and only after
      // a successful save + refetch (failures fall into the catch
      // block below and never reach this point).
      if (pendingOverride) {
        setOverrideTarget(pendingOverride.target);
        setOverrideReason(pendingOverride.reason);
        setPendingOverride(null);
        setOverrideOpen(true);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      // Phase 14 — conflict error codes are distinct per field so
      // the UI can render role-specific wording. Both codes are
      // caught here; the single conflict-override checkbox in the
      // modal applies to whichever role is active.
      if (
        typeof msg === "string" &&
        (msg.includes("asset_active_conflict") ||
          msg.includes("drop_off_asset_active_conflict"))
      ) {
        const stripped = msg
          .replace(/^drop_off_asset_active_conflict:\s*/, "")
          .replace(/^asset_active_conflict:\s*/, "");
        setAssetEditConflict(stripped);
        setAssetEditOverride(false);
      } else {
        toast(
          "error",
          assetEditRole === "drop_off"
            ? FEATURE_REGISTRY.delivery_asset_updated_error?.label ??
                "Failed to update delivery asset"
            : FEATURE_REGISTRY.asset_updated_error?.label ??
                "Failed to update asset",
        );
      }
    } finally {
      setAssetEditSaving(false);
    }
  };

  const resolveChainId = async (currentJob: Job) => {
    if (!currentJob.customer?.id) return;
    try {
      const chains = await api.get<Array<{ id: string; links?: Array<{ job_id: string }> }>>(
        `/rental-chains?customerId=${currentJob.customer.id}`
      );
      for (const chain of chains) {
        if (chain.links?.some(l => l.job_id === currentJob.id)) {
          setChainId(chain.id);
          // Fetch lifecycle data for the strip
          api.get<{
            rentalChain: { status: string; dropOffDate: string; expectedPickupDate: string | null; rentalDays: number };
            jobs: Array<{ taskType: string; status: string; scheduledDate: string }>;
          }>(`/rental-chains/${chain.id}/lifecycle`).then(lc => {
            const dropOffTask = lc.jobs?.find(j => j.taskType === "drop_off");
            const pickUpTask = lc.jobs?.find(j => j.taskType === "pick_up");
            const hasExchange = lc.jobs?.some(j => j.taskType === "exchange") ?? false;
            setLifecycleStrip({
              dropOffDate: lc.rentalChain.dropOffDate,
              pickupDate: lc.rentalChain.expectedPickupDate,
              rentalDays: lc.rentalChain.rentalDays,
              chainStatus: lc.rentalChain.status,
              dropOffStatus: dropOffTask?.status ?? null,
              pickupStatus: pickUpTask?.status ?? null,
              hasExchange,
            });
          }).catch(() => {});
          return;
        }
      }
    } catch { /* silent */ }
  };

  const fetchDumpTickets = async () => {
    try {
      const data = await api.get<{ tickets: typeof dumpTickets }>(`/jobs/${id}/dump-slip`);
      setDumpTickets(data.tickets || []);
    } catch { /* */ }
  };

  const fetchInvoice = async () => {
    try {
      const res = await api.get<{ data: Array<{ id: string; invoice_number: number; status: string; total: number; balance_due: number }> }>(`/invoices?jobId=${id}&limit=1`);
      if (res.data && res.data.length > 0) setInvoice(res.data[0]);
    } catch { /* */ }
  };

  const fetchOpenBillingIssues = async () => {
    try {
      const res = await api.get<{ data: Array<{ id: string }>; meta: { total: number } }>(
        `/billing-issues?jobId=${id}&status=open&limit=1`,
      );
      setOpenBillingIssueCount(res.meta?.total ?? 0);
    } catch { /* silent — panel simply won't indicate billing issues */ }
  };

  // Phase 15 — fetchRelatedJobs was removed. The Connected Job
  // Lifecycle panel now derives its data from the canonical
  // rental_chains + task_chain_links graph via
  // GET /jobs/:id/lifecycle-context, fetched inside
  // <LifecycleContextPanel />. The old client-side walk of
  // parent_job_id / linked_job_ids could miss exchanges that
  // weren't explicitly linked and never showed chain-level
  // alerts; the new panel fixes both.

  useEffect(() => { fetchJob(); fetchDumpTickets(); fetchInvoice(); fetchOpenBillingIssues(); }, [id]);

  // Detect one-time postCreate flag and consume it
  useEffect(() => {
    if (searchParams.get("postCreate") === "1") {
      setIsPostCreate(true);
      // Clean the query param from URL without re-triggering navigation
      router.replace(`/jobs/${id}`, { scroll: false });
    }
  }, [searchParams, id, router]);

  // Phase 2 — pre-modal existing behavior, preserved as the fallback
  // path when the cancellation-context fetch fails. Kept byte-for-byte
  // equivalent to the pre-Phase-2 flow so a backend outage on the new
  // read-only endpoint never blocks an operator from cancelling.
  const cancelWithReasonFallback = async () => {
    const reason = prompt("Cancellation reason:");
    if (!reason) return;
    setActionLoading(true);
    try {
      await api.patch(`/jobs/${id}/status`, {
        status: "cancelled",
        cancellationReason: reason,
      });
      toast("success", "Job cancelled");
      await fetchJob();
      setLifecyclePanelRefresh((n) => n + 1);
    } catch {
      toast("error", "Failed to update");
    } finally {
      setActionLoading(false);
    }
  };

  // Phase 2 — primary cancel entry point. Opens the guided modal,
  // fetches lifecycle + billing context, and renders impact before
  // the operator confirms. Any fetch failure routes through
  // `cancelWithReasonFallback` so the cancel path never gets blocked.
  const openCancelModal = async () => {
    if (actionLoading || cancelContextLoading) return;
    setCancelReason("");
    setCancelContext(null);
    setCancelModalOpen(true);
    setCancelContextLoading(true);
    try {
      const ctx = await api.get<CancellationContext>(
        `/jobs/${id}/cancellation-context`,
      );
      // Defensive shape check — if the endpoint returns something
      // unexpected, fall back to the pre-Phase-2 flow rather than
      // rendering a half-baked modal.
      if (!ctx || typeof ctx !== "object" || !ctx.summary || !Array.isArray(ctx.jobs)) {
        setCancelModalOpen(false);
        await cancelWithReasonFallback();
        return;
      }
      setCancelContext(ctx);
    } catch {
      // Network error, 500, timeout — silent log + graceful fallback
      // to the existing prompt() flow. Spec: "do NOT block the operator."
      setCancelModalOpen(false);
      await cancelWithReasonFallback();
    } finally {
      setCancelContextLoading(false);
    }
  };

  // Phase 2 — confirm handler. Calls the existing cancel PATCH path
  // unchanged (no new backend flags, no chain-level mutation) and
  // preserves the existing cancellationReason capture from the
  // pre-modal prompt flow.
  const confirmCancelFromModal = async () => {
    if (!cancelReason.trim()) return;
    setActionLoading(true);
    try {
      await api.patch(`/jobs/${id}/status`, {
        status: "cancelled",
        cancellationReason: cancelReason.trim(),
      });
      toast("success", "Job cancelled");
      setCancelModalOpen(false);
      setCancelReason("");
      setCancelContext(null);
      await fetchJob();
      setLifecyclePanelRefresh((n) => n + 1);
    } catch {
      // Keep the modal open so the operator can retry without
      // losing the reason text.
      toast("error", "Failed to update");
    } finally {
      setActionLoading(false);
    }
  };

  const closeCancelModal = () => {
    if (actionLoading) return;
    setCancelModalOpen(false);
    setCancelReason("");
    setCancelContext(null);
  };

  const changeStatus = async (newStatus: string) => {
    if (actionLoading) return;
    if (newStatus === "cancelled") {
      // Route cancel through the guided modal — same PATCH contract,
      // richer confirmation UX. Fetch failures fall back to the
      // pre-Phase-2 prompt() path inside `openCancelModal` itself.
      await openCancelModal();
      return;
    }
    setActionLoading(true);
    try {
      await api.patch(`/jobs/${id}/status`, { status: newStatus });
      toast("success", `Job marked as ${DISPLAY_STATUS_LABELS[deriveDisplayStatus(newStatus)]}`);
      await fetchJob();
      setLifecyclePanelRefresh((n) => n + 1);
    } catch { toast("error", "Failed to update"); } finally { setActionLoading(false); }
  };

  const handleOverride = async () => {
    if (!overrideTarget || !overrideReason.trim()) return;
    setActionLoading(true);
    try {
      // Phase B3-Fix — single atomic call. The reason travels with
      // the status change so the backend's admin-override audit log
      // captures it on the same commit. The previous implementation
      // used a two-call sequence that fired a second
      // `PATCH /jobs/:id { driver_notes }` which was silently
      // stripped by the global `whitelist: true` ValidationPipe
      // because `UpdateJobDto` has no `driver_notes` field, losing
      // the reason on every override.
      await api.patch(`/jobs/${id}/status`, {
        status: overrideTarget,
        overrideReason: overrideReason.trim(),
      });
      toast("success", `Status overridden to ${DISPLAY_STATUS_LABELS[deriveDisplayStatus(overrideTarget)]}`);
      setOverrideOpen(false);
      // A successful submission clears any pending-override stash so
      // a subsequent asset save does not auto-reopen this modal.
      setPendingOverride(null);
      await fetchJob();
      // Override can move status BACKWARDS (e.g. en_route → dispatched).
      // The lifecycle-context panel caches node rows internally, so it
      // must be told to refetch — otherwise node chips stay stuck on
      // the pre-override state even though the job detail header /
      // timeline (which read from the freshly-fetched `job`) have
      // already moved. See LifecycleContextPanel.refreshSignal.
      setLifecyclePanelRefresh((n) => n + 1);
    } catch { toast("error", "Failed to override status"); } finally { setActionLoading(false); }
  };

  const deleteJob = async () => {
    if (!confirm("Delete this job permanently?")) return;
    try {
      await api.delete(`/jobs/${id}`);
      toast("success", "Job deleted");
      router.push("/jobs");
    } catch { toast("error", "Failed to delete"); }
  };

  // Driver Task V1 — dedicated task-level delete path. For
  // `job_type = 'driver_task'` records the backend `cascadeDelete`
  // branch physically deletes the row instead of soft-cancelling it,
  // so the task disappears from dispatch, driver route, and every
  // operational surface the next time the board is fetched. Task-
  // specific confirmation copy keeps office users in the "task"
  // mental model, not the "rental job" one.
  const deleteTask = async () => {
    if (
      !confirm(
        FEATURE_REGISTRY.driver_task_delete_confirm?.guideDescription
          ?? "Delete Task?\n\nThis will permanently remove the internal driver task from dispatch and driver views. This cannot be undone.",
      )
    ) {
      return;
    }
    try {
      await api.delete(`/jobs/${id}`);
      toast(
        "success",
        FEATURE_REGISTRY.driver_task_delete_success?.label ?? "Task deleted",
      );
      router.push("/dispatch");
    } catch {
      toast(
        "error",
        FEATURE_REGISTRY.driver_task_delete_failed?.label ?? "Failed to delete task",
      );
    }
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

  const startEditAddress = () => {
    const a = job?.service_address;
    setEditAddress({
      street: a?.street || "", city: a?.city || "", state: a?.state || "", zip: a?.zip || "",
      lat: a?.lat ? Number(a.lat) : null, lng: a?.lng ? Number(a.lng) : null,
    });
    setEditingAddress(true);
  };

  const saveAddress = async () => {
    if (!editAddress.lat || !editAddress.lng) { toast("error", "Address must be geocoded with coordinates"); return; }
    setSavingAddress(true);
    try {
      await api.patch(`/jobs/${id}`, { serviceAddress: editAddress });
      toast("success", "Service address updated");
      setEditingAddress(false);
      await fetchJob();
    } catch (err: any) { toast("error", err?.message || "Failed to update address"); }
    finally { setSavingAddress(false); }
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
  // Hide the "Assign" CTA (which is the `dispatched` transition,
  // per TRANSITION_STYLES above) when a driver is already live on
  // the job. Previous logic was inverted — `|| !!job.assigned_driver`
  // kept the button visible *only when* already assigned, exactly
  // backwards. Gated on the same truth the lifecycle chip uses:
  // the live `assigned_driver` relation on the job payload.
  const transitions = (VALID_TRANSITIONS[job.status] || []).filter((t) => t !== "dispatched" || !job.assigned_driver);
  // Lifecycle timeline step index is derived from the LIVE display
  // status, not from the raw `status` column. Previously this used
  // `findIndex(s => s.status === job.status)` which meant a job
  // whose raw status was still `dispatched` after the driver was
  // unassigned kept pointing at the Assigned step forever. The
  // display status (via the new `deriveDisplayStatus(job)` object
  // form) is driver-aware, so unassignment cleanly pulls the
  // timeline back to the Unassigned step.
  const liveDisplayStatus = deriveDisplayStatus(job);
  const statusIdx = (() => {
    // Cancelled jobs are rendered via a special-case branch below
    // (muted X icon, no "current" step). Keep the -1 contract.
    if (job.status === "cancelled") return -1;
    switch (liveDisplayStatus) {
      case "completed":
        return 5;
      case "arrived":
        return 4;
      case "en_route":
        return 3;
      case "assigned":
        return 2;
      case "unassigned":
      case "needs_reschedule":
        // Preserve the pre-existing distinction between "Created"
        // (raw status=pending) and "Unassigned" (raw status=confirmed
        // or dispatched-without-driver). Only bare pending sits at
        // step 0; anything else without a driver sits at step 1.
        return job.status === "pending" ? 0 : 1;
      case "pending_payment":
        // Pending with an open invoice — still pre-dispatch. Show
        // the Created dot.
        return 0;
      default:
        return 0;
    }
  })();
  const typeColor = JOB_TYPE_COLORS[job.job_type] || "text-blue-400";
  const sizeColor = job.asset?.subtype ? (SIZE_COLORS[job.asset.subtype] || "text-[var(--t-text-muted)]") : "";
  // Rental duration truth source (bug fix for the "20,557 days"
  // display issue observed on JOB-20260413-M5F and similar).
  //
  // `rental_chains.rental_days` is AUTHORITATIVE — it's set once
  // at chain creation from the rental rule and never recomputed.
  // The lifecycle strip already reads it via /rental-chains/:id/
  // lifecycle into lifecycleStrip.rentalDays.
  //
  // `job.rental_days` is a denormalized cache on the jobs row
  // that can diverge — at least one upstream write path produces
  // values like 20,557 (the day count from the Unix epoch to
  // rental_end_date, which is the signature of a
  // `(new Date(end) - new Date(start)) / 86400000` computation
  // where `start` was null and got coerced to the epoch).
  //
  // We standardize all three display surfaces (lifecycle strip,
  // Summary card "Rental Days", Pricing card "Rental Period") on
  // the chain-truth value whenever the job is part of a rental
  // chain, and fall back to the job-level cache only for truly
  // standalone jobs. This matches the Phase 15 pattern where the
  // Summary card's sibling dates already read from lifecycleStrip
  // for the same chain-truth reason.
  const rentalDays = lifecycleStrip?.rentalDays
    ?? (job.rental_start_date && job.rental_end_date
      ? daysBetween(job.rental_start_date, job.rental_end_date)
      : job.rental_days);

  return (
    <div>
      {/* History-first back nav. Falls back to /jobs only when
          the page was opened via direct URL / fresh tab / hard
          reload — otherwise we pop the real history entry so
          Dispatch → Job → Back returns to Dispatch, Customer → Job
          → Back returns to the customer, etc. See lib/navigation. */}
      <button
        type="button"
        onClick={() => navigateBack(router, "/jobs")}
        className="mb-6 inline-flex items-center gap-2 text-sm text-[var(--t-frame-text-muted)] transition-colors hover:text-[var(--t-frame-text)]"
      >
        <ArrowLeft className="h-4 w-4" /> {FEATURE_REGISTRY.job_detail_back_link?.label ?? "Back to Lifecycles"}
      </button>

      {/* --- Header --- */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)]">{formatJobNumber(job.job_number)}</h1>
            <span className="text-xs font-medium" style={{ color: displayStatusColor(liveDisplayStatus) }}>
              {DISPLAY_STATUS_LABELS[liveDisplayStatus]}
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
            Created {new Date(job.created_at).toLocaleDateString()} {job.source && `· Source: ${formatSourceLabel(job.source)}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Phase B3-UI Issue 1 — the top-right "Assign" CTA was
              removed. Driver assignment now happens exclusively from
              the Dispatch board's Unassigned lane, so the only
              office-allowed primary transition here (`dispatched` →
              label "Assign") was a dead shortcut. The filter
              `OFFICE_ALLOWED_TRANSITIONS` only resolved to `dispatched`
              once `cancelled` was excluded, so the whole
              transitions.filter().map() block collapsed to a single
              dead button. Override Status in the actions menu covers
              any remaining office-side need to advance a job
              manually. */}

          {/* Actions menu
              ──────────────────────────────────────────────────────
              Driver Task V1 — for `job_type === 'driver_task'` the
              entire menu collapses to a single task-specific Delete
              Task action. Customer-lifecycle concepts (Cancel Job,
              Schedule Pickup / Exchange / Dump & Return, Override
              Status) are intentionally hidden because driver tasks
              have no lifecycle, no invoice, no customer, and no
              billing state — surfacing those options here would just
              confuse office users about whether this is a rental
              job. Lifecycle jobs keep the existing full menu below. */}
          <Dropdown
            trigger={<button className="rounded-full border border-[var(--t-border)] p-2 text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] transition-colors"><MoreHorizontal className="h-4 w-4" /></button>}
            align="right"
          >
            {/* Polish pass — rows tightened to px-3 py-1.5 with a
                min-h-[36px] floor so tap targets stay comfortable.
                Group order: lifecycle/scheduling first (most common
                forward actions), destructive Cancel/Delete at the
                bottom, separated by a divider. Override Status sits
                with lifecycle because it's a constructive correction
                path, not a destructive one; its AlertTriangle icon is
                tinted with var(--t-warning) so it still reads as a
                caution action without turning the whole row yellow.
                Schedule Pickup uses Truck (already imported) to
                differentiate from the generic ArrowRight on the
                other two scheduling actions — Exchange and Dump &
                Return keep ArrowRight because the Lucide icons that
                would better fit (ArrowLeftRight, RefreshCw) are not
                already imported and the spec forbids new imports. */}
            {job.job_type === "driver_task" ? (
              <button
                onClick={deleteTask}
                className="flex w-full min-h-[36px] items-center gap-2 px-3 py-1.5 text-sm text-[var(--t-error)] hover:bg-[var(--t-bg-card-hover)] transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {FEATURE_REGISTRY.driver_task_delete_action?.label ?? "Delete Task"}
              </button>
            ) : (() => {
              const canOverride = (OVERRIDE_TARGETS[job.status]?.length ?? 0) > 0;
              const canSchedule =
                job.status === "completed" &&
                (job.job_type === "delivery" || job.job_type === "drop_off");
              const hasLifecycleGroup = canOverride || canSchedule;
              const canCancel = transitions.includes("cancelled");
              return (
                <>
                  {/* ── Lifecycle / scheduling group ── */}
                  {canOverride && (
                    <button
                      onClick={() => {
                        setOverrideTarget(OVERRIDE_TARGETS[job.status]?.[0] || "");
                        setOverrideReason("");
                        setOverrideOpen(true);
                      }}
                      className="flex w-full min-h-[36px] items-center gap-2 px-3 py-1.5 text-sm text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors"
                    >
                      <AlertTriangle className="h-3.5 w-3.5 text-[var(--t-warning)]" />
                      Override Status
                    </button>
                  )}
                  {canSchedule && (
                    <>
                      {canOverride && (
                        <div className="my-1 border-t border-[var(--t-border)]" />
                      )}
                      <button
                        onClick={() => scheduleNext("pickup")}
                        disabled={actionLoading}
                        className="flex w-full min-h-[36px] items-center gap-2 px-3 py-1.5 text-sm text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors disabled:opacity-50"
                      >
                        <Truck className="h-3.5 w-3.5 text-[var(--t-text-muted)]" />
                        Schedule Pickup
                      </button>
                      <button
                        onClick={() => scheduleNext("exchange")}
                        disabled={actionLoading}
                        className="flex w-full min-h-[36px] items-center gap-2 px-3 py-1.5 text-sm text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors disabled:opacity-50"
                      >
                        <ArrowRight className="h-3.5 w-3.5 text-[var(--t-text-muted)]" />
                        Schedule Exchange
                      </button>
                      <button
                        onClick={() => scheduleNext("dump_and_return")}
                        disabled={actionLoading}
                        className="flex w-full min-h-[36px] items-center gap-2 px-3 py-1.5 text-sm text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors disabled:opacity-50"
                      >
                        <ArrowRight className="h-3.5 w-3.5 text-[var(--t-text-muted)]" />
                        Schedule Dump & Return
                      </button>
                    </>
                  )}

                  {/* ── Destructive group ── */}
                  {hasLifecycleGroup && (
                    <div className="my-1 border-t border-[var(--t-border)]" />
                  )}
                  {canCancel && (
                    <button
                      onClick={() => changeStatus("cancelled")}
                      className="flex w-full min-h-[36px] items-center gap-2 px-3 py-1.5 text-sm text-[var(--t-error)] hover:bg-[var(--t-bg-card-hover)] transition-colors"
                    >
                      <XCircle className="h-3.5 w-3.5" /> Cancel Job
                    </button>
                  )}
                  <button
                    onClick={deleteJob}
                    className="flex w-full min-h-[36px] items-center gap-2 px-3 py-1.5 text-sm text-[var(--t-error)] hover:bg-[var(--t-bg-card-hover)] transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete Job
                  </button>
                </>
              );
            })()}
          </Dropdown>
        </div>
      </div>

      {/*
        ── Connected Lifecycle Navigation ──
        Prev / Current / Next triplet derived from the same
        /cancellation-context response used by the guided-cancel
        modal. Chain jobs only — standalone jobs render nothing.
        Silent on fetch error; loading renders a 3-slot skeleton
        that does NOT block the rest of the page.
      */}
      {navContextLoading && (
        <div className="grid grid-cols-3 gap-2 mb-6">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 rounded-[14px] skeleton"
            />
          ))}
        </div>
      )}
      {!navContextLoading && navContext && navContext.isChain && (() => {
        const currentIdx = navContext.jobs.findIndex((j) => j.is_current);
        if (currentIdx < 0) return null;
        const prev =
          currentIdx > 0 ? navContext.jobs[currentIdx - 1] : null;
        const current = navContext.jobs[currentIdx];
        const next =
          currentIdx < navContext.jobs.length - 1
            ? navContext.jobs[currentIdx + 1]
            : null;

        const prevLabel =
          FEATURE_REGISTRY.connected_lifecycle_previous?.label ?? "Previous";
        const currentLabel =
          FEATURE_REGISTRY.connected_lifecycle_current?.label ?? "Current";
        const nextLabel =
          FEATURE_REGISTRY.connected_lifecycle_next?.label ?? "Next";
        const sectionTitle =
          FEATURE_REGISTRY.connected_lifecycle_title?.label ?? "Lifecycle";

        type NavJob = CancellationContext["jobs"][number];
        const renderSlot = (
          slotLabel: string,
          node: NavJob | null,
          isCurrent: boolean,
        ) => {
          if (!node) {
            return (
              <div
                className="rounded-[14px] border p-2"
                style={{
                  borderColor: "var(--t-border)",
                  borderStyle: "dashed",
                  background: "var(--t-bg-card)",
                }}
              >
                <p className="text-[10px] text-[var(--t-text-muted)] mb-1">
                  {slotLabel}
                </p>
                <p className="text-[11px] text-[var(--t-text-tertiary)]">—</p>
              </div>
            );
          }
          const nodeStatus = deriveDisplayStatus(node.status);
          const body = (
            <>
              <div className="flex items-baseline gap-1 mb-0.5">
                <span className="text-[10px] text-[var(--t-text-muted)]">
                  {node.job_type}
                </span>
                <span className="text-sm font-medium text-[var(--t-text-primary)]">
                  {formatJobNumber(node.job_number)}
                </span>
              </div>
              <p className="text-[11px] text-[var(--t-text-tertiary)] mb-0.5">
                {node.scheduled_date ?? "—"}
              </p>
              <span
                className="text-[11px] font-medium"
                style={{ color: displayStatusColor(nodeStatus) }}
              >
                {DISPLAY_STATUS_LABELS[nodeStatus] ?? node.status}
              </span>
            </>
          );
          if (isCurrent) {
            return (
              <div
                className="rounded-[14px] border p-2"
                style={{
                  borderColor: "var(--t-border)",
                  borderLeft: "3px solid var(--t-accent)",
                  background: "var(--t-bg-card)",
                }}
              >
                <p
                  className="text-[10px] mb-1"
                  style={{ color: "var(--t-accent)" }}
                >
                  {slotLabel}
                </p>
                {body}
              </div>
            );
          }
          return (
            <button
              type="button"
              onClick={() => router.push(`/jobs/${node.id}`)}
              className="rounded-[14px] border p-2 text-left transition-colors hover:bg-[var(--t-bg-card-hover)]"
              style={{
                borderColor: "var(--t-border)",
                background: "var(--t-bg-card)",
              }}
            >
              <p className="text-[10px] text-[var(--t-text-muted)] mb-1">
                {slotLabel}
              </p>
              {body}
            </button>
          );
        };

        return (
          <div className="mb-6">
            <p className="text-sm font-medium text-[var(--t-text-muted)] mb-2">
              {sectionTitle}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {renderSlot(prevLabel, prev, false)}
              {renderSlot(currentLabel, current, true)}
              {renderSlot(nextLabel, next, false)}
            </div>
          </div>
        );
      })()}

      {/* ─── Blocked panel (contextual — only shown when this job is blocked) ─── */}
      {/*
       * Uses the shared `getBlockedReason` helper from
       * @/lib/blocked-job so this panel and the Jobs page stay
       * perfectly in sync on "is this job blocked and why". The panel
       * is a navigation surface only — it never resolves issues
       * directly; operators click through to the authorized Billing
       * Issues or Invoice workflows. Labels and tooltips come from
       * FEATURE_REGISTRY.
       */}
      {(() => {
        const blockedShape = {
          status: job.status,
          open_billing_issue_count: openBillingIssueCount,
          linked_invoice: invoice
            ? { status: invoice.status, balance_due: invoice.balance_due }
            : null,
        };
        const reason = getBlockedReason(blockedShape);
        if (!reason) return null;
        const panelFeature = FEATURE_REGISTRY.job_blocked_panel;
        const reasonFeature =
          reason === "billing_issue"
            ? FEATURE_REGISTRY.blocked_reason_billing_issue
            : FEATURE_REGISTRY.blocked_reason_unpaid_completed_invoice;
        const reviewIssuesLabel =
          FEATURE_REGISTRY.job_blocked_panel_cta_review_issues?.label ?? "Review in Billing Issues";
        const openInvoiceLabel =
          FEATURE_REGISTRY.job_blocked_panel_cta_open_invoice?.label ?? "Open Invoice";
        return (
          <div
            className="mb-4 rounded-[20px] border-l-4 px-5 py-4"
            style={{
              backgroundColor: "var(--t-error-soft)",
              borderColor: "var(--t-error)",
              borderTop: "1px solid var(--t-border)",
              borderRight: "1px solid var(--t-border)",
              borderBottom: "1px solid var(--t-border)",
            }}
            role="alert"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" style={{ color: "var(--t-error)" }} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
                    {panelFeature?.label ?? "Job is blocked"}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--t-text-secondary)" }}>
                    {reasonFeature?.shortDescription ?? reasonFeature?.label ?? reason}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{ backgroundColor: "var(--t-error)", color: "var(--t-error-on-error, #fff)" }}
                    >
                      {reasonFeature?.label ?? reason}
                    </span>
                    {reason === "billing_issue" && openBillingIssueCount > 0 && (
                      <span className="text-[11px]" style={{ color: "var(--t-text-muted)" }}>
                        {openBillingIssueCount} open issue{openBillingIssueCount !== 1 ? "s" : ""} for this job
                      </span>
                    )}
                    {reason === "unpaid_completed_invoice" && invoice && (
                      <span className="text-[11px]" style={{ color: "var(--t-text-muted)" }}>
                        Invoice #{invoice.invoice_number} — {fmt(invoice.balance_due)} due
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/*
                 * Primary CTA — opens the Phase 4 job-scoped resolution
                 * drawer. The drawer keeps the operator on the Job page
                 * and offers root-cause-first resolution (record payment
                 * inline, related issues clear automatically) instead of
                 * forcing a Job → Billing Issues → Invoice → back-to-Job
                 * round trip.
                 */}
                <button
                  type="button"
                  onClick={() => setResolveDrawerOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
                  style={{ backgroundColor: "var(--t-error)", color: "var(--t-error-on-error, #fff)" }}
                  title={FEATURE_REGISTRY.job_blocked_resolution_drawer?.shortDescription}
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {FEATURE_REGISTRY.job_blocked_resolution_cta_primary?.label ?? "Fix Billing"}
                </button>
                {/*
                 * Secondary fallback CTAs preserved for operators who
                 * prefer the dedicated Billing Issues / Invoice surfaces
                 * (e.g., complex resolutions that the inline drawer
                 * cannot handle). The drawer is the recommended path,
                 * but the existing deep-links still work.
                 */}
                {reason === "billing_issue" && (
                  <Link
                    href={`/billing-issues?jobId=${id}`}
                    className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
                    style={{ borderColor: "var(--t-border)", color: "var(--t-text-secondary)" }}
                    title={FEATURE_REGISTRY.job_blocked_panel_cta_review_issues?.shortDescription}
                  >
                    <FileText className="h-3 w-3" /> {reviewIssuesLabel}
                  </Link>
                )}
                {reason === "unpaid_completed_invoice" && invoice && (
                  <Link
                    href={`/invoices/${invoice.id}?openPayment=1`}
                    className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
                    style={{ borderColor: "var(--t-border)", color: "var(--t-text-secondary)" }}
                    title={FEATURE_REGISTRY.job_blocked_panel_cta_open_invoice?.shortDescription}
                  >
                    <DollarSign className="h-3 w-3" /> {openInvoiceLabel}
                  </Link>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── Job Blocked Resolution Drawer (Phase 4) ─── */}
      {/*
       * Mounted unconditionally so SlideOver can animate in/out, but
       * only fetches its scoped issue list when `open === true`. The
       * `onRefetch` callback wires the drawer back into this page's
       * existing fetch routines so the contextual panel reflects the
       * latest invoice + issue state immediately after a payment.
       */}
      <JobBlockedResolutionDrawer
        open={resolveDrawerOpen}
        onClose={() => setResolveDrawerOpen(false)}
        jobId={id as string}
        invoice={invoice}
        onRefetch={() => {
          fetchJob();
          fetchInvoice();
          fetchOpenBillingIssues();
        }}
      />

      {/* --- Post-Create Billing Banner --- */}
      {isPostCreate && invoice && invoice.balance_due > 0 && (
        <div
          className="mb-4 flex items-center justify-between rounded-[20px] border-l-4 px-5 py-4"
          style={{ backgroundColor: "var(--t-accent-soft)", borderColor: "var(--t-accent)", borderTop: "1px solid var(--t-border)", borderRight: "1px solid var(--t-border)", borderBottom: "1px solid var(--t-border)" }}
        >
          <div className="flex items-center gap-3">
            <DollarSign className="h-5 w-5" style={{ color: "var(--t-accent)" }} />
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
                Invoice #{invoice.invoice_number} — {fmt(invoice.balance_due)} due
              </p>
              <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>
                Collect payment to complete this booking
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/invoices/${invoice.id}?openPayment=1`}
              className="flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ backgroundColor: "var(--t-accent)", color: "#fff" }}
            >
              <DollarSign className="h-3.5 w-3.5" /> Collect Payment
            </Link>
            <button
              onClick={() => setIsPostCreate(false)}
              className="rounded-full px-3 py-2 text-xs font-medium transition-colors hover:bg-[var(--t-bg-card-hover)]"
              style={{ color: "var(--t-text-muted)" }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {isPostCreate && invoice && invoice.balance_due <= 0 && (
        <div
          className="mb-4 flex items-center gap-3 rounded-[20px] border px-5 py-3"
          style={{ backgroundColor: "var(--t-bg-card)", borderColor: "var(--t-accent)" }}
        >
          <CheckCircle2 className="h-5 w-5" style={{ color: "var(--t-accent)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>
            Booking created — invoice paid
          </p>
        </div>
      )}
      {isPostCreate && !invoice && (
        <div
          className="mb-4 flex items-center justify-between rounded-[20px] border-l-4 px-5 py-3"
          style={{ backgroundColor: "var(--t-warning-soft, var(--t-bg-card))", borderColor: "var(--t-warning)", borderTop: "1px solid var(--t-border)", borderRight: "1px solid var(--t-border)", borderBottom: "1px solid var(--t-border)" }}
        >
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5" style={{ color: "var(--t-warning)" }} />
            <p className="text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>
              Booking created — no invoice found yet
            </p>
          </div>
        </div>
      )}

      {/* --- Quick Action Buttons --- */}
      <div className="mb-6 flex items-center gap-2 flex-wrap">
        <button
          onClick={async () => {
            if (!invoice) { toast("warning", "No invoice linked to this job"); return; }
            try {
              await api.post(`/invoices/${invoice.id}/send`);
              toast("success", "Invoice sent");
            } catch { toast("error", "Failed to send invoice"); }
          }}
          disabled={actionLoading}
          className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 hover:bg-[var(--t-bg-card-hover)]"
          style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)", background: "none", cursor: "pointer" }}
        >
          <Send className="h-3 w-3" /> Send Invoice
        </button>
        <button
          onClick={tryMarkComplete}
          disabled={actionLoading || !transitions.includes("completed")}
          className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 hover:bg-[var(--t-bg-card-hover)]"
          style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)", background: "none", cursor: "pointer" }}
        >
          <CheckCircle2 className="h-3 w-3" /> Mark Complete
        </button>
        <button
          onClick={async () => {
            const note = prompt("Add a note:");
            if (!note) return;
            try {
              await api.patch(`/jobs/${id}`, { driver_notes: note });
              toast("success", "Note added");
              await fetchJob();
            } catch { toast("error", "Failed to add note"); }
          }}
          disabled={actionLoading}
          className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 hover:bg-[var(--t-bg-card-hover)]"
          style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)", background: "none", cursor: "pointer" }}
        >
          <StickyNote className="h-3 w-3" /> Add Note
        </button>
      </div>

      {/* --- Failed Trip Banner --- */}
      {job.is_failed_trip && (
        <div className="mb-6 rounded-[20px] border px-5 py-4" style={{ borderColor: "var(--t-error)", background: "rgba(220,38,38,0.05)" }}>
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" style={{ color: "var(--t-error)" }} />
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--t-error)" }}>
                Failed Trip
                {job.attempt_count && job.attempt_count > 1 && (
                  <span className="ml-2 text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "var(--t-error-soft)", color: "var(--t-error)" }}>
                    Attempt #{job.attempt_count}
                  </span>
                )}
              </p>
              {job.failed_reason && <p className="text-xs mt-1" style={{ color: "var(--t-text-primary)" }}>{job.failed_reason}</p>}
              {job.failed_at && <p className="text-[11px] mt-1" style={{ color: "var(--t-text-muted)" }}>Failed at {new Date(job.failed_at).toLocaleString()}</p>}
            </div>
          </div>
        </div>
      )}

      {/* --- Timeline --- */}
      <div className="mb-8 rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-6">
        <div className="flex items-center justify-between">
          {TIMELINE_STEPS.map((step, i) => {
            const isCompleted = i <= statusIdx && job.status !== "cancelled";
            const isCurrent = i === statusIdx;
            const rawTimestamp = (job as unknown as Record<string, string>)[step.key];
            // Timestamp safety: only show the `dispatched_at`
            // ("Assigned") timestamp when the live derived state is
            // actually at or past the Assigned step. Otherwise we'd
            // render a stale historical timestamp under an inactive
            // step — the exact "ghost Assigned" bug this fix is for.
            // Same guard applies to `en_route_at` / `arrived_at` /
            // `completed_at` so an unassignment after en_route never
            // leaves an orphaned later-step timestamp visible.
            const timestamp = i <= statusIdx ? rawTimestamp : undefined;
            // Phase B3-UI Issue 2 — clickable-chip override shortcut.
            // A step chip is interactive iff (a) the viewer is an
            // office role AND (b) the step's raw status is in
            // `OVERRIDE_TARGETS[job.status]` AND (c) it isn't the
            // current status (overriding to self is a no-op). Reuses
            // the existing override modal — sets the same state the
            // kebab menu sets — so reason entry and audit trail are
            // identical to the three-dot path.
            const chipIsOverrideTarget =
              isOfficeRole &&
              step.status !== job.status &&
              (OVERRIDE_TARGETS[job.status] || []).includes(step.status);
            const chipOnClick = chipIsOverrideTarget
              ? () => {
                  setOverrideTarget(step.status);
                  setOverrideReason("");
                  setOverrideOpen(true);
                }
              : undefined;
            const chipInner = (
              <>
                <div className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                  job.status === "cancelled" && i > statusIdx ? "bg-[var(--t-border)] text-[var(--t-text-muted)]" :
                  isCurrent ? "bg-[var(--t-accent)] text-[var(--t-accent-on-accent)] ring-4 ring-[var(--t-accent)]/20" :
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
              </>
            );
            return (
              <div key={step.key} className="flex flex-1 items-center">
                {chipIsOverrideTarget ? (
                  <button
                    type="button"
                    onClick={chipOnClick}
                    aria-label={`Override status to ${step.label}`}
                    className="flex flex-col items-center rounded-lg px-1 py-0.5 transition-colors cursor-pointer hover:bg-[var(--t-bg-card-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--t-accent)]/40"
                  >
                    {chipInner}
                  </button>
                ) : (
                  <div className="flex flex-col items-center">
                    {chipInner}
                  </div>
                )}
                {i < TIMELINE_STEPS.length - 1 && (
                  <div className={`mx-2 h-0.5 flex-1 rounded-full transition-colors ${
                    i < statusIdx && job.status !== "cancelled" ? "bg-[var(--t-accent)]/30" : "bg-[var(--t-border)]"
                  }`} />
                )}
              </div>
            );
          })}
        </div>
        {job.status === "cancelled" && (() => {
          // Phase 10A — map cancellation_reason to registry label, fall
          // back to the legacy "cancelled as part of lifecycle update"
          // copy when reason is null (legacy jobs), and surface the
          // chain-derived replacement tasks.
          const reasonLabel =
            job.cancellation_reason === "exchange_replacement"
              ? FEATURE_REGISTRY.cancelled_due_to_exchange_replacement?.label ?? "Cancelled due to exchange replacement"
              : job.cancellation_reason
                ? job.cancellation_reason
                : FEATURE_REGISTRY.cancelled_due_to_lifecycle_update?.label ?? "Cancelled as part of lifecycle update";
          const replacements = job.replacement_jobs ?? [];
          const hasReplacements = replacements.length > 0;
          const replacementRouteLabel = (r: { task_type: string; job_type: string }) =>
            r.task_type === "exchange"
              ? FEATURE_REGISTRY.rental_lifecycle_task_exchange?.label ?? "Exchange"
              : r.task_type === "pick_up"
                ? FEATURE_REGISTRY.rental_lifecycle_task_pick_up?.label ?? "Pickup"
                : r.task_type === "drop_off"
                  ? FEATURE_REGISTRY.rental_lifecycle_task_drop_off?.label ?? "Delivery"
                  : r.job_type;
          return (
            <div className="mt-5 mb-2 rounded-[20px] bg-[var(--t-error-soft)] border border-[var(--t-error)]/20 px-4 py-4 text-sm">
              <div className="text-[var(--t-error)] leading-relaxed">
                <XCircle className="inline h-4 w-4 mr-1.5 -mt-0.5" />
                <span className="font-semibold">{reasonLabel}</span>
                {job.cancelled_at && (
                  <span className="text-[var(--t-text-muted)] ml-2">
                    · {new Date(job.cancelled_at).toLocaleString()}
                  </span>
                )}
              </div>
              {hasReplacements && (
                <div className="mt-4 pt-4 border-t border-[var(--t-error)]/15">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)] mb-2.5">
                    {FEATURE_REGISTRY.replaced_by?.label ?? "Replaced by"}
                  </p>
                  <div className="space-y-2">
                    {replacements.map((r) => (
                      <Link
                        key={r.job_id}
                        href={`/jobs/${r.job_id}`}
                        className="flex items-center justify-between rounded-[12px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3.5 py-2.5 hover:bg-[var(--t-bg-card-hover)] transition-colors"
                        title={FEATURE_REGISTRY.view_replacement_job?.label ?? "View replacement job"}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-xs font-semibold text-[var(--t-accent)]">
                            {replacementRouteLabel(r)}
                          </span>
                          <span className="text-xs font-medium text-[var(--t-text-primary)]">{formatJobNumber(r.job_number)}</span>
                          <span className="text-xs text-[var(--t-text-muted)]">
                            {r.scheduled_date ? new Date(r.scheduled_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                          </span>
                        </div>
                        <ArrowRight className="h-3 w-3 text-[var(--t-text-muted)]" />
                      </Link>
                    ))}
                  </div>
                  {job.rental_chain_id && (
                    <Link
                      href={`/rentals/${job.rental_chain_id}`}
                      className="inline-flex items-center gap-1 mt-3 text-[11px] font-medium text-[var(--t-accent)] hover:underline"
                    >
                      {FEATURE_REGISTRY.view_lifecycle?.label ?? "View full lifecycle"}
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* --- Lifecycle Strip --- */}
      {chainId && lifecycleStrip && (
        <Link href={`/rentals/${chainId}`}
          className="block rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-5 py-3 mb-2 hover:border-[var(--t-accent)] transition-colors cursor-pointer">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-4 text-xs">
              <span className="text-[var(--t-text-muted)]">
                {FEATURE_REGISTRY.lifecycle_strip_delivered?.label ?? "Delivered"}:{" "}
                <span className="font-semibold text-[var(--t-text-primary)]">{lifecycleStrip.dropOffDate ? fmtDateFull(lifecycleStrip.dropOffDate) : "—"}</span>
              </span>
              <ArrowRight className="h-3 w-3 text-[var(--t-text-muted)]" />
              <span className="text-[var(--t-text-muted)]">
                {FEATURE_REGISTRY.lifecycle_strip_pickup?.label ?? "Pickup"}:{" "}
                <span className="font-semibold text-[var(--t-text-primary)]">{lifecycleStrip.pickupDate ? fmtDateFull(lifecycleStrip.pickupDate) : "—"}</span>
              </span>
              {lifecycleStrip.rentalDays && (
                <span className="text-[var(--t-text-muted)]">({lifecycleStrip.rentalDays} days)</span>
              )}
            </div>
            <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full ${
              lifecycleStrip.chainStatus === "completed"
                ? "bg-[var(--t-bg-elevated)] text-[var(--t-text-muted)]"
                : "bg-[var(--t-accent-soft)] text-[var(--t-accent)]"
            }`}>
              {(() => {
                if (lifecycleStrip.chainStatus === "completed") return FEATURE_REGISTRY.lifecycle_status_completed?.label ?? "Completed";
                if (lifecycleStrip.hasExchange) return FEATURE_REGISTRY.lifecycle_status_exchange?.label ?? "Exchange Scheduled";
                if (lifecycleStrip.dropOffStatus === "completed" && lifecycleStrip.pickupStatus && lifecycleStrip.pickupStatus !== "completed")
                  return FEATURE_REGISTRY.lifecycle_status_awaiting_pickup?.label ?? "Awaiting Pickup";
                if (lifecycleStrip.dropOffStatus === "completed" && !lifecycleStrip.pickupStatus)
                  return FEATURE_REGISTRY.lifecycle_status_on_site?.label ?? "On Site";
                return FEATURE_REGISTRY.lifecycle_status_awaiting_pickup?.label ?? "Awaiting Pickup";
              })()}
            </span>
          </div>
        </Link>
      )}

      {/* --- Two Column Layout --- */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Left Column (60%) */}
        <div className="space-y-6 lg:col-span-3">
          {/* Job Summary — unified service details + scheduling */}
          <Card title={FEATURE_REGISTRY.job_detail_summary?.label ?? "Job Summary"} icon={Truck}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Job Type" value={job.job_type} capitalize />
              <Field label="Service" value={job.service_type?.replace(/_/g, " ") || "—"} capitalize />
              <Field
                label={FEATURE_REGISTRY.job_dumpster_size?.label ?? "Dumpster Size"}
                value={(job.rental_chain_dumpster_size || job.asset_subtype || "—") as string}
              />
              {/* Phase B2 pilot UX — delivery jobs no longer have
                  asset_id pre-populated; the driver (or an office
                  override) captures it at completion. A flat
                  "None assigned" reads as broken state to office
                  users, so pre-completion delivery jobs get an
                  explicit "Not yet assigned" primary line plus a
                  muted "Captured at completion" helper to explain
                  the new workflow. Completed deliveries and every
                  other job type fall through to the original
                  single-line Field display unchanged. */}
              {job.job_type === "delivery" && job.status !== "completed" && !job.asset_id ? (
                <div>
                  <p className="text-xs text-[var(--t-text-muted)] mb-0.5">Asset</p>
                  <p className="text-sm text-[var(--t-text-primary)] font-medium">
                    {FEATURE_REGISTRY.delivery_asset_pending_label?.label ?? "Not yet assigned"}
                  </p>
                  <p className="text-xs text-[var(--t-text-muted)] mt-0.5">
                    {FEATURE_REGISTRY.delivery_asset_captured_hint?.label ?? "Captured at completion"}
                  </p>
                </div>
              ) : (
                <Field label="Asset" value={job.asset ? `${job.asset.identifier} (${job.asset.subtype})` : "None assigned"} />
              )}
              <Field label="Priority" value={job.priority} capitalize />
            </div>
            {/* Dates — context-aware by job type.
                Phase 15 — sibling dates come from lifecycleStrip
                (fetched by resolveChainId from the rental-chains
                lifecycle endpoint) instead of the deleted
                relatedJobs state. This is the same chain-truth
                source the Connected Job Lifecycle panel uses, so
                the Summary card never disagrees with the panel. */}
            <div className="mt-4 pt-4 border-t border-[var(--t-border)] grid grid-cols-2 gap-4">
              {(() => {
                const chainDropOffDate = lifecycleStrip?.dropOffDate ?? null;
                const chainPickupDate = lifecycleStrip?.pickupDate ?? null;
                if (job.job_type === "delivery") {
                  return (<>
                    <Field label={FEATURE_REGISTRY.job_detail_delivery_date?.label ?? "Delivery Date"} value={job.scheduled_date ? fmtDateFull(job.scheduled_date) : "—"} />
                    <Field label={FEATURE_REGISTRY.job_detail_pickup_date?.label ?? "Pickup Date"} value={chainPickupDate ? fmtDateFull(chainPickupDate) : "—"} />
                  </>);
                }
                if (job.job_type === "pickup") {
                  return (<>
                    <Field label={FEATURE_REGISTRY.job_detail_delivery_date?.label ?? "Delivery Date"} value={chainDropOffDate ? fmtDateFull(chainDropOffDate) : "—"} />
                    <Field label={FEATURE_REGISTRY.job_detail_pickup_date?.label ?? "Pickup Date"} value={job.scheduled_date ? fmtDateFull(job.scheduled_date) : "—"} />
                  </>);
                }
                // Exchange: show both contexts
                return (<>
                  <Field label={FEATURE_REGISTRY.job_detail_delivery_date?.label ?? "Delivery Date"} value={chainDropOffDate ? fmtDateFull(chainDropOffDate) : "—"} />
                  <Field label="Exchange Date" value={job.scheduled_date ? fmtDateFull(job.scheduled_date) : "—"} />
                  {chainPickupDate && <Field label={FEATURE_REGISTRY.job_detail_pickup_date?.label ?? "Pickup Date"} value={fmtDateFull(chainPickupDate)} />}
                </>);
              })()}
              <Field label="Time Window" value={
                job.scheduled_window_start
                  ? `${fmtTime(job.scheduled_window_start)}${job.scheduled_window_end ? ` – ${fmtTime(job.scheduled_window_end)}` : ""}`
                  : "Any time"
              } />
              {rentalDays ? <Field label="Rental Days" value={`${rentalDays} days`} /> : null}
            </div>
            {job.rental_start_date && job.rental_end_date && (
              <div className="mt-3 pt-3 border-t border-[var(--t-border)] text-xs text-[var(--t-text-muted)]">
                {fmtDateFull(job.rental_start_date)} <ArrowRight className="inline h-3 w-3 mx-1" /> {fmtDateFull(job.rental_end_date)} ({rentalDays} days)
              </div>
            )}
            {/* Address */}
            <div className="mt-4 pt-4 border-t border-[var(--t-border)]">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-[var(--t-text-muted)]">Service Address</p>
                {!editingAddress && (
                  <button onClick={startEditAddress} className="flex items-center gap-1 text-[10px] font-medium text-[var(--t-accent)] hover:opacity-80">
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                )}
              </div>
              {editingAddress ? (
                <div className="space-y-3">
                  <AddressAutocomplete value={editAddress} onChange={setEditAddress} placeholder="Search address..." />
                  {editAddress.street && (
                    <p className="text-xs text-[var(--t-text-muted)]">
                      {[editAddress.street, editAddress.city, editAddress.state, editAddress.zip].filter(Boolean).join(", ")}
                      {editAddress.lat && editAddress.lng ? " ✓ Geocoded" : " — Missing coordinates"}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button onClick={saveAddress} disabled={savingAddress} className="rounded-full px-4 py-1.5 text-xs font-semibold bg-[var(--t-accent)] text-[var(--t-accent-on-accent)] disabled:opacity-50">
                      {savingAddress ? "Saving..." : "Save Address"}
                    </button>
                    <button onClick={() => setEditingAddress(false)} className="rounded-full px-4 py-1.5 text-xs font-medium border border-[var(--t-border)] text-[var(--t-text-muted)]">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : addr && (addr.street || addr.city) ? (
                <>
                  <p className="text-sm text-[var(--t-text-primary)]">{[addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(", ")}</p>
                  {job.placement_notes && <p className="mt-1 text-xs text-[var(--t-text-muted)] italic">Placement: {job.placement_notes}</p>}
                  {(job as any).placement_lat && (job as any).placement_lng && (
                    <div className="mt-4 rounded-[20px] border overflow-hidden" style={{ borderColor: "var(--t-accent)", boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
                      <div className="px-4 py-3 flex items-center justify-between" style={{ background: "var(--t-accent-soft)" }}>
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "var(--t-accent)" }}>
                            <MapPin className="h-3.5 w-3.5" style={{ color: "var(--t-accent-on-accent, #fff)" }} />
                          </div>
                          <span className="text-sm font-bold" style={{ color: "var(--t-accent)" }}>
                            {FEATURE_REGISTRY.portal_placement_title?.label ?? "Drop Location"}
                          </span>
                        </div>
                        <a
                          href={`https://www.google.com/maps?q=${(job as any).placement_lat},${(job as any).placement_lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] font-semibold rounded-full border px-3 py-1"
                          style={{ borderColor: "var(--t-accent)", color: "var(--t-accent)" }}
                        >
                          {FEATURE_REGISTRY.portal_placement_open_maps?.label ?? "Open in Maps"} →
                        </a>
                      </div>
                      <img
                        src={`https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/pin-l+FACC15(${(job as any).placement_lng},${(job as any).placement_lat})/${(job as any).placement_lng},${(job as any).placement_lat},17.5,0/600x200@2x?access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}`}
                        alt="Drop location"
                        className="w-full h-[160px] object-cover"
                        loading="lazy"
                      />
                      {(job as any).placement_pin_notes && (
                        <div className="px-4 py-3" style={{ borderTop: "1px solid var(--t-border)", background: "var(--t-bg-card)" }}>
                          <p className="text-xs" style={{ color: "var(--t-text-secondary)" }}>
                            <span className="font-semibold" style={{ color: "var(--t-text-primary)" }}>{FEATURE_REGISTRY.portal_placement_notes_label?.label ?? "Notes for the driver"}:</span> {(job as any).placement_pin_notes}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {addr.lat && addr.lng && !((job as any).placement_lat && (job as any).placement_lng) && (
                    <div className="mt-3">
                      <MapboxMap
                        markers={[{ id: job.id, lat: Number(addr.lat), lng: Number(addr.lng), type: job.job_type as any, label: job.asset?.subtype?.replace("yd","") || "" }]}
                        center={{ lat: Number(addr.lat), lng: Number(addr.lng) }}
                        zoom={14}
                        interactive={false}
                        showControls={false}
                        fitBounds={false}
                        style={{ height: 180, width: "100%" }}
                      />
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-[var(--t-text-muted)]">No address set — <button onClick={startEditAddress} className="text-[var(--t-accent)] hover:underline">add one</button></p>
              )}
            </div>
          </Card>

          {/* Phase B4 — Schedule Change History card.
              Renders the latest reschedule audit trio that
              `JobsService.updateScheduledDate` writes on every
              date change (portal customer + office dispatcher
              edits both flow through the same path). Self-
              gating: the component returns null when there is
              no meaningful prior date, so a fresh job is
              unaffected. Placed directly above the lifecycle
              panel so an operator drilling in to investigate
              "why did the date move" sees the history
              alongside the chain context. */}
          <ScheduleChangeHistoryCard
            scheduledDate={job.scheduled_date}
            rescheduledFromDate={job.rescheduled_from_date}
            rescheduledAt={job.rescheduled_at}
            rescheduledReason={job.rescheduled_reason}
            rescheduledByCustomer={job.rescheduled_by_customer}
          />

          {/* Phase 15 — Connected Job Lifecycle panel.
              Replaces the old parent_job_id / linked_job_ids
              walker with a single endpoint
              (/jobs/:id/lifecycle-context) that returns the full
              rental-chain graph plus inline alerts. Rendered for
              every job; the panel itself handles the standalone
              empty state. */}
          <LifecycleContextPanel jobId={id} refreshSignal={lifecyclePanelRefresh} />

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

          {/* Phase 11B — empty state for pickup/exchange jobs missing a dump slip */}
          {dumpTickets.length === 0 &&
            (job.job_type === "pickup" || job.job_type === "exchange" || job.job_type === "removal") && (
            <Card
              title={FEATURE_REGISTRY.dump_slip?.label ?? "Dump Slip"}
              icon={FileText}
            >
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--t-text-muted)]">
                  {FEATURE_REGISTRY.no_dump_slip_recorded?.label ?? "No dump slip recorded"}
                </p>
                <button
                  onClick={openDumpSlipCreate}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-1.5 text-[11px] font-semibold text-[var(--t-accent)] hover:bg-[var(--t-bg-card-hover)] transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  {FEATURE_REGISTRY.add_dump_slip?.label ?? "Add Dump Slip"}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-[var(--t-text-muted)]">
                Dump slips are required to complete pickup and exchange jobs.
              </p>
            </Card>
          )}

          {/* Dump Tickets */}
          {dumpTickets.length > 0 && (
            <Card title={`Dump Tickets (${dumpTickets.length})`} icon={FileText}>
              <div className="space-y-4">
                {dumpTickets.map((t) => {
                  const statusColors: Record<string, string> = {
                    submitted: "bg-yellow-500/10 text-yellow-500",
                    reviewed: "bg-emerald-500/10 text-emerald-400",
                    corrected: "bg-orange-500/10 text-orange-400",
                    voided: "bg-red-500/10 text-red-400",
                  };
                  return (
                    <div key={t.id} className={`rounded-xl border p-4 space-y-2 ${t.status === "voided" ? "opacity-50 border-red-500/20" : "border-[var(--t-border)]"}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-[var(--t-text-primary)]">
                          Ticket #{t.ticket_number || "—"}
                        </span>
                        <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${statusColors[t.status] || "bg-gray-500/10 text-gray-400"}`}>
                          {t.status}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-[var(--t-text-muted)]">Location: </span>
                          <span className="text-[var(--t-text-primary)]">{t.dump_location_name}</span>
                        </div>
                        <div>
                          <span className="text-[var(--t-text-muted)]">Waste: </span>
                          <span className="text-[var(--t-text-primary)] capitalize">{t.waste_type?.replace(/_/g, " ")}</span>
                        </div>
                        <div>
                          <span className="text-[var(--t-text-muted)]">Weight: </span>
                          <span className="text-[var(--t-text-primary)]">{Number(t.weight_tons).toFixed(2)} tons</span>
                        </div>
                        <div>
                          <span className="text-[var(--t-text-muted)]">Customer charges: </span>
                          <span className="text-[var(--t-text-primary)]">{fmt(t.customer_charges)}</span>
                        </div>
                      </div>
                      {t.void_reason && (
                        <p className="text-xs text-red-400">Void reason: {t.void_reason}</p>
                      )}
                      {/* Actions */}
                      {t.status !== "voided" && (
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => openDumpSlipEdit({
                              id: t.id,
                              ticket_number: t.ticket_number,
                              waste_type: t.waste_type,
                              weight_tons: Number(t.weight_tons),
                              dump_location_id: t.dump_location_id,
                              ticket_photo: t.ticket_photo,
                            })}
                            className="text-[10px] font-medium text-[var(--t-accent)] hover:underline"
                          >
                            {FEATURE_REGISTRY.edit_dump_slip?.label ?? "Edit Dump Slip"}
                          </button>
                          <button
                            onClick={() => setVoidingTicket({ id: t.id, ticket_number: t.ticket_number || null })}
                            className="text-[10px] font-medium text-[var(--t-error)] hover:underline"
                          >
                            {FEATURE_REGISTRY.void_dump_slip?.label ?? "Void"}
                          </button>
                          {t.status === "submitted" && (
                            <button
                              onClick={async () => {
                                try {
                                  await api.post(`/jobs/${id}/dump-slip/review`);
                                  toast("success", "Dump slip reviewed");
                                  fetchDumpTickets();
                                } catch (e: any) { toast("error", e.message || "Failed"); }
                              }}
                              className="text-[10px] font-medium text-emerald-400 hover:underline"
                            >
                              Finalize
                            </button>
                          )}
                          {t.revisions && t.revisions.length > 0 && (
                            <button
                              onClick={() => setShowRevisions(showRevisions === t.id ? null : t.id)}
                              className="text-[10px] font-medium text-[var(--t-text-muted)] hover:underline"
                            >
                              {showRevisions === t.id ? "Hide" : "Show"} History ({t.revisions.length})
                            </button>
                          )}
                        </div>
                      )}
                      {/* Correction History */}
                      {showRevisions === t.id && t.revisions && t.revisions.length > 0 && (
                        <div className="mt-2 border-t border-[var(--t-border)] pt-2 space-y-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)]">{FEATURE_REGISTRY.dump_slip_history?.label ?? "Correction History"}</p>
                          {t.revisions.map((rev, ri) => (
                            <div key={ri} className="text-xs space-y-0.5 pl-2 border-l-2 border-[var(--t-border)]">
                              <p className="text-[var(--t-text-muted)]">
                                Rev {rev.revision} &middot; {rev.changedByRole} &middot; {new Date(rev.changedAt).toLocaleString()}
                              </p>
                              {rev.reason && <p className="text-[var(--t-text-secondary)]">Reason: {rev.reason}</p>}
                              {Object.entries(rev.changes).map(([field, val]) => (
                                <p key={field} className="text-[var(--t-text-primary)]">
                                  <span className="text-[var(--t-text-muted)]">{field.replace(/_/g, " ")}:</span>{" "}
                                  <span className="line-through text-red-400">{String(val.old)}</span>{" → "}
                                  <span className="text-emerald-400">{String(val.new)}</span>
                                </p>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Invoice Summary */}
          {invoice && (
            <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5">
              <button
                onClick={() => setInvoiceOpen(!invoiceOpen)}
                className="flex w-full items-center justify-between"
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
              >
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-[var(--t-text-muted)]" />
                  <h3 className="text-sm font-semibold text-[var(--t-text-primary)]">Invoice Summary</h3>
                </div>
                {invoiceOpen ? <ChevronUp className="h-4 w-4 text-[var(--t-text-muted)]" /> : <ChevronDown className="h-4 w-4 text-[var(--t-text-muted)]" />}
              </button>
              {invoiceOpen && (
                <div className="mt-4 space-y-2.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[var(--t-text-muted)]">Invoice #</span>
                    <span className="text-[var(--t-text-primary)] font-medium">{invoice.invoice_number}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--t-text-muted)]">Status</span>
                    <span className="capitalize font-medium" style={{
                      color: invoice.status === "paid" ? "var(--t-accent)" : invoice.status === "overdue" ? "var(--t-error)" : "var(--t-warning)"
                    }}>{invoice.status}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--t-text-muted)]">Total</span>
                    <span className="text-[var(--t-text-primary)] tabular-nums font-semibold">{fmt(invoice.total)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--t-text-muted)]">Balance Due</span>
                    <span className="tabular-nums font-semibold" style={{ color: invoice.balance_due > 0 ? "var(--t-warning)" : "var(--t-accent)" }}>{fmt(invoice.balance_due)}</span>
                  </div>
                  <div className="pt-2 border-t border-[var(--t-border)]">
                    <Link href={`/invoices/${invoice.id}`} className="flex items-center gap-1.5 text-xs font-medium text-[var(--t-accent)] hover:underline">
                      <ExternalLink className="h-3 w-3" /> View Full Invoice
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column (40%) */}
        <div className="space-y-6 lg:col-span-2">
          {/* Pricing */}
          <Card title="Pricing" icon={DollarSign}>
            <div className="space-y-2.5 text-sm">
              <PriceRow label="Base Price" value={fmt(job.base_price)} />
              {job.deposit_amount > 0 && <PriceRow label="Deposit" value={fmt(job.deposit_amount)} />}
              {/* Bug fix — use the `rentalDays` derived constant
                  at the top of this component (which prefers the
                  chain's authoritative rental_days over the
                  potentially-stale job.rental_days cache).
                  See the comment block on the `rentalDays`
                  declaration for the full rationale. */}
              {rentalDays && rentalDays > 0 && <PriceRow label="Rental Period" value={`${rentalDays} days`} />}
              <div className="flex justify-between border-t border-[var(--t-border)] pt-2.5 font-semibold">
                <span className="text-[var(--t-text-primary)]">Total</span>
                <span className="text-[var(--t-accent)] tabular-nums text-base">{fmt(job.total_price)}</span>
              </div>
              {job.extra_day_charges != null && job.extra_day_charges > 0 && (
                <PriceRow label={`Extra Days (${job.extra_days || 0}d)`} value={fmt(job.extra_day_charges)} />
              )}
            </div>
          </Card>

          {/* Rental Overage */}
          {(job.is_overdue || (job.extra_days != null && job.extra_days > 0)) && (
            <div className="rounded-[20px] border p-5" style={{ background: "var(--t-bg-card)", borderColor: job.is_overdue ? "var(--t-error)" : "var(--t-warning)" }}>
              <div className="flex items-center gap-2 mb-3">
                <Clock className="h-4 w-4" style={{ color: job.is_overdue ? "var(--t-error)" : "var(--t-warning)" }} />
                <span className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--t-text-muted)" }}>Rental Overage</span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span style={{ color: "var(--t-text-muted)" }}>Extra Days</span>
                  <span className="font-semibold tabular-nums" style={{ color: job.is_overdue ? "var(--t-error)" : "var(--t-text-primary)" }}>{job.extra_days || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "var(--t-text-muted)" }}>Daily Rate</span>
                  <span className="tabular-nums" style={{ color: "var(--t-text-primary)" }}>{fmt(job.extra_day_rate)}</span>
                </div>
                <div className="flex justify-between pt-2 font-semibold" style={{ borderTop: "1px solid var(--t-border)" }}>
                  <span style={{ color: "var(--t-text-primary)" }}>Extra Charges</span>
                  <span className="tabular-nums" style={{ color: job.is_overdue ? "var(--t-error)" : "var(--t-accent)" }}>{fmt(job.extra_day_charges)}</span>
                </div>
              </div>
              {job.rental_start_date && job.rental_end_date && (
                <p className="text-[11px] mt-3" style={{ color: "var(--t-text-muted)" }}>
                  Rental: {fmtDateFull(job.rental_start_date)} — {fmtDateFull(job.rental_end_date)} ({rentalDays || 0} days included)
                </p>
              )}
            </div>
          )}

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

          {/* Asset — Phase 14: split into Pickup + Delivery roles
              for exchange jobs, otherwise a single card. The
              renderAssetRoleCard helper below is scoped inline
              (closes over `job`, `openAssetEdit`, etc.) so the
              pickup and delivery cards stay perfectly parallel
              without a top-level extraction. */}
          {(() => {
            const isExchange = job.job_type === "exchange";
            const requiredSize =
              job.rental_chain_dumpster_size || job.asset_subtype || null;

            const renderAssetRoleCard = (role: "pickup" | "drop_off") => {
              const roleAsset =
                role === "drop_off" ? job.drop_off_asset : job.asset;
              // Size mismatch is only meaningful for the pickup role
              // on non-exchange jobs. For exchanges, the delivery
              // asset is allowed to be a different size than what is
              // currently on site — that's the whole point of the
              // exchange. For the exchange pickup role, the mismatch
              // check compares against the *current* on-site asset
              // via the chain, which handleAssetEditSave enforces
              // only on save.
              const assignedSize = roleAsset?.subtype || null;
              const showSizeMismatch =
                !isExchange &&
                role === "pickup" &&
                !!(requiredSize && assignedSize && assignedSize !== requiredSize);

              // Labels per role — registry-driven.
              const sectionLabel = isExchange
                ? role === "drop_off"
                  ? FEATURE_REGISTRY.asset_role_delivery?.label ?? "Delivery Asset"
                  : FEATURE_REGISTRY.asset_role_pickup?.label ?? "Pickup Asset"
                : "Asset";
              const editTitle = isExchange
                ? role === "drop_off"
                  ? FEATURE_REGISTRY.edit_delivery_asset?.label ?? "Edit Delivery Asset"
                  : FEATURE_REGISTRY.edit_pickup_asset?.label ?? "Edit Pickup Asset"
                : FEATURE_REGISTRY.edit_asset?.label ?? "Edit Asset";
              const emptyLabel =
                role === "drop_off"
                  ? FEATURE_REGISTRY.no_delivery_asset_recorded?.label ??
                    "No delivery asset recorded"
                  : FEATURE_REGISTRY.no_asset_recorded?.label ?? "No asset recorded";

              // Expected-on-site hint only applies to the pickup role
              // (either exchange pickup-side or a plain pickup/removal
              // job). The delivery role has no "expected" concept —
              // there's no chain history for a new dumpster.
              const showExpected =
                role === "pickup" &&
                !roleAsset &&
                !!job.expected_on_site_asset;

              return (
                <div
                  key={role}
                  className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <Box className="h-4 w-4 text-[var(--t-text-muted)]" />
                    <span className="text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)] flex-1">
                      {sectionLabel}
                    </span>
                    <button
                      onClick={() => openAssetEdit(role)}
                      className="text-[var(--t-accent)] hover:opacity-70 transition-opacity"
                      title={editTitle}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                  {/* Required size context — shown on pickup side only
                      (exchanges legitimately deliver a different size). */}
                  {role === "pickup" && requiredSize && (
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)] mb-1">
                      {FEATURE_REGISTRY.required_size?.label ?? "Required"}:{" "}
                      <span className="text-[var(--t-text-primary)] font-bold">
                        {requiredSize}
                      </span>
                    </p>
                  )}
                  {roleAsset ? (
                    <>
                      <p className="text-sm font-semibold text-[var(--t-text-primary)]">
                        {roleAsset.identifier}
                      </p>
                      <p className="text-xs text-[var(--t-text-muted)] mt-0.5 capitalize">
                        {roleAsset.asset_type} &middot; {roleAsset.subtype}
                      </p>
                      {showSizeMismatch && (
                        <div className="mt-2 flex items-center gap-1.5 rounded-[10px] bg-amber-500/10 border border-amber-500/30 px-2.5 py-1.5">
                          <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                          <p className="text-[11px] text-amber-500 leading-snug">
                            {FEATURE_REGISTRY.size_mismatch_warning?.label ??
                              "Selected asset size does not match required dumpster size"}
                          </p>
                        </div>
                      )}
                    </>
                  ) : /* Phase B2 pilot UX — a pre-completion delivery
                       with no pickup-side asset is no longer an error
                       state; it's the expected state under the new
                       "capture at completion" model. Show the
                       pending/helper messaging instead of the red
                       "No asset recorded" string. Exchange drop-off
                       cards, pickup jobs, and every other case
                       continue to use the existing emptyLabel in
                       error color so legacy missing-asset states
                       stay visible. */
                  role === "pickup" &&
                    job.job_type === "delivery" &&
                    job.status !== "completed" ? (
                    <>
                      <p className="text-sm font-medium text-[var(--t-text-primary)]">
                        {FEATURE_REGISTRY.delivery_asset_pending_label?.label ?? "Not yet assigned"}
                      </p>
                      <p className="text-xs text-[var(--t-text-muted)] mt-0.5">
                        {FEATURE_REGISTRY.delivery_asset_captured_hint?.label ?? "Captured at completion"}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-[var(--t-error)]">{emptyLabel}</p>
                  )}
                  {/* Phase 11A — expected on-site hint for pickup side */}
                  {showExpected && job.expected_on_site_asset && (
                    <div className="mt-3 rounded-[12px] bg-[var(--t-accent-soft)] border border-[var(--t-accent)]/20 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-accent)]">
                        {FEATURE_REGISTRY.expected_on_site_asset?.label ??
                          "Expected on-site"}
                      </p>
                      <p className="text-xs text-[var(--t-text-primary)] mt-0.5">
                        {job.expected_on_site_asset.identifier}
                        {job.expected_on_site_asset.subtype
                          ? ` · ${job.expected_on_site_asset.subtype}`
                          : ""}
                      </p>
                    </div>
                  )}
                </div>
              );
            };

            return (
              <>
                {renderAssetRoleCard("pickup")}
                {isExchange && renderAssetRoleCard("drop_off")}
                {/* Phase 11A + 14 — asset change audit trail. Rendered
                    ONCE below the role cards, tagging each entry with
                    its field marker so pickup-side and delivery-side
                    corrections are visually distinct. Entries written
                    before Phase 14 have no `field` and implicitly
                    refer to the pickup (asset_id) column. */}
                {job.asset_change_history && job.asset_change_history.length > 0 && (
                  <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--t-text-muted)] mb-3">
                      {FEATURE_REGISTRY.asset_change_history_title?.label ??
                        "Asset Change History"}
                    </p>
                    <div className="space-y-1.5">
                      {job.asset_change_history
                        .slice()
                        .reverse()
                        .slice(0, 10)
                        .map((h, i) => {
                          const when = h.changed_at
                            ? new Date(h.changed_at).toLocaleString()
                            : "";
                          const who = h.changed_by_name || h.changed_by || "system";
                          const fieldLabel =
                            h.field === "drop_off_asset_id"
                              ? FEATURE_REGISTRY.asset_change_history_delivery?.label ??
                                "Delivery"
                              : FEATURE_REGISTRY.asset_change_history_pickup?.label ??
                                "Pickup";
                          // Only show the field badge on exchange jobs
                          // where the distinction matters. On non-
                          // exchange jobs every entry implicitly refers
                          // to the single asset_id column, so the
                          // badge would be noise.
                          const showFieldBadge = isExchange;
                          return (
                            <div
                              key={i}
                              className="text-[11px] text-[var(--t-text-muted)] leading-relaxed"
                            >
                              {showFieldBadge && (
                                <span
                                  className={`mr-1 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                                    h.field === "drop_off_asset_id"
                                      ? "bg-[var(--t-accent-soft)] text-[var(--t-accent)]"
                                      : "bg-[var(--t-bg-elevated)] text-[var(--t-text-muted)]"
                                  }`}
                                >
                                  {fieldLabel}
                                </span>
                              )}
                              <span className="text-[var(--t-text-primary)]">
                                {h.previous_asset_id ? "Changed" : "Assigned"}
                              </span>
                              {h.override_conflict && (
                                <span className="ml-1 text-amber-500 font-medium">
                                  (override)
                                </span>
                              )}
                              {h.size_mismatch && (
                                <span className="ml-1 text-amber-500 font-medium">
                                  (size mismatch)
                                </span>
                              )}{" "}
                              by{" "}
                              <span className="text-[var(--t-text-primary)]">
                                {who}
                              </span>
                              {when && <span> · {when}</span>}
                              {h.reason && (
                                <div className="italic opacity-80">"{h.reason}"</div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </>
            );
          })()}

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

      {/* --- Phase 11A: Edit Asset Modal (fix: size-aware grouping) --- */}
      {/* Phase 14 — now drives off `assetEditRole` so the same modal
          handles pickup and delivery edits on exchange jobs. */}
      {assetEditOpen && job && (() => {
        const requiredSize =
          job.rental_chain_dumpster_size || job.asset_subtype || null;
        // Phase B3-UI Issue 3 — client-side free-text filter. Empty
        // query preserves the existing Matching/Other grouping
        // behavior; non-empty query collapses into a single flat
        // filtered list so the operator sees every match regardless
        // of size. Match is case-insensitive across identifier and
        // subtype — "any typed fragment" per the spec.
        const searchQuery = assetEditSearch.trim().toLowerCase();
        const searchActive = searchQuery.length > 0;
        const searchFiltered = searchActive
          ? assetOptions.filter((a) => {
              const identifier = (a.identifier || "").toLowerCase();
              const subtype = (a.subtype || "").toLowerCase();
              return (
                identifier.includes(searchQuery) ||
                subtype.includes(searchQuery)
              );
            })
          : [];
        const matching = requiredSize
          ? assetOptions.filter((a) => a.subtype === requiredSize)
          : [];
        const other = requiredSize
          ? assetOptions.filter((a) => a.subtype !== requiredSize)
          : assetOptions;
        const pickedAsset = assetOptions.find((a) => a.id === assetEditSelection);
        const pickedSize = pickedAsset?.subtype || null;
        // Size mismatch is ONLY relevant when editing the pickup
        // role. An exchange's delivery asset is legitimately allowed
        // to be a different size than what's currently on site —
        // size-swapping is literally why exchanges exist — so the
        // modal skips the mismatch warning in that case.
        const selectionMismatch =
          assetEditRole === "pickup" &&
          !!(requiredSize && pickedSize && pickedSize !== requiredSize);

        const renderAssetButton = (a: AssetOption) => {
          const selected = assetEditSelection === a.id;
          const inUse = a.status !== "available";
          return (
            <button
              key={a.id}
              onClick={() => {
                setAssetEditSelection(a.id);
                setAssetEditConflict(null);
                setAssetEditOverride(false);
                setAssetEditMismatchAck(false);
              }}
              className={`w-full flex items-center justify-between rounded-[12px] border px-3 py-2.5 text-left transition-colors ${
                selected
                  ? "border-[var(--t-accent)] bg-[var(--t-accent-soft)]"
                  : "border-[var(--t-border)] bg-[var(--t-bg-card)] hover:bg-[var(--t-bg-card-hover)]"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-semibold text-[var(--t-text-primary)]">{a.identifier}</span>
                {a.subtype && (
                  <span className="text-xs text-[var(--t-text-muted)]">{a.subtype}</span>
                )}
              </div>
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                  inUse ? "text-amber-500 bg-amber-500/10" : "text-[var(--t-accent)] bg-[var(--t-accent-soft)]"
                }`}
              >
                {inUse
                  ? FEATURE_REGISTRY.asset_in_use?.label ?? "In Use"
                  : FEATURE_REGISTRY.asset_available?.label ?? "Available"}
              </span>
            </button>
          );
        };

        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setAssetEditOpen(false)} />
          <div className="relative rounded-[20px] p-6 w-full max-w-md shadow-2xl" style={{ backgroundColor: "var(--t-bg-secondary)", border: "1px solid var(--t-border)" }}>
            <h3 className="text-base font-semibold mb-1" style={{ color: "var(--t-text-primary)" }}>
              {assetEditRole === "drop_off"
                ? FEATURE_REGISTRY.update_delivery_asset?.label ?? "Update Delivery Asset"
                : job.job_type === "exchange"
                  ? FEATURE_REGISTRY.update_pickup_asset?.label ?? "Update Pickup Asset"
                  : FEATURE_REGISTRY.update_asset?.label ?? "Update Asset"}
            </h3>
            <p className="text-xs mb-3" style={{ color: "var(--t-text-muted)" }}>
              Pick the correct dumpster for this job. The change is audited and inventory state updates automatically.
            </p>

            {/* Context header — always visible at the top of the modal.
                Phase 14: `Current:` reflects whichever role is being
                edited (pickup vs delivery), and the required-size /
                expected-on-site hints are only shown for the pickup
                role because neither applies to a delivery asset. */}
            <div className="mb-3 rounded-[12px] bg-[var(--t-bg-elevated)] border border-[var(--t-border)] px-3 py-2.5 space-y-1">
              {assetEditRole === "pickup" && requiredSize && (
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--t-text-muted)]">
                    {FEATURE_REGISTRY.required_size?.label ?? "Required"}:
                  </span>
                  <span className="text-sm font-bold text-[var(--t-text-primary)]">{requiredSize}</span>
                </div>
              )}
              {assetEditRole === "pickup" && job.asset && (
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--t-text-muted)]">
                    Current:
                  </span>
                  <span className="text-xs text-[var(--t-text-primary)]">
                    {job.asset.identifier}
                    {job.asset.subtype ? ` (${job.asset.subtype})` : ""}
                  </span>
                </div>
              )}
              {assetEditRole === "drop_off" && job.drop_off_asset && (
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--t-text-muted)]">
                    Current:
                  </span>
                  <span className="text-xs text-[var(--t-text-primary)]">
                    {job.drop_off_asset.identifier}
                    {job.drop_off_asset.subtype ? ` (${job.drop_off_asset.subtype})` : ""}
                  </span>
                </div>
              )}
              {assetEditRole === "pickup" && job.expected_on_site_asset && (
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--t-accent)]">
                    {FEATURE_REGISTRY.expected_on_site_asset?.label ?? "Expected on-site"}:
                  </span>
                  <span className="text-xs text-[var(--t-text-primary)]">
                    {job.expected_on_site_asset.identifier}
                    {job.expected_on_site_asset.subtype ? ` (${job.expected_on_site_asset.subtype})` : ""}
                  </span>
                </div>
              )}
            </div>

            {/* Unassign option — pickup role only, only when a pickup
                asset is currently set. Rendered above the asset groups
                so it's the first thing in the scroll container.
                Intentionally styled with amber/warning tones so it
                reads as a distinct, destructive-ish action rather than
                "pick another dumpster". */}
            {assetEditRole === "pickup" && job.asset_id && (
              <button
                onClick={() => {
                  setAssetEditSelection(ASSET_UNASSIGN);
                  setAssetEditConflict(null);
                  setAssetEditOverride(false);
                  setAssetEditMismatchAck(false);
                }}
                className={`w-full flex items-center gap-2 rounded-[12px] border px-3 py-2.5 text-left transition-colors mb-3 ${
                  assetEditSelection === ASSET_UNASSIGN
                    ? "border-amber-500 bg-amber-500/15"
                    : "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10"
                }`}
              >
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-semibold text-[var(--t-text-primary)]">
                    No Asset / Unassign
                  </span>
                  <span className="text-[11px] text-[var(--t-text-muted)]">
                    Removes the current dumpster and returns it to the yard
                  </span>
                </div>
              </button>
            )}

            {/* Phase B3-UI Issue 3 — search input. Visible only when
                assets have finished loading and at least one exists,
                so it doesn't compete with loading / empty copy. */}
            {!assetOptionsLoading && assetOptions.length > 0 && (
              <input
                type="text"
                value={assetEditSearch}
                onChange={(e) => setAssetEditSearch(e.target.value)}
                placeholder={
                  FEATURE_REGISTRY.asset_search_placeholder?.label
                  ?? "Search assets…"
                }
                aria-label="Search assets"
                className="w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3.5 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] mb-3"
              />
            )}

            {/* Grouped asset list — flattens into a single filtered
                list when the search query is non-empty, per Phase
                B3-UI Issue 3. */}
            <div className="max-h-64 overflow-y-auto space-y-3 mb-3">
              {assetOptionsLoading ? (
                <p className="text-xs text-[var(--t-text-muted)] py-4 text-center">Loading…</p>
              ) : assetOptions.length === 0 ? (
                <p className="text-xs text-[var(--t-text-muted)] py-4 text-center">No assets found</p>
              ) : searchActive ? (
                searchFiltered.length > 0 ? (
                  <div className="space-y-1.5">{searchFiltered.map(renderAssetButton)}</div>
                ) : (
                  <p className="text-xs text-[var(--t-text-muted)] py-4 text-center">
                    No assets match &quot;{assetEditSearch}&quot;
                  </p>
                )
              ) : requiredSize ? (
                <>
                  {/* Matching size section */}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--t-accent)] mb-1.5">
                      {FEATURE_REGISTRY.matching_assets?.label ?? "Matching Size"} ({requiredSize})
                    </p>
                    <div className="space-y-1.5">
                      {matching.length > 0
                        ? matching.map(renderAssetButton)
                        : (
                          <p className="text-[11px] text-[var(--t-text-muted)] italic">
                            No matching-size assets available
                          </p>
                        )}
                    </div>
                  </div>
                  {/* Other sizes section — collapsed behind Show All by default */}
                  {assetEditShowAll && other.length > 0 && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--t-text-muted)] mb-1.5">
                        {FEATURE_REGISTRY.other_assets?.label ?? "Other Sizes"}
                      </p>
                      <div className="space-y-1.5">{other.map(renderAssetButton)}</div>
                    </div>
                  )}
                </>
              ) : (
                // No required size known — show flat list
                <div className="space-y-1.5">{assetOptions.map(renderAssetButton)}</div>
              )}
            </div>

            {/* Show all toggle — hidden while a search is active
                because the flat search results already span every
                size. */}
            {!searchActive && requiredSize && other.length > 0 && (
              <button
                onClick={() => setAssetEditShowAll((v) => !v)}
                className="w-full mb-3 text-[11px] font-medium text-[var(--t-accent)] hover:underline text-center"
              >
                {assetEditShowAll
                  ? "Hide other sizes"
                  : `${FEATURE_REGISTRY.show_all_assets?.label ?? "Show all sizes"} (${other.length})`}
              </button>
            )}

            <input
              type="text"
              value={assetEditReason}
              onChange={(e) => setAssetEditReason(e.target.value)}
              placeholder="Reason for change (optional)"
              className="w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] mb-3"
            />

            {/* Size mismatch warning — amber, requires explicit confirm */}
            {selectionMismatch && (
              <div className="mb-3 rounded-[12px] bg-amber-500/10 border border-amber-500/40 px-3 py-2.5">
                <div className="flex items-start gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-[var(--t-text-primary)] leading-snug">
                    {FEATURE_REGISTRY.size_mismatch_warning?.label ?? "Selected asset size does not match required dumpster size"}
                    {" "}— required {requiredSize}, picked {pickedSize}.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs text-[var(--t-text-primary)] cursor-pointer">
                  <input type="checkbox" checked={assetEditMismatchAck} onChange={(e) => setAssetEditMismatchAck(e.target.checked)} />
                  <span>I confirm this size is correct for this job</span>
                </label>
              </div>
            )}

            {assetEditConflict && (
              <div className="mb-3 rounded-[12px] bg-amber-500/10 border border-amber-500/40 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-amber-500 mb-1">
                  {assetEditRole === "drop_off"
                    ? FEATURE_REGISTRY.delivery_asset_active_conflict?.label ??
                      "This delivery asset is already committed to another active job"
                    : FEATURE_REGISTRY.asset_active_conflict?.label ??
                      "This asset is already assigned to another active job"}
                </p>
                <p className="text-xs text-[var(--t-text-primary)] mb-2">{assetEditConflict}</p>
                <label className="flex items-center gap-2 text-xs text-[var(--t-text-primary)] cursor-pointer">
                  <input type="checkbox" checked={assetEditOverride} onChange={(e) => setAssetEditOverride(e.target.checked)} />
                  <span>{FEATURE_REGISTRY.asset_conflict_override?.label ?? "Override asset conflict"}</span>
                </label>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setAssetEditOpen(false)} className="rounded-full px-4 py-2 text-xs font-medium text-[var(--t-text-muted)]">
                Cancel
              </button>
              <button
                onClick={handleAssetEditSave}
                disabled={
                  !assetEditSelection ||
                  assetEditSaving ||
                  (!!assetEditConflict && !assetEditOverride) ||
                  (selectionMismatch && !assetEditMismatchAck)
                }
                className="rounded-full bg-[var(--t-accent)] px-4 py-2 text-xs font-semibold text-[var(--t-accent-on-accent)] disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                {assetEditSaving
                  ? "Saving…"
                  : assetEditSelection === ASSET_UNASSIGN
                    ? "Unassign Asset"
                    : assetEditRole === "drop_off"
                      ? FEATURE_REGISTRY.update_delivery_asset?.label ?? "Update Delivery Asset"
                      : job.job_type === "exchange"
                        ? FEATURE_REGISTRY.update_pickup_asset?.label ?? "Update Pickup Asset"
                        : FEATURE_REGISTRY.update_asset?.label ?? "Update Asset"}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* --- Phase 11B: shared DumpTicketForm for create + edit + completion shortcut --- */}
      {job && (
        <DumpTicketForm
          mode={dumpFormMode}
          open={addDumpSlipOpen}
          jobId={id}
          existingTicket={editingTicket}
          dumpLocations={dumpLocations}
          saveLabelOverride={
            dumpFormMode === "create" && pendingCompleteAfterDumpSlip
              ? FEATURE_REGISTRY.dump_slip_complete_shortcut?.label ?? "Save & Mark Complete"
              : undefined
          }
          hintText={
            dumpFormMode === "create" && pendingCompleteAfterDumpSlip
              ? FEATURE_REGISTRY.dump_slip_required_complete_hint?.label
                ?? "This job requires a dump slip before it can be marked complete."
              : undefined
          }
          onClose={() => {
            setAddDumpSlipOpen(false);
            // If the user dismissed the shortcut form, drop the queued
            // completion so the next regular Add Dump Slip doesn't
            // accidentally trigger changeStatus.
            if (pendingCompleteAfterDumpSlip) setPendingCompleteAfterDumpSlip(false);
          }}
          onSaved={handleDumpSlipSaved}
        />
      )}

      {/* --- Phase 11B: void dump ticket dialog --- */}
      <VoidDumpTicketDialog
        ticket={voidingTicket}
        open={voidingTicket !== null}
        onClose={() => setVoidingTicket(null)}
        onVoided={fetchDumpTickets}
      />

      {/* --- Override Status Modal --- */}
      {overrideOpen && job && (() => {
        // Phase B3-Fix — centralize the close-without-submit path so
        // both the backdrop and the Cancel button clear any
        // pendingOverride stash. Without this, cancelling the modal
        // after the asset-picker auto-reopen would leave a dangling
        // stash that could re-fire on a subsequent unrelated asset
        // save. Explicit-submit close (inside handleOverride) also
        // clears pendingOverride — this helper is only for the
        // close-without-submit cases.
        const closeOverrideWithoutSubmit = () => {
          setPendingOverride(null);
          setOverrideOpen(false);
        };
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={closeOverrideWithoutSubmit} />
          <div className="relative rounded-[20px] p-6 w-full max-w-md shadow-2xl" style={{ backgroundColor: "var(--t-bg-secondary)", border: "1px solid var(--t-border)" }}>
            <h3 className="text-base font-semibold mb-1" style={{ color: "var(--t-text-primary)" }}>Override Status</h3>
            <p className="text-xs mb-4" style={{ color: "var(--t-text-muted)" }}>
              Correct a driver status error. This action is recorded.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--t-text-muted)" }}>Target Status</label>
                <select
                  value={overrideTarget}
                  onChange={(e) => setOverrideTarget(e.target.value)}
                  className="w-full rounded-[14px] border px-3.5 py-2.5 text-sm outline-none focus:border-[var(--t-accent)]"
                  style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
                >
                  {/* Dedupe override targets by display status so
                      `arrived` and `in_progress` (which both collapse
                      to the "Arrived" display label in
                      `deriveDisplayStatus`) don't render two options
                      with the same label. Keeps the first occurrence
                      so the canonical raw value for each display step
                      survives. */}
                  {(() => {
                    const seen = new Set<string>();
                    return (OVERRIDE_TARGETS[job.status] || [])
                      .filter((s) => {
                        const disp = deriveDisplayStatus(s);
                        if (seen.has(disp)) return false;
                        seen.add(disp);
                        return true;
                      })
                      .map((s) => (
                        <option key={s} value={s}>{DISPLAY_STATUS_LABELS[deriveDisplayStatus(s)]}</option>
                      ));
                  })()}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--t-text-muted)" }}>Reason (required)</label>
                <input
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="e.g. Driver tapped wrong button"
                  className="w-full rounded-[14px] border px-3.5 py-2.5 text-sm outline-none focus:border-[var(--t-accent)]"
                  style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
                />
              </div>

              {/* Delivery override → Completed must capture asset.
                  Backend enforces this with `delivery_completion_requires_asset`
                  in `jobs.service.ts#changeStatus`; this panel is the
                  UX guardrail that surfaces the requirement up-front
                  and guides the operator to the asset picker instead
                  of letting them hit the error. */}
              {overrideTarget === "completed" && job.job_type === "delivery" && (
                job.asset_id ? (
                  <div className="rounded-[12px] bg-[var(--t-accent-soft)] border border-[var(--t-accent)] px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--t-accent)] mb-1">
                      Confirm asset on completion
                    </p>
                    <p className="text-xs text-[var(--t-text-primary)]">
                      {job.asset?.identifier ?? job.asset_id}
                      {job.asset?.subtype ? ` — ${job.asset.subtype}` : ""}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-[12px] bg-amber-500/10 border border-amber-500/40 px-3 py-2.5">
                    <div className="flex items-start gap-2 mb-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-[var(--t-text-primary)] leading-snug">
                        Delivery completion requires an asset. Assign one before overriding to Completed.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        // Phase B3-Fix — stash the in-progress override
                        // before detouring to the asset picker so
                        // `handleAssetEditSave` can auto-reopen this
                        // modal with target + reason intact after the
                        // asset is assigned.
                        setPendingOverride({
                          target: overrideTarget,
                          reason: overrideReason,
                        });
                        setOverrideOpen(false);
                        openAssetEdit("pickup");
                      }}
                      className="text-xs font-semibold text-[var(--t-accent)] hover:underline"
                    >
                      Assign asset →
                    </button>
                  </div>
                )
              )}

              {/* Dump-slip-eligible override → Completed must have an
                  active dump slip. Backend enforces via
                  `dump_slip_required` in the same gate; this panel
                  mirrors the normal `tryMarkComplete` flow so the
                  override path doesn't silently hit the error toast. */}
              {overrideTarget === "completed" &&
                (job.job_type === "pickup" || job.job_type === "exchange" || job.job_type === "removal") &&
                dumpTickets.filter((t) => t.status !== "voided").length === 0 && (
                  <div className="rounded-[12px] bg-amber-500/10 border border-amber-500/40 px-3 py-2.5">
                    <div className="flex items-start gap-2 mb-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-[var(--t-text-primary)] leading-snug">
                        {job.job_type === "pickup" ? "Pickup" : job.job_type === "exchange" ? "Exchange" : "Removal"} completion requires an active dump slip. Record one before overriding to Completed.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setOverrideOpen(false); openDumpSlipCreate(); }}
                      className="text-xs font-semibold text-[var(--t-accent)] hover:underline"
                    >
                      Add dump slip →
                    </button>
                  </div>
                )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleOverride}
                  disabled={
                    !overrideTarget ||
                    !overrideReason.trim() ||
                    actionLoading ||
                    (overrideTarget === "completed" && job.job_type === "delivery" && !job.asset_id) ||
                    (overrideTarget === "completed" &&
                      (job.job_type === "pickup" || job.job_type === "exchange" || job.job_type === "removal") &&
                      dumpTickets.filter((t) => t.status !== "voided").length === 0)
                  }
                  className="flex-1 rounded-full py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{ backgroundColor: "var(--t-warning)", color: "#000" }}
                >
                  {actionLoading ? "Overriding..." : "Confirm Override"}
                </button>
                <button
                  onClick={closeOverrideWithoutSubmit}
                  className="rounded-full px-5 py-2.5 text-sm font-medium border transition-colors hover:bg-[var(--t-bg-card-hover)]"
                  style={{ borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

      {/*
        Cancellation Orchestrator Phase 2 — guided cancel modal.
        Intercepts the `changeStatus("cancelled")` path from the
        kebab menu, fetches the read-only preview endpoint
        `GET /jobs/:id/cancellation-context`, and renders the
        lifecycle + billing impact before the operator confirms.
        Fetch failures bypass this modal and fall through to the
        pre-Phase-2 prompt() flow (see `openCancelModal`).
      */}
      {cancelModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={closeCancelModal}
          role="presentation"
        >
          <div
            className="rounded-2xl border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6 w-full max-w-lg min-w-0 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-job-modal-title"
          >
            <h3
              id="cancel-job-modal-title"
              className="text-sm font-semibold text-[var(--t-text-primary)] mb-4"
            >
              {(
                FEATURE_REGISTRY.cancel_job_modal_title?.label ?? "Cancel Job {N}?"
              ).replace("{N}", formatJobNumber(job?.job_number ?? ""))}
            </h3>

            {cancelContextLoading && !cancelContext && (
              <div className="py-8 flex items-center justify-center gap-2">
                <Clock
                  className="h-4 w-4 animate-pulse"
                  style={{ color: "var(--t-text-muted)" }}
                />
                <span className="text-xs text-[var(--t-text-muted)]">
                  Loading impact…
                </span>
              </div>
            )}

            {cancelContext && (
              <>
                {/* ── Warning flags ─────────────────────────── */}
                <div className="space-y-2 mb-4">
                  {cancelContext.summary.hasCompletedJobs && (
                    <div
                      className="rounded-[12px] px-3 py-2 text-xs flex items-start gap-2"
                      style={{
                        background: "var(--t-error-soft)",
                        color: "var(--t-error)",
                        border: "1px solid var(--t-error)",
                      }}
                      role="alert"
                    >
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>
                        {FEATURE_REGISTRY.cancel_job_warning_completed?.label ??
                          "A completed job exists in this lifecycle — service may have already occurred."}
                      </span>
                    </div>
                  )}
                  {cancelContext.summary.hasActiveJobs && (
                    <div
                      className="rounded-[12px] px-3 py-2 text-xs flex items-start gap-2"
                      style={{
                        background: "var(--t-bg-elevated)",
                        color: "var(--t-warning)",
                        border: "1px solid var(--t-warning)",
                      }}
                    >
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>
                        {FEATURE_REGISTRY.cancel_job_warning_active?.label ??
                          "Other active jobs in this lifecycle will remain after this cancellation."}
                      </span>
                    </div>
                  )}
                  {cancelContext.summary.hasPaidInvoices && (
                    <div
                      className="rounded-[12px] px-3 py-2 text-xs flex items-start gap-2"
                      style={{
                        background: "var(--t-bg-elevated)",
                        color: "var(--t-warning)",
                        border: "1px solid var(--t-warning)",
                      }}
                    >
                      <DollarSign className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>
                        {FEATURE_REGISTRY.cancel_job_warning_paid_invoice?.label ??
                          "Paid invoices exist — a credit memo or refund may be required."}
                      </span>
                    </div>
                  )}
                </div>

                {/* ── Lifecycle section (chain only) ────────── */}
                {cancelContext.isChain && (
                  <div className="mb-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] mb-1">
                      {FEATURE_REGISTRY.cancel_job_lifecycle_section_title?.label ??
                        "Related Jobs"}
                    </p>
                    <p className="text-[11px] text-[var(--t-text-muted)] mb-2">
                      {(
                        FEATURE_REGISTRY.cancel_job_lifecycle_hint?.label ??
                        "{N} related jobs in this lifecycle"
                      ).replace(
                        "{N}",
                        String(cancelContext.summary.totalJobs),
                      )}
                    </p>
                    <ul
                      className="space-y-1.5 rounded-[12px] border p-2"
                      style={{
                        background: "var(--t-bg-elevated)",
                        borderColor: "var(--t-border)",
                      }}
                    >
                      {cancelContext.jobs.map((j) => (
                        <li
                          key={j.id}
                          className="flex items-center justify-between gap-2 px-2 py-1 rounded-md"
                          style={{
                            background: j.is_current
                              ? "var(--t-accent-soft)"
                              : "transparent",
                          }}
                        >
                          <span className="text-xs font-medium text-[var(--t-text-primary)]">
                            {formatJobNumber(j.job_number)}
                            {j.is_current && (
                              <span
                                className="ml-1.5 text-[10px] font-semibold uppercase"
                                style={{ color: "var(--t-accent-text)" }}
                              >
                                (this job)
                              </span>
                            )}
                          </span>
                          <span className="text-[11px] text-[var(--t-text-muted)] flex items-center gap-2">
                            <span>{j.job_type}</span>
                            <span>·</span>
                            <span
                              style={{
                                color: displayStatusColor(
                                  deriveDisplayStatus(j.status),
                                ),
                              }}
                            >
                              {DISPLAY_STATUS_LABELS[
                                deriveDisplayStatus(j.status)
                              ] ?? j.status}
                            </span>
                            {j.scheduled_date && (
                              <>
                                <span>·</span>
                                <span>{j.scheduled_date}</span>
                              </>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* ── Billing section (if any invoices) ─────── */}
                {cancelContext.summary.hasInvoices && (
                  <div className="mb-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] mb-2">
                      {FEATURE_REGISTRY.cancel_job_billing_section_title?.label ??
                        "Linked Invoices"}
                    </p>
                    <ul
                      className="space-y-1.5 rounded-[12px] border p-2"
                      style={{
                        background: "var(--t-bg-elevated)",
                        borderColor: "var(--t-border)",
                      }}
                    >
                      {cancelContext.invoices.map((inv) => (
                        <li
                          key={inv.id}
                          className="flex items-center justify-between gap-2 px-2 py-1"
                        >
                          <span className="text-xs font-medium text-[var(--t-text-primary)] flex items-center gap-2">
                            <span>#{inv.invoice_number}</span>
                            <span className="text-[10px] uppercase text-[var(--t-text-muted)]">
                              {inv.invoice_status}
                            </span>
                          </span>
                          <span className="text-[11px] text-[var(--t-text-muted)] tabular-nums">
                            Paid {formatCurrency(inv.amount_paid)} · Balance{" "}
                            <span
                              style={{
                                color:
                                  inv.balance_due > 0
                                    ? "var(--t-warning)"
                                    : undefined,
                              }}
                            >
                              {formatCurrency(inv.balance_due)}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* ── Cancellation reason (required) ────────── */}
                <div className="mb-4">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] mb-1 block">
                    {FEATURE_REGISTRY.cancel_job_reason_label?.label ??
                      "Cancellation reason"}
                    <span
                      className="ml-1"
                      style={{ color: "var(--t-error)" }}
                    >
                      *
                    </span>
                  </label>
                  <textarea
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder={
                      FEATURE_REGISTRY.cancel_job_reason_placeholder?.label ??
                      "Why is this job being cancelled?"
                    }
                    rows={3}
                    className="w-full rounded-[12px] border px-3 py-2 text-sm resize-none focus:outline-none focus:border-[var(--t-accent)]"
                    style={{
                      background: "var(--t-bg-card)",
                      borderColor: "var(--t-border)",
                      color: "var(--t-text-primary)",
                    }}
                    autoFocus
                  />
                </div>

                {/* ── Actions ──────────────────────────────── */}
                <div className="flex justify-end gap-2">
                  <button
                    onClick={closeCancelModal}
                    disabled={actionLoading}
                    className="rounded-full px-4 py-2 text-xs font-medium border transition-colors hover:bg-[var(--t-bg-card-hover)] disabled:opacity-40"
                    style={{
                      borderColor: "var(--t-border)",
                      color: "var(--t-text-muted)",
                    }}
                  >
                    {FEATURE_REGISTRY.cancel_job_modal_dismiss?.label ??
                      "Keep Job"}
                  </button>
                  <button
                    onClick={confirmCancelFromModal}
                    disabled={!cancelReason.trim() || actionLoading}
                    className="rounded-full px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
                    style={{
                      background: "var(--t-error)",
                      color: "var(--t-accent-on-accent)",
                    }}
                  >
                    {actionLoading
                      ? "Cancelling…"
                      : FEATURE_REGISTRY.cancel_job_modal_confirm?.label ??
                        "Confirm Cancellation"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
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

/**
 * Default export — Suspense boundary required by Next.js App Router
 * because `JobDetailPageContent` calls `useSearchParams`.
 */
export default function JobDetailPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm" style={{ color: "var(--t-text-muted)" }}>
          Loading…
        </div>
      }
    >
      <JobDetailPageContent {...props} />
    </Suspense>
  );
}
