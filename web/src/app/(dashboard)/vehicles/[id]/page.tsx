"use client";

import { useState, useEffect, use, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, CarFront, User, Pencil, Wrench, Fuel, Shield, ChevronDown, ChevronUp, Plus, DollarSign, Calendar, Truck } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import SlideOver from "@/components/slide-over";
import { formatCurrency } from "@/lib/utils";

interface Employee {
  id: string; firstName: string; lastName: string; role: string;
  vehicleInfo: Record<string, string> | null;
}

interface ExpandableProps { title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }

function Expandable({ title, icon, children, defaultOpen = false }: ExpandableProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-4 py-3.5 hover:bg-[var(--t-bg-card-hover)] transition-colors">
        <div className="flex items-center gap-2.5">
          {icon}
          <span className="text-sm font-semibold text-[var(--t-text-primary)]">{title}</span>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-[var(--t-text-muted)]" /> : <ChevronDown className="h-4 w-4 text-[var(--t-text-muted)]" />}
      </button>
      {open && <div className="px-4 pb-4 border-t border-[var(--t-border)] pt-3">{children}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-center justify-between py-1.5 text-sm"><span className="text-[var(--t-text-muted)]">{label}</span><span className="text-[var(--t-text-primary)]">{value}</span></div>;
}

const sampleMaintenance = [
  { id: "1", date: "2026-03-15", type: "Oil Change", desc: "Full synthetic oil change + filter", cost: 89.99, mileage: 45200 },
  { id: "2", date: "2026-02-01", type: "Tire Rotation", desc: "Rotated and balanced all 4 tires", cost: 49.99, mileage: 43800 },
  { id: "3", date: "2026-01-10", type: "Brake Inspection", desc: "Front pads at 60%, rear at 75%", cost: 0, mileage: 42500 },
];

const sampleFuel = [
  { id: "1", date: "2026-03-28", gallons: 22.5, cost: 81.00, mileage: 46100 },
  { id: "2", date: "2026-03-20", gallons: 21.8, cost: 78.48, mileage: 45700 },
  { id: "3", date: "2026-03-12", gallons: 23.1, cost: 83.16, mileage: 45200 },
];

export default function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { toast } = useToast();
  const [emp, setEmp] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    api.get<Employee>(`/team/${id}`).then(setEmp).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="space-y-4"><div className="h-8 w-48 skeleton rounded-[14px]" /><div className="h-48 skeleton rounded-[14px]" /></div>;
  if (!emp || !emp.vehicleInfo) return (
    <div className="py-20 text-center">
      <CarFront className="mx-auto h-10 w-10 text-[var(--t-text-muted)] opacity-20 mb-2" />
      <p className="text-sm text-[var(--t-text-muted)]">No vehicle assigned to this team member</p>
      <Link href="/vehicles" className="text-[11px] font-semibold text-[var(--t-accent)] hover:opacity-80 mt-2 inline-block">Back to Vehicles</Link>
    </div>
  );

  const v = emp.vehicleInfo;
  const displayName = `${v.year || ""} ${v.make || ""} ${v.model || ""}`.trim() || "Vehicle";
  const totalMaint = sampleMaintenance.reduce((s, m) => s + m.cost, 0);
  const totalFuel = sampleFuel.reduce((s, f) => s + f.cost, 0);

  return (
    <div className="space-y-5">
      <Link href="/vehicles" className="inline-flex items-center gap-1.5 text-[13px] text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] transition-colors"><ArrowLeft className="h-3.5 w-3.5" /> Vehicles</Link>

      {/* Header */}
      <div className="rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] bg-[var(--t-bg-card-hover)]">
              <CarFront className="h-7 w-7 text-[var(--t-text-muted)]" />
            </div>
            <div>
              <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-text-primary)]">{displayName}</h1>
              {v.plate && <p className="text-sm text-[var(--t-text-muted)] font-mono mt-0.5">{v.plate}</p>}
              <div className="flex items-center gap-2 mt-2">
                <Link href={`/team/${emp.id}`} className="flex items-center gap-1.5 text-[13px] text-[var(--t-accent)] hover:opacity-80">
                  <User className="h-3 w-3" /> {emp.firstName} {emp.lastName}
                </Link>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--t-accent)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--t-accent)]" />Active
                </span>
              </div>
            </div>
          </div>
          <button onClick={() => setEditOpen(true)} className="rounded-full border border-[var(--t-border)] px-4 py-2 text-[13px] font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors flex items-center gap-1.5"><Pencil className="h-3.5 w-3.5" /> Edit</button>
        </div>
      </div>

      {/* Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          <Expandable title="Vehicle Details" icon={<CarFront className="h-4 w-4 text-[var(--t-accent)]" />} defaultOpen>
            <Row label="Display Name" value={displayName} />
            <Row label="Year" value={v.year || "\u2014"} />
            <Row label="Make" value={v.make || "\u2014"} />
            <Row label="Model" value={v.model || "\u2014"} />
            <Row label="License Plate" value={v.plate || "\u2014"} />
            <Row label="VIN" value={v.vin || "\u2014"} />
            <Row label="Color" value={v.color || "\u2014"} />
            <Row label="In-Service Date" value={v.inServiceDate || "\u2014"} />
          </Expandable>

          <Expandable title="Purchase Info" icon={<DollarSign className="h-4 w-4 text-[var(--t-warning)]" />}>
            <Row label="Seller" value={v.seller || "\u2014"} />
            <Row label="Purchase Price" value={v.purchasePrice ? formatCurrency(v.purchasePrice) : "\u2014"} />
            <Row label="Purchase Date" value={v.purchaseDate || "\u2014"} />
            <Row label="Monthly Payment" value={v.monthlyPayment ? formatCurrency(v.monthlyPayment) : "\u2014"} />
          </Expandable>
        </div>

        <div className="space-y-4">
          <Expandable title="Specifications" icon={<Truck className="h-4 w-4 text-[var(--t-text-muted)]" />} defaultOpen>
            <Row label="Gross Weight" value={v.grossWeight ? `${v.grossWeight} LBS` : "\u2014"} />
            <Row label="Fuel Type" value={v.fuelType || "Diesel"} />
            <Row label="MPG" value={v.mpg || "\u2014"} />
            <Row label="Cost Per Mile" value={v.costPerMile ? `$${v.costPerMile}` : "\u2014"} />
            <Row label="Carry Capacity" value={v.carryCapacity || "10yd, 15yd, 20yd, 30yd"} />
          </Expandable>

          <Expandable title="Insurance" icon={<Shield className="h-4 w-4 text-[var(--t-text-muted)]" />}>
            <Row label="Insurer" value={v.insurer || "\u2014"} />
            <Row label="Policy #" value={v.policyNumber || "\u2014"} />
            <Row label="Coverage" value={v.coverageType || "\u2014"} />
            <Row label="Premium" value={v.premium ? formatCurrency(v.premium) : "\u2014"} />
            <Row label="Expiration" value={v.insuranceExpiry || "\u2014"} />
          </Expandable>
        </div>
      </div>

      {/* Maintenance Log */}
      <Expandable title="Maintenance Log" icon={<Wrench className="h-4 w-4 text-[var(--t-warning)]" />} defaultOpen>
        <div className="overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-[var(--t-border)]">
              {["Date", "Type", "Description", "Cost", "Mileage"].map(h => <th key={h} className="px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)]">{h}</th>)}
            </tr></thead>
            <tbody>
              {sampleMaintenance.map(m => (
                <tr key={m.id} className="border-b border-[var(--t-border)] last:border-0">
                  <td className="px-3 py-2 text-[var(--t-text-primary)]">{new Date(m.date).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-[var(--t-text-primary)] font-medium">{m.type}</td>
                  <td className="px-3 py-2 text-[var(--t-text-muted)]">{m.desc}</td>
                  <td className="px-3 py-2 text-[var(--t-text-primary)] tabular-nums">{m.cost > 0 ? formatCurrency(m.cost) : "\u2014"}</td>
                  <td className="px-3 py-2 text-[var(--t-text-muted)] tabular-nums">{m.mileage.toLocaleString()} mi</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="flex items-center gap-1.5 mt-3 text-[11px] font-semibold text-[var(--t-accent)] hover:opacity-80"><Plus className="h-3 w-3" /> Add Maintenance Record</button>
      </Expandable>

      <Expandable title="Fuel Log" icon={<Fuel className="h-4 w-4 text-[var(--t-accent)]" />}>
        <div className="overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-[var(--t-border)]">
              {["Date", "Gallons", "Cost", "Mileage", "$/Gal"].map(h => <th key={h} className="px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)]">{h}</th>)}
            </tr></thead>
            <tbody>
              {sampleFuel.map(f => (
                <tr key={f.id} className="border-b border-[var(--t-border)] last:border-0">
                  <td className="px-3 py-2 text-[var(--t-text-primary)]">{new Date(f.date).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-[var(--t-text-primary)] font-medium tabular-nums">{f.gallons.toFixed(1)}</td>
                  <td className="px-3 py-2 text-[var(--t-text-primary)] tabular-nums">{formatCurrency(f.cost)}</td>
                  <td className="px-3 py-2 text-[var(--t-text-muted)] tabular-nums">{f.mileage.toLocaleString()} mi</td>
                  <td className="px-3 py-2 text-[var(--t-text-muted)] tabular-nums">${(f.cost / f.gallons).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="flex items-center gap-1.5 mt-3 text-[11px] font-semibold text-[var(--t-accent)] hover:opacity-80"><Plus className="h-3 w-3" /> Add Fuel Entry</button>
      </Expandable>

      {/* Cost Summary */}
      <div className="rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] mb-3">Cost Summary</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Maintenance", value: totalMaint },
            { label: "Fuel", value: totalFuel },
            { label: "Insurance", value: 0 },
            { label: "Total", value: totalMaint + totalFuel },
          ].map(c => (
            <div key={c.label} className="text-center">
              <p className="text-[24px] font-bold tabular-nums text-[var(--t-text-primary)]">{formatCurrency(c.value)}</p>
              <p className="text-[13px] uppercase font-semibold tracking-wide text-[var(--t-text-muted)] mt-0.5">{c.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Edit Slide-Over */}
      <SlideOver open={editOpen} onClose={() => setEditOpen(false)} title="Edit Vehicle">
        <VehicleEditForm emp={emp} onSuccess={(updated) => { setEmp(updated); setEditOpen(false); toast("success", "Vehicle updated"); }} />
      </SlideOver>
    </div>
  );
}

function VehicleEditForm({ emp, onSuccess }: { emp: Employee; onSuccess: (e: Employee) => void }) {
  const v = emp.vehicleInfo || {};
  const [make, setMake] = useState(v.make || "");
  const [model, setModel] = useState(v.model || "");
  const [year, setYear] = useState(v.year || "");
  const [plate, setPlate] = useState(v.plate || "");
  const [vin, setVin] = useState(v.vin || "");
  const [color, setColor] = useState(v.color || "");
  const [saving, setSaving] = useState(false);
  const inputCls = "w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2.5 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)]";
  const labelCls = "block text-[13px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] mb-1";

  return (
    <form onSubmit={async (e: FormEvent) => {
      e.preventDefault(); setSaving(true);
      try {
        const u = await api.patch<Employee>(`/team/${emp.id}`, {
          vehicleInfo: { ...emp.vehicleInfo, make, model, year, plate, vin, color },
        });
        onSuccess(u);
      } catch {} finally { setSaving(false); }
    }} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>Year</label><input value={year} onChange={e => setYear(e.target.value)} className={inputCls} placeholder="2024" /></div>
        <div><label className={labelCls}>Make</label><input value={make} onChange={e => setMake(e.target.value)} className={inputCls} placeholder="Ford" /></div>
      </div>
      <div><label className={labelCls}>Model</label><input value={model} onChange={e => setModel(e.target.value)} className={inputCls} placeholder="F-550" /></div>
      <div><label className={labelCls}>License Plate</label><input value={plate} onChange={e => setPlate(e.target.value)} className={inputCls} placeholder="ABC-1234" /></div>
      <div><label className={labelCls}>VIN</label><input value={vin} onChange={e => setVin(e.target.value)} className={inputCls} placeholder="1HGCM..." /></div>
      <div><label className={labelCls}>Color</label><input value={color} onChange={e => setColor(e.target.value)} className={inputCls} placeholder="White" /></div>
      <button type="submit" disabled={saving} className="w-full rounded-full bg-[#22C55E] py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50">
        {saving ? "Saving..." : "Save Vehicle"}
      </button>
    </form>
  );
}
