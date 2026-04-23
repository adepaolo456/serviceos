"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type FormEvent } from "react";
import {
  Plus,
  Box,
  MapPin,
  DollarSign,
  X,
  Wrench,
  Truck,
  CheckCircle2,
  LayoutGrid,
  List,
  Search,
  MoreHorizontal,
  AlertTriangle,
  AlertCircle,
  Eye,
  ClipboardList,
  Shield,
  Timer,
  Download,
  ChevronDown,
  RefreshCw,
  ExternalLink,
  Settings,
  Pencil,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";
import Dropdown from "@/components/dropdown";
import { useToast } from "@/components/toast";
import { FEATURE_REGISTRY, getFeatureLabel } from "@/lib/feature-registry";

// Phase C — localStorage key for the "Projected Availability" panel
// collapse state. Stores only `{ showProjection: boolean }` — UI
// preference, no PII, no tenant coupling. Date + confirmedOnly are
// intentionally session-scoped and reset on each visit.
const PROJECTION_LS_KEY = "serviceos_assets_projection";
const SECTIONS_LS_KEY = "serviceos_assets_sections";
const ASSET_PAGE_SIZE = 25;

// Phase C — default target date for the projection panel: local
// today + 7 days. The backend authoritatively interprets the date
// against tenant_settings.timezone via getTenantToday(), so browser-
// local is fine as a default; the operator can override at will.
function defaultProjectionDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/* ─── Types ─── */

interface Asset {
  id: string;
  asset_type: string;
  subtype: string;
  identifier: string;
  status: string;
  condition: string;
  current_location_type: string;
  current_location: Record<string, string> | null;
  notes: string;
  needs_dump: boolean;
  metadata: Record<string, unknown>;
  retired_at: string | null;
  retired_by: string | null;
  retired_reason: string | null;
  retired_notes: string | null;
  created_at: string;
  updated_at: string;
}

interface AssetsResponse {
  data: Asset[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface MaintenanceRecord {
  id: string;
  date: string;
  type: string;
  description: string;
  cost: number;
  next_due?: string;
}

interface SizeGroup {
  size: string;
  assets: Asset[];
  total: number;
  available: number;
  deployed: number;
  maintenance: number;
  reserved: number;
}

interface PricingRule {
  id: string;
  base_price: number;
  container_size: string;
}

/* ─── Constants ─── */

const SIZES = ["10yd", "15yd", "20yd", "30yd", "40yd"] as const;

const STATUS_LABELS: Record<string, string> = {
  all: "All",
  available: "Available",
  on_site: "Deployed",
  reserved: "Staged",
  maintenance: "Maintenance",
  in_transit: "In Transit",
  deployed: "Deployed",
  retired: "Retired",
};

const SUBTYPES_BY_TYPE: Record<string, { value: string; label: string }[]> = {
  dumpster: [
    { value: "10yd", label: "10 yd" },
    { value: "15yd", label: "15 yd" },
    { value: "20yd", label: "20 yd" },
    { value: "30yd", label: "30 yd" },
    { value: "40yd", label: "40 yd" },
  ],
  storage_container: [
    { value: "10ft", label: "10 ft" },
    { value: "20ft", label: "20 ft" },
    { value: "40ft", label: "40 ft" },
  ],
  portable_restroom: [
    { value: "standard", label: "Standard" },
    { value: "deluxe", label: "Deluxe" },
    { value: "ada", label: "ADA" },
  ],
};

// Standard asset-number format: {prefix}-NN or {prefix}-NNN, where prefix
// is 2–3 chars of uppercase letters and/or digits. Matches every value
// SUBTYPE_PREFIX_MAP can emit (numeric "10"/"15"/…, letter "ST"/"DL"/…)
// plus future 3-char prefixes. Rejects lowercase, long prefixes, garbage.
// When this regex rejects an input, the UI shows the yellow soft-warning
// banner before POST/PATCH. Backend never rejects by format — uniqueness
// is the only hard constraint.
const STANDARD_ASSET_NUMBER = /^[A-Z0-9]{2,3}-\d{2,3}$/;

// Numeric-aware asset identifier sort. Splits on the first `-` into a
// prefix string + numeric suffix; non-standard identifiers (no match)
// sort by raw string after standard ones. Fixes the pre-existing
// localeCompare bug where "10-100" sorted before "10-99".
function compareIdentifiers(a: string, b: string): number {
  const parse = (s: string) => {
    const m = s.match(/^([A-Za-z0-9]+)-(\d+)$/);
    return m
      ? { prefix: m[1], num: parseInt(m[2], 10), raw: s }
      : { prefix: s, num: -1, raw: s };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (pa.prefix !== pb.prefix) return pa.prefix.localeCompare(pb.prefix);
  if (pa.num !== pb.num) return pa.num - pb.num;
  return pa.raw.localeCompare(pb.raw);
}

// Awaiting-dump predicate — canonical on the FRONTEND. Mirrors the
// backend AssetsService.getAwaitingDump WHERE clause:
//   status != 'retired' AND (status = 'full_staged' OR needs_dump = true)
// Referenced by THREE sites on this page: the tile count (quickStats),
// the filteredAssets status-filter special case, and the section
// builder. Keep those sites pointed at this helper so frontend/
// backend predicates can't silently drift — same bug class Item 5
// eliminated for current_job_id.
function isAwaitingDump(a: Pick<Asset, "status" | "needs_dump">): boolean {
  return a.status !== "retired" && (a.status === "full_staged" || a.needs_dump);
}

/* ─── Status color text (no badge backgrounds) ─── */

function statusColor(s: string): string {
  if (s === "available") return "color: var(--t-accent-text)";
  if (s === "on_site" || s === "deployed") return "color: var(--t-warning)";
  if (s === "reserved") return "color: var(--t-warning)";
  if (s === "maintenance") return "color: var(--t-error)";
  if (s === "in_transit") return "color: #A855F7";
  if (s === "retired") return "color: var(--t-text-muted)";
  return "color: var(--t-text-muted)";
}

function statusTextClass(s: string): string {
  if (s === "available") return "text-[var(--t-accent-text)]";
  if (s === "on_site" || s === "deployed") return "text-[var(--t-warning)]";
  if (s === "reserved") return "text-[var(--t-warning)]";
  if (s === "maintenance") return "text-[var(--t-error)]";
  if (s === "in_transit") return "text-[#A855F7]";
  return "text-[var(--t-text-muted)]";
}

/* ─── Helpers ─── */

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function fmtDate(d: string): string {
  if (!d) return "\u2014";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

import { formatCurrency } from "@/lib/utils";
function fmtMoney(n: number): string {
  return formatCurrency(n);
}

function getDeployedInfo(asset: Asset): { customerName: string; address: string; deliveryDate: string; rentalEnd: string; daysDeployed: number; isOverdue: boolean } | null {
  if (asset.status !== "on_site" && asset.status !== "deployed") return null;
  const meta = (asset.metadata || {}) as Record<string, any>;
  const deliveryDate = meta.delivery_date || meta.deployed_date || asset.updated_at;
  const rentalEnd = meta.rental_end_date || "";
  const today = new Date().toISOString().split("T")[0];
  const daysDeployed = daysBetween(deliveryDate, today);
  const isOverdue = rentalEnd ? today > rentalEnd : false;
  return {
    customerName: meta.customer_name || "",
    address: asset.current_location?.address || "",
    deliveryDate,
    rentalEnd,
    daysDeployed: Math.max(0, daysDeployed),
    isOverdue,
  };
}

function exportCSV(assets: Asset[]) {
  const headers = ["Identifier", "Type", "Size", "Status", "Location", "Notes"];
  const rows = assets.map((a) => [
    a.identifier,
    a.asset_type,
    a.subtype,
    a.status,
    a.current_location?.address || a.current_location_type || "Yard",
    (a.notes || "").replace(/,/g, ";"),
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `inventory-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── Main Page ─── */

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [createPrefilledSize, setCreatePrefilledSize] = useState<string | null>(null);
  const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [editAsset, setEditAsset] = useState<Asset | null>(null);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  // Item 4 — retire / delete lifecycle. includeRetired is OFF by default;
  // toggle sends includeRetired=true to the backend list endpoint, which
  // widens the response to include status='retired' rows. Retired assets
  // render with muted styling and the `Retired` badge, and expose only a
  // View action.
  const [includeRetired, setIncludeRetired] = useState(false);
  const [retireAsset, setRetireAsset] = useState<Asset | null>(null);
  const [deleteAssetTarget, setDeleteAssetTarget] = useState<Asset | null>(null);
  // Phase C — Projected Availability panel state. Collapse state is
  // persisted via `PROJECTION_LS_KEY`; target date + confirmedOnly
  // reset on each visit. Default collapsed=open per the Phase C spec
  // (operators should see projections by default on load).
  const [showProjection, setShowProjection] = useState(true);
  const [projectionDate, setProjectionDate] = useState<string>(
    defaultProjectionDate,
  );
  const [projectionConfirmedOnly, setProjectionConfirmedOnly] =
    useState(false);
  const [projectionData, setProjectionData] = useState<
    Array<{
      subtype: string;
      base_available: number;
      outgoing_count: number;
      incoming_count: number;
      projected_available: number;
      reserved_count: number;
      warnings: string[];
    }> | null
  >(null);
  const [projectionLoading, setProjectionLoading] = useState(false);
  const [projectionError, setProjectionError] = useState<string | null>(null);
  const { toast } = useToast();
  const router = useRouter();

  const fetchAssets = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (silent) setRefreshing(true);
    try {
      const qs = `/assets?limit=200${includeRetired ? "&includeRetired=true" : ""}`;
      const res = await api.get<AssetsResponse>(qs);
      setAssets(res.data);
      setLastUpdated(new Date());
    } catch { /* silent */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [includeRetired]);

  useEffect(() => { fetchAssets(); }, [fetchAssets]);

  useEffect(() => {
    const interval = setInterval(() => fetchAssets(true), 30000);
    return () => clearInterval(interval);
  }, [fetchAssets]);

  // Phase C — restore the projection-panel collapse preference on
  // mount. Null-safe on SSR and on parse errors.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(PROJECTION_LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { showProjection?: unknown };
      if (typeof parsed.showProjection === "boolean") {
        setShowProjection(parsed.showProjection);
      }
    } catch {
      // Missing key / corrupt JSON → fall through to default (open).
    }
  }, []);

  // Phase C — persist the projection-panel collapse preference.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        PROJECTION_LS_KEY,
        JSON.stringify({ showProjection }),
      );
    } catch {
      // Quota / private mode — collapse still works for the session.
    }
  }, [showProjection]);

  // Sectioned asset list — collapse + pagination state. Open/closed
  // is persisted via `SECTIONS_LS_KEY`; per-section page numbers
  // reset each visit (session-only). Defaults: Available=open, the
  // rest collapsed — operators typically care about free inventory.
  const [sectionOpen, setSectionOpen] = useState<Record<string, boolean>>({
    available: true,
    deployed: false,
    awaiting_dump: false,
    maintenance: false,
  });
  const [sectionPages, setSectionPages] = useState<Record<string, number>>({});

  // Sections LS — load on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(SECTIONS_LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const next: Record<string, boolean> = {};
      for (const k of ["available", "deployed", "awaiting_dump", "maintenance"]) {
        if (typeof parsed[k] === "boolean") next[k] = parsed[k] as boolean;
      }
      if (Object.keys(next).length > 0) {
        setSectionOpen((prev) => ({ ...prev, ...next }));
      }
    } catch { /* fall through */ }
  }, []);

  // Sections LS — persist on change. Only persist when statusFilter
  // is "all" (user-manual state). Tile-driven section overrides are
  // ephemeral and should NOT pollute the saved preference — otherwise
  // switching back to "All" would restore a tile-driven snapshot
  // instead of the user's manual preference.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (statusFilter !== "all") return;
    try {
      window.localStorage.setItem(SECTIONS_LS_KEY, JSON.stringify(sectionOpen));
    } catch { /* quota / private mode */ }
  }, [sectionOpen, statusFilter]);

  // Tile → section auto-expand. When a status tile is active, open
  // ONLY the matching section and close the rest. When "All" is
  // restored, re-apply the user's manual open/closed preference
  // from before the tile was selected. Uses a ref to stash the
  // manual state so it survives across renders without triggering
  // unnecessary re-renders.
  const manualSectionOpenRef = useRef<Record<string, boolean> | null>(null);

  // Per-section DOM refs for tile-click scroll-into-view orientation.
  // Populated via callback refs on each section wrapper below. Used
  // only for scroll + brief highlight — does not affect rendering.
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Short-lived highlight key set by a tile click so the landed
  // section gets a visible focus flash for ~1.2s after scrolling.
  const [highlightedSection, setHighlightedSection] = useState<
    string | null
  >(null);
  useEffect(() => {
    const keyMap: Record<string, string> = {
      available: "available",
      on_site: "deployed",
      awaiting_dump: "awaiting_dump",
      maintenance: "maintenance",
    };
    if (statusFilter === "all") {
      if (manualSectionOpenRef.current) {
        setSectionOpen(manualSectionOpenRef.current);
        manualSectionOpenRef.current = null;
      }
    } else {
      const sectionKey = keyMap[statusFilter];
      if (sectionKey) {
        setSectionOpen((prev) => {
          if (!manualSectionOpenRef.current) {
            manualSectionOpenRef.current = { ...prev };
          }
          const next: Record<string, boolean> = {};
          for (const k of Object.keys(prev)) next[k] = k === sectionKey;
          return next;
        });
      }
    }
  }, [statusFilter]);

  const sizeGroups: SizeGroup[] = useMemo(() => {
    return SIZES.map((size) => {
      const sizeAssets = assets.filter((a) => a.subtype === size);
      const available = sizeAssets.filter((a) => a.status === "available").length;
      const deployed = sizeAssets.filter((a) => a.status === "on_site" || a.status === "deployed").length;
      const maintenance = sizeAssets.filter((a) => a.status === "maintenance").length;
      const reserved = sizeAssets.filter((a) => a.status === "reserved").length;
      return { size, assets: sizeAssets, total: sizeAssets.length, available, deployed, maintenance, reserved };
    }).filter((g) => g.total > 0);
  }, [assets]);

  // Phase C — stable dependency key for the projection fetch effect.
  // Without this, the effect would re-run every 30s when the asset
  // poll refreshes `assets` and creates a new `sizeGroups` object
  // reference. By reducing sizeGroups to a sorted comma-joined
  // string, we only refetch when the SET of active subtypes actually
  // changes — not when their internal counts change.
  const projectionSubtypesKey = useMemo(
    () => sizeGroups.map((g) => g.size).sort().join(","),
    [sizeGroups],
  );

  // Fetch projected availability for the tenant in a single call.
  // The backend multi-subtype endpoint returns one entry per
  // DISTINCT assets.subtype — replaces the old per-subtype parallel
  // Promise.all. Re-runs on mount, when the active subtype set
  // changes (auto-refresh when a new size is provisioned), when
  // the target date changes, or when the confirmedOnly toggle
  // flips. Does NOT poll — data refreshes only on explicit control
  // changes.
  useEffect(() => {
    if (!projectionSubtypesKey) {
      setProjectionData(null);
      return;
    }
    let cancelled = false;
    setProjectionLoading(true);
    setProjectionError(null);
    api
      .get<
        Array<{
          subtype: string;
          base_available: number;
          outgoing_count: number;
          incoming_count: number;
          projected_available: number;
          reserved_count: number;
          warnings: string[];
        }>
      >(
        `/assets/availability?date=${encodeURIComponent(projectionDate)}` +
          `&confirmedOnly=${projectionConfirmedOnly ? "true" : "false"}`,
      )
      .then((data) => {
        if (cancelled) return;
        // Defensive — the multi-subtype path returns an array; the
        // legacy single-subtype shape was an object. If something
        // upstream misroutes and returns a single object we fall
        // back to an empty list rather than rendering garbage.
        const rows = Array.isArray(data) ? data : [];
        setProjectionData(
          rows.map((r) => ({
            subtype: r.subtype,
            base_available: r.base_available ?? 0,
            outgoing_count: r.outgoing_count ?? 0,
            incoming_count: r.incoming_count ?? 0,
            projected_available: r.projected_available ?? 0,
            reserved_count: r.reserved_count ?? 0,
            warnings: Array.isArray(r.warnings) ? r.warnings : [],
          })),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setProjectionError("Could not load availability data");
          setProjectionData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setProjectionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectionSubtypesKey, projectionDate, projectionConfirmedOnly]);

  const filteredAssets = useMemo(() => {
    let result = [...assets];
    if (selectedSize) result = result.filter((a) => a.subtype === selectedSize);
    if (statusFilter !== "all") {
      result = result.filter((a) => {
        // Synthetic filter keys — not raw status values. Each maps to
        // a predicate that spans multiple statuses / flags.
        if (statusFilter === "on_site") return a.status === "on_site" || a.status === "deployed";
        if (statusFilter === "awaiting_dump") return isAwaitingDump(a);
        return a.status === statusFilter;
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((a) => {
        const meta = (a.metadata || {}) as Record<string, any>;
        return (
          a.identifier.toLowerCase().includes(q) ||
          (meta.customer_name || "").toLowerCase().includes(q) ||
          (a.current_location?.address || "").toLowerCase().includes(q)
        );
      });
    }
    result.sort((a, b) => compareIdentifiers(a.identifier, b.identifier));
    return result;
  }, [assets, selectedSize, statusFilter, searchQuery]);

  // Sectioned groups — splits filteredAssets by status for the
  // Jobs-style segmented list view. Filtering + search happens
  // first (in filteredAssets); then this memo groups the results.
  // Sections with zero rows are hidden at render time. Section
  // order matches the KPI tiles: Available → Deployed → Awaiting Dump →
  // Maintenance. An "other" catch-all captures any statuses not
  // covered (in_transit, full_staged, retired, etc.).
  const assetSections = useMemo(() => {
    const sections = [
      {
        key: "available",
        label: FEATURE_REGISTRY.assets_available_section?.label ?? "Available Assets",
        assets: filteredAssets.filter((a) => a.status === "available"),
      },
      {
        key: "deployed",
        label: FEATURE_REGISTRY.assets_deployed_section?.label ?? "Deployed Assets",
        assets: filteredAssets.filter(
          (a) => a.status === "on_site" || a.status === "deployed",
        ),
      },
      {
        key: "awaiting_dump",
        label: getFeatureLabel("asset_section_awaiting_dump"),
        assets: filteredAssets.filter(isAwaitingDump),
      },
      {
        key: "maintenance",
        label: FEATURE_REGISTRY.assets_maintenance_section?.label ?? "Maintenance Assets",
        assets: filteredAssets.filter((a) => a.status === "maintenance"),
      },
    ];
    // Catch-all for statuses not in the four main groups
    const coveredIds = new Set(sections.flatMap((s) => s.assets.map((a) => a.id)));
    const other = filteredAssets.filter((a) => !coveredIds.has(a.id));
    if (other.length > 0) {
      sections.push({ key: "other", label: "Other", assets: other });
    }
    return sections;
  }, [filteredAssets]);

  const overdueAssets = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    return assets.filter((a) => {
      if (a.status !== "on_site" && a.status !== "deployed") return false;
      const meta = (a.metadata || {}) as Record<string, any>;
      return meta.rental_end_date && today > meta.rental_end_date;
    });
  }, [assets]);

  const quickStats = useMemo(() => {
    const available = assets.filter((a) => a.status === "available").length;
    const deployed = assets.filter((a) => a.status === "on_site" || a.status === "deployed");
    const awaitingDump = assets.filter(isAwaitingDump).length;
    const maintenanceCount = assets.filter((a) => a.status === "maintenance").length;
    return { available, deployed: deployed.length, awaitingDump, maintenanceCount };
  }, [assets]);

  const quickStatus = async (id: string, status: string) => {
    try {
      await api.patch(`/assets/${id}`, { status });
      toast("success", `Asset marked as ${STATUS_LABELS[status] || status}`);
      fetchAssets();
    } catch {
      toast("error", "Failed to update status");
    }
  };

  // Opens the destructive-styled hard-delete modal. The actual DELETE
  // request + 409 handling lives in DeleteAssetModal below. The old
  // inline window.confirm path was replaced because (a) it offered no
  // structured 409 copy — the backend now returns
  // `asset_has_references` with a "Retire instead" hint — and (b)
  // destructive confirmation dialogs should match the app's modal
  // styling conventions.
  const deleteAsset = (asset: Asset) => {
    setDeleteAssetTarget(asset);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const cancelBulk = () => { setBulkMode(false); setSelectedIds(new Set()); };

  const bulkDelete = async () => {
    const count = selectedIds.size;
    if (!confirm(`Delete ${count} selected asset(s)? This cannot be undone.`)) return;
    try {
      await Promise.all([...selectedIds].map(id => api.delete(`/assets/${id}`)));
      toast("success", `${count} asset(s) deleted`);
      cancelBulk();
      fetchAssets();
    } catch { toast("error", "Failed to delete some assets"); }
  };

  const handleTileClick = (size: string) => {
    if (selectedSize === size) {
      setSelectedSize(null);
      setStatusFilter("all");
    } else {
      setSelectedSize(size);
      setStatusFilter("all");
    }
  };

  return (
    <div>
      {/* Overdue Alert */}
      {overdueAssets.length > 0 && (
        <div
          className="mb-6 flex items-center justify-between px-5 py-3"
          style={{ borderRadius: 14, border: "1px solid var(--t-error)", background: "var(--t-error-soft)" }}
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5" style={{ color: "var(--t-error)" }} />
            <span className="text-sm font-medium" style={{ color: "var(--t-error)" }}>
              {overdueAssets.length} overdue rental{overdueAssets.length !== 1 ? "s" : ""}
            </span>
          </div>
          <button
            onClick={() => { setSelectedSize(null); setStatusFilter("on_site"); }}
            className="text-sm font-medium transition-colors"
            style={{ color: "var(--t-error)" }}
          >
            View Details
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-1px", color: "var(--t-frame-text)" }}>
            Assets
          </h1>
          <p style={{ fontSize: 14, color: "var(--t-frame-text-muted)", marginTop: 4 }}>
            {assets.length} dumpsters across {sizeGroups.length} sizes
          </p>
        </div>
        <button
          onClick={() => { setCreatePrefilledSize(null); setCreateOpen(true); }}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "var(--t-accent)", color: "var(--t-accent-on-accent)", fontWeight: 600, fontSize: 14,
            padding: "10px 20px", borderRadius: 24,
            transition: "opacity 0.15s ease",
          }}
          onMouseOver={(e) => (e.currentTarget.style.opacity = "0.9")}
          onMouseOut={(e) => (e.currentTarget.style.opacity = "1")}
        >
          <Plus className="h-4 w-4" />
          Add Asset
        </button>
      </div>

      {/* ─── KPI Row ─── */}
      {!loading && (() => {
        // Smart Availability tile — merges current + projected into
        // one tile. Projected total is derived from the EXISTING
        // `projectionData` state (no new fetch). Other 3 tiles are
        // unchanged and rendered via the standard map.
        const projectedTotal = projectionData
          ? projectionData.reduce((sum, r) => sum + r.projected_available, 0)
          : null;
        const projDateLabel = (() => {
          try {
            return new Date(projectionDate + "T12:00:00").toLocaleDateString(
              "en-US",
              { month: "short", day: "numeric" },
            );
          } catch {
            return projectionDate;
          }
        })();
        const availIsActive = statusFilter === "available";
        const tileBase = {
          borderRadius: 14,
          padding: "18px 16px",
          transition: "all 0.15s ease" as const,
          textAlign: "left" as const,
          cursor: "pointer" as const,
        };
        return (
          <div className="grid grid-cols-4 gap-4 mb-8">
            {/* Availability tile (merged current → projected) */}
            <button
              onClick={() => {
                const nextActive = !availIsActive;
                setStatusFilter(nextActive ? "available" : "all");
                // When activating, orient the user: scroll the
                // Ready Assets section into view and flash it
                // briefly. Delay gives React a frame to commit
                // the filter change + auto-expand side-effect
                // before we try to scroll to the now-open section.
                if (nextActive) {
                  setTimeout(() => {
                    const el = sectionRefs.current["available"];
                    if (el) {
                      el.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });
                      setHighlightedSection("available");
                      setTimeout(
                        () => setHighlightedSection(null),
                        1200,
                      );
                    }
                  }, 80);
                }
              }}
              style={{
                ...tileBase,
                border: availIsActive ? "2px solid var(--t-accent)" : "1px solid var(--t-border)",
                background: availIsActive ? "var(--t-bg-elevated)" : "var(--t-bg-card)",
              }}
              onMouseOver={(e) => { if (!availIsActive) e.currentTarget.style.background = "var(--t-bg-card-hover)"; }}
              onMouseOut={(e) => { if (!availIsActive) e.currentTarget.style.background = "var(--t-bg-card)"; }}
            >
              <p style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", color: availIsActive ? "var(--t-accent)" : "var(--t-text-muted)", letterSpacing: "0.05em" }}>
                {FEATURE_REGISTRY.assets_availability_label?.label ?? "Availability"}
              </p>
              <div className="flex items-baseline gap-1.5" style={{ marginTop: 4 }}>
                <span className="tabular-nums" style={{ fontSize: 24, fontWeight: 700, color: quickStats.available > 0 ? "var(--t-accent-text)" : "var(--t-text-primary)" }}>
                  {quickStats.available}
                </span>
                <span style={{ fontSize: 16, fontWeight: 500, color: "var(--t-text-muted)" }}>→</span>
                <span className="tabular-nums" style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: projectedTotal === null
                    ? "var(--t-text-muted)"
                    : projectedTotal === 0
                      ? "var(--t-error)"
                      : projectedTotal <= 2
                        ? "var(--t-warning)"
                        : "var(--t-accent-text)",
                }}>
                  {projectedTotal ?? "—"}
                </span>
              </div>
              <p style={{ fontSize: 10, color: "var(--t-text-muted)", marginTop: 2 }}>
                Now → {projDateLabel}
              </p>
            </button>

            {/* Remaining KPI tiles (unchanged) */}
            {[
              { label: "DEPLOYED", value: quickStats.deployed, color: "var(--t-warning)", filter: "on_site" },
              { label: getFeatureLabel("asset_tile_awaiting_dump"), value: quickStats.awaitingDump, color: "var(--t-warning)", filter: "awaiting_dump" },
              { label: "MAINTENANCE", value: quickStats.maintenanceCount, color: "var(--t-error)", filter: "maintenance" },
            ].map((kpi) => {
              const isActive = statusFilter === kpi.filter;
              return (
                <button
                  key={kpi.label}
                  onClick={() => setStatusFilter(isActive ? "all" : kpi.filter)}
                  style={{
                    ...tileBase,
                    border: isActive ? "2px solid var(--t-accent)" : "1px solid var(--t-border)",
                    background: isActive ? "var(--t-bg-elevated)" : "var(--t-bg-card)",
                  }}
                  onMouseOver={(e) => { if (!isActive) e.currentTarget.style.background = "var(--t-bg-card-hover)"; }}
                  onMouseOut={(e) => { if (!isActive) e.currentTarget.style.background = "var(--t-bg-card)"; }}
                >
                  <p style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", color: isActive ? "var(--t-accent)" : "var(--t-text-muted)", letterSpacing: "0.05em" }}>
                    {kpi.label}
                  </p>
                  <p style={{ fontSize: 24, fontWeight: 700, color: kpi.value > 0 ? kpi.color : "var(--t-text-primary)", marginTop: 4 }} className="tabular-nums">
                    {kpi.value}
                  </p>
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* Last updated + refresh */}
      {!loading && (
        <div className="flex items-center gap-2 mb-4" style={{ fontSize: 11, color: "var(--t-frame-text-muted)" }}>
          <span>Updated {lastUpdated.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
          <button
            onClick={() => fetchAssets(true)}
            disabled={refreshing}
            className="p-1 rounded transition-colors disabled:opacity-40"
            style={{ color: "var(--t-frame-text-muted)" }}
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      )}

      {/* ─── Projected Availability (Phase C) ─── */}
      {/* Collapsible section matching the Jobs page pattern from
          commit 0c6e74b. Reads from the Phase-B-fixed
          GET /assets/availability endpoint. Default open, persisted
          in localStorage. Re-fetches only on target-date change or
          confirmedOnly toggle — never polls. */}
      {!loading && sizeGroups.length > 0 && (
        <div className="mb-6">
          <button
            type="button"
            onClick={() => setShowProjection((v) => !v)}
            aria-expanded={showProjection}
            aria-controls="assets-projection-panel"
            className="w-full flex items-center justify-between px-4 py-2 mb-3 rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] hover:bg-[var(--t-bg-card-hover)] transition-colors cursor-pointer"
          >
            <span className="text-sm font-semibold text-[var(--t-text-primary)]">
              {FEATURE_REGISTRY.assets_availability_panel_label?.label ?? "Availability"}
            </span>
            <ChevronDown
              className="h-4 w-4 text-[var(--t-text-muted)] transition-transform duration-150 ease-out"
              style={{ transform: showProjection ? "rotate(0deg)" : "rotate(-90deg)" }}
            />
          </button>
          {showProjection && (
            <div
              id="assets-projection-panel"
              className="rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4"
            >
              {/* Controls */}
              <div className="flex items-center gap-4 mb-2 flex-wrap">
                <label className="flex items-center gap-2 text-xs text-[var(--t-text-muted)]">
                  <span>
                    {FEATURE_REGISTRY.projected_availability_date_label?.label ?? "Project to date"}
                  </span>
                  <input
                    type="date"
                    value={projectionDate}
                    onChange={(e) => setProjectionDate(e.target.value)}
                    className="rounded-[10px] border border-[var(--t-border)] bg-[var(--t-bg-secondary)] px-2.5 py-1 text-xs text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)]"
                  />
                </label>
                <label
                  className="flex items-center gap-2 text-xs cursor-pointer"
                  title={
                    FEATURE_REGISTRY.projected_availability_confirmed_only_hint?.label ??
                    "Only include confirmed/dispatched jobs"
                  }
                >
                  <input
                    type="checkbox"
                    checked={projectionConfirmedOnly}
                    onChange={(e) => setProjectionConfirmedOnly(e.target.checked)}
                    className="cursor-pointer"
                  />
                  <span className="text-[var(--t-text-muted)]">
                    {FEATURE_REGISTRY.projected_availability_confirmed_only?.label ?? "Confirmed jobs only"}
                  </span>
                </label>
                {/* Phase C1 — active-state badge. Appears next to the
                    confirmed-only toggle when the projection is
                    filtered to firmly-committed jobs, so operators
                    always see which mode the numbers represent. */}
                {projectionConfirmedOnly && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{
                      background: "var(--t-accent-soft, var(--t-bg-elevated))",
                      color: "var(--t-accent)",
                    }}
                  >
                    {FEATURE_REGISTRY.projected_availability_confirmed_active?.label ??
                      "Showing confirmed jobs only"}
                  </span>
                )}
              </div>
              {/* Phase C1 — formula hint. Small muted line under the
                  controls that makes the Projected math explicit so
                  operators don't have to infer the relationship
                  between the four table columns. */}
              <p className="text-[10px] text-[var(--t-text-muted)] mb-4 italic">
                {FEATURE_REGISTRY.projected_availability_formula_hint?.label ??
                  "Projected = Available + Incoming \u2212 Outgoing"}
              </p>

              {/* Summary block — aggregated totals across every
                  subtype so operators see a single roll-up before
                  drilling into the per-subtype table. Reuses the
                  same `projectionData` fetched for the table below
                  (no additional API call). "Available Now" sums the
                  strict `base_available` field from projectionData
                  (not `quickStats.available`) so the summary's own
                  math stays self-consistent: base + incoming −
                  outgoing = TOTAL exactly. The tile separately uses
                  `quickStats.available` for its left-hand number —
                  the two can legitimately differ by a few units
                  because the strict backend filter excludes
                  `needs_dump` and referentially-held assets. */}
              {!projectionLoading && !projectionError && projectionData && (() => {
                const baseTotal = projectionData.reduce(
                  (sum, r) => sum + r.base_available,
                  0,
                );
                const incomingTotal = projectionData.reduce(
                  (sum, r) => sum + r.incoming_count,
                  0,
                );
                const outgoingTotal = projectionData.reduce(
                  (sum, r) => sum + r.outgoing_count,
                  0,
                );
                const projectedTotal = projectionData.reduce(
                  (sum, r) => sum + r.projected_available,
                  0,
                );
                const totalColor =
                  projectedTotal === 0
                    ? "var(--t-error)"
                    : projectedTotal <= 2
                      ? "var(--t-warning)"
                      : "var(--t-accent)";
                return (
                  <div
                    className="mb-4 rounded-[12px] px-4 py-3"
                    style={{
                      background: "var(--t-bg-elevated, var(--t-bg-secondary))",
                      border: "1px solid var(--t-border)",
                    }}
                  >
                    <div className="flex justify-between items-center text-sm mb-1.5">
                      <span className="text-[var(--t-text-muted)]">Available Now</span>
                      <span className="tabular-nums font-semibold" style={{ color: "var(--t-text-primary)" }}>
                        {baseTotal}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-sm mb-1.5">
                      <span className="text-[var(--t-text-muted)]">Incoming</span>
                      <span className="tabular-nums font-semibold" style={{ color: "var(--t-text-primary)" }}>
                        +{incomingTotal}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-[var(--t-text-muted)]">Outgoing</span>
                      <span className="tabular-nums font-semibold" style={{ color: "var(--t-text-primary)" }}>
                        &minus;{outgoingTotal}
                      </span>
                    </div>
                    <div
                      className="flex justify-between items-center mt-2.5 pt-2.5"
                      style={{ borderTop: "1px solid var(--t-border)" }}
                    >
                      <span
                        className="uppercase tracking-wider font-bold"
                        style={{ fontSize: 11, color: "var(--t-text-muted)" }}
                      >
                        Total
                      </span>
                      <span
                        className="tabular-nums"
                        style={{ fontSize: 20, fontWeight: 700, color: totalColor }}
                      >
                        {projectedTotal}
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Body: loading / error / table */}
              {projectionLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-8 rounded animate-pulse"
                      style={{ background: "var(--t-bg-elevated)" }}
                    />
                  ))}
                </div>
              ) : projectionError ? (
                <p className="text-xs text-[var(--t-error)] py-4 text-center">
                  {projectionError}
                </p>
              ) : !projectionData || projectionData.length === 0 ? (
                <p className="text-xs text-[var(--t-text-muted)] py-4 text-center">
                  No subtypes to project
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full" style={{ fontSize: 12, borderCollapse: "collapse" }}>
                    <thead>
                      <tr className="text-left" style={{ borderBottom: "1px solid var(--t-border)" }}>
                        <th style={{ padding: "8px 12px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>
                          Subtype
                        </th>
                        <th className="text-right" style={{ padding: "8px 12px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>
                          {FEATURE_REGISTRY.projected_availability_base?.label ?? "Available Now"}
                        </th>
                        <th className="text-right" style={{ padding: "8px 12px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>
                          {FEATURE_REGISTRY.projected_availability_outgoing?.label ?? "Outgoing"}
                        </th>
                        <th className="text-right" style={{ padding: "8px 12px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>
                          {FEATURE_REGISTRY.projected_availability_incoming?.label ?? "Incoming"}
                        </th>
                        <th className="text-right" style={{ padding: "8px 12px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>
                          {FEATURE_REGISTRY.projected_availability_projected?.label ?? "Projected"}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectionData.map((row) => {
                        // Color-coding: 0 → error, 1-2 → warning,
                        // >= 3 → accent (healthy). Per the Phase C
                        // spec's "green if > 0, amber if 1-2, red if
                        // 0" — interpreted as 3+ / 1-2 / 0 since the
                        // literal "both > 0 and 1-2" is inconsistent.
                        // Phase C1 — tinted pill background keyed to
                        // the same three buckets. Uses existing
                        // `*-soft` tokens with fallback to
                        // `--t-bg-elevated` so the pill still renders
                        // cleanly if a soft token isn't defined.
                        const projColor =
                          row.projected_available === 0
                            ? "var(--t-error)"
                            : row.projected_available <= 2
                              ? "var(--t-warning)"
                              : "var(--t-accent)";
                        const projBg =
                          row.projected_available === 0
                            ? "var(--t-error-soft, var(--t-bg-elevated))"
                            : row.projected_available <= 2
                              ? "var(--t-warning-soft, var(--t-bg-elevated))"
                              : "var(--t-accent-soft, var(--t-bg-elevated))";
                        return (
                          <tr
                            key={row.subtype}
                            style={{ borderBottom: "1px solid var(--t-border-subtle)" }}
                          >
                            <td style={{ padding: "10px 12px", fontWeight: 600, color: "var(--t-text-primary)" }}>
                              {row.subtype.replace(/yd$/i, "Y").toUpperCase()}
                            </td>
                            <td className="text-right tabular-nums" style={{ padding: "10px 12px", color: "var(--t-text-primary)" }}>
                              {row.base_available}
                            </td>
                            {/* Phase C1 — plain numbers on Outgoing
                                and Incoming. The column headers
                                already indicate direction, so the
                                prior `−` / `+` prefixes were
                                redundant and visually noisy. */}
                            <td className="text-right tabular-nums" style={{ padding: "10px 12px", color: "var(--t-text-muted)" }}>
                              {row.outgoing_count}
                            </td>
                            <td className="text-right tabular-nums" style={{ padding: "10px 12px", color: "var(--t-text-muted)" }}>
                              {row.incoming_count}
                            </td>
                            {/* Phase C1 — emphasized Projected cell.
                                Larger text, pill background, strong
                                color. This is the key decision
                                metric and should dominate the row. */}
                            <td className="text-right" style={{ padding: "10px 12px" }}>
                              <span
                                className="inline-block tabular-nums rounded-full"
                                style={{
                                  fontSize: 15,
                                  fontWeight: 700,
                                  color: projColor,
                                  background: projBg,
                                  padding: "2px 12px",
                                  minWidth: 36,
                                  textAlign: "center",
                                }}
                              >
                                {row.projected_available}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Insights panel — softened from the Phase C1
                  "Warnings" panel. The content is operational context
                  (legacy reserved counts, stale past-due jobs,
                  exchange Phase B limitation), not an urgent failure
                  state. Neutral background + border + muted icon
                  make it read as informational rather than alarming.
                  Grouped-by-subtype rendering preserved from C1. */}
              {!projectionLoading &&
                !projectionError &&
                projectionData &&
                (() => {
                  const warningsBySubtype = projectionData
                    .filter((r) => r.warnings.length > 0)
                    .map((r) => ({
                      subtype: r.subtype,
                      messages: r.warnings,
                    }));
                  if (warningsBySubtype.length === 0) return null;
                  return (
                    <div
                      className="mt-4 rounded-[12px] px-3 py-2.5"
                      style={{
                        background: "var(--t-bg-elevated, var(--t-bg-secondary))",
                        border: "1px solid var(--t-border)",
                      }}
                    >
                      <div className="flex items-start gap-2 mb-2">
                        <AlertCircle
                          className="h-3.5 w-3.5 shrink-0 mt-0.5"
                          style={{ color: "var(--t-text-muted)" }}
                        />
                        <span
                          className="text-[10px] font-bold uppercase tracking-wider"
                          style={{ color: "var(--t-text-muted)" }}
                        >
                          {FEATURE_REGISTRY.assets_insights_section?.label ?? "Insights"}
                        </span>
                      </div>
                      <div className="space-y-3 pl-5">
                        {warningsBySubtype.map((group) => (
                          <div key={group.subtype}>
                            <p
                              className="text-[11px] font-bold mb-0.5"
                              style={{ color: "var(--t-text-primary)" }}
                            >
                              {group.subtype.replace(/yd$/i, "Y").toUpperCase()}
                            </p>
                            <ul
                              className="space-y-0.5 text-[11px] pl-4 list-disc list-outside"
                              style={{ color: "var(--t-text-muted)" }}
                            >
                              {group.messages.map((m, i) => (
                                <li key={i}>{m}</li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
            </div>
          )}
        </div>
      )}

      {/* ─── Size pills (status pills removed — tiles are the
          primary status control now) ─── */}
      {!loading && sizeGroups.length > 0 && (
        <div className="mb-6 flex items-center gap-3 flex-wrap">
          <div style={{ display: "inline-flex", borderRadius: 22, backgroundColor: "var(--t-bg-secondary)", border: "1px solid var(--t-border)", padding: 3, gap: 2 }}>
            {sizeGroups.map((g) => {
              const isActive = selectedSize === g.size;
              return (
                <button
                  key={g.size}
                  onClick={() => handleTileClick(g.size)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "5px 12px", borderRadius: 18, fontSize: 12, fontWeight: 600,
                    background: isActive ? "var(--t-accent)" : "transparent",
                    color: isActive ? "#fff" : "var(--t-text-muted)",
                    border: "none", transition: "all 0.15s ease", cursor: "pointer",
                  }}
                >
                  {g.size}
                  <span style={{ fontSize: 10, fontWeight: 700, opacity: isActive ? 0.85 : 0.6 }}>{g.total}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Expanded Tile Section ─── */}
      {selectedSize && !loading && (
        <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
          <div />
          <div className="flex gap-2">
            <button
              onClick={() => { setBulkMode(!bulkMode); setSelectedIds(new Set()); }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 24, fontSize: 12, fontWeight: 500,
                border: bulkMode ? "1px solid var(--t-accent)" : "1px solid var(--t-border)",
                color: bulkMode ? "var(--t-accent-text)" : "var(--t-text-muted)",
                background: bulkMode ? "var(--t-accent-soft)" : "transparent",
                transition: "all 0.15s ease", cursor: "pointer",
              }}
            >
              <Settings className="h-3 w-3" /> {bulkMode ? "Exit Bulk Edit" : "Bulk Edit"}
            </button>
            <button
              onClick={() => { setCreatePrefilledSize(selectedSize); setCreateOpen(true); }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 24, fontSize: 12, fontWeight: 500,
                border: "1px solid var(--t-border)", color: "var(--t-accent-text)",
                background: "transparent", transition: "all 0.15s ease", cursor: "pointer",
              }}
            >
              <Plus className="h-3 w-3" /> Add More {selectedSize}
            </button>
            <button
              onClick={() => exportCSV(filteredAssets)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 24, fontSize: 12, fontWeight: 500,
                border: "1px solid var(--t-border)", color: "var(--t-text-muted)",
                background: "transparent", transition: "all 0.15s ease", cursor: "pointer",
              }}
            >
              <Download className="h-3 w-3" /> CSV
            </button>
          </div>
        </div>
      )}

      {/* ─── Search + View Toggle ─── */}
      {!loading && assets.length > 0 && (
        <div className="flex items-center gap-3 mb-5">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "var(--t-text-muted)" }} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search identifier, customer, address..."
              style={{
                width: "100%", borderRadius: 14, border: "1px solid var(--t-border)",
                background: "var(--t-bg-card)", padding: "10px 16px 10px 40px",
                fontSize: 14, color: "var(--t-text-primary)", outline: "none",
                transition: "border 0.15s ease",
              }}
            />
          </div>
          <div className="flex overflow-hidden" style={{ borderRadius: 14, border: "1px solid var(--t-border)" }}>
            <button
              onClick={() => setViewMode("list")}
              className="p-2 transition-colors"
              style={{
                background: viewMode === "list" ? "var(--t-accent-soft)" : "transparent",
                color: viewMode === "list" ? "var(--t-accent-text)" : "var(--t-text-muted)",
              }}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className="p-2 transition-colors"
              style={{
                background: viewMode === "grid" ? "var(--t-accent-soft)" : "transparent",
                color: viewMode === "grid" ? "var(--t-accent-text)" : "var(--t-text-muted)",
              }}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
          <label
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "8px 14px", borderRadius: 14,
              border: "1px solid var(--t-border)",
              background: includeRetired ? "var(--t-accent-soft)" : "var(--t-bg-card)",
              cursor: "pointer", fontSize: 13,
              color: includeRetired ? "var(--t-accent-text)" : "var(--t-text-muted)",
            }}
          >
            <input
              type="checkbox"
              checked={includeRetired}
              onChange={(e) => setIncludeRetired(e.target.checked)}
              style={{ margin: 0 }}
            />
            {getFeatureLabel("asset_include_retired_toggle")}
          </label>
          {!selectedSize && (
            <>
              <button
                onClick={() => { setBulkMode(!bulkMode); setSelectedIds(new Set()); }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "8px 14px", borderRadius: 24, fontSize: 12, fontWeight: 500,
                  border: bulkMode ? "1px solid var(--t-accent)" : "1px solid var(--t-border)",
                  color: bulkMode ? "var(--t-accent-text)" : "var(--t-text-muted)",
                  background: bulkMode ? "var(--t-accent-soft)" : "transparent",
                  transition: "all 0.15s ease", cursor: "pointer",
                }}
              >
                <Settings className="h-3.5 w-3.5" /> {bulkMode ? "Exit Bulk Edit" : "Bulk Edit"}
              </button>
              <button
                onClick={() => exportCSV(filteredAssets)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "8px 14px", borderRadius: 24, fontSize: 12, fontWeight: 500,
                  border: "1px solid var(--t-border)", color: "var(--t-text-muted)",
                  background: "transparent", transition: "all 0.15s ease", cursor: "pointer",
                }}
              >
                <Download className="h-3.5 w-3.5" /> Export
              </button>
            </>
          )}
        </div>
      )}

      {/* ─── Asset List / Grid ─── */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 w-full skeleton" style={{ borderRadius: 14 }} />
          ))}
        </div>
      ) : filteredAssets.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center text-center">
          <Box size={48} style={{ color: "var(--t-text-muted)", opacity: 0.3 }} className="mb-4" />
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--t-text-primary)" }} className="mb-1">
            {searchQuery ? "No matching assets" : selectedSize ? `No ${selectedSize} dumpsters with this filter` : "No assets yet"}
          </h2>
          <p style={{ fontSize: 14, color: "var(--t-text-muted)" }} className="mb-6">
            {searchQuery ? "Try a different search term" : "Add your first dumpster to get started"}
          </p>
          {!searchQuery && !selectedSize && (
            <button
              onClick={() => setCreateOpen(true)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                background: "var(--t-accent)", color: "var(--t-accent-on-accent)", fontWeight: 600, fontSize: 14,
                padding: "10px 20px", borderRadius: 24, transition: "opacity 0.15s ease",
              }}
            >
              <Plus className="h-4 w-4" />
              Add Asset
            </button>
          )}
        </div>
      ) : viewMode === "list" ? (
        /* Jobs-style sectioned list view. Each status group gets its
           own collapsible header, per-section pagination, and a
           "Showing X–Y of Z" footer. Sections with zero rows are
           hidden. Bulk-selection is GLOBAL — `selectedIds` is the
           same Set across all sections, and the per-section
           onToggleSelectAll callback uses `setSelectedIds(prev=>...)`
           so selections in one section don't clobber selections in
           another. Grid view stays flat (unchanged). */
        <div className="space-y-6">
          {assetSections.map((section) => {
            if (section.assets.length === 0) return null;
            const isOpen = sectionOpen[section.key] ?? false;
            const page = sectionPages[section.key] ?? 1;
            const total = section.assets.length;
            const start = (page - 1) * ASSET_PAGE_SIZE;
            const end = Math.min(start + ASSET_PAGE_SIZE, total);
            const pageAssets = section.assets.slice(start, end);
            const totalPages = Math.ceil(total / ASSET_PAGE_SIZE);
            const isHighlighted = highlightedSection === section.key;
            return (
              <div
                key={section.key}
                ref={(el) => {
                  sectionRefs.current[section.key] = el;
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                    setSectionOpen((prev) => ({
                      ...prev,
                      [section.key]: !prev[section.key],
                    }))
                  }
                  aria-expanded={isOpen}
                  className="w-full flex items-center justify-between px-4 py-2 mb-3 rounded-[14px] border bg-[var(--t-bg-card)] hover:bg-[var(--t-bg-card-hover)] transition-all cursor-pointer"
                  style={{
                    borderColor: isHighlighted
                      ? "var(--t-accent)"
                      : "var(--t-border)",
                    boxShadow: isHighlighted
                      ? "0 0 0 2px var(--t-accent)"
                      : "none",
                    transitionDuration: "250ms",
                  }}
                >
                  <span className="text-sm font-semibold text-[var(--t-text-primary)]">
                    {section.label}
                    <span className="ml-2 text-xs font-normal text-[var(--t-text-muted)]">
                      ({total})
                    </span>
                  </span>
                  <ChevronDown
                    className="h-4 w-4 text-[var(--t-text-muted)] transition-transform duration-150 ease-out"
                    style={{
                      transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)",
                    }}
                  />
                </button>
                {isOpen && (
                  <>
                    <ListView
                      assets={pageAssets}
                      onSelect={setDetailAsset}
                      onQuickStatus={quickStatus}
                      onEdit={setEditAsset}
                      onDelete={deleteAsset}
                      onRetire={setRetireAsset}
                      bulkMode={bulkMode}
                      selectedIds={selectedIds}
                      onToggleSelect={toggleSelect}
                      onToggleSelectAll={() => {
                        const ids = pageAssets.map((a) => a.id);
                        setSelectedIds((prev) => {
                          const allSelected = ids.every((id) =>
                            prev.has(id),
                          );
                          const next = new Set(prev);
                          if (allSelected) {
                            ids.forEach((id) => next.delete(id));
                          } else {
                            ids.forEach((id) => next.add(id));
                          }
                          return next;
                        });
                      }}
                    />
                    {totalPages > 1 && (
                      <div
                        className="mt-3 flex items-center justify-between"
                        style={{
                          fontSize: 13,
                          color: "var(--t-text-muted)",
                        }}
                      >
                        <span>
                          Showing {start + 1}–{end} of {total}
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() =>
                              setSectionPages((prev) => ({
                                ...prev,
                                [section.key]: Math.max(1, page - 1),
                              }))
                            }
                            disabled={page === 1}
                            className="btn-ghost"
                            style={{
                              padding: "5px 12px",
                              fontSize: 12,
                              border: "1px solid var(--t-border)",
                              borderRadius: 8,
                              opacity: page === 1 ? 0.4 : 1,
                            }}
                          >
                            Previous
                          </button>
                          <button
                            onClick={() =>
                              setSectionPages((prev) => ({
                                ...prev,
                                [section.key]: Math.min(
                                  totalPages,
                                  page + 1,
                                ),
                              }))
                            }
                            disabled={page === totalPages}
                            className="btn-ghost"
                            style={{
                              padding: "5px 12px",
                              fontSize: 12,
                              border: "1px solid var(--t-border)",
                              borderRadius: 8,
                              opacity: page === totalPages ? 0.4 : 1,
                            }}
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <GridView assets={filteredAssets} onSelect={setDetailAsset} onQuickStatus={quickStatus} />
      )}

      {/* Bulk Edit Floating Bar */}
      {bulkMode && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-5 py-3 shadow-2xl"
          style={{ borderRadius: 24, border: "1px solid var(--t-border)", background: "var(--t-bg-card)" }}>
          <span className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>{selectedIds.size} selected</span>
          <button onClick={() => setBulkEditOpen(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 24, fontSize: 13, fontWeight: 600, background: "var(--t-accent)", color: "var(--t-accent-on-accent)", border: "none", cursor: "pointer" }}>
            <Pencil className="h-3.5 w-3.5" /> Edit Selected
          </button>
          <button onClick={bulkDelete}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 24, fontSize: 13, fontWeight: 600, border: "1px solid var(--t-error)", color: "var(--t-error)", background: "transparent", cursor: "pointer" }}>
            <Trash2 className="h-3.5 w-3.5" /> Delete Selected
          </button>
          <button onClick={cancelBulk}
            style={{ padding: "8px 16px", borderRadius: 24, fontSize: 13, border: "1px solid var(--t-border)", color: "var(--t-text-muted)", background: "transparent", cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      )}

      {/* Bulk Edit Modal */}
      {bulkEditOpen && (
        <BulkEditModal
          count={selectedIds.size}
          onClose={() => setBulkEditOpen(false)}
          onSaved={async (updates) => {
            try {
              await Promise.all([...selectedIds].map(id => api.patch(`/assets/${id}`, updates)));
              toast("success", `Updated ${selectedIds.size} asset(s)`);
              setBulkEditOpen(false);
              cancelBulk();
              fetchAssets();
            } catch { toast("error", "Failed to update some assets"); }
          }}
        />
      )}

      {/* Create Slide-Over */}
      <SlideOver open={createOpen} onClose={() => setCreateOpen(false)} title="Add Asset">
        <CreateAssetForm prefilledSize={createPrefilledSize} onSuccess={() => { setCreateOpen(false); fetchAssets(); }} />
      </SlideOver>

      {/* Detail Slide-Over */}
      <SlideOver open={!!detailAsset} onClose={() => setDetailAsset(null)} title={detailAsset?.identifier || "Asset Details"}
        headerActions={detailAsset ? (
          <button onClick={() => { setEditAsset(detailAsset); }} className="rounded-full p-2 transition-colors" style={{ color: "var(--t-text-muted)", border: "1px solid var(--t-border)" }}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
        ) : undefined}
      >
        {detailAsset && (
          <AssetDetail
            asset={detailAsset}
            onStatusChange={(status) => { quickStatus(detailAsset.id, status); setDetailAsset({ ...detailAsset, status }); }}
            onUpdated={() => { setDetailAsset(null); fetchAssets(); }}
          />
        )}
      </SlideOver>

      {/* Edit Asset Modal */}
      {editAsset && (
        <EditAssetModal
          asset={editAsset}
          onClose={() => setEditAsset(null)}
          onSaved={() => { setEditAsset(null); setDetailAsset(null); fetchAssets(); toast("success", "Asset updated"); }}
        />
      )}

      {/* Retire Asset Modal */}
      {retireAsset && (
        <RetireAssetModal
          asset={retireAsset}
          onClose={() => setRetireAsset(null)}
          onDone={() => { setRetireAsset(null); setDetailAsset(null); fetchAssets(); }}
        />
      )}

      {/* Hard Delete Asset Modal */}
      {deleteAssetTarget && (
        <DeleteAssetModal
          asset={deleteAssetTarget}
          onClose={() => setDeleteAssetTarget(null)}
          onDone={() => { setDeleteAssetTarget(null); setDetailAsset(null); fetchAssets(); }}
        />
      )}
    </div>
  );
}

/* ─── List View ─── */

function ListView({ assets, onSelect, onQuickStatus, onEdit, onDelete, onRetire, bulkMode, selectedIds, onToggleSelect, onToggleSelectAll }: {
  assets: Asset[]; onSelect: (a: Asset) => void; onQuickStatus: (id: string, status: string) => void; onEdit: (a: Asset) => void; onDelete: (a: Asset) => void; onRetire: (a: Asset) => void;
  bulkMode?: boolean; selectedIds?: Set<string>; onToggleSelect?: (id: string) => void; onToggleSelectAll?: () => void;
}) {
  return (
    <div style={{ borderRadius: 20, border: "1px solid var(--t-border)", background: "var(--t-bg-card)", overflow: "hidden" }}>
      <div className="table-scroll">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--t-border)" }}>
              {bulkMode && (
                <th style={{ padding: "12px 8px 12px 16px", width: 36 }}>
                  <input type="checkbox" checked={assets.length > 0 && assets.every((a) => selectedIds?.has(a.id))} onChange={onToggleSelectAll}
                    className="h-4 w-4 rounded accent-[var(--t-accent)]" />
                </th>
              )}
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Identifier</th>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Size</th>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Status</th>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Location</th>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Days Out</th>
              <th style={{ padding: "12px 8px" }}></th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => {
              const deployed = getDeployedInfo(asset);

              return (
                <tr
                  key={asset.id}
                  onClick={() => onSelect(asset)}
                  className="cursor-pointer"
                  style={{
                    borderBottom: "1px solid var(--t-border)",
                    transition: "background 0.15s ease",
                    opacity: asset.status === "retired" ? 0.55 : 1,
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "var(--t-bg-card-hover)")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {bulkMode && (
                    <td style={{ padding: "12px 8px 12px 16px", width: 36 }} onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selectedIds?.has(asset.id) || false} onChange={() => onToggleSelect?.(asset.id)}
                        className="h-4 w-4 rounded accent-[var(--t-accent)]" />
                    </td>
                  )}
                  <td style={{ padding: "12px 16px", fontWeight: 600, color: "var(--t-text-primary)" }}>
                    {asset.identifier}
                    {asset.status === "retired" && (
                      <span
                        title={asset.retired_reason ? `${asset.retired_reason}${asset.retired_at ? ` — ${new Date(asset.retired_at).toLocaleDateString()}` : ""}` : undefined}
                        style={{ marginLeft: 8, fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", padding: "2px 8px", borderRadius: 10, background: "var(--t-bg-card-hover)", color: "var(--t-text-muted)", border: "1px solid var(--t-border)" }}
                      >
                        {getFeatureLabel("asset_retired_badge")}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--t-text-muted)" }}>{asset.subtype}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <span className={statusTextClass(asset.status)} style={{ fontSize: 11, fontWeight: 600 }}>
                      {STATUS_LABELS[asset.status] || asset.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--t-text-muted)", maxWidth: 200 }} className="truncate">
                    {deployed ? (
                      <span>{deployed.customerName ? `${deployed.customerName} \u2014 ` : ""}{deployed.address || "Customer site"}</span>
                    ) : (
                      <span>Yard</span>
                    )}
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    {deployed ? (
                      <span className="tabular-nums" style={{ fontSize: 13, fontWeight: 500, color: deployed.isOverdue ? "var(--t-error)" : "var(--t-text-primary)" }}>
                        {deployed.daysDeployed}d {deployed.isOverdue && <span style={{ fontSize: 10, color: "var(--t-error)", fontWeight: 700 }}>OVERDUE</span>}
                      </span>
                    ) : (
                      <span style={{ color: "var(--t-text-muted)", fontSize: 13 }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "12px 8px" }} onClick={(e) => e.stopPropagation()}>
                    <Dropdown
                      trigger={
                        <button className="rounded p-1 transition-colors" style={{ color: "var(--t-text-muted)" }}>
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      }
                      align="right"
                    >
                      {asset.status === "retired" ? (
                        // Retired rows are terminal in the UI — only View
                        // is exposed. Edit is blocked by the backend 409
                        // asset_retired guard anyway, so hiding it avoids
                        // dead paths.
                        <button onClick={() => onSelect(asset)} className="flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors" style={{ color: "var(--t-text-primary)" }}>
                          <Eye className="h-3.5 w-3.5" /> {getFeatureLabel("asset_view_action")}
                        </button>
                      ) : (
                        <>
                          <button onClick={() => onEdit(asset)} className="flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors" style={{ color: "var(--t-text-primary)" }}>
                            <Pencil className="h-3.5 w-3.5" /> Edit
                          </button>
                          <button onClick={() => onSelect(asset)} className="flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors" style={{ color: "var(--t-text-primary)" }}>
                            <Eye className="h-3.5 w-3.5" /> View Details
                          </button>
                          {asset.status !== "available" && (
                            <button onClick={() => onQuickStatus(asset.id, "available")} className="flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors" style={{ color: "var(--t-accent-text)" }}>
                              <CheckCircle2 className="h-3.5 w-3.5" /> Mark Available
                            </button>
                          )}
                          {asset.status !== "on_site" && (
                            <button onClick={() => onQuickStatus(asset.id, "on_site")} className="flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors" style={{ color: "var(--t-warning)" }}>
                              <Truck className="h-3.5 w-3.5" /> Mark Deployed
                            </button>
                          )}
                          {asset.status !== "maintenance" && (
                            <button onClick={() => onQuickStatus(asset.id, "maintenance")} className="flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors" style={{ color: "var(--t-error)" }}>
                              <Wrench className="h-3.5 w-3.5" /> Schedule Maintenance
                            </button>
                          )}
                          <button onClick={() => onRetire(asset)} className="flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors" style={{ color: "var(--t-text-muted)" }}>
                            <Shield className="h-3.5 w-3.5" /> {getFeatureLabel("asset_retire_action")}
                          </button>
                          {(asset.status === "available" || asset.status === "maintenance") && (
                            <button onClick={() => onDelete(asset)} className="flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors" style={{ color: "var(--t-error)" }}>
                              <Trash2 className="h-3.5 w-3.5" /> {getFeatureLabel("asset_delete_action")}
                            </button>
                          )}
                        </>
                      )}
                    </Dropdown>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Grid View ─── */

function GridView({ assets, onSelect, onQuickStatus }: { assets: Asset[]; onSelect: (a: Asset) => void; onQuickStatus: (id: string, status: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {assets.map((asset) => {
        const deployed = getDeployedInfo(asset);

        return (
          <button
            key={asset.id}
            onClick={() => onSelect(asset)}
            className="group relative text-left"
            style={{
              borderRadius: 14, border: "1px solid var(--t-border)",
              background: "var(--t-bg-card)", padding: "18px 16px",
              transition: "all 0.15s ease", cursor: "pointer",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "var(--t-bg-card-hover)";
              e.currentTarget.style.borderColor = "var(--t-text-muted)";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "var(--t-bg-card)";
              e.currentTarget.style.borderColor = "var(--t-border)";
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <p style={{ fontSize: 15, fontWeight: 700, color: "var(--t-text-primary)" }}>{asset.identifier}</p>
            </div>

            <span className={statusTextClass(asset.status)} style={{ fontSize: 11, fontWeight: 600 }}>
              {STATUS_LABELS[asset.status] || asset.status.replace(/_/g, " ")}
            </span>

            <div className="truncate mt-2" style={{ fontSize: 12, color: "var(--t-text-muted)" }}>
              {deployed ? (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3 shrink-0" />
                  {deployed.customerName || deployed.address || "Customer site"}
                </span>
              ) : (
                <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> Yard</span>
              )}
            </div>

            {deployed && (
              <p style={{ fontSize: 10, fontWeight: 500, color: deployed.isOverdue ? "var(--t-error)" : "var(--t-text-muted)", marginTop: 4 }}>
                {deployed.daysDeployed}d out {deployed.isOverdue && "\u00b7 OVERDUE"}
              </p>
            )}

            <div className="mt-2 flex gap-1" onClick={(e) => e.stopPropagation()}>
              {asset.status !== "available" && (
                <button
                  onClick={() => onQuickStatus(asset.id, "available")}
                  style={{ borderRadius: 4, padding: "2px 6px", fontSize: 9, fontWeight: 500, color: "var(--t-accent-text)", transition: "opacity 0.15s ease" }}
                >
                  Avail
                </button>
              )}
              {asset.status !== "maintenance" && (
                <button
                  onClick={() => onQuickStatus(asset.id, "maintenance")}
                  style={{ borderRadius: 4, padding: "2px 6px", fontSize: 9, fontWeight: 500, color: "var(--t-error)", transition: "opacity 0.15s ease" }}
                >
                  Maint
                </button>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ─── Asset Detail Panel ─── */

function AssetDetail({ asset, onStatusChange, onUpdated }: { asset: Asset; onStatusChange: (status: string) => void; onUpdated: () => void }) {
  const [activeTab, setActiveTab] = useState<"overview" | "history" | "maintenance">("overview");
  const deployed = getDeployedInfo(asset);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span style={{ fontSize: 12, color: "var(--t-text-muted)", textTransform: "capitalize" }}>
            {asset.asset_type} &middot; {asset.subtype}
          </span>
          <span className={statusTextClass(asset.status)} style={{ fontSize: 11, fontWeight: 600 }}>
            {STATUS_LABELS[asset.status] || asset.status.replace(/_/g, " ")}
          </span>
        </div>

        <div className="flex gap-2 flex-wrap">
          {(["available", "on_site", "maintenance"] as const).map((s) =>
            asset.status !== s ? (
              <button
                key={s}
                onClick={() => onStatusChange(s)}
                style={{
                  padding: "6px 14px", borderRadius: 24, fontSize: 12, fontWeight: 500,
                  border: "1px solid var(--t-border)", background: "transparent",
                  color: s === "available" ? "var(--t-accent-text)" : s === "on_site" ? "var(--t-warning)" : "var(--t-error)",
                  transition: "all 0.15s ease", cursor: "pointer",
                }}
              >
                {s === "available" ? "Mark Available" : s === "on_site" ? "Mark Deployed" : "Maintenance"}
              </button>
            ) : null
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0" style={{ borderBottom: "1px solid var(--t-border)" }}>
        {(["overview", "history", "maintenance"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="relative px-4 py-2.5 text-sm font-medium capitalize transition-colors"
            style={{ color: activeTab === tab ? "var(--t-accent-text)" : "var(--t-text-muted)" }}
          >
            {tab}
            {activeTab === tab && (
              <span className="absolute inset-x-0 bottom-0 rounded-full" style={{ height: 2, background: "var(--t-accent)" }} />
            )}
          </button>
        ))}
      </div>

      {activeTab === "overview" && <OverviewTab asset={asset} deployed={deployed} />}
      {activeTab === "history" && <HistoryTab asset={asset} />}
      {activeTab === "maintenance" && <MaintenanceTab asset={asset} onUpdated={onUpdated} />}
    </div>
  );
}

/* ─── Overview Tab ─── */

function OverviewTab({ asset, deployed }: { asset: Asset; deployed: ReturnType<typeof getDeployedInfo> }) {
  return (
    <div className="space-y-6">
      {deployed && (
        <div style={{ borderRadius: 14, border: "1px solid var(--t-border)", background: "var(--t-bg-card)", padding: 16 }} className="space-y-3">
          <h4 style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Current Deployment</h4>
          <div className="grid grid-cols-2 gap-3">
            {deployed.customerName && (
              <div>
                <p style={{ fontSize: 12, color: "var(--t-text-muted)" }}>Customer</p>
                <p style={{ fontSize: 14, fontWeight: 500, color: "var(--t-accent-text)" }}>{deployed.customerName}</p>
              </div>
            )}
            <div>
              <p style={{ fontSize: 12, color: "var(--t-text-muted)" }}>Delivery Date</p>
              <p style={{ fontSize: 14, fontWeight: 500, color: "var(--t-text-primary)" }}>{fmtDate(deployed.deliveryDate)}</p>
            </div>
            {deployed.rentalEnd && (
              <div>
                <p style={{ fontSize: 12, color: "var(--t-text-muted)" }}>Rental End</p>
                <p style={{ fontSize: 14, fontWeight: 500, color: deployed.isOverdue ? "var(--t-error)" : "var(--t-text-primary)" }}>{fmtDate(deployed.rentalEnd)}</p>
              </div>
            )}
            <div>
              <p style={{ fontSize: 12, color: "var(--t-text-muted)" }}>Days Deployed</p>
              <p style={{ fontSize: 14, fontWeight: 500, color: deployed.isOverdue ? "var(--t-error)" : "var(--t-text-primary)" }}>
                {deployed.daysDeployed} days {deployed.isOverdue && "(OVERDUE)"}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h4 style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Specifications</h4>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p style={{ fontSize: 12, color: "var(--t-text-muted)" }}>Location</p>
            <p style={{ fontSize: 14, fontWeight: 500, color: "var(--t-text-primary)" }}>
              {asset.current_location?.address || (asset.current_location_type === "yard" || !asset.current_location_type ? "Yard" : asset.current_location_type.replace(/_/g, " "))}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h4 style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Photos</h4>
        <div className="flex flex-col items-center justify-center text-center" style={{ borderRadius: 14, border: "1px dashed var(--t-border)", padding: 32 }}>
          <Box className="h-8 w-8 mb-2" style={{ color: "var(--t-text-muted)", opacity: 0.3 }} />
          <p style={{ fontSize: 12, color: "var(--t-text-muted)" }}>Photo uploads coming soon</p>
        </div>
      </div>

      {asset.notes && (
        <div className="space-y-2">
          <h4 style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Notes</h4>
          <p style={{ fontSize: 14, color: "var(--t-text-primary)", borderRadius: 14, border: "1px solid var(--t-border)", background: "var(--t-bg-card)", padding: 16 }}>{asset.notes}</p>
        </div>
      )}
    </div>
  );
}

/* ─── History Tab ─── */

function HistoryTab({ asset }: { asset: Asset }) {
  const meta = (asset.metadata || {}) as Record<string, any>;
  const history = (meta.job_history || []) as any[];
  const lifetimeRevenue = meta.lifetime_revenue || 0;
  const totalDaysDeployed = meta.total_days_deployed || 0;
  const totalDaysAvailable = meta.total_days_available || 0;
  const utilization = totalDaysDeployed + totalDaysAvailable > 0
    ? Math.round((totalDaysDeployed / (totalDaysDeployed + totalDaysAvailable)) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "LIFETIME REVENUE", value: lifetimeRevenue > 0 ? `$${Number(lifetimeRevenue).toLocaleString()}` : "\u2014", color: "var(--t-accent-text)" },
          { label: "DAYS DEPLOYED", value: totalDaysDeployed || "\u2014", color: "var(--t-text-primary)" },
          { label: "UTILIZATION", value: utilization > 0 ? `${utilization}%` : "\u2014", color: "var(--t-text-primary)" },
        ].map((stat) => (
          <div key={stat.label} style={{ borderRadius: 14, border: "1px solid var(--t-border)", background: "var(--t-bg-card)", padding: 12, textAlign: "center" }}>
            <p style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--t-text-muted)", letterSpacing: "0.05em" }}>{stat.label}</p>
            <p style={{ fontSize: 18, fontWeight: 700, color: stat.color }} className="tabular-nums">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <h4 style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Job History</h4>
        {history.length === 0 ? (
          <div className="text-center" style={{ borderRadius: 14, border: "1px solid var(--t-border)", background: "var(--t-bg-card)", padding: 32 }}>
            <ClipboardList className="h-8 w-8 mx-auto mb-2" style={{ color: "var(--t-text-muted)", opacity: 0.3 }} />
            <p style={{ fontSize: 12, color: "var(--t-text-muted)" }}>No job history recorded yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((job: any, i: number) => (
              <div key={i} className="flex items-center gap-3" style={{ borderRadius: 14, border: "1px solid var(--t-border)", background: "var(--t-bg-card)", padding: 12 }}>
                <div className="flex h-8 w-8 items-center justify-center" style={{ borderRadius: 8, background: "var(--t-bg-card-hover)" }}>
                  <Truck className="h-4 w-4" style={{ color: "var(--t-text-muted)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate" style={{ fontSize: 14, fontWeight: 500, color: "var(--t-text-primary)" }}>{job.customer_name || "Customer"}</p>
                  <p style={{ fontSize: 12, color: "var(--t-text-muted)" }}>{fmtDate(job.date)} &middot; {job.duration || 0} days</p>
                </div>
                {job.revenue > 0 && <span style={{ fontSize: 14, fontWeight: 500, color: "var(--t-accent-text)" }}>${Number(job.revenue).toLocaleString()}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Maintenance Tab ─── */

function MaintenanceTab({ asset, onUpdated }: { asset: Asset; onUpdated: () => void }) {
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newRecord, setNewRecord] = useState({ type: "inspection", description: "", cost: "" });
  const { toast } = useToast();
  const meta = (asset.metadata || {}) as Record<string, any>;
  const totalMaintenanceCost = meta.total_maintenance_cost || 0;

  useEffect(() => {
    setRecords((meta.maintenance_log || []) as MaintenanceRecord[]);
  }, [asset.id]);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updatedLog = [
        ...records,
        { id: crypto.randomUUID(), date: new Date().toISOString(), type: newRecord.type, description: newRecord.description, cost: Number(newRecord.cost) || 0 },
      ];
      const newTotalCost = updatedLog.reduce((sum, r) => sum + (r.cost || 0), 0);
      await api.patch(`/assets/${asset.id}`, {
        metadata: { ...asset.metadata, maintenance_log: updatedLog, total_maintenance_cost: newTotalCost },
      });
      setRecords(updatedLog as MaintenanceRecord[]);
      setNewRecord({ type: "inspection", description: "", cost: "" });
      setAddOpen(false);
      toast("success", "Maintenance record added");
    } catch {
      toast("error", "Failed to add record");
    } finally {
      setSaving(false);
    }
  };

  const inp: React.CSSProperties = {
    width: "100%", borderRadius: 14, border: "1px solid var(--t-border)",
    background: "var(--t-bg-card)", padding: "10px 16px",
    fontSize: 14, color: "var(--t-text-primary)", outline: "none",
  };
  const lbl: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 500, color: "var(--t-text-muted)", marginBottom: 6 };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between" style={{ borderRadius: 14, border: "1px solid var(--t-border)", background: "var(--t-bg-card)", padding: 16 }}>
        <div>
          <p style={{ fontSize: 12, color: "var(--t-text-muted)" }}>Total Maintenance Cost</p>
          <p style={{ fontSize: 18, fontWeight: 700, color: "var(--t-text-primary)" }}>{totalMaintenanceCost > 0 ? `$${Number(totalMaintenanceCost).toLocaleString()}` : "$0"}</p>
        </div>
        <button
          onClick={() => setAddOpen(!addOpen)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 14px", borderRadius: 24, fontSize: 12, fontWeight: 500,
            background: "var(--t-accent-soft)", color: "var(--t-accent-text)",
            border: "none", cursor: "pointer", transition: "opacity 0.15s ease",
          }}
        >
          <Plus className="h-3.5 w-3.5" /> Add Record
        </button>
      </div>

      {addOpen && (
        <form onSubmit={handleAdd} className="space-y-3" style={{ borderRadius: 14, border: "1px solid var(--t-accent)", background: "var(--t-accent-soft)", padding: 16 }}>
          <div>
            <label style={lbl}>Type</label>
            <select value={newRecord.type} onChange={(e) => setNewRecord({ ...newRecord, type: e.target.value })} style={{ ...inp, appearance: "none" as const }}>
              <option value="inspection">Inspection</option>
              <option value="repair">Repair</option>
              <option value="cleaning">Cleaning</option>
              <option value="painting">Painting</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Description</label>
            <input value={newRecord.description} onChange={(e) => setNewRecord({ ...newRecord, description: e.target.value })} style={inp} placeholder="What was done..." required />
          </div>
          <div>
            <label style={lbl}>Cost ($)</label>
            <input type="number" step="0.01" value={newRecord.cost} onChange={(e) => setNewRecord({ ...newRecord, cost: e.target.value })} style={inp} placeholder="0.00" />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              style={{
                background: "var(--t-accent)", color: "var(--t-accent-on-accent)", fontWeight: 600, fontSize: 14,
                padding: "8px 20px", borderRadius: 24, border: "none",
                transition: "opacity 0.15s ease", cursor: "pointer", opacity: saving ? 0.5 : 1,
              }}
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              style={{
                padding: "8px 20px", borderRadius: 24, fontSize: 14,
                border: "1px solid var(--t-border)", background: "transparent",
                color: "var(--t-text-muted)", cursor: "pointer", transition: "all 0.15s ease",
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {records.length === 0 ? (
        <div className="text-center" style={{ borderRadius: 14, border: "1px solid var(--t-border)", background: "var(--t-bg-card)", padding: 32 }}>
          <Shield className="h-8 w-8 mx-auto mb-2" style={{ color: "var(--t-text-muted)", opacity: 0.3 }} />
          <p style={{ fontSize: 12, color: "var(--t-text-muted)" }}>No maintenance records yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {records.map((record, i) => (
            <div key={record.id || i} className="flex items-center gap-3" style={{ borderRadius: 14, border: "1px solid var(--t-border)", background: "var(--t-bg-card)", padding: 12 }}>
              <div className="flex h-8 w-8 items-center justify-center" style={{ borderRadius: 8, background: "var(--t-bg-card-hover)" }}>
                <Wrench className="h-4 w-4" style={{ color: "var(--t-text-muted)" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="capitalize" style={{ fontSize: 14, fontWeight: 500, color: "var(--t-text-primary)" }}>{record.type}</p>
                <p className="truncate" style={{ fontSize: 12, color: "var(--t-text-muted)" }}>{record.description} &middot; {fmtDate(record.date)}</p>
              </div>
              {record.cost > 0 && <span style={{ fontSize: 14, fontWeight: 500, color: "var(--t-error)" }}>-${Number(record.cost).toLocaleString()}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


/* ─── Bulk Edit Modal ─── */

function BulkEditModal({ count, onClose, onSaved }: { count: number; onClose: () => void; onSaved: (updates: Record<string, unknown>) => void }) {
  const [status, setStatus] = useState("");
  const [notes, setNotes] = useState("");

  const handleSave = () => {
    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;
    if (notes) updates.notes = notes;
    if (Object.keys(updates).length === 0) { onClose(); return; }
    onSaved(updates);
  };

  const inp: React.CSSProperties = {
    width: "100%", borderRadius: 14, border: "1px solid var(--t-border)",
    background: "var(--t-bg-card)", padding: "10px 16px",
    fontSize: 14, color: "var(--t-text-primary)", outline: "none",
  };
  const lbl: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 500, color: "var(--t-text-muted)", marginBottom: 6 };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm animate-fade-in" style={{ borderRadius: 14, border: "1px solid var(--t-border)", background: "var(--t-bg-primary)", padding: 24, boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)" }}>
        <h3 style={{ fontSize: 18, fontWeight: 600, color: "var(--t-text-primary)" }} className="mb-1">Bulk Edit</h3>
        <p style={{ fontSize: 14, color: "var(--t-text-muted)" }} className="mb-4">Update {count} selected asset(s). Only filled fields will be changed.</p>
        <div className="space-y-3">
          <div>
            <label style={lbl}>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...inp, appearance: "none" as const }}>
              <option value="">— No change —</option>
              <option value="available">Available</option>
              <option value="maintenance">Maintenance</option>
              {/* `retired` intentionally removed — use the Retire action (reason + actor captured). */}
            </select>
          </div>
          <div>
            <label style={lbl}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inp, resize: "none" as const }} placeholder="Leave blank to keep existing notes" />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={handleSave} style={{ flex: 1, background: "var(--t-accent)", color: "var(--t-accent-on-accent)", fontWeight: 600, fontSize: 14, padding: "10px 20px", borderRadius: 24, border: "none", cursor: "pointer" }}>
            Update {count} Asset(s)
          </button>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 24, fontSize: 14, border: "1px solid var(--t-border)", background: "transparent", color: "var(--t-text-muted)", cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Edit Asset Modal ─── */

function EditAssetModal({ asset, onClose, onSaved }: { asset: Asset; onClose: () => void; onSaved: () => void }) {
  const [identifier, setIdentifier] = useState(asset.identifier);
  const [subtype, setSubtype] = useState(asset.subtype);
  const [status, setStatus] = useState(asset.status);
  const [notes, setNotes] = useState(asset.notes || "");
  const [saving, setSaving] = useState(false);
  const [showWarn, setShowWarn] = useState(false);
  const [duplicateError, setDuplicateError] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setShowWarn(false);
    setDuplicateError(false);
  }, [identifier]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setDuplicateError(false);

    // Only gate on the warning when the user actually changed the
    // identifier to something non-standard. If they left it alone
    // (e.g. a legacy non-standard id), don't nag them.
    const changed = identifier !== asset.identifier;
    if (changed && !STANDARD_ASSET_NUMBER.test(identifier) && !showWarn) {
      setShowWarn(true);
      return;
    }

    setSaving(true);
    try {
      await api.patch(`/assets/${asset.id}`, {
        identifier, subtype, status,
        notes: notes || undefined,
      });
      onSaved();
    } catch (err) {
      const e = err as { status?: number; body?: { error?: string } } | null;
      if (e?.status === 409 && e?.body?.error === "duplicate_asset_number") {
        setDuplicateError(true);
      } else {
        toast("error", getFeatureLabel("asset_edit_generic_error"));
      }
      setSaving(false);
    }
  };

  const inp: React.CSSProperties = {
    width: "100%", borderRadius: 14, border: "1px solid var(--t-border)",
    background: "var(--t-bg-card)", padding: "10px 16px",
    fontSize: 14, color: "var(--t-text-primary)", outline: "none",
  };
  const lbl: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 500, color: "var(--t-text-muted)", marginBottom: 6 };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md animate-fade-in" style={{ borderRadius: 14, border: "1px solid var(--t-border)", background: "var(--t-bg-primary)", padding: 24, boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)" }}>
        <h3 style={{ fontSize: 18, fontWeight: 600, color: "var(--t-text-primary)" }} className="mb-1">Edit Asset</h3>
        <p style={{ fontSize: 14, color: "var(--t-text-muted)" }} className="mb-4">{asset.identifier}</p>
        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label style={lbl}>Identifier</label>
            <input value={identifier} onChange={e => setIdentifier(e.target.value)} style={inp} required />
            {duplicateError && (
              <p style={{ marginTop: 6, fontSize: 12, color: "var(--t-error)" }}>
                {getFeatureLabel("asset_number_duplicate_error")}
              </p>
            )}
          </div>
          {showWarn && (
            <div style={{ borderRadius: 14, background: "var(--t-warning-soft, rgba(234,179,8,0.15))", border: "1px solid var(--t-warning)", padding: "12px 16px" }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: "var(--t-warning)" }}>
                {getFeatureLabel("asset_number_warn_title")}
              </p>
              <p style={{ marginTop: 4, fontSize: 13, color: "var(--t-text-primary)" }}>
                {getFeatureLabel("asset_number_warn_body")}
              </p>
              <button
                type="button"
                onClick={() => setShowWarn(false)}
                style={{ marginTop: 8, padding: "6px 14px", borderRadius: 20, fontSize: 13, border: "1px solid var(--t-border)", background: "transparent", color: "var(--t-text-muted)", cursor: "pointer" }}
              >
                {getFeatureLabel("asset_number_warn_cancel")}
              </button>
            </div>
          )}
          <div>
            <label style={lbl}>Size / Subtype</label>
            <select value={subtype} onChange={e => setSubtype(e.target.value)} style={{ ...inp, appearance: "none" as const }}>
              {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...inp, appearance: "none" as const }}>
              <option value="available">Available</option>
              <option value="maintenance">Maintenance</option>
              {/* `retired` intentionally removed — use the Retire action (reason + actor captured). */}
            </select>
          </div>
          <div>
            <label style={lbl}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inp, resize: "none" as const }} placeholder="Any notes..." />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving || !identifier} style={{ flex: 1, background: "var(--t-accent)", color: "var(--t-accent-on-accent)", fontWeight: 600, fontSize: 14, padding: "10px 20px", borderRadius: 24, border: "none", cursor: "pointer", transition: "opacity 0.15s ease", opacity: saving || !identifier ? 0.5 : 1 }}>
              {saving ? "Saving..." : showWarn ? getFeatureLabel("asset_number_warn_confirm") : "Save Changes"}
            </button>
            <button type="button" onClick={onClose} style={{ padding: "10px 20px", borderRadius: 24, fontSize: 14, border: "1px solid var(--t-border)", background: "transparent", color: "var(--t-text-muted)", cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Retire Asset Modal ─── */

// Item 4 — Retire flow. Required reason + optional notes. On 409 from
// the backend (already_retired / asset_in_use), surface the structured
// error via inline banner — the backend-only path (/assets/:id/retire)
// enforces the "in active use" gate using live joins against jobs and
// rental_chains, so any block here reflects a real conflict, not a
// client-side heuristic.
function RetireAssetModal({ asset, onClose, onDone }: { asset: Asset; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { toast } = useToast();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!reason) return;
    setSaving(true);
    try {
      await api.post(`/assets/${asset.id}/retire`, { reason, notes: notes || undefined });
      toast("success", getFeatureLabel("asset_retire_success"));
      onDone();
    } catch (err) {
      const e = err as { status?: number; body?: { error?: string } } | null;
      if (e?.status === 409 && e.body?.error === "asset_in_use") {
        setErrorMsg(getFeatureLabel("asset_retire_error_in_use"));
      } else if (e?.status === 409 && e.body?.error === "already_retired") {
        setErrorMsg(getFeatureLabel("asset_retire_error_already_retired"));
      } else {
        toast("error", getFeatureLabel("asset_retire_generic_error"));
      }
      setSaving(false);
    }
  };

  const inp: React.CSSProperties = {
    width: "100%", borderRadius: 14, border: "1px solid var(--t-border)",
    background: "var(--t-bg-card)", padding: "10px 16px",
    fontSize: 14, color: "var(--t-text-primary)", outline: "none",
  };
  const lbl: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 500, color: "var(--t-text-muted)", marginBottom: 6 };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md animate-fade-in" style={{ borderRadius: 14, border: "1px solid var(--t-border)", background: "var(--t-bg-primary)", padding: 24, boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)" }}>
        <h3 style={{ fontSize: 18, fontWeight: 600, color: "var(--t-text-primary)" }} className="mb-1">
          {getFeatureLabel("asset_retire_title")}
        </h3>
        <p style={{ fontSize: 14, color: "var(--t-text-muted)" }} className="mb-1">{asset.identifier}</p>
        <p style={{ fontSize: 13, color: "var(--t-text-muted)" }} className="mb-4">
          {getFeatureLabel("asset_retire_body")}
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label style={lbl}>{getFeatureLabel("asset_retire_reason_label")}</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)} required style={{ ...inp, appearance: "none" as const }}>
              <option value="">—</option>
              <option value="sold">{getFeatureLabel("asset_retire_reason_sold")}</option>
              <option value="damaged">{getFeatureLabel("asset_retire_reason_damaged")}</option>
              <option value="scrapped">{getFeatureLabel("asset_retire_reason_scrapped")}</option>
              <option value="other">{getFeatureLabel("asset_retire_reason_other")}</option>
            </select>
          </div>
          <div>
            <label style={lbl}>{getFeatureLabel("asset_retire_notes_label")}</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ ...inp, resize: "none" as const }} placeholder={getFeatureLabel("asset_retire_notes_placeholder")} />
          </div>
          {errorMsg && (
            <div style={{ borderRadius: 14, background: "var(--t-error-soft)", border: "1px solid var(--t-error)", padding: "10px 14px", fontSize: 13, color: "var(--t-error)" }}>
              {errorMsg}
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving || !reason} style={{ flex: 1, background: "var(--t-accent)", color: "var(--t-accent-on-accent)", fontWeight: 600, fontSize: 14, padding: "10px 20px", borderRadius: 24, border: "none", cursor: "pointer", transition: "opacity 0.15s ease", opacity: saving || !reason ? 0.5 : 1 }}>
              {saving ? "…" : getFeatureLabel("asset_retire_confirm")}
            </button>
            <button type="button" onClick={onClose} style={{ padding: "10px 20px", borderRadius: 24, fontSize: 14, border: "1px solid var(--t-border)", background: "transparent", color: "var(--t-text-muted)", cursor: "pointer" }}>
              {getFeatureLabel("asset_retire_cancel")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Delete Asset Modal (destructive) ─── */

// Item 4 — Hard delete. Destructive-styled confirmation. Backend enforces
// "zero references" across 4 columns (jobs.asset_id, drop_off_asset_id,
// pick_up_asset_id, rental_chains.asset_id). Defensive 409 handling lives
// below — race condition between the list-fetch and this DELETE is the
// realistic failure mode.
function DeleteAssetModal({ asset, onClose, onDone }: { asset: Asset; onClose: () => void; onDone: () => void }) {
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { toast } = useToast();

  const handleConfirm = async () => {
    setErrorMsg(null);
    setSaving(true);
    try {
      await api.delete(`/assets/${asset.id}`);
      toast("success", getFeatureLabel("asset_delete_success"));
      onDone();
    } catch (err) {
      const e = err as { status?: number; body?: { error?: string } } | null;
      if (e?.status === 409 && e.body?.error === "asset_has_references") {
        setErrorMsg(getFeatureLabel("asset_delete_error_has_references"));
      } else {
        toast("error", getFeatureLabel("asset_delete_generic_error"));
      }
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md animate-fade-in" style={{ borderRadius: 14, border: "1px solid var(--t-error)", background: "var(--t-bg-primary)", padding: 24, boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)" }}>
        <h3 style={{ fontSize: 18, fontWeight: 600, color: "var(--t-error)" }} className="mb-1">
          {getFeatureLabel("asset_delete_title")}
        </h3>
        <p style={{ fontSize: 14, color: "var(--t-text-muted)" }} className="mb-1">{asset.identifier}</p>
        <p style={{ fontSize: 13, color: "var(--t-text-primary)" }} className="mb-4">
          {getFeatureLabel("asset_delete_body")}
        </p>
        {errorMsg && (
          <div style={{ borderRadius: 14, background: "var(--t-error-soft)", border: "1px solid var(--t-error)", padding: "10px 14px", fontSize: 13, color: "var(--t-error)", marginBottom: 12 }}>
            {errorMsg}
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={handleConfirm} disabled={saving} style={{ flex: 1, background: "var(--t-error)", color: "white", fontWeight: 600, fontSize: 14, padding: "10px 20px", borderRadius: 24, border: "none", cursor: "pointer", transition: "opacity 0.15s ease", opacity: saving ? 0.5 : 1 }}>
            {saving ? "…" : getFeatureLabel("asset_delete_confirm")}
          </button>
          <button type="button" onClick={onClose} style={{ padding: "10px 20px", borderRadius: 24, fontSize: 14, border: "1px solid var(--t-border)", background: "transparent", color: "var(--t-text-muted)", cursor: "pointer" }}>
            {getFeatureLabel("asset_delete_cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Create Asset Form ─── */

function CreateAssetForm({ prefilledSize, onSuccess }: { prefilledSize: string | null; onSuccess: () => void }) {
  const [assetType, setAssetType] = useState("dumpster");
  const [subtype, setSubtype] = useState(prefilledSize || "20yd");
  const [identifier, setIdentifier] = useState("");
  const [notes, setNotes] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Soft-warning state — user typed a non-standard identifier and hit
  // submit; next submit proceeds through the warning. Reset when the
  // identifier changes so the user can fix-and-retry without carrying
  // stale acknowledgement.
  const [showWarn, setShowWarn] = useState(false);
  const [duplicateError, setDuplicateError] = useState(false);
  // userTouched — once the user types in the identifier field, we stop
  // overwriting it on subtype/assetType change. Dirty-flag guard lets
  // the auto-suggest populate the initial value but preserves user
  // edits on subsequent subtype switches.
  const userTouched = useRef(false);
  const { toast } = useToast();

  useEffect(() => {
    setShowWarn(false);
    setDuplicateError(false);
  }, [identifier]);

  useEffect(() => {
    if (!prefilledSize) {
      const subtypes = SUBTYPES_BY_TYPE[assetType];
      if (subtypes?.length) setSubtype(subtypes[0].value);
    }
  }, [assetType, prefilledSize]);

  // Fetch the next standard-format suggestion from the backend whenever
  // assetType or subtype changes. AbortController cancels an in-flight
  // fetch if the selection changes mid-request. `userTouched` blocks
  // overwrite once the user has typed manually.
  useEffect(() => {
    if (userTouched.current) return;
    const ac = new AbortController();
    (async () => {
      try {
        const res = await api.get<{ suggested: string }>(
          `/assets/next-number?assetType=${encodeURIComponent(assetType)}&subtype=${encodeURIComponent(subtype)}`,
          { signal: ac.signal },
        );
        if (!userTouched.current) setIdentifier(res.suggested);
      } catch {
        // Silent — suggestion is advisory. User can still type manually.
      }
    })();
    return () => ac.abort();
  }, [assetType, subtype]);

  const postOne = async (id: string) => {
    await api.post("/assets", {
      assetType, subtype, identifier: id,
      notes: notes || undefined,
    });
  };

  // Fetch the next suggestion from the backend. Used for initial pre-fill
  // and — critically — for bulk-create 409 recovery. Returns null if the
  // endpoint is unavailable so the caller can fall back to local increment.
  const fetchSuggestion = async (): Promise<string | null> => {
    try {
      const res = await api.get<{ suggested: string }>(
        `/assets/next-number?assetType=${encodeURIComponent(assetType)}&subtype=${encodeURIComponent(subtype)}`,
      );
      return res.suggested;
    } catch {
      return null;
    }
  };

  const is409 = (err: unknown) => {
    const e = err as { status?: number; body?: { error?: string } } | null;
    return e?.status === 409 && e?.body?.error === "duplicate_asset_number";
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setDuplicateError(false);

    // Soft-warning gate — first submit with a non-standard identifier
    // flips on the banner; second submit proceeds. Uniqueness is still
    // enforced by the backend.
    if (!STANDARD_ASSET_NUMBER.test(identifier) && !showWarn) {
      setShowWarn(true);
      return;
    }

    setSaving(true);
    const qty = Math.max(1, Math.min(50, parseInt(quantity) || 1));

    try {
      const m = identifier.match(/^([A-Za-z0-9]+)-(\d{2,3})$/);
      const canBulk = qty > 1 && m !== null;

      if (!canBulk) {
        try {
          await postOne(identifier);
        } catch (err) {
          if (is409(err)) {
            setDuplicateError(true);
            setSaving(false);
            return;
          }
          throw err;
        }
        toast("success", "Asset created");
      } else {
        const prefix = m![1];
        let num = parseInt(m![2], 10);
        let width = m![2].length >= 3 ? 3 : 2;
        // Sequential post. On 201 we bump num and count the asset; on 409
        // we do NOT count the attempt (created stays put) and we RESET
        // num by refetching /assets/next-number so a concurrent burst of
        // bulk creates from another operator doesn't chew through a
        // string of dead numbers. Local increment is only the fallback
        // if the refetch itself fails. Upper-bound attempts ensures we
        // can't loop forever under a persistent failure mode.
        let created = 0;
        const maxAttempts = qty * 3;
        let attempts = 0;
        while (created < qty && attempts < maxAttempts) {
          attempts++;
          if (num >= 100 && width < 3) width = 3;
          const id = `${prefix}-${String(num).padStart(width, "0")}`;
          try {
            await postOne(id);
            created++;
            num++;
          } catch (err) {
            if (is409(err)) {
              const suggested = await fetchSuggestion();
              const nm = suggested?.match(/^([A-Za-z0-9]+)-(\d{2,3})$/);
              if (nm) {
                num = parseInt(nm[2], 10);
                if (nm[2].length >= 3) width = 3;
              } else {
                num++;
              }
              continue;
            }
            throw err;
          }
        }
        if (created < qty) {
          toast("warning", `${created} of ${qty} assets created (duplicates skipped)`);
        } else {
          toast("success", `${qty} assets created`);
        }
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  const inp: React.CSSProperties = {
    width: "100%", borderRadius: 14, border: "1px solid var(--t-border)",
    background: "var(--t-bg-card)", padding: "10px 16px",
    fontSize: 14, color: "var(--t-text-primary)", outline: "none",
  };
  const lbl: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 500, color: "var(--t-text-muted)", marginBottom: 6 };
  const qty = parseInt(quantity) || 1;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div style={{ borderRadius: 14, background: "var(--t-error-soft)", padding: "12px 16px", fontSize: 14, color: "var(--t-error)" }}>{error}</div>
      )}

      <div>
        <label style={lbl}>Asset Type</label>
        <select value={assetType} onChange={(e) => setAssetType(e.target.value)} style={{ ...inp, appearance: "none" as const }}>
          <option value="dumpster">Dumpster</option>
          <option value="storage_container">Storage Container</option>
          <option value="portable_restroom">Portable Restroom</option>
        </select>
      </div>

      <div>
        <label style={lbl}>Size / Subtype</label>
        <select value={subtype} onChange={(e) => setSubtype(e.target.value)} style={{ ...inp, appearance: "none" as const }}>
          {(SUBTYPES_BY_TYPE[assetType] || []).map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label style={lbl}>Identifier</label>
        <input
          value={identifier}
          onChange={(e) => { userTouched.current = true; setIdentifier(e.target.value); }}
          required
          style={inp}
          placeholder="10-07"
        />
        {duplicateError && (
          <p style={{ marginTop: 6, fontSize: 12, color: "var(--t-error)" }}>
            {getFeatureLabel("asset_number_duplicate_error")}
          </p>
        )}
        {qty > 1 && (() => {
          const m = identifier.match(/^([A-Za-z0-9]+)-(\d{2,3})$/);
          if (!m) {
            return (
              <p style={{ marginTop: 6, fontSize: 12, color: "var(--t-text-muted)" }}>
                Non-standard identifier — only 1 will be created regardless of quantity.
              </p>
            );
          }
          const prefix = m[1];
          const startNum = parseInt(m[2], 10);
          const width = m[2].length >= 3 ? 3 : 2;
          const last = startNum + qty - 1;
          const w = last >= 100 && width < 3 ? 3 : width;
          return (
            <p style={{ marginTop: 6, fontSize: 12, color: "var(--t-text-muted)" }}>
              Will create: {identifier} through {`${prefix}-${String(last).padStart(w, "0")}`}
            </p>
          );
        })()}
      </div>

      {showWarn && (
        <div style={{ borderRadius: 14, background: "var(--t-warning-soft, rgba(234,179,8,0.15))", border: "1px solid var(--t-warning)", padding: "12px 16px" }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--t-warning)" }}>
            {getFeatureLabel("asset_number_warn_title")}
          </p>
          <p style={{ marginTop: 4, fontSize: 13, color: "var(--t-text-primary)" }}>
            {getFeatureLabel("asset_number_warn_body")}
          </p>
          <button
            type="button"
            onClick={() => setShowWarn(false)}
            style={{ marginTop: 8, padding: "6px 14px", borderRadius: 20, fontSize: 13, border: "1px solid var(--t-border)", background: "transparent", color: "var(--t-text-muted)", cursor: "pointer" }}
          >
            {getFeatureLabel("asset_number_warn_cancel")}
          </button>
        </div>
      )}

      <div>
        <label style={lbl}>Quantity</label>
        <input type="number" min="1" max="50" value={quantity} onChange={(e) => setQuantity(e.target.value)} style={inp} placeholder="1" />
      </div>

      <div>
        <label style={lbl}>Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ ...inp, resize: "none" as const }} placeholder="Any notes..." />
      </div>

      <button
        type="submit"
        disabled={saving}
        style={{
          width: "100%", background: "var(--t-accent)", color: "var(--t-accent-on-accent)", fontWeight: 600, fontSize: 14,
          padding: "10px 20px", borderRadius: 24, border: "none",
          cursor: "pointer", transition: "opacity 0.15s ease",
          opacity: saving ? 0.5 : 1,
        }}
      >
        {saving
          ? "Creating..."
          : showWarn
            ? getFeatureLabel("asset_number_warn_confirm")
            : qty > 1
              ? `Add ${qty} \u00d7 ${subtype} ${assetType === "dumpster" ? "dumpsters" : "assets"}`
              : "Add Asset"}
      </button>
    </form>
  );
}
