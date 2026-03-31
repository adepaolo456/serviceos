"use client";

import { useState, useEffect } from "react";
import { MessageSquare } from "lucide-react";
import { api } from "@/lib/api";

interface DemoRequest {
  id: string;
  name: string;
  email: string;
  phone: string;
  company_name: string;
  business_type: string;
  fleet_size: string;
  message: string;
  status: string;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  new: "text-blue-400",
  contacted: "text-amber-400",
  converted: "text-[var(--t-accent)]",
  declined: "text-[var(--t-error)]",
};

const STATUSES = ["new", "contacted", "converted", "declined"];

export default function AdminDemosPage() {
  const [demos, setDemos] = useState<DemoRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<{ data: DemoRequest[] }>("/demos")
      .then((r) => setDemos(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const updateStatus = async (id: string, status: string) => {
    try {
      await api.patch(`/demos/${id}`, { status });
      setDemos((prev) => prev.map((d) => d.id === id ? { ...d, status } : d));
    } catch { /* */ }
  };

  if (loading) {
    return (
      <div>
        <div className="mb-8 h-8 w-48 animate-pulse rounded bg-[var(--t-bg-card)]" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="mb-3 h-16 animate-pulse rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)]" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[28px] font-bold tracking-[-1px]" style={{ color: "var(--t-frame-text)" }}>Demo Requests</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--t-frame-text-muted)" }}>{demos.length} total requests</p>
      </div>

      <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--t-border)]">
                {["Name", "Email", "Company", "Type", "Fleet", "Status", "Date", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {demos.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <MessageSquare className="mx-auto h-12 w-12 text-[var(--t-text-muted)]/20 mb-3" />
                    <p className="text-sm text-[var(--t-text-muted)]">No demo requests yet</p>
                  </td>
                </tr>
              ) : (
                demos.map((d) => (
                  <tr key={d.id} className="border-b border-[var(--t-border)] last:border-0 hover:bg-[var(--t-bg-card-hover)] transition-colors">
                    <td className="px-4 py-3 font-medium text-[var(--t-text-primary)]">{d.name}</td>
                    <td className="px-4 py-3 text-[var(--t-text-muted)]">{d.email}</td>
                    <td className="px-4 py-3 text-[var(--t-text-muted)]">{d.company_name}</td>
                    <td className="px-4 py-3 text-[var(--t-text-muted)] capitalize">{d.business_type || "—"}</td>
                    <td className="px-4 py-3 text-[var(--t-text-muted)]">{d.fleet_size || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium capitalize ${STATUS_COLORS[d.status] || STATUS_COLORS.new}`}>
                        {d.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--t-text-muted)]">{new Date(d.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <select
                        value={d.status}
                        onChange={(e) => updateStatus(d.id, e.target.value)}
                        className="rounded-full border border-[var(--t-border)] bg-[var(--t-bg-card)] px-2 py-1 text-xs text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)]"
                      >
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
