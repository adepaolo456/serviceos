"use client";

import { useState, useEffect, use, useCallback, type FormEvent, Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useBooking } from "@/components/booking-provider";
import {
  ArrowLeft, Mail, Phone, MapPin, Building, Calendar, Pencil, Trash2,
  Briefcase, FileText, FileCheck, DollarSign, Clock, Plus, MessageSquare,
  CreditCard, Send, Tag, Settings, User, ChevronRight, ChevronDown, ArrowRight,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast";
import { deriveDisplayStatus, DISPLAY_STATUS_LABELS, displayStatusColor, formatJobNumber } from "@/lib/job-status";
import SlideOver from "@/components/slide-over";
import AddressAutocomplete, { type AddressValue } from "@/components/address-autocomplete";
import MapboxMap from "@/components/mapbox-map";
import { CUSTOMER_DASHBOARD_LABELS } from "@/lib/customer-dashboard-labels";
import { navigateBack } from "@/lib/navigation";
import { CustomerCreditPanel } from "@/components/customer-credit-panel";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import { resolveRepresentativeJobId } from "@/lib/lifecycle-job-resolver";

/* ---- Types ---- */

interface Customer {
  id: string; type: string; first_name: string; last_name: string;
  email: string; phone: string; company_name: string; account_id: string;
  billing_address: Record<string, string> | null;
  service_addresses: Record<string, string>[];
  notes: string; tags: string[]; lead_source: string;
  customer_preferences: Record<string, unknown>;
  total_jobs: number; lifetime_revenue: number; is_active: boolean; created_at: string;
}

interface Job {
  id: string; job_number: string; job_type: string; service_type: string;
  status: string; scheduled_date: string; total_price: number;
  // Live driver assignment — required for the driver-aware
  // `deriveDisplayStatus` object form so the customer detail Jobs
  // table never shows a stale "Assigned" chip after the driver is
  // unassigned from dispatch.
  assigned_driver_id?: string | null;
  asset: { id: string; identifier: string } | null;
  created_at: string;
}

interface Invoice {
  id: string; invoice_number: number; status: string; total: number;
  balance_due: number; due_date: string; created_at: string;
}

interface Note {
  id: string; content: string; type: string; author_name: string; created_at: string;
}

// Minimal rental-chain shape for the Jobs tab grouping. This mirrors
// the same `/rental-chains?customerId=...` response the main Jobs
// (Rental Lifecycles) page consumes so the two surfaces can share a
// mental model and future shared component extraction is trivial.
interface CustomerChainLink {
  job_id: string;
  sequence_number: number;
  task_type: string;
  status: string;
  scheduled_date: string;
  // `assigned_driver_id` is carried on the nested job shape so the
  // child chain row's Assigned chip can use the driver-aware
  // `deriveDisplayStatus` object form without needing a full job
  // refetch. Backend already returns it on the rental-chain link.
  job: { id: string; job_number: string; status: string; asset_subtype?: string; assigned_driver_id?: string | null } | null;
}
interface CustomerChain {
  id: string;
  status: string;
  dumpster_size: string;
  drop_off_date: string;
  expected_pickup_date: string | null;
  links: CustomerChainLink[];
}

/* ---- Helpers ---- */

import { formatPhone, formatCurrency } from "@/lib/utils";

const fmtPhone = formatPhone;
const fmtMoney = (n: number) => formatCurrency(n);
const fmtMoneyShort = (n: number) => formatCurrency(n);

function timeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

const STATUS_CLS: Record<string, string> = {
  pending: "text-yellow-500", confirmed: "text-blue-400",
  dispatched: "text-purple-400", en_route: "text-orange-400",
  in_progress: "text-[var(--t-accent)]", completed: "text-emerald-400",
  cancelled: "text-[var(--t-error)]", draft: "text-[var(--t-text-muted)]",
  sent: "text-blue-400", paid: "text-[var(--t-accent)]",
  overdue: "text-[var(--t-error)]", void: "text-[var(--t-text-muted)]",
};

const TABS = [
  { key: "overview", label: "Overview", icon: User },
  { key: "billing", label: "Billing", icon: CreditCard },
  { key: "jobs", label: "Jobs", icon: Briefcase },
  { key: "quotes", label: "Quotes", icon: FileCheck },
  { key: "invoices", label: "Invoices", icon: FileText },
  { key: "pricing", label: "Pricing", icon: DollarSign },
  { key: "notes", label: "Notes", icon: MessageSquare },
  { key: "settings", label: "Settings", icon: Settings },
] as const;

type Tab = typeof TABS[number]["key"];

/**
 * Overview-tab interactive tile keys — drives the shared historical
 * metrics drill-down panel. "active" used to be a tile here but it was
 * promoted to an always-visible top-of-page card so operators no
 * longer have to click a tile to see the customer's current state.
 */
type OverviewTile = "jobs" | "revenue" | "avgValue" | "lastJob";

/* ---- Page ---- */

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { openWizard } = useBooking();
  const { toast } = useToast();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [chains, setChains] = useState<CustomerChain[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [customerQuotes, setCustomerQuotes] = useState<Array<{ id: string; quote_number: string; asset_subtype: string; total_quoted: number; derived_status: string; created_at: string; customer_name: string | null }>>([]);
  const [creditMemos, setCreditMemos] = useState<{ id: string; amount: number; reason: string; status: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedTile, setSelectedTile] = useState<OverviewTile | null>(null);
  // Expanded rental chains inside the Jobs tab. Collapsed by default;
  // expanding a chain reveals its delivery / exchange / pickup child
  // rows inline. Matches the pattern on the main Rental Lifecycles
  // page so operators get the same interaction on both surfaces.
  const [expandedChains, setExpandedChains] = useState<Set<string>>(new Set());
  const toggleChain = useCallback((chainId: string) => {
    setExpandedChains((prev) => {
      const next = new Set(prev);
      if (next.has(chainId)) next.delete(chainId);
      else next.add(chainId);
      return next;
    });
  }, []);
  const [editOpen, setEditOpen] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [c, j, i, n] = await Promise.all([
          api.get<Customer>(`/customers/${id}`),
          api.get<{ data: Job[] }>(`/jobs?customerId=${id}&limit=100`),
          api.get<{ data: Invoice[] }>(`/invoices?customerId=${id}&limit=100`),
          api.get<Note[]>(`/customers/${id}/notes`).catch(() => []),
        ]);
        setCustomer(c); setJobs(j.data); setInvoices(i.data); setNotes(n);
        api.get<{ data: any[] }>(`/quotes?customerId=${id}&limit=50`)
          .then((r) => setCustomerQuotes(r.data || []))
          .catch(() => setCustomerQuotes([]));
        api.get<{ id: string; amount: number; reason: string; status: string }[]>(`/invoices/credit-memos/by-customer/${id}`)
          .then(setCreditMemos).catch(() => setCreditMemos([]));
        // Rental chains for the Jobs tab grouping. Uses the
        // customerId filter that `rental-chains.controller.ts`
        // already supports, so the response only contains this
        // customer's chains (not all tenant chains).
        api.get<CustomerChain[]>(`/rental-chains?customerId=${id}`)
          .then((r) => setChains(Array.isArray(r) ? r : []))
          .catch(() => setChains([]));
      } catch { /* */ }
      finally { setLoading(false); }
    }
    load();
  }, [id]);

  // Default the historical-metrics drill-down to "jobs" on first load.
  // Pre-refactor this defaulted to "active" so the user would land
  // looking at active rentals — but active rentals are now their own
  // always-visible card at the top of the Overview tab, so the tiles
  // no longer need to surface them. Users still manually click any
  // tile to change the drill-down focus.
  useEffect(() => {
    if (loading || selectedTile !== null) return;
    setSelectedTile("jobs");
  }, [loading, selectedTile]);

  const handleDelete = async () => {
    if (!confirm("Delete this customer?")) return;
    try { await api.delete(`/customers/${id}`); toast("success", "Deleted"); router.push("/customers"); }
    catch (err: any) { toast("error", err?.message ?? "Failed to delete"); }
  };

  const addNote = async () => {
    if (!newNote.trim()) return;
    setAddingNote(true);
    try {
      const note = await api.post<Note>(`/customers/${id}/notes`, { content: newNote });
      setNotes(prev => [note, ...prev]);
      setNewNote("");
      toast("success", "Note added");
    } catch { toast("error", "Failed"); }
    finally { setAddingNote(false); }
  };

  if (loading) {
    return <div className="space-y-4"><div className="h-8 w-48 rounded bg-[var(--t-bg-card)] animate-pulse" /><div className="h-40 rounded-[20px] bg-[var(--t-bg-card)] animate-pulse" /><div className="h-64 rounded-[20px] bg-[var(--t-bg-card)] animate-pulse" /></div>;
  }
  if (!customer) return <div className="py-20 text-center text-[var(--t-text-muted)]">Not found</div>;

  const activeJobs = jobs.filter(j => !["completed", "cancelled"].includes(j.status));
  const unpaidBalance = invoices.reduce((s, i) => s + Number(i.balance_due), 0);
  const totalCredits = creditMemos.filter(m => m.status === "issued").reduce((s, m) => s + Number(m.amount), 0);
  const netBalance = Math.round((unpaidBalance - totalCredits) * 100) / 100;
  const avgValue = customer.total_jobs > 0 ? Math.round(Number(customer.lifetime_revenue) / customer.total_jobs) : 0;
  const lastJob = jobs[0];
  const daysSinceLastJob = lastJob ? Math.floor((Date.now() - new Date(lastJob.scheduled_date || lastJob.created_at).getTime()) / 86400000) : null;

  // Finance Snapshot derived fields — fed by the same `invoices` /
  // `creditMemos` state the page already fetches. No extra network.
  const pastDueCount = invoices.filter(
    (i) => i.status === "overdue" || (i.due_date && i.due_date < new Date().toISOString().split("T")[0] && Number(i.balance_due) > 0),
  ).length;
  const lastPaidInvoice = invoices
    .filter((i) => i.status === "paid")
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0];
  const lastPaymentAt = lastPaidInvoice ? lastPaidInvoice.created_at : null;

  // Pick a representative service address for the Location card. Prefers
  // the first geocoded entry (so the map can render); falls back to the
  // first address on file; falls back to billing address; otherwise null.
  const serviceAddresses = customer.service_addresses || [];
  const primaryServiceAddr: Record<string, string> | null =
    serviceAddresses.find((a) => (a as any).lat && (a as any).lng) ??
    serviceAddresses[0] ??
    (customer.billing_address?.street ? customer.billing_address : null);
  const primaryServiceAddrHasCoords = Boolean(
    primaryServiceAddr && (primaryServiceAddr as any).lat && (primaryServiceAddr as any).lng,
  );
  const L = CUSTOMER_DASHBOARD_LABELS;

  return (
    <div>
      {/* History-first back nav — preserves real browser history
          so Jobs → Customer → Back lands on Jobs, not the Customers
          list. Falls back to /customers only for direct URL access. */}
      <button
        type="button"
        onClick={() => navigateBack(router, "/customers")}
        className="inline-flex items-center gap-1.5 text-xs text-[var(--t-frame-text-muted)] hover:text-[var(--t-frame-text)] transition-colors mb-4"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Customers
      </button>

      {/* ===== HEADER (compressed — inline status strip at bottom) ===== */}
      <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-4 mb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] text-base font-bold ${customer.type === "commercial" ? "bg-purple-500/15 text-purple-400" : "bg-blue-500/15 text-blue-400"}`}>
              {customer.first_name[0]}{customer.last_name[0]}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-[22px] font-bold tracking-[-0.5px] text-[var(--t-text-primary)]">{customer.first_name} {customer.last_name}</h1>
                <span className={`text-xs font-medium capitalize ${customer.type === "commercial" ? "text-purple-400" : "text-blue-400"}`}>{customer.type}</span>
                {activeJobs.length > 0 && <span className="text-xs font-medium text-yellow-500">Active Rental</span>}
                {netBalance > 0 && <span className="text-xs font-medium text-[var(--t-error)]">Balance Due</span>}
                {netBalance < 0 && <span className="text-xs font-medium text-[var(--t-accent)]">Credit</span>}
              </div>
              {customer.company_name && <p className="text-xs text-[var(--t-text-muted)] mt-0.5">{customer.company_name}</p>}
              <div className="flex items-center gap-3 mt-1.5 text-xs text-[var(--t-text-muted)] flex-wrap">
                {customer.account_id && <span>ID: {customer.account_id}</span>}
                <span>Balance: <span className={netBalance > 0 ? "text-[var(--t-error)] font-medium" : "text-[var(--t-accent)]"}>{netBalance < 0 ? `-${fmtMoney(Math.abs(netBalance))} credit` : fmtMoney(netBalance)}</span></span>
                <span className={`inline-flex items-center gap-1 ${customer.is_active ? "text-[var(--t-accent)]" : "text-[var(--t-error)]"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${customer.is_active ? "bg-[var(--t-accent)]" : "bg-[var(--t-error)]"}`} />{customer.is_active ? "Active" : "Inactive"}
                </span>
              </div>
            </div>
          </div>
          {/* Quick Actions */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button onClick={() => openWizard({ customerId: id })} className="flex items-center gap-1.5 rounded-full bg-[var(--t-accent)] px-4 py-2 text-xs font-semibold text-[var(--t-accent-on-accent)] hover:opacity-90 transition-opacity border-none cursor-pointer"><Plus className="h-3.5 w-3.5" /> New Job</button>
            {customer.phone && <a href={`tel:${customer.phone}`} className="flex items-center gap-1.5 rounded-full border border-[var(--t-border)] bg-transparent px-3 py-2 text-xs font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors"><Phone className="h-3.5 w-3.5" /> Call</a>}
            {customer.email && <a href={`mailto:${customer.email}`} className="flex items-center gap-1.5 rounded-full border border-[var(--t-border)] bg-transparent px-3 py-2 text-xs font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors"><Mail className="h-3.5 w-3.5" /> Email</a>}
            <button onClick={() => setEditOpen(true)} className="rounded-full border border-[var(--t-border)] bg-transparent p-2 text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors"><Pencil className="h-3.5 w-3.5" /></button>
            <button onClick={handleDelete} className="rounded-full border border-[var(--t-error)]/20 bg-transparent p-2 text-[var(--t-error)] hover:bg-[var(--t-error-soft)] transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </div>

      {/* ===== TABS (promoted to top-level — no Advanced wrapper) ===== */}
      <div className="flex gap-0 border-b border-[var(--t-frame-border)] mb-5 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`relative flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors shrink-0 ${tab === t.key ? "text-[var(--t-accent)]" : "text-[var(--t-frame-text-muted)] hover:text-[var(--t-frame-text)]"}`}>
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
            {t.key === "jobs" && <span className="text-[9px] text-[var(--t-frame-text-muted)] ml-0.5">{jobs.length}</span>}
            {t.key === "invoices" && <span className="text-[9px] text-[var(--t-frame-text-muted)] ml-0.5">{invoices.length}</span>}
            {t.key === "notes" && notes.length > 0 && <span className="text-[9px] text-[var(--t-frame-text-muted)] ml-0.5">{notes.length}</span>}
            {tab === t.key && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--t-accent)] rounded-full" />}
          </button>
        ))}
      </div>

      {/* ===== OVERVIEW TAB ===== */}
      {tab === "overview" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4">
            {/* Contact */}
            <Card title="Contact">
              <Row label="Phone" value={customer.phone ? <a href={`tel:${customer.phone}`} className="text-[var(--t-text-primary)] hover:text-[var(--t-accent)]">{fmtPhone(customer.phone)}</a> : "—"} />
              <Row label="Email" value={customer.email ? <a href={`mailto:${customer.email}`} className="text-[var(--t-text-primary)] hover:text-[var(--t-accent)]">{customer.email}</a> : "—"} />
              <Row label="Type" value={<span className="capitalize">{customer.type}</span>} />
              {customer.lead_source && <Row label="Source" value={<span className="capitalize">{customer.lead_source}</span>} />}
              <Row label="Since" value={new Date(customer.created_at).toLocaleDateString()} />
            </Card>
            {/* Billing Address */}
            {customer.billing_address?.street && (
              <Card title="Billing Address">
                <p className="text-sm text-[var(--t-text-primary)]">{customer.billing_address.street}</p>
                <p className="text-xs text-[var(--t-text-muted)]">{[customer.billing_address.city, customer.billing_address.state, customer.billing_address.zip].filter(Boolean).join(", ")}</p>
              </Card>
            )}
            {/* Tags */}
            {customer.tags?.length > 0 && (
              <Card title="Tags">
                <div className="flex flex-wrap gap-1.5">{customer.tags.map(t => <span key={t} className="rounded-full border border-[var(--t-border)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--t-text-primary)]">{t}</span>)}</div>
              </Card>
            )}
            {customer.notes && <Card title="Notes"><p className="text-sm text-[var(--t-text-primary)] whitespace-pre-wrap">{customer.notes}</p></Card>}
          </div>

          <div className="lg:col-span-2 space-y-4">
            {/* ── Active Rentals card (always visible command-center) ── */}
            <Card
              title={L.overview.activeRentalsTitle}
              action={
                <Link
                  href={`/jobs?customerId=${id}`}
                  className="text-[10px] font-medium text-[var(--t-accent)] hover:underline"
                >
                  {L.overview.activeRentalsAllLabel} →
                </Link>
              }
            >
              {activeJobs.length === 0 ? (
                <EmptyRow>{L.overview.activeRentalsEmpty}</EmptyRow>
              ) : (
                <div className="divide-y divide-[var(--t-border)] -mx-4">
                  {activeJobs.slice(0, 5).map((j) => (
                    <Link
                      key={j.id}
                      href={`/jobs/${j.id}`}
                      className="flex items-center justify-between px-4 py-2 hover:bg-[var(--t-bg-card-hover)] transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-semibold text-[var(--t-text-primary)]">
                          {formatJobNumber(j.job_number)}
                        </span>
                        <span className="text-[10px] text-[var(--t-text-muted)] capitalize">
                          {j.job_type}
                        </span>
                        {j.asset && (
                          <span className="text-[10px] text-[var(--t-text-muted)]">
                            {j.asset.identifier}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {j.scheduled_date && (
                          <span className="text-[10px] text-[var(--t-text-muted)]">
                            {j.scheduled_date}
                          </span>
                        )}
                        {(() => {
                          // Live-derived: pass the job so the chip
                          // reflects the current driver assignment.
                          const ds = deriveDisplayStatus(j);
                          return (
                            <span
                              className="text-[10px] font-medium"
                              style={{ color: displayStatusColor(ds) }}
                            >
                              {DISPLAY_STATUS_LABELS[ds]}
                            </span>
                          );
                        })()}
                      </div>
                    </Link>
                  ))}
                  {activeJobs.length > 5 && (
                    <p className="px-4 pt-2 pb-0 text-[10px] text-[var(--t-text-muted)]">
                      +{activeJobs.length - 5} more active
                    </p>
                  )}
                </div>
              )}
            </Card>

            {/* ── Location card (always visible, prominent map or fallback) ── */}
            <Card title={L.overview.locationTitle}>
              {primaryServiceAddr ? (
                <div>
                  <p className="text-sm font-semibold text-[var(--t-text-primary)]">
                    {primaryServiceAddr.street || "—"}
                  </p>
                  <p className="text-xs text-[var(--t-text-muted)] mb-3">
                    {[primaryServiceAddr.city, primaryServiceAddr.state, primaryServiceAddr.zip]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </p>
                  {primaryServiceAddrHasCoords ? (
                    <div className="rounded-[14px] overflow-hidden border border-[var(--t-border)]">
                      <MapboxMap
                        markers={serviceAddresses
                          .filter((a: any) => a.lat && a.lng)
                          .map((a: any, i: number) => ({
                            id: `svc-${i}`,
                            lat: Number(a.lat),
                            lng: Number(a.lng),
                            type: "customer" as const,
                            label: String(i + 1),
                            popupContent: {
                              title: a.street || "Service Address",
                              subtitle: [a.city, a.state, a.zip].filter(Boolean).join(", "),
                            },
                          }))}
                        style={{ height: 260, width: "100%" }}
                        interactive={false}
                        showControls={false}
                      />
                    </div>
                  ) : (
                    <p className="text-[11px] italic text-[var(--t-text-muted)]">
                      {L.overview.locationNoCoordinates}
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-xs italic text-[var(--t-text-muted)]">
                    {L.overview.locationEmpty}
                  </p>
                  <button
                    onClick={() => setEditOpen(true)}
                    className="mt-2 text-[11px] font-medium text-[var(--t-accent)] hover:underline"
                  >
                    {L.overview.locationAddCta} →
                  </button>
                </div>
              )}
            </Card>

            {/* ── Finance Snapshot card ── */}
            <Card
              title={L.overview.financeTitle}
              action={
                <button
                  onClick={() => setTab("billing")}
                  className="text-[10px] font-medium text-[var(--t-accent)] hover:underline"
                >
                  {L.overview.financeViewBilling} →
                </button>
              }
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--t-text-muted)] mb-0.5">
                    {L.overview.financeBalanceLabel}
                  </p>
                  <p
                    className="text-xl font-bold tabular-nums"
                    style={{
                      color:
                        netBalance > 0
                          ? "var(--t-error)"
                          : netBalance < 0
                            ? "var(--t-accent)"
                            : "var(--t-text-primary)",
                    }}
                  >
                    {netBalance < 0
                      ? `-${fmtMoney(Math.abs(netBalance))}`
                      : fmtMoney(netBalance)}
                  </p>
                  {netBalance < 0 && (
                    <p className="text-[10px] text-[var(--t-accent)]">
                      {L.overview.financeCreditAvailable}
                    </p>
                  )}
                  {pastDueCount > 0 && (
                    <p className="text-[10px] text-[var(--t-error)] mt-0.5">
                      {pastDueCount} {L.overview.financePastDue}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--t-text-muted)] mb-0.5">
                    {L.overview.financeLastPayment}
                  </p>
                  {lastPaymentAt ? (
                    <>
                      <p className="text-sm font-semibold text-[var(--t-text-primary)]">
                        {timeAgo(lastPaymentAt)}
                      </p>
                      <p className="text-[10px] text-[var(--t-text-muted)]">
                        {new Date(lastPaymentAt).toLocaleDateString()}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs italic text-[var(--t-text-muted)]">
                      {L.overview.financeNeverPaid}
                    </p>
                  )}
                </div>
              </div>
            </Card>

            {/* ── Historical metrics drill-down — 4 tiles + shared panel ── */}
            {/*
             * These tiles drive a shared detail panel below. The
             * "Active" tile that used to live here was promoted to
             * the always-visible card above, so operators no longer
             * need to click a tile to see current state.
             */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  { key: "jobs" as const, label: CUSTOMER_DASHBOARD_LABELS.tile.jobs, value: customer.total_jobs },
                  { key: "revenue" as const, label: CUSTOMER_DASHBOARD_LABELS.tile.revenue, value: fmtMoneyShort(customer.lifetime_revenue) },
                  { key: "avgValue" as const, label: CUSTOMER_DASHBOARD_LABELS.tile.avgValue, value: `$${avgValue}` },
                  { key: "lastJob" as const, label: CUSTOMER_DASHBOARD_LABELS.tile.lastJob, value: daysSinceLastJob !== null ? `${daysSinceLastJob}d` : "—" },
                ]
              ).map(s => {
                const isSelected = selectedTile === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setSelectedTile(s.key)}
                    className="rounded-[20px] border p-3 text-center transition-colors cursor-pointer"
                    style={{
                      background: isSelected ? "var(--t-accent-soft, rgba(34,197,94,0.08))" : "var(--t-bg-card)",
                      borderColor: isSelected ? "var(--t-accent)" : "var(--t-border)",
                    }}
                    aria-pressed={isSelected}
                  >
                    <p
                      className="text-base font-bold tabular-nums"
                      style={{ color: isSelected ? "var(--t-accent)" : "var(--t-text-primary)" }}
                    >
                      {s.value}
                    </p>
                    <p className="text-[9px] text-[var(--t-text-muted)]">{s.label}</p>
                  </button>
                );
              })}
            </div>

            {/* Shared detail panel — only the selected tile's content is rendered */}
            {selectedTile && (
              <OverviewTilePanel
                tile={selectedTile}
                jobs={jobs}
                invoices={invoices}
                customer={customer}
              />
            )}
          </div>
        </div>
      )}

      {/* ===== BILLING TAB ===== */}
      {tab === "billing" && (
        <div className="space-y-4 max-w-2xl">
          {/* Phase 3 — visibility-only Accounting & Credit panel.
              Self-contained: fetches its own credit-state + profile,
              gates inline edits on admin/owner, never enforces. */}
          <CustomerCreditPanel customerId={id} />
          <div className="grid grid-cols-2 gap-4">
            <Card title="Current Balance"><p className={`text-2xl font-bold tabular-nums ${netBalance > 0 ? "text-[var(--t-error)]" : "text-[var(--t-accent)]"}`}>{netBalance < 0 ? `-${fmtMoney(Math.abs(netBalance))}` : fmtMoney(netBalance)}</p>{totalCredits > 0 && <p className="text-xs mt-1" style={{ color: "var(--t-accent)" }}>{fmtMoney(totalCredits)} credit available</p>}</Card>
            <Card title="Lifetime Revenue"><p className="text-2xl font-bold text-[var(--t-text-primary)] tabular-nums">{fmtMoney(customer.lifetime_revenue)}</p></Card>
          </div>
          <Card title="Payment History">
            {invoices.filter(i => i.status === "paid").length === 0 ? <p className="py-4 text-center text-xs text-[var(--t-text-muted)]">No payments recorded</p> : (
              <div className="divide-y divide-[var(--t-border)] -mx-4">
                {invoices.filter(i => i.status === "paid").map(i => (
                  <div key={i.id} className="flex items-center justify-between px-4 py-2">
                    <div><p className="text-xs font-medium text-[var(--t-text-primary)]">#{i.invoice_number}</p><p className="text-[10px] text-[var(--t-text-muted)]">{new Date(i.created_at).toLocaleDateString()}</p></div>
                    <span className="text-sm font-medium text-[var(--t-accent)] tabular-nums">{fmtMoney(i.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Unpaid Invoices">
            {invoices.filter(i => ["open", "overdue", "draft", "partial"].includes(i.status)).length === 0 ? <p className="py-4 text-center text-xs text-[var(--t-text-muted)]">All paid up</p> : (
              <div className="divide-y divide-[var(--t-border)] -mx-4">
                {invoices.filter(i => ["open", "overdue", "draft", "partial"].includes(i.status)).map(i => (
                  // Phase B2 — preserve customer context via
                  // returnTo so the invoice detail page can render
                  // a "Back to Customer" link. The invoice detail
                  // page validates the prefix against an allowlist
                  // before navigating.
                  <Link key={i.id} href={`/invoices/${i.id}?returnTo=${encodeURIComponent(`/customers/${id}`)}`} className="flex items-center justify-between px-4 py-2 hover:bg-[var(--t-bg-card-hover)] transition-colors">
                    <div><p className="text-xs font-medium text-[var(--t-text-primary)]">#{i.invoice_number}</p><p className="text-[10px] text-[var(--t-text-muted)]">Due: {i.due_date || "—"}</p></div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-medium ${STATUS_CLS[i.status] || ""}`}>{i.status}</span>
                      <span className="text-sm font-medium text-[var(--t-error)] tabular-nums">{fmtMoney(i.balance_due)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ===== JOBS TAB ===== */}
      {/*
       * Jobs tab — grouped by rental lifecycle. Delivery / exchange /
       * pickup tasks that belong to the same chain are collapsed under
       * an expandable parent row so office staff can immediately see
       * which jobs are part of the same rental. Standalone jobs (not
       * part of any chain) render as flat rows below. Parent row
       * click toggles expansion; child row click jumps to the job
       * detail. The right-arrow on a parent row navigates to the
       * full `/rentals/:id` lifecycle page.
       */}
      {tab === "jobs" && (() => {
        const chainedJobIdSet = new Set<string>();
        for (const c of chains) {
          for (const l of c.links) {
            if (l.job_id) chainedJobIdSet.add(l.job_id);
          }
        }
        const standaloneJobs = jobs.filter((j) => !chainedJobIdSet.has(j.id));
        const hasNothing = chains.length === 0 && standaloneJobs.length === 0;
        const deriveChainLabel = (chain: CustomerChain) => {
          // Reuse existing derived truth — chain.status is the
          // authoritative lifecycle state from the backend.
          const dropOff = chain.links.find((l) => l.task_type === "drop_off");
          const pickUp = chain.links.find((l) => l.task_type === "pick_up");
          const hasExchange = chain.links.some((l) => l.task_type === "exchange");
          if (chain.status === "completed") return FEATURE_REGISTRY.lifecycle_status_completed?.label ?? "Completed";
          if (chain.status === "cancelled") return "Cancelled";
          if (hasExchange) return FEATURE_REGISTRY.lifecycle_status_exchange?.label ?? "Exchange Scheduled";
          if (dropOff?.job?.status === "completed" && pickUp?.job?.status !== "completed") {
            return FEATURE_REGISTRY.lifecycle_status_awaiting_pickup?.label ?? "Awaiting Pickup";
          }
          return FEATURE_REGISTRY.lifecycle_status_awaiting_delivery?.label ?? "Awaiting Delivery";
        };
        return (
          <div className="space-y-4">
            {hasNothing ? (
              <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] py-12 text-center text-xs text-[var(--t-text-muted)]">
                No jobs
              </div>
            ) : (
              <>
                {/* Rental lifecycles — expandable grouped rows */}
                {chains.length > 0 && (
                  <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] overflow-hidden">
                    <div className="px-4 py-3 border-b border-[var(--t-border)] flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--t-text-muted)]">
                        {FEATURE_REGISTRY.customer_jobs_rental_chains_heading?.label ?? "Rental Lifecycles"}
                      </p>
                      <span className="text-[10px] text-[var(--t-text-muted)]">{chains.length}</span>
                    </div>
                    <div className="table-scroll">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[var(--t-border)]">
                            <th className="w-8" aria-label="Expand" />
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Size</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Delivered</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Pickup</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Tasks</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Status</th>
                            <th className="w-10" />
                          </tr>
                        </thead>
                        <tbody>
                          {chains.map((chain) => {
                            const isExpanded = expandedChains.has(chain.id);
                            const isCompleted = chain.status === "completed";
                            const orderedLinks = [...chain.links].sort(
                              (a, b) => (a.sequence_number ?? 0) - (b.sequence_number ?? 0),
                            );
                            const completedTasks = chain.links.filter((l) => l.job?.status === "completed").length;
                            const totalTasks = chain.links.length;
                            const chainLabel = deriveChainLabel(chain);
                            return (
                              <Fragment key={chain.id}>
                                <tr
                                  onClick={() => toggleChain(chain.id)}
                                  aria-expanded={isExpanded}
                                  className="border-b border-[var(--t-border)] cursor-pointer hover:bg-[var(--t-bg-card-hover)] transition-colors"
                                  style={{
                                    borderLeft: isCompleted ? "3px solid var(--t-success, #22c55e)" : "3px solid var(--t-accent)",
                                    background: isExpanded ? "var(--t-bg-card-hover)" : undefined,
                                  }}
                                >
                                  <td className="pl-2">
                                    {isExpanded
                                      ? <ChevronDown className="h-3.5 w-3.5" style={{ color: "var(--t-text-muted)" }} />
                                      : <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--t-text-muted)" }} />}
                                  </td>
                                  <td className="px-4 py-3">
                                    {chain.dumpster_size ? (
                                      <span className="text-[11px] font-extrabold uppercase" style={{ color: "var(--t-text-primary)", background: "var(--t-accent-soft)", padding: "2px 7px", borderRadius: 5 }}>
                                        {chain.dumpster_size.replace(/yd$/i, "Y").toUpperCase()}
                                      </span>
                                    ) : <span className="text-[var(--t-text-tertiary)]">—</span>}
                                  </td>
                                  <td className="px-4 py-3 text-xs text-[var(--t-text-primary)]">
                                    {chain.drop_off_date || "—"}
                                  </td>
                                  <td className="px-4 py-3 text-xs text-[var(--t-text-primary)]">
                                    {chain.expected_pickup_date || "—"}
                                  </td>
                                  <td className="px-4 py-3 text-[11px] text-[var(--t-text-muted)]">
                                    {completedTasks}/{totalTasks}
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className="text-[10px] font-semibold" style={{
                                      color: isCompleted ? "var(--t-text-muted)" : "var(--t-accent)",
                                      background: isCompleted ? "var(--t-bg-elevated)" : "var(--t-accent-soft)",
                                      padding: "2px 8px",
                                      borderRadius: 10,
                                    }}>
                                      {chainLabel}
                                    </span>
                                  </td>
                                  <td className="pr-3">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        // Phase 3 — prefer the chain's
                                        // representative job as the navigation
                                        // target; keep the chain route as a
                                        // safe fallback when resolution fails.
                                        const repJobId = resolveRepresentativeJobId(chain.links);
                                        if (repJobId) {
                                          router.push(`/jobs/${repJobId}`);
                                        } else {
                                          router.push(`/rentals/${chain.id}`);
                                        }
                                      }}
                                      className="p-1 rounded transition-colors"
                                      style={{ color: "var(--t-text-muted)" }}
                                      aria-label={FEATURE_REGISTRY.view_lifecycle?.label ?? "View full lifecycle"}
                                      title={FEATURE_REGISTRY.view_lifecycle?.label ?? "View full lifecycle"}
                                      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-accent)"; }}
                                      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-muted)"; }}
                                    >
                                      <ArrowRight className="h-3.5 w-3.5" />
                                    </button>
                                  </td>
                                </tr>
                                {isExpanded && orderedLinks.map((link) => {
                                  const childJob = link.job;
                                  if (!childJob) return null;
                                  // Pull the fuller Job record from
                                  // the flat `jobs[]` fetch (which
                                  // has asset + price + driver info)
                                  // when available; fall back to the
                                  // link.job shape. Live-derived so
                                  // the Assigned chip is driver-aware.
                                  const fullJob = jobs.find((j) => j.id === childJob.id);
                                  const display = deriveDisplayStatus(fullJob ?? childJob);
                                  return (
                                    <tr
                                      key={`${chain.id}-child-${link.job_id}`}
                                      onClick={() => router.push(`/jobs/${childJob.id}`)}
                                      className="border-b border-[var(--t-border)] cursor-pointer hover:bg-[var(--t-bg-card-hover)] transition-colors"
                                      style={{
                                        borderLeft: isCompleted ? "3px solid var(--t-success, #22c55e)" : "3px solid var(--t-accent)",
                                        background: "var(--t-bg-secondary, var(--t-bg-card))",
                                      }}
                                    >
                                      <td />
                                      <td className="pl-8 pr-4 py-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--t-text-muted)" }}>
                                            {link.task_type === "drop_off" ? "Delivery"
                                              : link.task_type === "pick_up" ? "Pickup"
                                                : link.task_type === "exchange" ? "Exchange"
                                                  : link.task_type}
                                          </span>
                                          <span className="text-xs font-medium text-[var(--t-text-primary)]">
                                            {formatJobNumber(childJob.job_number)}
                                          </span>
                                        </div>
                                      </td>
                                      <td className="px-4 py-2 text-[11px] text-[var(--t-text-primary)]">
                                        {link.scheduled_date || "—"}
                                      </td>
                                      <td className="px-4 py-2 text-[11px] text-[var(--t-text-muted)]">
                                        {fullJob?.asset?.identifier || childJob.asset_subtype || "—"}
                                      </td>
                                      <td />
                                      <td className="px-4 py-2">
                                        <span className="text-[10px] font-medium" style={{ color: displayStatusColor(display) }}>
                                          {DISPLAY_STATUS_LABELS[display]}
                                        </span>
                                      </td>
                                      <td className="pr-3 text-right">
                                        {fullJob?.total_price ? (
                                          <span className="text-[11px] tabular-nums text-[var(--t-text-muted)]">
                                            {fmtMoneyShort(fullJob.total_price)}
                                          </span>
                                        ) : null}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Standalone jobs (not part of any rental chain) */}
                {standaloneJobs.length > 0 && (
                  <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] overflow-hidden">
                    <div className="px-4 py-3 border-b border-[var(--t-border)] flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--t-text-muted)]">
                        {FEATURE_REGISTRY.customer_jobs_standalone_heading?.label ?? "Standalone Jobs"}
                      </p>
                      <span className="text-[10px] text-[var(--t-text-muted)]">{standaloneJobs.length}</span>
                    </div>
                    <div className="table-scroll">
                      <table className="w-full text-sm">
                        <thead><tr className="border-b border-[var(--t-border)]">
                          {["Job #", "Type", "Date", "Asset", "Status", "Price"].map(h => (
                            <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">{h}</th>
                          ))}
                        </tr></thead>
                        <tbody>
                          {standaloneJobs.map(j => (
                            <tr key={j.id} onClick={() => router.push(`/jobs/${j.id}`)} className="border-b border-[var(--t-border)] last:border-0 cursor-pointer hover:bg-[var(--t-bg-card-hover)] transition-colors">
                              <td className="px-4 py-3 font-medium text-[var(--t-text-primary)]">{formatJobNumber(j.job_number)}</td>
                              <td className="px-4 py-3 text-[var(--t-text-primary)] capitalize">{j.job_type}</td>
                              <td className="px-4 py-3 text-[var(--t-text-primary)]">{j.scheduled_date || "—"}</td>
                              <td className="px-4 py-3 text-[var(--t-text-muted)]">{j.asset?.identifier || "—"}</td>
                              {(() => {
                                // Live-derived: pass the job so the
                                // Assigned chip reflects the current
                                // driver assignment, not the raw
                                // `dispatched` status column.
                                const ds = deriveDisplayStatus(j);
                                return (
                                  <td className="px-4 py-3"><span className="text-[10px] font-medium" style={{ color: displayStatusColor(ds) }}>{DISPLAY_STATUS_LABELS[ds]}</span></td>
                                );
                              })()}
                              <td className="px-4 py-3 text-[var(--t-text-primary)] tabular-nums">{j.total_price ? fmtMoneyShort(j.total_price) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* ===== QUOTES TAB ===== */}
      {tab === "quotes" && (
        <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] overflow-hidden">
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--t-border)]">
                {["Quote #", "Size", "Amount", "Status", "Date"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {customerQuotes.length === 0 ? <tr><td colSpan={5} className="py-12 text-center text-xs text-[var(--t-text-muted)]">No quotes for this customer</td></tr> :
                  customerQuotes.map(q => (
                    <tr key={q.id} onClick={() => router.push(`/quotes`)} className="border-b border-[var(--t-border)] last:border-0 cursor-pointer hover:bg-[var(--t-bg-card-hover)] transition-colors">
                      <td className="px-4 py-3 font-medium text-[var(--t-accent)]">{q.quote_number}</td>
                      <td className="px-4 py-3 text-[var(--t-text-primary)]">{q.asset_subtype}</td>
                      <td className="px-4 py-3 text-[var(--t-text-primary)] tabular-nums">${Number(q.total_quoted).toFixed(2)}</td>
                      <td className="px-4 py-3"><span className="text-[10px] font-medium capitalize" style={{ color: q.derived_status === "converted" ? "var(--t-success, #22c55e)" : q.derived_status === "expired" ? "var(--t-error)" : "var(--t-accent)" }}>{q.derived_status}</span></td>
                      <td className="px-4 py-3 text-[var(--t-text-muted)]">{new Date(q.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== INVOICES TAB ===== */}
      {tab === "invoices" && (
        <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] overflow-hidden">
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--t-border)]">
                {["Invoice #", "Date", "Due", "Status", "Total", "Balance"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[var(--t-text-muted)]">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {invoices.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-xs text-[var(--t-text-muted)]">No invoices</td></tr> :
                  invoices.map(i => (
                    // Phase B2 — preserve customer context via
                    // returnTo (see Unpaid Invoices sidebar above
                    // for the full pattern).
                    <tr key={i.id} onClick={() => router.push(`/invoices/${i.id}?returnTo=${encodeURIComponent(`/customers/${id}`)}`)} className="border-b border-[var(--t-border)] last:border-0 cursor-pointer hover:bg-[var(--t-bg-card-hover)] transition-colors">
                      <td className="px-4 py-3 font-medium text-[var(--t-text-primary)]">#{i.invoice_number}</td>
                      <td className="px-4 py-3 text-[var(--t-text-primary)]">{new Date(i.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-[var(--t-text-primary)]">{i.due_date || "—"}</td>
                      <td className="px-4 py-3"><span className={`text-[10px] font-medium capitalize ${STATUS_CLS[i.status] || ""}`}>{i.status}</span></td>
                      <td className="px-4 py-3 text-[var(--t-text-primary)] tabular-nums">{fmtMoney(i.total)}</td>
                      <td className="px-4 py-3 text-[var(--t-text-primary)] tabular-nums">{fmtMoney(i.balance_due)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===== PRICING TAB ===== */}
      {tab === "pricing" && customer && (
        <CustomerPricingTab customerId={customer.id} customerName={`${customer.first_name} ${customer.last_name}`} />
      )}

      {/* ===== NOTES TAB ===== */}
      {tab === "notes" && (
        <div className="max-w-2xl space-y-4">
          {/* Add note */}
          <div className="flex gap-2">
            <input value={newNote} onChange={e => setNewNote(e.target.value)} onKeyDown={e => e.key === "Enter" && addNote()}
              className="flex-1 rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] px-4 py-2.5 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none focus:border-[var(--t-accent)]"
              placeholder="Add a note..." />
            <button onClick={addNote} disabled={addingNote || !newNote.trim()}
              className="rounded-full bg-[var(--t-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--t-accent-on-accent)] hover:opacity-90 disabled:opacity-40 transition-opacity">
              {addingNote ? "..." : "Add"}
            </button>
          </div>
          {/* Notes timeline */}
          {notes.length === 0 ? (
            <div className="py-12 text-center"><MessageSquare className="mx-auto h-8 w-8 text-[var(--t-text-muted)]/20 mb-2" /><p className="text-xs text-[var(--t-text-muted)]">No notes yet</p></div>
          ) : (
            <div className="space-y-2">
              {notes.map(n => (
                <div key={n.id} className="rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] p-3">
                  <p className="text-sm text-[var(--t-text-primary)]">{n.content}</p>
                  <div className="flex items-center gap-2 mt-2 text-[10px] text-[var(--t-text-muted)]">
                    <span>{n.author_name || "System"}</span>
                    <span>·</span>
                    <span>{timeAgo(n.created_at)}</span>
                    {n.type === "system" && <span className="text-[8px] text-[var(--t-text-muted)]">AUTO</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===== SETTINGS TAB ===== */}
      {tab === "settings" && customer && (
        <div className="max-w-2xl space-y-6">
          <Card title="Client Type">
            <p className="text-sm capitalize" style={{ color: "var(--t-text-primary)" }}>{customer.type}</p>
            <p className="text-xs mt-1" style={{ color: "var(--t-text-muted)" }}>Change via the Edit Customer button above</p>
          </Card>
          <Card title="Terms Template">
            <p className="text-sm" style={{ color: "var(--t-text-muted)" }}>
              Using {customer.type === "commercial" ? "Commercial" : "Residential"} Standard (default)
            </p>
            <Link href="/pricing/terms" className="text-xs text-[var(--t-accent)] hover:underline mt-1 inline-block">
              Manage Templates
            </Link>
          </Card>
          <Card title="Service Addresses">
            {(customer.service_addresses || []).length === 0 ? (
              <p className="text-sm" style={{ color: "var(--t-text-muted)" }}>No service addresses on file</p>
            ) : (
              <div className="space-y-2">
                {customer.service_addresses.map((addr, i) => (
                  <div key={i} className="rounded-[14px] border border-[var(--t-border)] p-3">
                    <p className="text-sm" style={{ color: "var(--t-text-primary)" }}>{addr.street || "—"}</p>
                    <p className="text-xs" style={{ color: "var(--t-text-muted)" }}>{[addr.city, addr.state, addr.zip].filter(Boolean).join(", ")}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Notification Preferences">
            <p className="text-xs mb-3" style={{ color: "var(--t-text-muted)" }}>
              Control which notifications this customer receives
            </p>
            {[
              "Booking Confirmation", "Service Reminder", "On Our Way", "Service Complete",
              "Invoice Sent", "Payment Confirmation", "Overdue Reminder", "Pickup Reminder",
              "Rental Extension", "Failed Trip Notice", "Schedule Change", "Dump Ticket Ready",
            ].map(cat => (
              <div key={cat} className="flex items-center justify-between py-2 border-b border-[var(--t-border)] last:border-0">
                <span className="text-sm" style={{ color: "var(--t-text-primary)" }}>{cat}</span>
                <div className="flex gap-3">
                  <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--t-text-muted)" }}>
                    <input type="checkbox" defaultChecked className="accent-[var(--t-accent)]" /> Email
                  </label>
                  <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--t-text-muted)" }}>
                    <input type="checkbox" defaultChecked className="accent-[var(--t-accent)]" /> SMS
                  </label>
                </div>
              </div>
            ))}
            {/* TODO: Connect to backend notification preferences endpoint when available */}
          </Card>
          {customer.notes && (
            <Card title="Internal Notes">
              <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--t-text-primary)" }}>{customer.notes}</p>
            </Card>
          )}
        </div>
      )}

      {/* Edit */}
      <SlideOver open={editOpen} onClose={() => setEditOpen(false)} title="Edit Customer">
        <EditForm customer={customer} onSuccess={c => { setCustomer(c); setEditOpen(false); toast("success", "Updated"); }} />
      </SlideOver>
    </div>
  );
}

/* ---- Reusable Card ---- */

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-[var(--t-text-muted)] uppercase tracking-wider font-semibold">{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-center justify-between py-1.5 text-sm"><span className="text-[var(--t-text-muted)]">{label}</span><span className="text-[var(--t-text-primary)]">{value}</span></div>;
}

/* ---- Overview Tile Detail Panel ----
 * Shared panel rendered below the Overview tile row. Its content changes
 * based on which tile the user selected. All data comes from the existing
 * customer-page fetches — no new network calls.
 */

function OverviewTilePanel({
  tile,
  jobs,
  invoices,
  customer,
}: {
  tile: OverviewTile;
  jobs: Job[];
  invoices: Invoice[];
  customer: Customer;
}) {
  const L = CUSTOMER_DASHBOARD_LABELS;

  // — Jobs: most-recent-first, up to 10 —
  if (tile === "jobs") {
    const recent = [...jobs].slice(0, 10);
    return (
      <Card title={L.tilePanel.jobs}>
        {recent.length === 0 ? (
          <EmptyRow>{L.tileEmpty.jobs}</EmptyRow>
        ) : (
          <div className="divide-y divide-[var(--t-border)] -mx-4">
            {recent.map((j) => (
              <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-[var(--t-bg-card-hover)] transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-medium text-[var(--t-text-primary)]">{formatJobNumber(j.job_number)}</span>
                  <span className="text-[10px] text-[var(--t-text-muted)] capitalize">{j.job_type}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-[var(--t-text-muted)]">{j.scheduled_date || "—"}</span>
                  <span className={`text-[10px] font-medium ${STATUS_CLS[j.status] || ""}`}>{j.status.replace(/_/g, " ")}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    );
  }

  // — Revenue: paid invoices, sum + list —
  if (tile === "revenue") {
    const paidInvoices = invoices.filter((i) => i.status === "paid");
    const lifetimeRevenue = Number(customer.lifetime_revenue) || 0;
    return (
      <Card title={L.tilePanel.revenue}>
        <div className="mb-3 flex items-baseline justify-between">
          <p className="text-[10px] uppercase tracking-wider text-[var(--t-text-muted)]">
            Lifetime
          </p>
          <p className="text-lg font-bold tabular-nums text-[var(--t-text-primary)]">
            {fmtMoney(lifetimeRevenue)}
          </p>
        </div>
        {paidInvoices.length === 0 ? (
          <EmptyRow>{L.tileEmpty.revenue}</EmptyRow>
        ) : (
          <div className="divide-y divide-[var(--t-border)] -mx-4">
            {paidInvoices.slice(0, 10).map((i) => (
              // Phase B2 — preserve customer context via
              // returnTo. Uses `customer.id` here (not the outer
              // route `id`) because this branch is inside
              // `OverviewTilePanel`, a nested helper that
              // receives `customer` as a prop. `customer.id` is
              // guaranteed present in this scope since the
              // component only renders once customer is loaded.
              <Link key={i.id} href={`/invoices/${i.id}?returnTo=${encodeURIComponent(`/customers/${customer.id}`)}`} className="flex items-center justify-between px-4 py-2 hover:bg-[var(--t-bg-card-hover)] transition-colors">
                <div>
                  <p className="text-xs font-medium text-[var(--t-text-primary)]">#{i.invoice_number}</p>
                  <p className="text-[10px] text-[var(--t-text-muted)]">{new Date(i.created_at).toLocaleDateString()}</p>
                </div>
                <span className="text-sm font-medium text-[var(--t-accent)] tabular-nums">{fmtMoney(i.total)}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    );
  }

  // — Avg Value: jobs sorted by total_price descending, highlight average —
  if (tile === "avgValue") {
    const priced = jobs
      .filter((j) => Number(j.total_price) > 0)
      .sort((a, b) => Number(b.total_price) - Number(a.total_price));
    const avg = priced.length > 0
      ? Math.round(priced.reduce((s, j) => s + Number(j.total_price), 0) / priced.length)
      : 0;
    return (
      <Card title={L.tilePanel.avgValue}>
        <div className="mb-3 flex items-baseline justify-between">
          <p className="text-[10px] uppercase tracking-wider text-[var(--t-text-muted)]">
            Average
          </p>
          <p className="text-lg font-bold tabular-nums text-[var(--t-text-primary)]">
            ${avg}
          </p>
        </div>
        {priced.length === 0 ? (
          <EmptyRow>{L.tileEmpty.avgValue}</EmptyRow>
        ) : (
          <div className="divide-y divide-[var(--t-border)] -mx-4">
            {priced.slice(0, 10).map((j) => (
              <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-[var(--t-bg-card-hover)] transition-colors">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[var(--t-text-primary)]">{formatJobNumber(j.job_number)}</span>
                  <span className="text-[10px] text-[var(--t-text-muted)] capitalize">{j.job_type}</span>
                </div>
                <span className="text-xs font-medium tabular-nums text-[var(--t-text-primary)]">{fmtMoneyShort(Number(j.total_price))}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    );
  }

  // — Last Job: single card with latest job summary —
  if (tile === "lastJob") {
    const last = jobs[0];
    return (
      <Card title={L.tilePanel.lastJob}>
        {!last ? (
          <EmptyRow>{L.tileEmpty.lastJob}</EmptyRow>
        ) : (
          <Link href={`/jobs/${last.id}`} className="block rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card-hover)] p-3 hover:opacity-90 transition-opacity">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-[var(--t-text-primary)]">{formatJobNumber(last.job_number)}</span>
              <span className={`text-[10px] font-medium capitalize ${STATUS_CLS[last.status] || ""}`}>
                {last.status.replace(/_/g, " ")}
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-[var(--t-text-muted)] flex-wrap">
              <span className="capitalize">{last.job_type}</span>
              {last.asset && <span>{last.asset.identifier}</span>}
              {last.scheduled_date && <span>{last.scheduled_date}</span>}
              {Number(last.total_price) > 0 && (
                <span className="text-[var(--t-text-primary)] font-medium tabular-nums">
                  {fmtMoney(Number(last.total_price))}
                </span>
              )}
              <span>· {timeAgo(last.created_at)}</span>
            </div>
          </Link>
        )}
      </Card>
    );
  }

  return null;
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-4 text-center text-xs text-[var(--t-text-muted)]">
      {children}
    </p>
  );
}

/* ---- Edit Form ---- */

function EditForm({ customer, onSuccess }: { customer: Customer; onSuccess: (c: Customer) => void }) {
  const [firstName, setFirstName] = useState(customer.first_name);
  const [lastName, setLastName] = useState(customer.last_name);
  const [email, setEmail] = useState(customer.email || "");
  const [phone, setPhone] = useState(customer.phone || "");
  const [companyName, setCompanyName] = useState(customer.company_name || "");
  const [notes, setNotes] = useState(customer.notes || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const inputCls = "w-full bg-[var(--t-bg-card)] border border-[var(--t-border)] rounded-[20px] px-4 py-3 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none focus:border-[var(--t-accent)] focus:ring-1 focus:ring-[var(--t-accent)]";

  return (
    <form onSubmit={async (e: FormEvent) => {
      e.preventDefault(); setError(""); setSaving(true);
      try { const u = await api.patch<Customer>(`/customers/${customer.id}`, { firstName, lastName, email: email || undefined, phone: phone || undefined, companyName: companyName || undefined, notes: notes || undefined }); onSuccess(u); }
      catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
      finally { setSaving(false); }
    }} className="space-y-4">
      {error && <div className="rounded-[20px] bg-[var(--t-error-soft)] px-4 py-3 text-sm text-[var(--t-error)]">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <input value={firstName} onChange={e => setFirstName(e.target.value)} required className={inputCls} placeholder="First" />
        <input value={lastName} onChange={e => setLastName(e.target.value)} required className={inputCls} placeholder="Last" />
      </div>
      <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} placeholder="Phone" />
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="Email" />
      <input value={companyName} onChange={e => setCompanyName(e.target.value)} className={inputCls} placeholder="Company" />
      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={`${inputCls} resize-none`} placeholder="Notes" />
      <button type="submit" disabled={saving} className="w-full rounded-full bg-[var(--t-accent)] py-3 text-sm font-bold text-[var(--t-accent-on-accent)] hover:opacity-90 disabled:opacity-50 transition-opacity">
        {saving ? "Saving..." : "Save"}
      </button>
    </form>
  );
}

/* ---- Customer Pricing Tab ---- */

interface PricingOverride {
  id: string;
  pricing_rule_id: string;
  base_price: number | null;
  weight_allowance_tons: number | null;
  overage_per_ton: number | null;
  daily_overage_rate: number | null;
  rental_days: number | null;
  effective_from: string;
  effective_to: string | null;
  pricing_rule?: { id: string; name: string; asset_subtype: string; base_price: number; included_tons: number; overage_per_ton: number; extra_day_rate: number; rental_period_days: number };
}

interface SurchargeOverride {
  id: string;
  surcharge_template_id: string;
  amount: number;
  available_for_billing: boolean;
  surcharge_template?: { id: string; name: string; default_amount: number };
}

interface PricingRuleLite {
  id: string;
  name: string;
  asset_subtype: string;
  base_price: number;
  included_tons: number;
  overage_per_ton: number;
  extra_day_rate: number;
  rental_period_days: number;
  is_active: boolean;
}

function CustomerPricingTab({ customerId }: { customerId: string; customerName: string }) {
  const L = CUSTOMER_DASHBOARD_LABELS.pricing;
  const [rules, setRules] = useState<PricingRuleLite[]>([]);
  const [overrides, setOverrides] = useState<PricingOverride[]>([]);
  const [surcharges, setSurcharges] = useState<SurchargeOverride[]>([]);
  const [allTemplates, setAllTemplates] = useState<Array<{ id: string; name: string; default_amount: number }>>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchData = async () => {
    setLoading(true);
    try {
      const [rulesRes, ov, sc, tpl] = await Promise.all([
        api.get<{ data: PricingRuleLite[] } | PricingRuleLite[]>("/pricing"),
        api.get<PricingOverride[]>(`/customers/${customerId}/pricing-overrides`),
        api.get<SurchargeOverride[]>(`/customers/${customerId}/surcharge-overrides`),
        api.get<Array<{ id: string; name: string; default_amount: number }>>("/surcharge-templates"),
      ]);
      const ruleList: PricingRuleLite[] = Array.isArray(rulesRes)
        ? rulesRes
        : Array.isArray((rulesRes as any)?.data)
          ? (rulesRes as any).data
          : [];
      setRules(ruleList.filter((r) => r.is_active !== false));
      setOverrides(Array.isArray(ov) ? ov : []);
      setSurcharges(Array.isArray(sc) ? sc : []);
      setAllTemplates(Array.isArray(tpl) ? tpl : []);
    } catch { /* */ } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [customerId]);

  if (loading) {
    return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-[20px]" style={{ background: "var(--t-bg-card)" }} />)}</div>;
  }

  const overridesByRuleId = new Map(overrides.map((o) => [o.pricing_rule_id, o]));
  const overridesActiveCount = overrides.filter((o) => o.base_price != null).length;

  return (
    <div className="space-y-8 max-w-3xl">
      {/* ── Section 1: Custom Pricing ── */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
              {L.sections.customPricing}
            </h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--t-text-muted)" }}>
              {L.sections.customPricingDescription}
            </p>
          </div>
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold shrink-0"
            style={{
              background: overridesActiveCount > 0
                ? "var(--t-accent-soft, rgba(34,197,94,0.12))"
                : "var(--t-bg-card-hover)",
              color: overridesActiveCount > 0 ? "var(--t-accent)" : "var(--t-text-muted)",
            }}
          >
            {overridesActiveCount > 0
              ? `${L.status.customActive} · ${overridesActiveCount}`
              : L.status.usingGlobal}
          </span>
        </div>

        {rules.length === 0 ? (
          <div className="rounded-[20px] border p-6 text-center" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
            <p className="text-sm" style={{ color: "var(--t-text-muted)" }}>{L.empty.noRules}</p>
            <p className="text-xs mt-1" style={{ color: "var(--t-text-muted)" }}>{L.empty.noRulesHint}</p>
          </div>
        ) : (
          <div className="rounded-[20px] border overflow-hidden" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
            {rules.map((rule, idx) => (
              <PricingOverrideRow
                key={rule.id}
                customerId={customerId}
                rule={rule}
                override={overridesByRuleId.get(rule.id) ?? null}
                isLast={idx === rules.length - 1}
                onChanged={fetchData}
                onToast={toast}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Section 2: Surcharge Amounts ── */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--t-text-primary)" }}>
              {L.sections.surcharges}
            </h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--t-text-muted)" }}>
              {L.sections.surchargesDescription}
            </p>
          </div>
          <span
            className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold shrink-0"
            style={{
              background: surcharges.length > 0
                ? "var(--t-accent-soft, rgba(34,197,94,0.12))"
                : "var(--t-bg-card-hover)",
              color: surcharges.length > 0 ? "var(--t-accent)" : "var(--t-text-muted)",
            }}
          >
            {surcharges.length > 0
              ? `${L.status.customSurchargesActive} · ${surcharges.length}`
              : L.status.usingGlobalSurcharges}
          </span>
        </div>

        {allTemplates.length === 0 ? (
          <div className="rounded-[20px] border p-6 text-center" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
            <p className="text-sm" style={{ color: "var(--t-text-muted)" }}>{L.empty.noSurcharges}</p>
          </div>
        ) : (
          <div className="rounded-[20px] border overflow-hidden" style={{ background: "var(--t-bg-card)", borderColor: "var(--t-border)" }}>
            {allTemplates.map((tpl, idx) => (
              <SurchargeOverrideRow
                key={tpl.id}
                customerId={customerId}
                template={tpl}
                override={surcharges.find((s) => s.surcharge_template_id === tpl.id) ?? null}
                isLast={idx === allTemplates.length - 1}
                onChanged={fetchData}
                onToast={toast}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Single editable row for a pricing rule → customer override. */
function PricingOverrideRow({
  customerId,
  rule,
  override,
  isLast,
  onChanged,
  onToast,
}: {
  customerId: string;
  rule: PricingRuleLite;
  override: PricingOverride | null;
  isLast: boolean;
  onChanged: () => void;
  onToast: (variant: "success" | "error" | "warning", msg: string) => void;
}) {
  const L = CUSTOMER_DASHBOARD_LABELS.pricing;
  const [input, setInput] = useState<string>(
    override?.base_price != null ? String(override.base_price) : "",
  );
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Keep input in sync if parent refetches
  useEffect(() => {
    setInput(override?.base_price != null ? String(override.base_price) : "");
  }, [override?.base_price]);

  const globalBase = Number(rule.base_price);
  const parsed = input.trim() === "" ? null : Number(input);
  const isValid = parsed !== null && !isNaN(parsed) && parsed > 0;
  const currentOverride = override?.base_price != null ? Number(override.base_price) : null;
  const isDirty = isValid && parsed !== currentOverride;
  const effective = currentOverride ?? globalBase;

  const handleSave = async () => {
    if (!isValid || !isDirty) return;
    setSaving(true);
    try {
      if (override) {
        await api.put(`/customers/${customerId}/pricing-overrides/${override.id}`, {
          base_price: parsed,
        });
      } else {
        await api.post(`/customers/${customerId}/pricing-overrides`, {
          customer_id: customerId,
          pricing_rule_id: rule.id,
          base_price: parsed,
        });
      }
      onToast("success", L.toast.saved);
      onChanged();
    } catch {
      onToast("error", L.toast.failed);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!override) return;
    setClearing(true);
    try {
      await api.delete(`/customers/${customerId}/pricing-overrides/${override.id}`);
      onToast("success", L.toast.cleared);
      onChanged();
    } catch {
      onToast("error", L.toast.failed);
    } finally {
      setClearing(false);
    }
  };

  const hasOverride = currentOverride != null;

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 flex-wrap"
      style={{ borderBottom: isLast ? "none" : "1px solid var(--t-border)" }}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>
          {rule.asset_subtype}
        </p>
        <p className="text-[10px]" style={{ color: "var(--t-text-muted)" }}>
          {L.fields.global}: {formatCurrency(globalBase)}
          {" · "}
          {L.fields.effective}:{" "}
          <span style={{ color: hasOverride ? "var(--t-accent)" : "var(--t-text-muted)", fontWeight: hasOverride ? 600 : 400 }}>
            {formatCurrency(effective)}
          </span>
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="relative">
          <span
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs pointer-events-none"
            style={{ color: "var(--t-text-muted)" }}
          >
            $
          </span>
          <input
            type="number"
            inputMode="decimal"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={L.fields.overridePlaceholder}
            className="w-28 rounded-full border bg-[var(--t-bg-card-hover)] pl-5 pr-2.5 py-1.5 text-xs text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] transition-colors tabular-nums"
            style={{ borderColor: "var(--t-border)" }}
          />
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || !isValid || saving}
          className="rounded-full px-3 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-40"
          style={{
            background: "var(--t-accent)",
            color: "var(--t-accent-on-accent)",
            cursor: !isDirty || !isValid ? "not-allowed" : "pointer",
          }}
        >
          {saving ? L.actions.saving : L.actions.save}
        </button>
        {hasOverride && (
          <button
            type="button"
            onClick={handleClear}
            disabled={clearing}
            className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40"
            style={{
              borderColor: "var(--t-border)",
              color: "var(--t-text-muted)",
            }}
          >
            {clearing ? "…" : L.actions.clear}
          </button>
        )}
      </div>
    </div>
  );
}

/** Single editable row for a surcharge template → customer override. */
function SurchargeOverrideRow({
  customerId,
  template,
  override,
  isLast,
  onChanged,
  onToast,
}: {
  customerId: string;
  template: { id: string; name: string; default_amount: number };
  override: SurchargeOverride | null;
  isLast: boolean;
  onChanged: () => void;
  onToast: (variant: "success" | "error" | "warning", msg: string) => void;
}) {
  const L = CUSTOMER_DASHBOARD_LABELS.pricing;
  const [input, setInput] = useState<string>(
    override?.amount != null ? String(override.amount) : "",
  );
  const [active, setActive] = useState<boolean>(override?.available_for_billing ?? true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    setInput(override?.amount != null ? String(override.amount) : "");
    setActive(override?.available_for_billing ?? true);
  }, [override?.amount, override?.available_for_billing]);

  const defaultAmount = Number(template.default_amount);
  const parsed = input.trim() === "" ? null : Number(input);
  const isValid = parsed !== null && !isNaN(parsed) && parsed >= 0;
  const currentAmount = override?.amount != null ? Number(override.amount) : null;
  const currentActive = override?.available_for_billing ?? true;
  const isDirty =
    (isValid && parsed !== currentAmount) ||
    (override != null && active !== currentActive);

  const effective = override && currentActive ? currentAmount! : defaultAmount;
  const hasOverride = override != null;

  const handleSave = async () => {
    if (!isValid || !isDirty) return;
    setSaving(true);
    try {
      if (override) {
        await api.put(`/customers/${customerId}/surcharge-overrides/${override.id}`, {
          amount: parsed,
          available_for_billing: active,
        });
      } else {
        await api.post(`/customers/${customerId}/surcharge-overrides`, {
          customer_id: customerId,
          surcharge_template_id: template.id,
          amount: parsed,
          available_for_billing: active,
        });
      }
      onToast("success", L.toast.saved);
      onChanged();
    } catch {
      onToast("error", L.toast.failed);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!override) return;
    setClearing(true);
    try {
      await api.delete(`/customers/${customerId}/surcharge-overrides/${override.id}`);
      onToast("success", L.toast.cleared);
      onChanged();
    } catch {
      onToast("error", L.toast.failed);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 flex-wrap"
      style={{ borderBottom: isLast ? "none" : "1px solid var(--t-border)" }}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium" style={{ color: "var(--t-text-primary)" }}>
          {template.name}
        </p>
        <p className="text-[10px]" style={{ color: "var(--t-text-muted)" }}>
          {L.fields.default}: {formatCurrency(defaultAmount)}
          {" · "}
          {L.fields.effective}:{" "}
          <span
            style={{
              color: hasOverride && currentActive ? "var(--t-accent)" : "var(--t-text-muted)",
              fontWeight: hasOverride && currentActive ? 600 : 400,
            }}
          >
            {formatCurrency(effective)}
          </span>
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="relative">
          <span
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs pointer-events-none"
            style={{ color: "var(--t-text-muted)" }}
          >
            $
          </span>
          <input
            type="number"
            inputMode="decimal"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={L.fields.overridePlaceholder}
            className="w-24 rounded-full border bg-[var(--t-bg-card-hover)] pl-5 pr-2.5 py-1.5 text-xs text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] transition-colors tabular-nums"
            style={{ borderColor: "var(--t-border)" }}
          />
        </div>

        {/* Active toggle — only meaningful once an override exists */}
        <label
          className={`inline-flex items-center gap-1.5 ${hasOverride ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
        >
          <button
            type="button"
            onClick={() => hasOverride && setActive((v) => !v)}
            disabled={!hasOverride}
            className={`relative h-5 w-9 rounded-full transition-colors ${
              active ? "bg-[var(--t-accent)]" : "bg-[var(--t-bg-card-hover)]"
            }`}
            style={{ border: "1px solid var(--t-border)" }}
          >
            <span
              className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                active ? "left-[18px]" : "left-0.5"
              }`}
            />
          </button>
          <span className="text-[10px]" style={{ color: "var(--t-text-muted)" }}>
            {L.fields.active}
          </span>
        </label>

        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || !isValid || saving}
          className="rounded-full px-3 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-40"
          style={{
            background: "var(--t-accent)",
            color: "var(--t-accent-on-accent)",
            cursor: !isDirty || !isValid ? "not-allowed" : "pointer",
          }}
        >
          {saving ? L.actions.saving : L.actions.save}
        </button>
        {hasOverride && (
          <button
            type="button"
            onClick={handleClear}
            disabled={clearing}
            className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40"
            style={{
              borderColor: "var(--t-border)",
              color: "var(--t-text-muted)",
            }}
          >
            {clearing ? "…" : L.actions.clear}
          </button>
        )}
      </div>
    </div>
  );
}
