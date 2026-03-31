"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Box,
  Briefcase,
  Truck,
  FileText,
  DollarSign,
  Settings,
  LogOut,
  Menu,
  X,
  BarChart3,
  ShieldCheck,
  Store,
  CarFront,
  Trash2,
  Sun,
  Moon,
} from "lucide-react";
import { api } from "@/lib/api";
import { useTheme } from "@/components/theme-provider";

interface UserProfile {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  tenant?: { enabledModules?: string[] };
}

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Customers", href: "/customers", icon: Users },
  { name: "Assets", href: "/assets", icon: Box },
  { name: "Jobs", href: "/jobs", icon: Briefcase },
  { name: "Dispatch", href: "/dispatch", icon: Truck },
  { name: "Dump Sites", href: "/dump-locations", icon: Trash2, module: "dump_locations" },
  { name: "Invoices", href: "/invoices", icon: FileText },
  { name: "Pricing", href: "/pricing", icon: DollarSign },
  { name: "Team", href: "/team", icon: Users },
  { name: "Vehicles", href: "/vehicles", icon: CarFront },
  { name: "Analytics", href: "/analytics", icon: BarChart3 },
  { name: "Marketplace", href: "/marketplace", icon: Store },
  { name: "Settings", href: "/settings", icon: Settings },
] as const;

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const { theme, cycleTheme } = useTheme();

  useEffect(() => {
    api
      .get<UserProfile>("/auth/profile")
      .then((p) => setUser(p))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const handleLogout = () => {
    api.clearToken();
    window.location.href = "/login";
  };

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex h-14 items-center gap-2.5 px-5 shrink-0">
        <span className="text-[17px] font-bold tracking-tight" style={{ color: "var(--t-text-primary)" }}>
          Service<span style={{ color: "var(--t-accent)" }}>OS</span>
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="space-y-0.5">
          {navigation.filter((item) => {
            if (!("module" in item) || !item.module) return true;
            const mods = user?.tenant?.enabledModules || [];
            return mods.length === 0 || mods.includes(item.module);
          }).map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <li key={item.name}>
                <Link
                  href={item.href}
                  className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[15px] transition-all duration-150"
                  style={{
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? "var(--t-accent)" : "var(--t-text-muted)",
                    backgroundColor: isActive ? "var(--t-accent-soft)" : "transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = "var(--t-bg-card-hover)";
                      e.currentTarget.style.color = "var(--t-text-primary)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = "transparent";
                      e.currentTarget.style.color = "var(--t-text-muted)";
                    }
                  }}
                >
                  <item.icon
                    className="h-[18px] w-[18px] shrink-0"
                    style={{ color: isActive ? "var(--t-accent)" : "var(--t-text-muted)" }}
                  />
                  {item.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer: User + Theme + Logout */}
      <div className="px-3 pb-4 pt-2 space-y-1 shrink-0" style={{ borderTop: "1px solid var(--t-border)" }}>
        {user && (
          <div className="flex items-center gap-3 px-3 py-2.5">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold shrink-0"
              style={{ backgroundColor: "var(--t-accent-soft)", color: "var(--t-accent)" }}
            >
              {user.firstName?.[0]}{user.lastName?.[0]}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate" style={{ color: "var(--t-text-primary)" }}>
                {user.firstName} {user.lastName}
              </p>
              <p className="text-[11px] capitalize truncate" style={{ color: "var(--t-text-muted)" }}>{user.role}</p>
            </div>
          </div>
        )}
        <button
          onClick={cycleTheme}
          className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm transition-all duration-150"
          style={{ color: "var(--t-text-muted)" }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--t-bg-card-hover)"; e.currentTarget.style.color = "var(--t-text-primary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--t-text-muted)"; }}
        >
          {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          {theme === "dark" ? "Light Mode" : "Dark Mode"}
        </button>
        {user?.email === "adepaolo456@gmail.com" && (
          <Link
            href="/admin"
            className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm transition-all duration-150"
            style={{ color: "var(--t-text-muted)" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--t-accent-soft)"; e.currentTarget.style.color = "var(--t-accent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--t-text-muted)"; }}
          >
            <ShieldCheck className="h-[18px] w-[18px]" />
            Switch to Admin
          </Link>
        )}
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm transition-all duration-150"
          style={{ color: "var(--t-text-muted)" }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--t-error-soft)"; e.currentTarget.style.color = "var(--t-error)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--t-text-muted)"; }}
        >
          <LogOut className="h-[18px] w-[18px]" />
          Log out
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-40 flex h-10 w-10 items-center justify-center rounded-xl md:hidden btn-press"
        style={{ backgroundColor: "var(--t-bg-secondary)", border: "1px solid var(--t-border)", color: "var(--t-text-muted)" }}
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col shadow-2xl"
            style={{ backgroundColor: "var(--t-bg-primary)", animationName: "slide-in-left", animationDuration: "0.25s", animationTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
          >
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 rounded-lg p-1.5"
              style={{ color: "var(--t-text-muted)" }}
            >
              <X className="h-5 w-5" />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden md:flex w-64 flex-col"
        style={{ backgroundColor: "var(--t-bg-primary)", borderRight: "1px solid var(--t-border)" }}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
