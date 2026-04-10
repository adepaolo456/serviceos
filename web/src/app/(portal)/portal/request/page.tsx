"use client";

import { useState, useEffect, useRef, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { portalApi } from "@/lib/portal-api";
import { formatCurrency } from "@/lib/utils";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";
import { Package, CheckCircle2, Loader2, Calendar, CreditCard } from "lucide-react";

function label(id: string, fallback: string): string {
  return FEATURE_REGISTRY[id]?.label ?? fallback;
}

/** Same helper used by BookingWizard + NewCustomerForm + OrchestrationService */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

interface SizeOption {
  asset_subtype: string;
  rental_period_days: number;
  base_price: number;
}

interface PriceEstimate {
  total: number | null;
  size: string;
  rental_days: number | null;
  included_days: number | null;
  extra_days_billable: boolean;
  available: boolean;
}

export default function PortalRequestPage() {
  const router = useRouter();
  const [sizeOptions, setSizeOptions] = useState<SizeOption[]>([]);
  const [size, setSize] = useState("");
  const [address, setAddress] = useState<Partial<AddressValue>>({});
  const [date, setDate] = useState("");
  const [rentalDays, setRentalDays] = useState(14);
  const [instructions, setInstructions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [jobNumber, setJobNumber] = useState("");
  const [error, setError] = useState("");
  const [bookingResult, setBookingResult] = useState<{
    invoice_id: string | null;
    balance_due: number;
    payment_required: boolean;
  } | null>(null);
  const [payingInvoice, setPayingInvoice] = useState(false);

  // Pricing state
  const [estimate, setEstimate] = useState<PriceEstimate | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  const hasAddress = !!(address.lat && address.lng);
  const selectedSize = sizeOptions.find(s => s.asset_subtype === size);

  // Derived pickup date — same logic as BookingWizard / NewCustomerForm
  const pickupDate = date && rentalDays ? addDays(date, rentalDays) : null;

  // Load size options from backend pricing rules (same as BookingWizard)
  useEffect(() => {
    portalApi.get<{ data: SizeOption[] }>("/pricing?limit=100")
      .then(res => {
        const opts = (res.data || []).filter(r => r.asset_subtype);
        setSizeOptions(opts);
        if (opts.length > 0 && !size) {
          setSize(opts[0].asset_subtype);
          setRentalDays(opts[0].rental_period_days || 14);
        }
      })
      .catch(() => {});
  }, []);

  // Sync rental days to pricing rule when size changes (same as BookingWizard lines 435-440)
  useEffect(() => {
    const rule = sizeOptions.find(o => o.asset_subtype === size);
    if (rule?.rental_period_days) setRentalDays(rule.rental_period_days);
  }, [size, sizeOptions]);

  // Fetch pricing estimate with debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!hasAddress || !size) {
      setEstimate(null);
      return;
    }

    setPriceLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          size,
          days: String(rentalDays),
          ...(address.lat ? { lat: String(address.lat) } : {}),
          ...(address.lng ? { lng: String(address.lng) } : {}),
        });
        const result = await portalApi.get<PriceEstimate>(`/portal/pricing/estimate?${params}`);
        setEstimate(result);
      } catch {
        setEstimate({ total: null, size, rental_days: rentalDays, included_days: null, extra_days_billable: true, available: false });
      } finally {
        setPriceLoading(false);
      }
    }, 400);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [size, rentalDays, address.lat, address.lng, hasAddress]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await portalApi.post<{
        job_number: string;
        invoice_id: string | null;
        balance_due: number;
        payment_required: boolean;
      }>("/portal/request", {
        serviceType: "dumpster_rental",
        size,
        serviceAddress: address,
        preferredDate: date,
        rentalDays,
        instructions,
      });
      setJobNumber(result.job_number);
      setBookingResult({
        invoice_id: result.invoice_id,
        balance_due: result.balance_due,
        payment_required: result.payment_required,
      });
      setSubmitted(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      // Credit enforcement blocks show as customer-safe service restriction
      if (msg.includes("credit hold") || msg.includes("CREDIT_HOLD")) {
        setError(label("portal_request_service_restricted", "Your account has an outstanding balance that must be resolved before new service can be scheduled. Please make a payment or contact us."));
      } else {
        setError(msg || label("portal_request_error", "Something went wrong. Please try again."));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    // Payment required — route to payment
    if (bookingResult?.payment_required && bookingResult.invoice_id && bookingResult.balance_due > 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--t-warning-soft, #FFF8E1)] mb-4">
            <CreditCard className="h-8 w-8" style={{ color: "var(--t-warning, #F59E0B)" }} />
          </div>
          <h2 className="text-xl font-bold text-[var(--t-frame-text)]">{label("portal_booking_payment_required", "Payment Required to Complete Booking")}</h2>
          <p className="mt-2 text-sm text-[var(--t-frame-text-muted)] text-center max-w-sm">
            {label("portal_booking_payment_message", "Your booking will be scheduled after payment is confirmed.")}
          </p>
          <div className="mt-4 rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-6 py-4 text-center">
            <p className="text-xs uppercase tracking-wider font-semibold" style={{ color: "var(--t-text-muted)" }}>{label("portal_booking_amount_due", "Amount Due")}</p>
            <p className="text-3xl font-bold tabular-nums mt-1" style={{ color: "var(--t-text-primary)" }}>{formatCurrency(bookingResult.balance_due)}</p>
          </div>
          <div className="mt-6 flex flex-col gap-3 items-center">
            <button
              onClick={async () => {
                if (payingInvoice) return;
                setPayingInvoice(true);
                try {
                  const res = await portalApi.post<{ url?: string }>("/portal/payments/prepare", {
                    invoiceId: bookingResult.invoice_id,
                    amount: bookingResult.balance_due,
                  });
                  if (res.url) { window.location.href = res.url; return; }
                  router.push("/portal/invoices");
                } catch {
                  setError(label("portal_payment_failed", "Payment could not be processed") + ". " + label("portal_payment_try_again", "Please try again or contact us."));
                  setPayingInvoice(false);
                }
              }}
              disabled={payingInvoice}
              className="flex items-center gap-2 rounded-full bg-[var(--t-accent)] px-8 py-3 text-sm font-semibold text-[var(--t-accent-on-accent)] hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              <CreditCard className="h-4 w-4" />
              {payingInvoice ? label("portal_payment_processing", "Processing payment...") : label("portal_pay_now", "Pay Now")}
            </button>
            <button onClick={() => router.push("/portal/invoices")} className="text-xs font-medium" style={{ color: "var(--t-accent)" }}>
              {label("portal_booking_pay_later", "Pay Later")} →
            </button>
          </div>
          {error && <p className="mt-4 text-sm text-[var(--t-error)] text-center max-w-sm">{error}</p>}
        </div>
      );
    }

    // No payment required — confirmation
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--t-accent-soft)] mb-4">
          <CheckCircle2 className="h-8 w-8 text-[var(--t-accent)]" />
        </div>
        <h2 className="text-xl font-bold text-[var(--t-frame-text)]">{label("portal_request_submitted", "Request Submitted!")}</h2>
        <p className="mt-2 text-sm text-[var(--t-frame-text-muted)] text-center max-w-sm">
          {label("portal_request_confirmation", "Your request has been received. We'll confirm availability and contact you shortly.")}
        </p>
        <div className="mt-6 flex gap-3">
          <button onClick={() => router.push("/portal")} className="rounded-full border border-[var(--t-border)] px-4 py-2 text-sm font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
            {label("portal_back_to_dashboard", "Back to Dashboard")}
          </button>
          <button onClick={() => { setSubmitted(false); setBookingResult(null); setSize(sizeOptions[0]?.asset_subtype || ""); setDate(""); setAddress({}); setInstructions(""); setEstimate(null); }}
            className="rounded-full bg-[var(--t-accent)] px-4 py-2 text-sm font-semibold text-[var(--t-accent-on-accent)] hover:opacity-90 transition-opacity">
            {label("portal_request_another", "Request Another")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)]">{label("portal_request_title", "Request a Dumpster")}</h1>
        <p className="mt-1 text-sm text-[var(--t-frame-text-muted)]">{label("portal_request_subtitle", "Choose your size and schedule delivery.")}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && <div className="rounded-[20px] bg-[var(--t-error-soft)] px-4 py-3 text-sm text-[var(--t-error)]">{error}</div>}

        {/* Size selector — from backend pricing rules */}
        <div>
          <label className="block text-sm font-semibold text-[var(--t-text-primary)] mb-3">{label("portal_request_select_size", "Select Size")}</label>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {sizeOptions.length > 0 ? sizeOptions.map(s => (
              <button key={s.asset_subtype} type="button" onClick={() => setSize(s.asset_subtype)}
                className={`rounded-[20px] border-2 p-4 text-center transition-all ${
                  size === s.asset_subtype ? "border-[var(--t-accent)] bg-[var(--t-accent-soft)]" : "border-[var(--t-border)] bg-[var(--t-bg-card)] hover:border-[var(--t-text-muted)]"
                }`}>
                <p className="text-lg font-bold text-[var(--t-text-primary)]">{s.asset_subtype.replace(/yd$/i, " YD").toUpperCase()}</p>
                <p className="text-xs text-[var(--t-text-muted)] mt-0.5">{s.rental_period_days} {label("portal_request_days_included", "days included")}</p>
              </button>
            )) : (
              <div className="col-span-full h-16 rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] animate-pulse" />
            )}
          </div>
        </div>

        {/* Delivery address */}
        <div>
          <label className="block text-sm font-semibold text-[var(--t-text-primary)] mb-2">{label("portal_request_address", "Delivery Address")}</label>
          <AddressAutocomplete value={address} onChange={setAddress} placeholder="Enter delivery address" />
        </div>

        {/* Date — clicking anywhere in field opens picker */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-[var(--t-text-primary)] mb-2">{label("portal_request_date", "Preferred Delivery Date")}</label>
            <div
              className="relative cursor-pointer"
              onClick={() => dateInputRef.current?.showPicker?.()}
            >
              <input
                ref={dateInputRef}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                min={new Date().toISOString().split("T")[0]}
                className="w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2.5 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)] cursor-pointer"
              />
              <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--t-text-muted)] pointer-events-none" />
            </div>
          </div>
          {/* Pickup date — auto-derived from delivery + included days */}
          <div>
            <label className="block text-sm font-semibold text-[var(--t-text-primary)] mb-2">{label("portal_request_pickup_date", "Estimated Pickup Date")}</label>
            <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-elevated, var(--t-bg-card))] px-4 py-2.5 text-sm" style={{ color: pickupDate ? "var(--t-text-primary)" : "var(--t-text-muted)" }}>
              {pickupDate ? new Date(pickupDate + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : label("portal_request_pickup_auto", "Set delivery date to see pickup date")}
            </div>
            {selectedSize && (
              <p className="text-xs mt-1" style={{ color: "var(--t-text-muted)" }}>
                {selectedSize.rental_period_days} {label("portal_request_days_included", "days included")}
                {estimate && !estimate.extra_days_billable && (
                  <span> · {label("portal_request_no_extra_charge", "no additional charge for extra days")}</span>
                )}
              </p>
            )}
          </div>
        </div>

        {/* Instructions */}
        <div>
          <label className="block text-sm font-semibold text-[var(--t-text-primary)] mb-2">{label("portal_request_instructions", "Special Instructions")} <span className="font-normal text-[var(--t-text-muted)]">({label("portal_request_optional", "optional")})</span></label>
          <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} placeholder="Placement instructions, gate codes, etc."
            className="w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2.5 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)] resize-none" />
        </div>

        {/* Price estimate — backend-driven with customer context */}
        <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
          <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-3">{label("portal_request_estimated_cost", "Estimated Cost")}</h3>
          {!hasAddress ? (
            <p className="text-sm text-[var(--t-text-muted)]">{label("portal_request_enter_address", "Enter an address to see pricing.")}</p>
          ) : priceLoading ? (
            <div className="flex items-center gap-2 text-sm text-[var(--t-text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" /> {label("portal_request_calculating", "Calculating price...")}
            </div>
          ) : estimate && estimate.available && estimate.total != null ? (
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between font-semibold text-[var(--t-text-primary)]">
                <span>{label("portal_request_estimated_total", "Estimated Total")}</span>
                <span>{formatCurrency(estimate.total)}</span>
              </div>
              <p className="text-xs text-[var(--t-text-muted)] mt-2">{label("portal_request_price_disclaimer", "Final price may vary based on location and disposal fees.")}</p>
            </div>
          ) : (
            <p className="text-sm text-[var(--t-text-muted)]">{label("portal_request_price_unavailable", "Unable to calculate price. Please try again or contact us.")}</p>
          )}
        </div>

        {/* Submit */}
        <button type="submit" disabled={submitting || !date || !address.street}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--t-accent)] px-4 py-3 text-sm font-semibold text-[var(--t-accent-on-accent)] hover:opacity-90 disabled:opacity-50 transition-opacity">
          {submitting ? label("portal_request_submitting", "Submitting...") : <><Package className="h-4 w-4" /> {label("portal_request_submit", "Submit Request")}</>}
        </button>
      </form>
    </div>
  );
}
