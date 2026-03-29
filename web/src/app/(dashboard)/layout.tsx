"use client";

import Sidebar from "@/components/sidebar";
import { ToastProvider } from "@/components/toast";

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
      </div>
    </ToastProvider>
  );
}
