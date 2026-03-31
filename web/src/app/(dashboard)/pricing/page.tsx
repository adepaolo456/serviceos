"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import {
  Plus,
  Calculator,
  DollarSign,
  Truck,
  MapPin,
  Package,
  Clock,
  ChevronDown,
  ChevronUp,
  Pencil,
  ExternalLink,
  History,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";
import { useToast } from "@/components/toast";

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
  is_active: boolean;
}

interface PricingResponse {
  data: PricingRule[];
  meta: { total: number };
}

interface PriceBreakdown {
  rule: { id: string; name: string };
  breakdown: {
    basePrice: number;
    rentalDays: number;
    includedDays: number;
    extraDays: number;
    extraDayRate: number;
    extraDayCharges: number;
    distanceMiles: number;
    includedMiles: number;
    excessMiles: number;
    perMileCharge: number;
    distanceSurcharge: number;
    jobType: string;
    jobFee: number;
    subtotal: number;
    taxRate: number;
    tax: number;
    total: number;
    requireDeposit: boolean;
    depositAmount: number;
    includedTons: number;
    overagePerTon: number;
  };
}

const SERVICE_LABELS: Record<string, string> = {
  dumpster_rental: "Dumpster Rental",
  pod_storage: "Pod Storage",
  restroom_service: "Restroom Service",
  landscaping: "Landscaping",
};

import { formatCurrency } from "@/lib/utils";
const fmt = (n: number | null | undefined) => formatCurrency(n as number);

/* ── Design-system helpers ── */
const inputCls =
  "w-full rounded-[18px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2.5 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none transition-colors focus:border-[var(--t-accent)]";
const labelCls =
  "block text-[13px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] mb-1.5";
const sectionCls =
  "text-[13px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] mb-3 mt-6";

