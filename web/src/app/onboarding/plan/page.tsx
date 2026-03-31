"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Zap, Crown, Rocket } from "lucide-react";
import { api } from "@/lib/api";

const PLANS = [
  {
    key: "starter",
    name: "Starter",
    price: "$99",
    icon: Zap,
    features: [
      "1 admin user",
      "2 driver accounts",
      "50 jobs per month",
      "Basic analytics",
      "Email support",
      "Customer management",
    ],
  },
  {
    key: "professional",
    name: "Professional",
    price: "$249",
    icon: Crown,
    popular: true,
    features: [
      "3 admin users",
      "10 driver accounts",
      "Unlimited jobs",
      "Advanced analytics & routing",
      "Dispatch board",
      "Marketplace integration",
      "Priority support",
    ],
  },
  {
    key: "business",
    name: "Business",
    price: "$499",
    icon: Rocket,
    features: [
      "10 admin users",
      "25 driver accounts",
      "Unlimited jobs",
      "API access",
      "White-label options",
      "Custom analytics",
      "Dedicated account manager",
      "Priority phone support",
    ],
  },
];

export default function SelectPlanPage() {
  const router = useRouter();
  const [selecting, setSelecting] = useState<string | null>(null);

  const handleSelect = async (plan: string) => {
    setSelecting(plan);
    try {
      await api.post("/billing/select-plan", { plan });
      router.push("/?welcome=true");
    } catch {
      alert("Failed to select plan. Please try again.");
    } finally {
      setSelecting(null);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--t-bg-primary)] flex flex-col items-center justify-center px-4 py-12">
      <div className="text-center mb-12">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--t-accent)]">
          <span className="text-xl font-bold text-black">S</span>
        </div>
        <h1 className="text-[28px] font-bold text-[var(--t-text-primary)] tracking-[-1px]">
          Choose your plan
        </h1>
        <p className="mt-2 text-[var(--t-text-muted)] max-w-md mx-auto">
          Start with a 14-day free trial. No credit card required. Upgrade or cancel anytime.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 max-w-4xl w-full">
        {PLANS.map((plan) => (
          <div
            key={plan.key}
            className={`relative rounded-[18px] border p-6 transition-all ${
              plan.popular
                ? "border-[var(--t-accent)] bg-[var(--t-accent-soft)]"
                : "border-[var(--t-border)] bg-[var(--t-bg-card)] hover:bg-[var(--t-bg-card-hover)]"
            }`}
          >
            {plan.popular && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[var(--t-accent)] px-4 py-1 text-xs font-bold text-black">
                Most Popular
              </span>
            )}
            <div className="flex h-10 w-10 items-center justify-center rounded-[18px] border border-[var(--t-border)] bg-[var(--t-bg-primary)] mb-4">
              <plan.icon className="h-5 w-5 text-[var(--t-accent)]" />
            </div>
            <h2 className="text-xl font-bold text-[var(--t-text-primary)]">{plan.name}</h2>
            <p className="mt-1">
              <span className="text-4xl font-bold text-[var(--t-text-primary)] tabular-nums">{plan.price}</span>
              <span className="text-sm text-[var(--t-text-muted)]">/mo</span>
            </p>
            <ul className="mt-6 space-y-2.5">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <Check className="h-4 w-4 text-[var(--t-accent)] shrink-0 mt-0.5" />
                  <span className="text-[var(--t-text-primary)]">{f}</span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => handleSelect(plan.key)}
              disabled={selecting !== null}
              className={`mt-6 w-full rounded-full py-3 text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-50 ${
                plan.popular
                  ? "bg-[var(--t-accent)] text-black hover:brightness-110"
                  : "border border-[var(--t-border)] text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)]"
              }`}
            >
              {selecting === plan.key ? "Starting trial..." : "Start Free Trial"}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-8 text-center">
        <p className="text-sm text-[var(--t-text-muted)]">
          Not sure which plan is right?{" "}
          <a href="/demo" className="text-[var(--t-accent)] hover:brightness-110 font-medium transition-colors">
            Request a demo
          </a>
        </p>
      </div>
    </div>
  );
}
