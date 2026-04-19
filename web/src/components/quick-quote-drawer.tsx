"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { DollarSign, Mail, MessageSquare, Loader2, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useQuickQuote } from "@/components/quick-quote-provider";
import SlideOver from "@/components/slide-over";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";
import { getFeatureLabel, FEATURE_REGISTRY } from "@/lib/feature-registry";
import { QUOTE_SEND_LABELS, deliveryReasonLabel } from "@/lib/quote-send-labels";
import QuoteSendPanel from "@/components/quote-send-panel";
import type { InitialSchedule } from "@/components/booking-wizard";

type DeliveryMethod = "email" | "sms" | "both";

interface ChannelOutcome {
  attempted: boolean;
  ok: boolean;
  reason?: string;
  recipient?: string;
}

interface SendResponse {
  send: { email: ChannelOutcome; sms: ChannelOutcome };
  resolved_method: DeliveryMethod;
}

interface SmsPreviewResponse {
  valid: boolean;
  reason?: string;
  body: string;
  recipient: string | null;
  from_number: string | null;
  character_count: number;
}

interface TenantQuoteSettings {
  sms_enabled?: boolean;
  sms_phone_number?: string | null;
  quotes_email_enabled?: boolean;
  quotes_sms_enabled?: boolean;
  default_quote_delivery_method?: DeliveryMethod;
}

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
  const { drawerOpen, closeQuickQuote, openBookingFlow } = useQuickQuote();
  const { toast } = useToast();

  // Form state
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [selectedSize, setSelectedSize] = useState("");
  const [address, setAddress] = useState<AddressValue | null>(null);
  const [addressDisplay, setAddressDisplay] = useState("");

  // Projected availability per subtype (Phase D read-only signal).
  // null = not yet loaded / fetch failed; shown as "—" in the UI.
  // Fetched in parallel once rules arrive for the default target
  // date (today + 7 days) since the quote flow has no firm service
  // date of its own. Reuses the Assets-page /assets/availability
  // endpoint — no new endpoint, no new projection math.
  const [projections, setProjections] = useState<Record<string, number | null>>({});

  // Full pricing engine result
  const [pricingResult, setPricingResult] = useState<PricingResult | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [pricingError, setPricingError] = useState<string | null>(null);

  // Send-quote progressive disclosure
  const [showSendFields, setShowSendFields] = useState(false);
  // Ref on the expanded Send Quote section so we can auto-scroll it
  // into view when the operator opens it. Without this, the form lands
  // near the viewport bottom edge inside the SlideOver's scroll
  // container and feels cramped.
  const sendQuoteFormRef = useRef<HTMLDivElement>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>("email");
  const [tenantQuoteSettings, setTenantQuoteSettings] = useState<TenantQuoteSettings>({});
  const [smsPreview, setSmsPreview] = useState<SmsPreviewResponse | null>(null);
  const [smsPreviewLoading, setSmsPreviewLoading] = useState(false);

  // Load tenant settings to determine which channels are available + the default
  useEffect(() => {
    if (!drawerOpen) return;
    api
      .get<TenantQuoteSettings>("/tenant-settings")
      .then((s) => {
        setTenantQuoteSettings(s);
        if (s.default_quote_delivery_method) {
          setDeliveryMethod(s.default_quote_delivery_method);
        }
      })
      .catch(() => {});
  }, [drawerOpen]);

  const selectedRule = rules.find((r) => r.asset_subtype === selectedSize);
  const breakdown = pricingResult?.breakdown;

  // Channel availability derived from tenant settings — UI mirrors the
  // backend rules (the backend remains the source of truth for actual sends).
  const emailChannelAvailable = !!tenantQuoteSettings.quotes_email_enabled;
  const smsChannelAvailable =
    !!tenantQuoteSettings.sms_enabled &&
    !!tenantQuoteSettings.sms_phone_number &&
    !!tenantQuoteSettings.quotes_sms_enabled;

  // If the chosen method becomes unavailable due to settings, fall back safely.
  useEffect(() => {
    if (deliveryMethod === "sms" && !smsChannelAvailable && emailChannelAvailable) {
      setDeliveryMethod("email");
    } else if (deliveryMethod === "email" && !emailChannelAvailable && smsChannelAvailable) {
      setDeliveryMethod("sms");
    } else if (deliveryMethod === "both" && (!emailChannelAvailable || !smsChannelAvailable)) {
      setDeliveryMethod(emailChannelAvailable ? "email" : smsChannelAvailable ? "sms" : "email");
    }
  }, [deliveryMethod, emailChannelAvailable, smsChannelAvailable]);

  // Fetch pricing rules on open
  useEffect(() => {
    if (!drawerOpen) return;
    setRulesLoading(true);
    api.get<{ data: PricingRule[] }>("/pricing?limit=100")
      .then((res) => setRules(res.data))
      .catch(() => {})
      .finally(() => setRulesLoading(false));
  }, [drawerOpen]);

  // Phase D — fetch projected availability once per drawer open
  // using the multi-subtype endpoint. Returns an array covering
  // every subtype in the tenant; we index it into a {subtype →
  // projected} map consumed inline by each size pill. Target date
  // is today + 7 days (quote flow has no firm service date).
  // Confirmed-only so the signal reflects committed pipeline, not
  // speculative holds. Errors are swallowed silently — the pill
  // falls back to the "—" loading state per spec.
  useEffect(() => {
    if (!drawerOpen) return;
    const target = new Date();
    target.setDate(target.getDate() + 7);
    const dateStr = target.toISOString().slice(0, 10);

    let cancelled = false;
    api
      .get<
        Array<{
          subtype: string;
          projected_available?: number;
          availableOnDate?: number;
        }>
      >(`/assets/availability?date=${dateStr}&confirmedOnly=true`)
      .then((res) => {
        if (cancelled) return;
        const rows = Array.isArray(res) ? res : [];
        const map: Record<string, number | null> = {};
        for (const r of rows) {
          map[r.subtype] =
            typeof r.projected_available === "number"
              ? r.projected_available
              : typeof r.availableOnDate === "number"
                ? r.availableOnDate
                : null;
        }
        setProjections(map);
      })
      .catch(() => {
        // silent — pill stays on loading state
      });

    return () => {
      cancelled = true;
    };
  }, [drawerOpen]);

  // No reset-on-open effect needed — provider remounts this component via key on close

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

  // Book Now — build schedule, then open customer picker via provider (survives drawer remount)
  const handleBookNow = useCallback(() => {
    const schedule: InitialSchedule = {
      dumpsterSize: selectedSize,
      lockSiteAddress: !!address,
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
    };
    // Open customer picker BEFORE closing quote drawer — state lives in provider
    openBookingFlow(schedule);
    closeQuickQuote();
  }, [closeQuickQuote, openBookingFlow, selectedSize, address]);

  // Live SMS preview when SMS or Both is selected — re-renders against the
  // tenant's real template + the in-progress quote payload.
  useEffect(() => {
    const wantSms = deliveryMethod === "sms" || deliveryMethod === "both";
    if (!wantSms || !showSendFields || !breakdown || !smsChannelAvailable) {
      setSmsPreview(null);
      return;
    }
    let cancelled = false;
    setSmsPreviewLoading(true);
    api
      .post<SmsPreviewResponse>("/quotes/preview-sms", {
        customerName: customerName || undefined,
        customerPhone: customerPhone || undefined,
        customerEmail: customerEmail || undefined,
        deliveryAddress: address
          ? { street: address.street, city: address.city, state: address.state, zip: address.zip }
          : undefined,
        assetSubtype: selectedSize,
        totalQuoted: breakdown.total,
      })
      .then((res) => {
        if (!cancelled) setSmsPreview(res);
      })
      .catch(() => {
        if (!cancelled) setSmsPreview(null);
      })
      .finally(() => {
        if (!cancelled) setSmsPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    deliveryMethod,
    showSendFields,
    breakdown,
    smsChannelAvailable,
    customerName,
    customerPhone,
    customerEmail,
    address,
    selectedSize,
  ]);

  // Auto-scroll the expanded Send Quote section into center view when
  // the operator opens it. Effect fires after React has rendered the
  // panel, so the ref is populated by the time scrollIntoView runs.
  // The SlideOver's overflow-y-auto container is the nearest scrollable
  // ancestor and handles the scroll natively.
  useEffect(() => {
    if (showSendFields) {
      sendQuoteFormRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [showSendFields]);

  // Atomic create + send via the selected delivery method.
  const handleSendQuote = useCallback(async () => {
    if (!selectedRule || !customerName || !breakdown) return;
    const wantEmail = deliveryMethod === "email" || deliveryMethod === "both";
    const wantSms = deliveryMethod === "sms" || deliveryMethod === "both";
    if (wantEmail && !customerEmail) return;
    if (wantSms && !customerPhone) return;

    setSending(true);
    try {
      const res = await api.post<SendResponse>("/quotes", {
        customerName,
        customerEmail: customerEmail || undefined,
        customerPhone: customerPhone || undefined,
        deliveryAddress: address
          ? { street: address.street, city: address.city, state: address.state, zip: address.zip, lat: address.lat, lng: address.lng }
          : null,
        assetSubtype: selectedSize,
        basePrice: breakdown.basePrice,
        includedTons: breakdown.includedTons,
        rentalDays: breakdown.rentalDays,
        overageRate: breakdown.overagePerTon,
        extraDayRate: breakdown.extraDayRate,
        distanceSurcharge: breakdown.distanceSurcharge,
        totalQuoted: breakdown.total,
        deliveryMethod,
      });

      const { email, sms } = res.send;
      const emailOk = email.ok;
      const smsOk = sms.ok;
      const emailFailed = email.attempted && !email.ok;
      const smsFailed = sms.attempted && !sms.ok;

      if (emailOk && smsOk) {
        toast("success", QUOTE_SEND_LABELS.bothSendSuccess);
        closeQuickQuote();
      } else if (emailOk && !sms.attempted) {
        toast("success", QUOTE_SEND_LABELS.emailSendSuccess);
        closeQuickQuote();
      } else if (smsOk && !email.attempted) {
        toast("success", QUOTE_SEND_LABELS.smsSendSuccess);
        closeQuickQuote();
      } else if (emailOk && smsFailed) {
        // Partial — clearly distinguish, do NOT collapse to generic success
        toast("warning", `${QUOTE_SEND_LABELS.smsSendPartialSuccess}${sms.reason ? ` (${deliveryReasonLabel(sms.reason) || sms.reason})` : ""}`);
        closeQuickQuote();
      } else if (smsOk && emailFailed) {
        toast("warning", `${QUOTE_SEND_LABELS.emailSendPartialSuccess}${email.reason ? ` (${deliveryReasonLabel(email.reason) || email.reason})` : ""}`);
        closeQuickQuote();
      } else {
        // Both failed (or none attempted)
        const detail =
          deliveryReasonLabel(email.reason || sms.reason) ||
          email.reason ||
          sms.reason ||
          QUOTE_SEND_LABELS.noChannelAttempted;
        toast("error", detail);
      }
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Failed to send quote");
    } finally {
      setSending(false);
    }
  }, [
    selectedRule,
    customerName,
    customerEmail,
    customerPhone,
    address,
    selectedSize,
    breakdown,
    deliveryMethod,
    toast,
    closeQuickQuote,
  ]);

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
              {rules.map((rule) => {
                const isSelected = selectedSize === rule.asset_subtype;
                // Phase D signal — resolve color bucket. null/undefined
                // keeps muted loading state; 0 goes red with ⚠️; 1-2
                // amber; >=3 stays muted (informational only).
                const projected = projections[rule.asset_subtype];
                const signalColor =
                  projected === 0
                    ? "var(--t-error)"
                    : projected !== null && projected !== undefined && projected <= 2
                      ? "var(--t-warning)"
                      : "var(--t-text-muted)";
                const signalText =
                  projected === null || projected === undefined
                    ? "\u2014"
                    : `${projected}${projected === 0 ? " \u26A0" : ""}`;
                const signalLabel =
                  FEATURE_REGISTRY.dispatch_availability_signal?.label ?? "Projected";
                const tooltip =
                  FEATURE_REGISTRY.dispatch_availability_tooltip?.label ??
                  "Projected availability for this date based on current jobs.";
                return (
                  <button
                    key={rule.id}
                    onClick={() => setSelectedSize(rule.asset_subtype)}
                    title={tooltip}
                    className="rounded-full px-3.5 py-1.5 text-[13px] font-bold border transition-all inline-flex items-center gap-1.5"
                    style={{
                      background: isSelected ? "var(--t-accent)" : "var(--t-bg-secondary)",
                      color: isSelected ? "var(--t-accent-on-accent)" : "var(--t-text-primary)",
                      borderColor: isSelected ? "var(--t-accent)" : "var(--t-border)",
                    }}
                  >
                    <span>
                      {rule.asset_subtype || rule.name || "Unknown"} — ${Number(rule.base_price)}
                    </span>
                    <span
                      className="text-[11px] font-semibold tabular-nums"
                      style={{ color: signalColor, opacity: isSelected ? 0.9 : 1 }}
                    >
                      · {signalLabel}: {signalText}
                    </span>
                  </button>
                );
              })}
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

        {/* Unified Action Area */}
        {hasQuote && !calculating && (
          <div className="space-y-3">
            {/* Primary: Book Now */}
            <button
              onClick={handleBookNow}
              className="w-full flex items-center justify-center gap-2 rounded-full py-2.5 text-[13px] font-bold transition-opacity hover:opacity-90"
              style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}
            >
              <DollarSign className="h-4 w-4" /> {getFeatureLabel("quick_quote_book_now")}
            </button>

            {/* Send Quote — inline compact form */}
            {!showSendFields ? (
              <button
                onClick={() => setShowSendFields(true)}
                className="w-full flex items-center justify-center gap-2 rounded-full py-2.5 text-[13px] font-bold border transition-colors hover:bg-[var(--t-bg-card-hover)]"
                style={{ borderColor: "var(--t-border)", color: "var(--t-text-primary)", background: "transparent" }}
              >
                <Mail className="h-4 w-4" /> {getFeatureLabel("quick_quote_email")}
              </button>
            ) : (
              <div ref={sendQuoteFormRef}>
                <QuoteSendPanel
                  customerName={customerName}
                  customerEmail={customerEmail}
                  customerPhone={customerPhone}
                  onCustomerNameChange={setCustomerName}
                  onCustomerEmailChange={setCustomerEmail}
                  onCustomerPhoneChange={setCustomerPhone}
                  deliveryMethod={deliveryMethod}
                  onDeliveryMethodChange={setDeliveryMethod}
                  emailChannelAvailable={emailChannelAvailable}
                  smsChannelAvailable={smsChannelAvailable}
                  tenantSmsNumber={tenantQuoteSettings.sms_phone_number || null}
                  smsPreview={smsPreview}
                  smsPreviewLoading={smsPreviewLoading}
                  onSend={handleSendQuote}
                  onCancel={() => setShowSendFields(false)}
                  sending={sending}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </SlideOver>
  );
}
