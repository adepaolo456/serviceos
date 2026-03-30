"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Phone, Truck, Calendar, Grid3X3, Shield, Clock, Zap, MapPin } from "lucide-react";
import { useTenant } from "./tenant-context";
import { formatPhone, formatCurrency } from "@/lib/utils";

const API = process.env.NEXT_PUBLIC_API_URL || "https://serviceos-api.vercel.app";

interface ServiceGroup {
  [key: string]: Array<{ name: string; subtype: string; basePrice: number; rentalDays: number; extraDayRate: number; deliveryFee: number; depositAmount: number; depositRequired: boolean }>;
}

export default function SiteHomePage() {
  const { tenant } = useTenant();
  const [services, setServices] = useState<ServiceGroup>({});

  useEffect(() => {
    if (!tenant) return;
    fetch(`${API}/public/tenant/${tenant.slug}/services`).then(r => r.json()).then(d => setServices(d.services || {})).catch(() => {});
  }, [tenant]);

  if (!tenant) return null;
  const color = tenant.primaryColor || "#2ECC71";
  const allServices = Object.values(services).flat();

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${color}08, ${color}15)` }}>
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-28">
          <div className="max-w-2xl">
            <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 leading-tight">
              {tenant.headline || `Professional ${tenant.businessType?.replace(/_/g, ' ') || 'Service'} You Can Trust`}
            </h1>
            <p className="mt-6 text-lg text-gray-600 leading-relaxed">
              {tenant.description || "Reliable, affordable, and hassle-free. Book online in minutes and we'll handle the rest."}
            </p>
            <div className="flex flex-wrap gap-3 mt-8">
              <Link href="/site/book" className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:shadow-xl hover:-translate-y-0.5" style={{ background: color }}>
                <Calendar className="h-4 w-4" /> Book Now
              </Link>
              {tenant.phone && (
                <a href={`tel:${tenant.phone}`} className="inline-flex items-center gap-2 rounded-xl border-2 px-6 py-3 text-sm font-semibold transition-colors hover:bg-gray-50" style={{ borderColor: color, color }}>
                  <Phone className="h-4 w-4" /> Call {formatPhone(tenant.phone)}
                </a>
              )}
            </div>
            <div className="flex flex-wrap gap-4 mt-8">
              {[
                { icon: Shield, label: "Licensed & Insured" },
                { icon: Zap, label: "Same-Day Available" },
                { icon: Clock, label: "Transparent Pricing" },
              ].map(b => (
                <div key={b.label} className="flex items-center gap-1.5 text-sm text-gray-500">
                  <b.icon className="h-4 w-4" style={{ color }} />{b.label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Services */}
      {allServices.length > 0 && (
        <section id="services" className="py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold text-gray-900">Services & Pricing</h2>
              <p className="mt-3 text-gray-500">Transparent pricing with no hidden fees</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {allServices.map((s, i) => (
                <div key={i} className="rounded-2xl border border-gray-200 p-6 hover:shadow-lg hover:-translate-y-1 transition-all">
                  <div className="flex items-center justify-between mb-4">
                    <span className="rounded-lg px-3 py-1 text-xs font-semibold text-white" style={{ background: color }}>{s.subtype || s.name}</span>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">{s.name}</h3>
                  <p className="text-3xl font-bold mt-3" style={{ color }}>{formatCurrency(s.basePrice)}</p>
                  <p className="text-xs text-gray-400 mt-1">{s.rentalDays} day rental included</p>
                  <ul className="mt-4 space-y-2 text-sm text-gray-600">
                    <li>+ {formatCurrency(s.extraDayRate)}/extra day</li>
                    {s.deliveryFee > 0 && <li>+ {formatCurrency(s.deliveryFee)} delivery</li>}
                    {s.depositRequired && <li>{formatCurrency(s.depositAmount)} deposit required</li>}
                  </ul>
                  <Link href="/site/book" className="mt-6 block w-full rounded-lg py-2.5 text-center text-sm font-semibold text-white transition-colors" style={{ background: color }}>
                    Book Now
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* How It Works */}
      <section className="py-16 sm:py-20 bg-gray-50">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-3xl font-bold text-gray-900 text-center mb-12">How It Works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              { icon: Grid3X3, title: "Choose Your Size", desc: "Pick the right container for your project" },
              { icon: Calendar, title: "Pick Your Date", desc: "Select a delivery date that works for you" },
              { icon: Truck, title: "We Deliver", desc: "We drop it off and pick it up when you're done" },
            ].map((step, i) => (
              <div key={i} className="text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl mb-4" style={{ background: `${color}15` }}>
                  <step.icon className="h-6 w-6" style={{ color }} />
                </div>
                <div className="flex h-7 w-7 mx-auto items-center justify-center rounded-full text-xs font-bold text-white mb-3" style={{ background: color }}>{i + 1}</div>
                <h3 className="text-lg font-semibold text-gray-900">{step.title}</h3>
                <p className="mt-2 text-sm text-gray-500">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Service Area + Contact */}
      <section id="contact" className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-12">
            {tenant.serviceArea && (
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-4">Service Area</h2>
                <div className="flex items-start gap-3">
                  <MapPin className="h-5 w-5 mt-0.5 shrink-0" style={{ color }} />
                  <p className="text-gray-600 leading-relaxed">{tenant.serviceArea}</p>
                </div>
              </div>
            )}
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Contact Us</h2>
              <div className="space-y-3">
                {tenant.phone && <a href={`tel:${tenant.phone}`} className="flex items-center gap-3 text-lg font-semibold hover:underline" style={{ color }}><Phone className="h-5 w-5" />{formatPhone(tenant.phone)}</a>}
                {tenant.email && <a href={`mailto:${tenant.email}`} className="flex items-center gap-3 text-gray-600 hover:text-gray-900">{tenant.email}</a>}
              </div>
            </div>
          </div>
          {tenant.about && (
            <div className="mt-12 rounded-2xl bg-gray-50 p-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">About {tenant.name}</h3>
              <p className="text-gray-600 leading-relaxed">{tenant.about}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
