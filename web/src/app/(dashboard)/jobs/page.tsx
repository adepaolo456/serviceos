"use client";

import { useState, useEffect, useCallback, useRef, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, DollarSign, Briefcase } from "lucide-react";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";

interface Job {
  id: string;
  job_number: string;
  job_type: string;
  service_type: string;
  status: string;
  priority: string;
  scheduled_date: string;
  total_price: number;
  customer: { id: string; first_name: string; last_name: string } | null;
  asset: { id: string; identifier: string } | null;
  assigned_driver: {
    id: string;
    first_name: string;
    last_name: string;
  } | null;
}

interface JobsResponse {
  data: Job[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface StatusCount {
  status: string;
  count: number;
}

const STATUSES = [
  "all",
  "pending",
  "confirmed",
  "dispatched",
  "en_route",
  "in_progress",
  "completed",
  "cancelled",
] as const;

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/10 text-yellow-400",
  confirmed: "bg-blue-500/10 text-blue-400",
  dispatched: "bg-purple-500/10 text-purple-400",
  en_route: "bg-orange-500/10 text-orange-400",
  arrived: "bg-teal-500/10 text-teal-400",
  in_progress: "bg-brand/10 text-brand",
  completed: "bg-emerald-500/10 text-emerald-400",
  cancelled: "bg-red-500/10 text-red-400",
};

const JOB_TYPE_COLORS: Record<string, string> = {
  delivery: "bg-blue-500/10 text-blue-400",
  pickup: "bg-orange-500/10 text-orange-400",
  exchange: "bg-purple-500/10 text-purple-400",
};

export default function JobsPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [statusCounts, setStatusCounts] = useState<StatusCount[]>([]);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await api.get<JobsResponse>(`/jobs?${params.toString()}`);
      setJobs(res.data);
      setTotal(res.meta.total);
    } catch {
      /* handled */
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    api
      .get<StatusCount[]>("/analytics/jobs-by-status")
      .then(setStatusCounts)
      .catch(() => {});
  }, []);

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  const getCount = (s: string) => {
    if (s === "all")
      return statusCounts.reduce((sum, c) => sum + Number(c.count), 0);
    return Number(statusCounts.find((c) => c.status === s)?.count ?? 0);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            Jobs
          </h1>
          <p className="mt-1 text-muted">{total} jobs</p>
        </div>
        <button
          onClick={() => setPanelOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1FA855]"
        >
          <Plus className="h-4 w-4" />
          New Job
        </button>
      </div>

      {/* Tab filters */}
      <div className="mb-6 flex gap-0 overflow-x-auto border-b border-[#1E2D45]">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`relative shrink-0 px-4 py-3 text-sm font-medium capitalize transition-colors ${
              statusFilter === s
                ? "text-brand"
                : "text-muted hover:text-foreground"
            }`}
          >
            {s.replace(/_/g, " ")}
            <span
              className={`ml-1.5 text-xs ${statusFilter === s ? "text-brand" : "text-muted/60"}`}
            >
              {getCount(s)}
            </span>
            {statusFilter === s && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brand rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Job table */}
      <div className="rounded-2xl bg-dark-card overflow-hidden border border-[#1E2D45] shadow-lg shadow-black/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#1E2D45]">
              {["Job #", "Customer", "Type", "Date", "Driver", "Asset", "Status", "Price"].map(
                (h, i) => (
                  <th
                    key={h}
                    className={`px-5 py-3.5 text-xs font-medium uppercase tracking-wider text-muted ${
                      i >= 6 ? "text-right" : "text-left"
                    }`}
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <>
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={8} className="px-5 py-1">
                      <div className="h-12 w-full skeleton rounded" />
                    </td>
                  </tr>
                ))}
              </>
            ) : jobs.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <Briefcase size={48} className="text-[#7A8BA3]/30" />
                    <h3 className="text-lg font-semibold text-white">No jobs yet</h3>
                    <p className="text-sm text-muted">Create your first job to get started</p>
                    <button
                      type="button"
                      onClick={() => setPanelOpen(true)}
                      className="mt-2 flex items-center gap-2 rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1FA855]"
                    >
                      <Plus className="h-4 w-4" />
                      New Job
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              jobs.map((j) => (
                <tr
                  key={j.id}
                  onClick={() => router.push(`/jobs/${j.id}`)}
                  className="border-b border-[#1E2D45] last:border-0 cursor-pointer transition-colors hover:bg-[#1A2740]/50"
                >
                  <td className="px-5 py-4 font-medium text-white">
                    {j.job_number}
                  </td>
                  <td className="px-5 py-4 text-foreground">
                    {j.customer
                      ? `${j.customer.first_name} ${j.customer.last_name}`
                      : "—"}
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                        JOB_TYPE_COLORS[j.job_type] || "bg-zinc-500/10 text-zinc-400"
                      }`}
                    >
                      {j.job_type}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-foreground">
                    {j.scheduled_date || "—"}
                  </td>
                  <td className="px-5 py-4 text-foreground">
                    {j.assigned_driver
                      ? `${j.assigned_driver.first_name} ${j.assigned_driver.last_name}`
                      : "—"}
                  </td>
                  <td className="px-5 py-4 text-foreground">
                    {j.asset?.identifier || "—"}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        STATUS_COLORS[j.status] || "bg-zinc-500/10 text-zinc-400"
                      }`}
                    >
                      {j.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right text-foreground tabular-nums">
                    {j.total_price
                      ? `$${Number(j.total_price).toLocaleString()}`
                      : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > 20 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted">
          <span>
            Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of{" "}
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
              disabled={page * 20 >= total}
              className="rounded-lg bg-dark-card px-3 py-1.5 transition-colors hover:bg-dark-card-hover disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <SlideOver
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title="New Job"
      >
        <NewJobForm
          onSuccess={() => {
            setPanelOpen(false);
            fetchJobs();
          }}
        />
      </SlideOver>
    </div>
  );
}

