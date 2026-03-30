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
} from "lucide-react";
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
  dailyRate: number;
}

/* ─── Constants ─── */

const SIZES = ["10yd", "15yd", "20yd", "30yd", "40yd"] as const;

const STATUS_FILTERS = ["all", "available", "on_site", "reserved", "maintenance"] as const;
const STATUS_LABELS: Record<string, string> = {
  all: "All",
  available: "Available",
  on_site: "Deployed",
  reserved: "Reserved",
  maintenance: "Maintenance",
  in_transit: "In Transit",
  deployed: "Deployed",
  retired: "Retired",
};

const STATUS_BADGE: Record<string, { className: string; dot: string }> = {
  available: { className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", dot: "bg-emerald-400" },
  on_site: { className: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20", dot: "bg-yellow-400" },
  deployed: { className: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20", dot: "bg-yellow-400" },
  reserved: { className: "bg-blue-500/10 text-blue-400 border-blue-500/20", dot: "bg-blue-400" },
  in_transit: { className: "bg-purple-500/10 text-purple-400 border-purple-500/20", dot: "bg-purple-400" },
  maintenance: { className: "bg-red-500/10 text-red-400 border-red-500/20", dot: "bg-red-400" },
  retired: { className: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20", dot: "bg-zinc-400" },
};

const CONDITION_BADGE: Record<string, string> = {
  new: "bg-emerald-500/10 text-emerald-400",
  good: "bg-emerald-500/10 text-emerald-400",
  fair: "bg-yellow-500/10 text-yellow-400",
  poor: "bg-red-500/10 text-red-400",
};

const SIZE_ACCENT: Record<string, { border: string; glow: string; bg: string; text: string }> = {
  "10yd": { border: "border-sky-500/50", glow: "shadow-sky-500/20", bg: "bg-sky-500", text: "text-sky-400" },
  "15yd": { border: "border-indigo-500/50", glow: "shadow-indigo-500/20", bg: "bg-indigo-500", text: "text-indigo-400" },
  "20yd": { border: "border-violet-500/50", glow: "shadow-violet-500/20", bg: "bg-violet-500", text: "text-violet-400" },
  "30yd": { border: "border-amber-500/50", glow: "shadow-amber-500/20", bg: "bg-amber-500", text: "text-amber-400" },
  "40yd": { border: "border-rose-500/50", glow: "shadow-rose-500/20", bg: "bg-rose-500", text: "text-rose-400" },
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

/* ─── Helpers ─── */

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function fmtDate(d: string): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtMoney(n: number): string {
  return `$${Number(n).toFixed(0)}`;
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
  const { toast } = useToast();

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<AssetsResponse>("/assets?limit=200");
      setAssets(res.data);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAssets(); }, [fetchAssets]);

  // Group assets by size
  const sizeGroups: SizeGroup[] = useMemo(() => {
    return SIZES.map((size) => {
      const sizeAssets = assets.filter((a) => a.subtype === size);
      const available = sizeAssets.filter((a) => a.status === "available").length;
      const deployed = sizeAssets.filter((a) => a.status === "on_site" || a.status === "deployed").length;
      const maintenance = sizeAssets.filter((a) => a.status === "maintenance").length;
      const reserved = sizeAssets.filter((a) => a.status === "reserved").length;
      const rates = sizeAssets.filter((a) => a.daily_rate > 0).map((a) => Number(a.daily_rate));
      const dailyRate = rates.length > 0 ? rates[0] : 0;
      return { size, assets: sizeAssets, total: sizeAssets.length, available, deployed, maintenance, reserved, dailyRate };
    }).filter((g) => g.total > 0);
  }, [assets]);

  // Filtered assets for the list below tiles
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

  // Overdue count
  const overdueAssets = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    return assets.filter((a) => {
      if (a.status !== "on_site" && a.status !== "deployed") return false;
      const meta = (a.metadata || {}) as Record<string, any>;
      return meta.rental_end_date && today > meta.rental_end_date;
    });
  }, [assets]);

  // Quick stats
  const quickStats = useMemo(() => {
    const deployed = assets.filter((a) => a.status === "on_site" || a.status === "deployed");
    const totalFleetDailyValue = deployed.reduce((sum, a) => sum + Number(a.daily_rate || 0), 0);
    const utilizationRate = assets.length > 0 ? Math.round((deployed.length / assets.length) * 100) : 0;
    const maintenanceCount = assets.filter((a) => a.status === "maintenance").length;
    return { totalFleetDailyValue, utilizationRate, overdueCount: overdueAssets.length, maintenanceCount };
  }, [assets, overdueAssets]);

  const quickStatus = async (id: string, status: string) => {
    try {
      await api.patch(`/assets/${id}`, { status });
      toast("success", `Asset marked as ${STATUS_LABELS[status] || status}`);
      fetchAssets();
    } catch {
      toast("error", "Failed to update status");
    }
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
        <div className="mb-6 flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-3">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-red-400" />
            <span className="text-sm font-medium text-red-300">
              {overdueAssets.length} overdue rental{overdueAssets.length !== 1 ? "s" : ""}
            </span>
          </div>
          <button
            onClick={() => { setSelectedSize(null); setStatusFilter("on_site"); }}
            className="text-sm font-medium text-red-400 hover:text-red-300 transition-colors"
          >
            View Details
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">Inventory</h1>
          <p className="mt-1 text-sm text-muted">{assets.length} dumpsters across {sizeGroups.length} sizes</p>
        </div>
        <button
          onClick={() => { setCreatePrefilledSize(null); setCreateOpen(true); }}
          className="flex items-center gap-2 rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1FA855] btn-press"
        >
          <Plus className="h-4 w-4" />
          Add Asset
        </button>
      </div>

      {/* ─── Size Summary Tiles ─── */}
      {loading ? (
        <div className="flex gap-3 mb-6 overflow-x-auto pb-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-36 min-w-[200px] flex-1 skeleton rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="flex gap-3 mb-6 overflow-x-auto pb-2 scrollbar-thin">
          {sizeGroups.map((group) => {
            const accent = SIZE_ACCENT[group.size] || SIZE_ACCENT["20yd"];
            const isSelected = selectedSize === group.size;
            return (
              <button
                key={group.size}
                onClick={() => handleTileClick(group.size)}
                className={`relative min-w-[190px] flex-1 rounded-2xl border p-4 text-left transition-all btn-press ${
                  isSelected
                    ? `${accent.border} shadow-lg ${accent.glow} bg-dark-card-hover ring-1 ring-brand/30`
                    : "border-[#1E2D45] bg-dark-card hover:bg-dark-card-hover hover:border-white/10"
                }`}
              >
                {/* Size label */}
                <div className="flex items-center justify-between mb-2">
                  <span className={`font-display text-2xl font-black tracking-tight ${isSelected ? accent.text : "text-white"}`}>
                    {group.size.replace("yd", "")} <span className="text-sm font-semibold opacity-60">YD</span>
                  </span>
                  <span className="text-xs text-muted">{group.total} unit{group.total !== 1 ? "s" : ""}</span>
                </div>

                {/* Status breakdown */}
                <div className="flex items-center gap-3 text-[11px] mb-3 flex-wrap">
                  {group.available > 0 && (
                    <span className="flex items-center gap-1 text-emerald-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{group.available}
                    </span>
                  )}
                  {group.deployed > 0 && (
                    <span className="flex items-center gap-1 text-yellow-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />{group.deployed}
                    </span>
                  )}
                  {group.maintenance > 0 && (
                    <span className="flex items-center gap-1 text-red-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-400" />{group.maintenance}
                    </span>
                  )}
                  {group.reserved > 0 && (
                    <span className="flex items-center gap-1 text-blue-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />{group.reserved}
                    </span>
                  )}
                </div>

                {/* Daily rate */}
                {group.dailyRate > 0 && (
                  <p className="text-xs text-muted mb-3">{fmtMoney(group.dailyRate)}/day</p>
                )}

                {/* Utilization bar */}
                <div className="h-1.5 w-full rounded-full bg-dark-elevated overflow-hidden flex">
                  {group.available > 0 && (
                    <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(group.available / group.total) * 100}%` }} />
                  )}
                  {group.deployed > 0 && (
                    <div className="h-full bg-yellow-500 transition-all" style={{ width: `${(group.deployed / group.total) * 100}%` }} />
                  )}
                  {group.maintenance > 0 && (
                    <div className="h-full bg-red-500 transition-all" style={{ width: `${(group.maintenance / group.total) * 100}%` }} />
                  )}
                  {group.reserved > 0 && (
                    <div className="h-full bg-blue-500 transition-all" style={{ width: `${(group.reserved / group.total) * 100}%` }} />
                  )}
                </div>

                {/* Selected indicator */}
                {isSelected && (
                  <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2">
                    <ChevronDown className={`h-4 w-4 ${accent.text}`} />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ─── Expanded Tile Section ─── */}
      {selectedSize && !loading && (
        <div className="mb-6 space-y-4">
          {/* Bulk Actions + Filter Pills */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((s) => {
                const group = sizeGroups.find((g) => g.size === selectedSize);
                const count = s === "all"
                  ? (group?.total || 0)
                  : s === "on_site"
                    ? (group?.deployed || 0)
                    : ((group as any)?.[s] || 0);
                const isActive = statusFilter === s;
                const badge = STATUS_BADGE[s];
                return (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all btn-press border ${
                      isActive
                        ? s === "all"
                          ? "bg-white/10 text-white border-white/20"
                          : (badge?.className || "bg-white/10 text-white border-white/20")
                        : "bg-transparent text-muted border-[#1E2D45] hover:border-white/20 hover:text-white"
                    }`}
                  >
                    {s !== "all" && badge && <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />}
                    {STATUS_LABELS[s]}
                    <span className={`text-[10px] ${isActive ? "opacity-80" : "opacity-50"}`}>{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => bulkMaintenance(selectedSize)}
                className="flex items-center gap-1.5 rounded-lg border border-[#1E2D45] px-3 py-1.5 text-xs font-medium text-muted hover:text-red-400 hover:border-red-500/30 transition-colors"
              >
                <Wrench className="h-3 w-3" /> Mark All Maintenance
              </button>
              <button
                onClick={() => { setCreatePrefilledSize(selectedSize); setCreateOpen(true); }}
                className="flex items-center gap-1.5 rounded-lg border border-[#1E2D45] px-3 py-1.5 text-xs font-medium text-muted hover:text-brand hover:border-brand/30 transition-colors"
              >
                <Plus className="h-3 w-3" /> Add More {selectedSize}
              </button>
              <button
                onClick={() => exportCSV(filteredAssets)}
                className="flex items-center gap-1.5 rounded-lg border border-[#1E2D45] px-3 py-1.5 text-xs font-medium text-muted hover:text-white hover:border-white/20 transition-colors"
              >
                <Download className="h-3 w-3" /> Export CSV
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Search + View Toggle ─── */}
      {!loading && assets.length > 0 && (
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search identifier, customer, address..."
              className="w-full rounded-lg bg-[#111C2E] border border-[#1E2D45] pl-10 pr-4 py-2 text-sm text-white placeholder-muted outline-none transition-colors focus:border-brand"
            />
          </div>
          <div className="flex rounded-lg border border-[#1E2D45] overflow-hidden">
            <button
              onClick={() => setViewMode("list")}
              className={`p-2 transition-colors ${viewMode === "list" ? "bg-brand/10 text-brand" : "text-muted hover:text-white"}`}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={`p-2 transition-colors ${viewMode === "grid" ? "bg-brand/10 text-brand" : "text-muted hover:text-white"}`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
          {!selectedSize && (
            <button
              onClick={() => exportCSV(filteredAssets)}
              className="flex items-center gap-1.5 rounded-lg border border-[#1E2D45] px-3 py-2 text-xs font-medium text-muted hover:text-white hover:border-white/20 transition-colors"
            >
              <Download className="h-3.5 w-3.5" /> Export
            </button>
          )}
        </div>
      )}

      {/* ─── Asset List / Grid ─── */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 w-full skeleton rounded-xl" />
          ))}
        </div>
      ) : filteredAssets.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center text-center">
          <Box size={48} className="text-[#7A8BA3]/30 mb-4" />
          <h2 className="text-lg font-semibold text-white mb-1">
            {searchQuery ? "No matching assets" : selectedSize ? `No ${selectedSize} dumpsters with this filter` : "No assets yet"}
          </h2>
          <p className="text-sm text-muted mb-6">
            {searchQuery ? "Try a different search term" : "Add your first dumpster to get started"}
          </p>
          {!searchQuery && !selectedSize && (
            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-2 rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1FA855] btn-press"
            >
              <Plus className="h-4 w-4" />
              Add Asset
            </button>
          )}
        </div>
      ) : viewMode === "list" ? (
        <ListView assets={filteredAssets} onSelect={setDetailAsset} onQuickStatus={quickStatus} />
      ) : (
        <GridView assets={filteredAssets} onSelect={setDetailAsset} onQuickStatus={quickStatus} />
      )}

      {/* ─── Quick Stats Bar ─── */}
      {!loading && assets.length > 0 && (
        <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-[#1E2D45] bg-dark-card p-4">
            <p className="text-xs text-muted mb-1">Fleet Daily Value</p>
            <p className="text-xl font-bold text-brand tabular-nums">${quickStats.totalFleetDailyValue.toLocaleString()}<span className="text-xs font-normal text-muted">/day</span></p>
          </div>
          <div className="rounded-2xl border border-[#1E2D45] bg-dark-card p-4">
            <p className="text-xs text-muted mb-1">Utilization Rate</p>
            <p className="text-xl font-bold text-white tabular-nums">{quickStats.utilizationRate}%</p>
          </div>
          <div className={`rounded-2xl border p-4 ${quickStats.overdueCount > 0 ? "border-red-500/30 bg-red-500/5" : "border-[#1E2D45] bg-dark-card"}`}>
            <p className="text-xs text-muted mb-1">Overdue Rentals</p>
            <p className={`text-xl font-bold tabular-nums ${quickStats.overdueCount > 0 ? "text-red-400" : "text-white"}`}>{quickStats.overdueCount}</p>
          </div>
          <div className={`rounded-2xl border p-4 ${quickStats.maintenanceCount > 0 ? "border-yellow-500/20 bg-yellow-500/5" : "border-[#1E2D45] bg-dark-card"}`}>
            <p className="text-xs text-muted mb-1">In Maintenance</p>
            <p className="text-xl font-bold text-white tabular-nums">{quickStats.maintenanceCount}</p>
          </div>
        </div>
      )}

      {/* Create Slide-Over */}
      <SlideOver open={createOpen} onClose={() => setCreateOpen(false)} title="Add Asset">
        <CreateAssetForm prefilledSize={createPrefilledSize} onSuccess={() => { setCreateOpen(false); fetchAssets(); }} />
      </SlideOver>

      {/* Detail Slide-Over */}
      <SlideOver open={!!detailAsset} onClose={() => setDetailAsset(null)} title={detailAsset?.identifier || "Asset Details"}>
        {detailAsset && (
          <AssetDetail
            asset={detailAsset}
            onStatusChange={(status) => { quickStatus(detailAsset.id, status); setDetailAsset({ ...detailAsset, status }); }}
            onUpdated={() => { setDetailAsset(null); fetchAssets(); }}
          />
        )}
      </SlideOver>
    </div>
  );
}

/* ─── List View ─── */

function ListView({ assets, onSelect, onQuickStatus }: { assets: Asset[]; onSelect: (a: Asset) => void; onQuickStatus: (id: string, status: string) => void }) {
  return (
    <div className="rounded-2xl border border-[#1E2D45] bg-dark-card overflow-hidden">
      <div className="table-scroll">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#1E2D45]">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">Identifier</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">Size</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">Location</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">Days Out</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">Rate</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">Condition</th>
              <th className="px-2 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => {
              const badge = STATUS_BADGE[asset.status] || STATUS_BADGE.available;
              const condBadge = CONDITION_BADGE[asset.condition] || CONDITION_BADGE.good;
              const deployed = getDeployedInfo(asset);

              return (
                <tr
                  key={asset.id}
                  onClick={() => onSelect(asset)}
                  className="border-b border-[#1E2D45] last:border-0 cursor-pointer transition-colors hover:bg-[#1A2740]/50"
                >
                  <td className="px-4 py-3 font-semibold text-white">{asset.identifier}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-foreground">{asset.subtype}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badge.className}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                      {STATUS_LABELS[asset.status] || asset.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-foreground text-xs max-w-[200px] truncate">
                    {deployed ? (
                      <span>{deployed.customerName ? `${deployed.customerName} — ` : ""}{deployed.address || "Customer site"}</span>
                    ) : (
                      <span className="text-muted">Yard</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {deployed ? (
                      <span className={`tabular-nums text-xs font-medium ${deployed.isOverdue ? "text-red-400" : "text-foreground"}`}>
                        {deployed.daysDeployed}d {deployed.isOverdue && <span className="text-red-400 text-[10px]">OVERDUE</span>}
                      </span>
                    ) : (
                      <span className="text-muted text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-foreground tabular-nums text-xs">
                    {asset.daily_rate > 0 ? `${fmtMoney(asset.daily_rate)}/day` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {asset.condition && (
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${condBadge}`}>
                        {asset.condition}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                    <Dropdown
                      trigger={<button className="rounded p-1 text-muted hover:text-white hover:bg-dark-elevated transition-colors"><MoreHorizontal className="h-4 w-4" /></button>}
                      align="right"
                    >
                      <button onClick={() => onSelect(asset)} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-dark-card transition-colors">
                        <Eye className="h-3.5 w-3.5" /> View Details
                      </button>
                      {asset.status !== "available" && (
                        <button onClick={() => onQuickStatus(asset.id, "available")} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-emerald-400 hover:bg-dark-card transition-colors">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Mark Available
                        </button>
                      )}
                      {asset.status !== "on_site" && (
                        <button onClick={() => onQuickStatus(asset.id, "on_site")} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-yellow-400 hover:bg-dark-card transition-colors">
                          <Truck className="h-3.5 w-3.5" /> Mark Deployed
                        </button>
                      )}
                      {asset.status !== "maintenance" && (
                        <button onClick={() => onQuickStatus(asset.id, "maintenance")} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-dark-card transition-colors">
                          <Wrench className="h-3.5 w-3.5" /> Schedule Maintenance
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
        const badge = STATUS_BADGE[asset.status] || STATUS_BADGE.available;
        const deployed = getDeployedInfo(asset);

        return (
          <button
            key={asset.id}
            onClick={() => onSelect(asset)}
            className="group relative rounded-xl bg-dark-card p-4 text-left transition-all hover:bg-dark-card-hover hover:ring-1 hover:ring-white/5 border border-[#1E2D45] card-hover btn-press"
          >
            <div className="flex items-center justify-between mb-2">
              <p className="font-display text-base font-bold text-white">{asset.identifier}</p>
              <span className={`h-2.5 w-2.5 rounded-full ${badge.dot}`} />
            </div>

            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium mb-2 ${badge.className}`}>
              {STATUS_LABELS[asset.status] || asset.status.replace(/_/g, " ")}
            </span>

            <div className="text-xs text-muted truncate">
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
              <p className={`text-[10px] mt-1 font-medium ${deployed.isOverdue ? "text-red-400" : "text-muted"}`}>
                {deployed.daysDeployed}d out {deployed.isOverdue && "· OVERDUE"}
              </p>
            )}

            <div className="mt-2 flex gap-1" onClick={(e) => e.stopPropagation()}>
              {asset.status !== "available" && (
                <button onClick={() => onQuickStatus(asset.id, "available")} className="rounded px-1.5 py-0.5 text-[9px] font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors">Avail</button>
              )}
              {asset.status !== "maintenance" && (
                <button onClick={() => onQuickStatus(asset.id, "maintenance")} className="rounded px-1.5 py-0.5 text-[9px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">Maint</button>
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
  const badge = STATUS_BADGE[asset.status] || STATUS_BADGE.available;
  const condBadge = CONDITION_BADGE[asset.condition] || CONDITION_BADGE.good;
  const deployed = getDeployedInfo(asset);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-muted capitalize">{asset.asset_type} &middot; {asset.subtype}</span>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badge.className}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
            {STATUS_LABELS[asset.status] || asset.status.replace(/_/g, " ")}
          </span>
          {asset.condition && (
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${condBadge}`}>
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
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  s === "available" ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20" :
                  s === "on_site" ? "bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20" :
                  "bg-red-500/10 text-red-400 hover:bg-red-500/20"
                }`}
              >
                {s === "available" ? "Mark Available" : s === "on_site" ? "Mark Deployed" : "Maintenance"}
              </button>
            ) : null
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-[#1E2D45]">
        {(["overview", "history", "maintenance"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`relative px-4 py-2.5 text-sm font-medium capitalize transition-colors ${
              activeTab === tab ? "text-brand" : "text-muted hover:text-foreground"
            }`}
          >
            {tab}
            {activeTab === tab && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brand rounded-full" />}
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
  const lbl = "text-xs text-muted";
  const val = "text-sm text-white font-medium";

  return (
    <div className="space-y-6">
      {deployed && (
        <div className="rounded-xl border border-[#1E2D45] bg-[#111C2E] p-4 space-y-3">
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted">Current Deployment</h4>
          <div className="grid grid-cols-2 gap-3">
            {deployed.customerName && <div><p className={lbl}>Customer</p><p className={`${val} text-brand`}>{deployed.customerName}</p></div>}
            <div><p className={lbl}>Delivery Date</p><p className={val}>{fmtDate(deployed.deliveryDate)}</p></div>
            {deployed.rentalEnd && <div><p className={lbl}>Rental End</p><p className={`${val} ${deployed.isOverdue ? "text-red-400" : ""}`}>{fmtDate(deployed.rentalEnd)}</p></div>}
            <div><p className={lbl}>Days Deployed</p><p className={`${val} ${deployed.isOverdue ? "text-red-400" : ""}`}>{deployed.daysDeployed} days {deployed.isOverdue && "(OVERDUE)"}</p></div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h4 className="text-xs font-medium uppercase tracking-wider text-muted">Specifications</h4>
        <div className="grid grid-cols-2 gap-3">
          <div><p className={lbl}>Daily Rate</p><p className={val}>{asset.daily_rate > 0 ? `${fmtMoney(asset.daily_rate)}/day` : "Not set"}</p></div>
          <div><p className={lbl}>Weight Capacity</p><p className={val}>{asset.weight_capacity ? `${Number(asset.weight_capacity).toLocaleString()} tons` : "Not set"}</p></div>
          <div><p className={lbl}>Condition</p><p className={`${val} capitalize`}>{asset.condition || "—"}</p></div>
          <div><p className={lbl}>Location</p><p className={val}>{asset.current_location?.address || (asset.current_location_type === "yard" || !asset.current_location_type ? "Yard" : asset.current_location_type.replace(/_/g, " "))}</p></div>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-medium uppercase tracking-wider text-muted">Photos</h4>
        <div className="rounded-xl border border-dashed border-[#1E2D45] p-8 flex flex-col items-center justify-center text-center">
          <Box className="h-8 w-8 text-muted/30 mb-2" />
          <p className="text-xs text-muted">Photo uploads coming soon</p>
        </div>
      </div>

      {asset.notes && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted">Notes</h4>
          <p className="text-sm text-foreground rounded-xl bg-[#111C2E] border border-[#1E2D45] p-4">{asset.notes}</p>
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
        <div className="rounded-xl border border-[#1E2D45] bg-[#111C2E] p-3 text-center">
          <p className="text-xs text-muted">Lifetime Revenue</p>
          <p className="text-lg font-bold text-brand">{lifetimeRevenue > 0 ? `$${Number(lifetimeRevenue).toLocaleString()}` : "—"}</p>
        </div>
        <div className="rounded-xl border border-[#1E2D45] bg-[#111C2E] p-3 text-center">
          <p className="text-xs text-muted">Days Deployed</p>
          <p className="text-lg font-bold text-white">{totalDaysDeployed || "—"}</p>
        </div>
        <div className="rounded-xl border border-[#1E2D45] bg-[#111C2E] p-3 text-center">
          <p className="text-xs text-muted">Utilization</p>
          <p className="text-lg font-bold text-white">{utilization > 0 ? `${utilization}%` : "—"}</p>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-medium uppercase tracking-wider text-muted">Job History</h4>
        {history.length === 0 ? (
          <div className="rounded-xl border border-[#1E2D45] bg-[#111C2E] p-8 text-center">
            <ClipboardList className="h-8 w-8 text-muted/30 mx-auto mb-2" />
            <p className="text-xs text-muted">No job history recorded yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((job: any, i: number) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-[#1E2D45] bg-[#111C2E] p-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-dark-elevated">
                  <Truck className="h-4 w-4 text-muted" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium truncate">{job.customer_name || "Customer"}</p>
                  <p className="text-xs text-muted">{fmtDate(job.date)} &middot; {job.duration || 0} days</p>
                </div>
                {job.revenue > 0 && <span className="text-sm font-medium text-brand">${Number(job.revenue).toLocaleString()}</span>}
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

  const inp = "w-full rounded-lg bg-[#111C2E] border border-[#1E2D45] px-4 py-2.5 text-sm text-white placeholder-muted outline-none transition-colors focus:border-brand";
  const lbl = "block text-sm font-medium text-[#7A8BA3] mb-1.5";

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#1E2D45] bg-[#111C2E] p-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted">Total Maintenance Cost</p>
          <p className="text-lg font-bold text-white">{totalMaintenanceCost > 0 ? `$${Number(totalMaintenanceCost).toLocaleString()}` : "$0"}</p>
        </div>
        <button onClick={() => setAddOpen(!addOpen)} className="flex items-center gap-1.5 rounded-lg bg-brand/10 text-brand px-3 py-1.5 text-xs font-medium hover:bg-brand/20 transition-colors">
          <Plus className="h-3.5 w-3.5" /> Add Record
        </button>
      </div>

      {addOpen && (
        <form onSubmit={handleAdd} className="rounded-xl border border-brand/20 bg-brand/5 p-4 space-y-3">
          <div>
            <label className={lbl}>Type</label>
            <select value={newRecord.type} onChange={(e) => setNewRecord({ ...newRecord, type: e.target.value })} className={`${inp} appearance-none`}>
              <option value="inspection">Inspection</option>
              <option value="repair">Repair</option>
              <option value="cleaning">Cleaning</option>
              <option value="painting">Painting</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className={lbl}>Description</label>
            <input value={newRecord.description} onChange={(e) => setNewRecord({ ...newRecord, description: e.target.value })} className={inp} placeholder="What was done..." required />
          </div>
          <div>
            <label className={lbl}>Cost ($)</label>
            <input type="number" step="0.01" value={newRecord.cost} onChange={(e) => setNewRecord({ ...newRecord, cost: e.target.value })} className={inp} placeholder="0.00" />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="rounded-lg bg-[#2ECC71] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1FA855] disabled:opacity-50 transition-colors">
              {saving ? "Saving..." : "Save"}
            </button>
            <button type="button" onClick={() => setAddOpen(false)} className="rounded-lg border border-[#1E2D45] px-4 py-2 text-sm text-muted hover:text-white transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}

      {records.length === 0 ? (
        <div className="rounded-xl border border-[#1E2D45] bg-[#111C2E] p-8 text-center">
          <Shield className="h-8 w-8 text-muted/30 mx-auto mb-2" />
          <p className="text-xs text-muted">No maintenance records yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {records.map((record, i) => (
            <div key={record.id || i} className="flex items-center gap-3 rounded-xl border border-[#1E2D45] bg-[#111C2E] p-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-dark-elevated">
                <Wrench className="h-4 w-4 text-muted" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium capitalize">{record.type}</p>
                <p className="text-xs text-muted truncate">{record.description} &middot; {fmtDate(record.date)}</p>
              </div>
              {record.cost > 0 && <span className="text-sm font-medium text-red-400">-${Number(record.cost).toLocaleString()}</span>}
            </div>
          ))}
        </div>
      )}
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

  const inp = "w-full rounded-lg bg-[#111C2E] border border-[#1E2D45] px-4 py-2.5 text-sm text-white placeholder-muted outline-none transition-colors focus:border-brand";
  const lbl = "block text-sm font-medium text-[#7A8BA3] mb-1.5";
  const qty = parseInt(quantity) || 1;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}

      <div>
        <label className={lbl}>Asset Type</label>
        <select value={assetType} onChange={(e) => setAssetType(e.target.value)} className={`${inp} appearance-none`}>
          <option value="dumpster">Dumpster</option>
          <option value="storage_container">Storage Container</option>
          <option value="portable_restroom">Portable Restroom</option>
        </select>
      </div>

      <div>
        <label className={lbl}>Size / Subtype</label>
        <select value={subtype} onChange={(e) => setSubtype(e.target.value)} className={`${inp} appearance-none`}>
          {(SUBTYPES_BY_TYPE[assetType] || []).map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={lbl}>Identifier</label>
        <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} required className={inp} placeholder="D-20-001" />
        {qty > 1 && (
          <p className="mt-1.5 text-xs text-muted">
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
          <label className={lbl}>Daily Rate ($)</label>
          <input type="number" step="0.01" value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} className={inp} placeholder="25.00" />
        </div>
        <div>
          <label className={lbl}>Weight Capacity (tons)</label>
          <input type="number" value={weightCapacity} onChange={(e) => setWeightCapacity(e.target.value)} className={inp} placeholder="4" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Condition</label>
          <select value={condition} onChange={(e) => setCondition(e.target.value)} className={`${inp} appearance-none`}>
            <option value="good">Good</option>
            <option value="new">New</option>
            <option value="fair">Fair</option>
            <option value="poor">Poor</option>
          </select>
        </div>
        <div>
          <label className={lbl}>Quantity</label>
          <input type="number" min="1" max="50" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inp} placeholder="1" />
        </div>
      </div>

      <div>
        <label className={lbl}>Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={`${inp} resize-none`} placeholder="Any notes..." />
      </div>

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1FA855] disabled:opacity-50 btn-press"
      >
        {saving ? "Creating..." : qty > 1 ? `Add ${qty} × ${subtype} ${assetType === "dumpster" ? "dumpsters" : "assets"}` : "Add Asset"}
      </button>
    </form>
  );
}
