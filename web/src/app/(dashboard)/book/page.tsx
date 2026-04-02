"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DollarSign, User, Calendar, CreditCard, CheckCircle2, ArrowLeft,
  Phone, Truck, Package, AlertTriangle,
} from "lucide-react";
import { api } from "@/lib/api";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";

/* ---- Types ---- */

interface PriceQuote {
  rule?: { name: string };
  breakdown: {
    basePrice: number; total: number; tax: number; taxRate: number;
    deliveryFee: number; pickupFee: number; extraDayRate: number;
    extraDayCharges: number; includedDays: number; rentalDays: number;
    distanceSurcharge: number; requireDeposit: boolean; depositAmount: number; jobFee: number;
    distanceMiles?: number; includedMiles?: number; excessMiles?: number; perMileCharge?: number;
    includedTons?: number; overagePerTon?: number; subtotal?: number;
    exchangeDiscount?: number; isExchange?: boolean;
  };
}

interface CustomerMatch {
  id: string; first_name: string; last_name: string; phone: string;
  email: string; company_name: string; billing_address: Record<string, string> | null;
}

interface BookingResult {
  success: boolean;
  deliveryJob: { id: string; jobNumber: string };
  pickupJob: { id: string; jobNumber: string };
  invoice: { id: string; invoiceNumber: string };
  customerId: string;
  autoApproved?: boolean;
  asset?: { id: string; identifier: string } | null;
  assetWarning?: string | null;
}

/* ---- Helpers ---- */

