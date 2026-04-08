"use client";

import { useState, useEffect, use } from "react";
import { Phone, Mail, MapPin, Calendar, Box, Clock } from "lucide-react";
import { formatPhone, formatCurrency, formatDumpsterSize } from "@/lib/utils";

const API = process.env.NEXT_PUBLIC_API_URL || "https://serviceos-api.vercel.app";

interface QuoteData {
  size: string;
  customerName: string | null;
  deliveryAddress: Record<string, string> | null;
  totalQuoted: number;
  basePrice: number;
  distanceSurcharge: number;
  rentalDays: number;
  includedTons: number;
  overageRate: number;
  extraDayRate: number;
  expiresAt: string;
  createdAt: string;
}

interface Branding {
  companyName: string;
  logoUrl: string | null;
  primaryColor: string;
  phone: string | null;
  email: string | null;
  slug: string;
}

interface HostedQuoteResponse {
  status: "active" | "expired" | "booked";
  quote: QuoteData;
  branding: Branding;
}

export default function HostedQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<HostedQuoteResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/public/tenant/quote/${token}`)
      .then((r) => {
        if (!r.ok) throw new Error("not_found");
        return r.json();
      })
      .then(setData)
      .catch(() => setError("This quote is no longer available."))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="h-8 w-8 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-700">Quote Not Found</p>
          <p className="text-sm text-gray-500 mt-1">{error || "This quote is no longer available."}</p>
        </div>
      </div>
    );
  }

  const { quote, branding, status } = data;
  const accent = branding.primaryColor || "#2ECC71";
  const addr = quote.deliveryAddress;
  const addrStr = addr ? [addr.street, addr.city, addr.state, addr.zip].filter(Boolean).join(", ") : null;
  const expiresDate = new Date(quote.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="mx-auto max-w-2xl flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt="" className="h-9 w-9 rounded-lg object-cover" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-lg text-white text-sm font-bold" style={{ backgroundColor: accent }}>
                {branding.companyName[0]}
              </div>
            )}
            <span className="font-semibold text-gray-900">{branding.companyName}</span>
          </div>
          {branding.phone && (
            <a href={`tel:${branding.phone}`} className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
              <Phone className="h-3.5 w-3.5" /> {formatPhone(branding.phone)}
            </a>
          )}
        </div>
      </header>

      {/* Content */}
      <div className="mx-auto max-w-2xl px-6 py-8">
        {/* Status banner */}
        {status === "expired" && (
          <div className="mb-6 rounded-xl bg-amber-50 border border-amber-200 px-5 py-3 text-sm text-amber-800 font-medium">
            This quote expired on {expiresDate}. Please contact us for updated pricing.
          </div>
        )}
        {status === "booked" && (
          <div className="mb-6 rounded-xl bg-green-50 border border-green-200 px-5 py-3 text-sm text-green-800 font-medium">
            This quote has been booked. Thank you!
          </div>
        )}

        {/* Greeting */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            {quote.customerName ? `Hi ${quote.customerName.split(" ")[0]},` : "Your Quote"}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Here&#39;s your quote from {branding.companyName}
          </p>
        </div>

        {/* Quote card */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
          {/* Hero */}
          <div className="px-6 py-5" style={{ backgroundColor: accent + "12" }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Box className="h-6 w-6" style={{ color: accent }} />
                <div>
                  <p className="text-lg font-bold text-gray-900">{formatDumpsterSize(quote.size)} Dumpster</p>
                  <p className="text-sm text-gray-500">{quote.rentalDays}-day rental</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-extrabold" style={{ color: accent }}>{formatCurrency(quote.totalQuoted)}</p>
                <p className="text-xs text-gray-500">total quoted</p>
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="px-6 py-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Base price</span>
              <span className="text-gray-900 font-medium">{formatCurrency(quote.basePrice)}</span>
            </div>
            {quote.distanceSurcharge > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500">Distance surcharge</span>
                <span className="text-gray-900 font-medium">{formatCurrency(quote.distanceSurcharge)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">Included weight</span>
              <span className="text-gray-900">{quote.includedTons} tons</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Overage rate</span>
              <span className="text-gray-900">{formatCurrency(quote.overageRate)}/ton</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Extra days</span>
              <span className="text-gray-900">{formatCurrency(quote.extraDayRate)}/day after {quote.rentalDays} days</span>
            </div>
          </div>

          {/* Address */}
          {addrStr && (
            <div className="px-6 py-3 border-t border-gray-100">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <MapPin className="h-4 w-4 text-gray-400 shrink-0" />
                <span>{addrStr}</span>
              </div>
            </div>
          )}

          {/* Validity */}
          <div className="px-6 py-3 border-t border-gray-100">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Clock className="h-4 w-4 text-gray-400" />
              <span>Valid through {expiresDate}</span>
            </div>
          </div>
        </div>

        {/* Contact CTA */}
        <div className="mt-8 text-center space-y-3">
          <p className="text-sm text-gray-500">Ready to book or have questions?</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            {branding.phone && (
              <a
                href={`tel:${branding.phone}`}
                className="flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: accent }}
              >
                <Phone className="h-4 w-4" /> Call {formatPhone(branding.phone)}
              </a>
            )}
            {branding.email && (
              <a
                href={`mailto:${branding.email}`}
                className="flex items-center gap-2 rounded-full border border-gray-300 px-6 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
              >
                <Mail className="h-4 w-4" /> Email Us
              </a>
            )}
          </div>
          {!branding.phone && !branding.email && (
            <p className="text-sm text-gray-400">Contact your service provider for next steps</p>
          )}
        </div>

        {/* Footer */}
        <div className="mt-12 pb-8 text-center">
          <p className="text-xs text-gray-400">Powered by ServiceOS</p>
        </div>
      </div>
    </div>
  );
}
