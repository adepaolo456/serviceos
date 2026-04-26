/**
 * Arc K Phase 1A Step 4 — §K.2 PII scrubber.
 *
 * Walks the Sentry event tree (payload + breadcrumbs) and applies
 * field-name-based STRIP / HASH / KEEP rules from the audit. The rule
 * is name-based, never value-pattern-based — regex over values produces
 * false positives that drop legitimate UUIDs and false negatives that
 * leak PII.
 *
 * HASH function (HARD REQUIREMENT):
 *   sha256(`${tenant_id}:${raw_value}:${SENTRY_HASH_SALT}`)
 *
 * If tenant_id or SALT is missing, HASH-classified fields are STRIPPED
 * instead of hashed. The function NEVER logs the raw value, tenant_id-
 * as-hash-input, salt, or hash output anywhere.
 *
 * The salt is read once at module init. Rotating it later breaks
 * deterministic grouping for hashed customer_id / user_id — see the
 * ops note in the Phase 1A prompt.
 */

import { createHash } from 'crypto';
import type { Breadcrumb, ErrorEvent } from '@sentry/nestjs';

import { CLS_TENANT_ID, ServiceOSClsStore } from '../cls/cls.config';
import { ClsServiceManager } from 'nestjs-cls';

// Salt read ONCE at module init. Never re-read; never logged.
const SALT: string = process.env.SENTRY_HASH_SALT ?? '';

// Sentinel for redacted fields. Stable string so Sentry's UI groups
// scrubbed fields identically across events.
const REDACTED = '[REDACTED]';

/**
 * §K.2 STRIP fields — must NEVER reach Sentry. Counted once per
 * unique field name; deduplicated across surfaces.
 *
 * Sources: customer/user names + contact, addresses, free-text notes,
 * SMS content, auth tokens (JWT email if captured), Stripe billing
 * details, Postgres driverError.detail, audit-log unstructured fields.
 */
const STRIP_FIELDS: ReadonlySet<string> = new Set([
  // Names / contact
  'first_name',
  'last_name',
  'firstName',
  'lastName',
  'name', // when key, it's typically a customer/billing name
  'email',
  'phone',
  'company_name',
  'companyName',
  // Addresses
  'address',
  'billing_address',
  'billingAddress',
  'service_address',
  'serviceAddress',
  'service_addresses',
  'serviceAddresses',
  'delivery_address',
  // Free text — may contain customer-identifying content
  'notes',
  'placement_notes',
  'placementNotes',
  'driver_instructions',
  'driverInstructions',
  'cancellation_reason',
  'reason',
  // Audit-log unstructured
  'metadata',
  // SMS / Twilio
  'body',
  'Body',
  'from_number',
  'to_number',
  'From',
  'To',
  // Driver / vehicle
  'emergency_contact',
  'emergencyContact',
  'additional_phones',
  'additionalPhones',
  'additional_emails',
  'additionalEmails',
  'vehicle_info',
  'vehicleInfo',
  // Payment instrument
  'stripe_payment_intent_id',
  'stripePaymentIntentId',
  'reference_number',
  'referenceNumber',
  // DB error contexts (Postgres driverError leaks)
  'detail',
  'where',
  'driverError',
  // Stripe webhook block — strip whole subtree
  'billing_details',
  'billingDetails',
]);

/**
 * §K.2 HASH fields — replaced with deterministic SHA-256 hex. Hashing
 * preserves grouping ("see all events for this customer") without
 * exposing the raw identifier.
 *
 * customerId / userId are tenant-scoped UUIDs in our system, but
 * they're still classified HASH (not KEEP) because in legal/compliance
 * contexts a UUID that maps to an individual is PII. The HASH path
 * mixes tenant_id into the digest so the same customer_id under
 * different tenants produces different hashes (defense against
 * cross-tenant correlation in event data).
 *
 * Stripe `customer` is the vendor's customer ID (e.g., cus_*). When
 * encountered as a string in a Stripe event payload, hash it.
 */
const HASH_FIELDS: ReadonlySet<string> = new Set([
  'customer_id',
  'customerId',
  'user_id',
  'userId',
  'sub', // JWT subject
  // Stripe customer ref appears as 'customer' in Stripe event payloads.
  // We only hash when value is a string (entity 'customer' relations
  // are objects and recurse for STRIP).
]);

/**
 * Compute the deterministic hash. The function is internal and
 * preconditions are enforced by callers (tenantId truthy, salt present).
 * NEVER log any input or output of this function.
 */
function computeHash(tenantId: string, rawValue: string): string {
  return createHash('sha256')
    .update(`${tenantId}:${rawValue}:${SALT}`)
    .digest('hex');
}

/**
 * Hash a string field. If tenant_id or SALT is missing, fall back to
 * STRIP — we never produce a hash without a tenant_id binding it.
 */
