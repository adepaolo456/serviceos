import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../../billing/entities/invoice.entity';
import { Tenant } from '../../tenants/entities/tenant.entity';
import {
  PAYMENT_TERMS_DAYS,
  PaymentTerms,
  isPaymentTerms,
} from '../payment-terms';
import {
  CreditPolicySettings,
  getCreditPolicy,
} from '../../tenants/credit-policy';
import {
  CustomerCreditState,
  EffectiveSource,
  HoldReason,
} from './customer-credit.types';

/**
 * Phase 2 — Credit-control: shared accounting + credit + hold state
 * service for customers.
 *
 * Single backend source of truth that future phases consume to answer
 * "what does this customer's accounting + credit posture look like?".
 * Phase 2 has zero existing consumers — none of the Jobs / Billing
 * Issues / Invoices / Blocked Drawer paths read from this service yet.
 * Adding this service does NOT change any existing runtime behavior.
 *
 * What this service is responsible for:
 *
 *   1. Computing receivable / past-due / credit / payment-terms / hold
 *      state for a single customer in one DB round trip.
 *   2. Resolving the customer-override → tenant-default → app-default
 *      precedence chain for payment_terms and credit_limit.
 *   3. Applying tenant credit_policy rules to compute policy holds
 *      (storage-only — Phase 2 reads them, future phases enforce them).
 *   4. Providing audited write paths for credit settings + manual hold.
 *
 * What this service is NOT responsible for:
 *
 *   - Mutating invoice rows. NEVER touches invoices except via
 *     repository reads. Invoice state is owned by
 *     InvoiceService.reconcileBalance() — see invoice.service.ts:826.
 *   - Mutating job lifecycle. NEVER touches jobs.
 *   - Triggering enforcement on the dispatch / billing-issue / blocked
 *     pipelines. Those will be added in future phases by reading from
 *     this service.
 *   - Computing AR for arbitrary customer lists. Phase 2 is per-customer.
 *     Batch use is a Phase 3 concern that can layer on top.
 *
 * Multi-tenant safety:
 *   - Every read query begins with `... WHERE tenant_id = :tenantId`.
 *   - Customer + Tenant lookups are tenant-scoped.
 *   - Write paths take tenantId as a required parameter and never
 *     accept a foreign tenant via the request body.
 *   - There is no admin escape hatch for cross-tenant queries.
 */
@Injectable()
export class CustomerCreditService {
  /** Application-default fallback when no override is set anywhere. */
  private static readonly APP_DEFAULT_PAYMENT_TERMS: PaymentTerms = 'net_30';

  constructor(
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Invoice)
    private readonly invoiceRepo: Repository<Invoice>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  /* ─── READ ───────────────────────────────────────────────────── */

