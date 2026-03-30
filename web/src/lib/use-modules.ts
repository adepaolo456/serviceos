import { useState, useEffect } from "react";
import { api } from "./api";

interface TenantModules {
  businessType: string;
  enabledModules: string[];
  loading: boolean;
}

let cachedModules: { businessType: string; enabledModules: string[] } | null = null;

export function useModules(): TenantModules {
  const [data, setData] = useState<{ businessType: string; enabledModules: string[] }>(
    cachedModules || { businessType: "waste", enabledModules: [] }
  );
  const [loading, setLoading] = useState(!cachedModules);

  useEffect(() => {
    if (cachedModules) return;
    api.get<{ tenant: { businessType: string; enabledModules: string[] } }>("/auth/profile")
      .then((p) => {
        const modules = {
          businessType: p.tenant?.businessType || "waste",
          enabledModules: p.tenant?.enabledModules || [],
        };
        cachedModules = modules;
        setData(modules);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { ...data, loading };
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
