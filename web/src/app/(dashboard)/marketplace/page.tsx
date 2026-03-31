"use client";

import { Store } from "lucide-react";

export default function MarketplacePage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-text-primary)]">RentThis Marketplace</h1>
        <p className="mt-1 text-[13px] text-[var(--t-text-muted)]">Discover services and grow your business.</p>
      </div>

      <div className="flex flex-col items-center justify-center rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-20">
        <Store className="h-14 w-14 text-[var(--t-text-muted)] opacity-30 mb-5" />
        <p className="text-lg font-semibold text-[var(--t-text-primary)]">Coming soon</p>
        <p className="text-[13px] text-[var(--t-text-muted)] mt-2 max-w-sm text-center">
          The RentThis Marketplace will connect you with customers looking for dumpster rentals, portable storage, and more.
        </p>
      </div>
    </div>
  );
}
