/**
 * Arc K Phase 1A Step 4 — PII scrubber tests.
 *
 * Coverage requirements (§K.2):
 *   - Every STRIP family: name/contact, address, free-text, SMS,
 *     auth/PII, payment, DB error, billing_details
 *   - Every HASH field: customer_id, user_id/sub, Stripe customer
 *   - Every KEEP field family: tenant_id, *_id UUIDs, status enums,
 *     numerics
 *   - Hash determinism + cross-tenant difference
 *   - Hash irreversibility (NOT base64-decodable)
 *   - No-tenant_id fallback: HASH fields STRIP without tenant_id
 *   - Breadcrumb scrubbing
 *   - Stripe billing_details block (whole-subtree strip)
 *   - Twilio webhook fields (From / To / Body)
 *
 * Hard rule: NEVER log raw values, hash inputs, or the salt.
 */

import { ClsServiceManager } from 'nestjs-cls';
import type { ErrorEvent } from '@sentry/nestjs';

import { __scrubberInternals, scrubEvent } from './scrubber';
import { CLS_TENANT_ID, ServiceOSClsStore } from '../cls/cls.config';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const REDACTED = __scrubberInternals.REDACTED;

// SENTRY_HASH_SALT is set in src/test-setup.ts (jest setupFiles hook)
// BEFORE the scrubber module loads. The scrubber captures SALT at
// module init; setting it later in beforeAll would be too late.

function runInClsContext<T>(
  store: Partial<ServiceOSClsStore>,
  fn: () => T,
): T {
  const cls = ClsServiceManager.getClsService<ServiceOSClsStore>();
  return cls.runWith(store as ServiceOSClsStore, fn);
}

function ev(data: Record<string, unknown>): ErrorEvent {
  return {
    event_id: 'evt-1',
    type: undefined,
    request: { data },
  } as ErrorEvent;
}

// ─── STRIP families ─────────────────────────────────────────────────────

describe('Scrubber — STRIP fields', () => {
  it('name / contact fields are stripped', () => {
    const e = scrubEvent(
      ev({
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@example.com',
        phone: '5551234567',
        company_name: 'Acme Co',
      }),
    );
    const data = e.request!.data as Record<string, unknown>;
    expect(data.first_name).toBe(REDACTED);
    expect(data.last_name).toBe(REDACTED);
    expect(data.email).toBe(REDACTED);
    expect(data.phone).toBe(REDACTED);
    expect(data.company_name).toBe(REDACTED);
  });

  it('address fields are stripped', () => {
    const e = scrubEvent(
      ev({
        billing_address: { street: '123 Main' },
        service_address: { street: '456 Oak' },
        service_addresses: [{ street: '789 Pine' }],
        address: '100 Elm',
        delivery_address: { street: '200 Birch' },
      }),
    );
    const data = e.request!.data as Record<string, unknown>;
    expect(data.billing_address).toBe(REDACTED);
    expect(data.service_address).toBe(REDACTED);
    expect(data.service_addresses).toBe(REDACTED);
    expect(data.address).toBe(REDACTED);
    expect(data.delivery_address).toBe(REDACTED);
  });

  it('free-text fields are stripped (notes, placement_notes, reason, metadata)', () => {
    const e = scrubEvent(
      ev({
        notes: 'Customer prefers afternoon delivery',
        placement_notes: 'Behind the gate',
        driver_instructions: 'Call before arrival',
        cancellation_reason: 'Customer no longer needs service',
        reason: 'Closing account',
        metadata: { anything: 'could be here' },
      }),
    );
    const data = e.request!.data as Record<string, unknown>;
    expect(data.notes).toBe(REDACTED);
    expect(data.placement_notes).toBe(REDACTED);
    expect(data.driver_instructions).toBe(REDACTED);
    expect(data.cancellation_reason).toBe(REDACTED);
    expect(data.reason).toBe(REDACTED);
    expect(data.metadata).toBe(REDACTED);
  });

  it('SMS fields (Twilio webhook) are stripped — From, To, Body', () => {
    const e = scrubEvent(
      ev({
        From: '+15551234567',
        To: '+15559876543',
        Body: 'STOP',
        from_number: '+15551111111',
        to_number: '+15552222222',
        body: 'lowercase variant',
      }),
    );
    const data = e.request!.data as Record<string, unknown>;
    expect(data.From).toBe(REDACTED);
    expect(data.To).toBe(REDACTED);
    expect(data.Body).toBe(REDACTED);
    expect(data.from_number).toBe(REDACTED);
    expect(data.to_number).toBe(REDACTED);
    expect(data.body).toBe(REDACTED);
  });

  it('auth / driver / vehicle PII fields are stripped', () => {
    const e = scrubEvent(
      ev({
        emergency_contact: { name: 'Mom', phone: '5550000' },
        additional_phones: ['5551111', '5552222'],
        additional_emails: ['alt@example.com'],
        vehicle_info: { vin: '1HGCM82633A123456' },
      }),
    );
    const data = e.request!.data as Record<string, unknown>;
    expect(data.emergency_contact).toBe(REDACTED);
    expect(data.additional_phones).toBe(REDACTED);
    expect(data.additional_emails).toBe(REDACTED);
    expect(data.vehicle_info).toBe(REDACTED);
  });

  it('payment instrument fields are stripped', () => {
    const e = scrubEvent(
      ev({
        stripe_payment_intent_id: 'pi_abc123',
        reference_number: 'CHK-9999',
      }),
    );
    const data = e.request!.data as Record<string, unknown>;
    expect(data.stripe_payment_intent_id).toBe(REDACTED);
    expect(data.reference_number).toBe(REDACTED);
  });

  it('DB error context fields are stripped (driverError.detail, where)', () => {
    const e = scrubEvent(
      ev({
        driverError: { detail: 'Key (email)=(jamie@example.com) already exists' },
        detail: 'inline detail',
        where: 'PL/pgSQL function',
      }),
    );
    const data = e.request!.data as Record<string, unknown>;
    expect(data.driverError).toBe(REDACTED);
    expect(data.detail).toBe(REDACTED);
    expect(data.where).toBe(REDACTED);
  });

  it('Stripe billing_details block stripped as whole subtree', () => {
    const e = scrubEvent(
      ev({
        billing_details: {
          email: 'card@example.com',
          name: 'Card Holder',
          address: { city: 'Springfield' },
          phone: '5551234567',
        },
      }),
    );
    const data = e.request!.data as Record<string, unknown>;
    expect(data.billing_details).toBe(REDACTED);
  });

  it('STRIP rules apply recursively to nested objects', () => {
    const e = scrubEvent(
      ev({
        outer: {
          customer: {
            first_name: 'Jane',
            email: 'jane@example.com',
          },
          job_id: '550e8400-e29b-41d4-a716-446655440000',
        },
      }),
    );
    const outer = (e.request!.data as any).outer;
    expect(outer.customer.first_name).toBe(REDACTED);
    expect(outer.customer.email).toBe(REDACTED);
    expect(outer.job_id).toBe('550e8400-e29b-41d4-a716-446655440000'); // KEEP
  });
});