  /**
   * Compute the full credit/AR/hold state for a customer.
   *
   * Performance:
   *   - 1 customer fetch (single row, indexed)
   *   - 1 tenant fetch (single row, indexed) — only the `settings`
   *     column is read
   *   - 1 invoice aggregation query (single round trip; sums + counts
   *     for both open and past-due in one SELECT)
   *   = 3 round trips total per call. No N+1.
   *
   * Tenant safety: every query has `tenant_id = :tenantId`. The
   * `customerRepo.findOne` includes `tenant_id` in the where clause
   * so a request for another tenant's customer ID returns null and
   * throws NotFoundException — no leakage.
   */
  async getCustomerCreditState(
    tenantId: string,
    customerId: string,
  ): Promise<CustomerCreditState> {
    const [customer, tenant, ar] = await Promise.all([
      this.customerRepo.findOne({
        where: { id: customerId, tenant_id: tenantId },
      }),
      this.tenantRepo.findOne({ where: { id: tenantId } }),
      this.aggregateCustomerAR(tenantId, customerId),
    ]);

    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }
    // Tenant should always exist when the request reached this point
    // (the @TenantId() decorator binds from JWT). Defensive throw.
    if (!tenant) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }

    const policy = getCreditPolicy(tenant);

    // ── Receivable + past-due (computed by aggregateCustomerAR) ──
    const receivable = {
      total_open_ar: ar.total_open_ar,
      open_invoice_count: ar.open_invoice_count,
      has_open_receivables: ar.total_open_ar > 0,
    };

    const past_due = {
      total_past_due_ar: ar.total_past_due_ar,
      past_due_invoice_count: ar.past_due_invoice_count,
      oldest_past_due_days: ar.oldest_past_due_days,
    };

    // ── Effective payment terms (precedence chain) ──
    const payment_terms = this.resolvePaymentTerms(customer, policy);

    // ── Effective credit limit (precedence chain) ──
    const credit = this.resolveCreditLimit(
      customer,
      policy,
      receivable.total_open_ar,
    );

    // ── Manual + policy + effective hold + structured reasons ──
    const hold = this.resolveHoldState(
      customer,
      policy,
      receivable.total_open_ar,
      past_due.oldest_past_due_days,
      credit.effective_limit,
    );

    return {
      customer_id: customer.id,
      tenant_id: tenantId,
      computed_at: new Date().toISOString(),
      receivable,
      past_due,
      credit,
      payment_terms,
      hold,
    };
  }

  /* ─── WRITE: customer credit settings ────────────────────────── */

  /**
   * Update customer-level credit settings (payment_terms,
   * credit_limit, or both). Atomic — both fields update in one save.
   * Pass `null` to clear an override and fall back to the tenant
   * default. Pass `undefined` to leave the field unchanged.
   *
   * Tenant safety: customer is loaded with `tenant_id = :tenantId`
   * before any mutation. A foreign-tenant ID returns null and throws
   * NotFoundException.
   */
  async updateCreditSettings(
    tenantId: string,
    customerId: string,
    patch: { payment_terms?: PaymentTerms | null; credit_limit?: number | null },
  ): Promise<Customer> {
    const customer = await this.customerRepo.findOne({
      where: { id: customerId, tenant_id: tenantId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }

    if (patch.payment_terms !== undefined) {
      if (patch.payment_terms !== null && !isPaymentTerms(patch.payment_terms)) {
        throw new BadRequestException(
          `Invalid payment_terms value: ${patch.payment_terms}`,
        );
      }
      customer.payment_terms = patch.payment_terms;
    }

    if (patch.credit_limit !== undefined) {
      if (patch.credit_limit !== null && (Number.isNaN(patch.credit_limit) || patch.credit_limit < 0)) {
        throw new BadRequestException(
          `credit_limit must be a non-negative number or null`,
        );
      }
      customer.credit_limit = patch.credit_limit;
    }

    return this.customerRepo.save(customer);
  }

  /* ─── WRITE: manual credit hold ──────────────────────────────── */

  /**
   * Set the manual credit hold flag with full audit metadata. Required
   * to provide a non-empty `reason` so the hold has forensic context.
   * Idempotent — calling on an already-held customer overwrites the
   * existing set_by/set_at/reason with the new ones.
   *
   * Future phases will surface this on the Customer detail UI and on
   * the dispatch / blocked-job paths. Phase 2 only stores it.
   */
  async setCreditHold(
    tenantId: string,
    customerId: string,
    userId: string,
    reason: string,
  ): Promise<Customer> {
    if (!reason || !reason.trim()) {
      throw new BadRequestException(
        'A non-empty hold reason is required when setting a credit hold.',
      );
    }
    const customer = await this.customerRepo.findOne({
      where: { id: customerId, tenant_id: tenantId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }
    customer.credit_hold = true;
    customer.credit_hold_reason = reason.trim();
    customer.credit_hold_set_by = userId;
    customer.credit_hold_set_at = new Date();
    // Clear any prior release record so the audit trail reflects the
    // most recent set action. Released_by/released_at stay null until
    // the hold is released.
    customer.credit_hold_released_by = null;
    customer.credit_hold_released_at = null;
    return this.customerRepo.save(customer);
  }

  /**
   * Release the manual credit hold. Stamps released_by + released_at
   * while leaving set_by/set_at/reason intact as forensic history.
   * Idempotent — releasing an already-released customer is a no-op
   * with respect to the boolean but updates the released_by/at to
   * the new caller.
   */
  async releaseCreditHold(
    tenantId: string,
    customerId: string,
    userId: string,
  ): Promise<Customer> {
    const customer = await this.customerRepo.findOne({
      where: { id: customerId, tenant_id: tenantId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }
    customer.credit_hold = false;
    customer.credit_hold_released_by = userId;
    customer.credit_hold_released_at = new Date();
    return this.customerRepo.save(customer);
  }

  /* ─── INTERNAL: AR aggregation ───────────────────────────────── */

  /**
   * Single tenant-scoped query that computes:
   *   - total open AR
   *   - open invoice count
   *   - total past-due AR
   *   - past-due invoice count
   *   - oldest past-due age in days (NULL if none)
   *
   * Excludes 'voided' and 'draft' invoices, matching the existing
   * `getCustomerBalance` exclusion list. Past-due is defined as
   * `due_date < CURRENT_DATE AND balance_due > 0`.
   */
  private async aggregateCustomerAR(
    tenantId: string,
    customerId: string,
  ): Promise<{
    total_open_ar: number;
    open_invoice_count: number;
    total_past_due_ar: number;
    past_due_invoice_count: number;
    oldest_past_due_days: number | null;
  }> {
    const result = await this.invoiceRepo
      .createQueryBuilder('i')
      .select('COALESCE(SUM(CASE WHEN i.balance_due > 0 THEN i.balance_due ELSE 0 END), 0)', 'total_open_ar')
      .addSelect('COUNT(CASE WHEN i.balance_due > 0 THEN 1 END)::int', 'open_invoice_count')
      .addSelect(
        `COALESCE(SUM(CASE WHEN i.balance_due > 0 AND i.due_date < CURRENT_DATE THEN i.balance_due ELSE 0 END), 0)`,
        'total_past_due_ar',
      )
      .addSelect(
        `COUNT(CASE WHEN i.balance_due > 0 AND i.due_date < CURRENT_DATE THEN 1 END)::int`,
        'past_due_invoice_count',
      )
      .addSelect(
        `EXTRACT(DAY FROM CURRENT_DATE - MIN(CASE WHEN i.balance_due > 0 AND i.due_date < CURRENT_DATE THEN i.due_date END))::int`,
        'oldest_past_due_days',
      )
      .where('i.tenant_id = :tenantId', { tenantId })
      .andWhere('i.customer_id = :customerId', { customerId })
      .andWhere('i.status NOT IN (:...excluded)', { excluded: ['voided', 'draft'] })
      .getRawOne<{
        total_open_ar: string;
        open_invoice_count: number;
        total_past_due_ar: string;
        past_due_invoice_count: number;
        oldest_past_due_days: number | null;
      }>();

    return {
      total_open_ar: Number(result?.total_open_ar ?? 0),
      open_invoice_count: Number(result?.open_invoice_count ?? 0),
      total_past_due_ar: Number(result?.total_past_due_ar ?? 0),
      past_due_invoice_count: Number(result?.past_due_invoice_count ?? 0),
      oldest_past_due_days:
        result?.oldest_past_due_days !== null && result?.oldest_past_due_days !== undefined
          ? Number(result.oldest_past_due_days)
          : null,
    };
  }

  /* ─── INTERNAL: precedence resolvers ─────────────────────────── */

  /**
   * Payment terms precedence chain:
   *   1. customers.payment_terms (if not null)
   *   2. tenants.settings.credit_policy.default_payment_terms (if set)
   *   3. CustomerCreditService.APP_DEFAULT_PAYMENT_TERMS ('net_30')
   */
  private resolvePaymentTerms(
    customer: Customer,
    policy: CreditPolicySettings,
  ): { effective: PaymentTerms; source: EffectiveSource } {
    if (customer.payment_terms && isPaymentTerms(customer.payment_terms)) {
      return {
        effective: customer.payment_terms as PaymentTerms,
        source: 'customer_override',
      };
    }
    if (policy.default_payment_terms) {
      return {
        effective: policy.default_payment_terms,
        source: 'tenant_default',
      };
    }
    return {
      effective: CustomerCreditService.APP_DEFAULT_PAYMENT_TERMS,
      source: 'app_default',
    };
  }

  /**
   * Credit limit precedence chain:
   *   1. customers.credit_limit (if not null)
   *   2. tenants.settings.credit_policy.default_credit_limit (if set, including null = explicit "no limit")
   *   3. null (no limit configured at any level)
   */
  private resolveCreditLimit(
    customer: Customer,
    policy: CreditPolicySettings,
    totalOpenAr: number,
  ): {
    effective_limit: number | null;
    available_credit: number | null;
    limit_exceeded: boolean;
    no_limit_configured: boolean;
    source: EffectiveSource;
  } {
    let effective_limit: number | null = null;
    let source: EffectiveSource = 'none';

    if (customer.credit_limit !== null && customer.credit_limit !== undefined) {
      effective_limit = Number(customer.credit_limit);
      source = 'customer_override';
    } else if (policy.default_credit_limit !== undefined && policy.default_credit_limit !== null) {
      effective_limit = Number(policy.default_credit_limit);
      source = 'tenant_default';
    }

    if (effective_limit === null) {
      return {
        effective_limit: null,
        available_credit: null,
        limit_exceeded: false,
        no_limit_configured: true,
        source,
      };
    }

    const available_credit = Math.round((effective_limit - totalOpenAr) * 100) / 100;
    return {
      effective_limit,
      available_credit,
      limit_exceeded: totalOpenAr > effective_limit,
      no_limit_configured: false,
      source,
    };
  }

  /**
   * Resolve hold state. Combines:
   *   - manual hold (`customers.credit_hold`) — always wins for the
   *     `manual_active` and `effective_active` flags
   *   - policy hold — computed from tenant credit_policy rules when
   *     they are explicitly enabled. Phase 2 computes these
   *     deterministically but no enforcement path consumes them yet.
   *
   * Returns a structured `reasons[]` array so future UI can render
   * each reason separately with registry-driven labels.
   */
  private resolveHoldState(
    customer: Customer,
    policy: CreditPolicySettings,
    totalOpenAr: number,
    oldestPastDueDays: number | null,
    effectiveLimit: number | null,
  ) {
    const reasons: HoldReason[] = [];

    const manual_active = !!customer.credit_hold;
    if (manual_active) {
      reasons.push({
        type: 'manual_hold',
        set_by: customer.credit_hold_set_by ?? null,
        set_at: customer.credit_hold_set_at
          ? new Date(customer.credit_hold_set_at).toISOString()
          : null,
        reason: customer.credit_hold_reason ?? null,
      });
    }

    let policy_active = false;

    // Credit-limit policy: only triggers if the policy rule is enabled
    // AND we have an effective limit AND total AR exceeds it. We use
    // the resolved effective_limit (not policy.default_credit_limit
    // directly) so customer overrides are honored.
    if (
      policy.ar_threshold_block?.enabled &&
      effectiveLimit !== null &&
      totalOpenAr > effectiveLimit
    ) {
      policy_active = true;
      reasons.push({
        type: 'credit_limit_exceeded',
        limit: effectiveLimit,
        current_ar: totalOpenAr,
      });
    }

    // Overdue threshold policy: triggers when oldest past-due age
    // exceeds the configured threshold.
    if (
      policy.overdue_block?.enabled &&
      policy.overdue_block.days_overdue !== undefined &&
      oldestPastDueDays !== null &&
      oldestPastDueDays >= policy.overdue_block.days_overdue
    ) {
      policy_active = true;
      reasons.push({
        type: 'overdue_threshold_exceeded',
        threshold_days: policy.overdue_block.days_overdue,
        oldest_past_due_days: oldestPastDueDays,
      });
    }

    // unpaid_exceptions_block is intentionally NOT computed in Phase 2.
    // Future phase will join job_costs / overage tracking once that
    // breakdown is available. Reserved as a TODO.

    const has_manual_history =
      !!customer.credit_hold_set_by ||
      !!customer.credit_hold_set_at ||
      !!customer.credit_hold_reason ||
      !!customer.credit_hold_released_by ||
      !!customer.credit_hold_released_at;

    return {
      manual_active,
      policy_active,
      effective_active: manual_active || policy_active,
      reasons,
      manual_metadata: has_manual_history
        ? {
            reason: customer.credit_hold_reason ?? null,
            set_by: customer.credit_hold_set_by ?? null,
            set_at: customer.credit_hold_set_at
              ? new Date(customer.credit_hold_set_at).toISOString()
              : null,
            released_by: customer.credit_hold_released_by ?? null,
            released_at: customer.credit_hold_released_at
              ? new Date(customer.credit_hold_released_at).toISOString()
              : null,
          }
        : null,
    };
  }

  /* ─── EXPORTED HELPERS ───────────────────────────────────────── */

  /**
   * Pure helper — given an invoice issue date and effective payment
   * terms, return the due date. Used by future phases at invoice
   * creation time. Phase 2 does not call this; it lives here so the
   * payment-terms-to-due-date conversion has a single source of truth
   * once consumers exist.
   *
   * Returns:
   *   - issued + N days for net_* terms
   *   - issued itself for due_on_receipt and cod
   *   - null for 'custom' (caller must override)
   */
  static computeDueDate(
    issuedAt: Date,
    terms: PaymentTerms,
  ): Date | null {
    const days = PAYMENT_TERMS_DAYS[terms];
    if (days === null) return null;
    const due = new Date(issuedAt);
    due.setDate(due.getDate() + days);
    return due;
  }
}
