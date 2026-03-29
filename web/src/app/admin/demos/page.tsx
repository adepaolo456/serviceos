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

const STATUS_BADGE: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  contacted: "bg-amber-100 text-amber-700",
  converted: "bg-emerald-100 text-emerald-700",
  declined: "bg-red-100 text-red-600",
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
        <div className="mb-8 h-8 w-48 animate-pulse rounded bg-gray-200" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="mb-3 h-16 animate-pulse rounded-xl bg-gray-200" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Demo Requests</h1>
        <p className="mt-1 text-sm text-gray-500">{demos.length} total requests</p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                {["Name", "Email", "Company", "Type", "Fleet", "Status", "Date", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {demos.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <MessageSquare className="mx-auto h-12 w-12 text-gray-300 mb-3" />
                    <p className="text-sm text-gray-500">No demo requests yet</p>
                  </td>
                </tr>
              ) : (
                demos.map((d) => (
                  <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{d.name}</td>
                    <td className="px-4 py-3 text-gray-600">{d.email}</td>
                    <td className="px-4 py-3 text-gray-600">{d.company_name}</td>
                    <td className="px-4 py-3 text-gray-600 capitalize">{d.business_type || "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{d.fleet_size || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[d.status] || STATUS_BADGE.new}`}>
                        {d.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{new Date(d.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <select
                        value={d.status}
                        onChange={(e) => updateStatus(d.id, e.target.value)}
                        className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 outline-none focus:border-[#2ECC71]"
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
