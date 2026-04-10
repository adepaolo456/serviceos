"use client";

import { useEffect, useState } from "react";
import { Shield } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";

const PERMISSION_KEYS = [
  "credit_policy_edit",
  "credit_hold_manage",
  "booking_override",
  "dispatch_override",
  "credit_audit_view",
  "credit_analytics_view",
  "credit_queue_manage",
] as const;

const CONFIGURABLE_ROLES = ["admin", "dispatcher", "office"] as const;

type Role = (typeof CONFIGURABLE_ROLES)[number];
type PermKey = (typeof PERMISSION_KEYS)[number];

interface PermConfig {
  admin: Record<string, boolean>;
  dispatcher: Record<string, boolean>;
  office: Record<string, boolean>;
}

function label(id: string, fallback: string): string {
  return FEATURE_REGISTRY[id]?.label ?? fallback;
}

const PERM_LABELS: Record<PermKey, { id: string; fallback: string }> = {
  credit_policy_edit: { id: "perm_credit_policy_edit", fallback: "Edit credit policy" },
  credit_hold_manage: { id: "perm_credit_hold_manage", fallback: "Manage credit holds" },
  booking_override: { id: "perm_booking_override", fallback: "Override booking blocks" },
  dispatch_override: { id: "perm_dispatch_override", fallback: "Override dispatch blocks" },
  credit_audit_view: { id: "perm_credit_audit_view", fallback: "View audit dashboard" },
  credit_analytics_view: { id: "perm_credit_analytics_view", fallback: "View analytics" },
  credit_queue_manage: { id: "perm_credit_queue_manage", fallback: "Access review queue" },
};

const ROLE_LABELS: Record<Role, { id: string; fallback: string }> = {
  admin: { id: "perm_role_admin", fallback: "Admin" },
  dispatcher: { id: "perm_role_dispatcher", fallback: "Dispatcher" },
  office: { id: "perm_role_office", fallback: "Office" },
};

export interface TeamPermissionsTabProps {
  profile: { id: string; role: string } | null;
}

export function TeamPermissionsTab({ profile }: TeamPermissionsTabProps) {
  const { toast } = useToast();
  const [config, setConfig] = useState<PermConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const isOwner = profile?.role === "owner";

  useEffect(() => {
    api.get<PermConfig>("/permissions/config")
      .then(setConfig)
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (role: Role, key: PermKey) => {
    if (!config) return;
    setConfig({
      ...config,
      [role]: { ...config[role], [key]: !config[role][key] },
    });
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const result = await api.patch<PermConfig>("/permissions/config", config);
      setConfig(result);
      toast("success", "Permissions saved");
    } catch {
      toast("error", "Failed to save permissions");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-[20px] border p-5" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
        <div className="h-4 w-48 rounded bg-[var(--t-bg-elevated)] animate-pulse mb-3" />
        <div className="h-48 w-full rounded bg-[var(--t-bg-elevated)] animate-pulse" />
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="rounded-[20px] border p-5" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
        <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>Owner role required to manage team permissions.</p>
      </div>
    );
  }

  return (
    <div className="rounded-[20px] border p-5" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
      <div className="flex items-center gap-2 mb-1">
        <Shield className="h-5 w-5" style={{ color: "var(--t-accent)" }} />
        <h2 className="text-lg font-bold" style={{ color: "var(--t-text-primary)" }}>
          {label("team_permissions_section", "Team Permissions")}
        </h2>
      </div>
      <p className="text-xs mb-5" style={{ color: "var(--t-text-muted)" }}>
        {FEATURE_REGISTRY.team_permissions_section?.shortDescription ?? "Control which roles can perform credit-control actions."}
      </p>

      {/* Matrix */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left py-2 pr-4 text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--t-text-muted)" }}>
                {label("perm_col_permission", "Permission")}
              </th>
              <th className="text-center px-3 py-2 text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--t-text-muted)" }}>
                {label("perm_role_owner", "Owner")}
              </th>
              {CONFIGURABLE_ROLES.map((role) => (
                <th key={role} className="text-center px-3 py-2 text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--t-text-muted)" }}>
                  {label(ROLE_LABELS[role].id, ROLE_LABELS[role].fallback)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_KEYS.map((key) => (
              <tr key={key} style={{ borderTop: "1px solid var(--t-border)" }}>
                <td className="py-3 pr-4 font-medium" style={{ color: "var(--t-text-primary)" }}>
                  {label(PERM_LABELS[key].id, PERM_LABELS[key].fallback)}
                </td>
                {/* Owner — always on */}
                <td className="text-center px-3">
                  <span className="text-[10px] font-semibold" style={{ color: "var(--t-accent)" }}>Always</span>
                </td>
                {/* Configurable roles */}
                {CONFIGURABLE_ROLES.map((role) => (
                  <td key={role} className="text-center px-3">
                    <input
                      type="checkbox"
                      checked={config?.[role]?.[key] ?? false}
                      onChange={() => toggle(role, key)}
                      className="h-4 w-4 cursor-pointer accent-[var(--t-accent)]"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-full px-5 py-2.5 text-sm font-semibold disabled:opacity-50"
          style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent, #fff)" }}
        >
          {saving ? "Saving..." : label("perm_save", "Save permissions")}
        </button>
      </div>
    </div>
  );
}
