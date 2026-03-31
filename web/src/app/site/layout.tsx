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

  if (loading) return <div className="min-h-screen bg-[var(--t-bg-primary)] flex items-center justify-center"><div className="h-8 w-8 border-2 border-[var(--t-border)] border-t-[var(--t-accent)] rounded-full animate-spin" /></div>;
  if (!tenant) return <div className="min-h-screen bg-[var(--t-bg-primary)] flex items-center justify-center"><p className="text-[var(--t-text-muted)]">Website not found</p></div>;

  const nav = [
    { label: "Home", href: "/site" },
    { label: "Services", href: "/site#services" },
    { label: "Book Now", href: "/site/book" },
    { label: "Contact", href: "/site#contact" },
  ];

  return (
    <div className="min-h-screen bg-[var(--t-bg-primary)] text-[var(--t-text-primary)]">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-[var(--t-border)] bg-[var(--t-bg-primary)]/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/site" className="flex items-center gap-2.5">
            {tenant.logoUrl ? <img src={tenant.logoUrl} alt="" className="h-8 w-8 rounded-[18px] object-cover" /> : <div className="flex h-8 w-8 items-center justify-center rounded-[18px] bg-[var(--t-accent)] text-black text-sm font-bold">{tenant.name[0]}</div>}
            <span className="font-semibold text-[var(--t-text-primary)] text-sm hidden sm:block">{tenant.name}</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            {nav.map(n => <Link key={n.label} href={n.href} className="text-sm font-medium text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] transition-colors">{n.label}</Link>)}
          </nav>
          <div className="flex items-center gap-3">
            {tenant.phone && (
              <a href={`tel:${tenant.phone}`} className="hidden sm:flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-semibold bg-[var(--t-accent)] text-black transition-colors hover:brightness-110">
                <Phone className="h-3.5 w-3.5" />{formatPhone(tenant.phone)}
              </a>
            )}
            <button onClick={() => setMobileOpen(true)} className="md:hidden rounded-[18px] p-2 text-[var(--t-text-muted)] hover:bg-[var(--t-bg-card)]"><Menu className="h-5 w-5" /></button>
          </div>
        </div>
      </header>

      {/* Mobile nav */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="fixed inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div className="fixed inset-y-0 right-0 w-64 bg-[var(--t-bg-card)] border-l border-[var(--t-border)] p-6">
            <button onClick={() => setMobileOpen(false)} className="mb-6 text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)]"><X className="h-5 w-5" /></button>
            <nav className="space-y-1">
              {nav.map(n => <Link key={n.label} href={n.href} onClick={() => setMobileOpen(false)} className="block rounded-[18px] px-3 py-2.5 text-sm font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)]">{n.label}</Link>)}
              {tenant.phone && <a href={`tel:${tenant.phone}`} className="flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold bg-[var(--t-accent)] text-black mt-4"><Phone className="h-4 w-4" />Call Us</a>}
            </nav>
          </div>
        </div>
      )}

      <main>{children}</main>

      {/* Footer */}
      <footer className="border-t border-[var(--t-border)] bg-[var(--t-bg-card)] mt-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            <div>
              <p className="font-semibold text-[var(--t-text-primary)]">{tenant.name}</p>
              {tenant.serviceArea && <p className="text-sm text-[var(--t-text-muted)] mt-2">{tenant.serviceArea}</p>}
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--t-text-primary)] mb-2">Contact</p>
              {tenant.phone && <a href={`tel:${tenant.phone}`} className="block text-sm text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)]">{formatPhone(tenant.phone)}</a>}
              {tenant.email && <a href={`mailto:${tenant.email}`} className="block text-sm text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] mt-1">{tenant.email}</a>}
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--t-text-primary)] mb-2">Quick Links</p>
              <Link href="/site/book" className="block text-sm text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)]">Book Now</Link>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t border-[var(--t-border)] text-center">
            <p className="text-xs text-[var(--t-text-muted)]">Powered by <a href="https://serviceos.com" className="hover:text-[var(--t-text-primary)]">ServiceOS</a></p>
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
  return <Suspense fallback={<div className="min-h-screen bg-[var(--t-bg-primary)]" />}><LayoutWithSlug>{children}</LayoutWithSlug></Suspense>;
}
