/**
 * Arc K Phase 1A Step 5 — §K.5 scenario smoke validation (structural).
 *
 * Composes synthetic exception payloads for each §K.5 scenario in scope
 * for the API surface and walks them through the full beforeSend
 * pipeline (filter → scrub → tag → guard). Asserts predicted vs actual
 * outcome.
 *
 * Live preview verification was deferred at Halt Gate 2 due to Vercel
 * SSO + bypass-token-on-POST friction. The 24-hour post-prod observation
 * window (Step 5 mitigation) is the field check that closes the live
 * verification gap. This file is the structural smoke that proves the
 * pipeline composition under realistic exception shapes.
 *
 * Scenarios:
 *   #1 Failed cancellation orchestrator run        → ALLOW (A1/A8) + scrub + tag
 *   #2 Stripe webhook signature failure            → DENY (D7)
 *   #3 Twilio inbound webhook signature failure    → DENY (D6)
 *   #5 23505 UNIQUE constraint on customer email   → ALLOW (A2) + scrub + tag
 *   #6 401 on /auth/profile from expired token     → DENY (D2)
 *
 * Scenario #4 (driver app crash) deferred to Phase 1C.
 */

import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';
import type { ErrorEvent, EventHint } from '@sentry/nestjs';

import {
  beforeSend,
  getUntaggedEventDrops,
  resetUntaggedEventDrops,
} from './before-send';
import { CLS_SCOPE, CLS_TENANT_ID, ServiceOSClsStore } from '../cls/cls.config';
import { __scrubberInternals } from './scrubber';

const TENANT_UUID = '11111111-1111-4111-8111-111111111111';
const REDACTED = __scrubberInternals.REDACTED;

function withHint(originalException: unknown): EventHint {
  return { originalException } as EventHint;
}

function runInClsContext<T>(
  store: Partial<ServiceOSClsStore>,
  fn: () => T,
): T {
  const cls = ClsServiceManager.getClsService<ServiceOSClsStore>();
  return cls.runWith(store as ServiceOSClsStore, fn);
}

beforeEach(() => {
  resetUntaggedEventDrops();
});

// ─── Scenario #1 — Failed cancellation orchestrator run ─────────────────

describe('§K.5 #1 — Failed cancellation orchestrator run', () => {
  it('predicted: ALLOW + scrub cancellation_reason + tag tenant_id; severity error', () => {
    // Synthesize the BLOCKER J pattern: an InternalServerErrorException
    // escaping the cancellation orchestrator after a step throws past
    // the catch boundary. Real path: rental-chains/jobs services in
    // the cancellation flow.
    const exception = new InternalServerErrorException(
      'Cancellation step failed: post-commit refund audit threw',
    );

    const event: ErrorEvent = {
      event_id: 'evt-cancel-1',
      type: undefined,
      request: {
        method: 'POST',
        url: '/jobs/abc/cancel',
        data: {
          job_id: '550e8400-e29b-41d4-a716-446655440099',
          chain_id: '550e8400-e29b-41d4-a716-446655440100',
          cancellation_reason:
            'Customer Maria Santos requested cancellation; their phone is 5551234',
          customer_id: 'cust-real-uuid',
          tenant_id: TENANT_UUID,
        },
      },
    } as ErrorEvent;

    const result = runInClsContext({ [CLS_TENANT_ID]: TENANT_UUID }, () =>
      beforeSend(event, withHint(exception)),
    );

    // PASS criteria from §K.5 prediction:
    //   - filter does NOT drop (InternalServerErrorException is A8)
    //   - scrubber STRIPs cancellation_reason
    //   - scrubber HASHes customer_id
    //   - tag applies tenant_id
    //   - KEEP fields preserved
    expect(result).not.toBeNull();
    const data = result!.request!.data as Record<string, unknown>;
    expect(data.cancellation_reason).toBe(REDACTED);
    expect(typeof data.customer_id).toBe('string');
    expect((data.customer_id as string).length).toBe(64);
    expect(data.job_id).toBe('550e8400-e29b-41d4-a716-446655440099');
    expect(data.chain_id).toBe('550e8400-e29b-41d4-a716-446655440100');
    expect(data.tenant_id).toBe(TENANT_UUID);
    expect(result!.tags?.tenant_id).toBe(TENANT_UUID);
    expect(getUntaggedEventDrops()).toBe(0);
  });
});

// ─── Scenario #2 — Stripe webhook signature failure ─────────────────────

