"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "https://api.rentthisapp.com";

export interface TenantInfo {
  name: string; slug: string; businessType: string;
  headline: string | null; description: string | null;
  heroImageUrl: string | null; logoUrl: string | null;
  primaryColor: string; phone: string | null; email: string | null;
  serviceArea: string | null; about: string | null;
}

const TenantContext = createContext<{ tenant: TenantInfo | null; loading: boolean }>({ tenant: null, loading: true });

export function TenantProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/public/tenant/${slug}`).then(r => r.ok ? r.json() : null).then(setTenant).catch(() => {}).finally(() => setLoading(false));
  }, [slug]);

  return <TenantContext.Provider value={{ tenant, loading }}>{children}</TenantContext.Provider>;
}

export function useTenant() { return useContext(TenantContext); }
