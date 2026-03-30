"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart3,
  DollarSign,
  TrendingUp,
  Truck,
  Users,
  Box,
  FileText,
  Download,
  Loader2,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

/* ─── Types ─── */

interface RevenueData {
  totalRevenue: number;
  collected: number;
  outstanding: number;
  overdue: number;
  revenueBySource: { source: string; amount: number }[];
  revenueBySize: { size: string; amount: number; count: number }[];
}

interface DumpCostsData {
  totalDumpCosts: number;
  totalCustomerCharges: number;
  margin: number;
  marginPercent: number;
  costsByFacility: { facility: string; cost: number; loads: number }[];
  costsByWasteType: { wasteType: string; cost: number; loads: number }[];
}

interface ProfitData {
  revenue: number;
  dumpCosts: number;
  grossProfit: number;
  marginPercent: number;
}

interface DriverRow {
  id: string;
  name: string;
  totalJobs: number;
  completed: number;
  failed: number;
  deliveries: number;
  pickups: number;
}

interface DriversData {
  totalDrivers: number;
  totalCompleted: number;
  drivers: DriverRow[];
}

interface AssetSizeRow {
  size: string;
  total: number;
  available: number;
  deployed: number;
  staged: number;
}

interface AssetsData {
  total: number;
  available: number;
  deployed: number;
  staged: number;
  bySize: AssetSizeRow[];
}

interface CustomerRow {
  id: string;
  name: string;
  type: string;
  totalSpend: number;
  jobCount: number;
}

interface CustomersData {
  total: number;
  newCustomers: number;
  byType: { type: string; count: number }[];
  topCustomers: CustomerRow[];
}

interface AgingBucket {
  label: string;
  amount: number;
  count: number;
}

interface OverdueInvoice {
  id: string;
  customer: string;
  amount: number;
  dueDate: string;
  daysOverdue: number;
}

interface ReceivablesData {
  totalOutstanding: number;
  totalOverdue: number;
  aging: AgingBucket[];
  overdueInvoices: OverdueInvoice[];
}

/* ─── Tabs ─── */

type TabKey = "revenue" | "dump-costs" | "profit" | "drivers" | "assets" | "customers" | "receivables";

const TABS: { key: TabKey; label: string; icon: typeof DollarSign }[] = [
  { key: "revenue", label: "Revenue", icon: DollarSign },
  { key: "dump-costs", label: "Dump Costs", icon: TrendingUp },
  { key: "profit", label: "Profit", icon: BarChart3 },
  { key: "drivers", label: "Drivers", icon: Truck },
  { key: "assets", label: "Assets", icon: Box },
  { key: "customers", label: "Customers", icon: Users },
  { key: "receivables", label: "Receivables", icon: FileText },
];

/* ─── Helpers ─── */

