"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Users,
  Briefcase,
  Package,
  CreditCard,
  UserCircle,
  Shield,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/api";

interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  businessType: string;
  subscriptionTier: string;
  subscriptionStatus: string;
  stripeCustomerId: string | null;
  isActive: boolean;
  createdAt: string;
  trialEndsAt: string | null;
  jobCount: number;
  customerCount: number;
  assetCount: number;
  users: Array<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    isActive: boolean;
    lastLoginAt: string | null;
    createdAt: string;
  }>;
}

const TIERS = ["trial", "starter", "professional", "business"];

export default function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    api
      .get<TenantDetail>(`/admin/tenants/${id}`)
      .then(setTenant)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const handleChangePlan = async (tier: string) => {
    if (!confirm(`Change plan to ${tier}?`)) return;
    setUpdating(true);
    try {
      const updated = await api.patch<TenantDetail>(`/admin/tenants/${id}`, {
        subscriptionTier: tier,
        subscriptionStatus: tier === "trial" ? "trialing" : "active",
      });
      setTenant(updated);
    } catch { /* */ }
    finally { setUpdating(false); }
  };

  const handleToggleActive = async () => {
    if (!tenant) return;
    const action = tenant.isActive ? "deactivate" : "reactivate";
    if (!confirm(`${action} this tenant?`)) return;
    setUpdating(true);
    try {
      const updated = await api.patch<TenantDetail>(`/admin/tenants/${id}`, {
        isActive: !tenant.isActive,
      });
      setTenant(updated);
    } catch { /* */ }
    finally { setUpdating(false); }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-6 w-40 animate-pulse rounded bg-gray-200" />
        <div className="h-64 animate-pulse rounded-xl bg-gray-200" />
      </div>
    );
  }

  if (!tenant) {
    return <div className="py-20 text-center text-gray-500">Tenant not found</div>;
  }

  const tierBadge: Record<string, string> = {
    trial: "bg-gray-100 text-gray-600",
    starter: "bg-blue-100 text-blue-700",
    professional: "bg-purple-100 text-purple-700",
    business: "bg-amber-100 text-amber-700",
  };

  const roleBadge: Record<string, string> = {
    owner: "bg-amber-100 text-amber-700",
    admin: "bg-purple-100 text-purple-700",
    dispatcher: "bg-blue-100 text-blue-700",
    driver: "bg-cyan-100 text-cyan-700",
    viewer: "bg-gray-100 text-gray-600",
  };

  return (
    <div>
      <Link href="/admin/tenants" className="mb-6 inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Tenants
      </Link>

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{tenant.name}</h1>
          <p className="mt-1 text-sm text-gray-500">{tenant.slug} &middot; {tenant.businessType || "General"}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleToggleActive}
            disabled={updating}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
              tenant.isActive
                ? "bg-red-50 text-red-600 hover:bg-red-100"
                : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
            }`}
          >
            {tenant.isActive ? <><XCircle className="h-4 w-4" /> Deactivate</> : <><Shield className="h-4 w-4" /> Reactivate</>}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Info cards */}
        <div className="space-y-6 lg:col-span-1">
          {/* Status */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Subscription</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Tier</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${tierBadge[tenant.subscriptionTier] || tierBadge.trial}`}>
                  {tenant.subscriptionTier}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Status</span>
                <span className={`text-sm font-medium capitalize ${tenant.isActive ? "text-emerald-600" : "text-red-500"}`}>
                  {tenant.subscriptionStatus}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Created</span>
                <span className="text-sm text-gray-700">{new Date(tenant.createdAt).toLocaleDateString()}</span>
              </div>
              {tenant.trialEndsAt && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Trial ends</span>
                  <span className="text-sm text-gray-700">{new Date(tenant.trialEndsAt).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          </div>

          {/* Change plan */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Change Plan</h2>
            <div className="grid grid-cols-2 gap-2">
              {TIERS.map((t) => (
                <button
                  key={t}
                  onClick={() => handleChangePlan(t)}
                  disabled={updating || tenant.subscriptionTier === t}
                  className={`rounded-lg py-2 text-xs font-medium capitalize transition-colors disabled:opacity-40 ${
                    tenant.subscriptionTier === t
                      ? "bg-[#2ECC71] text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Usage</h2>
            <div className="grid grid-cols-3 gap-4 text-center">
              {[
                { label: "Jobs", value: tenant.jobCount, icon: Briefcase },
                { label: "Customers", value: tenant.customerCount, icon: Users },
                { label: "Assets", value: tenant.assetCount, icon: Package },
              ].map((s) => (
                <div key={s.label}>
                  <s.icon className="mx-auto h-5 w-5 text-gray-400 mb-1" />
                  <p className="text-xl font-bold text-gray-900 tabular-nums">{s.value}</p>
                  <p className="text-[11px] text-gray-500">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Users table */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">Users ({tenant.users.length})</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    {["Name", "Email", "Role", "Status", "Last Login"].map((h) => (
                      <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tenant.users.map((u) => (
                    <tr key={u.id} className="border-b border-gray-50">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-600">
                            {u.firstName?.[0]}{u.lastName?.[0]}
                          </div>
                          <span className="font-medium text-gray-900">{u.firstName} {u.lastName}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-gray-600">{u.email}</td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${roleBadge[u.role] || roleBadge.viewer}`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center gap-1 text-xs ${u.isActive ? "text-emerald-600" : "text-red-400"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${u.isActive ? "bg-emerald-500" : "bg-red-400"}`} />
                          {u.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-gray-400">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "Never"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
