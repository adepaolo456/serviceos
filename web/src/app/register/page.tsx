"use client";

import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";

interface RegisterResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
}

const BUSINESS_TYPES = [
  { value: "dumpster", label: "Dumpster Rental" },
  { value: "pod", label: "Portable Storage (Pods)" },
  { value: "restroom", label: "Portable Restrooms" },
  { value: "landscaping", label: "Landscaping" },
  { value: "general", label: "General Services" },
];

export default function RegisterPage() {
  const [companyName, setCompanyName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await api.post<RegisterResponse>("/auth/register", {
        companyName,
        businessType,
        firstName,
        lastName,
        email,
        password,
        ...(phone ? { phone } : {}),
      });
      api.setToken(data.accessToken);
      localStorage.setItem("refreshToken", data.refreshToken);
      window.location.href = "/onboarding/plan";
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Registration failed. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "w-full rounded-[18px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2.5 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none transition-colors focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]";
  const labelClass = "block text-sm font-medium text-[var(--t-text-primary)] mb-1.5";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--t-bg-primary)] px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--t-accent)]">
            <span className="text-xl font-bold text-black">
              S
            </span>
          </div>
          <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-text-primary)]">
            Create your account
          </h1>
          <p className="mt-2 text-sm text-[var(--t-text-muted)]">
            Start managing your service business
          </p>
        </div>

        <a
          href={`${process.env.NEXT_PUBLIC_API_URL || "https://serviceos-api.vercel.app"}/auth/google`}
          className="w-full flex items-center justify-center gap-3 rounded-full border border-[var(--t-border)] bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50 active:scale-[0.98]"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          Continue with Google
        </a>
        <div className="relative my-5">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[var(--t-border)]" /></div>
          <div className="relative flex justify-center"><span className="bg-[var(--t-bg-primary)] px-3 text-xs text-[var(--t-text-muted)]">or</span></div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-[18px] bg-[var(--t-error-soft)] border border-[var(--t-error)] px-4 py-3 text-sm text-[var(--t-error)]">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="companyName" className={labelClass}>
              Company Name
            </label>
            <input
              id="companyName"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
              className={inputClass}
              placeholder="Acme Dumpster Rentals"
            />
          </div>

          <div>
            <label htmlFor="businessType" className={labelClass}>
              Business Type
            </label>
            <select
              id="businessType"
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
              required
              className={`${inputClass} appearance-none`}
            >
              <option value="" disabled>
                Select your business type
              </option>
              {BUSINESS_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="firstName" className={labelClass}>
                First Name
              </label>
              <input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                className={inputClass}
                placeholder="John"
              />
            </div>
            <div>
              <label htmlFor="lastName" className={labelClass}>
                Last Name
              </label>
              <input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                className={inputClass}
                placeholder="Doe"
              />
            </div>
          </div>

          <div>
            <label htmlFor="email" className={labelClass}>
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={inputClass}
              placeholder="you@company.com"
            />
          </div>

          <div>
            <label htmlFor="password" className={labelClass}>
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className={inputClass}
              placeholder="Minimum 8 characters"
            />
          </div>

          <div>
            <label htmlFor="phone" className={labelClass}>
              Phone{" "}
              <span className="text-[var(--t-text-muted)] font-normal">(optional)</span>
            </label>
            <input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputClass}
              placeholder="555-234-5678"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-[var(--t-accent)] px-4 py-2.5 text-sm font-semibold text-black transition-all hover:brightness-110 disabled:opacity-50"
          >
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--t-text-muted)]">
          Already have an account?{" "}
          <a href="/login" className="font-medium text-[var(--t-accent)] hover:brightness-110 transition-colors">Sign in</a>
        </p>
        <p className="mt-2 text-center text-sm text-[var(--t-text-muted)]">
          Want to see it in action?{" "}
          <a href="/demo" className="font-medium text-[var(--t-accent)] hover:brightness-110 transition-colors">Request a demo</a>
        </p>
      </div>
    </div>
  );
}
