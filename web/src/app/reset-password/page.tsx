"use client";

import { useState, Suspense, type FormEvent } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";

// Map backend's typed error codes to user-friendly messages. Whitelist —
// anything unrecognized falls back to the generic "try again" copy to
// avoid leaking arbitrary error shapes into the UI.
const ERROR_MESSAGES: Record<string, string> = {
  invalid_or_expired_token:
    "This reset link has expired or already been used. Please request a new one.",
  account_deactivated:
    "Your account has been deactivated. Contact your administrator.",
  password_too_short: "Password must be at least 8 characters.",
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
};

interface ResetResponse {
  accessToken: string;
  refreshToken: string;
}

interface ApiErrorBody {
  error?: string;
  message?: string;
}

function ResetPasswordInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") || "";

  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError(ERROR_MESSAGES.password_too_short);
      return;
    }
    if (newPassword !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      const data = await api.post<ResetResponse>("/auth/reset-password", {
        token,
        newPassword,
      });
      api.setAuthTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
      window.location.href = "/";
    } catch (err) {
      const body = (err as { body?: ApiErrorBody })?.body;
      const code = body?.error;
      setError(
        (code && ERROR_MESSAGES[code]) ||
          "Something went wrong. Please try again or request a new reset link.",
      );
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4" style={{ backgroundColor: "var(--t-bg-primary)" }}>
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--t-accent)]">
              <span className="text-xl font-bold text-black">S</span>
            </div>
            <h1 className="text-[28px] font-bold tracking-[-1px]" style={{ color: "var(--t-frame-text)" }}>
              Invalid reset link
            </h1>
            <p className="mt-2 text-sm" style={{ color: "var(--t-frame-text-muted)" }}>
              This reset link is missing or malformed. Request a new one below.
            </p>
          </div>
          <div className="rounded-[20px] p-6" style={{ backgroundColor: "var(--t-bg-secondary)", boxShadow: "0 8px 30px rgba(0,0,0,0.15)" }}>
            <Link
              href="/forgot-password"
              className="block w-full rounded-full bg-[var(--t-accent)] px-4 py-2.5 text-center text-sm font-semibold text-black transition-all hover:brightness-110"
            >
              Request new reset link
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ backgroundColor: "var(--t-bg-primary)" }}>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--t-accent)]">
            <span className="text-xl font-bold text-black">S</span>
          </div>
          <h1 className="text-[28px] font-bold tracking-[-1px]" style={{ color: "var(--t-frame-text)" }}>
            Set a new password
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--t-frame-text-muted)" }}>
            Enter a new password for your ServiceOS account.
          </p>
        </div>

        <div className="rounded-[20px] p-6" style={{ backgroundColor: "var(--t-bg-secondary)", boxShadow: "0 8px 30px rgba(0,0,0,0.15)" }}>
          {error && (
            <div className="mb-4 rounded-[20px] bg-[var(--t-error-soft)] border border-[var(--t-error)] px-4 py-3 text-sm text-[var(--t-error)]">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="newPassword" className="block text-sm font-medium mb-1.5" style={{ color: "var(--t-text-primary)" }}>
                New password
              </label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                autoFocus
                className="w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2.5 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none transition-colors focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]"
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label htmlFor="confirm" className="block text-sm font-medium mb-1.5" style={{ color: "var(--t-text-primary)" }}>
                Confirm password
              </label>
              <input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2.5 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none transition-colors focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]"
                placeholder="Re-enter password"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-full bg-[var(--t-accent)] px-4 py-2.5 text-sm font-semibold text-black transition-all hover:brightness-110 disabled:opacity-50"
            >
              {loading ? "Updating..." : "Set new password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// Suspense boundary required because ResetPasswordInner calls useSearchParams()
// to read the ?token=X query param on mount. Next.js App Router disallows
// useSearchParams outside a Suspense boundary on a default export (same
// pattern used by login/page.tsx and site/layout.tsx).
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ backgroundColor: "var(--t-bg-primary)" }} />}>
      <ResetPasswordInner />
    </Suspense>
  );
}
