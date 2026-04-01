"use client";

import { useState, useEffect } from "react";
import { MapPin, Phone, Clock, Plus, Trash2, ChevronDown, ChevronUp, Pencil } from "lucide-react";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

/* ─── Types ─── */

interface Rate {
  id: string;
  waste_type: string;
  waste_type_label: string;
  rate_per_ton: number;
  minimum_charge: number;
  is_active: boolean;
}
interface Surcharge {
  id: string;
  item_type: string;
  label: string;
  dump_charge: number;
  customer_charge: number;
  is_active: boolean;
  sort_order: number;
}
interface DumpLocation {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  latitude: number;
  longitude: number;
  phone: string;
  contact_name: string;
  notes: string;
  operating_hours: string;
  is_active: boolean;
  rates: Rate[];
  surcharges: Surcharge[];
}

const WASTE_TYPES = [
  { value: "cnd", label: "C&D (Construction & Demolition)" },
  { value: "msw", label: "MSW (Municipal Solid Waste)" },
  { value: "clean_fill", label: "Clean Fill" },
  { value: "yard_waste", label: "Yard Waste" },
  { value: "recyclables", label: "Recyclables" },
  { value: "mixed", label: "Mixed" },
];

const inputCls =
  "w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none focus:border-[var(--t-accent)]";

/* ─── Page ─── */