function hashOrStrip(rawValue: string, tenantId: string | null): string {
  if (!tenantId) return REDACTED;
  if (!SALT) return REDACTED;
  return computeHash(tenantId, rawValue);
}

/**
 * Read tenant_id from the active CLS context. Used to bind hash inputs.
 * Returns null if no active context — callers fall back to STRIP.
 */
function readTenantId(): string | null {
  try {
    const cls = ClsServiceManager.getClsService<ServiceOSClsStore>();
    if (!cls.isActive()) return null;
    const t = cls.get(CLS_TENANT_ID);
    return typeof t === 'string' && t.length > 0 ? t : null;
  } catch {
    return null;
  }
}

/**
 * Apply scrubbing rules to a single (key, value) pair. Returns the
 * scrubbed value. Recurses for nested objects/arrays.
 */
function scrubValue(
  key: string,
  value: unknown,
  tenantId: string | null,
): unknown {
  if (STRIP_FIELDS.has(key)) return REDACTED;

  if (HASH_FIELDS.has(key)) {
    if (typeof value === 'string') return hashOrStrip(value, tenantId);
    // Non-string at a HASH key (rare — e.g. customerId: null). Pass through.
    if (value == null) return value;
    // Recurse if it's somehow an object/array — treat sub-fields normally.
  }

  // Special case: 'customer' string in Stripe event payloads is the
  // Stripe vendor customer ID. Hash if string; recurse if object
  // (entity relation).
  if (key === 'customer' && typeof value === 'string') {
    return hashOrStrip(value, tenantId);
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubValueByContext(item, tenantId));
  }

  if (value && typeof value === 'object') {
    return scrubObject(value as Record<string, unknown>, tenantId);
  }

  return value;
}

/**
 * For values inside arrays — we don't have a key context, so recurse
 * by structural type only. STRIP/HASH never applies at array element
 * level since the rule is keyed on the parent's field name.
 */
function scrubValueByContext(value: unknown, tenantId: string | null): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => scrubValueByContext(item, tenantId));
  }
  if (value && typeof value === 'object') {
    return scrubObject(value as Record<string, unknown>, tenantId);
  }
  return value;
}

function scrubObject(
  obj: Record<string, unknown>,
  tenantId: string | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = scrubValue(k, v, tenantId);
  }
  return out;
}

/**
 * Scrub a Sentry event in place. Returns the same event reference
 * with PII fields replaced. Applied to:
 *   - event.request.data (HTTP request body)
 *   - event.request.headers (Authorization, Cookie are sensitive)
 *   - event.request.query_string (may contain customer_id)
 *   - event.request.cookies
 *   - event.extra (developer-attached context)
 *   - event.contexts (SDK contexts)
 *   - event.user
 *   - event.breadcrumbs[].data
 *
 * The scrubber DOES NOT touch event.message or event.exception.values[].value
 * — those are operator-controlled strings. PII in exception messages is a
 * code-side concern (caught by the customer.service.ts sanitization
 * pattern documented in §K.2 surface 6).
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const tenantId = readTenantId();

  if (event.request?.data && typeof event.request.data === 'object') {
    event.request.data = scrubObject(
      event.request.data as Record<string, unknown>,
      tenantId,
    );
  }
  if (event.request?.headers && typeof event.request.headers === 'object') {
    event.request.headers = scrubObject(
      event.request.headers as Record<string, unknown>,
      tenantId,
    ) as Record<string, string>;
  }
  if (event.request?.cookies && typeof event.request.cookies === 'object') {
    event.request.cookies = scrubObject(
      event.request.cookies as Record<string, unknown>,
      tenantId,
    ) as Record<string, string>;
  }
  if (event.request?.query_string && typeof event.request.query_string === 'object') {
    event.request.query_string = scrubObject(
      event.request.query_string as Record<string, unknown>,
      tenantId,
    ) as Record<string, string>;
  }

  if (event.extra) {
    event.extra = scrubObject(event.extra, tenantId);
  }
  if (event.contexts) {
    event.contexts = scrubObject(
      event.contexts as Record<string, unknown>,
      tenantId,
    ) as ErrorEvent['contexts'];
  }
  if (event.user) {
    event.user = scrubObject(
      event.user as Record<string, unknown>,
      tenantId,
    ) as ErrorEvent['user'];
  }

  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map((bc) =>
      scrubBreadcrumb(bc, tenantId),
    );
  }

  return event;
}

function scrubBreadcrumb(bc: Breadcrumb, tenantId: string | null): Breadcrumb {
  const out: Breadcrumb = { ...bc };
  if (out.data && typeof out.data === 'object') {
    out.data = scrubObject(out.data as Record<string, unknown>, tenantId);
  }
  return out;
}

/**
 * Test-only — exposes internals for unit verification. NEVER call
 * from production code.
 */
export const __scrubberInternals = {
  STRIP_FIELDS,
  HASH_FIELDS,
  REDACTED,
  scrubObject,
  scrubValue,
  computeHash,
  hashOrStrip,
};
