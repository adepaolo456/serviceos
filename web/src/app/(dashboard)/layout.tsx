"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/sidebar";
import { ToastProvider } from "@/components/toast";
import KeyboardShortcuts from "@/components/keyboard-shortcuts";
import NotificationBell from "@/components/notification-bell";

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
      <div className="min-h-screen" style={{ backgroundColor: "var(--t-bg-primary)" }}>
        <Sidebar />
        <main className="md:pl-64">
          <div className="mx-auto max-w-[1400px] px-5 py-6 md:px-8 pt-16 md:pt-6">{children}</div>
        </main>
        <NotificationBell />
        <KeyboardShortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      </div>
    </ToastProvider>
  );
}
