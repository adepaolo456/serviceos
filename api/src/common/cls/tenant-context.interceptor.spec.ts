/**
 * Arc K Phase 1A Step 1 — TenantContextInterceptor unit tests.
 *
 * Verifies the contract that CLS keys are populated correctly given
 * three input shapes:
 *   #1 authenticated tenant request → { tenant_id, user_id, role }
 *   #2 anonymous request (req.user undefined) → { scope: 'platform' }
 *   #3 portal request (req.user has tenantId, no role) → { tenant_id, user_id }
 *
 * The interceptor MUST NOT throw on any of these shapes — exceptions
 * here would block every HTTP request through the API.
 */

import { ExecutionContext } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { of } from 'rxjs';

import { TenantContextInterceptor } from './tenant-context.interceptor';
import {
  CLS_ROLE,
  CLS_SCOPE,
  CLS_TENANT_ID,
  CLS_USER_ID,
  ServiceOSClsStore,
} from './cls.config';

function makeMockContext(req: unknown): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

function makeMockCls(): {
  cls: ClsService<ServiceOSClsStore>;
  store: Map<string, unknown>;
} {
  const store = new Map<string, unknown>();
  const cls = {
    get: jest.fn((key: string) => store.get(key)),
    set: jest.fn((key: string, value: unknown) => {
      store.set(key, value);
    }),
  } as unknown as ClsService<ServiceOSClsStore>;
  return { cls, store };
}

describe('TenantContextInterceptor — Arc K Phase 1A Step 1', () => {
  // ── #1 authenticated tenant request ──────────────────────────────────
  it('1. authenticated tenant request — populates tenant_id + user_id + role', async () => {
    const { cls, store } = makeMockCls();
    const interceptor = new TenantContextInterceptor(cls);
    const context = makeMockContext({
      user: {
        tenantId: 'tenant-A',
        id: 'user-1',
        role: 'owner',
      },
    });

    const next = { handle: jest.fn().mockReturnValue(of('result')) };
    const result$ = interceptor.intercept(context, next);
    await result$.toPromise();

    expect(store.get(CLS_TENANT_ID)).toBe('tenant-A');
    expect(store.get(CLS_USER_ID)).toBe('user-1');
    expect(store.get(CLS_ROLE)).toBe('owner');
    expect(store.has(CLS_SCOPE)).toBe(false);
    expect(next.handle).toHaveBeenCalledTimes(1);
  });

  // ── #2 anonymous request ──────────────────────────────────────────────
  it('2. anonymous request — populates scope=platform, no tenant_id', async () => {
    const { cls, store } = makeMockCls();
    const interceptor = new TenantContextInterceptor(cls);
    const context = makeMockContext({}); // no req.user

    const next = { handle: jest.fn().mockReturnValue(of('result')) };
    const result$ = interceptor.intercept(context, next);
    await result$.toPromise();

    expect(store.has(CLS_TENANT_ID)).toBe(false);
    expect(store.get(CLS_SCOPE)).toBe('platform');
  });

  // ── #3 portal request (tenantId + id from portal JWT, no role) ───────
  it('3. portal request — populates tenant_id + user_id without role', async () => {
    const { cls, store } = makeMockCls();
    const interceptor = new TenantContextInterceptor(cls);
    const context = makeMockContext({
      user: {
        tenantId: 'tenant-portal',
        id: 'cust-99',
        // no role — portal users don't have tenant-user roles
      },
    });

    const next = { handle: jest.fn().mockReturnValue(of('result')) };
    const result$ = interceptor.intercept(context, next);
    await result$.toPromise();

    expect(store.get(CLS_TENANT_ID)).toBe('tenant-portal');
    expect(store.get(CLS_USER_ID)).toBe('cust-99');
    expect(store.has(CLS_ROLE)).toBe(false);
    expect(store.has(CLS_SCOPE)).toBe(false);
  });

  // ── #4 user.sub fallback (JWT subject) instead of user.id ────────────
  it('4. JWT user.sub fallback — uses sub when id is absent', async () => {
    const { cls, store } = makeMockCls();
    const interceptor = new TenantContextInterceptor(cls);
    const context = makeMockContext({
      user: { tenantId: 'tenant-B', sub: 'sub-from-jwt', role: 'admin' },
    });

    const next = { handle: jest.fn().mockReturnValue(of('result')) };
    const result$ = interceptor.intercept(context, next);
    await result$.toPromise();

    expect(store.get(CLS_TENANT_ID)).toBe('tenant-B');
    expect(store.get(CLS_USER_ID)).toBe('sub-from-jwt');
    expect(store.get(CLS_ROLE)).toBe('admin');
  });

  // ── #5 upstream override preserved (cron / webhook ran cls.runWith first)
  it('5. upstream tenant_id override preserved — does not overwrite to platform', async () => {
    const { cls, store } = makeMockCls();
    // Simulate a cron handler having set tenant_id via cls.runWith earlier.
    store.set(CLS_TENANT_ID, 'tenant-from-cron-loop');
    const interceptor = new TenantContextInterceptor(cls);
    const context = makeMockContext({}); // no req.user

    const next = { handle: jest.fn().mockReturnValue(of('result')) };
    const result$ = interceptor.intercept(context, next);
    await result$.toPromise();

    // Upstream tenant_id wins — interceptor must NOT overwrite to platform.
    expect(store.get(CLS_TENANT_ID)).toBe('tenant-from-cron-loop');
    expect(store.has(CLS_SCOPE)).toBe(false);
  });
});
