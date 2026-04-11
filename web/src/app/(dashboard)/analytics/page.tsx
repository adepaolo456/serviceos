"use client";

import React, { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
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
  Search,
  ClipboardList,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency, formatSourceLabel } from "@/lib/utils";
import SlideOver from "@/components/slide-over";
import HelpTooltip from "@/components/ui/HelpTooltip";

/* ─── Types ─── */

interface SourceRow {
  source: string;
  amount: number;
  count: number;
  paidCount: number;
  outstanding: number;
}

interface PeriodRow {
  date: string;
  amount: number;
  count: number;
  paidCount: number;
}

type RevenueGrouping = "daily" | "weekly" | "monthly";

interface RevenueData {
  totalRevenue: number;
  totalCollected: number;
  totalOutstanding: number;
  totalOverdue: number;
  revenueBySource: Record<string, number> | SourceRow[];
  dailyRevenue: PeriodRow[];
  grouping?: RevenueGrouping;
}

interface SourceDetailInvoice {
  id: string;
  invoiceNumber: string;
  customerName: string;
  total: number;
  amountPaid: number;
  balanceDue: number;
  status: string;
  createdAt: string;
  jobId: string;
  jobNumber: string;
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

interface DumpSlipTicket {
  id: string;
  ticketNumber: string;
  submittedAt: string;
  jobId: string;
  jobNumber: string;
  customerName: string;
  dumpLocationName: string;
  wasteType: string;
  weightTons: number;
  dumpTonnageCost: number;
  fuelEnvCost: number;
  dumpSurchargeCost: number;
  totalDumpCost: number;
  customerTonnageCharge: number;
  customerSurchargeCharge: number;
  totalCustomerCharge: number;
  overageItems: Array<{ type: string; label: string; quantity: number; chargePerUnit: number; total: number }>;
  status: string;
  invoiced: boolean;
  invoiceId: string | null;
}

interface FacilitySummary {
  dumpLocationId: string;
  dumpLocationName: string;
  ticketCount: number;
  totalWeight: number;
  totalDumpCost: number;
  totalFuelEnv: number;
  totalCost: number;
  totalCustomerCharges: number;
}

interface DumpSlipsData {
  summary: {
    totalTickets: number;
    totalWeightTons: number;
    totalDumpCost: number;
    totalFuelEnvCost: number;
    totalCustomerCharges: number;
    totalMargin: number;
  };
  byFacility: FacilitySummary[];
  tickets: DumpSlipTicket[];
}

interface DumpLocationOption {
  id: string;
  name: string;
}

/* ─── Tabs ─── */

type TabKey = "revenue" | "dump-costs" | "profit" | "drivers" | "assets" | "customers" | "receivables" | "dump-slips";

const TABS: { key: TabKey; label: string; icon: typeof DollarSign }[] = [
  { key: "revenue", label: "Revenue", icon: DollarSign },
  { key: "dump-costs", label: "Dump Costs", icon: TrendingUp },
  { key: "profit", label: "Profit", icon: BarChart3 },
  { key: "drivers", label: "Drivers", icon: Truck },
  { key: "assets", label: "Assets", icon: Box },
  { key: "customers", label: "Customers", icon: Users },
  { key: "receivables", label: "Receivables", icon: FileText },
  { key: "dump-slips", label: "Dump Slips", icon: ClipboardList },
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

function safeDateStr(d: string | null | undefined): string {
  if (!d) return "—";
  const parsed = new Date(d);
  if (isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString();
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

function KPI({ label, value, sub, color, onClick }: { label: string; value: string; sub?: string; color?: string; onClick?: () => void }) {
  const cls = `rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4 ${onClick ? "cursor-pointer hover:border-[var(--t-accent)] transition-colors" : ""}`;
  return (
    <div
      className={cls}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      tabIndex={onClick ? 0 : undefined}
      role={onClick ? "button" : undefined}
    >
      <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)]">{label}</p>
      <p className={`text-[24px] font-bold mt-1 tabular-nums ${color || "text-[var(--t-text-primary)]"}`}>{value}</p>
      {sub && <p className="text-[13px] text-[var(--t-text-muted)] mt-0.5">{sub}</p>}
    </div>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-[20px] animate-pulse ${className}`} />;
}

function KPIGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">{children}</div>
  );
}

function KPISkeleton() {
  return <KPIGrid>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</KPIGrid>;
}

function TableSkeleton() {
  return <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="py-16 text-center">
      <BarChart3 className="mx-auto h-10 w-10 text-[var(--t-text-muted)] opacity-20 mb-3" />
      <p className="text-sm text-[var(--t-text-muted)]">{text}</p>
    </div>
  );
}

function DataTable({ headers, rows, onRowClick }: { headers: string[]; rows: (string | number)[][]; onRowClick?: (rowIndex: number) => void }) {
  if (!rows.length) return <EmptyState text="No data for this period" />;
  const clickable = !!onRowClick;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--t-border)]">
            {headers.map((h) => (
              <th key={h} className="text-left text-[12px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] py-3 px-3">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={`border-b border-[var(--t-border)] hover:bg-[var(--t-bg-card-hover)] transition-colors ${clickable ? "cursor-pointer" : ""}`}
              onClick={clickable ? () => onRowClick(i) : undefined}
              onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick(i); } } : undefined}
              tabIndex={clickable ? 0 : undefined}
              role={clickable ? "button" : undefined}
            >
              {row.map((cell, j) => (
                <td key={j} className="py-3 px-3 text-[var(--t-text-primary)] tabular-nums">{cell}</td>
              ))}
              {clickable && (
                <td className="py-3 px-1 text-[var(--t-text-muted)]"><ChevronRight className="h-4 w-4" /></td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Tab Content Components ─── */

function InvoiceCard({ inv, statusColor }: { inv: SourceDetailInvoice; statusColor: (s: string) => string }) {
  return (
    <a
      href={`/invoices/${inv.id}`}
      className="block rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-4 hover:border-[var(--t-accent)] transition-colors cursor-pointer"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-semibold text-[var(--t-text-primary)]">
          {inv.invoiceNumber || "—"}
        </span>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium uppercase ${statusColor(inv.status)}`}>
            {inv.status}
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-[var(--t-text-muted)]" />
        </div>
      </div>
      <p className="text-xs text-[var(--t-text-muted)]">{inv.customerName || "Unknown customer"}</p>
      {inv.jobNumber && (
        <p className="text-xs text-[var(--t-text-muted)]">Job {inv.jobNumber}</p>
      )}
      <div className="flex items-center gap-4 mt-2 text-xs tabular-nums">
        <span className="text-[var(--t-text-primary)] font-medium">{formatCurrency(inv.total)}</span>
        <span className="text-[var(--t-text-muted)]">Paid {formatCurrency(inv.amountPaid)}</span>
        {inv.balanceDue > 0 && (
          <span className="text-[var(--t-warning)]">Due {formatCurrency(inv.balanceDue)}</span>
        )}
      </div>
      <p className="text-[11px] text-[var(--t-text-muted)] mt-1">{safeDateStr(inv.createdAt)}</p>
    </a>
  );
}

function InvoiceSlideOver({
  open, onClose, title, subtitle, invoices, loading,
}: {
  open: boolean; onClose: () => void; title: string; subtitle: string;
  invoices: SourceDetailInvoice[]; loading: boolean;
}) {
  const statusColor = (s: string) => {
    if (s === "paid") return "text-[var(--t-accent)]";
    if (s === "overdue") return "text-[var(--t-error)]";
    if (s === "partial") return "text-[var(--t-warning)]";
    return "text-[var(--t-text-muted)]";
  };

  return (
    <SlideOver open={open} onClose={onClose} title={title} wide>
      <p className="text-xs text-[var(--t-text-muted)] mb-4">
        {subtitle} · {invoices.length} invoice{invoices.length !== 1 ? "s" : ""}
      </p>
      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-[var(--t-text-muted)]" /></div>
      ) : invoices.length === 0 ? (
        <EmptyState text="No invoices found" />
      ) : (
        <div className="space-y-3">
          {invoices.map((inv) => (
            <InvoiceCard key={inv.id} inv={inv} statusColor={statusColor} />
          ))}
        </div>
      )}
    </SlideOver>
  );
}

