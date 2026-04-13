"use client";

/**
 * Phase B17 — Dynamic rental detail route.
 *
 * Moving the detail view off /portal/rentals?id= onto a real dynamic
 * route /portal/rentals/[id] means list and detail are now distinct
 * pathnames. The previous bugs where router.replace to the same
 * pathname didn't flush useSearchParams reactivity are no longer
 * reachable — navigating between list and detail is always a real
 * pathname change, which Next.js handles deterministically.
 */

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Package } from "lucide-react";
import { portalApi } from "@/lib/portal-api";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import PortalRentalDetailView, { type PortalRental } from "@/components/portal-rental-detail-view";

export default function PortalRentalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [rentals, setRentals] = useState<PortalRental[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    portalApi
      .get<PortalRental[]>("/portal/rentals")
      .then(setRentals)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const rental = rentals.find(r => r.id === id) ?? null;

  const onBack = () => router.push("/portal/rentals");
  const onUpdate = (updated: PortalRental) => {
    setRentals(prev => prev.map(r => (r.id === updated.id ? updated : r)));
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-5 w-32 rounded-md bg-[var(--t-bg-card)] border border-[var(--t-border)] animate-pulse" />
        <div className="h-64 rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] animate-pulse" />
        <div className="h-32 rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] animate-pulse" />
      </div>
    );
  }

  if (!rental) {
    return (
      <div className="rounded-[20px] border border-dashed border-[var(--t-border)] bg-[var(--t-bg-card)] p-8 text-center">
        <Package className="mx-auto h-10 w-10 text-[var(--t-text-muted)]/30 mb-3" />
        <p className="text-sm font-semibold text-[var(--t-text-primary)]">
          {FEATURE_REGISTRY.portal_rental_not_found?.label ?? "Rental not found"}
        </p>
        <p className="text-xs text-[var(--t-text-muted)] mt-1">
          {FEATURE_REGISTRY.portal_rental_not_found_hint?.label ?? "This rental may have been removed or you may not have access to it."}
        </p>
        <Link
          href="/portal/rentals"
          className="mt-4 inline-flex items-center rounded-full bg-[var(--t-accent)] px-4 py-2 text-xs font-semibold text-[var(--t-accent-on-accent)] hover:opacity-90 transition-opacity"
        >
          {FEATURE_REGISTRY.portal_rentals_back?.label ?? "Back to rentals"}
        </Link>
      </div>
    );
  }

  return (
    <PortalRentalDetailView
      rental={rental}
      rentals={rentals}
      onBack={onBack}
      onUpdate={onUpdate}
    />
  );
}
