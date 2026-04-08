"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import {
  Building, Users, CreditCard, Plug, Upload, Copy, Check, Eye, EyeOff,
  ExternalLink, Zap, Globe, Key, Webhook, MapPin, Plus, Trash2, Star,
  Bell, Shield, Lock, Download, AlertTriangle, FileText,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import SlideOver from "@/components/slide-over";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";

interface Profile {
  id: string; email: string; firstName: string; lastName: string; role: string;
  tenant: {
    id: string; name: string; slug: string; businessType: string;
    address: Record<string, string> | null; serviceRadius: number | null;
    subscriptionTier: string; subscriptionStatus: string;
  };
}

interface TeamMember {
  id: string; email: string; first_name: string; last_name: string;
  role: string; is_active: boolean; created_at: string;
}

const TABS = [
  { key: "company", label: "Company Profile", icon: Building },
  { key: "locations", label: "Locations", icon: MapPin },
  { key: "team", label: "Team", icon: Users },
  { key: "billing", label: "Billing", icon: CreditCard },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "integrations", label: "Integrations", icon: Plug },
  { key: "website", label: "Website", icon: Globe },
  { key: "quotes", label: "Quotes", icon: FileText },
  { key: "account", label: "Account", icon: Shield },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const inputCls = "w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-3 text-[var(--t-text-primary)] focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)] transition outline-none text-sm";
const labelCls = "text-[13px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] mb-1.5";

