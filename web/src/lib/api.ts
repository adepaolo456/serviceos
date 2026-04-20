const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://serviceos-api.vercel.app";

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("accessToken");
  }

  setToken(token: string) {
    localStorage.setItem("accessToken", token);
  }

  // Store both tokens from a login-equivalent response (login, password
  // reset auto-login, etc.). Centralizes the two-key localStorage pattern.
  setAuthTokens({ accessToken, refreshToken }: { accessToken: string; refreshToken: string }) {
    localStorage.setItem("accessToken", accessToken);
    localStorage.setItem("refreshToken", refreshToken);
  }

  clearToken() {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
  }

  async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) || {}),
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (res.status === 401) {
      this.clearToken();
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
      throw new Error("Unauthorized");
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      // Phase 2 (Dispatch Prepayment UX) — attach the parsed error
      // body to the thrown Error so callers can introspect structured
      // fields (e.g., `code`, `hold.override_allowed`) without
      // substring-matching the message. Backwards compatible: existing
      // `err.message` callers continue to work unchanged.
      const err = new Error(
        (error as { message?: string }).message ||
          `Request failed: ${res.status}`,
      );
      (err as Error & { body?: unknown; status?: number }).body = error;
      (err as Error & { body?: unknown; status?: number }).status = res.status;
      throw err;
    }

    if (res.status === 204) return {} as T;
    const text = await res.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  get<T>(endpoint: string) {
    return this.request<T>(endpoint);
  }

  post<T>(endpoint: string, data?: unknown) {
    return this.request<T>(endpoint, {
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  patch<T>(endpoint: string, data?: unknown) {
    return this.request<T>(endpoint, {
      method: "PATCH",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  put<T>(endpoint: string, data?: unknown) {
    return this.request<T>(endpoint, {
      method: "PUT",
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  delete<T>(endpoint: string) {
    return this.request<T>(endpoint, { method: "DELETE" });
  }
}

export const api = new ApiClient(API_BASE);
