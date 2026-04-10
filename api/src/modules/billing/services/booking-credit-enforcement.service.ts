import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerCreditService } from '../../customers/services/customer-credit.service';
import { Tenant } from '../../tenants/entities/tenant.entity';
import {
  CreditPolicySettings,
  getCreditPolicy,
} from '../../tenants/credit-policy';
import { CreditAuditService } from '../../credit-audit/credit-audit.service';
import { PermissionService } from '../../permissions/permission.service';

/**
 * Phase 4B — Server-authoritative credit-hold enforcement for booking
 * creation paths.
 *
 * Single source of truth on the backend for "is this booking allowed
 * to proceed for this customer right now?". Called from every booking
 * creation entry point so the answer cannot be bypassed by:
 *   - alternate clients (curl, postman, scripts)
 *   - stale UI state (frontend cache vs current DB)
 *   - skipped fetches (frontend never called credit-state)
 *   - future frontend regressions (UI gating accidentally removed)
 *
 * This service NEVER mutates customer/policy/invoice state. It is a
 * pure read + decision layer that:
 *   1. Reads credit state via the existing
 *      CustomerCreditService.getCustomerCreditState (Phase 2)
 *   2. Reads tenant policy mode (warn vs block per rule)
 *   3. Computes the per-rule mode aggregation identical to the
 *      Phase 4A frontend hook
 *   4. Validates any override request (role + policy + reason)
 *   5. Returns an audit note string for the calling code to splice
 *      into the new job's placement_notes / driver_notes column
 *      (no separate audit write — uses the existing notes pattern
 *      that matches `[Status Override]` in jobs/[id]/page.tsx)
 *
 * Fail-closed (Phase 4B reverses Phase 4A's fail-open):
 *   If credit-state evaluation fails for any reason that isn't a
 *   normal NotFound, the service throws a 503 with a structured
 *   code so the caller knows enforcement could not be evaluated and
 *   the booking is rejected. Better to bounce a single booking than
 *   to silently let a held customer through.
 *
 * NEVER touched:
 *   - Invoice rows (only reconcileBalance is allowed to)
 *   - Job lifecycle / status
 *   - Payment rows
 *   - Blocked predicate
 *   - Existing scheduled jobs
 */

/**
 * Discriminated result returned by `enforceForBooking`. Calling code
 * must respect `overrideNote` — when non-null, it MUST be appended to
 * the new job's placement_notes (or driver_notes) field for forensic
 * audit. The service does not write the note itself.
 */
export interface BookingCreditEnforcementResult {
  /** Always true when this returns successfully — blocks throw. */
  allowed: true;
  /**
   * Audit note string. NULL when no override was needed. NON-NULL
   * when an override was applied — caller MUST append this to the
   * new job's placement_notes.
   */
  overrideNote: string | null;
}

export interface BookingCreditEnforcementParams {
  tenantId: string;
  /**
   * Customer being booked. NULL means a new customer is being
   * created in the same request — new customers have no credit
   * history and are always allowed.
   */
  customerId: string | null | undefined;
  /** Authenticated user UUID from the JWT (NOT trusted from payload). */
  userId: string;
  /** Authenticated user role from the JWT (NOT trusted from payload). */
  userRole: string | undefined;
  /** Optional override request from the request body. */
  creditOverride?: { reason?: string } | null;
}

/**
 * Structured 403 payload thrown when a booking is blocked. The shape
 * mirrors the Phase 4A frontend banner so future API consumers can
 * render an equivalent block screen from the response alone.
 */
interface CreditHoldBlockPayload {
  code: 'CREDIT_HOLD_BLOCK';
  message: string;
  hold: {
    manual_active: boolean;
    policy_active: boolean;
    reasons: Array<Record<string, unknown>>;
    override_allowed: boolean;
  };
}

@Injectable()
export class BookingCreditEnforcementService {
  constructor(
    private readonly creditService: CustomerCreditService,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    private readonly auditService: CreditAuditService,
    private readonly permissionService: PermissionService,
  ) {}

