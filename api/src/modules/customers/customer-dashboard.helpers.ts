/**
 * Customer Dashboard — pure derivation helpers.
 *
 * Every function in this file is a pure function: no I/O, no DB access,
 * no service calls. Input data comes entirely from the caller. This
 * keeps status-strip / severity / service-site derivation trivially
 * testable and isolated from the aggregation layer in
 * `customer-dashboard.service.ts`.
 *
 * Severity rules (approved):
 *   RED    = 30+ day overdue invoice OR open billing issue
 *   YELLOW = (no red) AND (balance > 0 not overdue OR sms opted out
 *            OR geocode failure OR expiring quote)
 *   GREEN  = none of the above
 *
 * Note (Phase B8): the former `dispatch_blocker` red reason was removed
 * alongside the dispatch-board payment gate. Credit enforcement now lives
 * in `dispatch-credit-enforcement.service.ts` (action-time gate), not as
 * a customer-level status-strip reason.
 */
import { hasValidServiceCoordinates } from '../../common/helpers/coordinate-validator';

export type StatusSeverity = 'green' | 'yellow' | 'red';

/** Normalized reason keys — stable identifiers so the UI can map to labels. */
export type StatusReasonKey =
  | 'overdue_30_plus'
  | 'open_billing_issue'
  | 'balance_outstanding'
  | 'sms_opted_out'
  | 'geocode_failure'
  | 'expiring_quote';

export interface StatusStrip {
  severity: StatusSeverity;
  reasons: StatusReasonKey[];
}

export interface StatusStripInput {
  /** Net outstanding balance across all non-voided, non-draft invoices. */
  netBalance: number;
  /** Number of invoices with at least one day past due. */
  overdueInvoiceCount: number;
  /** Number of overdue invoices at least 30 days past due. */
  overdueThirtyPlusCount: number;
  /** Number of open (actionable) billing issues linked to this customer. */
  openBillingIssueCount: number;
  /** Whether the customer's phone is currently SMS-suppressed. */
  smsOptedOut: boolean;
  /** Number of service sites missing valid coordinates. */
  geocodeFailureCount: number;
  /** Number of active quotes expiring within the configured window. */
  expiringQuoteCount: number;
}

/**
 * Derive the traffic-light status strip from the already-computed
 * aggregation inputs. Pure function — no I/O, no derivation from raw
 * entities. Call sites assemble the input from their own queries.
 */
export function deriveStatusStrip(input: StatusStripInput): StatusStrip {
  const redReasons: StatusReasonKey[] = [];
  if (input.overdueThirtyPlusCount > 0) redReasons.push('overdue_30_plus');
  if (input.openBillingIssueCount > 0) redReasons.push('open_billing_issue');

  if (redReasons.length > 0) {
    return { severity: 'red', reasons: redReasons };
  }

  const yellowReasons: StatusReasonKey[] = [];
  if (input.netBalance > 0) yellowReasons.push('balance_outstanding');
  if (input.smsOptedOut) yellowReasons.push('sms_opted_out');
  if (input.geocodeFailureCount > 0) yellowReasons.push('geocode_failure');
  if (input.expiringQuoteCount > 0) yellowReasons.push('expiring_quote');

  if (yellowReasons.length > 0) {
    return { severity: 'yellow', reasons: yellowReasons };
  }

  return { severity: 'green', reasons: [] };
}

// ─────────────────────────────────────────────────────────────────
// Service site derivation
// ─────────────────────────────────────────────────────────────────

export interface ServiceSiteSummary {
  /** Raw address object (street/city/state/zip + optional lat/lng/geocoded_at). */
  address: Record<string, any>;
  /** True if the address has valid, usable lat/lng coordinates. */
  hasCoordinates: boolean;
  /** Where coordinates came from (e.g. 'mapbox'). Null if ungeocoded. */
  geocodeSource: string | null;
}

export interface ServiceSitesState {
  /** Primary service address — first element of service_addresses, if any. */
  primary: ServiceSiteSummary | null;
  /** All saved service sites including the primary. */
  all: ServiceSiteSummary[];
  /** Count of sites missing valid coordinates — feeds yellow severity. */
  geocodeFailureCount: number;
}

/** Shape of what the aggregator passes in — typed loosely because the
 * underlying field is jsonb and may carry arbitrary provider metadata. */
type RawAddress = Record<string, any>;

function summarizeAddress(addr: RawAddress | null | undefined): ServiceSiteSummary | null {
  if (!addr || typeof addr !== 'object') return null;
  // Skip entries that don't even have a street — they're placeholder rows
  // the UI shouldn't render.
  if (!addr.street) return null;
  return {
    address: addr,
    hasCoordinates: hasValidServiceCoordinates(addr),
    geocodeSource: typeof addr.geocode_source === 'string' ? addr.geocode_source : null,
  };
}

/**
 * Derive service-site display state from a customer's stored
 * service_addresses jsonb array. Returns a structured summary that the
 * frontend can render directly.
 */
export function deriveServiceSites(
  serviceAddresses: RawAddress[] | null | undefined,
): ServiceSitesState {
  const raw = Array.isArray(serviceAddresses) ? serviceAddresses : [];
  const all = raw
    .map(summarizeAddress)
    .filter((x): x is ServiceSiteSummary => x !== null);
  const primary = all[0] ?? null;
  const geocodeFailureCount = all.filter((s) => !s.hasCoordinates).length;
  return { primary, all, geocodeFailureCount };
}

// ─────────────────────────────────────────────────────────────────
// Financial snapshot derivation
// ─────────────────────────────────────────────────────────────────

export type FinancialState = 'paid' | 'partial' | 'past_due' | 'needs_review';

