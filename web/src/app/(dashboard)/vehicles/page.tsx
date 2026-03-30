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

const ROLE_CLS: Record<string, string> = {
  owner: "bg-amber-500/10 text-amber-400", admin: "bg-blue-500/10 text-blue-400",
  dispatcher: "bg-purple-500/10 text-purple-400", driver: "bg-brand/10 text-brand",
};
const ROLE_AVATAR: Record<string, string> = {
  owner: "bg-amber-500/15 text-amber-400", admin: "bg-blue-500/15 text-blue-400",
  dispatcher: "bg-purple-500/15 text-purple-400", driver: "bg-brand/15 text-brand",
};

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
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">Vehicles</h1>
          <p className="mt-0.5 text-sm text-muted">{withVehicle.length} vehicles in fleet</p>
        </div>
      </div>

      {/* Summary Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-[#1E2D45] bg-dark-card p-4">
          <div className="flex items-center justify-between mb-2">
            <CarFront className="h-5 w-5 text-muted" />
            <span className="text-2xl font-bold text-white tabular-nums">{withVehicle.length}</span>
          </div>
          <p className="text-xs font-medium text-muted">Total Vehicles</p>
        </div>
        <div className="rounded-xl border border-[#1E2D45] bg-dark-card p-4">
          <div className="flex items-center justify-between mb-2">
            <Truck className="h-5 w-5 text-brand" />
            <span className="text-2xl font-bold text-white tabular-nums">{withVehicle.filter(m => m.role === "driver").length}</span>
          </div>
          <p className="text-xs font-medium text-muted">Assigned to Drivers</p>
        </div>
        <div className="rounded-xl border border-[#1E2D45] bg-dark-card p-4">
          <div className="flex items-center justify-between mb-2">
            <Users className="h-5 w-5 text-amber-400" />
            <span className="text-2xl font-bold text-white tabular-nums">{withoutVehicle.length}</span>
          </div>
          <p className="text-xs font-medium text-muted">Drivers Without Vehicle</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vehicles, drivers, plates..."
          className="w-full rounded-lg bg-dark-card border border-[#1E2D45] pl-10 pr-4 py-2.5 text-sm text-white placeholder-muted outline-none focus:border-brand" />
      </div>

      {/* Vehicle Cards */}
      {loading ? (
        <div className="grid gap-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 skeleton rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-dark-card border border-dashed border-[#1E2D45] py-16 text-center">
          <CarFront className="mx-auto h-10 w-10 text-muted/20 mb-2" />
          <p className="text-sm text-muted">{search ? "No vehicles match your search" : "No vehicles in fleet"}</p>
          <p className="text-xs text-muted/60 mt-1">Assign vehicles from team member profiles</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map(m => {
            const v = m.vehicleInfo!;
            const displayName = `${v.year || ""} ${v.make || ""} ${v.model || ""}`.trim() || "Unknown Vehicle";
            return (
              <div key={m.id} onClick={() => router.push(`/vehicles/${m.id}`)}
                className="rounded-xl bg-dark-card border border-[#1E2D45] p-4 cursor-pointer hover:bg-dark-card-hover hover:border-white/10 transition-all">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-dark-elevated">
                    <CarFront className="h-5 w-5 text-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{displayName}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold ${ROLE_AVATAR[m.role] || ROLE_AVATAR.driver}`}>
                        {m.firstName[0]}{m.lastName[0]}
                      </div>
                      <span className="text-xs text-muted truncate">{m.firstName} {m.lastName}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium capitalize ${ROLE_CLS[m.role] || ""}`}>{m.role}</span>
                    </div>
                    {v.plate && <p className="text-xs text-muted mt-1.5 font-mono">{v.plate}</p>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
