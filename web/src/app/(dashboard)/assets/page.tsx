"use client";

import { useState, useEffect, useCallback, useMemo, type FormEvent } from "react";
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
  current_job_id: string | null;
  daily_rate: number;
  weight_capacity: number;
  notes: string;
  metadata: Record<string, unknown>;
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

const STATUS_FILTERS = ["all", "available", "on_site", "reserved", "maintenance"] as const;
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

const TYPE_PREFIX: Record<string, string> = {
  dumpster: "D",
  storage_container: "SC",
  portable_restroom: "PR",
};

/* ─── Status color text (no badge backgrounds) ─── */

function statusColor(s: string): string {
  if (s === "available") return "color: #22C55E";
  if (s === "on_site" || s === "deployed") return "color: #FCD34D";
  if (s === "reserved") return "color: #FCD34D";
  if (s === "maintenance") return "color: #F87171";
  if (s === "in_transit") return "color: #A855F7";
  if (s === "retired") return "color: var(--t-text-muted)";
  return "color: var(--t-text-muted)";
}

function statusTextClass(s: string): string {
  if (s === "available") return "text-[#22C55E]";
  if (s === "on_site" || s === "deployed") return "text-[#FCD34D]";
  if (s === "reserved") return "text-[#FCD34D]";
  if (s === "maintenance") return "text-[#F87171]";
  if (s === "in_transit") return "text-[#A855F7]";
  return "text-[var(--t-text-muted)]";
}

