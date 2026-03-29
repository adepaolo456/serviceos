"use client";

import Sidebar from "@/components/sidebar";
import { ToastProvider } from "@/components/toast";
import { useTheme } from "@/components/theme-provider";
import { Moon, Sun, Monitor } from "lucide-react";

function ThemeToggle() {
  const { theme, cycleTheme } = useTheme();
  return (
    <button type="button" onClick={() => cycleTheme()} className="fixed top-4 right-4 z-[9999] p-2 rounded-lg bg-dark-card border border-dark-elevated shadow-lg">
      {theme === "dark" ? <Moon className="h-4 w-4" /> : theme === "light" ? <Sun className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
    </button>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <div className="min-h-screen bg-dark-primary">
        <Sidebar />
        <main className="md:pl-64">
          <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 pt-16 md:pt-6">{children}</div>
        </main>
        <ThemeToggle />
      </div>
    </ToastProvider>
  );
}