  /**
   * Server-authoritative enforcement entry point. Throws on block.
   * Returns the enforcement result on allow.
   *
   * Flow:
   *   1. No customerId → allow (new customer being created)
   *   2. Fetch credit-state (NotFound bubbles, other errors → 503)
   *   3. Fetch tenant policy for per-rule mode aggregation
   *   4. effective_active === false → allow with no note
   *   5. Aggregate: any reason in `block` mode → block; else `warn`
   *   6. warn → allow with no note
   *   7. block → validate override request
   *      - allow_office_override === true (policy)
   *      - userRole in (admin, owner) (JWT)
   *      - non-empty trimmed reason (payload)
   *      All three required → allow with override note
   *      Otherwise → throw 403 with structured hold payload
   */
  async enforceForBooking(
    params: BookingCreditEnforcementParams,
  ): Promise<BookingCreditEnforcementResult> {
    // Case 1 — no customer (new customer being created in this same
    // request). New customers have no credit history; allow.
    if (!params.customerId) {
      return { allowed: true, overrideNote: null };
    }

    // Case 2 — fetch credit state. NotFound bubbles up as 404 from
    // the underlying service; any other unexpected error becomes
    // 503 so the caller knows enforcement could not be evaluated.
    let creditState;
    try {
      creditState = await this.creditService.getCustomerCreditState(
        params.tenantId,
        params.customerId,
      );
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      throw new ServiceUnavailableException({
        code: 'CREDIT_STATE_UNAVAILABLE',
        message:
          'Booking blocked: credit enforcement could not be evaluated for this customer.',
      });
    }

    // Case 3 — no hold → allow with no note.
    if (!creditState.hold.effective_active) {
      return { allowed: true, overrideNote: null };
    }

    // Case 4 — hold is active. Determine warn vs block by aggregating
    // each reason's mode against the tenant policy.
    let policy: CreditPolicySettings;
    try {
      const tenant = await this.tenantRepo.findOne({
        where: { id: params.tenantId },
      });
      if (!tenant) {
        throw new ServiceUnavailableException({
          code: 'CREDIT_STATE_UNAVAILABLE',
          message:
            'Booking blocked: tenant credit policy could not be loaded.',
        });
      }
      policy = getCreditPolicy(tenant);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new ServiceUnavailableException({
        code: 'CREDIT_STATE_UNAVAILABLE',
        message:
          'Booking blocked: tenant credit policy could not be loaded.',
      });
    }

    const isBlock = creditState.hold.reasons.some(
      (r) => this.reasonMode(r, policy) === 'block',
    );

    // Case 5 — warn-only → allow with no note.
    if (!isBlock) {
      return { allowed: true, overrideNote: null };
    }

    // Case 6 — block. Validate override request before throwing.
    const hasOverridePerm = await this.permissionService.hasPermission(
      params.tenantId, params.userRole ?? '', 'booking_override',
    );
    const overrideAllowed = policy.allow_office_override === true && hasOverridePerm;

    const overrideRequested = !!params.creditOverride;
    const trimmedReason = params.creditOverride?.reason?.trim() ?? '';

    if (overrideRequested && overrideAllowed && trimmedReason.length > 0) {
      const note = `[Credit Override] ${trimmedReason} (by ${params.userId} at ${new Date().toISOString()})`;
      this.auditService.record({
        tenantId: params.tenantId,
        eventType: 'booking_override',
        userId: params.userId,
        customerId: params.customerId,
        reason: trimmedReason,
        metadata: {
          action: 'booking_create',
          effective_active: creditState.hold.effective_active,
          manual_active: creditState.hold.manual_active,
          policy_active: creditState.hold.policy_active,
          reason_count: creditState.hold.reasons.length,
        },
      });
      return { allowed: true, overrideNote: note };
    }

    // Override either not requested, not eligible, or invalid reason.
    // Differentiate the rejection so callers/clients can distinguish
    // expected business-rule blocks from malformed override requests.
    if (overrideRequested && !overrideAllowed) {
      throw new ForbiddenException({
        code: 'CREDIT_HOLD_OVERRIDE_NOT_PERMITTED',
        message:
          'Override not permitted: tenant policy or user role does not allow credit hold override.',
        hold: this.buildHoldPayload(creditState, false),
      });
    }
    if (overrideRequested && trimmedReason.length === 0) {
      throw new HttpException(
        {
          code: 'CREDIT_HOLD_OVERRIDE_REASON_REQUIRED',
          message: 'Override reason is required and cannot be empty.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // No override requested or override invalid → standard block.
    throw new ForbiddenException(
      this.buildBlockPayload(creditState, overrideAllowed),
    );
  }

  /* ─── Internal helpers ─── */

  /**
   * Per-reason → mode resolver. Manual holds always count as block;
   * policy holds inherit their rule's mode (defaulting to `warn` when
   * the rule has no mode set). Mirrors the Phase 4A frontend hook.
   */
  private reasonMode(
    reason: { type: string },
    policy: CreditPolicySettings,
  ): 'warn' | 'block' {
    switch (reason.type) {
      case 'manual_hold':
        return 'block';
      case 'credit_limit_exceeded':
        return policy.ar_threshold_block?.mode === 'block' ? 'block' : 'warn';
      case 'overdue_threshold_exceeded':
        return policy.overdue_block?.mode === 'block' ? 'block' : 'warn';
      default:
        return 'warn';
    }
  }

  private buildHoldPayload(
    creditState: { hold: { manual_active: boolean; policy_active: boolean; reasons: unknown[] } },
    overrideAllowed: boolean,
  ): CreditHoldBlockPayload['hold'] {
    return {
      manual_active: creditState.hold.manual_active,
      policy_active: creditState.hold.policy_active,
      reasons: creditState.hold.reasons as Array<Record<string, unknown>>,
      override_allowed: overrideAllowed,
    };
  }

  private buildBlockPayload(
    creditState: { hold: { manual_active: boolean; policy_active: boolean; reasons: unknown[] } },
    overrideAllowed: boolean,
  ): CreditHoldBlockPayload {
    return {
      code: 'CREDIT_HOLD_BLOCK',
      message: 'Booking blocked: customer is on credit hold.',
      hold: this.buildHoldPayload(creditState, overrideAllowed),
    };
  }
}
