import {
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerCreditService } from '../customers/services/customer-credit.service';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Invoice } from '../billing/entities/invoice.entity';
import {
  getCreditPolicy,
  getDispatchEnforcement,
} from '../tenants/credit-policy';
import { CreditAuditService } from '../credit-audit/credit-audit.service';
import { PermissionService } from '../permissions/permission.service';

/**
 * Phase 5 — Dispatch credit-hold enforcement.
 *
 * Server-authoritative enforcement layer for dispatch actions
 * (job assignment, status transitions). Mirrors the booking
 * enforcement pattern (BookingCreditEnforcementService) but with
 * per-action granularity controlled by the tenant's
 * `dispatch_enforcement` policy.
 *
 * OFF by default — no tenant experiences dispatch blocking until
 * `dispatch_enforcement.enabled` is explicitly set to `true`.
 *
 * This service NEVER mutates customer/policy/invoice state. It is
 * a pure read + decision layer.
 *
 * Fail-closed: if credit-state evaluation fails, the action is
 * rejected with a 503 rather than silently allowed.
 */

/** Dispatch actions subject to enforcement. */
export type DispatchAction = 'assignment' | 'en_route' | 'arrived' | 'completed';

export interface DispatchEnforcementParams {
  tenantId: string;
  /** Customer ID for the job. NULL = no customer (skip enforcement). */
  customerId: string | null | undefined;
  /** Authenticated user UUID from JWT. */
  userId: string;
  /** Authenticated user role from JWT. */
  userRole: string | undefined;
  /** Which dispatch action is being attempted. */
  action: DispatchAction;
  /** Optional override request from the request body. */
  creditOverride?: { reason?: string } | null;
}

export interface DispatchEnforcementResult {
  allowed: true;
  /** Audit note to write to job notes. NULL when no override needed. */
  overrideNote: string | null;
  /** Warning reasons (when hold is active but action is not blocked). */
  warnReasons: Array<Record<string, unknown>>;
}

@Injectable()
export class DispatchCreditEnforcementService {
  constructor(
    private readonly creditService: CustomerCreditService,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    // Phase B9 — Invoice repo is used by `enforceJobPrepayment` to
    // look up the linked invoice for a specific job (direct link via
    // `invoices.job_id` or chain link via `invoices.rental_chain_id`).
    @InjectRepository(Invoice)
    private readonly invoiceRepo: Repository<Invoice>,
    private readonly auditService: CreditAuditService,
    private readonly permissionService: PermissionService,
  ) {}

