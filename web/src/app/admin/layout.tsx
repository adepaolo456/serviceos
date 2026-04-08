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
  ChevronRight,
  MessageSquare,
  BarChart3,
  BookOpen,
  PhoneOff,
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
  { name: "Demos", href: "/admin/demos", icon: MessageSquare },
  { name: "SMS Requests", href: "/admin/sms-requests", icon: PhoneOff },
  { name: "Help Analytics", href: "/admin/help-analytics", icon: BarChart3 },
  { name: "Admin Guide", href: "/admin/admin-guide", icon: BookOpen },
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
      <div className="flex min-h-screen items-center justify-center bg-[var(--t-bg-primary)]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--t-accent)] border-t-transparent" />
      </div>
    );
  }

  if (auth === "denied") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--t-bg-primary)]">
        <Shield className="h-16 w-16 text-[var(--t-error)] mb-4" />
        <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-text-primary)]">Access Denied</h1>
        <p className="mt-2 text-[var(--t-text-muted)]">You don&apos;t have permission to access the admin panel.</p>
        <a href="/" className="mt-6 rounded-full bg-[var(--t-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--t-accent-on-accent)] hover:opacity-90 transition-opacity">
          Back to Dashboard
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--t-bg-primary)]">
      {/* Top navbar */}
      <header className="sticky top-0 z-40" style={{ backgroundColor: "var(--t-frame-bg)", borderBottom: "1px solid var(--t-frame-border)" }}>
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--t-accent)]">
                <span className="text-sm font-bold text-[var(--t-accent-on-accent)]">S</span>
              </div>
              <span className="text-base font-bold" style={{ color: "var(--t-frame-text)" }}>
                ServiceOS <span className="text-xs font-medium ml-1" style={{ color: "var(--t-frame-text-muted)" }}>Admin</span>
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
                    className={`flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? "text-[var(--t-accent)]"
                        : ""
                    }`}
                    style={isActive ? {} : { color: "var(--t-frame-text-muted)" }}
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
              className="flex items-center gap-2 rounded-full bg-transparent px-3.5 py-2 text-sm font-medium transition-colors active:scale-95"
              style={{ border: "1px solid var(--t-frame-border)", color: "var(--t-frame-text)" }}
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              Switch to Dashboard
            </Link>
            <button
              onClick={() => { api.clearToken(); window.location.href = "/login"; }}
              className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm transition-colors"
              style={{ color: "var(--t-frame-text-muted)" }}
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8" style={{ backgroundColor: "var(--t-bg-primary)" }}>
        <Breadcrumbs pathname={pathname} />
        {children}
      </main>
    </div>
  );
}

function Breadcrumbs({ pathname }: { pathname: string }) {
  if (pathname === "/admin") return null;

  const segments = pathname.replace("/admin", "").split("/").filter(Boolean);
  const crumbs = [{ label: "Admin", href: "/admin" }];

  let path = "/admin";
  for (const seg of segments) {
    path += `/${seg}`;
    // Check if it looks like a UUID
    const isId = seg.length > 8 && seg.includes("-");
    crumbs.push({
      label: isId ? "Detail" : seg.charAt(0).toUpperCase() + seg.slice(1),
      href: path,
    });
  }

  return (
    <nav className="mb-6 flex items-center gap-1 text-sm">
      {crumbs.map((c, i) => (
        <span key={c.href} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-[var(--t-text-muted)]" />}
          {i < crumbs.length - 1 ? (
            <Link href={c.href} className="text-[var(--t-text-muted)] hover:text-[var(--t-accent)] transition-colors">
              {c.label}
            </Link>
          ) : (
            <span className="text-[var(--t-text-primary)] font-medium">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
