import { FEATURE_REGISTRY } from "@/lib/feature-registry";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://api.rentthisapp.com";

/**
 * Translates raw backend error keys into portal-friendly, registry-driven
 * messages. The API throws internal keys like `edit_job_date_error_before_drop_off`
 * that are fine for the operator dashboard but leak internal vocabulary to
 * customers. Unknown keys fall through to a generic registry label, so no
 * raw internal strings ever reach a portal user.
 */
export function resolvePortalErrorMessage(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "";
  const portalKeyByBackendKey: Record<string, string> = {
    edit_job_date_error_before_drop_off: "portal_error_early_pickup_before_delivery",
    edit_job_date_error_after_pickup: "portal_error_reschedule_after_pickup",
    edit_job_date_error_after_exchange: "portal_error_reschedule_after_pickup",
    edit_job_date_error_invalid: "portal_error_invalid_date",
    edit_job_date_error_past_date: "portal_error_past_date",
  };
  const portalKey = portalKeyByBackendKey[msg];
  if (portalKey) return FEATURE_REGISTRY[portalKey]?.label ?? FEATURE_REGISTRY.portal_error_generic?.label ?? "Something went wrong.";
  // Any other Error or non-mapped message — fall back to the generic
  // registry label so internal keys never render in the portal UI.
  return FEATURE_REGISTRY.portal_error_generic?.label ?? "Something went wrong.";
}

class PortalApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("portal_token");
  }

  setToken(token: string) {
    localStorage.setItem("portal_token", token);
  }

  clearToken() {
    localStorage.removeItem("portal_token");
  }

  getCustomer(): { id: string; firstName: string; lastName: string; email: string } | null {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem("portal_customer");
    return raw ? JSON.parse(raw) : null;
  }

  setCustomer(c: { id: string; firstName: string; lastName: string; email: string }) {
    localStorage.setItem("portal_customer", JSON.stringify(c));
  }

  clearCustomer() {
    localStorage.removeItem("portal_customer");
  }

  getTenantId(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("portalTenantId");
  }

  setTenantId(id: string) {
    localStorage.setItem("portalTenantId", id);
  }

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) || {}),
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${this.baseUrl}${endpoint}`, { ...options, headers });

    if (res.status === 401) {
      this.clearToken();
      this.clearCustomer();
      if (typeof window !== "undefined") window.location.href = "/portal/login";
      throw new Error("Unauthorized");
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error((error as { message?: string }).message || `Request failed: ${res.status}`);
    }

    if (res.status === 204) return {} as T;
    return res.json() as Promise<T>;
  }

  get<T>(endpoint: string) { return this.request<T>(endpoint); }
  post<T>(endpoint: string, data?: unknown) {
    return this.request<T>(endpoint, { method: "POST", body: data ? JSON.stringify(data) : undefined });
  }
  patch<T>(endpoint: string, data?: unknown) {
    return this.request<T>(endpoint, { method: "PATCH", body: data ? JSON.stringify(data) : undefined });
  }
}

export const portalApi = new PortalApiClient(API_BASE);
