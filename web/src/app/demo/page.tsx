"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";

const FLEET_SIZES = ["1-10", "11-25", "26-50", "50+"];
const BUSINESS_TYPES = [
  { value: "dumpster", label: "Dumpster Rental" },
  { value: "pod", label: "Portable Storage" },
  { value: "restroom", label: "Portable Restrooms" },
  { value: "landscaping", label: "Landscaping" },
  { value: "general", label: "General Services" },
];

export default function DemoPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [fleetSize, setFleetSize] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api.post("/demos", { name, email, phone, companyName, businessType, fleetSize, message });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = "w-full rounded-lg border border-white/10 bg-dark-card px-4 py-3 text-sm text-white placeholder-muted outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand";

  if (submitted) {
    return (
      <div className="min-h-screen bg-dark-primary flex flex-col items-center justify-center px-4">
        <CheckCircle2 className="h-16 w-16 text-brand mb-4" />
        <h1 className="font-display text-2xl font-bold text-white">Thanks for your interest!</h1>
        <p className="mt-2 text-muted max-w-md text-center">
          We&apos;ll reach out within 24 hours to schedule your personalized demo.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href="/register" className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-dark-primary hover:bg-brand-light transition-colors">
            Sign Up Now
          </Link>
          <Link href="/login" className="rounded-lg bg-dark-card border border-[#1E2D45] px-5 py-2.5 text-sm font-medium text-white hover:bg-dark-card-hover transition-colors">
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-primary flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand">
            <span className="font-display text-xl font-bold text-dark-primary">S</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-white">Request a Demo</h1>
          <p className="mt-2 text-sm text-muted">See how ServiceOS can transform your service business</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <input value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} placeholder="Your name" />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputClass} placeholder="Email address" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} placeholder="Phone (optional)" />
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required className={inputClass} placeholder="Company name" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <select value={businessType} onChange={(e) => setBusinessType(e.target.value)} className={`${inputClass} appearance-none`}>
              <option value="">Business type</option>
              {BUSINESS_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <select value={fleetSize} onChange={(e) => setFleetSize(e.target.value)} className={`${inputClass} appearance-none`}>
              <option value="">Fleet size</option>
              {FLEET_SIZES.map((s) => <option key={s} value={s}>{s} units</option>)}
            </select>
          </div>

          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className={`${inputClass} resize-none`} placeholder="Tell us about your needs (optional)" />

          <button type="submit" disabled={submitting} className="w-full rounded-lg bg-brand py-3 text-sm font-bold text-dark-primary transition-all hover:bg-brand-light active:scale-[0.98] disabled:opacity-50">
            {submitting ? "Submitting..." : "Request Demo"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Ready to get started?{" "}
          <Link href="/register" className="text-brand hover:text-brand-light font-medium">Sign up for free</Link>
          {" "}or{" "}
          <Link href="/login" className="text-brand hover:text-brand-light font-medium">sign in</Link>
        </p>
      </div>
    </div>
  );
}