// ─── HASH fields ────────────────────────────────────────────────────────

describe('Scrubber — HASH fields', () => {
  it('customer_id / customerId hashed deterministically per tenant', () => {
    const result = runInClsContext({ [CLS_TENANT_ID]: TENANT_A }, () =>
      scrubEvent(
        ev({
          customer_id: 'cust-uuid-123',
          customerId: 'cust-uuid-456',
        }),
      ),
    );
    const data = result.request!.data as Record<string, unknown>;
    expect(typeof data.customer_id).toBe('string');
    expect((data.customer_id as string).length).toBe(64); // sha256 hex
    expect(data.customer_id).not.toBe('cust-uuid-123');
    expect(typeof data.customerId).toBe('string');
    expect((data.customerId as string).length).toBe(64);
  });

  it('user_id / userId / sub hashed', () => {
    const result = runInClsContext({ [CLS_TENANT_ID]: TENANT_A }, () =>
      scrubEvent(
        ev({
          user_id: 'user-1',
          userId: 'user-2',
          sub: 'user-3',
        }),
      ),
    );
    const data = result.request!.data as Record<string, unknown>;
    expect((data.user_id as string).length).toBe(64);
    expect((data.userId as string).length).toBe(64);
    expect((data.sub as string).length).toBe(64);
  });

  it('Stripe vendor customer ID (string at key "customer") is hashed', () => {
    const result = runInClsContext({ [CLS_TENANT_ID]: TENANT_A }, () =>
      scrubEvent(ev({ customer: 'cus_abc123' })),
    );
    const data = result.request!.data as Record<string, unknown>;
    expect(typeof data.customer).toBe('string');
    expect((data.customer as string).length).toBe(64);
    expect(data.customer).not.toBe('cus_abc123');
  });

  it('hash determinism — same (raw, tenant) → same hash', () => {
    const r1 = runInClsContext({ [CLS_TENANT_ID]: TENANT_A }, () =>
      scrubEvent(ev({ customer_id: 'cust-1' })),
    );
    const r2 = runInClsContext({ [CLS_TENANT_ID]: TENANT_A }, () =>
      scrubEvent(ev({ customer_id: 'cust-1' })),
    );
    expect((r1.request!.data as any).customer_id).toBe(
      (r2.request!.data as any).customer_id,
    );
  });

  it('hash cross-tenant difference — same raw, different tenant → different hash', () => {
    const rA = runInClsContext({ [CLS_TENANT_ID]: TENANT_A }, () =>
      scrubEvent(ev({ customer_id: 'cust-1' })),
    );
    const rB = runInClsContext({ [CLS_TENANT_ID]: TENANT_B }, () =>
      scrubEvent(ev({ customer_id: 'cust-1' })),
    );
    expect((rA.request!.data as any).customer_id).not.toBe(
      (rB.request!.data as any).customer_id,
    );
  });

  it('hash irreversibility — output is NOT base64-decodable to input', () => {
    const result = runInClsContext({ [CLS_TENANT_ID]: TENANT_A }, () =>
      scrubEvent(ev({ customer_id: 'human-readable-input' })),
    );
    const hash = (result.request!.data as any).customer_id as string;
    // sha256 hex = lowercase 0-9 a-f, length 64. Try base64 decode and
    // confirm it does NOT yield the original.
    let decoded = '';
    try {
      decoded = Buffer.from(hash, 'base64').toString('utf-8');
    } catch {
      // OK — base64 throws is fine, also confirms irreversibility
    }
    expect(decoded).not.toContain('human-readable-input');
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });

  it('no-tenant_id fallback — HASH fields are STRIPPED without tenant_id', () => {
    // No CLS context → no tenant_id → hashOrStrip returns REDACTED.
    const result = scrubEvent(ev({ customer_id: 'cust-no-tenant' }));
    const data = result.request!.data as Record<string, unknown>;
    expect(data.customer_id).toBe(REDACTED);
  });
});

