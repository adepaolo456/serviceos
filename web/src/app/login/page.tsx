"use client";

import { useState, useEffect, Suspense, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";

// Map OAuth callback error codes (arrive via ?error=X in URL after the
// Google flow) to operator-friendly messages. Unrecognized codes fall back
// to a generic message. Whitelist-first — matches the backend's
// KNOWN_CODES set in auth.controller.ts.
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  no_account_found:
    "No account found for this email. Contact your administrator to request access.",
  account_deactivated:
    "Your account has been deactivated. Contact your administrator.",
  email_not_verified:
    "Your Google account email isn't verified. Please verify it with Google and try again.",
  no_email: "We couldn't read your email from Google. Please try again.",
  token_exchange_failed:
    "Google sign-in couldn't complete. Please try again.",
  userinfo_failed:
    "We couldn't fetch your Google profile. Please try again.",
  google_not_configured:
    "Google sign-in isn't available right now. Please use email and password.",
  oauth_failed: "Google sign-in failed. Please try again.",
};

interface TenantOption {
  id: string;
  name: string;
  logo_url: string | null;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  };
}

type Step = "email" | "tenant" | "password";

function LoginPageInner() {
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<TenantOption | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Surface OAuth callback errors arriving via ?error=X. Whitelist-first
  // (matches backend auth.controller KNOWN_CODES); unknown → generic.
  useEffect(() => {
    const code = searchParams.get("error");
    if (!code) return;
    setError(OAUTH_ERROR_MESSAGES[code] || OAUTH_ERROR_MESSAGES.oauth_failed);
  }, [searchParams]);

  const handleEmailContinue = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await api.post<{ tenants: TenantOption[] }>("/auth/lookup-tenants", { email });

      if (data.tenants.length === 0) {
        setError("Invalid credentials");
      } else if (data.tenants.length === 1) {
        setSelectedTenant(data.tenants[0]);
        setStep("password");
      } else {
        setTenants(data.tenants);
        setStep("tenant");
      }
    } catch {
      setError("Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  const handleTenantSelect = (tenant: TenantOption) => {
    setSelectedTenant(tenant);
    setStep("password");
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await api.post<LoginResponse>("/auth/login", {
        email,
        password,
        tenantId: selectedTenant?.id,
      });
      api.setToken(data.accessToken);
      localStorage.setItem("refreshToken", data.refreshToken);
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid email or password");
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (step === "password" && tenants.length > 1) {
      setStep("tenant");
      setSelectedTenant(null);
    } else {
      setStep("email");
      setSelectedTenant(null);
      setTenants([]);
      setPassword("");
    }
    setError("");
  };

  const googleUrl = selectedTenant
    ? `${process.env.NEXT_PUBLIC_API_URL || "https://serviceos-api.vercel.app"}/auth/google?tenant_id=${selectedTenant.id}`
    : `${process.env.NEXT_PUBLIC_API_URL || "https://serviceos-api.vercel.app"}/auth/google`;

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ backgroundColor: "var(--t-bg-primary)" }}>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--t-accent)]">
            <span className="text-xl font-bold text-black">S</span>
          </div>
          <h1 className="text-[28px] font-bold tracking-[-1px]" style={{ color: "var(--t-frame-text)" }}>
            Sign in to RentThisApp
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--t-frame-text-muted)" }}>
            {step === "email" && "Enter your email to get started"}
            {step === "tenant" && "Select your company"}
            {step === "password" && (selectedTenant ? `Signing in to ${selectedTenant.name}` : "Enter your password")}
          </p>
        </div>

        <div className="rounded-[20px] p-6" style={{ backgroundColor: "var(--t-bg-secondary)", boxShadow: "0 8px 30px rgba(0,0,0,0.15)" }}>
          {error && (
            <div className="mb-4 rounded-[20px] bg-[var(--t-error-soft)] border border-[var(--t-error)] px-4 py-3 text-sm text-[var(--t-error)]">
              {error}
            </div>
          )}

          {/* Step 1: Email */}
          {step === "email" && (
            <>
              <a
                href={googleUrl}
                className="w-full flex items-center justify-center gap-3 rounded-full border border-[var(--t-border)] bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50 active:scale-[0.98]"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                Continue with Google
              </a>
              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[var(--t-border)]" /></div>
                <div className="relative flex justify-center"><span className="px-3 text-xs" style={{ backgroundColor: "var(--t-bg-secondary)", color: "var(--t-text-muted)" }}>or</span></div>
              </div>
              <form onSubmit={handleEmailContinue} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium mb-1.5" style={{ color: "var(--t-text-primary)" }}>
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2.5 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none transition-colors focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]"
                    placeholder="you@company.com"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-full bg-[var(--t-accent)] px-4 py-2.5 text-sm font-semibold text-black transition-all hover:brightness-110 disabled:opacity-50"
                >
                  {loading ? "Looking up..." : "Continue"}
                </button>
              </form>
            </>
          )}

          {/* Step 2: Tenant selector */}
          {step === "tenant" && (
            <div className="space-y-3">
              {tenants.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleTenantSelect(t)}
                  className="w-full flex items-center gap-3 rounded-[16px] border border-[var(--t-border)] p-4 text-left transition-all hover:border-[var(--t-accent)] hover:bg-[var(--t-bg-card-hover)]"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--t-accent)] text-black font-bold text-sm">
                    {t.logo_url ? (
                      <img src={t.logo_url} alt="" className="h-10 w-10 rounded-xl object-cover" />
                    ) : (
                      t.name.charAt(0).toUpperCase()
                    )}
                  </div>
                  <span className="text-sm font-medium text-[var(--t-text-primary)]">{t.name}</span>
                </button>
              ))}
              <button
                onClick={handleBack}
                className="w-full text-center text-sm text-[var(--t-text-muted)] hover:text-[var(--t-accent)] transition-colors mt-2"
              >
                Use a different email
              </button>
            </div>
          )}

          {/* Step 3: Password */}
          {step === "password" && (
            <>
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label htmlFor="password" className="block text-sm font-medium mb-1.5" style={{ color: "var(--t-text-primary)" }}>
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus
                    className="w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2.5 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none transition-colors focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]"
                    placeholder="Enter your password"
                  />
                  <div className="flex justify-end mt-2">
                    <Link
                      href="/forgot-password"
                      className="text-xs font-medium text-[var(--t-accent)] hover:brightness-110 transition-colors"
                    >
                      Forgot password?
                    </Link>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-full bg-[var(--t-accent)] px-4 py-2.5 text-sm font-semibold text-black transition-all hover:brightness-110 disabled:opacity-50"
                >
                  {loading ? "Signing in..." : "Sign In"}
                </button>
              </form>
              <button
                onClick={handleBack}
                className="w-full text-center text-sm text-[var(--t-text-muted)] hover:text-[var(--t-accent)] transition-colors mt-4"
              >
                Back
              </button>
            </>
          )}

          {step === "email" && (
            <>
              <p className="mt-6 text-center text-sm" style={{ color: "var(--t-text-muted)" }}>
                Don&apos;t have an account?{" "}
                <a href="/register" className="font-medium text-[var(--t-accent)] hover:brightness-110 transition-colors">Sign up</a>
              </p>
              <p className="mt-2 text-center text-sm" style={{ color: "var(--t-text-muted)" }}>
                Want to see it in action?{" "}
                <a href="/demo" className="font-medium text-[var(--t-accent)] hover:brightness-110 transition-colors">Request a demo</a>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Suspense boundary required because LoginPageInner calls useSearchParams()
// to read the OAuth callback ?error=X query param on mount. Next.js App
// Router disallows useSearchParams outside a Suspense boundary on a default
// export (same pattern used by site/layout.tsx).
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ backgroundColor: "var(--t-bg-primary)" }} />}>
      <LoginPageInner />
    </Suspense>
  );
}
