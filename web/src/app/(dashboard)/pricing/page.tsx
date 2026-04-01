"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, DollarSign, Mail, Pencil, Trash2, Check, X, MapPin } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";
import { useToast } from "@/components/toast";
import AddressAutocomplete from "@/components/address-autocomplete";

interface PricingRule {
  id: string;
  name: string;
  service_type: string;
  asset_subtype: string;
  customer_type: string | null;
  base_price: number;
  rental_period_days: number;
  extra_day_rate: number;
  included_miles: number;
  per_mile_charge: number;
  max_service_miles: number;
  included_tons: number;
  overage_per_ton: number;
  delivery_fee: number;
  pickup_fee: number;
  exchange_fee: number;
  require_deposit: boolean;
  deposit_amount: number;
  tax_rate: number;
  failed_trip_base_fee: number;
  is_active: boolean;
}

interface PricingResponse {
  data: PricingRule[];
  meta: { total: number };
}

export default function PricingPage() {
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editRule, setEditRule] = useState<PricingRule | null>(null);
  // Quote state
  const [quoteSize, setQuoteSize] = useState<string>("");
  const [quoteAddress, setQuoteAddress] = useState("");
  const [quoteCoords, setQuoteCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [quoteName, setQuoteName] = useState("");
  const [quoteEmail, setQuoteEmail] = useState("");
  const [quotePhone, setQuotePhone] = useState("");
  const [quoteSending, setQuoteSending] = useState(false);
  const [distanceInfo, setDistanceInfo] = useState<{ distanceMiles: number; zone: { name: string; surcharge: number } | null; outsideServiceArea: boolean; maxServiceMiles: number } | null>(null);
  const [zones, setZones] = useState<Array<{ id: string; zone_name: string; min_miles: number; max_miles: number; surcharge: number }>>([]);
  const [editingZone, setEditingZone] = useState<string | null>(null);
  const [zoneForm, setZoneForm] = useState({ zoneName: "", minMiles: "", maxMiles: "", surcharge: "" });
  const [addingZone, setAddingZone] = useState(false);
  const [yardAddress, setYardAddress] = useState<{ street?: string; city?: string; state?: string; zip?: string } | null>(null);
  const [yardLat, setYardLat] = useState<number | null>(null);
  const [yardLng, setYardLng] = useState<number | null>(null);
  const [editingYard, setEditingYard] = useState(false);
  const { toast } = useToast();

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<PricingResponse>("/pricing?limit=100");
      setRules(res.data);
      const zoneRes = await api.get<any[]>("/pricing/delivery-zones");
      setZones(Array.isArray(zoneRes) ? zoneRes : []);
      try {
        const profile = await api.get<any>("/auth/profile");
        const t = profile.tenant;
        if (t?.yardAddress) setYardAddress(t.yardAddress);
        if (t?.yardLatitude) setYardLat(t.yardLatitude);
        if (t?.yardLongitude) setYardLng(t.yardLongitude);
      } catch {}
    } catch {
      /* handled */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  // Calculate distance when coords change
  useEffect(() => {
    if (!quoteCoords) { setDistanceInfo(null); return; }
    api.get<any>(`/pricing/calculate-distance?destLat=${quoteCoords.lat}&destLng=${quoteCoords.lng}`)
      .then(setDistanceInfo)
      .catch(() => setDistanceInfo(null));
  }, [quoteCoords]);

  const selectedRule = rules.find((r) => r.asset_subtype === quoteSize);
  const deliverySurcharge = distanceInfo?.zone?.surcharge || 0;
  const totalQuoted = selectedRule ? Number(selectedRule.base_price) + deliverySurcharge : 0;

  const saveRule = async (data: Partial<PricingRule>) => {
    if (!editRule) return;
    try {
      await api.patch(`/pricing/${editRule.id}`, data);
      toast("success", `${editRule.asset_subtype} pricing updated`);
      setEditOpen(false);
      fetchRules();
    } catch {
      toast("error", "Failed to save");
    }
  };

  const sendQuote = async () => {
    if (!selectedRule || !quoteEmail) return;
    setQuoteSending(true);
    try {
      await api.post("/quotes", {
        customerName: quoteName,
        customerEmail: quoteEmail,
        customerPhone: quotePhone,
        deliveryAddress: quoteAddress ? { street: quoteAddress } : null,
        assetSubtype: quoteSize,
        basePrice: Number(selectedRule.base_price),
        includedTons: Number(selectedRule.included_tons),
        rentalDays: selectedRule.rental_period_days,
        overageRate: Number(selectedRule.overage_per_ton),
        extraDayRate: Number(selectedRule.extra_day_rate),
      });
      toast("success", `Quote emailed to ${quoteEmail}`);
      setQuoteName("");
      setQuoteEmail("");
      setQuotePhone("");
      setQuoteAddress("");
      setQuoteSize("");
    } catch {
      toast("error", "Failed to send quote");
    } finally {
      setQuoteSending(false);
    }
  };

  return (
    <div>
      {/* Header on dark frame */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-xl font-bold"
            style={{ color: "var(--t-frame-text)" }}
          >
            Pricing
          </h1>
          <p
            className="text-sm mt-1"
            style={{ color: "var(--t-frame-text-muted)" }}
          >
            {rules.length} pricing rules
          </p>
        </div>
        <button
          onClick={() => {
            setEditRule(null);
            setEditOpen(true);
          }}
          className="flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold"
          style={{ background: "var(--t-accent)", color: "#000" }}
        >
          <Plus className="h-3.5 w-3.5" /> Add Size
        </button>
      </div>

      {/* Quick links */}
      <div className="flex gap-3 mb-6">
        <Link href="/pricing/surcharges" className="flex items-center gap-2 rounded-[16px] border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--t-bg-card-hover)]"
          style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}>
          <DollarSign className="h-4 w-4" style={{ color: "var(--t-accent)" }} /> Surcharge Templates
        </Link>
        <Link href="/pricing/terms" className="flex items-center gap-2 rounded-[16px] border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--t-bg-card-hover)]"
          style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}>
          <Mail className="h-4 w-4" style={{ color: "var(--t-accent)" }} /> Terms &amp; Conditions
        </Link>
      </div>

      {/* ── QUICK QUOTE (top — most used) ── */}
      <div className="mb-8">
        <p className="text-[11px] font-extrabold uppercase tracking-[1.2px] mb-1" style={{ color: "var(--t-frame-text-muted)" }}>QUICK QUOTE</p>
        <p className="text-[13px] mb-3" style={{ color: "var(--t-frame-text-muted)" }}>Instant quote for phone inquiries</p>

        <div className="rounded-[20px] border p-5" style={{ background: "var(--t-bg-secondary)", borderColor: "var(--t-border)", boxShadow: "0 2px 12px var(--t-shadow)" }}>
          {/* Size pills */}
          <div className="mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--t-text-muted)" }}>Dumpster Size</p>
            <div className="flex flex-wrap gap-1.5">
              {rules.map((rule) => (
                <button key={rule.id} onClick={() => setQuoteSize(rule.asset_subtype)}
                  className="rounded-full px-3.5 py-1.5 text-[13px] font-bold border transition-all"
                  style={{
                    background: quoteSize === rule.asset_subtype ? "var(--t-accent)" : "var(--t-bg-secondary)",
                    color: quoteSize === rule.asset_subtype ? "#000" : "var(--t-text-primary)",
                    borderColor: quoteSize === rule.asset_subtype ? "var(--t-accent)" : "var(--t-border)",
                  }}>
                  {rule.asset_subtype} — ${Number(rule.base_price)}
                </button>
              ))}
            </div>
          </div>

          {/* Form fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--t-text-muted)" }}>Delivery Address</label>
              <AddressAutocomplete
                value={quoteAddress ? { street: quoteAddress } : undefined}
                onChange={(addr) => {
                  setQuoteAddress(addr.formatted || [addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(", "));
                  if (addr.lat && addr.lng) setQuoteCoords({ lat: addr.lat, lng: addr.lng });
                  else setQuoteCoords(null);
                }}
                placeholder="Address or ZIP"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--t-text-muted)" }}>Customer Name</label>
              <input value={quoteName} onChange={(e) => setQuoteName(e.target.value)} placeholder="Optional"
                className="w-full rounded-[14px] border px-3.5 py-2 text-sm outline-none focus:border-[var(--t-accent)]"
                style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--t-text-muted)" }}>Email</label>
              <input value={quoteEmail} onChange={(e) => setQuoteEmail(e.target.value)} placeholder="For emailing quote" type="email"
                className="w-full rounded-[14px] border px-3.5 py-2 text-sm outline-none focus:border-[var(--t-accent)]"
                style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--t-text-muted)" }}>Phone</label>
              <input value={quotePhone} onChange={(e) => setQuotePhone(e.target.value)} placeholder="Optional"
                className="w-full rounded-[14px] border px-3.5 py-2 text-sm outline-none focus:border-[var(--t-accent)]"
                style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} />
            </div>
          </div>

          {/* Quote result */}
          {selectedRule && (
            <div className="rounded-[20px] border-l-4 p-5 mb-4 animate-fade-in"
              style={{ background: "var(--t-bg-card)", borderColor: "var(--t-accent)", borderTop: "1px solid var(--t-border)", borderRight: "1px solid var(--t-border)", borderBottom: "1px solid var(--t-border)" }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[15px] font-bold" style={{ color: "var(--t-text-primary)" }}>{selectedRule.asset_subtype?.replace("yd", " Yard")} Dumpster</p>
                <p className="text-[24px] font-extrabold tracking-tight" style={{ color: distanceInfo?.outsideServiceArea ? "var(--t-error)" : "var(--t-accent)" }}>
                  ${totalQuoted.toLocaleString()}
                </p>
              </div>
              {distanceInfo?.outsideServiceArea && (
                <div className="rounded-lg px-3 py-2 mb-3 text-[12px] font-semibold" style={{ background: "var(--t-error-soft)", color: "var(--t-error)" }}>
                  ⚠ Outside service area ({distanceInfo.distanceMiles} miles). Maximum is {distanceInfo.maxServiceMiles} miles.
                </div>
              )}
              <div className="space-y-1.5 text-[13px]" style={{ color: "var(--t-text-muted)" }}>
                <div className="flex justify-between"><span>Base price</span><span style={{ color: "var(--t-text-primary)" }}>${Number(selectedRule.base_price).toLocaleString()}</span></div>
                {distanceInfo && !distanceInfo.outsideServiceArea && (
                  <div className="flex justify-between">
                    <span>Delivery zone</span>
                    <span style={{ color: deliverySurcharge > 0 ? "var(--t-warning)" : "var(--t-accent)" }}>
                      {distanceInfo.zone ? `${distanceInfo.zone.name} · ${distanceInfo.distanceMiles} mi` : `${distanceInfo.distanceMiles} mi`}
                      {deliverySurcharge > 0 ? ` (+$${deliverySurcharge})` : " (Free)"}
                    </span>
                  </div>
                )}
                {!distanceInfo && quoteAddress && (
                  <div className="flex justify-between"><span>Delivery zone</span><span className="text-[11px] italic" style={{ color: "var(--t-text-tertiary)" }}>Select address for zone pricing</span></div>
                )}
                <div className="flex justify-between"><span>Includes</span><span style={{ color: "var(--t-text-primary)" }}>{Number(selectedRule.included_tons)} tons · {selectedRule.rental_period_days} day rental</span></div>
                <div className="flex justify-between"><span>Overage</span><span style={{ color: "var(--t-text-primary)" }}>${Number(selectedRule.overage_per_ton)}/ton after {Number(selectedRule.included_tons)} tons</span></div>
                <div className="flex justify-between"><span>Extra days</span><span style={{ color: "var(--t-text-primary)" }}>${Number(selectedRule.extra_day_rate)}/day after {selectedRule.rental_period_days} days</span></div>
                {quoteAddress && <div className="flex justify-between"><span>Delivery to</span><span style={{ color: "var(--t-text-primary)" }}>{quoteAddress}</span></div>}
              </div>
              <p className="text-[11px] mt-3" style={{ color: "var(--t-text-tertiary)" }}>Valid for 30 days from today</p>
            </div>
          )}

          {/* Action buttons */}
          {selectedRule && (
            <div className="flex gap-3">
              <Link href={`/book?size=${quoteSize}&address=${encodeURIComponent(quoteAddress)}&name=${encodeURIComponent(quoteName)}&email=${encodeURIComponent(quoteEmail)}&phone=${encodeURIComponent(quotePhone)}`}
                className="flex-1 flex items-center justify-center gap-2 rounded-full py-2.5 text-[13px] font-bold"
                style={{ background: "var(--t-accent)", color: "#000" }}>
                <DollarSign className="h-4 w-4" /> Book Now
              </Link>
              <button onClick={sendQuote} disabled={!quoteEmail || quoteSending}
                className="flex-1 flex items-center justify-center gap-2 rounded-full py-2.5 text-[13px] font-bold border disabled:opacity-50"
                style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)", background: "transparent" }}>
                <Mail className="h-4 w-4" /> {quoteSending ? "Sending..." : "Email Quote"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── PRICING RULES (bottom) ── */}
      <p className="text-[11px] font-extrabold uppercase tracking-[1.2px] mb-3" style={{ color: "var(--t-frame-text-muted)" }}>PRICING RULES</p>
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-28 skeleton rounded-[20px]" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="group relative text-left rounded-[20px] border p-5 transition-all duration-150 cursor-pointer hover:-translate-y-0.5"
              style={{
                background: "var(--t-bg-secondary)",
                borderColor: "var(--t-border)",
                boxShadow: "0 2px 12px var(--t-shadow)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.12)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 2px 12px var(--t-shadow)"; }}
              onClick={() => { setEditRule(rule); setEditOpen(true); }}
            >
              {/* Edit/Delete icons */}
              <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                <button onClick={() => { setEditRule(rule); setEditOpen(true); }}
                  className="p-1.5 rounded-lg transition-colors" style={{ color: "var(--t-text-muted)" }}
                  onMouseEnter={e => { e.currentTarget.style.color = "var(--t-accent)"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "var(--t-text-muted)"; }}>
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={async () => {
                    if (!confirm(`Delete ${rule.asset_subtype || rule.name} pricing rule? Existing invoices will keep their original pricing.`)) return;
                    try { await api.delete(`/pricing/${rule.id}`); toast("success", "Pricing rule deleted"); fetchRules(); }
                    catch { toast("error", "Failed to delete"); }
                  }}
                  className="p-1.5 rounded-lg transition-colors" style={{ color: "var(--t-text-muted)" }}
                  onMouseEnter={e => { e.currentTarget.style.color = "var(--t-error)"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "var(--t-text-muted)"; }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[11px] font-extrabold uppercase tracking-[1.2px]" style={{ color: "var(--t-text-tertiary)" }}>
                {rule.asset_subtype?.replace("yd", " Yard") || rule.name}
              </p>
              <p className="text-[28px] font-extrabold tracking-tight mt-1" style={{ color: "var(--t-text-primary)", letterSpacing: "-1px" }}>
                ${Number(rule.base_price).toLocaleString()}
              </p>
              <p className="text-[12px] mt-1.5" style={{ color: "var(--t-text-muted)" }}>
                {Number(rule.included_tons)} ton{Number(rule.included_tons) !== 1 ? "s" : ""} · {rule.rental_period_days} days · ${Number(rule.extra_day_rate)}/day
              </p>
              <p className="text-[11px] mt-1 font-semibold" style={{ color: "var(--t-accent)" }}>
                ${Number(rule.overage_per_ton)}/ton overage
              </p>
            </div>
          ))}
          {/* Add new size card */}
          <button
            onClick={() => {
              setEditRule(null);
              setEditOpen(true);
            }}
            className="rounded-[20px] border border-dashed p-5 transition-all duration-150 flex flex-col items-center justify-center cursor-pointer"
            style={{
              borderColor: "var(--t-border)",
              color: "var(--t-text-muted)",
              minHeight: 120,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--t-accent)";
              e.currentTarget.style.color = "var(--t-accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--t-border)";
              e.currentTarget.style.color = "var(--t-text-muted)";
            }}
          >
            <Plus className="h-6 w-6 mb-1" />
            <span className="text-xs font-semibold">Add Size</span>
          </button>
        </div>
      )}

      {/* ── DELIVERY ZONES ── */}
      <div className="mt-8">
        <p className="text-[11px] font-extrabold uppercase tracking-[1.2px] mb-1" style={{ color: "var(--t-frame-text-muted)" }}>DELIVERY ZONES</p>
        <p className="text-[13px] mb-4" style={{ color: "var(--t-frame-text-muted)" }}>Distance-based delivery surcharges from your yard</p>

        {/* Yard Location Card */}
        <div className="rounded-[20px] border p-5 mb-4" style={{ background: "var(--t-bg-secondary)", borderColor: "var(--t-border)", boxShadow: "0 2px 12px var(--t-shadow)" }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4" style={{ color: "var(--t-accent)" }} />
              <p className="text-[11px] font-extrabold uppercase tracking-[1.2px]" style={{ color: "var(--t-text-muted)" }}>Home Base / Yard Location</p>
            </div>
            <button onClick={() => setEditingYard(!editingYard)} className="text-xs font-medium" style={{ color: "var(--t-accent)" }}>
              {editingYard ? "Cancel" : "Change"}
            </button>
          </div>
          <p className="text-[12px] mb-2" style={{ color: "var(--t-text-tertiary)" }}>Distances for delivery zones are calculated from this location</p>
          {yardAddress ? (
            <p className="text-[14px] font-semibold" style={{ color: "var(--t-text-primary)" }}>
              {[yardAddress.street, yardAddress.city, yardAddress.state, yardAddress.zip].filter(Boolean).join(", ")}
            </p>
          ) : (
            <p className="text-[13px] italic" style={{ color: "var(--t-text-tertiary)" }}>No yard location set — distances cannot be calculated</p>
          )}
          {editingYard && (
            <div className="mt-3">
              <AddressAutocomplete
                value={yardAddress || undefined}
                onChange={async (addr) => {
                  try {
                    await api.patch("/auth/profile", { yardLatitude: addr.lat, yardLongitude: addr.lng, yardAddress: { street: addr.street, city: addr.city, state: addr.state, zip: addr.zip } });
                    setYardAddress({ street: addr.street, city: addr.city, state: addr.state, zip: addr.zip });
                    if (addr.lat) setYardLat(addr.lat);
                    if (addr.lng) setYardLng(addr.lng);
                    setEditingYard(false);
                    toast("success", "Yard location updated");
                  } catch { toast("error", "Failed to update"); }
                }}
                placeholder="Search for yard address..."
              />
            </div>
          )}
        </div>

        {/* Zone Table */}
        <div className="rounded-[20px] border overflow-hidden" style={{ background: "var(--t-bg-secondary)", borderColor: "var(--t-border)", boxShadow: "0 2px 12px var(--t-shadow)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--t-border)" }}>
                <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--t-text-muted)" }}>Zone</th>
                <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--t-text-muted)" }}>Distance</th>
                <th className="text-right px-5 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--t-text-muted)" }}>Surcharge</th>
                <th className="w-20 px-3 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {zones.map((z, i) => {
                const isEditing = editingZone === z.id;
                return (
                  <tr key={z.id} style={{ borderBottom: i < zones.length - 1 ? "1px solid var(--t-border-subtle)" : "none" }}>
                    {isEditing ? (
                      <>
                        <td className="px-5 py-2"><input value={zoneForm.zoneName} onChange={e => setZoneForm({ ...zoneForm, zoneName: e.target.value })} className="w-full rounded-lg border px-2 py-1.5 text-sm outline-none" style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} /></td>
                        <td className="px-5 py-2">
                          <div className="flex items-center gap-1">
                            <input value={zoneForm.minMiles} onChange={e => setZoneForm({ ...zoneForm, minMiles: e.target.value })} type="number" className="w-16 rounded-lg border px-2 py-1.5 text-sm outline-none text-center" style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} />
                            <span style={{ color: "var(--t-text-muted)" }}>–</span>
                            <input value={zoneForm.maxMiles} onChange={e => setZoneForm({ ...zoneForm, maxMiles: e.target.value })} type="number" className="w-16 rounded-lg border px-2 py-1.5 text-sm outline-none text-center" style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} />
                            <span className="text-xs" style={{ color: "var(--t-text-muted)" }}>mi</span>
                          </div>
                        </td>
                        <td className="px-5 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-xs" style={{ color: "var(--t-text-muted)" }}>$</span>
                            <input value={zoneForm.surcharge} onChange={e => setZoneForm({ ...zoneForm, surcharge: e.target.value })} type="number" className="w-20 rounded-lg border px-2 py-1.5 text-sm outline-none text-right" style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} />
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1 justify-end">
                            <button onClick={async () => {
                              try {
                                await api.patch(`/pricing/delivery-zones/${z.id}`, { zoneName: zoneForm.zoneName, minMiles: Number(zoneForm.minMiles), maxMiles: Number(zoneForm.maxMiles), surcharge: Number(zoneForm.surcharge) });
                                toast("success", "Zone updated");
                                setEditingZone(null);
                                fetchRules();
                              } catch { toast("error", "Failed"); }
                            }} className="p-1.5 rounded-lg" style={{ color: "var(--t-accent)" }}><Check className="h-4 w-4" /></button>
                            <button onClick={() => setEditingZone(null)} className="p-1.5 rounded-lg" style={{ color: "var(--t-text-muted)" }}><X className="h-4 w-4" /></button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-5 py-3 font-semibold" style={{ color: "var(--t-text-primary)" }}>{z.zone_name}</td>
                        <td className="px-5 py-3" style={{ color: "var(--t-text-muted)" }}>{Number(z.min_miles)} – {Number(z.max_miles)} miles</td>
                        <td className="px-5 py-3 text-right font-semibold" style={{ color: Number(z.surcharge) > 0 ? "var(--t-warning)" : "var(--t-accent)" }}>
                          {Number(z.surcharge) > 0 ? `+$${Number(z.surcharge)}` : "Free"}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => { setEditingZone(z.id); setZoneForm({ zoneName: z.zone_name, minMiles: String(Number(z.min_miles)), maxMiles: String(Number(z.max_miles)), surcharge: String(Number(z.surcharge)) }); }}
                              className="p-1.5 rounded-lg transition-all" style={{ color: "var(--t-text-muted)" }}
                              onMouseEnter={e => { e.currentTarget.style.background = "var(--t-bg-card-hover)"; }}
                              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={async () => {
                              if (!confirm(`Delete ${z.zone_name}?`)) return;
                              try { await api.delete(`/pricing/delivery-zones/${z.id}`); toast("success", "Zone deleted"); fetchRules(); }
                              catch { toast("error", "Failed"); }
                            }} className="p-1.5 rounded-lg transition-all" style={{ color: "var(--t-text-muted)" }}
                              onMouseEnter={e => { e.currentTarget.style.color = "var(--t-error)"; }}
                              onMouseLeave={e => { e.currentTarget.style.color = "var(--t-text-muted)"; }}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              {/* Add zone row */}
              {addingZone && (
                <tr style={{ borderTop: "1px solid var(--t-border-subtle)" }}>
                  <td className="px-5 py-2"><input value={zoneForm.zoneName} onChange={e => setZoneForm({ ...zoneForm, zoneName: e.target.value })} placeholder="Zone name" className="w-full rounded-lg border px-2 py-1.5 text-sm outline-none" style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} /></td>
                  <td className="px-5 py-2">
                    <div className="flex items-center gap-1">
                      <input value={zoneForm.minMiles} onChange={e => setZoneForm({ ...zoneForm, minMiles: e.target.value })} type="number" placeholder="0" className="w-16 rounded-lg border px-2 py-1.5 text-sm outline-none text-center" style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} />
                      <span style={{ color: "var(--t-text-muted)" }}>–</span>
                      <input value={zoneForm.maxMiles} onChange={e => setZoneForm({ ...zoneForm, maxMiles: e.target.value })} type="number" placeholder="15" className="w-16 rounded-lg border px-2 py-1.5 text-sm outline-none text-center" style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} />
                      <span className="text-xs" style={{ color: "var(--t-text-muted)" }}>mi</span>
                    </div>
                  </td>
                  <td className="px-5 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <span className="text-xs" style={{ color: "var(--t-text-muted)" }}>$</span>
                      <input value={zoneForm.surcharge} onChange={e => setZoneForm({ ...zoneForm, surcharge: e.target.value })} type="number" placeholder="0" className="w-20 rounded-lg border px-2 py-1.5 text-sm outline-none text-right" style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)" }} />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1 justify-end">
                      <button onClick={async () => {
                        try {
                          await api.post("/pricing/delivery-zones", { zoneName: zoneForm.zoneName, minMiles: Number(zoneForm.minMiles), maxMiles: Number(zoneForm.maxMiles), surcharge: Number(zoneForm.surcharge), sortOrder: zones.length + 1 });
                          toast("success", "Zone added");
                          setAddingZone(false);
                          fetchRules();
                        } catch { toast("error", "Failed"); }
                      }} className="p-1.5 rounded-lg" style={{ color: "var(--t-accent)" }}><Check className="h-4 w-4" /></button>
                      <button onClick={() => setAddingZone(false)} className="p-1.5 rounded-lg" style={{ color: "var(--t-text-muted)" }}><X className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              )}
              {zones.length === 0 && !addingZone && (
                <tr><td colSpan={4} className="px-5 py-6 text-center text-xs" style={{ color: "var(--t-text-muted)" }}>No zones configured</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {!addingZone && (
          <button onClick={() => {
            const lastZone = zones[zones.length - 1];
            const nextMin = lastZone ? Number(lastZone.max_miles) : 0;
            setZoneForm({ zoneName: `Zone ${zones.length + 1}`, minMiles: String(nextMin), maxMiles: String(nextMin + 15), surcharge: String(lastZone ? Number(lastZone.surcharge) + 50 : 0) });
            setAddingZone(true);
          }}
            className="mt-3 flex items-center gap-1.5 text-xs font-semibold transition-all" style={{ color: "var(--t-frame-text-muted)" }}
            onMouseEnter={e => { e.currentTarget.style.color = "var(--t-accent)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "var(--t-frame-text-muted)"; }}>
            <Plus className="h-3.5 w-3.5" /> Add Zone
          </button>
        )}
        {zones.length > 0 && (
          <p className="text-[11px] mt-3" style={{ color: "var(--t-frame-text-muted)" }}>
            Addresses beyond {Math.max(...zones.map(z => Number(z.max_miles)))} miles will show as outside service area
          </p>
        )}
      </div>

      {/* Edit Pricing SlideOver */}
      <SlideOver
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={
          editRule ? `Edit ${editRule.asset_subtype} Pricing` : "Add New Size"
        }
      >
        <PricingForm
          rule={editRule}
          onSave={saveRule}
          onClose={() => setEditOpen(false)}
        />
      </SlideOver>
    </div>
  );
}

/* ── Pricing Edit Form ── */
function PricingForm({
  rule,
  onSave,
  onClose,
}: {
  rule: PricingRule | null;
  onSave: (data: Partial<PricingRule>) => void;
  onClose: () => void;
}) {
  const [basePrice, setBasePrice] = useState(
    rule ? String(Number(rule.base_price)) : ""
  );
  const [includedTons, setIncludedTons] = useState(
    rule ? String(Number(rule.included_tons)) : ""
  );
  const [overageRate, setOverageRate] = useState(
    rule ? String(Number(rule.overage_per_ton)) : ""
  );
  const [rentalDays, setRentalDays] = useState(
    rule ? String(rule.rental_period_days) : "14"
  );
  const [extraDayRate, setExtraDayRate] = useState(
    rule ? String(Number(rule.extra_day_rate)) : ""
  );
  const inputStyle = {
    background: "var(--t-bg-card)",
    borderColor: "var(--t-border)",
    color: "var(--t-text-primary)",
  };

  const fields = [
    {
      label: "Base Price",
      value: basePrice,
      set: setBasePrice,
      prefix: "$",
      suffix: undefined,
    },
    {
      label: "Included Tonnage",
      value: includedTons,
      set: setIncludedTons,
      prefix: undefined,
      suffix: "tons",
    },
    {
      label: "Overage Rate",
      value: overageRate,
      set: setOverageRate,
      prefix: "$",
      suffix: "/ton",
    },
    {
      label: "Rental Period",
      value: rentalDays,
      set: setRentalDays,
      prefix: undefined,
      suffix: "days",
    },
    {
      label: "Extra Day Rate",
      value: extraDayRate,
      set: setExtraDayRate,
      prefix: "$",
      suffix: "/day",
    },
  ];

  return (
    <div className="space-y-5">
      {fields.map((field) => (
        <div key={field.label}>
          <label
            className="block text-[12px] font-semibold uppercase tracking-wide mb-1.5"
            style={{ color: "var(--t-text-muted)" }}
          >
            {field.label}
          </label>
          <div className="relative">
            {field.prefix && (
              <span
                className="absolute left-4 top-1/2 -translate-y-1/2 text-sm"
                style={{ color: "var(--t-text-muted)" }}
              >
                {field.prefix}
              </span>
            )}
            <input
              value={field.value}
              onChange={(e) => field.set(e.target.value)}
              type="number"
              className="w-full rounded-[14px] border px-4 py-2.5 text-sm outline-none transition-colors focus:border-[var(--t-accent)]"
              style={{
                ...inputStyle,
                paddingLeft: field.prefix ? 28 : 16,
              }}
            />
            {field.suffix && (
              <span
                className="absolute right-4 top-1/2 -translate-y-1/2 text-xs"
                style={{ color: "var(--t-text-muted)" }}
              >
                {field.suffix}
              </span>
            )}
          </div>
        </div>
      ))}

      <div className="flex gap-3 pt-4">
        <button
          onClick={() =>
            onSave({
              basePrice: Number(basePrice),
              includedTons: Number(includedTons),
              overagePerTon: Number(overageRate),
              rentalPeriodDays: Number(rentalDays),
              extraDayRate: Number(extraDayRate),
            } as any)
          }
          className="flex-1 rounded-full py-3 text-[13px] font-bold"
          style={{ background: "var(--t-accent)", color: "#000" }}
        >
          Save
        </button>
        <button
          onClick={onClose}
          className="rounded-full px-6 py-3 text-[13px] font-medium border"
          style={{
            borderColor: "var(--t-border)",
            color: "var(--t-text-muted)",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
