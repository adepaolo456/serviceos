"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/sidebar";
import { SidebarProvider, useSidebar } from "@/components/sidebar-context";
import { ToastProvider } from "@/components/toast";
import KeyboardShortcuts from "@/components/keyboard-shortcuts";
import NotificationBell from "@/components/notification-bell";

function DashboardContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { collapsed } = useSidebar();
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
    <div className="min-h-screen" style={{ backgroundColor: "var(--t-bg-primary)" }}>
      <Sidebar />
      <main
        style={{
          paddingLeft: undefined,
          transition: "padding-left 0.2s ease",
        }}
        className={collapsed ? "md:pl-[72px]" : "md:pl-64"}
      >
        <div className="mx-auto max-w-[1400px] px-5 py-6 md:px-8 md:pr-14 pt-16 md:pt-6" style={{ color: "var(--t-frame-text)" }}>{children}</div>
      </main>
      <NotificationBell />
      <KeyboardShortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <ToastProvider>
        <DashboardContent>{children}</DashboardContent>
      </ToastProvider>
    </SidebarProvider>
  );
}
