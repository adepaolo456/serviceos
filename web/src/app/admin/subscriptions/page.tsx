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

const tierBadge: Record<string, string> = {
  starter: "bg-blue-100 text-blue-700",
  professional: "bg-purple-100 text-purple-700",
  business: "bg-amber-100 text-amber-700",
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
        <div className="mb-8 h-8 w-48 animate-pulse rounded bg-gray-200" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-200" />)}
        </div>
      </div>
    );
  }

  const maxTierMrr = Math.max(...(data?.tierBreakdown ?? []).map((t) => t.mrr), 1);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Subscriptions</h1>
        <p className="mt-1 text-sm text-gray-500">Revenue and subscription analytics</p>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-8">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <DollarSign className="h-4.5 w-4.5" />
            </div>
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Monthly Revenue</span>
          </div>
          <p className="text-3xl font-bold text-gray-900 tabular-nums">${(data?.totalMrr ?? 0).toLocaleString()}</p>
        </div>
        <button
          onClick={() => subscribersRef.current?.scrollIntoView({ behavior: "smooth" })}
          className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm text-left cursor-pointer transition-all hover:shadow-lg hover:border-[#2ECC71]/30"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
              <CreditCard className="h-4.5 w-4.5" />
            </div>
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Active Subscribers</span>
          </div>
          <p className="text-3xl font-bold text-gray-900 tabular-nums">{data?.totalActive ?? 0}</p>
        </button>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <TrendingUp className="h-4.5 w-4.5" />
            </div>
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Revenue/Tenant</span>
          </div>
          <p className="text-3xl font-bold text-gray-900 tabular-nums">
            ${data?.totalActive ? Math.round((data.totalMrr ?? 0) / data.totalActive).toLocaleString() : "0"}
          </p>
        </div>
      </div>

      {/* MRR by tier */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm mb-8">
        <h2 className="text-base font-semibold text-gray-900 mb-5">MRR by Tier</h2>
        <div className="space-y-4">
          {(data?.tierBreakdown ?? []).map((t) => (
            <Link key={t.tier} href={`/admin/tenants?tier=${t.tier}`} className="block rounded-lg p-2 -mx-2 transition-colors hover:bg-gray-50 cursor-pointer">
              <div className="flex items-center justify-between text-sm mb-1.5">
                <span className="font-medium text-gray-700 capitalize">{t.tier}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500">{t.count} tenants</span>
                  <span className="font-semibold text-gray-900 tabular-nums">${t.mrr.toLocaleString()}/mo</span>
                </div>
              </div>
              <div className="h-3 w-full rounded-full bg-gray-100 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${tierBarColor[t.tier] || "bg-gray-400"}`}
                  style={{ width: `${(t.mrr / maxTierMrr) * 100}%` }}
                />
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Subscriber list */}
      <div ref={subscribersRef} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Active Subscribers</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                {["Company", "Owner", "Tier", "MRR", "Since"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.subscribers ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-16 text-center">
                    <Building2 className="mx-auto h-12 w-12 text-gray-300 mb-3" />
                    <p className="text-sm text-gray-500">No active subscribers yet</p>
                  </td>
                </tr>
              ) : (
                (data?.subscribers ?? []).map((s) => (
                  <tr key={s.id} onClick={() => router.push(`/admin/tenants/${s.id}`)} className="border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer">
                    <td className="px-5 py-3.5 font-medium text-gray-900">{s.name}</td>
                    <td className="px-5 py-3.5 text-gray-600">{s.ownerEmail}</td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${tierBadge[s.tier || ""] || "bg-gray-100 text-gray-600"}`}>
                        {s.tier}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-medium text-gray-900 tabular-nums">${s.mrr}/mo</td>
                    <td className="px-5 py-3.5 text-xs text-gray-400">{new Date(s.createdAt).toLocaleDateString()}</td>
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
