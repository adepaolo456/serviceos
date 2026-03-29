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
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { api } from "@/lib/api";
import { useTheme } from "@/components/theme-provider";

interface UserProfile {
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Customers", href: "/customers", icon: Users },
  { name: "Assets", href: "/assets", icon: Box },
  { name: "Jobs", href: "/jobs", icon: Briefcase },
  { name: "Dispatch", href: "/dispatch", icon: Truck },
  { name: "Invoices", href: "/invoices", icon: FileText },
  { name: "Pricing", href: "/pricing", icon: DollarSign },
  { name: "Team", href: "/team", icon: Users },
  { name: "Analytics", href: "/analytics", icon: BarChart3 },
  { name: "Settings", href: "/settings", icon: Settings },
];

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
      <div className="flex h-16 items-center gap-3 px-6 border-b border-[#1E2D45] shrink-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand shadow-md shadow-brand/20">
          <span className="font-display text-sm font-bold text-dark-primary">S</span>
        </div>
        <span className="font-display text-lg font-bold tracking-tight text-white">
          ServiceOS
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-0.5">
          {navigation.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <li key={item.name}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all btn-press ${
                    isActive
                      ? "bg-brand/10 text-brand border-l-2 border-brand pl-[10px]"
                      : "text-muted hover:bg-[#1A2740]/50 hover:text-white border-l-2 border-transparent pl-[10px]"
                  }`}
                >
                  <item.icon className="h-[18px] w-[18px]" />
                  {item.name}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User profile + admin switch + logout */}
      <div className="border-t border-[#1E2D45] p-3 space-y-1 shrink-0">
        {user && (
          <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/15 text-xs font-bold text-brand">
              {user.firstName?.[0]}{user.lastName?.[0]}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white truncate">
                {user.firstName} {user.lastName}
              </p>
              <p className="text-[11px] text-muted capitalize truncate">{user.role}</p>
            </div>
          </div>
        )}
        {user?.email === "adepaolo456@gmail.com" && (
          <Link
            href="/admin"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted transition-all hover:bg-brand/10 hover:text-brand btn-press"
          >
            <ShieldCheck className="h-[18px] w-[18px]" />
            Switch to Admin
          </Link>
        )}
        <div className="px-3 py-1.5">
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); cycleTheme(); }}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-[#1E2D45] bg-dark-elevated/50 px-3 py-1.5 text-xs font-medium text-muted transition-all hover:bg-dark-elevated hover:text-foreground active:scale-95"
            type="button"
          >
            {theme === "dark" ? <Moon className="h-3.5 w-3.5" /> : theme === "light" ? <Sun className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
            {theme === "dark" ? "Dark" : theme === "light" ? "Light" : "System"}
          </button>
        </div>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted transition-all hover:bg-red-500/10 hover:text-red-400 btn-press"
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
        className="fixed top-4 left-4 z-40 flex h-10 w-10 items-center justify-center rounded-lg bg-dark-secondary border border-[#1E2D45] text-muted md:hidden btn-press"
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
          <aside className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-dark-secondary animate-slide-in-right shadow-2xl"
            style={{ animationName: "slide-in-left" }}
          >
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 rounded-lg p-1.5 text-muted hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden md:flex w-64 flex-col bg-dark-secondary border-r border-[#1E2D45]">
        {sidebarContent}
      </aside>
    </>
  );
}