export default function DumpLocationsPage() {
  const [locations, setLocations] = useState<DumpLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [newName, setNewName] = useState("");
  const [newAddr, setNewAddr] = useState("");
  const [newCity, setNewCity] = useState("");
  const [newState, setNewState] = useState("MA");
  const [newPhone, setNewPhone] = useState("");
  const [newHours, setNewHours] = useState("");

  useEffect(() => {
    api
      .get<DumpLocation[]>("/dump-locations")
      .then(setLocations)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const refresh = () =>
    api
      .get<DumpLocation[]>("/dump-locations")
      .then(setLocations)
      .catch(() => {});

  const handleCreate = async () => {
    try {
      await api.post("/dump-locations", {
        name: newName,
        address: newAddr,
        city: newCity,
        state: newState,
        phone: newPhone,
        operatingHours: newHours,
      });
      setAdding(false);
      setNewName("");
      setNewAddr("");
      setNewCity("");
      setNewPhone("");
      setNewHours("");
      await refresh();
    } catch {
      /* handled by api client */
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)]">
            Dump Locations
          </h1>
          <p className="mt-1 text-[13px] text-[var(--t-frame-text-muted)]">
            {locations.length} facilities configured
          </p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 rounded-full bg-[#22C55E] px-6 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Add Location
        </button>
      </div>

      {/* Add form */}
      {adding && (
        <div className="rounded-[20px] border border-[var(--t-accent)] bg-[var(--t-bg-card)] p-5 space-y-3">
          <p className="text-sm font-semibold text-[var(--t-text-primary)]">New Dump Location</p>
          <div className="grid grid-cols-2 gap-3">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} className={inputCls} placeholder="Facility name" />
            <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} className={inputCls} placeholder="Phone" />
          </div>
          <input value={newAddr} onChange={(e) => setNewAddr(e.target.value)} className={inputCls} placeholder="Address" />
          <div className="grid grid-cols-3 gap-3">
            <input value={newCity} onChange={(e) => setNewCity(e.target.value)} className={inputCls} placeholder="City" />
            <input value={newState} onChange={(e) => setNewState(e.target.value)} className={inputCls} placeholder="State" />
            <input value={newHours} onChange={(e) => setNewHours(e.target.value)} className={inputCls} placeholder="Operating hours" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={!newName || !newAddr}
              className="rounded-full bg-[#22C55E] px-5 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50">
              Save
            </button>
            <button onClick={() => setAdding(false)}
              className="rounded-full border border-[var(--t-border)] px-5 py-2 text-sm text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Locations list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 skeleton rounded-[20px]" />
          ))}
        </div>
      ) : locations.length === 0 ? (
        <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] py-16 text-center">
          <MapPin className="mx-auto h-10 w-10 text-[var(--t-text-muted)] opacity-20 mb-2" />
          <p className="text-sm text-[var(--t-text-muted)]">No dump locations configured</p>
        </div>
      ) : (
        <div className="space-y-2">
          {locations.map((loc) => (
            <LocationCard
              key={loc.id}
              loc={loc}
              expanded={expandedId === loc.id}
              onToggle={() =>
                setExpandedId(expandedId === loc.id ? null : loc.id)
              }
              onRefresh={refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Location Card ─── */

function LocationCard({
  loc,
  expanded,
  onToggle,
  onRefresh,
}: {
  loc: DumpLocation;
  expanded: boolean;
  onToggle: () => void;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [editingLoc, setEditingLoc] = useState(false);
  const [locName, setLocName] = useState(loc.name);
  const [locAddr, setLocAddr] = useState(loc.address);
  const [locHours, setLocHours] = useState(loc.operating_hours || "");
  const [editRate, setEditRate] = useState<Rate | null>(null);
  const [editSurcharge, setEditSurcharge] = useState<Surcharge | null>(null);

  const handleDeleteLoc = async () => {
    if (!confirm(`Delete "${loc.name}"? Historical data will be preserved for reporting.`)) return;
    try { await api.delete(`/dump-locations/${loc.id}`); toast("success", "Location deleted"); onRefresh(); }
    catch { toast("error", "Failed to delete"); }
  };

  const handleSaveLoc = async () => {
    try {
      await api.patch(`/dump-locations/${loc.id}`, { name: locName, address: locAddr, operating_hours: locHours });
      toast("success", "Location updated"); setEditingLoc(false); onRefresh();
    } catch { toast("error", "Failed to update"); }
  };

  const handleDeleteRate = async (rateId: string) => {
    if (!confirm("Delete this rate? Historical data will be preserved for reporting.")) return;
    try { await api.delete(`/dump-locations/${loc.id}/rates/${rateId}`); toast("success", "Rate deleted"); onRefresh(); }
    catch { toast("error", "Failed to delete"); }
  };

  const handleSaveRate = async (r: Rate, updates: { ratePerTon: number; minimumCharge: number | null; wasteType: string; wasteTypeLabel: string }) => {
    try { await api.patch(`/dump-locations/${loc.id}/rates/${r.id}`, updates); toast("success", "Rate updated"); setEditRate(null); onRefresh(); }
    catch { toast("error", "Failed to update"); }
  };

  const handleDeleteSurcharge = async (surId: string) => {
    if (!confirm("Delete this surcharge? Historical data will be preserved for reporting.")) return;
    try { await api.delete(`/dump-locations/${loc.id}/surcharges/${surId}`); toast("success", "Surcharge deleted"); onRefresh(); }
    catch { toast("error", "Failed to delete"); }
  };

  const handleSaveSurcharge = async (s: Surcharge, updates: { label: string; dumpCharge: number; customerCharge: number }) => {
    try { await api.patch(`/dump-locations/${loc.id}/surcharges/${s.id}`, updates); toast("success", "Surcharge updated"); setEditSurcharge(null); onRefresh(); }
    catch { toast("error", "Failed to update"); }
  };

  return (
    <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] overflow-hidden">
      {/* Header row */}
      <div className="flex w-full items-center justify-between px-5 py-4">
        <button onClick={onToggle} className="flex-1 text-left min-w-0 hover:opacity-80 transition-opacity">
          <p className="text-sm font-semibold text-[var(--t-text-primary)]">{loc.name}</p>
          <p className="text-[13px] text-[var(--t-text-muted)] mt-0.5">
            {[loc.address, loc.city, loc.state].filter(Boolean).join(", ")}
          </p>
        </button>
        <div className="flex items-center gap-4 shrink-0">
          <span className="text-[11px] font-semibold text-[var(--t-accent)]">
            {loc.rates?.length || 0} rates
          </span>
          <span className="text-[11px] font-semibold text-[var(--t-text-muted)]">
            {loc.surcharges?.length || 0} surcharges
          </span>
          {expanded && (
            <>
              <button onClick={() => { setEditingLoc(true); setLocName(loc.name); setLocAddr(loc.address); setLocHours(loc.operating_hours || ""); }}
                className="p-1 rounded transition-colors" style={{ color: "var(--t-text-muted)" }}><Pencil className="h-3.5 w-3.5" /></button>
              <button onClick={handleDeleteLoc}
                className="p-1 rounded transition-colors" style={{ color: "var(--t-error)" }}><Trash2 className="h-3.5 w-3.5" /></button>
            </>
          )}
          <button onClick={onToggle} className="p-1">
            {expanded ? <ChevronUp className="h-4 w-4 text-[var(--t-text-muted)]" /> : <ChevronDown className="h-4 w-4 text-[var(--t-text-muted)]" />}
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-[var(--t-border)] px-5 py-4 space-y-5">
          {/* Edit location inline */}
          {editingLoc && (
            <div className="rounded-[14px] border border-[var(--t-accent)] bg-[var(--t-accent-soft)] p-4 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input value={locName} onChange={e => setLocName(e.target.value)} className={inputCls} placeholder="Name" />
                <input value={locHours} onChange={e => setLocHours(e.target.value)} className={inputCls} placeholder="Operating hours" />
              </div>
              <input value={locAddr} onChange={e => setLocAddr(e.target.value)} className={inputCls} placeholder="Address" />
              <div className="flex gap-2">
                <button onClick={handleSaveLoc} className="rounded-full bg-[#22C55E] px-4 py-1.5 text-xs font-semibold text-black">Save</button>
                <button onClick={() => setEditingLoc(false)} className="text-xs text-[var(--t-text-muted)]">Cancel</button>
              </div>
            </div>
          )}

          {/* Meta info */}
          {!editingLoc && (
            <div className="flex items-center gap-4 text-[13px] text-[var(--t-text-muted)]">
              {loc.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{loc.phone}</span>}
              {loc.operating_hours && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{loc.operating_hours}</span>}
            </div>
          )}

          {/* Waste Type Rates */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)]">Waste Type Rates</p>
              <AddRateButton locationId={loc.id} onAdded={onRefresh} />
            </div>
            {(loc.rates?.length || 0) === 0 ? (
              <p className="text-[13px] text-[var(--t-text-muted)]">No rates configured</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--t-border)]">
                    <th className="px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)]">Waste Type</th>
                    <th className="px-3 py-2 text-right text-[12px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)]">Rate/Ton</th>
                    <th className="px-3 py-2 text-right text-[12px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)]">Min Charge</th>
                    <th className="px-3 py-2 w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {loc.rates.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--t-border)] last:border-0 group">
                      <td className="px-3 py-2 text-[var(--t-text-primary)]">{r.waste_type_label}</td>
                      <td className="px-3 py-2 text-right text-[var(--t-text-primary)] tabular-nums">{formatCurrency(r.rate_per_ton)}</td>
                      <td className="px-3 py-2 text-right text-[var(--t-text-muted)] tabular-nums">{r.minimum_charge ? formatCurrency(r.minimum_charge) : "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-end gap-1">
                          <button onClick={() => setEditRate(r)} className="p-1" style={{ color: "var(--t-text-muted)" }}><Pencil className="h-3 w-3" /></button>
                          <button onClick={() => handleDeleteRate(r.id)} className="p-1" style={{ color: "var(--t-error)" }}><Trash2 className="h-3 w-3" /></button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Surcharge Items */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)]">Surcharge Items</p>
              <AddSurchargeButton locationId={loc.id} onAdded={onRefresh} />
            </div>
            {(loc.surcharges?.length || 0) === 0 ? (
              <p className="text-[13px] text-[var(--t-text-muted)]">No surcharges configured</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--t-border)]">
                    <th className="px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)]">Item</th>
                    <th className="px-3 py-2 text-right text-[12px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)]">Dump Charges Us</th>
                    <th className="px-3 py-2 text-right text-[12px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)]">We Charge Customer</th>
                    <th className="px-3 py-2 text-right text-[12px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)]">Markup</th>
                    <th className="px-3 py-2 w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {loc.surcharges.map((s) => {
                    const markup = Number(s.dump_charge) > 0 ? (((Number(s.customer_charge) - Number(s.dump_charge)) / Number(s.dump_charge)) * 100).toFixed(0) : "—";
                    return (
                      <tr key={s.id} className="border-b border-[var(--t-border)] last:border-0 group">
                        <td className="px-3 py-2 text-[var(--t-text-primary)]">{s.label}</td>
                        <td className="px-3 py-2 text-right text-[var(--t-text-primary)] tabular-nums">{formatCurrency(s.dump_charge)}</td>
                        <td className="px-3 py-2 text-right text-[var(--t-accent)] tabular-nums">{formatCurrency(s.customer_charge)}</td>
                        <td className="px-3 py-2 text-right text-[var(--t-text-muted)] tabular-nums">{markup}%</td>
                        <td className="px-3 py-2 text-right">
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-end gap-1">
                            <button onClick={() => setEditSurcharge(s)} className="p-1" style={{ color: "var(--t-text-muted)" }}><Pencil className="h-3 w-3" /></button>
                            <button onClick={() => handleDeleteSurcharge(s.id)} className="p-1" style={{ color: "var(--t-error)" }}><Trash2 className="h-3 w-3" /></button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {loc.notes && (
            <div>
              <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] mb-1">Notes</p>
              <p className="text-sm text-[var(--t-text-primary)]">{loc.notes}</p>
            </div>
          )}
        </div>
      )}

      {/* Edit Rate Modal */}
      {editRate && <EditRateModal rate={editRate} onClose={() => setEditRate(null)} onSave={(updates) => handleSaveRate(editRate, updates)} />}

      {/* Edit Surcharge Modal */}
      {editSurcharge && <EditSurchargeModal surcharge={editSurcharge} onClose={() => setEditSurcharge(null)} onSave={(updates) => handleSaveSurcharge(editSurcharge, updates)} />}
    </div>
  );
}

/* ─── Add Rate Inline ─── */

function AddRateButton({ locationId, onAdded }: { locationId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [wasteType, setWasteType] = useState("cnd");
  const [rate, setRate] = useState("");
  const [min, setMin] = useState("");
  const label = WASTE_TYPES.find((w) => w.value === wasteType)?.label || wasteType;

  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="text-[11px] font-semibold text-[var(--t-accent)] hover:opacity-80">
        + Add Rate
      </button>
    );

  return (
    <div className="flex items-center gap-2">
      <select value={wasteType} onChange={(e) => setWasteType(e.target.value)} className={`${inputCls} w-48`}>
        {WASTE_TYPES.map((w) => (<option key={w.value} value={w.value}>{w.label}</option>))}
      </select>
      <input value={rate} onChange={(e) => setRate(e.target.value)} className={`${inputCls} w-24`} placeholder="$/ton" type="number" step="0.01" />
      <input value={min} onChange={(e) => setMin(e.target.value)} className={`${inputCls} w-24`} placeholder="Min $" type="number" step="0.01" />
      <button
        onClick={async () => {
          await api.post(`/dump-locations/${locationId}/rates`, {
            wasteType, wasteTypeLabel: label, ratePerTon: Number(rate), minimumCharge: min ? Number(min) : null,
          });
          setOpen(false); setRate(""); setMin(""); onAdded();
        }}
        className="rounded-full bg-[#22C55E] px-3 py-2 text-xs font-semibold text-black"
      >
        Add
      </button>
      <button onClick={() => setOpen(false)} className="text-xs text-[var(--t-text-muted)]">Cancel</button>
    </div>
  );
}

/* ─── Add Surcharge Inline ─── */

function AddSurchargeButton({ locationId, onAdded }: { locationId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [itemType, setItemType] = useState("");
  const [label, setLabel] = useState("");
  const [dumpCharge, setDumpCharge] = useState("");
  const [custCharge, setCustCharge] = useState("");

  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="text-[11px] font-semibold text-[var(--t-accent)] hover:opacity-80">
        + Add Surcharge
      </button>
    );

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input value={label} onChange={(e) => { setLabel(e.target.value); setItemType(e.target.value.toLowerCase().replace(/\s+/g, "_")); }} className={`${inputCls} w-32`} placeholder="Item name" />
      <input value={dumpCharge} onChange={(e) => setDumpCharge(e.target.value)} className={`${inputCls} w-24`} placeholder="Dump $" type="number" step="0.01" />
      <input value={custCharge} onChange={(e) => setCustCharge(e.target.value)} className={`${inputCls} w-24`} placeholder="Customer $" type="number" step="0.01" />
      <button
        onClick={async () => {
          await api.post(`/dump-locations/${locationId}/surcharges`, {
            itemType, label, dumpCharge: Number(dumpCharge), customerCharge: Number(custCharge),
          });
          setOpen(false); setLabel(""); setDumpCharge(""); setCustCharge(""); onAdded();
        }}
        className="rounded-full bg-[#22C55E] px-3 py-2 text-xs font-semibold text-black"
      >
        Add
      </button>
      <button onClick={() => setOpen(false)} className="text-xs text-[var(--t-text-muted)]">Cancel</button>
    </div>
  );
}