function nextBusinessDay() {
  const d = new Date(); d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

function addDays(date: string, days: number) {
  const d = new Date(date + "T00:00:00"); d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" });
}

import { formatCurrency, formatPhone } from "@/lib/utils";
const fmtMoney = (n: number) => formatCurrency(n);

const STEPS = [
  { num: 1, label: "Quote", icon: DollarSign },
  { num: 2, label: "Customer", icon: User },
  { num: 3, label: "Schedule", icon: Calendar },
  { num: 4, label: "Confirm", icon: CreditCard },
];

/* ---- Page ---- */

export default function BookingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [prefilledFromLast, setPrefilledFromLast] = useState(false);

  // Step 1: Quote
  const [serviceType, setServiceType] = useState(() => {
    if (typeof window === "undefined") return "dumpster_rental";
    try { const s = JSON.parse(localStorage.getItem("serviceos-last-booking") || "{}"); if (s.serviceType) { return s.serviceType; } } catch {} return "dumpster_rental";
  });
  const [jobType, setJobType] = useState<"delivery" | "exchange">("delivery");
  const [assetSubtype, setAssetSubtype] = useState(() => {
    if (typeof window === "undefined") return "20yd";
    try { const s = JSON.parse(localStorage.getItem("serviceos-last-booking") || "{}"); if (s.assetSubtype) { return s.assetSubtype; } } catch {} return "20yd";
  });
  const [address, setAddress] = useState<AddressValue>({ street: "", city: "", state: "", zip: "", lat: null, lng: null });
  const [rentalDays, setRentalDays] = useState(14);

  useEffect(() => {
    try { const s = localStorage.getItem("serviceos-last-booking"); if (s) setPrefilledFromLast(true); } catch {}
  }, []);
  const [activeSizes, setActiveSizes] = useState<string[]>([]);
  const [quote, setQuote] = useState<PriceQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [availability, setAvailability] = useState<{ availableOnDate: number; availableNow: number; pickupsBeforeDate: number; total: number } | null>(null);

  // Fetch active sizes from pricing rules
  useEffect(() => {
    api.get<{ data: { asset_subtype: string }[] }>("/pricing?limit=100")
      .then((res) => {
        const sizes = [...new Set((res.data || []).map(r => r.asset_subtype).filter(Boolean))];
        setActiveSizes(sizes);
        if (sizes.length > 0 && !sizes.includes(assetSubtype)) setAssetSubtype(sizes[0]);
      })
      .catch(() => {});
  }, []);

  // Step 2: Customer
  const [phoneSearch, setPhoneSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerMatch[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [custType, setCustType] = useState<"residential" | "commercial">("residential");
  const [companyName, setCompanyName] = useState("");
  const [sameAddress, setSameAddress] = useState(true);
  const [billingAddress, setBillingAddress] = useState<AddressValue>({ street: "", city: "", state: "", zip: "", lat: null, lng: null });
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(null);

  // Step 3: Schedule
  const [deliveryDate, setDeliveryDate] = useState(nextBusinessDay);
  const [timeWindow, setTimeWindow] = useState("morning");
  const [instructions, setInstructions] = useState("");
  const [pickupDate, setPickupDate] = useState(() => addDays(nextBusinessDay(), 14));

  // Step 4: Payment
  const [paymentMethod, setPaymentMethod] = useState<"card" | "invoice">("invoice");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BookingResult | null>(null);
  const [error, setError] = useState("");

  // Auto-quote
  useEffect(() => {
    if (!address.lat || !address.lng) return;
    setQuoting(true);
    Promise.all([
      api.post<PriceQuote>("/pricing/calculate", { serviceType, assetSubtype, jobType, customerLat: address.lat, customerLng: address.lng, rentalDays }),
      api.get<{ availableOnDate: number; availableNow: number; pickupsBeforeDate: number; total: number }>(`/assets/availability?subtype=${assetSubtype}&date=${deliveryDate}`),
    ]).then(([q, avail]) => { setQuote(q); setAvailability(avail); if (q.breakdown.includedDays) setRentalDays(q.breakdown.includedDays); })
    .catch(() => { setQuote(null); setAvailability(null); }).finally(() => setQuoting(false));
  }, [address.lat, address.lng, serviceType, assetSubtype, jobType, deliveryDate]);

  useEffect(() => {
    if (!address.lat || !quote) return;
    api.post<PriceQuote>("/pricing/calculate", { serviceType, assetSubtype, jobType, customerLat: address.lat, customerLng: address.lng, rentalDays }).then(setQuote).catch(() => {});
  }, [rentalDays]);

  useEffect(() => { setPickupDate(addDays(deliveryDate, rentalDays)); }, [deliveryDate, rentalDays]);

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!phoneSearch || phoneSearch.length < 2) { setCustomerResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await api.get<{ data: CustomerMatch[] }>(`/customers?search=${encodeURIComponent(phoneSearch)}&limit=5`);
        setCustomerResults(res.data);
        if (res.data.length === 0 && !/^\d/.test(phoneSearch)) {
          const parts = phoneSearch.trim().split(/\s+/);
          if (parts.length >= 1) setFirstName(parts[0]);
          if (parts.length >= 2) setLastName(parts.slice(1).join(" "));
        }
      } catch { /* */ }
    }, 250);
  }, [phoneSearch]);

  const selectCustomer = (c: CustomerMatch) => {
    setCustomerId(c.id); setFirstName(c.first_name); setLastName(c.last_name);
    setEmail(c.email || ""); setPhone(c.phone || ""); setPhoneSearch(""); setCustomerResults([]);
    if (c.company_name) { setCustType("commercial"); setCompanyName(c.company_name); }
  };

  const handleSubmit = async () => {
    if (!quote) return;
    setError(""); setSubmitting(true);
    const windows: Record<string, [string, string]> = { morning: ["08:00", "12:00"], afternoon: ["12:00", "17:00"], fullday: ["08:00", "17:00"] };
    const [wStart, wEnd] = windows[timeWindow] || windows.morning;
    try {
      const res = await api.post<BookingResult>("/bookings/complete", {
        customerId: customerId || undefined,
        customer: customerId ? undefined : {
          firstName, lastName, email: email || undefined, phone: phone || undefined,
          type: custType, companyName: custType === "commercial" ? companyName : undefined,
          billingAddress: sameAddress ? { street: address.street, city: address.city, state: address.state, zip: address.zip } : { street: billingAddress.street, city: billingAddress.city, state: billingAddress.state, zip: billingAddress.zip },
        },
        serviceType, assetSubtype,
        serviceAddress: { street: address.street, city: address.city, state: address.state, zip: address.zip, lat: address.lat, lng: address.lng },
        deliveryDate, pickupDate, rentalDays,
        scheduledWindowStart: wStart, scheduledWindowEnd: wEnd,
        placementNotes: instructions || undefined,
        basePrice: quote.breakdown.basePrice,
        deliveryFee: quote.breakdown.deliveryFee || quote.breakdown.jobFee || 0,
        taxAmount: quote.breakdown.tax, totalPrice: quote.breakdown.total,
        depositAmount: quote.breakdown.requireDeposit ? quote.breakdown.depositAmount : 0,
        paymentMethod,
      });
      setResult(res);
      try { localStorage.setItem("serviceos-last-booking", JSON.stringify({ serviceType, assetSubtype, timeWindow })); } catch {}
      setStep(5);
    } catch (err) { setError(err instanceof Error ? err.message : "Booking failed"); }
    finally { setSubmitting(false); }
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape" && step > 1 && step < 5) setStep(s => s - 1); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [step]);

  const inputCls = "w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-3 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)] transition-colors";
  const labelCls = "block text-[13px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] mb-1.5";

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          {step < 5 && step > 1 && (
            <button onClick={() => setStep(s => s - 1)} className="rounded-full border border-[var(--t-frame-border)] bg-[rgba(255,255,255,0.06)] p-2 text-[var(--t-frame-text-muted)] hover:text-[var(--t-frame-text)] transition-colors active:scale-95">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div>
            <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)]">
              {step === 5 ? "Booking Confirmed!" : "New Booking"}
            </h1>
            {step < 5 && <p className="text-[13px] text-[var(--t-frame-text-muted)] mt-0.5">Step {step} of 4</p>}
          </div>
        </div>
        {step < 5 && <Link href="/" className="text-[13px] text-[var(--t-frame-text-muted)] hover:text-[var(--t-frame-text)] transition-colors">Cancel</Link>}
      </div>

      {/* Progress */}
      {step < 5 && (
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((s) => (
            <div key={s.num} className="flex-1">
              <div className={`h-1.5 rounded-full transition-colors ${step >= s.num ? "bg-[#22C55E]" : "bg-[var(--t-bg-card-hover)]"}`} />
            </div>
          ))}
        </div>
      )}

      {/* ===== STEP 1: Quote ===== */}
      {step === 1 && (
        <div className="space-y-5">
          {prefilledFromLast && <p className="text-[13px] text-[var(--t-text-muted)] italic">Pre-filled from your last booking</p>}

          <div>
            <label className={labelCls}>Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setJobType("delivery")}
                className={`rounded-[20px] py-3 text-sm font-medium transition-all active:scale-95 ${jobType === "delivery" ? "bg-[var(--t-accent-soft)] text-[var(--t-accent)] border border-[var(--t-accent)]" : "bg-[var(--t-bg-card)] text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] border border-[var(--t-border)]"}`}>
                New Delivery
              </button>
              <button onClick={() => setJobType("exchange")}
                className={`rounded-[20px] py-3 text-sm font-medium transition-all active:scale-95 ${jobType === "exchange" ? "bg-[var(--t-accent-soft)] text-[var(--t-accent)] border border-[var(--t-accent)]" : "bg-[var(--t-bg-card)] text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] border border-[var(--t-border)]"}`}>
                Exchange
              </button>
            </div>
            {jobType === "exchange" && (
              <p className="mt-2 text-[13px] text-[var(--t-text-muted)] rounded-[20px] bg-[var(--t-bg-card)] px-3 py-2 border border-[var(--t-border)]">
                Exchange = Pickup existing dumpster + Deliver new one. Priced same as delivery.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Service</label>
              <select value={serviceType} onChange={e => setServiceType(e.target.value)} className={`${inputCls} appearance-none`}>
                <option value="dumpster_rental">Dumpster Rental</option>
                <option value="pod_storage">Pod Storage</option>
                <option value="restroom_service">Restroom Service</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Size</label>
              <div className={`grid gap-1`} style={{ gridTemplateColumns: `repeat(${Math.min(activeSizes.length || 3, 5)}, 1fr)` }}>
                {activeSizes.map(s => (
                  <button key={s} onClick={() => setAssetSubtype(s)}
                    className={`rounded-[20px] py-3 text-xs font-bold transition-all active:scale-95 ${assetSubtype === s ? "bg-[#22C55E] text-black" : "bg-[var(--t-bg-card)] text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] border border-[var(--t-border)]"}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <AddressAutocomplete value={address} onChange={setAddress} label="Delivery Address" placeholder="Customer address or zip code..." />

          {quoting && (
            <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6 text-center">
              <div className="h-6 w-6 mx-auto animate-spin rounded-full border-2 border-[var(--t-accent)] border-t-transparent mb-2" />
              <p className="text-[13px] text-[var(--t-text-muted)]">Calculating price...</p>
            </div>
          )}

          {quote && !quoting && (
            <div className="rounded-[20px] border border-[var(--t-accent)] bg-[var(--t-accent-soft)] p-6">
              <div className="text-center mb-4">
                <p className="text-4xl font-bold text-[var(--t-accent)] tabular-nums">{fmtMoney(quote.breakdown.total)}</p>
                <p className="text-sm text-[var(--t-text-muted)] mt-1">{rentalDays}-day rental, delivery included</p>
              </div>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-[var(--t-text-muted)]">Base price</span><span className="text-[var(--t-text-primary)] tabular-nums">{fmtMoney(quote.breakdown.basePrice)}</span></div>
                {(quote.breakdown.deliveryFee > 0 || quote.breakdown.jobFee > 0) && (
                  <div className="flex justify-between"><span className="text-[var(--t-text-muted)]">Delivery fee</span><span className="text-[var(--t-text-primary)] tabular-nums">{fmtMoney(quote.breakdown.deliveryFee || quote.breakdown.jobFee)}</span></div>
                )}
                {quote.breakdown.distanceSurcharge > 0 && (
                  <div className="flex justify-between">
                    <span className="text-[var(--t-text-muted)]">Distance charge{quote.breakdown.distanceMiles != null ? ` (${quote.breakdown.distanceMiles} mi)` : ""}</span>
                    <span className="text-[var(--t-text-primary)] tabular-nums">{fmtMoney(quote.breakdown.distanceSurcharge)}</span>
                  </div>
                )}
                {quote.breakdown.distanceSurcharge === 0 && quote.breakdown.distanceMiles != null && (
                  <div className="flex justify-between"><span className="text-[var(--t-text-muted)]">Delivery distance</span><span className="text-[var(--t-accent)] tabular-nums">{quote.breakdown.distanceMiles} mi (Free — within 15 mi)</span></div>
                )}
                {quote.breakdown.extraDayCharges > 0 && (
                  <div className="flex justify-between"><span className="text-[var(--t-warning)]">Extra days (+{rentalDays - quote.breakdown.includedDays})</span><span className="text-[var(--t-warning)] tabular-nums">+{fmtMoney(quote.breakdown.extraDayCharges)}</span></div>
                )}
                <div className="flex justify-between"><span className="text-[var(--t-text-muted)]">Includes</span><span className="text-[var(--t-text-primary)] tabular-nums">{quote.breakdown.includedTons ?? 0} tons · {quote.breakdown.includedDays} day rental</span></div>
                {(quote.breakdown.overagePerTon ?? 0) > 0 && (
                  <div className="flex justify-between"><span className="text-[var(--t-text-muted)]">Overage</span><span className="text-[var(--t-text-primary)] tabular-nums">{fmtMoney(quote.breakdown.overagePerTon!)}/ton after {quote.breakdown.includedTons} tons</span></div>
                )}
                {(quote.breakdown.extraDayRate ?? 0) > 0 && (
                  <div className="flex justify-between"><span className="text-[var(--t-text-muted)]">Extra days</span><span className="text-[var(--t-text-primary)] tabular-nums">{fmtMoney(quote.breakdown.extraDayRate)}/day after {quote.breakdown.includedDays} days</span></div>
                )}
                {address.street && (
                  <div className="flex justify-between"><span className="text-[var(--t-text-muted)]">Delivery to</span><span className="text-[var(--t-text-primary)] truncate ml-4">{address.street}, {address.city}</span></div>
                )}
                {quote.breakdown.tax > 0 && (
                  <div className="flex justify-between"><span className="text-[var(--t-text-muted)]">Tax</span><span className="text-[var(--t-text-primary)] tabular-nums">{fmtMoney(quote.breakdown.tax)}</span></div>
                )}
                <div className="border-t border-[var(--t-accent)] pt-2 flex justify-between font-semibold">
                  <span className="text-[var(--t-accent)]">Total</span><span className="text-[var(--t-accent)] tabular-nums">{fmtMoney(quote.breakdown.total)}</span>
                </div>
                {quote.breakdown.requireDeposit && (
                  <div className="flex justify-between text-[13px]"><span className="text-[var(--t-text-muted)]">Deposit required</span><span className="text-[var(--t-text-primary)] tabular-nums">{fmtMoney(quote.breakdown.depositAmount)}</span></div>
                )}
              </div>
              <div className="mt-4">
                <label className={labelCls}>Rental Days</label>
                <input type="number" min={1} max={90} value={rentalDays} onChange={e => setRentalDays(Number(e.target.value) || 1)} className={inputCls} />
              </div>
            </div>
          )}

          {availability && (
            <div className={`rounded-[20px] px-4 py-3 text-sm flex items-center gap-2 border ${
              availability.availableOnDate > 0 ? "bg-[var(--t-accent-soft)] border-[var(--t-accent)] text-[var(--t-accent)]"
              : availability.pickupsBeforeDate > 0 ? "bg-[var(--t-warning-soft)] border-[var(--t-warning)] text-[var(--t-warning)]"
              : "bg-[var(--t-error-soft)] border-[var(--t-error)] text-[var(--t-error)]"
            }`}>
              {availability.availableOnDate > 0 ? (
                <><CheckCircle2 className="h-4 w-4 shrink-0" /> {availability.availableOnDate} available for {deliveryDate}</>
              ) : availability.pickupsBeforeDate > 0 ? (
                <><AlertTriangle className="h-4 w-4 shrink-0" /> 0 available now -- {availability.pickupsBeforeDate} pickup{availability.pickupsBeforeDate > 1 ? "s" : ""} scheduled before then</>
              ) : (
                <><AlertTriangle className="h-4 w-4 shrink-0" /> None available and no pickups scheduled</>
              )}
            </div>
          )}

          <button onClick={() => setStep(2)} disabled={!quote}
            className="w-full rounded-full bg-[#22C55E] py-3.5 text-sm font-bold text-black transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-40">
            Customer wants to book
          </button>
        </div>
      )}

      {/* ===== STEP 2: Customer ===== */}
      {step === 2 && (
        <div className="space-y-5">
          <div className="relative">
            <label className={labelCls}>Phone Number</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--t-text-muted)]" />
              <input value={customerId ? phone : phoneSearch}
                onChange={e => { setPhoneSearch(e.target.value); setPhone(e.target.value); setCustomerId(null); }}
                className={`${inputCls} pl-10`} placeholder="Search by phone or name..." autoFocus />
            </div>
            {customerResults.length > 0 && !customerId && (
              <div className="absolute z-20 mt-1 w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] shadow-xl overflow-hidden">
                {customerResults.map(c => (
                  <button key={c.id} onClick={() => selectCustomer(c)}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-sm hover:bg-[var(--t-bg-card-hover)] transition-colors">
                    <span className="font-medium text-[var(--t-text-primary)]">{c.first_name} {c.last_name}</span>
                    <span className="text-[13px] text-[var(--t-text-muted)]">{c.phone ? <a href={`tel:${c.phone}`} className="hover:text-[var(--t-accent)]" onClick={(e) => e.stopPropagation()}>{c.phone}</a> : c.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {customerId && (
            <div className="rounded-[20px] bg-[var(--t-accent-soft)] border border-[var(--t-accent)] px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-[var(--t-accent)] font-medium">Existing customer: {firstName} {lastName}</span>
              <button onClick={() => { setCustomerId(null); setFirstName(""); setLastName(""); }} className="text-[13px] text-[var(--t-text-muted)] hover:text-[var(--t-error)]">Clear</button>
            </div>
          )}

          {!customerId && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls}>First Name</label><input value={firstName} onChange={e => setFirstName(e.target.value)} className={inputCls} required /></div>
                <div><label className={labelCls}>Last Name</label><input value={lastName} onChange={e => setLastName(e.target.value)} className={inputCls} required /></div>
              </div>
              <div><label className={labelCls}>Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="Optional" /></div>
              <div>
                <label className={labelCls}>Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {(["residential", "commercial"] as const).map(t => (
                    <button key={t} onClick={() => setCustType(t)} className={`rounded-[20px] py-2.5 text-xs font-medium capitalize transition-all ${custType === t ? "bg-[#22C55E] text-black" : "bg-[var(--t-bg-card)] text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] border border-[var(--t-border)]"}`}>{t}</button>
                  ))}
                </div>
              </div>
              {custType === "commercial" && (
                <div><label className={labelCls}>Company Name</label><input value={companyName} onChange={e => setCompanyName(e.target.value)} className={inputCls} /></div>
              )}
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={sameAddress} onChange={e => setSameAddress(e.target.checked)} className="h-4 w-4 rounded accent-[#22C55E]" />
                <span className="text-[13px] text-[var(--t-text-muted)]">Billing address same as delivery</span>
              </div>
              {!sameAddress && <AddressAutocomplete value={billingAddress} onChange={setBillingAddress} label="Billing Address" />}
            </>
          )}

          <button onClick={() => setStep(3)} disabled={!firstName || !lastName}
            className="w-full rounded-full bg-[#22C55E] py-3.5 text-sm font-bold text-black transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-40">
            Continue to scheduling
          </button>
        </div>
      )}

      {/* ===== STEP 3: Schedule ===== */}
      {step === 3 && (
        <div className="space-y-5">
          <div><label className={labelCls}>Delivery Date</label><input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} className={inputCls} /></div>

          <div>
            <label className={labelCls}>Time Window</label>
            <div className="grid grid-cols-3 gap-2">
              {([["morning", "Morning", "8 AM - 12 PM"], ["afternoon", "Afternoon", "12 - 5 PM"], ["fullday", "Full Day", "8 AM - 5 PM"]] as const).map(([k, label, sub]) => (
                <button key={k} onClick={() => setTimeWindow(k)}
                  className={`rounded-[20px] p-4 text-center transition-all active:scale-95 ${timeWindow === k ? "bg-[var(--t-accent-soft)] border border-[var(--t-accent)]" : "bg-[var(--t-bg-card)] border border-[var(--t-border)]"}`}>
                  <p className={`text-sm font-semibold ${timeWindow === k ? "text-[var(--t-accent)]" : "text-[var(--t-text-primary)]"}`}>{label}</p>
                  <p className="text-[11px] text-[var(--t-text-muted)] mt-0.5">{sub}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>Delivery Instructions</label>
            <textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={2} className={`${inputCls} resize-none`} placeholder="Place in driveway, call before delivery..." />
          </div>

          <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] text-[var(--t-text-muted)]">Pickup Date</p>
                <p className="text-sm font-medium text-[var(--t-text-primary)]">{fmtDate(pickupDate)}</p>
                <p className="text-[11px] text-[var(--t-text-muted)]">{rentalDays}-day rental</p>
              </div>
              <input type="date" value={pickupDate} onChange={e => {
                setPickupDate(e.target.value);
                const days = Math.round((new Date(e.target.value).getTime() - new Date(deliveryDate).getTime()) / 86400000);
                if (days > 0) setRentalDays(days);
              }} className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card-hover)] px-3 py-1.5 text-xs text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)]" />
            </div>
          </div>

          <button onClick={() => setStep(4)}
            className="w-full rounded-full bg-[#22C55E] py-3.5 text-sm font-bold text-black transition-all hover:opacity-90 active:scale-[0.98]">
            Continue to payment
          </button>
        </div>
      )}

      {/* ===== STEP 4: Confirm ===== */}
      {step === 4 && quote && (
        <div className="space-y-5">
          {error && <div className="rounded-[20px] bg-[var(--t-error-soft)] px-4 py-3 text-sm text-[var(--t-error)]">{error}</div>}

          <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5 space-y-3">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)]">Order Summary</h3>
            <div className="flex justify-between text-sm"><span className="text-[var(--t-text-muted)]">Service</span><span className="text-[var(--t-text-primary)]">{assetSubtype} {serviceType.replace(/_/g, " ")}</span></div>
            <div className="flex justify-between text-sm"><span className="text-[var(--t-text-muted)]">Customer</span><span className="text-[var(--t-text-primary)]">{firstName} {lastName}</span></div>
            <div className="flex justify-between text-sm"><span className="text-[var(--t-text-muted)]">Delivery</span><span className="text-[var(--t-text-primary)]">{fmtDate(deliveryDate)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-[var(--t-text-muted)]">Pickup</span><span className="text-[var(--t-text-primary)]">{fmtDate(pickupDate)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-[var(--t-text-muted)]">Rental</span><span className="text-[var(--t-text-primary)]">{rentalDays} days</span></div>
            {address.street && <div className="flex justify-between text-sm"><span className="text-[var(--t-text-muted)]">Address</span><span className="text-[var(--t-text-primary)] truncate ml-4">{address.street}, {address.city}</span></div>}
            <div className="border-t border-[var(--t-border)] pt-3 flex justify-between font-semibold text-lg">
              <span className="text-[var(--t-accent)]">Total</span><span className="text-[var(--t-accent)] tabular-nums">{fmtMoney(quote.breakdown.total)}</span>
            </div>
          </div>

          <div>
            <label className={labelCls}>Payment</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setPaymentMethod("invoice")}
                className={`rounded-[20px] p-4 text-center transition-all ${paymentMethod === "invoice" ? "bg-[var(--t-accent-soft)] border border-[var(--t-accent)]" : "bg-[var(--t-bg-card)] border border-[var(--t-border)]"}`}>
                <Package className={`mx-auto h-5 w-5 mb-1 ${paymentMethod === "invoice" ? "text-[var(--t-accent)]" : "text-[var(--t-text-muted)]"}`} />
                <p className={`text-sm font-medium ${paymentMethod === "invoice" ? "text-[var(--t-accent)]" : "text-[var(--t-text-primary)]"}`}>Send Invoice</p>
                <p className="text-[11px] text-[var(--t-text-muted)]">Email invoice to customer</p>
              </button>
              <button onClick={() => setPaymentMethod("card")}
                className={`rounded-[20px] p-4 text-center transition-all ${paymentMethod === "card" ? "bg-[var(--t-accent-soft)] border border-[var(--t-accent)]" : "bg-[var(--t-bg-card)] border border-[var(--t-border)]"}`}>
                <CreditCard className={`mx-auto h-5 w-5 mb-1 ${paymentMethod === "card" ? "text-[var(--t-accent)]" : "text-[var(--t-text-muted)]"}`} />
                <p className={`text-sm font-medium ${paymentMethod === "card" ? "text-[var(--t-accent)]" : "text-[var(--t-text-primary)]"}`}>Charge Card</p>
                <p className="text-[11px] text-[var(--t-text-muted)]">Collect payment now</p>
              </button>
            </div>
          </div>

          {paymentMethod === "card" && (
            <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4 text-center text-[13px] text-[var(--t-text-muted)]">
              <CreditCard className="mx-auto h-6 w-6 text-[var(--t-text-muted)] opacity-30 mb-2" />
              Stripe card form will be integrated here
            </div>
          )}

          {quote.breakdown.requireDeposit && (
            <div className="rounded-[20px] bg-[var(--t-warning-soft)] border border-[var(--t-warning)] p-3 text-[13px] text-[var(--t-warning)]">
              Deposit due now: {fmtMoney(quote.breakdown.depositAmount)}. Remaining {fmtMoney(quote.breakdown.total - quote.breakdown.depositAmount)} due on pickup.
            </div>
          )}

          <button onClick={handleSubmit} disabled={submitting}
            className="w-full rounded-full bg-[#22C55E] py-4 text-sm font-bold text-black transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50">
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-black border-t-transparent" />
                Processing...
              </span>
            ) : (
              `Complete Booking -- ${fmtMoney(quote.breakdown.total)}`
            )}
          </button>
        </div>
      )}

      {/* ===== STEP 5: Success ===== */}
      {step === 5 && result && (
        <div className="text-center py-8">
          <CheckCircle2 className="mx-auto h-16 w-16 text-[var(--t-accent)] mb-4" />
          <h2 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)]">Booking Confirmed!</h2>
          <p className="text-[var(--t-text-muted)] mt-2">Job #{result.deliveryJob.jobNumber} created</p>

          <div className="mt-6 rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5 text-left max-w-sm mx-auto space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-[var(--t-text-muted)]">Delivery Job</span><span className="text-[var(--t-text-primary)] font-medium">{result.deliveryJob.jobNumber}</span></div>
            <div className="flex justify-between"><span className="text-[var(--t-text-muted)]">Pickup Job</span><span className="text-[var(--t-text-primary)] font-medium">{result.pickupJob.jobNumber}</span></div>
            <div className="flex justify-between"><span className="text-[var(--t-text-muted)]">Invoice</span><span className="text-[var(--t-text-primary)] font-medium">{result.invoice.invoiceNumber}</span></div>
            <div className="flex justify-between"><span className="text-[var(--t-text-muted)]">Status</span><span className={`font-medium ${result.autoApproved ? "text-[var(--t-accent)]" : "text-[var(--t-warning)]"}`}>{result.autoApproved ? "Auto-Confirmed" : "Pending Approval"}</span></div>
            {result.asset && <div className="flex justify-between"><span className="text-[var(--t-text-muted)]">Asset</span><span className="text-[var(--t-text-primary)] font-medium">{result.asset.identifier}</span></div>}
            <div className="flex justify-between"><span className="text-[var(--t-text-muted)]">Payment</span><span className="text-[var(--t-text-primary)] font-medium capitalize">{paymentMethod === "card" ? "Paid" : "Invoice sent"}</span></div>
          </div>

          <div className="mt-8 flex flex-col gap-2 max-w-sm mx-auto">
            <button onClick={() => { setStep(1); setResult(null); setQuote(null); setCustomerId(null); setFirstName(""); setLastName(""); setAddress({ street: "", city: "", state: "", zip: "", lat: null, lng: null }); }}
              className="rounded-full bg-[#22C55E] py-3 text-sm font-bold text-black hover:opacity-90 transition-all active:scale-[0.98]">
              Create Another Booking
            </button>
            <Link href={`/jobs/${result.deliveryJob.id}`}
              className="rounded-full border border-[var(--t-border)] bg-[var(--t-bg-card)] py-3 text-sm font-medium text-[var(--t-text-primary)] text-center hover:bg-[var(--t-bg-card-hover)] transition-colors">
              View Job
            </Link>
            <Link href="/"
              className="rounded-full py-3 text-sm text-[var(--t-text-muted)] text-center hover:text-[var(--t-text-primary)] transition-colors">
              Back to Dashboard
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
