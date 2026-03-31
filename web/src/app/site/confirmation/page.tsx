"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { CheckCircle2, Phone } from "lucide-react";
import { useTenant } from "../tenant-context";
import { formatPhone } from "@/lib/utils";

function ConfirmationContent() {
  const params = useSearchParams();
  const jobNumber = params.get("jobNumber");
  const embed = params.get("embed") === "true";
  const { tenant } = useTenant();

  return (
    <div className="mx-auto max-w-lg px-4 py-16 sm:py-24 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[var(--t-accent-soft)] mb-6">
        <CheckCircle2 className="h-10 w-10 text-[var(--t-accent)]" />
      </div>
      <h1 className="text-[28px] font-bold text-[var(--t-text-primary)] tracking-[-1px]">Booking Confirmed!</h1>
      {jobNumber && <p className="mt-3 text-[var(--t-text-muted)]">Reference: <span className="font-semibold text-[var(--t-text-primary)]">{jobNumber}</span></p>}
      <div className="mt-8 rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6 text-left">
        <h3 className="font-semibold text-[var(--t-text-primary)] mb-2">What happens next?</h3>
        <ul className="space-y-2 text-sm text-[var(--t-text-muted)]">
          <li>1. You&apos;ll receive a confirmation email shortly</li>
          <li>2. Our team will contact you to confirm delivery details</li>
          <li>3. We&apos;ll deliver on your scheduled date</li>
        </ul>
      </div>
      <div className="flex flex-wrap justify-center gap-3 mt-8">
        <Link href="/site/book" className="rounded-full px-7 py-3 text-sm font-semibold bg-[var(--t-accent)] text-black hover:brightness-110 transition-all">Book Another</Link>
        {tenant?.phone && <a href={`tel:${tenant.phone}`} className="rounded-full border border-[var(--t-border)] px-7 py-3 text-sm font-semibold text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card)] transition-colors"><Phone className="inline h-4 w-4 mr-1" />Call Us</a>}
        {embed && <button onClick={() => window.parent.postMessage({ type: "serviceos-close" }, "*")} className="rounded-full border border-[var(--t-border)] bg-[var(--t-bg-card)] px-7 py-3 text-sm font-medium text-[var(--t-text-muted)] hover:bg-[var(--t-bg-card-hover)] transition-colors">Close</button>}
      </div>
      {embed && <p className="mt-8 text-xs text-[var(--t-text-muted)]">Powered by <a href="https://serviceos.com" className="hover:text-[var(--t-text-primary)]">ServiceOS</a></p>}
    </div>
  );
}

export default function ConfirmationPage() {
  return <Suspense fallback={<div className="min-h-screen bg-[var(--t-bg-primary)]" />}><ConfirmationContent /></Suspense>;
}
