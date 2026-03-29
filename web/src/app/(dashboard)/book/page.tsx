"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DollarSign,
  User,
  Calendar,
  CreditCard,
  CheckCircle2,
  ArrowLeft,
  Phone,
  Truck,
  Package,
} from "lucide-react";
import { api } from "@/lib/api";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";

/* ---- Types ---- */

interface PriceQuote {
  rule?: { name: string };
  breakdown: {
    basePrice: number;
    total: number;
    tax: number;
    taxRate: number;
    deliveryFee: number;
    pickupFee: number;
    extraDayRate: number;
    extraDayCharges: number;
    includedDays: number;
    rentalDays: number;
    distanceSurcharge: number;
    requireDeposit: boolean;
    depositAmount: number;
    jobFee: number;
  };
}

interface CustomerMatch {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  company_name: string;
  billing_address: Record<string, string> | null;
}

interface BookingResult {
  success: boolean;
  deliveryJob: { id: string; jobNumber: string };
  pickupJob: { id: string; jobNumber: string };
  invoice: { id: string; invoiceNumber: string };
  customerId: string;
}

/* ---- Helpers ---- */

function nextBusinessDay() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

function addDays(date: string, days: number) {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" });
}

function fmtMoney(n: number) {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ---- Steps ---- */

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

  // Step 1: Quote
  const [serviceType, setServiceType] = useState("dumpster_rental");
  const [assetSubtype, setAssetSubtype] = useState("20yd");
  const [address, setAddress] = useState<AddressValue>({ street: "", city: "", state: "", zip: "", lat: null, lng: null });
  const [rentalDays, setRentalDays] = useState(14);
  const [quote, setQuote] = useState<PriceQuote | null>(null);
  const [quoting, setQuoting] = useState(false);

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

  // Auto-quote when address changes
  useEffect(() => {
    if (!address.lat || !address.lng) return;
    setQuoting(true);
    api.post<PriceQuote>("/pricing/calculate", {
      serviceType, assetSubtype, jobType: "delivery",
      customerLat: address.lat, customerLng: address.lng,
      yardLat: 30.35, yardLng: -97.7,
      rentalDays,
    }).then((q) => {
      setQuote(q);
      if (q.breakdown.includedDays) setRentalDays(q.breakdown.includedDays);
    }).catch(() => setQuote(null))
    .finally(() => setQuoting(false));
  }, [address.lat, address.lng, serviceType, assetSubtype]);

  // Recalc when rental days change
  useEffect(() => {
    if (!address.lat || !quote) return;
    api.post<PriceQuote>("/pricing/calculate", {
      serviceType, assetSubtype, jobType: "delivery",
      customerLat: address.lat, customerLng: address.lng,
      yardLat: 30.35, yardLng: -97.7,
      rentalDays,
    }).then(setQuote).catch(() => {});
  }, [rentalDays]);

  // Update pickup date when delivery date or rental days change
  useEffect(() => {
    setPickupDate(addDays(deliveryDate, rentalDays));
  }, [deliveryDate, rentalDays]);

  // Customer phone search
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!phoneSearch || phoneSearch.length < 3) { setCustomerResults([]); return; }
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await api.get<{ data: CustomerMatch[] }>(`/customers?search=${encodeURIComponent(phoneSearch)}&limit=5`);
        setCustomerResults(res.data);
      } catch { /* */ }
    }, 250);
  }, [phoneSearch]);

  const selectCustomer = (c: CustomerMatch) => {
    setCustomerId(c.id);
    setFirstName(c.first_name);
    setLastName(c.last_name);
    setEmail(c.email || "");
    setPhone(c.phone || "");
    setPhoneSearch("");
    setCustomerResults([]);
    if (c.company_name) {
      setCustType("commercial");
      setCompanyName(c.company_name);
    }
  };

  const handleSubmit = async () => {
    if (!quote) return;
    setError("");
    setSubmitting(true);
    const windows: Record<string, [string, string]> = {
      morning: ["08:00", "12:00"],
      afternoon: ["12:00", "17:00"],
      fullday: ["08:00", "17:00"],
    };
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
        taxAmount: quote.breakdown.tax,
        totalPrice: quote.breakdown.total,
        depositAmount: quote.breakdown.requireDeposit ? quote.breakdown.depositAmount : 0,
        paymentMethod,
      });
      setResult(res);
      setStep(5);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Booking failed");
    } finally {
      setSubmitting(false);
    }
  };

  // Keyboard shortcut: Escape goes back
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && step > 1 && step < 5) setStep(s => s - 1);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [step]);

  const inputCls = "w-full bg-[#111C2E] border border-[#1E2D45] rounded-lg px-4 py-3 text-sm text-white placeholder-muted outline-none focus:border-brand focus:ring-1 focus:ring-brand transition-colors";
  const labelCls = "block text-xs font-medium text-muted uppercase tracking-wider mb-1.5";

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          {step < 5 && step > 1 && (
            <button onClick={() => setStep(s => s - 1)} className="rounded-lg bg-dark-card border border-[#1E2D45] p-2 text-muted hover:text-white transition-colors active:scale-95">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div>
            <h1 className="font-display text-xl font-bold text-white">
              {step === 5 ? "Booking Confirmed!" : "New Booking"}
            </h1>
            {step < 5 && <p className="text-xs text-muted mt-0.5">Step {step} of 4</p>}
          </div>
        </div>
        {step < 5 && (
          <Link href="/" className="text-xs text-muted hover:text-white transition-colors">Cancel</Link>
        )}
      </div>

      {/* Progress bar */}
      {step < 5 && (
        <div className="flex items-center gap-1 mb-8">
          {STEPS.map((s) => (
            <div key={s.num} className="flex-1 flex items-center gap-2">
              <div className={`h-1.5 flex-1 rounded-full transition-colors ${step >= s.num ? "bg-brand" : "bg-dark-elevated"}`} />
            </div>
          ))}
        </div>
      )}

      {/* ==================== STEP 1: Quote ==================== */}
      {step === 1 && (
        <div className="space-y-5">
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
              <div className="grid grid-cols-5 gap-1">
                {["10yd", "15yd", "20yd", "30yd", "40yd"].map(s => (
                  <button key={s} onClick={() => setAssetSubtype(s)}
                    className={`rounded-lg py-3 text-xs font-bold transition-all active:scale-95 ${assetSubtype === s ? "bg-brand text-dark-primary" : "bg-dark-elevated text-muted hover:text-white"}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <AddressAutocomplete value={address} onChange={setAddress} label="Delivery Address" placeholder="Customer address or zip code..." />

          {quoting && (
            <div className="rounded-xl bg-dark-card border border-[#1E2D45] p-6 text-center">
              <div className="h-6 w-6 mx-auto animate-spin rounded-full border-2 border-brand border-t-transparent mb-2" />
              <p className="text-xs text-muted">Calculating price...</p>
            </div>
          )}

          {quote && !quoting && (
            <div className="rounded-xl bg-brand/5 border border-brand/20 p-6">
              <div className="text-center mb-4">
                <p className="font-display text-4xl font-bold text-brand tabular-nums">{fmtMoney(quote.breakdown.total)}</p>
                <p className="text-sm text-muted mt-1">
                  {rentalDays}-day rental, delivery included
                </p>
              </div>

              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-muted">Base price</span><span className="text-white tabular-nums">{fmtMoney(quote.breakdown.basePrice)}</span></div>
                {(quote.breakdown.deliveryFee > 0 || quote.breakdown.jobFee > 0) && (
                  <div className="flex justify-between"><span className="text-muted">Delivery fee</span><span className="text-white tabular-nums">{fmtMoney(quote.breakdown.deliveryFee || quote.breakdown.jobFee)}</span></div>
                )}
                {quote.breakdown.distanceSurcharge > 0 && (
                  <div className="flex justify-between"><span className="text-muted">Distance surcharge</span><span className="text-white tabular-nums">{fmtMoney(quote.breakdown.distanceSurcharge)}</span></div>
                )}
                {quote.breakdown.extraDayCharges > 0 && (
                  <div className="flex justify-between"><span className="text-yellow-400">Extra days (+{rentalDays - quote.breakdown.includedDays})</span><span className="text-yellow-400 tabular-nums">+{fmtMoney(quote.breakdown.extraDayCharges)}</span></div>
                )}
                {quote.breakdown.tax > 0 && (
                  <div className="flex justify-between"><span className="text-muted">Tax</span><span className="text-white tabular-nums">{fmtMoney(quote.breakdown.tax)}</span></div>
                )}
                <div className="border-t border-brand/20 pt-2 flex justify-between font-semibold">
                  <span className="text-brand">Total</span><span className="text-brand tabular-nums">{fmtMoney(quote.breakdown.total)}</span>
                </div>
                {quote.breakdown.requireDeposit && (
                  <div className="flex justify-between text-xs"><span className="text-muted">Deposit required</span><span className="text-white tabular-nums">{fmtMoney(quote.breakdown.depositAmount)}</span></div>
                )}
              </div>

              <div className="mt-4">
                <label className={labelCls}>Rental Days</label>
                <input type="number" min={1} max={90} value={rentalDays} onChange={e => setRentalDays(Number(e.target.value) || 1)} className={inputCls} />
              </div>
            </div>
          )}

          <button onClick={() => setStep(2)} disabled={!quote}
            className="w-full rounded-xl bg-brand py-3.5 text-sm font-bold text-dark-primary transition-all hover:bg-brand-light active:scale-[0.98] disabled:opacity-40">
            Customer wants to book →
          </button>
        </div>
      )}

      {/* ==================== STEP 2: Customer ==================== */}
      {step === 2 && (
        <div className="space-y-5">
          {/* Phone search */}
          <div className="relative">
            <label className={labelCls}>Phone Number</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input value={customerId ? phone : phoneSearch}
                onChange={e => { setPhoneSearch(e.target.value); setPhone(e.target.value); setCustomerId(null); }}
                className={`${inputCls} pl-10`} placeholder="Search by phone or name..." autoFocus />
            </div>
            {customerResults.length > 0 && !customerId && (
              <div className="absolute z-20 mt-1 w-full rounded-lg border border-[#1E2D45] bg-dark-secondary shadow-xl overflow-hidden">
                {customerResults.map(c => (
                  <button key={c.id} onClick={() => selectCustomer(c)}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-sm hover:bg-dark-card-hover transition-colors">
                    <span className="font-medium text-white">{c.first_name} {c.last_name}</span>
                    <span className="text-xs text-muted">{c.phone || c.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {customerId && (
            <div className="rounded-lg bg-brand/5 border border-brand/20 px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-brand font-medium">Existing customer: {firstName} {lastName}</span>
              <button onClick={() => { setCustomerId(null); setFirstName(""); setLastName(""); }} className="text-xs text-muted hover:text-red-400">Clear</button>
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
                    <button key={t} onClick={() => setCustType(t)} className={`rounded-lg py-2.5 text-xs font-medium capitalize transition-all ${custType === t ? "bg-brand text-dark-primary" : "bg-dark-elevated text-muted hover:text-white"}`}>{t}</button>
                  ))}
                </div>
              </div>
              {custType === "commercial" && (
                <div><label className={labelCls}>Company Name</label><input value={companyName} onChange={e => setCompanyName(e.target.value)} className={inputCls} /></div>
              )}
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={sameAddress} onChange={e => setSameAddress(e.target.checked)} className="h-4 w-4 rounded accent-brand" />
                <span className="text-xs text-muted">Billing address same as delivery</span>
              </div>
              {!sameAddress && <AddressAutocomplete value={billingAddress} onChange={setBillingAddress} label="Billing Address" />}
            </>
          )}

          <button onClick={() => setStep(3)} disabled={!firstName || !lastName}
            className="w-full rounded-xl bg-brand py-3.5 text-sm font-bold text-dark-primary transition-all hover:bg-brand-light active:scale-[0.98] disabled:opacity-40">
            Continue to scheduling →
          </button>
        </div>
      )}

      {/* ==================== STEP 3: Schedule ==================== */}
      {step === 3 && (
        <div className="space-y-5">
          <div>
            <label className={labelCls}>Delivery Date</label>
            <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>Time Window</label>
            <div className="grid grid-cols-3 gap-2">
              {([["morning", "Morning", "8 AM – 12 PM"], ["afternoon", "Afternoon", "12 – 5 PM"], ["fullday", "Full Day", "8 AM – 5 PM"]] as const).map(([k, label, sub]) => (
                <button key={k} onClick={() => setTimeWindow(k)}
                  className={`rounded-xl p-4 text-center transition-all active:scale-95 ${timeWindow === k ? "bg-brand/10 border border-brand/30 ring-1 ring-brand/20" : "bg-dark-card border border-[#1E2D45] hover:border-[#2a3d5a]"}`}>
                  <p className={`text-sm font-semibold ${timeWindow === k ? "text-brand" : "text-white"}`}>{label}</p>
                  <p className="text-[10px] text-muted mt-0.5">{sub}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>Delivery Instructions</label>
            <textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={2} className={`${inputCls} resize-none`} placeholder="Place in driveway, call before delivery..." />
          </div>

          <div className="rounded-lg bg-dark-card border border-[#1E2D45] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted">Pickup Date</p>
                <p className="text-sm font-medium text-white">{fmtDate(pickupDate)}</p>
                <p className="text-[10px] text-muted">{rentalDays}-day rental</p>
              </div>
              <input type="date" value={pickupDate} onChange={e => {
                setPickupDate(e.target.value);
                const days = Math.round((new Date(e.target.value).getTime() - new Date(deliveryDate).getTime()) / 86400000);
                if (days > 0) setRentalDays(days);
              }} className="rounded-lg bg-dark-elevated border border-[#1E2D45] px-3 py-1.5 text-xs text-white outline-none focus:border-brand" />
            </div>
          </div>

          <button onClick={() => setStep(4)}
            className="w-full rounded-xl bg-brand py-3.5 text-sm font-bold text-dark-primary transition-all hover:bg-brand-light active:scale-[0.98]">
            Continue to payment →
          </button>
        </div>
      )}

      {/* ==================== STEP 4: Confirm ==================== */}
      {step === 4 && quote && (
        <div className="space-y-5">
          {error && <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}

          {/* Summary */}
          <div className="rounded-xl bg-dark-card border border-[#1E2D45] p-5 space-y-3">
            <h3 className="text-xs text-muted uppercase tracking-wider">Order Summary</h3>
            <div className="flex justify-between text-sm"><span className="text-muted">Service</span><span className="text-white">{assetSubtype} {serviceType.replace(/_/g, " ")}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted">Customer</span><span className="text-white">{firstName} {lastName}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted">Delivery</span><span className="text-white">{fmtDate(deliveryDate)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted">Pickup</span><span className="text-white">{fmtDate(pickupDate)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted">Rental</span><span className="text-white">{rentalDays} days</span></div>
            {address.street && <div className="flex justify-between text-sm"><span className="text-muted">Address</span><span className="text-white truncate ml-4">{address.street}, {address.city}</span></div>}
            <div className="border-t border-[#1E2D45] pt-3 flex justify-between font-semibold text-lg">
              <span className="text-brand">Total</span><span className="text-brand tabular-nums">{fmtMoney(quote.breakdown.total)}</span>
            </div>
          </div>

          {/* Payment method */}
          <div>
            <label className={labelCls}>Payment</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setPaymentMethod("invoice")}
                className={`rounded-xl p-4 text-center transition-all ${paymentMethod === "invoice" ? "bg-brand/10 border border-brand/30" : "bg-dark-card border border-[#1E2D45]"}`}>
                <Package className={`mx-auto h-5 w-5 mb-1 ${paymentMethod === "invoice" ? "text-brand" : "text-muted"}`} />
                <p className={`text-sm font-medium ${paymentMethod === "invoice" ? "text-brand" : "text-white"}`}>Send Invoice</p>
                <p className="text-[10px] text-muted">Email invoice to customer</p>
              </button>
              <button onClick={() => setPaymentMethod("card")}
                className={`rounded-xl p-4 text-center transition-all ${paymentMethod === "card" ? "bg-brand/10 border border-brand/30" : "bg-dark-card border border-[#1E2D45]"}`}>
                <CreditCard className={`mx-auto h-5 w-5 mb-1 ${paymentMethod === "card" ? "text-brand" : "text-muted"}`} />
                <p className={`text-sm font-medium ${paymentMethod === "card" ? "text-brand" : "text-white"}`}>Charge Card</p>
                <p className="text-[10px] text-muted">Collect payment now</p>
              </button>
            </div>
          </div>

          {paymentMethod === "card" && (
            <div className="rounded-lg bg-dark-card border border-[#1E2D45] p-4 text-center text-xs text-muted">
              <CreditCard className="mx-auto h-6 w-6 text-muted/30 mb-2" />
              Stripe card form will be integrated here
            </div>
          )}

          {quote.breakdown.requireDeposit && (
            <div className="rounded-lg bg-yellow-500/5 border border-yellow-500/20 p-3 text-xs text-yellow-400">
              Deposit due now: {fmtMoney(quote.breakdown.depositAmount)}. Remaining {fmtMoney(quote.breakdown.total - quote.breakdown.depositAmount)} due on pickup.
            </div>
          )}

          <button onClick={handleSubmit} disabled={submitting}
            className="w-full rounded-xl bg-brand py-4 text-sm font-bold text-dark-primary transition-all hover:bg-brand-light active:scale-[0.98] disabled:opacity-50 shadow-lg shadow-brand/20">
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-dark-primary border-t-transparent" />
                Processing...
              </span>
            ) : (
              `Complete Booking — ${fmtMoney(quote.breakdown.total)}`
            )}
          </button>
        </div>
      )}

      {/* ==================== STEP 5: Success ==================== */}
      {step === 5 && result && (
        <div className="text-center py-8">
          <CheckCircle2 className="mx-auto h-16 w-16 text-brand mb-4" />
          <h2 className="font-display text-2xl font-bold text-white">Booking Confirmed!</h2>
          <p className="text-muted mt-2">
            Job #{result.deliveryJob.jobNumber} created
          </p>

          <div className="mt-6 rounded-xl bg-dark-card border border-[#1E2D45] p-5 text-left max-w-sm mx-auto space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted">Delivery Job</span><span className="text-white font-medium">{result.deliveryJob.jobNumber}</span></div>
            <div className="flex justify-between"><span className="text-muted">Pickup Job</span><span className="text-white font-medium">{result.pickupJob.jobNumber}</span></div>
            <div className="flex justify-between"><span className="text-muted">Invoice</span><span className="text-white font-medium">{result.invoice.invoiceNumber}</span></div>
            <div className="flex justify-between"><span className="text-muted">Payment</span><span className="text-white font-medium capitalize">{paymentMethod === "card" ? "Paid" : "Invoice sent"}</span></div>
          </div>

          <div className="mt-8 flex flex-col gap-2 max-w-sm mx-auto">
            <button onClick={() => { setStep(1); setResult(null); setQuote(null); setCustomerId(null); setFirstName(""); setLastName(""); setAddress({ street: "", city: "", state: "", zip: "", lat: null, lng: null }); }}
              className="rounded-xl bg-brand py-3 text-sm font-bold text-dark-primary hover:bg-brand-light transition-all active:scale-[0.98]">
              Create Another Booking
            </button>
            <Link href={`/jobs/${result.deliveryJob.id}`}
              className="rounded-xl bg-dark-card border border-[#1E2D45] py-3 text-sm font-medium text-white text-center hover:bg-dark-card-hover transition-colors">
              View Job
            </Link>
            <Link href="/"
              className="rounded-xl py-3 text-sm text-muted text-center hover:text-white transition-colors">
              Back to Dashboard
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