function downloadCSV(data: Record<string, unknown>[], filename: string) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const csv = [
    headers.join(","),
    ...data.map((row) =>
      headers.map((h) => JSON.stringify(row[h] ?? "")).join(",")
    ),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function fmtPct(n: number | undefined | null): string {
  if (n === null || n === undefined || isNaN(n)) return "0%";
  return `${n.toFixed(1)}%`;
}

function fmtNum(n: number | undefined | null): string {
  if (n === null || n === undefined || isNaN(n)) return "0";
  return n.toLocaleString("en-US");
}

/* ─── Sub-components ─── */

function KPI({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl bg-dark-card border border-[#1E2D45] p-4">
      <p className="text-xs text-muted uppercase tracking-wider font-medium">
        {label}
      </p>
      <p
        className={`text-2xl font-bold mt-1 tabular-nums ${color || "text-white"}`}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-muted mt-0.5">{sub}</p>}
    </div>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-xl animate-pulse ${className}`} />;
}

function KPIGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
      {children}
    </div>
  );
}

function KPISkeleton() {
  return (
    <KPIGrid>
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-24" />
      ))}
    </KPIGrid>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="py-16 text-center">
      <BarChart3 className="mx-auto h-10 w-10 text-muted/20 mb-3" />
      <p className="text-sm text-muted">{text}</p>
    </div>
  );
}

function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | number)[][];
}) {
  if (!rows.length) return <EmptyState text="No data for this period" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#1E2D45]">
            {headers.map((h) => (
              <th
                key={h}
                className="text-left text-xs text-muted uppercase tracking-wider font-medium py-3 px-3"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-[#1E2D45]/50 hover:bg-[#111C2E] transition-colors"
            >
              {row.map((cell, j) => (
                <td key={j} className="py-3 px-3 text-white tabular-nums">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Tab Content Components ─── */

function RevenueTab({
  data,
  loading,
}: {
  data: RevenueData | null;
  loading: boolean;
}) {
  if (loading) return <><KPISkeleton /><TableSkeleton /></>;
  if (!data) return <EmptyState text="No revenue data available" />;

  return (
    <div className="space-y-6">
      <KPIGrid>
        <KPI label="Total Revenue" value={formatCurrency(data.totalRevenue)} color="text-[#2ECC71]" />
        <KPI label="Collected" value={formatCurrency(data.collected)} color="text-emerald-400" />
        <KPI label="Outstanding" value={formatCurrency(data.outstanding)} color="text-yellow-400" />
        <KPI label="Overdue" value={formatCurrency(data.overdue)} color="text-red-400" />
      </KPIGrid>

      {data.revenueBySource?.length > 0 && (
        <div className="rounded-xl border border-[#1E2D45] bg-dark-card p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Revenue by Source</h3>
          <DataTable
            headers={["Source", "Amount"]}
            rows={data.revenueBySource.map((r) => [r.source, formatCurrency(r.amount)])}
          />
        </div>
      )}

      {data.revenueBySize?.length > 0 && (
        <div className="rounded-xl border border-[#1E2D45] bg-dark-card p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Revenue by Size</h3>
          <DataTable
            headers={["Size", "Jobs", "Amount"]}
            rows={data.revenueBySize.map((r) => [r.size, fmtNum(r.count), formatCurrency(r.amount)])}
          />
        </div>
      )}
    </div>
  );
}

function DumpCostsTab({
  data,
  loading,
}: {
  data: DumpCostsData | null;
  loading: boolean;
}) {
  if (loading) return <><KPISkeleton /><TableSkeleton /></>;
  if (!data) return <EmptyState text="No dump cost data available" />;

  return (
    <div className="space-y-6">
      <KPIGrid>
        <KPI label="Dump Costs" value={formatCurrency(data.totalDumpCosts)} color="text-red-400" />
        <KPI label="Customer Charges" value={formatCurrency(data.totalCustomerCharges)} color="text-white" />
        <KPI label="Margin" value={formatCurrency(data.margin)} color="text-[#2ECC71]" />
        <KPI label="Margin %" value={fmtPct(data.marginPercent)} color="text-[#2ECC71]" />
      </KPIGrid>

      {data.costsByFacility?.length > 0 && (
        <div className="rounded-xl border border-[#1E2D45] bg-dark-card p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Costs by Facility</h3>
          <DataTable
            headers={["Facility", "Loads", "Cost"]}
            rows={data.costsByFacility.map((r) => [r.facility, fmtNum(r.loads), formatCurrency(r.cost)])}
          />
        </div>
      )}

      {data.costsByWasteType?.length > 0 && (
        <div className="rounded-xl border border-[#1E2D45] bg-dark-card p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Costs by Waste Type</h3>
          <DataTable
            headers={["Waste Type", "Loads", "Cost"]}
            rows={data.costsByWasteType.map((r) => [r.wasteType, fmtNum(r.loads), formatCurrency(r.cost)])}
          />
        </div>
      )}
    </div>
  );
}

function ProfitTab({
  data,
  loading,
}: {
  data: ProfitData | null;
  loading: boolean;
}) {
  if (loading) return <KPISkeleton />;
  if (!data) return <EmptyState text="No profit data available" />;

  return (
    <KPIGrid>
      <KPI label="Revenue" value={formatCurrency(data.revenue)} color="text-white" />
      <KPI label="Dump Costs" value={formatCurrency(data.dumpCosts)} color="text-red-400" />
      <KPI label="Gross Profit" value={formatCurrency(data.grossProfit)} color="text-[#2ECC71]" />
      <KPI label="Margin %" value={fmtPct(data.marginPercent)} color="text-[#2ECC71]" />
    </KPIGrid>
  );
}

function DriversTab({
  data,
  loading,
}: {
  data: DriversData | null;
  loading: boolean;
}) {
  if (loading) return <><KPISkeleton /><TableSkeleton /></>;
  if (!data) return <EmptyState text="No driver data available" />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-6">
        <KPI label="Total Drivers" value={fmtNum(data.totalDrivers)} />
        <KPI label="Total Completed" value={fmtNum(data.totalCompleted)} color="text-[#2ECC71]" />
      </div>

      {data.drivers?.length > 0 && (
        <div className="rounded-xl border border-[#1E2D45] bg-dark-card p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Driver Stats</h3>
          <DataTable
            headers={["Name", "Jobs", "Completed", "Failed", "Deliveries", "Pickups"]}
            rows={data.drivers.map((d) => [
              d.name,
              fmtNum(d.totalJobs),
              fmtNum(d.completed),
              fmtNum(d.failed),
              fmtNum(d.deliveries),
              fmtNum(d.pickups),
            ])}
          />
        </div>
      )}
    </div>
  );
}

function AssetsTab({
  data,
  loading,
}: {
  data: AssetsData | null;
  loading: boolean;
}) {
  if (loading) return <><KPISkeleton /><TableSkeleton /></>;
  if (!data) return <EmptyState text="No asset data available" />;

  return (
    <div className="space-y-6">
      <KPIGrid>
        <KPI label="Total" value={fmtNum(data.total)} />
        <KPI label="Available" value={fmtNum(data.available)} color="text-[#2ECC71]" />
        <KPI label="Deployed" value={fmtNum(data.deployed)} color="text-blue-400" />
        <KPI label="Staged" value={fmtNum(data.staged)} color="text-yellow-400" />
      </KPIGrid>

      {data.bySize?.length > 0 && (
        <div className="rounded-xl border border-[#1E2D45] bg-dark-card p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Assets by Size</h3>
          <DataTable
            headers={["Size", "Total", "Available", "Deployed", "Staged"]}
            rows={data.bySize.map((r) => [
              r.size,
              fmtNum(r.total),
              fmtNum(r.available),
              fmtNum(r.deployed),
              fmtNum(r.staged),
            ])}
          />
        </div>
      )}
    </div>
  );
}

function CustomersTab({
  data,
  loading,
}: {
  data: CustomersData | null;
  loading: boolean;
}) {
  if (loading) return <><KPISkeleton /><TableSkeleton /></>;
  if (!data) return <EmptyState text="No customer data available" />;

  return (
    <div className="space-y-6">
      <KPIGrid>
        <KPI label="Total Customers" value={fmtNum(data.total)} />
        <KPI label="New Customers" value={fmtNum(data.newCustomers)} color="text-[#2ECC71]" />
        {data.byType?.slice(0, 2).map((t) => (
          <KPI key={t.type} label={t.type} value={fmtNum(t.count)} />
        ))}
      </KPIGrid>

      {data.topCustomers?.length > 0 && (
        <div className="rounded-xl border border-[#1E2D45] bg-dark-card p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Top Customers</h3>
          <DataTable
            headers={["Name", "Type", "Jobs", "Total Spend"]}
            rows={data.topCustomers.map((c) => [
              c.name,
              c.type,
              fmtNum(c.jobCount),
              formatCurrency(c.totalSpend),
            ])}
          />
        </div>
      )}
    </div>
  );
}

function ReceivablesTab({
  data,
  loading,
}: {
  data: ReceivablesData | null;
  loading: boolean;
}) {
  if (loading) return <><KPISkeleton /><TableSkeleton /></>;
  if (!data) return <EmptyState text="No receivables data available" />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-6">
        <KPI label="Outstanding" value={formatCurrency(data.totalOutstanding)} color="text-yellow-400" />
        <KPI label="Overdue" value={formatCurrency(data.totalOverdue)} color="text-red-400" />
      </div>

      {data.aging?.length > 0 && (
        <div className="rounded-xl border border-[#1E2D45] bg-dark-card p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Aging Summary</h3>
          <DataTable
            headers={["Bucket", "Invoices", "Amount"]}
            rows={data.aging.map((a) => [a.label, fmtNum(a.count), formatCurrency(a.amount)])}
          />
        </div>
      )}

      {data.overdueInvoices?.length > 0 && (
        <div className="rounded-xl border border-[#1E2D45] bg-dark-card p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Overdue Invoices</h3>
          <DataTable
            headers={["Customer", "Amount", "Due Date", "Days Overdue"]}
            rows={data.overdueInvoices.map((inv) => [
              inv.customer,
              formatCurrency(inv.amount),
              inv.dueDate,
              fmtNum(inv.daysOverdue),
            ])}
          />
        </div>
      )}
    </div>
  );
}

/* ─── Main Page ─── */

export default function AnalyticsPage() {
  const now = new Date();
  const [startDate, setStartDate] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0]
  );
  const [endDate, setEndDate] = useState(now.toISOString().split("T")[0]);
  const [activeTab, setActiveTab] = useState<TabKey>("revenue");
  const [loading, setLoading] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tabData, setTabData] = useState<Record<TabKey, any>>({
    revenue: null,
    "dump-costs": null,
    profit: null,
    drivers: null,
    assets: null,
    customers: null,
    receivables: null,
  });

  const setPreset = (preset: "month" | "quarter" | "year") => {
    const today = new Date();
    let start: Date;
    if (preset === "month") {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (preset === "quarter") {
      const q = Math.floor(today.getMonth() / 3) * 3;
      start = new Date(today.getFullYear(), q, 1);
    } else {
      start = new Date(today.getFullYear(), 0, 1);
    }
    setStartDate(start.toISOString().split("T")[0]);
    setEndDate(today.toISOString().split("T")[0]);
  };

  const fetchTab = useCallback(
    async (tab: TabKey) => {
      setLoading(true);
      try {
        const qs = `startDate=${startDate}&endDate=${endDate}`;
        let result;
        switch (tab) {
          case "revenue":
            result = await api.get<RevenueData>(`/reporting/revenue?${qs}`);
            break;
          case "dump-costs":
            result = await api.get<DumpCostsData>(`/reporting/dump-costs?${qs}`);
            break;
          case "profit":
            result = await api.get<ProfitData>(`/reporting/profit?${qs}`);
            break;
          case "drivers":
            result = await api.get<DriversData>(`/reporting/drivers?${qs}`);
            break;
          case "assets":
            result = await api.get<AssetsData>("/reporting/assets");
            break;
          case "customers":
            result = await api.get<CustomersData>(`/reporting/customers?${qs}`);
            break;
          case "receivables":
            result = await api.get<ReceivablesData>("/reporting/accounts-receivable");
            break;
        }
        setTabData((prev) => ({ ...prev, [tab]: result }));
      } catch (err) {
        console.error(`Failed to fetch ${tab}:`, err);
      } finally {
        setLoading(false);
      }
    },
    [startDate, endDate]
  );

  useEffect(() => {
    fetchTab(activeTab);
  }, [activeTab, fetchTab]);

  const handleExport = () => {
    const data = tabData[activeTab];
    if (!data) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rows: Record<string, any>[] = [];
    switch (activeTab) {
      case "revenue":
        rows = data.revenueBySource || data.revenueBySize || [];
        break;
      case "dump-costs":
        rows = data.costsByFacility || data.costsByWasteType || [];
        break;
      case "profit":
        rows = [{ revenue: data.revenue, dumpCosts: data.dumpCosts, grossProfit: data.grossProfit, marginPercent: data.marginPercent }];
        break;
      case "drivers":
        rows = data.drivers || [];
        break;
      case "assets":
        rows = data.bySize || [];
        break;
      case "customers":
        rows = data.topCustomers || [];
        break;
      case "receivables":
        rows = data.overdueInvoices || data.aging || [];
        break;
    }
    downloadCSV(rows, `${activeTab}-report-${startDate}-to-${endDate}.csv`);
  };

  const presetClass = (preset: string, s: string, e: string) => {
    const today = new Date();
    let expectedStart: Date;
    if (preset === "month") {
      expectedStart = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (preset === "quarter") {
      const q = Math.floor(today.getMonth() / 3) * 3;
      expectedStart = new Date(today.getFullYear(), q, 1);
    } else {
      expectedStart = new Date(today.getFullYear(), 0, 1);
    }
    const expectedEnd = today.toISOString().split("T")[0];
    const expectedStartStr = expectedStart.toISOString().split("T")[0];
    const isActive = s === expectedStartStr && e === expectedEnd;
    return isActive
      ? "bg-[#2ECC71]/10 text-[#2ECC71] border-[#2ECC71]/30"
      : "text-muted hover:text-white border-transparent";
  };

  return (
    <div>
      {/* ─── Top Bar ─── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">
          Reports
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          {/* Preset buttons */}
          <div className="flex rounded-lg border border-[#1E2D45] overflow-hidden">
            {(["month", "quarter", "year"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPreset(p)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border-r last:border-r-0 border-[#1E2D45] ${presetClass(p, startDate, endDate)}`}
              >
                This {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>

          {/* Custom date inputs */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-lg border border-[#1E2D45] bg-dark-card px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#2ECC71]/50"
            />
            <span className="text-xs text-muted">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-lg border border-[#1E2D45] bg-dark-card px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#2ECC71]/50"
            />
          </div>

          {/* Export */}
          <button
            onClick={handleExport}
            disabled={!tabData[activeTab]}
            className="flex items-center gap-1.5 rounded-lg border border-[#1E2D45] px-3 py-1.5 text-xs font-medium text-muted hover:text-white hover:border-white/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {/* ─── Tab Row ─── */}
      <div className="flex overflow-x-auto gap-1 mb-6 pb-1 -mx-1 px-1 scrollbar-hide">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-medium transition-all shrink-0 ${
                isActive
                  ? "bg-[#2ECC71]/10 text-[#2ECC71] border border-[#2ECC71]/30"
                  : "text-muted hover:text-white border border-transparent hover:border-[#1E2D45]"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {loading && isActive && (
                <Loader2 className="h-3 w-3 animate-spin ml-1" />
              )}
            </button>
          );
        })}
      </div>

      {/* ─── Tab Content ─── */}
      <div className="min-h-[400px]">
        {activeTab === "revenue" && (
          <RevenueTab data={tabData.revenue} loading={loading && !tabData.revenue} />
        )}
        {activeTab === "dump-costs" && (
          <DumpCostsTab data={tabData["dump-costs"]} loading={loading && !tabData["dump-costs"]} />
        )}
        {activeTab === "profit" && (
          <ProfitTab data={tabData.profit} loading={loading && !tabData.profit} />
        )}
        {activeTab === "drivers" && (
          <DriversTab data={tabData.drivers} loading={loading && !tabData.drivers} />
        )}
        {activeTab === "assets" && (
          <AssetsTab data={tabData.assets} loading={loading && !tabData.assets} />
        )}
        {activeTab === "customers" && (
          <CustomersTab data={tabData.customers} loading={loading && !tabData.customers} />
        )}
        {activeTab === "receivables" && (
          <ReceivablesTab data={tabData.receivables} loading={loading && !tabData.receivables} />
        )}
      </div>
    </div>
  );
}
