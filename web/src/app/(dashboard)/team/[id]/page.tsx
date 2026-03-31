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

import { formatPhone } from "@/lib/utils";
const fmtPhone = formatPhone;

function fmtTime(d: string) { return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
function fmtDate(d: string) { return new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); }

const TABS = [
  { key: "profile", label: "Profile", icon: User },
  { key: "rates", label: "Driver Rates", icon: DollarSign },
  { key: "time", label: "Time Tracking", icon: Clock },
  { key: "schedule", label: "Schedule", icon: Calendar },
  { key: "contact", label: "Contact", icon: Phone },
  { key: "access", label: "Access", icon: Shield },
  { key: "performance", label: "Performance", icon: Briefcase },
  { key: "notes", label: "Notes", icon: MessageSquare },
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

  if (loading) return <div className="space-y-4"><div className="h-8 w-48 skeleton rounded-[14px]" /><div className="h-48 skeleton rounded-[14px]" /></div>;
  if (!emp) return <div className="py-20 text-center text-[var(--t-text-muted)]">Not found</div>;

  const rate = Number(emp.payRate) || 0;
  const otRate = Number(emp.overtimeRate) || rate * 1.5;

  return (
    <div>
      <Link href="/team" className="inline-flex items-center gap-1.5 text-[13px] text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] transition-colors mb-4"><ArrowLeft className="h-3.5 w-3.5" /> Team</Link>

      {/* Header */}
      <div className="rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5 mb-5">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--t-bg-card-hover)] text-lg font-bold text-[var(--t-text-primary)]">{emp.firstName[0]}{emp.lastName[0]}</div>
            <div>
              <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-text-primary)]">{emp.firstName} {emp.lastName}</h1>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-[11px] font-semibold capitalize text-[var(--t-text-muted)]">{emp.role}</span>
                <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${emp.isActive ? "text-[var(--t-accent)]" : "text-[var(--t-error)]"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${emp.isActive ? "bg-[var(--t-accent)]" : "bg-[var(--t-error)]"}`} />{emp.isActive ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-2 text-[13px] text-[var(--t-text-muted)] flex-wrap">
                {emp.phone && <a href={`tel:${emp.phone}`} className="hover:text-[var(--t-accent)]"><Phone className="inline h-3 w-3 mr-1" />{fmtPhone(emp.phone)}</a>}
                {emp.email && <a href={`mailto:${emp.email}`} className="hover:text-[var(--t-accent)]"><Mail className="inline h-3 w-3 mr-1" />{emp.email}</a>}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setEditOpen(true)} className="rounded-full border border-[var(--t-border)] px-4 py-2 text-[13px] font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors flex items-center gap-1.5"><Pencil className="h-3.5 w-3.5" /> Edit</button>
            <button className="rounded-full border border-[var(--t-error)] px-4 py-2 text-[13px] font-medium text-[var(--t-error)] hover:opacity-80 transition-opacity">Deactivate</button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 overflow-x-auto pb-1">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[11px] font-medium transition-colors shrink-0 ${tab === t.key ? "bg-[var(--t-accent-soft)] text-[var(--t-accent)]" : "text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)]"}`}>
            <t.icon className="h-3.5 w-3.5" />{t.label}
          </button>
        ))}
      </div>

      {/* ===== PROFILE ===== */}
      {tab === "profile" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 max-w-4xl">
          <Card title="Employment">
            <Row label="Role" value={<span className="capitalize">{emp.role}</span>} />
            <Row label="Hire Date" value={emp.hireDate || "\u2014"} />
            <Row label="Pay Rate" value={rate ? `$${rate.toFixed(2)}/hr` : "\u2014"} />
            <Row label="OT Rate" value={otRate ? `$${otRate.toFixed(2)}/hr` : "\u2014"} />
          </Card>
          <Card title="Vehicle">
            {emp.vehicleInfo ? (<>
              <Row label="Vehicle" value={`${emp.vehicleInfo.year || ""} ${emp.vehicleInfo.make || ""} ${emp.vehicleInfo.model || ""}`.trim() || "\u2014"} />
              <Row label="Plate" value={emp.vehicleInfo.plate || "\u2014"} />
            </>) : <p className="text-[13px] text-[var(--t-text-muted)] py-2">No vehicle assigned</p>}
          </Card>
          <Card title="Emergency Contact">
            {emp.emergencyContact ? (<>
              <Row label="Name" value={emp.emergencyContact.name || "\u2014"} />
              <Row label="Phone" value={emp.emergencyContact.phone ? <a href={`tel:${emp.emergencyContact.phone}`} className="hover:text-[var(--t-accent)]">{fmtPhone(emp.emergencyContact.phone)}</a> : "\u2014"} />
              <Row label="Relation" value={emp.emergencyContact.relationship || "\u2014"} />
            </>) : <p className="text-[13px] text-[var(--t-text-muted)] py-2">Not set</p>}
          </Card>
          <Card title="This Week">
            <Row label="Total" value={<span className={`font-semibold tabular-nums ${(timesheet?.totalHours || 0) > 40 ? "text-[var(--t-error)]" : "text-[var(--t-text-primary)]"}`}>{(timesheet?.totalHours || 0).toFixed(1)}h</span>} />
            <Row label="Regular" value={`${(timesheet?.regularHours || 0).toFixed(1)}h`} />
            <Row label="Overtime" value={<span className={(timesheet?.overtimeHours || 0) > 0 ? "text-[var(--t-error)]" : ""}>{(timesheet?.overtimeHours || 0).toFixed(1)}h</span>} />
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
            <p className="text-sm font-medium text-[var(--t-text-primary)]">Week of {timesheet.weekOf}</p>
            <div className="flex items-center gap-3 text-sm">
              <span className="text-[var(--t-text-muted)]">Total: <span className="text-[var(--t-text-primary)] font-medium tabular-nums">{timesheet.totalHours.toFixed(1)}h</span></span>
              {timesheet.overtimeHours > 0 && <span className="text-[var(--t-error)] font-medium">OT: {timesheet.overtimeHours.toFixed(1)}h</span>}
            </div>
          </div>
          {timesheet.entries.length === 0 ? (
            <div className="py-12 text-center"><Clock className="mx-auto h-8 w-8 text-[var(--t-text-muted)] opacity-20 mb-2" /><p className="text-[13px] text-[var(--t-text-muted)]">No entries this week</p></div>
          ) : (
            <div className="rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] overflow-hidden">
              <table className="w-full text-sm"><thead><tr className="border-b border-[var(--t-border)]">
                {["Date", "In", "Out", "Break", "Hours", "Status"].map(h => <th key={h} className="px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)]">{h}</th>)}
              </tr></thead><tbody>
                {timesheet.entries.map(e => (
                  <tr key={e.id} className="border-b border-[var(--t-border)] last:border-0">
                    <td className="px-4 py-3 text-[var(--t-text-primary)]">{fmtDate(e.clock_in)}</td>
                    <td className="px-4 py-3 text-[var(--t-text-primary)] tabular-nums">{fmtTime(e.clock_in)}</td>
                    <td className="px-4 py-3 text-[var(--t-text-primary)] tabular-nums">{e.clock_out ? fmtTime(e.clock_out) : "\u2014"}</td>
                    <td className="px-4 py-3 text-[var(--t-text-muted)]">{e.break_minutes}m</td>
                    <td className="px-4 py-3 text-[var(--t-text-primary)] font-medium tabular-nums">{Number(e.total_hours).toFixed(1)}h</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold capitalize ${e.status === "approved" ? "text-[var(--t-accent)]" : e.status === "flagged" ? "text-[var(--t-error)]" : "text-[var(--t-warning)]"}`}>{e.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          )}
        </div>
      )}

      {/* ===== CONTACT ===== */}
      {tab === "contact" && <ContactTab emp={emp} onSave={setEmp} />}

      {/* ===== ACCESS ===== */}
      {tab === "access" && <AccessTab emp={emp} onSave={setEmp} />}

      {/* ===== SCHEDULE ===== */}
      {tab === "schedule" && (
        <div className="max-w-3xl space-y-2">
          <p className="text-sm text-[var(--t-text-muted)] mb-3">This week&apos;s assigned jobs for {emp.firstName}.</p>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => {
            const jobs = i < 5 ? Math.floor(Math.random() * 4) : 0;
            return (
              <div key={day} className="rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-[var(--t-text-primary)] w-10">{day}</span>
                    {jobs > 0 ? (
                      <span className="text-[11px] font-semibold text-[var(--t-accent)]">{jobs} jobs</span>
                    ) : (
                      <span className="text-[13px] text-[var(--t-text-muted)]">No jobs</span>
                    )}
                  </div>
                  {jobs > 0 && <span className="text-[13px] text-[var(--t-text-muted)]">~{jobs * 1.5}h estimated</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ===== PERFORMANCE ===== */}
      {tab === "performance" && perf && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 max-w-2xl">
          {[
            { label: "This Week", value: String(perf.weekJobs), sub: "jobs completed", icon: Briefcase },
            { label: "This Month", value: String(perf.monthJobs), sub: "jobs completed", icon: Calendar },
            { label: "Daily Avg", value: perf.avgPerDay.toFixed(1), sub: "jobs per day", icon: Truck },
          ].map(s => (
            <div key={s.label} className="rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5 text-center">
              <s.icon className="mx-auto h-5 w-5 text-[var(--t-accent)] mb-2" />
              <p className="text-[24px] font-bold text-[var(--t-text-primary)] tabular-nums">{s.value}</p>
              <p className="text-[13px] text-[var(--t-text-muted)] mt-0.5">{s.sub}</p>
              <p className="text-[13px] uppercase font-semibold tracking-wide text-[var(--t-text-muted)] mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ===== NOTES ===== */}
      {tab === "notes" && (
        <div className="max-w-2xl space-y-4">
          <div className="rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4">
            <textarea placeholder="Add a note..." rows={3}
              className="w-full bg-transparent text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none resize-none" />
            <div className="flex justify-end mt-2">
              <button className="rounded-full bg-[#22C55E] px-5 py-2 text-xs font-semibold text-black transition-opacity hover:opacity-90">Add Note</button>
            </div>
          </div>
          <div className="space-y-3">
            {[
              { date: "Mar 28, 2026", text: "Completed 50th job — great reliability record", auto: false },
              { date: "Mar 15, 2026", text: "Vehicle updated: 2022 Hino L6", auto: true },
              { date: "Feb 1, 2026", text: "Role changed to Driver", auto: true },
              { date: "Jan 15, 2026", text: "Hired — Welcome to the team!", auto: true },
            ].map((note, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className={`h-2 w-2 rounded-full mt-1.5 ${note.auto ? "bg-[var(--t-border)]" : "bg-[var(--t-accent)]"}`} />
                  {i < 3 && <div className="w-px flex-1 bg-[var(--t-border)]" />}
                </div>
                <div className="pb-4">
                  <p className="text-sm text-[var(--t-text-primary)]">{note.text}</p>
                  <p className="text-[11px] text-[var(--t-text-muted)] mt-0.5">{note.date}{note.auto ? " / Auto-logged" : ""}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== SETTINGS ===== */}
      {tab === "settings" && (
        <div className="max-w-md space-y-4">
          <Card title="Account"><Row label="Email" value={emp.email} /><Row label="Role" value={<span className="capitalize">{emp.role}</span>} /></Card>
          <button className="w-full rounded-full border border-[var(--t-error)] py-3 text-sm font-medium text-[var(--t-error)] hover:opacity-80 transition-opacity">Deactivate Employee</button>
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

  const inputCls = "w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none focus:border-[var(--t-accent)] tabular-nums";

  return (
    <div className="max-w-2xl space-y-5">
      <div className="rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] mb-3">Set All Rates</p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--t-text-muted)] text-sm">$</span>
            <input value={globalRate} onChange={e => setGlobalRate(e.target.value)} type="number" step="0.01" className={`${inputCls} pl-7`} placeholder="Flat rate for all job types" />
          </div>
          <button onClick={applyGlobal} className="rounded-full border border-[var(--t-border)] px-4 py-2 text-xs font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors">Apply to All</button>
        </div>
      </div>

      <div className="rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] mb-3">Per Job Type Rates</p>
        <div className="grid grid-cols-2 gap-3">
          {JOB_TYPES.map(jt => (
            <div key={jt}>
              <label className="block text-[11px] text-[var(--t-text-muted)] mb-1">{JOB_TYPE_LABELS[jt] || jt}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--t-text-muted)] text-sm">$</span>
                <input value={getRate(jt)} onChange={e => setRate(jt, e.target.value)} type="number" step="0.01" className={`${inputCls} pl-7`} placeholder="0.00" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] overflow-hidden">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] px-4 pt-4 pb-2">Size-Specific Overrides</p>
        {SIZES.map(size => (
          <div key={size} className="border-t border-[var(--t-border)]">
            <button onClick={() => setExpandedSize(expandedSize === size ? null : size)}
              className="flex w-full items-center justify-between px-4 py-3 text-sm text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
              <span className="font-medium">{size}</span>
              {expandedSize === size ? <ChevronUp className="h-4 w-4 text-[var(--t-text-muted)]" /> : <ChevronDown className="h-4 w-4 text-[var(--t-text-muted)]" />}
            </button>
            {expandedSize === size && (
              <div className="px-4 pb-4 grid grid-cols-2 gap-2">
                {JOB_TYPES.map(jt => {
                  const key = `${size}_${jt}`;
                  return (
                    <div key={key}>
                      <label className="block text-[9px] text-[var(--t-text-muted)] mb-0.5">{JOB_TYPE_LABELS[jt]}</label>
                      <div className="relative"><span className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--t-text-muted)] text-xs">$</span>
                        <input value={getRate(key)} onChange={e => setRate(key, e.target.value)} type="number" step="0.01" className={`${inputCls} pl-5 py-1.5 text-xs`} placeholder="\u2014" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <button onClick={handleSave} disabled={saving} className="w-full rounded-full bg-[#22C55E] py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50">
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

  const inputCls = "w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none focus:border-[var(--t-accent)]";

  return (
    <div className="max-w-lg space-y-5">
      <Card title="Primary Contact">
        <Row label="Phone" value={emp.phone ? <a href={`tel:${emp.phone}`} className="hover:text-[var(--t-accent)]">{fmtPhone(emp.phone)}</a> : "\u2014"} />
        <Row label="Email" value={emp.email || "\u2014"} />
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-[var(--t-border)]">
          <input type="checkbox" checked={smsOptIn} onChange={e => setSmsOptIn(e.target.checked)} className="h-4 w-4 rounded accent-[#22C55E]" />
          <div>
            <p className="text-[13px] text-[var(--t-text-primary)]">SMS Notifications</p>
            <p className="text-[11px] text-[var(--t-text-muted)] leading-tight mt-0.5">By opting in, {emp.firstName} agrees to receive text messages.</p>
          </div>
        </div>
      </Card>

      <Card title="Additional Phone Numbers">
        {phones.map((p, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <input value={p.label} onChange={e => { const n = [...phones]; n[i] = { ...n[i], label: e.target.value }; setPhones(n); }} className={`${inputCls} w-24`} placeholder="Label" />
            <input value={p.number} onChange={e => { const n = [...phones]; n[i] = { ...n[i], number: e.target.value }; setPhones(n); }} className={`${inputCls} flex-1`} placeholder="Number" />
            <button onClick={() => setPhones(phones.filter((_, j) => j !== i))} className="text-[var(--t-text-muted)] hover:text-[var(--t-error)] p-1"><X className="h-4 w-4" /></button>
          </div>
        ))}
        <button onClick={() => setPhones([...phones, { label: "", number: "" }])} className="text-[11px] font-semibold text-[var(--t-accent)]">+ Add phone</button>
      </Card>

      <Card title="Additional Emails">
        {emails.map((e, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <input value={e.label} onChange={ev => { const n = [...emails]; n[i] = { ...n[i], label: ev.target.value }; setEmails(n); }} className={`${inputCls} w-24`} placeholder="Label" />
            <input value={e.email} onChange={ev => { const n = [...emails]; n[i] = { ...n[i], email: ev.target.value }; setEmails(n); }} className={`${inputCls} flex-1`} placeholder="Email" />
            <button onClick={() => setEmails(emails.filter((_, j) => j !== i))} className="text-[var(--t-text-muted)] hover:text-[var(--t-error)] p-1"><X className="h-4 w-4" /></button>
          </div>
        ))}
        <button onClick={() => setEmails([...emails, { label: "", email: "" }])} className="text-[11px] font-semibold text-[var(--t-accent)]">+ Add email</button>
      </Card>

      <Card title="Address">
        <AddressAutocomplete value={address} onChange={setAddress} placeholder="Search address..." />
        {address.lat && <p className="text-[11px] text-[var(--t-text-muted)] mt-2">GPS: {address.lat.toFixed(4)}, {address.lng?.toFixed(4)}</p>}
      </Card>

      <button onClick={handleSave} disabled={saving} className="w-full rounded-full bg-[#22C55E] py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50">
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
      <span className="text-sm text-[var(--t-text-primary)]">{label}</span>
      <button onClick={() => toggle(k)} className={`w-10 h-5 rounded-full transition-colors ${perms[k] ? "bg-[#22C55E]" : "bg-[var(--t-bg-card-hover)]"}`}>
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
      <button onClick={handleSave} disabled={saving} className="w-full rounded-full bg-[#22C55E] py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50">
        {saving ? "Saving..." : "Save Permissions"}
      </button>
    </div>
  );
}

/* ===== Shared ===== */

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4"><p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] mb-3">{title}</p>{children}</div>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-center justify-between py-1.5 text-sm"><span className="text-[var(--t-text-muted)]">{label}</span><span className="text-[var(--t-text-primary)]">{value}</span></div>;
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
  const inputCls = "w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2.5 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)]";
  const labelCls = "block text-[13px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] mb-1";

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
      {error && <div className="rounded-[14px] bg-[var(--t-error-soft)] px-4 py-3 text-sm text-[var(--t-error)]">{error}</div>}
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
      <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] pt-2 border-t border-[var(--t-border)]">Vehicle</p>
      <div className="grid grid-cols-2 gap-2">
        <input value={vMake} onChange={e => setVMake(e.target.value)} className={inputCls} placeholder="Make" />
        <input value={vModel} onChange={e => setVModel(e.target.value)} className={inputCls} placeholder="Model" />
        <input value={vYear} onChange={e => setVYear(e.target.value)} className={inputCls} placeholder="Year" />
        <input value={vPlate} onChange={e => setVPlate(e.target.value)} className={inputCls} placeholder="Plate" />
      </div>
      <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] pt-2 border-t border-[var(--t-border)]">Emergency</p>
      <input value={ecName} onChange={e => setEcName(e.target.value)} className={inputCls} placeholder="Name" />
      <div className="grid grid-cols-2 gap-2">
        <input value={ecPhone} onChange={e => setEcPhone(e.target.value)} className={inputCls} placeholder="Phone" />
        <input value={ecRel} onChange={e => setEcRel(e.target.value)} className={inputCls} placeholder="Relationship" />
      </div>
      <button type="submit" disabled={saving} className="w-full rounded-full bg-[#22C55E] py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50">{saving ? "Saving..." : "Save"}</button>
    </form>
  );
}
