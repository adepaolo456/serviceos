"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { portalApi } from "@/lib/portal-api";
import { formatCurrency } from "@/lib/utils";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";
import { Package, CheckCircle2 } from "lucide-react";

const sizes = [
  { value: "10yd", label: "10 YD", desc: "Small cleanouts", price: 350 },
  { value: "15yd", label: "15 YD", desc: "Garage / basement", price: 425 },
  { value: "20yd", label: "20 YD", desc: "Renovation debris", price: 500 },
  { value: "30yd", label: "30 YD", desc: "Large projects", price: 600 },
  { value: "40yd", label: "40 YD", desc: "Commercial / demo", price: 750 },
];

const durations = [
  { value: 7, label: "7 days" },
  { value: 14, label: "14 days" },
  { value: 30, label: "30 days" },
];

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

  const selectedSize = sizes.find(s => s.value === size);
  const estimatedTotal = selectedSize ? selectedSize.price + (rentalDays > 14 ? (rentalDays - 14) * 15 : 0) : 0;

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
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#2ECC71]/10 mb-4">
          <CheckCircle2 className="h-8 w-8 text-[#2ECC71]" />
        </div>
        <h2 className="text-xl font-bold text-[#0F172A]">Request Submitted!</h2>
        <p className="mt-2 text-sm text-[#64748B] text-center max-w-sm">
          Your request {jobNumber} has been received. We&apos;ll confirm availability and contact you within 1 hour.
        </p>
        <div className="mt-6 flex gap-3">
          <button onClick={() => router.push("/portal")} className="rounded-lg border border-[#E2E8F0] px-4 py-2 text-sm font-medium text-[#334155] hover:bg-[#F1F5F9]">
            Back to Dashboard
          </button>
          <button onClick={() => { setSubmitted(false); setSize("20yd"); setDate(""); setAddress({}); setInstructions(""); }}
            className="rounded-lg bg-[#2ECC71] px-4 py-2 text-sm font-semibold text-white hover:bg-[#27AE60]">
            Request Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#0F172A]">Request a Dumpster</h1>
        <p className="mt-1 text-sm text-[#64748B]">Choose your size and schedule delivery. We&apos;ll confirm within 1 hour.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">{error}</div>}

        {/* Size selector */}
        <div>
          <label className="block text-sm font-semibold text-[#0F172A] mb-3">Select Size</label>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {sizes.map(s => (
              <button key={s.value} type="button" onClick={() => setSize(s.value)}
                className={`rounded-xl border-2 p-4 text-center transition-all ${
                  size === s.value ? "border-[#2ECC71] bg-[#2ECC71]/5 shadow-sm" : "border-[#E2E8F0] bg-white hover:border-[#CBD5E1]"
                }`}>
                <p className="text-lg font-bold text-[#0F172A]">{s.label}</p>
                <p className="text-xs text-[#64748B] mt-0.5">{s.desc}</p>
                <p className="text-sm font-semibold text-[#2ECC71] mt-2">{formatCurrency(s.price)}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Delivery address */}
        <div>
          <label className="block text-sm font-semibold text-[#0F172A] mb-2">Delivery Address</label>
          <AddressAutocomplete value={address} onChange={setAddress} placeholder="Enter delivery address" />
        </div>

        {/* Date + Duration row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-[#0F172A] mb-2">Preferred Delivery Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required
              min={new Date().toISOString().split("T")[0]}
              className="w-full rounded-lg border border-[#E2E8F0] bg-white px-4 py-2.5 text-sm text-[#0F172A] outline-none focus:border-[#2ECC71] focus:ring-1 focus:ring-[#2ECC71]" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-[#0F172A] mb-2">Rental Duration</label>
            <div className="flex gap-2">
              {durations.map(d => (
                <button key={d.value} type="button" onClick={() => setRentalDays(d.value)}
                  className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                    rentalDays === d.value ? "border-[#2ECC71] bg-[#2ECC71]/5 text-[#2ECC71]" : "border-[#E2E8F0] text-[#64748B] hover:border-[#CBD5E1]"
                  }`}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div>
          <label className="block text-sm font-semibold text-[#0F172A] mb-2">Special Instructions <span className="font-normal text-[#94A3B8]">(optional)</span></label>
          <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} placeholder="Placement instructions, gate codes, etc."
            className="w-full rounded-lg border border-[#E2E8F0] bg-white px-4 py-2.5 text-sm text-[#0F172A] placeholder-[#94A3B8] outline-none focus:border-[#2ECC71] focus:ring-1 focus:ring-[#2ECC71] resize-none" />
        </div>

        {/* Price estimate */}
        <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-5">
          <h3 className="text-sm font-semibold text-[#0F172A] mb-3">Estimated Cost</h3>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between text-[#64748B]"><span>{selectedSize?.label} Dumpster ({rentalDays} days)</span><span>{formatCurrency(selectedSize?.price || 0)}</span></div>
            {rentalDays > 14 && <div className="flex justify-between text-[#64748B]"><span>Extra days ({rentalDays - 14} x $15)</span><span>{formatCurrency((rentalDays - 14) * 15)}</span></div>}
            <div className="flex justify-between border-t border-[#E2E8F0] pt-1.5 font-semibold text-[#0F172A]"><span>Estimated Total</span><span>{formatCurrency(estimatedTotal)}</span></div>
          </div>
          <p className="text-xs text-[#94A3B8] mt-2">Final price may vary based on distance and disposal fees.</p>
        </div>

        {/* Submit */}
        <button type="submit" disabled={submitting || !date || !address.street}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#2ECC71] px-4 py-3 text-sm font-semibold text-white hover:bg-[#27AE60] disabled:opacity-50">
          {submitting ? "Submitting..." : <><Package className="h-4 w-4" /> Submit Request</>}
        </button>
      </form>
    </div>
  );
}
