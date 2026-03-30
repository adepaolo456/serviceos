"use client";

import { Truck } from "lucide-react";

export default function VehiclesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Vehicles</h1>
        <p className="mt-1 text-sm text-muted">Manage your fleet vehicles, maintenance, and assignments.</p>
      </div>
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#1E2D45] bg-dark-card p-16">
        <Truck className="h-12 w-12 text-muted/30 mb-4" />
        <p className="text-sm font-medium text-muted">Vehicle management coming soon</p>
        <p className="text-xs text-muted/60 mt-1">Track your fleet, schedule maintenance, and assign vehicles to drivers.</p>
      </div>
    </div>
  );
}
