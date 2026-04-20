"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email });
    } catch {
      // Backend always returns 200 ok:true for enumeration defense.
      // Only network/CORS errors land here; treat the same — the user
      // should never learn whether their email was found.
    }
    setSubmitted(true);
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ backgroundColor: "var(--t-bg-primary)" }}>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--t-accent)]">
            <span className="text-xl font-bold text-black">S</span>
          </div>
          <h1 className="text-[28px] font-bold tracking-[-1px]" style={{ color: "var(--t-frame-text)" }}>
            {submitted ? "Check your email" : "Reset your password"}
          </h1>
          <p className="mt-2 text-sm" style={{ color: "var(--t-frame-text-muted)" }}>
            {submitted
              ? `If an account exists for ${email}, we've sent a link to reset your password. The link expires in 60 minutes.`
              : "Enter your email and we'll send you a link to reset your password."}
          </p>
        </div>

        <div className="rounded-[20px] p-6" style={{ backgroundColor: "var(--t-bg-secondary)", boxShadow: "0 8px 30px rgba(0,0,0,0.15)" }}>
          {submitted ? (
            <Link
              href="/login"
              className="block w-full rounded-full bg-[var(--t-accent)] px-4 py-2.5 text-center text-sm font-semibold text-black transition-all hover:brightness-110"
            >
              Back to login
            </Link>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
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
                  autoFocus
                  className="w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2.5 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none transition-colors focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]"
                  placeholder="you@company.com"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-full bg-[var(--t-accent)] px-4 py-2.5 text-sm font-semibold text-black transition-all hover:brightness-110 disabled:opacity-50"
              >
                {loading ? "Sending..." : "Send reset link"}
              </button>
              <Link
                href="/login"
                className="block w-full text-center text-sm text-[var(--t-text-muted)] hover:text-[var(--t-accent)] transition-colors"
              >
                Back to login
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
