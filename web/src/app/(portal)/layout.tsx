"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Package, FileText, PlusCircle, UserCircle, Menu, X, LogOut } from "lucide-react";
import { portalApi } from "@/lib/portal-api";

const nav = [
  { name: "My Rentals", href: "/portal", icon: Package },
  { name: "Invoices", href: "/portal/invoices", icon: FileText },
  { name: "Request Service", href: "/portal/request", icon: PlusCircle },
  { name: "Profile", href: "/portal/profile", icon: UserCircle },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [customer, setCustomer] = useState<{ firstName: string; lastName: string } | null>(null);

  useEffect(() => {
    const c = portalApi.getCustomer();
    if (!c && pathname !== "/portal/login") {
      router.push("/portal/login");
      return;
    }
    setCustomer(c);
  }, [pathname, router]);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  if (pathname === "/portal/login") return <>{children}</>;

  const handleLogout = () => {
    portalApi.clearToken();
    portalApi.clearCustomer();
    router.push("/portal/login");
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC]" style={{ colorScheme: "light" }}>
      {/* Top navbar */}
      <header className="sticky top-0 z-40 border-b border-[#E2E8F0] bg-white shadow-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/portal" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#2ECC71]">
              <span className="text-sm font-bold text-white">S</span>
            </div>
            <span className="font-semibold text-[#0F172A] text-sm hidden sm:block">ServiceOS</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {nav.map((item) => {
              const active = pathname === item.href || (item.href !== "/portal" && pathname.startsWith(item.href));
              return (
                <Link key={item.name} href={item.href}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active ? "bg-[#2ECC71]/10 text-[#2ECC71]" : "text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
                  }`}>
                  <item.icon className="h-4 w-4" />
                  {item.name}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            {customer && (
              <span className="hidden sm:block text-sm text-[#64748B]">
                {customer.firstName} {customer.lastName}
              </span>
            )}
            <button onClick={handleLogout} className="rounded-lg p-2 text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A]" title="Log out">
              <LogOut className="h-4 w-4" />
            </button>
            <button onClick={() => setMobileOpen(true)} className="md:hidden rounded-lg p-2 text-[#64748B] hover:bg-[#F1F5F9]">
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile nav overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="fixed inset-0 bg-black/30" onClick={() => setMobileOpen(false)} />
          <div className="fixed inset-y-0 right-0 w-64 bg-white shadow-xl p-4">
            <button onClick={() => setMobileOpen(false)} className="mb-4 rounded-lg p-2 text-[#64748B] hover:bg-[#F1F5F9]">
              <X className="h-5 w-5" />
            </button>
            <nav className="space-y-1">
              {nav.map((item) => {
                const active = pathname === item.href || (item.href !== "/portal" && pathname.startsWith(item.href));
                return (
                  <Link key={item.name} href={item.href}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium ${
                      active ? "bg-[#2ECC71]/10 text-[#2ECC71]" : "text-[#64748B] hover:bg-[#F1F5F9]"
                    }`}>
                    <item.icon className="h-4 w-4" />
                    {item.name}
                  </Link>
                );
              })}
              <button onClick={handleLogout}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-red-500 hover:bg-red-50">
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            </nav>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
