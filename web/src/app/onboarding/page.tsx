"use client";

import { useState, useEffect, useCallback, useRef, type FormEvent } from "react";
import {
  Building2, DollarSign, MapPin, Truck, Users, Bell, Globe,
  Check, Minus, Circle, Sparkles, ChevronRight, Loader2,
} from "lucide-react";
import { api } from "@/lib/api";

/* ── Types ──────────────────────────────────────────────────── */

interface ChecklistItem {
  stepKey: string;
  status: "pending" | "completed" | "skipped" | "auto_completed";
  completedAt: string | null;
  completedBy: string | null;
  required: boolean;
  category: "required" | "recommended" | "optional";
}

interface ProgressResponse {
  total: number;
  completed: number;
  skipped: number;
  percentage: number;
  requiredComplete: boolean;
  steps: ChecklistItem[];
}

interface Suggestion {
  field: string;
  value: unknown;
  explanation: string;
}

interface SuggestionResponse {
  suggestions: Suggestion[];
  source: "static" | "ai";
}

interface TenantSettings {
  brand_color: string;
  logo_url: string | null;
  support_email: string | null;
  support_phone: string | null;
  portal_slug: string | null;
  portal_name: string | null;
  email_sender_name: string | null;
  sms_enabled: boolean;
  email_enabled: boolean;
  default_rental_period_days: number;
  failed_trip_fee: number;
  time_change_cutoff_hours: number;
  driver_hourly_rate: number | null;
  helper_hourly_rate: number | null;
}

interface Profile {
  tenant: { id: string; name: string; slug: string };
}

/* ── Step config ────────────────────────────────────────────── */

const STEPS = [
  { key: "company_info", label: "Company Info", icon: Building2 },
  { key: "pricing", label: "Pricing", icon: DollarSign },
  { key: "yards", label: "Yards", icon: MapPin },
  { key: "vehicles", label: "Vehicles", icon: Truck },
  { key: "labor_rates", label: "Labor Rates", icon: Users },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "portal", label: "Portal", icon: Globe },
];

const statusIcon = (status: string) => {
  if (status === "completed" || status === "auto_completed")
    return <Check className="h-4 w-4 text-[#22C55E]" />;
  if (status === "skipped") return <Minus className="h-4 w-4 text-[var(--t-text-muted)]" />;
  return <Circle className="h-4 w-4 text-[var(--t-text-muted)]" />;
};

const inputCls =
  "w-full rounded-[16px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-3 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none transition-colors focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]";
const labelCls = "block text-[13px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] mb-1.5";
const btnPrimary =
  "rounded-full bg-[var(--t-accent)] px-6 py-2.5 text-sm font-semibold text-black transition-all hover:brightness-110 disabled:opacity-50";
const btnSecondary =
  "rounded-full border border-[var(--t-border)] px-6 py-2.5 text-sm font-medium text-[var(--t-text-primary)] transition-all hover:bg-[var(--t-bg-card-hover)] disabled:opacity-50";

/* ── Main component ─────────────────────────────────────────── */

