"use client";

import { Bell } from "lucide-react";

export default function NotificationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Notifications</h1>
        <p className="mt-1 text-sm text-muted">View and manage all your notifications.</p>
      </div>
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#1E2D45] bg-dark-card p-16">
        <Bell className="h-12 w-12 text-muted/30 mb-4" />
        <p className="text-sm font-medium text-muted">Notification center coming soon</p>
        <p className="text-xs text-muted/60 mt-1">All your alerts, updates, and activity in one place.</p>
      </div>
    </div>
  );
}
