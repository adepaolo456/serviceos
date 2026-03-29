"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import {
  Building,
  Users,
  CreditCard,
  Plug,
  Upload,
  Copy,
  Check,
  Eye,
  EyeOff,
  ExternalLink,
  Zap,
  Globe,
  Key,
  Webhook,
  MapPin,
  Plus,
  Trash2,
  Star,
} from "lucide-react";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";

interface Profile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenant: {
    id: string;
    name: string;
    slug: string;
    subscriptionTier: string;
    subscriptionStatus: string;
  };
}

interface TeamMember {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

const TABS = [
  { key: "company", label: "Company Profile", icon: Building },
  { key: "locations", label: "Locations", icon: MapPin },
  { key: "team", label: "Team Members", icon: Users },
  { key: "billing", label: "Billing", icon: CreditCard },
  { key: "integrations", label: "Integrations", icon: Plug },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const ROLE_BADGE: Record<string, string> = {
  owner: "bg-brand/10 text-brand",
  admin: "bg-purple-500/10 text-purple-400",
  dispatcher: "bg-blue-500/10 text-blue-400",
  driver: "bg-orange-500/10 text-orange-400",
  viewer: "bg-zinc-500/10 text-zinc-400",
};

export default function SettingsPage() {
  const [tab, setTab] = useState<TabKey>("company");
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    api
      .get<Profile>("/auth/profile")
      .then(setProfile)
      .catch(() => {});
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">
          Settings
        </h1>
        <p className="mt-1 text-muted">Manage your account and preferences</p>
      </div>

      {/* Tabs */}
      <div className="mb-8 flex gap-0 border-b border-[#1E2D45]">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`relative flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors btn-press ${
                tab === t.key
                  ? "text-brand"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
              {tab === t.key && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brand rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {tab === "company" && <CompanyTab profile={profile} />}
      {tab === "locations" && <LocationsTab />}
      {tab === "team" && <TeamTab />}
      {tab === "billing" && <BillingTab profile={profile} />}
      {tab === "integrations" && <IntegrationsTab profile={profile} />}
    </div>
  );
}

/* ============================================================
   Company Profile
   ============================================================ */

function CompanyTab({ profile }: { profile: Profile | null }) {
  const [name, setName] = useState(profile?.tenant.name ?? "");
  const [businessType, setBusinessType] = useState("");
  const [address, setAddress] = useState<AddressValue>({ street: "", city: "", state: "", zip: "", lat: null, lng: null });
  const [radius, setRadius] = useState("50");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus("idle");
    try {
      await api.patch("/auth/profile", {
        companyName: name,
        businessType,
        address: { street: address.street, city: address.city, state: address.state, zip: address.zip },
        serviceRadius: Number(radius),
      });
      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full bg-[#111C2E] border border-[#1E2D45] rounded-lg px-4 py-3 text-white focus:border-[#2ECC71] focus:ring-1 focus:ring-[#2ECC71] transition";
  const labelClass = "text-sm font-medium text-[#7A8BA3] mb-1.5";

  return (
    <div className="max-w-2xl space-y-8">
      {/* Logo */}
      <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-6 card-hover">
        <h2 className="font-display text-base font-semibold text-white mb-4">
          Company Logo
        </h2>
        <div className="flex items-center gap-6">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-dark-elevated border-2 border-dashed border-white/10">
            <Upload className="h-6 w-6 text-muted" />
          </div>
          <div>
            <button className="rounded-lg bg-dark-elevated px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-dark-card-hover">
              Upload Logo
            </button>
            <p className="mt-1.5 text-xs text-muted">
              PNG, JPG up to 2MB. Recommended 256×256px.
            </p>
          </div>
        </div>
      </div>

      {/* Company details */}
      <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-6 card-hover">
        <h2 className="font-display text-base font-semibold text-white mb-4">
          Company Details
        </h2>
        <div className="space-y-4">
          <div>
            <label className={labelClass}>Company Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Business Type</label>
            <select
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
              className={`${inputClass} appearance-none`}
            >
              <option value="">Select type</option>
              <option value="dumpster_rental">Dumpster Rental</option>
              <option value="portable_storage">Portable Storage</option>
              <option value="portable_restrooms">Portable Restrooms</option>
              <option value="landscaping">Landscaping</option>
              <option value="multi_service">Multi-Service</option>
            </select>
          </div>
        </div>
      </div>

      {/* Address */}
      <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-6">
        <h2 className="font-display text-base font-semibold text-white mb-4">Yard / Office Address</h2>
        <AddressAutocomplete value={address} onChange={setAddress} placeholder="Search for your business address..." />
        {address.street && (
          <div className="mt-3 rounded-lg bg-dark-elevated p-3 text-xs text-muted">
            <p className="text-white font-medium">{address.street}</p>
            <p>{address.city}, {address.state} {address.zip}</p>
          </div>
        )}
      </div>

      {/* Service radius */}
      <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-6 card-hover">
        <h2 className="font-display text-base font-semibold text-white mb-4">
          Service Radius
        </h2>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min="5"
            max="200"
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
            className="flex-1 accent-brand"
          />
          <div className="w-20 text-center">
            <span className="font-display text-xl font-bold text-white">
              {radius}
            </span>
            <span className="text-xs text-muted ml-1">mi</span>
          </div>
        </div>
      </div>

      {saveStatus === "success" && (
        <div className="rounded-lg bg-brand/10 px-4 py-3 text-sm text-brand">
          Settings saved successfully.
        </div>
      )}
      {saveStatus === "error" && (
        <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Failed to save settings. Please try again.
        </div>
      )}
      <button
        onClick={handleSave}
        disabled={saving}
        className="rounded-lg bg-[#2ECC71] hover:bg-[#1FA855] text-white font-semibold px-6 py-2.5 text-sm transition-colors disabled:opacity-50 btn-press"
      >
        {saving ? "Saving..." : "Save Changes"}
      </button>
    </div>
  );
}

/* ============================================================
   Team Members
   ============================================================ */

function TeamTab() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    // There's no /users list endpoint, so we fetch from profile + any cached data
    // For now, show current user from profile
    api
      .get<Profile>("/auth/profile")
      .then((p) => {
        setMembers([
          {
            id: p.id,
            email: p.email,
            first_name: p.firstName,
            last_name: p.lastName,
            role: p.role,
            is_active: true,
            created_at: new Date().toISOString(),
          },
        ]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-muted">{members.length} team members</p>
        <button
          onClick={() => setInviteOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-[#2ECC71] hover:bg-[#1FA855] text-white font-semibold px-4 py-2.5 text-sm transition-colors btn-press"
        >
          <Users className="h-4 w-4" />
          Invite Member
        </button>
      </div>

      <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 overflow-hidden">
        <div className="table-scroll">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#1E2D45]">
              <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-muted">
                Name
              </th>
              <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-muted">
                Email
              </th>
              <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-muted">
                Role
              </th>
              <th className="px-6 py-3.5 text-center text-xs font-medium uppercase tracking-wider text-muted">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <>
                {[1, 2, 3].map((i) => (
                  <tr key={i}>
                    <td colSpan={4} className="px-6 py-2">
                      <div className="h-12 w-full skeleton rounded" />
                    </td>
                  </tr>
                ))}
              </>
            ) : (
              members.map((m) => (
                <tr
                  key={m.id}
                  className="border-b border-[#1E2D45] last:border-0"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand">
                        {m.first_name[0]}
                        {m.last_name[0]}
                      </div>
                      <span className="font-medium text-white">
                        {m.first_name} {m.last_name}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-foreground">{m.email}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${ROLE_BADGE[m.role] || "bg-zinc-500/10 text-zinc-400"}`}
                    >
                      {m.role}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${m.is_active ? "bg-brand" : "bg-red-500"}`}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      <SlideOver
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite Team Member"
      >
        <InviteForm
          onSuccess={() => {
            setInviteOpen(false);
            // Refresh would go here
          }}
        />
      </SlideOver>
    </div>
  );
}

function InviteForm({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState("driver");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      const result = await api.post<{ tempPassword: string }>("/auth/invite", {
        email,
        firstName,
        lastName,
        role,
        phone: phone || undefined,
      });
      setSuccess(`Invited! Temp password: ${result.tempPassword}`);
      setTimeout(onSuccess, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to invite");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full bg-[#111C2E] border border-[#1E2D45] rounded-lg px-4 py-3 text-white focus:border-[#2ECC71] focus:ring-1 focus:ring-[#2ECC71] transition";
  const labelClass = "text-sm font-medium text-[#7A8BA3] mb-1.5";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg bg-brand/10 px-4 py-3 text-sm text-brand">
          {success}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>First Name</label>
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            className={inputClass}
            placeholder="Jane"
          />
        </div>
        <div>
          <label className={labelClass}>Last Name</label>
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
            className={inputClass}
            placeholder="Smith"
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className={inputClass}
          placeholder="jane@company.com"
        />
      </div>

      <div>
        <label className={labelClass}>Phone</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={inputClass}
          placeholder="555-234-5678"
        />
      </div>

      <div>
        <label className={labelClass}>Role</label>
        <div className="grid grid-cols-4 gap-1 rounded-lg bg-dark-card p-1">
          {(["admin", "dispatcher", "driver", "viewer"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={`rounded-md py-2 text-xs font-medium capitalize transition-colors btn-press ${
                role === r
                  ? "bg-brand text-dark-primary"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-lg bg-[#2ECC71] hover:bg-[#1FA855] text-white font-semibold px-4 py-2.5 text-sm transition-colors disabled:opacity-50 btn-press"
      >
        {saving ? "Inviting..." : "Send Invite"}
      </button>
    </form>
  );
}

/* ============================================================
   Billing
   ============================================================ */

const TIERS = [
  {
    key: "starter",
    name: "Starter",
    price: "$99",
    features: ["Up to 3 users", "50 jobs/month", "Basic analytics", "Email support"],
  },
  {
    key: "professional",
    name: "Professional",
    price: "$249",
    features: ["Up to 15 users", "Unlimited jobs", "Advanced analytics", "Dispatch board", "Marketplace", "Priority support"],
    popular: true,
  },
  {
    key: "business",
    name: "Business",
    price: "$499",
    features: ["Unlimited users", "Unlimited jobs", "Custom analytics", "API access", "White-label", "Dedicated CSM"],
  },
];

function BillingTab({ profile }: { profile: Profile | null }) {
  const currentTier = profile?.tenant.subscriptionTier || "trial";
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  const handleUpgrade = async (plan: string) => {
    setUpgrading(plan);
    try {
      const res = await api.post<{ url: string }>("/billing/create-checkout-session", { plan });
      if (res.url) window.location.href = res.url;
    } catch {
      alert("Failed to create checkout session");
    } finally {
      setUpgrading(null);
    }
  };

  const handleManage = async () => {
    setPortalLoading(true);
    try {
      const res = await api.get<{ url: string }>("/billing/portal");
      if (res.url) window.location.href = res.url;
    } catch {
      alert("Subscribe to a plan first to manage billing.");
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-8">
      {/* Current plan */}
      <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-6 card-hover">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted mb-1">
              Current Plan
            </p>
            <p className="font-display text-2xl font-bold text-white capitalize">
              {currentTier}
            </p>
            <p className="text-sm text-muted mt-1 capitalize">
              Status: {profile?.tenant.subscriptionStatus || "trialing"}
            </p>
          </div>
          <button
            onClick={handleManage}
            disabled={portalLoading}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-dark-elevated px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-dark-card-hover disabled:opacity-50 btn-press"
          >
            <ExternalLink className="h-4 w-4" />
            {portalLoading ? "Loading..." : "Manage Subscription"}
          </button>
        </div>
      </div>

      {/* Tier cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {TIERS.map((tier) => {
          const isCurrent = tier.key === currentTier;
          return (
            <div
              key={tier.key}
              className={`relative rounded-2xl border p-6 transition-colors card-hover ${
                isCurrent
                  ? "bg-brand/5 border-brand/30"
                  : "bg-dark-card border-[#1E2D45] hover:bg-dark-card-hover"
              }`}
            >
              {"popular" in tier && tier.popular && (
                <span className="absolute -top-2.5 right-4 rounded-full bg-brand px-3 py-0.5 text-[10px] font-bold text-dark-primary">
                  Popular
                </span>
              )}
              <p className="font-display text-lg font-semibold text-white">
                {tier.name}
              </p>
              <p className="mt-1">
                <span className="font-display text-3xl font-bold text-white tabular-nums">
                  {tier.price}
                </span>
                <span className="text-sm text-muted">/mo</span>
              </p>
              <ul className="mt-5 space-y-2">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm">
                    <Check className="h-3.5 w-3.5 text-brand" />
                    <span className="text-foreground">{f}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => !isCurrent && handleUpgrade(tier.key)}
                disabled={isCurrent || upgrading === tier.key}
                className={`mt-6 w-full rounded-lg py-2.5 text-sm font-semibold transition-colors ${
                  isCurrent
                    ? "bg-dark-elevated text-muted cursor-default"
                    : "bg-[#2ECC71] hover:bg-[#1FA855] text-white"
                }`}
              >
                {isCurrent ? "Current Plan" : upgrading === tier.key ? "Redirecting..." : "Upgrade"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   Integrations
   ============================================================ */

function IntegrationsTab({ profile }: { profile: Profile | null }) {
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const tenantId = profile?.tenant.id || "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";
  const apiKey = `sos_live_${tenantId.replace(/-/g, "").slice(0, 24)}`;
  const webhookUrl = `https://api.serviceos.io/marketplace/bookings`;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="max-w-2xl space-y-6">
      {/* Marketplace */}
      <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-6 card-hover">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10">
              <Globe className="h-5 w-5 text-brand" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">
                RentThis.com Marketplace
              </p>
              <p className="text-xs text-muted">
                Receive bookings from the marketplace
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-brand" />
            <span className="text-xs font-medium text-brand">Connected</span>
          </div>
        </div>
        <div className="rounded-lg bg-dark-elevated p-4 space-y-3">
          <div>
            <p className="text-xs text-muted mb-1">Tenant ID</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-dark-card px-3 py-1.5 text-xs text-foreground font-mono">
                {tenantId}
              </code>
              <button
                onClick={() => copyToClipboard(tenantId, "tenant")}
                className="rounded p-1.5 text-muted transition-colors hover:bg-dark-card hover:text-white"
              >
                {copied === "tenant" ? (
                  <Check className="h-3.5 w-3.5 text-brand" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* API Key */}
      <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-6 card-hover">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10">
            <Key className="h-5 w-5 text-purple-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">API Key</p>
            <p className="text-xs text-muted">
              Use this key for API authentication
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-lg bg-dark-elevated px-4 py-2.5 text-sm font-mono text-foreground">
            {showKey ? apiKey : "sos_live_••••••••••••••••••••••••"}
          </code>
          <button
            onClick={() => setShowKey(!showKey)}
            className="rounded-lg bg-dark-elevated p-2.5 text-muted transition-colors hover:bg-dark-card-hover hover:text-white btn-press"
          >
            {showKey ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={() => copyToClipboard(apiKey, "api")}
            className="rounded-lg bg-dark-elevated p-2.5 text-muted transition-colors hover:bg-dark-card-hover hover:text-white"
          >
            {copied === "api" ? (
              <Check className="h-4 w-4 text-brand" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Webhook */}
      <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-6 card-hover">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10">
            <Webhook className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Webhook URL</p>
            <p className="text-xs text-muted">
              Configure this URL in your marketplace dashboard
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-lg bg-dark-elevated px-4 py-2.5 text-sm font-mono text-foreground truncate">
            {webhookUrl}
          </code>
          <button
            onClick={() => copyToClipboard(webhookUrl, "webhook")}
            className="rounded-lg bg-dark-elevated p-2.5 text-muted transition-colors hover:bg-dark-card-hover hover:text-white"
          >
            {copied === "webhook" ? (
              <Check className="h-4 w-4 text-brand" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Zapier / future */}
      <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-6 opacity-60 card-hover">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10">
              <Zap className="h-5 w-5 text-orange-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Zapier</p>
              <p className="text-xs text-muted">
                Connect with 5,000+ apps
              </p>
            </div>
          </div>
          <span className="rounded-full bg-dark-elevated px-3 py-1 text-xs font-medium text-muted">
            Coming Soon
          </span>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Locations (Yards)
   ============================================================ */

interface YardData {
  id: string;
  name: string;
  address: Record<string, string> | null;
  lat: number | null;
  lng: number | null;
  is_primary: boolean;
  is_active: boolean;
}

function LocationsTab() {
  const [yards, setYards] = useState<YardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const fetchYards = useCallback(async () => {
    try {
      const data = await api.get<YardData[]>("/yards");
      setYards(data);
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchYards(); }, [fetchYards]);

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this yard?")) return;
    try {
      await api.delete(`/yards/${id}`);
      fetchYards();
    } catch { /* */ }
  };

  const handleSetPrimary = async (id: string) => {
    try {
      await api.patch(`/yards/${id}/primary`, {});
      fetchYards();
    } catch { /* */ }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-base font-semibold text-white">Yard Locations</h2>
            <p className="text-xs text-muted mt-1">Your primary yard is used for distance-based pricing calculations.</p>
          </div>
          <button onClick={() => setAddOpen(true)} className="flex items-center gap-2 rounded-lg bg-[#2ECC71] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1FA855] transition-colors btn-press">
            <Plus className="h-4 w-4" /> Add Yard
          </button>
        </div>

        {loading ? (
          <div className="space-y-3">{[1,2].map(i => <div key={i} className="h-16 skeleton rounded-lg" />)}</div>
        ) : yards.length === 0 ? (
          <div className="py-8 text-center">
            <MapPin className="mx-auto h-10 w-10 text-muted/20 mb-2" />
            <p className="text-sm text-muted">No yards configured</p>
            <p className="text-xs text-muted/70 mt-1">Add your yard location for accurate pricing</p>
          </div>
        ) : (
          <div className="space-y-2">
            {yards.map(yard => (
              <div key={yard.id} className="flex items-center gap-4 rounded-lg bg-dark-elevated border border-[#1E2D45] px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">{yard.name}</p>
                    {yard.is_primary && (
                      <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand">Primary</span>
                    )}
                  </div>
                  {yard.address && (
                    <p className="text-xs text-muted mt-0.5 truncate">
                      {[yard.address.street, yard.address.city, yard.address.state, yard.address.zip].filter(Boolean).join(", ")}
                    </p>
                  )}
                  {yard.lat && <p className="text-[10px] text-muted/50">GPS: {Number(yard.lat).toFixed(4)}, {Number(yard.lng).toFixed(4)}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!yard.is_primary && (
                    <button onClick={() => handleSetPrimary(yard.id)} title="Set as primary" className="rounded p-1.5 text-muted hover:text-brand hover:bg-brand/10 transition-colors">
                      <Star className="h-4 w-4" />
                    </button>
                  )}
                  <button onClick={() => handleDelete(yard.id)} className="rounded p-1.5 text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <SlideOver open={addOpen} onClose={() => setAddOpen(false)} title="Add Yard">
        <AddYardForm onSuccess={() => { setAddOpen(false); fetchYards(); }} />
      </SlideOver>
    </div>
  );
}

function AddYardForm({ onSuccess }: { onSuccess: () => void }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState<AddressValue>({ street: "", city: "", state: "", zip: "", lat: null, lng: null });
  const [isPrimary, setIsPrimary] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name) return;
    setError(""); setSaving(true);
    try {
      await api.post("/yards", {
        name,
        address: address.street ? { street: address.street, city: address.city, state: address.state, zip: address.zip } : undefined,
        lat: address.lat, lng: address.lng,
        isPrimary,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally { setSaving(false); }
  };

  const inputClass = "w-full bg-[#111C2E] border border-[#1E2D45] rounded-lg px-4 py-3 text-sm text-white placeholder-muted outline-none focus:border-[#2ECC71] focus:ring-1 focus:ring-[#2ECC71] transition";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}
      <div>
        <label className="block text-sm font-medium text-[#7A8BA3] mb-1.5">Yard Name</label>
        <input value={name} onChange={e => setName(e.target.value)} required className={inputClass} placeholder="Main Yard" />
      </div>
      <AddressAutocomplete value={address} onChange={setAddress} label="Address" placeholder="Search for yard address..." />
      {address.street && (
        <div className="rounded-lg bg-dark-elevated p-3 text-xs text-muted">
          <p className="text-white font-medium">{address.street}</p>
          <p>{address.city}, {address.state} {address.zip}</p>
          {address.lat && <p className="text-[10px] text-muted/50 mt-1">GPS: {address.lat.toFixed(4)}, {address.lng?.toFixed(4)}</p>}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={isPrimary} onChange={e => setIsPrimary(e.target.checked)} className="h-4 w-4 rounded accent-brand" />
        <span className="text-sm text-muted">Set as primary yard (used for pricing)</span>
      </div>
      <button type="submit" disabled={saving} className="w-full rounded-lg bg-[#2ECC71] py-3 text-sm font-semibold text-white hover:bg-[#1FA855] disabled:opacity-50 transition-colors">
        {saving ? "Adding..." : "Add Yard"}
      </button>
    </form>
  );
}