  /**
   * Evaluate dispatch enforcement for a specific action.
   *
   * Flow:
   *   1. No customerId → allow (no credit history to check)
   *   2. Load tenant policy → dispatch_enforcement
   *   3. Enforcement disabled → allow (no-op)
   *   4. Fetch credit state
   *   5. No hold → allow
   *   6. Hold active + action not in block_actions → allow with warn
   *   7. Hold active + action in block_actions → validate override
   *      - Override valid → allow with audit note
   *      - Override invalid → throw 403
   */
  async enforceForDispatch(
    params: DispatchEnforcementParams,
  ): Promise<DispatchEnforcementResult> {
    // 1. No customer — skip enforcement.
    if (!params.customerId) {
      return { allowed: true, overrideNote: null, warnReasons: [] };
    }

    // 2. Load tenant and dispatch enforcement config.
    let tenant;
    try {
      tenant = await this.tenantRepo.findOne({
        where: { id: params.tenantId },
      });
    } catch (err) {
      throw new ServiceUnavailableException({
        code: 'DISPATCH_CREDIT_UNAVAILABLE',
        message: 'Dispatch enforcement could not load tenant configuration.',
      });
    }
    if (!tenant) {
      throw new ServiceUnavailableException({
        code: 'DISPATCH_CREDIT_UNAVAILABLE',
        message: 'Dispatch enforcement could not load tenant configuration.',
      });
    }

    const policy = getCreditPolicy(tenant);
    const config = getDispatchEnforcement(policy);

    // 3. Enforcement disabled → pass through silently.
    if (!config.enabled || !config.block_on_hold) {
      return { allowed: true, overrideNote: null, warnReasons: [] };
    }

    // 4. Fetch credit state.
    let creditState;
    try {
      creditState = await this.creditService.getCustomerCreditState(
        params.tenantId,
        params.customerId,
      );
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      throw new ServiceUnavailableException({
        code: 'DISPATCH_CREDIT_UNAVAILABLE',
        message:
          'Dispatch blocked: credit enforcement could not be evaluated.',
      });
    }

    // 5. No hold → allow.
    if (!creditState.hold.effective_active) {
      return { allowed: true, overrideNote: null, warnReasons: [] };
    }

    // 6. Hold active — check if this specific action is blocked.
    const actionBlocked = config.block_actions[params.action] ?? false;
    if (!actionBlocked) {
      // Warn only — action allowed but hold is active.
      return {
        allowed: true,
        overrideNote: null,
        warnReasons: creditState.hold.reasons as Array<Record<string, unknown>>,
      };
    }

    // 7. Action is blocked — validate override.
    const hasOverridePerm = await this.permissionService.hasPermission(
      params.tenantId, params.userRole ?? '', 'dispatch_override',
    );
    const overrideAllowed = config.allow_override && hasOverridePerm;

    const overrideRequested = !!params.creditOverride;
    const trimmedReason = params.creditOverride?.reason?.trim() ?? '';

    if (
      overrideRequested &&
      overrideAllowed &&
      (!config.require_override_reason || trimmedReason.length > 0)
    ) {
      const note = `[Dispatch Credit Override] ${trimmedReason || '(no reason required)'} (by ${params.userId} at ${new Date().toISOString()}) [action: ${params.action}]`;
      this.auditService.record({
        tenantId: params.tenantId,
        eventType: 'dispatch_override',
        userId: params.userId,
        customerId: params.customerId,
        reason: trimmedReason || null,
        metadata: {
          action: params.action,
          effective_active: creditState.hold.effective_active,
          manual_active: creditState.hold.manual_active,
          policy_active: creditState.hold.policy_active,
          reason_count: creditState.hold.reasons.length,
        },
      });
      return {
        allowed: true,
        overrideNote: note,
        warnReasons: creditState.hold.reasons as Array<Record<string, unknown>>,
      };
    }

    // Override requested but not permitted or missing reason.
    if (overrideRequested && !overrideAllowed) {
      throw new ForbiddenException({
        code: 'DISPATCH_CREDIT_OVERRIDE_NOT_PERMITTED',
        message:
          'Override not permitted: tenant policy or user role does not allow dispatch credit override.',
        hold: {
          manual_active: creditState.hold.manual_active,
          policy_active: creditState.hold.policy_active,
          reasons: creditState.hold.reasons,
          override_allowed: false,
        },
      });
    }
    if (overrideRequested && config.require_override_reason && trimmedReason.length === 0) {
      throw new HttpException(
        {
          code: 'DISPATCH_CREDIT_OVERRIDE_REASON_REQUIRED',
          message: 'Override reason is required and cannot be empty.',
        },
        400,
      );
    }

    // No override requested — block the action.
    throw new ForbiddenException({
      code: 'DISPATCH_CREDIT_BLOCK',
      message: `Dispatch action '${params.action}' blocked: customer is on credit hold.`,
      action: params.action,
      hold: {
        manual_active: creditState.hold.manual_active,
        policy_active: creditState.hold.policy_active,
        reasons: creditState.hold.reasons,
        override_allowed: overrideAllowed,
      },
    });
  }

