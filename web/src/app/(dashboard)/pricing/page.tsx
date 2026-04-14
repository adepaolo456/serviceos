"use client";

/**
 * Pricing hub — main landing page for the Pricing admin surface.
 *
 * Before this refactor, the landing page tried to render every
 * pricing rule as a large tile in a responsive grid. That worked
 * for 3-4 dumpster sizes but would not scale once a tenant had 15+
 * rules or once ServiceOS expanded into other service categories
 * (portable storage, restrooms, equipment rentals).
 *
 * The landing page now acts as a hub: it shows a compact summary
 * card for Pricing Rules (with a count and a small preview) and
 * links into the dedicated `/pricing/rules` page where the full
 * scalable table view lives. Delivery Zones, Surcharge Templates,
 * and Terms & Conditions are preserved in their existing shapes.
 *
 * Pricing LOGIC is unchanged — this page still reads from the same
 * endpoints, the pricing rules themselves still flow through the
 * same create / update / delete APIs (on the dedicated rules page),
 * and invoice / billing / customer-facing service descriptions are
 * deliberately untouched.
 */

import { useState, useEffect, useCallback } from "react";
import { Plus, DollarSign, Pencil, Trash2, Check, X, MapPin, ArrowRight, FileText } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import AddressAutocomplete from "@/components/address-autocomplete";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";

// Minimal shape — only the fields the hub summary preview needs.
// The dedicated /pricing/rules page pulls the full PricingRule shape.
interface PricingRuleSummary {
  id: string;
  name: string;
  asset_subtype: string;
  base_price: number;
}

interface PricingResponse {
  data: PricingRuleSummary[];
  meta: { total: number };
}

