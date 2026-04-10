"use client";

import { useState, useEffect, useRef, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { portalApi } from "@/lib/portal-api";
import { formatCurrency } from "@/lib/utils";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";
import { Package, CheckCircle2, Loader2 } from "lucide-react";

function label(id: string, fallback: string): string {
  return FEATURE_REGISTRY[id]?.label ?? fallback;
}

const sizes = [
  { value: "10yd", label: "10 YD", desc: "Small cleanouts" },
  { value: "15yd", label: "15 YD", desc: "Garage / basement" },
  { value: "20yd", label: "20 YD", desc: "Renovation debris" },
  { value: "30yd", label: "30 YD", desc: "Large projects" },
  { value: "40yd", label: "40 YD", desc: "Commercial / demo" },
];

const durations = [
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
];

interface PriceEstimate {
  total: number | null;
  size: string;
  rental_days: number | null;
  available: boolean;
}

export default function PortalRequestPage() {
  const router = useRouter();
  const [size, setSize] = useState("20yd");
  const [address, setAddress] = useState<Partial<AddressValue>>({});
  const [date, setDate] = useState("");
  const [rentalDays, setRentalDays] = useState(14);
  const [instructions, setInstructions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [jobNumber, setJobNumber] = useState("");
  const [error, setError] = useState("");

  // Pricing state
  const [estimate, setEstimate] = useState<PriceEstimate | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasAddress = !!(address.lat && address.lng);

  // Fetch pricing estimate with debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!hasAddress) {
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
        setEstimate({ total: null, size, rental_days: rentalDays, available: false });
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
      const result = await portalApi.post<{ job_number: string }>("/portal/request", {
        serviceType: "dumpster_rental",
        size,
        serviceAddress: address,
        preferredDate: date,
        rentalDays,
        instructions,
      });
      setJobNumber(result.job_number);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : label("portal_request_error", "Something went wrong. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--t-accent-soft)] mb-4">
          <CheckCircle2 className="h-8 w-8 text-[var(--t-accent)]" />
        </div>
        <h2 className="text-xl font-bold text-[var(--t-frame-text)]">{label("portal_request_submitted", "Request Submitted!")}</h2>
        <p className="mt-2 text-sm text-[var(--t-frame-text-muted)] text-center max-w-sm">
          {label("portal_request_confirmation", "Your request has been received. We'll confirm availability and contact you shortly.")} {jobNumber && `(${jobNumber})`}
        </p>
        <div className="mt-6 flex gap-3">
          <button onClick={() => router.push("/portal")} className="rounded-full border border-[var(--t-border)] px-4 py-2 text-sm font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
            {label("portal_back_to_dashboard", "Back to Dashboard")}
          </button>
          <button onClick={() => { setSubmitted(false); setSize("20yd"); setDate(""); setAddress({}); setInstructions(""); setEstimate(null); }}
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

        {/* Size selector — no prices shown until address entered */}
        <div>
          <label className="block text-sm font-semibold text-[var(--t-text-primary)] mb-3">{label("portal_request_select_size", "Select Size")}</label>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {sizes.map(s => (
              <button key={s.value} type="button" onClick={() => setSize(s.value)}
                className={`rounded-[20px] border-2 p-4 text-center transition-all ${
                  size === s.value ? "border-[var(--t-accent)] bg-[var(--t-accent-soft)]" : "border-[var(--t-border)] bg-[var(--t-bg-card)] hover:border-[var(--t-text-muted)]"
                }`}>
                <p className="text-lg font-bold text-[var(--t-text-primary)]">{s.label}</p>
                <p className="text-xs text-[var(--t-text-muted)] mt-0.5">{s.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Delivery address */}
        <div>
          <label className="block text-sm font-semibold text-[var(--t-text-primary)] mb-2">{label("portal_request_address", "Delivery Address")}</label>
          <AddressAutocomplete value={address} onChange={setAddress} placeholder="Enter delivery address" />
        </div>

        {/* Date + Duration row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-[var(--t-text-primary)] mb-2">{label("portal_request_date", "Preferred Delivery Date")}</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required
              min={new Date().toISOString().split("T")[0]}
              className="w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2.5 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-[var(--t-text-primary)] mb-2">{label("portal_request_duration", "Rental Duration")}</label>
            <div className="flex gap-2">
              {durations.map(d => (
                <button key={d.value} type="button" onClick={() => setRentalDays(d.value)}
                  className={`flex-1 rounded-full border px-3 py-2.5 text-sm font-medium transition-colors ${
                    rentalDays === d.value ? "border-[var(--t-accent)] text-[var(--t-accent)] bg-[var(--t-accent-soft)]" : "border-[var(--t-border)] text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)]"
                  }`}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div>
          <label className="block text-sm font-semibold text-[var(--t-text-primary)] mb-2">{label("portal_request_instructions", "Special Instructions")} <span className="font-normal text-[var(--t-text-muted)]">({label("portal_request_optional", "optional")})</span></label>
          <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} placeholder="Placement instructions, gate codes, etc."
            className="w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2.5 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)] resize-none" />
        </div>

        {/* Price estimate — backend-driven */}
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
              <div className="flex justify-between border-t-0 font-semibold text-[var(--t-text-primary)]">
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
