/**
 * Arc K Phase 1A Step 1 — CLS context key constants.
 *
 * The keys here form the contract that the TenantContextInterceptor
 * (authenticated requests), the per-iteration cron wrappers, and the
 * future Sentry beforeSend hook (Step 2) all read from.
 *
 * Exactly one of CLS_TENANT_ID or CLS_SCOPE must be populated for any
 * request that reaches an exception capture point. Step 2's untagged-
 * event guard treats the absence of both as a bug and drops the event.
 *
 * §K.3 (audit) lists every execution context where these keys must be
 * populated.
 */

/** UUID of the tenant on whose behalf the request is running. */
export const CLS_TENANT_ID = 'tenant_id';

/** UUID of the authenticated user (req.user.id / sub). */
export const CLS_USER_ID = 'user_id';

/** Role string (owner/admin/dispatcher/driver/etc). Optional. */
export const CLS_ROLE = 'role';

/**
 * For non-tenant-scoped contexts (health checks, anonymous routes,
 * pre-resolution webhook entry points). Value: 'platform'.
 */
export const CLS_SCOPE = 'scope';

/**
 * Typed CLS store for the API. Inject as `ClsService<ServiceOSClsStore>`
 * to get typed get/set/runWith. All keys are optional — exactly one of
 * tenant_id or scope is populated per request, never both.
 */
import type { ClsStore } from 'nestjs-cls';

export interface ServiceOSClsStore extends ClsStore {
  [CLS_TENANT_ID]?: string;
  [CLS_USER_ID]?: string;
  [CLS_ROLE]?: string;
  [CLS_SCOPE]?: 'platform';
}
