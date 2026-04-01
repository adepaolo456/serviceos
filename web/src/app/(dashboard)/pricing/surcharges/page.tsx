"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Pencil, Trash2, DollarSign, Tag } from "lucide-react";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";
import { useToast } from "@/components/toast";
import { formatCurrency } from "@/lib/utils";

const fmt = (n: number) => formatCurrency(n);

interface SurchargeTemplate {
  id: string;
  name: string;
  default_amount: number;
  is_taxable: boolean;
  is_active: boolean;
  created_at: string;
}

export default function SurchargeTemplatesPage() {
  const [templates, setTemplates] = useState<SurchargeTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<SurchargeTemplate | null>(null);
  const { toast } = useToast();

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<SurchargeTemplate[]>("/surcharge-templates");
      setTemplates(Array.isArray(res) ? res : []);
    } catch { /* */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const handleDelete = async (id: string) => {
    if (!confirm("Deactivate this surcharge template?")) return;
    try {
      await api.delete(`/surcharge-templates/${id}`);
      toast("success", "Template deactivated");
      await fetch();
    } catch { toast("error", "Failed to delete"); }
  };

  const openEdit = (t: SurchargeTemplate) => { setEditing(t); setPanelOpen(true); };
  const openCreate = () => { setEditing(null); setPanelOpen(true); };
  const onSuccess = () => { setPanelOpen(false); setEditing(null); fetch(); };

  return (
    <div>
      <Link href="/pricing" className="mb-6 inline-flex items-center gap-2 text-sm transition-colors" style={{ color: "var(--t-frame-text-muted)" }}>
        <ArrowLeft className="h-4 w-4" /> Back to Pricing
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-1px]" style={{ color: "var(--t-frame-text)" }}>
            Surcharge Templates
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--t-frame-text-muted)" }}>
            Define surcharge items that drivers can flag on the job
          </p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold" style={{ background: "var(--t-accent)", color: "#000" }}>
          <Plus className="h-4 w-4" /> Add Surcharge
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-[20px]" style={{ background: "var(--t-bg-card)" }} />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Tag className="h-12 w-12 mb-4" style={{ color: "var(--t-text-muted)" }} />
          <h3 className="text-lg font-semibold mb-1" style={{ color: "var(--t-frame-text)" }}>No surcharge templates</h3>
          <p className="text-sm mb-4" style={{ color: "var(--t-frame-text-muted)" }}>Create surcharges for items like mattresses, AC units, etc.</p>
          <button onClick={openCreate} className="rounded-full px-5 py-2.5 text-sm font-semibold" style={{ background: "var(--t-accent)", color: "#000" }}>
            Add Surcharge
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map(t => (
            <div key={t.id} className="rounded-[20px] border p-5 flex flex-col" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4" style={{ color: "var(--t-accent)" }} />
                  <h3 className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>{t.name}</h3>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(t)} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--t-bg-card-hover)]">
                    <Pencil className="h-3.5 w-3.5" style={{ color: "var(--t-text-muted)" }} />
                  </button>
                  <button onClick={() => handleDelete(t.id)} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--t-error-soft)]">
                    <Trash2 className="h-3.5 w-3.5" style={{ color: "var(--t-error)" }} />
                  </button>
                </div>
              </div>
              <p className="text-2xl font-bold tabular-nums mb-2" style={{ color: "var(--t-text-primary)" }}>
                {fmt(Number(t.default_amount))}
              </p>
              <div className="flex gap-2 mt-auto">
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{
                  background: t.is_taxable ? "var(--t-warning-soft)" : "var(--t-bg-elevated)",
                  color: t.is_taxable ? "var(--t-warning)" : "var(--t-text-muted)",
                }}>
                  {t.is_taxable ? "Taxable" : "Non-Taxable"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <SlideOver open={panelOpen} onClose={() => setPanelOpen(false)} title={editing ? "Edit Surcharge" : "New Surcharge"}>
        <SurchargeForm editing={editing} onSuccess={onSuccess} />
      </SlideOver>
    </div>
  );
}

function SurchargeForm({ editing, onSuccess }: { editing: SurchargeTemplate | null; onSuccess: () => void }) {
  const [name, setName] = useState(editing?.name || "");
  const [amount, setAmount] = useState(String(editing?.default_amount || ""));
  const [taxable, setTaxable] = useState(editing?.is_taxable ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name) { setError("Name is required"); return; }
    setError(""); setSaving(true);
    try {
      const body = { name, default_amount: Number(amount) || 0, is_taxable: taxable };
      if (editing) {
        await api.put(`/surcharge-templates/${editing.id}`, body);
        toast("success", "Surcharge updated");
      } else {
        await api.post("/surcharge-templates", body);
        toast("success", "Surcharge created");
      }
      onSuccess();
    } catch { setError("Failed to save"); }
    finally { setSaving(false); }
  };

  const inp = "w-full rounded-[20px] border px-4 py-2.5 text-sm outline-none transition-colors focus:border-[var(--t-accent)]";
  const inpStyle = { background: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <div className="rounded-[20px] px-4 py-3 text-sm" style={{ background: "var(--t-error-soft)", color: "var(--t-error)" }}>{error}</div>}
      <div>
        <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--t-text-muted)" }}>Name</label>
        <input value={name} onChange={e => setName(e.target.value)} className={inp} style={inpStyle} placeholder="e.g. Mattress" required />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--t-text-muted)" }}>Default Amount</label>
        <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className={inp} style={inpStyle} placeholder="100.00" required />
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setTaxable(!taxable)}
          className="relative w-10 h-5 rounded-full transition-colors"
          style={{ background: taxable ? "var(--t-accent)" : "var(--t-border)" }}>
          <span className={`absolute top-0.5 ${taxable ? "left-5" : "left-0.5"} h-4 w-4 rounded-full bg-white transition-all shadow`} />
        </button>
        <span className="text-sm" style={{ color: "var(--t-text-primary)" }}>Taxable</span>
      </div>
      <button type="submit" disabled={saving} className="w-full rounded-full py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50" style={{ background: "var(--t-accent)", color: "#000" }}>
        {saving ? "Saving..." : editing ? "Update Surcharge" : "Create Surcharge"}
      </button>
    </form>
  );
}
