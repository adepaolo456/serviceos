"use client";

import { useState, useEffect, use, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft, Phone, Mail, Clock, Briefcase, DollarSign, Truck,
  User, Calendar, Settings, Pencil, Shield,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import SlideOver from "@/components/slide-over";

interface Employee {
  id: string; firstName: string; lastName: string; email: string; phone: string;
  role: string; isActive: boolean; employeeStatus: string; hireDate: string;
  payRate: number; payType: string; overtimeRate: number;
  vehicleInfo: Record<string, string> | null;
  emergencyContact: Record<string, string> | null; createdAt: string;
}

interface TimeEntry {
  id: string; clock_in: string; clock_out: string | null; break_minutes: number;
  total_hours: number; status: string; notes: string;
  clock_in_location: Record<string, unknown> | null;
}

interface Timesheet {
  weekOf: string; entries: TimeEntry[]; totalHours: number;
  regularHours: number; overtimeHours: number;
}

interface Performance { monthJobs: number; weekJobs: number; avgPerDay: number; }

const ROLE_CLS: Record<string, string> = {
  owner: "bg-amber-500/15 text-amber-400", admin: "bg-blue-500/15 text-blue-400",
  dispatcher: "bg-purple-500/15 text-purple-400", driver: "bg-brand/15 text-brand",
};

const TABS = [
  { key: "profile", label: "Profile", icon: User },
  { key: "time", label: "Time Tracking", icon: Clock },
  { key: "performance", label: "Performance", icon: Briefcase },
  { key: "settings", label: "Settings", icon: Settings },
] as const;

type Tab = typeof TABS[number]["key"];

function fmtTime(d: string) { return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
function fmtDate(d: string) { return new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); }

export default function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { toast } = useToast();
  const [emp, setEmp] = useState<Employee | null>(null);
  const [timesheet, setTimesheet] = useState<Timesheet | null>(null);
  const [perf, setPerf] = useState<Performance | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("profile");
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [e, t, p] = await Promise.all([
          api.get<Employee>(`/team/${id}`),
          api.get<Timesheet>(`/team/timesheet/${id}`),
          api.get<Performance>(`/team/${id}/performance`).catch(() => ({ monthJobs: 0, weekJobs: 0, avgPerDay: 0 })),
        ]);
        setEmp(e); setTimesheet(t); setPerf(p);
      } catch { /* */ }
      finally { setLoading(false); }
    }
    load();
  }, [id]);

  if (loading) return <div className="space-y-4"><div className="h-8 w-48 skeleton rounded" /><div className="h-48 skeleton rounded-2xl" /></div>;
  if (!emp) return <div className="py-20 text-center text-muted">Employee not found</div>;

  const rate = Number(emp.payRate) || 0;
  const otRate = Number(emp.overtimeRate) || rate * 1.5;

  return (
    <div>
      <Link href="/team" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> Team
      </Link>

      {/* Header */}
      <div className="rounded-2xl bg-dark-card border border-[#1E2D45] p-5 mb-5">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold ${ROLE_CLS[emp.role] || ROLE_CLS.driver}`}>
              {emp.firstName[0]}{emp.lastName[0]}
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-white">{emp.firstName} {emp.lastName}</h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${ROLE_CLS[emp.role] || ""}`}>{emp.role}</span>
                <span className={`inline-flex items-center gap-1 text-[10px] ${emp.isActive ? "text-brand" : "text-red-400"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${emp.isActive ? "bg-brand" : "bg-red-500"}`} />{emp.isActive ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-2 text-xs text-muted flex-wrap">
                {emp.phone && <a href={`tel:${emp.phone}`} className="hover:text-brand transition-colors"><Phone className="inline h-3 w-3 mr-1" />{emp.phone}</a>}
                {emp.email && <a href={`mailto:${emp.email}`} className="hover:text-brand transition-colors"><Mail className="inline h-3 w-3 mr-1" />{emp.email}</a>}
              </div>
            </div>
          </div>
          <button onClick={() => setEditOpen(true)} className="rounded-lg bg-dark-elevated p-2 text-muted hover:text-foreground btn-press"><Pencil className="h-4 w-4" /></button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-[#1E2D45] mb-5 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors shrink-0 btn-press ${tab === t.key ? "text-brand" : "text-muted hover:text-foreground"}`}>
            <t.icon className="h-3.5 w-3.5" />{t.label}
            {tab === t.key && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brand rounded-full" />}
          </button>
        ))}
      </div>

      {/* Profile Tab */}
      {tab === "profile" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 max-w-4xl">
          <Card title="Employment">
            <Row label="Role" value={<span className="capitalize">{emp.role}</span>} />
            <Row label="Hire Date" value={emp.hireDate || "—"} />
            <Row label="Pay Rate" value={rate ? `$${rate.toFixed(2)}/hr` : "—"} />
            <Row label="Pay Type" value={<span className="capitalize">{emp.payType || "hourly"}</span>} />
            <Row label="OT Rate" value={otRate ? `$${otRate.toFixed(2)}/hr` : "—"} />
          </Card>
          <Card title="Vehicle">
            {emp.vehicleInfo ? (
              <>
                <Row label="Make" value={emp.vehicleInfo.make || "—"} />
                <Row label="Model" value={emp.vehicleInfo.model || "—"} />
                <Row label="Year" value={emp.vehicleInfo.year || "—"} />
                <Row label="Plate" value={emp.vehicleInfo.plate || "—"} />
              </>
            ) : <p className="text-xs text-muted py-2">No vehicle assigned</p>}
          </Card>
          <Card title="Emergency Contact">
            {emp.emergencyContact ? (
              <>
                <Row label="Name" value={emp.emergencyContact.name || "—"} />
                <Row label="Phone" value={emp.emergencyContact.phone || "—"} />
                <Row label="Relationship" value={emp.emergencyContact.relationship || "—"} />
              </>
            ) : <p className="text-xs text-muted py-2">Not set</p>}
          </Card>
          <Card title="This Week">
            <Row label="Total Hours" value={<span className={`font-semibold tabular-nums ${(timesheet?.totalHours || 0) > 40 ? "text-red-400" : "text-white"}`}>{(timesheet?.totalHours || 0).toFixed(1)}h</span>} />
            <Row label="Regular" value={`${(timesheet?.regularHours || 0).toFixed(1)}h`} />
            <Row label="Overtime" value={<span className={`tabular-nums ${(timesheet?.overtimeHours || 0) > 0 ? "text-red-400" : ""}`}>{(timesheet?.overtimeHours || 0).toFixed(1)}h</span>} />
            <Row label="Est. Pay" value={`$${((timesheet?.regularHours || 0) * rate + (timesheet?.overtimeHours || 0) * otRate).toFixed(2)}`} />
          </Card>
        </div>
      )}

      {/* Time Tracking Tab */}
      {tab === "time" && timesheet && (
        <div className="max-w-3xl">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-medium text-white">Week of {timesheet.weekOf}</p>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted">Total: <span className="text-white font-medium tabular-nums">{timesheet.totalHours.toFixed(1)}h</span></span>
              {timesheet.overtimeHours > 0 && <span className="text-red-400 font-medium">OT: {timesheet.overtimeHours.toFixed(1)}h</span>}
            </div>
          </div>
          {timesheet.entries.length === 0 ? (
            <div className="py-12 text-center"><Clock className="mx-auto h-8 w-8 text-muted/20 mb-2" /><p className="text-xs text-muted">No time entries this week</p></div>
          ) : (
            <div className="rounded-2xl bg-dark-card border border-[#1E2D45] overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[#1E2D45]">
                  {["Date", "In", "Out", "Break", "Hours", "Status"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {timesheet.entries.map(e => (
                    <tr key={e.id} className="border-b border-[#1E2D45] last:border-0">
                      <td className="px-4 py-3 text-white">{fmtDate(e.clock_in)}</td>
                      <td className="px-4 py-3 text-foreground tabular-nums">{fmtTime(e.clock_in)}</td>
                      <td className="px-4 py-3 text-foreground tabular-nums">{e.clock_out ? fmtTime(e.clock_out) : "—"}</td>
                      <td className="px-4 py-3 text-muted">{e.break_minutes}m</td>
                      <td className="px-4 py-3 text-white font-medium tabular-nums">{Number(e.total_hours).toFixed(1)}h</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${e.status === "approved" ? "bg-brand/10 text-brand" : e.status === "flagged" ? "bg-red-500/10 text-red-400" : "bg-yellow-500/10 text-yellow-400"}`}>{e.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Performance Tab */}
      {tab === "performance" && perf && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 max-w-2xl">
          <StatCard label="This Week" value={String(perf.weekJobs)} sub="jobs completed" icon={Briefcase} />
          <StatCard label="This Month" value={String(perf.monthJobs)} sub="jobs completed" icon={Calendar} />
          <StatCard label="Daily Avg" value={perf.avgPerDay.toFixed(1)} sub="jobs per day" icon={Truck} />
        </div>
      )}

      {/* Settings Tab */}
      {tab === "settings" && (
        <div className="max-w-md space-y-4">
          <Card title="Account">
            <Row label="Email" value={emp.email} />
            <Row label="Role" value={<span className="capitalize">{emp.role}</span>} />
            <Row label="Active" value={emp.isActive ? "Yes" : "No"} />
          </Card>
          <button className="w-full rounded-lg bg-red-500/10 py-3 text-sm font-medium text-red-400 hover:bg-red-500/20 transition-colors btn-press">
            Deactivate Employee
          </button>
        </div>
      )}

      {/* Edit */}
      <SlideOver open={editOpen} onClose={() => setEditOpen(false)} title="Edit Employee">
        <EditForm emp={emp} onSuccess={e => { setEmp(e); setEditOpen(false); toast("success", "Updated"); }} />
      </SlideOver>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl bg-dark-card border border-[#1E2D45] p-4"><p className="text-xs text-muted uppercase tracking-wider font-semibold mb-3">{title}</p>{children}</div>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-center justify-between py-1.5 text-sm"><span className="text-muted">{label}</span><span className="text-foreground">{value}</span></div>;
}

function StatCard({ label, value, sub, icon: Icon }: { label: string; value: string; sub: string; icon: typeof Briefcase }) {
  return (
    <div className="rounded-xl bg-dark-card border border-[#1E2D45] p-5 text-center">
      <Icon className="mx-auto h-5 w-5 text-brand mb-2" />
      <p className="text-2xl font-bold text-white tabular-nums">{value}</p>
      <p className="text-[10px] text-muted mt-0.5">{sub}</p>
      <p className="text-xs text-muted mt-1">{label}</p>
    </div>
  );
}

function EditForm({ emp, onSuccess }: { emp: Employee; onSuccess: (e: Employee) => void }) {
  const [firstName, setFirstName] = useState(emp.firstName);
  const [lastName, setLastName] = useState(emp.lastName);
  const [phone, setPhone] = useState(emp.phone || "");
  const [role, setRole] = useState(emp.role);
  const [payRate, setPayRate] = useState(String(emp.payRate || ""));
  const [hireDate, setHireDate] = useState(emp.hireDate || "");
  const [vMake, setVMake] = useState(emp.vehicleInfo?.make || "");
  const [vModel, setVModel] = useState(emp.vehicleInfo?.model || "");
  const [vYear, setVYear] = useState(emp.vehicleInfo?.year || "");
  const [vPlate, setVPlate] = useState(emp.vehicleInfo?.plate || "");
  const [ecName, setEcName] = useState(emp.emergencyContact?.name || "");
  const [ecPhone, setEcPhone] = useState(emp.emergencyContact?.phone || "");
  const [ecRel, setEcRel] = useState(emp.emergencyContact?.relationship || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const inputCls = "w-full bg-[#111C2E] border border-[#1E2D45] rounded-lg px-4 py-2.5 text-sm text-white placeholder-muted outline-none focus:border-brand";
  const labelCls = "block text-xs font-medium text-muted uppercase tracking-wider mb-1.5";

  return (
    <form onSubmit={async (e: FormEvent) => {
      e.preventDefault(); setError(""); setSaving(true);
      try {
        const u = await api.patch<Employee>(`/team/${emp.id}`, {
          firstName, lastName, phone: phone || undefined, role,
          payRate: payRate ? Number(payRate) : undefined, hireDate: hireDate || undefined,
          vehicleInfo: vMake || vModel ? { make: vMake, model: vModel, year: vYear, plate: vPlate } : undefined,
          emergencyContact: ecName ? { name: ecName, phone: ecPhone, relationship: ecRel } : undefined,
        });
        onSuccess(u);
      } catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
      finally { setSaving(false); }
    }} className="space-y-4">
      {error && <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>First</label><input value={firstName} onChange={e => setFirstName(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Last</label><input value={lastName} onChange={e => setLastName(e.target.value)} className={inputCls} /></div>
      </div>
      <div><label className={labelCls}>Phone</label><input value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} /></div>
      <div><label className={labelCls}>Role</label>
        <select value={role} onChange={e => setRole(e.target.value)} className={`${inputCls} appearance-none`}>
          <option value="driver">Driver</option><option value="dispatcher">Dispatcher</option><option value="admin">Admin</option><option value="owner">Owner</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>Pay Rate ($/hr)</label><input type="number" step="0.01" value={payRate} onChange={e => setPayRate(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Hire Date</label><input type="date" value={hireDate} onChange={e => setHireDate(e.target.value)} className={inputCls} /></div>
      </div>
      <p className="text-xs text-muted uppercase tracking-wider font-semibold pt-2 border-t border-[#1E2D45] mt-2">Vehicle</p>
      <div className="grid grid-cols-2 gap-3">
        <input value={vMake} onChange={e => setVMake(e.target.value)} className={inputCls} placeholder="Make" />
        <input value={vModel} onChange={e => setVModel(e.target.value)} className={inputCls} placeholder="Model" />
        <input value={vYear} onChange={e => setVYear(e.target.value)} className={inputCls} placeholder="Year" />
        <input value={vPlate} onChange={e => setVPlate(e.target.value)} className={inputCls} placeholder="Plate" />
      </div>
      <p className="text-xs text-muted uppercase tracking-wider font-semibold pt-2 border-t border-[#1E2D45] mt-2">Emergency Contact</p>
      <input value={ecName} onChange={e => setEcName(e.target.value)} className={inputCls} placeholder="Name" />
      <div className="grid grid-cols-2 gap-3">
        <input value={ecPhone} onChange={e => setEcPhone(e.target.value)} className={inputCls} placeholder="Phone" />
        <input value={ecRel} onChange={e => setEcRel(e.target.value)} className={inputCls} placeholder="Relationship" />
      </div>
      <button type="submit" disabled={saving} className="w-full rounded-lg bg-brand py-3 text-sm font-bold text-white hover:bg-brand-light disabled:opacity-50 btn-press mt-2">
        {saving ? "Saving..." : "Save"}
      </button>
    </form>
  );
}
