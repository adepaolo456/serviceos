"use client";

import { Bell } from "lucide-react";

export default function NotificationsPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)]">Notifications</h1>
        <p className="mt-1 text-[13px] text-[var(--t-frame-text-muted)]">View and manage all your notifications.</p>
      </div>

      <div className="flex flex-col items-center justify-center rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-16">
        <Bell className="h-12 w-12 text-[var(--t-text-muted)] opacity-30 mb-4" />
        <p className="text-sm font-medium text-[var(--t-text-muted)]">Notification center coming soon</p>
        <p className="text-[13px] text-[var(--t-text-muted)] opacity-60 mt-1">All your alerts, updates, and activity in one place.</p>
      </div>
    </div>
  );
}