export interface InvoiceSummaryInput {
  id: string;
  status: string;
  total: number;
  balance_due: number;
  due_date: string | null;
  created_at: Date;
}

export interface FinancialSnapshot {
  /** Net outstanding balance (sum of balance_due on non-voided/non-draft invoices). */
  outstandingBalance: number;
  /** Count of unpaid invoices with balance > 0. */
  unpaidCount: number;
  /** Count of invoices past their due_date with balance > 0. */
  overdueCount: number;
  /** Count of overdue invoices that are 30+ days past due. */
  overdueThirtyPlusCount: number;
  /** Latest invoice by created_at (any status) — surfaced for the snapshot card. */
  latestInvoice: {
    id: string;
    status: string;
    total: number;
    balance_due: number;
  } | null;
  /** Derived display state for the snapshot pill. */
  state: FinancialState;
}

/**
 * Compute the financial snapshot from an already-fetched list of
 * invoices. Excludes voided and draft invoices from balance math (same
 * rule the existing `customers.service.ts:getCustomerBalance` applies).
 *
 * `now` is injected to keep the function pure and testable.
 */
export function deriveFinancialSnapshot(
  invoices: InvoiceSummaryInput[],
  now: Date = new Date(),
): FinancialSnapshot {
  const active = invoices.filter(
    (i) => i.status !== 'voided' && i.status !== 'draft',
  );

  let outstandingBalance = 0;
  let unpaidCount = 0;
  let overdueCount = 0;
  let overdueThirtyPlusCount = 0;

  for (const inv of active) {
    const balance = Number(inv.balance_due) || 0;
    if (balance > 0) {
      outstandingBalance += balance;
      unpaidCount += 1;
      if (inv.due_date) {
        const due = new Date(inv.due_date);
        if (!isNaN(due.getTime()) && due.getTime() < now.getTime()) {
          overdueCount += 1;
          const daysOver = Math.floor(
            (now.getTime() - due.getTime()) / (24 * 60 * 60 * 1000),
          );
          if (daysOver >= 30) overdueThirtyPlusCount += 1;
        }
      }
    }
  }

  // Latest invoice = most recent by created_at, regardless of status.
  const sorted = [...invoices].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const latest = sorted[0] ?? null;
  const latestInvoice = latest
    ? {
        id: latest.id,
        status: latest.status,
        total: Number(latest.total) || 0,
        balance_due: Number(latest.balance_due) || 0,
      }
    : null;

  let state: FinancialState;
  if (overdueCount > 0) state = 'past_due';
  else if (unpaidCount > 0 && outstandingBalance > 0) {
    // Partial if ANY invoice has amount_paid between zero and total; we
    // can't tell from balance alone, so use 'partial' when there are
    // unpaid invoices but none are overdue. 'needs_review' is reserved
    // for the explicit 'draft' case when NOTHING is paid and NOTHING is
    // overdue — not reachable here since we excluded drafts above.
    state = 'partial';
  } else {
    state = 'paid';
  }

  // Draft-only customers (every invoice is draft) — surface as review.
  if (invoices.length > 0 && active.length === 0) {
    state = 'needs_review';
  }

  return {
    outstandingBalance: Math.round(outstandingBalance * 100) / 100,
    unpaidCount,
    overdueCount,
    overdueThirtyPlusCount,
    latestInvoice,
    state,
  };
}

// ─────────────────────────────────────────────────────────────────
// Quote expiration helper
// ─────────────────────────────────────────────────────────────────

/**
 * Given a list of quotes (with `status` and `expires_at`), count how
 * many are "active and expiring soon" — status ∈ {draft, sent} and
 * expires_at within the next `windowHours`. Used to trigger the
 * yellow `expiring_quote` status-strip reason.
 */
export function countExpiringQuotes(
  quotes: Array<{ status: string; expires_at: Date | string | null | undefined }>,
  windowHours: number = 48,
  now: Date = new Date(),
): number {
  const windowMs = windowHours * 60 * 60 * 1000;
  const horizon = now.getTime() + windowMs;
  let count = 0;
  for (const q of quotes) {
    if (q.status !== 'draft' && q.status !== 'sent') continue;
    // Defensive: legacy quote rows can have expires_at = null. The previous
    // ternary returned the raw value when it wasn't a string, then crashed
    // on `null.getTime()`. Skip any quote without a usable expiry.
    if (q.expires_at == null) continue;
    const expiresAt =
      typeof q.expires_at === 'string' ? new Date(q.expires_at) : q.expires_at;
    if (!(expiresAt instanceof Date) || isNaN(expiresAt.getTime())) continue;
    if (expiresAt.getTime() > now.getTime() && expiresAt.getTime() <= horizon) {
      count += 1;
    }
  }
  return count;
}

// ─────────────────────────────────────────────────────────────────
// Rental chain grouping
// ─────────────────────────────────────────────────────────────────

export interface ChainLinkInput {
  id: string;
  rental_chain_id: string;
  job_id: string;
  sequence_number: number;
  task_type: string;
  status: string;
  previous_link_id: string | null;
  next_link_id: string | null;
  scheduled_date: string;
}

export interface ChainGroupingResult {
  /** Set of job IDs that are part of at least one rental chain. */
  chainedJobIds: Set<string>;
}

/**
 * Build a Set of job IDs that are part of any rental chain, so callers
 * can split a jobs list into "chained" vs "standalone" for UI rendering.
 * Pure function; doesn't mutate input.
 */
export function indexChainedJobs(links: ChainLinkInput[]): ChainGroupingResult {
  const chainedJobIds = new Set<string>();
  for (const link of links) {
    if (link.job_id) chainedJobIds.add(link.job_id);
  }
  return { chainedJobIds };
}
