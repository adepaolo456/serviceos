import { useState, useEffect } from "react";
import { api } from "./api";

interface TenantModules {
  businessType: string;
  enabledModules: string[];
  loading: boolean;
}

// Phase B3 — this file now caches the full slice of `/auth/profile`
// that cross-page hooks care about (modules AND timezone), so both
// `useModules` and `useTenantTimezone` share a single fetch. Adding
// a separate fetch just for timezone would violate the "no new fetch
// for timezone" rule; co-locating the cache here avoids that while
// keeping the existing `useModules` API unchanged.
interface CachedProfile {
  businessType: string;
  enabledModules: string[];
  timezone: string | null;
}

let cachedProfile: CachedProfile | null = null;
let inflight: Promise<CachedProfile> | null = null;

interface ProfileResponse {
  tenant?: {
    businessType?: string;
    enabledModules?: string[];
    timezone?: string | null;
  };
}

function loadProfile(): Promise<CachedProfile> {
  if (cachedProfile) return Promise.resolve(cachedProfile);
  if (inflight) return inflight;
  inflight = api
    .get<ProfileResponse>("/auth/profile")
    .then((p) => {
      const result: CachedProfile = {
        businessType: p.tenant?.businessType || "waste",
        enabledModules: p.tenant?.enabledModules || [],
        timezone: p.tenant?.timezone ?? null,
      };
      cachedProfile = result;
      return result;
    })
    .catch(() => {
      const fallback: CachedProfile = {
        businessType: "waste",
        enabledModules: [],
        timezone: null,
      };
      cachedProfile = fallback;
      return fallback;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useModules(): TenantModules {
  const [data, setData] = useState<CachedProfile>(
    cachedProfile || { businessType: "waste", enabledModules: [], timezone: null }
  );
  const [loading, setLoading] = useState(!cachedProfile);

  useEffect(() => {
    if (cachedProfile) return;
    loadProfile()
      .then((p) => setData(p))
      .finally(() => setLoading(false));
  }, []);

  return {
    businessType: data.businessType,
    enabledModules: data.enabledModules,
    loading,
  };
}

/**
 * Phase B3 — tenant-wide timezone hook. Shares the `/auth/profile`
 * cache with `useModules` so there is no extra fetch. Returns the
 * tenant's IANA timezone string (e.g. "America/New_York") or
 * `undefined` while the profile is still loading. Consumers pass
 * the value directly to `getTenantToday(tz)` /
 * `getTenantDateRangeToday(tz)` from `@/lib/utils/tenantDate`,
 * which fall back to 'America/New_York' when the argument is
 * undefined — so the first render before the profile resolves is
 * already tenant-safe for default-timezone tenants.
 */
export function useTenantTimezone(): string | undefined {
  const [tz, setTz] = useState<string | undefined>(
    cachedProfile?.timezone ?? undefined
  );

  useEffect(() => {
    if (cachedProfile) {
      setTz(cachedProfile.timezone ?? undefined);
      return;
    }
    loadProfile().then((p) => setTz(p.timezone ?? undefined));
  }, []);

  return tz;
}

export function isModuleEnabled(enabledModules: string[], mod: string): boolean {
  return enabledModules.includes(mod);
}

/** Default modules per business type */
export const VERTICAL_DEFAULTS: Record<string, { label: string; modules: string[] }> = {
  waste: { label: "Waste & Dumpster Rental", modules: ["dump_slips", "weight_tickets", "overage_items", "dump_locations", "asset_pins"] },
  storage: { label: "Storage Container Rental", modules: ["storage_units", "access_codes", "climate_control"] },
  restrooms: { label: "Portable Restrooms", modules: ["service_schedules", "cleaning_logs", "route_optimization"] },
  equipment: { label: "Equipment Rental", modules: ["maintenance_logs", "inspection_checklists", "rental_agreements"] },
  general: { label: "General / Other", modules: [] },
};