export default function OnboardingPage() {
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [activeStep, setActiveStep] = useState("company_info");
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionModal, setSuggestionModal] = useState<Suggestion[] | null>(null);
  const lastFetch = useRef(0);

  // Form state per step
  const [companyName, setCompanyName] = useState("");
  const [brandColor, setBrandColor] = useState("#22C55E");
  const [supportEmail, setSupportEmail] = useState("");
  const [supportPhone, setSupportPhone] = useState("");
  const [driverRate, setDriverRate] = useState("");
  const [helperRate, setHelperRate] = useState("");
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailSenderName, setEmailSenderName] = useState("");
  const [portalSlug, setPortalSlug] = useState("");
  const [portalName, setPortalName] = useState("");

  const fetchProgress = useCallback(async () => {
    const now = Date.now();
    if (now - lastFetch.current < 1000) return;
    lastFetch.current = now;
    try {
      const data = await api.get<ProgressResponse>("/onboarding/progress");
      setProgress(data);
    } catch {}
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const data = await api.get<TenantSettings>("/tenant-settings");
      setSettings(data);
      setBrandColor(data.brand_color || "#22C55E");
      setSupportEmail(data.support_email || "");
      setSupportPhone(data.support_phone || "");
      setDriverRate(data.driver_hourly_rate ? String(data.driver_hourly_rate) : "");
      setHelperRate(data.helper_hourly_rate ? String(data.helper_hourly_rate) : "");
      setSmsEnabled(data.sms_enabled);
      setEmailEnabled(data.email_enabled);
      setEmailSenderName(data.email_sender_name || "");
      setPortalSlug(data.portal_slug || "");
      setPortalName(data.portal_name || "");
    } catch {}
  }, []);

  const fetchProfile = useCallback(async () => {
    try {
      const data = await api.get<Profile>("/auth/profile");
      setProfile(data);
      setCompanyName(data.tenant.name || "");
      if (!portalSlug) {
        setPortalSlug(
          data.tenant.slug ||
            data.tenant.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, ""),
        );
      }
    } catch {}
  }, [portalSlug]);

  useEffect(() => {
    fetchProgress();
    fetchSettings();
    fetchProfile();
  }, [fetchProgress, fetchSettings, fetchProfile]);

  // Re-fetch on focus / visibility change (debounced)
  useEffect(() => {
    const handler = () => fetchProgress();
    window.addEventListener("focus", handler);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") handler();
    });
    return () => {
      window.removeEventListener("focus", handler);
    };
  }, [fetchProgress]);

  const markStep = async (stepKey: string, status: "completed" | "skipped") => {
    try {
      await api.patch(`/onboarding/checklist/${stepKey}`, { status });
      await fetchProgress();
    } catch {}
  };

  const getSuggestions = async (section: string) => {
    setSuggesting(true);
    try {
      const data = await api.post<SuggestionResponse>("/ai/setup-suggestions", { section });
      setSuggestionModal(data.suggestions);
    } catch {} finally {
      setSuggesting(false);
    }
  };

  const applySuggestions = (suggestions: Suggestion[]) => {
    for (const s of suggestions) {
      switch (s.field) {
        case "brand_color": setBrandColor(String(s.value)); break;
        case "driver_hourly_rate": setDriverRate(String(s.value)); break;
        case "helper_hourly_rate": setHelperRate(String(s.value)); break;
        case "sms_enabled": setSmsEnabled(Boolean(s.value)); break;
        case "email_enabled": setEmailEnabled(Boolean(s.value)); break;
        case "portal_enabled": break; // no-op, just informational
      }
    }
    setSuggestionModal(null);
  };

  /* ── Save handlers per step ───────────────────────────────── */

  const saveCompanyInfo = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch("/auth/profile", { companyName });
      await api.patch("/tenant-settings/branding", {
        brand_color: brandColor,
        support_email: supportEmail,
        support_phone: supportPhone,
      });
      await markStep("company_info", "completed");
    } catch {} finally { setSaving(false); }
  };

  const saveLaborRates = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch("/tenant-settings", {
        driver_hourly_rate: driverRate ? Number(driverRate) : undefined,
        helper_hourly_rate: helperRate ? Number(helperRate) : undefined,
      });
      await markStep("labor_rates", "completed");
    } catch {} finally { setSaving(false); }
  };

  const saveNotifications = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch("/tenant-settings/notifications", {
        sms_enabled: smsEnabled,
        email_enabled: emailEnabled,
        email_sender_name: emailSenderName,
      });
      await markStep("notifications", "completed");
    } catch {} finally { setSaving(false); }
  };

  const savePortal = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch("/tenant-settings", {
        portal_slug: portalSlug,
        portal_name: portalName,
      });
      await markStep("portal", "completed");
    } catch {} finally { setSaving(false); }
  };

  const currentStepData = progress?.steps.find((s) => s.stepKey === activeStep);
  const isComplete = currentStepData?.status === "completed" || currentStepData?.status === "auto_completed";

  /* ── Render ───────────────────────────────────────────────── */

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--t-bg-primary)" }}>
      {/* Progress bar */}
      <div className="sticky top-0 z-50 border-b border-[var(--t-border)]" style={{ backgroundColor: "var(--t-bg-primary)" }}>
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--t-accent)]">
              <span className="text-sm font-bold text-black">S</span>
            </div>
            <span className="text-sm font-semibold text-[var(--t-text-primary)]">Setup Wizard</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-48 h-2 rounded-full bg-[var(--t-border)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--t-accent)] transition-all duration-500"
                style={{ width: `${progress?.percentage || 0}%` }}
              />
            </div>
            <span className="text-sm font-medium text-[var(--t-text-muted)] tabular-nums">
              {progress?.percentage || 0}%
            </span>
            {progress?.requiredComplete && (
              <a
                href="/"
                className={btnPrimary}
              >
                Launch Dashboard
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-8 flex gap-8">
        {/* Left sidebar — step list */}
        <div className="w-60 shrink-0">
          <div className="sticky top-24 space-y-1">
            {STEPS.map((s) => {
              const stepData = progress?.steps.find((p) => p.stepKey === s.key);
              const isActive = activeStep === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => setActiveStep(s.key)}
                  className={`w-full flex items-center gap-3 rounded-[14px] px-3 py-2.5 text-left transition-all text-sm ${
                    isActive
                      ? "bg-[var(--t-accent-soft)] text-[var(--t-accent)]"
                      : "text-[var(--t-text-muted)] hover:bg-[var(--t-bg-card-hover)] hover:text-[var(--t-text-primary)]"
                  }`}
                >
                  <s.icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 font-medium">{s.label}</span>
                  {statusIcon(stepData?.status || "pending")}
                </button>
              );
            })}
          </div>
        </div>

        {/* Main content area */}
        <div className="flex-1 min-w-0">
          <div className="rounded-[20px] border border-[var(--t-border)] p-8" style={{ backgroundColor: "var(--t-bg-secondary)" }}>
            {/* Auto-completed badge */}
            {currentStepData?.status === "auto_completed" && (
              <div className="mb-4 flex items-center gap-2 rounded-full bg-[#22C55E]/10 px-4 py-2 text-sm text-[#22C55E] w-fit">
                <Check className="h-4 w-4" /> Already configured
              </div>
            )}

            {/* Step content */}
            {activeStep === "company_info" && (
              <form onSubmit={saveCompanyInfo} className="space-y-5">
                <h2 className="text-lg font-bold text-[var(--t-text-primary)]">Company Information</h2>
                <div>
                  <label className={labelCls}>Company Name</label>
                  <input className={inputCls} value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
                </div>
                <div>
                  <label className={labelCls}>Brand Color</label>
                  <div className="flex items-center gap-3">
                    <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-10 w-10 rounded-lg border border-[var(--t-border)] cursor-pointer" />
                    <input className={inputCls + " max-w-[120px]"} value={brandColor} onChange={(e) => setBrandColor(e.target.value)} maxLength={7} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Support Email</label>
                  <input className={inputCls} type="email" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} placeholder="support@company.com" />
                </div>
                <div>
                  <label className={labelCls}>Support Phone</label>
                  <input className={inputCls} value={supportPhone} onChange={(e) => setSupportPhone(e.target.value)} placeholder="(555) 123-4567" />
                </div>
                <StepActions
                  stepKey="company_info"
                  saving={saving}
                  suggesting={suggesting}
                  onSuggest={() => getSuggestions("company_info")}
                  onSkip={() => markStep("company_info", "skipped")}
                  isComplete={isComplete}
                />
              </form>
            )}

            {activeStep === "pricing" && (
              <div className="space-y-5">
                <h2 className="text-lg font-bold text-[var(--t-text-primary)]">Pricing Configuration</h2>
                <p className="text-sm text-[var(--t-text-muted)]">
                  Configure your pricing rules on the{" "}
                  <a href="/pricing" className="text-[var(--t-accent)] hover:underline">Pricing page</a>.
                  When you have at least one active pricing rule, this step will auto-complete.
                </p>
                <div className="flex gap-3">
                  <a href="/pricing" className={btnPrimary}>Go to Pricing</a>
                  <button onClick={() => getSuggestions("pricing")} disabled={suggesting} className={btnSecondary}>
                    {suggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 inline mr-1.5" />}
                    View Recommended Values
                  </button>
                  <button onClick={() => markStep("pricing", "skipped")} className={btnSecondary}>Skip</button>
                </div>
              </div>
            )}

            {activeStep === "yards" && (
              <div className="space-y-5">
                <h2 className="text-lg font-bold text-[var(--t-text-primary)]">Yard Locations</h2>
                <p className="text-sm text-[var(--t-text-muted)]">
                  Add your yard locations on the{" "}
                  <a href="/settings" className="text-[var(--t-accent)] hover:underline">Settings &gt; Locations</a> page.
                  When you have at least one yard, this step will auto-complete.
                </p>
                <div className="flex gap-3">
                  <a href="/settings" className={btnPrimary}>Go to Locations</a>
                  <button onClick={() => markStep("yards", "skipped")} className={btnSecondary}>Skip</button>
                </div>
              </div>
            )}

            {activeStep === "vehicles" && (
              <div className="space-y-5">
                <h2 className="text-lg font-bold text-[var(--t-text-primary)]">Vehicles &amp; Assets</h2>
                <p className="text-sm text-[var(--t-text-muted)]">
                  Add your vehicles and dumpsters on the{" "}
                  <a href="/assets" className="text-[var(--t-accent)] hover:underline">Assets page</a>.
                  This step auto-completes when at least one asset exists.
                </p>
                <div className="flex gap-3">
                  <a href="/assets" className={btnPrimary}>Go to Assets</a>
                  <button onClick={() => getSuggestions("vehicles")} disabled={suggesting} className={btnSecondary}>
                    {suggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 inline mr-1.5" />}
                    View Recommended Values
                  </button>
                  <button onClick={() => markStep("vehicles", "skipped")} className={btnSecondary}>Skip</button>
                </div>
              </div>
            )}

            {activeStep === "labor_rates" && (
              <form onSubmit={saveLaborRates} className="space-y-5">
                <h2 className="text-lg font-bold text-[var(--t-text-primary)]">Labor Rates</h2>
                <div>
                  <label className={labelCls}>Driver Hourly Rate ($)</label>
                  <input className={inputCls + " max-w-[200px]"} type="number" step="0.01" min="0" value={driverRate} onChange={(e) => setDriverRate(e.target.value)} placeholder="28.00" />
                </div>
                <div>
                  <label className={labelCls}>Helper Hourly Rate ($)</label>
                  <input className={inputCls + " max-w-[200px]"} type="number" step="0.01" min="0" value={helperRate} onChange={(e) => setHelperRate(e.target.value)} placeholder="18.00" />
                </div>
                <StepActions
                  stepKey="labor_rates"
                  saving={saving}
                  suggesting={suggesting}
                  onSuggest={() => getSuggestions("labor_rates")}
                  onSkip={() => markStep("labor_rates", "skipped")}
                  isComplete={isComplete}
                />
              </form>
            )}

            {activeStep === "notifications" && (
              <form onSubmit={saveNotifications} className="space-y-5">
                <h2 className="text-lg font-bold text-[var(--t-text-primary)]">Notification Settings</h2>
                <div className="flex items-center justify-between rounded-[14px] border border-[var(--t-border)] p-4">
                  <div>
                    <p className="text-sm font-medium text-[var(--t-text-primary)]">SMS Notifications</p>
                    <p className="text-xs text-[var(--t-text-muted)]">Send delivery updates via SMS</p>
                  </div>
                  <ToggleSwitch checked={smsEnabled} onChange={setSmsEnabled} />
                </div>
                <div className="flex items-center justify-between rounded-[14px] border border-[var(--t-border)] p-4">
                  <div>
                    <p className="text-sm font-medium text-[var(--t-text-primary)]">Email Notifications</p>
                    <p className="text-xs text-[var(--t-text-muted)]">Send invoices and receipts via email</p>
                  </div>
                  <ToggleSwitch checked={emailEnabled} onChange={setEmailEnabled} />
                </div>
                <div>
                  <label className={labelCls}>Email Sender Name</label>
                  <input className={inputCls} value={emailSenderName} onChange={(e) => setEmailSenderName(e.target.value)} placeholder="Acme Dumpsters" />
                </div>
                <StepActions
                  stepKey="notifications"
                  saving={saving}
                  suggesting={suggesting}
                  onSuggest={() => getSuggestions("notifications")}
                  onSkip={() => markStep("notifications", "skipped")}
                  isComplete={isComplete}
                />
              </form>
            )}

            {activeStep === "portal" && (
              <form onSubmit={savePortal} className="space-y-5">
                <h2 className="text-lg font-bold text-[var(--t-text-primary)]">Customer Portal</h2>
                <div>
                  <label className={labelCls}>Portal Name</label>
                  <input className={inputCls} value={portalName} onChange={(e) => setPortalName(e.target.value)} placeholder="Acme Customer Portal" />
                </div>
                <div>
                  <label className={labelCls}>Portal Slug</label>
                  <input className={inputCls} value={portalSlug} onChange={(e) => setPortalSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="acme-dumpsters" />
                  <p className="mt-1.5 text-xs text-[var(--t-text-muted)]">
                    URL: /portal/{portalSlug || "your-slug"}/...
                  </p>
                </div>
                <StepActions
                  stepKey="portal"
                  saving={saving}
                  suggesting={suggesting}
                  onSuggest={() => getSuggestions("portal")}
                  onSkip={() => markStep("portal", "skipped")}
                  isComplete={isComplete}
                />
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Suggestion modal */}
      {suggestionModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-[20px] border border-[var(--t-border)] p-6" style={{ backgroundColor: "var(--t-bg-secondary)" }}>
            <h3 className="text-lg font-bold text-[var(--t-text-primary)] mb-4">Recommended Values</h3>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {suggestionModal.map((s) => (
                <div key={s.field} className="rounded-[12px] border border-[var(--t-border)] p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-[var(--t-text-primary)]">{s.field}</span>
                    <span className="text-sm font-bold text-[var(--t-accent)] tabular-nums">{String(s.value)}</span>
                  </div>
                  <p className="text-xs text-[var(--t-text-muted)] mt-1">{s.explanation}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => applySuggestions(suggestionModal)} className={btnPrimary}>Apply to Form</button>
              <button onClick={() => setSuggestionModal(null)} className={btnSecondary}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────── */

function StepActions({
  stepKey,
  saving,
  suggesting,
  onSuggest,
  onSkip,
  isComplete,
}: {
  stepKey: string;
  saving: boolean;
  suggesting: boolean;
  onSuggest: () => void;
  onSkip: () => void;
  isComplete?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <button type="submit" disabled={saving} className={btnPrimary}>
        {saving ? "Saving..." : isComplete ? "Update & Complete" : "Save & Complete"}
      </button>
      <button type="button" onClick={onSuggest} disabled={suggesting} className={btnSecondary}>
        {suggesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 inline mr-1.5" />}
        Recommended
      </button>
      <button type="button" onClick={onSkip} className={btnSecondary}>
        Skip
      </button>
    </div>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition-colors ${
        checked ? "bg-[var(--t-accent)]" : "bg-[var(--t-border)]"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}
