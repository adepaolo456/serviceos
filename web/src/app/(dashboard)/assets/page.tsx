"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import {
  Plus,
  Box,
  MapPin,
  DollarSign,
  X,
  Wrench,
  Truck,
  CheckCircle2,
} from "lucide-react";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";

interface Asset {
  id: string;
  asset_type: string;
  subtype: string;
  identifier: string;
  status: string;
  condition: string;
  current_location_type: string;
  current_location: Record<string, string> | null;
  daily_rate: number;
  weight_capacity: number;
  notes: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface AssetsResponse {
  data: Asset[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const STATUS_TABS = ["all", "available", "on_site", "maintenance"] as const;
const TAB_LABELS: Record<string, string> = {
  all: "All",
  available: "Available",
  on_site: "Deployed",
  maintenance: "Maintenance",
};

const STATUS_BADGE: Record<string, { className: string; icon: typeof Box }> = {
  available: {
    className: "bg-brand/10 text-brand",
    icon: CheckCircle2,
  },
  on_site: {
    className: "bg-yellow-500/10 text-yellow-400",
    icon: Truck,
  },
  in_transit: {
    className: "bg-blue-500/10 text-blue-400",
    icon: Truck,
  },
  maintenance: {
    className: "bg-red-500/10 text-red-400",
    icon: Wrench,
  },
  retired: {
    className: "bg-zinc-500/10 text-zinc-400",
    icon: X,
  },
};

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [detailAsset, setDetailAsset] = useState<Asset | null>(null);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "24" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await api.get<AssetsResponse>(
        `/assets?${params.toString()}`
      );
      setAssets(res.data);
      setTotal(res.meta.total);
    } catch {
      /* handled */
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-white">
            Inventory
          </h1>
          <p className="mt-1 text-muted">{total} assets</p>
        </div>
        <button
          onClick={() => setPanelOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-dark-primary transition-colors hover:bg-brand-light"
        >
          <Plus className="h-4 w-4" />
          Add Asset
        </button>
      </div>

      {/* Status tabs */}
      <div className="mb-6 flex gap-0 border-b border-white/5">
        {STATUS_TABS.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`relative px-5 py-3 text-sm font-medium transition-colors ${
              statusFilter === s
                ? "text-brand"
                : "text-muted hover:text-foreground"
            }`}
          >
            {TAB_LABELS[s] || s}
            {statusFilter === s && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brand rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Asset grid */}
      {loading ? (
        <div className="py-32 text-center text-muted">Loading...</div>
      ) : assets.length === 0 ? (
        <div className="py-32 text-center text-muted">No assets found</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {assets.map((asset) => {
            const badge = STATUS_BADGE[asset.status] || STATUS_BADGE.available;
            const Icon = badge.icon;
            return (
              <button
                key={asset.id}
                onClick={() => setDetailAsset(asset)}
                className="group rounded-2xl bg-dark-card p-5 text-left transition-all hover:bg-dark-card-hover hover:ring-1 hover:ring-white/5"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-dark-elevated">
                    <Box className="h-5 w-5 text-muted" />
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-medium ${badge.className}`}
                  >
                    <Icon className="h-3 w-3" />
                    {asset.status.replace(/_/g, " ")}
                  </span>
                </div>

                <p className="font-display text-lg font-bold text-white truncate">
                  {asset.identifier}
                </p>
                <p className="text-xs text-muted capitalize">
                  {asset.asset_type}
                  {asset.subtype && ` · ${asset.subtype}`}
                </p>

                <div className="mt-4 flex items-center justify-between">
                  {asset.current_location_type ? (
                    <div className="flex items-center gap-1 text-xs text-muted">
                      <MapPin className="h-3 w-3" />
                      <span className="capitalize truncate max-w-[120px]">
                        {asset.current_location_type}
                      </span>
                    </div>
                  ) : (
                    <span />
                  )}
                  {asset.daily_rate > 0 && (
                    <div className="flex items-center gap-1 text-xs text-foreground">
                      <DollarSign className="h-3 w-3 text-brand" />
                      <span className="font-medium">
                        {Number(asset.daily_rate).toFixed(0)}/day
                      </span>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {total > 24 && (
        <div className="mt-6 flex items-center justify-between text-sm text-muted">
          <span>
            Showing {(page - 1) * 24 + 1}–{Math.min(page * 24, total)} of{" "}
            {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-lg bg-dark-card px-3 py-1.5 transition-colors hover:bg-dark-card-hover disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page * 24 >= total}
              className="rounded-lg bg-dark-card px-3 py-1.5 transition-colors hover:bg-dark-card-hover disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Create asset slide-over */}
      <SlideOver
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title="Add Asset"
      >
        <CreateAssetForm
          onSuccess={() => {
            setPanelOpen(false);
            fetchAssets();
          }}
        />
      </SlideOver>

      {/* Detail slide-over */}
      <SlideOver
        open={!!detailAsset}
        onClose={() => setDetailAsset(null)}
        title="Asset Details"
      >
        {detailAsset && <AssetDetail asset={detailAsset} />}
      </SlideOver>
    </div>
  );
}

/* ---------- Detail panel ---------- */

function AssetDetail({ asset }: { asset: Asset }) {
  const badge = STATUS_BADGE[asset.status] || STATUS_BADGE.available;
  const Icon = badge.icon;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-dark-elevated">
          <Box className="h-7 w-7 text-muted" />
        </div>
        <div>
          <h3 className="font-display text-xl font-bold text-white">
            {asset.identifier}
          </h3>
          <p className="text-sm text-muted capitalize">
            {asset.asset_type}
            {asset.subtype && ` · ${asset.subtype}`}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${badge.className}`}
        >
          <Icon className="h-3.5 w-3.5" />
          {asset.status.replace(/_/g, " ")}
        </span>
        {asset.condition && (
          <span className="rounded-full bg-dark-elevated px-3 py-1 text-xs font-medium text-muted capitalize">
            {asset.condition}
          </span>
        )}
      </div>

      <div className="space-y-3 rounded-xl bg-dark-card p-4">
        <DetailRow label="Daily Rate" value={asset.daily_rate > 0 ? `$${Number(asset.daily_rate).toFixed(2)}` : "—"} />
        <DetailRow label="Weight Capacity" value={asset.weight_capacity > 0 ? `${Number(asset.weight_capacity).toLocaleString()} lbs` : "—"} />
        <DetailRow label="Location Type" value={asset.current_location_type || "—"} capitalize />
        <DetailRow label="Created" value={new Date(asset.created_at).toLocaleDateString()} />
      </div>

      {asset.notes && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted mb-2">
            Notes
          </p>
          <p className="text-sm text-foreground whitespace-pre-wrap">
            {asset.notes}
          </p>
        </div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  capitalize: cap,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{label}</span>
      <span className={`text-foreground ${cap ? "capitalize" : ""}`}>
        {value}
      </span>
    </div>
  );
}

/* ---------- Create form ---------- */

function CreateAssetForm({ onSuccess }: { onSuccess: () => void }) {
  const [assetType, setAssetType] = useState("dumpster");
  const [subtype, setSubtype] = useState("20yd");
  const [identifier, setIdentifier] = useState("");
  const [dailyRate, setDailyRate] = useState("");
  const [weightCapacity, setWeightCapacity] = useState("");
  const [condition, setCondition] = useState("good");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api.post("/assets", {
        assetType,
        subtype: subtype || undefined,
        identifier,
        dailyRate: dailyRate ? Number(dailyRate) : undefined,
        weightCapacity: weightCapacity ? Number(weightCapacity) : undefined,
        condition,
        notes: notes || undefined,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-white/10 bg-dark-card px-4 py-2.5 text-sm text-white placeholder-muted outline-none transition-colors focus:border-brand";
  const labelClass = "block text-sm font-medium text-foreground mb-1.5";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div>
        <label className={labelClass}>Identifier</label>
        <input
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          required
          className={inputClass}
          placeholder="D-015"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Type</label>
          <select
            value={assetType}
            onChange={(e) => setAssetType(e.target.value)}
            className={`${inputClass} appearance-none`}
          >
            <option value="dumpster">Dumpster</option>
            <option value="pod">Pod</option>
            <option value="restroom">Restroom</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Size</label>
          <select
            value={subtype}
            onChange={(e) => setSubtype(e.target.value)}
            className={`${inputClass} appearance-none`}
          >
            <option value="10yd">10 yd</option>
            <option value="20yd">20 yd</option>
            <option value="30yd">30 yd</option>
            <option value="40yd">40 yd</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Daily Rate ($)</label>
          <input
            type="number"
            step="0.01"
            value={dailyRate}
            onChange={(e) => setDailyRate(e.target.value)}
            className={inputClass}
            placeholder="25.00"
          />
        </div>
        <div>
          <label className={labelClass}>Weight Capacity (lbs)</label>
          <input
            type="number"
            value={weightCapacity}
            onChange={(e) => setWeightCapacity(e.target.value)}
            className={inputClass}
            placeholder="4000"
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>Condition</label>
        <select
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          className={`${inputClass} appearance-none`}
        >
          <option value="new">New</option>
          <option value="good">Good</option>
          <option value="fair">Fair</option>
          <option value="poor">Poor</option>
        </select>
      </div>

      <div>
        <label className={labelClass}>Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className={`${inputClass} resize-none`}
          placeholder="Any notes about this asset..."
        />
      </div>

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-dark-primary transition-colors hover:bg-brand-light disabled:opacity-50"
      >
        {saving ? "Adding..." : "Add Asset"}
      </button>
    </form>
  );
}