type DrillState =
  | { type: "source"; source: string }
  | { type: "daily"; date: string }
  | { type: "tile"; filter: "all" | "collected" | "outstanding" | "overdue" }
  | null;

const TILE_LABELS: Record<string, string> = {
  all: "Total Revenue",
  collected: "Collected",
  outstanding: "Outstanding",
  overdue: "Overdue",
};

function RevenueTab({ data, loading, startDate, endDate, grouping, onGroupingChange }: {
  data: RevenueData | null; loading: boolean; startDate: string; endDate: string;
  grouping: RevenueGrouping; onGroupingChange: (g: RevenueGrouping) => void;
}) {
  const [drill, setDrill] = useState<DrillState>(null);
  const [drillData, setDrillData] = useState<SourceDetailInvoice[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  const openDrill = async (next: NonNullable<DrillState>) => {
    setDrill(next);
    setDrillLoading(true);
    try {
      let res: { invoices: SourceDetailInvoice[] };
      if (next.type === "source") {
        res = await api.get(`/reporting/revenue/source-detail?source=${encodeURIComponent(next.source)}&startDate=${startDate}&endDate=${endDate}`);
      } else if (next.type === "daily") {
        res = await api.get(`/reporting/revenue/daily-detail?date=${next.date}`);
      } else {
        res = await api.get(`/reporting/revenue/invoices?filter=${next.filter}&startDate=${startDate}&endDate=${endDate}`);
      }
      setDrillData(res.invoices);
    } catch {
      setDrillData([]);
    } finally {
      setDrillLoading(false);
    }
  };

  const closeDrill = () => { setDrill(null); setDrillData([]); };

  if (loading) return <><KPISkeleton /><TableSkeleton /></>;
  if (!data) return <EmptyState text="No revenue data available" />;

  // Normalize revenueBySource: backend may return old Record or new SourceRow[]
  const sourceEntries: SourceRow[] = Array.isArray(data.revenueBySource)
    ? data.revenueBySource.map((r: any) => ({
        source: r.source, amount: Number(r.amount),
        count: Number(r.count) || 0, paidCount: Number(r.paidCount) || 0,
        outstanding: Number(r.outstanding) || 0,
      }))
    : Object.entries(data.revenueBySource || {}).map(([source, amount]) => ({
        source, amount: Number(amount), count: 0, paidCount: 0, outstanding: 0,
      }));

  const periodRows: PeriodRow[] = (data.dailyRevenue || []).map((d: any) => ({
    date: d.date, amount: Number(d.amount),
    count: Number(d.count) || 0, paidCount: Number(d.paidCount) || 0,
  }));

  const drillTitle = !drill ? "" :
    drill.type === "source" ? `${formatSourceLabel(drill.source)} — Invoices` :
    drill.type === "daily" ? `${safeDateStr(drill.date)} — Invoices` :
    `${TILE_LABELS[drill.filter]} — Invoices`;

  const drillSubtitle = !drill ? "" :
    drill.type === "daily" ? drill.date :
    `${safeDateStr(startDate)} – ${safeDateStr(endDate)}`;

  const groupingLabel = grouping === "weekly" ? "Weekly" : grouping === "monthly" ? "Monthly" : "Daily";

  const meta = (count: number, amount: number, paidCount?: number) => {
    const avg = count > 0 ? amount / count : 0;
    const parts = [`${fmtNum(count)} inv`, `avg ${formatCurrency(avg)}`];
    if (paidCount !== undefined && count > 0) {
      const unpaid = count - paidCount;
      if (unpaid > 0) parts.push(`${unpaid} open`);
    }
    return parts.join(" · ");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1.5 mb-1">
        <HelpTooltip featureId="revenue_overview" />
        <HelpTooltip featureId="revenue_collected_vs_booked" />
      </div>
      <KPIGrid>
        <KPI label="Total Revenue" value={formatCurrency(data.totalRevenue)} color="text-[var(--t-accent)]" onClick={() => openDrill({ type: "tile", filter: "all" })} />
        <KPI label="Collected" value={formatCurrency(data.totalCollected)} color="text-[var(--t-accent)]" onClick={() => openDrill({ type: "tile", filter: "collected" })} />
        <KPI label="Outstanding" value={formatCurrency(data.totalOutstanding)} color="text-[var(--t-warning)]" onClick={() => openDrill({ type: "tile", filter: "outstanding" })} />
        <KPI label="Overdue" value={formatCurrency(data.totalOverdue)} color="text-[var(--t-error)]" onClick={() => openDrill({ type: "tile", filter: "overdue" })} />
      </KPIGrid>

      {sourceEntries.length > 0 && (
        <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
          <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-4 flex items-center gap-1.5">Revenue by Source <HelpTooltip featureId="revenue_by_source" /></h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--t-border)]">
                  <th className="text-left text-[12px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] py-3 px-3">Source</th>
                  <th className="text-right text-[12px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] py-3 px-3">Amount</th>
                  <th className="text-right text-[12px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] py-3 px-3">Outstanding</th>
                  <th className="text-right text-[12px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] py-3 px-3 hidden sm:table-cell">Invoices</th>
                  <th className="py-3 px-1"></th>
                </tr>
              </thead>
              <tbody>
                {sourceEntries.map((r, i) => (
                  <tr
                    key={r.source}
                    className="border-b border-[var(--t-border)] hover:bg-[var(--t-bg-card-hover)] transition-colors cursor-pointer"
                    onClick={() => openDrill({ type: "source", source: r.source })}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrill({ type: "source", source: r.source }); } }}
                    tabIndex={0} role="button"
                  >
                    <td className="py-3 px-3">
                      <span className="text-[var(--t-text-primary)]">{formatSourceLabel(r.source)}</span>
                      <span className="block text-[11px] text-[var(--t-text-muted)] mt-0.5 sm:hidden">
                        {meta(r.count, r.amount, r.paidCount)}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums text-[var(--t-text-primary)] font-medium">{formatCurrency(r.amount)}</td>
                    <td className="py-3 px-3 text-right tabular-nums text-[var(--t-warning)]">{r.outstanding > 0 ? formatCurrency(r.outstanding) : "—"}</td>
                    <td className="py-3 px-3 text-right text-[var(--t-text-muted)] hidden sm:table-cell">
                      {meta(r.count, r.amount, r.paidCount)}
                    </td>
                    <td className="py-3 px-1 text-[var(--t-text-muted)]"><ChevronRight className="h-4 w-4" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {periodRows.length > 0 && (
        <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--t-text-primary)] flex items-center gap-1.5">{groupingLabel} Revenue <HelpTooltip featureId="revenue_period" /></h3>
            <div className="flex gap-1">
              {(["daily", "weekly", "monthly"] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => onGroupingChange(g)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    grouping === g
                      ? "bg-[var(--t-accent-soft)] text-[var(--t-accent)]"
                      : "text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)]"
                  }`}
                >
                  {g.charAt(0).toUpperCase() + g.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--t-border)]">
                  <th className="text-left text-[12px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] py-3 px-3">Period</th>
                  <th className="text-right text-[12px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] py-3 px-3">Amount</th>
                  <th className="text-right text-[12px] font-semibold uppercase tracking-wide text-[var(--t-text-muted)] py-3 px-3 hidden sm:table-cell">Invoices</th>
                  <th className="py-3 px-1"></th>
                </tr>
              </thead>
              <tbody>
                {periodRows.map((d, i) => (
                  <tr
                    key={d.date ?? i}
                    className="border-b border-[var(--t-border)] hover:bg-[var(--t-bg-card-hover)] transition-colors cursor-pointer"
                    onClick={() => { if (d.date) openDrill({ type: "daily", date: d.date }); }}
                    onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && d.date) { e.preventDefault(); openDrill({ type: "daily", date: d.date }); } }}
                    tabIndex={0} role="button"
                  >
                    <td className="py-3 px-3">
                      <span className="text-[var(--t-text-primary)]">{safeDateStr(d.date)}</span>
                      <span className="block text-[11px] text-[var(--t-text-muted)] mt-0.5 sm:hidden">
                        {meta(d.count, d.amount, d.paidCount)}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums text-[var(--t-text-primary)] font-medium">{formatCurrency(d.amount)}</td>
                    <td className="py-3 px-3 text-right text-[var(--t-text-muted)] hidden sm:table-cell">
                      {meta(d.count, d.amount, d.paidCount)}
                    </td>
                    <td className="py-3 px-1 text-[var(--t-text-muted)]"><ChevronRight className="h-4 w-4" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <InvoiceSlideOver
        open={drill !== null}
        onClose={closeDrill}
        title={drillTitle}
        subtitle={drillSubtitle}
        invoices={drillData}
        loading={drillLoading}
      />
    </div>
  );
}

function DumpCostsTab({ data, loading }: { data: DumpCostsData | null; loading: boolean }) {
  if (loading) return <><KPISkeleton /><TableSkeleton /></>;
  if (!data) return <EmptyState text="No dump cost data available" />;
  return (
    <div className="space-y-6">
      <KPIGrid>
        <KPI label="Dump Costs" value={formatCurrency(data.totalDumpCosts)} color="text-[var(--t-error)]" />
        <KPI label="Customer Charges" value={formatCurrency(data.totalCustomerCharges)} />
        <KPI label="Margin" value={formatCurrency(data.margin)} color="text-[var(--t-accent)]" />
        <KPI label="Margin %" value={fmtPct(data.marginPercent)} color="text-[var(--t-accent)]" />
      </KPIGrid>
      {data.costsByFacility?.length > 0 && (
        <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
          <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-4">Costs by Facility</h3>
          <DataTable headers={["Facility", "Loads", "Cost"]} rows={data.costsByFacility.map((r) => [r.facility, fmtNum(r.loads), formatCurrency(r.cost)])} />
        </div>
      )}
      {data.costsByWasteType?.length > 0 && (
        <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
          <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-4">Costs by Waste Type</h3>
          <DataTable headers={["Waste Type", "Loads", "Cost"]} rows={data.costsByWasteType.map((r) => [r.wasteType, fmtNum(r.loads), formatCurrency(r.cost)])} />
        </div>
      )}
    </div>
  );
}

function ProfitTab({ data, loading }: { data: ProfitData | null; loading: boolean }) {
  if (loading) return <KPISkeleton />;
  if (!data) return <EmptyState text="No profit data available" />;
  return (
    <KPIGrid>
      <KPI label="Revenue" value={formatCurrency(data.revenue)} />
      <KPI label="Dump Costs" value={formatCurrency(data.dumpCosts)} color="text-[var(--t-error)]" />
      <KPI label="Gross Profit" value={formatCurrency(data.grossProfit)} color="text-[var(--t-accent)]" />
      <KPI label="Margin %" value={fmtPct(data.marginPercent)} color="text-[var(--t-accent)]" />
    </KPIGrid>
  );
}

function DriversTab({ data, loading }: { data: DriversData | null; loading: boolean }) {
  if (loading) return <><KPISkeleton /><TableSkeleton /></>;
  if (!data) return <EmptyState text="No driver data available" />;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-6">
        <KPI label="Total Drivers" value={fmtNum(data.totalDrivers)} />
        <KPI label="Total Completed" value={fmtNum(data.totalCompleted)} color="text-[var(--t-accent)]" />
      </div>
      {data.drivers?.length > 0 && (
        <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
          <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-4">Driver Stats</h3>
          <DataTable headers={["Name", "Jobs", "Completed", "Failed", "Deliveries", "Pickups"]} rows={data.drivers.map((d) => [d.name, fmtNum(d.totalJobs), fmtNum(d.completed), fmtNum(d.failed), fmtNum(d.deliveries), fmtNum(d.pickups)])} />
        </div>
      )}
    </div>
  );
}

function AssetsTab({ data, loading }: { data: AssetsData | null; loading: boolean }) {
  if (loading) return <><KPISkeleton /><TableSkeleton /></>;
  if (!data) return <EmptyState text="No asset data available" />;
  return (
    <div className="space-y-6">
      <KPIGrid>
        <KPI label="Total" value={fmtNum(data.total)} />
        <KPI label="Available" value={fmtNum(data.available)} color="text-[var(--t-accent)]" />
        <KPI label="Deployed" value={fmtNum(data.deployed)} />
        <KPI label="Staged" value={fmtNum(data.staged)} color="text-[var(--t-warning)]" />
      </KPIGrid>
      {data.bySize?.length > 0 && (
        <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
          <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-4">Assets by Size</h3>
          <DataTable headers={["Size", "Total", "Available", "Deployed", "Staged"]} rows={data.bySize.map((r) => [r.size, fmtNum(r.total), fmtNum(r.available), fmtNum(r.deployed), fmtNum(r.staged)])} />
        </div>
      )}
    </div>
  );
}

function CustomersTab({ data, loading }: { data: CustomersData | null; loading: boolean }) {
  if (loading) return <><KPISkeleton /><TableSkeleton /></>;
  if (!data) return <EmptyState text="No customer data available" />;
  return (
    <div className="space-y-6">
      <KPIGrid>
        <KPI label="Total Customers" value={fmtNum(data.total)} />
        <KPI label="New Customers" value={fmtNum(data.newCustomers)} color="text-[var(--t-accent)]" />
        {data.byType?.slice(0, 2).map((t) => (
          <KPI key={t.type} label={t.type} value={fmtNum(t.count)} />
        ))}
      </KPIGrid>
      {data.topCustomers?.length > 0 && (
        <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
          <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-4">Top Customers</h3>
          <DataTable headers={["Name", "Type", "Jobs", "Total Spend"]} rows={data.topCustomers.map((c) => [c.name, c.type, fmtNum(c.jobCount), formatCurrency(c.totalSpend)])} />
        </div>
      )}
    </div>
  );
}

function ReceivablesTab({ data, loading }: { data: ReceivablesData | null; loading: boolean }) {
  if (loading) return <><KPISkeleton /><TableSkeleton /></>;
  if (!data) return <EmptyState text="No receivables data available" />;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-6">
        <KPI label="Outstanding" value={formatCurrency(data.totalOutstanding)} color="text-[var(--t-warning)]" />
        <KPI label="Overdue" value={formatCurrency(data.totalOverdue)} color="text-[var(--t-error)]" />
      </div>
      {data.aging?.length > 0 && (
        <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
          <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-4">Aging Summary</h3>
          <DataTable headers={["Bucket", "Invoices", "Amount"]} rows={data.aging.map((a) => [a.label, fmtNum(a.count), formatCurrency(a.amount)])} />
        </div>
      )}
      {data.overdueInvoices?.length > 0 && (
        <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-5">
          <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-4">Overdue Invoices</h3>
          <DataTable headers={["Customer", "Amount", "Due Date", "Days Overdue"]} rows={data.overdueInvoices.map((inv) => [inv.customer, formatCurrency(inv.amount), inv.dueDate, fmtNum(inv.daysOverdue)])} />
        </div>
      )}
    </div>
  );
}

/* ─── Dump Slips Tab ─── */

const WASTE_LABELS: Record<string, string> = { dtm: "DTM", cnd: "C&D", msw: "MSW", shingles: "Shingles" };
const SLIP_STATUS_FILTERS = ["all", "submitted", "reviewed", "invoiced"] as const;

function DumpSlipsTab({
  data,
  loading,
  startDate,
  endDate,
  onRefetch,
}: {
  data: DumpSlipsData | null;
  loading: boolean;
  startDate: string;
  endDate: string;
  onRefetch: (params: { search?: string; dumpLocationId?: string; status?: string }) => void;
}) {
  const [search, setSearch] = useState("");
  const [dumpLocationId, setDumpLocationId] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [locations, setLocations] = useState<DumpLocationOption[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reconOpen, setReconOpen] = useState(true);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(null);

  // Load dump location options
  useEffect(() => {
    api.get<Array<{ id: string; name: string }>>("/dump-locations")
      .then((locs) => setLocations(locs.map((l) => ({ id: l.id, name: l.name }))))
      .catch(() => {});
  }, []);

  // Debounced search
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      onRefetch({ search: search || undefined, dumpLocationId: dumpLocationId || undefined, status: statusFilter === "all" ? undefined : statusFilter });
    }, 400);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [search, dumpLocationId, statusFilter]);

  const handleExportSlips = () => {
    if (!data?.tickets?.length) return;
    const rows = data.tickets.map((t) => ({
      date: t.submittedAt ? new Date(t.submittedAt).toLocaleDateString() : "",
      ticketNumber: t.ticketNumber,
      jobNumber: t.jobNumber,
      customer: t.customerName,
      dumpLocation: t.dumpLocationName,
      wasteType: WASTE_LABELS[t.wasteType] || t.wasteType,
      weightTons: t.weightTons,
      dumpTonnageCost: t.dumpTonnageCost,
      fuelEnvCost: t.fuelEnvCost,
      dumpSurchargeCost: t.dumpSurchargeCost,
      totalDumpCost: t.totalDumpCost,
      customerTonnageCharge: t.customerTonnageCharge,
      customerSurchargeCharge: t.customerSurchargeCharge,
      totalCustomerCharge: t.totalCustomerCharge,
      status: t.status,
      invoiced: t.invoiced ? "Yes" : "No",
    }));
    downloadCSV(rows, `dump-slips-${startDate}-to-${endDate}.csv`);
  };

  if (loading && !data) return <><KPISkeleton /><TableSkeleton /></>;

  return (
    <div className="space-y-5">
      {/* Search + Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "var(--t-text-tertiary)" }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ticket number, customer name..."
            className="w-full rounded-full border px-10 py-2 text-[15px] outline-none transition-colors"
            style={{
              backgroundColor: "var(--t-bg-card)",
              borderColor: "var(--t-border)",
              color: "var(--t-text-primary)",
            }}
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Location dropdown */}
          <select
            value={dumpLocationId}
            onChange={(e) => setDumpLocationId(e.target.value)}
            className="rounded-full border px-3 py-2 text-xs font-medium outline-none appearance-none cursor-pointer"
            style={{ backgroundColor: "var(--t-bg-card)", borderColor: "var(--t-border)", color: "var(--t-text-primary)" }}
          >
            <option value="">All Locations</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          {/* Status pills */}
          <div className="flex gap-1">
            {SLIP_STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  statusFilter === s
                    ? "bg-[var(--t-accent-soft)] text-[var(--t-accent)]"
                    : "text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)]"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          {/* Export */}
          <button
            onClick={handleExportSlips}
            disabled={!data?.tickets?.length}
            className="flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-medium transition-colors disabled:opacity-40"
            style={{ borderColor: "var(--t-border)", color: "var(--t-text-muted)" }}
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {/* KPIs */}
      {data && (
        <KPIGrid>
          <KPI label="Total Tickets" value={fmtNum(data.summary.totalTickets)} />
          <KPI label="Total Weight" value={`${data.summary.totalWeightTons.toFixed(2)} tons`} />
          <KPI label="Our Cost" value={formatCurrency(data.summary.totalDumpCost)} color="text-[var(--t-error)]" sub={`incl. ${formatCurrency(data.summary.totalFuelEnvCost)} fuel/env`} />
          <KPI label="Customer Charged" value={formatCurrency(data.summary.totalCustomerCharges)} color="text-[var(--t-accent)]" />
        </KPIGrid>
      )}

      {/* Reconciliation by Facility */}
      {data && data.byFacility.length > 0 && (
        <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)]">
          <button
            onClick={() => setReconOpen(!reconOpen)}
            className="flex items-center justify-between w-full px-5 py-4 text-left"
          >
            <span className="text-[11px] font-extrabold uppercase tracking-[1.2px]" style={{ color: "var(--t-text-tertiary)" }}>
              Reconciliation by Facility
            </span>
            {reconOpen ? <ChevronDown className="h-4 w-4" style={{ color: "var(--t-text-tertiary)" }} /> : <ChevronRight className="h-4 w-4" style={{ color: "var(--t-text-tertiary)" }} />}
          </button>
          {reconOpen && (
            <div className="overflow-x-auto pb-3">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--t-border)" }}>
                    {["Facility", "Tickets", "Weight", "Dump Cost", "Fuel/Env", "Total Cost", "Customer Charged"].map((h) => (
                      <th key={h} className="text-left py-2.5 px-5 text-[11px] font-extrabold uppercase tracking-[1.2px]" style={{ color: "var(--t-text-tertiary)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.byFacility.map((f) => (
                    <tr key={f.dumpLocationId} className="transition-colors hover:bg-[var(--t-bg-card-hover)]" style={{ borderBottom: "1px solid var(--t-border-subtle, var(--t-border))" }}>
                      <td className="py-3 px-5 font-medium" style={{ color: "var(--t-text-primary)" }}>{f.dumpLocationName}</td>
                      <td className="py-3 px-5 tabular-nums" style={{ color: "var(--t-text-secondary)" }}>{f.ticketCount}</td>
                      <td className="py-3 px-5 tabular-nums" style={{ color: "var(--t-text-secondary)" }}>{f.totalWeight.toFixed(2)}t</td>
                      <td className="py-3 px-5 tabular-nums" style={{ color: "var(--t-text-secondary)" }}>{formatCurrency(f.totalDumpCost)}</td>
                      <td className="py-3 px-5 tabular-nums" style={{ color: "var(--t-text-secondary)" }}>{formatCurrency(f.totalFuelEnv)}</td>
                      <td className="py-3 px-5 tabular-nums font-semibold" style={{ color: "var(--t-text-primary)" }}>{formatCurrency(f.totalCost)}</td>
                      <td className="py-3 px-5 tabular-nums" style={{ color: "var(--t-accent)" }}>{formatCurrency(f.totalCustomerCharges)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Ticket Table */}
      {data && (
        <div className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--t-border)" }}>
                  {["Date", "Ticket #", "Job #", "Customer", "Location", "Type", "Weight", "Our Cost", "Cust. Charge", "Items", "Status"].map((h) => (
                    <th key={h} className="text-left py-3 px-4 text-[11px] font-extrabold uppercase tracking-[1.2px]" style={{ color: "var(--t-text-tertiary)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.tickets.length === 0 ? (
                  <tr><td colSpan={11} className="py-16 text-center text-sm" style={{ color: "var(--t-text-muted)" }}>No dump slips found for this period</td></tr>
                ) : data.tickets.map((t) => {
                  const isExpanded = expandedId === t.id;
                  const itemCount = t.overageItems?.length || 0;
                  const itemSummary = t.overageItems?.map((i) => `${i.quantity}x ${i.label}`).join(", ") || "";
                  return (
                    <React.Fragment key={t.id}>
                      <tr
                        onClick={() => setExpandedId(isExpanded ? null : t.id)}
                        className="cursor-pointer transition-colors hover:bg-[var(--t-bg-card-hover)]"
                        style={{ borderBottom: isExpanded ? "none" : "1px solid var(--t-border-subtle, var(--t-border))" }}
                      >
                        <td className="py-3 px-4 tabular-nums" style={{ color: "var(--t-text-secondary)" }}>{safeDateStr(t.submittedAt)}</td>
                        <td className="py-3 px-4 font-medium" style={{ color: "var(--t-text-primary)" }}>{t.ticketNumber || "—"}</td>
                        <td className="py-3 px-4" style={{ color: "var(--t-text-secondary)" }}>{t.jobNumber || "—"}</td>
                        <td className="py-3 px-4" style={{ color: "var(--t-text-primary)" }}>{t.customerName}</td>
                        <td className="py-3 px-4" style={{ color: "var(--t-text-secondary)" }}>{t.dumpLocationName}</td>
                        <td className="py-3 px-4 text-xs" style={{ color: "var(--t-text-secondary)" }}>{WASTE_LABELS[t.wasteType] || t.wasteType}</td>
                        <td className="py-3 px-4 tabular-nums" style={{ color: "var(--t-text-primary)" }}>{t.weightTons.toFixed(2)}</td>
                        <td className="py-3 px-4 tabular-nums" style={{ color: "var(--t-text-secondary)" }}>{formatCurrency(t.totalDumpCost)}</td>
                        <td className="py-3 px-4 tabular-nums font-semibold" style={{ color: t.totalCustomerCharge > 0 ? "var(--t-text-primary)" : "var(--t-text-tertiary)" }}>{t.totalCustomerCharge > 0 ? formatCurrency(t.totalCustomerCharge) : "$0"}</td>
                        <td className="py-3 px-4 text-xs" style={{ color: "var(--t-text-secondary)" }} title={itemSummary}>{itemCount > 0 ? `${itemCount} item${itemCount > 1 ? "s" : ""}` : "—"}</td>
                        <td className="py-3 px-4">
                          <span className="text-[11px] font-semibold" style={{
                            color: t.invoiced ? "#60A5FA" : t.status === "reviewed" ? "var(--t-accent)" : "var(--t-warning)",
                          }}>
                            {t.invoiced ? "Invoiced" : t.status === "reviewed" ? "Reviewed" : "Submitted"}
                          </span>
                        </td>
                      </tr>
                      {/* Expanded detail */}
                      {isExpanded && (
                        <tr style={{ borderBottom: "1px solid var(--t-border)" }}>
                          <td colSpan={11} className="px-4 py-4" style={{ backgroundColor: "var(--t-bg-primary)" }}>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm mb-3">
                              <div>
                                <p className="text-[11px] uppercase font-bold tracking-wide" style={{ color: "var(--t-text-tertiary)" }}>Dump Tonnage</p>
                                <p className="tabular-nums" style={{ color: "var(--t-text-primary)" }}>{formatCurrency(t.dumpTonnageCost)}</p>
                              </div>
                              <div>
                                <p className="text-[11px] uppercase font-bold tracking-wide" style={{ color: "var(--t-text-tertiary)" }}>Fuel/Env Fee</p>
                                <p className="tabular-nums" style={{ color: "var(--t-text-primary)" }}>{formatCurrency(t.fuelEnvCost)}</p>
                              </div>
                              <div>
                                <p className="text-[11px] uppercase font-bold tracking-wide" style={{ color: "var(--t-text-tertiary)" }}>Dump Surcharges</p>
                                <p className="tabular-nums" style={{ color: "var(--t-text-primary)" }}>{formatCurrency(t.dumpSurchargeCost)}</p>
                              </div>
                              <div>
                                <p className="text-[11px] uppercase font-bold tracking-wide" style={{ color: "var(--t-text-tertiary)" }}>Total Dump Cost</p>
                                <p className="tabular-nums font-semibold" style={{ color: "var(--t-error)" }}>{formatCurrency(t.totalDumpCost)}</p>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm mb-3">
                              <div>
                                <p className="text-[11px] uppercase font-bold tracking-wide" style={{ color: "var(--t-text-tertiary)" }}>Cust. Tonnage</p>
                                <p className="tabular-nums" style={{ color: "var(--t-text-primary)" }}>{formatCurrency(t.customerTonnageCharge)}</p>
                              </div>
                              <div>
                                <p className="text-[11px] uppercase font-bold tracking-wide" style={{ color: "var(--t-text-tertiary)" }}>Cust. Surcharges</p>
                                <p className="tabular-nums" style={{ color: "var(--t-text-primary)" }}>{formatCurrency(t.customerSurchargeCharge)}</p>
                              </div>
                              <div>
                                <p className="text-[11px] uppercase font-bold tracking-wide" style={{ color: "var(--t-text-tertiary)" }}>Total Cust. Charge</p>
                                <p className="tabular-nums font-semibold" style={{ color: "var(--t-accent)" }}>{formatCurrency(t.totalCustomerCharge)}</p>
                              </div>
                              <div>
                                <p className="text-[11px] uppercase font-bold tracking-wide" style={{ color: "var(--t-text-tertiary)" }}>Margin</p>
                                <p className="tabular-nums font-semibold" style={{ color: t.totalCustomerCharge - t.totalDumpCost >= 0 ? "var(--t-accent)" : "var(--t-error)" }}>
                                  {formatCurrency(t.totalCustomerCharge - t.totalDumpCost)}
                                </p>
                              </div>
                            </div>
                            {t.overageItems && t.overageItems.length > 0 && (
                              <div className="mb-3">
                                <p className="text-[11px] uppercase font-bold tracking-wide mb-2" style={{ color: "var(--t-text-tertiary)" }}>Surcharge Items</p>
                                <div className="flex flex-wrap gap-2">
                                  {t.overageItems.map((item, idx) => (
                                    <span key={idx} className="text-xs px-2.5 py-1 rounded-full" style={{ backgroundColor: "var(--t-bg-card)", border: "1px solid var(--t-border)", color: "var(--t-text-secondary)" }}>
                                      {item.quantity}x {item.label} @ ${item.chargePerUnit}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            <div className="flex items-center gap-3">
                              {t.jobId && (
                                <a href={`/jobs/${t.jobId}`} className="inline-flex items-center gap-1 text-xs font-medium rounded-full px-3 py-1.5 transition-colors" style={{ color: "var(--t-accent)", backgroundColor: "var(--t-accent-soft)" }}>
                                  <ExternalLink className="h-3 w-3" /> View Job
                                </a>
                              )}
                              {t.invoiceId && (
                                <a href={`/invoices/${t.invoiceId}`} className="inline-flex items-center gap-1 text-xs font-medium rounded-full px-3 py-1.5 transition-colors" style={{ color: "#60A5FA", backgroundColor: "rgba(96,165,250,0.1)" }}>
                                  <ExternalLink className="h-3 w-3" /> View Invoice
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main Page ─── */

export default function AnalyticsPage() {
  return <Suspense fallback={null}><AnalyticsPageContent /></Suspense>;
}

function AnalyticsPageContent() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const initialTab: TabKey = tabParam && ["revenue", "dump-costs", "profit", "drivers", "assets", "customers", "receivables", "dump-slips"].includes(tabParam) ? tabParam as TabKey : "revenue";

  const now = new Date();
  const [startDate, setStartDate] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0]
  );
  const [endDate, setEndDate] = useState(now.toISOString().split("T")[0]);
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [loading, setLoading] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tabData, setTabData] = useState<Record<TabKey, any>>({
    revenue: null, "dump-costs": null, profit: null, drivers: null, assets: null, customers: null, receivables: null, "dump-slips": null,
  });

  const [revenueGrouping, setRevenueGrouping] = useState<RevenueGrouping>("daily");
  const [dumpSlipParams, setDumpSlipParams] = useState<{ search?: string; dumpLocationId?: string; status?: string }>({});

  const setPreset = (preset: "week" | "month" | "quarter" | "year") => {
    const today = new Date();
    let start: Date;
    if (preset === "week") {
      const day = today.getDay();
      const diff = day === 0 ? 6 : day - 1; // Monday
      start = new Date(today);
      start.setDate(today.getDate() - diff);
    } else if (preset === "month") {
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
          case "revenue": result = await api.get<RevenueData>(`/reporting/revenue?${qs}&grouping=${revenueGrouping}`); break;
          case "dump-costs": result = await api.get<DumpCostsData>(`/reporting/dump-costs?${qs}`); break;
          case "profit": result = await api.get<ProfitData>(`/reporting/profit?${qs}`); break;
          case "drivers": result = await api.get<DriversData>(`/reporting/drivers?${qs}`); break;
          case "assets": result = await api.get<AssetsData>("/reporting/assets"); break;
          case "customers": result = await api.get<CustomersData>(`/reporting/customers?${qs}`); break;
          case "receivables": result = await api.get<ReceivablesData>("/reporting/accounts-receivable"); break;
          case "dump-slips": {
            const slipParams = new URLSearchParams({ startDate, endDate });
            if (dumpSlipParams.search) slipParams.set("search", dumpSlipParams.search);
            if (dumpSlipParams.dumpLocationId) slipParams.set("dumpLocationId", dumpSlipParams.dumpLocationId);
            if (dumpSlipParams.status) slipParams.set("status", dumpSlipParams.status);
            result = await api.get<DumpSlipsData>(`/reporting/dump-slips?${slipParams}`);
            break;
          }
        }
        setTabData((prev) => ({ ...prev, [tab]: result }));
      } catch (err) {
        console.error(`Failed to fetch ${tab}:`, err);
      } finally {
        setLoading(false);
      }
    },
    [startDate, endDate, revenueGrouping, dumpSlipParams]
  );

  useEffect(() => {
    // When switching to dump-slips, default to this week if currently on a month range
    if (activeTab === "dump-slips" && presetActive("month")) {
      setPreset("week");
      return; // setPreset will trigger re-render and fetchTab
    }
    fetchTab(activeTab);
  }, [activeTab, fetchTab]);

  const handleExport = () => {
    const data = tabData[activeTab];
    if (!data) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rows: Record<string, any>[] = [];
    switch (activeTab) {
      case "revenue": rows = data.revenueBySource || data.revenueBySize || []; break;
      case "dump-costs": rows = data.costsByFacility || data.costsByWasteType || []; break;
      case "profit": rows = [{ revenue: data.revenue, dumpCosts: data.dumpCosts, grossProfit: data.grossProfit, marginPercent: data.marginPercent }]; break;
      case "drivers": rows = data.drivers || []; break;
      case "assets": rows = data.bySize || []; break;
      case "customers": rows = data.topCustomers || []; break;
      case "receivables": rows = data.overdueInvoices || data.aging || []; break;
      case "dump-slips": rows = data.tickets || []; break;
    }
    downloadCSV(rows, `${activeTab}-report-${startDate}-to-${endDate}.csv`);
  };

  const presetActive = (preset: string) => {
    const today = new Date();
    let expectedStart: Date;
    if (preset === "week") {
      const day = today.getDay();
      const diff = day === 0 ? 6 : day - 1;
      expectedStart = new Date(today);
      expectedStart.setDate(today.getDate() - diff);
    } else if (preset === "month") expectedStart = new Date(today.getFullYear(), today.getMonth(), 1);
    else if (preset === "quarter") { const q = Math.floor(today.getMonth() / 3) * 3; expectedStart = new Date(today.getFullYear(), q, 1); }
    else expectedStart = new Date(today.getFullYear(), 0, 1);
    return startDate === expectedStart.toISOString().split("T")[0] && endDate === today.toISOString().split("T")[0];
  };

  return (
    <div>
      {/* Top Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
        <h1 className="text-[28px] font-bold tracking-[-1px] text-[var(--t-frame-text)]">Reports</h1>
        <div className="flex flex-wrap items-center gap-3">
          {/* Preset pills */}
          <div className="flex gap-1">
            {(activeTab === "dump-slips" ? ["week", "month", "quarter", "year"] as const : ["month", "quarter", "year"] as const).map((p) => (
              <button key={p} onClick={() => setPreset(p)}
                className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                  presetActive(p)
                    ? "bg-[var(--t-accent-soft)] text-[var(--t-accent)]"
                    : "text-[var(--t-frame-text-muted)] hover:text-[var(--t-frame-text)]"
                }`}>
                This {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>

          {/* Date inputs */}
          <div className="flex items-center gap-2">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="rounded-[20px] border border-[var(--t-frame-border)] bg-[var(--t-frame-hover)] px-2.5 py-1.5 text-xs text-[var(--t-frame-text)] focus:outline-none focus:border-[var(--t-accent)]" />
            <span className="text-xs text-[var(--t-frame-text-muted)]">to</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="rounded-[20px] border border-[var(--t-frame-border)] bg-[var(--t-frame-hover)] px-2.5 py-1.5 text-xs text-[var(--t-frame-text)] focus:outline-none focus:border-[var(--t-accent)]" />
          </div>

          {/* Export */}
          <button onClick={handleExport} disabled={!tabData[activeTab]}
            className="flex items-center gap-1.5 rounded-full border border-[var(--t-frame-border)] px-4 py-1.5 text-xs font-medium text-[var(--t-frame-text-muted)] hover:text-[var(--t-frame-text)] hover:border-[var(--t-frame-text-muted)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {/* Tab Row */}
      <div className="flex overflow-x-auto gap-1 mb-6 pb-1 -mx-1 px-1 scrollbar-hide">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-xs font-medium transition-all shrink-0 ${
                isActive
                  ? "bg-[var(--t-accent-soft)] text-[var(--t-accent)]"
                  : "text-[var(--t-frame-text-muted)] hover:text-[var(--t-frame-text)]"
              }`}>
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {loading && isActive && <Loader2 className="h-3 w-3 animate-spin ml-1" />}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === "revenue" && <RevenueTab data={tabData.revenue} loading={loading && !tabData.revenue} startDate={startDate} endDate={endDate} grouping={revenueGrouping} onGroupingChange={setRevenueGrouping} />}
        {activeTab === "dump-costs" && <DumpCostsTab data={tabData["dump-costs"]} loading={loading && !tabData["dump-costs"]} />}
        {activeTab === "profit" && <ProfitTab data={tabData.profit} loading={loading && !tabData.profit} />}
        {activeTab === "drivers" && <DriversTab data={tabData.drivers} loading={loading && !tabData.drivers} />}
        {activeTab === "assets" && <AssetsTab data={tabData.assets} loading={loading && !tabData.assets} />}
        {activeTab === "customers" && <CustomersTab data={tabData.customers} loading={loading && !tabData.customers} />}
        {activeTab === "receivables" && <ReceivablesTab data={tabData.receivables} loading={loading && !tabData.receivables} />}
        {activeTab === "dump-slips" && (
          <DumpSlipsTab
            data={tabData["dump-slips"]}
            loading={loading && !tabData["dump-slips"]}
            startDate={startDate}
            endDate={endDate}
            onRefetch={(params) => { setDumpSlipParams(params); }}
          />
        )}
      </div>
    </div>
  );
}