function conditionTextClass(c: string): string {
  if (c === "new" || c === "good") return "text-[#22C55E]";
  if (c === "fair") return "text-[#FCD34D]";
  if (c === "poor") return "text-[#F87171]";
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
  const headers = ["Identifier", "Type", "Size", "Status", "Condition", "Daily Rate", "Weight Capacity", "Location", "Notes"];
  const rows = assets.map((a) => [
    a.identifier,
    a.asset_type,
    a.subtype,
    a.status,
    a.condition,
    a.daily_rate,
    a.weight_capacity,
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
  const { toast } = useToast();
  const router = useRouter();

  const fetchAssets = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (silent) setRefreshing(true);
    try {
      const res = await api.get<AssetsResponse>("/assets?limit=200");
      setAssets(res.data);
      setLastUpdated(new Date());
    } catch { /* silent */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchAssets(); }, [fetchAssets]);

  useEffect(() => {
    const interval = setInterval(() => fetchAssets(true), 30000);
    return () => clearInterval(interval);
  }, [fetchAssets]);

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

  const filteredAssets = useMemo(() => {
    let result = [...assets];
    if (selectedSize) result = result.filter((a) => a.subtype === selectedSize);
    if (statusFilter !== "all") {
      result = result.filter((a) => {
        if (statusFilter === "on_site") return a.status === "on_site" || a.status === "deployed";
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
    result.sort((a, b) => a.identifier.localeCompare(b.identifier));
    return result;
  }, [assets, selectedSize, statusFilter, searchQuery]);

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
    const staged = assets.filter((a) => a.status === "reserved").length;
    const maintenanceCount = assets.filter((a) => a.status === "maintenance").length;
    return { available, deployed: deployed.length, staged, maintenanceCount };
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

  const deleteAsset = async (asset: Asset) => {
    if (!confirm(`Are you sure you want to delete asset ${asset.identifier}? This cannot be undone.`)) return;
    try {
      await api.delete(`/assets/${asset.id}`);
      toast("success", `${asset.identifier} deleted`);
      setDetailAsset(null);
      fetchAssets();
    } catch { toast("error", "Failed to delete asset"); }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredAssets.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredAssets.map(a => a.id)));
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

  const bulkMaintenance = async (size: string) => {
    const sizeAssets = assets.filter((a) => a.subtype === size && a.status !== "maintenance");
    if (sizeAssets.length === 0) return;
    try {
      await Promise.all(sizeAssets.map((a) => api.patch(`/assets/${a.id}`, { status: "maintenance" })));
      toast("success", `${sizeAssets.length} ${size} dumpsters marked as maintenance`);
      fetchAssets();
    } catch {
      toast("error", "Failed to update some assets");
    }
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
            background: "#22C55E", color: "#000", fontWeight: 600, fontSize: 14,
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
      {!loading && (
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: "AVAILABLE", value: quickStats.available, color: "#22C55E" },
            { label: "DEPLOYED", value: quickStats.deployed, color: "#FCD34D" },
            { label: "STAGED", value: quickStats.staged, color: "#FCD34D" },
            { label: "MAINTENANCE", value: quickStats.maintenanceCount, color: "#F87171" },
          ].map((kpi) => (
            <div
              key={kpi.label}
              style={{
                borderRadius: 14, border: "1px solid var(--t-border)",
                background: "var(--t-bg-card)", padding: "18px 16px",
                transition: "background 0.15s ease",
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = "var(--t-bg-card-hover)")}
              onMouseOut={(e) => (e.currentTarget.style.background = "var(--t-bg-card)")}
            >
              <p style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", color: "var(--t-text-muted)", letterSpacing: "0.05em" }}>
                {kpi.label}
              </p>
              <p style={{ fontSize: 24, fontWeight: 700, color: kpi.value > 0 ? kpi.color : "var(--t-text-primary)", marginTop: 4 }} className="tabular-nums">
                {kpi.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ─── Filter Tabs (Pills) ─── */}
      {!loading && (
        <div className="flex gap-2 mb-6 flex-wrap">
          {STATUS_FILTERS.map((s) => {
            const isActive = statusFilter === s;
            const count = s === "all"
              ? assets.length
              : s === "on_site"
                ? assets.filter((a) => a.status === "on_site" || a.status === "deployed").length
                : assets.filter((a) => a.status === s).length;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "6px 14px", borderRadius: 24, fontSize: 13, fontWeight: 500,
                  background: isActive ? "var(--t-accent-soft)" : "rgba(255,255,255,0.06)",
                  color: isActive ? "#22C55E" : "var(--t-frame-text-muted)",
                  border: isActive ? "1px solid transparent" : "1px solid rgba(255,255,255,0.08)",
                  transition: "all 0.15s ease", cursor: "pointer",
                }}
              >
                {STATUS_LABELS[s]}
                <span style={{ fontSize: 11, opacity: 0.7 }}>{count}</span>
              </button>
            );
          })}

          {/* Size filter pills when no tile selected */}
          {sizeGroups.length > 0 && (
            <>
              <span style={{ width: 1, background: "rgba(255,255,255,0.08)", margin: "0 4px", alignSelf: "stretch" }} />
              {sizeGroups.map((g) => {
                const isActive = selectedSize === g.size;
                return (
                  <button
                    key={g.size}
                    onClick={() => handleTileClick(g.size)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "6px 14px", borderRadius: 24, fontSize: 13, fontWeight: 500,
                      background: isActive ? "var(--t-accent-soft)" : "rgba(255,255,255,0.06)",
                      color: isActive ? "#22C55E" : "var(--t-frame-text-muted)",
                      border: isActive ? "1px solid transparent" : "1px solid rgba(255,255,255,0.08)",
                      transition: "all 0.15s ease", cursor: "pointer",
                    }}
                  >
                    {g.size}
                    <span style={{ fontSize: 11, opacity: 0.7 }}>{g.total}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}

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
                border: bulkMode ? "1px solid #22C55E" : "1px solid var(--t-border)",
                color: bulkMode ? "#22C55E" : "var(--t-text-muted)",
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
                border: "1px solid var(--t-border)", color: "#22C55E",
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
                color: viewMode === "list" ? "#22C55E" : "var(--t-text-muted)",
              }}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className="p-2 transition-colors"
              style={{
                background: viewMode === "grid" ? "var(--t-accent-soft)" : "transparent",
                color: viewMode === "grid" ? "#22C55E" : "var(--t-text-muted)",
              }}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
          {!selectedSize && (
            <>
              <button
                onClick={() => { setBulkMode(!bulkMode); setSelectedIds(new Set()); }}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "8px 14px", borderRadius: 24, fontSize: 12, fontWeight: 500,
                  border: bulkMode ? "1px solid #22C55E" : "1px solid var(--t-border)",
                  color: bulkMode ? "#22C55E" : "var(--t-text-muted)",
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
                background: "#22C55E", color: "#000", fontWeight: 600, fontSize: 14,
                padding: "10px 20px", borderRadius: 24, transition: "opacity 0.15s ease",
              }}
            >
              <Plus className="h-4 w-4" />
              Add Asset
            </button>
          )}
        </div>
      ) : viewMode === "list" ? (
        <ListView assets={filteredAssets} onSelect={setDetailAsset} onQuickStatus={quickStatus} onEdit={setEditAsset} onDelete={deleteAsset}
          bulkMode={bulkMode} selectedIds={selectedIds} onToggleSelect={toggleSelect} onToggleSelectAll={toggleSelectAll} />
      ) : (
        <GridView assets={filteredAssets} onSelect={setDetailAsset} onQuickStatus={quickStatus} />
      )}

      {/* Bulk Edit Floating Bar */}
      {bulkMode && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-5 py-3 shadow-2xl"
          style={{ borderRadius: 24, border: "1px solid var(--t-border)", background: "var(--t-bg-card)" }}>
          <span className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>{selectedIds.size} selected</span>
          <button onClick={() => setBulkEditOpen(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 24, fontSize: 13, fontWeight: 600, background: "#22C55E", color: "#000", border: "none", cursor: "pointer" }}>
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
    </div>
  );
}

/* ─── List View ─── */

function ListView({ assets, onSelect, onQuickStatus, onEdit, onDelete, bulkMode, selectedIds, onToggleSelect, onToggleSelectAll }: {
  assets: Asset[]; onSelect: (a: Asset) => void; onQuickStatus: (id: string, status: string) => void; onEdit: (a: Asset) => void; onDelete: (a: Asset) => void;
  bulkMode?: boolean; selectedIds?: Set<string>; onToggleSelect?: (id: string) => void; onToggleSelectAll?: () => void;
}) {
  return (
    <div style={{ borderRadius: 14, border: "1px solid var(--t-border)", background: "var(--t-bg-card)", overflow: "hidden" }}>
      <div className="table-scroll">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--t-border)" }}>
              {bulkMode && (
                <th style={{ padding: "12px 8px 12px 16px", width: 36 }}>
                  <input type="checkbox" checked={selectedIds?.size === assets.length && assets.length > 0} onChange={onToggleSelectAll}
                    className="h-4 w-4 rounded accent-[#22C55E]" />
                </th>
              )}
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Identifier</th>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Size</th>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Status</th>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Location</th>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Days Out</th>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--t-text-muted)" }}>Condition</th>
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
                  style={{ borderBottom: "1px solid var(--t-border)", transition: "background 0.15s ease" }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "var(--t-bg-card-hover)")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  {bulkMode && (
                    <td style={{ padding: "12px 8px 12px 16px", width: 36 }} onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selectedIds?.has(asset.id) || false} onChange={() => onToggleSelect?.(asset.id)}
                        className="h-4 w-4 rounded accent-[#22C55E]" />
                    </td>
                  )}
                  <td style={{ padding: "12px 16px", fontWeight: 600, color: "var(--t-text-primary)" }}>{asset.identifier}</td>
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
                  <td style={{ padding: "12px 16px" }}>
                    {asset.condition && (
                      <span className={conditionTextClass(asset.condition)} style={{ fontSize: 11, fontWeight: 600, textTransform: "capitalize" }}>
                        {asset.condition}
                      </span>
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
                      <button onClick={() => onEdit(asset)} className="flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors" style={{ color: "var(--t-text-primary)" }}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      <button onClick={() => onSelect(asset)} className="flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors" style={{ color: "var(--t-text-primary)" }}>
                        <Eye className="h-3.5 w-3.5" /> View Details
                      </button>
                      {asset.status !== "available" && (
                        <button onClick={() => onQuickStatus(asset.id, "available")} className="flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors" style={{ color: "#22C55E" }}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Mark Available
                        </button>
                      )}
                      {asset.status !== "on_site" && (
                        <button onClick={() => onQuickStatus(asset.id, "on_site")} className="flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors" style={{ color: "#FCD34D" }}>
                          <Truck className="h-3.5 w-3.5" /> Mark Deployed
                        </button>
                      )}
                      {asset.status !== "maintenance" && (
                        <button onClick={() => onQuickStatus(asset.id, "maintenance")} className="flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors" style={{ color: "#F87171" }}>
                          <Wrench className="h-3.5 w-3.5" /> Schedule Maintenance
                        </button>
                      )}
                      {(asset.status === "available" || asset.status === "maintenance") && (
                        <button onClick={() => onDelete(asset)} className="flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors" style={{ color: "var(--t-error)" }}>
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
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
                  style={{ borderRadius: 4, padding: "2px 6px", fontSize: 9, fontWeight: 500, color: "#22C55E", transition: "opacity 0.15s ease" }}
                >
                  Avail
                </button>
              )}
              {asset.status !== "maintenance" && (
                <button
                  onClick={() => onQuickStatus(asset.id, "maintenance")}
                  style={{ borderRadius: 4, padding: "2px 6px", fontSize: 9, fontWeight: 500, color: "#F87171", transition: "opacity 0.15s ease" }}
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
          {asset.condition && (
            <span className={conditionTextClass(asset.condition)} style={{ fontSize: 11, fontWeight: 600, textTransform: "capitalize" }}>
              {asset.condition}
            </span>
          )}
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
                  color: s === "available" ? "#22C55E" : s === "on_site" ? "#FCD34D" : "#F87171",
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
            style={{ color: activeTab === tab ? "#22C55E" : "var(--t-text-muted)" }}
          >
            {tab}
            {activeTab === tab && (
              <span className="absolute inset-x-0 bottom-0 rounded-full" style={{ height: 2, background: "#22C55E" }} />
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
                <p style={{ fontSize: 14, fontWeight: 500, color: "#22C55E" }}>{deployed.customerName}</p>
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
            <p style={{ fontSize: 12, color: "var(--t-text-muted)" }}>Daily Rate</p>
            <p style={{ fontSize: 14, fontWeight: 500, color: "var(--t-text-primary)" }}>{asset.daily_rate > 0 ? `${fmtMoney(asset.daily_rate)}/day` : "Not set"}</p>
          </div>
          <div>
            <p style={{ fontSize: 12, color: "var(--t-text-muted)" }}>Weight Capacity</p>
            <p style={{ fontSize: 14, fontWeight: 500, color: "var(--t-text-primary)" }}>{asset.weight_capacity ? `${Number(asset.weight_capacity).toLocaleString()} tons` : "Not set"}</p>
          </div>
          <div>
            <p style={{ fontSize: 12, color: "var(--t-text-muted)" }}>Condition</p>
            <p style={{ fontSize: 14, fontWeight: 500, color: "var(--t-text-primary)", textTransform: "capitalize" }}>{asset.condition || "\u2014"}</p>
          </div>
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
          { label: "LIFETIME REVENUE", value: lifetimeRevenue > 0 ? `$${Number(lifetimeRevenue).toLocaleString()}` : "\u2014", color: "#22C55E" },
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
                {job.revenue > 0 && <span style={{ fontSize: 14, fontWeight: 500, color: "#22C55E" }}>${Number(job.revenue).toLocaleString()}</span>}
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
            background: "var(--t-accent-soft)", color: "#22C55E",
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
                background: "#22C55E", color: "#000", fontWeight: 600, fontSize: 14,
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
  const [condition, setCondition] = useState("");
  const [notes, setNotes] = useState("");

  const handleSave = () => {
    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;
    if (condition) updates.condition = condition;
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
              <option value="retired">Retired</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Condition</label>
            <select value={condition} onChange={e => setCondition(e.target.value)} style={{ ...inp, appearance: "none" as const }}>
              <option value="">— No change —</option>
              <option value="good">Good</option>
              <option value="fair">Fair</option>
              <option value="poor">Poor</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inp, resize: "none" as const }} placeholder="Leave blank to keep existing notes" />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={handleSave} style={{ flex: 1, background: "#22C55E", color: "#000", fontWeight: 600, fontSize: 14, padding: "10px 20px", borderRadius: 24, border: "none", cursor: "pointer" }}>
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
  const [condition, setCondition] = useState(asset.condition || "good");
  const [weightCapacity, setWeightCapacity] = useState(asset.weight_capacity ? String(asset.weight_capacity) : "");
  const [notes, setNotes] = useState(asset.notes || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/assets/${asset.id}`, {
        identifier, subtype, status, condition,
        weightCapacity: weightCapacity ? Number(weightCapacity) : undefined,
        notes: notes || undefined,
      });
      onSaved();
    } catch { setSaving(false); }
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
          </div>
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
              <option value="retired">Retired</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Condition</label>
            <select value={condition} onChange={e => setCondition(e.target.value)} style={{ ...inp, appearance: "none" as const }}>
              <option value="good">Good</option>
              <option value="fair">Fair</option>
              <option value="poor">Poor</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Weight Capacity (tons)</label>
            <input type="number" step="0.01" value={weightCapacity} onChange={e => setWeightCapacity(e.target.value)} style={inp} placeholder="4" />
          </div>
          <div>
            <label style={lbl}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...inp, resize: "none" as const }} placeholder="Any notes..." />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={saving || !identifier} style={{ flex: 1, background: "#22C55E", color: "#000", fontWeight: 600, fontSize: 14, padding: "10px 20px", borderRadius: 24, border: "none", cursor: "pointer", transition: "opacity 0.15s ease", opacity: saving || !identifier ? 0.5 : 1 }}>
              {saving ? "Saving..." : "Save Changes"}
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

/* ─── Create Asset Form ─── */

function CreateAssetForm({ prefilledSize, onSuccess }: { prefilledSize: string | null; onSuccess: () => void }) {
  const [assetType, setAssetType] = useState("dumpster");
  const [subtype, setSubtype] = useState(prefilledSize || "20yd");
  const [identifier, setIdentifier] = useState("");
  const [dailyRate, setDailyRate] = useState("");
  const [weightCapacity, setWeightCapacity] = useState("");
  const [condition, setCondition] = useState("good");
  const [notes, setNotes] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const prefix = TYPE_PREFIX[assetType] || "A";
    const sizeNum = subtype.replace(/\D/g, "") || subtype;
    setIdentifier(`${prefix}-${sizeNum}-001`);
  }, [assetType, subtype]);

  useEffect(() => {
    if (!prefilledSize) {
      const subtypes = SUBTYPES_BY_TYPE[assetType];
      if (subtypes?.length) setSubtype(subtypes[0].value);
    }
  }, [assetType, prefilledSize]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    const qty = Math.max(1, Math.min(50, parseInt(quantity) || 1));

    try {
      if (qty === 1) {
        await api.post("/assets", {
          assetType, subtype, identifier,
          dailyRate: dailyRate ? Number(dailyRate) : undefined,
          weightCapacity: weightCapacity ? Number(weightCapacity) : undefined,
          condition, notes: notes || undefined,
        });
      } else {
        const match = identifier.match(/^(.*?)(\d+)$/);
        const prefix = match ? match[1] : identifier + "-";
        const startNum = match ? parseInt(match[2]) : 1;
        for (let i = 0; i < qty; i++) {
          const num = startNum + i;
          const id = `${prefix}${String(num).padStart(3, "0")}`;
          await api.post("/assets", {
            assetType, subtype, identifier: id,
            dailyRate: dailyRate ? Number(dailyRate) : undefined,
            weightCapacity: weightCapacity ? Number(weightCapacity) : undefined,
            condition, notes: notes || undefined,
          });
        }
      }
      toast("success", qty > 1 ? `${qty} assets created` : "Asset created");
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
        <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} required style={inp} placeholder="D-20-001" />
        {qty > 1 && (
          <p style={{ marginTop: 6, fontSize: 12, color: "var(--t-text-muted)" }}>
            Will create: {identifier} through {(() => {
              const match = identifier.match(/^(.*?)(\d+)$/);
              if (!match) return `${identifier}-${String(qty).padStart(3, "0")}`;
              return `${match[1]}${String(parseInt(match[2]) + qty - 1).padStart(3, "0")}`;
            })()}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label style={lbl}>Daily Rate ($)</label>
          <input type="number" step="0.01" value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} style={inp} placeholder="25.00" />
        </div>
        <div>
          <label style={lbl}>Weight Capacity (tons)</label>
          <input type="number" value={weightCapacity} onChange={(e) => setWeightCapacity(e.target.value)} style={inp} placeholder="4" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label style={lbl}>Condition</label>
          <select value={condition} onChange={(e) => setCondition(e.target.value)} style={{ ...inp, appearance: "none" as const }}>
            <option value="good">Good</option>
            <option value="new">New</option>
            <option value="fair">Fair</option>
            <option value="poor">Poor</option>
          </select>
        </div>
        <div>
          <label style={lbl}>Quantity</label>
          <input type="number" min="1" max="50" value={quantity} onChange={(e) => setQuantity(e.target.value)} style={inp} placeholder="1" />
        </div>
      </div>

      <div>
        <label style={lbl}>Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ ...inp, resize: "none" as const }} placeholder="Any notes..." />
      </div>

      <button
        type="submit"
        disabled={saving}
        style={{
          width: "100%", background: "#22C55E", color: "#000", fontWeight: 600, fontSize: 14,
          padding: "10px 20px", borderRadius: 24, border: "none",
          cursor: "pointer", transition: "opacity 0.15s ease",
          opacity: saving ? 0.5 : 1,
        }}
      >
        {saving ? "Creating..." : qty > 1 ? `Add ${qty} \u00d7 ${subtype} ${assetType === "dumpster" ? "dumpsters" : "assets"}` : "Add Asset"}
      </button>
    </form>
  );
}
