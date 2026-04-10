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
}