  /* ──────────────────────────────────────────────────────────────
   * Phase B9 — Per-job prepayment enforcement.
   *
   * Separate from the customer-level credit-hold gate above. The
   * hold gate checks aggregate AR / credit limit / manual hold flag.
   * This gate checks whether THIS specific job is prepaid according
   * to the customer's effective payment terms.
   *
   * Rule (launch scope — payment_terms alone is sufficient):
   *   - No customer          → allow (no policy to apply)
   *   - total_price <= 0     → allow (free / placeholder job)
   *   - payment_terms is any `net_*` or `custom`
   *                          → allow (credit customer, pay later is OK)
   *   - payment_terms is due_on_receipt or cod:
   *       • linked invoice (direct or chain-linked) is paid/partial
   *                          → allow (prepayment satisfied)
   *       • else             → block, unless the caller passes a
   *                            valid `creditOverride.reason` AND has
   *                            the `dispatch_override` permission
   *
   * Tenant-scoped: invoice lookup always filters by `tenant_id`. No
   * new tenant settings required.
   * ────────────────────────────────────────────────────────────── */
  async enforceJobPrepayment(
    params: DispatchPrepaymentParams,
  ): Promise<DispatchEnforcementResult> {
    // 1. No customer → allow.
    if (!params.job.customer_id) {
      return { allowed: true, overrideNote: null, warnReasons: [] };
    }

    // 2. Free / placeholder job → allow.
    const price = Number(params.job.total_price) || 0;
    if (price <= 0) {
      return { allowed: true, overrideNote: null, warnReasons: [] };
    }

    // 3. Resolve effective payment terms via the credit service
    //    (reuses the existing customer-override → tenant-default →
    //    app-default precedence chain). Fail-closed on error.
    let creditState;
    try {
      creditState = await this.creditService.getCustomerCreditState(
        params.tenantId,
        params.job.customer_id,
      );
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      throw new ServiceUnavailableException({
        code: 'DISPATCH_PREPAYMENT_UNAVAILABLE',
        message:
          'Dispatch blocked: prepayment enforcement could not be evaluated.',
      });
    }

    const terms = creditState.payment_terms.effective;

    // 4. Credit customer → allow. Only due_on_receipt and cod count
    //    as prepay. Everything else (net_7/15/30/60/custom) passes.
    if (terms !== 'due_on_receipt' && terms !== 'cod') {
      return { allowed: true, overrideNote: null, warnReasons: [] };
    }

    // 5. Prepay customer — look up a linked paid invoice.
    let paid: boolean;
    try {
      paid = await this.hasPaidLinkedInvoice(
        params.tenantId,
        params.job.id,
      );
    } catch (err) {
      throw new ServiceUnavailableException({
        code: 'DISPATCH_PREPAYMENT_UNAVAILABLE',
        message:
          'Dispatch blocked: prepayment invoice lookup failed.',
      });
    }
    if (paid) {
      return { allowed: true, overrideNote: null, warnReasons: [] };
    }

    // 6. Prepay customer + no paid invoice → validate override.
    const hasOverridePerm = await this.permissionService.hasPermission(
      params.tenantId,
      params.userRole ?? '',
      'dispatch_override',
    );
    const overrideRequested = !!params.creditOverride;
    const trimmedReason = params.creditOverride?.reason?.trim() ?? '';

    if (overrideRequested && hasOverridePerm && trimmedReason.length > 0) {
      const note = `[Dispatch Prepayment Override] ${trimmedReason} (by ${params.userId} at ${new Date().toISOString()}) [terms: ${terms}]`;
      // Reuse the existing `dispatch_override` audit event type so the
      // analytics/workflow queries that filter on it automatically
      // pick up prepayment overrides too. The `sub_type` metadata
      // field distinguishes prepayment from credit-hold overrides
      // for forensic review.
      this.auditService.record({
        tenantId: params.tenantId,
        eventType: 'dispatch_override',
        userId: params.userId,
        customerId: params.job.customer_id,
        jobId: params.job.id,
        reason: trimmedReason,
        metadata: {
          sub_type: 'prepayment',
          payment_terms: terms,
        },
      });
      return {
        allowed: true,
        overrideNote: note,
        warnReasons: [{ type: 'unpaid_prepayment', payment_terms: terms }],
      };
    }

    if (overrideRequested && !hasOverridePerm) {
      throw new ForbiddenException({
        code: 'DISPATCH_PREPAYMENT_OVERRIDE_NOT_PERMITTED',
        message:
          'Override not permitted: your role cannot override the payment requirement for this job.',
        hold: {
          manual_active: false,
          policy_active: false,
          reasons: [{ type: 'unpaid_prepayment', payment_terms: terms }],
          override_allowed: false,
        },
      });
    }

    if (overrideRequested && trimmedReason.length === 0) {
      throw new HttpException(
        {
          code: 'DISPATCH_PREPAYMENT_OVERRIDE_REASON_REQUIRED',
          message: 'Override reason is required and cannot be empty.',
        },
        400,
      );
    }

    // No override requested — block with the same response shape as
    // DISPATCH_CREDIT_BLOCK so the web error pipeline picks it up.
    // Phase 2 (Dispatch Prepayment UX) — message uses plain operator
    // language; the dispatch page now keys off `body.code` rather
    // than substring-matching the message.
    throw new ForbiddenException({
      code: 'DISPATCH_PREPAYMENT_BLOCK',
      message:
        'Payment required before dispatch. This customer requires payment before dispatch and this job has no paid invoice linked.',
      hold: {
        manual_active: false,
        policy_active: false,
        reasons: [{ type: 'unpaid_prepayment', payment_terms: terms }],
        override_allowed: hasOverridePerm,
      },
    });
  }

