"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Package, FileText, PlusCircle, UserCircle, Menu, X, LogOut } from "lucide-react";
import { portalApi } from "@/lib/portal-api";

const nav = [
  { name: "My Rentals", href: "/portal/rentals", icon: Package },
  { name: "Invoices", href: "/portal/invoices", icon: FileText },
  { name: "Request Service", href: "/portal/request", icon: PlusCircle },
  { name: "Profile", href: "/portal/profile", icon: UserCircle },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [customer, setCustomer] = useState<{ firstName: string; lastName: string } | null>(null);
  const [accountStatus, setAccountStatus] = useState<{ account_status: string; status_message: string | null } | null>(null);

  // Auth check on pathname change
  useEffect(() => {
    const c = portalApi.getCustomer();
    if (!c && pathname !== "/portal/login") {
      router.push("/portal/login");
      return;
    }
    setCustomer(c);
  }, [pathname, router]);

  // Fetch account summary once on mount (not per-navigation)
  useEffect(() => {
    const c = portalApi.getCustomer();
    if (c) {
      portalApi.get<{ account_status: string; status_message: string | null }>("/portal/account-summary")
        .then(setAccountStatus)
        .catch(() => {});
    }
  }, []);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  if (pathname === "/portal/login") return <>{children}</>;

  const handleLogout = () => {
    portalApi.clearToken();
    portalApi.clearCustomer();
    router.push("/portal/login");
  };

  return (
    // Phase B12 — overflow-x-clip is a safety net at the root so any
    // single bad descendant can't push the body into horizontal scroll.
    // Underlying flex/truncate bugs are still fixed at their source.
    <div className="min-h-screen bg-[var(--t-bg-primary)] overflow-x-clip">
      {/* Top navbar */}
      <header className="sticky top-0 z-40" style={{ backgroundColor: "var(--t-frame-bg)", borderBottom: "1px solid var(--t-frame-border)" }}>
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/portal" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--t-accent)]">
              <span className="text-sm font-bold text-[var(--t-accent-on-accent)]">S</span>
            </div>
            <span className="font-semibold text-sm hidden sm:block" style={{ color: "var(--t-frame-text)" }}>RentThisApp</span>
          </Link>

          {/* Desktop nav — Phase B17: list and detail are now distinct
              pathnames (/portal/rentals and /portal/rentals/[id]), so plain
              <Link> navigations are always cross-pathname and Next.js
              handles them deterministically. The B14 same-pathname onClick
              guard is no longer needed. */}
          <nav className="hidden md:flex items-center gap-1">
            {nav.map((item) => {
              const active = pathname === item.href || (item.href !== "/portal" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                    active ? "text-[var(--t-accent)]" : ""
                  }`}
                  style={active ? {} : { color: "var(--t-frame-text-muted)" }}>
                  <item.icon className="h-4 w-4" />
                  {item.name}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            {customer && (
              <span className="hidden sm:block text-sm" style={{ color: "var(--t-frame-text-muted)" }}>
                {customer.firstName} {customer.lastName}
              </span>
            )}
            <button onClick={handleLogout} className="rounded-full p-2 transition-colors" style={{ color: "var(--t-frame-text-muted)" }} title="Log out">
              <LogOut className="h-4 w-4" />
            </button>
            <button onClick={() => setMobileOpen(true)} className="md:hidden rounded-full p-2" style={{ color: "var(--t-frame-text-muted)" }}>
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile nav overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="fixed inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="fixed inset-y-0 right-0 w-64 bg-[var(--t-bg-card)] border-l border-[var(--t-border)] p-4">
            <button onClick={() => setMobileOpen(false)} className="mb-4 rounded-full p-2 text-[var(--t-text-muted)] hover:bg-[var(--t-bg-card-hover)]">
              <X className="h-5 w-5" />
            </button>
            <nav className="space-y-1">
              {nav.map((item) => {
                const active = pathname === item.href || (item.href !== "/portal" && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`flex items-center gap-2.5 rounded-[20px] px-3 py-2.5 text-sm font-medium ${
                      active ? "text-[var(--t-accent)]" : "text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)]"
                    }`}>
                    <item.icon className="h-4 w-4" />
                    {item.name}
                  </Link>
                );
              })}
              <button onClick={handleLogout}
                className="flex w-full items-center gap-2.5 rounded-[20px] px-3 py-2.5 text-sm font-medium text-[var(--t-error)] hover:bg-[var(--t-error-soft)]">
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            </nav>
          </div>
        </div>
      )}

      {/* Main content — Phase B12: explicit min-w-0 so children inside
          nested flex/grid layouts can actually shrink below intrinsic
          content width on mobile. */}
      <main className="mx-auto max-w-5xl px-4 py-6 min-w-0 w-full">{children}</main>
    </div>
  );
}