export default function PricingPage() {
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(true);
  const [editRule, setEditRule] = useState<PricingRule | null>(null);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<PricingResponse>("/pricing?limit=100");
      setRules(res.data);
    } catch {
      /* handled */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const grouped = rules.reduce<Record<string, PricingRule[]>>((acc, r) => {
    const key = r.service_type;
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  const sizeGrouped = (rules: PricingRule[]) => {
    const bySize: Record<string, PricingRule[]> = {};
    rules.forEach((r) => {
      const key = r.asset_subtype || "other";
      if (!bySize[key]) bySize[key] = [];
      bySize[key].push(r);
    });
    return bySize;
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-text-primary)]">
            Pricing
          </h1>
          <p className="mt-1 text-[13px] text-[var(--t-text-muted)]">{rules.length} pricing rules</p>
        </div>
        <button
          onClick={() => setPanelOpen(true)}
          className="flex items-center gap-2 rounded-full bg-[#22C55E] px-6 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          New Rule
        </button>
      </div>

      {/* Price Calculator */}
      <div className="mb-8 rounded-[18px] border border-[var(--t-border)] bg-[var(--t-bg-card)] overflow-hidden">
        <button
          onClick={() => setCalcOpen(!calcOpen)}
          className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-[var(--t-bg-card-hover)]"
        >
          <div className="flex items-center gap-3">
            <Calculator className="h-5 w-5 text-[var(--t-accent)]" />
            <div>
              <h2 className="text-base font-semibold text-[var(--t-text-primary)]">
                Price Calculator
              </h2>
              <p className="text-[13px] text-[var(--t-text-muted)]">
                Get an instant quote for any service
              </p>
            </div>
          </div>
          {calcOpen ? (
            <ChevronUp className="h-5 w-5 text-[var(--t-text-muted)]" />
          ) : (
            <ChevronDown className="h-5 w-5 text-[var(--t-text-muted)]" />
          )}
        </button>
        {calcOpen && (
          <div className="border-t border-[var(--t-border)] p-6">
            <PriceCalculator />
          </div>
        )}
      </div>

      {/* Rules grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 skeleton rounded-[18px]" />
          ))}
        </div>
      ) : rules.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center text-center">
          <DollarSign size={48} className="text-[var(--t-text-muted)] opacity-30 mb-4" />
          <p className="text-lg font-semibold text-[var(--t-text-primary)] mb-1">No pricing rules</p>
          <p className="text-sm text-[var(--t-text-muted)] mb-6">Create your first pricing rule to start quoting jobs</p>
          <button
            onClick={() => setPanelOpen(true)}
            className="flex items-center gap-2 rounded-full bg-[#22C55E] px-6 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            New Rule
          </button>
        </div>
      ) : (
        Object.entries(grouped).map(([serviceType, serviceRules]) => {
          const bySize = sizeGrouped(serviceRules);
          return (
            <div key={serviceType} className="mb-8">
              <h2 className="text-lg font-semibold text-[var(--t-text-primary)] mb-4">
                {SERVICE_LABELS[serviceType] || serviceType}
              </h2>
              {Object.entries(bySize).map(([size, sizeRules]) => {
                const hasMultipleTypes = sizeRules.length > 1 && sizeRules.some((r) => r.customer_type);
                return (
                  <SizeTile key={size} size={size} rules={sizeRules} hasCustomerTypes={hasMultipleTypes} onEdit={setEditRule} />
                );
              })}
            </div>
          );
        })
      )}

      <SlideOver open={panelOpen} onClose={() => setPanelOpen(false)} title="New Pricing Rule">
        <CreateRuleForm onSuccess={() => { setPanelOpen(false); fetchRules(); }} />
      </SlideOver>

      <SlideOver open={!!editRule} onClose={() => setEditRule(null)} title="Edit Pricing Rule">
        {editRule && <EditRuleForm rule={editRule} onSuccess={() => { setEditRule(null); fetchRules(); }} onDelete={() => { setEditRule(null); fetchRules(); }} />}
      </SlideOver>
    </div>
  );
}

/* ---------- Size Tile ---------- */

function SizeTile({ size, rules, hasCustomerTypes, onEdit }: { size: string; rules: PricingRule[]; hasCustomerTypes: boolean; onEdit: (rule: PricingRule) => void }) {
  const [activeType, setActiveType] = useState<string | null>(null);
  const filteredRules = activeType ? rules.filter((r) => r.customer_type === activeType) : rules;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[11px] font-semibold uppercase text-[var(--t-accent)]">{size}</span>
        {hasCustomerTypes && (
          <div className="flex gap-1">
            {[
              { key: null, label: "All" },
              { key: "residential", label: "Residential" },
              { key: "commercial", label: "Commercial" },
            ].map((opt) => (
              <button
                key={String(opt.key)}
                onClick={() => setActiveType(opt.key)}
                className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                  activeType === opt.key
                    ? "bg-[var(--t-accent-soft)] text-[var(--t-accent)]"
                    : "text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredRules.map((rule) => (
          <RuleCard key={rule.id} rule={rule} onEdit={() => onEdit(rule)} />
        ))}
      </div>
    </div>
  );
}

/* ---------- Rule Card ---------- */

function RuleCard({ rule, onEdit }: { rule: PricingRule; onEdit: () => void }) {
  return (
    <div
      onClick={onEdit}
      className={`group relative cursor-pointer rounded-[18px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5 transition-colors hover:bg-[var(--t-bg-card-hover)] ${
        !rule.is_active ? "opacity-50" : ""
      }`}
    >
      <Pencil className="absolute top-4 right-4 h-4 w-4 text-[var(--t-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />

      {/* Title + Price */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-base font-semibold text-[var(--t-text-primary)]">{rule.name}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase text-[var(--t-accent)]">{rule.asset_subtype}</span>
            {rule.customer_type && (
              <span className="text-[11px] font-semibold capitalize text-[var(--t-text-muted)]">{rule.customer_type}</span>
            )}
            {!rule.is_active && (
              <span className="text-[11px] font-semibold text-[var(--t-error)]">Inactive</span>
            )}
          </div>
        </div>
        <p className="text-[24px] font-bold text-[var(--t-text-primary)] tabular-nums">
          {fmt(rule.base_price)}
        </p>
      </div>

      {/* Key-value pairs */}
      <div className="space-y-1.5 text-[13px]">
        <KV icon={<Clock className="h-3 w-3" />} label={`${rule.rental_period_days} days included`} detail={`${fmt(rule.extra_day_rate)}/extra day`} />
        <KV icon={<MapPin className="h-3 w-3" />} label={`${Number(rule.included_miles)} mi free`} detail={`${fmt(rule.per_mile_charge)}/mi after`} />
        <KV icon={<Package className="h-3 w-3" />} label={`${Number(rule.included_tons)} tons included`} detail={`${fmt(rule.overage_per_ton)}/ton over`} />
        <KV icon={<Truck className="h-3 w-3" />} label={`Delivery ${fmt(rule.delivery_fee)}`} detail={`Pickup ${fmt(rule.pickup_fee)}${Number(rule.exchange_fee) > 0 ? ` / Exch -${Number(rule.exchange_fee)}%` : ""}`} />
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-[var(--t-border)] pt-3">
        <div className="flex items-center gap-3 text-[13px] text-[var(--t-text-muted)]">
          {rule.require_deposit ? (
            <span>Deposit: {fmt(rule.deposit_amount)}</span>
          ) : (
            <span>No deposit</span>
          )}
          {Number(rule.tax_rate) > 0 && (
            <span>Tax: {(Number(rule.tax_rate) * 100).toFixed(2)}%</span>
          )}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); }}
          className="flex items-center gap-1 text-[11px] text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] transition-colors"
          title="Pricing change history coming soon"
        >
          <History className="h-3 w-3" /> History
        </button>
      </div>
    </div>
  );
}

function KV({ icon, label, detail }: { icon: React.ReactNode; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-2 text-[var(--t-text-muted)]">
      {icon}
      <span className="text-[var(--t-text-primary)]">{label}</span>
      <span className="text-[var(--t-text-muted)]">{detail}</span>
    </div>
  );
}

/* ---------- Price Calculator ---------- */

function PriceCalculator() {
  const router = useRouter();
  const [serviceType, setServiceType] = useState("dumpster_rental");
  const [assetSubtype, setAssetSubtype] = useState("20yd");
  const [jobType, setJobType] = useState("delivery");
  const [lat, setLat] = useState("30.2672");
  const [lng, setLng] = useState("-97.7431");
  const [rentalDays, setRentalDays] = useState("7");
  const [result, setResult] = useState<PriceBreakdown | null>(null);
  const [error, setError] = useState("");
  const [calculating, setCalculating] = useState(false);

  const handleCalculate = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setResult(null);
    setCalculating(true);
    try {
      const data = await api.post<PriceBreakdown>("/pricing/calculate", {
        serviceType,
        assetSubtype,
        jobType,
        customerLat: Number(lat),
        customerLng: Number(lng),
        yardLat: 30.35,
        yardLng: -97.7,
        rentalDays: Number(rentalDays) || undefined,
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Calculation failed");
    } finally {
      setCalculating(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <form onSubmit={handleCalculate} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Service Type</label>
            <select value={serviceType} onChange={(e) => setServiceType(e.target.value)} className={`${inputCls} appearance-none`}>
              <option value="dumpster_rental">Dumpster Rental</option>
              <option value="pod_storage">Pod Storage</option>
              <option value="restroom_service">Restroom Service</option>
              <option value="landscaping">Landscaping</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Size</label>
            <select value={assetSubtype} onChange={(e) => setAssetSubtype(e.target.value)} className={`${inputCls} appearance-none`}>
              <option value="10yd">10 yd</option>
              <option value="20yd">20 yd</option>
              <option value="30yd">30 yd</option>
              <option value="40yd">40 yd</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Job Type</label>
            <select value={jobType} onChange={(e) => setJobType(e.target.value)} className={`${inputCls} appearance-none`}>
              <option value="delivery">Delivery</option>
              <option value="pickup">Pickup</option>
              <option value="exchange">Exchange</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Rental Days</label>
            <input type="number" value={rentalDays} onChange={(e) => setRentalDays(e.target.value)} className={inputCls} min="1" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Customer Lat</label>
            <input type="number" step="any" value={lat} onChange={(e) => setLat(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Customer Lng</label>
            <input type="number" step="any" value={lng} onChange={(e) => setLng(e.target.value)} className={inputCls} />
          </div>
        </div>

        <button
          type="submit"
          disabled={calculating}
          className="w-full rounded-full bg-[#22C55E] px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {calculating ? "Calculating..." : "Calculate Price"}
        </button>

        {error && (
          <div className="rounded-[18px] bg-[var(--t-error-soft)] px-4 py-3 text-sm text-[var(--t-error)]">
            {error}
          </div>
        )}
      </form>

      {/* Receipt */}
      <div className="rounded-[18px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
        {!result ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--t-text-muted)] py-12">
            <div className="text-center">
              <DollarSign className="mx-auto h-8 w-8 text-[var(--t-text-muted)] opacity-40 mb-2" />
              <p>Enter details and click Calculate</p>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[13px] uppercase font-semibold tracking-wide text-[var(--t-text-muted)]">Quote</p>
                <p className="text-sm font-medium text-[var(--t-text-primary)]">{result.rule.name}</p>
              </div>
              <p className="text-[24px] font-bold text-[var(--t-accent)] tabular-nums">
                {fmt(result.breakdown.total)}
              </p>
            </div>

            <div className="space-y-0 text-sm">
              <ReceiptLine label="Base price" value={fmt(result.breakdown.basePrice)} />
              <ReceiptLine label={`Rental (${result.breakdown.rentalDays} days, ${result.breakdown.includedDays} included)`} value="" />
              {result.breakdown.extraDays > 0 && (
                <ReceiptLine label={`  Extra days (${result.breakdown.extraDays} x ${fmt(result.breakdown.extraDayRate)})`} value={fmt(result.breakdown.extraDayCharges)} indent />
              )}
              <ReceiptLine label={`Distance (${result.breakdown.distanceMiles} mi, ${result.breakdown.includedMiles} free)`} value="" />
              {result.breakdown.distanceSurcharge > 0 && (
                <ReceiptLine label={`  Surcharge (${result.breakdown.excessMiles} mi x ${fmt(result.breakdown.perMileCharge)})`} value={fmt(result.breakdown.distanceSurcharge)} indent />
              )}
              {result.breakdown.jobFee > 0 && (
                <ReceiptLine label={`${result.breakdown.jobType} fee`} value={fmt(result.breakdown.jobFee)} />
              )}

              <div className="border-t border-[var(--t-border)] my-2" />
              <ReceiptLine label="Subtotal" value={fmt(result.breakdown.subtotal)} bold />
              {result.breakdown.tax > 0 && (
                <ReceiptLine label={`Tax (${(result.breakdown.taxRate * 100).toFixed(2)}%)`} value={fmt(result.breakdown.tax)} />
              )}
              <div className="border-t border-[var(--t-border)] my-2" />
              <ReceiptLine label="Total" value={fmt(result.breakdown.total)} bold highlight />

              {result.breakdown.requireDeposit && (
                <>
                  <div className="border-t border-dashed border-[var(--t-border)] my-2" />
                  <ReceiptLine label="Deposit required" value={fmt(result.breakdown.depositAmount)} />
                </>
              )}

              {result.breakdown.includedTons > 0 && (
                <p className="mt-3 text-[11px] text-[var(--t-text-muted)]">
                  Includes {result.breakdown.includedTons} tons. {fmt(result.breakdown.overagePerTon)}/ton overage.
                </p>
              )}

              <button
                type="button"
                onClick={() => router.push(`/book?size=${assetSubtype}&type=${jobType}&days=${rentalDays}`)}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-[#22C55E] px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
              >
                Create Booking with This Quote
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReceiptLine({
  label,
  value,
  bold,
  highlight,
  indent,
}: {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: boolean;
  indent?: boolean;
}) {
  if (!value)
    return (
      <p className={`py-1 text-xs ${indent ? "text-[var(--t-text-muted)] pl-2" : "text-[var(--t-text-muted)] font-medium uppercase tracking-wider"}`}>
        {label}
      </p>
    );
  return (
    <div
      className={`flex items-center justify-between py-1 ${
        highlight
          ? "text-[var(--t-accent)] font-semibold"
          : bold
            ? "text-[var(--t-text-primary)] font-medium"
            : indent
              ? "text-[var(--t-text-muted)] pl-2"
              : "text-[var(--t-text-primary)]"
      }`}
    >
      <span className={indent ? "text-xs" : "text-sm"}>{label}</span>
      <span className={`tabular-nums ${indent ? "text-xs" : "text-sm"}`}>{value}</span>
    </div>
  );
}

/* ---------- Create Rule Form ---------- */

function CreateRuleForm({ onSuccess }: { onSuccess: () => void }) {
  const [name, setName] = useState("");
  const [serviceType, setServiceType] = useState("dumpster_rental");
  const [assetSubtype, setAssetSubtype] = useState("20yd");
  const [customerType, setCustomerType] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [rentalPeriodDays, setRentalPeriodDays] = useState("7");
  const [extraDayRate, setExtraDayRate] = useState("");
  const [includedMiles, setIncludedMiles] = useState("15");
  const [perMileCharge, setPerMileCharge] = useState("");
  const [maxServiceMiles, setMaxServiceMiles] = useState("");
  const [includedTons, setIncludedTons] = useState("2");
  const [overagePerTon, setOveragePerTon] = useState("");
  const [deliveryFee, setDeliveryFee] = useState("");
  const [pickupFee, setPickupFee] = useState("");
  const [exchangeFee, setExchangeFee] = useState("");
  const [requireDeposit, setRequireDeposit] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [taxRate, setTaxRate] = useState("0.0825");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api.post("/pricing", {
        name,
        serviceType,
        assetSubtype,
        customerType: customerType || undefined,
        basePrice: Number(basePrice),
        rentalPeriodDays: Number(rentalPeriodDays) || 7,
        extraDayRate: Number(extraDayRate) || 0,
        includedMiles: Number(includedMiles) || 0,
        perMileCharge: Number(perMileCharge) || 0,
        maxServiceMiles: Number(maxServiceMiles) || undefined,
        includedTons: Number(includedTons) || 0,
        overagePerTon: Number(overagePerTon) || 0,
        deliveryFee: Number(deliveryFee) || 0,
        pickupFee: Number(pickupFee) || 0,
        exchangeFee: Number(exchangeFee) || 0,
        requireDeposit,
        depositAmount: Number(depositAmount) || 0,
        taxRate: Number(taxRate) || 0,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-[18px] bg-[var(--t-error-soft)] px-4 py-3 text-sm text-[var(--t-error)]">{error}</div>
      )}

      <div>
        <label className={labelCls}>Rule Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required className={inputCls} placeholder="Standard 20yd Dumpster" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>Service</label>
          <select value={serviceType} onChange={(e) => setServiceType(e.target.value)} className={`${inputCls} appearance-none`}>
            <option value="dumpster_rental">Dumpster</option>
            <option value="pod_storage">Pod</option>
            <option value="restroom_service">Restroom</option>
            <option value="landscaping">Landscaping</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Size</label>
          <select value={assetSubtype} onChange={(e) => setAssetSubtype(e.target.value)} className={`${inputCls} appearance-none`}>
            <option value="10yd">10 yd</option>
            <option value="20yd">20 yd</option>
            <option value="30yd">30 yd</option>
            <option value="40yd">40 yd</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Customer</label>
          <select value={customerType} onChange={(e) => setCustomerType(e.target.value)} className={`${inputCls} appearance-none`}>
            <option value="">All</option>
            <option value="residential">Residential</option>
            <option value="commercial">Commercial</option>
          </select>
        </div>
      </div>

      <p className={sectionCls}>Base Pricing</p>
      <div className="grid grid-cols-3 gap-3">
        <div><label className={labelCls}>Base Price ($)</label><input type="number" step="0.01" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} required className={inputCls} placeholder="350" /></div>
        <div><label className={labelCls}>Rental Days</label><input type="number" value={rentalPeriodDays} onChange={(e) => setRentalPeriodDays(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Extra Day ($)</label><input type="number" step="0.01" value={extraDayRate} onChange={(e) => setExtraDayRate(e.target.value)} className={inputCls} placeholder="25" /></div>
      </div>

      <p className={sectionCls}>Distance</p>
      <div className="grid grid-cols-3 gap-3">
        <div><label className={labelCls}>Free Miles</label><input type="number" value={includedMiles} onChange={(e) => setIncludedMiles(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Per Mile ($)</label><input type="number" step="0.01" value={perMileCharge} onChange={(e) => setPerMileCharge(e.target.value)} className={inputCls} placeholder="3.50" /></div>
        <div><label className={labelCls}>Max Miles</label><input type="number" value={maxServiceMiles} onChange={(e) => setMaxServiceMiles(e.target.value)} className={inputCls} placeholder="50" /></div>
      </div>

      <p className={sectionCls}>Weight</p>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>Included Tons</label><input type="number" step="0.01" value={includedTons} onChange={(e) => setIncludedTons(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Overage/Ton ($)</label><input type="number" step="0.01" value={overagePerTon} onChange={(e) => setOveragePerTon(e.target.value)} className={inputCls} placeholder="75" /></div>
      </div>

      <p className={sectionCls}>Service Fees</p>
      <div className="grid grid-cols-3 gap-3">
        <div><label className={labelCls}>Delivery ($)</label><input type="number" step="0.01" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} className={inputCls} placeholder="75" /></div>
        <div><label className={labelCls}>Pickup ($)</label><input type="number" step="0.01" value={pickupFee} onChange={(e) => setPickupFee(e.target.value)} className={inputCls} placeholder="75" /></div>
        <div><label className={labelCls}>Exchange Discount (%)</label><input type="number" step="1" min="0" max="100" value={exchangeFee} onChange={(e) => setExchangeFee(e.target.value)} className={inputCls} placeholder="0" /></div>
      </div>

      <p className={sectionCls}>Deposit & Tax</p>
      <div className="grid grid-cols-3 gap-3 items-end">
        <div className="flex items-center gap-2 py-2.5">
          <input type="checkbox" id="deposit" checked={requireDeposit} onChange={(e) => setRequireDeposit(e.target.checked)} className="h-4 w-4 rounded accent-[#22C55E]" />
          <label htmlFor="deposit" className="text-sm text-[var(--t-text-primary)]">Require deposit</label>
        </div>
        <div><label className={labelCls}>Deposit ($)</label><input type="number" step="0.01" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} className={inputCls} placeholder="150" /></div>
        <div><label className={labelCls}>Tax Rate</label><input type="number" step="0.0001" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className={inputCls} placeholder="0.0825" /></div>
      </div>

      <button type="submit" disabled={saving} className="w-full rounded-full bg-[#22C55E] px-4 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 mt-6">
        {saving ? "Creating..." : "Create Rule"}
      </button>
    </form>
  );
}

/* ---------- Edit Rule Form ---------- */

function EditRuleForm({ rule, onSuccess, onDelete }: { rule: PricingRule; onSuccess: () => void; onDelete: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(rule.name);
  const [serviceType, setServiceType] = useState(rule.service_type);
  const [assetSubtype, setAssetSubtype] = useState(rule.asset_subtype);
  const [customerType, setCustomerType] = useState(rule.customer_type || "");
  const [basePrice, setBasePrice] = useState(String(rule.base_price));
  const [rentalPeriodDays, setRentalPeriodDays] = useState(String(rule.rental_period_days));
  const [extraDayRate, setExtraDayRate] = useState(String(rule.extra_day_rate));
  const [includedMiles, setIncludedMiles] = useState(String(rule.included_miles));
  const [perMileCharge, setPerMileCharge] = useState(String(rule.per_mile_charge));
  const [maxServiceMiles, setMaxServiceMiles] = useState(String(rule.max_service_miles));
  const [includedTons, setIncludedTons] = useState(String(rule.included_tons));
  const [overagePerTon, setOveragePerTon] = useState(String(rule.overage_per_ton));
  const [deliveryFee, setDeliveryFee] = useState(String(rule.delivery_fee));
  const [pickupFee, setPickupFee] = useState(String(rule.pickup_fee));
  const [exchangeFee, setExchangeFee] = useState(String(rule.exchange_fee));
  const [requireDeposit, setRequireDeposit] = useState(rule.require_deposit);
  const [depositAmount, setDepositAmount] = useState(String(rule.deposit_amount));
  const [taxRate, setTaxRate] = useState(String(rule.tax_rate));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api.patch("/pricing/" + rule.id, {
        name, serviceType, assetSubtype,
        customerType: customerType || undefined,
        basePrice: Number(basePrice),
        rentalPeriodDays: Number(rentalPeriodDays) || 7,
        extraDayRate: Number(extraDayRate) || 0,
        includedMiles: Number(includedMiles) || 0,
        perMileCharge: Number(perMileCharge) || 0,
        maxServiceMiles: Number(maxServiceMiles) || undefined,
        includedTons: Number(includedTons) || 0,
        overagePerTon: Number(overagePerTon) || 0,
        deliveryFee: Number(deliveryFee) || 0,
        pickupFee: Number(pickupFee) || 0,
        exchangeFee: Number(exchangeFee) || 0,
        requireDeposit,
        depositAmount: Number(depositAmount) || 0,
        taxRate: Number(taxRate) || 0,
      });
      toast("success", "Pricing rule updated");
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update";
      setError(msg);
      toast("error", msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this pricing rule? This cannot be undone.")) return;
    setDeleting(true);
    try {
      await api.delete("/pricing/" + rule.id);
      toast("success", "Pricing rule deleted");
      onDelete();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete";
      setError(msg);
      toast("error", msg);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-[18px] bg-[var(--t-error-soft)] px-4 py-3 text-sm text-[var(--t-error)]">{error}</div>
      )}

      <div><label className={labelCls}>Rule Name</label><input value={name} onChange={(e) => setName(e.target.value)} required className={inputCls} /></div>

      <div className="grid grid-cols-3 gap-3">
        <div><label className={labelCls}>Service</label><select value={serviceType} onChange={(e) => setServiceType(e.target.value)} className={`${inputCls} appearance-none`}><option value="dumpster_rental">Dumpster</option><option value="pod_storage">Pod</option><option value="restroom_service">Restroom</option><option value="landscaping">Landscaping</option></select></div>
        <div><label className={labelCls}>Size</label><select value={assetSubtype} onChange={(e) => setAssetSubtype(e.target.value)} className={`${inputCls} appearance-none`}><option value="10yd">10 yd</option><option value="20yd">20 yd</option><option value="30yd">30 yd</option><option value="40yd">40 yd</option></select></div>
        <div><label className={labelCls}>Customer</label><select value={customerType} onChange={(e) => setCustomerType(e.target.value)} className={`${inputCls} appearance-none`}><option value="">All</option><option value="residential">Residential</option><option value="commercial">Commercial</option></select></div>
      </div>

      <p className={sectionCls}>Base Pricing</p>
      <div className="grid grid-cols-3 gap-3">
        <div><label className={labelCls}>Base Price ($)</label><input type="number" step="0.01" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} required className={inputCls} /></div>
        <div><label className={labelCls}>Rental Days</label><input type="number" value={rentalPeriodDays} onChange={(e) => setRentalPeriodDays(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Extra Day ($)</label><input type="number" step="0.01" value={extraDayRate} onChange={(e) => setExtraDayRate(e.target.value)} className={inputCls} /></div>
      </div>

      <p className={sectionCls}>Distance</p>
      <div className="grid grid-cols-3 gap-3">
        <div><label className={labelCls}>Free Miles</label><input type="number" value={includedMiles} onChange={(e) => setIncludedMiles(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Per Mile ($)</label><input type="number" step="0.01" value={perMileCharge} onChange={(e) => setPerMileCharge(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Max Miles</label><input type="number" value={maxServiceMiles} onChange={(e) => setMaxServiceMiles(e.target.value)} className={inputCls} /></div>
      </div>

      <p className={sectionCls}>Weight</p>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>Included Tons</label><input type="number" step="0.01" value={includedTons} onChange={(e) => setIncludedTons(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Overage/Ton ($)</label><input type="number" step="0.01" value={overagePerTon} onChange={(e) => setOveragePerTon(e.target.value)} className={inputCls} /></div>
      </div>

      <p className={sectionCls}>Service Fees</p>
      <div className="grid grid-cols-3 gap-3">
        <div><label className={labelCls}>Delivery ($)</label><input type="number" step="0.01" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Pickup ($)</label><input type="number" step="0.01" value={pickupFee} onChange={(e) => setPickupFee(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Exchange Discount (%)</label><input type="number" step="1" min="0" max="100" value={exchangeFee} onChange={(e) => setExchangeFee(e.target.value)} className={inputCls} /></div>
      </div>

      <p className={sectionCls}>Deposit & Tax</p>
      <div className="grid grid-cols-3 gap-3 items-end">
        <div className="flex items-center gap-2 py-2.5">
          <input type="checkbox" id="edit-deposit" checked={requireDeposit} onChange={(e) => setRequireDeposit(e.target.checked)} className="h-4 w-4 rounded accent-[#22C55E]" />
          <label htmlFor="edit-deposit" className="text-sm text-[var(--t-text-primary)]">Require deposit</label>
        </div>
        <div><label className={labelCls}>Deposit ($)</label><input type="number" step="0.01" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Tax Rate</label><input type="number" step="0.0001" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className={inputCls} /></div>
      </div>

      <button type="submit" disabled={saving} className="w-full rounded-full bg-[#22C55E] px-4 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 mt-6">
        {saving ? "Saving..." : "Save Changes"}
      </button>

      <button type="button" onClick={handleDelete} disabled={deleting} className="w-full rounded-full border border-[var(--t-error)] px-4 py-3 text-sm font-semibold text-[var(--t-error)] transition-opacity hover:opacity-80 disabled:opacity-50">
        {deleting ? "Deleting..." : "Delete Rule"}
      </button>
    </form>
  );
}
