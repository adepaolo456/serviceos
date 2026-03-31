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

const tierColors: Record<string, string> = {
  trial: "text-[var(--t-text-muted)]",
  starter: "text-blue-400",
  professional: "text-purple-400",
  business: "text-amber-400",
};

const statusColors: Record<string, string> = {
  trialing: "text-[var(--t-text-muted)]",
  active: "text-[var(--t-accent)]",
  past_due: "text-[var(--t-error)]",
  cancelled: "text-[var(--t-error)]",
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
          <h1 className="text-[28px] font-bold tracking-[-1px]" style={{ color: "var(--t-frame-text)" }}>Tenants</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--t-frame-text-muted)" }}>{total} registered companies</p>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--t-text-muted)]" />
          <input
            type="text"
            placeholder="Search tenants..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-[20px] py-2.5 pl-10 pr-4 text-sm placeholder-white/40 outline-none transition-colors focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]"
            style={{ backgroundColor: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--t-frame-text)" }}
          />
        </div>
        <div className="flex gap-1">
          {TIER_FILTERS.map((t) => (
            <button
              key={t}
              onClick={() => setTierFilter(t)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                tierFilter === t
                  ? "bg-[var(--t-accent)] text-black"
                  : "border border-[var(--t-border)] text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)]"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--t-border)]">
                {["Company", "Owner", "Tier", "Status", "Users", "Jobs", "Created"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-[var(--t-border)]">
                    <td colSpan={7} className="px-5 py-4"><div className="h-5 w-full animate-pulse rounded bg-[var(--t-border)]" /></td>
                  </tr>
                ))
              ) : tenants.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <Building2 className="mx-auto h-12 w-12 text-[var(--t-text-muted)]/20 mb-3" />
                    <p className="text-sm font-medium text-[var(--t-text-muted)]">No tenants found</p>
                  </td>
                </tr>
              ) : tenants.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => router.push(`/admin/tenants/${t.id}`)}
                  className="border-b border-[var(--t-border)] last:border-0 cursor-pointer transition-colors hover:bg-[var(--t-bg-card-hover)]"
                >
                  <td className="px-5 py-3.5">
                    <div>
                      <p className="font-medium text-[var(--t-text-primary)]">{t.name}</p>
                      <p className="text-xs text-[var(--t-text-muted)]">{t.slug}</p>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-[var(--t-text-muted)]">{t.ownerEmail}</td>
                  <td className="px-5 py-3.5">
                    <span className={`text-xs font-medium capitalize ${tierColors[t.subscriptionTier] || tierColors.trial}`}>
                      {t.subscriptionTier}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`text-xs font-medium capitalize ${statusColors[t.subscriptionStatus] || statusColors.trialing}`}>
                      {t.subscriptionStatus}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-[var(--t-text-muted)] tabular-nums">{t.userCount}</td>
                  <td className="px-5 py-3.5 text-[var(--t-text-muted)] tabular-nums">{t.jobCount}</td>
                  <td className="px-5 py-3.5 text-[var(--t-text-muted)] text-xs">{new Date(t.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
