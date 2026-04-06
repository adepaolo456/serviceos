"use client";

import { useState, useEffect, useCallback } from "react";
import { DollarSign, Mail, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useBooking } from "@/components/booking-provider";
import { useQuickQuote } from "@/components/quick-quote-provider";
import SlideOver from "@/components/slide-over";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";
import { getFeatureLabel } from "@/lib/feature-registry";

interface PricingRule {
  id: string;
  name: string;
  asset_subtype: string;
  base_price: number;
  rental_period_days: number;
  extra_day_rate: number;
  included_tons: number;
  overage_per_ton: number;
  is_active: boolean;
}

interface PriceBreakdown {
  basePrice: number;
  rentalDays: number;
  includedDays: number;
  extraDays: number;
  extraDayRate: number;
  extraDayCharges: number;
  distanceMiles: number;
  distanceSurcharge: number;
  includedTons: number;
  overagePerTon: number;
  jobFee: number;
  fees: Array<{ fee_key: string; label: string; amount: number; is_percentage: boolean }>;
  totalFees: number;
  taxRate: number;
  tax: number;
  total: number;
  subtotal: number;
  requireDeposit: boolean;
  depositAmount: number;
}

interface PricingResult {
  rule: { id: string; name: string };
  breakdown: PriceBreakdown;
}

