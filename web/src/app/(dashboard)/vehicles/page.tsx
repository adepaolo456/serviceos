"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CarFront, Users, Search, Plus, Truck } from "lucide-react";
import { api } from "@/lib/api";

interface TeamMember {
  id: string; firstName: string; lastName: string; role: string;
  vehicleInfo: { year?: string; make?: string; model?: string; plate?: string } | null;
  isActive: boolean; employeeStatus: string;
}

export default function VehiclesPage() {
  const router = useRouter();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.get<{ data: TeamMember[] }>("/team")
      .then(res => setMembers(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const withVehicle = members.filter(m => m.vehicleInfo && (m.vehicleInfo.make || m.vehicleInfo.model));
  const withoutVehicle = members.filter(m => m.role === "driver" && (!m.vehicleInfo || (!m.vehicleInfo.make && !m.vehicleInfo.model)));

  const filtered = withVehicle.filter(m => {
    if (!search) return true;
    const s = search.toLowerCase();
    const vName = `${m.vehicleInfo?.year || ""} ${m.vehicleInfo?.make || ""} ${m.vehicleInfo?.model || ""}`.toLowerCase();
    const dName = `${m.firstName} ${m.lastName}`.toLowerCase();
    return vName.includes(s) || dName.includes(s) || (m.vehicleInfo?.plate || "").toLowerCase().includes(s);
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)]">Vehicles</h1>
          <p className="mt-1 text-[13px] text-[var(--t-frame-text-muted)]">{withVehicle.length} vehicles in fleet</p>
        </div>
      </div>

      {/* Summary Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4">
          <div className="flex items-center justify-between mb-2">
            <CarFront className="h-5 w-5 text-[var(--t-text-muted)]" />
            <span className="text-[24px] font-bold text-[var(--t-text-primary)] tabular-nums">{withVehicle.length}</span>
          </div>
          <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)]">Total Vehicles</p>
        </div>
        <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4">
          <div className="flex items-center justify-between mb-2">
            <Truck className="h-5 w-5 text-[var(--t-accent)]" />
            <span className="text-[24px] font-bold text-[var(--t-text-primary)] tabular-nums">{withVehicle.filter(m => m.role === "driver").length}</span>
          </div>
          <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)]">Assigned to Drivers</p>
        </div>
        <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4">
          <div className="flex items-center justify-between mb-2">
            <Users className="h-5 w-5 text-[var(--t-warning)]" />
            <span className="text-[24px] font-bold text-[var(--t-text-primary)] tabular-nums">{withoutVehicle.length}</span>
          </div>
          <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)]">Drivers Without Vehicle</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--t-frame-text-muted)]" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vehicles, drivers, plates..."
          className="w-full rounded-[20px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.06)] pl-10 pr-4 py-2.5 text-sm text-[var(--t-frame-text)] placeholder-[var(--t-frame-text-muted)] outline-none focus:border-[var(--t-accent)]" />
      </div>

      {/* Vehicle List */}
      {loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 skeleton rounded-[20px]" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] py-16 text-center">
          <CarFront className="mx-auto h-10 w-10 text-[var(--t-text-muted)] opacity-20 mb-2" />
          <p className="text-sm text-[var(--t-text-muted)]">{search ? "No vehicles match your search" : "No vehicles in fleet"}</p>
          <p className="text-[13px] text-[var(--t-text-muted)] opacity-60 mt-1">Assign vehicles from team member profiles</p>
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map(m => {
            const v = m.vehicleInfo!;
            const displayName = `${v.year || ""} ${v.make || ""} ${v.model || ""}`.trim() || "Unknown Vehicle";
            return (
              <div key={m.id} onClick={() => router.push(`/vehicles/${m.id}`)}
                className="flex items-center justify-between rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-5 py-3.5 cursor-pointer hover:bg-[var(--t-bg-card-hover)] transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <CarFront className="h-5 w-5 text-[var(--t-text-muted)] shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--t-text-primary)] truncate">{displayName}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[13px] text-[var(--t-text-muted)]">{m.firstName} {m.lastName}</span>
                      {v.plate && <span className="text-[11px] text-[var(--t-text-muted)] font-mono">{v.plate}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-semibold capitalize text-[var(--t-text-muted)]">{m.role}</span>
                  <span className={`h-2 w-2 rounded-full ${m.isActive ? "bg-[var(--t-accent)]" : "bg-[var(--t-text-muted)]"}`} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
