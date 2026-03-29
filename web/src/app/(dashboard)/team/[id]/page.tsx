"use client";

import { useState, useEffect, use, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft, Phone, Mail, Clock, Briefcase, DollarSign, Truck,
  User, Calendar, Settings, Pencil, Shield, MapPin, Plus, X,
  ChevronDown, ChevronUp, MessageSquare, Monitor, Smartphone,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import SlideOver from "@/components/slide-over";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";

/* ---- Types ---- */

interface Employee {
  id: string; firstName: string; lastName: string; email: string; phone: string;
  role: string; isActive: boolean; employeeStatus: string; hireDate: string;
  payRate: number; payType: string; overtimeRate: number;
  vehicleInfo: Record<string, string> | null;
  emergencyContact: Record<string, string> | null; createdAt: string;
  driverRates: Record<string, unknown>;
  permissions: Record<string, unknown>;
  additionalPhones: Array<{ label: string; number: string }>;
  additionalEmails: Array<{ label: string; email: string }>;
  smsOptIn: boolean;
  address: Record<string, unknown> | null;
}

interface TimeEntry {
  id: string; clock_in: string; clock_out: string | null; break_minutes: number;
  total_hours: number; status: string; notes: string;
}

interface Timesheet { weekOf: string; entries: TimeEntry[]; totalHours: number; regularHours: number; overtimeHours: number; }
interface Performance { monthJobs: number; weekJobs: number; avgPerDay: number; }

const ROLE_CLS: Record<string, string> = {
  owner: "bg-amber-500/15 text-amber-400", admin: "bg-blue-500/15 text-blue-400",
  dispatcher: "bg-purple-500/15 text-purple-400", driver: "bg-brand/15 text-brand",
};

function fmtPhone(p: string | null): string {
  if (!p) return ""; const d = p.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`; return p;
}

function fmtTime(d: string) { return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
function fmtDate(d: string) { return new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); }

const TABS = [
  { key: "profile", label: "Profile", icon: User },
  { key: "rates", label: "Driver Rates", icon: DollarSign },
  { key: "time", label: "Time Tracking", icon: Clock },
  { key: "contact", label: "Contact", icon: Phone },
  { key: "access", label: "Access", icon: Shield },
  { key: "performance", label: "Performance", icon: Briefcase },
  { key: "settings", label: "Settings", icon: Settings },
] as const;

type Tab = typeof TABS[number]["key"];

const JOB_TYPES = ["drop_off", "pick_up", "exchange", "live_load", "dump_return", "relocate", "failed"];
const JOB_TYPE_LABELS: Record<string, string> = {
  drop_off: "Drop Off", pick_up: "Pick Up", exchange: "Exchange",
  live_load: "Live Load", dump_return: "Dump & Return", relocate: "Relocate", failed: "Failed Job",
};
const SIZES = ["10yd", "15yd", "20yd", "30yd", "40yd"];

/* ---- Page ---- */

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
      } catch { /* */ } finally { setLoading(false); }
    }
    load();
  }, [id]);

  if (loading) return <div className="space-y-4"><div className="h-8 w-48 skeleton rounded" /><div className="h-48 skeleton rounded-2xl" /></div>;
  if (!emp) return <div className="py-20 text-center text-muted">Not found</div>;

  const rate = Number(emp.payRate) || 0;
  const otRate = Number(emp.overtimeRate) || rate * 1.5;

  return (
    <div>
      <Link href="/team" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors mb-4"><ArrowLeft className="h-3.5 w-3.5" /> Team</Link>

      {/* Header */}
      <div className="rounded-2xl bg-dark-card border border-[#1E2D45] p-5 mb-5">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold ${ROLE_CLS[emp.role] || ROLE_CLS.driver}`}>{emp.firstName[0]}{emp.lastName[0]}</div>
            <div>
              <h1 className="font-display text-xl font-bold text-white">{emp.firstName} {emp.lastName}</h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${ROLE_CLS[emp.role] || ""}`}>{emp.role}</span>
                <span className={`inline-flex items-center gap-1 text-[10px] ${emp.isActive ? "text-brand" : "text-red-400"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${emp.isActive ? "bg-brand" : "bg-red-500"}`} />{emp.isActive ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-2 text-xs text-muted flex-wrap">
                {emp.phone && <a href={`tel:${emp.phone}`} className="hover:text-brand"><Phone className="inline h-3 w-3 mr-1" />{fmtPhone(emp.phone)}</a>}
                {emp.email && <a href={`mailto:${emp.email}`} className="hover:text-brand"><Mail className="inline h-3 w-3 mr-1" />{emp.email}</a>}
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
            className={`relative flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-medium transition-colors shrink-0 btn-press ${tab === t.key ? "text-brand" : "text-muted hover:text-foreground"}`}>
            <t.icon className="h-3.5 w-3.5" />{t.label}
            {tab === t.key && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brand rounded-full" />}
          </button>
        ))}
      </div>

      {/* ===== PROFILE ===== */}
      {tab === "profile" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 max-w-4xl">
          <Card title="Employment">
            <Row label="Role" value={<span className="capitalize">{emp.role}</span>} />
            <Row label="Hire Date" value={emp.hireDate || "—"} />
            <Row label="Pay Rate" value={rate ? `$${rate.toFixed(2)}/hr` : "—"} />
            <Row label="OT Rate" value={otRate ? `$${otRate.toFixed(2)}/hr` : "—"} />
          </Card>
          <Card title="Vehicle">
            {emp.vehicleInfo ? (<>
              <Row label="Vehicle" value={`${emp.vehicleInfo.year || ""} ${emp.vehicleInfo.make || ""} ${emp.vehicleInfo.model || ""}`.trim() || "—"} />
              <Row label="Plate" value={emp.vehicleInfo.plate || "—"} />
            </>) : <p className="text-xs text-muted py-2">No vehicle assigned</p>}
          </Card>
          <Card title="Emergency Contact">
            {emp.emergencyContact ? (<>
              <Row label="Name" value={emp.emergencyContact.name || "—"} />
              <Row label="Phone" value={emp.emergencyContact.phone ? fmtPhone(emp.emergencyContact.phone) : "—"} />
              <Row label="Relation" value={emp.emergencyContact.relationship || "—"} />
            </>) : <p className="text-xs text-muted py-2">Not set</p>}
          </Card>
          <Card title="This Week">
            <Row label="Total" value={<span className={`font-semibold tabular-nums ${(timesheet?.totalHours || 0) > 40 ? "text-red-400" : "text-white"}`}>{(timesheet?.totalHours || 0).toFixed(1)}h</span>} />
            <Row label="Regular" value={`${(timesheet?.regularHours || 0).toFixed(1)}h`} />
            <Row label="Overtime" value={<span className={(timesheet?.overtimeHours || 0) > 0 ? "text-red-400" : ""}>{(timesheet?.overtimeHours || 0).toFixed(1)}h</span>} />
            <Row label="Est. Pay" value={`$${((timesheet?.regularHours || 0) * rate + (timesheet?.overtimeHours || 0) * otRate).toFixed(2)}`} />
          </Card>
        </div>
      )}

      {/* ===== DRIVER RATES ===== */}
      {tab === "rates" && <DriverRatesTab emp={emp} onSave={setEmp} />}

      {/* ===== TIME TRACKING ===== */}
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
            <div className="py-12 text-center"><Clock className="mx-auto h-8 w-8 text-muted/20 mb-2" /><p className="text-xs text-muted">No entries this week</p></div>
          ) : (
            <div className="rounded-2xl bg-dark-card border border-[#1E2D45] overflow-hidden">
              <table className="w-full text-sm"><thead><tr className="border-b border-[#1E2D45]">
                {["Date", "In", "Out", "Break", "Hours", "Status"].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">{h}</th>)}
              </tr></thead><tbody>
                {timesheet.entries.map(e => (
                  <tr key={e.id} className="border-b border-[#1E2D45] last:border-0">
                    <td className="px-4 py-3 text-white">{fmtDate(e.clock_in)}</td>
                    <td className="px-4 py-3 text-foreground tabular-nums">{fmtTime(e.clock_in)}</td>
                    <td className="px-4 py-3 text-foreground tabular-nums">{e.clock_out ? fmtTime(e.clock_out) : "—"}</td>
                    <td className="px-4 py-3 text-muted">{e.break_minutes}m</td>
                    <td className="px-4 py-3 text-white font-medium tabular-nums">{Number(e.total_hours).toFixed(1)}h</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${e.status === "approved" ? "bg-brand/10 text-brand" : e.status === "flagged" ? "bg-red-500/10 text-red-400" : "bg-yellow-500/10 text-yellow-400"}`}>{e.status}</span></td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          )}
        </div>
      )}

      {/* ===== CONTACT ===== */}
      {tab === "contact" && <ContactTab emp={emp} onSave={setEmp} />}

      {/* ===== ACCESS & PERMISSIONS ===== */}
      {tab === "access" && <AccessTab emp={emp} onSave={setEmp} />}

      {/* ===== PERFORMANCE ===== */}
      {tab === "performance" && perf && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 max-w-2xl">
          {[
            { label: "This Week", value: String(perf.weekJobs), sub: "jobs completed", icon: Briefcase },
            { label: "This Month", value: String(perf.monthJobs), sub: "jobs completed", icon: Calendar },
            { label: "Daily Avg", value: perf.avgPerDay.toFixed(1), sub: "jobs per day", icon: Truck },
          ].map(s => (
            <div key={s.label} className="rounded-xl bg-dark-card border border-[#1E2D45] p-5 text-center">
              <s.icon className="mx-auto h-5 w-5 text-brand mb-2" />
              <p className="text-2xl font-bold text-white tabular-nums">{s.value}</p>
              <p className="text-[10px] text-muted mt-0.5">{s.sub}</p>
              <p className="text-xs text-muted mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ===== SETTINGS ===== */}
      {tab === "settings" && (
        <div className="max-w-md space-y-4">
          <Card title="Account"><Row label="Email" value={emp.email} /><Row label="Role" value={<span className="capitalize">{emp.role}</span>} /></Card>
          <button className="w-full rounded-lg bg-red-500/10 py-3 text-sm font-medium text-red-400 hover:bg-red-500/20 btn-press">Deactivate Employee</button>
        </div>
      )}

      <SlideOver open={editOpen} onClose={() => setEditOpen(false)} title="Edit Employee">
        <EditForm emp={emp} onSuccess={e => { setEmp(e); setEditOpen(false); toast("success", "Updated"); }} />
      </SlideOver>
    </div>
  );
}

/* ===== Driver Rates Tab ===== */

function DriverRatesTab({ emp, onSave }: { emp: Employee; onSave: (e: Employee) => void }) {
  const { toast } = useToast();
  const [rates, setRates] = useState<Record<string, unknown>>(emp.driverRates || {});
  const [globalRate, setGlobalRate] = useState("");
  const [expandedSize, setExpandedSize] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const setRate = (key: string, val: string) => setRates(r => ({ ...r, [key]: val ? Number(val) : undefined }));
  const getRate = (key: string) => String((rates as Record<string, number>)[key] || "");

  const applyGlobal = () => {
    if (!globalRate) return;
    const v = Number(globalRate);
    const updated: Record<string, unknown> = { ...rates };
    JOB_TYPES.forEach(jt => { updated[jt] = v; });
    setRates(updated);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const u = await api.patch<Employee>(`/team/${emp.id}`, { driverRates: rates });
      onSave(u); toast("success", "Rates saved");
    } catch { toast("error", "Failed"); }
    finally { setSaving(false); }
  };

  const inputCls = "w-full bg-[#111C2E] border border-[#1E2D45] rounded-lg px-3 py-2 text-sm text-white placeholder-muted outline-none focus:border-brand tabular-nums";

  return (
    <div className="max-w-2xl space-y-5">
      {/* Set All */}
      <div className="rounded-xl bg-dark-card border border-[#1E2D45] p-4">
        <p className="text-xs text-muted uppercase tracking-wider font-semibold mb-3">Set All Rates</p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
            <input value={globalRate} onChange={e => setGlobalRate(e.target.value)} type="number" step="0.01" className={`${inputCls} pl-7`} placeholder="Flat rate for all job types" />
          </div>
          <button onClick={applyGlobal} className="rounded-lg bg-dark-elevated px-4 py-2 text-xs font-medium text-foreground hover:bg-dark-card-hover btn-press">Apply to All</button>
        </div>
      </div>

      {/* Per Job Type */}
      <div className="rounded-xl bg-dark-card border border-[#1E2D45] p-4">
        <p className="text-xs text-muted uppercase tracking-wider font-semibold mb-3">Per Job Type Rates</p>
        <div className="grid grid-cols-2 gap-3">
          {JOB_TYPES.map(jt => (
            <div key={jt}>
              <label className="block text-[10px] text-muted mb-1">{JOB_TYPE_LABELS[jt] || jt}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
                <input value={getRate(jt)} onChange={e => setRate(jt, e.target.value)} type="number" step="0.01" className={`${inputCls} pl-7`} placeholder="0.00" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Per Size Overrides */}
      <div className="rounded-xl bg-dark-card border border-[#1E2D45] overflow-hidden">
        <p className="text-xs text-muted uppercase tracking-wider font-semibold px-4 pt-4 pb-2">Size-Specific Overrides</p>
        {SIZES.map(size => (
          <div key={size} className="border-t border-[#1E2D45]">
            <button onClick={() => setExpandedSize(expandedSize === size ? null : size)}
              className="flex w-full items-center justify-between px-4 py-3 text-sm text-foreground hover:bg-dark-card-hover transition-colors">
              <span className="font-medium">{size}</span>
              {expandedSize === size ? <ChevronUp className="h-4 w-4 text-muted" /> : <ChevronDown className="h-4 w-4 text-muted" />}
            </button>
            {expandedSize === size && (
              <div className="px-4 pb-4 grid grid-cols-2 gap-2">
                {JOB_TYPES.map(jt => {
                  const key = `${size}_${jt}`;
                  return (
                    <div key={key}>
                      <label className="block text-[9px] text-muted mb-0.5">{JOB_TYPE_LABELS[jt]}</label>
                      <div className="relative"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted text-xs">$</span>
                        <input value={getRate(key)} onChange={e => setRate(key, e.target.value)} type="number" step="0.01" className={`${inputCls} pl-5 py-1.5 text-xs`} placeholder="—" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <button onClick={handleSave} disabled={saving} className="w-full rounded-lg bg-brand py-3 text-sm font-bold text-white hover:bg-brand-light disabled:opacity-50 btn-press">
        {saving ? "Saving..." : "Update Driver Rates"}
      </button>
    </div>
  );
}

/* ===== Contact Tab ===== */

function ContactTab({ emp, onSave }: { emp: Employee; onSave: (e: Employee) => void }) {
  const { toast } = useToast();
  const [smsOptIn, setSmsOptIn] = useState(emp.smsOptIn || false);
  const [phones, setPhones] = useState(emp.additionalPhones || []);
  const [emails, setEmails] = useState(emp.additionalEmails || []);
  const [address, setAddress] = useState<AddressValue>({
    street: (emp.address as Record<string, string>)?.street || "",
    city: (emp.address as Record<string, string>)?.city || "",
    state: (emp.address as Record<string, string>)?.state || "",
    zip: (emp.address as Record<string, string>)?.zip || "",
    lat: null, lng: null,
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const u = await api.patch<Employee>(`/team/${emp.id}`, {
        smsOptIn, additionalPhones: phones, additionalEmails: emails,
        address: address.street ? { street: address.street, city: address.city, state: address.state, zip: address.zip, lat: address.lat, lng: address.lng } : undefined,
      });
      onSave(u); toast("success", "Saved");
    } catch { toast("error", "Failed"); }
    finally { setSaving(false); }
  };

  const inputCls = "w-full bg-[#111C2E] border border-[#1E2D45] rounded-lg px-3 py-2 text-sm text-white placeholder-muted outline-none focus:border-brand";

  return (
    <div className="max-w-lg space-y-5">
      <Card title="Primary Contact">
        <Row label="Phone" value={emp.phone ? <a href={`tel:${emp.phone}`} className="hover:text-brand">{fmtPhone(emp.phone)}</a> : "—"} />
        <Row label="Email" value={emp.email || "—"} />
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-[#1E2D45]">
          <input type="checkbox" checked={smsOptIn} onChange={e => setSmsOptIn(e.target.checked)} className="h-4 w-4 rounded accent-brand" />
          <div>
            <p className="text-xs text-foreground">SMS Notifications</p>
            <p className="text-[9px] text-muted leading-tight mt-0.5">By opting in, {emp.firstName} agrees to receive text messages. Message and data rates may apply.</p>
          </div>
        </div>
      </Card>

      <Card title="Additional Phone Numbers">
        {phones.map((p, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <input value={p.label} onChange={e => { const n = [...phones]; n[i] = { ...n[i], label: e.target.value }; setPhones(n); }} className={`${inputCls} w-24`} placeholder="Label" />
            <input value={p.number} onChange={e => { const n = [...phones]; n[i] = { ...n[i], number: e.target.value }; setPhones(n); }} className={`${inputCls} flex-1`} placeholder="Number" />
            <button onClick={() => setPhones(phones.filter((_, j) => j !== i))} className="text-muted hover:text-red-400 p-1"><X className="h-4 w-4" /></button>
          </div>
        ))}
        <button onClick={() => setPhones([...phones, { label: "", number: "" }])} className="text-xs text-brand hover:text-brand-light">+ Add phone</button>
      </Card>

      <Card title="Additional Emails">
        {emails.map((e, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <input value={e.label} onChange={ev => { const n = [...emails]; n[i] = { ...n[i], label: ev.target.value }; setEmails(n); }} className={`${inputCls} w-24`} placeholder="Label" />
            <input value={e.email} onChange={ev => { const n = [...emails]; n[i] = { ...n[i], email: ev.target.value }; setEmails(n); }} className={`${inputCls} flex-1`} placeholder="Email" />
            <button onClick={() => setEmails(emails.filter((_, j) => j !== i))} className="text-muted hover:text-red-400 p-1"><X className="h-4 w-4" /></button>
          </div>
        ))}
        <button onClick={() => setEmails([...emails, { label: "", email: "" }])} className="text-xs text-brand hover:text-brand-light">+ Add email</button>
      </Card>

      <Card title="Address">
        <AddressAutocomplete value={address} onChange={setAddress} placeholder="Search address..." />
        {address.lat && <p className="text-[10px] text-muted mt-2">GPS: {address.lat.toFixed(4)}, {address.lng?.toFixed(4)}</p>}
      </Card>

      <button onClick={handleSave} disabled={saving} className="w-full rounded-lg bg-brand py-3 text-sm font-bold text-white hover:bg-brand-light disabled:opacity-50 btn-press">
        {saving ? "Saving..." : "Save Contact Info"}
      </button>
    </div>
  );
}

/* ===== Access Tab ===== */

function AccessTab({ emp, onSave }: { emp: Employee; onSave: (e: Employee) => void }) {
  const { toast } = useToast();
  const [perms, setPerms] = useState<Record<string, boolean>>((emp.permissions || {}) as Record<string, boolean>);
  const [saving, setSaving] = useState(false);

  const toggle = (key: string) => setPerms(p => ({ ...p, [key]: !p[key] }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const u = await api.patch<Employee>(`/team/${emp.id}`, { permissions: perms });
      onSave(u); toast("success", "Saved");
    } catch { toast("error", "Failed"); }
    finally { setSaving(false); }
  };

  const Toggle = ({ label, k }: { label: string; k: string }) => (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-foreground">{label}</span>
      <button onClick={() => toggle(k)} className={`w-10 h-5 rounded-full transition-colors ${perms[k] ? "bg-brand" : "bg-dark-elevated"}`}>
        <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${perms[k] ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
    </div>
  );

  return (
    <div className="max-w-lg space-y-5">
      <Card title="App Access">
        <Toggle label="Mobile App Access" k="mobile_access" />
        <Toggle label="Desktop Access" k="desktop_access" />
      </Card>
      <Card title="Mobile Features">
        <Toggle label="View Jobs" k="mobile_jobs" />
        <Toggle label="Navigation" k="mobile_nav" />
        <Toggle label="Take Photos" k="mobile_photos" />
        <Toggle label="Add Notes" k="mobile_notes" />
        <Toggle label="Clock In/Out" k="mobile_clock" />
      </Card>
      <Card title="Permissions">
        <Toggle label="Create Jobs" k="perm_create_jobs" />
        <Toggle label="Edit Jobs" k="perm_edit_jobs" />
        <Toggle label="View Pricing" k="perm_view_pricing" />
        <Toggle label="View Customer Info" k="perm_view_customers" />
        <Toggle label="View Revenue" k="perm_view_revenue" />
      </Card>
      <Card title="Reports">
        <Toggle label="Daily Summary" k="report_daily" />
        <Toggle label="Weekly Hours" k="report_weekly" />
        <Toggle label="Job History" k="report_jobs" />
      </Card>
      <button onClick={handleSave} disabled={saving} className="w-full rounded-lg bg-brand py-3 text-sm font-bold text-white hover:bg-brand-light disabled:opacity-50 btn-press">
        {saving ? "Saving..." : "Save Permissions"}
      </button>
    </div>
  );
}

/* ===== Shared ===== */

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl bg-dark-card border border-[#1E2D45] p-4"><p className="text-xs text-muted uppercase tracking-wider font-semibold mb-3">{title}</p>{children}</div>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-center justify-between py-1.5 text-sm"><span className="text-muted">{label}</span><span className="text-foreground">{value}</span></div>;
}

/* ===== Edit Form ===== */

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
  const inputCls = "w-full bg-[#111C2E] border border-[#1E2D45] rounded-lg px-4 py-2.5 text-sm text-white outline-none focus:border-brand";
  const labelCls = "block text-xs font-medium text-muted uppercase tracking-wider mb-1";

  return (
    <form onSubmit={async (e: FormEvent) => {
      e.preventDefault(); setError(""); setSaving(true);
      try {
        const u = await api.patch<Employee>(`/team/${emp.id}`, {
          firstName, lastName, phone: phone || undefined, role,
          payRate: payRate ? Number(payRate) : undefined, hireDate: hireDate || undefined,
          vehicleInfo: vMake ? { make: vMake, model: vModel, year: vYear, plate: vPlate } : undefined,
          emergencyContact: ecName ? { name: ecName, phone: ecPhone, relationship: ecRel } : undefined,
        }); onSuccess(u);
      } catch (err) { setError(err instanceof Error ? err.message : "Failed"); } finally { setSaving(false); }
    }} className="space-y-3">
      {error && <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>First</label><input value={firstName} onChange={e => setFirstName(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Last</label><input value={lastName} onChange={e => setLastName(e.target.value)} className={inputCls} /></div>
      </div>
      <div><label className={labelCls}>Phone</label><input value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} /></div>
      <div><label className={labelCls}>Role</label><select value={role} onChange={e => setRole(e.target.value)} className={`${inputCls} appearance-none`}><option value="driver">Driver</option><option value="dispatcher">Dispatcher</option><option value="admin">Admin</option><option value="owner">Owner</option></select></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>Pay $/hr</label><input type="number" step="0.01" value={payRate} onChange={e => setPayRate(e.target.value)} className={inputCls} /></div>
        <div><label className={labelCls}>Hire Date</label><input type="date" value={hireDate} onChange={e => setHireDate(e.target.value)} className={inputCls} /></div>
      </div>
      <p className="text-xs text-muted uppercase tracking-wider font-semibold pt-2 border-t border-[#1E2D45]">Vehicle</p>
      <div className="grid grid-cols-2 gap-2">
        <input value={vMake} onChange={e => setVMake(e.target.value)} className={inputCls} placeholder="Make" />
        <input value={vModel} onChange={e => setVModel(e.target.value)} className={inputCls} placeholder="Model" />
        <input value={vYear} onChange={e => setVYear(e.target.value)} className={inputCls} placeholder="Year" />
        <input value={vPlate} onChange={e => setVPlate(e.target.value)} className={inputCls} placeholder="Plate" />
      </div>
      <p className="text-xs text-muted uppercase tracking-wider font-semibold pt-2 border-t border-[#1E2D45]">Emergency</p>
      <input value={ecName} onChange={e => setEcName(e.target.value)} className={inputCls} placeholder="Name" />
      <div className="grid grid-cols-2 gap-2">
        <input value={ecPhone} onChange={e => setEcPhone(e.target.value)} className={inputCls} placeholder="Phone" />
        <input value={ecRel} onChange={e => setEcRel(e.target.value)} className={inputCls} placeholder="Relationship" />
      </div>
      <button type="submit" disabled={saving} className="w-full rounded-lg bg-brand py-3 text-sm font-bold text-white hover:bg-brand-light disabled:opacity-50 btn-press">{saving ? "Saving..." : "Save"}</button>
    </form>
  );
}
