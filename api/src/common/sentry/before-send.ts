/**
 * Arc K Phase 1A Step 2 — Sentry beforeSend hook + untagged-event guard.
 *
 * INVARIANT (Phase 1A hard invariant #1):
 *   Every event delivered to Sentry MUST have either
 *     - event.tags.tenant_id (a UUID matching UUID_RE), OR
 *     - event.tags.scope === 'platform'
 *   If neither is derivable from CLS, the event is DROPPED (return null)
 *   and the in-process untaggedEventDrops counter increments. The dropped
 *   event's payload is NEVER transmitted, not even partially.
 *
 * The counter is observable via getUntaggedEventDrops() for tests and
 * the Halt Gate output. A rate-limited debug log emits at most 1/min.
 *
 * Steps 3 (filter rules) and 4 (PII scrubbing) extend this hook.
 * Order in those later steps will be:
 *   1. filter (drop expected exceptions early — D1..D10)
 *   2. scrub  (strip / hash PII fields)
 *   3. tag    (set tenant_id or scope=platform; drop if neither)
 *
 * In Step 2 only the tag/drop layer is wired; filter/scrub are
 * placeholders that will fill in later.
 */

import type { ErrorEvent, EventHint } from '@sentry/nestjs';
import { ClsServiceManager } from 'nestjs-cls';

import {
  CLS_SCOPE,
  CLS_TENANT_ID,
  ServiceOSClsStore,
} from '../cls/cls.config';

// RFC 4122 UUID format. Strict — exactly 36 chars, four dashes.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let untaggedEventDrops = 0;
let lastDebugLogTime = 0;
const DEBUG_LOG_RATE_LIMIT_MS = 60_000;

export function getUntaggedEventDrops(): number {
  return untaggedEventDrops;
}

/**
 * Test-only — never call from production code.
 */
export function resetUntaggedEventDrops(): void {
  untaggedEventDrops = 0;
  lastDebugLogTime = 0;
}

function logUntaggedDropRateLimited(stableLocationId: string): void {
  const now = Date.now();
  if (now - lastDebugLogTime > DEBUG_LOG_RATE_LIMIT_MS) {
    lastDebugLogTime = now;
    // Stable location id only — never the event payload, never raw values.
    // eslint-disable-next-line no-console
    console.warn(
      `[sentry] untagged_event_drops=${untaggedEventDrops} loc=${stableLocationId}`,
    );
  }
}

/**
 * Read CLS context safely. Returns nulls if no active CLS context
 * (e.g., during boot, during a startup exception before middleware
 * runs). Both nulls signal the event must be dropped.
 */
function readClsContext(): {
  tenantId: string | null;
  scope: 'platform' | null;
} {
  try {
    const cls = ClsServiceManager.getClsService<ServiceOSClsStore>();
    // cls.isActive() guards against reading outside a context.
    if (!cls.isActive()) return { tenantId: null, scope: null };
    const tenantId = cls.get(CLS_TENANT_ID) ?? null;
    const scope = cls.get(CLS_SCOPE) ?? null;
    return {
      tenantId: typeof tenantId === 'string' ? tenantId : null,
      scope: scope === 'platform' ? 'platform' : null,
    };
  } catch {
    return { tenantId: null, scope: null };
  }
}

/**
 * The Sentry beforeSend hook. Returns the (tagged) event for delivery,
 * or null to drop the event entirely.
 */
export function beforeSend(event: ErrorEvent, _hint?: EventHint): ErrorEvent | null {
  // Step 3 filter rules will run here; Step 4 scrubbing will run here.
  // Step 2 wires only the tag/drop layer.

  const { tenantId, scope } = readClsContext();

  // Ensure tags object exists.
  event.tags = event.tags ?? {};

  if (tenantId && UUID_RE.test(tenantId)) {
    event.tags.tenant_id = tenantId;
    return event;
  }

  if (scope === 'platform') {
    event.tags.scope = 'platform';
    return event;
  }

  // Untagged-event guard fires. Drop the event — DO NOT transmit anything.
  untaggedEventDrops += 1;
  logUntaggedDropRateLimited('beforeSend:no_cls_tag');
  return null;
}
