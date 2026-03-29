"use client";

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
  Store,
  Settings,
  LogOut,
} from "lucide-react";
import { api } from "@/lib/api";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Customers", href: "/customers", icon: Users },
  { name: "Assets", href: "/assets", icon: Box },
  { name: "Jobs", href: "/jobs", icon: Briefcase },
  { name: "Dispatch", href: "/dispatch", icon: Truck },
  { name: "Invoices", href: "/invoices", icon: FileText },
  { name: "Pricing", href: "/pricing", icon: DollarSign },
  { name: "Marketplace", href: "/marketplace", icon: Store },
  { name: "Settings", href: "/settings", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();

  const handleLogout = () => {
    api.clearToken();
    window.location.href = "/login";
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-dark-secondary border-r border-white/5">
      <div className="flex h-16 items-center gap-3 px-6 border-b border-white/5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand">
          <span className="text-sm font-bold text-dark-primary">S</span>
        </div>
        <span className="font-display text-lg font-bold tracking-tight text-white">
          ServiceOS
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {navigation.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <li key={item.name}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-brand/10 text-brand"
                      : "text-muted hover:bg-dark-card hover:text-foreground"
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

      <div className="border-t border-white/5 p-3">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-dark-card hover:text-foreground"
        >
          <LogOut className="h-[18px] w-[18px]" />
          Log out
        </button>
      </div>
    </aside>
  );
}