describe('§K.5 #2 — Stripe webhook signature failure', () => {
  it('predicted: DENY (filter D7); no event sent; counter NOT bumped', () => {
    // stripe.service.ts:275 throws this exact exception on signature
    // mismatch. Audit §K.4 D7 maps the message string to the deny rule.
    const exception = new BadRequestException('Invalid webhook signature');

    // Naive Sentry capture would include the entire Stripe payload —
    // billing_details.email, billing_details.name, etc. We compose the
    // event with that PII present to verify the filter drops the event
    // BEFORE scrubbing or tagging would even run.
    const event: ErrorEvent = {
      event_id: 'evt-stripe-sig-fail',
      type: undefined,
      request: {
        method: 'POST',
        url: '/stripe/webhook',
        data: {
          billing_details: {
            email: 'attacker@spoof.example',
            name: 'Spoofed Name',
            address: { street: 'fake' },
          },
          customer: 'cus_spoofed',
          MessageSid: 'unrelated',
        },
      },
    } as ErrorEvent;

    // Run with platform scope (webhook routes are anonymous before
    // tenant resolution). Even with valid CLS, the filter must drop.
    const result = runInClsContext({ [CLS_SCOPE]: 'platform' }, () =>
      beforeSend(event, withHint(exception)),
    );

    expect(result).toBeNull();
    // Filter-drops do NOT increment the untagged-event guard counter —
    // that counter is reserved for genuine missing-tag bugs.
    expect(getUntaggedEventDrops()).toBe(0);
  });
});

// ─── Scenario #3 — Twilio inbound webhook signature failure ─────────────

describe('§K.5 #3 — Twilio inbound webhook signature failure', () => {
  it('predicted: DENY (filter D6); no event sent; counter NOT bumped', () => {
    // automation.controller.ts:134 throws this exact exception when
    // the HMAC-SHA1 timing-safe comparison fails. Per Step 5 prompt
    // clarification: signature failure → DENY (D6); payload-processing
    // failure (post-signature-validation) is a separate ALLOW path that
    // is NOT in scope for this scenario.
    const exception = new UnauthorizedException('Invalid Twilio signature');

    // Compose with the Twilio webhook PII triple in the body. Filter
    // must drop BEFORE this PII could leak.
    const event: ErrorEvent = {
      event_id: 'evt-twilio-sig-fail',
      type: undefined,
      request: {
        method: 'POST',
        url: '/automation/sms/inbound',
        data: {
          From: '+15551234567',
          To: '+15559876543',
          Body: 'STOP',
          MessageSid: 'SM_attempted',
        },
      },
    } as ErrorEvent;

    const result = runInClsContext({ [CLS_SCOPE]: 'platform' }, () =>
      beforeSend(event, withHint(exception)),
    );

    expect(result).toBeNull();
    expect(getUntaggedEventDrops()).toBe(0);
  });

  it('boundary check: payload-processing failure (post-signature) is NOT silenced by D6', () => {
    // Per Step 5 prompt: "Do NOT over-broaden the Twilio deny rule to
    // silence real processing bugs." A handler exception thrown AFTER
    // signature validation passes — e.g., a generic Error from
    // schema-drift or an unexpected payload shape — must reach Sentry.
    const exception = new Error(
      'Twilio inbound payload schema drift: missing required field',
    );

    const event: ErrorEvent = {
      event_id: 'evt-twilio-processing',
      type: undefined,
      request: {
        method: 'POST',
        url: '/automation/sms/inbound',
        data: {
          From: '+15551234567',
          To: '+15559876543',
          Body: 'real message',
          MessageSid: 'SM_real',
        },
      },
    } as ErrorEvent;

    const result = runInClsContext({ [CLS_SCOPE]: 'platform' }, () =>
      beforeSend(event, withHint(exception)),
    );

    // Should DELIVER (not drop) with PII scrubbed and platform scope tag.
    expect(result).not.toBeNull();
    const data = result!.request!.data as Record<string, unknown>;
    expect(data.From).toBe(REDACTED);
    expect(data.To).toBe(REDACTED);
    expect(data.Body).toBe(REDACTED);
    expect(data.MessageSid).toBe('SM_real'); // KEEP
    expect(result!.tags?.scope).toBe('platform');
    expect(getUntaggedEventDrops()).toBe(0);
  });
});

// ─── Scenario #5 — 23505 UNIQUE constraint regression case ──────────────

