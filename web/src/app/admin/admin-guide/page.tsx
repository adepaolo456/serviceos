"use client";

import { CheckCircle2, AlertTriangle, XCircle, ArrowRight } from "lucide-react";

const CARD = "rounded-[20px] border p-5 mb-4";
const TITLE = "text-sm font-bold mb-3";
const LIST = "space-y-2 text-sm";
const ITEM = "flex items-start gap-2";
const BULLET = "mt-1 h-1.5 w-1.5 rounded-full shrink-0";

function Card({ title, children, danger }: { title: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <div
      className={CARD}
      style={{
        backgroundColor: "var(--t-bg-secondary)",
        borderColor: danger ? "var(--t-error)" : "var(--t-border)",
        borderLeftWidth: danger ? 3 : 1,
      }}
    >
      <h3 className={TITLE} style={{ color: danger ? "var(--t-error)" : "var(--t-text-primary)" }}>{title}</h3>
      <div className={LIST} style={{ color: "var(--t-text-muted)" }}>{children}</div>
    </div>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <div className={ITEM}>
      <span className={BULLET} style={{ backgroundColor: "var(--t-accent)" }} />
      <span>{children}</span>
    </div>
  );
}

function StatusFlow() {
  const steps = ["Draft", "Open", "Partial", "Paid"];
  return (
    <div className="flex items-center gap-1 flex-wrap mb-2">
      {steps.map((s, i) => (
        <span key={s} className="flex items-center gap-1">
          <span
            className="rounded-full px-3 py-1 text-xs font-semibold"
            style={{
              backgroundColor: s === "Paid" ? "var(--t-accent-soft)" : "var(--t-bg-card)",
              color: s === "Paid" ? "var(--t-accent)" : "var(--t-text-primary)",
              border: "1px solid var(--t-border)",
            }}
          >
            {s}
          </span>
          {i < steps.length - 1 && <ArrowRight className="h-3 w-3" style={{ color: "var(--t-text-muted)" }} />}
        </span>
      ))}
      <span className="ml-2 text-xs" style={{ color: "var(--t-text-muted)" }}>
        or <span className="rounded-full px-2 py-0.5 text-xs" style={{ backgroundColor: "var(--t-error-soft)", color: "var(--t-error)" }}>Voided</span>
      </span>
    </div>
  );
}