export default function PricingPage() {
  const [rules, setRules] = useState<PricingRuleSummary[]>([]);
  const [loading, setLoading] = useState(true);
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

  const rulesCardLabel =
    FEATURE_REGISTRY.pricing_hub_rules_card_title?.label ?? "Pricing Rules";
  const rulesCardDesc =
    FEATURE_REGISTRY.pricing_hub_rules_card_description?.shortDescription
      ?? "Base prices, included capacity, durations, and overage rates.";
  const rulesCta =
    FEATURE_REGISTRY.pricing_hub_rules_manage_cta?.label ?? "Manage pricing rules";

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)]">
            {FEATURE_REGISTRY.pricing_hub_title?.label ?? "Pricing"}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--t-frame-text-muted)]">
            {FEATURE_REGISTRY.pricing_hub_subtitle?.shortDescription
              ?? "Rules, delivery zones, surcharges, and customer-facing terms."}
          </p>
        </div>
      </div>

      {/* ── PRICING RULES summary card ── */}
      <p
        className="text-[11px] font-extrabold uppercase tracking-[1.2px] mb-3"
        style={{ color: "var(--t-frame-text-muted)" }}
      >
        {(FEATURE_REGISTRY.pricing_hub_section_rules?.label ?? "Pricing Rules").toUpperCase()}
      </p>
      <Link
        href="/pricing/rules"
        className="block rounded-[14px] border p-5 mb-6 transition-all hover:border-[var(--t-accent)]"
        style={{
          background: "var(--t-bg-secondary)",
          borderColor: "var(--t-border)",
          boxShadow: "0 2px 12px var(--t-shadow)",
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5">
              <DollarSign className="h-4 w-4 shrink-0" style={{ color: "var(--t-accent)" }} />
              <p
                className="text-[14px] font-semibold"
                style={{ color: "var(--t-text-primary)" }}
              >
                {rulesCardLabel}
              </p>
            </div>
            <p className="text-[12px] mb-3" style={{ color: "var(--t-text-muted)" }}>
              {rulesCardDesc}
            </p>
            {loading ? (
              <div className="h-5 w-40 skeleton rounded" />
            ) : rules.length === 0 ? (
              <p className="text-[12px] italic" style={{ color: "var(--t-text-tertiary)" }}>
                {FEATURE_REGISTRY.pricing_hub_rules_empty?.label
                  ?? "No pricing rules configured yet"}
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  className="text-[12px] font-semibold tabular-nums"
                  style={{ color: "var(--t-text-primary)" }}
                >
                  {rules.length} rule{rules.length === 1 ? "" : "s"}
                </span>
                <span style={{ color: "var(--t-text-tertiary)" }}>·</span>
                <span className="text-[12px]" style={{ color: "var(--t-text-muted)" }}>
                  {rules
                    .slice(0, 5)
                    .map((r) => r.asset_subtype || r.name)
                    .filter(Boolean)
                    .join(" · ")}
                  {rules.length > 5 ? ` · +${rules.length - 5} more` : ""}
                </span>
              </div>
            )}
          </div>
          <div
            className="flex items-center gap-1.5 text-[12px] font-semibold shrink-0"
            style={{ color: "var(--t-accent)" }}
          >
            {rulesCta} <ArrowRight className="h-3.5 w-3.5" />
          </div>
        </div>
      </Link>

      {/* ── OTHER SECTIONS — Surcharges, Terms ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mb-8">
        <Link
          href="/pricing/surcharges"
          className="flex items-start gap-3 rounded-[14px] border p-5 transition-all hover:border-[var(--t-accent)]"
          style={{
            background: "var(--t-bg-secondary)",
            borderColor: "var(--t-border)",
            boxShadow: "0 2px 12px var(--t-shadow)",
          }}
        >
          <DollarSign className="h-5 w-5 shrink-0 mt-0.5" style={{ color: "var(--t-accent)" }} />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold" style={{ color: "var(--t-text-primary)" }}>
              {FEATURE_REGISTRY.pricing_hub_section_surcharges?.label ?? "Surcharge Templates"}
            </p>
            <p className="text-[12px] mt-0.5" style={{ color: "var(--t-text-muted)" }}>
              {FEATURE_REGISTRY.pricing_hub_surcharges_description?.shortDescription
                ?? "Reusable charges applied to jobs or invoices."}
            </p>
          </div>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 mt-1" style={{ color: "var(--t-accent)" }} />
        </Link>
        <Link
          href="/pricing/terms"
          className="flex items-start gap-3 rounded-[14px] border p-5 transition-all hover:border-[var(--t-accent)]"
          style={{
            background: "var(--t-bg-secondary)",
            borderColor: "var(--t-border)",
            boxShadow: "0 2px 12px var(--t-shadow)",
          }}
        >
          <FileText className="h-5 w-5 shrink-0 mt-0.5" style={{ color: "var(--t-accent)" }} />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold" style={{ color: "var(--t-text-primary)" }}>
              {FEATURE_REGISTRY.pricing_hub_section_terms?.label ?? "Terms & Conditions"}
            </p>
            <p className="text-[12px] mt-0.5" style={{ color: "var(--t-text-muted)" }}>
              {FEATURE_REGISTRY.pricing_hub_terms_description?.shortDescription
                ?? "Customer-facing legal text shown on quotes and invoices."}
            </p>
          </div>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 mt-1" style={{ color: "var(--t-accent)" }} />
        </Link>
      </div>

      {/* ── DELIVERY ZONES ── */}
      <div className="mt-8">
        <p className="text-[11px] font-extrabold uppercase tracking-[1.2px] mb-1" style={{ color: "var(--t-frame-text-muted)" }}>DELIVERY ZONES</p>
        <p className="text-[13px] mb-4" style={{ color: "var(--t-frame-text-muted)" }}>Distance-based delivery surcharges from your yard</p>

        {/* Yard Location Card */}
        <div className="rounded-[14px] border p-5 mb-4" style={{ background: "var(--t-bg-secondary)", borderColor: "var(--t-border)", boxShadow: "0 2px 12px var(--t-shadow)" }}>
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
        <div className="rounded-[14px] border overflow-hidden" style={{ background: "var(--t-bg-secondary)", borderColor: "var(--t-border)", boxShadow: "0 2px 12px var(--t-shadow)" }}>
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

      {/*
       * Rule edit SlideOver moved to `/pricing/rules`. That page
       * owns the full PricingForm and the compact table that
       * replaces the legacy big-card grid.
       */}
    </div>
  );
}
