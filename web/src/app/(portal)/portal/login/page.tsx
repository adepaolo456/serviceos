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
    <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-4" style={{ colorScheme: "light" }}>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2ECC71] shadow-lg shadow-[#2ECC71]/20">
            <span className="text-xl font-bold text-white">S</span>
          </div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Customer Portal</h1>
          <p className="mt-2 text-sm text-[#64748B]">
            {mode === "login" ? "Sign in to manage your rentals and invoices" : "Create your portal account"}
          </p>
        </div>

        {magicSent ? (
          <div className="rounded-xl bg-[#2ECC71]/10 border border-[#2ECC71]/20 p-6 text-center">
            <Mail className="mx-auto h-8 w-8 text-[#2ECC71] mb-3" />
            <p className="text-sm font-medium text-[#0F172A]">Check your email</p>
            <p className="text-xs text-[#64748B] mt-1">We sent a login link to {email}</p>
            <button onClick={() => setMagicSent(false)} className="mt-4 text-xs text-[#2ECC71] font-medium hover:underline">
              Back to login
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">{error}</div>
              )}

              <div>
                <label className="block text-sm font-medium text-[#334155] mb-1.5">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94A3B8]" />
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@email.com"
                    className="w-full rounded-lg border border-[#E2E8F0] bg-white pl-10 pr-4 py-2.5 text-sm text-[#0F172A] placeholder-[#94A3B8] outline-none focus:border-[#2ECC71] focus:ring-1 focus:ring-[#2ECC71]" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#334155] mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94A3B8]" />
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                    placeholder={mode === "register" ? "Choose a password (8+ characters)" : "Your password"}
                    minLength={mode === "register" ? 8 : undefined}
                    className="w-full rounded-lg border border-[#E2E8F0] bg-white pl-10 pr-4 py-2.5 text-sm text-[#0F172A] placeholder-[#94A3B8] outline-none focus:border-[#2ECC71] focus:ring-1 focus:ring-[#2ECC71]" />
                </div>
              </div>

              <button type="submit" disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#2ECC71] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#27AE60] disabled:opacity-50">
                {loading ? (mode === "login" ? "Signing in..." : "Creating account...") : (
                  <>{mode === "login" ? "Sign In" : "Create Account"} <ArrowRight className="h-4 w-4" /></>
                )}
              </button>
            </form>

            <div className="mt-4 space-y-3 text-center">
              {mode === "login" ? (
                <>
                  <button onClick={handleMagicLink} disabled={!email || loading}
                    className="text-xs text-[#2ECC71] font-medium hover:underline disabled:opacity-50">
                    Send me a magic link instead
                  </button>
                  <p className="text-sm text-[#64748B]">
                    First time?{" "}
                    <button onClick={() => { setMode("register"); setError(""); }} className="font-medium text-[#2ECC71] hover:underline">
                      Set up your account
                    </button>
                  </p>
                </>
              ) : (
                <p className="text-sm text-[#64748B]">
                  Already have a password?{" "}
                  <button onClick={() => { setMode("login"); setError(""); }} className="font-medium text-[#2ECC71] hover:underline">
                    Sign in
                  </button>
                </p>
              )}
            </div>
          </>
        )}

        <p className="mt-8 text-center text-xs text-[#94A3B8]">
          Need help? Contact the office during business hours.
        </p>
      </div>
    </div>
  );
}