export default function AdminGuidePage() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold mb-1" style={{ color: "var(--t-frame-text)" }}>
        Admin Guide
      </h1>
      <p className="text-sm mb-1" style={{ color: "var(--t-frame-text-muted)" }}>
        System rules, workflows, and operational checklists
      </p>
      <p className="text-xs mb-6" style={{ color: "var(--t-text-muted)", opacity: 0.6 }}>
        Internal reference only &mdash; not visible to customers.
      </p>

      {/* Core Rules */}
      <Card title="Core Rules">
        <Li>Pricing is automatic &mdash; do not override</Li>
        <Li>Invoice balances come from payments</Li>
        <Li>Never manually set invoice status</Li>
        <Li>Every dump ticket creates a job cost</Li>
        <Li>Every invoice must have a rental chain + snapshot</Li>
      </Card>

      {/* Booking Flow */}
      <Card title="Booking Flow">
        <Li>Use <strong>Quick Quote</strong> from the sidebar (or keyboard B) for new bookings, or <strong>New Job</strong> from a customer dashboard for repeat work</Li>
        <Li>System auto-creates: Job &rarr; Invoice (draft) &rarr; Pricing snapshot &rarr; Rental chain &rarr; Task chain links</Li>
        <Li>Distance charge added automatically if &gt; 15 miles from yard ($25 per 5-mile band)</Li>
        <Li>Card payments create a Payment record and set status to &ldquo;paid&rdquo;</Li>
        <Li>Invoice payments mark as &ldquo;open&rdquo; and sent to customer</Li>
      </Card>

      {/* Invoice Lifecycle */}
      <Card title="Invoice Lifecycle">
        <StatusFlow />
        <Li>Status updates <strong>automatically</strong> based on payments via reconcileBalance</Li>
        <Li>Draft &rarr; Open: when invoice is sent (sent_at set)</Li>
        <Li>Open &rarr; Partial: when some payment received</Li>
        <Li>Partial/Open &rarr; Paid: when total paid &ge; invoice total</Li>
        <Li>Any &rarr; Voided: via void workflow (sets voided_at, creates credit memo)</Li>
      </Card>

      {/* Dump Tickets */}
      <Card title="Dump Tickets">
        <Li>Auto-creates a separate draft invoice for customer overage charges</Li>
        <Li>Creates a <strong>job_cost</strong> record for COGS tracking</Li>
        <Li>Duplicate tickets blocked (unique constraint on job_id + ticket_number)</Li>
        <Li>Overage rate: <strong>$185/ton</strong> prorated from pricing_rules (not dump facility rate)</Li>
        <Li>Surcharge items (mattress, tire, etc.) added as separate line items</Li>
      </Card>

      {/* Payments */}
      <Card title="Payments">
        <Li>Payments update invoice status automatically via <strong>reconcileBalance</strong></Li>
        <Li>Overpayments create credit memos (idempotent &mdash; one per invoice max)</Li>
        <Li>Credit memo amount updates if overpayment changes</Li>
        <Li>Never mark an invoice paid without a payment record</Li>
      </Card>

      {/* Dashboard & Integrity */}
      <Card title="Dashboard & Integrity">
        <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--t-text-muted)" }}>Daily checks</p>
        <Li>Revenue (post-correction)</Li>
        <Li>AR: open + overdue balances</Li>
        <Li>Fleet utilization</Li>
        <Li>Integrity check: <code className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--t-bg-card)", color: "var(--t-text-primary)" }}>GET /reporting/integrity-check</code></Li>
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-2 text-xs">
            <XCircle className="h-3.5 w-3.5" style={{ color: "var(--t-error)" }} />
            <span><strong>Critical</strong> = must be 0 (balance mismatch, duplicate tickets)</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <AlertTriangle className="h-3.5 w-3.5" style={{ color: "var(--t-warning)" }} />
            <span><strong>Warning</strong> = investigate (paid without payment, orphaned payments)</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "var(--t-text-muted)" }} />
            <span><strong>Info</strong> = legacy data only (pre-April 2, 2026 &mdash; not actionable)</span>
          </div>
        </div>
      </Card>

      {/* Lifecycle Debugging */}
      <Card title="Lifecycle Debugging">
        <Li>Trace any rental: Booking &rarr; Job &rarr; Invoice &rarr; Dump Ticket &rarr; Job Cost &rarr; Payment &rarr; Credit Memo</Li>
        <Li>Use <code className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--t-bg-card)", color: "var(--t-text-primary)" }}>GET /rental-chains/:id/lifecycle</code> for full drill-down</Li>
        <Li>Every entity classified as &ldquo;legacy&rdquo; (before 4/2/2026) or &ldquo;post-correction&rdquo;</Li>
      </Card>

      {/* Do NOT */}
      <Card title="Do NOT" danger>
        <Li>Edit invoice totals manually</Li>
        <Li>Mark invoices paid without payment records</Li>
        <Li>Bypass the BookingWizard flow</Li>
        <Li>Override pricing logic</Li>
        <Li>Set invoice status directly via API</Li>
      </Card>

      {/* Weekly Checklist */}
      <Card title="Weekly Checklist">
        {[
          "Run integrity check",
          "Review AR aging",
          "Review profit by rental chain",
          "Check fleet utilization",
          "Review credits and refunds",
          "Spot-check 2\u20133 rental chain lifecycles",
        ].map((item) => (
          <label key={item} className="flex items-center gap-2 cursor-default">
            <input type="checkbox" disabled className="h-3.5 w-3.5 rounded accent-[var(--t-accent)]" />
            <span className="text-sm" style={{ color: "var(--t-text-muted)" }}>{item}</span>
          </label>
        ))}
      </Card>

      {/* Data Awareness */}
      <Card title="Data Awareness">
        <div className="space-y-3">
          <div>
            <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide mb-1" style={{ backgroundColor: "var(--t-bg-card)", color: "var(--t-text-muted)", border: "1px solid var(--t-border)" }}>Legacy</span>
            <p className="text-sm" style={{ color: "var(--t-text-muted)" }}>Before April 2, 2026: may have gaps &mdash; jobs without invoices, invoices without chains, dump tickets without job_costs. Expected and labeled in reporting.</p>
          </div>
          <div>
            <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide mb-1" style={{ backgroundColor: "var(--t-accent-soft)", color: "var(--t-accent)" }}>Post-correction</span>
            <p className="text-sm" style={{ color: "var(--t-text-muted)" }}>April 2, 2026+: must be clean. Any integrity issues in post-correction data are real bugs.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
