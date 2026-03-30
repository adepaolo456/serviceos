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
  const color = tenant?.primaryColor || "#2ECC71";

  return (
    <div className="mx-auto max-w-lg px-4 py-16 sm:py-24 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full mb-6" style={{ background: `${color}15` }}>
        <CheckCircle2 className="h-10 w-10" style={{ color }} />
      </div>
      <h1 className="text-3xl font-bold text-gray-900">Booking Confirmed!</h1>
      {jobNumber && <p className="mt-3 text-gray-500">Reference: <span className="font-semibold text-gray-900">{jobNumber}</span></p>}
      <div className="mt-8 rounded-2xl bg-gray-50 border border-gray-200 p-6 text-left">
        <h3 className="font-semibold text-gray-900 mb-2">What happens next?</h3>
        <ul className="space-y-2 text-sm text-gray-600">
          <li>1. You&apos;ll receive a confirmation email shortly</li>
          <li>2. Our team will contact you to confirm delivery details</li>
          <li>3. We&apos;ll deliver on your scheduled date</li>
        </ul>
      </div>
      <div className="flex flex-wrap justify-center gap-3 mt-8">
        <Link href="/site/book" className="rounded-xl px-6 py-3 text-sm font-semibold text-white" style={{ background: color }}>Book Another</Link>
        {tenant?.phone && <a href={`tel:${tenant.phone}`} className="rounded-xl border-2 px-6 py-3 text-sm font-semibold" style={{ borderColor: color, color }}><Phone className="inline h-4 w-4 mr-1" />Call Us</a>}
        {embed && <button onClick={() => window.parent.postMessage({ type: "serviceos-close" }, "*")} className="rounded-xl bg-gray-100 px-6 py-3 text-sm font-medium text-gray-600">Close</button>}
      </div>
      {embed && <p className="mt-8 text-xs text-gray-400">Powered by <a href="https://serviceos.com" className="hover:text-gray-600">ServiceOS</a></p>}
    </div>
  );
}

export default function ConfirmationPage() {
  return <Suspense fallback={<div className="min-h-screen bg-white" />}><ConfirmationContent /></Suspense>;
}
