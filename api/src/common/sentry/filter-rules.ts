/**
 * Arc K Phase 1A Step 3 — §K.4 filter rules (deny D1–D10, allow A1–A9).
 *
 * The deny rules drop events early in `beforeSend` BEFORE tag application,
 * because there's no point spending CPU on tagging an event we're going to
 * discard. Allow rules are documented here as positive assertions about
 * which categories MUST pass through the filter unfiltered — they don't
 * have implementation here. Every event that survives the filter MUST
 * still pass through tag enforcement and the untagged-event guard before
 * delivery (see before-send.ts).
 *
 * Pipeline order: filter (this file) → tag → guard → return.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ErrorEvent, EventHint } from '@sentry/nestjs';

// ── Deny rules (D1–D10) ──────────────────────────────────────────────────

/**
 * §K.4 D1: BadRequestException from class-validator (158 throws).
 * Already user-facing, not actionable in telemetry, would dominate
 * event volume. Note: D7 (Stripe signature mismatch) is also a
 * BadRequestException and is denied by the same predicate.
 */
function isD1_BadRequest(ex: unknown): boolean {
  return ex instanceof BadRequestException;
}

/**
 * §K.4 D2: UnauthorizedException from JwtAuthGuard / portal guard.
 * Expected behavior on token expiry; abuse traffic on /auth/login
 * would dominate volume. Note: D6 (Twilio signature mismatch) is
 * also an UnauthorizedException and is denied by the same predicate.
 */
function isD2_Unauthorized(ex: unknown): boolean {
  return ex instanceof UnauthorizedException;
}

/**
 * §K.4 D3: ForbiddenException from RolesGuard / TenantGuard.
 * Expected RBAC behavior — not actionable.
 */
function isD3_Forbidden(ex: unknown): boolean {
  return ex instanceof ForbiddenException;
}

/**
 * §K.4 D4: NotFoundException (131 throws). Normal product behavior
 * — fetching a deleted record, hitting a stale URL, etc.
 */
function isD4_NotFound(ex: unknown): boolean {
  return ex instanceof NotFoundException;
}

/**
 * §K.4 D5: ConflictException (31 throws — idempotency conflicts,
 * dup-entry, etc). Note: D9 (idempotency-key conflicts in
 * billing/services/orchestration.service.ts 24-hour cache) is also
 * a ConflictException and is denied by the same predicate.
 */
function isD5_Conflict(ex: unknown): boolean {
  return ex instanceof ConflictException;
}

/**
 * §K.4 D6: Twilio webhook signature mismatch.
 * Thrown at api/src/modules/automation/automation.controller.ts:134
 * as `UnauthorizedException('Invalid Twilio signature')`. Already
 * covered by D2 — duplicate intentional for clarity. Treated as
 * abuse traffic to prevent alert spam.
 */
function isD6_TwilioSigMismatch(ex: unknown): boolean {
  return (
    ex instanceof UnauthorizedException &&
    typeof (ex as Error).message === 'string' &&
    (ex as Error).message === 'Invalid Twilio signature'
  );
}

/**
 * §K.4 D7: Stripe webhook signature mismatch.
 * Thrown at api/src/modules/stripe/stripe.service.ts:275 as
 * `BadRequestException('Invalid webhook signature')`. Already covered
 * by D1 — duplicate intentional for clarity.
 */
function isD7_StripeSigMismatch(ex: unknown): boolean {
  return (
    ex instanceof BadRequestException &&
    typeof (ex as Error).message === 'string' &&
    (ex as Error).message === 'Invalid webhook signature'
  );
}

/**
 * §K.4 D8: Rate-limit rejections — HttpException with status 429.
 * Already tracked in the `rate_limit_log` table (api/src/common/
 * rate-limiter.ts); redundant in Sentry.
 */
function isD8_RateLimit(ex: unknown): boolean {
  return ex instanceof HttpException && ex.getStatus() === 429;
}

/**
 * §K.4 D9: Idempotency-key conflicts in billing/services/
 * orchestration.service.ts (24-hour cache; conflict means client
 * retried). Surfaced as ConflictException, already covered by D5
 * — duplicate intentional for clarity.
 */
function isD9_IdempotencyConflict(ex: unknown): boolean {
  return ex instanceof ConflictException;
}

/**
 * §K.4 D10: Translated user-facing errors (the errorCopy registry
 * pattern — scattered across services). These are HttpException
 * subclasses (BadRequest / NotFound / Conflict / Unauthorized) with
 * registry-translated messages; already covered by D1/D2/D4/D5
 * predicates. The audit lists them separately to guide categorization,
 * but the implementation is the existing buckets — duplicate
 * intentional for documentation.
 */
function isD10_TranslatedUserFacing(ex: unknown): boolean {
  return (
    ex instanceof BadRequestException ||
    ex instanceof UnauthorizedException ||
    ex instanceof NotFoundException ||
    ex instanceof ConflictException
  );
}

const DENY_RULES = [
  isD1_BadRequest,
  isD2_Unauthorized,
  isD3_Forbidden,
  isD4_NotFound,
  isD5_Conflict,
  isD6_TwilioSigMismatch,
  isD7_StripeSigMismatch,
  isD8_RateLimit,
  isD9_IdempotencyConflict,
  isD10_TranslatedUserFacing,
] as const;

/**
 * Returns true if the event matches any deny rule and should be
 * dropped early (before tag application).
 */
export function shouldDropEvent(_event: ErrorEvent, hint?: EventHint): boolean {
  const ex = hint?.originalException;
  if (ex == null) return false;
  return DENY_RULES.some((predicate) => predicate(ex));
}

/**
 * Test-only — exposes individual deny predicates so the spec can
 * verify each rule independently.
 */
export const __denyPredicates = {
  D1: isD1_BadRequest,
  D2: isD2_Unauthorized,
  D3: isD3_Forbidden,
  D4: isD4_NotFound,
  D5: isD5_Conflict,
  D6: isD6_TwilioSigMismatch,
  D7: isD7_StripeSigMismatch,
  D8: isD8_RateLimit,
  D9: isD9_IdempotencyConflict,
  D10: isD10_TranslatedUserFacing,
};

// ── Allow rules (A1–A9) — documentation only ──────────────────────────────
//
// These categories MUST pass through the filter unchanged and continue
// to the tag enforcement + untagged-event guard. They have no
// implementation here — they're positive assertions verified by the
// tests in filter-rules.spec.ts.
//
//   A1 — Unhandled exception (generic Error / TypeError / RangeError).
//        By definition, anything not matched by D1–D10 is allowed.
//   A2 — DB constraint violation NOT pre-handled by service code
//        (TypeORM QueryFailedError with codes 23502 NOT NULL,
//        23514 CHECK, or unexpected 23505).
//   A3 — Stripe API errors with status NOT in {200, 400, 402, 404, 429}.
//        Stripe library throws Stripe.errors.StripeAPIError subclasses.
//   A4 — Twilio API errors with status NOT in {200, 429}. Twilio
//        library throws Twilio.RestError.
//   A5 — Vercel serverless cold-start / timeout / OOM. Surfaces as
//        generic Error or Node native error — handled by A1.
//   A6 — Driver app native crashes. CLIENT-SIDE — out of scope for the
//        API filter. Phase 1C concern.
//   A7 — Web React error boundary catches. CLIENT-SIDE — out of scope
//        for the API filter. Phase 1B concern.
//   A8 — InternalServerErrorException (3 throws — always alert).
//   A9 — ServiceUnavailableException (8 throws — third-party
//        degradation; alert if sustained).
