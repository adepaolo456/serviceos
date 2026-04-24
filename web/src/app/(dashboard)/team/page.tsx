"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus, Users, Phone, Mail, ChevronLeft, ChevronRight, Clock, Truck,
  Shield, Radio, UserCog,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import { getFeatureLabel } from "@/lib/feature-registry";

interface TeamMember {
  id: string; firstName: string; lastName: string; email: string; phone: string;
  role: string; isActive: boolean; employeeStatus: string; hireDate: string;
  payRate: number; payType: string; vehicleInfo: Record<string, string> | null;
  weekHours: number; weekEntries: number;
}

import { formatPhone } from "@/lib/utils";
const fmtPhone = formatPhone;

function getMonday(d: Date): string {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toISOString().split("T")[0];
}

function addDays(s: string, n: number): string {
  const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

function fmtWeek(monday: string): string {
  const mon = new Date(monday + "T00:00:00");
  const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  return `${fmt(mon)} - ${fmt(sun)}`;
}

const FILTERS = ["all", "driver", "admin", "dispatcher", "active", "inactive"];

export default function TeamPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [weekOf, setWeekOf] = useState(() => getMonday(new Date()));
  // Mirrors the Assets includeRetired pattern at assets/page.tsx:384 / 422 / 430.
  // Default OFF so the team page hides deactivated users until an admin opts in.
  const [includeDeactivated, setIncludeDeactivated] = useState(false);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  const fetchTeam = useCallback(async () => {
    setLoading(true);
    try {
      const qs = `/team?weekOf=${weekOf}${includeDeactivated ? "&includeDeactivated=true" : ""}`;
      const res = await api.get<{ data: TeamMember[]; weekOf: string }>(qs);
      setMembers(res.data);
    } catch {
      // Surface fetch failure — empty catch here was Phase B silent-swallow
      // that hid network/5xx errors from the operator.
      toast("error", getFeatureLabel("team_error_generic"));
    } finally {
      setLoading(false);
    }
  }, [weekOf, includeDeactivated, toast]);

  useEffect(() => { fetchTeam(); }, [fetchTeam]);

  const handleReactivate = async (m: TeamMember, e: React.MouseEvent) => {
    e.stopPropagation();
    setReactivatingId(m.id);
    try {
      await api.post(`/team/${m.id}/reactivate`);
      toast("success", getFeatureLabel("team_reactivate_success"));
      await fetchTeam();
    } catch {
      toast("error", getFeatureLabel("team_error_generic"));
    } finally {
      setReactivatingId(null);
    }
  };

  const filtered = members.filter(m => {
    if (filter === "all") return true;
    if (filter === "active") return m.isActive;
    if (filter === "inactive") return !m.isActive;
    return m.role === filter;
  });

  const roleCounts = {
    owner: members.filter(m => m.role === "owner").length,
    admin: members.filter(m => m.role === "admin").length,
    dispatcher: members.filter(m => m.role === "dispatcher").length,
    driver: members.filter(m => m.role === "driver").length,
  };

  const driverHours = members.filter(m => m.role === "driver").reduce((s, m) => s + m.weekHours, 0);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)]">Team</h1>
          <p className="mt-1 text-[13px] text-[var(--t-frame-text-muted)]">{members.length} team members</p>
        </div>
        <Link
          href="/settings"
          className="flex items-center gap-2 rounded-full bg-[var(--t-accent)] px-6 py-2.5 text-sm font-semibold text-[var(--t-accent-on-accent)] transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Add Member
        </Link>
      </div>

      {/* Role Summary Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { role: "owner", label: "Owners", icon: Shield, count: roleCounts.owner },
          { role: "admin", label: "Admins", icon: UserCog, count: roleCounts.admin },
          { role: "dispatcher", label: "Dispatchers", icon: Radio, count: roleCounts.dispatcher },
          { role: "driver", label: "Drivers", icon: Truck, count: roleCounts.driver },
        ].map(t => {
          const active = filter === t.role;
          return (
            <button key={t.role} onClick={() => setFilter(active ? "all" : t.role)}
              className={`rounded-[20px] border p-4 text-left transition-all ${active ? "border-[var(--t-accent)] bg-[var(--t-accent-soft)]" : "border-[var(--t-border)] bg-[var(--t-bg-card)] hover:bg-[var(--t-bg-card-hover)]"}`}>
              <div className="flex items-center justify-between mb-2">
                <t.icon className={`h-5 w-5 ${active ? "text-[var(--t-accent)]" : "text-[var(--t-text-muted)]"}`} />
                <span className="text-[24px] font-bold text-[var(--t-text-primary)] tabular-nums">{t.count}</span>
              </div>
              <p className="text-[13px] uppercase font-semibold tracking-wide text-[var(--t-text-muted)]">{t.label}</p>
              {t.role === "driver" && driverHours > 0 && (
                <p className="text-[11px] text-[var(--t-text-muted)] mt-0.5">{driverHours.toFixed(1)}h this week</p>
              )}
            </button>
          );
        })}
      </div>

      {/* Week Navigation */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => setWeekOf(w => addDays(w, -7))} className="rounded-full border border-[var(--t-frame-border)] bg-[var(--t-frame-hover)] p-2 text-[var(--t-frame-text-muted)] hover:text-[var(--t-frame-text)] active:scale-95 transition-all">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-medium text-[var(--t-frame-text)] min-w-[300px] text-center">{fmtWeek(weekOf)}</p>
        <button onClick={() => setWeekOf(w => addDays(w, 7))} className="rounded-full border border-[var(--t-frame-border)] bg-[var(--t-frame-hover)] p-2 text-[var(--t-frame-text-muted)] hover:text-[var(--t-frame-text)] active:scale-95 transition-all">
          <ChevronRight className="h-4 w-4" />
        </button>
        <button onClick={() => setWeekOf(getMonday(new Date()))} className={`rounded-full border px-3 py-2 text-xs font-medium transition-all active:scale-95 ${weekOf === getMonday(new Date()) ? "bg-[var(--t-accent-soft)] border-[var(--t-accent)] text-[var(--t-accent)]" : "bg-[var(--t-frame-hover)] border-[var(--t-frame-border)] text-[var(--t-frame-text-muted)] hover:text-[var(--t-frame-text)]"}`}>This Week</button>
      </div>

      {/* Filters */}
      <div className="mb-5 flex items-center gap-4 flex-wrap">
        <div style={{ display: "inline-flex", borderRadius: 22, backgroundColor: "var(--t-bg-secondary)", border: "1px solid var(--t-border)", padding: 3, gap: 2 }}>
          {FILTERS.map(f => (
            <button key={f} onClick={() => setFilter(f)}
              style={{ fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 18, border: "none", cursor: "pointer", textTransform: "capitalize", transition: "all 0.15s ease", backgroundColor: filter === f ? "var(--t-accent)" : "transparent", color: filter === f ? "#fff" : "var(--t-text-muted)" }}>
              {f}
            </button>
          ))}
        </div>
        {/* Include-deactivated toggle. Mirrors assets/page.tsx:1433-1438. */}
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--t-text-muted)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={includeDeactivated}
            onChange={(e) => setIncludeDeactivated(e.target.checked)}
            style={{ margin: 0 }}
          />
          {getFeatureLabel("team_include_deactivated_toggle")}
        </label>
      </div>

      {/* Team List */}
      {loading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 skeleton rounded-[20px]" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] py-16 text-center">
          <Users className="mx-auto h-10 w-10 text-[var(--t-text-muted)] opacity-20 mb-2" />
          <p className="text-sm text-[var(--t-text-muted)]">No team members</p>
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map(m => (
            <div key={m.id} onClick={() => router.push(`/team/${m.id}`)}
              className="flex items-center justify-between rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-5 py-3.5 cursor-pointer hover:bg-[var(--t-bg-card-hover)] transition-colors"
              style={{ opacity: m.isActive ? 1 : 0.55 }}>
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--t-bg-card-hover)] text-sm font-bold text-[var(--t-text-primary)]">
                  {m.firstName[0]}{m.lastName[0]}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--t-text-primary)]">{m.firstName} {m.lastName}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] font-semibold capitalize text-[var(--t-text-muted)]">{m.role}</span>
                    {m.role === "driver" && (
                      <span className="text-[11px] font-semibold text-[var(--t-accent)]">Billable</span>
                    )}
                    {!m.isActive && (
                      <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", padding: "2px 8px", borderRadius: 10, background: "var(--t-bg-card-hover)", color: "var(--t-text-muted)", border: "1px solid var(--t-border)" }}>
                        {getFeatureLabel("team_deactivated_badge")}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-6 shrink-0">
                {/* Hours */}
                <div className="text-right hidden sm:block">
                  <p className={`text-sm font-semibold tabular-nums ${m.weekHours > 40 ? "text-[var(--t-error)]" : "text-[var(--t-text-primary)]"}`}>{m.weekHours.toFixed(1)}h</p>
                  <p className="text-[11px] text-[var(--t-text-muted)]">{m.payRate ? `$${Number(m.payRate).toFixed(2)}/hr` : ""}</p>
                </div>

                {/* Phone */}
                {m.phone && (
                  <span onClick={e => e.stopPropagation()} className="hidden md:flex items-center gap-1 text-[13px] text-[var(--t-text-muted)]">
                    <Phone className="h-3 w-3" />
                    <a href={`tel:${m.phone}`} className="hover:text-[var(--t-accent)]">{fmtPhone(m.phone)}</a>
                  </span>
                )}

                {/* Reactivate (shown only on deactivated rows, when the toggle revealed them) */}
                {!m.isActive && (
                  <button
                    onClick={(e) => handleReactivate(m, e)}
                    disabled={reactivatingId === m.id}
                    className="rounded-full border border-[var(--t-border)] px-3 py-1 text-[11px] font-semibold text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors disabled:opacity-50"
                  >
                    {reactivatingId === m.id ? "..." : getFeatureLabel("team_reactivate_action")}
                  </button>
                )}

                {/* Status */}
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold capitalize">
                  <span className={`h-1.5 w-1.5 rounded-full ${m.employeeStatus === "inactive" ? "bg-[var(--t-text-muted)]" : m.employeeStatus === "on_break" ? "bg-yellow-500" : "bg-[var(--t-accent)]"}`} />
                  <span className="hidden md:inline text-[var(--t-text-muted)]">{m.employeeStatus || "active"}</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
