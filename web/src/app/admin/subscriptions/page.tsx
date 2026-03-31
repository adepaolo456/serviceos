"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DollarSign,
  TrendingUp,
  CreditCard,
  Building2,
} from "lucide-react";
import { api } from "@/lib/api";

interface Subscriber {
  id: string;
  name: string;
  tier: string;
  status: string;
  ownerEmail: string;
  mrr: number;
  createdAt: string;
}

interface SubsData {
  totalMrr: number;
  totalActive: number;
  tierBreakdown: Array<{ tier: string; count: number; mrr: number }>;
  subscribers: Subscriber[];
}

const tierColors: Record<string, string> = {
  starter: "text-blue-400",
  professional: "text-purple-400",
  business: "text-amber-400",
};

const tierBarColor: Record<string, string> = {
  starter: "bg-blue-500",
  professional: "bg-purple-500",
  business: "bg-amber-500",
};

export default function SubscriptionsPage() {
  const router = useRouter();
  const subscribersRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<SubsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<SubsData>("/admin/subscriptions")
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div>
        <div className="mb-8 h-8 w-48 animate-pulse rounded bg-[var(--t-bg-card)]" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-[18px] bg-[var(--t-bg-card)] border border-[var(--t-border)]" />)}
        </div>
      </div>
    );
  }

  const maxTierMrr = Math.max(...(data?.tierBreakdown ?? []).map((t) => t.mrr), 1);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-text-primary)]">Subscriptions</h1>
        <p className="mt-1 text-sm text-[var(--t-text-muted)]">Revenue and subscription analytics</p>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-8">
        <div className="rounded-[18px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
          <div className="flex items-center gap-3 mb-3">
            <DollarSign className="h-4.5 w-4.5 text-[var(--t-text-muted)]" />
            <span className="text-xs font-medium text-[var(--t-text-muted)] uppercase tracking-wider">Monthly Revenue</span>
          </div>
          <p className="text-3xl font-bold text-[var(--t-text-primary)] tabular-nums">${(data?.totalMrr ?? 0).toLocaleString()}</p>
        </div>
        <button
          onClick={() => subscribersRef.current?.scrollIntoView({ behavior: "smooth" })}
          className="rounded-[18px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5 text-left cursor-pointer transition-colors hover:bg-[var(--t-bg-card-hover)]"
        >
          <div className="flex items-center gap-3 mb-3">
            <CreditCard className="h-4.5 w-4.5 text-[var(--t-text-muted)]" />
            <span className="text-xs font-medium text-[var(--t-text-muted)] uppercase tracking-wider">Active Subscribers</span>
          </div>
          <p className="text-3xl font-bold text-[var(--t-text-primary)] tabular-nums">{data?.totalActive ?? 0}</p>
        </button>
        <div className="rounded-[18px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
          <div className="flex items-center gap-3 mb-3">
            <TrendingUp className="h-4.5 w-4.5 text-[var(--t-text-muted)]" />
            <span className="text-xs font-medium text-[var(--t-text-muted)] uppercase tracking-wider">Avg Revenue/Tenant</span>
          </div>
          <p className="text-3xl font-bold text-[var(--t-text-primary)] tabular-nums">
            ${data?.totalActive ? Math.round((data.totalMrr ?? 0) / data.totalActive).toLocaleString() : "0"}
          </p>
        </div>
      </div>

      {/* MRR by tier */}
      <div className="rounded-[18px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6 mb-8">
        <h2 className="text-base font-semibold text-[var(--t-text-primary)] mb-5">MRR by Tier</h2>
        <div className="space-y-4">
          {(data?.tierBreakdown ?? []).map((t) => (
            <Link key={t.tier} href={`/admin/tenants?tier=${t.tier}`} className="block rounded-[18px] p-2 -mx-2 transition-colors hover:bg-[var(--t-bg-card-hover)] cursor-pointer">
              <div className="flex items-center justify-between text-sm mb-1.5">
                <span className={`font-medium capitalize ${tierColors[t.tier] || "text-[var(--t-text-muted)]"}`}>{t.tier}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[var(--t-text-muted)]">{t.count} tenants</span>
                  <span className="font-semibold text-[var(--t-text-primary)] tabular-nums">${t.mrr.toLocaleString()}/mo</span>
                </div>
              </div>
              <div className="h-3 w-full rounded-full bg-[var(--t-border)] overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${tierBarColor[t.tier] || "bg-[var(--t-text-muted)]"}`}
                  style={{ width: `${(t.mrr / maxTierMrr) * 100}%` }}
                />
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Subscriber list */}
      <div ref={subscribersRef} className="rounded-[18px] border border-[var(--t-border)] bg-[var(--t-bg-card)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--t-border)]">
          <h2 className="text-base font-semibold text-[var(--t-text-primary)]">Active Subscribers</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--t-border)]">
                {["Company", "Owner", "Tier", "MRR", "Since"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.subscribers ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-16 text-center">
                    <Building2 className="mx-auto h-12 w-12 text-[var(--t-text-muted)]/20 mb-3" />
                    <p className="text-sm text-[var(--t-text-muted)]">No active subscribers yet</p>
                  </td>
                </tr>
              ) : (
                (data?.subscribers ?? []).map((s) => (
                  <tr key={s.id} onClick={() => router.push(`/admin/tenants/${s.id}`)} className="border-b border-[var(--t-border)] last:border-0 hover:bg-[var(--t-bg-card-hover)] transition-colors cursor-pointer">
                    <td className="px-5 py-3.5 font-medium text-[var(--t-text-primary)]">{s.name}</td>
                    <td className="px-5 py-3.5 text-[var(--t-text-muted)]">{s.ownerEmail}</td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs font-medium capitalize ${tierColors[s.tier || ""] || "text-[var(--t-text-muted)]"}`}>
                        {s.tier}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-medium text-[var(--t-text-primary)] tabular-nums">${s.mrr}/mo</td>
                    <td className="px-5 py-3.5 text-xs text-[var(--t-text-muted)]">{new Date(s.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
