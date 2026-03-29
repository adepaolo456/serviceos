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
} from "lucide-react";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";

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

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "$0.00";
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PricingPage() {
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(true);

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

  // Group by service type
  const grouped = rules.reduce<Record<string, PricingRule[]>>((acc, r) => {
    const key = r.service_type;
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            Pricing
          </h1>
          <p className="mt-1 text-muted">{rules.length} pricing rules</p>
        </div>
        <button
          onClick={() => setPanelOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1FA855] btn-press"
        >
          <Plus className="h-4 w-4" />
          New Rule
        </button>
      </div>

      {/* Price Calculator */}
      <div className="mb-8 rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 overflow-hidden">
        <button
          onClick={() => setCalcOpen(!calcOpen)}
          className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-dark-card-hover btn-press"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/10">
              <Calculator className="h-4 w-4 text-brand" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                Price Calculator
              </h2>
              <p className="text-xs text-muted">
                Get an instant quote for any service
              </p>
            </div>
          </div>
          {calcOpen ? (
            <ChevronUp className="h-5 w-5 text-muted" />
          ) : (
            <ChevronDown className="h-5 w-5 text-muted" />
          )}
        </button>
        {calcOpen && (
          <div className="border-t border-[#1E2D45] p-6">
            <PriceCalculator />
          </div>
        )}
      </div>

      {/* Rules grid grouped by service type */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 skeleton rounded-xl" />
          ))}
        </div>
      ) : rules.length === 0 ? (
        <div className="py-20 flex flex-col items-center justify-center text-center">
          <DollarSign size={48} className="text-[#7A8BA3]/30 mb-4" />
          <p className="font-display text-lg font-semibold text-white mb-1">No pricing rules</p>
          <p className="text-sm text-muted mb-6">Create your first pricing rule to start quoting jobs</p>
          <button
            onClick={() => setPanelOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1FA855] btn-press"
          >
            <Plus className="h-4 w-4" />
            New Rule
          </button>
        </div>
      ) : (
        Object.entries(grouped).map(([serviceType, serviceRules]) => (
          <div key={serviceType} className="mb-8">
            <h2 className="font-display text-lg font-semibold text-white mb-4">
              {SERVICE_LABELS[serviceType] || serviceType}
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {serviceRules.map((rule) => (
                <RuleCard key={rule.id} rule={rule} />
              ))}
            </div>
          </div>
        ))
      )}

      <SlideOver
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title="New Pricing Rule"
      >
        <CreateRuleForm
          onSuccess={() => {
            setPanelOpen(false);
            fetchRules();
          }}
        />
      </SlideOver>
    </div>
  );
}

/* ---------- Rule Card ---------- */

