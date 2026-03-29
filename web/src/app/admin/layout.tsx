"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  CreditCard,
  LogOut,
  Shield,
  ArrowLeftRight,
} from "lucide-react";
import { api } from "@/lib/api";

interface Profile {
  email: string;
  firstName: string;
  lastName: string;
}

const ADMIN_EMAIL = "adepaolo456@gmail.com";

const nav = [
  { name: "Overview", href: "/admin", icon: LayoutDashboard },
  { name: "Tenants", href: "/admin/tenants", icon: Building2 },
  { name: "Subscriptions", href: "/admin/subscriptions", icon: CreditCard },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [auth, setAuth] = useState<"loading" | "denied" | "ok">("loading");

  useEffect(() => {
    api
      .get<Profile>("/auth/profile")
      .then((p) => setAuth(p.email === ADMIN_EMAIL ? "ok" : "denied"))
      .catch(() => setAuth("denied"));
  }, []);

  if (auth === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#2ECC71] border-t-transparent" />
      </div>
    );
  }

  if (auth === "denied") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#F8FAFC]">
        <Shield className="h-16 w-16 text-red-400 mb-4" />
        <h1 className="text-2xl font-bold text-gray-900">Access Denied</h1>
        <p className="mt-2 text-gray-500">You don&apos;t have permission to access the admin panel.</p>
        <a href="/" className="mt-6 rounded-lg bg-[#2ECC71] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1FA855]">
          Back to Dashboard
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      {/* Top navbar */}
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#2ECC71]">
                <span className="text-sm font-bold text-white">S</span>
              </div>
              <span className="font-display text-base font-bold text-gray-900">
                ServiceOS <span className="text-xs font-medium text-gray-400 ml-1">Admin</span>
              </span>
            </div>
            <nav className="hidden sm:flex items-center gap-1">
              {nav.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/admin" && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-[#2ECC71]/10 text-[#2ECC71]"
                        : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.name}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-100 hover:border-gray-300 active:scale-95"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              Switch to Dashboard
            </Link>
            <button
              onClick={() => { api.clearToken(); window.location.href = "/login"; }}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {children}
      </main>
    </div>
  );
}