  /**
   * Tenant-scoped lookup: returns true iff there is at least one
   * invoice in {paid, partial} linked to the given job — either
   * directly (`invoices.job_id = :jobId`) or via the job's rental
   * chain (`invoices.rental_chain_id IN (SELECT rental_chain_id FROM
   * task_chain_links WHERE job_id = :jobId)`).
   *
   * Mirrors the OR/JOIN shape of the pre-B8 visibility gate but
   * scoped to a single job at action time instead of filtering the
   * whole board.
   */
  private async hasPaidLinkedInvoice(
    tenantId: string,
    jobId: string,
  ): Promise<boolean> {
    // Chain-leak fix: invoices with a direct `job_id` are the canonical
    // payment source for that specific job. Do not cross-link them to
    // other jobs on the same rental_chain_id. Prior behavior treated any
    // paid invoice on the chain as satisfying prepay for every job on
    // the chain, which allowed exchange jobs to dispatch without payment
    // whenever the original delivery invoice was paid. Chain-only
    // invoices (invoice.job_id IS NULL) still fall back to chain
    // matching for legacy compatibility.
    //
    // Both queries carry `inv.tenant_id = :tenantId` as the first
    // WHERE clause — tenant scoping preserved byte-for-byte.

    // Step 1 — canonical per-job invoices. When any exist for this
    // exact job, they are the authoritative payment source. Return
    // true iff at least one is paid/partial; never fall through to
    // chain-level matching.
    const directInvoices = await this.invoiceRepo
      .createQueryBuilder('inv')
      .select('inv.status', 'status')
      .where('inv.tenant_id = :tenantId', { tenantId })
      .andWhere('inv.job_id = :jobId', { jobId })
      .getRawMany<{ status: string }>();

    if (directInvoices.length > 0) {
      return directInvoices.some(
        (i) => i.status === 'paid' || i.status === 'partial',
      );
    }

    // Step 2 — legacy fallback. Only runs when no direct invoice
    // exists for the job. Matches chain-only invoices
    // (invoice.job_id IS NULL) that pre-date the per-job invoicing
    // model introduced by Path α.
    const chainOnlyMatch = await this.invoiceRepo
      .createQueryBuilder('inv')
      .select('inv.id')
      .where('inv.tenant_id = :tenantId', { tenantId })
      .andWhere('inv.job_id IS NULL')
      .andWhere(
        `inv.rental_chain_id IN (
           SELECT tcl.rental_chain_id
             FROM task_chain_links tcl
            WHERE tcl.job_id = :jobId
        )`,
        { jobId },
      )
      .andWhere('inv.status IN (:...paidStatuses)', {
        paidStatuses: ['paid', 'partial'],
      })
      .limit(1)
      .getOne();
    return !!chainOnlyMatch;
  }
}

/**
 * Phase B9 — Parameters for the per-job prepayment gate.
 * Structurally typed so callers can pass a full `Job` entity without
 * this file needing to import the Job entity class.
 */
export interface DispatchPrepaymentParams {
  tenantId: string;
  job: {
    id: string;
    customer_id: string | null;
    total_price: number | string | null;
  };
  userId: string;
  userRole: string | undefined;
  creditOverride?: { reason?: string } | null;
}