function RuleCard({ rule }: { rule: PricingRule }) {
  return (
    <div
      className={`rounded-2xl bg-dark-card border border-[#1E2D45] shadow-lg shadow-black/10 p-5 transition-colors hover:bg-dark-card-hover card-hover ${
        !rule.is_active ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="font-display text-base font-semibold text-white">
            {rule.name}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-[10px] font-medium text-brand">
              {rule.asset_subtype}
            </span>
            {rule.customer_type && (
              <span className="rounded-full bg-blue-500/10 px-2.5 py-0.5 text-[10px] font-medium text-blue-400 capitalize">
                {rule.customer_type}
              </span>
            )}
            {!rule.is_active && (
              <span className="rounded-full bg-red-500/10 px-2.5 py-0.5 text-[10px] font-medium text-red-400">
                Inactive
              </span>
            )}
          </div>
        </div>
        <p className="font-display text-2xl font-bold text-white tabular-nums">
          {fmt(rule.base_price)}
        </p>
      </div>

      <div className="space-y-2 text-xs tabular-nums">
        <div className="flex items-center gap-2 text-foreground">
          <Clock className="h-3 w-3 text-muted" />
          <span>
            {rule.rental_period_days} days included · {fmt(rule.extra_day_rate)}
            /extra day
          </span>
        </div>
        <div className="flex items-center gap-2 text-foreground">
          <MapPin className="h-3 w-3 text-muted" />
          <span>
            {Number(rule.included_miles)} mi free · {fmt(rule.per_mile_charge)}
            /mi after
          </span>
        </div>
        <div className="flex items-center gap-2 text-foreground">
          <Package className="h-3 w-3 text-muted" />
          <span>
            {Number(rule.included_tons)} tons included ·{" "}
            {fmt(rule.overage_per_ton)}/ton over
          </span>
        </div>
        <div className="flex items-center gap-2 text-foreground">
          <Truck className="h-3 w-3 text-muted" />
          <span>
            Delivery {fmt(rule.delivery_fee)} · Pickup {fmt(rule.pickup_fee)}
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-[#1E2D45] pt-3">
        {rule.require_deposit ? (
          <span className="text-xs text-muted">
            Deposit: {fmt(rule.deposit_amount)}
          </span>
        ) : (
          <span className="text-xs text-muted">No deposit</span>
        )}
        {Number(rule.tax_rate) > 0 && (
          <span className="text-xs text-muted">
            Tax: {(Number(rule.tax_rate) * 100).toFixed(2)}%
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------- Price Calculator ---------- */

function PriceCalculator() {
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

  const inputClass =
    "w-full rounded-lg bg-[#111C2E] border border-[#1E2D45] px-4 py-2.5 text-sm text-white placeholder-muted outline-none transition-colors focus:border-brand";
  const labelClass = "block text-xs font-medium text-muted mb-1";

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <form onSubmit={handleCalculate} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Service Type</label>
            <select
              value={serviceType}
              onChange={(e) => setServiceType(e.target.value)}
              className={`${inputClass} appearance-none`}
            >
              <option value="dumpster_rental">Dumpster Rental</option>
              <option value="pod_storage">Pod Storage</option>
              <option value="restroom_service">Restroom Service</option>
              <option value="landscaping">Landscaping</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Size</label>
            <select
              value={assetSubtype}
              onChange={(e) => setAssetSubtype(e.target.value)}
              className={`${inputClass} appearance-none`}
            >
              <option value="10yd">10 yd</option>
              <option value="20yd">20 yd</option>
              <option value="30yd">30 yd</option>
              <option value="40yd">40 yd</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Job Type</label>
            <select
              value={jobType}
              onChange={(e) => setJobType(e.target.value)}
              className={`${inputClass} appearance-none`}
            >
              <option value="delivery">Delivery</option>
              <option value="pickup">Pickup</option>
              <option value="exchange">Exchange</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Rental Days</label>
            <input
              type="number"
              value={rentalDays}
              onChange={(e) => setRentalDays(e.target.value)}
              className={inputClass}
              min="1"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Customer Lat</label>
            <input
              type="number"
              step="any"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Customer Lng</label>
            <input
              type="number"
              step="any"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={calculating}
          className="w-full rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1FA855] disabled:opacity-50 btn-press"
        >
          {calculating ? "Calculating..." : "Calculate Price"}
        </button>

        {error && (
          <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}
      </form>

      {/* Receipt */}
      <div className="rounded-xl border border-[#1E2D45] bg-dark-elevated p-5">
        {!result ? (
          <div className="flex h-full items-center justify-center text-sm text-muted py-12">
            <div className="text-center">
              <DollarSign className="mx-auto h-8 w-8 text-muted/40 mb-2" />
              <p>Enter details and click Calculate</p>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs text-muted uppercase tracking-wider">
                  Quote
                </p>
                <p className="text-sm font-medium text-white">
                  {result.rule.name}
                </p>
              </div>
              <p className="font-display text-3xl font-bold text-brand tabular-nums">
                {fmt(result.breakdown.total)}
              </p>
            </div>

            <div className="space-y-0 text-sm">
              <ReceiptLine
                label="Base price"
                value={fmt(result.breakdown.basePrice)}
              />
              <ReceiptLine
                label={`Rental (${result.breakdown.rentalDays} days, ${result.breakdown.includedDays} included)`}
                value=""
              />
              {result.breakdown.extraDays > 0 && (
                <ReceiptLine
                  label={`  Extra days (${result.breakdown.extraDays} × ${fmt(result.breakdown.extraDayRate)})`}
                  value={fmt(result.breakdown.extraDayCharges)}
                  indent
                />
              )}
              <ReceiptLine
                label={`Distance (${result.breakdown.distanceMiles} mi, ${result.breakdown.includedMiles} free)`}
                value=""
              />
              {result.breakdown.distanceSurcharge > 0 && (
                <ReceiptLine
                  label={`  Surcharge (${result.breakdown.excessMiles} mi × ${fmt(result.breakdown.perMileCharge)})`}
                  value={fmt(result.breakdown.distanceSurcharge)}
                  indent
                />
              )}
              {result.breakdown.jobFee > 0 && (
                <ReceiptLine
                  label={`${result.breakdown.jobType} fee`}
                  value={fmt(result.breakdown.jobFee)}
                />
              )}

              <div className="border-t border-white/10 my-2" />
              <ReceiptLine
                label="Subtotal"
                value={fmt(result.breakdown.subtotal)}
                bold
              />
              {result.breakdown.tax > 0 && (
                <ReceiptLine
                  label={`Tax (${(result.breakdown.taxRate * 100).toFixed(2)}%)`}
                  value={fmt(result.breakdown.tax)}
                />
              )}
              <div className="border-t border-white/10 my-2" />
              <ReceiptLine
                label="Total"
                value={fmt(result.breakdown.total)}
                bold
                highlight
              />

              {result.breakdown.requireDeposit && (
                <>
                  <div className="border-t border-dashed border-white/10 my-2" />
                  <ReceiptLine
                    label="Deposit required"
                    value={fmt(result.breakdown.depositAmount)}
                  />
                </>
              )}

              {result.breakdown.includedTons > 0 && (
                <p className="mt-3 text-[11px] text-muted">
                  Includes {result.breakdown.includedTons} tons.{" "}
                  {fmt(result.breakdown.overagePerTon)}/ton overage.
                </p>
              )}
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
      <p
        className={`py-1 text-xs ${indent ? "text-muted pl-2" : "text-muted font-medium uppercase tracking-wider"}`}
      >
        {label}
      </p>
    );
  return (
    <div
      className={`flex items-center justify-between py-1 ${
        highlight
          ? "text-brand font-semibold"
          : bold
            ? "text-white font-medium"
            : indent
              ? "text-muted pl-2"
              : "text-foreground"
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

  const inputClass =
    "w-full rounded-lg bg-[#111C2E] border border-[#1E2D45] px-4 py-2.5 text-sm text-white placeholder-muted outline-none transition-colors focus:border-brand";
  const labelClass = "block text-sm font-medium text-foreground mb-1.5";
  const sectionClass = "text-xs font-medium uppercase tracking-wider text-muted mb-3 mt-6";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div>
        <label className={labelClass}>Rule Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className={inputClass}
          placeholder="Standard 20yd Dumpster"
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelClass}>Service</label>
          <select
            value={serviceType}
            onChange={(e) => setServiceType(e.target.value)}
            className={`${inputClass} appearance-none`}
          >
            <option value="dumpster_rental">Dumpster</option>
            <option value="pod_storage">Pod</option>
            <option value="restroom_service">Restroom</option>
            <option value="landscaping">Landscaping</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Size</label>
          <select
            value={assetSubtype}
            onChange={(e) => setAssetSubtype(e.target.value)}
            className={`${inputClass} appearance-none`}
          >
            <option value="10yd">10 yd</option>
            <option value="20yd">20 yd</option>
            <option value="30yd">30 yd</option>
            <option value="40yd">40 yd</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Customer</label>
          <select
            value={customerType}
            onChange={(e) => setCustomerType(e.target.value)}
            className={`${inputClass} appearance-none`}
          >
            <option value="">All</option>
            <option value="residential">Residential</option>
            <option value="commercial">Commercial</option>
          </select>
        </div>
      </div>

      <p className={sectionClass}>Base Pricing</p>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelClass}>Base Price ($)</label>
          <input
            type="number"
            step="0.01"
            value={basePrice}
            onChange={(e) => setBasePrice(e.target.value)}
            required
            className={inputClass}
            placeholder="350"
          />
        </div>
        <div>
          <label className={labelClass}>Rental Days</label>
          <input
            type="number"
            value={rentalPeriodDays}
            onChange={(e) => setRentalPeriodDays(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Extra Day ($)</label>
          <input
            type="number"
            step="0.01"
            value={extraDayRate}
            onChange={(e) => setExtraDayRate(e.target.value)}
            className={inputClass}
            placeholder="25"
          />
        </div>
      </div>

      <p className={sectionClass}>Distance</p>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelClass}>Free Miles</label>
          <input
            type="number"
            value={includedMiles}
            onChange={(e) => setIncludedMiles(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Per Mile ($)</label>
          <input
            type="number"
            step="0.01"
            value={perMileCharge}
            onChange={(e) => setPerMileCharge(e.target.value)}
            className={inputClass}
            placeholder="3.50"
          />
        </div>
        <div>
          <label className={labelClass}>Max Miles</label>
          <input
            type="number"
            value={maxServiceMiles}
            onChange={(e) => setMaxServiceMiles(e.target.value)}
            className={inputClass}
            placeholder="50"
          />
        </div>
      </div>

      <p className={sectionClass}>Weight</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Included Tons</label>
          <input
            type="number"
            step="0.01"
            value={includedTons}
            onChange={(e) => setIncludedTons(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Overage/Ton ($)</label>
          <input
            type="number"
            step="0.01"
            value={overagePerTon}
            onChange={(e) => setOveragePerTon(e.target.value)}
            className={inputClass}
            placeholder="75"
          />
        </div>
      </div>

      <p className={sectionClass}>Service Fees</p>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelClass}>Delivery ($)</label>
          <input
            type="number"
            step="0.01"
            value={deliveryFee}
            onChange={(e) => setDeliveryFee(e.target.value)}
            className={inputClass}
            placeholder="75"
          />
        </div>
        <div>
          <label className={labelClass}>Pickup ($)</label>
          <input
            type="number"
            step="0.01"
            value={pickupFee}
            onChange={(e) => setPickupFee(e.target.value)}
            className={inputClass}
            placeholder="75"
          />
        </div>
        <div>
          <label className={labelClass}>Exchange ($)</label>
          <input
            type="number"
            step="0.01"
            value={exchangeFee}
            onChange={(e) => setExchangeFee(e.target.value)}
            className={inputClass}
            placeholder="100"
          />
        </div>
      </div>

      <p className={sectionClass}>Deposit & Tax</p>
      <div className="grid grid-cols-3 gap-3 items-end">
        <div className="flex items-center gap-2 py-2.5">
          <input
            type="checkbox"
            id="deposit"
            checked={requireDeposit}
            onChange={(e) => setRequireDeposit(e.target.checked)}
            className="h-4 w-4 rounded border-white/20 bg-dark-card accent-brand"
          />
          <label htmlFor="deposit" className="text-sm text-foreground">
            Require deposit
          </label>
        </div>
        <div>
          <label className={labelClass}>Deposit ($)</label>
          <input
            type="number"
            step="0.01"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            className={inputClass}
            placeholder="150"
          />
        </div>
        <div>
          <label className={labelClass}>Tax Rate</label>
          <input
            type="number"
            step="0.0001"
            value={taxRate}
            onChange={(e) => setTaxRate(e.target.value)}
            className={inputClass}
            placeholder="0.0825"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1FA855] disabled:opacity-50 mt-6 btn-press"
      >
        {saving ? "Creating..." : "Create Rule"}
      </button>
    </form>
  );
}
