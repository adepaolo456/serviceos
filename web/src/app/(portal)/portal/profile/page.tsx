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

  if (loading) return <div className="space-y-4">{[1, 2, 3].map(i => <div key={i} className="h-20 rounded-xl bg-[#E2E8F0] animate-pulse" />)}</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#0F172A]">Profile</h1>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-[#F1F5F9] p-1 w-fit">
        {([["info", "Personal Info"], ["password", "Password"], ["notifications", "Notifications"]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${tab === key ? "bg-white text-[#0F172A] shadow-sm" : "text-[#64748B] hover:text-[#0F172A]"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "info" && (
        <form onSubmit={handleSave} className="rounded-xl border border-[#E2E8F0] bg-white p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#334155] mb-1.5">First Name</label>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)}
                className="w-full rounded-lg border border-[#E2E8F0] bg-white px-4 py-2.5 text-sm text-[#0F172A] outline-none focus:border-[#2ECC71] focus:ring-1 focus:ring-[#2ECC71]" />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#334155] mb-1.5">Last Name</label>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded-lg border border-[#E2E8F0] bg-white px-4 py-2.5 text-sm text-[#0F172A] outline-none focus:border-[#2ECC71] focus:ring-1 focus:ring-[#2ECC71]" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#334155] mb-1.5">Email</label>
            <input value={profile?.email || ""} disabled
              className="w-full rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-2.5 text-sm text-[#64748B] cursor-not-allowed" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#334155] mb-1.5">Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555"
              className="w-full rounded-lg border border-[#E2E8F0] bg-white px-4 py-2.5 text-sm text-[#0F172A] outline-none focus:border-[#2ECC71] focus:ring-1 focus:ring-[#2ECC71]" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#334155] mb-2">Billing Address</label>
            <AddressAutocomplete value={billingAddress} onChange={setBillingAddress} placeholder="Enter billing address" />
          </div>

          {profile?.service_addresses && profile.service_addresses.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-[#334155] mb-2">Service Addresses</label>
              <div className="space-y-2">
                {profile.service_addresses.map((addr, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] px-4 py-2.5 text-sm text-[#334155]">
                    <MapPin className="h-4 w-4 text-[#64748B] shrink-0" />
                    {addr.formatted || addr.street || "—"}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button type="submit" disabled={saving}
              className="rounded-lg bg-[#2ECC71] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#27AE60] disabled:opacity-50">
              {saving ? "Saving..." : "Save Changes"}
            </button>
            {saved && <span className="flex items-center gap-1 text-sm text-[#2ECC71]"><CheckCircle2 className="h-4 w-4" /> Saved</span>}
          </div>
        </form>
      )}

      {tab === "password" && (
        <form onSubmit={handlePasswordChange} className="rounded-xl border border-[#E2E8F0] bg-white p-6 space-y-5 max-w-md">
          {pwError && <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">{pwError}</div>}
          {pwSuccess && <div className="rounded-lg bg-green-50 border border-green-100 px-4 py-3 text-sm text-green-600 flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Password updated successfully</div>}
          <div>
            <label className="block text-sm font-medium text-[#334155] mb-1.5">Current Password</label>
            <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} required
              className="w-full rounded-lg border border-[#E2E8F0] bg-white px-4 py-2.5 text-sm text-[#0F172A] outline-none focus:border-[#2ECC71] focus:ring-1 focus:ring-[#2ECC71]" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#334155] mb-1.5">New Password</label>
            <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required minLength={8}
              className="w-full rounded-lg border border-[#E2E8F0] bg-white px-4 py-2.5 text-sm text-[#0F172A] outline-none focus:border-[#2ECC71] focus:ring-1 focus:ring-[#2ECC71]" />
            <p className="text-xs text-[#94A3B8] mt-1">Minimum 8 characters</p>
          </div>
          <button type="submit" disabled={pwSaving}
            className="rounded-lg bg-[#2ECC71] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#27AE60] disabled:opacity-50">
            {pwSaving ? "Updating..." : "Update Password"}
          </button>
        </form>
      )}

      {tab === "notifications" && (
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-6 space-y-4">
          <p className="text-sm text-[#64748B]">Choose how you&apos;d like to be notified.</p>
          {["Delivery updates", "Pickup reminders", "Invoice notifications", "Payment confirmations"].map(label => (
            <div key={label} className="flex items-center justify-between py-2 border-b border-[#F1F5F9] last:border-b-0">
              <div>
                <p className="text-sm font-medium text-[#0F172A]">{label}</p>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 text-xs text-[#64748B]">
                  <input type="checkbox" defaultChecked className="rounded border-[#CBD5E1] text-[#2ECC71] focus:ring-[#2ECC71]" /> Email
                </label>
                <label className="flex items-center gap-1.5 text-xs text-[#64748B]">
                  <input type="checkbox" className="rounded border-[#CBD5E1] text-[#2ECC71] focus:ring-[#2ECC71]" /> SMS
                </label>
              </div>
            </div>
          ))}
          <button className="rounded-lg bg-[#2ECC71] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#27AE60]">
            Save Preferences
          </button>
        </div>
      )}
    </div>
  );
}
