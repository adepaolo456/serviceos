"use client";

/**
 * Shared "Record Payment" form. Originally lived inline at the bottom
 * of `web/src/app/(dashboard)/invoices/[id]/page.tsx`. Extracted in
 * Phase 4 of the Blocked workflow so the new Job Blocked Resolution
 * Drawer can reuse it without duplicating the payment-recording logic.
 *
 * Consumers:
 *   - web/src/app/(dashboard)/invoices/[id]/page.tsx → "Record Payment"
 *     SlideOver, opened from the invoice header or the post-create
 *     billing flow's `?openPayment=1` deep-link.
 *   - web/src/components/job-blocked-resolution-drawer.tsx → inline
 *     payment-first resolution path on the Job detail page.
 *
 * Both consumers POST to the same authorized endpoint
 * (`/invoices/:id/payments`) so the existing tenant scoping, payment
 * pipeline, and reconcileBalance behavior remain the single source of
 * truth — there is NO parallel payment system.
 */

import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

const fmt = (n: number | null | undefined) => formatCurrency(n as number);

export interface RecordPaymentFormProps {
  invoiceId: string;
  balanceDue: number;
  onSuccess: () => void;
}

export function RecordPaymentForm({
  invoiceId,
  balanceDue,
  onSuccess,
}: RecordPaymentFormProps) {
  const [amount, setAmount] = useState(String(balanceDue));
  const [method, setMethod] = useState("card");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api.post(`/invoices/${invoiceId}/payments`, {
        amount: Number(amount),
        payment_method: method,
        notes: notes || undefined,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full rounded-[20px] border border-[var(--t-border)] bg-[var(--t-bg-card)] px-4 py-2.5 text-sm text-[var(--t-text-primary)] placeholder-[var(--t-text-muted)] outline-none transition-colors focus:border-[var(--t-accent)]";
  const labelClass = "block text-sm font-medium text-[var(--t-text-primary)] mb-1.5";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-[20px] bg-[var(--t-error-soft)] px-4 py-3 text-sm text-[var(--t-error)]">
          {error}
        </div>
      )}

      <div className="rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-4 text-center">
        <p className="text-xs text-[var(--t-text-muted)] mb-1">Balance Due</p>
        <p className="text-2xl font-bold text-[var(--t-text-primary)] tabular-nums">
          {fmt(balanceDue)}
        </p>
      </div>

      <div>
        <label className={labelClass}>Amount</label>
        <input
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>Payment Method</label>
        <div className="grid grid-cols-4 gap-1 rounded-[20px] bg-[var(--t-bg-card)] border border-[var(--t-border)] p-1">
          {(["card", "ach", "cash", "check"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={`rounded-[10px] py-2 text-sm font-medium capitalize transition-colors ${
                method === m
                  ? "bg-[var(--t-accent)] text-[var(--t-accent-on-accent)]"
                  : "text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)]"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={labelClass}>Notes</label>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={inputClass}
          placeholder="Check #1234, etc."
        />
      </div>

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-full bg-[var(--t-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--t-accent-on-accent)] transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {saving ? "Recording..." : `Record ${fmt(Number(amount))}`}
      </button>
    </form>
  );
}
