"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Truck, MapPin, Calendar, Package, DollarSign, CheckCircle2, Clock, ArrowRight, FileText, Pencil, CalendarClock, Repeat } from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { FEATURE_REGISTRY } from "@/lib/feature-registry";
import { deriveDisplayStatus, DISPLAY_STATUS_LABELS, displayStatusColor } from "@/lib/job-status";

/* ── Types (from /rental-chains/:id/lifecycle response) ── */

interface LifecycleJob {
  id: string;
  linkId?: string;
  linkStatus?: string;
  jobNumber: string;
  taskType: string;
  status: string;
  scheduledDate: string;
  completedAt: string | null;
  asset: { subtype: string; identifier: string } | null;
  driver: { name: string } | null;
}

interface LifecycleInvoice {
  id: string;
  invoiceNumber: number;
  total: number;
  status: string;
  balanceDue: number;
}

interface LifecyclePayment {
  id: string;
  amount: number;
  status: string;
  paymentMethod: string;
  appliedAt: string;
}

interface LifecycleData {
  rentalChain: {
    id: string;
    status: string;
    dumpsterSize: string;
    rentalDays: number;
    dropOffDate: string;
    expectedPickupDate: string | null;
    createdAt: string;
  };
  customer: { id: string; name: string; accountId: string } | null;
  jobs: LifecycleJob[];
  invoices: LifecycleInvoice[];
  payments: LifecyclePayment[];
  financials: { revenue: number; cost: number; profit: number; margin: number };
}

/* ── Helpers ── */

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const TASK_TYPE_LABELS: Record<string, string> = {
  drop_off: FEATURE_REGISTRY.rental_lifecycle_task_drop_off?.label ?? "Delivery",
  pick_up: FEATURE_REGISTRY.rental_lifecycle_task_pick_up?.label ?? "Pickup",
  exchange: FEATURE_REGISTRY.rental_lifecycle_task_exchange?.label ?? "Exchange",
};

const TASK_TYPE_COLORS: Record<string, string> = {
  drop_off: "text-blue-400",
  pick_up: "text-orange-400",
  exchange: "text-purple-400",
};

const STATUS_LABELS: Record<string, string> = {
  active: FEATURE_REGISTRY.rental_lifecycle_status_active?.label ?? "Active",
  completed: FEATURE_REGISTRY.rental_lifecycle_status_completed?.label ?? "Completed",
  cancelled: "Cancelled",
};

/* ── Page ── */

