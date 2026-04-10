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
  FileCheck,
  DollarSign,
  Settings,
  LogOut,
  Menu,
  X,
  BarChart3,
  Shield,
  ShieldCheck,
  Store,
  CarFront,
  Trash2,
  AlertTriangle,
  Bell,
  HelpCircle,
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Globe,
} from "lucide-react";
import { api } from "@/lib/api";
import { useTheme } from "@/components/theme-provider";
import { useSidebar } from "@/components/sidebar-context";
import { useQuickQuote } from "@/components/quick-quote-provider";
import { getFeatureLabel } from "@/lib/feature-registry";

interface UserProfile {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  tenant?: { enabledModules?: string[] };
}

const navigation: ReadonlyArray<{
  name: string; href: string; icon: typeof LayoutDashboard;
  module?: string; roles?: readonly string[];
}> = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Customers", href: "/customers", icon: Users },
  { name: "Assets", href: "/assets", icon: Box },
  { name: "Jobs", href: "/jobs", icon: Briefcase },
  { name: "Dispatch", href: "/dispatch", icon: Truck },
  { name: "Dump Sites", href: "/dump-locations", icon: Trash2, module: "dump_locations" },
  { name: "Invoices", href: "/invoices", icon: FileText },
  { name: "Quotes", href: "/quotes", icon: FileCheck },
  { name: "Billing Issues", href: "/billing-issues", icon: AlertTriangle },
  { name: "Pricing Issues", href: "/pricing-qa", icon: Shield },
  { name: "Notifications", href: "/notifications", icon: Bell },
  { name: "Pricing", href: "/pricing", icon: DollarSign },
  { name: "Team", href: "/team", icon: Users },
  { name: "Vehicles", href: "/vehicles", icon: CarFront },
  { name: "Analytics", href: "/analytics", icon: BarChart3 },
  { name: "Portal Activity", href: "/portal-activity", icon: Globe, roles: ["owner", "admin", "dispatcher"] },
  { name: "Credit Analytics", href: "/credit-analytics", icon: BarChart3, roles: ["owner", "admin"] },
  { name: "Credit Audit", href: "/credit-audit", icon: Shield, roles: ["owner", "admin"] },
  { name: "Credit Queue", href: "/credit-queue", icon: ClipboardList, roles: ["owner", "admin"] },
  { name: "Marketplace", href: "/marketplace", icon: Store },
  { name: "Settings", href: "/settings", icon: Settings },
  { name: "Help Center", href: "/help", icon: HelpCircle },
];


