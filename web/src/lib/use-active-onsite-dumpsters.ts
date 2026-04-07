"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";

export interface OnsiteDumpster {
  jobId: string | null;
  assetId: string | null;
  size: string;
  deliveredAt: string;
  address: string | null;
  rentalChainId: string;
  assetIdentifier: string | null;
}

interface ActiveOnsiteResponse {
  hasActiveOnsite: boolean;
  dumpsters: OnsiteDumpster[];
}

export interface SiteAddressComponents {
  street: string;
  city: string;
  state: string;
  zip: string;
}

interface UseActiveOnsiteDumpstersOpts {
  customerId: string | undefined;
  siteAddress: SiteAddressComponents | undefined;
  enabled?: boolean;
}

interface UseActiveOnsiteDumpstersResult {
  hasActiveOnsite: boolean;
  dumpsters: OnsiteDumpster[];
  isLoading: boolean;
}

const DEBOUNCE_MS = 300;

/**
 * Detects active on-site dumpsters for a customer + site address combo.
 *
 * - Only fetches when both customerId and siteAddress (with street+city+state) are present
 * - Debounces address-driven changes by 300ms
 * - Session-level cache keyed by normalized customerId + address components
 * - Resets when address is cleared or customer changes
 */
export function useActiveOnsiteDumpsters({
  customerId,
  siteAddress,
  enabled = true,
}: UseActiveOnsiteDumpstersOpts): UseActiveOnsiteDumpstersResult {
  const [hasActiveOnsite, setHasActiveOnsite] = useState(false);
  const [dumpsters, setDumpsters] = useState<OnsiteDumpster[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const cacheRef = useRef<Map<string, ActiveOnsiteResponse>>(new Map());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setHasActiveOnsite(false);
    setDumpsters([]);
    setIsLoading(false);
  }, []);

  // Stable serialized key for siteAddress to avoid re-renders
  const addressKey = siteAddress
    ? `${siteAddress.street}|${siteAddress.city}|${siteAddress.state}|${siteAddress.zip}`.toLowerCase()
    : "";

  useEffect(() => {
    // Clear pending debounce on any input change
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    // Need both signals to run detection
    if (!enabled || !customerId || !addressKey) {
      reset();
      return;
    }

    const cacheKey = `${customerId}::${addressKey}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setHasActiveOnsite(cached.hasActiveOnsite);
      setDumpsters(cached.dumpsters);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    debounceRef.current = setTimeout(async () => {
      // Cancel any in-flight request
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const params = new URLSearchParams({ customerId });
        if (siteAddress) {
          params.set("street", siteAddress.street);
          params.set("city", siteAddress.city);
          params.set("state", siteAddress.state);
          if (siteAddress.zip) params.set("zip", siteAddress.zip);
        }

        const res = await api.get<ActiveOnsiteResponse>(
          `/jobs/active-onsite?${params.toString()}`,
        );

        if (controller.signal.aborted) return;

        cacheRef.current.set(cacheKey, res);
        setHasActiveOnsite(res.hasActiveOnsite);
        setDumpsters(res.dumpsters);
      } catch {
        if (controller.signal.aborted) return;
        setHasActiveOnsite(false);
        setDumpsters([]);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, addressKey, enabled, reset]);

  return { hasActiveOnsite, dumpsters, isLoading };
}