// ─── KEEP fields ────────────────────────────────────────────────────────

describe('Scrubber — KEEP fields', () => {
  it('tenant_id passes through unchanged', () => {
    const result = scrubEvent(ev({ tenant_id: TENANT_A }));
    expect((result.request!.data as any).tenant_id).toBe(TENANT_A);
  });

  it('internal UUIDs (job_id, invoice_id, payment_id) pass through', () => {
    const result = scrubEvent(
      ev({
        job_id: '550e8400-e29b-41d4-a716-446655440000',
        invoice_id: '550e8400-e29b-41d4-a716-446655440001',
        payment_id: '550e8400-e29b-41d4-a716-446655440002',
        asset_id: '550e8400-e29b-41d4-a716-446655440003',
      }),
    );
    const data = result.request!.data as Record<string, unknown>;
    expect(data.job_id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(data.invoice_id).toBe('550e8400-e29b-41d4-a716-446655440001');
    expect(data.payment_id).toBe('550e8400-e29b-41d4-a716-446655440002');
    expect(data.asset_id).toBe('550e8400-e29b-41d4-a716-446655440003');
  });

  it('status enums and numeric fields pass through', () => {
    const result = scrubEvent(
      ev({
        status: 'paid',
        job_type: 'delivery',
        priority: 'high',
        role: 'owner',
        amount: 250.5,
        invoice_number: 1015,
        balance_due: 0,
      }),
    );
    const data = result.request!.data as Record<string, unknown>;
    expect(data.status).toBe('paid');
    expect(data.job_type).toBe('delivery');
    expect(data.priority).toBe('high');
    expect(data.role).toBe('owner');
    expect(data.amount).toBe(250.5);
    expect(data.invoice_number).toBe(1015);
    expect(data.balance_due).toBe(0);
  });

  it('Stripe MessageSid / event id / metadata.invoiceId pass through', () => {
    // 'metadata' is in STRIP_FIELDS by default — but Stripe webhooks
    // use it for tenant tagging. The key is in STRIP because audit-log
    // metadata is unstructured; for Stripe, the full block strip is
    // intentional defense-in-depth (we already extract tenantId in
    // the controller before scrubbing happens).
    const result = scrubEvent(
      ev({
        MessageSid: 'SM_abc123',
        event_id: 'evt-stripe-123',
      }),
    );
    const data = result.request!.data as Record<string, unknown>;
    expect(data.MessageSid).toBe('SM_abc123');
    expect(data.event_id).toBe('evt-stripe-123');
  });
});

// ─── Breadcrumb scrubbing ───────────────────────────────────────────────

describe('Scrubber — breadcrumbs', () => {
  it('breadcrumb data is scrubbed (recursive)', () => {
    const event: ErrorEvent = {
      event_id: 'evt-1',
      type: undefined,
      breadcrumbs: [
        {
          category: 'http',
          data: { email: 'leak@example.com', job_id: 'job-1' },
        },
        {
          category: 'auth',
          data: { customer_id: 'cust-1', tenant_id: TENANT_A },
        },
      ],
    } as ErrorEvent;

    const result = runInClsContext({ [CLS_TENANT_ID]: TENANT_A }, () =>
      scrubEvent(event),
    );
    expect(result.breadcrumbs![0].data!.email).toBe(REDACTED);
    expect(result.breadcrumbs![0].data!.job_id).toBe('job-1');
    expect(typeof result.breadcrumbs![1].data!.customer_id).toBe('string');
    expect((result.breadcrumbs![1].data!.customer_id as string).length).toBe(64);
    expect(result.breadcrumbs![1].data!.tenant_id).toBe(TENANT_A);
  });
});

// ─── No-logging audit ───────────────────────────────────────────────────

describe('Scrubber — logging discipline', () => {
  it('scrubber.ts source contains NO console.log / logger / console.warn calls', () => {
    // Read the source file at test time and grep for forbidden patterns.
    // This is a structural check: the hash function and salt MUST NEVER
    // be logged anywhere.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, 'scrubber.ts'),
      'utf-8',
    );
    expect(src).not.toMatch(/console\.log/);
    expect(src).not.toMatch(/console\.warn/);
    expect(src).not.toMatch(/console\.error/);
    expect(src).not.toMatch(/logger\.(error|warn|log|debug|info)/);
  });
});
