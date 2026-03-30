"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Phone, Menu, X } from "lucide-react";
import { TenantProvider, useTenant } from "./tenant-context";
import { formatPhone } from "@/lib/utils";
import { Suspense } from "react";

function SiteLayoutInner({ children }: { children: React.ReactNode }) {
  const { tenant, loading } = useTenant();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (loading) return <div className="min-h-screen bg-white flex items-center justify-center"><div className="h-8 w-8 border-2 border-gray-200 border-t-green-500 rounded-full animate-spin" /></div>;
  if (!tenant) return <div className="min-h-screen bg-white flex items-center justify-center"><p className="text-gray-500">Website not found</p></div>;

  const color = tenant.primaryColor || "#2ECC71";
  const nav = [
    { label: "Home", href: "/site" },
    { label: "Services", href: "/site#services" },
    { label: "Book Now", href: "/site/book" },
    { label: "Contact", href: "/site#contact" },
  ];

  return (
    <div className="min-h-screen bg-white text-gray-900" style={{ colorScheme: "light", "--accent": color } as React.CSSProperties}>
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/site" className="flex items-center gap-2.5">
            {tenant.logoUrl ? <img src={tenant.logoUrl} alt="" className="h-8 w-8 rounded-lg object-cover" /> : <div className="flex h-8 w-8 items-center justify-center rounded-lg text-white text-sm font-bold" style={{ background: color }}>{tenant.name[0]}</div>}
            <span className="font-semibold text-gray-900 text-sm hidden sm:block">{tenant.name}</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            {nav.map(n => <Link key={n.label} href={n.href} className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">{n.label}</Link>)}
          </nav>
          <div className="flex items-center gap-3">
            {tenant.phone && (
              <a href={`tel:${tenant.phone}`} className="hidden sm:flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors" style={{ background: color }}>
                <Phone className="h-3.5 w-3.5" />{formatPhone(tenant.phone)}
              </a>
            )}
            <button onClick={() => setMobileOpen(true)} className="md:hidden rounded-lg p-2 text-gray-500 hover:bg-gray-100"><Menu className="h-5 w-5" /></button>
          </div>
        </div>
      </header>

      {/* Mobile nav */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="fixed inset-0 bg-black/20" onClick={() => setMobileOpen(false)} />
          <div className="fixed inset-y-0 right-0 w-64 bg-white shadow-xl p-6">
            <button onClick={() => setMobileOpen(false)} className="mb-6 text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
            <nav className="space-y-1">
              {nav.map(n => <Link key={n.label} href={n.href} onClick={() => setMobileOpen(false)} className="block rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">{n.label}</Link>)}
              {tenant.phone && <a href={`tel:${tenant.phone}`} className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-white mt-4" style={{ background: color }}><Phone className="h-4 w-4" />Call Us</a>}
            </nav>
          </div>
        </div>
      )}

      <main>{children}</main>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-gray-50 mt-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            <div>
              <p className="font-semibold text-gray-900">{tenant.name}</p>
              {tenant.serviceArea && <p className="text-sm text-gray-500 mt-2">{tenant.serviceArea}</p>}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900 mb-2">Contact</p>
              {tenant.phone && <a href={`tel:${tenant.phone}`} className="block text-sm text-gray-500 hover:text-gray-900">{formatPhone(tenant.phone)}</a>}
              {tenant.email && <a href={`mailto:${tenant.email}`} className="block text-sm text-gray-500 hover:text-gray-900 mt-1">{tenant.email}</a>}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900 mb-2">Quick Links</p>
              <Link href="/site/book" className="block text-sm text-gray-500 hover:text-gray-900">Book Now</Link>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t border-gray-200 text-center">
            <p className="text-xs text-gray-400">Powered by <a href="https://serviceos.com" className="hover:text-gray-600">ServiceOS</a></p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function LayoutWithSlug({ children }: { children: React.ReactNode }) {
  const params = useSearchParams();
  const slug = params.get("slug") || "demo";
  return <TenantProvider slug={slug}><SiteLayoutInner>{children}</SiteLayoutInner></TenantProvider>;
}

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="min-h-screen bg-white" />}><LayoutWithSlug>{children}</LayoutWithSlug></Suspense>;
}
