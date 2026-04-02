const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://serviceos-api.vercel.app";

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
