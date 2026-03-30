"use client";

import { useState, useEffect, useMemo } from "react";
import {
  FileText,
  Search,
  CheckCircle2,
  Clock,
  AlertCircle,
  Truck,
  DollarSign,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

/* ─── Types ─── */

interface DumpSlipJob {
  id: string;
  job_number: string;
  status: string;
  scheduled_date: string;
  dump_status: string | null;
  dump_location_name: string | null;
  dump_weight_tons: number | null;
  dump_fee: number | null;
  dump_surcharges_total: number | null;
  dump_slip_photo_url: string | null;
  customer: {
    id: string;
    first_name: string;
    last_name: string;
  } | null;
  assigned_driver: {
    id: string;
    first_name: string;
    last_name: string;
  } | null;
}

type Tab = "all" | "pending" | "reviewed";

/* ─── Page ─── */

export default function DumpSlipsPage() {
  const [jobs, setJobs] = useState<DumpSlipJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    api
      .get<DumpSlipJob[]>("/jobs?include=dump")
      .then(setJobs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = jobs;
    if (tab === "pending")
      list = list.filter(
        (j) => j.dump_status === "pending" || j.dump_status === null
      );
    if (tab === "reviewed")
      list = list.filter((j) => j.dump_status === "reviewed");
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (j) =>
          j.job_number?.toLowerCase().includes(q) ||
          j.customer?.first_name?.toLowerCase().includes(q) ||
          j.customer?.last_name?.toLowerCase().includes(q) ||
          j.dump_location_name?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [jobs, tab, search]);

  const stats = useMemo(() => {
    const pending = jobs.filter(
      (j) => j.dump_status === "pending" || j.dump_status === null
    ).length;
    const reviewed = jobs.filter((j) => j.dump_status === "reviewed").length;
    const totalFees = jobs.reduce((s, j) => s + (Number(j.dump_fee) || 0), 0);
    return { total: jobs.length, pending, reviewed, totalFees };
  }, [jobs]);

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "all", label: "All", count: stats.total },
    { key: "pending", label: "Pending", count: stats.pending },
    { key: "reviewed", label: "Reviewed", count: stats.reviewed },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">
          Dump Slips
        </h1>
        <p className="mt-0.5 text-sm text-muted">
          Review dump tickets and weight slips from completed jobs
        </p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<FileText className="h-4 w-4 text-brand" />}
          label="Total Slips"
          value={String(stats.total)}
        />
        <StatCard
          icon={<Clock className="h-4 w-4 text-yellow-400" />}
          label="Pending Review"
          value={String(stats.pending)}
        />
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4 text-green-400" />}
          label="Reviewed"
          value={String(stats.reviewed)}
        />
        <StatCard
          icon={<DollarSign className="h-4 w-4 text-purple-400" />}
          label="Total Dump Fees"
          value={formatCurrency(stats.totalFees)}
        />
      </div>

      {/* Tabs + search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-dark-card border border-[#1E2D45] p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t.key
                  ? "bg-brand text-white"
                  : "text-muted hover:text-white"
              }`}
            >
              {t.label}
              <span className="ml-1.5 opacity-60">{t.count}</span>
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search jobs, customers, locations..."
            className="w-full md:w-72 bg-dark-card border border-[#1E2D45] rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-muted outline-none focus:border-brand"
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 skeleton rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-dark-card border border-dashed border-[#1E2D45] py-16 text-center">
          <FileText className="mx-auto h-10 w-10 text-muted/20 mb-2" />
          <p className="text-sm text-muted">
            {search ? "No matching dump slips" : "No dump slips found"}
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-dark-card border border-[#1E2D45] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1E2D45]">
                <th className="px-4 py-3 text-left text-xs font-medium text-muted">
                  Job
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted">
                  Customer
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted">
                  Driver
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted">
                  Dump Location
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted">
                  Weight (tons)
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted">
                  Dump Fee
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-muted">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((j) => (
                <tr
                  key={j.id}
                  className="border-b border-[#1E2D45] last:border-0 hover:bg-dark-card-hover transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-white">
                    {j.job_number}
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {j.customer
                      ? `${j.customer.first_name} ${j.customer.last_name}`
                      : "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {j.assigned_driver ? (
                      <span className="flex items-center gap-1.5">
                        <Truck className="h-3 w-3 text-muted" />
                        {j.assigned_driver.first_name}{" "}
                        {j.assigned_driver.last_name}
                      </span>
                    ) : (
                      "\u2014"
                    )}
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {j.dump_location_name || "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">
                    {j.dump_weight_tons != null
                      ? j.dump_weight_tons.toFixed(2)
                      : "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">
                    {j.dump_fee != null ? formatCurrency(j.dump_fee) : "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <DumpStatusBadge status={j.dump_status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Small components ─── */

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-dark-card border border-[#1E2D45] px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs text-muted">{label}</span>
      </div>
      <p className="text-lg font-bold text-white tabular-nums">{value}</p>
    </div>
  );
}

function DumpStatusBadge({ status }: { status: string | null }) {
  if (status === "reviewed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 text-green-400 px-2.5 py-0.5 text-[10px] font-medium">
        <CheckCircle2 className="h-3 w-3" /> Reviewed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/10 text-yellow-400 px-2.5 py-0.5 text-[10px] font-medium">
      <AlertCircle className="h-3 w-3" /> Pending
    </span>
  );
}
