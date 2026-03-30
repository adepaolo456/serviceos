"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus, Users, Phone, Mail, ChevronLeft, ChevronRight, Clock, Truck,
  Shield, Radio, UserCog,
} from "lucide-react";
import { api } from "@/lib/api";

interface TeamMember {
  id: string; firstName: string; lastName: string; email: string; phone: string;
  role: string; isActive: boolean; employeeStatus: string; hireDate: string;
  payRate: number; payType: string; vehicleInfo: Record<string, string> | null;
  weekHours: number; weekEntries: number;
}

const ROLE_CLS: Record<string, string> = {
  owner: "bg-amber-500/10 text-amber-400",
  admin: "bg-blue-500/10 text-blue-400",
  dispatcher: "bg-purple-500/10 text-purple-400",
  driver: "bg-brand/10 text-brand",
  viewer: "bg-zinc-500/10 text-zinc-400",
};

const ROLE_AVATAR: Record<string, string> = {
  owner: "bg-amber-500/15 text-amber-400",
  admin: "bg-blue-500/15 text-blue-400",
  dispatcher: "bg-purple-500/15 text-purple-400",
  driver: "bg-brand/15 text-brand",
  viewer: "bg-zinc-500/15 text-zinc-400",
};

const STATUS_DOT: Record<string, string> = {
  active: "bg-brand", inactive: "bg-zinc-500", "on_break": "bg-yellow-500",
};

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
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [weekOf, setWeekOf] = useState(() => getMonday(new Date()));

  const fetchTeam = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: TeamMember[]; weekOf: string }>(`/team?weekOf=${weekOf}`);
      setMembers(res.data);
    } catch { /* */ }
    finally { setLoading(false); }
  }, [weekOf]);

  useEffect(() => { fetchTeam(); }, [fetchTeam]);

  const filtered = members.filter(m => {
    if (filter === "all") return true;
    if (filter === "active") return m.isActive;
    if (filter === "inactive") return !m.isActive;
    return m.role === filter;
  });

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">Team</h1>
          <p className="mt-0.5 text-sm text-muted">{members.length} team members</p>
        </div>
        <Link href="/settings" className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-light btn-press">
          <Plus className="h-4 w-4" /> Add Employee
        </Link>
      </div>

      {/* Role Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { role: "owner", label: "Owners", icon: Shield, color: "amber" },
          { role: "admin", label: "Admins", icon: UserCog, color: "blue" },
          { role: "dispatcher", label: "Dispatchers", icon: Radio, color: "purple" },
          { role: "driver", label: "Drivers", icon: Truck, color: "brand" },
        ].map(t => {
          const count = members.filter(m => m.role === t.role).length;
          const active = filter === t.role;
          const driverHours = t.role === "driver" ? members.filter(m => m.role === "driver").reduce((s, m) => s + m.weekHours, 0) : 0;
          return (
            <button key={t.role} onClick={() => setFilter(active ? "all" : t.role)}
              className={`rounded-xl border p-4 text-left transition-all btn-press ${active ? "border-brand bg-brand/5" : "border-[#1E2D45] bg-dark-card hover:bg-dark-card-hover"}`}>
              <div className="flex items-center justify-between mb-2">
                <t.icon className={`h-5 w-5 ${active ? "text-brand" : "text-muted"}`} />
                <span className="text-xl font-bold text-white tabular-nums">{count}</span>
              </div>
              <p className="text-xs font-medium text-muted">{t.label}</p>
              {t.role === "driver" && driverHours > 0 && (
                <p className="text-[10px] text-muted mt-0.5">{driverHours.toFixed(1)}h this week</p>
              )}
            </button>
          );
        })}
      </div>

      {/* Week Navigation */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => setWeekOf(w => addDays(w, -7))} className="rounded-lg bg-dark-card border border-[#1E2D45] p-2 text-muted hover:text-white active:scale-95 transition-all">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-medium text-white min-w-[300px] text-center">{fmtWeek(weekOf)}</p>
        <button onClick={() => setWeekOf(w => addDays(w, 7))} className="rounded-lg bg-dark-card border border-[#1E2D45] p-2 text-muted hover:text-white active:scale-95 transition-all">
          <ChevronRight className="h-4 w-4" />
        </button>
        <button onClick={() => setWeekOf(getMonday(new Date()))} className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all active:scale-95 ${weekOf === getMonday(new Date()) ? "bg-brand/10 border-brand/20 text-brand" : "bg-dark-card border-[#1E2D45] text-muted hover:text-white"}`}>This Week</button>
      </div>

      {/* Filters */}
      <div className="flex gap-1 mb-5">
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors btn-press ${filter === f ? "bg-brand/15 text-brand" : "bg-dark-card text-muted hover:text-foreground"}`}>
            {f}
          </button>
        ))}
      </div>

      {/* Team Cards */}
      {loading ? (
        <div className="grid gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 skeleton rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-dark-card border border-[#1E2D45] py-16 text-center">
          <Users className="mx-auto h-10 w-10 text-muted/20 mb-2" />
          <p className="text-sm text-muted">No team members</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map(m => (
            <div key={m.id} onClick={() => router.push(`/team/${m.id}`)}
              className="rounded-xl bg-dark-card border border-[#1E2D45] p-4 cursor-pointer hover:bg-dark-card-hover hover:border-white/10 transition-all">
              <div className="flex items-center gap-4">
                {/* Avatar + Name */}
                <div className="flex items-center gap-3 min-w-[180px]">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${ROLE_AVATAR[m.role] || ROLE_AVATAR.viewer}`}>
                    {m.firstName[0]}{m.lastName[0]}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{m.firstName} {m.lastName}</p>
                    <span className={`inline-block mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${ROLE_CLS[m.role] || ROLE_CLS.viewer}`}>{m.role}</span>
                  </div>
                </div>

                {/* Contact */}
                <div className="flex-1 min-w-0 hidden sm:flex items-center gap-4" onClick={e => e.stopPropagation()}>
                  {m.phone && <a href={`tel:${m.phone}`} className="flex items-center gap-1 text-xs text-foreground hover:text-brand shrink-0"><Phone className="h-3 w-3 text-muted" />{fmtPhone(m.phone)}</a>}
                  {m.email && <a href={`mailto:${m.email}`} className="flex items-center gap-1 text-xs text-foreground hover:text-brand truncate"><Mail className="h-3 w-3 text-muted" /><span className="truncate max-w-[160px]">{m.email}</span></a>}
                  {m.vehicleInfo && <span className="flex items-center gap-1 text-xs text-muted shrink-0"><Truck className="h-3 w-3" />{`${m.vehicleInfo.year || ""} ${m.vehicleInfo.make || ""}`.trim()}</span>}
                </div>

                {/* Right: Status + Hours + Rate */}
                <div className="flex items-center gap-4 shrink-0">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-medium capitalize">
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[m.employeeStatus] || STATUS_DOT.active}`} />
                    <span className="hidden md:inline">{m.employeeStatus || "active"}</span>
                  </span>
                  <div className="text-right min-w-[60px]">
                    <p className={`text-sm font-semibold tabular-nums ${m.weekHours > 40 ? "text-red-400" : "text-white"}`}>{m.weekHours.toFixed(1)}h</p>
                    <p className="text-[10px] text-muted">{m.payRate ? `$${Number(m.payRate).toFixed(2)}/hr` : ""}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