export default function SettingsPage() {
  const [tab, setTab] = useState<TabKey>("company");
  const [profile, setProfile] = useState<Profile | null>(null);

  const fetchProfile = () => api.get<Profile>("/auth/profile").then(setProfile).catch(() => {});

  useEffect(() => { fetchProfile(); }, []);

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)]">Settings</h1>
          <p className="mt-1 text-[13px] text-[var(--t-frame-text-muted)]">Manage your account and preferences</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 overflow-x-auto pb-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors shrink-0 ${
                tab === t.key ? "bg-[var(--t-accent-soft)] text-[var(--t-accent)]" : "text-[var(--t-frame-text-muted)] hover:text-[var(--t-frame-text)]"
              }`}>
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "company" && <CompanyTab profile={profile} onSaved={fetchProfile} />}
      {tab === "locations" && <LocationsTab />}
      {tab === "team" && <TeamTab />}
      {tab === "billing" && <BillingTab profile={profile} />}
      {tab === "notifications" && <NotificationsTab />}
      {tab === "integrations" && <IntegrationsTab profile={profile} />}
      {tab === "website" && profile && <WebsiteTab slug={profile.tenant.slug} />}
      {tab === "quotes" && <QuotesTab />}
      {tab === "account" && <AccountTab profile={profile} />}
    </div>
  );
}

/* ── Company ── */

function CompanyTab({ profile, onSaved }: { profile: Profile | null; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [address, setAddress] = useState<AddressValue>({ street: "", city: "", state: "", zip: "", lat: null, lng: null });
  const [radius, setRadius] = useState("50");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");

  useEffect(() => {
    if (!profile) return;
    setName(profile.tenant.name || "");
    setBusinessType(profile.tenant.businessType || "");
    setRadius(String(profile.tenant.serviceRadius || 50));
    const addr = profile.tenant.address;
    if (addr) setAddress({ street: addr.street || "", city: addr.city || "", state: addr.state || "", zip: addr.zip || "", lat: null, lng: null });
  }, [profile]);

  const handleSave = async () => {
    setSaving(true); setSaveStatus("idle");
    try {
      await api.patch("/auth/profile", { companyName: name, businessType, address: { street: address.street, city: address.city, state: address.state, zip: address.zip }, serviceRadius: Number(radius) });
      setSaveStatus("success"); setTimeout(() => setSaveStatus("idle"), 3000);
      onSaved();
    } catch { setSaveStatus("error"); setTimeout(() => setSaveStatus("idle"), 3000); }
    finally { setSaving(false); }
  };

  return (
    <div className="max-w-2xl space-y-8">
      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6">
        <h2 className="text-base font-semibold text-[var(--t-text-primary)] mb-4">Company Logo</h2>
        <div className="flex items-center gap-6">
          <div className="flex h-20 w-20 items-center justify-center rounded-[20px] border-2 border-dashed border-[var(--t-border)] bg-[var(--t-bg-card-hover)]">
            <Upload className="h-6 w-6 text-[var(--t-text-muted)]" />
          </div>
          <div>
            <button className="rounded-full border border-[var(--t-border)] px-4 py-2 text-sm font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors">Upload Logo</button>
            <p className="mt-1.5 text-[13px] text-[var(--t-text-muted)]">PNG, JPG up to 2MB. Recommended 256x256px.</p>
          </div>
        </div>
      </div>

      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6">
        <h2 className="text-base font-semibold text-[var(--t-text-primary)] mb-4">Company Details</h2>
        <div className="space-y-4">
          <div><label className={labelCls}>Company Name</label><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></div>
          <div>
            <label className={labelCls}>Business Type</label>
            <select value={businessType} onChange={(e) => setBusinessType(e.target.value)} className={`${inputCls} appearance-none`}>
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

      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6">
        <h2 className="text-base font-semibold text-[var(--t-text-primary)] mb-4">Yard / Office Address</h2>
        <AddressAutocomplete value={address} onChange={setAddress} placeholder="Search for your business address..." />
        {address.street && (
          <div className="mt-3 rounded-[20px] bg-[var(--t-bg-card-hover)] p-3 text-[13px] text-[var(--t-text-muted)]">
            <p className="text-[var(--t-text-primary)] font-medium">{address.street}</p>
            <p>{address.city}, {address.state} {address.zip}</p>
          </div>
        )}
      </div>

      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6">
        <h2 className="text-base font-semibold text-[var(--t-text-primary)] mb-4">Service Radius</h2>
        <div className="flex items-center gap-4">
          <input type="range" min="5" max="200" value={radius} onChange={(e) => setRadius(e.target.value)} className="flex-1 accent-[var(--t-accent)]" />
          <div className="w-20 text-center">
            <span className="text-xl font-bold text-[var(--t-text-primary)]">{radius}</span>
            <span className="text-[13px] text-[var(--t-text-muted)] ml-1">mi</span>
          </div>
        </div>
      </div>

      {saveStatus === "success" && <div className="rounded-[20px] bg-[var(--t-accent-soft)] px-4 py-3 text-sm text-[var(--t-accent)]">Settings saved successfully.</div>}
      {saveStatus === "error" && <div className="rounded-[20px] bg-[var(--t-error-soft)] px-4 py-3 text-sm text-[var(--t-error)]">Failed to save settings.</div>}
      <button onClick={handleSave} disabled={saving} className="rounded-full bg-[var(--t-accent)] text-[var(--t-accent-on-accent)] font-semibold px-6 py-2.5 text-sm transition-opacity hover:opacity-90 disabled:opacity-50">
        {saving ? "Saving..." : "Save Changes"}
      </button>
    </div>
  );
}

/* ── Team ── */

function TeamTab() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    api.get<Profile>("/auth/profile").then((p) => {
      setMembers([{ id: p.id, email: p.email, first_name: p.firstName, last_name: p.lastName, role: p.role, is_active: true, created_at: new Date().toISOString() }]);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-[var(--t-text-muted)]">{members.length} team members</p>
        <button onClick={() => setInviteOpen(true)} className="flex items-center gap-2 rounded-full bg-[var(--t-accent)] text-[var(--t-accent-on-accent)] font-semibold px-5 py-2.5 text-sm transition-opacity hover:opacity-90">
          <Users className="h-4 w-4" /> Invite Member
        </button>
      </div>

      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--t-border)]">
              <th className="px-6 py-3.5 text-left text-[12px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)]">Name</th>
              <th className="px-6 py-3.5 text-left text-[12px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)]">Email</th>
              <th className="px-6 py-3.5 text-left text-[12px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)]">Role</th>
              <th className="px-6 py-3.5 text-center text-[12px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)]">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <>{[1, 2, 3].map((i) => (<tr key={i}><td colSpan={4} className="px-6 py-2"><div className="h-12 w-full skeleton rounded-[20px]" /></td></tr>))}</>
            ) : (
              members.map((m) => (
                <tr key={m.id} className="border-b border-[var(--t-border)] last:border-0">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--t-accent-soft)] text-xs font-bold text-[var(--t-accent)]">{m.first_name[0]}{m.last_name[0]}</div>
                      <span className="font-medium text-[var(--t-text-primary)]">{m.first_name} {m.last_name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-[var(--t-text-primary)]">{m.email}</td>
                  <td className="px-6 py-4"><span className="text-[11px] font-semibold capitalize text-[var(--t-text-muted)]">{m.role}</span></td>
                  <td className="px-6 py-4 text-center"><span className={`inline-block h-2 w-2 rounded-full ${m.is_active ? "bg-[var(--t-accent)]" : "bg-[var(--t-error)]"}`} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <SlideOver open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite Team Member">
        <InviteForm onSuccess={() => { setInviteOpen(false); }} />
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
    e.preventDefault(); setError(""); setSuccess(""); setSaving(true);
    try {
      const result = await api.post<{ tempPassword: string }>("/auth/invite", { email, firstName, lastName, role, phone: phone || undefined });
      setSuccess(`Invited! Temp password: ${result.tempPassword}`);
      setTimeout(onSuccess, 3000);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to invite"); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <div className="rounded-[20px] bg-[var(--t-error-soft)] px-4 py-3 text-sm text-[var(--t-error)]">{error}</div>}
      {success && <div className="rounded-[20px] bg-[var(--t-accent-soft)] px-4 py-3 text-sm text-[var(--t-accent)]">{success}</div>}
      <div className="grid grid-cols-2 gap-4">
        <div><label className={labelCls}>First Name</label><input value={firstName} onChange={(e) => setFirstName(e.target.value)} required className={inputCls} placeholder="Jane" /></div>
        <div><label className={labelCls}>Last Name</label><input value={lastName} onChange={(e) => setLastName(e.target.value)} required className={inputCls} placeholder="Smith" /></div>
      </div>
      <div><label className={labelCls}>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputCls} placeholder="jane@company.com" /></div>
      <div><label className={labelCls}>Phone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="555-234-5678" /></div>
      <div>
        <label className={labelCls}>Role</label>
        <div className="grid grid-cols-4 gap-1">
          {(["admin", "dispatcher", "driver", "viewer"] as const).map((r) => (
            <button key={r} type="button" onClick={() => setRole(r)}
              className={`rounded-full py-2 text-xs font-medium capitalize transition-colors ${role === r ? "bg-[var(--t-accent)] text-[var(--t-accent-on-accent)]" : "text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)]"}`}>{r}</button>
          ))}
        </div>
      </div>
      <button type="submit" disabled={saving} className="w-full rounded-full bg-[var(--t-accent)] text-[var(--t-accent-on-accent)] font-semibold px-4 py-2.5 text-sm transition-opacity hover:opacity-90 disabled:opacity-50">
        {saving ? "Inviting..." : "Send Invite"}
      </button>
    </form>
  );
}

/* ── Billing ── */

const TIERS = [
  { key: "starter", name: "Starter", price: "$99", features: ["Up to 3 users", "50 jobs/month", "Basic analytics", "Email support"] },
  { key: "professional", name: "Professional", price: "$249", features: ["Up to 15 users", "Unlimited jobs", "Advanced analytics", "Dispatch board", "Marketplace", "Priority support"], popular: true },
  { key: "business", name: "Business", price: "$499", features: ["Unlimited users", "Unlimited jobs", "Custom analytics", "API access", "White-label", "Dedicated CSM"] },
];

function BillingTab({ profile }: { profile: Profile | null }) {
  const currentTier = profile?.tenant.subscriptionTier || "trial";
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  const handleUpgrade = async (plan: string) => {
    setUpgrading(plan);
    try { const res = await api.post<{ url: string }>("/billing/create-checkout-session", { plan }); if (res.url) window.location.href = res.url; }
    catch { alert("Failed to create checkout session"); } finally { setUpgrading(null); }
  };

  const handleManage = async () => {
    setPortalLoading(true);
    try { const res = await api.get<{ url: string }>("/billing/portal"); if (res.url) window.location.href = res.url; }
    catch { alert("Subscribe to a plan first to manage billing."); } finally { setPortalLoading(false); }
  };

  return (
    <div className="max-w-4xl space-y-8">
      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] mb-1">Current Plan</p>
            <p className="text-[24px] font-bold text-[var(--t-text-primary)] capitalize">{currentTier}</p>
            <p className="text-sm text-[var(--t-text-muted)] mt-1 capitalize">Status: {profile?.tenant.subscriptionStatus || "trialing"}</p>
          </div>
          <button onClick={handleManage} disabled={portalLoading}
            className="flex items-center gap-2 rounded-full border border-[var(--t-border)] px-4 py-2.5 text-sm font-medium text-[var(--t-text-primary)] transition-colors hover:bg-[var(--t-bg-card-hover)] disabled:opacity-50">
            <ExternalLink className="h-4 w-4" />{portalLoading ? "Loading..." : "Manage Subscription"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {TIERS.map((tier) => {
          const isCurrent = tier.key === currentTier;
          return (
            <div key={tier.key} className={`relative rounded-[20px] border p-6 transition-colors ${isCurrent ? "bg-[var(--t-accent-soft)] border-[var(--t-accent)]" : "bg-[var(--t-bg-card)] border-[var(--t-border)] hover:bg-[var(--t-bg-card-hover)]"}`}>
              {"popular" in tier && tier.popular && (
                <span className="absolute -top-2.5 right-4 rounded-full bg-[var(--t-accent)] px-3 py-0.5 text-[10px] font-bold text-[var(--t-accent-on-accent)]">Popular</span>
              )}
              <p className="text-lg font-semibold text-[var(--t-text-primary)]">{tier.name}</p>
              <p className="mt-1"><span className="text-3xl font-bold text-[var(--t-text-primary)] tabular-nums">{tier.price}</span><span className="text-sm text-[var(--t-text-muted)]">/mo</span></p>
              <ul className="mt-5 space-y-2">
                {tier.features.map((f) => (<li key={f} className="flex items-center gap-2 text-sm"><Check className="h-3.5 w-3.5 text-[var(--t-accent)]" /><span className="text-[var(--t-text-primary)]">{f}</span></li>))}
              </ul>
              <button onClick={() => !isCurrent && handleUpgrade(tier.key)} disabled={isCurrent || upgrading === tier.key}
                className={`mt-6 w-full rounded-full py-2.5 text-sm font-semibold transition-colors ${isCurrent ? "bg-[var(--t-bg-card-hover)] text-[var(--t-text-muted)] cursor-default" : "bg-[var(--t-accent)] text-[var(--t-accent-on-accent)] hover:opacity-90"}`}>
                {isCurrent ? "Current Plan" : upgrading === tier.key ? "Redirecting..." : "Upgrade"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Integrations ── */

function IntegrationsTab({ profile }: { profile: Profile | null }) {
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const tenantId = profile?.tenant.id || "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";
  const apiKey = `sos_live_${tenantId.replace(/-/g, "").slice(0, 24)}`;
  const webhookUrl = `https://api.serviceos.io/marketplace/bookings`;

  const copyToClipboard = (text: string, label: string) => { navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(null), 2000); };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Globe className="h-5 w-5 text-[var(--t-accent)]" />
            <div><p className="text-sm font-semibold text-[var(--t-text-primary)]">RentThis.com Marketplace</p><p className="text-[13px] text-[var(--t-text-muted)]">Receive bookings from the marketplace</p></div>
          </div>
          <span className="text-[11px] font-semibold text-[var(--t-accent)]">Connected</span>
        </div>
        <div className="rounded-[20px] bg-[var(--t-bg-card-hover)] p-4">
          <p className="text-[13px] text-[var(--t-text-muted)] mb-1">Tenant ID</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-[20px] bg-[var(--t-bg-card)] px-3 py-1.5 text-xs text-[var(--t-text-primary)] font-mono">{tenantId}</code>
            <button onClick={() => copyToClipboard(tenantId, "tenant")} className="rounded-full p-1.5 text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] transition-colors">
              {copied === "tenant" ? <Check className="h-3.5 w-3.5 text-[var(--t-accent)]" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6">
        <div className="flex items-center gap-3 mb-4"><Key className="h-5 w-5 text-[var(--t-text-muted)]" /><div><p className="text-sm font-semibold text-[var(--t-text-primary)]">API Key</p><p className="text-[13px] text-[var(--t-text-muted)]">Use this key for API authentication</p></div></div>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-[20px] bg-[var(--t-bg-card-hover)] px-4 py-2.5 text-sm font-mono text-[var(--t-text-primary)]">{showKey ? apiKey : "sos_live_************************"}</code>
          <button onClick={() => setShowKey(!showKey)} className="rounded-full border border-[var(--t-border)] p-2.5 text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] transition-colors">
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
          <button onClick={() => copyToClipboard(apiKey, "api")} className="rounded-full border border-[var(--t-border)] p-2.5 text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] transition-colors">
            {copied === "api" ? <Check className="h-4 w-4 text-[var(--t-accent)]" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6">
        <div className="flex items-center gap-3 mb-4"><Webhook className="h-5 w-5 text-[var(--t-text-muted)]" /><div><p className="text-sm font-semibold text-[var(--t-text-primary)]">Webhook URL</p><p className="text-[13px] text-[var(--t-text-muted)]">Configure in your marketplace dashboard</p></div></div>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-[20px] bg-[var(--t-bg-card-hover)] px-4 py-2.5 text-sm font-mono text-[var(--t-text-primary)] truncate">{webhookUrl}</code>
          <button onClick={() => copyToClipboard(webhookUrl, "webhook")} className="rounded-full border border-[var(--t-border)] p-2.5 text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] transition-colors">
            {copied === "webhook" ? <Check className="h-4 w-4 text-[var(--t-accent)]" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6 opacity-60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3"><Zap className="h-5 w-5 text-[var(--t-warning)]" /><div><p className="text-sm font-semibold text-[var(--t-text-primary)]">Zapier</p><p className="text-[13px] text-[var(--t-text-muted)]">Connect with 5,000+ apps</p></div></div>
          <span className="text-[11px] font-semibold text-[var(--t-text-muted)]">Coming Soon</span>
        </div>
      </div>
    </div>
  );
}

/* ── Locations ── */

interface YardData { id: string; name: string; address: Record<string, string> | null; lat: number | null; lng: number | null; is_primary: boolean; is_active: boolean; }

function LocationsTab() {
  const [yards, setYards] = useState<YardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const fetchYards = useCallback(async () => {
    try { const data = await api.get<YardData[]>("/yards"); setYards(data); } catch { /* */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchYards(); }, [fetchYards]);

  const handleDelete = async (id: string) => { if (!confirm("Remove this yard?")) return; try { await api.delete(`/yards/${id}`); fetchYards(); } catch { /* */ } };
  const handleSetPrimary = async (id: string) => { try { await api.patch(`/yards/${id}/primary`, {}); fetchYards(); } catch { /* */ } };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6">
        <div className="flex items-center justify-between mb-4">
          <div><h2 className="text-base font-semibold text-[var(--t-text-primary)]">Yard Locations</h2><p className="text-[13px] text-[var(--t-text-muted)] mt-1">Primary yard used for distance pricing.</p></div>
          <button onClick={() => setAddOpen(true)} className="flex items-center gap-2 rounded-full bg-[var(--t-accent)] px-4 py-2 text-sm font-semibold text-[var(--t-accent-on-accent)] transition-opacity hover:opacity-90"><Plus className="h-4 w-4" /> Add Yard</button>
        </div>
        {loading ? (
          <div className="space-y-3">{[1,2].map(i => <div key={i} className="h-16 skeleton rounded-[20px]" />)}</div>
        ) : yards.length === 0 ? (
          <div className="py-8 text-center"><MapPin className="mx-auto h-10 w-10 text-[var(--t-text-muted)] opacity-20 mb-2" /><p className="text-sm text-[var(--t-text-muted)]">No yards configured</p></div>
        ) : (
          <div className="space-y-2">
            {yards.map(yard => (
              <div key={yard.id} className="flex items-center gap-4 rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card-hover)] px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-[var(--t-text-primary)]">{yard.name}</p>
                    {yard.is_primary && <span className="text-[11px] font-semibold text-[var(--t-accent)]">Primary</span>}
                  </div>
                  {yard.address && <p className="text-[13px] text-[var(--t-text-muted)] mt-0.5 truncate">{[yard.address.street, yard.address.city, yard.address.state, yard.address.zip].filter(Boolean).join(", ")}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!yard.is_primary && <button onClick={() => handleSetPrimary(yard.id)} title="Set as primary" className="rounded-full p-1.5 text-[var(--t-text-muted)] hover:text-[var(--t-accent)] transition-colors"><Star className="h-4 w-4" /></button>}
                  <button onClick={() => handleDelete(yard.id)} className="rounded-full p-1.5 text-[var(--t-text-muted)] hover:text-[var(--t-error)] transition-colors"><Trash2 className="h-4 w-4" /></button>
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
    e.preventDefault(); if (!name) return; setError(""); setSaving(true);
    try {
      await api.post("/yards", { name, address: address.street ? { street: address.street, city: address.city, state: address.state, zip: address.zip } : undefined, lat: address.lat, lng: address.lng, isPrimary });
      onSuccess();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to create"); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <div className="rounded-[20px] bg-[var(--t-error-soft)] px-4 py-3 text-sm text-[var(--t-error)]">{error}</div>}
      <div><label className={labelCls}>Yard Name</label><input value={name} onChange={e => setName(e.target.value)} required className={inputCls} placeholder="Main Yard" /></div>
      <AddressAutocomplete value={address} onChange={setAddress} label="Address" placeholder="Search for yard address..." />
      {address.street && (
        <div className="rounded-[20px] bg-[var(--t-bg-card-hover)] p-3 text-[13px] text-[var(--t-text-muted)]">
          <p className="text-[var(--t-text-primary)] font-medium">{address.street}</p>
          <p>{address.city}, {address.state} {address.zip}</p>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={isPrimary} onChange={e => setIsPrimary(e.target.checked)} className="h-4 w-4 rounded accent-[var(--t-accent)]" />
        <span className="text-sm text-[var(--t-text-muted)]">Set as primary yard (used for pricing)</span>
      </div>
      <button type="submit" disabled={saving} className="w-full rounded-full bg-[var(--t-accent)] py-3 text-sm font-semibold text-[var(--t-accent-on-accent)] transition-opacity hover:opacity-90 disabled:opacity-50">
        {saving ? "Adding..." : "Add Yard"}
      </button>
    </form>
  );
}

/* ── Notifications ── */

const NOTIF_TYPES = [
  { type: "booking_confirmation", label: "Booking Confirmation", desc: "Sent when a new rental is booked", group: "service", hasSms: true },
  { type: "delivery_reminder", label: "Delivery Reminder", desc: "Sent the day before delivery", group: "service", hasSms: true },
  { type: "on_my_way", label: "On My Way", desc: "Sent when driver starts heading to the job", group: "service", hasSms: true },
  { type: "service_completed", label: "Service Completed", desc: "Sent when a job is marked complete", group: "service", hasSms: true },
  { type: "pickup_reminder", label: "Pickup Reminder", desc: "Sent the day before scheduled pickup", group: "service", hasSms: true },
  { type: "overdue_rental", label: "Overdue Rental", desc: "Sent when rental period has expired", group: "service", hasSms: true },
  { type: "invoice_sent", label: "Invoice Sent", desc: "Sent when an invoice is emailed to customer", group: "financial", hasSms: false },
  { type: "payment_received", label: "Payment Received", desc: "Sent when a payment is applied", group: "financial", hasSms: true },
];

interface NotifPref { notification_type: string; email_enabled: boolean; sms_enabled: boolean }

function NotificationsTab() {
  const [prefs, setPrefs] = useState<NotifPref[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testSending, setTestSending] = useState(false);

  useEffect(() => {
    api.get<NotifPref[]>("/notifications/preferences").then(d => {
      setPrefs(Array.isArray(d) ? d : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const getPref = (type: string) => prefs.find(p => p.notification_type === type) || { notification_type: type, email_enabled: true, sms_enabled: false };

  const togglePref = async (type: string, field: "email_enabled" | "sms_enabled") => {
    const current = getPref(type);
    const newVal = !current[field];
    setSaving(type + field);
    try {
      await api.put(`/notifications/preferences/${type}`, { [field]: newVal });
      setPrefs(prev => {
        const idx = prev.findIndex(p => p.notification_type === type);
        if (idx >= 0) { const copy = [...prev]; copy[idx] = { ...copy[idx], [field]: newVal }; return copy; }
        return [...prev, { notification_type: type, email_enabled: field === "email_enabled" ? newVal : true, sms_enabled: field === "sms_enabled" ? newVal : false }];
      });
    } catch { /* */ }
    setTimeout(() => setSaving(null), 600);
  };

  const sendTest = async (channel: "email" | "sms") => {
    setTestSending(true); setTestResult(null);
    try {
      const body: any = {};
      if (channel === "email") body.email = testEmail;
      else body.phone = testPhone;
      const res = await api.post<any>("/notifications/test", body);
      const r = res[channel];
      setTestResult(r?.status === "delivered" ? `${channel === "email" ? "Email" : "SMS"} sent successfully!` : `Failed: ${r?.error || "Unknown error"}`);
    } catch (e: any) { setTestResult(`Failed: ${e.message}`); }
    finally { setTestSending(false); }
  };

  if (loading) return <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="h-20 animate-pulse rounded-[20px]" style={{ background: "var(--t-bg-card)" }} />)}</div>;

  const inp = "rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2.5 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] transition-colors";

  return (
    <div className="max-w-2xl space-y-6">
      {/* Test Setup */}
      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
        <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-3">Test Your Setup</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex gap-2">
            <input value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="your@email.com" className={`flex-1 ${inp}`} />
            <button onClick={() => sendTest("email")} disabled={testSending || !testEmail} className="shrink-0 rounded-full px-4 py-2 text-xs font-semibold disabled:opacity-40" style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}>
              {testSending ? "..." : "Test Email"}
            </button>
          </div>
          <div className="flex gap-2">
            <input value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="+1234567890" className={`flex-1 ${inp}`} />
            <button onClick={() => sendTest("sms")} disabled={testSending || !testPhone} className="shrink-0 rounded-full px-4 py-2 text-xs font-semibold disabled:opacity-40" style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}>
              {testSending ? "..." : "Test SMS"}
            </button>
          </div>
        </div>
        {testResult && <p className={`mt-2 text-xs font-medium ${testResult.startsWith("Failed") ? "text-[var(--t-error)]" : "text-[var(--t-accent)]"}`}>{testResult}</p>}
      </div>

      {/* Service Notifications */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "var(--t-text-muted)" }}>Service Notifications</p>
        <div className="space-y-2">
          {NOTIF_TYPES.filter(n => n.group === "service").map(n => {
            const p = getPref(n.type);
            return (
              <NotifCard key={n.type} title={n.label} desc={n.desc}>
                <div className="flex items-center gap-1">
                  <ToggleSwitch label="Email" checked={p.email_enabled} onChange={() => togglePref(n.type, "email_enabled")} />
                  {saving === n.type + "email_enabled" && <Check className="h-3 w-3 text-[var(--t-accent)]" />}
                </div>
                {n.hasSms && (
                  <div className="flex items-center gap-1">
                    <ToggleSwitch label="SMS" checked={p.sms_enabled} onChange={() => togglePref(n.type, "sms_enabled")} />
                    {saving === n.type + "sms_enabled" && <Check className="h-3 w-3 text-[var(--t-accent)]" />}
                  </div>
                )}
              </NotifCard>
            );
          })}
        </div>
      </div>

      {/* Financial Notifications */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: "var(--t-text-muted)" }}>Financial Notifications</p>
        <div className="space-y-2">
          {NOTIF_TYPES.filter(n => n.group === "financial").map(n => {
            const p = getPref(n.type);
            return (
              <NotifCard key={n.type} title={n.label} desc={n.desc}>
                <div className="flex items-center gap-1">
                  <ToggleSwitch label="Email" checked={p.email_enabled} onChange={() => togglePref(n.type, "email_enabled")} />
                  {saving === n.type + "email_enabled" && <Check className="h-3 w-3 text-[var(--t-accent)]" />}
                </div>
                {n.hasSms && (
                  <div className="flex items-center gap-1">
                    <ToggleSwitch label="SMS" checked={p.sms_enabled} onChange={() => togglePref(n.type, "sms_enabled")} />
                    {saving === n.type + "sms_enabled" && <Check className="h-3 w-3 text-[var(--t-accent)]" />}
                  </div>
                )}
              </NotifCard>
            );
          })}
        </div>
      </div>

      {/* Sender Info */}
      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
        <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-3">Sender Settings</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>From Email</span><span style={{ color: "var(--t-text-primary)" }}>noreply@rentthis.com</span></div>
          <div className="flex justify-between"><span style={{ color: "var(--t-text-muted)" }}>SMS Number</span><span style={{ color: "var(--t-text-primary)" }}>+1 (877) 706-1147</span></div>
        </div>
        <p className="mt-3 text-xs" style={{ color: "var(--t-text-muted)" }}>Custom sender domain — coming soon</p>
      </div>
    </div>
  );
}

function NotifCard({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
      <div className="mb-3"><p className="text-sm font-semibold text-[var(--t-text-primary)]">{title}</p><p className="text-[13px] text-[var(--t-text-muted)]">{desc}</p></div>
      <div className="flex items-center gap-4 flex-wrap">{children}</div>
    </div>
  );
}

function ToggleSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <button type="button" onClick={onChange} className={`relative h-5 w-9 rounded-full transition-colors ${checked ? "bg-[var(--t-accent)]" : "bg-[var(--t-bg-card-hover)]"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${checked ? "left-[18px]" : "left-0.5"}`} />
      </button>
      {label && <span className="text-[13px] text-[var(--t-text-muted)]">{label}</span>}
    </label>
  );
}

/* ── Account ── */

function AccountTab({ profile }: { profile: Profile | null }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const handlePasswordChange = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { setPasswordError("Passwords don't match"); return; }
    if (newPassword.length < 8) { setPasswordError("Password must be at least 8 characters"); return; }
    setPasswordError(""); setPasswordSaving(true);
    setTimeout(() => { setPasswordSaving(false); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); }, 1000);
  };

  const apiKey = profile?.tenant.id ? `sk_live_${profile.tenant.id.replace(/-/g, "").slice(0, 24)}` : "sk_live_...";

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6">
        <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-4">Account Owner</h3>
        <div className="grid grid-cols-2 gap-4">
          <div><p className="text-[13px] text-[var(--t-text-muted)]">Name</p><p className="text-sm text-[var(--t-text-primary)] font-medium">{profile?.firstName} {profile?.lastName}</p></div>
          <div><p className="text-[13px] text-[var(--t-text-muted)]">Email</p><p className="text-sm text-[var(--t-text-primary)] font-medium">{profile?.email}</p></div>
        </div>
      </div>

      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6">
        <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-4">Change Password</h3>
        <form onSubmit={handlePasswordChange} className="space-y-3">
          {passwordError && <div className="rounded-[20px] bg-[var(--t-error-soft)] px-3 py-2 text-xs text-[var(--t-error)]">{passwordError}</div>}
          <div><label className={labelCls}>Current Password</label><input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={inputCls} required /></div>
          <div><label className={labelCls}>New Password</label><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputCls} required /></div>
          <div><label className={labelCls}>Confirm New Password</label><input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputCls} required /></div>
          <button type="submit" disabled={passwordSaving} className="rounded-full bg-[var(--t-accent)] px-5 py-2 text-sm font-semibold text-[var(--t-accent-on-accent)] transition-opacity hover:opacity-90 disabled:opacity-50">
            {passwordSaving ? "Updating..." : "Update Password"}
          </button>
        </form>
      </div>

      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6">
        <div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold text-[var(--t-text-primary)]">Two-Factor Authentication</h3><p className="text-[13px] text-[var(--t-text-muted)] mt-0.5">Add an extra layer of security</p></div><ToggleSwitch label="" checked={false} onChange={() => {}} /></div>
        <p className="text-[13px] text-[var(--t-text-muted)] mt-2">Coming soon</p>
      </div>

      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6">
        <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-4">API Access</h3>
        <div className="space-y-3">
          <div>
            <label className={labelCls}>API Key</label>
            <div className="flex gap-2">
              <input type={showApiKey ? "text" : "password"} value={apiKey} readOnly className={`flex-1 ${inputCls} font-mono text-xs`} />
              <button onClick={() => setShowApiKey(!showApiKey)} className="rounded-full border border-[var(--t-border)] px-3 py-2 text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] transition-colors">
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="rounded-full border border-[var(--t-border)] px-3 py-1.5 text-xs font-medium text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] transition-colors">Regenerate Key</button>
            <button className="rounded-full border border-[var(--t-border)] px-3 py-1.5 text-xs font-medium text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] transition-colors">API Docs</button>
          </div>
        </div>
      </div>

      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6">
        <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-2">Data Export</h3>
        <p className="text-[13px] text-[var(--t-text-muted)] mb-3">Download a complete export of all your data</p>
        <button className="flex items-center gap-2 rounded-full border border-[var(--t-border)] px-4 py-2 text-sm font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors"><Download className="h-4 w-4" /> Export All Data</button>
      </div>

      <div className="rounded-[20px] border border-[var(--t-error)] bg-[var(--t-bg-card)] p-6">
        <h3 className="text-sm font-semibold text-[var(--t-error)] mb-2">Danger Zone</h3>
        <p className="text-[13px] text-[var(--t-text-muted)] mb-3">Permanently delete your account and all data. This cannot be undone.</p>
        {!deleteConfirm ? (
          <button onClick={() => setDeleteConfirm(true)} className="rounded-full border border-[var(--t-error)] px-4 py-2 text-sm font-medium text-[var(--t-error)] hover:opacity-80 transition-opacity">Delete Account</button>
        ) : (
          <div className="rounded-[20px] bg-[var(--t-error-soft)] border border-[var(--t-error)] p-4 space-y-3">
            <p className="text-sm text-[var(--t-error)] font-medium flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Are you absolutely sure?</p>
            <p className="text-[13px] text-[var(--t-text-muted)]">This will permanently delete your company, all jobs, invoices, customers, and assets.</p>
            <div className="flex gap-2">
              <button className="rounded-full bg-[var(--t-error)] px-4 py-2 text-sm font-semibold text-[var(--t-accent-on-accent)] hover:opacity-90 transition-opacity">Yes, Delete Everything</button>
              <button onClick={() => setDeleteConfirm(false)} className="rounded-full border border-[var(--t-border)] px-4 py-2 text-sm text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] transition-colors">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Website ── */

function WebsiteTab({ slug }: { slug: string }) {
  const [config, setConfig] = useState({
    websiteEnabled: false, websiteHeadline: "", websiteDescription: "", websiteHeroImageUrl: "",
    websiteLogoUrl: "", websitePrimaryColor: "#2ECC71", websitePhone: "", websiteEmail: "",
    websiteServiceArea: "", websiteAbout: "", widgetEnabled: false, allowedWidgetDomains: "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get<Record<string, unknown>>("/auth/profile").then((p: any) => {
      const t = p.tenant || {};
      setConfig({
        websiteEnabled: t.websiteEnabled || false, websiteHeadline: t.websiteHeadline || "",
        websiteDescription: t.websiteDescription || "", websiteHeroImageUrl: t.websiteHeroImageUrl || "",
        websiteLogoUrl: t.websiteLogoUrl || "", websitePrimaryColor: t.websitePrimaryColor || "#2ECC71",
        websitePhone: t.websitePhone || "", websiteEmail: t.websiteEmail || "",
        websiteServiceArea: t.websiteServiceArea || "", websiteAbout: t.websiteAbout || "",
        widgetEnabled: t.widgetEnabled || false, allowedWidgetDomains: (t.allowedWidgetDomains || []).join(", "),
      });
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch("/auth/profile", { ...config, allowedWidgetDomains: config.allowedWidgetDomains ? config.allowedWidgetDomains.split(",").map((d: string) => d.trim()).filter(Boolean) : [] });
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch {} finally { setSaving(false); }
  };

  const websiteUrl = `${slug}.serviceos.com`;
  const widgetCode = `<script src="https://serviceos-web-zeta.vercel.app/widget.js" data-slug="${slug}"></script>`;
  const copyText = (text: string) => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[var(--t-text-primary)]">Your Website</h3>
          <label className="flex items-center gap-2">
            <span className="text-[13px] text-[var(--t-text-muted)]">Enabled</span>
            <button onClick={() => setConfig(c => ({ ...c, websiteEnabled: !c.websiteEnabled }))} className={`w-10 h-5 rounded-full transition-colors ${config.websiteEnabled ? "bg-[var(--t-accent)]" : "bg-[var(--t-bg-card-hover)]"}`}>
              <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${config.websiteEnabled ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2.5 text-sm text-[var(--t-accent)] font-mono">{websiteUrl}</code>
          <button onClick={() => copyText(`https://${websiteUrl}`)} className="rounded-full border border-[var(--t-border)] px-3 py-2.5 text-[13px] text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] transition-colors">
            {copied ? <Check className="h-4 w-4 text-[var(--t-accent)]" /> : <Copy className="h-4 w-4" />}
          </button>
          <a href={`https://${websiteUrl}`} target="_blank" rel="noopener" className="rounded-full border border-[var(--t-border)] px-3 py-2.5 text-[13px] text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] transition-colors"><ExternalLink className="h-4 w-4" /></a>
        </div>
      </div>

      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5 space-y-4">
        <h3 className="text-sm font-semibold text-[var(--t-text-primary)]">Branding</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Primary Color</label>
            <div className="flex gap-2"><input type="color" value={config.websitePrimaryColor} onChange={e => setConfig(c => ({ ...c, websitePrimaryColor: e.target.value }))} className="h-10 w-10 rounded-[20px] border border-[var(--t-border)] bg-transparent cursor-pointer" /><input value={config.websitePrimaryColor} onChange={e => setConfig(c => ({ ...c, websitePrimaryColor: e.target.value }))} className={inputCls} /></div>
          </div>
          <div><label className={labelCls}>Logo URL</label><input value={config.websiteLogoUrl} onChange={e => setConfig(c => ({ ...c, websiteLogoUrl: e.target.value }))} className={inputCls} placeholder="https://..." /></div>
        </div>
        <div><label className={labelCls}>Hero Image URL</label><input value={config.websiteHeroImageUrl} onChange={e => setConfig(c => ({ ...c, websiteHeroImageUrl: e.target.value }))} className={inputCls} placeholder="https://..." /></div>
      </div>

      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5 space-y-4">
        <h3 className="text-sm font-semibold text-[var(--t-text-primary)]">Content</h3>
        <div><label className={labelCls}>Headline</label><input value={config.websiteHeadline} onChange={e => setConfig(c => ({ ...c, websiteHeadline: e.target.value }))} className={inputCls} placeholder="Fast Dumpster Delivery in Your Area" maxLength={255} /></div>
        <div><label className={labelCls}>Description</label><textarea value={config.websiteDescription} onChange={e => setConfig(c => ({ ...c, websiteDescription: e.target.value }))} className={`${inputCls} resize-none`} rows={3} placeholder="Brief description..." /></div>
        <div><label className={labelCls}>About</label><textarea value={config.websiteAbout} onChange={e => setConfig(c => ({ ...c, websiteAbout: e.target.value }))} className={`${inputCls} resize-none`} rows={3} placeholder="Tell customers about your company..." /></div>
        <div><label className={labelCls}>Service Area</label><textarea value={config.websiteServiceArea} onChange={e => setConfig(c => ({ ...c, websiteServiceArea: e.target.value }))} className={`${inputCls} resize-none`} rows={2} placeholder="e.g. Greater Brockton area..." /></div>
      </div>

      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5 space-y-4">
        <h3 className="text-sm font-semibold text-[var(--t-text-primary)]">Contact Info</h3>
        <div className="grid grid-cols-2 gap-4">
          <div><label className={labelCls}>Phone</label><input value={config.websitePhone} onChange={e => setConfig(c => ({ ...c, websitePhone: e.target.value }))} className={inputCls} placeholder="(508) 555-1234" /></div>
          <div><label className={labelCls}>Email</label><input value={config.websiteEmail} onChange={e => setConfig(c => ({ ...c, websiteEmail: e.target.value }))} className={inputCls} placeholder="info@company.com" /></div>
        </div>
      </div>

      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--t-text-primary)]">Embed Widget</h3>
          <label className="flex items-center gap-2">
            <span className="text-[13px] text-[var(--t-text-muted)]">Enabled</span>
            <button onClick={() => setConfig(c => ({ ...c, widgetEnabled: !c.widgetEnabled }))} className={`w-10 h-5 rounded-full transition-colors ${config.widgetEnabled ? "bg-[var(--t-accent)]" : "bg-[var(--t-bg-card-hover)]"}`}>
              <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${config.widgetEnabled ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
          </label>
        </div>
        <div>
          <label className={labelCls}>Embed Code</label>
          <div className="relative">
            <textarea readOnly value={widgetCode} className={`${inputCls} resize-none font-mono text-xs`} rows={2} />
            <button onClick={() => copyText(widgetCode)} className="absolute top-2 right-2 rounded-full bg-[var(--t-bg-card-hover)] px-2 py-1 text-[10px] text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)]">Copy</button>
          </div>
          <p className="text-[11px] text-[var(--t-text-muted)] mt-1.5">Add this to your existing website to embed the booking widget.</p>
        </div>
        <div><label className={labelCls}>Allowed Domains (comma-separated)</label><input value={config.allowedWidgetDomains} onChange={e => setConfig(c => ({ ...c, allowedWidgetDomains: e.target.value }))} className={inputCls} placeholder="mysite.com, example.com" /></div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving} className="rounded-full bg-[var(--t-accent)] px-6 py-3 text-sm font-semibold text-[var(--t-accent-on-accent)] transition-opacity hover:opacity-90 disabled:opacity-50">
          {saving ? "Saving..." : "Save Website Settings"}
        </button>
        {saved && <span className="text-sm text-[var(--t-accent)] flex items-center gap-1"><Check className="h-4 w-4" /> Saved</span>}
      </div>
    </div>
  );
}

/* ─── Quotes Tab ─── */

function QuotesTab() {
  const [settings, setSettings] = useState<Record<string, any> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    api.get<Record<string, any>>("/tenant-settings").then(setSettings).catch(() => {});
  }, []);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    // Validate delivery method vs enabled channels
    const method = settings.default_quote_delivery_method || "email";
    if (method === "email" && !settings.quotes_email_enabled) {
      toast("error", "Cannot set default to email when email is disabled");
      return;
    }
    if (method === "sms" && !settings.quotes_sms_enabled) {
      toast("error", "Cannot set default to SMS when SMS is disabled");
      return;
    }

    setSaving(true);
    try {
      await api.patch("/tenant-settings/quotes", {
        quote_expiration_days: Number(settings.quote_expiration_days) || 30,
        hot_quote_view_threshold: Number(settings.hot_quote_view_threshold) || 2,
        follow_up_recency_minutes: Number(settings.follow_up_recency_minutes) || 120,
        expiring_soon_hours: Number(settings.expiring_soon_hours) || 48,
        quotes_email_enabled: settings.quotes_email_enabled,
        quotes_sms_enabled: settings.quotes_sms_enabled,
        default_quote_delivery_method: method,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      toast("error", "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return <div className="py-8 text-center text-[var(--t-text-muted)]">Loading...</div>;

  const set = (key: string, value: unknown) => setSettings((s) => s ? { ...s, [key]: value } : s);

  return (
    <form onSubmit={handleSave} className="max-w-xl space-y-6">
      {/* Quote Rules */}
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--t-text-primary)] mb-3">Quote Rules</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Expiration (days)</label>
            <input type="number" min={1} max={365} value={settings.quote_expiration_days ?? 30}
              onChange={(e) => set("quote_expiration_days", e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Expiring Soon Window (hours)</label>
            <input type="number" min={1} max={720} value={settings.expiring_soon_hours ?? 48}
              onChange={(e) => set("expiring_soon_hours", e.target.value)} className={inputCls} />
          </div>
        </div>
      </div>

      {/* Hot Quote / Follow-Up */}
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--t-text-primary)] mb-3">Hot Quote / Follow-Up</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Hot Quote Threshold (views)</label>
            <input type="number" min={1} max={100} value={settings.hot_quote_view_threshold ?? 2}
              onChange={(e) => set("hot_quote_view_threshold", e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Follow-Up Recency (minutes)</label>
            <input type="number" min={1} max={10080} value={settings.follow_up_recency_minutes ?? 120}
              onChange={(e) => set("follow_up_recency_minutes", e.target.value)} className={inputCls} />
          </div>
        </div>
      </div>

      {/* Delivery Settings */}
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--t-text-primary)] mb-3">Delivery Settings</h3>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={settings.quotes_email_enabled ?? true}
              onChange={(e) => set("quotes_email_enabled", e.target.checked)}
              className="accent-[var(--t-accent)]" />
            <span className="text-sm text-[var(--t-text-primary)]">Enable email quotes</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={settings.quotes_sms_enabled ?? false}
              onChange={(e) => set("quotes_sms_enabled", e.target.checked)}
              className="accent-[var(--t-accent)]" />
            <span className="text-sm text-[var(--t-text-primary)]">Enable SMS quotes</span>
          </label>
          <div>
            <label className={labelCls}>Default Delivery Method</label>
            <select value={settings.default_quote_delivery_method ?? "email"}
              onChange={(e) => set("default_quote_delivery_method", e.target.value)}
              className={inputCls}>
              <option value="email">Email</option>
              <option value="sms" disabled={!settings.quotes_sms_enabled}>SMS</option>
              <option value="both" disabled={!settings.quotes_email_enabled || !settings.quotes_sms_enabled}>Both</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button type="submit" disabled={saving}
          className="rounded-full bg-[var(--t-accent)] text-white px-6 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-50">
          {saving ? "Saving..." : "Save Quote Settings"}
        </button>
        {saved && <span className="text-sm text-[var(--t-accent)] flex items-center gap-1"><Check className="h-4 w-4" /> Saved</span>}
      </div>
    </form>
  );
}
