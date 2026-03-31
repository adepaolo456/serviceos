"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ChevronLeft, ChevronRight, Check, Calendar, MapPin, User, ClipboardList, Loader2 } from "lucide-react";
import { useTenant } from "../tenant-context";
import { formatCurrency } from "@/lib/utils";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";

const API = process.env.NEXT_PUBLIC_API_URL || "https://serviceos-api.vercel.app";

interface Service {
  id: string;
  name: string;
  subtype: string;
  basePrice: number;
  rentalDays: number;
  extraDayRate: number;
  deliveryFee: number;
  depositAmount: number;
  depositRequired: boolean;
}

interface ServiceGroup {
  [key: string]: Service[];
}

const STEPS = ["Service", "Schedule", "Delivery", "Info", "Review"];
const STEP_ICONS = [ClipboardList, Calendar, MapPin, User, Check];

const TIME_WINDOWS = [
  { label: "Morning", value: "morning", desc: "7:00 AM - 12:00 PM" },
  { label: "Afternoon", value: "afternoon", desc: "12:00 PM - 5:00 PM" },
  { label: "Any Time", value: "any", desc: "7:00 AM - 5:00 PM" },
];

function BookingWizardContent() {
  const { tenant } = useTenant();
  const router = useRouter();
  const searchParams = useSearchParams();
  const embed = searchParams.get("embed") === "true";

  const [step, setStep] = useState(1);
  const [services, setServices] = useState<ServiceGroup>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [selectedType, setSelectedType] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [timeWindow, setTimeWindow] = useState("any");
  const [rentalDays, setRentalDays] = useState(7);
  const [address, setAddress] = useState<AddressValue | null>(null);
  const [placementNotes, setPlacementNotes] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  useEffect(() => {
    if (!tenant) return;
    fetch(`${API}/public/tenant/${tenant.slug}/services`)
      .then((r) => r.json())
      .then((d) => {
        const svc = d.services || {};
        setServices(svc);
        const types = Object.keys(svc);
        if (types.length === 1) setSelectedType(types[0]);
      })
      .catch(() => {});
  }, [tenant]);

  const types = Object.keys(services);
  const currentServices = selectedType ? services[selectedType] || [] : [];
  const selectedService = useMemo(
    () => currentServices.find((s) => s.id === selectedServiceId) || null,
    [currentServices, selectedServiceId]
  );

  // Set default rental days when service changes
  useEffect(() => {
    if (selectedService) setRentalDays(selectedService.rentalDays);
  }, [selectedService]);

  const priceBreakdown = useMemo(() => {
    if (!selectedService) return null;
    const extraDays = Math.max(0, rentalDays - selectedService.rentalDays);
    const extraDayCost = extraDays * selectedService.extraDayRate;
    const subtotal = selectedService.basePrice + extraDayCost + selectedService.deliveryFee;
    return {
      base: selectedService.basePrice,
      extraDays,
      extraDayCost,
      delivery: selectedService.deliveryFee,
      deposit: selectedService.depositRequired ? selectedService.depositAmount : 0,
      subtotal,
      total: subtotal + (selectedService.depositRequired ? selectedService.depositAmount : 0),
    };
  }, [selectedService, rentalDays]);

  const minDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  }, []);

  function canAdvance(): boolean {
    switch (step) {
      case 1: return !!selectedServiceId;
      case 2: return !!deliveryDate && !!timeWindow;
      case 3: return !!address?.street;
      case 4: return !!customerName.trim() && !!customerEmail.trim() && !!customerPhone.trim();
      default: return true;
    }
  }

  async function handleSubmit() {
    if (!tenant || !selectedService || !address) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`${API}/public/tenant/${tenant.slug}/booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: selectedServiceId,
          deliveryDate,
          timeWindow,
          rentalDays,
          address: {
            street: address.street,
            city: address.city,
            state: address.state,
            zip: address.zip,
            lat: address.lat,
            lng: address.lng,
          },
          placementNotes,
          customerName: customerName.trim(),
          customerEmail: customerEmail.trim(),
          customerPhone: customerPhone.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Booking failed. Please try again.");
      }
      const data = await res.json();
      const jobNumber = data.jobNumber || data.id || "";
      if (embed) {
        window.parent.postMessage({ type: "serviceos-booking-complete", jobNumber }, "*");
      }
      router.push(`/site/confirmation?jobNumber=${jobNumber}${embed ? "&embed=true" : ""}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!tenant) return null;

  const inputClass =
    "w-full rounded-[18px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-3 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none transition-colors focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]";

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      {/* Progress bar */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-2">
          {STEPS.map((label, i) => {
            const Icon = STEP_ICONS[i];
            const active = i + 1 === step;
            const done = i + 1 < step;
            return (
              <div key={label} className="flex flex-col items-center flex-1">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                    done
                      ? "bg-[var(--t-accent)] text-black"
                      : active
                      ? "bg-[var(--t-accent-soft)] text-[var(--t-accent)]"
                      : "bg-[var(--t-bg-card)] text-[var(--t-text-muted)] border border-[var(--t-border)]"
                  }`}
                >
                  {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </div>
                <span className={`mt-1.5 text-xs font-medium ${active ? "text-[var(--t-text-primary)]" : "text-[var(--t-text-muted)]"} hidden sm:block`}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
        <div className="h-1 rounded-full bg-[var(--t-bg-card)] border border-[var(--t-border)] mt-3">
          <div className="h-full rounded-full bg-[var(--t-accent)] transition-all duration-300" style={{ width: `${((step - 1) / (STEPS.length - 1)) * 100}%` }} />
        </div>
      </div>

      {/* Step 1: Service Selection */}
      {step === 1 && (
        <div>
          <h2 className="text-[28px] font-bold text-[var(--t-text-primary)] mb-2 tracking-[-1px]">Choose Your Service</h2>
          <p className="text-sm text-[var(--t-text-muted)] mb-6">Select a service type and size</p>

          {types.length > 1 && (
            <div className="flex flex-wrap gap-2 mb-6">
              {types.map((t) => (
                <button
                  key={t}
                  onClick={() => { setSelectedType(t); setSelectedServiceId(""); }}
                  className={`rounded-full px-5 py-2 text-sm font-medium border transition-colors ${
                    selectedType === t
                      ? "border-[var(--t-accent)] bg-[var(--t-accent-soft)] text-[var(--t-accent)]"
                      : "border-[var(--t-border)] text-[var(--t-text-muted)] hover:border-[var(--t-text-muted)]"
                  }`}
                >
                  {t.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {currentServices.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedServiceId(s.id)}
                className={`rounded-[18px] border p-5 text-left transition-all ${
                  selectedServiceId === s.id
                    ? "border-[var(--t-accent)] bg-[var(--t-accent-soft)]"
                    : "border-[var(--t-border)] bg-[var(--t-bg-card)] hover:bg-[var(--t-bg-card-hover)]"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-[var(--t-text-muted)] uppercase tracking-wider">
                    {s.subtype || s.name}
                  </span>
                  {selectedServiceId === s.id && <Check className="h-5 w-5 text-[var(--t-accent)]" />}
                </div>
                <h3 className="font-semibold text-[var(--t-text-primary)]">{s.name}</h3>
                <p className="text-2xl font-bold mt-2 text-[var(--t-accent)]">{formatCurrency(s.basePrice)}</p>
                <p className="text-xs text-[var(--t-text-muted)] mt-1">{s.rentalDays} day rental included</p>
                {s.deliveryFee > 0 && <p className="text-xs text-[var(--t-text-muted)]">+ {formatCurrency(s.deliveryFee)} delivery</p>}
              </button>
            ))}
          </div>
          {currentServices.length === 0 && selectedType && (
            <p className="text-center text-[var(--t-text-muted)] py-8">No services available</p>
          )}
        </div>
      )}

      {/* Step 2: Schedule */}
      {step === 2 && (
        <div>
          <h2 className="text-[28px] font-bold text-[var(--t-text-primary)] mb-2 tracking-[-1px]">Pick Your Date</h2>
          <p className="text-sm text-[var(--t-text-muted)] mb-6">Choose delivery date, time, and rental period</p>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-[var(--t-text-primary)] mb-1.5">Delivery Date</label>
              <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} min={minDate} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--t-text-primary)] mb-1.5">Preferred Time</label>
              <div className="grid grid-cols-3 gap-3">
                {TIME_WINDOWS.map((tw) => (
                  <button
                    key={tw.value}
                    onClick={() => setTimeWindow(tw.value)}
                    className={`rounded-[18px] border p-3 text-center transition-colors ${
                      timeWindow === tw.value
                        ? "border-[var(--t-accent)] bg-[var(--t-accent-soft)]"
                        : "border-[var(--t-border)] bg-[var(--t-bg-card)] hover:bg-[var(--t-bg-card-hover)]"
                    }`}
                  >
                    <p className="text-sm font-semibold text-[var(--t-text-primary)]">{tw.label}</p>
                    <p className="text-xs text-[var(--t-text-muted)] mt-0.5">{tw.desc}</p>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--t-text-primary)] mb-1.5">Rental Period: {rentalDays} days</label>
              <input
                type="range"
                min={selectedService?.rentalDays || 1}
                max={30}
                value={rentalDays}
                onChange={(e) => setRentalDays(Number(e.target.value))}
                className="w-full accent-[#22C55E]"
              />
              <div className="flex justify-between text-xs text-[var(--t-text-muted)] mt-1">
                <span>{selectedService?.rentalDays || 1} days (included)</span>
                <span>30 days</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Delivery Details */}
      {step === 3 && (
        <div>
          <h2 className="text-[28px] font-bold text-[var(--t-text-primary)] mb-2 tracking-[-1px]">Delivery Address</h2>
          <p className="text-sm text-[var(--t-text-muted)] mb-6">Where should we deliver?</p>

          <div className="space-y-4">
            <AddressAutocomplete
              value={address || undefined}
              onChange={setAddress}
              label="Address"
              placeholder="Start typing your address..."
              className={`${inputClass} pl-10`}
            />
            <div>
              <label className="block text-sm font-medium text-[var(--t-text-primary)] mb-1.5">Placement Notes (optional)</label>
              <textarea
                value={placementNotes}
                onChange={(e) => setPlacementNotes(e.target.value)}
                placeholder="e.g., Place in the driveway on the left side"
                rows={3}
                className={inputClass}
              />
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Customer Info */}
      {step === 4 && (
        <div>
          <h2 className="text-[28px] font-bold text-[var(--t-text-primary)] mb-2 tracking-[-1px]">Your Information</h2>
          <p className="text-sm text-[var(--t-text-muted)] mb-6">We&apos;ll use this to confirm your booking</p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--t-text-primary)] mb-1.5">Full Name</label>
              <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="John Smith" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--t-text-primary)] mb-1.5">Email</label>
              <input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="john@example.com" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--t-text-primary)] mb-1.5">Phone</label>
              <input type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="(555) 123-4567" className={inputClass} />
            </div>
          </div>
        </div>
      )}

      {/* Step 5: Review & Confirm */}
      {step === 5 && selectedService && priceBreakdown && (
        <div>
          <h2 className="text-[28px] font-bold text-[var(--t-text-primary)] mb-2 tracking-[-1px]">Review Your Booking</h2>
          <p className="text-sm text-[var(--t-text-muted)] mb-6">Confirm everything looks right</p>

          <div className="space-y-4">
            <div className="rounded-[18px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
              <h3 className="text-xs font-semibold text-[var(--t-text-muted)] uppercase tracking-wider mb-3">Service</h3>
              <p className="font-semibold text-[var(--t-text-primary)]">{selectedService.name}</p>
              <p className="text-sm text-[var(--t-text-muted)]">{selectedType.replace(/_/g, " ")} &middot; {rentalDays} day rental</p>
            </div>
            <div className="rounded-[18px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
              <h3 className="text-xs font-semibold text-[var(--t-text-muted)] uppercase tracking-wider mb-3">Delivery</h3>
              <p className="font-semibold text-[var(--t-text-primary)]">{deliveryDate}</p>
              <p className="text-sm text-[var(--t-text-muted)]">{TIME_WINDOWS.find((tw) => tw.value === timeWindow)?.desc}</p>
              {address && <p className="text-sm text-[var(--t-text-muted)] mt-1">{address.formatted || `${address.street}, ${address.city}, ${address.state} ${address.zip}`}</p>}
              {placementNotes && <p className="text-sm text-[var(--t-text-muted)] mt-1 italic">{placementNotes}</p>}
            </div>
            <div className="rounded-[18px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
              <h3 className="text-xs font-semibold text-[var(--t-text-muted)] uppercase tracking-wider mb-3">Contact</h3>
              <p className="font-semibold text-[var(--t-text-primary)]">{customerName}</p>
              <p className="text-sm text-[var(--t-text-muted)]">{customerEmail} &middot; {customerPhone}</p>
            </div>
            <div className="rounded-[18px] border border-[var(--t-accent)] bg-[var(--t-accent-soft)] p-5">
              <h3 className="text-xs font-semibold text-[var(--t-text-muted)] uppercase tracking-wider mb-3">Price Breakdown</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-[var(--t-text-muted)]">Base price ({selectedService.rentalDays} days)</span><span className="font-medium text-[var(--t-text-primary)]">{formatCurrency(priceBreakdown.base)}</span></div>
                {priceBreakdown.extraDays > 0 && (
                  <div className="flex justify-between"><span className="text-[var(--t-text-muted)]">Extra days ({priceBreakdown.extraDays} x {formatCurrency(selectedService.extraDayRate)})</span><span className="font-medium text-[var(--t-text-primary)]">{formatCurrency(priceBreakdown.extraDayCost)}</span></div>
                )}
                {priceBreakdown.delivery > 0 && (
                  <div className="flex justify-between"><span className="text-[var(--t-text-muted)]">Delivery fee</span><span className="font-medium text-[var(--t-text-primary)]">{formatCurrency(priceBreakdown.delivery)}</span></div>
                )}
                {priceBreakdown.deposit > 0 && (
                  <div className="flex justify-between"><span className="text-[var(--t-text-muted)]">Refundable deposit</span><span className="font-medium text-[var(--t-text-primary)]">{formatCurrency(priceBreakdown.deposit)}</span></div>
                )}
                <div className="flex justify-between border-t border-[var(--t-border)] pt-2 mt-2">
                  <span className="font-semibold text-[var(--t-text-primary)]">Total</span>
                  <span className="text-xl font-bold text-[var(--t-accent)]">{formatCurrency(priceBreakdown.total)}</span>
                </div>
              </div>
            </div>
          </div>

          {error && <p className="mt-4 rounded-[18px] bg-[var(--t-error-soft)] border border-[var(--t-error)] px-4 py-3 text-sm text-[var(--t-error)]">{error}</p>}
        </div>
      )}

      {/* Navigation buttons */}
      <div className="flex items-center justify-between mt-8 pt-6 border-t border-[var(--t-border)]">
        {step > 1 ? (
          <button onClick={() => setStep(step - 1)} className="flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-medium text-[var(--t-text-muted)] border border-[var(--t-border)] hover:bg-[var(--t-bg-card)] transition-colors">
            <ChevronLeft className="h-4 w-4" /> Back
          </button>
        ) : <div />}

        {step < 5 ? (
          <button
            onClick={() => setStep(step + 1)}
            disabled={!canAdvance()}
            className="flex items-center gap-1.5 rounded-full px-7 py-2.5 text-sm font-semibold bg-[var(--t-accent)] text-black transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
          >
            Continue <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-2 rounded-full px-8 py-3 text-sm font-semibold bg-[var(--t-accent)] text-black transition-all hover:brightness-110 disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {submitting ? "Submitting..." : "Confirm Booking"}
          </button>
        )}
      </div>

      {embed && (
        <p className="mt-8 text-center text-xs text-[var(--t-text-muted)]">
          Powered by <a href="https://serviceos.com" className="hover:text-[var(--t-text-primary)]">ServiceOS</a>
        </p>
      )}
    </div>
  );
}

export default function BookingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--t-bg-primary)] flex items-center justify-center"><div className="h-8 w-8 border-2 border-[var(--t-border)] border-t-[var(--t-accent)] rounded-full animate-spin" /></div>}>
      <BookingWizardContent />
    </Suspense>
  );
}