/* ---------- New Job Form ---------- */

interface CustomerOption {
  id: string;
  first_name: string;
  last_name: string;
}

interface AssetOption {
  id: string;
  identifier: string;
  asset_type: string;
  subtype: string;
}

interface DriverOption {
  id: string;
  first_name: string;
  last_name: string;
}

interface PriceQuote {
  breakdown: {
    basePrice: number;
    total: number;
    tax: number;
    distanceSurcharge: number;
    extraDayCharges: number;
    jobFee: number;
  };
}

function NewJobForm({ onSuccess }: { onSuccess: () => void }) {
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerOption[]>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [selectedCustomerName, setSelectedCustomerName] = useState("");

  const [jobType, setJobType] = useState("delivery");
  const [serviceType, setServiceType] = useState("dumpster_rental");
  const [assetSubtype, setAssetSubtype] = useState("20yd");
  const [scheduledDate, setScheduledDate] = useState("");
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [addrState, setAddrState] = useState("");
  const [zip, setZip] = useState("");
  const [placementNotes, setPlacementNotes] = useState("");
  const [assetId, setAssetId] = useState("");
  const [driverId, setDriverId] = useState("");

  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [drivers] = useState<DriverOption[]>([]);
  const [priceQuote, setPriceQuote] = useState<PriceQuote | null>(null);

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(null);

  // Load assets and drivers
  useEffect(() => {
    api
      .get<{ data: AssetOption[] }>("/assets?status=available&limit=100")
      .then((r) => setAssets(r.data))
      .catch(() => {});
    api
      .get<DriverOption[]>("/dispatch/unassigned")
      .catch(() => {})
      .then(() => {
        // Get drivers from profile — fallback: fetch users who are drivers
        // For now just leave empty, user can skip
      });
  }, []);

  // Customer search
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!customerSearch || customerSearch.length < 2) {
      setCustomerResults([]);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await api.get<{ data: CustomerOption[] }>(
          `/customers?search=${encodeURIComponent(customerSearch)}&limit=8`
        );
        setCustomerResults(res.data);
        setShowCustomerDropdown(true);
      } catch {
        /* */
      }
    }, 300);
  }, [customerSearch]);

  // Price calculation
  useEffect(() => {
    if (!serviceType || !assetSubtype) return;
    api
      .post<PriceQuote>("/pricing/calculate", {
        serviceType,
        assetSubtype,
        jobType,
        customerLat: 30.27,
        customerLng: -97.74,
        yardLat: 30.35,
        yardLng: -97.7,
      })
      .then(setPriceQuote)
      .catch(() => setPriceQuote(null));
  }, [serviceType, assetSubtype, jobType]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!customerId) {
      setError("Please select a customer");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const serviceAddress =
        street || city || addrState || zip
          ? { street, city, state: addrState, zip }
          : undefined;
      await api.post("/jobs", {
        customerId,
        jobType,
        serviceType,
        scheduledDate: scheduledDate || undefined,
        scheduledWindowStart: windowStart || undefined,
        scheduledWindowEnd: windowEnd || undefined,
        serviceAddress,
        placementNotes: placementNotes || undefined,
        assetId: assetId || undefined,
        assignedDriverId: driverId || undefined,
        basePrice: priceQuote?.breakdown.basePrice,
        totalPrice: priceQuote?.breakdown.total,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full rounded-lg bg-[#111C2E] border border-[#1E2D45] px-4 py-2.5 text-sm text-white placeholder-muted outline-none transition-colors focus:border-brand";
  const labelClass = "block text-sm font-medium text-[#7A8BA3] mb-1.5";
  const selectClass = `${inputClass} appearance-none`;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Customer search */}
      <div className="relative">
        <label className={labelClass}>Customer</label>
        {selectedCustomerName ? (
          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-dark-card px-4 py-2.5">
            <span className="text-sm text-white">{selectedCustomerName}</span>
            <button
              type="button"
              onClick={() => {
                setCustomerId("");
                setSelectedCustomerName("");
                setCustomerSearch("");
              }}
              className="text-xs text-muted hover:text-red-400"
            >
              Clear
            </button>
          </div>
        ) : (
          <input
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            onFocus={() =>
              customerResults.length > 0 && setShowCustomerDropdown(true)
            }
            className={inputClass}
            placeholder="Search customers..."
          />
        )}
        {showCustomerDropdown && customerResults.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-lg border border-white/10 bg-dark-secondary shadow-xl">
            {customerResults.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setCustomerId(c.id);
                  setSelectedCustomerName(
                    `${c.first_name} ${c.last_name}`
                  );
                  setShowCustomerDropdown(false);
                  setCustomerSearch("");
                }}
                className="w-full px-4 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-dark-card-hover first:rounded-t-lg last:rounded-b-lg"
              >
                {c.first_name} {c.last_name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Job Type</label>
          <select
            value={jobType}
            onChange={(e) => setJobType(e.target.value)}
            className={selectClass}
          >
            <option value="delivery">Delivery</option>
            <option value="pickup">Pickup</option>
            <option value="exchange">Exchange</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Service Type</label>
          <select
            value={serviceType}
            onChange={(e) => setServiceType(e.target.value)}
            className={selectClass}
          >
            <option value="dumpster_rental">Dumpster Rental</option>
            <option value="pod_storage">Pod Storage</option>
            <option value="restroom_service">Restroom Service</option>
            <option value="landscaping">Landscaping</option>
          </select>
        </div>
      </div>

      <div>
        <label className={labelClass}>Asset Size</label>
        <div className="flex gap-1 rounded-lg bg-dark-card p-1">
          {["10yd", "20yd", "30yd", "40yd"].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setAssetSubtype(s)}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
                assetSubtype === s
                  ? "bg-brand text-dark-primary"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={labelClass}>Scheduled Date</label>
        <input
          type="date"
          value={scheduledDate}
          onChange={(e) => setScheduledDate(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Window Start</label>
          <input
            type="time"
            value={windowStart}
            onChange={(e) => setWindowStart(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Window End</label>
          <input
            type="time"
            value={windowEnd}
            onChange={(e) => setWindowEnd(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-foreground mb-3">
          Service Address
        </legend>
        <div className="space-y-3">
          <input
            value={street}
            onChange={(e) => setStreet(e.target.value)}
            className={inputClass}
            placeholder="Street address"
          />
          <div className="grid grid-cols-3 gap-3">
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className={inputClass}
              placeholder="City"
            />
            <input
              value={addrState}
              onChange={(e) => setAddrState(e.target.value)}
              className={inputClass}
              placeholder="State"
            />
            <input
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              className={inputClass}
              placeholder="ZIP"
            />
          </div>
        </div>
      </fieldset>

      <div>
        <label className={labelClass}>Placement Notes</label>
        <textarea
          value={placementNotes}
          onChange={(e) => setPlacementNotes(e.target.value)}
          rows={2}
          className={`${inputClass} resize-none`}
          placeholder="Place in driveway, not on grass..."
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Assign Asset</label>
          <select
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
            className={selectClass}
          >
            <option value="">None</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.identifier} ({a.subtype || a.asset_type})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Assign Driver</label>
          <select
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
            className={selectClass}
          >
            <option value="">None</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.first_name} {d.last_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Price quote */}
      {priceQuote && (
        <div className="rounded-lg border border-brand/20 bg-brand/5 p-4">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-4 w-4 text-brand" />
            <span className="text-sm font-medium text-brand">
              Price Estimate
            </span>
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-foreground">
              <span>Base price</span>
              <span>${priceQuote.breakdown.basePrice}</span>
            </div>
            {priceQuote.breakdown.jobFee > 0 && (
              <div className="flex justify-between text-foreground">
                <span>Job fee</span>
                <span>${priceQuote.breakdown.jobFee}</span>
              </div>
            )}
            {priceQuote.breakdown.distanceSurcharge > 0 && (
              <div className="flex justify-between text-foreground">
                <span>Distance</span>
                <span>${priceQuote.breakdown.distanceSurcharge}</span>
              </div>
            )}
            {priceQuote.breakdown.tax > 0 && (
              <div className="flex justify-between text-foreground">
                <span>Tax</span>
                <span>${priceQuote.breakdown.tax}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-white/10 pt-2 font-semibold text-white">
              <span>Total</span>
              <span>${priceQuote.breakdown.total}</span>
            </div>
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1FA855] disabled:opacity-50"
      >
        {saving ? "Creating..." : "Create Job"}
      </button>
    </form>
  );
}
