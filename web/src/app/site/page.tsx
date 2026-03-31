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
  const allServices = Object.values(services).flat();

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-[var(--t-bg-primary)]">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-24 sm:py-36">
          <div className="max-w-3xl">
            <h1 className="text-[clamp(2.5rem,5vw,4rem)] font-bold text-[var(--t-text-primary)] leading-[1.08] tracking-[-1px]">
              {tenant.headline || `Professional ${tenant.businessType?.replace(/_/g, ' ') || 'Service'} You Can Trust`}
            </h1>
            <p className="mt-6 text-lg text-[var(--t-text-muted)] leading-relaxed max-w-xl">
              {tenant.description || "Reliable, affordable, and hassle-free. Book online in minutes and we'll handle the rest."}
            </p>
            <div className="flex flex-wrap gap-3 mt-10">
              <Link href="/site/book" className="inline-flex items-center gap-2 rounded-full px-8 py-3.5 text-sm font-semibold bg-[var(--t-accent)] text-black transition-all hover:brightness-110 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--t-accent)]/20">
                <Calendar className="h-4 w-4" /> Book Now
              </Link>
              {tenant.phone && (
                <a href={`tel:${tenant.phone}`} className="inline-flex items-center gap-2 rounded-full border border-[var(--t-border)] px-8 py-3.5 text-sm font-semibold text-[var(--t-text-primary)] transition-colors hover:bg-[var(--t-bg-card)]">
                  <Phone className="h-4 w-4" /> Call {formatPhone(tenant.phone)}
                </a>
              )}
            </div>
            <div className="flex flex-wrap gap-6 mt-10">
              {[
                { icon: Shield, label: "Licensed & Insured" },
                { icon: Zap, label: "Same-Day Available" },
                { icon: Clock, label: "Transparent Pricing" },
              ].map(b => (
                <div key={b.label} className="flex items-center gap-2 text-sm text-[var(--t-text-muted)]">
                  <b.icon className="h-4 w-4 text-[var(--t-accent)]" />{b.label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Services */}
      {allServices.length > 0 && (
        <section id="services" className="py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="text-center mb-14">
              <h2 className="text-[28px] font-bold text-[var(--t-text-primary)] tracking-[-1px]">Services & Pricing</h2>
              <p className="mt-3 text-[var(--t-text-muted)]">Transparent pricing with no hidden fees</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {allServices.map((s, i) => (
                <div key={i} className="rounded-[18px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6 hover:bg-[var(--t-bg-card-hover)] transition-all group">
                  <div className="mb-4">
                    <span className="text-xs font-semibold text-[var(--t-text-muted)] uppercase tracking-wider">{s.subtype || s.name}</span>
                  </div>
                  <h3 className="text-lg font-semibold text-[var(--t-text-primary)]">{s.name}</h3>
                  <p className="text-3xl font-bold mt-3 text-[var(--t-accent)]">{formatCurrency(s.basePrice)}</p>
                  <p className="text-xs text-[var(--t-text-muted)] mt-1">{s.rentalDays} day rental included</p>
                  <ul className="mt-4 space-y-2 text-sm text-[var(--t-text-muted)]">
                    <li>+ {formatCurrency(s.extraDayRate)}/extra day</li>
                    {s.deliveryFee > 0 && <li>+ {formatCurrency(s.deliveryFee)} delivery</li>}
                    {s.depositRequired && <li>{formatCurrency(s.depositAmount)} deposit required</li>}
                  </ul>
                  <Link href="/site/book" className="mt-6 block w-full rounded-full py-2.5 text-center text-sm font-semibold bg-[var(--t-accent)] text-black transition-all hover:brightness-110">
                    Book Now
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* How It Works */}
      <section className="py-20 sm:py-28 border-t border-[var(--t-border)]">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-[28px] font-bold text-[var(--t-text-primary)] text-center mb-14 tracking-[-1px]">How It Works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              { icon: Grid3X3, title: "Choose Your Size", desc: "Pick the right container for your project" },
              { icon: Calendar, title: "Pick Your Date", desc: "Select a delivery date that works for you" },
              { icon: Truck, title: "We Deliver", desc: "We drop it off and pick it up when you're done" },
            ].map((step, i) => (
              <div key={i} className="text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[18px] border border-[var(--t-border)] bg-[var(--t-bg-card)] mb-4">
                  <step.icon className="h-6 w-6 text-[var(--t-accent)]" />
                </div>
                <div className="flex h-7 w-7 mx-auto items-center justify-center rounded-full text-xs font-bold bg-[var(--t-accent)] text-black mb-3">{i + 1}</div>
                <h3 className="text-lg font-semibold text-[var(--t-text-primary)]">{step.title}</h3>
                <p className="mt-2 text-sm text-[var(--t-text-muted)]">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Service Area + Contact */}
      <section id="contact" className="py-20 sm:py-28 border-t border-[var(--t-border)]">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-12">
            {tenant.serviceArea && (
              <div>
                <h2 className="text-[28px] font-bold text-[var(--t-text-primary)] mb-4 tracking-[-1px]">Service Area</h2>
                <div className="flex items-start gap-3">
                  <MapPin className="h-5 w-5 mt-0.5 shrink-0 text-[var(--t-accent)]" />
                  <p className="text-[var(--t-text-muted)] leading-relaxed">{tenant.serviceArea}</p>
                </div>
              </div>
            )}
            <div>
              <h2 className="text-[28px] font-bold text-[var(--t-text-primary)] mb-4 tracking-[-1px]">Contact Us</h2>
              <div className="space-y-3">
                {tenant.phone && <a href={`tel:${tenant.phone}`} className="flex items-center gap-3 text-lg font-semibold text-[var(--t-accent)] hover:brightness-110"><Phone className="h-5 w-5" />{formatPhone(tenant.phone)}</a>}
                {tenant.email && <a href={`mailto:${tenant.email}`} className="flex items-center gap-3 text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)]">{tenant.email}</a>}
              </div>
            </div>
          </div>
          {tenant.about && (
            <div className="mt-12 rounded-[18px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-8">
              <h3 className="text-lg font-semibold text-[var(--t-text-primary)] mb-3">About {tenant.name}</h3>
              <p className="text-[var(--t-text-muted)] leading-relaxed">{tenant.about}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
