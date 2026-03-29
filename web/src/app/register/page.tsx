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
      window.location.href = "/";
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Registration failed. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-white/10 bg-dark-card px-4 py-2.5 text-sm text-white placeholder-muted outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand";
  const labelClass = "block text-sm font-medium text-foreground mb-1.5";

  return (
    <div className="flex min-h-screen items-center justify-center bg-dark-primary px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand">
            <span className="font-display text-xl font-bold text-dark-primary">
              S
            </span>
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            Create your account
          </h1>
          <p className="mt-2 text-sm text-muted">
            Start managing your service business
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
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
              <span className="text-muted font-normal">(optional)</span>
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
            className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-dark-primary transition-colors hover:bg-brand-light disabled:opacity-50"
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          Already have an account?{" "}
          <a
            href="/login"
            className="font-medium text-brand hover:text-brand-light transition-colors"
          >
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