export default function QuickQuoteDrawer() {
  const { drawerOpen, closeQuickQuote } = useQuickQuote();
  const { openWizard } = useBooking();
  const { toast } = useToast();

  // Form state
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [selectedSize, setSelectedSize] = useState("");
  const [address, setAddress] = useState<AddressValue | null>(null);
  const [addressDisplay, setAddressDisplay] = useState("");

  // Full pricing engine result
  const [pricingResult, setPricingResult] = useState<PricingResult | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [pricingError, setPricingError] = useState<string | null>(null);

  // Email Quote progressive disclosure
  const [showEmailFields, setShowEmailFields] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [sending, setSending] = useState(false);

  const selectedRule = rules.find((r) => r.asset_subtype === selectedSize);
  const breakdown = pricingResult?.breakdown;

  // Fetch pricing rules on open
  useEffect(() => {
    if (!drawerOpen) return;
    setRulesLoading(true);
    api.get<{ data: PricingRule[] }>("/pricing?limit=100")
      .then((res) => setRules(res.data))
      .catch(() => {})
      .finally(() => setRulesLoading(false));
  }, [drawerOpen]);

  // Reset state on open
  useEffect(() => {
    if (drawerOpen) {
      setSelectedSize("");
      setAddress(null);
      setAddressDisplay("");
      setPricingResult(null);
      setPricingError(null);
      setShowEmailFields(false);
      setCustomerName("");
      setCustomerEmail("");
      setCustomerPhone("");
    }
  }, [drawerOpen]);

  // Calculate full quote via POST /pricing/calculate when size + address are set
  useEffect(() => {
    if (!selectedSize || !address?.lat || !address?.lng) {
      setPricingResult(null);
      setPricingError(null);
      return;
    }
    setCalculating(true);
    setPricingError(null);
    api.post<PricingResult>("/pricing/calculate", {
      serviceType: "dumpster_rental",
      assetSubtype: selectedSize,
      jobType: "delivery",
      customerLat: address.lat,
      customerLng: address.lng,
    })
      .then(setPricingResult)
      .catch((err) => {
        setPricingResult(null);
        const msg = err?.message || err?.error || "Unable to calculate price";
        setPricingError(typeof msg === "string" ? msg : "Unable to calculate price");
      })
      .finally(() => setCalculating(false));
  }, [selectedSize, address?.lat, address?.lng]);

  const handleAddressChange = useCallback((addr: AddressValue) => {
    setAddress(addr);
    setAddressDisplay(addr.formatted || [addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(", "));
  }, []);

  // Book Now — hand off to existing booking wizard
  const handleBookNow = useCallback(() => {
    closeQuickQuote();
    openWizard({
      initialSchedule: {
        dumpsterSize: selectedSize,
        ...(address ? {
          siteAddress: {
            street: address.street,
            city: address.city,
            state: address.state,
            zip: address.zip,
            lat: address.lat,
            lng: address.lng,
          },
        } : {}),
      },
    });
  }, [closeQuickQuote, openWizard, selectedSize, address]);

  // Email Quote — atomic: create quote + send email
  const handleSendQuote = useCallback(async () => {
    if (!selectedRule || !customerEmail || !customerName || !breakdown) return;
    setSending(true);
    try {
      await api.post("/quotes", {
        customerName,
        customerEmail,
        customerPhone: customerPhone || undefined,
        deliveryAddress: address ? { street: address.street, city: address.city, state: address.state, zip: address.zip, lat: address.lat, lng: address.lng } : null,
        assetSubtype: selectedSize,
        basePrice: breakdown.basePrice,
        includedTons: breakdown.includedTons,
        rentalDays: breakdown.rentalDays,
        overageRate: breakdown.overagePerTon,
        extraDayRate: breakdown.extraDayRate,
        distanceSurcharge: breakdown.distanceSurcharge,
        totalQuoted: breakdown.total,
      });
      toast("success", `Quote emailed to ${customerEmail}`);
      closeQuickQuote();
    } catch {
      toast("error", "Failed to send quote");
    } finally {
      setSending(false);
    }
  }, [selectedRule, customerName, customerEmail, customerPhone, address, selectedSize, breakdown, toast, closeQuickQuote]);

  const hasQuote = !!breakdown;
  const outsideServiceArea = !!pricingError;

  return (
    <SlideOver open={drawerOpen} onClose={closeQuickQuote} title={getFeatureLabel("quick_quote")} side="left">
      <div className="space-y-5">
        {/* Dumpster Size */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--t-text-muted)" }}>
            {getFeatureLabel("quick_quote_dumpster_size")}
          </p>
          {rulesLoading ? (
            <div className="flex items-center gap-2 py-3">
              <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--t-text-muted)" }} />
              <span className="text-sm" style={{ color: "var(--t-text-muted)" }}>Loading sizes...</span>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {rules.map((rule) => (
                <button
                  key={rule.id}
                  onClick={() => setSelectedSize(rule.asset_subtype)}
                  className="rounded-full px-3.5 py-1.5 text-[13px] font-bold border transition-all"
                  style={{
                    background: selectedSize === rule.asset_subtype ? "var(--t-accent)" : "var(--t-bg-secondary)",
                    color: selectedSize === rule.asset_subtype ? "var(--t-accent-on-accent)" : "var(--t-text-primary)",
                    borderColor: selectedSize === rule.asset_subtype ? "var(--t-accent)" : "var(--t-border)",
                  }}
                >
                  {rule.asset_subtype || rule.name || "Unknown"} — ${Number(rule.base_price)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Delivery Address */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--t-text-muted)" }}>
            {getFeatureLabel("quick_quote_delivery_address")}
          </p>
          <AddressAutocomplete
            value={address || undefined}
            onChange={handleAddressChange}
            placeholder="Enter address or ZIP code"
          />
        </div>

        {/* Calculating indicator (shown when size selected but no address yet, or while calculating) */}
        {calculating && (
          <div className="flex items-center justify-center gap-2 py-4">
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--t-accent)" }} />
            <span className="text-sm" style={{ color: "var(--t-text-muted)" }}>Calculating quote...</span>
          </div>
        )}

        {/* Size selected but no address — show base-only preview */}
        {selectedRule && !address?.lat && !calculating && (
          <div
            className="rounded-[14px] border-l-4 p-5 animate-fade-in"
            style={{
              background: "var(--t-bg-card)",
              borderColor: "var(--t-accent)",
              borderTop: "1px solid var(--t-border)",
              borderRight: "1px solid var(--t-border)",
              borderBottom: "1px solid var(--t-border)",
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-[15px] font-bold" style={{ color: "var(--t-text-primary)" }}>
                {selectedRule.asset_subtype?.replace("yd", " Yard") || selectedRule.name || "Unknown"} Dumpster
              </p>
              <p className="text-[20px] font-extrabold tracking-tight" style={{ color: "var(--t-text-muted)" }}>
                from ${Number(selectedRule.base_price).toLocaleString()}
              </p>
            </div>
            <p className="text-[12px]" style={{ color: "var(--t-text-tertiary)" }}>
              Enter a delivery address for a full quote with distance pricing, fees, and tax.
            </p>
          </div>
        )}

        {/* Pricing error (outside service area, etc.) */}
        {outsideServiceArea && !calculating && (
          <div
            className="rounded-[14px] border-l-4 p-5 animate-fade-in"
            style={{
              background: "var(--t-bg-card)",
              borderColor: "var(--t-error)",
              borderTop: "1px solid var(--t-border)",
              borderRight: "1px solid var(--t-border)",
              borderBottom: "1px solid var(--t-border)",
            }}
          >
            <div className="rounded-lg px-3 py-2 text-[12px] font-semibold" style={{ background: "var(--t-error-soft)", color: "var(--t-error)" }}>
              {pricingError}
            </div>
          </div>
        )}

        {/* Full Quote Summary from pricing engine */}
        {hasQuote && !calculating && (
          <div
            className="rounded-[14px] border-l-4 p-5 animate-fade-in"
            style={{
              background: "var(--t-bg-card)",
              borderColor: "var(--t-accent)",
              borderTop: "1px solid var(--t-border)",
              borderRight: "1px solid var(--t-border)",
              borderBottom: "1px solid var(--t-border)",
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-[15px] font-bold" style={{ color: "var(--t-text-primary)" }}>
                {selectedRule?.asset_subtype?.replace("yd", " Yard") || "Unknown"} Dumpster
              </p>
              <p className="text-[24px] font-extrabold tracking-tight" style={{ color: "var(--t-accent)" }}>
                ${breakdown.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>

            <div className="space-y-1.5 text-[13px]" style={{ color: "var(--t-text-muted)" }}>
              <div className="flex justify-between">
                <span>Base price</span>
                <span style={{ color: "var(--t-text-primary)" }}>${breakdown.basePrice.toLocaleString()}</span>
              </div>

              {breakdown.distanceMiles > 0 && (
                <div className="flex justify-between">
                  <span>Delivery distance</span>
                  <span style={{ color: breakdown.distanceSurcharge > 0 ? "var(--t-warning)" : "var(--t-accent)" }}>
                    {breakdown.distanceMiles} mi
                    {breakdown.distanceSurcharge > 0 ? ` (+$${breakdown.distanceSurcharge})` : " (Free)"}
                  </span>
                </div>
              )}

              <div className="flex justify-between">
                <span>Includes</span>
                <span style={{ color: "var(--t-text-primary)" }}>
                  {breakdown.includedTons} tons · {breakdown.rentalDays} day rental
                </span>
              </div>
              <div className="flex justify-between">
                <span>Overage</span>
                <span style={{ color: "var(--t-text-primary)" }}>
                  ${breakdown.overagePerTon}/ton after {breakdown.includedTons} tons
                </span>
              </div>
              <div className="flex justify-between">
                <span>Extra days</span>
                <span style={{ color: "var(--t-text-primary)" }}>
                  ${breakdown.extraDayRate}/day after {breakdown.includedDays} days
                </span>
              </div>

              {breakdown.jobFee > 0 && (
                <div className="flex justify-between">
                  <span>Delivery fee</span>
                  <span style={{ color: "var(--t-text-primary)" }}>${breakdown.jobFee}</span>
                </div>
              )}

              {breakdown.fees.length > 0 && breakdown.fees.map((fee) => (
                <div key={fee.fee_key} className="flex justify-between">
                  <span>{fee.label}</span>
                  <span style={{ color: "var(--t-text-primary)" }}>${fee.amount.toFixed(2)}</span>
                </div>
              ))}

              {breakdown.tax > 0 && (
                <div className="flex justify-between">
                  <span>Tax ({(breakdown.taxRate * 100).toFixed(1)}%)</span>
                  <span style={{ color: "var(--t-text-primary)" }}>${breakdown.tax.toFixed(2)}</span>
                </div>
              )}

              {addressDisplay && (
                <div className="flex justify-between pt-1" style={{ borderTop: "1px solid var(--t-border)" }}>
                  <span>Delivery to</span>
                  <span className="text-right max-w-[200px]" style={{ color: "var(--t-text-primary)" }}>{addressDisplay}</span>
                </div>
              )}
            </div>

            <p className="text-[11px] mt-3" style={{ color: "var(--t-text-tertiary)" }}>
              Valid for 30 days from today
            </p>
          </div>
        )}

        {/* Action Buttons */}
        {hasQuote && !calculating && (
          <div className="space-y-3">
            <div className="flex gap-3">
              <button
                onClick={handleBookNow}
                className="flex-1 flex items-center justify-center gap-2 rounded-full py-2.5 text-[13px] font-bold transition-opacity hover:opacity-90"
                style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}
              >
                <DollarSign className="h-4 w-4" /> {getFeatureLabel("quick_quote_book_now")}
              </button>
              {!showEmailFields && (
                <button
                  onClick={() => setShowEmailFields(true)}
                  className="flex-1 flex items-center justify-center gap-2 rounded-full py-2.5 text-[13px] font-bold border transition-colors hover:bg-[var(--t-bg-card-hover)]"
                  style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)", background: "transparent" }}
                >
                  <Mail className="h-4 w-4" /> {getFeatureLabel("quick_quote_email")}
                </button>
              )}
            </div>

            {/* Email Quote — progressive disclosure */}
            {showEmailFields && (
              <div className="rounded-[14px] border p-4 space-y-3 animate-fade-in" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
                <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--t-text-muted)" }}>
                  {getFeatureLabel("quick_quote_email")} To
                </p>
                <div className="space-y-2">
                  <input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Customer name *"
                    className="w-full rounded-[14px] border px-3.5 py-2 text-sm outline-none focus:border-[var(--t-accent)]"
                    style={{ background: "var(--t-bg-secondary)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
                  />
                  <input
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="Email address *"
                    type="email"
                    className="w-full rounded-[14px] border px-3.5 py-2 text-sm outline-none focus:border-[var(--t-accent)]"
                    style={{ background: "var(--t-bg-secondary)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
                  />
                  <input
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="Phone (optional)"
                    className="w-full rounded-[14px] border px-3.5 py-2 text-sm outline-none focus:border-[var(--t-accent)]"
                    style={{ background: "var(--t-bg-secondary)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleSendQuote}
                    disabled={!customerName || !customerEmail || sending}
                    className="flex-1 flex items-center justify-center gap-2 rounded-full py-2.5 text-[13px] font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                    {sending ? "Sending..." : getFeatureLabel("quick_quote_email").replace("Email", "Send")}
                  </button>
                  <button
                    onClick={() => setShowEmailFields(false)}
                    className="rounded-full px-4 py-2.5 text-[13px] font-medium border transition-colors hover:bg-[var(--t-bg-card-hover)]"
                    style={{ borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </SlideOver>
  );
}
