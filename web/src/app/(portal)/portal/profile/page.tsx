"use client";

import { useState, useEffect, type FormEvent } from "react";
import { portalApi } from "@/lib/portal-api";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";
import { MapPin, CheckCircle2 } from "lucide-react";

interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  billing_address: Partial<AddressValue> | null;
  service_addresses: Partial<AddressValue>[];
}

export default function PortalProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<"info" | "password" | "notifications">("info");

  // Form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [billingAddress, setBillingAddress] = useState<Partial<AddressValue>>({});

  // Password state
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  useEffect(() => {
    portalApi.get<Profile>("/portal/profile").then(p => {
      setProfile(p);
      setFirstName(p.first_name);
      setLastName(p.last_name);
      setPhone(p.phone || "");
      setBillingAddress(p.billing_address || {});
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await portalApi.patch<Profile>("/portal/profile", {
        firstName, lastName, phone, billingAddress,
      });
      setProfile(updated);
      portalApi.setCustomer({ id: updated.id, firstName: updated.first_name, lastName: updated.last_name, email: updated.email });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // silently handle
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async (e: FormEvent) => {
    e.preventDefault();
    setPwError("");
    setPwSuccess(false);
    setPwSaving(true);
    try {
      await portalApi.post("/portal/profile/change-password", { currentPassword: currentPw, newPassword: newPw });
      setPwSuccess(true);
      setCurrentPw("");
      setNewPw("");
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Failed");
    } finally {
      setPwSaving(false);
    }
  };

  if (loading) return <div className="space-y-4">{[1, 2, 3].map(i => <div key={i} className="h-20 rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] animate-pulse" />)}</div>;

  const inputCls = "w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2.5 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]";
  const labelCls = "block text-sm font-medium text-[var(--t-text-primary)] mb-1.5";

  return (
    <div className="space-y-6">
      <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)]">Profile</h1>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-[var(--t-border)] overflow-x-auto">
        {([["info", "Personal Info"], ["password", "Password"], ["notifications", "Notifications"]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${tab === key ? "text-[var(--t-accent)]" : "text-[var(--t-frame-text-muted)] hover:text-[var(--t-frame-text)]"}`}>
            {label}
            {tab === key && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--t-accent)] rounded-full" />}
          </button>
        ))}
      </div>

      {tab === "info" && (
        <form onSubmit={handleSave} className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>First Name</label>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Last Name</label>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input value={profile?.email || ""} disabled
              className="w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-primary)] px-4 py-2.5 text-sm text-[var(--t-text-muted)] cursor-not-allowed" />
          </div>
          <div>
            <label className={labelCls}>Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" className={inputCls} />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--t-text-primary)] mb-2">Billing Address</label>
            <AddressAutocomplete value={billingAddress} onChange={setBillingAddress} placeholder="Enter billing address" />
          </div>

          {profile?.service_addresses && profile.service_addresses.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-[var(--t-text-primary)] mb-2">Service Addresses</label>
              <div className="space-y-2">
                {profile.service_addresses.map((addr, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-[20px] bg-[var(--t-bg-primary)] border border-[var(--t-border)] px-4 py-2.5 text-sm text-[var(--t-text-primary)]">
                    <MapPin className="h-4 w-4 text-[var(--t-text-muted)] shrink-0" />
                    {addr.formatted || addr.street || "—"}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button type="submit" disabled={saving}
              className="rounded-full bg-[var(--t-accent)] px-6 py-2.5 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50 transition-opacity">
              {saving ? "Saving..." : "Save Changes"}
            </button>
            {saved && <span className="flex items-center gap-1 text-sm text-[var(--t-accent)]"><CheckCircle2 className="h-4 w-4" /> Saved</span>}
          </div>
        </form>
      )}

      {tab === "password" && (
        <form onSubmit={handlePasswordChange} className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6 space-y-5 max-w-md">
          {pwError && <div className="rounded-[20px] bg-[var(--t-error-soft)] px-4 py-3 text-sm text-[var(--t-error)]">{pwError}</div>}
          {pwSuccess && <div className="rounded-[20px] bg-[var(--t-accent-soft)] px-4 py-3 text-sm text-[var(--t-accent)] flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Password updated successfully</div>}
          <div>
            <label className={labelCls}>Current Password</label>
            <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} required className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>New Password</label>
            <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required minLength={8} className={inputCls} />
            <p className="text-xs text-[var(--t-text-muted)] mt-1">Minimum 8 characters</p>
          </div>
          <button type="submit" disabled={pwSaving}
            className="rounded-full bg-[var(--t-accent)] px-6 py-2.5 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50 transition-opacity">
            {pwSaving ? "Updating..." : "Update Password"}
          </button>
        </form>
      )}

      {tab === "notifications" && (
        <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6 space-y-4">
          <p className="text-sm text-[var(--t-text-muted)]">Choose how you&apos;d like to be notified.</p>
          {["Delivery updates", "Pickup reminders", "Invoice notifications", "Payment confirmations"].map(label => (
            <div key={label} className="flex items-center justify-between py-2 border-b border-[var(--t-border)]/50 last:border-b-0">
              <div>
                <p className="text-sm font-medium text-[var(--t-text-primary)]">{label}</p>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 text-xs text-[var(--t-text-muted)]">
                  <input type="checkbox" defaultChecked className="rounded border-[var(--t-border)] text-[var(--t-accent)] focus:ring-[var(--t-accent)]" /> Email
                </label>
                <label className="flex items-center gap-1.5 text-xs text-[var(--t-text-muted)]">
                  <input type="checkbox" className="rounded border-[var(--t-border)] text-[var(--t-accent)] focus:ring-[var(--t-accent)]" /> SMS
                </label>
              </div>
            </div>
          ))}
          <button className="rounded-full bg-[var(--t-accent)] px-6 py-2.5 text-sm font-semibold text-black hover:opacity-90 transition-opacity">
            Save Preferences
          </button>
        </div>
      )}
    </div>
  );
}
