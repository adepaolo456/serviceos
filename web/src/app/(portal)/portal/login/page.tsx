"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { portalApi } from "@/lib/portal-api";
import { Mail, Lock, ArrowRight } from "lucide-react";

interface AuthResponse {
  token: string;
  customer: { id: string; firstName: string; lastName: string; email: string };
}

export default function PortalLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [magicSent, setMagicSent] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/portal/auth/login" : "/portal/auth/register";
      const data = await portalApi.post<AuthResponse>(endpoint, { email, password });
      portalApi.setToken(data.token);
      portalApi.setCustomer(data.customer);
      router.push("/portal");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLink = async () => {
    setError("");
    setLoading(true);
    try {
      await portalApi.post("/portal/auth/magic-link", { email });
      setMagicSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--t-bg-primary)] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--t-accent)]">
            <span className="text-xl font-bold text-black">S</span>
          </div>
          <h1 className="text-[28px] font-bold tracking-[-1px]" style={{ color: "var(--t-frame-text)" }}>Customer Portal</h1>
          <p className="mt-2 text-sm" style={{ color: "var(--t-frame-text-muted)" }}>
            {mode === "login" ? "Sign in to manage your rentals and invoices" : "Create your portal account"}
          </p>
        </div>

        <div className="rounded-[20px] p-6" style={{ backgroundColor: "var(--t-bg-secondary)", boxShadow: "0 8px 30px rgba(0,0,0,0.15)" }}>
        {magicSent ? (
          <div className="rounded-[20px] bg-[var(--t-accent-soft)] border border-[var(--t-accent)]/20 p-6 text-center">
            <Mail className="mx-auto h-8 w-8 text-[var(--t-accent)] mb-3" />
            <p className="text-sm font-medium text-[var(--t-text-primary)]">Check your email</p>
            <p className="text-xs text-[var(--t-text-muted)] mt-1">We sent a login link to {email}</p>
            <button onClick={() => setMagicSent(false)} className="mt-4 text-xs text-[var(--t-accent)] font-medium hover:underline">
              Back to login
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-[20px] bg-[var(--t-error-soft)] px-4 py-3 text-sm text-[var(--t-error)]">{error}</div>
              )}

              <div>
                <label className="block text-sm font-medium text-[var(--t-text-primary)] mb-1.5">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--t-text-muted)]" />
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@email.com"
                    className="w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] pl-10 pr-4 py-2.5 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--t-text-primary)] mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--t-text-muted)]" />
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                    placeholder={mode === "register" ? "Choose a password (8+ characters)" : "Your password"}
                    minLength={mode === "register" ? 8 : undefined}
                    className="w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] pl-10 pr-4 py-2.5 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]" />
                </div>
              </div>

              <button type="submit" disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--t-accent)] px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50">
                {loading ? (mode === "login" ? "Signing in..." : "Creating account...") : (
                  <>{mode === "login" ? "Sign In" : "Create Account"} <ArrowRight className="h-4 w-4" /></>
                )}
              </button>
            </form>

            <div className="mt-4 space-y-3 text-center">
              {mode === "login" ? (
                <>
                  <span className="text-xs text-[var(--t-text-muted)]">
                    Magic link login coming soon
                  </span>
                  <p className="text-sm text-[var(--t-text-muted)]">
                    First time?{" "}
                    <button onClick={() => { setMode("register"); setError(""); }} className="font-medium text-[var(--t-accent)] hover:underline">
                      Set up your account
                    </button>
                  </p>
                </>
              ) : (
                <p className="text-sm text-[var(--t-text-muted)]">
                  Already have a password?{" "}
                  <button onClick={() => { setMode("login"); setError(""); }} className="font-medium text-[var(--t-accent)] hover:underline">
                    Sign in
                  </button>
                </p>
              )}
            </div>
          </>
        )}
        </div>

        <p className="mt-8 text-center text-xs" style={{ color: "var(--t-frame-text-muted)" }}>
          Need help? Contact the office during business hours.
        </p>
      </div>
    </div>
  );
}
