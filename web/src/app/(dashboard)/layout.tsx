"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/sidebar";
import { ToastProvider } from "@/components/toast";
import { useTheme } from "@/components/theme-provider";
import KeyboardShortcuts from "@/components/keyboard-shortcuts";
import { Moon, Sun } from "lucide-react";
import NotificationBell from "@/components/notification-bell";

function ThemeToggle() {
  const { theme, cycleTheme } = useTheme();
  return (
    <button type="button" onClick={() => cycleTheme()} className="fixed top-4 right-4 z-[9999] p-2 rounded-lg bg-dark-card border border-dark-elevated shadow-lg">
      {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </button>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setShortcutsOpen(true); }
      if (e.key === "b" || e.key === "B") { if (!e.ctrlKey && !e.metaKey) router.push("/book"); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router]);

  return (
    <ToastProvider>
      <div className="min-h-screen bg-dark-primary">
        <Sidebar />
        <main className="md:pl-64">
          <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 pt-16 md:pt-6">{children}</div>
        </main>
        <NotificationBell />
        <ThemeToggle />
        <KeyboardShortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      </div>
    </ToastProvider>
  );
}