export default function RentalLifecyclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<LifecycleData | null>(null);
  const [loading, setLoading] = useState(true);
  // Edit pickup / extend modal state
  const [pickupModalOpen, setPickupModalOpen] = useState(false);
  const [pickupDate, setPickupDate] = useState("");
  const [pickupSaving, setPickupSaving] = useState(false);
  const [pickupError, setPickupError] = useState("");
  // Schedule exchange modal state
  const [exchangeModalOpen, setExchangeModalOpen] = useState(false);
  const [exchangeDate, setExchangeDate] = useState("");
  const [exchangeSize, setExchangeSize] = useState("");
  const [exchangeOverridePickup, setExchangeOverridePickup] = useState("");
  const [exchangeSaving, setExchangeSaving] = useState(false);
  const [exchangeError, setExchangeError] = useState("");
  // Active dumpster sizes from tenant pricing rules — driven by
  // `pricing_rules.asset_subtype` where is_active=true. Fetched once
  // when the modal first opens so typical page loads stay lean.
  const [availableSizes, setAvailableSizes] = useState<string[] | null>(null);
  const [sizesLoading, setSizesLoading] = useState(false);
  // Edit delivery date modal state
  const [deliveryModalOpen, setDeliveryModalOpen] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryShift, setDeliveryShift] = useState(true);
  const [deliverySaving, setDeliverySaving] = useState(false);
  const [deliveryError, setDeliveryError] = useState("");
  // Edit existing exchange modal state (keyed by linkId so the
  // timeline pencil icon opens the modal for the specific exchange row)
  const [editExchangeLinkId, setEditExchangeLinkId] = useState<string | null>(null);
  const [editExchangeDate, setEditExchangeDate] = useState("");
  const [editExchangeOverride, setEditExchangeOverride] = useState("");
  const [editExchangeSaving, setEditExchangeSaving] = useState(false);
  const [editExchangeError, setEditExchangeError] = useState("");

  const reload = () => api.get<LifecycleData>(`/rental-chains/${id}/lifecycle`).then(setData).catch(() => {});

  useEffect(() => {
    api.get<LifecycleData>(`/rental-chains/${id}/lifecycle`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  // Lazy-load active pricing sizes the first time the exchange modal
  // is opened. The pricing endpoint already filters `is_active = true`
  // by default, so deactivated sizes (e.g. 30yd/40yd) never surface.
  useEffect(() => {
    if (!exchangeModalOpen || availableSizes !== null || sizesLoading) return;
    setSizesLoading(true);
    api.get<{ data: Array<{ asset_subtype: string }> }>("/pricing?limit=100")
      .then((res) => {
        const uniq = Array.from(
          new Set(
            (res.data || [])
              .map((p) => p.asset_subtype)
              .filter((s): s is string => typeof s === "string" && s.length > 0),
          ),
        );
        setAvailableSizes(uniq);
      })
      .catch(() => setAvailableSizes([]))
      .finally(() => setSizesLoading(false));
  }, [exchangeModalOpen, availableSizes, sizesLoading]);

  const handlePickupDateUpdate = async () => {
    if (!data || !pickupDate) return;
    // Validate: pickup must be after delivery
    const deliveryDate = data.rentalChain.dropOffDate;
    if (deliveryDate && pickupDate <= deliveryDate) {
      setPickupError(FEATURE_REGISTRY.lifecycle_action_pickup_before_delivery?.label ?? "Pickup date must be after delivery date");
      return;
    }
    setPickupSaving(true);
    setPickupError("");
    try {
      // Authoritative lifecycle update — the backend keeps the chain
      // row and the linked pickup job's scheduled_date in sync inside
      // a single transaction, so there is no more drift between
      // `/jobs/:id` and `/rental-chains/:id`.
      await api.patch(`/rental-chains/${id}`, { expected_pickup_date: pickupDate });
      setPickupModalOpen(false);
      setPickupDate("");
      await reload();
    } catch (err: unknown) {
      setPickupError(err instanceof Error ? err.message : (FEATURE_REGISTRY.lifecycle_action_error?.label ?? "Failed to update"));
    } finally {
      setPickupSaving(false);
    }
  };

  const handleDeliveryUpdate = async () => {
    if (!data || !deliveryDate) return;
    if (deliveryDate === data.rentalChain.dropOffDate) {
      setDeliveryError(FEATURE_REGISTRY.delivery_date_unchanged?.label ?? "New delivery date matches the current date");
      return;
    }
    setDeliverySaving(true);
    setDeliveryError("");
    try {
      await api.patch(`/rental-chains/${id}`, {
        drop_off_date: deliveryDate,
        shift_downstream: deliveryShift,
      });
      setDeliveryModalOpen(false);
      setDeliveryDate("");
      await reload();
    } catch (err: unknown) {
      setDeliveryError(err instanceof Error ? err.message : (FEATURE_REGISTRY.lifecycle_update_error?.label ?? "Failed to update lifecycle"));
    } finally {
      setDeliverySaving(false);
    }
  };

  const handleExchangeReschedule = async () => {
    if (!data || !editExchangeLinkId || !editExchangeDate) return;
    const deliveryDateStr = data.rentalChain.dropOffDate;
    if (deliveryDateStr && editExchangeDate < deliveryDateStr) {
      setEditExchangeError(FEATURE_REGISTRY.lifecycle_action_exchange_before_delivery?.label ?? "Exchange date cannot be before delivery date");
      return;
    }
    if (editExchangeOverride && editExchangeOverride <= editExchangeDate) {
      setEditExchangeError(FEATURE_REGISTRY.lifecycle_action_pickup_before_exchange?.label ?? "Pickup date must be after exchange date");
      return;
    }
    setEditExchangeSaving(true);
    setEditExchangeError("");
    try {
      await api.patch(`/rental-chains/${id}/exchanges/${editExchangeLinkId}`, {
        exchange_date: editExchangeDate,
        ...(editExchangeOverride ? { override_pickup_date: editExchangeOverride } : {}),
      });
      setEditExchangeLinkId(null);
      setEditExchangeDate("");
      setEditExchangeOverride("");
      await reload();
    } catch (err: unknown) {
      setEditExchangeError(err instanceof Error ? err.message : (FEATURE_REGISTRY.lifecycle_update_error?.label ?? "Failed to update lifecycle"));
    } finally {
      setEditExchangeSaving(false);
    }
  };

  const handleScheduleExchange = async () => {
    if (!data || !exchangeDate) return;
    // Validate: exchange must be on or after delivery
    const deliveryDate = data.rentalChain.dropOffDate;
    if (deliveryDate && exchangeDate < deliveryDate) {
      setExchangeError(FEATURE_REGISTRY.lifecycle_action_exchange_before_delivery?.label ?? "Exchange date cannot be before delivery date");
      return;
    }
    if (exchangeOverridePickup && exchangeOverridePickup <= exchangeDate) {
      setExchangeError(FEATURE_REGISTRY.lifecycle_action_pickup_before_exchange?.label ?? "Pickup date must be after exchange date");
      return;
    }
    setExchangeSaving(true);
    setExchangeError("");
    try {
      await api.post(`/rental-chains/${id}/exchanges`, {
        exchange_date: exchangeDate,
        ...(exchangeSize ? { dumpster_size: exchangeSize } : {}),
        ...(exchangeOverridePickup ? { override_pickup_date: exchangeOverridePickup } : {}),
      });
      setExchangeModalOpen(false);
      setExchangeDate("");
      setExchangeSize("");
      setExchangeOverridePickup("");
      await reload();
    } catch (err: unknown) {
      setExchangeError(err instanceof Error ? err.message : (FEATURE_REGISTRY.lifecycle_update_error?.label ?? "Failed to schedule exchange"));
    } finally {
      setExchangeSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 rounded-lg bg-[var(--t-bg-card)] animate-pulse" />
        <div className="h-40 rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] animate-pulse" />
        <div className="h-60 rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] animate-pulse" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-[var(--t-text-muted)]">Rental lifecycle not found.</p>
        <button onClick={() => router.back()} className="mt-3 text-sm text-[var(--t-accent)] hover:underline">Go back</button>
      </div>
    );
  }

  const rentalChain = data.rentalChain;
  const customer = data.customer;
  const jobs = data.jobs?.filter(j => j?.id) ?? [];
  const invoices = data.invoices ?? [];
  const payments = data.payments ?? [];
  const financials = data.financials ?? { revenue: 0, cost: 0, profit: 0, margin: 0 };
  const deliveryJob = jobs.find(j => j.taskType === "drop_off");
  const isActive = rentalChain.status === "active";

  return (
    <div className="space-y-6">
      {/* Back */}
      <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-[var(--t-accent)] font-medium hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {/* Header */}
      <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-[var(--t-text-primary)]">
              {FEATURE_REGISTRY.rental_lifecycle?.label ?? "Rental Lifecycle"}
            </h1>
            {customer && (
              <Link href={`/customers/${customer.id}`} className="text-sm text-[var(--t-accent)] hover:underline mt-0.5 block">
                {customer.name}
              </Link>
            )}
          </div>
          <span className={`text-xs font-semibold px-3 py-1 rounded-full ${isActive ? "bg-[var(--t-accent-soft)] text-[var(--t-accent)]" : "bg-[var(--t-bg-elevated)] text-[var(--t-text-muted)]"}`}>
            {STATUS_LABELS[rentalChain.status] || rentalChain.status}
          </span>
        </div>

        {/* Key details grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">
              {FEATURE_REGISTRY.job_detail_delivery_date?.label ?? "Delivery Date"}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-sm font-semibold text-[var(--t-text-primary)]">{fmtDate(rentalChain.dropOffDate)}</p>
              {isActive && (
                <button onClick={() => {
                    setDeliveryModalOpen(true);
                    setDeliveryDate(rentalChain.dropOffDate || "");
                    setDeliveryShift(true);
                    setDeliveryError("");
                  }}
                  className="text-[var(--t-accent)] hover:opacity-70 transition-opacity"
                  title={FEATURE_REGISTRY.edit_delivery_date?.label ?? "Edit Delivery Date"}>
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">
              {FEATURE_REGISTRY.job_detail_pickup_date?.label ?? "Pickup Date"}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-sm font-semibold text-[var(--t-text-primary)]">{fmtDate(rentalChain.expectedPickupDate)}</p>
              {isActive && (
                <button onClick={() => { setPickupModalOpen(true); setPickupDate(rentalChain.expectedPickupDate || ""); setPickupError(""); }}
                  className="text-[var(--t-accent)] hover:opacity-70 transition-opacity" title={FEATURE_REGISTRY.lifecycle_action_edit_pickup?.label ?? "Edit Pickup Date"}>
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Dumpster</p>
            <p className="text-sm font-semibold text-[var(--t-text-primary)] mt-0.5">{rentalChain.dumpsterSize || "—"}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Rental Days</p>
            <p className="text-sm font-semibold text-[var(--t-text-primary)] mt-0.5">{rentalChain.rentalDays ? `${rentalChain.rentalDays} days` : "—"}</p>
          </div>
        </div>

        {/* Address from delivery job */}
        {deliveryJob?.asset && (
          <div className="mt-4 pt-4 border-t border-[var(--t-border)] flex items-center gap-2 text-sm text-[var(--t-text-muted)]">
            <Package className="h-3.5 w-3.5" />
            <span>Asset: <span className="text-[var(--t-text-primary)] font-medium">{deliveryJob.asset.identifier} ({deliveryJob.asset.subtype})</span></span>
          </div>
        )}
      </div>

      {/* Actions */}
      {isActive && (
        <div className="flex gap-2">
          <button onClick={() => { setPickupModalOpen(true); setPickupDate(rentalChain.expectedPickupDate || ""); setPickupError(""); }}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2 text-xs font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
            <Pencil className="h-3 w-3" /> {FEATURE_REGISTRY.lifecycle_action_edit_pickup?.label ?? "Edit Pickup Date"}
          </button>
          <button onClick={() => { setPickupModalOpen(true); setPickupDate(""); setPickupError(""); }}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2 text-xs font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
            <CalendarClock className="h-3 w-3" /> {FEATURE_REGISTRY.lifecycle_action_extend?.label ?? "Extend Rental"}
          </button>
          <button onClick={() => {
              const today = new Date().toISOString().split("T")[0];
              setExchangeModalOpen(true);
              setExchangeDate(today);
              setExchangeSize(rentalChain.dumpsterSize || "");
              setExchangeOverridePickup("");
              setExchangeError("");
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2 text-xs font-medium text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card-hover)] transition-colors">
            <Repeat className="h-3 w-3" /> {FEATURE_REGISTRY.schedule_exchange?.label ?? "Schedule Exchange"}
          </button>
        </div>
      )}

      {/* Connected Tasks */}
      <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="h-4 w-4 text-[var(--t-text-muted)]" />
          <h2 className="text-sm font-semibold text-[var(--t-text-primary)]">
            {FEATURE_REGISTRY.rental_lifecycle_connected_tasks?.label ?? "Connected Tasks"}
          </h2>
        </div>

        {/* Timeline */}
        <div className="space-y-2">
          {jobs.map((job, i) => {
            const status = job.status || "pending";
            const ds = deriveDisplayStatus(status);
            const isDone = status === "completed";
            const isCancelled = status === "cancelled";
            const typeColor = TASK_TYPE_COLORS[job.taskType] || "text-[var(--t-text-muted)]";
            return (
              <div key={job.id || i} className="flex items-center gap-3">
                {/* Sequence indicator */}
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${
                  isDone ? "border-[var(--t-accent)] bg-[var(--t-accent)]" : isCancelled ? "border-[var(--t-error)]/30 bg-transparent" : "border-[var(--t-border)] bg-[var(--t-bg-card)]"
                }`}>
                  {isDone ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-[var(--t-accent-on-accent)]" />
                  ) : (
                    <span className={`text-[10px] font-bold ${isCancelled ? "text-[var(--t-error)]" : "text-[var(--t-text-muted)]"}`}>{i + 1}</span>
                  )}
                </div>
                {/* Task row */}
                <Link href={`/jobs/${job.id}`}
                  className="flex-1 flex items-center justify-between rounded-[14px] border border-[var(--t-border)] px-3.5 py-2.5 hover:bg-[var(--t-bg-card-hover)] transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`text-xs font-semibold ${typeColor}`}>{TASK_TYPE_LABELS[job.taskType] || job.taskType}</span>
                    <span className="text-xs font-medium text-[var(--t-text-primary)]">{job.jobNumber || "—"}</span>
                    <span className="text-xs text-[var(--t-text-muted)]">{fmtDate(job.scheduledDate)}</span>
                    {job.driver && <span className="text-xs text-[var(--t-text-muted)]">· {job.driver.name}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {job.taskType === "exchange" && isActive && job.linkId && status !== "completed" && status !== "cancelled" && job.linkStatus === "scheduled" && (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditExchangeLinkId(job.linkId!);
                          setEditExchangeDate(job.scheduledDate || "");
                          setEditExchangeOverride("");
                          setEditExchangeError("");
                        }}
                        title={FEATURE_REGISTRY.edit_exchange_date?.label ?? "Edit Exchange Date"}
                        className="text-[var(--t-accent)] hover:opacity-70 transition-opacity"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                    <span className="text-[10px] font-semibold" style={{ color: displayStatusColor(ds) }}>
                      {DISPLAY_STATUS_LABELS[ds] || status}
                    </span>
                    <ArrowRight className="h-3 w-3 text-[var(--t-text-muted)]" />
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      </div>

      {/* Financials */}
      {(invoices.length > 0 || financials.revenue > 0) && (
        <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="h-4 w-4 text-[var(--t-text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--t-text-primary)]">
              {FEATURE_REGISTRY.rental_lifecycle_financials?.label ?? "Financials"}
            </h2>
          </div>

          {/* Summary row */}
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Revenue</p>
              <p className="text-sm font-bold text-[var(--t-text-primary)] tabular-nums">{formatCurrency(financials.revenue)}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Cost</p>
              <p className="text-sm font-bold text-[var(--t-text-primary)] tabular-nums">{formatCurrency(financials.cost)}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Profit</p>
              <p className={`text-sm font-bold tabular-nums ${financials.profit >= 0 ? "text-[var(--t-accent)]" : "text-[var(--t-error)]"}`}>{formatCurrency(financials.profit)}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)]">Margin</p>
              <p className="text-sm font-bold text-[var(--t-text-primary)] tabular-nums">{(financials.margin ?? 0).toFixed(1)}%</p>
            </div>
          </div>

          {/* Invoices */}
          {invoices.length > 0 && (
            <div className="border-t border-[var(--t-border)] pt-4 space-y-2">
              {invoices.map(inv => {
                const isPaid = inv.status === "paid";
                const isOverdue = inv.status === "open" && inv.balanceDue > 0;
                return (
                  <Link key={inv.id} href={`/invoices`}
                    className="flex items-center justify-between rounded-[14px] border border-[var(--t-border)] px-3.5 py-2.5 hover:bg-[var(--t-bg-card-hover)] transition-colors">
                    <div className="flex items-center gap-3">
                      <FileText className="h-3.5 w-3.5 text-[var(--t-text-muted)]" />
                      <span className="text-xs font-medium text-[var(--t-text-primary)]">Invoice #{inv.invoiceNumber}</span>
                      <span className="text-xs text-[var(--t-text-muted)] tabular-nums">{formatCurrency(inv.total)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {!isPaid && inv.balanceDue > 0 && (
                        <span className="text-[10px] font-semibold text-amber-500 tabular-nums">Due: {formatCurrency(inv.balanceDue)}</span>
                      )}
                      <span className={`text-[10px] font-semibold ${isPaid ? "text-[var(--t-accent)]" : isOverdue ? "text-[var(--t-error)]" : "text-amber-500"}`}>
                        {isPaid ? "Paid" : inv.status === "draft" ? "Draft" : "Unpaid"}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Payments */}
          {payments.length > 0 && (
            <div className="border-t border-[var(--t-border)] pt-3 mt-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--t-text-muted)] mb-2">Payments</p>
              <div className="space-y-1.5">
                {payments.map(p => (
                  <div key={p.id} className="flex items-center justify-between text-xs">
                    <span className="text-[var(--t-text-muted)]">{p.paymentMethod || "—"} · {p.appliedAt ? new Date(p.appliedAt).toLocaleDateString() : "—"}</span>
                    <span className={`font-medium tabular-nums ${p.status === "completed" ? "text-[var(--t-accent)]" : "text-[var(--t-text-muted)]"}`}>{formatCurrency(p.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {/* Edit Delivery Date Modal */}
      {deliveryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => setDeliveryModalOpen(false)}>
          <div className="rounded-2xl border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-1">
              {FEATURE_REGISTRY.edit_delivery_date?.label ?? "Edit Delivery Date"}
            </h3>
            <p className="text-xs text-[var(--t-text-muted)] mb-4">
              {FEATURE_REGISTRY.edit_delivery_date_description?.label ?? "Reschedule the delivery. Downstream tasks shift by the same number of days unless you opt out."}
            </p>
            <label className="text-xs text-[var(--t-text-muted)] mb-1 block">
              {FEATURE_REGISTRY.lifecycle_action_new_date?.label ?? "New pickup date"}
            </label>
            <input type="date" value={deliveryDate}
              onChange={e => { setDeliveryDate(e.target.value); setDeliveryError(""); }}
              className="w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] mb-3" />

            <label className="flex items-start gap-2 text-xs text-[var(--t-text-primary)] mb-1 cursor-pointer">
              <input type="checkbox" checked={deliveryShift}
                onChange={e => setDeliveryShift(e.target.checked)}
                className="mt-0.5" />
              <span>{FEATURE_REGISTRY.downstream_dates_shifted?.label ?? "Shift downstream exchange and pickup dates by the same number of days"}</span>
            </label>
            <p className="text-[10px] text-[var(--t-text-muted)] mb-3 ml-5">
              {deliveryShift
                ? (FEATURE_REGISTRY.downstream_dates_shifted_on_hint?.label ?? "Keeps the rental duration intact.")
                : (FEATURE_REGISTRY.downstream_dates_shifted_off_hint?.label ?? "Downstream dates stay put — the request fails if any would become invalid.")}
            </p>

            {deliveryError && (
              <p className="text-xs text-[var(--t-error)] mb-3">{deliveryError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeliveryModalOpen(false)} className="rounded-full px-4 py-2 text-xs font-medium text-[var(--t-text-muted)]">
                Cancel
              </button>
              <button onClick={handleDeliveryUpdate} disabled={!deliveryDate || deliverySaving}
                className="rounded-full bg-[var(--t-accent)] px-4 py-2 text-xs font-semibold text-[var(--t-accent-on-accent)] disabled:opacity-40 hover:opacity-90 transition-opacity">
                {deliverySaving ? (FEATURE_REGISTRY.lifecycle_action_saving?.label ?? "Saving...") : (FEATURE_REGISTRY.lifecycle_action_confirm?.label ?? "Confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Exchange Date Modal */}
      {editExchangeLinkId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => setEditExchangeLinkId(null)}>
          <div className="rounded-2xl border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-1">
              {FEATURE_REGISTRY.edit_exchange_date?.label ?? "Edit Exchange Date"}
            </h3>
            <p className="text-xs text-[var(--t-text-muted)] mb-4">
              {FEATURE_REGISTRY.edit_exchange_date_description?.label ?? "Reschedule this exchange. The downstream pickup is recalculated from your tenant rental period unless you override it."}
            </p>
            <label className="text-xs text-[var(--t-text-muted)] mb-1 block">
              {FEATURE_REGISTRY.exchange_date?.label ?? "Exchange date"}
            </label>
            <input type="date" value={editExchangeDate}
              onChange={e => { setEditExchangeDate(e.target.value); setEditExchangeError(""); }}
              min={rentalChain.dropOffDate || undefined}
              className="w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] mb-3" />

            <label className="text-xs text-[var(--t-text-muted)] mb-1 block">
              {FEATURE_REGISTRY.override_pickup_date?.label ?? "Override pickup date (optional)"}
            </label>
            <input type="date" value={editExchangeOverride}
              onChange={e => { setEditExchangeOverride(e.target.value); setEditExchangeError(""); }}
              min={editExchangeDate || undefined}
              className="w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] mb-1" />
            <p className="text-[10px] text-[var(--t-text-muted)] mb-3">
              {FEATURE_REGISTRY.override_pickup_date_hint?.label ?? "Leave blank to auto-calculate from your tenant rental period."}
            </p>

            {editExchangeError && (
              <p className="text-xs text-[var(--t-error)] mb-3">{editExchangeError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditExchangeLinkId(null)} className="rounded-full px-4 py-2 text-xs font-medium text-[var(--t-text-muted)]">
                Cancel
              </button>
              <button onClick={handleExchangeReschedule} disabled={!editExchangeDate || editExchangeSaving}
                className="rounded-full bg-[var(--t-accent)] px-4 py-2 text-xs font-semibold text-[var(--t-accent-on-accent)] disabled:opacity-40 hover:opacity-90 transition-opacity">
                {editExchangeSaving ? (FEATURE_REGISTRY.lifecycle_action_saving?.label ?? "Saving...") : (FEATURE_REGISTRY.lifecycle_action_confirm?.label ?? "Confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Exchange Modal */}
      {exchangeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => setExchangeModalOpen(false)}>
          <div className="rounded-2xl border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-1">
              {FEATURE_REGISTRY.schedule_exchange?.label ?? "Schedule Exchange"}
            </h3>
            <p className="text-xs text-[var(--t-text-muted)] mb-4">
              {FEATURE_REGISTRY.schedule_exchange_description?.label ?? "Swap the dumpster on this rental. A new pickup is automatically scheduled based on your tenant's default rental period."}
            </p>

            <label className="text-xs text-[var(--t-text-muted)] mb-1 block">
              {FEATURE_REGISTRY.exchange_date?.label ?? "Exchange date"}
            </label>
            <input type="date" value={exchangeDate}
              onChange={e => { setExchangeDate(e.target.value); setExchangeError(""); }}
              min={rentalChain.dropOffDate || undefined}
              className="w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] mb-3" />

            <label className="text-xs text-[var(--t-text-muted)] mb-1 block">
              {FEATURE_REGISTRY.new_dumpster_size?.label ?? "New dumpster size"}
            </label>
            {(() => {
              // Resolve option list: current size is always included
              // so the dropdown never shows "no active sizes" when the
              // rental itself is on a size that was recently deactivated.
              const currentSize = rentalChain.dumpsterSize || "";
              const baseList = availableSizes ?? [];
              const hasCurrent = currentSize && baseList.includes(currentSize);
              const options = hasCurrent || !currentSize ? baseList : [currentSize, ...baseList];
              const isEmpty = !sizesLoading && options.length === 0;
              return (
                <>
                  <select
                    value={exchangeSize}
                    onChange={e => setExchangeSize(e.target.value)}
                    disabled={sizesLoading || isEmpty}
                    className="w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] mb-1 disabled:opacity-50"
                  >
                    {sizesLoading && <option value="">{FEATURE_REGISTRY.select_dumpster_size_loading?.label ?? "Loading sizes…"}</option>}
                    {!sizesLoading && isEmpty && <option value="">{FEATURE_REGISTRY.no_available_sizes?.label ?? "No active sizes available"}</option>}
                    {!sizesLoading && !isEmpty && (
                      <>
                        {!exchangeSize && <option value="" disabled>{FEATURE_REGISTRY.select_dumpster_size?.label ?? "Select a size"}</option>}
                        {options.map(size => (
                          <option key={size} value={size}>{size}</option>
                        ))}
                      </>
                    )}
                  </select>
                  <p className="text-[10px] text-[var(--t-text-muted)] mb-3">
                    {isEmpty
                      ? (FEATURE_REGISTRY.no_available_sizes_hint?.label ?? "Add an active pricing rule to enable exchanges.")
                      : (FEATURE_REGISTRY.new_dumpster_size_hint?.label ?? "Pre-filled with the current rental size.")}
                  </p>
                </>
              );
            })()}

            <label className="text-xs text-[var(--t-text-muted)] mb-1 block">
              {FEATURE_REGISTRY.override_pickup_date?.label ?? "Override pickup date (optional)"}
            </label>
            <input type="date" value={exchangeOverridePickup}
              onChange={e => { setExchangeOverridePickup(e.target.value); setExchangeError(""); }}
              min={exchangeDate || undefined}
              className="w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] mb-1" />
            <p className="text-[10px] text-[var(--t-text-muted)] mb-3">
              {FEATURE_REGISTRY.override_pickup_date_hint?.label ?? "Leave blank to auto-calculate from your tenant rental period."}
            </p>

            {exchangeError && (
              <p className="text-xs text-[var(--t-error)] mb-3">{exchangeError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setExchangeModalOpen(false)} className="rounded-full px-4 py-2 text-xs font-medium text-[var(--t-text-muted)]">
                Cancel
              </button>
              <button onClick={handleScheduleExchange} disabled={!exchangeDate || !exchangeSize || exchangeSaving}
                className="rounded-full bg-[var(--t-accent)] px-4 py-2 text-xs font-semibold text-[var(--t-accent-on-accent)] disabled:opacity-40 hover:opacity-90 transition-opacity">
                {exchangeSaving ? (FEATURE_REGISTRY.lifecycle_action_saving?.label ?? "Saving...") : (FEATURE_REGISTRY.lifecycle_action_confirm?.label ?? "Confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Pickup Date / Extend Rental Modal */}
      {pickupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => setPickupModalOpen(false)}>
          <div className="rounded-2xl border border-[var(--t-border)] bg-[var(--t-bg-card)] p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-[var(--t-text-primary)] mb-1">
              {FEATURE_REGISTRY.lifecycle_action_edit_pickup?.label ?? "Edit Pickup Date"}
            </h3>
            <p className="text-xs text-[var(--t-text-muted)] mb-4">
              {FEATURE_REGISTRY.lifecycle_action_pickup_description?.label ?? "Select a new pickup date for this rental."}
            </p>
            <label className="text-xs text-[var(--t-text-muted)] mb-1 block">
              {FEATURE_REGISTRY.lifecycle_action_new_date?.label ?? "New pickup date"}
            </label>
            <input type="date" value={pickupDate} onChange={e => { setPickupDate(e.target.value); setPickupError(""); }}
              min={rentalChain.dropOffDate ? new Date(new Date(rentalChain.dropOffDate).getTime() + 86400000).toISOString().split("T")[0] : undefined}
              className="w-full rounded-[14px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-3 py-2 text-sm text-[var(--t-text-primary)] outline-none focus:border-[var(--t-accent)] mb-3" />
            {pickupError && (
              <p className="text-xs text-[var(--t-error)] mb-3">{pickupError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setPickupModalOpen(false)} className="rounded-full px-4 py-2 text-xs font-medium text-[var(--t-text-muted)]">
                Cancel
              </button>
              <button onClick={handlePickupDateUpdate} disabled={!pickupDate || pickupSaving}
                className="rounded-full bg-[var(--t-accent)] px-4 py-2 text-xs font-semibold text-[var(--t-accent-on-accent)] disabled:opacity-40 hover:opacity-90 transition-opacity">
                {pickupSaving ? (FEATURE_REGISTRY.lifecycle_action_saving?.label ?? "Saving...") : (FEATURE_REGISTRY.lifecycle_action_confirm?.label ?? "Confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
