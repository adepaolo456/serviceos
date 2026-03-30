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
  ArrowUpDown,
  AlertTriangle,
  Clock,
  Calendar,
  ChevronRight,
  Eye,
  Shuffle,
  CalendarClock,
  ClipboardList,
  Shield,
  Timer,
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

interface StatusCounts {
  total: number;
  available: number;
  on_site: number;
  reserved: number;
  maintenance: number;
}

interface AvailabilityDay {
  date: string;
  subtype: string;
  total: number;
  availableOnDate: number;
}

interface MaintenanceRecord {
  id: string;
  date: string;
  type: string;
  description: string;
  cost: number;
  next_due?: string;
}

/* ─── Constants ─── */

const STATUS_FILTERS = ["all", "available", "on_site", "reserved", "maintenance"] as const;
const STATUS_LABELS: Record<string, string> = {
  all: "All",
  available: "Available",
  on_site: "Deployed",
  reserved: "Reserved",
  maintenance: "Maintenance",
  in_transit: "In Transit",
  retired: "Retired",
};

const STATUS_BADGE: Record<string, { className: string; dot: string }> = {
  available: { className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", dot: "bg-emerald-400" },
  on_site: { className: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20", dot: "bg-yellow-400" },
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

const SIZE_COLORS: Record<string, string> = {
  "10yd": "bg-sky-500/10 text-sky-400 border-sky-500/20",
  "15yd": "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  "20yd": "bg-violet-500/10 text-violet-400 border-violet-500/20",
  "30yd": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "40yd": "bg-rose-500/10 text-rose-400 border-rose-500/20",
};

const SORT_OPTIONS = [
  { value: "identifier", label: "Identifier" },
  { value: "status", label: "Status" },
  { value: "subtype", label: "Size" },
  { value: "created_at", label: "Date Added" },
] as const;

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

/* ─── Main Page ─── */

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState<StatusCounts>({ total: 0, available: 0, on_site: 0, reserved: 0, maintenance: 0 });
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("identifier");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
  const [forecast, setForecast] = useState<AvailabilityDay[]>([]);
  const { toast } = useToast();

  // Fetch utilization counts
  const fetchCounts = useCallback(async () => {
    try {
      const stats: { status: string; count: number }[] = await api.get("/assets/utilization");
      const counts: StatusCounts = { total: 0, available: 0, on_site: 0, reserved: 0, maintenance: 0 };
      stats.forEach((s) => {
        counts.total += s.count;
        if (s.status in counts) (counts as any)[s.status] = s.count;
        // deployed maps to on_site
        if (s.status === "deployed") counts.on_site += s.count;
      });
      setStatusCounts(counts);
    } catch { /* silent */ }
  }, []);

  // Fetch assets
  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await api.get<AssetsResponse>(`/assets?${params.toString()}`);
      setAssets(res.data);
      setTotal(res.meta.total);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  // Fetch 7-day forecast
  const fetchForecast = useCallback(async () => {
    try {
      const sizes = ["10yd", "20yd", "30yd", "40yd"];
      const days: AvailabilityDay[] = [];
      const today = new Date();
      for (let d = 0; d < 7; d++) {
        const date = new Date(today);
        date.setDate(today.getDate() + d);
        const dateStr = date.toISOString().split("T")[0];
        for (const size of sizes) {
          try {
            const result = await api.get<AvailabilityDay>(`/assets/availability?subtype=${size}&date=${dateStr}`);
            days.push({ date: dateStr, subtype: size, total: result.total, availableOnDate: result.availableOnDate });
          } catch { /* skip */ }
        }
      }
      setForecast(days);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchAssets(); }, [fetchAssets]);
  useEffect(() => { fetchCounts(); }, [fetchCounts]);
  useEffect(() => { fetchForecast(); }, [fetchForecast]);
  useEffect(() => { setPage(1); }, [statusFilter]);

  // Client-side search + sort
  const filteredAssets = useMemo(() => {
    let result = [...assets];
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
    result.sort((a, b) => {
      if (sortBy === "identifier") return a.identifier.localeCompare(b.identifier);
      if (sortBy === "status") return a.status.localeCompare(b.status);
      if (sortBy === "subtype") return (a.subtype || "").localeCompare(b.subtype || "");
      if (sortBy === "created_at") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return 0;
    });
    return result;
  }, [assets, searchQuery, sortBy]);

  // Overdue assets
  const overdueAssets = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    return assets.filter((a) => {
      if (a.status !== "on_site" && a.status !== "deployed") return false;
      const meta = (a.metadata || {}) as Record<string, any>;
      const rentalEnd = meta.rental_end_date;
      return rentalEnd && today > rentalEnd;
    });
  }, [assets]);

  const quickStatus = async (id: string, status: string) => {
    try {
      await api.patch(`/assets/${id}`, { status });
      toast("success", `Asset marked as ${status.replace(/_/g, " ")}`);
      fetchAssets();
      fetchCounts();
    } catch {
      toast("error", "Failed to update status");
    }
  };

  const handleAssetCreated = () => {
    setCreateOpen(false);
    fetchAssets();
    fetchCounts();
    fetchForecast();
  };

  const handleAssetUpdated = () => {
    setDetailAsset(null);
    fetchAssets();
    fetchCounts();
    fetchForecast();
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
            onClick={() => setStatusFilter("on_site")}
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
          <p className="mt-1 text-sm text-muted">
            {statusCounts.total} total &middot;{" "}
            <span className="text-emerald-400">{statusCounts.available} available</span> &middot;{" "}
            <span className="text-yellow-400">{statusCounts.on_site} deployed</span> &middot;{" "}
            <span className="text-red-400">{statusCounts.maintenance} maintenance</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-[#1E2D45] overflow-hidden">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-2 transition-colors ${viewMode === "grid" ? "bg-brand/10 text-brand" : "text-muted hover:text-white"}`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-2 transition-colors ${viewMode === "list" ? "bg-brand/10 text-brand" : "text-muted hover:text-white"}`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1FA855] btn-press"
          >
            <Plus className="h-4 w-4" />
            Add Asset
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="mb-6 space-y-4">
        {/* Status pills */}
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((s) => {
            const count = s === "all" ? statusCounts.total : (statusCounts as any)[s] || 0;
            const isActive = statusFilter === s;
            const badge = STATUS_BADGE[s];
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-all btn-press border ${
                  isActive
                    ? s === "all"
                      ? "bg-white/10 text-white border-white/20"
                      : (badge?.className || "bg-white/10 text-white border-white/20")
                    : "bg-transparent text-muted border-[#1E2D45] hover:border-white/20 hover:text-white"
                }`}
              >
                {s !== "all" && badge && <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />}
                {STATUS_LABELS[s]}
                <span className={`text-xs ${isActive ? "opacity-80" : "opacity-50"}`}>{count}</span>
              </button>
            );
          })}
        </div>

        {/* Search + Sort */}
        <div className="flex gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search identifier, customer, address..."
              className="w-full rounded-lg bg-[#111C2E] border border-[#1E2D45] pl-10 pr-4 py-2 text-sm text-white placeholder-muted outline-none transition-colors focus:border-brand"
            />
          </div>
          <Dropdown
            trigger={
              <button className="flex items-center gap-2 rounded-lg border border-[#1E2D45] bg-[#111C2E] px-3 py-2 text-sm text-muted hover:text-white transition-colors">
                <ArrowUpDown className="h-3.5 w-3.5" />
                Sort: {SORT_OPTIONS.find((o) => o.value === sortBy)?.label}
              </button>
            }
            align="right"
          >
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSortBy(opt.value)}
                className={`block w-full px-4 py-2 text-left text-sm transition-colors ${
                  sortBy === opt.value ? "text-brand bg-brand/5" : "text-foreground hover:bg-dark-card"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </Dropdown>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 w-full skeleton rounded-xl" />
          ))}
        </div>
      ) : filteredAssets.length === 0 ? (
        <div className="py-32 flex flex-col items-center justify-center text-center">
          <Box size={48} className="text-[#7A8BA3]/30 mb-4" />
          <h2 className="text-lg font-semibold text-white mb-1">
            {searchQuery ? "No matching assets" : "No assets yet"}
          </h2>
          <p className="text-sm text-muted mb-6">
            {searchQuery ? "Try a different search term" : "Add your first asset to start tracking inventory"}
          </p>
          {!searchQuery && (
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

      {/* Pagination */}
      {total > 50 && (
        <div className="mt-6 flex items-center justify-between text-sm text-muted">
          <span>Showing {(page - 1) * 50 + 1}–{Math.min(page * 50, total)} of {total}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded-lg bg-dark-card px-3 py-1.5 transition-colors hover:bg-dark-card-hover disabled:opacity-40">Previous</button>
            <button onClick={() => setPage((p) => p + 1)} disabled={page * 50 >= total} className="rounded-lg bg-dark-card px-3 py-1.5 transition-colors hover:bg-dark-card-hover disabled:opacity-40">Next</button>
          </div>
        </div>
      )}

      {/* 7-Day Availability Forecast */}
      <ForecastTable forecast={forecast} />

      {/* Create Slide-Over */}
      <SlideOver open={createOpen} onClose={() => setCreateOpen(false)} title="Add Asset">
        <CreateAssetForm onSuccess={handleAssetCreated} />
      </SlideOver>

      {/* Detail Slide-Over */}
      <SlideOver open={!!detailAsset} onClose={() => setDetailAsset(null)} title={detailAsset?.identifier || "Asset Details"}>
        {detailAsset && (
          <AssetDetail
            asset={detailAsset}
            onStatusChange={(status) => { quickStatus(detailAsset.id, status); setDetailAsset({ ...detailAsset, status }); }}
            onUpdated={handleAssetUpdated}
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
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">Type / Size</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">Location</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">Days Deployed</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">Rental End</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">Rate</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">Condition</th>
              <th className="px-2 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => {
              const badge = STATUS_BADGE[asset.status] || STATUS_BADGE.available;
              const sizeBadge = SIZE_COLORS[asset.subtype] || "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
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
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${sizeBadge}`}>
                      {asset.asset_type === "dumpster" ? "Dumpster" : asset.asset_type === "storage_container" ? "Container" : "Restroom"} &middot; {asset.subtype || "—"}
                    </span>
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
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-foreground tabular-nums">
                    {deployed?.rentalEnd ? fmtDate(deployed.rentalEnd) : "—"}
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
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {assets.map((asset) => {
        const badge = STATUS_BADGE[asset.status] || STATUS_BADGE.available;
        const sizeBadge = SIZE_COLORS[asset.subtype] || "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
        const deployed = getDeployedInfo(asset);

        return (
          <button
            key={asset.id}
            onClick={() => onSelect(asset)}
            className="group relative rounded-2xl bg-dark-card p-5 text-left transition-all hover:bg-dark-card-hover hover:ring-1 hover:ring-white/5 border border-[#1E2D45] shadow-lg shadow-black/10 card-hover btn-press"
          >
            <div className="flex items-start justify-between mb-3">
              <p className="font-display text-xl font-bold text-white">{asset.identifier}</p>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${badge.className}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                {STATUS_LABELS[asset.status] || asset.status.replace(/_/g, " ")}
              </span>
            </div>

            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium mb-3 ${sizeBadge}`}>
              {asset.subtype || "—"}
            </span>

            {deployed ? (
              <div className="space-y-1 mb-3">
                <div className="flex items-center gap-1 text-xs text-foreground">
                  <MapPin className="h-3 w-3 text-muted" />
                  <span className="truncate max-w-[180px]">{deployed.customerName || deployed.address || "Customer site"}</span>
                </div>
                <div className="flex items-center gap-1 text-xs">
                  <Timer className="h-3 w-3 text-muted" />
                  <span className={deployed.isOverdue ? "text-red-400 font-medium" : "text-foreground"}>
                    {deployed.daysDeployed}d deployed {deployed.isOverdue && " — OVERDUE"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1 text-xs text-muted mb-3">
                <MapPin className="h-3 w-3" /> Yard
              </div>
            )}

            {asset.daily_rate > 0 && (
              <div className="flex items-center gap-1 text-xs text-foreground">
                <DollarSign className="h-3 w-3 text-brand" />
                <span className="font-medium">{fmtMoney(asset.daily_rate)}/day</span>
              </div>
            )}

            <div className="mt-3 flex gap-1" onClick={(e) => e.stopPropagation()}>
              {asset.status !== "available" && (
                <button onClick={() => onQuickStatus(asset.id, "available")} className="rounded px-2 py-1 text-[10px] font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors">Available</button>
              )}
              {asset.status !== "on_site" && (
                <button onClick={() => onQuickStatus(asset.id, "on_site")} className="rounded px-2 py-1 text-[10px] font-medium bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors">Deployed</button>
              )}
              {asset.status !== "maintenance" && (
                <button onClick={() => onQuickStatus(asset.id, "maintenance")} className="rounded px-2 py-1 text-[10px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors">Maint</button>
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
  const sizeBadge = SIZE_COLORS[asset.subtype] || "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
  const deployed = getDeployedInfo(asset);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${sizeBadge}`}>
            {asset.asset_type === "dumpster" ? "Dumpster" : asset.asset_type === "storage_container" ? "Container" : "Restroom"} &middot; {asset.subtype || "—"}
          </span>
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

        {/* Quick status buttons */}
        <div className="flex gap-2 flex-wrap">
          {["available", "on_site", "maintenance"].map((s) =>
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

      {/* Tab Content */}
      {activeTab === "overview" && (
        <OverviewTab asset={asset} deployed={deployed} />
      )}
      {activeTab === "history" && (
        <HistoryTab asset={asset} />
      )}
      {activeTab === "maintenance" && (
        <MaintenanceTab asset={asset} onUpdated={onUpdated} />
      )}
    </div>
  );
}

/* ─── Overview Tab ─── */

function OverviewTab({ asset, deployed }: { asset: Asset; deployed: ReturnType<typeof getDeployedInfo> }) {
  const labelClass = "text-xs text-muted";
  const valueClass = "text-sm text-white font-medium";

  return (
    <div className="space-y-6">
      {/* Deployed Info */}
      {deployed && (
        <div className="rounded-xl border border-[#1E2D45] bg-[#111C2E] p-4 space-y-3">
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted">Current Deployment</h4>
          <div className="grid grid-cols-2 gap-3">
            {deployed.customerName && (
              <div>
                <p className={labelClass}>Customer</p>
                <p className={`${valueClass} text-brand`}>{deployed.customerName}</p>
              </div>
            )}
            <div>
              <p className={labelClass}>Delivery Date</p>
              <p className={valueClass}>{fmtDate(deployed.deliveryDate)}</p>
            </div>
            {deployed.rentalEnd && (
              <div>
                <p className={labelClass}>Rental End</p>
                <p className={`${valueClass} ${deployed.isOverdue ? "text-red-400" : ""}`}>{fmtDate(deployed.rentalEnd)}</p>
              </div>
            )}
            <div>
              <p className={labelClass}>Days Deployed</p>
              <p className={`${valueClass} ${deployed.isOverdue ? "text-red-400" : ""}`}>
                {deployed.daysDeployed} days {deployed.isOverdue && "(OVERDUE)"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Specs */}
      <div className="space-y-3">
        <h4 className="text-xs font-medium uppercase tracking-wider text-muted">Specifications</h4>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className={labelClass}>Daily Rate</p>
            <p className={valueClass}>{asset.daily_rate > 0 ? `${fmtMoney(asset.daily_rate)}/day` : "Not set"}</p>
          </div>
          <div>
            <p className={labelClass}>Weight Capacity</p>
            <p className={valueClass}>{asset.weight_capacity ? `${Number(asset.weight_capacity).toLocaleString()} lbs` : "Not set"}</p>
          </div>
          <div>
            <p className={labelClass}>Condition</p>
            <p className={`${valueClass} capitalize`}>{asset.condition || "—"}</p>
          </div>
          <div>
            <p className={labelClass}>Location</p>
            <p className={valueClass}>{asset.current_location?.address || (asset.current_location_type === "yard" || !asset.current_location_type ? "Yard" : asset.current_location_type.replace(/_/g, " "))}</p>
          </div>
        </div>
      </div>

      {/* Photos placeholder */}
      <div className="space-y-3">
        <h4 className="text-xs font-medium uppercase tracking-wider text-muted">Photos</h4>
        <div className="rounded-xl border border-dashed border-[#1E2D45] p-8 flex flex-col items-center justify-center text-center">
          <Box className="h-8 w-8 text-muted/30 mb-2" />
          <p className="text-xs text-muted">Photo uploads coming soon</p>
        </div>
      </div>

      {/* Notes */}
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
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const meta = (asset.metadata || {}) as Record<string, any>;
  const lifetimeRevenue = meta.lifetime_revenue || 0;
  const totalDaysDeployed = meta.total_days_deployed || 0;
  const totalDaysAvailable = meta.total_days_available || 0;
  const utilization = totalDaysDeployed + totalDaysAvailable > 0
    ? Math.round((totalDaysDeployed / (totalDaysDeployed + totalDaysAvailable)) * 100)
    : 0;

  useEffect(() => {
    // History would come from a dedicated endpoint; for now use metadata
    const jobs = (meta.job_history || []) as any[];
    setHistory(jobs);
    setLoading(false);
  }, [asset.id]);

  return (
    <div className="space-y-6">
      {/* Stats */}
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

      {/* Timeline */}
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
                  <p className="text-xs text-muted">{fmtDate(job.date)} &middot; {job.duration || 0} days &middot; {job.job_type || "rental"}</p>
                </div>
                {job.revenue > 0 && (
                  <span className="text-sm font-medium text-brand">${Number(job.revenue).toLocaleString()}</span>
                )}
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
    const logs = (meta.maintenance_log || []) as MaintenanceRecord[];
    setRecords(logs);
  }, [asset.id]);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updatedLog = [
        ...records,
        {
          id: crypto.randomUUID(),
          date: new Date().toISOString(),
          type: newRecord.type,
          description: newRecord.description,
          cost: Number(newRecord.cost) || 0,
        },
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

  const inputClass = "w-full rounded-lg bg-[#111C2E] border border-[#1E2D45] px-4 py-2.5 text-sm text-white placeholder-muted outline-none transition-colors focus:border-brand";
  const labelClass = "block text-sm font-medium text-[#7A8BA3] mb-1.5";

  return (
    <div className="space-y-6">
      {/* Total Cost */}
      <div className="rounded-xl border border-[#1E2D45] bg-[#111C2E] p-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-muted">Total Maintenance Cost</p>
          <p className="text-lg font-bold text-white">{totalMaintenanceCost > 0 ? `$${Number(totalMaintenanceCost).toLocaleString()}` : "$0"}</p>
        </div>
        <button
          onClick={() => setAddOpen(!addOpen)}
          className="flex items-center gap-1.5 rounded-lg bg-brand/10 text-brand px-3 py-1.5 text-xs font-medium hover:bg-brand/20 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Record
        </button>
      </div>

      {/* Add form */}
      {addOpen && (
        <form onSubmit={handleAdd} className="rounded-xl border border-brand/20 bg-brand/5 p-4 space-y-3">
          <div>
            <label className={labelClass}>Type</label>
            <select value={newRecord.type} onChange={(e) => setNewRecord({ ...newRecord, type: e.target.value })} className={`${inputClass} appearance-none`}>
              <option value="inspection">Inspection</option>
              <option value="repair">Repair</option>
              <option value="cleaning">Cleaning</option>
              <option value="painting">Painting</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Description</label>
            <input value={newRecord.description} onChange={(e) => setNewRecord({ ...newRecord, description: e.target.value })} className={inputClass} placeholder="What was done..." required />
          </div>
          <div>
            <label className={labelClass}>Cost ($)</label>
            <input type="number" step="0.01" value={newRecord.cost} onChange={(e) => setNewRecord({ ...newRecord, cost: e.target.value })} className={inputClass} placeholder="0.00" />
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

      {/* Records */}
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
              {record.cost > 0 && (
                <span className="text-sm font-medium text-red-400">-${Number(record.cost).toLocaleString()}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── 7-Day Forecast ─── */

function ForecastTable({ forecast }: { forecast: AvailabilityDay[] }) {
  if (forecast.length === 0) return null;

  const sizes = ["10yd", "20yd", "30yd", "40yd"];
  const dates: string[] = [];
  const today = new Date();
  for (let d = 0; d < 7; d++) {
    const date = new Date(today);
    date.setDate(today.getDate() + d);
    dates.push(date.toISOString().split("T")[0]);
  }

  const getCell = (size: string, date: string): AvailabilityDay | undefined =>
    forecast.find((f) => f.subtype === size && f.date === date);

  const cellColor = (available: number, total: number): string => {
    if (total === 0) return "text-zinc-500";
    if (available === 0) return "bg-red-500/10 text-red-400 font-semibold";
    if (available <= 2) return "bg-yellow-500/10 text-yellow-400 font-medium";
    return "bg-emerald-500/10 text-emerald-400";
  };

  return (
    <div className="mt-10">
      <h3 className="font-display text-lg font-semibold text-white mb-1">7-Day Availability Forecast</h3>
      <p className="text-xs text-muted mb-4">Projected available units per size per day</p>
      <div className="rounded-2xl border border-[#1E2D45] bg-dark-card overflow-hidden">
        <div className="table-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1E2D45]">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">Size</th>
                {dates.map((date) => (
                  <th key={date} className="px-3 py-3 text-center text-xs font-medium text-muted">
                    {new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sizes.map((size) => (
                <tr key={size} className="border-b border-[#1E2D45] last:border-0">
                  <td className="px-4 py-2.5 text-sm font-medium text-white">{size}</td>
                  {dates.map((date) => {
                    const cell = getCell(size, date);
                    const available = cell?.availableOnDate ?? 0;
                    const total = cell?.total ?? 0;
                    return (
                      <td key={date} className="px-3 py-2.5 text-center">
                        <span className={`inline-flex rounded-md px-2 py-0.5 text-xs tabular-nums ${cellColor(available, total)}`}>
                          {available}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── Create Asset Form ─── */

function CreateAssetForm({ onSuccess }: { onSuccess: () => void }) {
  const [assetType, setAssetType] = useState("dumpster");
  const [subtype, setSubtype] = useState("20yd");
  const [identifier, setIdentifier] = useState("");
  const [dailyRate, setDailyRate] = useState("");
  const [weightCapacity, setWeightCapacity] = useState("");
  const [condition, setCondition] = useState("good");
  const [notes, setNotes] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Auto-suggest identifier
  useEffect(() => {
    const prefix = TYPE_PREFIX[assetType] || "A";
    const sizeNum = subtype.replace(/\D/g, "") || subtype;
    setIdentifier(`${prefix}-${sizeNum}-001`);
  }, [assetType, subtype]);

  // Update subtype when type changes
  useEffect(() => {
    const subtypes = SUBTYPES_BY_TYPE[assetType];
    if (subtypes?.length) setSubtype(subtypes[0].value);
  }, [assetType]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);

    const qty = Math.max(1, Math.min(50, parseInt(quantity) || 1));

    try {
      if (qty === 1) {
        await api.post("/assets", {
          assetType,
          subtype,
          identifier,
          dailyRate: dailyRate ? Number(dailyRate) : undefined,
          weightCapacity: weightCapacity ? Number(weightCapacity) : undefined,
          condition,
          notes: notes || undefined,
        });
      } else {
        // Batch create: increment the trailing number
        const match = identifier.match(/^(.*?)(\d+)$/);
        const prefix = match ? match[1] : identifier + "-";
        const startNum = match ? parseInt(match[2]) : 1;

        for (let i = 0; i < qty; i++) {
          const num = startNum + i;
          const id = `${prefix}${String(num).padStart(3, "0")}`;
          await api.post("/assets", {
            assetType,
            subtype,
            identifier: id,
            dailyRate: dailyRate ? Number(dailyRate) : undefined,
            weightCapacity: weightCapacity ? Number(weightCapacity) : undefined,
            condition,
            notes: notes || undefined,
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

  const inputClass = "w-full rounded-lg bg-[#111C2E] border border-[#1E2D45] px-4 py-2.5 text-sm text-white placeholder-muted outline-none transition-colors focus:border-brand";
  const labelClass = "block text-sm font-medium text-[#7A8BA3] mb-1.5";

  const qty = parseInt(quantity) || 1;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <div>
        <label className={labelClass}>Asset Type</label>
        <select value={assetType} onChange={(e) => setAssetType(e.target.value)} className={`${inputClass} appearance-none`}>
          <option value="dumpster">Dumpster</option>
          <option value="storage_container">Storage Container</option>
          <option value="portable_restroom">Portable Restroom</option>
        </select>
      </div>

      <div>
        <label className={labelClass}>Size / Subtype</label>
        <select value={subtype} onChange={(e) => setSubtype(e.target.value)} className={`${inputClass} appearance-none`}>
          {(SUBTYPES_BY_TYPE[assetType] || []).map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass}>Identifier</label>
        <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} required className={inputClass} placeholder="D-20-001" />
        {qty > 1 && (
          <p className="mt-1.5 text-xs text-muted">
            Will create: {identifier} through {(() => {
              const match = identifier.match(/^(.*?)(\d+)$/);
              if (!match) return `${identifier}-${String(qty).padStart(3, "0")}`;
              const prefix = match[1];
              const startNum = parseInt(match[2]);
              return `${prefix}${String(startNum + qty - 1).padStart(3, "0")}`;
            })()}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Daily Rate ($)</label>
          <input type="number" step="0.01" value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} className={inputClass} placeholder="25.00" />
        </div>
        <div>
          <label className={labelClass}>Weight Capacity (lbs)</label>
          <input type="number" value={weightCapacity} onChange={(e) => setWeightCapacity(e.target.value)} className={inputClass} placeholder="4000" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Condition</label>
          <select value={condition} onChange={(e) => setCondition(e.target.value)} className={`${inputClass} appearance-none`}>
            <option value="good">Good</option>
            <option value="new">New</option>
            <option value="fair">Fair</option>
            <option value="poor">Poor</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Quantity</label>
          <input type="number" min="1" max="50" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={inputClass} placeholder="1" />
        </div>
      </div>

      <div>
        <label className={labelClass}>Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={`${inputClass} resize-none`} placeholder="Any notes about this asset..." />
      </div>

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1FA855] disabled:opacity-50 btn-press"
      >
        {saving ? "Creating..." : qty > 1 ? `Add ${qty} × ${subtype} ${assetType === "dumpster" ? "dumpsters" : assetType === "storage_container" ? "containers" : "restrooms"}` : "Add Asset"}
      </button>
    </form>
  );
}
