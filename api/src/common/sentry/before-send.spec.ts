/**
 * Arc K Phase 1A Step 2 — beforeSend + untagged-event guard tests.
 *
 * Proves the structural defense: every event delivered to Sentry has
 * either tags.tenant_id (UUID) OR tags.scope === 'platform'. If neither
 * is derivable from CLS, the event is dropped (return null) and the
 * untaggedEventDrops counter increments. The dropped event payload is
 * NEVER transmitted.
 */

import { ClsServiceManager } from 'nestjs-cls';
import type { ErrorEvent } from '@sentry/nestjs';

import {
  beforeSend,
  getUntaggedEventDrops,
  resetUntaggedEventDrops,
} from './before-send';
import { CLS_SCOPE, CLS_TENANT_ID, ServiceOSClsStore } from '../cls/cls.config';

const VALID_TENANT_UUID = '11111111-1111-4111-8111-111111111111';
const INVALID_UUID = 'not-a-uuid';

function makeEvent(): ErrorEvent {
  return {
    event_id: 'evt-1',
    type: undefined,
    message: 'test exception',
    exception: { values: [{ type: 'Error', value: 'x' }] },
  } as ErrorEvent;
}

/**
 * Run a callback inside a CLS context with the given store contents.
 * Uses ClsServiceManager.getClsService() — the same path beforeSend uses.
 */
function runInClsContext<T>(
  store: Partial<ServiceOSClsStore>,
  fn: () => T,
): T {
  const cls = ClsServiceManager.getClsService<ServiceOSClsStore>();
  return cls.runWith(store as ServiceOSClsStore, fn);
}

describe('beforeSend — Arc K Phase 1A Step 2 (untagged-event guard)', () => {
  beforeEach(() => {
    resetUntaggedEventDrops();
  });

  // ── Tag application ─────────────────────────────────────────────────
  it('1. authenticated tenant — sets event.tags.tenant_id from CLS', () => {
    const ev = makeEvent();
    const result = runInClsContext({ [CLS_TENANT_ID]: VALID_TENANT_UUID }, () =>
      beforeSend(ev),
    );

    expect(result).not.toBeNull();
    expect(result!.tags?.tenant_id).toBe(VALID_TENANT_UUID);
    expect(result!.tags?.scope).toBeUndefined();
    expect(getUntaggedEventDrops()).toBe(0);
  });

  it('2. platform scope — sets event.tags.scope=platform from CLS', () => {
    const ev = makeEvent();
    const result = runInClsContext({ [CLS_SCOPE]: 'platform' }, () =>
      beforeSend(ev),
    );

    expect(result).not.toBeNull();
    expect(result!.tags?.scope).toBe('platform');
    expect(result!.tags?.tenant_id).toBeUndefined();
    expect(getUntaggedEventDrops()).toBe(0);
  });

  // ── Drop guard ──────────────────────────────────────────────────────
  it('3. no CLS tag — drops event AND increments counter', () => {
    const ev = makeEvent();
    const result = runInClsContext({}, () => beforeSend(ev));

    expect(result).toBeNull();
    expect(getUntaggedEventDrops()).toBe(1);
  });

  it('4. invalid tenant_id (not a UUID) — drops event', () => {
    const ev = makeEvent();
    const result = runInClsContext({ [CLS_TENANT_ID]: INVALID_UUID }, () =>
      beforeSend(ev),
    );

    expect(result).toBeNull();
    expect(getUntaggedEventDrops()).toBe(1);
  });

  it('5. no active CLS context — drops event', () => {
    // Don't wrap in cls.runWith — beforeSend is called outside any context.
    const ev = makeEvent();
    const result = beforeSend(ev);

    expect(result).toBeNull();
    expect(getUntaggedEventDrops()).toBe(1);
  });

  // ── Counter behavior ────────────────────────────────────────────────
  it('6. counter accumulates across multiple drops', () => {
    runInClsContext({}, () => beforeSend(makeEvent()));
    runInClsContext({}, () => beforeSend(makeEvent()));
    runInClsContext({}, () => beforeSend(makeEvent()));

    expect(getUntaggedEventDrops()).toBe(3);
  });

  it('7. counter does NOT increment when event is delivered', () => {
    runInClsContext({ [CLS_TENANT_ID]: VALID_TENANT_UUID }, () =>
      beforeSend(makeEvent()),
    );
    runInClsContext({ [CLS_SCOPE]: 'platform' }, () =>
      beforeSend(makeEvent()),
    );

    expect(getUntaggedEventDrops()).toBe(0);
  });

  // ── Dropped events transmit NOTHING ─────────────────────────────────
  it('8. dropped event — return value is null (not a redacted payload)', () => {
    const ev = makeEvent();
    const result = runInClsContext({}, () => beforeSend(ev));

    // The contract is strict: dropped events MUST return null. Returning
    // a partial/redacted event would still send something to Sentry.
    expect(result).toBeNull();
    // null !== undefined !== {} — make sure it's the literal null.
    expect(result === null).toBe(true);
  });

  // ── Tenant tag wins over platform scope when both somehow set ───────
  it('9. tenant_id present alongside scope — tenant_id wins', () => {
    const ev = makeEvent();
    const result = runInClsContext(
      {
        [CLS_TENANT_ID]: VALID_TENANT_UUID,
        [CLS_SCOPE]: 'platform' as const,
      },
      () => beforeSend(ev),
    );

    expect(result!.tags?.tenant_id).toBe(VALID_TENANT_UUID);
    expect(result!.tags?.scope).toBeUndefined();
  });
});