describe('§K.5 #5 — 23505 UNIQUE constraint on customer email (regression)', () => {
  it('predicted: ALLOW (A2 — raw QueryFailedError escapes catch); strip driverError.detail; tag tenant_id', () => {
    // The HANDLED case is a ConflictException thrown by
    // customers.service.ts:61-81 — that's filter D5/D9 territory.
    // The REGRESSION case is a raw TypeORM QueryFailedError escaping
    // past the service-layer catch (e.g., a future code path that
    // forgets to wrap). The audit predicts this should ALLOW (A2)
    // and the event arrives with driverError.detail STRIPPED.
    class QueryFailedErrorFake extends Error {
      code = '23505';
      constraint = 'idx_customers_tenant_email_unique';
      driverError = {
        detail: 'Key (email)=(jamie.real@example.com) already exists.',
        code: '23505',
      };
      constructor() {
        super('duplicate key value violates unique constraint');
      }
    }
    const exception = new QueryFailedErrorFake();

    const event: ErrorEvent = {
      event_id: 'evt-23505',
      type: undefined,
      request: {
        method: 'POST',
        url: '/customers',
        data: {
          first_name: 'Jamie',
          last_name: 'Rivera',
          email: 'jamie.real@example.com',
          phone: '5551112222',
          tenant_id: TENANT_UUID,
        },
      },
      // The exception's driverError.detail can also surface in extra
      // when callers attach the raw error. Test that path too.
      extra: {
        sql_error: {
          driverError: {
            detail:
              'Key (email)=(jamie.real@example.com) already exists.',
          },
        },
      },
    } as ErrorEvent;

    const result = runInClsContext({ [CLS_TENANT_ID]: TENANT_UUID }, () =>
      beforeSend(event, withHint(exception)),
    );

    expect(result).not.toBeNull();
    const data = result!.request!.data as Record<string, unknown>;
    // Email leak prevention — body and any nested driverError.detail
    expect(data.email).toBe(REDACTED);
    expect(data.first_name).toBe(REDACTED);
    expect(data.last_name).toBe(REDACTED);
    expect(data.phone).toBe(REDACTED);
    expect(data.tenant_id).toBe(TENANT_UUID);
    // Nested driverError under extra
    const sqlError = result!.extra!.sql_error as Record<string, unknown>;
    expect(sqlError.driverError).toBe(REDACTED);
    expect(result!.tags?.tenant_id).toBe(TENANT_UUID);
    expect(getUntaggedEventDrops()).toBe(0);
  });
});

// ─── Scenario #6 — 401 on /auth/profile from expired token ──────────────

describe('§K.5 #6 — 401 on /auth/profile from expired token', () => {
  it('predicted: DENY (filter D2); no event sent; counter NOT bumped', () => {
    // JwtAuthGuard throws this on token expiry. Audit §K.4 D2 covers
    // it; Sentry SDK auto-breadcrumbs do NOT capture the Authorization
    // header (sendDefaultPii: false in sentry.config.ts).
    const exception = new UnauthorizedException();

    const event: ErrorEvent = {
      event_id: 'evt-401',
      type: undefined,
      request: {
        method: 'GET',
        url: '/auth/profile',
        // If the SDK ever did capture the JWT, the email claim from
        // §K.2 surface 4 would be in scope. Compose with that risk.
        headers: {
          authorization: 'Bearer eyJ...redacted-test...',
        },
      },
    } as ErrorEvent;

    // No CLS context — unauthenticated failure. Even with no tenant_id
    // and no scope=platform set, the FILTER must still drop FIRST so
    // the untagged-event guard never sees the event.
    const result = beforeSend(event, withHint(exception));

    expect(result).toBeNull();
    expect(getUntaggedEventDrops()).toBe(0);
  });
});

// ─── Cross-scenario invariant — counter behavior ────────────────────────

describe('§K.5 cross-scenario invariants', () => {
  it('untaggedEventDrops stays 0 across all 5 scenarios run end-to-end', () => {
    // Re-run each scenario sequentially in a single test to confirm
    // counter behavior holds across the full pipeline.
    resetUntaggedEventDrops();

    // #1 ALLOW path — delivered, no drop
    runInClsContext({ [CLS_TENANT_ID]: TENANT_UUID }, () =>
      beforeSend(
        { event_id: '1', type: undefined } as ErrorEvent,
        withHint(new InternalServerErrorException('x')),
      ),
    );
    // #2 DENY (D7) — filter-drop, no counter bump
    beforeSend(
      { event_id: '2', type: undefined } as ErrorEvent,
      withHint(new BadRequestException('Invalid webhook signature')),
    );
    // #3 DENY (D6) — filter-drop, no counter bump
    beforeSend(
      { event_id: '3', type: undefined } as ErrorEvent,
      withHint(new UnauthorizedException('Invalid Twilio signature')),
    );
    // #5 ALLOW path — delivered (with valid CLS)
    runInClsContext({ [CLS_TENANT_ID]: TENANT_UUID }, () =>
      beforeSend(
        { event_id: '5', type: undefined } as ErrorEvent,
        withHint(new Error('raw QueryFailedError fake')),
      ),
    );
    // #6 DENY (D2) — filter-drop, no counter bump
    beforeSend(
      { event_id: '6', type: undefined } as ErrorEvent,
      withHint(new UnauthorizedException()),
    );

    expect(getUntaggedEventDrops()).toBe(0);
  });
});
