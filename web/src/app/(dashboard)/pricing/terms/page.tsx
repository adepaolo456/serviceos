"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Pencil, Trash2, FileText, Star, Eye } from "lucide-react";
import { api } from "@/lib/api";
import SlideOver from "@/components/slide-over";
import { useToast } from "@/components/toast";

interface TermsTemplate {
  id: string;
  name: string;
  client_type: string | null;
  template_body: string;
  is_default: boolean;
  created_at: string;
}

export default function TermsTemplatesPage() {
  const [templates, setTemplates] = useState<TermsTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<TermsTemplate | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const { toast } = useToast();

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<TermsTemplate[]>("/terms-templates");
      setTemplates(Array.isArray(res) ? res : []);
    } catch { /* */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this terms template?")) return;
    try {
      await api.delete(`/terms-templates/${id}`);
      toast("success", "Template deleted");
      await fetch();
    } catch { toast("error", "Failed to delete"); }
  };

  const handlePreview = async (id: string) => {
    try {
      const res = await api.post<{ rendered_text: string }>(`/terms-templates/${id}/render`, {
        weight_allowance: "3",
        overage_per_ton: "150",
        daily_overage_rate: "25",
        rental_days: "14",
        base_price: "800",
      });
      setPreviewText(res.rendered_text);
    } catch { toast("error", "Preview failed"); }
  };

  const onSuccess = () => { setPanelOpen(false); setEditing(null); fetch(); };

  const clientLabel = (t: string | null) => {
    if (!t) return "Universal";
    return t.charAt(0).toUpperCase() + t.slice(1);
  };

  return (
    <div>
      <Link href="/pricing" className="mb-6 inline-flex items-center gap-2 text-sm transition-colors" style={{ color: "var(--t-frame-text-muted)" }}>
        <ArrowLeft className="h-4 w-4" /> Back to Pricing
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-1px]" style={{ color: "var(--t-frame-text)" }}>
            Terms & Conditions
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--t-frame-text-muted)" }}>
            Templates for invoice terms with dynamic pricing variables
          </p>
        </div>
        <button onClick={() => { setEditing(null); setPanelOpen(true); }} className="flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold" style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}>
          <Plus className="h-4 w-4" /> Add Template
        </button>
      </div>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-[20px]" style={{ background: "var(--t-bg-card)" }} />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <FileText className="h-12 w-12 mb-4" style={{ color: "var(--t-text-muted)" }} />
          <h3 className="text-lg font-semibold mb-1" style={{ color: "var(--t-frame-text)" }}>No terms templates</h3>
          <p className="text-sm mb-4" style={{ color: "var(--t-frame-text-muted)" }}>{"Create templates with {{variables}} for dynamic pricing"}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {templates.map(t => (
            <div key={t.id} className="rounded-[20px] border p-5" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>{t.name}</h3>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-muted)" }}>
                    {clientLabel(t.client_type)}
                  </span>
                  {t.is_default && (
                    <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: "var(--t-accent-soft)", color: "var(--t-accent)" }}>
                      <Star className="h-3 w-3" /> Default
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => handlePreview(t.id)} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--t-bg-card-hover)]" title="Preview">
                    <Eye className="h-3.5 w-3.5" style={{ color: "var(--t-text-muted)" }} />
                  </button>
                  <button onClick={() => { setEditing(t); setPanelOpen(true); }} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--t-bg-card-hover)]">
                    <Pencil className="h-3.5 w-3.5" style={{ color: "var(--t-text-muted)" }} />
                  </button>
                  <button onClick={() => handleDelete(t.id)} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--t-error-soft)]">
                    <Trash2 className="h-3.5 w-3.5" style={{ color: "var(--t-error)" }} />
                  </button>
                </div>
              </div>
              <p className="text-xs leading-relaxed line-clamp-3" style={{ color: "var(--t-text-muted)" }}>
                {t.template_body.slice(0, 250)}{t.template_body.length > 250 ? "..." : ""}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Preview Modal */}
      {previewText !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setPreviewText(null)}>
          <div className="max-w-2xl w-full max-h-[80vh] overflow-y-auto rounded-[20px] border p-6"
            style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}
            onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4" style={{ color: "var(--t-text-primary)" }}>Preview (Sample Data)</h3>
            <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--t-text-primary)" }}>
              {previewText}
            </div>
            <button onClick={() => setPreviewText(null)} className="mt-4 rounded-full px-5 py-2 text-sm font-medium border" style={{ borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}>
              Close
            </button>
          </div>
        </div>
      )}

      <SlideOver open={panelOpen} onClose={() => setPanelOpen(false)} title={editing ? "Edit Template" : "New Template"}>
        <TermsForm editing={editing} onSuccess={onSuccess} />
      </SlideOver>
    </div>
  );
}

function TermsForm({ editing, onSuccess }: { editing: TermsTemplate | null; onSuccess: () => void }) {
  const [name, setName] = useState(editing?.name || "");
  const [clientType, setClientType] = useState(editing?.client_type || "");
  const [body, setBody] = useState(editing?.template_body || "");
  const [isDefault, setIsDefault] = useState(editing?.is_default ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name || !body) { setError("Name and body are required"); return; }
    setError(""); setSaving(true);
    try {
      const data = { name, client_type: clientType || undefined, template_body: body, is_default: isDefault };
      if (editing) {
        await api.put(`/terms-templates/${editing.id}`, data);
        toast("success", "Template updated");
      } else {
        await api.post("/terms-templates", data);
        toast("success", "Template created");
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
        <input value={name} onChange={e => setName(e.target.value)} className={inp} style={inpStyle} placeholder="Residential Standard" required />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--t-text-muted)" }}>Client Type</label>
        <select value={clientType} onChange={e => setClientType(e.target.value)} className={inp} style={inpStyle}>
          <option value="">Universal (All)</option>
          <option value="residential">Residential</option>
          <option value="commercial">Commercial</option>
        </select>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setIsDefault(!isDefault)}
          className="relative w-10 h-5 rounded-full transition-colors"
          style={{ background: isDefault ? "var(--t-accent)" : "var(--t-border)" }}>
          <span className={`absolute top-0.5 ${isDefault ? "left-5" : "left-0.5"} h-4 w-4 rounded-full bg-white transition-all shadow`} />
        </button>
        <span className="text-sm" style={{ color: "var(--t-text-primary)" }}>Default Template</span>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--t-text-muted)" }}>
          Template Body
        </label>
        <p className="text-xs mb-2" style={{ color: "var(--t-text-muted)" }}>
          {"Variables: {{weight_allowance}}, {{overage_per_ton}}, {{daily_overage_rate}}, {{rental_days}}, {{base_price}}"}
        </p>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={12}
          className="w-full rounded-[20px] border px-4 py-3 text-sm outline-none transition-colors focus:border-[var(--t-accent)] resize-none"
          style={inpStyle} placeholder="Enter terms and conditions..." required />
      </div>
      <button type="submit" disabled={saving} className="w-full rounded-full py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50" style={{ background: "var(--t-accent)", color: "var(--t-accent-on-accent)" }}>
        {saving ? "Saving..." : editing ? "Update Template" : "Create Template"}
      </button>
    </form>
  );
}
