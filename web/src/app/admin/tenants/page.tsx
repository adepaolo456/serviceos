"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Building2 } from "lucide-react";
import { api } from "@/lib/api";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  businessType: string;
  subscriptionTier: string;
  subscriptionStatus: string;
  isActive: boolean;
  ownerEmail: string;
  userCount: number;
  jobCount: number;
  createdAt: string;
}

interface TenantsResponse {
  data: Tenant[];
  meta: { total: number; page: number; limit: number };
}

const TIER_FILTERS = ["all", "trial", "starter", "professional", "business"];

const tierBadge: Record<string, string> = {
  trial: "bg-gray-100 text-gray-600",
  starter: "bg-blue-100 text-blue-700",
  professional: "bg-purple-100 text-purple-700",
  business: "bg-amber-100 text-amber-700",
};

const statusBadge: Record<string, string> = {
  trialing: "bg-gray-100 text-gray-600",
  active: "bg-emerald-100 text-emerald-700",
  past_due: "bg-red-100 text-red-700",
  cancelled: "bg-red-50 text-red-500",
};

export default function TenantsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState(searchParams.get("tier") || "all");
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (search) params.set("search", search);
      if (tierFilter !== "all") params.set("tier", tierFilter);
      const res = await api.get<TenantsResponse>(`/admin/tenants?${params}`);
      setTenants(res.data);
      setTotal(res.meta.total);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [search, tierFilter]);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tenants</h1>
          <p className="mt-1 text-sm text-gray-500">{total} registered companies</p>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search tenants..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-[#2ECC71] focus:ring-1 focus:ring-[#2ECC71]"
          />
        </div>
        <div className="flex gap-1">
          {TIER_FILTERS.map((t) => (
            <button
              key={t}
              onClick={() => setTierFilter(t)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                tierFilter === t
                  ? "bg-[#2ECC71] text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                {["Company", "Owner", "Tier", "Status", "Users", "Jobs", "Created"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td colSpan={7} className="px-5 py-4"><div className="h-5 w-full animate-pulse rounded bg-gray-100" /></td>
                  </tr>
                ))
              ) : tenants.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <Building2 className="mx-auto h-12 w-12 text-gray-300 mb-3" />
                    <p className="text-sm font-medium text-gray-500">No tenants found</p>
                  </td>
                </tr>
              ) : tenants.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => router.push(`/admin/tenants/${t.id}`)}
                  className="border-b border-gray-50 cursor-pointer transition-colors hover:bg-gray-50"
                >
                  <td className="px-5 py-3.5">
                    <div>
                      <p className="font-medium text-gray-900">{t.name}</p>
                      <p className="text-xs text-gray-400">{t.slug}</p>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-gray-600">{t.ownerEmail}</td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${tierBadge[t.subscriptionTier] || tierBadge.trial}`}>
                      {t.subscriptionTier}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusBadge[t.subscriptionStatus] || statusBadge.trialing}`}>
                      {t.subscriptionStatus}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-gray-600 tabular-nums">{t.userCount}</td>
                  <td className="px-5 py-3.5 text-gray-600 tabular-nums">{t.jobCount}</td>
                  <td className="px-5 py-3.5 text-gray-400 text-xs">{new Date(t.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