/* ---- Tooltip for collapsed mode ---- */
function NavTooltip({ label, show }: { label: string; show: boolean }) {
  if (!show) return null;
  return (
    <div
      className="absolute left-full ml-3 top-1/2 -translate-y-1/2 z-50 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium pointer-events-none"
      style={{
        backgroundColor: "var(--t-bg-card)",
        border: "1px solid var(--t-frame-border)",
        color: "var(--t-frame-text)",
        boxShadow: "0 4px 12px var(--t-shadow-lg)",
      }}
    >
      {label}
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [billingIssueCount, setBillingIssueCount] = useState(0);
  const [pricingQaCount, setPricingQaCount] = useState(0);
  const { theme, cycleTheme } = useTheme();
  const { collapsed, toggleCollapsed } = useSidebar();
  const { openQuickQuote } = useQuickQuote();

  useEffect(() => {
    api
      .get<UserProfile>("/auth/profile")
      .then((p) => setUser(p))
      .catch(() => {});
    api
      .get<{ total: number }>("/billing-issues/summary")
      .then((s) => setBillingIssueCount(s.total || 0))
      .catch(() => {});
    api
      .get<{ summary: { actionable_count: number } }>("/pricing-qa/overview")
      .then((d) => setPricingQaCount(d.summary.actionable_count || 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const handleLogout = () => {
    api.clearToken();
    window.location.href = "/login";
  };

  const filteredNav = navigation.filter((item) => {
    // Module gating
    if (item.module) {
      const mods = user?.tenant?.enabledModules || [];
      if (mods.length > 0 && !mods.includes(item.module)) return false;
    }
    // Role gating
    if (item.roles) {
      if (!user?.role || !item.roles.includes(user.role)) return false;
    }
    return true;
  });

  /* ---- Full sidebar content (for mobile + expanded desktop) ---- */
  const fullSidebarContent = (
    <>
      <div className="flex h-14 items-center gap-2.5 px-5 shrink-0">
        <span className="text-[17px] font-bold tracking-tight" style={{ color: "var(--t-frame-text)" }}>
          Service<span style={{ color: "var(--t-accent)" }}>OS</span>
        </span>
      </div>

      <div className="px-3 pt-2">
        <button
          onClick={() => openQuickQuote()}
          className="flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
          style={{ backgroundColor: "var(--t-accent)", color: "#fff" }}
        >
          <DollarSign className="h-4 w-4" /> {getFeatureLabel("quick_quote")}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="space-y-0.5">
          {filteredNav.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <li key={item.name}>
                <Link
                  href={item.href}
                  className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[15px] transition-all duration-150"
                  style={{
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? "var(--t-accent)" : "var(--t-frame-text-muted)",
                    backgroundColor: isActive ? "var(--t-accent-soft)" : "transparent",
                  }}
                  onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.backgroundColor = "var(--t-frame-hover)"; e.currentTarget.style.color = "var(--t-frame-text)"; } }}
                  onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--t-frame-text-muted)"; } }}
                >
                  <item.icon className="h-[18px] w-[18px] shrink-0" style={{ color: isActive ? "var(--t-accent)" : "var(--t-frame-text-muted)" }} />
                  {item.name}
                  {(item.name === "Invoices" || item.name === "Billing Issues") && billingIssueCount > 0 && (
                    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white" style={{ background: "var(--t-error)" }}>
                      {billingIssueCount}
                    </span>
                  )}
                  {item.name === "Pricing Issues" && pricingQaCount > 0 && (
                    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white" style={{ background: "var(--t-warning)" }}>
                      {pricingQaCount}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

      </nav>

      <div className="px-3 pb-4 pt-2 space-y-1 shrink-0" style={{ borderTop: "1px solid var(--t-frame-border)" }}>
        {user && (
          <div className="flex items-center gap-3 px-3 py-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold shrink-0" style={{ backgroundColor: "var(--t-accent-soft)", color: "var(--t-accent)" }}>
              {user.firstName?.[0]}{user.lastName?.[0]}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate" style={{ color: "var(--t-frame-text)" }}>{user.firstName} {user.lastName}</p>
              <p className="text-[11px] capitalize truncate" style={{ color: "var(--t-frame-text-muted)" }}>{user.role}</p>
            </div>
          </div>
        )}
        <button onClick={cycleTheme} className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm transition-all duration-150" style={{ color: "var(--t-frame-text-muted)" }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--t-frame-hover)"; e.currentTarget.style.color = "var(--t-frame-text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--t-frame-text-muted)"; }}
        >
          {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          {theme === "dark" ? "Light Mode" : "Dark Mode"}
        </button>
        {user?.email === "adepaolo456@gmail.com" && (
          <Link href="/admin" className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm transition-all duration-150" style={{ color: "var(--t-frame-text-muted)" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--t-accent-soft)"; e.currentTarget.style.color = "var(--t-accent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--t-frame-text-muted)"; }}
          >
            <ShieldCheck className="h-[18px] w-[18px]" /> Switch to Admin
          </Link>
        )}
        <button onClick={handleLogout} className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm transition-all duration-150" style={{ color: "var(--t-frame-text-muted)" }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--t-error-soft)"; e.currentTarget.style.color = "var(--t-error)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--t-frame-text-muted)"; }}
        >
          <LogOut className="h-[18px] w-[18px]" /> Log out
        </button>
      </div>
    </>
  );

  /* ---- Collapsed desktop sidebar content ---- */
  const collapsedSidebarContent = (
    <>
      {/* Logo — just green "OS" */}
      <div className="flex h-14 items-center justify-center shrink-0">
        <span className="text-[15px] font-bold" style={{ color: "var(--t-accent)" }}>OS</span>
      </div>

      {/* Quick Quote — icon only */}
      <div className="flex justify-center pt-2">
        <button
          onClick={() => openQuickQuote()}
          className="flex h-10 w-10 items-center justify-center rounded-full transition-opacity hover:opacity-90"
          style={{ backgroundColor: "var(--t-accent)", color: "#fff" }}
        >
          <DollarSign className="h-4 w-4" />
        </button>
      </div>

      {/* Nav — icons only with tooltips */}
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        <ul className="space-y-1">
          {filteredNav.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <li key={item.name} className="relative">
                <Link
                  href={item.href}
                  className="flex items-center justify-center h-11 w-11 mx-auto rounded-[10px] transition-all duration-150"
                  style={{
                    color: isActive ? "var(--t-accent)" : "var(--t-frame-text-muted)",
                    backgroundColor: isActive ? "var(--t-accent-soft)" : "transparent",
                  }}
                  onMouseEnter={(e) => {
                    setHoveredItem(item.name);
                    if (!isActive) { e.currentTarget.style.backgroundColor = "var(--t-frame-hover)"; e.currentTarget.style.color = "var(--t-frame-text)"; }
                  }}
                  onMouseLeave={(e) => {
                    setHoveredItem(null);
                    if (!isActive) { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--t-frame-text-muted)"; }
                  }}
                >
                  <item.icon className="h-[18px] w-[18px]" />
                </Link>
                <NavTooltip label={item.name} show={hoveredItem === item.name} />
              </li>
            );
          })}
        </ul>

      </nav>

      {/* Footer — icons only */}
      <div className="px-2 pb-4 pt-2 space-y-1 shrink-0 flex flex-col items-center" style={{ borderTop: "1px solid var(--t-frame-border)" }}>
        {user && (
          <div className="relative" onMouseEnter={() => setHoveredItem("_user")} onMouseLeave={() => setHoveredItem(null)}>
            <div className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold" style={{ backgroundColor: "var(--t-accent-soft)", color: "var(--t-accent)" }}>
              {user.firstName?.[0]}{user.lastName?.[0]}
            </div>
            <NavTooltip label={`${user.firstName} ${user.lastName}`} show={hoveredItem === "_user"} />
          </div>
        )}
        <div className="relative" onMouseEnter={() => setHoveredItem("_theme")} onMouseLeave={() => setHoveredItem(null)}>
          <button onClick={cycleTheme} className="flex h-11 w-11 items-center justify-center rounded-[10px] transition-all duration-150" style={{ color: "var(--t-frame-text-muted)" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--t-frame-hover)"; e.currentTarget.style.color = "var(--t-frame-text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--t-frame-text-muted)"; }}
          >
            {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          </button>
          <NavTooltip label={theme === "dark" ? "Light Mode" : "Dark Mode"} show={hoveredItem === "_theme"} />
        </div>
        {user?.email === "adepaolo456@gmail.com" && (
          <div className="relative" onMouseEnter={() => setHoveredItem("_admin")} onMouseLeave={() => setHoveredItem(null)}>
            <Link href="/admin" className="flex h-11 w-11 items-center justify-center rounded-[10px] transition-all duration-150" style={{ color: "var(--t-frame-text-muted)" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--t-accent-soft)"; e.currentTarget.style.color = "var(--t-accent)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--t-frame-text-muted)"; }}
            >
              <ShieldCheck className="h-[18px] w-[18px]" />
            </Link>
            <NavTooltip label="Switch to Admin" show={hoveredItem === "_admin"} />
          </div>
        )}
        <div className="relative" onMouseEnter={() => setHoveredItem("_logout")} onMouseLeave={() => setHoveredItem(null)}>
          <button onClick={handleLogout} className="flex h-11 w-11 items-center justify-center rounded-[10px] transition-all duration-150" style={{ color: "var(--t-frame-text-muted)" }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--t-error-soft)"; e.currentTarget.style.color = "var(--t-error)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "var(--t-frame-text-muted)"; }}
          >
            <LogOut className="h-[18px] w-[18px]" />
          </button>
          <NavTooltip label="Log out" show={hoveredItem === "_logout"} />
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-40 flex h-10 w-10 items-center justify-center rounded-xl md:hidden btn-press"
        style={{ backgroundColor: "var(--t-frame-bg)", border: "1px solid var(--t-frame-border)", color: "var(--t-frame-text-muted)" }}
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay — always full expanded */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setMobileOpen(false)} />
          <aside
            className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col shadow-2xl"
            style={{ backgroundColor: "var(--t-frame-bg)", animationName: "slide-in-left", animationDuration: "0.25s", animationTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
          >
            <button onClick={() => setMobileOpen(false)} className="absolute top-4 right-4 rounded-lg p-1.5" style={{ color: "var(--t-frame-text-muted)" }}>
              <X className="h-5 w-5" />
            </button>
            {fullSidebarContent}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden md:flex flex-col"
        style={{
          width: collapsed ? 72 : 256,
          backgroundColor: "var(--t-frame-bg)",
          borderRight: "1px solid var(--t-frame-border)",
          transition: "width 0.2s ease",
        }}
      >
        {collapsed ? collapsedSidebarContent : fullSidebarContent}

        {/* Collapse toggle */}
        <button
          onClick={toggleCollapsed}
          className="absolute -right-3 top-7 z-40 flex h-6 w-6 items-center justify-center rounded-full transition-all duration-150"
          style={{
            backgroundColor: "var(--t-bg-card)",
            border: "1px solid var(--t-frame-border)",
            color: "var(--t-frame-text-muted)",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-frame-text)"; e.currentTarget.style.borderColor = "var(--t-accent)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-frame-text-muted)"; e.currentTarget.style.borderColor = "var(--t-frame-border)"; }}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        </button>
      </aside>
    </>
  );
}
