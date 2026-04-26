/**
 * Arc K Phase 1A Step 3 — §K.4 filter-rules tests.
 *
 * 10 deny tests (D1–D10): each rule drops a representative event.
 * 9 allow tests (A1–A9): each category passes the filter AND receives
 * correct tag application when CLS is populated.
 * Combined test: an allow-listed event with NO CLS context still gets
 * dropped by the untagged-event guard — proves the layering is intact.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';
import type { ErrorEvent, EventHint } from '@sentry/nestjs';

import {
  beforeSend,
  getUntaggedEventDrops,
  resetUntaggedEventDrops,
} from './before-send';
import { __denyPredicates, shouldDropEvent } from './filter-rules';
import {
  CLS_SCOPE,
  CLS_TENANT_ID,
  ServiceOSClsStore,
} from '../cls/cls.config';

const VALID_TENANT_UUID = '11111111-1111-4111-8111-111111111111';

function makeEvent(): ErrorEvent {
  return {
    event_id: 'evt-1',
    type: undefined,
    message: 'test',
    exception: { values: [{ type: 'Error', value: 'x' }] },
  } as ErrorEvent;
}

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

// ─── DENY rules — D1–D10 ─────────────────────────────────────────────────

describe('Filter rules — DENY (D1–D10)', () => {
  it('D1: BadRequestException → dropped', () => {
    const ex = new BadRequestException('validation failed');
    expect(__denyPredicates.D1(ex)).toBe(true);
    expect(shouldDropEvent(makeEvent(), withHint(ex))).toBe(true);
  });

  it('D2: UnauthorizedException → dropped', () => {
    const ex = new UnauthorizedException();
    expect(__denyPredicates.D2(ex)).toBe(true);
    expect(shouldDropEvent(makeEvent(), withHint(ex))).toBe(true);
  });

  it('D3: ForbiddenException → dropped', () => {
    const ex = new ForbiddenException();
    expect(__denyPredicates.D3(ex)).toBe(true);
    expect(shouldDropEvent(makeEvent(), withHint(ex))).toBe(true);
  });

  it('D4: NotFoundException → dropped', () => {
    const ex = new NotFoundException();
    expect(__denyPredicates.D4(ex)).toBe(true);
    expect(shouldDropEvent(makeEvent(), withHint(ex))).toBe(true);
  });

  it('D5: ConflictException → dropped', () => {
    const ex = new ConflictException('duplicate');
    expect(__denyPredicates.D5(ex)).toBe(true);
    expect(shouldDropEvent(makeEvent(), withHint(ex))).toBe(true);
  });

  it('D6: Twilio signature mismatch (UnauthorizedException with specific msg) → dropped', () => {
    const ex = new UnauthorizedException('Invalid Twilio signature');
    expect(__denyPredicates.D6(ex)).toBe(true);
    expect(shouldDropEvent(makeEvent(), withHint(ex))).toBe(true);
  });

  it('D7: Stripe signature mismatch (BadRequestException with specific msg) → dropped', () => {
    const ex = new BadRequestException('Invalid webhook signature');
    expect(__denyPredicates.D7(ex)).toBe(true);
    expect(shouldDropEvent(makeEvent(), withHint(ex))).toBe(true);
  });

  it('D8: Rate-limit (HttpException 429) → dropped', () => {
    const ex = new HttpException('rate limit', HttpStatus.TOO_MANY_REQUESTS);
    expect(__denyPredicates.D8(ex)).toBe(true);
    expect(shouldDropEvent(makeEvent(), withHint(ex))).toBe(true);
  });

  it('D9: Idempotency-key conflict (ConflictException) → dropped', () => {
    const ex = new ConflictException('idempotency conflict');
    expect(__denyPredicates.D9(ex)).toBe(true);
    expect(shouldDropEvent(makeEvent(), withHint(ex))).toBe(true);
  });

  it('D10: Translated user-facing error (BadRequest with registry msg) → dropped', () => {
    const ex = new BadRequestException('cancel_job_deeplink_terminal');
    expect(__denyPredicates.D10(ex)).toBe(true);
    expect(shouldDropEvent(makeEvent(), withHint(ex))).toBe(true);
  });

  it('beforeSend integration — denied event returns null and does NOT increment drops counter', () => {
    resetUntaggedEventDrops();
    const ex = new BadRequestException('class-validator failure');
    // Run inside a valid CLS context so the tag layer would otherwise
    // accept this event. The filter must still drop it FIRST.
    const result = runInClsContext({ [CLS_TENANT_ID]: VALID_TENANT_UUID }, () =>
      beforeSend(makeEvent(), withHint(ex)),
    );
    expect(result).toBeNull();
    // Drops counter is for UNTAGGED events only; filtered events
    // don't bump it.
    expect(getUntaggedEventDrops()).toBe(0);
  });
});

// ─── ALLOW rules — A1–A9 ────────────────────────────────────────────────

describe('Filter rules — ALLOW (A1–A9)', () => {
  beforeEach(() => {
    resetUntaggedEventDrops();
  });

  it('A1: Unhandled generic Error → not denied AND tagged with tenant_id from CLS', () => {
    const ex = new Error('something exploded');
    expect(shouldDropEvent(makeEvent(), withHint(ex))).toBe(false);

    const result = runInClsContext({ [CLS_TENANT_ID]: VALID_TENANT_UUID }, () =>
      beforeSend(makeEvent(), withHint(ex)),
    );
    expect(result).not.toBeNull();
    expect(result!.tags?.tenant_id).toBe(VALID_TENANT_UUID);
  });

  it('A2: DB constraint violation (QueryFailedError unexpected) → not denied AND tagged', () => {
    // Simulate a TypeORM QueryFailedError with a Postgres CHECK violation
    // code (23514). This is NOT pre-handled by service code; should ALLOW.
    class QueryFailedErrorFake extends Error {
      code = '23514';
      constructor() {
        super('check_violation');
      }
    }
    const ex = new QueryFailedErrorFake();
    expect(shouldDropEvent(makeEvent(), withHint(ex))).toBe(false);

    const result = runInClsContext({ [CLS_TENANT_ID]: VALID_TENANT_UUID }, () =>
      beforeSend(makeEvent(), withHint(ex)),
    );
    expect(result).not.toBeNull();
    expect(result!.tags?.tenant_id).toBe(VALID_TENANT_UUID);
  });

  it('A3: Stripe API error with unexpected status → not denied AND tagged with platform scope', () => {
    // Simulate a Stripe API error that's not in the expected status set.
    // The webhook context typically resolves to platform scope.
    class StripeAPIError extends Error {
      statusCode = 502;
      constructor() {
        super('stripe upstream gateway error');
      }
    }
    const ex = new StripeAPIError();
    expect(shouldDropEvent(makeEvent(), withHint(ex))).toBe(false);

    const result = runInClsContext({ [CLS_SCOPE]: 'platform' }, () =>
      beforeSend(makeEvent(), withHint(ex)),
    );
    expect(result).not.toBeNull();
    expect(result!.tags?.scope).toBe('platform');
  });

  it('A4: Twilio RestError (non-200, non-429) → not denied AND tagged', () => {
    class TwilioRestError extends Error {
      status = 503;
      constructor() {
        super('twilio gateway error');
      }
    }
    const ex = new TwilioRestError();
    expect(shouldDropEvent(makeEvent(), withHint(ex))).toBe(false);

    const result = runInClsContext({ [CLS_SCOPE]: 'platform' }, () =>
      beforeSend(makeEvent(), withHint(ex)),
    );
    expect(result).not.toBeNull();
    expect(result!.tags?.scope).toBe('platform');
  });

  it('A5: Vercel cold-start / timeout (generic Error) → not denied AND tagged', () => {
    // Vercel surfaces these as generic Error / Node native errors;
    // covered by the same path as A1 but documented separately for
    // operator clarity.
    const ex = new Error('Function execution timed out');
    expect(shouldDropEvent(makeEvent(), withHint(ex))).toBe(false);

    const result = runInClsContext({ [CLS_TENANT_ID]: VALID_TENANT_UUID }, () =>
      beforeSend(makeEvent(), withHint(ex)),
    );
    expect(result).not.toBeNull();
    expect(result!.tags?.tenant_id).toBe(VALID_TENANT_UUID);
  });

  it('A6: Driver app native crash (out of scope for API filter) → API never sees this', () => {
    // A6 fires in the React Native driver app; the API filter is
    // structurally never invoked. This test documents the boundary.
    // No event shape exists to assert — the assertion is that no
    // additional API filter logic is needed.
    expect(true).toBe(true);
  });

  it('A7: React error boundary catch (out of scope for API filter) → Web concern', () => {
    // A7 fires in the Next.js web app via global-error.tsx; same
    // boundary note as A6.
    expect(true).toBe(true);
  });

  it('A8: InternalServerErrorException → not denied AND tagged', () => {
    const ex = new InternalServerErrorException('unexpected state');
    expect(shouldDropEvent(makeEvent(), withHint(ex))).toBe(false);

    const result = runInClsContext({ [CLS_TENANT_ID]: VALID_TENANT_UUID }, () =>
      beforeSend(makeEvent(), withHint(ex)),
    );
    expect(result).not.toBeNull();
    expect(result!.tags?.tenant_id).toBe(VALID_TENANT_UUID);
  });

  it('A9: ServiceUnavailableException → not denied AND tagged', () => {
    const ex = new ServiceUnavailableException('third-party down');
    expect(shouldDropEvent(makeEvent(), withHint(ex))).toBe(false);

    const result = runInClsContext({ [CLS_TENANT_ID]: VALID_TENANT_UUID }, () =>
      beforeSend(makeEvent(), withHint(ex)),
    );
    expect(result).not.toBeNull();
    expect(result!.tags?.tenant_id).toBe(VALID_TENANT_UUID);
  });
});

// ─── Combined: filter passes BUT tag missing → guard still drops ──────────

describe('Filter + tag + guard layering', () => {
  beforeEach(() => {
    resetUntaggedEventDrops();
  });

  it('Allow-listed event with NO CLS tenant_id and NO scope → still dropped by untagged-event guard', () => {
    // A1 category: generic Error. Filter does NOT drop. But CLS has
    // nothing — the guard MUST drop and increment the counter.
    const ex = new Error('generic — filter would let this through');
    expect(shouldDropEvent(makeEvent(), withHint(ex))).toBe(false);

    const result = runInClsContext({}, () =>
      beforeSend(makeEvent(), withHint(ex)),
    );
    expect(result).toBeNull();
    expect(getUntaggedEventDrops()).toBe(1);
  });

  it('Allow-listed event with valid tenant_id → passes filter AND tag AND guard', () => {
    const ex = new InternalServerErrorException('alert me');
    const result = runInClsContext({ [CLS_TENANT_ID]: VALID_TENANT_UUID }, () =>
      beforeSend(makeEvent(), withHint(ex)),
    );
    expect(result).not.toBeNull();
    expect(result!.tags?.tenant_id).toBe(VALID_TENANT_UUID);
    expect(getUntaggedEventDrops()).toBe(0);
  });

  it('Denied event short-circuits before tag — does NOT bump drops counter', () => {
    const ex = new BadRequestException('validation');
    // Even with NO CLS context, denied events return null without
    // touching the untagged-event guard.
    const result = beforeSend(makeEvent(), withHint(ex));
    expect(result).toBeNull();
    expect(getUntaggedEventDrops()).toBe(0);
  });
});
