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
        <div className="h-6 w-40 animate-pulse rounded bg-[var(--t-bg-card)]" />
        <div className="h-64 animate-pulse rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)]" />
      </div>
    );
  }

  if (!tenant) {
    return <div className="py-20 text-center text-[var(--t-text-muted)]">Tenant not found</div>;
  }

  const tierColors: Record<string, string> = {
    trial: "text-[var(--t-text-muted)]",
    starter: "text-blue-400",
    professional: "text-purple-400",
    business: "text-amber-400",
  };

  const roleColors: Record<string, string> = {
    owner: "text-amber-400",
    admin: "text-purple-400",
    dispatcher: "text-blue-400",
    driver: "text-cyan-400",
    viewer: "text-[var(--t-text-muted)]",
  };

  return (
    <div>
      <Link href="/admin/tenants" className="mb-6 inline-flex items-center gap-2 text-sm text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Tenants
      </Link>

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-1px]" style={{ color: "var(--t-frame-text)" }}>{tenant.name}</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--t-frame-text-muted)" }}>{tenant.slug} &middot; {tenant.businessType || "General"}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleToggleActive}
            disabled={updating}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
              tenant.isActive
                ? "border border-[var(--t-error)]/20 text-[var(--t-error)] hover:bg-[var(--t-error-soft)]"
                : "border border-[var(--t-accent)]/20 text-[var(--t-accent)] hover:bg-[var(--t-accent-soft)]"
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
          <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
            <h2 className="text-sm font-semibold text-[var(--t-text-primary)] mb-4">Subscription</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--t-text-muted)]">Tier</span>
                <span className={`text-xs font-medium capitalize ${tierColors[tenant.subscriptionTier] || tierColors.trial}`}>
                  {tenant.subscriptionTier}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--t-text-muted)]">Status</span>
                <span className={`text-sm font-medium capitalize ${tenant.isActive ? "text-[var(--t-accent)]" : "text-[var(--t-error)]"}`}>
                  {tenant.subscriptionStatus}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--t-text-muted)]">Created</span>
                <span className="text-sm text-[var(--t-text-primary)]">{new Date(tenant.createdAt).toLocaleDateString()}</span>
              </div>
              {tenant.trialEndsAt && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[var(--t-text-muted)]">Trial ends</span>
                  <span className="text-sm text-[var(--t-text-primary)]">{new Date(tenant.trialEndsAt).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          </div>

          {/* Change plan */}
          <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
            <h2 className="text-sm font-semibold text-[var(--t-text-primary)] mb-3">Change Plan</h2>
            <div className="grid grid-cols-2 gap-2">
              {TIERS.map((t) => (
                <button
                  key={t}
                  onClick={() => handleChangePlan(t)}
                  disabled={updating || tenant.subscriptionTier === t}
                  className={`rounded-full py-2 text-xs font-medium capitalize transition-all disabled:opacity-40 ${
                    tenant.subscriptionTier === t
                      ? "bg-[var(--t-accent)] text-black"
                      : "border border-[var(--t-border)] text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)]"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Stats */}
          <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
            <h2 className="text-sm font-semibold text-[var(--t-text-primary)] mb-4">Usage</h2>
            <div className="grid grid-cols-3 gap-4 text-center">
              {[
                { label: "Jobs", value: tenant.jobCount, icon: Briefcase },
                { label: "Customers", value: tenant.customerCount, icon: Users },
                { label: "Assets", value: tenant.assetCount, icon: Package },
              ].map((s) => (
                <div key={s.label} className="group relative rounded-[20px] p-2 cursor-default transition-colors hover:bg-[var(--t-bg-card-hover)]" title="Coming soon: drill into tenant data">
                  <s.icon className="mx-auto h-5 w-5 text-[var(--t-text-muted)] mb-1 group-hover:text-[var(--t-accent)] transition-colors" />
                  <p className="text-xl font-bold text-[var(--t-text-primary)] tabular-nums">{s.value}</p>
                  <p className="text-[11px] text-[var(--t-text-muted)]">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Users table */}
        <div className="lg:col-span-2">
          <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--t-border)]">
              <h2 className="text-sm font-semibold text-[var(--t-text-primary)]">Users ({tenant.users.length})</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--t-border)]">
                    {["Name", "Email", "Role", "Status", "Last Login"].map((h) => (
                      <th key={h} className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tenant.users.map((u) => (
                    <tr key={u.id} className="border-b border-[var(--t-border)] last:border-0">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--t-border)] text-[10px] font-bold text-[var(--t-text-muted)]">
                            {u.firstName?.[0]}{u.lastName?.[0]}
                          </div>
                          <span className="font-medium text-[var(--t-text-primary)]">{u.firstName} {u.lastName}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-[var(--t-text-muted)]">{u.email}</td>
                      <td className="px-5 py-3.5">
                        <span className={`text-[10px] font-medium capitalize ${roleColors[u.role] || roleColors.viewer}`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex items-center gap-1 text-xs ${u.isActive ? "text-[var(--t-accent)]" : "text-[var(--t-error)]"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${u.isActive ? "bg-[var(--t-accent)]" : "bg-[var(--t-error)]"}`} />
                          {u.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-[var(--t-text-muted)]">
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