/* ─── Edit Rate Modal ─── */

function EditRateModal({ rate, onClose, onSave }: { rate: Rate; onClose: () => void; onSave: (u: { ratePerTon: number; minimumCharge: number | null; wasteType: string; wasteTypeLabel: string }) => void }) {
  const [wasteType, setWasteType] = useState(rate.waste_type);
  const [rateVal, setRateVal] = useState(String(rate.rate_per_ton));
  const [minVal, setMinVal] = useState(rate.minimum_charge ? String(rate.minimum_charge) : "");
  const label = WASTE_TYPES.find(w => w.value === wasteType)?.label || rate.waste_type_label;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="fixed inset-0 bg-black/50" />
      <div className="relative w-80 rounded-2xl border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-[var(--t-text-primary)]">Edit Rate</h3>
        <select value={wasteType} onChange={e => setWasteType(e.target.value)} className={inputCls}>
          {WASTE_TYPES.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
        </select>
        <input value={rateVal} onChange={e => setRateVal(e.target.value)} className={inputCls} placeholder="Rate per ton" type="number" step="0.01" />
        <input value={minVal} onChange={e => setMinVal(e.target.value)} className={inputCls} placeholder="Min charge (optional)" type="number" step="0.01" />
        <div className="flex gap-2">
          <button onClick={() => onSave({ ratePerTon: Number(rateVal), minimumCharge: minVal ? Number(minVal) : null, wasteType, wasteTypeLabel: label })}
            className="rounded-full bg-[#22C55E] px-4 py-2 text-xs font-semibold text-black">Save</button>
          <button onClick={onClose} className="text-xs text-[var(--t-text-muted)]">Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Edit Surcharge Modal ─── */

function EditSurchargeModal({ surcharge, onClose, onSave }: { surcharge: Surcharge; onClose: () => void; onSave: (u: { label: string; dumpCharge: number; customerCharge: number }) => void }) {
  const [label, setLabel] = useState(surcharge.label);
  const [dumpCharge, setDumpCharge] = useState(String(surcharge.dump_charge));
  const [custCharge, setCustCharge] = useState(String(surcharge.customer_charge));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="fixed inset-0 bg-black/50" />
      <div className="relative w-80 rounded-2xl border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-[var(--t-text-primary)]">Edit Surcharge</h3>
        <input value={label} onChange={e => setLabel(e.target.value)} className={inputCls} placeholder="Item name" />
        <input value={dumpCharge} onChange={e => setDumpCharge(e.target.value)} className={inputCls} placeholder="Dump charges us ($)" type="number" step="0.01" />
        <input value={custCharge} onChange={e => setCustCharge(e.target.value)} className={inputCls} placeholder="We charge customer ($)" type="number" step="0.01" />
        <div className="flex gap-2">
          <button onClick={() => onSave({ label, dumpCharge: Number(dumpCharge), customerCharge: Number(custCharge) })}
            className="rounded-full bg-[#22C55E] px-4 py-2 text-xs font-semibold text-black">Save</button>
          <button onClick={onClose} className="text-xs text-[var(--t-text-muted)]">Cancel</button>
        </div>
      </div>
    </div>
  );
}
